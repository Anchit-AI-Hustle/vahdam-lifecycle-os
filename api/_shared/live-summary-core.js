'use strict';
/**
 * live-summary-core.js — the Live Summary view.
 *
 * One read per source, sliced into every period comparison the dashboard shows:
 * day on day, week on week, month on month, year on year.
 *
 * Lives under api/_shared/ so Vercel does not count it as a Serverless Function.
 * The repo sits at the Hobby cap of 12; this is reached through the existing
 * data-analysis router as `view=summary`, never as a new api/*.js file.
 *
 * ── THE THREE THINGS THIS FILE EXISTS TO GET RIGHT ──────────────────────────
 *
 * 1. LIKE FOR LIKE, OR NOT AT ALL.
 *    Today is a partial day. This month is a partial month. Comparing five days
 *    of September against all thirty of August is the single most common lie a
 *    marketing dashboard tells, and it always reads as a collapse. Every
 *    comparison here is built from two windows of the SAME LENGTH: month to date
 *    against the same number of days in the prior month, year to date against
 *    the same span last year. The window pair is returned with each figure so a
 *    reader can check it rather than trust it.
 *
 * 2. RATES ARE RECOMPUTED FROM TOTALS, NEVER AVERAGED.
 *    The mean of thirty daily CTRs is not the CTR of the month. Every ratio
 *    (CTR, CPM, CPC, CPA, ROAS, conversion rate, AOV) is derived from summed
 *    numerator and denominator at the moment it is needed.
 *
 * 3. ABSENT IS NOT ZERO, AND NO BASELINE IS NOT A DROP.
 *    A metric no connector could read is null and renders as a dash. A previous
 *    period of zero yields a null percentage with a stated reason, because
 *    "up infinity percent" and "up 100%" are both fabrications.
 */

const adsLive = require('./ads-live-core.js');
const shopify = require('./shopify-core.js');
const { liveConnectorsEnabled } = require('./live-connectors.js');

const iso = () => new Date().toISOString();
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const text = (v) => String(v == null ? '' : v).trim();

/**
 * Ratio that is null when the denominator cannot support it.
 *
 * Six decimals, not four. CTR is stored as a fraction, and a low-CTR account
 * lives around 0.0011; four decimals quantises that to steps of 0.01 percentage
 * points, so two genuinely different weeks can round to the same displayed CTR
 * and a real movement disappears. Storage is cheap; the display formatter is
 * where rounding belongs.
 */
function rate(num, den, digits = 6) {
  const a = Number(num), b = Number(den);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return Number((a / b).toFixed(digits));
}

// ── Calendar helpers, all UTC-noon anchored so DST cannot shift a day ────────
function addDays(isoDay, days) {
  const d = new Date(isoDay + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(isoDay, months) {
  const [y, m, dd] = isoDay.split('-').map(Number);
  // Clamp to the last valid day of the target month: 31 Mar minus one month is
  // 28/29 Feb, not 3 Mar. Date's own rollover would silently produce the latter
  // and quietly shift a month boundary by three days.
  const target = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(dd, last));
  return target.toISOString().slice(0, 10);
}
function daysBetween(from, to) {
  return Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000);
}
function startOfMonth(isoDay) { return isoDay.slice(0, 8) + '01'; }
function startOfYear(isoDay) { return isoDay.slice(0, 4) + '-01-01'; }

/** The report timezone's today. The US ad account reports on Eastern. */
function reportToday() { return adsLive.todayISO(); }

// ── Period definitions ──────────────────────────────────────────────────────
/**
 * Each period returns { key, label, current:{from,to}, previous:{from,to}, note }.
 *
 * `to` is INCLUSIVE throughout.
 *
 * Day on day deliberately compares YESTERDAY against the day before, not today
 * against yesterday: today is still accruing, and a part-day against a whole day
 * reads as a crash every single morning. Today is reported separately, labelled
 * as partial, and never used as a comparison base.
 */
