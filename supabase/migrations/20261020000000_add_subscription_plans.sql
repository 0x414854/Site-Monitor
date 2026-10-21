create table if not exists public.plan_catalog (
  id text primary key,
  name text not null,
  description text not null default '',
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'eur',
  billing_interval text,
  stripe_price_id text unique,
  max_sites integer not null check (max_sites >= 0),
  history_days integer not null check (history_days > 0),
  check_interval_hours integer not null check (check_interval_hours > 0),
  feature_flags jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_catalog_billing_interval_check
    check (billing_interval is null or billing_interval in ('month', 'year'))
);

insert into public.plan_catalog (
  id,
  name,
  description,
  price_cents,
  currency,
  billing_interval,
  max_sites,
  history_days,
  check_interval_hours,
  feature_flags,
  display_order
)
values
  (
    'free',
    'Gratuit',
    'Pour découvrir la surveillance web.',
    0,
    'eur',
    null,
    1,
    30,
    24,
    '{"http":true,"ssl":true,"dns":true,"security_headers":false,"integrity":false,"advanced_alerts":false,"multi_site":false}'::jsonb,
    1
  ),
  (
    'starter',
    'Starter',
    'Pour les indépendants et petits projets.',
    1700,
    'eur',
    'month',
    5,
    90,
    24,
    '{"http":true,"ssl":true,"dns":true,"security_headers":true,"integrity":true,"advanced_alerts":true,"multi_site":false}'::jsonb,
    2
  ),
  (
    'pro',
    'Pro',
    'Pour les freelances et agences web.',
    4700,
    'eur',
    'month',
    25,
    365,
    24,
    '{"http":true,"ssl":true,"dns":true,"security_headers":true,"integrity":true,"advanced_alerts":true,"multi_site":true}'::jsonb,
    3
  )
on conflict (id) do nothing;

create table if not exists public.user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null references public.plan_catalog(id),
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_subscriptions_plan_id_idx
  on public.user_subscriptions (plan_id);
create index if not exists user_subscriptions_status_plan_id_idx
  on public.user_subscriptions (status, plan_id);

alter table public.plan_catalog enable row level security;
alter table public.user_subscriptions enable row level security;

drop policy if exists plan_catalog_public_read on public.plan_catalog;
create policy plan_catalog_public_read
  on public.plan_catalog
  for select
  to anon
  using (active);

drop policy if exists plan_catalog_authenticated_read on public.plan_catalog;
create policy plan_catalog_authenticated_read
  on public.plan_catalog
  for select
  to authenticated
  using (
    active
    or exists (
      select 1
        from public.user_subscriptions
       where user_subscriptions.plan_id = plan_catalog.id
         and user_subscriptions.user_id = (select auth.uid())
    )
  );

drop policy if exists user_subscriptions_owner_read on public.user_subscriptions;
create policy user_subscriptions_owner_read
  on public.user_subscriptions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.plan_catalog from anon, authenticated;
grant select on public.plan_catalog to anon, authenticated;
revoke all on public.user_subscriptions from anon, authenticated;
grant select on public.user_subscriptions to authenticated;
grant all on public.plan_catalog, public.user_subscriptions to service_role;

create or replace function public.create_free_subscription_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.user_subscriptions (user_id, plan_id, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_free_subscription_for_new_user()
  from public, anon, authenticated;

drop trigger if exists create_free_subscription_after_signup on auth.users;
create trigger create_free_subscription_after_signup
after insert on auth.users
for each row execute function public.create_free_subscription_for_new_user();

insert into public.user_subscriptions (user_id, plan_id, status)
select id, 'free', 'active'
from auth.users
on conflict (user_id) do nothing;

create or replace function public.enforce_website_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  site_limit integer;
  current_site_count integer;
begin
  if new.owner_id is null then
    raise exception 'Un site doit appartenir à un utilisateur.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.owner_id = old.owner_id then
    return new;
  end if;

  perform 1
    from public.user_subscriptions
   where user_id = new.owner_id
   for update;

  select plans.max_sites
    into site_limit
    from public.user_subscriptions subscriptions
    join public.plan_catalog plans on plans.id = subscriptions.plan_id
   where subscriptions.user_id = new.owner_id
     and subscriptions.status in ('active', 'trialing', 'past_due');

  if site_limit is null then
    raise exception 'Aucun forfait actif ne permet de créer un site.'
      using errcode = '42501';
  end if;

  select count(*)
    into current_site_count
    from public.websites
   where owner_id = new.owner_id;

  if current_site_count >= site_limit then
    raise exception 'La limite de sites de votre forfait est atteinte.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_website_plan_limit()
  from public, anon, authenticated;

drop trigger if exists enforce_website_plan_limit_before_insert
  on public.websites;
create trigger enforce_website_plan_limit_before_write
before insert or update of owner_id on public.websites
for each row execute function public.enforce_website_plan_limit();

grant execute on function public.enforce_website_plan_limit() to service_role;
