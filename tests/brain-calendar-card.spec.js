const { test, expect } = require('@playwright/test');
const { startServer, blockExternal } = require('./lib/page-harness.js');

// /brain HAS ONE CALENDAR, AND IT IS A TABLE.
//
// The page briefly carried two views of the same 90 days: this Rolling calendar
// table and a day-card list. Merging them into the CARD list was the wrong
// direction. A card collapses a send into a chip, and the facts each row has to
// carry - cohort size, the analysis that chose the send, confidence, the review
// verdict, and per-send actions - have nowhere to live in a card, so they ended
// up in tooltips and behind clicks. Nine facts per row, identical in shape for
// every row, is what a table is for.
//
// Two properties this file pins, because both have regressed before:
//
//  1. ONE calendar. Not two views of one dataset, and not a table whose rows are
//     days when the unit of work is a send.
//  2. Nothing here calls a file that EXISTS "ready". assets_ready is derived from
//     builtChannels(): every planned channel has an ARTIFACT. That stays true for
//     a campaign generated weeks ago against a catalog that has since gone stale,
//     or that the live catalog gate is now blocking outright. Printing
//     file-existence where a reader scans for "cleared to send" is the same class
//     of defect as the run that called itself final while its gate had failed.

let server, BASE;
test.beforeAll(async () => { const s = await startServer(); server = s.server; BASE = s.base; });
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });
test.use({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });

/** One send. Two of these a day is the real plan shape, and is what made a day-per-row view lossy. */
function entry(date, market, opts = {}) {
  return {
    id: `${date}-${market}`, date, market, status: opts.status || 'tentative',
    cohort: { name: opts.cohort || 'Lapsed 90d', size: opts.size ?? 12400 },
    objective: opts.objective || 'winback',
    heroProduct: { title: opts.hero || 'Turmeric Ashwagandha Herbal Tea' },
    channels: ['email', 'meta', 'google', 'landing_page'],
    confidence: opts.confidence ?? 0.74,
    analysis: {
      summary: opts.why || 'Chosen to drive reactivation for Lapsed 90d with a caffeine-free evening ritual.',
      confidence: { label: 'moderate', factors: [{ delta: 12, label: 'cohort responds to winback' }] },
    },
    festival: opts.festival ? { name: opts.festival } : null,
  };
}

const PLAN = [
  entry('2026-10-05', 'US', { festival: 'Diwali Gifting' }),
  entry('2026-10-05', 'UK', { festival: 'Diwali Gifting' }),
  entry('2026-10-06', 'US', { hero: 'Himalayan Green Tea', cohort: 'Engaged' }),
  entry('2026-10-06', 'UK', { hero: 'Himalayan Green Tea', cohort: 'Engaged' }),
  entry('2026-10-07', 'US', { hero: 'Earl Grey Masala Chai', cohort: 'Winback', status: 'approved' }),
  entry('2026-10-07', 'UK', { hero: 'Earl Grey Masala Chai', cohort: 'Winback' }),
];

