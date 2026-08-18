const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

// The static assertions in funnel-drill.spec.js prove the graph is coherent and
// the call sites are wired. They cannot prove a row actually clicks — which is
// the entire feature. This drives the real page in a real browser.
//
// The page loads its data and this module with ABSOLUTE paths, so file:// cannot
// serve it: `/data/analytics/market-data.js` resolves to the filesystem root and
// the grid never renders. A throwaway static server over the repo root is what
// makes the page behave the way it does in production.

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };

let server; let origin;

// A stub of the shape api/_shared/revenue-analysis-core.js returns, cut down to
// the three paid-media cuts. Row FIELDS matter and are copied from that module:
// the drill joins on `platform`, `campaign` and `adset`, so a stub that renamed
// them would pass while the real payload failed.
const REVENUE_STUB = {
  ok: true, market: 'US', currency: 'USD',
  summary: { orders: 20620, total_sales: 1120765.35, net_sales: 1030000, aov: 54.3, window: '2026 YTD' },
  summary_source: 'Shopify CSV export', coverage: { total_cuts: 3, available: 3 },
  excluded_sources: [], note: 'Every revenue cut is listed whether or not it has data.',
  cuts: [
    { key: 'platform', label: 'Revenue by platform', grain: 'platform', available: true, source: 'stub', rows: [
      { platform: 'meta', level: 'account', entity: 'Meta US', spend: 1000, revenue: 4000, roas: 4 },
      { platform: 'google', level: 'account', entity: 'Google US', spend: 500, revenue: 1500, roas: 3 },
    ] },
    { key: 'campaign', label: 'Revenue by campaign', grain: 'campaign', available: true, source: 'stub', rows: [
      { platform: 'meta', campaign: 'Coffee_Prospecting', entity: 'Coffee_Prospecting', spend: 600, revenue: 2600, roas: 4.33 },
      { platform: 'meta', campaign: 'Chai_Retargeting', entity: 'Chai_Retargeting', spend: 400, revenue: 1400, roas: 3.5 },
      { platform: 'google', campaign: 'Brand_Search', entity: 'Brand_Search', spend: 500, revenue: 1500, roas: 3 },
    ] },
    { key: 'adset', label: 'Revenue by ad set / ad group', grain: 'adset', available: true, source: 'stub', rows: [
      { platform: 'meta', campaign: 'Coffee_Prospecting', adset: 'Broad_25_44', entity: 'Broad_25_44', spend: 350, revenue: 1500 },
      { platform: 'meta', campaign: 'Chai_Retargeting', adset: 'Cart_7d', entity: 'Cart_7d', spend: 400, revenue: 1400 },
    ] },
  ],
};

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    // The API is stubbed BEFORE the static lookup: api/public-config.js is a real
    // file on disk, so falling through would serve the serverless source as the
    // response body.
    if (rel.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(/view=revenue/.test(req.url) ? REVENUE_STUB : { ok: true }));
      return;
    }
    const file = path.join(ROOT, rel);
    // Never serve outside the repo, however the URL is spelled.
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"ok":false}');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

