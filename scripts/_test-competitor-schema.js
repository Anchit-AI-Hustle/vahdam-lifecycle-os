'use strict';
/**
 * Competitor benchmarking must match the SHAPE OF THE LIVE TABLE.
 *
 * smart_competitor_campaigns is written by the capture pipeline and its columns
 * are: id, brand, channel, market, captured_at, title, body, promo, angle,
 * format, assets, source. There is no observed_at, hook, headline or subject.
 *
 * services.js ordered by observed_at, so PostgREST answered 42703 and select()
 * degraded to [] with only a console warning -- the benchmark silently returned
 * nothing while 48 real rows sat in the table. This pins both halves.
 *
 *   node scripts/_test-competitor-schema.js
 */
const path = require('path');
const svc = require(path.join('..', 'lib', 'smart-brain', 'services.js'));

let failures = 0;
const ok = (cond, msg, detail) => {
  if (cond) console.log('  ✓', msg + (detail ? `  — ${detail}` : ''));
  else { console.error('  ✗', msg + (detail ? `  — ${detail}` : '')); failures++; }
};

// Exactly the columns the live table returns, values sampled from production.
const LIVE_ROWS = [
  { id: 'c1', brand: 'Bird & Blend', channel: 'landing_page', market: 'US',
    captured_at: '2026-06-11T17:37:59Z', title: 'Sleep deeper tonight',
    body: 'Captured competitor creative body text', promo: null,
    angle: 'brand-story', format: 'video', source: 'stream' },
  { id: 'c2', brand: 'Yogi Tea', channel: 'tiktok', market: 'US',
    captured_at: '2026-06-10T17:37:59Z', title: 'Free shipping weekend',
    body: '...', promo: null, angle: 'wellness-benefit',
    format: 'image_heavy', source: 'stream' },
  { id: 'c3', brand: 'Rishi Tea', channel: 'meta', market: 'US',
    captured_at: '2026-06-09T17:37:59Z', title: 'Iced tea season starts now',
    body: '...', promo: 'SAVE25', angle: 'subscription',
    format: 'image_heavy', source: 'stream' },
];

(async () => {
  console.log('Competitor benchmarking / live schema');

  // ---- 1. The query must name a column the table actually has.
  const asked = [];
  // `connected` is a getter over url+key, so stand those up rather than
  // assigning it; select() is stubbed so nothing leaves the machine.
  const db = new svc.SmartBrainDbAdapter({ tableNames: { competitors: 'smart_competitor_campaigns' } });
  db.url = 'https://example.test'; db.key = 'test-key';
  db.select = async (table, params) => { asked.push({ table, params }); return LIVE_ROWS; };
  const data = await db.competitorData();

  const order = String((asked[0] || {}).params && asked[0].params.order || '');
  ok(order.startsWith('captured_at'), 'orders by captured_at, a column that exists', order);
  ok(!/observed_at/.test(order), 'does not order by observed_at (PostgREST 42703)', order);
  ok(data.competitors.length === 3, 'rows reach the caller', `${data.competitors.length} rows`);

  // ---- 2. The benchmark must actually populate from those rows.
  const b = new svc.CompetitorBenchmarkingService({}).benchmark(data);
  const channels = Object.keys(b.byChannel);
  ok(channels.length === 3, 'every channel is counted', JSON.stringify(channels));
  ok(b.byChannel.meta && b.byChannel.meta.activeBrands.includes('Rishi Tea'),
     'brands are attributed to their channel');
  ok(b.byChannel.tiktok && b.byChannel.tiktok.formats.image_heavy === 1,
     'formats are counted from the format column');

  // trendingHooks read hook/headline/subject -- none of which this table has.
  ok(b.trendingHooks.length === 3, 'trending hooks are extracted', JSON.stringify(b.trendingHooks.map((h) => h.hook)));
  ok(b.trendingHooks.some((h) => h.hook === 'Sleep deeper tonight'),
     'the hook line comes from title');

  // ---- 3. A degraded read must stay empty rather than throw.
  const db2 = new svc.SmartBrainDbAdapter({ tableNames: { competitors: 'smart_competitor_campaigns' } });
  db2.url = 'https://example.test'; db2.key = 'test-key';
  db2.select = async () => [];
  const empty = await db2.competitorData();
  const b2 = new svc.CompetitorBenchmarkingService({}).benchmark(empty);
  ok(Object.keys(b2.byChannel).length === 0 && b2.trendingHooks.length === 0,
     'an empty read degrades cleanly');

  console.log(failures ? `\n${failures} failing` : '\nall competitor schema checks passed');
  process.exit(failures ? 1 : 0);
})();
