const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { blockExternal } = require('./lib/page-harness.js');

// The Live Summary tab is the whole-funnel answer, and the only surface in this
// app that compares one period against another. That makes it the surface with
// the most room to lie, and the lies are specific and well known:
//
//   - comparing five days of this month against thirty of last month
//   - averaging thirty daily CTRs and calling it the month's CTR
//   - printing "0" for a number nothing measured
//   - printing "+100%" when the previous period was zero
//   - summing reach across days as though it were additive
//
// Every one of those reads as a real finding and none of them is. This spec
// pins the refusals, not the layout: renaming a card is free, quietly comparing
// unequal windows is not.

const ROOT = path.join(__dirname, '..');
const CORE = path.join(ROOT, 'api', '_shared', 'live-summary-core.js');
const T = require(CORE).__testing;

// ── The period arithmetic ───────────────────────────────────────────────────

test.describe('every comparison uses two windows of the same length', () => {
  // A month-end date, a month-start date, a leap year and an ordinary mid-month
  // day. The month-end cases are where naive date maths rolls over.
  for (const today of ['2026-09-05', '2026-09-01', '2026-03-31', '2024-02-29', '2026-12-31']) {
    test(`on ${today}, current and previous windows match in length`, () => {
      for (const p of T.periods(today)) {
        if (p.unavailable) continue;
        const cur = T.daysBetween(p.current.from, p.current.to) + 1;
        const prev = T.daysBetween(p.previous.from, p.previous.to) + 1;
        expect(cur, `${p.key}: current window is ${cur} days`).toBe(prev);
        expect(cur).toBeGreaterThan(0);
      }
    });
  }

  test('today is never inside a comparison window', () => {
    const today = '2026-09-05';
    for (const p of T.periods(today)) {
      if (p.unavailable) continue;
      // Today is still accruing. A part-day against a whole day reads as a
      // crash every morning, so yesterday is the latest day either side.
      expect(p.current.to < today, `${p.key} current window ends ${p.current.to}`).toBe(true);
      expect(p.previous.to < today).toBe(true);
    }
  });

  test('month on month compares month-to-date against the SAME days of last month', () => {
    const p = T.periods('2026-09-05').find((x) => x.key === 'mom');
    expect(p.current).toEqual({ from: '2026-09-01', to: '2026-09-04' });
    // Not 2026-08-01..2026-08-31. That is the bug this whole file exists for.
    expect(p.previous).toEqual({ from: '2026-08-01', to: '2026-08-04' });
  });

  test('on the 1st, month on month reports that it cannot be computed', () => {
    const p = T.periods('2026-09-01').find((x) => x.key === 'mom');
    expect(p.unavailable).toBe(true);
    expect(p.note).toMatch(/no complete day/i);
  });

  test('subtracting a month from the 31st lands in the right month', () => {
    // Date rollover would give 2026-03-03 here, silently moving a boundary by
    // three days and shifting every month-on-month figure with it.
    expect(T.addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(T.addMonths('2024-03-31', -1)).toBe('2024-02-29');  // leap
    expect(T.addMonths('2026-05-31', -1)).toBe('2026-04-30');
    expect(T.addMonths('2026-01-31', -1)).toBe('2025-12-31');
  });
});

// ── The honesty rules ───────────────────────────────────────────────────────

test.describe('rates are recomputed from totals, never averaged', () => {
  test('a heavily skewed pair of days does not produce the mean of its rates', () => {
    // Day 1: 10 link clicks on 100 impressions (10%).
    // Day 2: 100 link clicks on 100,000 impressions (0.1%).
    // The true pooled CTR is 110/100100 = 0.11%. The mean of the two daily
    // rates is 5.05% — off by a factor of 46, and in the flattering direction.
    const series = [
      { day: '2026-09-03', impressions: 100, link_clicks: 10, clicks: 10, spend: 1, conversions: 0, revenue: 0 },
      { day: '2026-09-04', impressions: 100000, link_clicks: 100, clicks: 100, spend: 1, conversions: 0, revenue: 0 },
    ];
    const totals = T.sliceTotals(series, '2026-09-03', '2026-09-04',
      ['spend', 'impressions', 'clicks', 'link_clicks', 'conversions', 'revenue']);
    const m = T.adMetrics(totals);
    expect(m.ctr).toBeCloseTo(110 / 100100, 6);
    const mean = ((10 / 100) + (100 / 100000)) / 2;
    expect(Math.abs(m.ctr - mean)).toBeGreaterThan(0.04);
  });
});

test.describe('absent is never zero', () => {
  test('a ratio with no denominator is null, not zero and not Infinity', () => {
    const m = T.adMetrics({ spend: 0, impressions: 0, clicks: 0, link_clicks: 0, conversions: 0, revenue: 0 });
    // CPA of "0" would read as free conversions; Infinity would render as a
    // broken cell. Both are worse than admitting the figure does not exist.
    expect(m.cpa).toBeNull();
    expect(m.ctr).toBeNull();
    expect(m.cpc).toBeNull();
    expect(m.roas).toBeNull();
  });

  test('but a MEASURED zero stays zero, because that is a finding', () => {
    // Real spend and no revenue is a ROAS of 0.00, and it is the single most
    // important number on the page when it happens. Rendering it as a dash
    // would hide the exact case this account has already lived through: $756
    // spent, $0 returned. Absent and zero are different facts.
    const m = T.adMetrics({ spend: 756, impressions: 10000, clicks: 100, link_clicks: 80, conversions: 0, revenue: 0 });
    expect(m.roas).toBe(0);
    expect(m.conversion_rate).toBe(0);
    expect(m.cpa).toBeNull();   // no conversions to divide by: genuinely absent
  });

  test('rate() refuses a zero denominator', () => {
    expect(T.rate(5, 0)).toBeNull();
    expect(T.rate(0, 0)).toBeNull();
    expect(T.rate(5, 2)).toBe(2.5);
  });
});

test.describe('a percentage change is withheld wherever it would be fiction', () => {
  const cases = [
    ['previous is zero', 10, 0, /no baseline/i],
    ['both are zero', 0, 0, /both periods are zero/i],
    ['current was not measured', null, 5, /not measured/i],
    ['previous was not measured', 5, null, /not measured/i],
    ['previous is negative', 5, -2, /invert/i],
  ];
  for (const [name, cur, prev, reason] of cases) {
    test(name + ' yields no percentage, with a stated reason', () => {
      const d = T.delta(cur, prev);
      expect(d.pct, `${name} produced ${d.pct}%`).toBeNull();
      expect(d.reason).toMatch(reason);
    });
  }

  test('an ordinary change still produces a percentage', () => {
    expect(T.delta(10, 5).pct).toBe(100);
    expect(T.delta(5, 10).pct).toBe(-50);
    expect(T.delta(5, 5).pct).toBe(0);
  });
});

test.describe('a window the series does not cover is reported, not silently short', () => {
  const series = [
    { day: '2026-09-03', spend: 5 },
    { day: '2026-09-04', spend: 5 },
  ];
  test('a partial window is flagged with the reason', () => {
    const s = T.sliceTotals(series, '2026-09-01', '2026-09-04', ['spend']);
    // Summing 2 days and labelling it a 4-day window manufactures a 50% drop
    // out of missing data.
    expect(s.complete).toBe(false);
    expect(s.days_present).toBe(2);
    expect(s.days_expected).toBe(4);
    expect(s.partial_reason).toMatch(/begins 2026-09-03/);
  });
  test('a fully covered window is complete', () => {
    const s = T.sliceTotals(series, '2026-09-03', '2026-09-04', ['spend']);
    expect(s.complete).toBe(true);
    expect(s.spend).toBe(10);
  });
  test('a comparison is only complete when BOTH windows are', () => {
    const defs = [{ key: 'x', label: 'X', current: { from: '2026-09-03', to: '2026-09-04' }, previous: { from: '2026-09-01', to: '2026-09-02' }, note: '' }];
    const c = T.comparisons(defs, (f, t) => T.sliceTotals(series, f, t, ['spend']), (x) => ({ spend: x.spend }), 'spend');
    expect(c.x.complete).toBe(false);
    expect(c.x.coverage_note).toMatch(/Previous window/);
  });
});

test('reach is excluded from every period total, because it cannot be summed', () => {
  const src = fs.readFileSync(CORE, 'utf8');
  const fields = src.match(/const AD_FIELDS = \[([^\]]+)\]/)[1];
  // Reach is a unique-user count. Summing 30 daily reaches counts one person up
  // to 30 times and produces an audience larger than the platform has.
  expect(fields).not.toMatch(/reach/);
  expect(src).toMatch(/reach/i);            // it is still discussed
  const metricKeys = (src.match(/key: '(\w+)'/g) || []).join(' ');
  expect(metricKeys).not.toMatch(/'reach'/);
});

