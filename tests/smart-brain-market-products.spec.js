const { test, expect } = require('@playwright/test');
const path = require('path');

// A UK SEND PLANNED AROUND A US PRODUCT
//
// Measured against the live 90-day window on 2026-08-24: of the 80 UK slots, 64
// carried a hero whose SKU was VAH-US-*, and the US slots carried the UK ones in
// the same proportion. The cause was one line:
//
//     const product = products[(epoch + k + market.length) % products.length].product;
//
// The pool was GLOBAL - every product in smart_products, whatever market it
// belongs to - and the "vary it per market" stride was `market.length`, which is
// 2 for 'US' and 2 for 'UK'. So the two markets received byte-identical picks
// AND either could be handed the other's catalog.
//
// Two things are wrong with that, and the second is the expensive one:
// 1. It violates the closed source-of-truth rule (no cross-region reuse of
//    facts, assets, claims or URLs).
// 2. It breaks generation. The live-catalog gate resolves a named product
//    against the REGIONAL store and blocks the build when it cannot find it, so
//    a UK slot pointed at a US-only SKU is a slot that can never produce assets.
//
// smart_products carries a `market` column, so the pool is filtered on it.

const ROOT = path.join(__dirname, '..');
const { CalendarIntelligenceService, smartConfig } = require(path.join(ROOT, 'lib/smart-brain/services.js'));

const scored = (rows) => rows.map((p, i) => ({ product: p, score: rows.length - i }));
const US = [
  { sku: 'VAH-US-001', title: 'US Turmeric Ashwagandha', handle: 'us-turmeric', category: 'Wellness Tea', market: 'US' },
  { sku: 'VAH-US-002', title: 'US Masala Chai', handle: 'us-chai', category: 'Chai', market: 'US' },
  { sku: 'VAH-US-003', title: 'US Matcha', handle: 'us-matcha', category: 'Green Tea', market: 'US' },
];
const UK = [
  { sku: 'VAH-UK-001', title: 'UK Earl Grey', handle: 'uk-earl-grey', category: 'Black Tea', market: 'UK' },
  { sku: 'VAH-UK-002', title: 'UK Breakfast Blend', handle: 'uk-breakfast', category: 'Black Tea', market: 'UK' },
];

function plan(products, over = {}) {
  const config = smartConfig({ markets: ['US', 'UK'], calendarDays: 21, cohortsPerDay: 2, ...over });
  const analysis = {
    cohorts: [{ name: 'Loyalists', count: 245 }, { name: 'At-Risk', count: 1200 }, { name: 'New Subscribers', count: 800 }],
    productScores: scored(products),
    winningCampaigns: [],
    channelBenchmarks: {},
    mvtLearnings: [],
    dailyInsights: [],
  };
  const competitorBenchmarks = { byChannel: {}, trendingHooks: [] };
  return new CalendarIntelligenceService(config)
    .generate({ analysis, competitorBenchmarks, startDate: '2026-09-01', days: 21, feedback: [] })
    .entries;
}

const marketOfSku = (sku) => (String(sku).match(/VAH-([A-Z]{2})-/) || [])[1] || null;

test('every slot is planned from its own market catalog', () => {
  const entries = plan(US.concat(UK));
  expect(entries.length).toBeGreaterThan(20);
  const wrong = entries.filter((e) => marketOfSku(e.heroProduct.sku) !== e.market);
  expect(wrong.map((e) => `${e.date} ${e.market} -> ${e.heroProduct.sku}`).slice(0, 8),
    'a slot is planned around another region\'s product').toEqual([]);
});

test('supporting products stay in-market too', () => {
  // A bundle that mixes a UK hero with a US supporting SKU is the same defect,
  // one line down: the mailer would link to a product that market cannot buy.
  const entries = plan(US.concat(UK));
  const wrong = [];
  for (const e of entries) {
    for (const s of e.supportingProducts || []) {
      if (marketOfSku(s.sku) !== e.market) wrong.push(`${e.date} ${e.market} -> ${s.sku}`);
    }
  }
  expect(wrong.slice(0, 8), 'a bundle crosses regions').toEqual([]);
});

test('two markets on the same day do not get identical heroes', () => {
  // `market.length` is 2 for both US and UK, so the stride that was supposed to
  // separate them separated nothing.
  const entries = plan(US.concat(UK));
  const byDay = {};
  for (const e of entries) {
    const k = e.date + '#' + e.mailer_index;
    byDay[k] = byDay[k] || {};
    byDay[k][e.market] = e.heroProduct.title;
  }
  const collisions = Object.entries(byDay)
    .filter(([, v]) => v.US && v.UK && v.US === v.UK)
    .map(([k, v]) => `${k}: both markets on ${v.US}`);
  expect(collisions.slice(0, 5), 'US and UK are picking the same hero on the same day').toEqual([]);
});

test('a market with no catalog rows is planned AND flagged, never silently crossed', () => {
  // Nothing in the pool belongs to UK. The window must still be planned (an
  // empty calendar is not an improvement), and every UK slot must carry the
  // data dependency naming the market, so the gap is reviewable instead of
  // looking like a normal send.
  const entries = plan(US);
  const uk = entries.filter((e) => e.market === 'UK');
  expect(uk.length).toBeGreaterThan(0);
  for (const e of uk) {
    expect(e.product_data_dependency, `${e.date} UK crossed regions with no note`).toBeTruthy();
    expect(e.product_data_dependency).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
    expect(e.product_data_dependency).toContain('UK');
  }
  // And a market that DOES have rows must not be flagged.
  for (const e of entries.filter((x) => x.market === 'US')) {
    expect(e.product_data_dependency, `${e.date} US flagged though its catalog exists`).toBeFalsy();
  }
});

test('market-agnostic rows are usable by every market', () => {
  // A store that never set the market column should still plan, with no flag:
  // a row that claims no market is not another region's product.
  const rows = [
    { sku: 'VAHDAM-BUNDLE', title: 'Assorted Tea Gift Box', handle: 'gift-box', category: 'Gifts' },
    { sku: 'VAHDAM-SAMPLER', title: 'Tea Sampler', handle: 'sampler', category: 'Samplers' },
  ];
  const entries = plan(rows);
  expect(entries.length).toBeGreaterThan(20);
  for (const e of entries) expect(e.product_data_dependency).toBeFalsy();
});

test('the plan is still deterministic across runs', () => {
  // Determinism is load-bearing: a re-run that changes an approved slot means
  // the reviewer approved something that no longer exists.
  const a = plan(US.concat(UK)).map((e) => `${e.id}|${e.heroProduct.sku}`);
  const b = plan(US.concat(UK)).map((e) => `${e.id}|${e.heroProduct.sku}`);
  expect(a).toEqual(b);
});
