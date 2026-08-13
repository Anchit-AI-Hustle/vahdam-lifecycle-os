const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// MAILER INTELLIGENCE SHOWED ZEROS FOR DATA IT DID NOT HAVE.
//
// The panel rendered "OPEN RATE 0.00%", "CLICK RATE 0.00%", "MAILER REVENUE $0"
// and "DELIVERED 0" while Klaviyo was switched off and the WebEngage store had
// never been synced — directly beside its own note reading "No delivery
// denominator is available; rates remain zero rather than being estimated".
//
// The page KNEW the figures were unknown and displayed numbers anyway. And those
// numbers are not neutral: a 0.00% open rate is the claim "we sent mail and
// nobody opened it", and $0 mailer revenue is "email drove no sales". Both are
// far worse than an admission of ignorance, because they are actionable and
// wrong — they argue for cutting a channel that was never measured.
//
// Three separate causes, one per describe block below.

const ROOT = path.join(__dirname, '..');
const CORE = path.join(ROOT, 'api', '_shared', 'data-analysis-core.js');
const EXT = fs.readFileSync(path.join(ROOT, 'data-analysis-extensions.js'), 'utf8');

function stubSources({ klaviyoOn, klaviyoEvents = [], weConnected, weEvents = 0, weByEvent = [] }) {
  const kl = require(path.join(ROOT, 'api', '_shared', 'klaviyo-core.js'));
  const we = require(path.join(ROOT, 'api', '_shared', 'webengage-core.js'));
  const saved = {
    ic: kl.isConnected, gm: kl.getMetrics, ge: kl.getEvents,
    c: we.connected, es: we.eventSummary, cp: we.campaignPerformance,
  };
  kl.isConnected = () => klaviyoOn;
  kl.getMetrics = async () => ({ ok: klaviyoOn, data: { data: [] } });
  kl.getEvents = async () => (klaviyoOn ? { ok: true, data: { data: klaviyoEvents } } : { ok: false, hint: 'Set KLAVIYO_API_KEY' });
  we.connected = () => weConnected;
  we.eventSummary = async () => ({ ok: true, total_events: weEvents, by_event: weByEvent });
  we.campaignPerformance = async () => ({ ok: true, campaigns: [] });
  return () => {
    kl.isConnected = saved.ic; kl.getMetrics = saved.gm; kl.getEvents = saved.ge;
    we.connected = saved.c; we.eventSummary = saved.es; we.campaignPerformance = saved.cp;
  };
}

async function mailerKpis(opts) {
  const restore = stubSources(opts);
  try {
    const core = require(CORE);
    const d = await core.mailer({ market: 'US', hours: 720 });
    return { k: d.kpis, note: d.note, sources: d.sources };
  } finally { restore(); }
}

test.describe('cause 1: a missing denominator produced 0 instead of unknown', () => {
  test('rates are null, not zero, when nothing was delivered', async () => {
    // rate(a, b) returned 0 when b was 0. Zero looks like the neutral value and
    // is not: it is a measurement.
    const { k } = await mailerKpis({ klaviyoOn: false, weConnected: true, weEvents: 0 });
    for (const key of ['open_rate', 'click_rate', 'ctor', 'unsubscribe_rate', 'bounce_rate', 'revenue_per_recipient']) {
      expect(k[key], `${key} was reported as a number when it is unknown`).toBeNull();
    }
  });

  test('a real rate is still computed when a denominator exists', async () => {
    const { k } = await mailerKpis({
      klaviyoOn: false, weConnected: true, weEvents: 1200,
      weByEvent: [{ event: 'Notification Delivered', n: 1000 }, { event: 'Notification Opened', n: 250 }],
    });
    expect(k.delivered).toBe(1000);
    expect(k.open_rate).toBeCloseTo(0.25, 4);
  });
});

test.describe('cause 2: an empty store counted as a reporting source', () => {
  test('two dark sources yield unknown counts, not measured zeros', async () => {
    // This is the exact state in the reported screenshot: Klaviyo off, WebEngage
    // reachable but never synced. /api/connectors-health already treats an empty
    // webengage_events table as NOT live; this applies the same standard.
    const { k, note } = await mailerKpis({ klaviyoOn: false, weConnected: true, weEvents: 0 });
    for (const key of ['delivered', 'opens', 'clicks', 'conversions', 'revenue']) {
      expect(k[key], `${key} claimed a measured zero with no source reporting`).toBeNull();
    }
    expect(note).toMatch(/no mailer source returned data/i);
    expect(note, 'the note must say why an empty store is not a zero').toMatch(/empty store is not a measurement of zero/i);
  });

  test('the WebEngage row explains why it contributes nothing despite being reachable', async () => {
    // "Connected" beside "0 events" reads as a working source with nothing to say.
    const { sources } = await mailerKpis({ klaviyoOn: false, weConnected: true, weEvents: 0 });
    expect(sources.webengage.reported).toBe(false);
    expect(sources.webengage.note).toMatch(/reachable but no events/i);
  });
});

test.describe('cause 3: metrics only one source can see were credited to any source', () => {
  test('revenue and conversions stay unknown when Klaviyo is dark, even if WebEngage reports', async () => {
    // WebEngage carries no revenue at all. Gating revenue on "any source read"
    // let a populated push store produce "$0 mailer revenue" — email drove no
    // sales, when the only source that can see sales was switched off.
    const { k } = await mailerKpis({
      klaviyoOn: false, weConnected: true, weEvents: 1200,
      weByEvent: [{ event: 'Notification Delivered', n: 1000 }, { event: 'Notification Opened', n: 250 }],
    });
    expect(k.delivered, 'WebEngage genuinely measured deliveries').toBe(1000);
    expect(k.revenue, 'only Klaviyo can see revenue').toBeNull();
    expect(k.conversions, 'only Klaviyo emits order events here').toBeNull();
  });
});

test.describe('the UI never prints an unknown as a number', () => {
  test('formatters render null as a dash and a measured zero as zero', () => {
    // Extracted and run against the real source so the assertion cannot drift
    // from what the page actually does.
    const block = EXT.slice(EXT.indexOf('function num('), EXT.indexOf('function dateTime('));
    const fn = new Function(`${block}; return { known, fmt, money, percent, ratio };`);
    const { fmt, money, percent } = fn();
    expect(percent(null, 2)).toBe('—');
    expect(money(null)).toBe('—');
    expect(fmt(null)).toBe('—');
    expect(fmt(undefined)).toBe('—');
    // A genuinely measured zero is still a fact and must still read as 0.
    expect(percent(0, 2)).toBe('0.00%');
    expect(money(0)).toBe('$0');
    expect(fmt(0)).toBe('0');
  });

  test('the banner no longer promises that every figure is zero', () => {
    expect(EXT).not.toMatch(/so every figure below is zero/);
    expect(EXT).toMatch(/every figure below is <b>unknown<\/b>/);
    // And it points at the switch that actually unblocks Klaviyo.
    expect(EXT).toMatch(/LIVE_CONNECTORS=on/);
  });
});
