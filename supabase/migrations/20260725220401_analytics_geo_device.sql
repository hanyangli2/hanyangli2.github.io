-- Enrich analytics with coarse geo + device (no raw IP).

alter table public.analytics_events
  add column if not exists country text,
  add column if not exists city text,
  add column if not exists device text,
  add column if not exists os text;

create index if not exists analytics_events_country_idx
  on public.analytics_events (country);

create index if not exists analytics_events_device_idx
  on public.analytics_events (device);

drop policy if exists "anon can insert analytics events" on public.analytics_events;

create policy "anon can insert analytics events"
  on public.analytics_events
  for insert
  to anon, authenticated
  with check (
    char_length(name) between 1 and 64
    and (session_id is null or char_length(session_id) <= 64)
    and (path is null or char_length(path) <= 512)
    and (referrer is null or char_length(referrer) <= 512)
    and (ua is null or char_length(ua) <= 512)
    and (country is null or char_length(country) <= 8)
    and (city is null or char_length(city) <= 64)
    and (device is null or char_length(device) <= 16)
    and (os is null or char_length(os) <= 16)
    and pg_column_size(props) <= 2048
  );
