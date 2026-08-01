'use strict';

/**
 * revenue-analysis-core.js — ONE combined revenue analysis across every
 * dimension the business actually has: region, channel, platform, campaign →
 * ad set → ad, mailer, landing page, product, cohort and time.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 * Every cut is ALWAYS present in the response, so the UI can render a tab for
 * each and nothing is silently missing. Each cut declares its own provenance:
 *
 *   { key, label, available, source, grain, rows, blocker, note }
 *
 * `available:false` + a `blocker` means "this analysis exists and is scoped,
 * but the source that could answer it is not connected". It never means an
 * empty array of zeroes dressed up as a finding.
 *
 * ── Where the numbers come from, and what is NOT used ───────────────────────
 * REAL: data/analytics/market-data.json, built by scripts/build-market-analytics.js
 * from the actual Shopify CSV exports (US 20,620 orders / UK). This is the only
 * first-party revenue truth in the repo, and it carries far more dimensions than
 * anything was reading: channel, product type, product, month, week, day of
 * week, discount split, new vs returning, acquisition and cohort retention.
 *
 * DELIBERATELY NOT USED: the `smart_*` Supabase tables (smart_orders,
 * smart_sales_history, smart_campaign_metrics …). They look like a perfect
 * revenue substrate — 4,530 orders, market/channel/campaign/spend/revenue
 * columns spanning 2024-06 to 2026-06 — but they are SEED FIXTURES, not real
 * trade: sequential ids (o_01317, u_0130), placeholder SKUs (VAH-US-004), totals
 * that are always whole dollars, discounts only ever 0/5/10/15, and a single
 * rfm_segment value ("champions"). Building revenue reporting on them would put
 * fabricated money in front of the business, which is the one thing this project
 * must never do. They are reported in `excluded_sources` so the exclusion is
 * visible rather than silent.
 *
 * LIVE WHEN CONNECTED: platform / campaign / ad set / ad revenue comes from the
 * ad platforms (Meta action_values, Google conversions_value, TikTok complete
 * payment value); mailer revenue from Klaviyo + WebEngage; landing-page revenue
 * from PageDeck. None is connected today, so each returns its blocker.
 */

const market = require('./market-analytics.js');
const adInsights = require('./ad-insights-core.js');
const klaviyo = require('./klaviyo-core.js');
const webengage = require('./webengage-core.js');
const pagedeck = require('./pagedeck-core.js');
const shopify = require('./shopify-core.js');

const n = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
const round = (v, d = 2) => Math.round(n(v) * 10 ** d) / 10 ** d;
const rate = (a, b) => (n(b) ? round(n(a) / n(b), 4) : null);
const iso = () => new Date().toISOString();

// The seed tables we refuse to report as revenue, and why. Surfaced in the
// payload so "why isn't this using the orders table?" has an answer in-product.
const EXCLUDED_SOURCES = [{
  source: 'supabase smart_orders / smart_sales_history / smart_campaign_metrics',
  rows_present: '4530 / 1122 / 192',
  excluded_because: 'Seed fixtures, not real trade. Sequential ids (o_01317), placeholder SKUs (VAH-US-004), whole-dollar totals, discounts only ever 0/5/10/15, a single rfm_segment value. Reporting these as revenue would present fabricated money as real.',
  to_make_usable: 'Replace with a real order feed (Shopify Admin via /api/shopify, or a warehouse mirror of live orders).',
}];

function cut(key, label, grain, extra) {
  return Object.assign({ key, label, grain, available: false, source: null, rows: [], blocker: null, note: null }, extra || {});
}

// ── Region ──────────────────────────────────────────────────────────────────
function byRegion() {
  const all = market.data().markets || {};
  const rows = Object.keys(all).map((mk) => {
    const s = (all[mk] || {}).summary || {};
    return {
      region: mk, orders: n(s.orders), gross_sales: round(s.gross_sales), net_sales: round(s.net_sales),
      total_sales: round(s.total_sales), aov: round(s.aov), quantity: n(s.quantity),
      new_customers: n(s.new_customers), returning_customers: n(s.returning_customers),
      returning_rate: s.returning_rate == null ? null : round(s.returning_rate, 4),
      revenue_per_customer: rate(s.total_sales, n(s.new_customers) + n(s.returning_customers)),
    };
  }).sort((a, b) => b.total_sales - a.total_sales);
  return cut('region', 'Revenue by region', 'market', {
    available: rows.length > 0, source: 'Shopify CSV export (data/analytics/market-data.json)', rows,
    note: rows.length ? `Regions with a loaded export: ${rows.map((r) => r.region).join(', ')}. Other markets need their export dropped into data/market/.` : null,
    blocker: rows.length ? null : 'No market export loaded — run scripts/build-market-analytics.js.',
  });
}

