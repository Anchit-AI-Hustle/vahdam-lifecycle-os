'use strict';

/**
 * competitive-benchmark-core.js — competitive benchmarking sourced from the SAME
 * platform stack the rest of the app runs on (Shopify, Meta, Google, TikTok,
 * Klaviyo, WebEngage), on top of the existing Gmail-to-Sheet email intel.
 *
 * ── The boundary this module exists to enforce ──────────────────────────────
 * Our Meta / Google Ads / TikTok credentials report on OUR OWN ad accounts.
 * They cannot return a competitor's spend, CTR, CPM, ROAS or conversion count —
 * that data is private to the competitor's account and no API exposes it.
 * The same is true of Klaviyo and WebEngage: they hold OUR list performance,
 * not anyone else's open rate.
 *
 * So this module keeps two clearly separated sides and never blurs them:
 *
 *   own        — real figures from our connected platforms, labelled as ours.
 *   competitor — only what is genuinely observable from PUBLIC sources:
 *                  · their public Shopify storefront (/products.json): catalog
 *                    size, price band, product types — real, no auth needed
 *                  · Meta Ad Library: their currently-active creatives
 *                  · Google Ads Transparency Center / TikTok Creative Center:
 *                    deep links (neither exposes a public reporting API)
 *
 * Every metric is then sorted into one of two buckets:
 *   comparable — observable on BOTH sides by the SAME method, so a comparison
 *                is meaningful (catalog size and price band are read from
 *                /products.json for us and for them, identically).
 *   own_only   — we have it, no competitor value can exist. Reported with
 *                competitor: null and a reason, never with a guessed number.
 *
 * A benchmark that quietly presented our own CPM as "category CPM" would be
 * fabrication in the most damaging place — a number that looks sourced. The
 * split is the point of the module.
 */

const competitor = require('./competitor-core.js');
const adsLive = require('./ads-live-core.js');
const adInsights = require('./ad-insights-core.js');
const shopify = require('./shopify-core.js');
const klaviyo = require('./klaviyo-core.js');
const webengage = require('./webengage-core.js');

// Our own public storefronts, per CLAUDE.md's verified market URL map. The own
// side of a catalog comparison is read the same way as the competitor side so
// the two are methodologically identical.
const OWN_STOREFRONT = {
  US: 'www.vahdam.com',
  UK: 'www.vahdam.co.uk',
  IN: 'www.vahdamindia.com',
  EU: 'www.vahdam.global',
  AU: 'www.vahdam.global',
};

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
const round = (v, n = 2) => Math.round(num(v) * 10 ** n) / 10 ** n;
function normMarket(m) { return adInsights.normMarket(m); }
function hostOf(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  try { return new URL(s.startsWith('http') ? s : `https://${s}`).host.toLowerCase(); } catch (_) { return ''; }
}
function median(xs) {
  const a = xs.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : round((a[m - 1] + a[m]) / 2);
}

/**
 * Read a public Shopify storefront's catalog. Works for any Shopify store
 * without credentials; returns a structured "not readable" result for anything
 * that is not a Shopify storefront rather than guessing at the catalog.
 */