function periods(today) {
  const y1 = addDays(today, -1);        // yesterday, the last complete day
  const y2 = addDays(today, -2);

  const mStart = startOfMonth(today);
  const mtdDays = daysBetween(mStart, y1);  // complete days elapsed this month
  const prevMonthStart = addMonths(mStart, -1);

  const yStart = startOfYear(today);
  const ytdDays = daysBetween(yStart, y1);
  const prevYearStart = addMonths(yStart, -12);

  const out = [
    {
      key: 'dod', label: 'Day on day',
      current: { from: y1, to: y1 },
      previous: { from: y2, to: y2 },
      note: 'Yesterday against the day before. Today is excluded from both sides because it is still accruing.',
    },
    {
      key: 'wow', label: 'Week on week',
      current: { from: addDays(y1, -6), to: y1 },
      previous: { from: addDays(y1, -13), to: addDays(y1, -7) },
      note: 'Last seven complete days against the seven before them. Both windows are seven days, so weekday mix matches.',
    },
  ];

  // Month on month is only meaningful once the month has at least one complete
  // day in it. On the 1st there is nothing to compare and saying so beats
  // rendering a zero.
  if (mtdDays >= 0) {
    out.push({
      key: 'mom', label: 'Month on month',
      current: { from: mStart, to: y1 },
      previous: { from: prevMonthStart, to: addDays(prevMonthStart, mtdDays) },
      note: `Month to date (${mtdDays + 1} complete day${mtdDays === 0 ? '' : 's'}) against the SAME ${mtdDays + 1} day${mtdDays === 0 ? '' : 's'} of last month, not the whole of last month.`,
    });
  } else {
    out.push({
      key: 'mom', label: 'Month on month', unavailable: true,
      note: 'The month has no complete day yet. A month to date of zero days cannot be compared.',
    });
  }

  out.push({
    key: 'yoy', label: 'Year on year',
    current: { from: yStart, to: y1 },
    previous: { from: prevYearStart, to: addMonths(y1, -12) },
    note: `Year to date (${ytdDays + 1} days) against the same span last year. Leap years shift the end date by a calendar month, not by 365 days.`,
  });

  return out;
}

// ── Series slicing ──────────────────────────────────────────────────────────
/** Sum a dated series over an inclusive window. Returns null totals when the
 *  window is not covered by the data, rather than a partial sum presented whole. */
function sliceTotals(series, from, to, fields) {
  const rows = series.filter((r) => r.day >= from && r.day <= to);
  const totals = {};
  for (const f of fields) totals[f] = 0;
  for (const r of rows) for (const f of fields) totals[f] += n(r[f]);

  // Coverage is load-bearing. If the series starts after the window opens, the
  // sum is of a shorter period than the label claims, and comparing it against a
  // fully covered window manufactures a decline out of missing data.
  const first = series.length ? series[0].day : null;
  const last = series.length ? series[series.length - 1].day : null;
  const expected = daysBetween(from, to) + 1;
  const covered = rows.length;
  const complete = Boolean(first && last && first <= from && last >= to && covered >= expected);

  return {
    ...totals,
    days_expected: expected,
    days_present: covered,
    complete,
    partial_reason: complete ? null
      : !series.length ? 'No dated series was returned by the connector.'
      : first > from ? `The series begins ${first}, after this window opens (${from}).`
      : last < to ? `The series ends ${last}, before this window closes (${to}).`
      : `Only ${covered} of ${expected} days are present in the series.`,
  };
}

const AD_FIELDS = ['spend', 'impressions', 'clicks', 'link_clicks', 'conversions', 'revenue'];

/** Derive the ad metric set from summed totals. Rates from totals, never means. */
function adMetrics(t) {
  if (!t) return null;
  return {
    spend: t.spend, impressions: t.impressions, clicks: t.clicks,
    link_clicks: t.link_clicks, conversions: t.conversions, revenue: t.revenue,
    ctr: rate(t.link_clicks, t.impressions),
    cpc: rate(t.spend, t.clicks, 2),
    cpm: rate(t.spend * 1000, t.impressions, 2),
    cpa: rate(t.spend, t.conversions, 2),
    roas: rate(t.revenue, t.spend, 3),
    conversion_rate: rate(t.conversions, t.clicks),
  };
}

