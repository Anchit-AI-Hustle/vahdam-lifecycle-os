const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// Link-by-link journey analysis across Meta, Google, TikTok, Klaviyo, WebEngage
// and Shopify.
//
// The join key is the LINK, because it is the only thing that exists on every
// platform: there is no shared identity graph in this stack. Every rule below
// protects that join, and the first one exists because it broke in exactly the
// way that would have shipped looking correct.

const ROOT = path.join(__dirname, '..');
const CORE = path.join(ROOT, 'api', '_shared', 'journey-core.js');

// Count Vercel Serverless Function files WITHOUT a shell. Shelling out to `find`
// with a path built from __dirname is a command built from an uncontrolled
// absolute path — CodeQL flags it, correctly, and this repo has hit that finding
// before. A directory walk interpolates no path into any command string, so the
// class of issue is removed rather than escaped around.
function functionFileCount(dir = path.join(ROOT, 'api'), depth = 0) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_shared') continue;   // _shared is excluded by Vercel
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (depth < 6) n += functionFileCount(full, depth + 1); }
    else if (entry.name.endsWith('.js')) n += 1;
  }
  return n;
}
const journey = require(CORE);
const PAGE = fs.readFileSync(path.join(ROOT, 'ad-campaigns-master.html'), 'utf8');
const BRAIN = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');

test.describe('the join key', () => {
  test('a relative landing_site and an absolute ad URL are the SAME touchpoint', () => {
    // THE BUG THIS PINS. Shopify writes landing_site as a relative path; an ad's
    // destination URL is absolute. With the host in the key those two never
    // joined, so every paid link rendered TWICE — once with spend and no orders
    // (flagged a leak) and once with orders and no spend. The table looked
    // populated and was wrong in the most damaging direction available: it
    // invented a leak for every campaign that was actually converting.
    const rel = journey.normaliseLink('/collections/gifts?utm_source=facebook&utm_medium=cpc&utm_campaign=gifting');
    const abs = journey.normaliseLink('https://www.vahdam.com/collections/gifts?utm_source=facebook&utm_medium=cpc&utm_campaign=gifting');
    expect(rel.key).toBe(abs.key);
    // The host is still kept for display; it just cannot split the key.
    expect(abs.host).toBe('vahdam.com');
    expect(rel.host, 'the parser placeholder must never surface as a host').toBeNull();
  });

  test('non-UTM query params do not shatter one campaign into many links', () => {
    const a = journey.normaliseLink('/p/chai?utm_source=klaviyo&utm_medium=email&utm_campaign=aug');
    const b = journey.normaliseLink('/p/chai?utm_source=klaviyo&utm_medium=email&utm_campaign=aug&sid=abc&_ke=xyz');
    expect(a.key).toBe(b.key);
  });

  test('a trailing slash is not a different page, and case does not matter', () => {
    expect(journey.normaliseLink('/p/chai/?utm_source=Klaviyo&utm_medium=EMAIL').key)
      .toBe(journey.normaliseLink('/p/chai?utm_source=klaviyo&utm_medium=email').key);
  });
});

test.describe('channel is read from the link, not guessed', () => {
  test('SMS is not filed as email even though Klaviyo sends both', () => {
    // utm_source=klaviyo covers email AND SMS. Reading source alone would file
    // every SMS click under email and inflate the email channel.
    expect(journey.channelOf(journey.normaliseLink('/x?utm_source=klaviyo&utm_medium=sms'))).toBe('sms');
    expect(journey.channelOf(journey.normaliseLink('/x?utm_source=klaviyo&utm_medium=email'))).toBe('email');
  });

  test('paid social and paid search are separated by source', () => {
    expect(journey.channelOf(journey.normaliseLink('/x?utm_source=facebook&utm_medium=cpc'))).toBe('meta');
    expect(journey.channelOf(journey.normaliseLink('/x?utm_source=google&utm_medium=cpc'))).toBe('google');
    expect(journey.channelOf(journey.normaliseLink('/x?utm_source=tiktok&utm_medium=cpc'))).toBe('tiktok');
  });

  test('an untagged link is called untagged, never assigned to a channel', () => {
    expect(journey.channelOf(journey.normaliseLink('/products/chai'))).toBe('untagged');
  });
});