// ── Simple pass-through cuts off the real export ─────────────────────────────
function section(mk, name) {
  const m = (market.data().markets || {})[market.normMarket(mk)] || {};
  return Array.isArray(m[name]) ? m[name] : [];
}
function exportCut(key, label, grain, mk, name, map, blockerHint) {
  const rows = section(mk, name).map(map);
  return cut(key, label, grain, {
    available: rows.length > 0, source: 'Shopify CSV export (data/analytics/market-data.json)', rows,
    blocker: rows.length ? null : (blockerHint || `The ${mk} export carries no "${name}" section.`),
  });
}

function realCuts(mk) {
  return [
    exportCut('channel', 'Revenue by sales channel', 'channel', mk, 'channels', (r) => ({
      channel: r.channel, orders: n(r.orders), sales: round(r.sales), net: round(r.net), aov: round(r.aov),
      share_of_sales: null, // filled after totals are known
    })),
    exportCut('product_type', 'Revenue by product type / category', 'product_type', mk, 'product_types', (r) => ({
      product_type: r.type, net: round(r.net), orders: n(r.orders), quantity: n(r.quantity),
      net_per_order: rate(r.net, r.orders), net_per_unit: rate(r.net, r.quantity),
    })),
    exportCut('product', 'Revenue by product', 'product', mk, 'top_products', (r) => ({
      product: r.title, net: round(r.net), quantity: n(r.quantity), orders: n(r.orders),
      net_per_unit: rate(r.net, r.quantity),
    })),
    exportCut('month', 'Revenue by month', 'month', mk, 'monthly', (r) => ({
      month: r.month, orders: n(r.orders), sales: round(r.sales), aov: round(r.aov),
    })),
    exportCut('week', 'Revenue by week', 'week', mk, 'weekly', (r) => ({
      week: r.week, orders: n(r.orders), sales: round(r.sales), net: round(r.net), aov: round(r.aov),
    })),
    exportCut('day_of_week', 'Revenue by day of week', 'weekday', mk, 'day_of_week', (r) => ({
      day: r.dow, orders: n(r.orders), sales: round(r.sales), net: round(r.net), aov: round(r.aov),
    })),
    exportCut('discount', 'Discounted vs full price', 'discount_flag', mk, 'discount', (r) => ({
      discounted: r.discounted, orders: n(r.orders), sales: round(r.sales), net: round(r.net), aov: round(r.aov),
    })),
    exportCut('new_vs_returning', 'New vs returning revenue', 'month', mk, 'new_vs_returning', (r) => ({
      month: r.month, new_customers: n(r.new_c), returning_customers: n(r.ret_c),
      new_orders: n(r.new_o), returning_orders: n(r.ret_o),
      returning_order_share: rate(r.ret_o, n(r.new_o) + n(r.ret_o)),
    })),
    exportCut('acquisition', 'Acquisition cohort revenue', 'month', mk, 'acquisition', (r) => ({
      month: r.month, new_customers: n(r.new_c), orders: n(r.orders), sales: round(r.sales),
      sales_per_new_customer: rate(r.sales, r.new_c),
    })),
    exportCut('cohort_retention', 'Cohort retention', 'cohort', mk, 'cohort', (r) => ({
      cohort: r.cohort, base: n(r.base), retention: r.retention,
    })),
    exportCut('aov_trend', 'AOV trend', 'month', mk, 'aov_trend', (r) => ({
      month: r.month, aov: round(r.aov), orders: n(r.orders), sales: round(r.sales),
    })),
  ];
}

