const { test, expect } = require('@playwright/test');
const path = require('path');

// An INDEPENDENT check on email performance: count orders whose own Shopify
// record says they came from email, and find the day that peaks. It deliberately
// does not consult Klaviyo — an email platform reporting on itself cannot
// validate itself, which is the whole reason for this second approach.
//
// The traps this locks are the ones that would silently produce a WRONG DATE:
//   1. utm_source=klaviyo on an SMS click. Klaviyo sends email, SMS and push from
//      one source, so inferring email from the source alone counts SMS orders as
//      email and can move the peak onto an SMS blast's day. Medium must win.
//   2. UTC day boundaries. A 9pm America/New_York send straddles two UTC dates,
//      splitting its orders and moving the apparent peak by a day.
//   3. Treating unattributed orders as "not email". An email click that lost its
//      UTMs is direct_or_unknown, so the email count is a floor, not an exact
//      number, and the answer has to say so.

const core = require(path.join(__dirname, '..', 'api', '_shared', 'shopify-core.js'));

test('medium beats source: an SMS click from an email platform is not email', () => {
  expect(core.classifyOrder({ landing_site: '/?utm_source=klaviyo&utm_medium=sms' }).channel).toBe('sms');
  expect(core.classifyOrder({ landing_site: '/?utm_source=webengage&utm_medium=push' }).channel).toBe('push');
  expect(core.classifyOrder({ landing_site: '/?utm_source=klaviyo&utm_medium=email' }).channel).toBe('email');
  // Source-only remains email, but the reason must record that it was inferred.
  const inferred = core.classifyOrder({ landing_site: '/?utm_source=klaviyo' });
  expect(inferred.channel).toBe('email');
  expect(inferred.why).toContain('inferred');
});

test('an order with no UTM and no referrer is unknown, never "not email"', () => {
  const r = core.classifyOrder({});
  expect(r.channel).toBe('direct_or_unknown');
  // Junk that cannot be parsed must not become a guess either.
  expect(core.classifyOrder({ landing_site: 'not a url' }).channel).toBe('direct_or_unknown');
});

test('dates bucket in the shop timezone, not UTC', () => {
  // 01:30 UTC on the 7th is 21:30 on the 6th in New York — an evening send.
  expect(core.localDate('2026-08-07T01:30:00Z', 'America/New_York')).toBe('2026-08-06');
  expect(core.localDate('2026-08-07T01:30:00Z', null)).toBe('2026-08-07');
});

test('the peak email day is computed from real orders, with its caveats', async () => {
  // Two email orders on the 6th (one of them a 9pm ET order that UTC would push
  // to the 7th), one on the 7th, plus SMS/paid/direct noise. The correct answer
  // is the 6th — and only if timezone bucketing and medium precedence both work.
  const orders = [
    { name: '#1', processed_at: '2026-08-06T15:00:00Z', total_price: '40.00', landing_site: '/?utm_source=klaviyo&utm_medium=email' },
    { name: '#2', processed_at: '2026-08-07T01:30:00Z', total_price: '60.00', landing_site: '/?utm_source=klaviyo&utm_medium=email' },
    { name: '#3', processed_at: '2026-08-07T15:00:00Z', total_price: '25.00', landing_site: '/?utm_source=klaviyo&utm_medium=email' },
    { name: '#4', processed_at: '2026-08-07T16:00:00Z', total_price: '30.00', landing_site: '/?utm_source=klaviyo&utm_medium=sms' },
    { name: '#5', processed_at: '2026-08-07T17:00:00Z', total_price: '80.00', landing_site: '/?utm_source=facebook&utm_medium=paid_social' },
    { name: '#6', processed_at: '2026-08-07T18:00:00Z', total_price: '20.00' },
  ];
  const tz = 'America/New_York';
  const byDate = new Map();
  for (const o of orders) {
    const c = core.classifyOrder(o).channel;
    const d = core.localDate(o.processed_at, tz);
    if (!byDate.has(d)) byDate.set(d, { date: d, email: 0 });
    if (c === 'email') byDate.get(d).email++;
  }
  const ranked = [...byDate.values()].sort((a, b) => b.email - a.email);
  expect(ranked[0].date, 'the 9pm ET order must count to the 6th, not the 7th').toBe('2026-08-06');
  expect(ranked[0].email).toBe(2);
  // The SMS order must not be in the email count for the 7th.
  expect(byDate.get('2026-08-07').email).toBe(1);
});

test('with no credential it returns the request it would have made, and fabricates nothing', async () => {
  const prev = { d: process.env.SHOPIFY_STORE_DOMAIN, t: process.env.SHOPIFY_ADMIN_TOKEN, l: process.env.LIVE_CONNECTORS };
  delete process.env.SHOPIFY_STORE_DOMAIN; delete process.env.SHOPIFY_ADMIN_TOKEN; process.env.LIVE_CONNECTORS = 'off';
  const out = await core.attribution({ market: 'US', days: 90 });
  expect(out.ok).toBe(false);
  expect(out.connected).toBe(false);
  expect(out.would_request.url).toContain('orders.json');
  // The fields that make attribution possible must be in the request it names.
  expect(out.would_request.url).toContain('landing_site');
  expect(out.would_request.url).toContain('referring_site');
  expect(out.blocker).toBeTruthy();
  // No invented peak day.
  expect(out.peak_email_day).toBeUndefined();
  if (prev.d) process.env.SHOPIFY_STORE_DOMAIN = prev.d;
  if (prev.t) process.env.SHOPIFY_ADMIN_TOKEN = prev.t;
  if (prev.l) process.env.LIVE_CONNECTORS = prev.l; else delete process.env.LIVE_CONNECTORS;
});

test('attribution is exposed as a Shopify op', () => {
  expect(Object.keys(core.OPS)).toContain('attribution');
});
