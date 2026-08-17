'use strict';
/**
 * connectors-health.js — REAL live probes for every data platform, so "is the
 * live data working?" is answered by an actual round-trip, not by guessing from
 * which env vars are set. Each probe hits the platform (or its stored table) and
 * reports {live, latency_ms, sample, blocker}. Never fabricates: a platform with
 * no credential is reported live:false with the exact blocker.
 *
 * Exposed at /api/connectors-health (GET). Reused by the connectors page + the
 * dashboard so the UI shows the true state of every platform.
 *
 * Covers all seven: Klaviyo, Shopify, WebEngage, Supabase, Meta Ads, Google Ads
 * and TikTok Ads. The three ad platforms used to be absent here, so the one
 * endpoint that answers "is live data working?" was blind to the entire paid
 * media stack — it could report 4/4 healthy while no ad platform was connected.
 */
const klaviyo = require('./klaviyo-core.js');
const webengage = require('./webengage-core.js');
const market = require('./market-analytics.js');
const shopifyCore = require('./shopify-core.js');
const adInsights = require('./ad-insights-core.js');
const catalogLive = require('./catalog-live.js');
const catalogGate = require('./catalog-gate.js');
const { liveConnectorsEnabled } = require('./live-connectors.js');

async function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`timeout ${ms}ms`)), ms))]); }

// ── Klaviyo: a real read (metrics) confirms the key + live API. ──────────────
// THE PROBE ATTEMPTS THE READ; IT DOES NOT PREDICT IT FROM ENV VARS.
// This used to short-circuit on klaviyo.isConnected(), which is
// `LIVE_CONNECTORS on AND key set`. But klaviyo-core's request() gates only on
// the key, so with the switch off and a key set, Klaviyo answers live while this
// endpoint reported `live:false, blocker: "Set KLAVIYO_API_KEY"` — a blocker
// naming a variable that was already correctly set. That is the worst possible
// failure for a health check: it sent people to fix a thing that was not broken
// while the integration was working the whole time.
// A health check's entire job is to report what IS, so it now runs the read and
// lets the result decide, and it distinguishes the three real states: no key,
// key present but the kill switch is off, and live.
async function probeKlaviyo() {
  const base = { id: 'klaviyo', name: 'Klaviyo', kind: 'live-api' };
  if (!klaviyo.hasKey()) return { ...base, live: false, blocker: 'Set KLAVIYO_API_KEY in Vercel env.' };
  const t = Date.now();
  try {
    const r = await withTimeout(klaviyo.getMetrics(), 15000);
    const ok = !!(r && r.ok);
    const n = ok && r.data && Array.isArray(r.data.data) ? r.data.data.length : null;
    const out = {
      ...base, live: ok, latency_ms: Date.now() - t,
      sample: ok ? `${n} metrics reachable` : null,
      error: ok ? null : JSON.stringify((r && (r.error || r.hint)) || 'unknown').slice(0, 140),
    };
    // Surface the inconsistency rather than hiding it behind a green tick: the
    // connector is reaching Klaviyo through a switch that is meant to stop it.
    if (ok && !liveConnectorsEnabled()) {
      out.note = 'Reading live even though LIVE_CONNECTORS is off — klaviyo-core.request() gates on the API key only, not on the kill switch. Set LIVE_CONNECTORS=on so the switch and the behaviour agree.';
      out.kill_switch_bypassed = true;
    }
    if (!ok && !liveConnectorsEnabled()) out.blocker = 'Live connectors are disabled — set LIVE_CONNECTORS=on.';
    return out;
  } catch (e) { return { ...base, live: false, latency_ms: Date.now() - t, error: e.message }; }
}