// ── Paid media: platform → campaign → ad set → ad ───────────────────────────
// Revenue per ad entity is only knowable from the ad platform itself. Meta
// reports it in action_values, Google in conversions_value, TikTok in
// total_complete_payment_value.
const AD_LEVELS = [
  { key: 'platform', label: 'Revenue by platform', level: 'account', grain: 'platform' },
  { key: 'campaign', label: 'Revenue by campaign', level: 'campaign', grain: 'campaign' },
  { key: 'adset', label: 'Revenue by ad set / ad group', level: 'adset', grain: 'adset' },
  { key: 'ad', label: 'Revenue by ad / creative', level: 'ad', grain: 'ad' },
];

function metaRevenueRow(x, platform, level) {
  const actions = Array.isArray(x.action_values) ? x.action_values : [];
  // First present, never summed — Meta repeats a purchase under several types.
  let revenue = 0;
  for (const k of ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']) {
    const hit = actions.find((a) => String(a.action_type) === k);
    if (hit) { revenue = n(hit.value); break; }
  }
  const spend = n(x.spend);
  return {
    platform, level,
    entity: x.ad_name || x.adset_name || x.campaign_name || x.account_name || '(unnamed)',
    entity_id: x.ad_id || x.adset_id || x.campaign_id || x.account_id || '',
    campaign: x.campaign_name || '', adset: x.adset_name || '',
    spend: round(spend), revenue: round(revenue),
    roas: spend ? round(revenue / spend, 2) : null,
    profit: round(revenue - spend),
  };
}

async function adCut(spec, mk, since, until) {
  const results = await Promise.all(adInsights.PLATFORMS.map((p) =>
    adInsights.insights({ platform: p, market: mk, metricGroup: 'conversion', level: spec.level, since, until })
      .catch((e) => ({ ok: false, platform: p, error: e.message }))));

  const rows = [];
  const blockers = [];
  for (const r of results) {
    if (!r) continue;
    if (r.not_connected) { blockers.push(`${r.platform}: set ${(r.need_env || []).join(', ')}`); continue; }
    if (!r.ok) { blockers.push(`${r.platform}: ${String(r.error).slice(0, 90)}`); continue; }
    if (r.platform === 'meta') (r.data || []).forEach((x) => rows.push(metaRevenueRow(x, 'Meta', spec.level)));
    // Google and TikTok payload shapes differ per level; they are normalised by
    // the existing ads view. Rather than duplicate that mapping (and risk it
    // drifting), a connected-but-unmapped platform is reported honestly.
    else blockers.push(`${r.platform}: connected, revenue mapping for this level is served by the Live Ads view`);
  }
  return cut(spec.key, spec.label, spec.grain, {
    available: rows.length > 0,
    source: rows.length ? 'Ad platform reporting APIs (revenue = purchase action values)' : null,
    rows: rows.sort((a, b) => b.revenue - a.revenue),
    blocker: rows.length ? null : (blockers.join(' · ') || 'No ad platform connected.'),
    note: 'Ad-platform revenue is platform-attributed and will not tie exactly to Shopify totals — attribution windows and view-through differ by platform.',
  });
}

// ── Mailer + landing page ───────────────────────────────────────────────────
async function mailerCut(mk, hours) {
  const [we, klCon] = await Promise.all([
    webengage.campaignPerformance({ event: 'Notification Clicked', hours, market: mk, top: 100 }).catch((e) => ({ ok: false, error: e.message })),
    Promise.resolve(klaviyo.isConnected()),
  ]);
  const rows = [];
  if (we && we.ok && Array.isArray(we.campaigns)) {
    we.campaigns.forEach((c) => rows.push({
      mailer: c.campaign, source: 'WebEngage', events: n(c.events), unique_users: n(c.unique_users),
      revenue: c.revenue == null ? null : round(c.revenue),
    }));
  }
  const blockers = [];
  if (!klCon) blockers.push('Klaviyo: set KLAVIYO_API_KEY (+ LIVE_CONNECTORS=on) for per-campaign attributed revenue');
  if (!we || !we.ok) blockers.push(`WebEngage: ${(we && we.error) || 'no stored events'}`);
  return cut('mailer', 'Revenue by mailer / campaign send', 'mailer', {
    available: rows.some((r) => r.revenue != null),
    source: rows.length ? 'WebEngage stored events' : null, rows,
    blocker: rows.some((r) => r.revenue != null) ? null : (blockers.join(' · ') || 'No mailer source connected.'),
    note: 'Attributed mailer revenue requires Klaviyo — WebEngage events alone give engagement, not money.',
  });
}