test('Live Summary is the FIRST extension tab', () => {
  // Ordering is the claim: it is the whole-funnel view, so it comes before the
  // detail tabs rather than being buried among them. A source read, not a
  // browser check - the tab list is a literal in the file.
  const ext = fs.readFileSync(path.join(ROOT, 'data-analysis-extensions.js'), 'utf8');
  const block = ext.match(/var LIVE_TABS = \[([\s\S]*?)\n  \];/)[1];
  const ids = (block.match(/id: '([a-z-]+)'/g) || []).map((x) => x.split("'")[1]);
  expect(ids[0]).toBe('live-summary');
  expect(ext).toMatch(/if \(id === 'live-summary'\) return renderLiveSummary/);
});

test('a metric the series cannot describe gets NO trend line, not a flat one', () => {
  // The daily series carries raw counters, never derived rates. Reading `roas`
  // off a row returns undefined, num() turns that into 0, and a run of zeros
  // draws a perfectly flat line — which reads as "this metric did not move".
  // That is a claim nobody made, drawn in the same ink as the real ones.
  const ext = fs.readFileSync(path.join(ROOT, 'data-analysis-extensions.js'), 'utf8');
  const fn = ext.slice(ext.indexOf('function spark(series, field)'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  // It must go through the deriving reader and drop nulls, never num(r[field]).
  expect(body).toContain('dailyValue');
  expect(body).not.toMatch(/num\(r\[field\]\)/);
  expect(body).toMatch(/pts\.length < 2/);

  // And the deriving reader must compute a ratio rather than invent one.
  const dv = ext.slice(ext.indexOf('function dailyValue(row, field)'));
  for (const k of ['roas', 'cpa', 'cpc', 'ctr', 'conversion_rate', 'aov', 'cpm']) {
    expect(dv.slice(0, 1600), `${k} has no per-day derivation`).toContain(`case '${k}'`);
  }
  // A denominator of zero yields null, so the point is dropped rather than
  // plotted at zero or Infinity.
  expect(dv).toMatch(/y !== 0/);
});

test('the view is reachable without adding a serverless function', () => {
  // The repo sits at the Hobby cap of 12 functions; a 13th api/*.js file fails
  // the deploy outright. This view must arrive through the existing router.
  const core = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'data-analysis-core.js'), 'utf8');
  expect(core).toMatch(/case'summary'|case 'summary'/);
  expect(core).toMatch(/live-summary-core/);
  expect(fs.existsSync(path.join(ROOT, 'api', 'live-summary.js'))).toBe(false);
  expect(CORE).toMatch(/_shared/);
});