async function openCalendar(page) {
  await blockExternal(page);
  // Playwright matches routes in REVERSE registration order, so the catch-all
  // must be registered FIRST or it shadows the specific handler. Getting this
  // backwards served an empty plan, which renders the empty state - a stubbing
  // mistake that looks exactly like a broken page.
  await page.route((url) => url.pathname.startsWith('/api/'),
    (r) => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await page.route((url) => url.pathname.includes('/api/calendar'), (r) => {
    if (!/action=smart-brain-plan/.test(r.request().url())) {
      return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    }
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, entries: PLAN }) });
  });
  await page.goto(`${BASE}/smart-brain.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#plantable tbody tr.planrow').first().waitFor({ timeout: 20000 });
  // WAIT FOR THE REVEAL TRANSFORM TO CLEAR BEFORE MEASURING ANY GEOMETRY.
  //
  // motion.css reveals panels with a small rotation, and
  // getBoundingClientRect() on a ROTATED element returns its AXIS-ALIGNED
  // bounding box. The AABB of a rotated box is larger than the box, and the
  // error grows with distance from the transform origin, so far down a long
  // list two stacked rows' boxes overlap - which reads exactly like "a row is
  // beside another instead of below it" when nothing is painting over anything.
  // reducedMotion:'reduce' above is necessary but NOT sufficient: motion.css
  // only forces transform:none on .vh-rv and .vh-kin .vh-w, so anything outside
  // those selectors can still be mid-animation. Asserting the absence of a
  // transform is the robust form.
  await page.waitForFunction(() => {
    const el = document.querySelector('#plantable tbody tr.planrow');
    if (!el) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const tf = getComputedStyle(e).transform;
      if (tf !== 'none' && tf !== 'matrix(1, 0, 0, 1, 0, 0)') return false;
    }
    return true;
  }, null, { timeout: 20000 });
}

/**
 * The region filter defaults to US, so the table opens FILTERED - which is the
 * product behaviour, not a stubbing accident. Tests about the table's shape have
 * to widen it first, or they are measuring the filter.
 */
async function showAllRegions(page) {
  await page.locator('#mktfilter [data-mkt="all"]').click();
  await expect(page.locator('#plantable tbody tr.planrow')).toHaveCount(6);
}

test.describe('the /brain rolling calendar', () => {
  test.beforeEach(async ({ page }) => { await openCalendar(page); });

  test('there is exactly ONE calendar on the page', async ({ page }) => {
    await expect(page.locator('#plantable')).toHaveCount(1);
    // The day-card list was the second calendar. It is gone, along with the
    // panel that only it could open - a surface kept with no entrance is the
    // trap this repo has hit with INFO.ads and the Creative Studio.
    for (const dead of ['.callist', '#calbody', '#dayslots', '#callegend']) {
      await expect(page.locator(dead), `${dead} is a second calendar surface`).toHaveCount(0);
    }
  });

  test('one row per SEND, not per day, in date order', async ({ page }) => {
    // Two markets a day is the real plan shape. A day-per-row view renders 3
    // for this fixture; a send-per-row view renders 6, so the count alone
    // distinguishes the two designs.
    await showAllRegions(page);
    const rows = page.locator('#plantable tbody tr.planrow');
    const dates = await rows.locator('td:nth-child(1)').allInnerTexts();
    expect(dates.map((d) => d.trim().slice(0, 10)))
      .toEqual(['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-06', '2026-10-07', '2026-10-07']);
    const markets = await rows.locator('td:nth-child(2)').allInnerTexts();
    expect(markets.map((m) => m.trim().split('\n')[0])).toEqual(['US', 'UK', 'US', 'UK', 'US', 'UK']);
  });

  test('every column the row promises is actually there', async ({ page }) => {
    // Compared case-insensitively: the header is uppercased by CSS
    // text-transform, so asserting the rendered case would pin a style choice
    // rather than the columns.
    const heads = await page.locator('#plantable thead th').allInnerTexts();
    expect(heads.map((h) => h.trim().toUpperCase())).toEqual([
      'DATE', 'MARKET', 'COHORT', 'OBJECTIVE · HERO', 'WHY (ANALYSIS)',
      'CHANNELS', 'CONF.', 'STATUS', 'ACTIONS',
    ]);
    // A header is a promise about the cell under it. Check the row honours it.
    const row = page.locator('#plantable tbody tr.planrow').first();
    await expect(row.locator('td.cohort')).toContainText('Lapsed 90d');
    await expect(row.locator('td.cohort'), 'cohort size is what makes a send judgeable').toContainText('12400 profiles');
    await expect(row.locator('td.obj')).toContainText('winback');
    await expect(row.locator('td.obj')).toContainText('Turmeric Ashwagandha Herbal Tea');
    await expect(row.locator('td.why')).toContainText('Chosen to drive reactivation');
    await expect(row.locator('td.chan')).toContainText('email');
    await expect(row.locator('td.conf')).toContainText('74%');
    await expect(row.locator('td.conf')).toContainText('moderate');
  });

  test('each row acts on its own send', async ({ page }) => {
    const actions = page.locator('#plantable tbody tr.planrow').first().locator('td:last-child button');
    await expect(actions).toHaveCount(4);
    await expect(actions.nth(0)).toHaveText('View');
    // Approve / Reject live in the status cell, and collapse to a pill once a
    // verdict is recorded - so an approved send must NOT still offer Approve.
    const draft = page.locator('#plantable tbody tr.planrow').nth(0);
    await expect(draft.locator('td:nth-child(8)')).toContainText('draft');
    await expect(draft.locator('td:nth-child(8) button')).toHaveCount(2);
    await showAllRegions(page);
    const approved = page.locator('#plantable tbody tr.planrow').nth(4);
    await expect(approved.locator('td:nth-child(8)')).toContainText('approved');
    await expect(approved.locator('td:nth-child(8) button'),
      'an approved send still offers a review verdict').toHaveCount(0);
  });

  test('never calls an artifact that exists "ready"', async ({ page }) => {
    const text = await page.locator('#plantable').innerText();
    expect(text).not.toMatch(/\bready\b/i);
  });

  test('the filters and bulk actions act on this table', async ({ page }) => {
    const card = page.locator('#daycal');
    for (const id of ['#downloadAll', '#mktfilter', '#durfilter', '#catfilter']) {
      await expect(card.locator(id), `${id} is not on the calendar card`).toHaveCount(1);
    }
    // The count states what the filters resolved to, so a filter that matches
    // nothing cannot be read as "the plan is empty".
    await expect(page.locator('#durcount')).toContainText('of 6 sends');
  });

  // A max-width on a <td> IS IGNORED by auto table layout - it has to sit on a
  // block inside the cell. Four rules on this table read as deliberate column
  // caps and capped nothing, which is how the ad tables came to paint one
  // column's text over the next one. These two tests fail against that CSS.
  test('the wide columns are capped by a block inside the cell, not by the cell', async ({ page }) => {
    const capped = await page.evaluate(() => {
      const out = {};
      for (const cls of ['cohort', 'obj', 'why', 'chan']) {
        const cw = document.querySelector(`#plantable td.${cls} .cw`);
        out[cls] = cw ? getComputedStyle(cw).maxWidth : null;
      }
      return out;
    });
    for (const [cls, mw] of Object.entries(capped)) {
      expect(mw, `td.${cls} has no inner block carrying the cap`).toBeTruthy();
      expect(mw, `td.${cls} cap is "${mw}"`).not.toBe('none');
    }
  });

  test('a pathological product name never paints over the next column', async ({ page }) => {
    // The real failure mode: a long unbroken token grows its column until the
    // cells overlap. Force one in, then assert geometrically.
    await page.evaluate(() => {
      document.querySelectorAll('#plantable td.obj .cw').forEach((e) => {
        e.textContent = 'Turmeric' + 'Ashwagandha'.repeat(12) + 'Reserve';
      });
      document.querySelectorAll('#plantable td.why .cw').forEach((e) => {
        e.textContent = 'A'.repeat(160);
      });
    });
    const bad = await page.evaluate(() => {
      const out = [];
      for (const tr of document.querySelectorAll('#plantable tbody tr.planrow')) {
        const cells = [...tr.querySelectorAll('td')].map((td) => td.getBoundingClientRect());
        for (let i = 1; i < cells.length; i++) {
          if (cells[i].left < cells[i - 1].right - 1) out.push(`row cell ${i} overlaps ${i - 1}`);
        }
        for (const td of tr.querySelectorAll('td .cw')) {
          if (td.scrollWidth > td.clientWidth + 1) out.push(`content overflows its block by ${td.scrollWidth - td.clientWidth}px`);
        }
      }
      return out;
    });
    expect(bad, bad.join('\n')).toEqual([]);
  });

  test('the analysis column is readable, not decoratively faint', async ({ page }) => {
    // It rendered #a9b8ad on a white card: about 2:1, below AA at any size. A
    // column nobody can read is not a column.
    const { fg, bg } = await page.locator('#plantable td.why .clamp2').first().evaluate((el) => {
      const walkBg = (n) => {
        for (let e = n; e; e = e.parentElement) {
          const c = getComputedStyle(e).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
        }
        return 'rgb(255, 255, 255)';
      };
      return { fg: getComputedStyle(el).color, bg: walkBg(el) };
    });
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
        .map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    expect(ratio, `Why column contrast is ${ratio.toFixed(2)}:1 (${fg} on ${bg})`).toBeGreaterThanOrEqual(4.5);
  });
});

