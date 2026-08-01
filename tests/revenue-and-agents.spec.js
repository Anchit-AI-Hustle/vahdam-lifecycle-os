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
