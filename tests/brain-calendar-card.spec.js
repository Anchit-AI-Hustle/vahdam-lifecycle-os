const { test, expect } = require('@playwright/test');
const { startServer, blockExternal } = require('./lib/page-harness.js');

// THE DAY CARD SPENT ITS HEADLINE ON A CONSTANT.
//
// /brain renders a 90-day grid. The plan is one slot per market per day, so
// every card read "2 planned · 1 ready" — the same six words on ninety cards.
// The fields that actually differ between days (festival, hero product, cohort,
// objective) are all present on the slot and none of them was rendered.
//
// The second defect is not cosmetic. `assets_ready` is derived from
// builtChannels(): every planned channel has an ARTIFACT. That stays true for a
// campaign generated weeks ago against a catalog that has since gone stale, or
// that the live catalog gate is now blocking outright (production currently
// reports creative_blocked: true). Printing file-existence as "ready" where a
// reader scans for "cleared to send" is the same class of defect as the run
// that called itself final while its gate had failed.

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
  await page.goto(`${BASE}/smart-brain.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('.callist .cday').first().waitFor({ timeout: 20000 });
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
    const el = document.querySelector('.callist .cday');
    if (!el) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const tf = getComputedStyle(e).transform;
      if (tf !== 'none' && tf !== 'matrix(1, 0, 0, 1, 0, 0)') return false;
    }
    return true;
  }, null, { timeout: 20000 });
}

test.describe('the /brain day card', () => {
  test.beforeEach(async ({ page }) => { await openCalendar(page); });

  test('leads with what the day sends, not with a constant', async ({ page }) => {
    const themes = await page.locator('.callist .cday .ct').allTextContents();
    expect(themes.length, 'no theme line rendered on any card').toBeGreaterThan(0);
    // The whole point: cards must differ from one another.
    expect(new Set(themes).size, `every card shows the same thing: ${themes.join(' | ')}`).toBeGreaterThan(1);
    expect(themes.join(' ')).toContain('Diwali Gifting');
  });

  test('never calls an artifact that exists "ready"', async ({ page }) => {
    // "ready" is a promise about sendability the data cannot support; "built" is
    // what builtChannels() actually measured.
    const text = await page.locator('.callist').innerText();
    expect(text).not.toMatch(/\bready\b/i);
    expect(text).toMatch(/\d\/\d built/);
  });

  test('the readiness fraction shows its denominator', async ({ page }) => {
    // "0 ready" cannot be told apart from a day that plans nothing; "0/2 built" can.
    // Day 3 is deliberately MIXED (US unbuilt, UK built) so the fraction has to
    // be computed rather than echoing a constant. It belongs on the DAY, not on
    // a campaign row: a fraction over that day's sends is the one number here
    // that is about the day rather than about any single send.
    const group = page.locator('.callist .cdaygrp').nth(2);
    await expect(group.locator('.cdayhd .cs')).toHaveText('1/2 built');
  });

  test('the colour code is explained on the page', async ({ page }) => {
    const legend = page.locator('#callegend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('one row per campaign', { ignoreCase: true });
    await expect(legend).toContainText('not that they passed the live catalog gate', { ignoreCase: true });
  });

  // ONE ROW PER CAMPAIGN, NOT ONE ROW PER DAY.
  //
  // Collapsing a day's sends into market chips on a single row left a campaign
  // with no line of its own: its cohort and objective existed only in a tooltip
  // and in the panel behind a click, and two sends on one day shared a headline
  // built by joining their themes with a middot. The day stays the grouping.
  test('every campaign gets its own row, carrying its own cohort and objective', async ({ page }) => {
    // The fixture is 3 days x 2 markets. One row per DAY would render 3.
    await expect(page.locator('.callist .cday')).toHaveCount(6);
    await expect(page.locator('.callist .cdaygrp')).toHaveCount(3);

    // Each row names one market, and its own audience — not the day's.
    const rows = page.locator('.callist .cdaygrp').nth(2).locator('.cday');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.bar b')).toHaveText('US');
    await expect(rows.nth(1).locator('.bar b')).toHaveText('UK');
    for (const i of [0, 1]) {
      await expect(rows.nth(i).locator('.who'),
        'cohort and objective are still only reachable by opening the day').toContainText('Lapsed 90d');
      await expect(rows.nth(i).locator('.who')).toContainText('winback');
    }
  });

  test('each row states its own build state and says why it is that colour', async ({ page }) => {
    const rows = page.locator('.callist .cdaygrp').nth(2).locator('.cday');
    await expect(rows.nth(0).locator('.bar b')).toHaveAttribute('title', /US — not built yet/);
    await expect(rows.nth(1).locator('.bar b')).toHaveAttribute('title', /UK — all channels built/);
    // And it is on the row as TEXT, not only in a tooltip — a title attribute is
    // not readable by someone scanning the list, which is the whole job here.
    await expect(rows.nth(0).locator('.cs')).toHaveText('not built yet');
    await expect(rows.nth(1).locator('.cs')).toHaveText('all channels built');
  });

  test('clicking a campaign row marks THAT send in the day panel', async ({ page }) => {
    // Two rows open the same day panel. Without this the panel gave no sign of
    // which of the two the reader had asked about.
    await page.locator('.callist .cdaygrp').nth(2).locator('.cday').nth(1).click();
    const selected = page.locator('#dayslots .dslot.sel');
    await expect(selected, 'the panel does not mark the send that was clicked').toHaveCount(1);
    await expect(selected).toContainText('UK');
  });

  test('one campaign per row, and a long product name is not truncated', async ({ page }) => {
    // The reason for the single column. In the 7-across grid each day got about
    // 130px, so "Turmeric Ashwagandha Herbal Tea" rendered as
    // "Turmeric Ashwagandh..." — and so did most other days, which is the state
    // the screenshot showed. scrollWidth > clientWidth is exactly the ellipsis.
    const rows = page.locator('.callist .cday');
    // Collect enough to DIAGNOSE a failure from the CI log alone. The bare
    // "expected >= 1393.43, received 1389.93" that this used to print says a
    // row overlaps and nothing about which rows, how tall they are, or whether
    // they are even siblings - and the screenshot/trace live in a CI artifact
    // on a host this project's sandbox cannot reach. A geometry assertion
    // should carry its own evidence.
    const geo = await rows.evaluateAll((els) => els.map((e, i) => {
      const r = e.getBoundingClientRect();
      const p = e.parentElement;
      return {
        i, cls: e.className,
        x: +r.x.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2),
        h: +r.height.toFixed(2), offsetH: e.offsetHeight, scrollH: e.scrollHeight,
        parent: p ? (p.className || p.tagName) : null,
        parentDisplay: p ? getComputedStyle(p).display : null,
        parentGap: p ? getComputedStyle(p).rowGap : null,
      };
    }));
    const table = () => geo.map((g) =>
      `  [${g.i}] x=${g.x} top=${g.top} bottom=${g.bottom} h=${g.h} (offset ${g.offsetH}, scroll ${g.scrollH}) ` +
      `parent=${g.parent} display=${g.parentDisplay} gap=${g.parentGap} cls="${g.cls}"`).join('\n');

    const boxes = geo;
    expect(boxes.length, `only ${boxes.length} row(s) rendered:\n${table()}`).toBeGreaterThan(1);
    // One per row: every row starts at the same x and each sits below the last.
    const xs = new Set(boxes.map((b) => Math.round(b.x)));
    expect(xs.size, `rows are not in a single column (${xs.size} distinct x):\n${table()}`).toBe(1);
    for(let i = 1; i < boxes.length; i++){
      expect(boxes[i].top,
        `row ${i} overlaps row ${i - 1} by ${(boxes[i-1].bottom - boxes[i].top).toFixed(2)}px.\n` +
        `In a flex column with a fixed gap this is not possible for siblings, so check whether these ` +
        `two rows share a parent and whether either box is taller than its layout slot:\n${table()}`
      ).toBeGreaterThanOrEqual(boxes[i-1].bottom - 1);
    }
    // Assert the ROOM the column change delivers, as a FRACTION of the list.
    //
    // Two earlier versions of this got it wrong, both by measuring something
    // that is not the claim:
    //   1. "no theme is ever ellipsised" - failed on all three WebKit projects,
    //      because the same string measures wider there. That tested font
    //      metrics, not layout.
    //   2. "every theme is at least 260px" - still failed on iphone-12 and
    //      ipad. Those projects emulate a mobile device, where the layout width
    //      is driven by the page's own viewport meta rather than by the
    //      configured viewport, so an ABSOLUTE pixel floor is not a property
    //      the layout controls.
    // What the column change actually guarantees is a SHARE: the theme gets
    // most of the row instead of one seventh of the grid. In the 7-across grid
    // a day was ~1/7 of the container, so the theme measured ~13% of the list;
    // in a single column it is the 1fr of `52px 1fr 200px 128px`. A fraction is
    // both font-independent and viewport-independent.
    const share = await page.evaluate(() => {
      const list = document.querySelector('.callist').getBoundingClientRect().width;
      return [...document.querySelectorAll('.callist .cday .ct')]
        .map((e) => e.getBoundingClientRect().width / list);
    });
    expect(share.length).toBeGreaterThan(1);
    expect(Math.min(...share), `the theme column is still cramped: ${share.map((x) => Math.round(x * 100) + '%').join(', ')}`)
      .toBeGreaterThan(0.35);
  });

  // The assertion above only says the text HAPPENED to fit in the browser and
  // viewport that ran it. That is why this sat red on main: it passed on every
  // Chromium project and failed on all three WebKit ones, so it could not be
  // reproduced by anyone whose machine cannot launch WebKit - which includes
  // the sandbox this repo is usually developed in.
  //
  // These two tests pin the STRUCTURAL property instead, and both FAIL on
  // Chromium against the old nowrap + text-overflow:ellipsis rule. That is the
  // point: the defect is now reproducible on the engine you have, rather than
  // only on the one CI has. Wrapped text cannot exceed its box because line
  // breaking is CSS semantics, not a measurement that happens to come out
  // favourably.
  test('the headline is built to wrap, so no engine can truncate it', async ({ page }) => {
    const css = await page.locator('.callist .cday .ct').first().evaluate((el) => {
      const c = getComputedStyle(el);
      return { whiteSpace: c.whiteSpace, overflowWrap: c.overflowWrap, textOverflow: c.textOverflow, overflow: c.overflow };
    });
    expect(css.whiteSpace, 'nowrap means the text truncates as soon as it is too wide').not.toBe('nowrap');
    // A single unbroken token longer than the column is the one case wrapping
    // alone cannot solve.
    expect(['anywhere', 'break-word'], `overflow-wrap is ${css.overflowWrap}`).toContain(css.overflowWrap);
    expect(css.textOverflow, 'text-overflow:ellipsis is the truncation this test forbids').not.toBe('ellipsis');
  });

  test('a pathological product name still does not overflow, at the narrowest width', async ({ page }) => {
    // If a 200-char string and an unbroken 120-char token both fit at 320px -
    // narrower than any project here - then a few percent of extra glyph width
    // on another engine cannot make them overflow. That is what turns "it fits
    // in this browser" into "it cannot overflow in any browser".
    await page.setViewportSize({ width: 320, height: 900 });
    const overflowing = await page.locator('.callist .cday .ct').evaluateAll((els) => {
      const long = 'Turmeric Ashwagandha Herbal Tea with Cardamom and Black Pepper Single Estate Reserve Harvest Limited Batch Blend for the Morning Ritual, Second Flush, High Altitude Darjeeling Garden Selection';
      const unbroken = 'A'.repeat(120);
      const out = [];
      els.forEach((e, i) => {
        e.textContent = i % 2 ? long : unbroken;
        if (e.scrollWidth > e.clientWidth + 1) out.push(e.textContent.slice(0, 30));
      });
      return out;
    });
    expect(overflowing, `text overflowed its box even with wrapping on: ${overflowing.join(' | ')}`).toEqual([]);
  });

  test('a day opens the assets that were built for it', async ({ page }) => {
    // The panel used to list a campaign id, an image COUNT and a landing link,
    // and nothing else: no mailer, no ads, no way to look at anything. The
    // viewer already existed for the entry list further down the page, so the
    // capability was present and simply had no entrance from the calendar.
    await page.route((url) => url.pathname.includes('/api/calendar') || url.pathname.includes('/api/brain'), async (r) => {
      const u = r.request().url();
      if (/smart-brain-preview/.test(u)) {
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({
          ok: true, persisted: true,
          email_html: '<html><body><h1>Steep the evening slowly</h1></body></html>',
          landing_html: '<html><body><h1>Landing</h1></body></html>',
          ads: [], copywriter: { provider: 'anthropic' }, campaign: { campaign_id: 'camp-1' },
        }) });
      }
      return r.fallback();
    });
    await page.locator('.callist .cday').nth(1).click();
    // Locate the button STRUCTURALLY, not by its text: the text is what the
    // click changes, so a hasText locator stops matching the moment it works.
    const slotBtn = page.locator('#dayslots .dslot button').first();
    await expect(slotBtn, 'the day panel offers no way to see an asset').toBeVisible();
    await expect(slotBtn).toHaveText('View assets');
    await slotBtn.click();
    // The mailer must actually render, not just a spinner or an id.
    const frame = page.locator('#dayslots .slotpv iframe.pvframe').first();
    await expect(frame).toBeVisible({ timeout: 20000 });
    await expect(slotBtn).toHaveText('Hide assets');
  });

  test('the day surface is the ONLY calendar, and carries what the retired table carried', async ({ page }) => {
    // /brain used to show TWO calendars of the same 90 days: this day-level list
    // and a "Rolling calendar (next 90 days)" table, one row per entry. Two
    // calendars of one dataset is the duplication that made the page hard to use.
    await expect(page.locator('#plantable'), 'the duplicate Rolling calendar table is still rendered').toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Rolling calendar/i })).toHaveCount(0);

    // Its bulk actions and filters had to MOVE, not be deleted: they act on
    // PLAN + slotVisible, which is independent of the table's DOM, so deleting
    // the card without relocating them would have silently removed working
    // features rather than a duplicate view.
    const card = page.locator('#daycal');
    for (const id of ['#downloadAll', '#mktfilter', '#durfilter', '#catfilter']) {
      await expect(card.locator(id), `${id} did not move into the day card`).toHaveCount(1);
    }
    // #plan is kept as a hidden tbody because renderPlan() is still the single
    // place that computes the visible counts and button state.
    await expect(page.locator('#plan')).toHaveCount(1);

    // And the two columns only the table had now render in the per-send detail.
    await page.locator('.callist .cday').nth(1).click();
    const panel = page.locator('#dayslots');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Why:');
    await expect(panel).toContainText('Confidence:');
    await expect(panel).toContainText('moderate');
  });
});
