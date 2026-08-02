const { test, expect } = require('@playwright/test');
const path = require('path');

// Two new surfaces, and the properties that make them safe to act on:
//   Revenue Analysis — every cut is in scope whether or not it has a source, a
//   cut with no source says so instead of showing zeroes, and no share or ratio
//   is ever computed across mismatched windows.
//   Platform Agents  — an agent with no data does not think.

const shared = (f) => require(path.join(__dirname, '..', 'api', '_shared', f));
const rev = shared('revenue-analysis-core.js');
const agents = shared('platform-agents-core.js');

test.describe.configure({ mode: 'serial' });

let payload;
test.beforeAll(async () => { payload = await rev.revenue({ market: 'US' }); });

// ── Revenue Analysis ────────────────────────────────────────────────────────
test('every dimension asked for is present as a cut, sourced or not', () => {
  const keys = payload.cuts.map((c) => c.key);
  // region, channel, platform, campaign/adset/ad, mailer, landing page — plus
  // the product/time/cohort cuts the export supports.
  for (const required of ['region', 'channel', 'platform', 'campaign', 'adset', 'ad', 'mailer', 'landing_page',
    'product', 'product_type', 'month', 'week', 'day_of_week', 'discount', 'new_vs_returning', 'acquisition', 'cohort_retention']) {
    expect(keys, `"${required}" must be in scope`).toContain(required);
  }
  expect(payload.coverage.total_cuts).toBe(payload.cuts.length);
});

test('a cut with no source states a blocker and carries no rows', () => {
  for (const c of payload.cuts.filter((x) => !x.available)) {
    expect(c.rows, `${c.key} must not invent rows`).toEqual([]);
    expect(c.blocker, `${c.key} must name what would answer it`).toBeTruthy();
    expect(String(c.blocker).length).toBeGreaterThan(12);
  }
});

test('an available cut has real rows and names its source', () => {
  const avail = payload.cuts.filter((c) => c.available);
  expect(avail.length).toBeGreaterThan(0);
  for (const c of avail) {
    expect(c.rows.length, `${c.key}`).toBeGreaterThan(0);
    expect(c.source, `${c.key} must name its source`).toBeTruthy();
  }
});

test('channel share is taken over the cut, not a mismatched window total', () => {
  const chan = payload.cuts.find((c) => c.key === 'channel');
  test.skip(!chan.available, 'no channel export loaded');
  const total = chan.rows.reduce((a, r) => a + (r.share_of_sales || 0), 0);
  // The bug this pins: dividing channel sales by the 2026-YTD summary total put
  // one channel at 167% of "total".
  expect(total).toBeGreaterThan(0.98);
  expect(total).toBeLessThan(1.02);
  for (const r of chan.rows) expect(r.share_of_sales).toBeLessThanOrEqual(1);
});

test('the seed order tables are excluded, visibly and with a reason', () => {
  expect(payload.excluded_sources.length).toBeGreaterThan(0);
  const x = payload.excluded_sources[0];
  expect(x.source).toContain('smart_orders');
  expect(x.excluded_because).toMatch(/seed|fixture/i);
  expect(x.to_make_usable).toBeTruthy();
  // And nothing from them leaked into a cut.
  expect(JSON.stringify(payload.cuts)).not.toContain('VAH-US-0');
});

test('revenue figures come from the real export, not a rounded fixture', () => {
  const region = payload.cuts.find((c) => c.key === 'region');
  test.skip(!region.available, 'no export loaded');
  // Seed data was whole dollars throughout; real export totals carry cents.
  const hasCents = region.rows.some((r) => Math.round(r.total_sales) !== r.total_sales);
  expect(hasCents, 'real export revenue should not be all whole dollars').toBe(true);
});

test('every *_rate field in every cut is a fraction, never a 0-100 percent', () => {
  // live_orders passed shopify's returning_rate_pct (54.3) straight through
  // while both dashboards multiply _rate fields by 100 — rendering 5430%.
  for (const c of payload.cuts.filter((x) => x.available)) {
    for (const row of c.rows) {
      for (const [k, v] of Object.entries(row)) {
        if (/_rate($|_)/.test(k) && typeof v === 'number') {
          expect(v, `${c.key}.${k}=${v} must be a fraction`).toBeLessThanOrEqual(1.5);
        }
      }
    }
  }
});

// ── Platform Agents ─────────────────────────────────────────────────────────
test('there is one agent per platform, grouped', () => {
  const ids = agents.AGENTS.map((a) => a.id);
  expect(ids).toEqual(['shopify', 'meta', 'google', 'tiktok', 'klaviyo', 'webengage', 'pagedeck']);
  for (const a of agents.AGENTS) expect(['commerce', 'paid_media', 'lifecycle', 'web']).toContain(a.group);
});

