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
    // Card 3 is deliberately MIXED (US unbuilt, UK built) so the fraction has to
    // be computed rather than echoing a constant.
    const card = page.locator('.callist .cday').nth(2);
    await expect(card.locator('.cs')).toHaveText('1/2 built');
  });

  test('the colour code is explained on the page', async ({ page }) => {
    const legend = page.locator('#callegend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('one chip per send', { ignoreCase: true });
    await expect(legend).toContainText('not that they passed the live catalog gate', { ignoreCase: true });
  });

  test('each chip names its market and says why it is that colour', async ({ page }) => {
    const bars = page.locator('.callist .cday').nth(2).locator('.bar b');
    await expect(bars).toHaveCount(2);
    await expect(bars.nth(0)).toHaveAttribute('title', /US — not built yet/);
    await expect(bars.nth(1)).toHaveAttribute('title', /UK — all channels built/);
    // The chip NAMES its market, so "1/2 built" no longer leaves the reader
    // guessing which of the two is the missing one.
    await expect(bars.nth(0)).toHaveText('US');
    await expect(bars.nth(1)).toHaveText('UK');
  });

  test('one day per row, and a long product name is not truncated', async ({ page }) => {
    // The reason for the single column. In the 7-across grid each day got about
    // 130px, so "Turmeric Ashwagandha Herbal Tea" rendered as
    // "Turmeric Ashwagandh..." — and so did most other days, which is the state
    // the screenshot showed. scrollWidth > clientWidth is exactly the ellipsis.
    const rows = page.locator('.callist .cday');
    const boxes = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    expect(boxes.length).toBeGreaterThan(1);
    // One per row: every row starts at the same x and each sits below the last.
    const xs = new Set(boxes.map((b) => Math.round(b.x)));
    expect(xs.size, 'rows are not in a single column').toBe(1);
    for(let i = 1; i < boxes.length; i++){
      expect(boxes[i].top, 'a row is beside another instead of below it').toBeGreaterThanOrEqual(boxes[i-1].bottom - 1);
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
    // in a single column it is the 1fr of `64px 1fr 104px auto`. A fraction is
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
});