async function storefront(domain, { limit = 250, timeoutMs = 15000 } = {}) {
  const host = hostOf(domain);
  const out = { host, readable: false, source: 'public_storefront_products_json' };
  if (!host) return Object.assign(out, { error: 'no domain' });
  const url = `https://${host}/products.json?limit=${Math.min(parseInt(limit, 10) || 250, 250)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return Object.assign(out, { url, error: `HTTP ${res.status}`, note: 'Not a readable Shopify storefront (or products.json is disabled).' });
    const ct = String(res.headers.get('content-type') || '');
    if (!ct.includes('json')) return Object.assign(out, { url, error: 'non-json response', note: 'Storefront did not return JSON — likely not Shopify.' });
    const json = await res.json();
    const products = Array.isArray(json && json.products) ? json.products : [];
    const prices = products.flatMap((p) => (p.variants || []).map((v) => Number(v.price))).filter((n) => Number.isFinite(n) && n > 0);
    const types = [...new Set(products.map((p) => String(p.product_type || '').trim()).filter(Boolean))];
    return {
      ...out, readable: true, url,
      products: products.length,
      // products.json pages at 250; a full page means the catalog is at least
      // this big, not exactly this big. Say so rather than implying a total.
      products_truncated: products.length >= 250,
      price_min: prices.length ? round(Math.min(...prices)) : null,
      price_median: median(prices),
      price_max: prices.length ? round(Math.max(...prices)) : null,
      product_types: types.slice(0, 12),
      sample_titles: products.slice(0, 5).map((p) => p.title),
    };
  } catch (e) {
    return Object.assign(out, { url, error: String((e && e.message) || e).slice(0, 160) });
  } finally { clearTimeout(timer); }
}

// ── Own side: real figures from our connected platforms ─────────────────────
async function ownBaseline({ market = 'US', days = 30 } = {}) {
  const mk = normMarket(market);
  const [paid, live, commerce, store] = await Promise.all([
    adsLive.daily({}).catch((e) => ({ ok: false, error: e.message })),
    adsLive.today({}).catch((e) => ({ ok: false, error: e.message })),
    shopify.summary({ market: mk, days }).catch((e) => ({ ok: false, error: e.message })),
    storefront(OWN_STOREFRONT[mk] || OWN_STOREFRONT.US),
  ]);

  // Roll the per-day Meta series into window totals. Only the direct API path
  // carries conversions/revenue, so ROAS stays null on the warehouse fallback
  // instead of reading as zero return.
  const rows = (paid && paid.rows) || [];
  const t = rows.reduce((s, r) => ({
    spend: round(s.spend + num(r.spend)), impressions: s.impressions + num(r.impressions),
    link_clicks: s.link_clicks + num(r.link_clicks), conversions: s.conversions + num(r.conversions),
    revenue: round(s.revenue + num(r.revenue)),
  }), { spend: 0, impressions: 0, link_clicks: 0, conversions: 0, revenue: 0 });
  const complete = !!(paid && paid.complete_metrics);

  return {
    side: 'own', market: mk, window_days: days,
    paid_media: {
      connected: !!(paid && paid.connected), source: (paid && paid.source) || null,
      metrics_complete: complete,
      spend: rows.length ? t.spend : null,
      impressions: rows.length ? t.impressions : null,
      link_clicks: rows.length ? t.link_clicks : null,
      ctr_pct: t.impressions ? round(t.link_clicks / t.impressions * 100, 2) : null,
      cpm: t.impressions ? round(t.spend / t.impressions * 1000, 2) : null,
      cpc: t.link_clicks ? round(t.spend / t.link_clicks, 3) : null,
      conversions: complete ? t.conversions : null,
      revenue: complete ? t.revenue : null,
      roas: complete && t.spend ? round(t.revenue / t.spend, 2) : null,
      // Ads delivering in our own account today — the own-side counterpart to a
      // competitor's Ad Library listing count.
      active_creatives: (live && live.ok && live.live_count != null) ? live.live_count : null,
      platforms: adInsights.status(mk).platforms,
      blocker: (paid && paid.not_connected) ? (paid.hint || 'No live paid-media source configured.') : null,
    },
    commerce: commerce && commerce.ok
      ? { connected: true, orders: commerce.orders, revenue: commerce.revenue, aov: commerce.aov, returning_rate_pct: commerce.returning_rate_pct, currency: commerce.currency }
      : { connected: false, blocker: (commerce && (commerce.blocker || commerce.error)) || 'Shopify not connected.' },
    catalog: store,
    lifecycle: {
      klaviyo: { connected: klaviyo.isConnected(), blocker: klaviyo.isConnected() ? null : 'Set KLAVIYO_API_KEY (+ LIVE_CONNECTORS=on) to read our own send performance.' },
      webengage: { connected: !!webengage.env().key, blocker: webengage.env().key ? null : 'Set SUPABASE_SERVICE_ROLE_KEY and run the WebEngage sync.' },
    },
  };
}

// ── Competitor side: PUBLIC sources only ────────────────────────────────────
function transparencyLinks(brand, country) {
  const q = encodeURIComponent(String(brand || '').trim());
  const cc = String(country || 'US').toUpperCase();
  return {
    // Neither Google nor TikTok exposes a public competitor-reporting API, so a
    // deep link into the official public library is the honest maximum here.
    google_ads: { source: 'deep_link', why_no_api: 'Google Ads Transparency Center has no public reporting API — advertiser data is browsable, not queryable.', url: `https://adstransparency.google.com/?region=${cc}&domain=${q}` },
    tiktok_ads: { source: 'deep_link', why_no_api: 'TikTok Creative Center Top Ads has no public per-advertiser reporting API.', url: `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=${cc}&keyword=${q}` },
  };
}