// ── The rendered page ───────────────────────────────────────────────────────
// auth.js registers sw.js, and its controllerchange handler reloads the page
// 50ms later. A spec that navigates and then reads page state races that reload.
test.describe('the rendered tab', () => {
  test.use({ serviceWorkers: 'block' });


  async function serve(summaryPayload) {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      if (p.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        if (u.searchParams.get('view') === 'summary') return res.end(JSON.stringify(summaryPayload));
        return res.end(JSON.stringify({ ok: true, generated_at: new Date().toISOString(), kpis: {}, rows: [], platforms: [] }));
      }
      const f = path.join(ROOT, p === '/' ? '/index.html' : p);
      if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        const ext = path.extname(f);
        res.writeHead(200, { 'Content-Type': ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' : 'text/html' });
        return res.end(fs.readFileSync(f));
      }
      res.writeHead(404); res.end('nf');
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    return { srv, base: 'http://127.0.0.1:' + srv.address().port };
  }

  function payload(over) {
    const base = {
      ok: true, generated_at: new Date().toISOString(), market: 'US',
      today: '2026-09-05', timezone: 'America/New_York', live_connectors: true,
      sources: [
        { id: 'ads', label: 'Paid media (Meta / warehouse)', connected: true, read: 'fetched', source: 'meta', blocker: null, requested: {}, days_returned: 400, first_day: '2025-08-01', last_day: '2026-09-05' },
        { id: 'commerce', label: 'Shopify orders (US store)', connected: true, read: 'fetched', source: 'shopify-admin', blocker: null, requested: {}, days_returned: 90, first_day: '2026-06-07', last_day: '2026-09-05' },
      ],
      periods: [
        { key: 'dod', label: 'Day on day', current: { from: '2026-09-04', to: '2026-09-04' }, previous: { from: '2026-09-03', to: '2026-09-03' }, note: 'n' },
        { key: 'mom', label: 'Month on month', current: { from: '2026-09-01', to: '2026-09-04' }, previous: { from: '2026-08-01', to: '2026-08-04' }, note: 'n' },
      ],
      metrics: [],
      today_partial: { ads: null, commerce: null },
      series: { ads: [], commerce: [] },
      notes: ['Every comparison uses two windows of equal length.'],
    };
    return Object.assign(base, over || {});
  }

  function metric(over) {
    return Object.assign({
      key: 'revenue', label: 'Attributed revenue', unit: 'currency', better: 'up',
      group: 'Paid media', source: 'ads', available: true, blocker: null,
      periods: {
        dod: { label: 'Day on day', available: true, current: 200, previous: 100, change: 100, pct: 100, blocked_reason: null, current_window: { from: '2026-09-04', to: '2026-09-04' }, previous_window: { from: '2026-09-03', to: '2026-09-03' }, complete: true, coverage_note: null, note: 'n' },
        mom: { label: 'Month on month', available: true, current: 800, previous: 400, change: 400, pct: 100, blocked_reason: null, current_window: { from: '2026-09-01', to: '2026-09-04' }, previous_window: { from: '2026-08-01', to: '2026-08-04' }, complete: true, coverage_note: null, note: 'n' },
      },
    }, over || {});
  }

  async function openSummary(page, data) {
    const { srv, base } = await serve(data);
    // Abort third-party requests. Without this every goto sits waiting on Google
    // Fonts and the Shopify CDN until each connection gives up: 13s per
    // navigation against 0.2s, for assets that change nothing this spec asserts.
    await blockExternal(page);
    await page.goto(base + '/data-analysis.html', { waitUntil: 'load' });
    await page.waitForSelector('#anTabs button[data-ext-tab="live-summary"]', { timeout: 15000 });
    await page.click('#anTabs button[data-ext-tab="live-summary"]');
    await page.waitForSelector('.sm-matrix, .xcard', { timeout: 15000 });
    await page.waitForTimeout(500);
    return { srv, base };
  }

  test('with no source reading, nothing is rendered as a zero', async ({ page }) => {
    const blocked = payload({
      live_connectors: false,
      sources: [
        { id: 'ads', label: 'Paid media', connected: false, read: 'not-attempted', source: null, blocker: 'Live connectors are disabled. Set LIVE_CONNECTORS=on to allow outbound reads.', requested: {}, days_returned: 0, first_day: null, last_day: null },
      ],
      metrics: [metric({ available: false, blocker: 'Live connectors are disabled. Set LIVE_CONNECTORS=on to allow outbound reads.', periods: null })],
    });
    const { srv } = await openSummary(page, blocked);
    const body = await page.textContent('#xSumBody');

    expect(body).toContain('LIVE_CONNECTORS=on');       // the fix is on screen
    expect(body).toMatch(/No live source answered/i);
    // The defect this guards: a blocked metric rendered as "$0" claims we spent
    // nothing and sold nothing, which is a finding rather than a gap.
    const values = await page.$$eval('.sm-now', (els) => els.map((e) => e.textContent.trim()));
    for (const v of values) expect(v, `a blocked metric rendered as "${v}"`).not.toMatch(/^\$?0(\.0+)?%?$/);
    srv.close();
  });

  test('a metric that improved is coloured as an improvement, and one that worsened is not', async ({ page }) => {
    const data = payload({
      metrics: [
        metric(),                                                     // revenue up 100%, better=up
        metric({ key: 'cpa', label: 'Cost per conversion', better: 'down' }), // cpa up 100%, better=down
      ],
    });
    const { srv } = await openSummary(page, data);
    const rows = await page.$$eval('.sm-matrix tbody tr', (trs) => trs.map((tr) => ({
      label: tr.querySelector('.sm-metric b').textContent.trim(),
      cls: [...tr.querySelectorAll('.sm-delta')].map((d) => d.className.replace('sm-delta ', '')),
    })));
    const rev = rows.find((r) => /Attributed revenue/.test(r.label));
    const cpa = rows.find((r) => /Cost per conversion/.test(r.label));
    // Same +100%, opposite meaning. Revenue doubling is good; cost per
    // conversion doubling is not, and painting both green is how a dashboard
    // congratulates someone on a rising CPA.
    expect(rev.cls.every((c) => c === 'up')).toBe(true);
    expect(cpa.cls.every((c) => c === 'down')).toBe(true);
    srv.close();
  });

  test('spend is never coloured good or bad on its own', async ({ page }) => {
    const data = payload({ metrics: [metric({ key: 'spend', label: 'Ad spend', better: 'context' })] });
    const { srv } = await openSummary(page, data);
    const cls = await page.$$eval('.sm-delta', (els) => els.map((e) => e.className));
    // Spend rising is not an achievement. Green here is how a chart argues for
    // a budget increase it has no evidence for.
    for (const c of cls) expect(c).not.toMatch(/\bup\b|\bdown\b/);
    srv.close();
  });

  test('a comparison with no baseline says so instead of showing a percentage', async ({ page }) => {
    const m = metric();
    m.periods.dod = Object.assign({}, m.periods.dod, {
      current: 200, previous: 0, change: 200, pct: null,
      blocked_reason: 'The previous period is zero, so a percentage change has no baseline.',
    });
    const { srv } = await openSummary(page, payload({ metrics: [m] }));
    const body = await page.textContent('#xSumBody');
    expect(body).toContain('no baseline');
    expect(body).not.toMatch(/Infinity|NaN/);
    srv.close();
  });

  test('an incomplete window is marked rather than presented as final', async ({ page }) => {
    const m = metric();
    m.periods.mom = Object.assign({}, m.periods.mom, {
      complete: false, coverage_note: 'Previous window: The series begins 2026-08-03, after this window opens (2026-08-01).',
    });
    const { srv } = await openSummary(page, payload({ metrics: [m] }));
    const partial = page.locator('.sm-partial').first();
    await expect(partial).toBeVisible();
    expect(await partial.getAttribute('title')).toMatch(/Incomplete window/);
    srv.close();
  });

  test('today is labelled partial and is not used as a comparison base', async ({ page }) => {
    const data = payload({
      today_partial: { ads: { spend: 120, impressions: 4000, clicks: 90, conversions: 3 }, commerce: null },
      metrics: [metric()],
    });
    const { srv } = await openSummary(page, data);
    const body = await page.textContent('#xSumBody');
    expect(body).toMatch(/partial/i);
    expect(body).toMatch(/still accruing/i);
    // Every comparison window on screen must end before today.
    const titles = await page.$$eval('.sm-delta', (els) => els.map((e) => e.getAttribute('title') || ''));
    for (const t of titles) expect(t).not.toContain('2026-09-05');
    srv.close();
  });

  test('the exact window pair is reachable from every comparison', async ({ page }) => {
    const { srv } = await openSummary(page, payload({ metrics: [metric()] }));
    const titles = await page.$$eval('.sm-delta', (els) => els.map((e) => e.getAttribute('title') || ''));
    expect(titles.length).toBeGreaterThan(0);
    // A reader must be able to check the comparison rather than trust it.
    for (const t of titles) expect(t).toMatch(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} vs \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    srv.close();
  });
});
