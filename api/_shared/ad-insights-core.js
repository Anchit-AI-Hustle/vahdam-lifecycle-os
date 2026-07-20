'use strict';

/**
 * api/_shared/ad-insights-core.js — READ-ONLY paid-ads performance for VAHDAM.
 *
 * Fetches ad results straight from each platform's OWN reporting API:
 *   • Meta Ads   — Graph API Insights   (conversion / traffic / engagement)
 *   • Google Ads — Google Ads API (GAQL, searchStream)
 *   • TikTok Ads — Business API integrated report
 *
 * Region-aware: every credential resolves per-market first
 * (e.g. META_AD_ACCOUNT_ID_US / _UK) and falls back to the generic var, so US
 * and UK ad accounts are reported separately for the region the assets/analysis
 * are for.
 *
 * Scaffold pattern (same as klaviyo-core): until a platform's keys are set,
 * every op returns a structured { connected:false, would_request } envelope with
 * the EXACT request it WOULD send — so the chat + ad-analysis flows work
 * end-to-end and only need keys to go live. It NEVER fabricates an ad figure.
 *
 * Read-only: only reporting/read endpoints are called — no campaign create /
 * update / pause. (The ad hosts are not the guarded Shopify/Klaviyo/WebEngage
 * hosts, but the same fetch-only posture applies by construction here.)
 *
 * Env (set in Vercel — never hardcode; append _US / _UK for per-market accounts):
 *   Meta:    META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
 *   Google:  GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
 *            GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
 *            GOOGLE_ADS_CUSTOMER_ID (+ optional GOOGLE_ADS_LOGIN_CUSTOMER_ID)
 *   TikTok:  TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID
 *
 * Docs: Meta https://developers.facebook.com/docs/marketing-api/insights ·
 *       Google https://developers.google.com/google-ads/api/docs/reporting ·
 *       TikTok https://business-api.tiktok.com/portal/docs?id=1740302848100353
 */

const GRAPH_VER = 'v21.0';
const GADS_VER = 'v18';
const TIKTOK_BASE = 'https://business-api.tiktok.com/open_api/v1.3';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const PLATFORMS = ['meta', 'google', 'tiktok'];
const METRIC_GROUPS = ['conversion', 'traffic', 'engagement'];

function normMarket(m) {
  const s = String(m || 'US').trim().toUpperCase();
  if (['US', 'USA', 'UNITED STATES'].includes(s)) return 'US';
  if (['UK', 'GB', 'UNITED KINGDOM', 'BRITAIN'].includes(s)) return 'UK';
  return s;
}

// Per-market credential: <BASE>_<MARKET> wins, else the generic <BASE>.
function envFor(base, market) {
  const mk = normMarket(market);
  return String(process.env[`${base}_${mk}`] || process.env[base] || '').trim();
}

function qs(obj) {
  return Object.entries(obj || {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function toIso(d) { return d.toISOString().slice(0, 10); }
function defaultRange(days = 30) {
  const until = new Date();
  const since = new Date(Date.now() - days * 86400000);
  return { since: toIso(since), until: toIso(until) };
}

function notConnected(platform, market, wouldRequest, needEnv) {
  return {
    ok: false, connected: false, not_connected: true,
    platform, market: normMarket(market),
    would_request: wouldRequest,
    need_env: needEnv,
    hint: `Set ${needEnv.join(', ')} in Vercel env (append _${normMarket(market)} for a market-specific ad account) to fetch real ${platform} results. The request shape above is exactly what will be sent.`,
  };
}

async function fetchJson(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text }; }
    return { status: res.status, ok: res.ok, json };
  } finally { clearTimeout(t); }
}

// ── Meta Ads (Graph API Insights) ───────────────────────────────────────────
const META_FIELDS = {
  conversion: ['spend', 'actions', 'action_values', 'purchase_roas', 'cost_per_action_type', 'impressions', 'clicks'],
  traffic: ['impressions', 'clicks', 'ctr', 'cpc', 'reach', 'frequency', 'inline_link_clicks', 'spend'],
  engagement: ['impressions', 'reach', 'actions', 'cost_per_action_type', 'spend'],
};