async function competitorSignals({ brand, domain, country = 'US', limit = 20 } = {}) {
  const name = String(brand || '').trim();
  if (!name && !domain) return { ok: false, error: 'missing brand or domain' };
  const [ads, store] = await Promise.all([
    competitor.fetchMetaAds({ brand: name, country, limit }).catch((e) => ({ ok: false, error: e.message, ads: [] })),
    domain ? storefront(domain) : Promise.resolve({ readable: false, note: 'No domain on the brand record — cannot read a storefront.' }),
  ]);
  return {
    side: 'competitor', brand: name, domain: hostOf(domain) || null, country,
    storefront: store,
    meta_ads: { source: (ads && ads.source) || null, active_creatives: (ads && ads.ads && ads.ads.length) || 0, deep_link: ads && ads.deepLink, ads: (ads && ads.ads) || [], note: ads && ads.note },
    ...transparencyLinks(name, country),
    not_observable: {
      fields: ['spend', 'ctr', 'cpm', 'cpc', 'roas', 'conversions', 'revenue', 'email_open_rate', 'email_click_rate', 'aov', 'list_size'],
      reason: 'These live inside the competitor\'s own ad and ESP accounts. No public API exposes them, and our platform credentials only report on our own accounts. They are reported as null, never estimated.',
    },
  };
}

// ── The comparison ──────────────────────────────────────────────────────────
function compare(own, comp) {
  const os = own.catalog || {};
  const cs = comp.storefront || {};
  const both = (a, b) => a != null && b != null;
  const row = (metric, unit, o, c, note) => ({
    metric, unit, own: o, competitor: c,
    delta: both(o, c) ? round(o - c) : null,
    // A ratio is only meaningful when the competitor side is a real non-zero
    // reading, so it is omitted rather than shown as Infinity.
    ratio: both(o, c) && c ? round(o / c, 2) : null,
    note: note || null,
  });

  const comparable = [];
  if (os.readable && cs.readable) {
    comparable.push(
      row('catalog_size', 'products', os.products, cs.products,
        (os.products_truncated || cs.products_truncated) ? 'One or both catalogs hit the 250-product page cap — these are floors, not totals.' : null),
      row('price_min', 'currency', os.price_min, cs.price_min, 'Storefront currency is each store\'s own — do not compare across markets.'),
      row('price_median', 'currency', os.price_median, cs.price_median, 'Storefront currency is each store\'s own — do not compare across markets.'),
      row('price_max', 'currency', os.price_max, cs.price_max, 'Storefront currency is each store\'s own — do not compare across markets.'),
    );
  }
  // Active-creative count is observable on both sides, but by DIFFERENT methods
  // (our ad account vs their Ad Library listing), so it is flagged as indicative.
  const ourAds = (own.paid_media && own.paid_media.active_creatives != null) ? own.paid_media.active_creatives : null;
  comparable.push(Object.assign(
    row('active_meta_creatives', 'ads', ourAds, comp.meta_ads ? comp.meta_ads.active_creatives : null),
    { note: 'Indicative only: our side counts ads in our own account, theirs counts public Ad Library listings. The two are collected differently and are not strictly like-for-like.' },
  ));

  const ownOnly = [
    'spend', 'ctr_pct', 'cpm', 'cpc', 'conversions', 'revenue', 'roas', 'aov', 'returning_rate_pct', 'email_open_rate', 'email_click_rate',
  ].map((m) => ({
    metric: m,
    own: (own.paid_media && own.paid_media[m] != null) ? own.paid_media[m]
      : (own.commerce && own.commerce[m] != null ? own.commerce[m] : null),
    competitor: null,
    reason: 'Private to the competitor\'s ad/ESP account. No public source exposes it; never estimated here.',
  }));

  return { comparable: comparable.filter((r) => r.own != null || r.competitor != null), own_only: ownOnly };
}