const COMMERCE_FIELDS = ['orders', 'revenue', 'units'];
function commerceMetrics(t) {
  if (!t) return null;
  return {
    orders: t.orders, revenue: t.revenue, units: t.units,
    aov: rate(t.revenue, t.orders, 2),
    units_per_order: rate(t.units, t.orders, 2),
  };
}

/**
 * Percentage change. Null, with a reason, wherever a percentage would be a
 * fiction: no baseline, absent value, or a sign flip that makes the ratio
 * meaningless (ROAS moving from -0.2 to 0.4 is not "up 300%").
 */
function delta(current, previous) {
  if (current == null || previous == null) {
    return { change: null, pct: null, reason: 'One side of the comparison was not measured.' };
  }
  const change = Number((current - previous).toFixed(6));
  if (previous === 0) {
    return { change, pct: null, reason: current === 0 ? 'Both periods are zero.' : 'The previous period is zero, so a percentage change has no baseline.' };
  }
  if (previous < 0) {
    return { change, pct: null, reason: 'The previous period is negative, so a percentage change would invert.' };
  }
  return { change, pct: Number(((change / previous) * 100).toFixed(2)), reason: null };
}

/** Build the comparison block for one metric key across every period. */
function comparisons(periodDefs, sliceFn, deriveFn, key) {
  const out = {};
  for (const p of periodDefs) {
    if (p.unavailable) {
      out[p.key] = { label: p.label, available: false, note: p.note };
      continue;
    }
    const cur = sliceFn(p.current.from, p.current.to);
    const prev = sliceFn(p.previous.from, p.previous.to);
    const c = deriveFn(cur), q = deriveFn(prev);
    const cv = c ? c[key] : null, pv = q ? q[key] : null;
    const d = delta(cv, pv);
    out[p.key] = {
      label: p.label,
      available: true,
      current: cv, previous: pv,
      change: d.change, pct: d.pct, blocked_reason: d.reason,
      current_window: p.current, previous_window: p.previous,
      // Both windows must be fully covered before a delta is trustworthy. A
      // partially covered window is still SHOWN, flagged, so the reader can see
      // the shape without being invited to act on the percentage.
      complete: Boolean(cur.complete && prev.complete),
      coverage_note: cur.complete && prev.complete ? null
        : [cur.partial_reason && `Current window: ${cur.partial_reason}`,
           prev.partial_reason && `Previous window: ${prev.partial_reason}`].filter(Boolean).join(' '),
      note: p.note,
    };
  }
  return out;
}

// ── Metric catalogue ────────────────────────────────────────────────────────
const AD_METRICS = [
  { key: 'spend', label: 'Ad spend', unit: 'currency', better: 'context' },
  { key: 'revenue', label: 'Attributed revenue', unit: 'currency', better: 'up' },
  { key: 'roas', label: 'ROAS', unit: 'ratio', better: 'up' },
  { key: 'conversions', label: 'Conversions', unit: 'count', better: 'up' },
  { key: 'cpa', label: 'Cost per conversion', unit: 'currency', better: 'down' },
  { key: 'impressions', label: 'Impressions', unit: 'count', better: 'context' },
  { key: 'clicks', label: 'Clicks', unit: 'count', better: 'up' },
  { key: 'ctr', label: 'CTR (link)', unit: 'percent_fraction', better: 'up' },
  { key: 'cpc', label: 'CPC', unit: 'currency', better: 'down' },
  { key: 'cpm', label: 'CPM', unit: 'currency', better: 'down' },
  { key: 'conversion_rate', label: 'Conversion rate', unit: 'percent_fraction', better: 'up' },
];
const COMMERCE_METRICS = [
  { key: 'revenue', label: 'Store revenue', unit: 'currency', better: 'up' },
  { key: 'orders', label: 'Orders', unit: 'count', better: 'up' },
  { key: 'aov', label: 'Average order value', unit: 'currency', better: 'up' },
  { key: 'units', label: 'Units sold', unit: 'count', better: 'up' },
  { key: 'units_per_order', label: 'Units per order', unit: 'ratio', better: 'up' },
];

