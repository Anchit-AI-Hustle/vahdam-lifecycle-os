-- ============================================================================
-- Close anon access to the two tables that hold subscriber PII.
--
-- ci_user_subscriptions and ci_notification_log were the ONLY two tables of 57
-- in this schema with row level security disabled and zero policies, so anyone
-- holding the (public, client-shipped) anon key could read or modify every row.
-- Both carry user_email, so this was a live PII exposure rather than a lint.
--
-- WHY NOT COPY THE SIBLING ci_* TABLES
-- The other ci_* tables enable RLS and then grant `FOR ALL TO public USING
-- (true)`. That satisfies the security advisor while leaving the data just as
-- readable to anon as having no RLS at all. Copying that pattern here would
-- have silenced the warning without fixing the exposure. It is not copied.
--
-- WHY NO ANON POLICY IS NEEDED
-- These two tables are touched only by api/_shared/ci-subscriptions-core.js,
-- which runs server-side through api/_shared/supa.js. No .html page queries
-- them. supa.js prefers SUPABASE_SERVICE_ROLE_KEY, and the service role bypasses
-- RLS, so the application keeps full access with no policy granting it.
--
-- ⚠️ DEPENDENCY: supa.js falls back to SUPABASE_ANON_KEY when the service-role
-- key is absent. On a deployment running that fallback, subscriptions and the
-- notification log will start returning empty after this migration — which is
-- the correct outcome (anon must not read subscriber emails), but it means
-- SUPABASE_SERVICE_ROLE_KEY has to be set for the feature to keep working.
-- ============================================================================

alter table public.ci_user_subscriptions enable row level security;
alter table public.ci_notification_log   enable row level security;

-- The service role bypasses RLS regardless, but declaring these makes the
-- intent explicit: a future reader seeing zero policies could reasonably think
-- the table was left half-configured, which is how the original gap survived.
drop policy if exists ci_user_subscriptions_service_only on public.ci_user_subscriptions;
create policy ci_user_subscriptions_service_only
  on public.ci_user_subscriptions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists ci_notification_log_service_only on public.ci_notification_log;
create policy ci_notification_log_service_only
  on public.ci_notification_log
  for all
  to service_role
  using (true)
  with check (true);

-- Deliberately NO policy for anon or authenticated: neither should ever read a
-- subscriber's email address from the client.
