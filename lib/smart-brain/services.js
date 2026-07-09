'use strict';

/**
 * VAHDAM Smart Brain service layer.
 *
 * The module is intentionally dependency-light so it can run inside one Vercel
 * serverless function. It exposes clean service contracts for KB, Analysis,
 * Competitor Benchmarking, Calendar Intelligence, Generation, and Review.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CONFIG = {
  markets: ['US', 'UK'],
  calendarDays: 15,
  performanceThresholds: {
    email: { openRate: 0.22, clickRate: 0.018, conversionRate: 0.006, revenuePerRecipient: 0.08 },
    meta: { ctr: 0.009, cvr: 0.012, roas: 1.6 },
    google: { ctr: 0.025, cvr: 0.018, roas: 1.8 },
    tiktok: { ctr: 0.007, cvr: 0.008, roas: 1.3 },
    landing_page: { conversionRate: 0.018 },
  },
  confidence: {
    minHumanVerificationConfidence: 0.82,
    weeklyRecalibrationDays: 7,
  },
  capacity: {
    emailPerMarketPerWeek: 4,
    paidCampaignsPerMarketPerWeek: 5,
  },
  tableNames: {
    products: 'smart_products',
    assets: 'smart_assets',
    campaigns: 'smart_campaigns',
    campaignAssets: 'smart_campaign_assets',
    campaignMetrics: 'smart_campaign_metrics',
    users: 'smart_users',
    orders: 'smart_orders',
    events: 'smart_events',
    competitors: 'smart_competitor_campaigns',
    mvtResults: 'smart_mvt_results',
    feedback: 'smart_feedback',
    generatedCampaigns: 'smart_generated_campaigns',
    runs: 'smart_brain_runs',
    calendarEntries: 'smart_calendar_entries',
    adsGenerated: 'ads_generated',
    landingPagesGenerated: 'landing_pages_generated',
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return { ...base };
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v;
  }
  return out;
}

function smartConfig(overrides = {}) {
  let fileConfig = {};
  const cfgPath = path.join(process.cwd(), 'smart-brain.config.json');
  if (fs.existsSync(cfgPath)) {
    try { fileConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) { fileConfig = {}; }
  }
  return deepMerge(deepMerge(DEFAULT_CONFIG, fileConfig), overrides);
}

function idFor(prefix, input) {
  return `${prefix}_${crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 12)}`;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function round(n, digits = 4) { return Number.isFinite(+n) ? Number((+n).toFixed(digits)) : 0; }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function asArray(x) { return Array.isArray(x) ? x : []; }
function norm(s) { return String(s || '').trim(); }
function slug(s) { return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'campaign'; }

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (quote && c === '"' && next === '"') { cell += '"'; i++; continue; }
    if (c === '"') { quote = !quote; continue; }
    if (!quote && c === ',') { row.push(cell); cell = ''; continue; }
    if (!quote && (c === '\n' || c === '\r')) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function readCsvIfExists(rel) {
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) return [];
  return parseCsv(fs.readFileSync(p, 'utf8'));
}

function loadFestivals() {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'festivals.json'), 'utf8')); }
  catch (_) { return {}; }
}

class SmartBrainDbAdapter {
  constructor(config = smartConfig()) {
    this.config = config;
    // Linked-DB-first: data/linked-db.json is the provided linked database.
    let linked = {};
    try { linked = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'linked-db.json'), 'utf8')); } catch (_) {}
    this.url = (process.env.SMART_BRAIN_SUPABASE_URL || linked.url || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    this.key = process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY || process.env.SMART_BRAIN_SUPABASE_KEY || linked.anonKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  }
  get connected() { return Boolean(this.url && this.key); }
  headers() { return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }; }
  async select(table, params = {}) {
    if (!this.connected) return null;
    const search = new URLSearchParams({ select: params.select || '*' });
    if (params.limit) search.set('limit', String(params.limit));
    if (params.order) search.set('order', params.order);
    for (const [k, v] of Object.entries(params.filters || {})) search.set(k, v);
    const r = await fetch(`${this.url}/rest/v1/${table}?${search}`, { headers: this.headers() });
    if (!r.ok) throw new Error(`Supabase select ${table} failed: ${r.status} ${await r.text()}`);
    return r.json();
  }
  async insert(table, rows) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    const r = await fetch(`${this.url}/rest/v1/${table}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(rows) });
    if (!r.ok) return { ok: false, warning: `Supabase insert ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async upsert(table, rows, onConflict = 'id', { resolution = 'merge-duplicates' } = {}) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    // resolution='ignore-duplicates' makes an insert that NEVER overwrites an existing
    // row — used by syncDaily so a slot approved mid-window is not clobbered back to tentative.
    const headers = { ...this.headers(), Prefer: `return=representation,resolution=${resolution}` };
    const r = await fetch(`${this.url}/rest/v1/${table}?on_conflict=${onConflict}`, { method: 'POST', headers, body: JSON.stringify(rows) });
    if (!r.ok) return { ok: false, warning: `Supabase upsert ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async update(table, filters, patch) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(filters || {})) search.set(k, v);
    const r = await fetch(`${this.url}/rest/v1/${table}?${search}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(patch) });
    if (!r.ok) return { ok: false, warning: `Supabase update ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async delete(table, filters) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(filters || {})) search.set(k, v);
    // Guard: refuse an unfiltered DELETE (would wipe the table).
    if (![...search.keys()].length) return { ok: false, warning: `Supabase delete ${table} refused: no filters` };
    const r = await fetch(`${this.url}/rest/v1/${table}?${search}`, { method: 'DELETE', headers: this.headers() });
    if (!r.ok) return { ok: false, warning: `Supabase delete ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async ownData() {
    if (this.connected) {
      const t = this.config.tableNames;
      const [products, assets, campaigns, campaignAssets, campaignMetrics, users, orders, events, mvtResults, feedback] = await Promise.all([
        this.select(t.products, { limit: 5000 }), this.select(t.assets, { limit: 5000 }),
        this.select(t.campaigns, { limit: 5000 }), this.select(t.campaignAssets, { limit: 10000 }),
        this.select(t.campaignMetrics, { limit: 20000 }), this.select(t.users, { limit: 20000 }),
        this.select(t.orders, { limit: 20000 }), this.select(t.events, { limit: 50000 }),
        this.select(t.mvtResults, { limit: 5000 }).catch(() => []), this.select(t.feedback, { limit: 5000 }).catch(() => []),
      ]);
      return { source: 'supabase', products, assets, campaigns, campaignAssets, campaignMetrics, users, orders, events, mvtResults, feedback };
    }
    return this.localFallbackData();
  }
  async competitorData() {
    if (this.connected) {
      const competitors = await this.select(this.config.tableNames.competitors, { limit: 5000, order: 'observed_at.desc' }).catch(() => []);
      return { source: 'supabase', competitors };
    }
    return { source: 'local-empty', competitors: [] };
  }
  localFallbackData() {
    const productsRaw = readCsvIfExists('input/uploaded_by_anchit/shopify_products.csv')
      .concat(readCsvIfExists('Vahdam Product Catalog RegionWise/products_export_usa.csv'))
      .concat(readCsvIfExists('Vahdam Product Catalog RegionWise/products_export_uk.csv'));
    const ordersRaw = readCsvIfExists('input/uploaded_by_anchit/shopify_orders.csv');
    const customersRaw = readCsvIfExists('input/uploaded_by_anchit/shopify_customers.csv');
    const campaignsRaw = readCsvIfExists('input/uploaded_by_anchit/klaviyo_campaigns.csv').concat(readCsvIfExists('data/klaviyo/campaigns.csv'));
    const products = productsRaw.slice(0, 500).map((p, i) => ({
      id: p.id || p.ID || p.Handle || `local_product_${i}`,
      sku: p.Variant_SKU || p['Variant SKU'] || p.SKU || p.Handle || `SKU-${i}`,
      title: p.Title || p.title || p.Name || p.Handle || `VAHDAM Product ${i + 1}`,
      handle: p.Handle || p.handle || slug(p.Title || p.Name || `product-${i}`),
      category: p.Type || p['Product Category'] || p.Category || 'Tea & Wellness',
      market: /uk/i.test(p.__file || '') ? 'UK' : 'US',
      price: num(p['Variant Price'] || p.Price || p.price, 0),
      tags: String(p.Tags || p.tags || '').split(',').map((x) => x.trim()).filter(Boolean),
    }));
    const campaigns = campaignsRaw.slice(0, 500).map((c, i) => ({
      id: c.id || c.Campaign_ID || c.Name || `local_campaign_${i}`,
      name: c.Name || c.Campaign || c.subject || c.Subject || `Lifecycle Campaign ${i + 1}`,
      channel: c.channel || c.Channel || 'email',
      market: c.market || c.Market || 'US',
      campaign_type: c.type || c.Type || 'lifecycle',
      subject: c.Subject || c.subject || c.Name || '',
      sent_at: c.Sent_At || c['Send Time'] || c.date || '',
      cohort_key: c.segment || c.Segment || 'All Customers',
    }));
    // No Supabase connection means no real performance metrics source. We do
    // NOT fabricate sends/opens/clicks/revenue — an empty metrics set is the
    // honest state (rollups compute to zero and campaigns simply don't clear
    // performance thresholds until real metrics are connected).
    const campaignMetrics = [];
    // User and order monetary fields come from the CSV only. When a column is
    // absent we leave the value at 0 (unknown) rather than inventing a spend or
    // order count from the row index.
    const users = customersRaw.slice(0, 1000).map((u, i) => ({
      id: u.id || u.ID || u.Email || `user_${i}`,
      email: u.Email || u.email || '',
      market: u.Country || u.country || 'US',
      total_spend: num(u['Total Spent'] || u.total_spend, 0),
      orders_count: num(u['Orders Count'] || u.orders_count, 0),
      last_order_at: u['Last Order Date'] || u.last_order_at || '',
      accepts_marketing: u['Accepts Marketing'] !== 'no',
      tags: String(u.Tags || '').split(',').map((x) => x.trim()).filter(Boolean),
    }));
    const orders = ordersRaw.slice(0, 2000).map((o, i) => ({
      id: o.id || o.Name || `order_${i}`,
      user_id: o.Customer_ID || o.Email || `user_${i % Math.max(users.length, 1)}`,
      market: o.Country || o['Shipping Country'] || 'US',
      total: num(o.Total || o['Total Price'] || o.Subtotal, 0),
      created_at: o.Created_At || o['Created at'] || o.created_at || '',
      product_sku: o.SKU || '',
    }));
    return { source: 'local-csv (no performance metrics)', products, assets: [], campaigns, campaignAssets: [], campaignMetrics, users, orders, events: [], mvtResults: [], feedback: [] };
  }
}

class KnowledgeBaseService {
  constructor(config) { this.config = config; }
  build(data) {
    const assetByCampaign = new Map();
    for (const ca of asArray(data.campaignAssets)) {
      const list = assetByCampaign.get(ca.campaign_id) || [];
      const asset = asArray(data.assets).find((a) => String(a.id) === String(ca.asset_id)) || ca;
      list.push(asset);
      assetByCampaign.set(ca.campaign_id, list);
    }
    const metricByCampaign = new Map();
    for (const m of asArray(data.campaignMetrics)) {
      const list = metricByCampaign.get(m.campaign_id) || [];
      list.push(normalizeMetric(m));
      metricByCampaign.set(m.campaign_id, list);
    }
    const indexedCampaigns = asArray(data.campaigns).map((c) => {
      const metrics = metricByCampaign.get(c.id) || [];
      const rollup = rollupMetrics(metrics);
      return {
        ...c,
        assets: assetByCampaign.get(c.id) || [],
        metrics,
        performance: rollup,
        hooks: extractHooks(c, assetByCampaign.get(c.id) || []),
        angles: extractAngles(c),
        formats: [...new Set((assetByCampaign.get(c.id) || []).map((a) => a.format || a.asset_type).filter(Boolean))],
      };
    });
    return {
      source: data.source,
      indexed_at: new Date().toISOString(),
      catalog: asArray(data.products),
      brandAssets: asArray(data.assets).filter((a) => /brand|logo|font|kit/i.test(`${a.asset_type || ''} ${a.tags || ''}`)),
      indexedCampaigns,
      userCount: asArray(data.users).length,
      orderCount: asArray(data.orders).length,
    };
  }
}

function normalizeMetric(m) {
  const sends = num(m.sends || m.recipients || m.delivered || m.impressions, 0);
  const impressions = num(m.impressions || sends, sends);
  const clicks = num(m.clicks, 0);
  const conversions = num(m.conversions || m.orders, 0);
  const spend = num(m.spend, 0);
  const revenue = num(m.revenue || m.attributed_revenue, 0);
  return {
    ...m,
    openRate: round(num(m.open_rate, num(m.opens, 0) / Math.max(sends, 1))),
    clickRate: round(num(m.click_rate || m.ctr, clicks / Math.max(impressions || sends, 1))),
    conversionRate: round(num(m.conversion_rate || m.cvr, conversions / Math.max(clicks || impressions || sends, 1))),
    revenuePerRecipient: round(revenue / Math.max(sends, 1)),
    // ROAS is undefined without spend (e.g. owned email) — report null (N/A),
    // never a sentinel like 999 that would masquerade as a real ratio.
    roas: spend > 0 ? round(revenue / spend, 2) : null,
    revenue,
    spend,
    sends,
    impressions,
    clicks,
    conversions,
  };
}

function rollupMetrics(metrics) {
  const total = metrics.reduce((a, m) => ({
    sends: a.sends + num(m.sends), impressions: a.impressions + num(m.impressions), clicks: a.clicks + num(m.clicks), conversions: a.conversions + num(m.conversions), revenue: a.revenue + num(m.revenue), spend: a.spend + num(m.spend), opens: a.opens + num(m.opens),
  }), { sends: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0, spend: 0, opens: 0 });
  return normalizeMetric(total);
}
function extractHooks(c, assets) {
  return [...new Set([c.subject, c.headline, c.hook, ...assets.map((a) => a.hook || a.alt || a.title)].filter(Boolean).map(String).slice(0, 8))];
}
function extractAngles(c) {
  const text = `${c.name || ''} ${c.subject || ''} ${c.campaign_type || ''}`.toLowerCase();
  return ['gift', 'wellness', 'green tea', 'chai', 'matcha', 'detox', 'subscription', 'sale', 'holiday', 'iced tea'].filter((x) => text.includes(x));
}

class AnalysisService {
  constructor(config) { this.config = config; }
  analyze(kb, data) {
    const cohorts = buildCohorts(data.users, data.orders);
    const winningCampaigns = kb.indexedCampaigns.filter((c) => campaignClearsThreshold(c, this.config.performanceThresholds));
    const productScores = scoreProducts(kb.catalog, data.orders, winningCampaigns);
    const channelBenchmarks = buildChannelBenchmarks(kb.indexedCampaigns);
    const mvtLearnings = summarizeMvt(data.mvtResults);
    return {
      analyzed_at: new Date().toISOString(),
      thresholds: this.config.performanceThresholds,
      cohorts,
      winningCampaigns,
      productScores,
      channelBenchmarks,
      mvtLearnings,
      dailyInsights: buildDailyInsights({ cohorts, winningCampaigns, productScores, channelBenchmarks, mvtLearnings }),
    };
  }
}

function campaignClearsThreshold(c, thresholds) {
  const channel = String(c.channel || 'email').toLowerCase();
  const t = thresholds[channel] || thresholds.email;
  const p = c.performance || {};
  if (channel === 'email') return p.openRate >= t.openRate && p.clickRate >= t.clickRate && (p.conversionRate >= t.conversionRate || p.revenuePerRecipient >= t.revenuePerRecipient);
  return p.clickRate >= (t.ctr || 0) && p.conversionRate >= (t.cvr || 0) && p.roas >= (t.roas || 0);
}
function daysSince(dateish) {
  const t = new Date(dateish || 0).getTime();
  if (!t) return 9999;
  return Math.floor((Date.now() - t) / 86400000);
}
function cohortName(u) {
  const recency = daysSince(u.last_order_at || u.last_seen_at);
  const spend = num(u.total_spend || u.lifetime_value);
  const orders = num(u.orders_count || u.order_count);
  if (orders >= 4 && recency <= 90 && spend >= 180) return 'Champions';
  if (orders >= 3 && recency <= 120) return 'Loyalists';
  if (orders <= 1 && recency <= 45) return 'New Buyers';
  if (recency > 180 && spend >= 100) return 'Winback High-LTV';
  if (recency > 120) return 'At-Risk';
  return 'Nurture';
}
function buildCohorts(users, orders) {
  const byUser = new Map();
  for (const u of asArray(users)) byUser.set(String(u.id || u.email), { ...u });
  for (const o of asArray(orders)) {
    const id = String(o.user_id || o.customer_id || o.email || 'unknown');
    const u = byUser.get(id) || { id, market: o.market, total_spend: 0, orders_count: 0 };
    u.total_spend = num(u.total_spend) + num(o.total);
    u.orders_count = num(u.orders_count) + 1;
    if (!u.last_order_at || new Date(o.created_at) > new Date(u.last_order_at)) u.last_order_at = o.created_at;
    byUser.set(id, u);
  }
  const grouped = new Map();
  for (const u of byUser.values()) {
    const name = cohortName(u);
    const g = grouped.get(name) || { name, count: 0, revenue: 0, markets: {}, rules: [] };
    g.count += 1; g.revenue += num(u.total_spend || u.lifetime_value);
    const market = norm(u.market || u.country || 'Global');
    g.markets[market] = (g.markets[market] || 0) + 1;
    grouped.set(name, g);
  }
  return [...grouped.values()].map((g) => ({ ...g, revenue: round(g.revenue, 2), avgLtv: round(g.revenue / Math.max(g.count, 1), 2), rules: cohortRules(g.name) })).sort((a, b) => b.revenue - a.revenue);
}
function cohortRules(name) {
  const map = {
    Champions: ['orders_count >= 4', 'last_order_at <= 90 days', 'total_spend >= premium threshold'],
    Loyalists: ['orders_count >= 3', 'last_order_at <= 120 days'],
    'New Buyers': ['orders_count <= 1', 'first/last order <= 45 days'],
    'Winback High-LTV': ['last_order_at > 180 days', 'total_spend >= high-LTV threshold'],
    'At-Risk': ['last_order_at > 120 days'],
    Nurture: ['all remaining opted-in profiles'],
  };
  return map[name] || [];
}
function scoreProducts(products, orders, winningCampaigns) {
  const score = new Map();
  for (const p of asArray(products)) score.set(p.sku || p.id, { product: p, orderCount: 0, revenue: 0, winningMentions: 0, score: 0 });
  for (const o of asArray(orders)) {
    const key = o.product_sku || o.sku || o.variant_sku;
    if (!score.has(key)) continue;
    const s = score.get(key); s.orderCount += 1; s.revenue += num(o.total || o.line_total);
  }
  for (const c of asArray(winningCampaigns)) {
    const key = c.hero_sku || c.product_sku;
    if (score.has(key)) score.get(key).winningMentions += 1;
  }
  return [...score.values()].map((s) => ({ ...s, score: round(s.orderCount * 1.5 + s.revenue / 100 + s.winningMentions * 10, 2) })).sort((a, b) => b.score - a.score).slice(0, 50);
}
function buildChannelBenchmarks(campaigns) {
  const groups = {};
  for (const c of asArray(campaigns)) {
    const ch = String(c.channel || 'email').toLowerCase();
    groups[ch] ||= [];
    groups[ch].push(c.performance || {});
  }
  return Object.fromEntries(Object.entries(groups).map(([ch, ms]) => [ch, {
    count: ms.length,
    avgClickRate: round(ms.reduce((a, m) => a + num(m.clickRate), 0) / Math.max(ms.length, 1)),
    avgConversionRate: round(ms.reduce((a, m) => a + num(m.conversionRate), 0) / Math.max(ms.length, 1)),
    // Only campaigns with spend have a ROAS; average over those, null if none.
    avgRoas: (() => {
      const withRoas = ms.filter((m) => Number.isFinite(m.roas));
      return withRoas.length ? round(withRoas.reduce((a, m) => a + Math.min(m.roas, 20), 0) / withRoas.length, 2) : null;
    })(),
  }]));
}
function summarizeMvt(rows) {
  return asArray(rows).map((r) => ({ variable: r.variable || r.test_name, winner: r.winner || r.winning_variant, lift: num(r.lift || r.relative_lift), confidence: num(r.confidence, 0.5) })).filter((r) => r.confidence >= 0.7).slice(0, 25);
}
function buildDailyInsights({ cohorts, winningCampaigns, productScores, mvtLearnings }) {
  return [
    `${winningCampaigns.length} own campaigns clear current performance thresholds and are eligible for creative reuse.`,
    `Top cohort by revenue is ${cohorts[0]?.name || 'N/A'} (${cohorts[0]?.count || 0} profiles).`,
    `Highest-scored hero product is ${productScores[0]?.product?.title || 'N/A'}.`,
    `${mvtLearnings.length} statistically useful MVT learnings are active in generation rules.`,
  ];
}

class CompetitorBenchmarkingService {
  constructor(config) { this.config = config; }
  benchmark(data) {
    const competitors = asArray(data.competitors).map((c) => ({ ...c, channel: String(c.channel || c.campaign_type || 'unknown').toLowerCase() }));
    const byChannel = {};
    const hooks = {};
    for (const c of competitors) {
      byChannel[c.channel] ||= { count: 0, activeBrands: new Set(), formats: {} };
      byChannel[c.channel].count += 1;
      if (c.brand) byChannel[c.channel].activeBrands.add(c.brand);
      const fmt = c.format || c.asset_type || 'unknown';
      byChannel[c.channel].formats[fmt] = (byChannel[c.channel].formats[fmt] || 0) + 1;
      for (const h of [c.hook, c.headline, c.subject].filter(Boolean)) hooks[h] = (hooks[h] || 0) + 1;
    }
    return {
      source: data.source,
      isolated: true,
      observed_at: new Date().toISOString(),
      byChannel: Object.fromEntries(Object.entries(byChannel).map(([k, v]) => [k, { ...v, activeBrands: [...v.activeBrands] }])),
      trendingHooks: Object.entries(hooks).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([hook, count]) => ({ hook, count })),
      note: 'Competitive benchmarks inform prioritization only; they are not used to qualify own campaign-library winners.',
    };
  }
}

class CalendarIntelligenceService {
  constructor(config) { this.config = config; this.festivals = loadFestivals(); }
  generate({ analysis, competitorBenchmarks, startDate = todayIso(), days = this.config.calendarDays, feedback = [] }) {
    const entries = [];
    const cohorts = analysis.cohorts.length ? analysis.cohorts : [{ name: 'Nurture', count: 0 }];
    const products = analysis.productScores.length ? analysis.productScores : [{ product: { title: 'VAHDAM Tea Assortment', sku: 'VAHDAM-BUNDLE' }, score: 1 }];
    const winners = analysis.winningCampaigns;
    const feedbackMap = summarizeFeedback(feedback);
    for (let d = 0; d < days; d++) {
      const date = addDays(startDate, d);
      for (const market of this.config.markets) {
        const festival = festivalOn(this.festivals, market, date);
        const cohort = cohorts[(d + market.length) % cohorts.length];
        const product = products[(d * 2 + market.length) % products.length].product;
        const winningTemplate = winners[(d + entries.length) % Math.max(winners.length, 1)] || null;
        const channels = d % 3 === 0 ? ['email', 'meta', 'google', 'landing_page'] : d % 3 === 1 ? ['email', 'tiktok', 'landing_page'] : ['meta', 'google', 'landing_page'];
        entries.push({
          id: idFor('cal', { date, market, cohort: cohort.name, channels }),
          date,
          market,
          status: 'needs_human_verification',
          confidence: confidenceFor({ winningTemplate, festival, feedbackMap, cohort }),
          cohort: { name: cohort.name, size: cohort.count, rules: cohort.rules || [] },
          channels,
          objective: objectiveFor(cohort.name, festival),
          festival: festival ? { name: festival.name, weight: festival.weight, tags: festival.tags || [] } : null,
          heroProduct: { sku: product.sku || product.id, title: product.title, handle: product.handle, category: product.category },
          ownDataReference: winningTemplate ? { campaign_id: winningTemplate.id, name: winningTemplate.name, hooks: winningTemplate.hooks, performance: winningTemplate.performance } : null,
          competitorContext: competitorContext(competitorBenchmarks, channels),
          mvtPlan: buildMvtPlan(analysis.mvtLearnings, channels),
          rationale: buildCalendarRationale({ cohort, product, festival, winningTemplate }),
        });
      }
    }
    return { generated_at: new Date().toISOString(), start_date: startDate, days, entries, review: { dailyAutomation: true, weeklyHumanRecalibrationRequired: true } };
  }
}
function festivalOn(festivals, market, date) {
  const mmdd = date.slice(5);
  return [...(festivals[market] || []), ...(festivals.Global || [])].find((f) => f.date === mmdd || f.date_iso === date) || null;
}
function objectiveFor(cohort, festival) {
  if (festival) return 'seasonal conversion moment';
  if (/winback|at-risk/i.test(cohort)) return 'reactivation and replenishment';
  if (/champion|loyal/i.test(cohort)) return 'premium bundle expansion';
  if (/new/i.test(cohort)) return 'second-order activation';
  return 'education-led conversion';
}
function confidenceFor({ winningTemplate, festival, feedbackMap, cohort }) {
  let c = 0.52;
  if (winningTemplate) c += 0.18;
  if (festival?.weight >= 7) c += 0.08;
  if ((cohort.count || 0) > 1000) c += 0.08;
  if (feedbackMap.positive > feedbackMap.negative) c += 0.06;
  return round(Math.min(c, 0.96), 2);
}
function competitorContext(bench, channels) {
  return channels.filter((c) => c !== 'landing_page').map((channel) => ({ channel, benchmark: bench.byChannel[channel] || null, trendingHooks: bench.trendingHooks.slice(0, 3) }));
}
function buildMvtPlan(learnings, channels) {
  const variables = ['hook', 'offer_depth', 'hero_visual', 'cta', 'landing_page_length'];
  return variables.slice(0, Math.min(3, channels.length)).map((variable, i) => ({ variable, variants: [`control_${variable}`, `challenger_${variable}_${i + 1}`], apply_prior_learning: learnings.find((l) => l.variable === variable) || null }));
}
function summarizeFeedback(feedback) {
  return asArray(feedback).reduce((a, f) => { /reject|bad|negative/i.test(f.verdict || f.rating) ? a.negative++ : a.positive++; return a; }, { positive: 0, negative: 0 });
}
function buildCalendarRationale({ cohort, product, festival, winningTemplate }) {
  const parts = [`Targets ${cohort.name} using ${product.title || product.sku}.`];
  if (winningTemplate) parts.push(`Reuses patterns from high-performing own campaign "${winningTemplate.name}".`);
  if (festival) parts.push(`Aligned to ${festival.name}.`);
  return parts.join(' ');
}

class GenerationService {
  constructor(config) { this.config = config; }
  generate(entry) {
    const baseName = `${entry.market} ${entry.objective} · ${entry.heroProduct.title}`;
    const campaignId = idFor('campaign', entry);
    const audience = buildAudienceSpec(entry);
    const funnel = buildFunnelSpec(entry);
    const email = entry.channels.includes('email') ? buildEmailAsset(entry, campaignId) : null;
    const landing = entry.channels.includes('landing_page') ? buildLandingPageAsset(entry, campaignId) : null;
    const ads = buildAdAssets(entry, campaignId);
    return {
      schema_version: 'smart-campaign.v1',
      campaign_id: campaignId,
      name: baseName,
      status: entry.confidence >= this.config.confidence.minHumanVerificationConfidence ? 'ready_for_human_final_check' : 'needs_human_verification',
      approval: { required: true, reason: 'Launch-state safety policy requires human verification for every campaign before final.' },
      market: entry.market,
      objective: entry.objective,
      cohort: entry.cohort,
      audience,
      retargeting: buildRetargetingSpec(entry),
      similarAudienceLogic: buildSimilarAudienceSpec(entry),
      funnel,
      assets: { email, landing_pages: landing ? [landing] : [], ads },
      platform_ready: {
        google_ads: ads.filter((a) => a.platform === 'google').map(platformAdObject),
        meta_ads: ads.filter((a) => a.platform === 'meta').map(platformAdObject),
        tiktok_ads: ads.filter((a) => a.platform === 'tiktok').map(platformAdObject),
        lifecycle_messaging: email ? [platformEmailObject(email, audience)] : [],
      },
      no_live_push: true,
      created_at: new Date().toISOString(),
    };
  }
}
function buildAudienceSpec(entry) {
  return { name: `${entry.market}_${slug(entry.cohort.name)}`, market: entry.market, inclusion_rules: entry.cohort.rules || [], exclusions: ['unsubscribed users', 'recent purchasers inside suppression window', 'users with unresolved support escalation'] };
}
function buildRetargetingSpec(entry) {
  return { windows: [{ name: 'site_view_no_purchase_14d', days: 14 }, { name: 'email_click_no_purchase_7d', days: 7 }, { name: 'cart_no_purchase_3d', days: 3 }], message: `Retarget ${entry.heroProduct.title} viewers with proof-led bundle or replenishment angle.` };
}
function buildSimilarAudienceSpec(entry) {
  return { seed: `${entry.cohort.name} purchasers in ${entry.market}`, similarity: '1-3% platform lookalike/equivalent', guardrails: ['exclude active purchasers already in lifecycle flow', 'separate prospecting from retargeting budget'] };
}
function buildFunnelSpec(entry) {
  return { steps: [{ step: 'creative', goal: 'earn click with cohort-specific hook' }, { step: 'landing_page', goal: 'convert with product proof, offer framing, reviews' }, { step: 'mailer_follow_up', goal: 'recover non-purchasers with education and urgency-safe reminder' }] };
}
function safeCopy(text) {
  // Full CLAUDE.md banned-phrase list (kept in sync with api/_shared/scenario-model.js
  // sanitizeBrand) — the prior regex missed game-changer / last chance /
  // while supplies last.
  return String(text || '')
    .replace(/LIMITED TIME/g, 'time-bound')
    .replace(/wellness journey|liquid gold|game[\s-]?changer|hurry|don'?t miss out|last chance|while supplies last/gi, 'premium daily ritual')
    .replace(/\btransform(ing|ed|s|ation)?\b/gi, 'restore');
}
function buildEmailAsset(entry, campaignId) {
  const subject = safeCopy(`${entry.festival ? `${entry.festival.name}: ` : ''}${entry.heroProduct.title} for ${entry.cohort.name}`);
  const preheader = safeCopy(`A premium VAHDAM India edit built for ${entry.market} ${entry.cohort.name}.`);
  const HEAD = "'Lao MN','Cormorant Garamond',Georgia,serif";
  const BODY = "'Proxima Nova','Helvetica Neue',Arial,sans-serif";
  const meta = `<!--\nSUBJECT_PRIMARY: ${subject}\nPREHEADER: ${preheader}\n-->\n`;
  const html = `${meta}<!doctype html><html><head><meta charset="utf-8"><title>${subject}</title></head><body style="margin:0;background:#FBF5EA;color:#171717;font-family:${BODY}"><main style="max-width:680px;margin:auto;background:#fff"><section style="background:#004A2B;color:#FBF5EA;padding:36px"><p style="color:#AB8743;letter-spacing:.16em;text-transform:uppercase;font-family:${BODY}">VAHDAM India</p><h1 style="font-family:${HEAD};font-weight:500">${subject}</h1><p style="font-family:${BODY}">${preheader}</p></section><section style="padding:32px"><h2 style="font-family:${HEAD};color:#004A2B;font-weight:500">${entry.heroProduct.title}</h2><p style="font-family:${BODY}">Crafted around ${entry.objective}, this send connects the creative, landing page, and follow-up logic into one cohort-specific funnel.</p><a href="{{landing_page_url}}" style="background:#004A2B;color:#FBF5EA;padding:14px 20px;text-decoration:none;border-radius:2px;display:inline-block;font-family:${BODY};letter-spacing:1.4px;text-transform:uppercase">Shop the edit</a></section></main></body></html>`;
  return { id: `${campaignId}_email`, type: 'html_email', platform_targets: ['klaviyo', 'webengage'], subject, preheader, html, text: `${subject}\n${preheader}\nShop the edit: {{landing_page_url}}` };
}
function buildLandingPageAsset(entry, campaignId) {
  const title = safeCopy(`${entry.heroProduct.title} · ${entry.market} ${entry.cohort.name} Edit`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:Arial,sans-serif;color:#171717;background:#FBF5EA"><section style="padding:56px 24px;background:#004A2B;color:#FBF5EA;text-align:center"><p style="color:#AB8743;letter-spacing:.18em;text-transform:uppercase">VAHDAM India</p><h1>${title}</h1><p>${safeCopy(entry.rationale)}</p></section><section style="max-width:920px;margin:auto;padding:40px 24px"><h2>Why this edit</h2><ul><li>Premium tea and wellness assortment selected for ${entry.cohort.name}.</li><li>Proof-led product storytelling and reviews section placeholder.</li><li>Retargeting and mailer follow-up are aligned to this same page promise.</li></ul><button style="background:#AB8743;border:0;padding:16px 24px;font-weight:bold">Add to cart</button></section></body></html>`;
  return { id: `${campaignId}_landing`, type: 'landing_page', path: `/lp/${campaignId}`, html, sections: ['hero', 'proof', 'product_grid', 'reviews', 'faq', 'sticky_cta'] };
}
function buildAdAssets(entry, campaignId) {
  const copy = safeCopy(`${entry.heroProduct.title} selected for ${entry.cohort.name}. Discover the VAHDAM India edit.`);
  const out = [];
  if (entry.channels.includes('meta')) out.push({ id: `${campaignId}_meta_1`, platform: 'meta', format: 'feed_story_reels', primary_text: copy, headline: safeCopy(entry.heroProduct.title), description: entry.objective, creative_brief: 'Premium product close-up, forest green backdrop, gold accent, clear packshot.' });
  if (entry.channels.includes('google')) out.push({ id: `${campaignId}_google_1`, platform: 'google', format: 'responsive_search_display', headlines: [safeCopy(entry.heroProduct.title), 'Premium Indian Teas', `${entry.market} VAHDAM Edit`], descriptions: [copy, 'Shop teas, botanicals, and giftable assortments.'] });
  if (entry.channels.includes('tiktok')) out.push({ id: `${campaignId}_tiktok_1`, platform: 'tiktok', format: 'short_video', script: `0-2s: show pack and brew. 3-7s: explain ${entry.objective}. 8-12s: product proof. 13-15s: CTA to landing page.`, caption: copy });
  return out;
}
function platformAdObject(a) { return { external_platform: a.platform, creative_id: a.id, format: a.format, copy: a, destination_url: '{{landing_page_url}}', push_status: 'not_integrated_phase_2' }; }
function platformEmailObject(email, audience) { return { external_platforms: email.platform_targets, message_id: email.id, audience, subject: email.subject, html: email.html, push_status: 'not_integrated_phase_2' }; }

class ReviewService {
  constructor(config) { this.config = config; }
  review(calendar, campaigns) {
    const needsHuman = campaigns.filter((c) => c.approval.required || c.status !== 'final');
    return {
      daily_review_completed_at: new Date().toISOString(),
      calendar_entries_reviewed: calendar.entries.length,
      generated_campaigns: campaigns.length,
      human_verification_required: needsHuman.length,
      weekly_recalibration: { required: true, minimum_frequency_days: this.config.confidence.weeklyRecalibrationDays, checklist: ['approve/reject calendar direction', 'validate cohorts and suppression rules', 'review performance thresholds', 'approve competitive benchmark use', 'sign off on generated assets'] },
      policy: 'Daily automated review updates plans without human involvement; every campaign still needs human verification before final, and full-system recalibration is mandatory weekly.',
    };
  }
}

async function runDailySmartBrain({ config: cfg = {}, startDate = todayIso(), days, persist = false } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const ownData = await db.ownData();
  const competitorData = await db.competitorData();
  const kb = new KnowledgeBaseService(config).build(ownData);
  const analysis = new AnalysisService(config).analyze(kb, ownData);
  const competitorBenchmarks = new CompetitorBenchmarkingService(config).benchmark(competitorData);
  const calendar = new CalendarIntelligenceService(config).generate({ analysis, competitorBenchmarks, startDate, days: days || config.calendarDays, feedback: ownData.feedback });
  const generator = new GenerationService(config);
  const campaigns = calendar.entries.map((entry) => generator.generate(entry));
  const review = new ReviewService(config).review(calendar, campaigns);
  const result = { ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', kb, analysis, competitorBenchmarks, calendar, campaigns, review };
  if (persist) {
    result.persistence = await db.insert(config.tableNames.runs, [{ id: idFor('run', { startDate, days, at: Date.now() }), payload: result, created_at: new Date().toISOString() }]);
  }
  return result;
}

function schemaAssumptions(config = smartConfig()) {
  return {
    tables: config.tableNames,
    required_contracts: {
      products: ['id', 'sku', 'title', 'handle', 'category', 'market', 'price', 'tags jsonb'],
      assets: ['id', 'asset_type', 'format', 'url', 'title', 'tags jsonb', 'metadata jsonb'],
      campaigns: ['id', 'name', 'channel', 'market', 'campaign_type', 'subject/headline', 'sent_at', 'cohort_key'],
      campaign_assets: ['campaign_id', 'asset_id', 'role'],
      campaign_metrics: ['campaign_id', 'creative_id', 'channel', 'market', 'sends/impressions', 'opens', 'clicks', 'conversions', 'revenue', 'spend', 'observed_at'],
      users: ['id', 'email/phone hash allowed', 'market', 'total_spend', 'orders_count', 'last_order_at', 'accepts_marketing', 'tags jsonb'],
      orders: ['id', 'user_id', 'market', 'total', 'created_at', 'product_sku'],
      competitor_campaigns: ['id', 'brand', 'channel', 'campaign_type', 'asset_type', 'hook/headline/subject', 'asset_url', 'observed_at'],
      generated_campaigns: ['id', 'payload jsonb', 'status', 'human_verified_at', 'created_at'],
      feedback: ['id', 'target_type', 'target_id', 'verdict', 'notes', 'created_at'],
    },
  };
}

module.exports = { smartConfig, SmartBrainDbAdapter, KnowledgeBaseService, AnalysisService, CompetitorBenchmarkingService, CalendarIntelligenceService, GenerationService, ReviewService, runDailySmartBrain, schemaAssumptions };