// ── Source readers ──────────────────────────────────────────────────────────
/**
 * Ad series. ONE read covering the whole lookback, then sliced locally — a read
 * per comparison window would be four times the cost for the same numbers.
 */
async function readAdSeries({ today, lookbackDays, account }) {
  const from = addDays(today, -lookbackDays);
  const base = {
    id: 'ads', label: 'Paid media (Meta / warehouse)',
    requested: { from, to: today, account: account || 'all' },
  };
  if (!liveConnectorsEnabled()) {
    return { ...base, connected: false, series: [], blocker: 'Live connectors are disabled. Set LIVE_CONNECTORS=on to allow outbound reads.', read: 'not-attempted' };
  }
  try {
    const res = await adsLive.daily({ since: from, until: today, account });
    const series = (res && Array.isArray(res.series) ? res.series : [])
      .filter((r) => r && r.day)
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));
    return {
      ...base,
      connected: Boolean(res && res.connected),
      source: (res && res.source) || null,
      series,
      read: series.length ? 'fetched' : 'empty',
      blocker: series.length ? null : text(res && (res.blocker || res.error || res.note))
        || 'The connector answered with no dated rows, so no period can be compared.',
    };
  } catch (e) {
    return { ...base, connected: false, series: [], read: 'error', blocker: `Ad series read failed: ${text(e && e.message).slice(0, 200)}` };
  }
}

/**
 * Commerce series, bucketed by the store's local day.
 *
 * Bounded on purpose. Orders are a PAGED read, so a year of them is thousands of
 * records fetched on a dashboard load. The default lookback therefore serves day,
 * week and month comparisons; year on year needs `commerceDays` raised
 * explicitly, and the response says so rather than quietly returning a YoY built
 * on a window the read never covered.
 */
async function readCommerceSeries({ today, commerceDays }) {
  const from = addDays(today, -commerceDays);
  const base = {
    id: 'commerce', label: 'Shopify orders (US store)',
    requested: { from, to: today, days: commerceDays },
  };
  if (!liveConnectorsEnabled()) {
    return { ...base, connected: false, series: [], blocker: 'Live connectors are disabled. Set LIVE_CONNECTORS=on to allow outbound reads.', read: 'not-attempted' };
  }
  if (!shopify.isConnected()) {
    return { ...base, connected: false, series: [], read: 'not-attempted', blocker: text(shopify.status && shopify.status().blocker) || 'Shopify is not configured. Set SHOPIFY_STORE_DOMAIN and a read-scoped SHOPIFY_ADMIN_TOKEN.' };
  }
  try {
    const res = await shopify.orders({ market: 'US', days: commerceDays });
    const rows = (res && Array.isArray(res.orders) ? res.orders : []);
    const byDay = {};
    for (const o of rows) {
      const day = text(o.created_at).slice(0, 10);
      if (!day) continue;
      byDay[day] = byDay[day] || { day, orders: 0, revenue: 0, units: 0 };
      byDay[day].orders += 1;
      byDay[day].revenue += n(o.total_price != null ? o.total_price : o.total);
      byDay[day].units += (Array.isArray(o.line_items) ? o.line_items : []).reduce((a, li) => a + n(li.quantity), 0);
    }
    const series = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ ...d, revenue: Number(d.revenue.toFixed(2)) }));
    return {
      ...base, connected: true, source: 'shopify-admin', series,
      read: series.length ? 'fetched' : 'empty',
      blocker: series.length ? null : 'Shopify answered, but returned no orders in the window.',
    };
  } catch (e) {
    return { ...base, connected: false, series: [], read: 'error', blocker: `Order read failed: ${text(e && e.message).slice(0, 200)}` };
  }
}

// ── Public view ─────────────────────────────────────────────────────────────
/**
 * @param {object} p
 * @param {string} [p.market='US']
 * @param {string} [p.account]        scope the ad read to one account
 * @param {number} [p.lookbackDays]   ad series span; must cover YoY to compute it
 * @param {number} [p.commerceDays]   order series span; bounded, see above
 */
