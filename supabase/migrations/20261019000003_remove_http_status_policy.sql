alter table public.websites
  drop constraint if exists websites_accepted_status_min_range,
  drop constraint if exists websites_accepted_status_max_range,
  drop constraint if exists websites_accepted_status_order,
  drop column if exists accepted_status_min,
  drop column if exists accepted_status_max;