test.describe('the ledger', () => {
  // Stub the four sources so the JOIN is exercised rather than the network.
  function stub({ adPlatforms, orders }) {
    const shopify = require(path.join(ROOT, 'api', '_shared', 'shopify-core.js'));
    const ai = require(path.join(ROOT, 'api', '_shared', 'ad-insights-core.js'));
    const kl = require(path.join(ROOT, 'api', '_shared', 'klaviyo-core.js'));
    const we = require(path.join(ROOT, 'api', '_shared', 'webengage-core.js'));
    const saved = { rp: shopify.readPagedOrders, sm: ai.summary, hk: kl.hasKey, cp: we.campaignPerformance };
    shopify.readPagedOrders = async () => ({ ok: true, pages: 1, basis: 'live', orders });
    ai.summary = async () => ({ platforms: adPlatforms });
    kl.hasKey = () => false;
    we.campaignPerformance = async () => ({ ok: true, campaigns: [] });
    return () => { shopify.readPagedOrders = saved.rp; ai.summary = saved.sm; kl.hasKey = saved.hk; we.campaignPerformance = saved.cp; };
  }

  const ORDERS = [
    { total_price: '89.00', landing_site: '/products/chai?utm_source=klaviyo&utm_medium=email&utm_campaign=aug' },
    { total_price: '145.50', landing_site: '/products/chai?utm_source=klaviyo&utm_medium=email&utm_campaign=aug&sid=z' },
    { total_price: '62.00', landing_site: '/collections/gifts?utm_source=facebook&utm_medium=cpc&utm_campaign=gifting' },
    { total_price: '999.00', landing_site: '/products/chai?utm_source=klaviyo&utm_medium=email&utm_campaign=aug', cancelled_at: 'x' },
  ];
  const ADS = [{
    platform: 'meta', connected: true, rows: [
      { campaign_name: 'Gifting', destination_url: 'https://www.vahdam.com/collections/gifts?utm_source=facebook&utm_medium=cpc&utm_campaign=gifting', spend: 300, clicks: 900, impressions: 50000 },
      { campaign_name: 'Dead', destination_url: 'https://www.vahdam.com/collections/tea?utm_source=facebook&utm_medium=cpc&utm_campaign=dead', spend: 450, clicks: 200, impressions: 80000 },
      { campaign_name: 'No destination', spend: 120, clicks: 100, impressions: 9000 },
    ],
  }, { platform: 'google', connected: false, not_connected: true, hint: 'Set GOOGLE_ADS_CLIENT_ID.', need_env: ['GOOGLE_ADS_CLIENT_ID'] }];

  test('cost and outcome join into ONE row per link', async () => {
    const restore = stub({ adPlatforms: ADS, orders: ORDERS });
    try {
      const out = await journey.linkLedger({ market: 'US', days: 90 });
      const gifting = out.links.filter((l) => l.campaign === 'gifting');
      expect(gifting.length, 'the same link produced two rows again').toBe(1);
      expect(gifting[0].orders).toBe(1);
      expect(gifting[0].spend).toBe(300);
      expect(gifting[0].roas).toBeCloseTo(62 / 300, 3);
      expect(gifting[0].leak, 'a converting campaign was flagged as a leak').toBe(false);
    } finally { restore(); }
  });

  test('only genuinely dead spend is flagged as a leak', async () => {
    const restore = stub({ adPlatforms: ADS, orders: ORDERS });
    try {
      const out = await journey.linkLedger({ market: 'US', days: 90 });
      const leaks = out.links.filter((l) => l.leak);
      expect(leaks.map((l) => l.campaign)).toEqual(['dead']);
    } finally { restore(); }
  });

  test('excluded orders do not reach the revenue total', async () => {
    const restore = stub({ adPlatforms: ADS, orders: ORDERS });
    try {
      const out = await journey.linkLedger({ market: 'US', days: 90 });
      const chai = out.links.find((l) => l.campaign === 'aug');
      // 89.00 + 145.50; the 999.00 cancelled order must not be counted, and the
      // session param must not have split it into two links.
      expect(chai.orders).toBe(2);
      expect(chai.revenue).toBeCloseTo(234.5, 2);
    } finally { restore(); }
  });

  test('spend with no destination is reported, never silently dropped', async () => {
    const restore = stub({ adPlatforms: ADS, orders: ORDERS });
    try {
      const out = await journey.linkLedger({ market: 'US', days: 90 });
      // Dropping it would understate total spend with no explanation anywhere.
      expect(out.coverage.unjoinable_spend).toBe(120);
      expect(out.coverage.unjoinable_note).toMatch(/not silently understated/i);
    } finally { restore(); }
  });

  test('a disconnected platform contributes a reason, not zeros', async () => {
    const restore = stub({ adPlatforms: ADS, orders: ORDERS });
    try {
      const out = await journey.linkLedger({ market: 'US', days: 90 });
      const g = out.blockers.find((b) => b.platform === 'google');
      expect(g).toBeTruthy();
      expect(g.need_env).toContain('GOOGLE_ADS_CLIENT_ID');
      expect(g.effect, 'the blocker must say what its absence does to the table').toBeTruthy();
      // No google row may appear carrying a zero.
      expect(out.links.some((l) => l.channel === 'google')).toBe(false);
    } finally { restore(); }
  });

  test('ROAS is null, never zero or infinity, when a side is missing', async () => {
    const restore = stub({ adPlatforms: ADS, orders: ORDERS });
    try {
      const out = await journey.linkLedger({ market: 'US', days: 90 });
      const chai = out.links.find((l) => l.campaign === 'aug');   // revenue, no spend
      const dead = out.links.find((l) => l.campaign === 'dead');  // spend, no revenue
      expect(chai.roas, 'revenue with no spend is not infinite ROAS').toBeNull();
      expect(dead.roas, 'spend with no revenue is not 0 ROAS, it is unknown').toBeNull();
    } finally { restore(); }
  });

  test('the method is stated, and states what it is NOT', async () => {
    const restore = stub({ adPlatforms: ADS, orders: ORDERS });
    try {
      const out = await journey.linkLedger({ market: 'US', days: 90 });
      // Claiming multi-touch from last-click data is the most seductive
      // fabrication available on this surface.
      expect(out.method).toMatch(/last-click/i);
      expect(out.method).toMatch(/NOT multi-touch/i);
      expect(out.method).toMatch(/NOT the email platform's self-reported/i);
    } finally { restore(); }
  });
});

test('the tabs and route are wired, and no Serverless Function was added', () => {
  for (const t of ['journey', 'mailers']) {
    expect(PAGE).toContain(`data-p="${t}"`);
    expect(PAGE).toContain(`id="p-${t}"`);
  }
  expect(BRAIN).toContain("case 'journey'");
  expect(fs.existsSync(path.join(ROOT, 'api', 'journey.js'))).toBe(false);
  expect(functionFileCount()).toBeLessThanOrEqual(12);
});