async function summary(p = {}) {
  const market = text(p.market).toUpperCase() || 'US';
  const today = reportToday();
  // 400 days so the year-on-year window is fully covered including the leap-day
  // case; 365 would leave the far end of last year's YTD window short and every
  // YoY figure would be flagged incomplete.
  const lookbackDays = Math.min(Math.max(n(p.lookbackDays) || 400, 30), 800);
  const commerceDays = Math.min(Math.max(n(p.commerceDays) || 90, 7), 800);

  const [ads, commerce] = await Promise.all([
    readAdSeries({ today, lookbackDays, account: text(p.account) }),
    readCommerceSeries({ today, commerceDays }),
  ]);

  const defs = periods(today);
  const adSlice = (from, to) => sliceTotals(ads.series, from, to, AD_FIELDS);
  const comSlice = (from, to) => sliceTotals(commerce.series, from, to, COMMERCE_FIELDS);

  const metrics = [
    ...AD_METRICS.map((m) => ({
      ...m, group: 'Paid media', source: 'ads',
      available: ads.series.length > 0,
      blocker: ads.series.length ? null : ads.blocker,
      periods: ads.series.length ? comparisons(defs, adSlice, adMetrics, m.key) : null,
    })),
    ...COMMERCE_METRICS.map((m) => ({
      ...m, group: 'Commerce', source: 'commerce',
      available: commerce.series.length > 0,
      blocker: commerce.series.length ? null : commerce.blocker,
      periods: commerce.series.length ? comparisons(defs, comSlice, commerceMetrics, m.key) : null,
    })),
  ];

  // Today, reported separately and never used as a comparison base.
  const todayAds = ads.series.length ? adMetrics(sliceTotals(ads.series, today, today, AD_FIELDS)) : null;
  const todayCom = commerce.series.length ? commerceMetrics(sliceTotals(commerce.series, today, today, COMMERCE_FIELDS)) : null;

  // Reach is deliberately absent from every rolled-up figure above. It is a
  // unique-user count and is NOT additive across days: summing thirty daily
  // reaches counts the same person up to thirty times. It stays on the daily
  // series for charting and is excluded from all period totals.
  const notes = [
    'Every comparison uses two windows of equal length. Month to date is compared against the same number of days in the prior month, not against the whole month.',
    'Yesterday is the latest complete day. Today is shown separately and marked partial; it is never used as a comparison base.',
    'Rates (CTR, CPC, CPM, CPA, ROAS, conversion rate, AOV) are recomputed from summed totals, never averaged across days.',
    'Reach is excluded from all period totals because it is a unique-user count and cannot be summed across days.',
  ];

  const yoyCovered = commerceDays >= 400;
  if (!yoyCovered) {
    notes.push(`Commerce year on year is not computed: the order read is bounded to ${commerceDays} days because orders are a paged fetch. Request commerceDays=400 to include it.`);
  }

  return {
    ok: true,
    generated_at: iso(),
    market,
    today,
    timezone: process.env.ADS_REPORT_TZ || 'America/New_York',
    live_connectors: liveConnectorsEnabled(),
    sources: [ads, commerce].map((s) => ({
      id: s.id, label: s.label, connected: Boolean(s.connected), read: s.read,
      source: s.source || null, blocker: s.blocker || null, requested: s.requested,
      days_returned: s.series.length,
      first_day: s.series.length ? s.series[0].day : null,
      last_day: s.series.length ? s.series[s.series.length - 1].day : null,
    })),
    periods: defs,
    metrics,
    today_partial: { ads: todayAds, commerce: todayCom },
    series: { ads: ads.series, commerce: commerce.series },
    notes,
  };
}

module.exports = {
  summary,
  // Exported for tests: the period arithmetic and the honesty rules are the part
  // worth pinning, and they are pure functions of a date and a series.
  __testing: { periods, sliceTotals, delta, adMetrics, commerceMetrics, rate, addDays, addMonths, daysBetween, comparisons },
};
