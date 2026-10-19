alter table public.websites
  add column if not exists accepted_status_min smallint not null default 100,
  add column if not exists accepted_status_max smallint not null default 499;

alter table public.websites
  drop constraint if exists websites_accepted_status_min_range,
  drop constraint if exists websites_accepted_status_max_range,
  drop constraint if exists websites_accepted_status_order;

alter table public.websites
  add constraint websites_accepted_status_min_range
    check (accepted_status_min between 100 and 599),
  add constraint websites_accepted_status_max_range
    check (accepted_status_max between 100 and 599),
  add constraint websites_accepted_status_order
    check (accepted_status_min <= accepted_status_max);
