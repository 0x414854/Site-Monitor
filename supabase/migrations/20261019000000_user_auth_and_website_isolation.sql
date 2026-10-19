alter table public.websites
  add column if not exists owner_id uuid references auth.users(id);

create table if not exists public.site_monitor_bootstrap_claim (
  id boolean primary key default true check (id),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz
);

alter table public.site_monitor_bootstrap_claim enable row level security;
revoke all on public.site_monitor_bootstrap_claim from anon, authenticated;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = any (array[
         'websites',
         'website_checks',
         'website_incidents',
         'website_ssl_checks',
         'website_ssl_alerts',
         'website_security_checks',
         'website_integrity_config',
         'website_integrity_scans',
         'website_integrity_findings',
         'notification_outbox'
       ])
  loop
    execute format(
      'drop policy %I on %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename
    );
  end loop;
end;
$$;

create or replace function public.claim_legacy_websites_for_first_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_claimant uuid;
begin
  insert into public.site_monitor_bootstrap_claim (id)
  values (true)
  on conflict (id) do nothing;

  select claimed_by
    into current_claimant
    from public.site_monitor_bootstrap_claim
   where id = true
   for update;

  if current_claimant is null then
    update public.websites
       set owner_id = new.id
     where owner_id is null;

    update public.site_monitor_bootstrap_claim
       set claimed_by = new.id,
           claimed_at = now()
     where id = true;
  end if;

  return new;
end;
$$;

revoke all on function public.claim_legacy_websites_for_first_user()
  from public, anon, authenticated;

do $$
declare
  first_user_id uuid;
begin
  select id
    into first_user_id
    from auth.users
   order by created_at, id
   limit 1;

  if first_user_id is not null then
    insert into public.site_monitor_bootstrap_claim (id, claimed_by, claimed_at)
    values (true, first_user_id, now())
    on conflict (id) do nothing;

    update public.websites
       set owner_id = first_user_id
     where owner_id is null;
  end if;
end;
$$;

drop trigger if exists claim_legacy_websites_after_signup on auth.users;
create trigger claim_legacy_websites_after_signup
after insert on auth.users
for each row execute function public.claim_legacy_websites_for_first_user();

alter table public.websites enable row level security;
drop policy if exists websites_owner_access on public.websites;
create policy websites_owner_access
  on public.websites
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

alter table public.website_checks enable row level security;
drop policy if exists website_checks_owner_access on public.website_checks;
create policy website_checks_owner_access
  on public.website_checks
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.websites
       where websites.id = website_checks.website_id
         and websites.owner_id = (select auth.uid())
    )
  );

alter table public.website_incidents enable row level security;
drop policy if exists website_incidents_owner_access on public.website_incidents;
create policy website_incidents_owner_access
  on public.website_incidents
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.websites
       where websites.id = website_incidents.website_id
         and websites.owner_id = (select auth.uid())
    )
  );

alter table public.website_ssl_checks enable row level security;
drop policy if exists website_ssl_checks_owner_access on public.website_ssl_checks;
create policy website_ssl_checks_owner_access
  on public.website_ssl_checks
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.websites
       where websites.id = website_ssl_checks.website_id
         and websites.owner_id = (select auth.uid())
    )
  );

alter table public.website_ssl_alerts enable row level security;
drop policy if exists website_ssl_alerts_owner_access on public.website_ssl_alerts;
create policy website_ssl_alerts_owner_access
  on public.website_ssl_alerts
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.websites
       where websites.id = website_ssl_alerts.website_id
         and websites.owner_id = (select auth.uid())
    )
  );

alter table public.website_security_checks enable row level security;
drop policy if exists website_security_checks_owner_access
  on public.website_security_checks;
create policy website_security_checks_owner_access
  on public.website_security_checks
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.websites
       where websites.id = website_security_checks.website_id
         and websites.owner_id = (select auth.uid())
    )
  );

alter table public.website_integrity_config enable row level security;
drop policy if exists website_integrity_config_owner_access
  on public.website_integrity_config;
create policy website_integrity_config_owner_access
  on public.website_integrity_config
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.websites
       where websites.id = website_integrity_config.website_id
         and websites.owner_id = (select auth.uid())
    )
  );

alter table public.website_integrity_scans enable row level security;
drop policy if exists website_integrity_scans_owner_access
  on public.website_integrity_scans;
create policy website_integrity_scans_owner_access
  on public.website_integrity_scans
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.websites
       where websites.id = website_integrity_scans.website_id
         and websites.owner_id = (select auth.uid())
    )
  );

alter table public.website_integrity_findings enable row level security;
drop policy if exists website_integrity_findings_owner_access
  on public.website_integrity_findings;
create policy website_integrity_findings_owner_access
  on public.website_integrity_findings
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.website_integrity_scans
        join public.websites
          on websites.id = website_integrity_scans.website_id
       where website_integrity_scans.id = website_integrity_findings.scan_id
         and websites.owner_id = (select auth.uid())
    )
  );

alter table public.notification_outbox enable row level security;

do $$
declare
  routine regprocedure;
begin
  for routine in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('record_website_check', 'claim_notification_events')
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      routine
    );
    execute format('grant execute on function %s to service_role', routine);
  end loop;
end;
$$;
