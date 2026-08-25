const { test, expect } = require('@playwright/test');
const { startServer, blockExternal } = require('./lib/page-harness.js');

// ONE CALENDAR ON /brain, AND IT IS THE SEND TABLE.
//
// This page has swapped between a send-level TABLE and a day-card LIST twice,
// each side deleting the other and each commit arguing the merge was overdue.
// The product owner's call is the table, and the day list is gone: nine
// identical facts per row - cohort size, the analysis that chose the send,
// confidence, the verdict and four per-send actions - is what a table is for,
// where a card collapses them into a chip and puts the rest behind clicks.
//
// The day-level READ survives because the freshness card is computed from it;
// it simply no longer draws a calendar. What this file pins:
//   1. the table is VISIBLE, not a hidden tbody renderPlan() fills for nobody -
//      which is exactly how it regressed last time;
//   2. every column it promises carries real data, capped by a block INSIDE the
//      cell (a max-width on a <td> is ignored, a defect shipped here twice);
//   3. each row can act on its own send;
//   4. the plan says how old it is.

let server, BASE;
test.beforeAll(async () => { const s = await startServer(); server = s.server; BASE = s.base; });
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });
test.use({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });

/** Two markets a day, same theme — exactly the shape that made every card identical. */
function day(date, bucket, opts = {}) {
  const mk = (market, ready) => ({
    id: `${date}-${market}`, market, status: 'tentative',
    cohort: opts.cohort || 'Lapsed 90d', festival: opts.festival || null,
    hero: opts.hero || 'Turmeric Spiced Herbal Tea', objective: 'winback',
    // Forwarded by daily-calendar-core so the day surface can carry what the
    // retired "Rolling calendar" table used to show.
    why: 'Chosen to drive reactivation for Lapsed 90d with ' + (opts.hero || 'Turmeric Spiced Herbal Tea') + '.',
    confidence: 0.7, confidence_label: 'moderate',
    channels: ['mailer', 'meta', 'landing_page'],
    assets: ready ? { mailer: true, meta: true, landing_page: true } : null,
    assets_missing: ready ? [] : ['mailer', 'meta', 'landing_page'],
    assets_ready: ready,
  });
  const slots = [mk('US', opts.usReady !== false), mk('UK', !!opts.ukReady)];
  return {
    date, bucket, weekday: 'Mon', slots,
    counts: {
      planned: slots.length, approved: 0, tentative: 2, rejected: 0, archived: 0,
      assets_ready: slots.filter((s) => s.assets_ready).length,
      assets_missing: slots.filter((s) => !s.assets_ready).length,
    },
    measured: bucket === 'past' ? { orders: 12, revenue: 4200, basis: 'shopify' } : null,
    blockers: [],
  };
}