async function metaInsights({ market, metricGroup = 'conversion', since, until, level = 'account' } = {}) {
  const token = envFor('META_ACCESS_TOKEN', market);
  const acct = envFor('META_AD_ACCOUNT_ID', market);
  const fields = META_FIELDS[metricGroup] || META_FIELDS.conversion;
  const range = (since && until) ? { since, until } : defaultRange();
  const path = `act_${acct || '{META_AD_ACCOUNT_ID}'}/insights`;
  const params = { level, fields: fields.join(','), time_range: JSON.stringify(range) };
  const url = `https://graph.facebook.com/${GRAPH_VER}/${path}`;
  if (!token || !acct) {
    return notConnected('meta', market, { method: 'GET', url, params }, ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID']);
  }
  const full = `${url}?${qs({ ...params, access_token: token })}`;
  const r = await fetchJson(full);
  if (!r.ok) return { ok: false, connected: true, platform: 'meta', market: normMarket(market), status: r.status, error: (r.json && r.json.error && r.json.error.message) || 'meta insights request failed', raw: r.json };
  return { ok: true, connected: true, platform: 'meta', market: normMarket(market), metric_group: metricGroup, window: range, source: 'meta_graph_insights', data: (r.json && r.json.data) || [] };
}

// ── Google Ads (GAQL via searchStream) ───────────────────────────────────────
const GADS_METRICS = {
  conversion: ['metrics.conversions', 'metrics.conversions_value', 'metrics.cost_per_conversion', 'metrics.cost_micros', 'metrics.all_conversions'],
  traffic: ['metrics.impressions', 'metrics.clicks', 'metrics.ctr', 'metrics.average_cpc', 'metrics.cost_micros'],
  engagement: ['metrics.engagements', 'metrics.engagement_rate', 'metrics.interactions', 'metrics.video_views', 'metrics.cost_micros'],
};

function gaqlFor(metricGroup, since, until) {
  const metrics = (GADS_METRICS[metricGroup] || GADS_METRICS.conversion).join(', ');
  const where = (since && until) ? `WHERE segments.date BETWEEN '${since}' AND '${until}'` : 'WHERE segments.date DURING LAST_30_DAYS';
  return `SELECT ${metrics} FROM customer ${where}`;
}

async function googleAccessToken(market) {
  const cid = envFor('GOOGLE_ADS_CLIENT_ID', market);
  const cs = envFor('GOOGLE_ADS_CLIENT_SECRET', market);
  const rt = envFor('GOOGLE_ADS_REFRESH_TOKEN', market);
  if (!cid || !cs || !rt) return null;
  const r = await fetchJson(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: qs({ client_id: cid, client_secret: cs, refresh_token: rt, grant_type: 'refresh_token' }),
  });
  return (r.json && r.json.access_token) || null;
}

async function googleInsights({ market, metricGroup = 'conversion', since, until } = {}) {
  const dev = envFor('GOOGLE_ADS_DEVELOPER_TOKEN', market);
  const cust = envFor('GOOGLE_ADS_CUSTOMER_ID', market).replace(/-/g, '');
  const login = envFor('GOOGLE_ADS_LOGIN_CUSTOMER_ID', market).replace(/-/g, '');
  const range = (since && until) ? { since, until } : defaultRange();
  const query = gaqlFor(metricGroup, since && until ? range.since : null, since && until ? range.until : null);
  const url = `https://googleads.googleapis.com/${GADS_VER}/customers/${cust || '{GOOGLE_ADS_CUSTOMER_ID}'}/googleAds:searchStream`;
  const need = ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'];
  if (!dev || !cust) {
    return notConnected('google', market, { method: 'POST', url, headers: { 'developer-token': '{GOOGLE_ADS_DEVELOPER_TOKEN}', authorization: 'Bearer {oauth_access_token}' }, body: { query } }, need);
  }
  const token = await googleAccessToken(market);
  if (!token) return notConnected('google', market, { method: 'POST', url, body: { query } }, need);
  const headers = { authorization: `Bearer ${token}`, 'developer-token': dev, 'content-type': 'application/json' };
  if (login) headers['login-customer-id'] = login;
  const r = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify({ query }) });
  if (!r.ok) return { ok: false, connected: true, platform: 'google', market: normMarket(market), status: r.status, error: 'google ads request failed', raw: r.json };
  return { ok: true, connected: true, platform: 'google', market: normMarket(market), metric_group: metricGroup, window: range, source: 'google_ads_api', query, data: r.json };
}

// ── TikTok Ads (integrated report) ───────────────────────────────────────────
const TIKTOK_METRICS = {
  conversion: ['spend', 'conversion', 'cost_per_conversion', 'conversion_rate', 'complete_payment', 'total_complete_payment_rate'],
  traffic: ['impressions', 'clicks', 'ctr', 'cpc', 'reach', 'spend'],
  engagement: ['impressions', 'video_play_actions', 'video_watched_2s', 'video_watched_6s', 'likes', 'comments', 'shares', 'spend'],
};

