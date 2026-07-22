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

// PRIORITY METRICS — the exact set (and order) from the client's Final_Output_Data
// workbook. These MUST lead every ads analysis and dashboard, ahead of any other
// metric. `campaign_name` (or `ad_name` at ad level) is the row label; the rest
// are the 16 ordered measures. fmt drives display only.
const PRIORITY_METRICS = [
  { key: 'amount_spent', label: 'Amount spent (USD)', fmt: 'usd' },
  { key: 'frequency', label: 'Frequency', fmt: 'num2' },
  { key: 'hook_rate', label: 'Hook Rate', fmt: 'pct' },
  { key: 'through_rate', label: 'Through Rate', fmt: 'pct' },
  { key: 'reach', label: 'Reach', fmt: 'int' },
  { key: 'cost_per_reach', label: 'Cost Per Reach', fmt: 'usd4' },
  { key: 'impressions', label: 'Impressions', fmt: 'int' },
  { key: 'link_clicks', label: 'Link clicks', fmt: 'int' },
  { key: 'ctr', label: 'CTR (link click-through rate)', fmt: 'pct' },
  { key: 'cpc', label: 'CPC (cost per link click)', fmt: 'usd' },
  { key: 'cpm', label: 'CPM (cost per 1,000 impressions)', fmt: 'usd' },
  { key: 'video_plays_3s', label: '3-second video plays', fmt: 'int' },
  { key: 'video_plays_25', label: 'Video plays at 25%', fmt: 'int' },
  { key: 'video_plays_50', label: 'Video plays at 50%', fmt: 'int' },
  { key: 'video_plays_75', label: 'Video plays at 75%', fmt: 'int' },
  { key: 'cost_per_3s_play', label: 'Cost per 3-second video play', fmt: 'usd' },
];

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
// Raw fields needed to compute EVERY priority metric (Meta supports the full set).
// Video breakdowns + link-click variants are requested so Hook/Through rate,
// Cost Per Reach and Cost per 3-sec play can be derived exactly.
const META_RAW_FIELDS = [
  'spend', 'frequency', 'reach', 'impressions',
  'inline_link_clicks', 'inline_link_click_ctr', 'cost_per_inline_link_click', 'cpm',
  'video_play_actions', 'video_p25_watched_actions', 'video_p50_watched_actions',
  'video_p75_watched_actions', 'video_thruplay_watched_actions',
];
function metaActionVal(a) { return (Array.isArray(a) && a.length) ? (Number(a[0].value) || 0) : null; }
// Map one Meta insights row onto the 16 ordered priority measures (+ names).
function computeMetaPriority(r) {
  const spend = Number(r.spend || 0), reach = Number(r.reach || 0), impr = Number(r.impressions || 0);
  const v3 = metaActionVal(r.video_play_actions);
  const thru = metaActionVal(r.video_thruplay_watched_actions);
  const num = (x) => (x == null || x === '' ? null : Number(x));
  return {
    campaign_name: r.campaign_name || null,
    ad_name: r.ad_name || null,
    amount_spent: spend,
    frequency: num(r.frequency),
    hook_rate: (v3 != null && impr) ? v3 / impr : null,
    through_rate: (thru != null && impr) ? thru / impr : null,
    reach: reach || null,
    cost_per_reach: reach ? spend / reach : null,
    impressions: impr || null,
    link_clicks: num(r.inline_link_clicks),
    ctr: num(r.inline_link_click_ctr),
    cpc: num(r.cost_per_inline_link_click),
    cpm: num(r.cpm),
    video_plays_3s: v3,
    video_plays_25: metaActionVal(r.video_p25_watched_actions),
    video_plays_50: metaActionVal(r.video_p50_watched_actions),
    video_plays_75: metaActionVal(r.video_p75_watched_actions),
    cost_per_3s_play: v3 ? spend / v3 : null,
  };
}

