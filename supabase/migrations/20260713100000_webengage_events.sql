-- WebEngage events store. WebEngage exports bulk .gz batches to a private
-- Supabase Storage bucket (webengage-dumps) every 12h; the ingestion in
-- api/_shared/webengage-core.js decompresses + upserts them here (dedupe on
-- event_id), then the campaigns/cohorts + ChaiGPT read from this table — the app
-- stays decoupled from WebEngage live latency.
create table if not exists public.webengage_events (
  id          uuid default gen_random_uuid() primary key,
  event_id    text unique not null,                              -- WebEngage unique id (dedupe)
  event_name  text not null,                                     -- 'Notification Clicked', 'Cart Abandoned', ...
  user_id     text,
  event_time  timestamptz,
  attributes  jsonb default '{}'::jsonb,                         -- campaign_name, os, location, target_region, ...
  created_at  timestamptz default timezone('utc'::text, now()) not null
);
create index if not exists idx_we_event_name  on public.webengage_events (event_name);
create index if not exists idx_we_event_time  on public.webengage_events (event_time);
create index if not exists idx_we_attributes  on public.webengage_events using gin (attributes);

alter table public.webengage_events enable row level security;
do $$ begin
  create policy "webengage_events_read"  on public.webengage_events for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "webengage_events_write" on public.webengage_events for insert with check (true);
exception when duplicate_object then null; end $$;