async function tiktokInsights({ market, metricGroup = 'conversion', since, until } = {}) {
  const token = envFor('TIKTOK_ACCESS_TOKEN', market);
  const adv = envFor('TIKTOK_ADVERTISER_ID', market);
  const range = (since && until) ? { since, until } : defaultRange();
  const metrics = TIKTOK_METRICS[metricGroup] || TIKTOK_METRICS.conversion;
  const params = {
    advertiser_id: adv || '{TIKTOK_ADVERTISER_ID}',
    report_type: 'BASIC', data_level: 'AUCTION_ADVERTISER',
    dimensions: JSON.stringify(['advertiser_id']),
    metrics: JSON.stringify(metrics),
    start_date: range.since, end_date: range.until,
  };
  const url = `${TIKTOK_BASE}/report/integrated/get/`;
  if (!token || !adv) {
    return notConnected('tiktok', market, { method: 'GET', url, params, headers: { 'Access-Token': '{TIKTOK_ACCESS_TOKEN}' } }, ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID']);
  }
  const full = `${url}?${qs(params)}`;
  const r = await fetchJson(full, { headers: { 'Access-Token': token } });
  if (!r.ok || (r.json && r.json.code && r.json.code !== 0)) {
    return { ok: false, connected: true, platform: 'tiktok', market: normMarket(market), status: r.status, error: (r.json && r.json.message) || 'tiktok report request failed', raw: r.json };
  }
  return { ok: true, connected: true, platform: 'tiktok', market: normMarket(market), metric_group: metricGroup, window: range, source: 'tiktok_business_report', data: (r.json && r.json.data) || r.json };
}

// ── Dispatch + roll-up ───────────────────────────────────────────────────────
function isConnected(platform, market) {
  switch (platform) {
    case 'meta': return !!(envFor('META_ACCESS_TOKEN', market) && envFor('META_AD_ACCOUNT_ID', market));
    case 'google': return !!(envFor('GOOGLE_ADS_DEVELOPER_TOKEN', market) && envFor('GOOGLE_ADS_CUSTOMER_ID', market) && envFor('GOOGLE_ADS_REFRESH_TOKEN', market));
    case 'tiktok': return !!(envFor('TIKTOK_ACCESS_TOKEN', market) && envFor('TIKTOK_ADVERTISER_ID', market));
    default: return false;
  }
}

function status(market) {
  const mk = normMarket(market);
  return {
    ok: true, market: mk,
    platforms: PLATFORMS.map((p) => ({ platform: p, connected: isConnected(p, mk) })),
    any_connected: PLATFORMS.some((p) => isConnected(p, mk)),
    note: 'Ad results are fetched from each platform\'s own reporting API. Unconnected platforms return the exact request they would send; no ad figures are ever fabricated.',
  };
}

async function insights({ platform, market = 'US', metricGroup = 'conversion', metric_group, since, until } = {}) {
  const mg = metricGroup || metric_group || 'conversion';
  const p = String(platform || '').toLowerCase();
  const args = { market, metricGroup: mg, since, until };
  if (p === 'meta' || p === 'facebook' || p === 'instagram') return metaInsights(args);
  if (p === 'google' || p === 'google_ads' || p === 'googleads') return googleInsights(args);
  if (p === 'tiktok') return tiktokInsights(args);
  return { ok: false, error: `Unknown ad platform '${platform}'. Use one of: ${PLATFORMS.join(', ')}.` };
}

// Pull every platform for a market in parallel — the payload the ad-analysis /
// ChaiGPT reasons over. Connected platforms return real figures; unconnected
// ones return their would_request stub (never a fabricated number).
async function summary({ market = 'US', metricGroup = 'conversion', metric_group, since, until } = {}) {
  const mg = metricGroup || metric_group || 'conversion';
  const mk = normMarket(market);
  const results = await Promise.all(PLATFORMS.map((p) => insights({ platform: p, market: mk, metricGroup: mg, since, until }).catch((e) => ({ ok: false, platform: p, error: e.message }))));
  const connected = results.filter((r) => r && r.connected && r.ok).map((r) => r.platform);
  const pending = results.filter((r) => r && r.not_connected).map((r) => r.platform);
  return {
    ok: true, market: mk, metric_group: mg,
    window: (since && until) ? { since, until } : defaultRange(),
    connected_platforms: connected,
    pending_platforms: pending,
    platforms: results,
    note: pending.length
      ? `Live figures for: ${connected.join(', ') || 'none yet'}. Awaiting keys for: ${pending.join(', ')} (each result includes the exact request it will send). No ad numbers are fabricated.`
      : `Live figures from all connected platforms.`,
  };
}

module.exports = {
  insights, summary, status, isConnected,
  metaInsights, googleInsights, tiktokInsights,
  PLATFORMS, METRIC_GROUPS, normMarket, envFor,
};