test('an unconnected agent does not think, and says so', async () => {
  const out = await agents.runAll({ market: 'US' });
  expect(out.agents.length).toBe(7);
  for (const a of out.agents.filter((x) => !x.connected)) {
    expect(a.analysed, `${a.agent} must not claim analysis`).toBe(false);
    expect(a.insights, `${a.agent} must produce no insights without data`).toEqual([]);
    expect(a.blocker, `${a.agent} must name its blocker`).toBeTruthy();
    // The connection step IS the action item — not an error, an instruction.
    expect(a.action_items.length).toBe(1);
    expect(a.action_items[0].priority).toBe('P0');
    expect(a.action_items[0].why).toBe(a.blocker);
  }
});

test('the action queue is ranked and attributes every item to its platform', async () => {
  const out = await agents.runAll({ market: 'US' });
  expect(out.action_queue.length).toBeGreaterThan(0);
  const rank = { P0: 0, P1: 1, P2: 2 };
  let prev = -1;
  for (const a of out.action_queue) {
    expect(a.platform, 'every action names its platform').toBeTruthy();
    const r = rank[a.priority] ?? 3;
    expect(r, 'queue must be ordered by priority').toBeGreaterThanOrEqual(prev);
    prev = r;
  }
});

test('an unknown platform is refused rather than guessed at', async () => {
  const out = await agents.runAgent('linkedin', {});
  expect(out.ok).toBe(false);
  expect(out.available).toContain('shopify');
});

// ── Three-platform normalisation ────────────────────────────────────────────
// Meta, Google and TikTok disagree about units and shape. These pin the three
// conversions that actually go wrong, using payloads shaped like each platform's
// real response. Revenue Analysis mapped Meta only before this; Google spend
// would have been read as micros (a millionfold overstatement) had it not.
const adRows = shared('ad-rows-core.js');

test('Google cost arrives in micros and becomes dollars', () => {
  const rows = adRows.rowsFor({ ok: true, platform: 'google', level: 'campaign', data: [{ results: [
    { campaign: { id: '1', name: 'Search Brand' },
      metrics: { costMicros: 1234560000, impressions: 1000, clicks: 50, conversions: 5, conversionsValue: 500, averageCpc: 24691200 } },
  ] }] });
  expect(rows).toHaveLength(1);
  expect(rows[0].spend).toBeCloseTo(1234.56, 2);      // not 1,234,560,000
  expect(rows[0].cpc).toBeCloseTo(24.6912, 3);
  expect(rows[0].roas).toBeCloseTo(500 / 1234.56, 4);
});

test('TikTok percentage rates become fractions', () => {
  const rows = adRows.rowsFor({ ok: true, platform: 'tiktok', level: 'campaign', data: { list: [
    { dimensions: { campaign_id: '9', campaign_name: 'TT Prospecting' },
      metrics: { spend: 100, impressions: 10000, clicks: 321, ctr: 3.21, complete_payment: 4, total_complete_payment_value: 250 } },
  ] } });
  expect(rows[0].ctr).toBeCloseTo(0.0321, 4);          // 3.21% -> 0.0321, not 3.21
  expect(rows[0].revenue).toBe(250);
  expect(rows[0].conversions).toBe(4);
});

test('a Meta purchase reported under several action types is counted once', () => {
  const rows = adRows.rowsFor({ ok: true, platform: 'meta', level: 'campaign', data: [
    { campaign_id: '5', campaign_name: 'Meta BOF', spend: 100, impressions: 5000, clicks: 200,
      actions: [{ action_type: 'purchase', value: '10' }, { action_type: 'omni_purchase', value: '10' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '10' }],
      action_values: [{ action_type: 'purchase', value: '900' }, { action_type: 'omni_purchase', value: '900' }] },
  ] });
  // Summing the three action types would give 30 purchases / 1800 revenue.
  expect(rows[0].conversions).toBe(10);
  expect(rows[0].revenue).toBe(900);
});

test('all three platforms produce the same row shape', () => {
  const meta = adRows.rowsFor({ ok: true, platform: 'meta', level: 'account', data: [{ account_id: 'a', spend: 1 }] });
  const google = adRows.rowsFor({ ok: true, platform: 'google', level: 'account', data: [{ results: [{ customer: { id: 'c' }, metrics: { costMicros: 1e6 } }] }] });
  const tiktok = adRows.rowsFor({ ok: true, platform: 'tiktok', level: 'account', data: { list: [{ dimensions: { advertiser_id: 't' }, metrics: { spend: 1 } }] } });
  const keys = (r) => Object.keys(r[0]).sort().join(',');
  expect(keys(google)).toBe(keys(meta));
  expect(keys(tiktok)).toBe(keys(meta));
  for (const r of [meta, google, tiktok]) expect(r[0].spend).toBe(1);
});

