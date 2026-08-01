const { test, expect } = require('@playwright/test');
const path = require('path');

// Locks the live-data contract across all six platforms: Shopify, Meta, Google
// Ads, TikTok, Klaviyo and WebEngage. The rules that matter here are the ones
// that erode quietly — an unconnected platform inventing a figure, a health
// page going blind to a platform, or a competitor benchmark presenting our own
// account numbers as theirs.

const shared = (f) => require(path.join(__dirname, '..', 'api', '_shared', f));
const shopify = shared('shopify-core.js');
const health = shared('connectors-health.js');
const bench = shared('competitive-benchmark-core.js');
const adInsights = shared('ad-insights-core.js');

// ── Shopify: read-only, never fabricates ────────────────────────────────────
test('Shopify ops return an honest not_connected envelope without credentials', async () => {
  // The suite runs with no Shopify credentials, which is exactly the state that
  // must not produce a number.
  for (const op of ['shop', 'orders', 'products', 'customers', 'summary']) {
    const r = await shopify.dispatch(op, { market: 'US' });
    expect(r.connected, `${op} must report not connected`).toBe(false);
    expect(r.not_connected).toBe(true);
    expect(r.would_request.method, `${op} must only ever describe a GET`).toBe('GET');
    expect(r.blocker, `${op} must name the fix`).toBeTruthy();
    // No fabricated figures anywhere in the payload.
    expect(r.orders).toBeUndefined();
    expect(r.revenue).toBeUndefined();
  }
});

test('Shopify core exposes no mutating operation', () => {
  const ops = Object.keys(shopify.OPS);
  const mutators = ops.filter((o) => /create|update|delete|write|set|post|put|patch/i.test(o));
  expect(mutators, `read-only core must expose no mutators, found: ${mutators}`).toEqual([]);
});

test('Shopify never leaks the admin token in a not_connected envelope', async () => {
  const r = await shopify.dispatch('orders', { market: 'US' });
  expect(JSON.stringify(r)).not.toMatch(/X-Shopify-Access-Token"\s*:\s*"(?!REDACTED)/);
});

// ── Connector health: every platform visible ────────────────────────────────
test('health probes all seven platforms, including the three ad platforms', async () => {
  const r = await health.health({ market: 'US' });
  const ids = r.platforms.map((p) => p.id).sort();
  expect(ids).toEqual(['google', 'klaviyo', 'meta', 'shopify', 'supabase', 'tiktok', 'webengage']);
  expect(r.summary.total).toBe(7);
  expect(r.groups.paid_media.total).toBe(3);
});

test('every blocked platform states an actionable blocker, never a bare failure', async () => {
  const r = await health.health({ market: 'US' });
  for (const p of r.platforms.filter((x) => !x.live)) {
    const msg = p.blocker || p.error;
    expect(msg, `${p.id} must explain why it is not live`).toBeTruthy();
    expect(String(msg).length, `${p.id} blocker must be more than a status code`).toBeGreaterThan(12);
  }
});

// ── Competitive benchmarking: the own/competitor boundary ───────────────────
test('competitor-side metrics that cannot be observed are never given a value', async () => {
  const own = { catalog: { readable: false }, paid_media: { connected: false, active_creatives: null }, commerce: { connected: false } };
  const comp = { storefront: { readable: false }, meta_ads: { active_creatives: 3 } };
  const { own_only } = bench.compare(own, comp);
  expect(own_only.length).toBeGreaterThan(0);
  for (const row of own_only) {
    expect(row.competitor, `${row.metric} must have no competitor value`).toBeNull();
    expect(row.reason, `${row.metric} must say why`).toBeTruthy();
  }
});

test('comparable rows only appear when both sides were actually read', async () => {
  // Competitor storefront unreadable -> no catalog/price comparison may be emitted.
  const own = { catalog: { readable: true, products: 100, price_min: 5, price_median: 20, price_max: 90 }, paid_media: { active_creatives: null }, commerce: {} };
  const comp = { storefront: { readable: false }, meta_ads: { active_creatives: null } };
  const { comparable } = bench.compare(own, comp);
  expect(comparable.some((c) => c.metric === 'catalog_size')).toBe(false);
});

test('a ratio is omitted rather than divided by zero', () => {
  const own = { catalog: { readable: true, products: 10, price_min: 1, price_median: 2, price_max: 3 }, paid_media: {}, commerce: {} };
  const comp = { storefront: { readable: true, products: 0, price_min: 0, price_median: 0, price_max: 0 }, meta_ads: {} };
  const { comparable } = bench.compare(own, comp);
  for (const row of comparable) expect(Number.isFinite(row.ratio) || row.ratio === null).toBe(true);
});

test('public storefront read returns real structure or an honest failure', async () => {
  // Not a Shopify storefront — must report unreadable rather than guess.
  const r = await bench.storefront('example.com');
  expect(r.readable).toBe(false);
  expect(r.error || r.note).toBeTruthy();
  expect(r.products).toBeUndefined();
});

// ── Ads dashboard freshness: a stale date must never present itself as today ──
test('an account whose fresh_to is in the past is not reported as the current partial day', () => {
  const snow = shared('ads-snowflake-core.js');
  const accounts = snow.pickSources('dtc,retail').map(snow.describeAccount);
  expect(accounts.length).toBeGreaterThan(0);
  for (const a of accounts) {
    if (!a.fresh_to) continue;
    if (a.fresh_to !== a.today) {
      // This is the exact bug: the registry hardcodes partial_day:true, and the
      // dashboard rendered "includes the current partial day" against a date a
      // week old. The live claim must be derived, not trusted.
      expect(a.partial_day, `${a.id} fresh_to=${a.fresh_to} today=${a.today} must not claim to be today`).toBe(false);
      expect(a.stale_days, `${a.id} must report how far behind it is`).toBeGreaterThan(0);
      expect(a.freshness_note, `${a.id} must explain the staleness`).toContain(a.today);
    } else {
      expect(a.stale_days).toBe(0);
      expect(a.freshness).toBe('current');
    }
  }
});

test('the original verification observation is preserved, not silently dropped', () => {
  const snow = shared('ads-snowflake-core.js');
  const a = snow.pickSources('dtc').map(snow.describeAccount)[0];
  expect(a.verified_partial_day).toBe(true); // what the registry recorded
  expect(a).toHaveProperty('today');
  expect(a).toHaveProperty('stale_days');
});

// ── Ad platforms ────────────────────────────────────────────────────────────
test('unconnected ad platforms return would_request and need_env, no figures', async () => {
  for (const platform of ['meta', 'google', 'tiktok']) {
    const r = await adInsights.insights({ platform, market: 'US', level: 'account' });
    expect(r.connected, `${platform}`).toBe(false);
    expect(r.not_connected).toBe(true);
    expect(Array.isArray(r.need_env) && r.need_env.length, `${platform} must list required env`).toBeTruthy();
    expect(r.data).toBeUndefined();
  }
});