// ── Shopify: live Admin API via the read-only core; else honest export fallback. ──
async function probeShopify() {
  const base = { id: 'shopify', name: 'Shopify', kind: 'live-api' };
  const exportsOk = market.performance('US').ok; // real CSV exports available regardless
  const fallback = exportsOk ? 'public storefront + CSV market exports (real, not live)' : 'none';
  if (!shopifyCore.isConnected('US')) {
    return { ...base, live: false, source: fallback, blocker: shopifyCore.status('US').blocker };
  }
  const t = Date.now();
  try {
    const r = await withTimeout(shopifyCore.shop({ market: 'US' }), 15000);
    const name = r && r.ok && r.data && r.data.shop ? r.data.shop.name : null;
    return {
      ...base, live: !!(r && r.ok), latency_ms: Date.now() - t,
      sample: r && r.ok ? `shop: ${name}` : null,
      source: r && r.ok ? 'shopify admin api (live)' : fallback,
      error: r && r.ok ? null : String((r && (r.error || r.status)) || 'unknown').slice(0, 140),
    };
  } catch (e) { return { ...base, live: false, latency_ms: Date.now() - t, source: fallback, error: e.message }; }
}

// ── Ad platforms: one real round-trip each, account level, 7-day window. ─────
// A credential that is set but expired or wrongly scoped is the failure mode
// that matters here, and only an actual request surfaces it.
const AD_PLATFORMS = [
  { id: 'meta', name: 'Meta Ads' },
  { id: 'google', name: 'Google Ads' },
  { id: 'tiktok', name: 'TikTok Ads' },
];
function isoDaysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

async function probeAdPlatform(p, marketCode = 'US') {
  const base = { id: p.id, name: p.name, kind: 'live-api', market: marketCode };
  if (!adInsights.isConnected(p.id, marketCode)) {
    // Reuse the core's own env list so the blocker can never drift from what the
    // code actually requires.
    const probe = await adInsights.insights({ platform: p.id, market: marketCode, level: 'account' }).catch(() => null);
    const need = (probe && probe.need_env) || [];
    return { ...base, live: false, blocker: need.length ? `Set ${need.join(', ')} in Vercel env (append _${marketCode} for a market-specific account).` : `${p.name} credentials not set.` };
  }
  const t = Date.now();
  try {
    const r = await withTimeout(adInsights.insights({
      platform: p.id, market: marketCode, level: 'account', metricGroup: 'traffic',
      since: isoDaysAgo(7), until: isoDaysAgo(0),
    }), 20000);
    const live = !!(r && r.ok && r.connected);
    return {
      ...base, live, latency_ms: Date.now() - t,
      sample: live ? `${p.name} reporting reachable (${r.source})` : null,
      error: live ? null : String((r && r.error) || 'request failed').slice(0, 140),
    };
  } catch (e) { return { ...base, live: false, latency_ms: Date.now() - t, error: e.message }; }
}

// ── WebEngage: table reachable + has rows (populated by the 12h sync). ───────
async function probeWebengage() {
  const base = { id: 'webengage', name: 'WebEngage', kind: 'stored-table' };
  const e = webengage.env();
  if (!e.url || !e.key) return { ...base, live: false, blocker: 'Set SUPABASE_SERVICE_ROLE_KEY (+ WEBENGAGE_EXPORT_URL/API_KEY or the webengage-dumps bucket).' };
  const t = Date.now();
  try {
    const r = await withTimeout(fetch(`${e.url}/rest/v1/webengage_events?select=id&limit=1`, { headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, Prefer: 'count=exact' } }), 15000);
    const total = parseInt((r.headers.get('content-range') || '').split('/')[1], 10) || 0;
    // PostgREST answers 404 when the relation is not in its schema cache — i.e.
    // the migration has not been applied. That is a different fix from "empty
    // table", and reporting it as a bare "HTTP 404" with no blocker (as this
    // did) leaves the operator with nothing to act on.
    const missingTable = r.status === 404;
    return {
      ...base, live: r.ok && total > 0, latency_ms: Date.now() - t,
      sample: r.ok ? `${total} events stored` : null,
      blocker: missingTable
        ? 'Table webengage_events does not exist — apply supabase/migrations/20260713110000_polling_ingestion_tables.sql (or supabase/COMBINED_RUN_THIS.sql), then run the 12h sync (/api/cron/webengage).'
        : (r.ok && total === 0 ? 'Table reachable but empty — set WEBENGAGE_EXPORT_URL + WEBENGAGE_API_KEY (or the webengage-dumps bucket) and run the 12h sync (/api/cron/webengage).' : null),
      error: r.ok ? null : `HTTP ${r.status}`,
    };
  } catch (e2) { return { ...base, live: false, latency_ms: Date.now() - t, error: e2.message }; }
}

