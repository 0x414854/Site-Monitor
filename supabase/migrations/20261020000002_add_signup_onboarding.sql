create table if not exists public.signup_intents (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  subject_hash text not null,
  email text,
  user_id uuid references auth.users(id) on delete set null,
  plan_id text not null references public.plan_catalog(id),
  status text not null default 'awaiting_email'
    check (
      status in (
        'awaiting_email',
        'payment_required',
        'checkout_open',
        'payment_failed',
        'completed',
        'expired'
      )
    ),
  checkout_session_id text unique,
  checkout_attempt integer not null default 0 check (checkout_attempt >= 0),
  checkout_started_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signup_intents_user_status_created_idx
  on public.signup_intents (user_id, status, created_at desc);

create index if not exists signup_intents_expiry_idx
  on public.signup_intents (expires_at)
  where status = 'awaiting_email';

create table if not exists public.signup_rate_limits (
  subject_hash text primary key,
  intent_window_started_at timestamptz not null default now(),
  intent_count integer not null default 0 check (intent_count >= 0),
  resend_window_started_at timestamptz,
  resend_count integer not null default 0 check (resend_count >= 0),
  last_resend_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  claimed_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

alter table public.signup_intents enable row level security;
alter table public.signup_rate_limits enable row level security;
alter table public.stripe_webhook_events enable row level security;

revoke all on public.signup_intents, public.signup_rate_limits,
  public.stripe_webhook_events
  from public, anon, authenticated;
grant all on public.signup_intents, public.signup_rate_limits,
  public.stripe_webhook_events to service_role;

create or replace function public.reserve_signup_intent(p_subject_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reserved boolean;
begin
  if p_subject_hash is null or length(p_subject_hash) <> 64 then
    return false;
  end if;

  insert into public.signup_rate_limits (
    subject_hash,
    intent_window_started_at,
    intent_count
  )
  values (p_subject_hash, now(), 1)
  on conflict (subject_hash) do update
    set intent_window_started_at = case
          when signup_rate_limits.intent_window_started_at < now() - interval '1 hour'
            then now()
          else signup_rate_limits.intent_window_started_at
        end,
        intent_count = case
          when signup_rate_limits.intent_window_started_at < now() - interval '1 hour'
            then 1
          else signup_rate_limits.intent_count + 1
        end,
        updated_at = now()
    where signup_rate_limits.intent_window_started_at < now() - interval '1 hour'
       or signup_rate_limits.intent_count < 5
  returning true into reserved;

  return coalesce(reserved, false);
end;
$$;

create or replace function public.reserve_signup_email_resend(p_subject_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reserved boolean;
begin
  if p_subject_hash is null or length(p_subject_hash) <> 64 then
    return false;
  end if;

  insert into public.signup_rate_limits (
    subject_hash,
    resend_window_started_at,
    resend_count,
    last_resend_at
  )
  values (p_subject_hash, now(), 1, now())
  on conflict (subject_hash) do update
    set resend_window_started_at = case
          when signup_rate_limits.resend_window_started_at is null
            or signup_rate_limits.resend_window_started_at < now() - interval '24 hours'
            then now()
          else signup_rate_limits.resend_window_started_at
        end,
        resend_count = case
          when signup_rate_limits.resend_window_started_at is null
            or signup_rate_limits.resend_window_started_at < now() - interval '24 hours'
            then 1
          else signup_rate_limits.resend_count + 1
        end,
        last_resend_at = now(),
        updated_at = now()
    where (
        signup_rate_limits.last_resend_at is null
        or signup_rate_limits.last_resend_at < now() - interval '60 seconds'
      )
      and (
        signup_rate_limits.resend_window_started_at is null
        or signup_rate_limits.resend_window_started_at < now() - interval '24 hours'
        or signup_rate_limits.resend_count < 5
      )
  returning true into reserved;

  return coalesce(reserved, false);
end;
$$;

create or replace function public.reserve_signup_checkout(p_intent_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  attempt integer;
begin
  update public.signup_intents
     set status = 'checkout_open',
         checkout_attempt = checkout_attempt + 1,
         checkout_started_at = now(),
         updated_at = now()
   where id = p_intent_id
     and (
       status in ('payment_required', 'payment_failed')
       or (
         status = 'checkout_open'
         and checkout_session_id is null
         and checkout_started_at < now() - interval '5 minutes'
       )
     )
  returning checkout_attempt into attempt;

  return attempt;
end;
$$;

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed boolean;
  current_status text;
begin
  insert into public.stripe_webhook_events (
    event_id,
    event_type,
    status,
    attempts,
    claimed_at
  )
  values (p_event_id, p_event_type, 'processing', 1, now())
  on conflict (event_id) do update
    set status = 'processing',
        attempts = stripe_webhook_events.attempts + 1,
        claimed_at = now(),
        last_error = null
    where stripe_webhook_events.status = 'failed'
       or (
         stripe_webhook_events.status = 'processing'
         and stripe_webhook_events.claimed_at < now() - interval '5 minutes'
       )
  returning true into claimed;

  if coalesce(claimed, false) then
    return 'claimed';
  end if;

  select status
    into current_status
    from public.stripe_webhook_events
   where event_id = p_event_id;

  if current_status = 'processed' then
    return 'processed';
  end if;

  return 'busy';
end;
$$;

revoke all on function public.reserve_signup_intent(text)
  from public, anon, authenticated;
revoke all on function public.reserve_signup_email_resend(text)
  from public, anon, authenticated;
revoke all on function public.reserve_signup_checkout(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_stripe_webhook_event(text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_signup_intent(text) to service_role;
grant execute on function public.reserve_signup_email_resend(text) to service_role;
grant execute on function public.reserve_signup_checkout(uuid) to service_role;
grant execute on function public.claim_stripe_webhook_event(text, text)
  to service_role;
