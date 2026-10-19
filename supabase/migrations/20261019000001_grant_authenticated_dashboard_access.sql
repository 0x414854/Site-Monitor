grant usage on schema public to authenticated;

grant select on table
  public.websites,
  public.website_checks,
  public.website_incidents,
  public.website_ssl_checks,
  public.website_ssl_alerts,
  public.website_security_checks,
  public.website_integrity_config,
  public.website_integrity_scans,
  public.website_integrity_findings
to authenticated;

grant insert, update, delete on table public.websites to authenticated;