async function openCalendar(page) {
  await blockExternal(page);
  // Playwright matches routes in REVERSE registration order, so the catch-all
  // must be registered FIRST or it shadows the specific handler. Getting this
  // backwards served {ok:true} with no days to the calendar, which rendered
  // "No days returned." — a stubbing mistake that looks exactly like a broken
  // page. Match on the parsed URL rather than a glob over a query string.
  await page.route((url) => url.pathname.startsWith('/api/'),
    (r) => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await page.route((url) => url.pathname.includes('/api/brain'), (r) => {
    if (!/action=daily-calendar/.test(r.request().url())) {
      return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    }
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        days: [
          day('2026-10-05', 'future', { festival: 'Diwali Gifting' }),
          day('2026-10-06', 'future', { hero: 'Himalayan Green Tea' }),
          day('2026-10-07', 'future', { hero: 'Earl Grey Masala Chai', usReady: false, ukReady: true }),
        ],
        totals: { planned: 6, assets_ready: 3 },
      }),
    });
  });
  // The day grid and the review controls read DIFFERENT endpoints: the grid comes
  // from ?action=daily-calendar, the verdict buttons resolve each slot back to an
  // entry in PLAN, which comes from ?action=smart-brain-plan. Stubbing only the
  // first leaves PLAN empty, and the panel then correctly says the send is "not
  // in the plan currently loaded" rather than offering buttons that would act on
  // the wrong row. The ids must MATCH the day fixture's slot ids.
  await page.route((url) => url.pathname.includes('/api/calendar'), (r) => {
    if (!/action=smart-brain-plan/.test(r.request().url())) return r.fallback();
    const entries = [];
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) {
      for (const mk of ['US', 'UK']) {
        entries.push({
          id: `${d}-${mk}`, date: d, market: mk, status: 'tentative',
          cohort: { name: 'Lapsed 90d', size: 12400 }, objective: 'winback',
          heroProduct: { title: 'Turmeric Spiced Herbal Tea' },
          channels: ['email', 'meta'], confidence: 0.7,
          // The table's Why column reads analysis.summary || rationale. Omitting
          // both rendered an empty column that looked like a broken cell.
          rationale: 'Chosen to drive reactivation for Lapsed 90d with a caffeine-free evening ritual.',
          analysis: { summary: 'Chosen to drive reactivation for Lapsed 90d with a caffeine-free evening ritual.', confidence: { label: 'moderate', factors: [{ delta: 12, label: 'cohort responds to winback' }] } },
        });
      }
    }
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, entries }) });
  });
  await page.goto(`${BASE}/smart-brain.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#plantable tbody tr.planrow').first().waitFor({ timeout: 20000 });
  // WAIT FOR THE REVEAL TRANSFORM TO CLEAR BEFORE MEASURING ANY GEOMETRY.
  //
  // This is the same defect I diagnosed on the ads table earlier and then failed
  // to guard here. motion.css reveals panels with a small ROTATION, and
  // getBoundingClientRect returns the AXIS-ALIGNED bounding box of a rotated
  // element. The AABB of a rotated box is larger than the box, and the error
  // grows with distance from the transform origin - so far down a long list,
  // stacked rows' AABBs overlap:
  //
  //   expected >= 1393.43  (previous row's bottom - 1)
  //   received    1389.93  (this row's top)      -> ~4.5px overlap at y≈1390
  //
  // which reads exactly like "a row is beside another instead of below it".
  // reducedMotion:'reduce' above is necessary but not sufficient: motion.css
  // only forces transform:none on .vh-rv and .vh-kin .vh-w, so anything outside
  // those selectors can still be mid-animation. Asserting the absence of a
  // transform is the robust form, and it explains why the failing PROJECT SET
  // shifted between runs (iphone-12+ipad, then iphone-se+iphone-12) - it is a
  // race, not a per-device layout difference.
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

test.describe('the /brain rolling calendar', () => {
  test.beforeEach(async ({ page }) => { await openCalendar(page); });

  test('the table is the ONE calendar, and it is actually visible', async ({ page }) => {
    await expect(page.locator('#plantable'), 'the send-level table is missing again').toHaveCount(1);
    await expect(page.getByRole('heading', { name: /Rolling calendar/i })).toHaveCount(1);
    // The day-card list is gone, and so is its per-day slot panel. Asserting
    // their ABSENCE is what stops the third flip-flop reintroducing a second
    // calendar of the same 90 days.
    await expect(page.locator('.callist .cday'), 'the day-card calendar is back').toHaveCount(0);
    await expect(page.locator('#calbody'), '#calbody is back').toHaveCount(0);
    await expect(page.locator('#dayslots'), '#dayslots is back').toHaveCount(0);

    // The table must be VISIBLE, not a hidden tbody that renderPlan() fills for
    // nobody - which is exactly how it regressed last time.
    await expect(page.locator('#plantable')).toBeVisible();
    await expect(page.locator('#plantable tbody tr.planrow').first()).toBeVisible();

    // The filters and bulk actions had to MOVE onto the table's card, not be
    // deleted with the view they used to sit on: they act on PLAN + slotVisible,
    // so deleting the card without relocating them would have silently removed
    // working features rather than a duplicate view.
    const card = page.locator('#daycal');
    for (const id of ['#downloadAll', '#mktfilter', '#durfilter', '#catfilter', '#plantable']) {
      await expect(card.locator(id), `${id} is not on the calendar card`).toHaveCount(1);
    }
  });

  test('the freshness card still has its read, which the day view used to own', async ({ page }) => {
    // loadDayCalendar is kept for ONE reason: renderFreshness is computed from
    // it. Removing the grid must not have taken the ages with it.
    const cells = page.locator('#freshcells .fcell');
    await expect(cells.first()).toBeVisible();
    await expect(page.locator('#freshcells')).not.toContainText('Checking…');
  });

  test('every column the row promises is actually there', async ({ page }) => {
    const heads = await page.locator('#plantable thead th').allTextContents();
    expect(heads.map((h) => h.trim().toLowerCase())).toEqual([
      'date', 'market', 'cohort', 'objective · hero', 'why (analysis)', 'channels', 'conf.', 'status', 'actions',
    ]);
    const row = page.locator('#plantable tbody tr.planrow').first();
    await expect(row.locator('td.cohort')).toContainText('Lapsed 90d');
    await expect(row.locator('td.obj')).toContainText('winback');
    await expect(row.locator('td.why')).not.toBeEmpty();
    await expect(row.locator('td.chan')).toContainText('email');
    await expect(row.locator('td.conf')).toContainText('%');
  });

  test('each row acts on its own send', async ({ page }) => {
    // The verdict controls and the four per-send actions are the reason this is a
    // table: they were being rendered into a hidden node the whole time it was
    // "merged away".
    const row = page.locator('#plantable tbody tr.planrow').first();
    for (const label of [/^View$/, /Recreate/, /Download/, /Why this mail\?/]) {
      await expect(row.getByRole('button', { name: label }), `${label} is missing from the row`).toHaveCount(1);
    }
    await expect(row.getByRole('button', { name: /Approve/ })).toHaveCount(1);
    await expect(row.getByRole('button', { name: /Reject/ })).toHaveCount(1);
    await expect(row.locator('.st')).toContainText(/draft|approved|rejected/);
  });

  test('the wide columns are capped by a block inside the cell, not by the cell', async ({ page }) => {
    // A max-width on a <td> is IGNORED by auto table layout. This page shipped
    // the ignored form twice; the cap has to sit on a block INSIDE the cell.
    const row = page.locator('#plantable tbody tr.planrow').first();
    for (const col of ['cohort', 'obj', 'why', 'chan']) {
      const cw = row.locator(`td.${col} .cw`);
      await expect(cw, `td.${col} has no .cw inner block, so its cap does nothing`).toHaveCount(1);
      const capped = await cw.evaluate((el) => getComputedStyle(el).maxWidth);
      expect(capped, `td.${col} .cw has no max-width`).toMatch(/px$/);
    }
  });

  test('a pathological product name never paints over the next column', async ({ page }) => {
    // Wrapped text cannot exceed its box on any engine; overflow-wrap:anywhere
    // covers a single unbroken token. Measured, not asserted from CSS.
    const boxes = await page.locator('#plantable tbody tr.planrow').first().locator('td').evaluateAll(
      (tds) => tds.map((td) => { const r = td.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; }));
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].l, `cell ${i} starts before cell ${i - 1} ends (columns overlap)`).toBeGreaterThanOrEqual(boxes[i - 1].r - 1);
      expect(boxes[i].w, `cell ${i} collapsed to ${boxes[i].w}px`).toBeGreaterThan(8);
    }
  });

  test('the analysis column is readable, not decoratively faint', async ({ page }) => {
    // It rendered #a9b8ad on a light card: about 2:1, below AA at any size. A
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
//
// NOTE: these stub BOTH endpoints the page reads. The plan (which carries the
// timestamps this tile is computed from) comes from ?action=smart-brain-plan;
// ?action=daily-calendar is still read for the freshness card above the table.
// Stubbing only one leaves the other empty and the tile then correctly reads
// "never" - a green-looking test measuring nothing.
test.describe('the /brain plan says how old it is', () => {
  const DATES = ['2026-10-05', '2026-10-06', '2026-10-07'];

  function planEntries(stamp) {
    const entries = [];
    for (const d of DATES) {
      for (const mk of ['US', 'UK']) {
        entries.push({
          id: `${d}-${mk}`, date: d, market: mk, status: 'tentative',
          cohort: { name: 'Lapsed 90d', size: 12400 }, objective: 'winback',
          heroProduct: { title: 'Turmeric Spiced Herbal Tea' },
          channels: ['email', 'meta'], confidence: 0.7,
          ...(stamp ? { updated_at: stamp } : {}),
        });
      }
    }
    return entries;
  }

  async function openWith(page, stamp) {
    await blockExternal(page);
    await page.route((url) => url.pathname.startsWith('/api/'),
      (r) => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
    await page.route((url) => url.pathname.includes('/api/brain'), (r) => {
      if (!/action=daily-calendar/.test(r.request().url())) {
        return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      }
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          days: DATES.map((d) => day(d, 'future')),
          totals: { planned: 6, assets_ready: 3 },
        }),
      });
    });
    await page.route((url) => url.pathname.includes('/api/calendar'), (r) => {
      if (!/action=smart-brain-plan/.test(r.request().url())) return r.fallback();
      // No `mode:'db-linked'` on purpose: that flag makes autoGenerateOnLoad kick
      // a sync on load, and the stubbed sync answers {ok:true} with no plan,
      // which wipes the timestamps this test is reading.
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, entries: planEntries(stamp) }) });
    });
    await page.goto(`${BASE}/smart-brain.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#plantable tbody tr.planrow').first().waitFor({ timeout: 20000 });
  }

  test('a fresh plan shows its age on load, with no warning', async ({ page }) => {
    await openWith(page, new Date(Date.now() - 2 * 3600 * 1000).toISOString());
    const tile = page.locator('#lastsync');
    await expect(tile).not.toHaveText('—');
    await expect(tile).toContainText('h ago');
    await expect(page.locator('#lastsyncnote')).toBeHidden();
  });

  test('a ten-day-old plan says so, in red, and names the loop to check', async ({ page }) => {
    await openWith(page, new Date(Date.now() - 10 * 86400 * 1000).toISOString());
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
    await openWith(page, null);
    await expect(page.locator('#lastsync')).toHaveText('never');
    await expect(page.locator('#lastsyncnote')).toContainText('never been written');
  });
});