// One viewport is enough: this is behaviour, not layout, and the same assertions
// six times over only slow the suite down.
test.describe('Data Analysis rows actually click', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'behaviour test, one engine');

  // Widgets are routed to tabs (TAB_MAP in the page), so the card only exists
  // once its tab is active.
  const TAB = { channels: 'acq', dow: 'control' };

  async function openDetail(page, widget) {
    await page.goto(origin + '/data-analysis.html');
    await page.waitForFunction(() => !!document.querySelector('.w.link'));
    await page.evaluate((t) => {
      const b = document.querySelector('#anTabs button[data-tab="' + t + '"]');
      if (b) b.click();
    }, TAB[widget]);
    await page.waitForFunction((id) => !!document.querySelector('.w.link[data-wid="' + id + '"]'), widget);
    await page.evaluate((id) => document.querySelector('.w.link[data-wid="' + id + '"]').click(), widget);
    await page.waitForSelector('#detail .tbl-wrap table tr td');
  }

  test('the module loads and exposes the shared graph', async ({ page }) => {
    await page.goto(origin + '/data-analysis.html');
    await expect.poll(() => page.evaluate(() => !!window.FunnelDrill)).toBe(true);
    const stages = await page.evaluate(() => Object.keys(window.FunnelDrill.STAGES).length);
    expect(stages).toBeGreaterThan(10);
  });

  test('every row of the sales-channel table gets a next-step control', async ({ page }) => {
    await openDetail(page, 'channels');
    const counts = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#detail .tbl-wrap table tr')].filter((r) => r.querySelector('td'));
      return { rows: rows.length, wired: rows.filter((r) => r.classList.contains('fd-row')).length, buttons: document.querySelectorAll('#detail .fd-go').length };
    });
    expect(counts.rows).toBeGreaterThan(3);
    expect(counts.wired, 'every data row must be clickable').toBe(counts.rows);
    expect(counts.buttons).toBe(counts.rows);
  });

  test('the next-step control names where it goes, and names the missing join', async ({ page }) => {
    await openDetail(page, 'channels');
    const label = await page.getAttribute('#detail .fd-go', 'aria-label');
    // channel -> platform has no join key in the connected sources, and the
    // control has to say so before it is pressed, not after.
    expect(label).toContain('Ad platform');
    expect(label).toContain('not narrowed');
  });

  test('clicking a row drills to the next step, and a link inside one is not hijacked', async ({ page }) => {
    await openDetail(page, 'channels');
    // /analytics used to be a 5KB shell that iframed this page, so
    // data-analysis-extensions.js — and with it the Revenue Analysis tab —
    // was absent from this view and a row had nowhere to drill to. Now the
    // page IS the document, the extensions load with it, and the drill target
    // genuinely exists. So the row drills, which is the whole point of the
    // feature; the record view below is the fallback, not the normal path.
    await page.click('#detail .tbl-wrap table tr:has(td)');
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('detailing'))).toBe(false);
    await expect(page.locator('#anTabs button.on')).toHaveText(/Revenue Analysis/);
  });

  test('with no drill target the row still opens its own record, never a dead click', async ({ page }) => {
    // Reproduce the no-target condition on purpose rather than relying on a
    // page shape that no longer occurs. wireDetailDrill reads the handoff at
    // the moment the detail opens, so it has to be removed after the page has
    // booted but before the widget is opened — a plain openDetail() would
    // navigate and let the extensions re-install it.
    await page.goto(origin + '/data-analysis.html');
    await page.waitForFunction(() => !!document.querySelector('.w.link'));
    await page.evaluate(() => {
      const t = document.querySelector('#anTabs button[data-tab="acq"]');
      if (t) t.click();
    });
    await page.waitForFunction(() => !!document.querySelector('.w.link[data-wid="channels"]'));
    await page.evaluate(() => { delete window.__lcFunnelToRevenue; });
    await page.evaluate(() => document.querySelector('.w.link[data-wid="channels"]').click());
    await page.waitForSelector('#detail .tbl-wrap table tr td');
    await page.click('#detail .tbl-wrap table tr:has(td)');
    await expect(page.locator('.fd-modal')).toBeVisible();
    await expect(page.locator('.fd-sheet')).toContainText('Online Store');
    await page.click('.fd-close');
    await expect(page.locator('.fd-modal')).toHaveCount(0);
  });

  test('a terminal dimension says why it stops rather than pretending to drill', async ({ page }) => {
    await openDetail(page, 'dow');
    await page.click('#detail .fd-go');
    await expect(page.locator('.fd-sheet')).toContainText('No next step in the funnel');
    await expect(page.locator('.fd-sheet')).toContainText('send-timing signal');
  });

  test('the appended action column is announced, not a phantom', async ({ page }) => {
    await openDetail(page, 'channels');
    const shape = await page.evaluate(() => {
      const t = document.querySelector('#detail .tbl-wrap table');
      const head = t.querySelector('tr');
      const body = [...t.querySelectorAll('tr')].filter((r) => r.querySelector('td'))[0];
      return { head: head.children.length, body: body.children.length, scope: t.querySelector('th.fd-cell') ? t.querySelector('th.fd-cell').getAttribute('scope') : null };
    });
    expect(shape.head, 'header and body must have the same column count').toBe(shape.body);
    expect(shape.scope).toBe('col');
  });

  test('Escape closes the record view', async ({ page }) => {
    // A TERMINAL dimension always opens a record rather than drilling, so this
    // exercises the record view without depending on whether a drill target
    // happens to be loaded.
    await openDetail(page, 'dow');
    await page.click('#detail .fd-go');
    await expect(page.locator('.fd-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.fd-modal')).toHaveCount(0);
  });
});

