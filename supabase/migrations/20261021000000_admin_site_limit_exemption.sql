create table if not exists public.platform_admin_accounts (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.platform_admin_accounts enable row level security;
revoke all on public.platform_admin_accounts from public, anon, authenticated;
grant all on public.platform_admin_accounts to service_role;

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

  if exists (
    select 1
      from public.platform_admin_accounts
     where singleton
       and user_id = new.owner_id
  ) then
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
grant execute on function public.enforce_website_plan_limit() to service_role;