test('a retail-media rollup reports null ROAS, never zero', () => {
  // Traffic-KPI accounts have no pixel: zero purchases is structural, not a result.
  const roll = adRows.rollup([{ spend: 500, impressions: 90000, clicks: 3000, conversions: 0, revenue: 0, reach: 40000 }]);
  expect(roll.roas).toBeNull();
  expect(roll.cpa).toBeNull();
  expect(roll.revenue_trustworthy).toBe(false);
  expect(roll.revenue_note).toMatch(/retail-media/i);
  // Delivery metrics are still real and must survive.
  expect(roll.ctr).toBeCloseTo(3000 / 90000, 6);
  expect(roll.cpm).toBeCloseTo(500 * 1000 / 90000, 4);
});

// ── Account connectors reach both features ──────────────────────────────────
test('revenue analysis exposes the ad account registry', async () => {
  const r = await rev.revenue({ market: 'US' });
  expect(r.ad_accounts).toBeTruthy();
  expect(r.ad_accounts.feeds).toBeGreaterThan(0);
  expect(r.ad_accounts.revenue_capable + r.ad_accounts.traffic_only).toBe(r.ad_accounts.feeds);
  expect(Object.keys(r.ad_accounts.by_platform)).toEqual(expect.arrayContaining(['meta', 'google', 'tiktok']));
});

test('each ad agent knows its own accounts even while offline', async () => {
  for (const id of ['meta', 'google', 'tiktok']) {
    const a = await agents.runAgent(id, { market: 'US' });
    const list = (a.metrics && a.metrics.accounts) || [];
    expect(list.length, `${id} must know its accounts`).toBeGreaterThan(0);
    for (const acct of list) expect(typeof acct.can_report_revenue).toBe('boolean');
  }
});

test('every ad cut reads all three platforms, not just Meta', async () => {
  const r = await rev.revenue({ market: 'US' });
  for (const key of ['platform', 'campaign', 'adset', 'ad']) {
    const c = r.cuts.find((x) => x.key === key);
    // Unconnected here, so the blocker must account for all three platforms
    // rather than silently covering only the one that was mapped.
    for (const p of ['meta', 'google', 'tiktok']) {
      expect(String(c.blocker), `${key} must report ${p}`).toContain(p);
    }
  }
});

// ── CTA promise gate ────────────────────────────────────────────────────────
// A generated mailer shipped a green band reading "DOWNLOAD YOUR PERSONALIZED
// PERFORMANCE PLAYBOOK" directly above a button reading "Explore the
// collection", both linking to a product collection. VAHDAM has no playbook, so
// the CTA invented a deliverable — a fabricated claim the banned-PHRASE gate
// cannot catch, because every individual word is fine.
const sm = shared('scenario-model.js');

test('a CTA promising a gated asset is rewritten to a real action', () => {
  const undeliverable = [
    'Download your personalized performance playbook',
    'Get your free wellness report',
    'Claim your personalised tea audit',
    'Unlock the ritual blueprint',
    'Book a call with our tea expert',
    'Take the quiz',
    'Start your free trial',
    'Access our brewing checklist',
  ];
  for (const c of undeliverable) {
    const out = sm.sanitizeCta(c);
    expect(out, `"${c}" must not ship`).not.toBe(c);
    expect(sm.CTA_UNDELIVERABLE_RX.test(out), `rewrite of "${c}" must itself be deliverable`).toBe(false);
  }
});

test('real commerce CTAs are left alone', () => {
  // Over-blocking would be its own failure: "Shop the gift guide" is a real
  // collection, and the acquisition-verb list deliberately excludes shop/browse.
  for (const c of ['Steep the ritual', 'Explore the collection', 'Shop best sellers', 'Shop the gift guide',
    'Browse single-estate teas', 'Find your blend', 'Restore your morning', 'Order the sampler']) {
    expect(sm.sanitizeCta(c), `"${c}" must survive untouched`).toBe(c);
  }
});

test('two CTAs promising different journeys are detected as contradictory', () => {
  expect(sm.ctasAgree('Download your personalized performance playbook', 'Explore the collection')).toBe(false);
  expect(sm.ctasAgree('Steep the ritual', 'Explore the collection')).toBe(true);
});

test('the dev tripwire throws on an undeliverable CTA', () => {
  const prev = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'development';
  try {
    expect(() => sm.assertDeliverableCta('Download your free playbook', 'mailer')).toThrow(/undeliverable/i);
    expect(() => sm.assertDeliverableCta('Steep the ritual', 'mailer')).not.toThrow();
  } finally { process.env.VERCEL_ENV = prev; }
});
