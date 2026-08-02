const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The ads calendar labelled the SNAPSHOT'S LAST DAY as "TODAY". On 2 Aug 2026
// it was still drawing "25 · TODAY" with "$136 · partial day" beside it,
// because every date in the page came from `SNAP.today.date` — a field whose
// name says "today" but whose value is "the last day this capture covers".
// Both dates being recent Saturdays is what kept it invisible.
//
// This is the same defect describeAccount() fixed server-side (CLAUDE.md: "a
// stale date must never present itself as today"); the calendar never got it.
// These tests run the REAL page functions against a snapshot pinned in the
// past, so they fail if anything re-conflates the two dates.

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'ad-campaigns-master.html'), 'utf8');

// The shipped snapshot: captured 2026-07-26, last day of data 2026-07-25.
const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ads/ads-live-snapshot.json'), 'utf8'));

test('the committed snapshot really is stale — the premise of these tests', () => {
  const captured = SNAPSHOT.captured_at;
  const lastDay = SNAPSHOT.today && SNAPSHOT.today.date;
  expect(lastDay, 'snapshot must carry a last-day date').toBeTruthy();
  // If someone refreshes the snapshot to literally today, these tests still
  // hold (the page would say TODAY correctly) — but the interesting case is a
  // snapshot behind the clock, which is what the file has shipped as.
  expect(captured >= lastDay, 'capture cannot precede its own last data day').toBe(true);
});

// Extract the page's date-contract helpers and run them directly. Pulling them
// from source (rather than restating them) means the test tracks what ships.
function dateHelpers(nowISO) {
  const start = HTML.indexOf('var AD_REPORT_TZ=');
  const end = HTML.indexOf('function fallbackDay()');
  expect(start, 'date-contract helpers must exist in the page').toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const src = HTML.slice(start, end);
  // eslint-disable-next-line no-new-func
  const make = new Function('SNAP', 'NOW_ISO', `
    ${src.replace(
      'return new Intl.DateTimeFormat("en-CA",{timeZone:AD_REPORT_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());',
      'return NOW_ISO;'
    )}
    return { reportToday, snapDay, snapIsToday, staleDays, snapDayNote };
  `);
  return make(SNAPSHOT, nowISO);
}

test('a week-old snapshot is never reported as today', () => {
  const h = dateHelpers('2026-08-02');
  expect(h.reportToday()).toBe('2026-08-02');
  expect(h.snapDay()).toBe('2026-07-25');
  expect(h.snapIsToday(), 'a 2026-07-25 snapshot must not claim to be 2026-08-02').toBe(false);
  expect(h.staleDays()).toBe(8);
  expect(h.snapDayNote()).toContain('8 days before today');
  expect(h.snapDayNote()).toContain('2026-08-02');
  expect(h.snapDayNote(), 'a stale day must never be described as still accruing').not.toContain('still accruing');
});

test('on the day of capture the same snapshot IS today, and says so', () => {
  const h = dateHelpers('2026-07-25');
  expect(h.snapIsToday()).toBe(true);
  expect(h.staleDays()).toBe(0);
  expect(h.snapDayNote()).toContain('today, still accruing');
});