// level: 'account' | 'campaign' | 'ad'. Default 'campaign' so results come back
// per campaign; use 'ad' for every individual ad.
async function metaInsights({ market, since, until, level = 'campaign' } = {}) {
  const token = envFor('META_ACCESS_TOKEN', market);
  const acct = envFor('META_AD_ACCOUNT_ID', market);
  const nameFields = level === 'ad' ? ['ad_name', 'campaign_name'] : level === 'campaign' ? ['campaign_name'] : [];
  const fields = nameFields.concat(META_RAW_FIELDS);
  const range = (since && until) ? { since, until } : defaultRange();
  const path = `act_${acct || '{META_AD_ACCOUNT_ID}'}/insights`;
  const params = { level, fields: fields.join(','), time_range: JSON.stringify(range), limit: 500 };
  const url = `https://graph.facebook.com/${GRAPH_VER}/${path}`;
  if (!token || !acct) {
    return notConnected('meta', market, { method: 'GET', url, params }, ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID']);
  }
  const full = `${url}?${qs({ ...params, access_token: token })}`;
  const r = await fetchJson(full);
  if (!r.ok) return { ok: false, connected: true, platform: 'meta', market: normMarket(market), status: r.status, error: (r.json && r.json.error && r.json.error.message) || 'meta insights request failed', raw: r.json };
  const rows = (r.json && r.json.data) || [];
  return {
    ok: true, connected: true, platform: 'meta', market: normMarket(market), level,
    window: range, source: 'meta_graph_insights',
    priority_metrics: PRIORITY_METRICS,
    rows: rows.map(computeMetaPriority),
    raw: rows,
  };
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
// Priority-metric GAQL, per campaign or per ad. Google's standard reports don't
// expose reach/frequency or 3-sec/quartile video PLAY COUNTS, so those priority
// fields come back null (never fabricated); Meta carries the full video funnel.
function gaqlPriority(level, since, until) {
  const base = ['metrics.cost_micros', 'metrics.impressions', 'metrics.clicks', 'metrics.ctr', 'metrics.average_cpc', 'metrics.average_cpm', 'metrics.video_views'];
  const where = (since && until) ? `WHERE segments.date BETWEEN '${since}' AND '${until}'` : 'WHERE segments.date DURING LAST_30_DAYS';
  if (level === 'ad') return `SELECT ad_group_ad.ad.name, ad_group_ad.ad.id, ${base.join(', ')} FROM ad_group_ad ${where}`;
  return `SELECT campaign.name, ${base.join(', ')} FROM campaign ${where}`;
}
function computeGooglePriority(row) {
  const m = row.metrics || {};
  const micros = (x) => (x == null ? null : Number(x) / 1e6);
  const name = (row.campaign && row.campaign.name) || null;
  const adName = (row.adGroupAd && row.adGroupAd.ad && row.adGroupAd.ad.name) || null;
  return {
    campaign_name: name, ad_name: adName,
    amount_spent: micros(m.costMicros),
    frequency: null, hook_rate: null, through_rate: null, reach: null, cost_per_reach: null,
    impressions: m.impressions != null ? Number(m.impressions) : null,
    link_clicks: m.clicks != null ? Number(m.clicks) : null,
    ctr: m.ctr != null ? Number(m.ctr) : null,
    cpc: micros(m.averageCpc),
    cpm: micros(m.averageCpm),
    video_plays_3s: m.videoViews != null ? Number(m.videoViews) : null,
    video_plays_25: null, video_plays_50: null, video_plays_75: null, cost_per_3s_play: null,
  };
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

async function googleInsights({ market, since, until, level = 'campaign' } = {}) {
  const dev = envFor('GOOGLE_ADS_DEVELOPER_TOKEN', market);
  const cust = envFor('GOOGLE_ADS_CUSTOMER_ID', market).replace(/-/g, '');
  const login = envFor('GOOGLE_ADS_LOGIN_CUSTOMER_ID', market).replace(/-/g, '');
  const range = (since && until) ? { since, until } : defaultRange();
  const query = gaqlPriority(level, since && until ? range.since : null, since && until ? range.until : null);
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
  // searchStream returns an array of batches, each with a `results` array.
  const batches = Array.isArray(r.json) ? r.json : [r.json];
  const results = batches.flatMap((b) => (b && b.results) || []);
  return {
    ok: true, connected: true, platform: 'google', market: normMarket(market), level,
    window: range, source: 'google_ads_api', query,
    priority_metrics: PRIORITY_METRICS,
    rows: results.map(computeGooglePriority),
    coverage_note: 'Google standard reports do not expose reach, frequency, or 3-sec/quartile video play counts; those priority fields are null (not fabricated). Meta carries the full video funnel.',
    raw: results,
  };
}

// ── TikTok Ads (integrated report) ───────────────────────────────────────────
const TIKTOK_METRICS = {
  conversion: ['spend', 'conversion', 'cost_per_conversion', 'conversion_rate', 'complete_payment', 'total_complete_payment_rate'],
  traffic: ['impressions', 'clicks', 'ctr', 'cpc', 'reach', 'spend'],
  engagement: ['impressions', 'video_play_actions', 'video_watched_2s', 'video_watched_6s', 'likes', 'comments', 'shares', 'spend'],
};

async function tiktokInsights({ market, metricGroup = 'conversion', since, until, level = 'campaign' } = {}) {
  const token = envFor('TIKTOK_ACCESS_TOKEN', market);
  const adv = envFor('TIKTOK_ADVERTISER_ID', market);
  const range = (since && until) ? { since, until } : defaultRange();
  const metrics = TIKTOK_METRICS[metricGroup] || TIKTOK_METRICS.conversion;
  const lvl = level === 'ad' ? { data_level: 'AUCTION_AD', dim: 'ad_id' }
    : level === 'campaign' ? { data_level: 'AUCTION_CAMPAIGN', dim: 'campaign_id' }
    : { data_level: 'AUCTION_ADVERTISER', dim: 'advertiser_id' };
  const params = {
    advertiser_id: adv || '{TIKTOK_ADVERTISER_ID}',
    report_type: 'BASIC', data_level: lvl.data_level,
    dimensions: JSON.stringify([lvl.dim]),
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

async function insights({ platform, market = 'US', metricGroup = 'conversion', metric_group, since, until, level = 'campaign' } = {}) {
  const mg = metricGroup || metric_group || 'conversion';
  const p = String(platform || '').toLowerCase();
  if (p === 'meta' || p === 'facebook' || p === 'instagram') return metaInsights({ market, since, until, level });
  if (p === 'google' || p === 'google_ads' || p === 'googleads') return googleInsights({ market, since, until, level });
  if (p === 'tiktok') return tiktokInsights({ market, metricGroup: mg, since, until, level });
  return { ok: false, error: `Unknown ad platform '${platform}'. Use one of: ${PLATFORMS.join(', ')}.` };
}

// Pull every platform for a market in parallel — the payload the ad-analysis /
// ChaiGPT reasons over. Connected platforms return real figures; unconnected
// ones return their would_request stub (never a fabricated number).
async function summary({ market = 'US', metricGroup = 'conversion', metric_group, since, until, level = 'campaign' } = {}) {
  const mg = metricGroup || metric_group || 'conversion';
  const mk = normMarket(market);
  const results = await Promise.all(PLATFORMS.map((p) => insights({ platform: p, market: mk, metricGroup: mg, since, until, level }).catch((e) => ({ ok: false, platform: p, error: e.message }))));
  const connected = results.filter((r) => r && r.connected && r.ok).map((r) => r.platform);
  const pending = results.filter((r) => r && r.not_connected).map((r) => r.platform);
  return {
    ok: true, market: mk, level, metric_group: mg,
    window: (since && until) ? { since, until } : defaultRange(),
    priority_metrics: PRIORITY_METRICS,
    connected_platforms: connected,
    pending_platforms: pending,
    platforms: results,
    note: pending.length
      ? `Live figures for: ${connected.join(', ') || 'none yet'}. Awaiting keys for: ${pending.join(', ')} (each result includes the exact request it will send). No ad numbers are fabricated. Priority metrics (${PRIORITY_METRICS.length}) lead every result.`
      : `Live figures from all connected platforms. Priority metrics lead every result.`,
  };
}

module.exports = {
  insights, summary, status, isConnected,
  metaInsights, googleInsights, tiktokInsights,
  PLATFORMS, METRIC_GROUPS, PRIORITY_METRICS, normMarket, envFor,
};