async function landingCut(mk) {
  const d = await pagedeck.analytics({ market: mk }).catch((e) => ({ ok: false, error: e.message }));
  const pages = (d && Array.isArray(d.pages)) ? d.pages : [];
  const rows = pages.map((p) => ({
    page: p.name, status: p.status || null, visitors: n(p.visitors), conversions: n(p.conversions),
    conversion_rate: p.conversion_rate == null ? null : round(p.conversion_rate, 4),
    revenue: p.revenue == null ? null : round(p.revenue), aov: p.aov == null ? null : round(p.aov),
    revenue_per_visitor: rate(p.revenue, p.visitors),
  })).sort((a, b) => n(b.revenue) - n(a.revenue));
  return cut('landing_page', 'Revenue by landing page', 'landing_page', {
    available: rows.length > 0, source: rows.length ? ((d.connector && d.connector.sources || []).join(' · ') || 'PageDeck') : null, rows,
    blocker: rows.length ? null : ((d && d.connector && d.connector.note) || 'PageDeck not connected — set PAGEDECK_ANALYTICS_EXPORT_URL or populate the pagedeck_pages mirror.'),
  });
}

// ── Commerce truth check ────────────────────────────────────────────────────
async function liveCommerce(mk, days) {
  const s = await shopify.summary({ market: mk, days }).catch((e) => ({ ok: false, error: e.message }));
  return cut('live_orders', 'Live order feed (reconciliation)', 'window', {
    available: !!(s && s.ok),
    source: s && s.ok ? s.source : null,
    rows: s && s.ok ? [{ window_days: s.window_days, orders: s.orders, revenue: s.revenue, aov: s.aov, returning_rate: s.returning_rate_pct, currency: s.currency }] : [],
    blocker: s && s.ok ? null : ((s && (s.blocker || s.error)) || 'Shopify not connected.'),
    note: 'The export cuts above are a point-in-time file. This is the live feed to reconcile them against.',
  });
}

/**
 * The whole analysis. `market` scopes the export-backed cuts; region is
 * cross-market by definition.
 */
async function revenue({ market: mk = 'US', since, until, days = 30, hours = 720 } = {}) {
  const mkN = market.normMarket(mk);
  const perf = market.performance(mkN);

  const [platform, campaign, adset, ad, mailer, landing, live] = await Promise.all([
    ...AD_LEVELS.map((spec) => adCut(spec, mkN, since, until)),
    mailerCut(mkN, hours),
    landingCut(mkN),
    liveCommerce(mkN, days),
  ]);

  const cuts = [byRegion(), ...realCuts(mkN), platform, campaign, adset, ad, mailer, landing, live];

  // Share-of-sales is computed against the SUM OF THE CUT'S OWN ROWS, never
  // against summary.total_sales. The summary is a 2026-YTD window while the
  // channel breakdown spans the full export, so dividing one by the other put
  // "Online Store" at 167% of total. A share must only ever be taken over rows
  // that share a window.
  const chan = cuts.find((c) => c.key === 'channel');
  if (chan && chan.rows.length) {
    const cutTotal = chan.rows.reduce((a, r) => a + n(r.sales), 0);
    chan.rows.forEach((r) => { r.share_of_sales = rate(r.sales, cutTotal); });
    chan.note = `Share is of the ${round(cutTotal)} total across these channels, which spans the full export window — NOT the ${perf.ok && perf.summary ? perf.summary.window || 'summary' : 'summary'} figure shown in the header.`;
  }

  const available = cuts.filter((c) => c.available);
  return {
    ok: true, generated_at: iso(), market: mkN,
    currency: market.cur ? market.cur(mkN) : null,
    summary: perf.ok ? perf.summary : null,
    summary_source: perf.ok ? (perf.source || 'Shopify CSV export') : null,
    coverage: {
      total_cuts: cuts.length,
      available: available.length,
      blocked: cuts.length - available.length,
      available_keys: available.map((c) => c.key),
      blocked_keys: cuts.filter((c) => !c.available).map((c) => c.key),
    },
    cuts,
    excluded_sources: EXCLUDED_SOURCES,
    note: 'Every revenue cut is listed whether or not it has data. A blocked cut names the source that would answer it — no cut is filled with zeroes or estimates.',
  };
}

module.exports = { revenue, byRegion, realCuts, AD_LEVELS, EXCLUDED_SOURCES };