test('the page derives today from the clock, never from the snapshot field', () => {
  // The bug in one line: `var today=(SNAP&&SNAP.today&&SNAP.today.date)||""`.
  // Nothing that decides what to LABEL as today may read that field again.
  const calendarBody = HTML.slice(HTML.indexOf('function renderCalendar()'), HTML.indexOf('function calDetail('));
  expect(calendarBody).toContain('reportToday()');
  expect(
    /var\s+today\s*=\s*\(?\s*SNAP\s*&&\s*SNAP\.today/.test(calendarBody),
    'renderCalendar must not take "today" from SNAP.today.date'
  ).toBe(false);

  const detailBody = HTML.slice(HTML.indexOf('function calDetail('), HTML.indexOf('function monthLabel('));
  expect(
    /var\s+r=byDay\[iso\],\s*today=\(SNAP&&SNAP\.today/.test(detailBody),
    'calDetail must not take "today" from SNAP.today.date'
  ).toBe(false);

  // "Jump to today" must jump to the clock's today.
  const jump = HTML.slice(HTML.indexOf('document.getElementById("cal-today")'), HTML.indexOf('document.getElementById("cal-grid")'));
  expect(jump).toContain('reportToday()');
  expect(
    /SNAP\.today\.date/.test(jump),
    'the Jump to today button must not jump to the snapshot day'
  ).toBe(false);
});

test('the rendered grid marks the real today and labels the snapshot day honestly', async ({ page }) => {
  // Render the real calendar markup with the clock pinned to 2026-08-02.
  const start = HTML.indexOf('var AD_REPORT_TZ=');
  const helperSrc = HTML.slice(start, HTML.indexOf('function fallbackDay()'));
  const renderSrc = HTML.slice(HTML.indexOf('function renderCalendar()'), HTML.indexOf('function calDetail('));

  await page.setContent('<div id="cal-grid"></div><div id="cal-cards"></div><div id="cal-src"></div><select id="cal-month"><option value="2026-08">August</option></select>');
  const out = await page.evaluate(({ helperSrc, renderSrc, snap }) => {
    const $ = (s) => document.querySelector(s);
    const money0 = (v) => '$' + Math.round(Number(v) || 0).toLocaleString();
    const money = money0;
    const intf = (v) => (Number(v) || 0).toLocaleString();
    const pad = (n, w) => { n = String(Math.abs(Math.trunc(Number(n) || 0))); while (n.length < w) n = '0' + n; return n; };
    const SNAP = snap, LIVE = null;
    const fallbackDay = () => '2026-08-02';
    const monthKey = (v) => (/^\d{4}-\d{2}$/.test(v) ? v : '2026-08');
    const shortDay = (iso) => String(iso);
    // eslint-disable-next-line no-new-func
    new Function('SNAP', 'LIVE', '$', 'money0', 'money', 'intf', 'pad', 'fallbackDay', 'monthKey', 'shortDay', `
      ${helperSrc.replace(
        'return new Intl.DateTimeFormat("en-CA",{timeZone:AD_REPORT_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());',
        'return "2026-08-02";'
      )}
      ${renderSrc}
      renderCalendar();
    `)(SNAP, LIVE, $, money0, money, intf, pad, fallbackDay, monthKey, shortDay);
    return { grid: document.getElementById('cal-grid').innerHTML, src: document.getElementById('cal-src').textContent };
  }, { helperSrc, renderSrc, snap: SNAPSHOT });

  // innerHTML normalizes attribute quoting, so match quote-agnostically.
  const grid = out.grid.replace(/"/g, "'");

  // Exactly one TODAY, and it is the 2nd (the real day) — not the 25th.
  const todayCells = grid.match(/· TODAY/g) || [];
  expect(todayCells.length, 'exactly one cell may claim TODAY').toBe(1);
  expect(grid).toMatch(/data-d='2026-08-02'[^>]*>\s*<div class='dn'>2 · TODAY/);
  expect(grid, 'July 25 must not be rendered in the August grid at all').not.toContain("data-d='2026-07-25'");
  expect(grid, "today's cell must keep the today class").toMatch(/class='cell today[^']*'[^>]*data-d='2026-08-02'/);

  // Days already past but not covered by the snapshot say so, rather than
  // reading as "planned" (future) or a bare "no data" (nothing ran).
  expect(grid).toContain('not yet<br>reported');
  // Aug 1 already happened but the July snapshot cannot know it.
  expect(grid).toMatch(/class='cell past gap'[^>]*data-d='2026-08-01'/);
  // ...and it must NOT be dressed as a future/planned day.
  expect(grid, 'a day that already happened is not "planned"').not.toMatch(/class='cell future'[^>]*data-d='2026-08-01'/);
  // Genuinely future days keep the planned treatment.
  expect(grid).toMatch(/class='cell future'[^>]*data-d='2026-08-03'/);

  // The source line names the staleness instead of just "snapshot 2026-07-26".
  expect(out.src).toContain('snapshot 2026-07-26');
  expect(out.src).toContain('2026-07-25');
  expect(out.src).toContain('before today');
  expect(out.src).toContain('not a live read');
});
