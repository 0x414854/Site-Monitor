alter table public.website_integrity_scans
  add column if not exists links_discovered integer,
  add column if not exists external_links_discovered integer,
  add column if not exists result_reason text;

alter table public.website_integrity_scans
  add constraint website_integrity_scans_links_discovered_nonnegative
    check (links_discovered is null or links_discovered >= 0),
  add constraint website_integrity_scans_external_links_discovered_nonnegative
    check (
      external_links_discovered is null
      or external_links_discovered >= 0
    );