// ── Supabase (storage backbone) ──────────────────────────────────────────────
async function probeSupabase() {
  const base = { id: 'supabase', name: 'Supabase', kind: 'database' };
  const e = webengage.env();
  if (!e.url || !e.key) return { ...base, live: false, blocker: 'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.' };
  const t = Date.now();
  try {
    const r = await withTimeout(fetch(`${e.url}/rest/v1/?apikey=${encodeURIComponent(e.key)}`, { headers: { apikey: e.key, Authorization: `Bearer ${e.key}` } }), 12000);
    return { ...base, live: r.ok, latency_ms: Date.now() - t, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e2) { return { ...base, live: false, latency_ms: Date.now() - t, error: e2.message }; }
}

// ── Live catalog: the one connector whose absence STOPS creative work. ───────
// Probed by attempting the read, not by inspecting env vars — the Klaviyo
// lesson: predicting connectivity from configuration is how the health page
// ends up telling an operator to set a key that is already set and working.
async function probeCatalog(mk = 'US') {
  const base = { id: 'catalog', name: 'Live product catalog', kind: 'live-api', market: mk };
  const t = Date.now();
  try {
    const snap = await withTimeout(catalogLive.primeCatalog(mk, { fresh: true }), 20000);
    const bypassed = catalogGate.gateMode() === 'off';
    return {
      ...base,
      live: !!snap.live,
      latency_ms: Date.now() - t,
      source: snap.source || 'none',
      sample: snap.count ? `${snap.count} products from ${snap.source}` : null,
      blocker: snap.live
        // A bypass is reported as a live defect even when the catalog IS live,
        // because it means nothing downstream is actually enforcing this.
        ? (bypassed ? 'CATALOG_GATE=off - the pre-creative live-catalog check is bypassed. Creative can ship on stale data. Unset it.' : null)
        : snap.blocker,
      gate: bypassed ? 'BYPASSED (CATALOG_GATE=off)' : 'enforcing',
      blocks_creative: !snap.live && !bypassed,
    };
  } catch (e) {
    return { ...base, live: false, latency_ms: Date.now() - t, error: e.message, blocks_creative: true };
  }
}

async function health({ market: mk = 'US' } = {}) {
  const platforms = await Promise.all([
    probeKlaviyo(), probeShopify(), probeCatalog(mk), probeWebengage(), probeSupabase(),
    ...AD_PLATFORMS.map((p) => probeAdPlatform(p, mk)),
  ]);
  const live = platforms.filter((p) => p.live).length;
  const byGroup = (ids) => platforms.filter((p) => ids.includes(p.id));
  const adIds = AD_PLATFORMS.map((p) => p.id);
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    market: mk,
    summary: { live, blocked: platforms.length - live, total: platforms.length },
    // Grouped so a dashboard can say "paid media: 0/3 live" without re-deriving
    // which platform belongs to which side of the stack.
    groups: {
      paid_media: { live: byGroup(adIds).filter((p) => p.live).length, total: adIds.length },
      lifecycle: { live: byGroup(['klaviyo', 'webengage']).filter((p) => p.live).length, total: 2 },
      commerce: { live: byGroup(['shopify', 'catalog']).filter((p) => p.live).length, total: 2 },
    },
    // Hoisted out of the platform list because it is the one condition that
    // stops work rather than degrading it: no live catalog, no creative.
    creative_blocked: platforms.some((p) => p.id === 'catalog' && p.blocks_creative),
    platforms,
  };
}

module.exports = { health, probeKlaviyo, probeShopify, probeCatalog, probeWebengage, probeSupabase, probeAdPlatform, AD_PLATFORMS };
