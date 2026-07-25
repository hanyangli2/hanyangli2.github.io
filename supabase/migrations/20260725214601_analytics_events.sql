-- Anonymous product analytics for the personal site.
-- Anon can INSERT only. Reads stay private (service role / Studio).

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,
  props jsonb not null default '{}'::jsonb,
  session_id text,
  path text,
  referrer text,
  ua text
);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);

create index if not exists analytics_events_name_idx
  on public.analytics_events (name);

alter table public.analytics_events enable row level security;

-- Drop policies if re-running locally
drop policy if exists "anon can insert analytics events" on public.analytics_events;
drop policy if exists "no anon select analytics events" on public.analytics_events;

-- Allow public insert of a constrained event shape (validated again in API).
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
    and pg_column_size(props) <= 2048
  );

-- Explicitly deny reads for anon/authenticated. Service role bypasses RLS.
create policy "no anon select analytics events"
  on public.analytics_events
  for select
  to anon, authenticated
  using (false);

revoke all on table public.analytics_events from public;
grant insert on table public.analytics_events to anon, authenticated;
grant select, insert, update, delete on table public.analytics_events to service_role;