// ── A button that does nothing is worse than no button ──────────────────────
// "View Full Tear-downs →" on /landing-pages carried no onclick, no id, no data
// attribute and no delegated handler: clicking it did literally nothing. Scanned
// across all 818 buttons on the top-level pages, it was the only genuinely
// unwired one in the app - the presell/landing DELIVERABLES have carousel arrows
// wired by class, and lifecycle-calendar's "UK" chip is deliberately `disabled`
// with a title saying the program is UK-only. So this guard is narrow on purpose:
// it pins the one page that had the defect rather than pretending to police a
// class it would report falsely on.
test.describe('no dead control on the landing-pages surface', () => {
  const LP = require('fs').readFileSync(require('path').join(__dirname, '..', 'landing-pages.html'), 'utf8');

  test('every button is wired to something', () => {
    const dead = [];
    for (const m of LP.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      const tag = m[0].slice(0, m[0].indexOf('>') + 1);
      // A valueless data-* attribute counts as wired: this page delegates on
      // data-pm-download, data-ai-fill and friends, so requiring `data-x=` would
      // report five working buttons as dead.
      if (/onclick=|\bid=|\bdata-[a-z-]+|type=["']submit|\bdisabled\b/.test(tag)) continue;
      dead.push(m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 40));
    }
    expect(dead, `unwired button(s) on landing-pages.html: ${dead.join(' | ')}`).toEqual([]);
  });

  test('the tear-down promise leads somewhere real, and says what it is', () => {
    // It must not simply have been deleted: the click had a purpose, and the
    // repo does have a competitor intelligence surface to serve it.
    expect(LP).toContain('href="/competitor"');
    expect(LP).toMatch(/Open Competitor Benchmarking/);
    expect(LP, 'the old dead button is back').not.toMatch(/<button[^>]*>View Full Tear-downs/);
    // And the four named brands are labelled for what they are, like the card
    // beside them already labels its own patterns.
    expect(LP).toMatch(/Illustrative examples - not tracked VAHDAM competitor accounts/);
  });
});
