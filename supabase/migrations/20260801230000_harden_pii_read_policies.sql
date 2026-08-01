-- ============================================================================
-- Harden the anon-readable policies on tables that carry personal data.
--
-- WHY THIS FILE EXISTS
-- Two earlier migrations grant `for select using (true)` — readable by anyone
-- holding the anon key — on tables that hold personal data:
--
--   20260713110000_polling_ingestion_tables.sql
--     shopify_orders  -> `email` (customer email, and it is indexed)
--     klaviyo_events  -> `profile_id` (pseudonymous person identifier)
--
--   20260706_lifecycle_os_backbone.sql
--     loops "read all" over all 18 backbone tables, three of which carry
--     user_email: workspace_members, saved_items, uploaded_files
--
-- That is the same exposure closed on ci_user_subscriptions in
-- 20260801220000. When those two migrations were applied to the live project
-- the PII grants were deliberately left out, so this file makes the repo agree
-- with the database: re-running the originals followed by this one converges to
-- the secure state instead of silently re-opening the hole.
--
-- None of these tables is read from the browser. Every access path is
-- server-side (os-backbone.js, the 12h poll ingest, ci-subscriptions-core) via
-- the service role, which bypasses RLS — so removing the anon grant costs the
-- application nothing.
--
-- Idempotent: `drop policy if exists`, and RLS enable is a no-op when already on.
-- ============================================================================

-- Tables keep RLS on; only the anon-facing read grant is removed.
alter table if exists public.shopify_orders     enable row level security;
alter table if exists public.klaviyo_events     enable row level security;
alter table if exists public.workspace_members  enable row level security;
alter table if exists public.saved_items        enable row level security;
alter table if exists public.uploaded_files     enable row level security;

drop policy if exists "shopify_orders_read" on public.shopify_orders;
drop policy if exists "klaviyo_events_read" on public.klaviyo_events;
drop policy if exists "read all" on public.workspace_members;
drop policy if exists "read all" on public.saved_items;
drop policy if exists "read all" on public.uploaded_files;

-- webengage_events keeps its read policy: user_id there is a WebEngage-internal
-- identifier with no email or name attached, and the events feed is read by the
-- dashboards. Revisit if the payload ever starts carrying contact details.