// ── "Last sync" only ever knew about clicks, not about the plan ─────────────
//
// The tile was written in ONE place: inside runSync(). So on a plain page load
// it read "-" forever, and a rolling calendar that had stopped rolling looked
// exactly like one that was up to date. That is how a plan whose newest row was
// ten days old sat on screen unnoticed while the daily cron timed out at the
// 120s function cap and wrote nothing. The age is DERIVED from the rows at
// render time - never a stored "fresh" flag re-asserted as a live claim.
test.describe('the /brain plan says how old it is', () => {
  const stamped = (iso) => PLAN.map((e) => ({ ...e, updated_at: iso }));

  async function openWith(page, entries) {
    await blockExternal(page);
    await page.route((url) => url.pathname.startsWith('/api/'),
      (r) => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
    await page.route((url) => url.pathname.includes('/api/calendar'), (r) => {
      if (!/action=smart-brain-plan/.test(r.request().url())) {
        return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      }
      // No `mode:'db-linked'` on purpose: that flag makes autoGenerateOnLoad
      // kick a sync on load, and the stubbed sync answers {ok:true} with no
      // plan, which blanks the table this test is reading.
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, entries }) });
    });
    await page.goto(`${BASE}/smart-brain.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#plantable tbody tr.planrow').first().waitFor({ timeout: 20000 });
  }

  test('a fresh plan shows its age on load, with no warning', async ({ page }) => {
    await openWith(page, stamped(new Date(Date.now() - 2 * 3600 * 1000).toISOString()));
    const tile = page.locator('#lastsync');
    await expect(tile).not.toHaveText('—');
    await expect(tile).toContainText('h ago');
    await expect(page.locator('#lastsyncnote')).toBeHidden();
  });

  test('a ten-day-old plan says so, in red, and names the loop to check', async ({ page }) => {
    await openWith(page, stamped(new Date(Date.now() - 10 * 86400 * 1000).toISOString()));
    await expect(page.locator('#lastsync')).toContainText('10 days ago');
    const note = page.locator('#lastsyncnote');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Stale');
    // An operator needs the thing to go and look at, not just a red number.
    await expect(note).toContainText('/api/cron/smart-brain');
    const colour = await page.locator('#lastsync').evaluate((el) => getComputedStyle(el).color);
    expect(colour, `stale tile rendered ${colour}`).toMatch(/rgb\(185, 28, 28\)/);
  });

  test('a plan with no timestamps reports "never", not a plausible date', async ({ page }) => {
    await openWith(page, PLAN);   // no updated_at at all
    await expect(page.locator('#lastsync')).toHaveText('never');
    await expect(page.locator('#lastsyncnote')).toContainText('never been written');
  });
});