async function benchmark({ brand, domain, market = 'US', country, days = 30, limit = 20 } = {}) {
  const mk = normMarket(market);
  const cc = String(country || (mk === 'UK' ? 'GB' : mk)).toUpperCase();
  const [own, comp] = await Promise.all([
    ownBaseline({ market: mk, days }),
    competitorSignals({ brand, domain, country: cc, limit }),
  ]);
  if (comp && comp.ok === false) return comp;
  const cmp = compare(own, comp);
  return {
    ok: true, generated_at: new Date().toISOString(), market: mk, country: cc, window_days: days,
    own, competitor: comp, ...cmp,
    method: {
      own_sources: ['meta marketing api / snowflake mirror (paid)', 'shopify admin api (commerce)', 'public storefront products.json (catalog)', 'klaviyo + webengage (lifecycle)'],
      competitor_sources: ['public shopify storefront products.json', 'meta ad library', 'google ads transparency center (link)', 'tiktok creative center (link)'],
      rule: 'Our ad and ESP credentials report on OUR accounts only. No competitor performance figure is derived from them, and none is estimated. Metrics with no possible competitor value are listed under own_only with competitor: null.',
    },
  };
}

/** Benchmark against every stored brand in a category, ranked by catalog size. */
async function benchmarkSet({ market = 'US', category, days = 30, max = 6 } = {}) {
  const mk = normMarket(market);
  let brands = [];
  try { brands = await competitor.getBrands(); }
  catch (e) { return { ok: false, error: `Could not read the brand list: ${e.message}`, hint: 'Competitor brands live in the Google Sheet — check the Sheets credentials (see docs/workload-identity-federation.md).' }; }
  const pick = brands
    .filter((b) => !category || String(b.category || '').toLowerCase() === String(category).toLowerCase())
    .slice(0, Math.min(parseInt(max, 10) || 6, 12));
  if (!pick.length) return { ok: true, market: mk, category: category || null, brands: [], note: 'No stored brands matched — seed the brand list first (/api/competitor?action=seed).' };
  const own = await ownBaseline({ market: mk, days });
  const rows = await Promise.all(pick.map(async (b) => {
    const store = await storefront(b.domain || b.websiteUrl);
    return { brand: b.brandName, domain: hostOf(b.domain || b.websiteUrl), category: b.category || null, positioning: b.positioning || null, storefront: store };
  }));
  return {
    ok: true, generated_at: new Date().toISOString(), market: mk, category: category || null,
    own_catalog: own.catalog, brands: rows.sort((a, c) => num(c.storefront.products) - num(a.storefront.products)),
    note: 'Catalog and price band only — these are the fields readable from a public storefront. Competitor spend, CTR and ROAS are not obtainable and are not shown.',
  };
}

module.exports = { benchmark, benchmarkSet, ownBaseline, competitorSignals, storefront, compare, OWN_STOREFRONT };
