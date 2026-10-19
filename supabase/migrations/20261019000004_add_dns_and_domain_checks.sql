alter table public.websites
  drop constraint if exists websites_accepted_status_min_range,
  drop constraint if exists websites_accepted_status_max_range,
  drop constraint if exists websites_accepted_status_order,
  drop column if exists accepted_status_min,
  drop column if exists accepted_status_max;

create table if not exists public.website_dns_checks (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  checked_at timestamptz not null default now(),
  dns_status text not null check (dns_status in ('resolved', 'missing', 'error')),
  dns_records jsonb not null default '{}'::jsonb,
  dns_changes jsonb not null default '[]'::jsonb,
  dns_error text,
  rdap_status text not null check (rdap_status in ('available', 'unavailable', 'error')),
  rdap_error text,
  domain_expires_at timestamptz,
  domain_alert_level text
);

create index if not exists website_dns_checks_website_checked_at_idx
  on public.website_dns_checks (website_id, checked_at desc);

alter table public.website_dns_checks enable row level security;
drop policy if exists website_dns_checks_owner_access on public.website_dns_checks;
create policy website_dns_checks_owner_access
  on public.website_dns_checks
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.websites
       where websites.id = website_dns_checks.website_id
         and websites.owner_id = (select auth.uid())
    )
  );

grant select on table public.website_dns_checks to authenticated;
grant all on table public.website_dns_checks to service_role;

create table if not exists public.website_dns_alerts (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  alert_type text not null,
  alert_key text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (website_id, alert_type, alert_key)
);

alter table public.website_dns_alerts enable row level security;
revoke all on table public.website_dns_alerts from anon, authenticated;
grant all on table public.website_dns_alerts to service_role;