test.describe('Revenue Analysis drills down the paid-media chain', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'behaviour test, one engine');

  async function openRevenue(page) {
    await page.goto(origin + '/data-analysis.html');
    await page.waitForFunction(() => !!document.querySelector('#anTabs'));
    // The Live Intelligence tabs are added by the extensions file, which the
    // contrast wrapper injects in production.
    await page.addScriptTag({ url: '/data-analysis-extensions.js' });
    await page.waitForSelector('#anTabs button[data-ext-tab="revenue-analysis"]');
    await page.click('#anTabs button[data-ext-tab="revenue-analysis"]');
    await page.waitForSelector('#xRevCut .xtable table tr td');
  }
  async function cutRows(page) {
    return page.evaluate(() => ({
      title: document.querySelector('#xRevCut h3').textContent,
      rows: [...document.querySelectorAll('#xRevCut .xtable table tbody tr')].map((r) => r.cells[0].innerText.trim()),
      meta: document.querySelector('#xRevCut .xmeta').innerText.replace(/\s+/g, ' '),
    }));
  }

  test('platform → campaign → ad set, each step narrowed by the row that was clicked', async ({ page }) => {
    await openRevenue(page);
    await page.click('.xsub[data-cut="platform"]');
    await page.waitForFunction(() => /platform/i.test(document.querySelector('#xRevCut h3').textContent));

    // Click the Meta row. Google's campaign must not come with it.
    await page.click('#xRevCut .xtable table tbody tr:first-child');
    await page.waitForFunction(() => /campaign/i.test(document.querySelector('#xRevCut h3').textContent));
    let view = await cutRows(page);
    expect(view.rows).toEqual(['meta', 'meta']);
    expect(view.meta, 'the row count must show the narrowing').toContain('2 of 3');
    expect(await page.locator('.fd-crumb').nth(1).innerText()).toContain('meta');

    // And one level further: only Coffee_Prospecting's ad set.
    await page.click('#xRevCut .xtable table tbody tr:first-child');
    await page.waitForFunction(() => /ad set/i.test(document.querySelector('#xRevCut h3').textContent));
    view = await cutRows(page);
    expect(view.rows.length).toBe(1);
    expect(await page.locator('#xRevCut').innerText()).toContain('Broad_25_44');
  });

  test('a breadcrumb steps back up and widens the view again', async ({ page }) => {
    await openRevenue(page);
    await page.click('.xsub[data-cut="platform"]');
    await page.waitForFunction(() => /platform/i.test(document.querySelector('#xRevCut h3').textContent));
    await page.click('#xRevCut .xtable table tbody tr:first-child');
    await page.waitForFunction(() => document.querySelectorAll('#xRevCut .xtable table tbody tr').length === 2);
    // "All revenue" drops every step; the campaign cut goes back to all 3 rows.
    await page.click('.fd-crumb[data-fd-pop="0"]');
    await expect.poll(async () => (await cutRows(page)).rows.length).toBe(3);
    await expect(page.locator('.fd-crumbs')).toHaveCount(0);
  });

  test('choosing a cut by hand clears the trail instead of carrying stale filters', async ({ page }) => {
    await openRevenue(page);
    await page.click('.xsub[data-cut="platform"]');
    await page.waitForFunction(() => /platform/i.test(document.querySelector('#xRevCut h3').textContent));
    await page.click('#xRevCut .xtable table tbody tr:nth-child(2)');   // google
    await expect.poll(async () => (await cutRows(page)).rows.length).toBe(1);
    await page.click('.xsub[data-cut="adset"]');
    await expect.poll(async () => (await cutRows(page)).rows.length).toBe(2);
    await expect(page.locator('.fd-crumbs')).toHaveCount(0);
  });
});
