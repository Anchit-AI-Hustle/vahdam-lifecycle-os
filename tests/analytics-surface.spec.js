const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const { blockExternal } = require('./lib/page-harness');

// page.goto waits for `load`, and every page here links Google Fonts and CDN
// assets that cannot resolve in CI, so each navigation sat waiting for those
// connections to give up (measured: 13.0s per goto, 0.2s with them refused).
// Registered in a file-level beforeEach so it lands BEFORE any route a test
// installs for itself: Playwright matches routes in reverse registration order,
// so a per-test stub declared later still wins over this catch-all.
test.beforeEach(async ({ page }) => { await blockExternal(page); });

// /analytics is a DOCUMENT, not a frame around one.
//
// It used to be served by data-analysis-contrast.html: a 5KB shell that loaded
// data-analysis.html in an iframe, injected ~50 !important rules across the
// document boundary, re-added them from a MutationObserver, and side-loaded
// data-analysis-extensions.js into the iframe's body. Three things followed from
// that shape, none of them visible on the page itself:
//
//   1. auth.js ran INSIDE the frame, so the nav rendered there too. Its links are
//      deliberately plain hrefs ("internal nav stays in the same tab so the back
//      button works") and inside a frame that means the same FRAME: clicking
//      Mailer Studio loaded /studio into the iframe while the address bar still
//      said /analytics, and the wrapper's load handler then injected the analytics
//      palette and extensions script into whatever page had just arrived.
//   2. The iframe src was a bare "/data-analysis.html", so ?mkt= on the parent URL
//      never reached the page that reads it. /analytics?mkt=UK rendered US.
//   3. Opening /data-analysis.html directly got no extensions at all — the nav
//      lists that path as the same feature, but it rendered four tabs of ten.
//
// The fix is structural, so the guard is structural: assert the wrapper is gone,
// the routes point at the real page, and the real page carries its own behaviour.

const ROOT = path.join(__dirname, '..');
const SERVABLE = new Map();
(function index(dir, prefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'test-results') continue;
    const abs = path.join(dir, e.name), url = `${prefix}/${e.name}`;
    if (e.isDirectory()) index(abs, url);
    else if (/\.(html|js|json|css|svg|png|jpg|webp)$/i.test(e.name)) SERVABLE.set(url, abs);
  }
})(ROOT, '');

function server() {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, connected: true, kpis: {}, rows: [], platforms: [], note: '' }));
    }
    const f = SERVABLE.get(u === '/' ? '/index.html' : u);
    if (!f) { res.writeHead(404); return res.end('nf'); }
    const ext = path.extname(f);
    res.writeHead(200, { 'content-type': ext === '.json' ? 'application/json' : ext === '.js' ? 'text/javascript' : 'text/html' });
    res.end(fs.readFileSync(f));
  });
}

async function serve() {
  const s = server();
  await new Promise((r) => s.listen(0, r));
  return { s, BASE: 'http://127.0.0.1:' + s.address().port };
}

test('the iframe wrapper is gone and nothing points at it', () => {
  expect(
    fs.existsSync(path.join(ROOT, 'data-analysis-contrast.html')),
    'data-analysis-contrast.html is retired; fold styling into data-analysis.html instead of wrapping it',
  ).toBe(false);

  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  for (const route of ['/analytics', '/data-analysis']) {
    const rw = v.rewrites.find((r) => r.source === route);
    expect(rw, `${route} must be routed`).toBeTruthy();
    expect(rw.destination, `${route} must serve the real page, not a wrapper`).toBe('/data-analysis.html');
  }

  // cleanUrls is false, so the retired wrapper path was a real URL people hold.
  const red = v.redirects.find((r) => r.source === '/data-analysis-contrast.html');
  expect(red, 'the retired wrapper path needs a redirect, not a 404').toBeTruthy();
  expect(red.destination).toBe('/data-analysis');
});

test('the page carries its own behaviour, so the direct path is not a degraded page', async ({ page }) => {
  const html = fs.readFileSync(path.join(ROOT, 'data-analysis.html'), 'utf8');
  expect(html, 'data-analysis.html must load its own extensions').toMatch(/src="\/data-analysis-extensions\.js/);
  expect(html, 'the contrast palette must live in the page it styles').toContain('vahdam-high-contrast-override');

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { s, BASE } = await serve();
  await page.goto(BASE + '/data-analysis.html');
  await page.waitForTimeout(2200);

  // Native tabs come from the page, extension tabs from the script it now loads.
  // Both present on the direct path is the whole point.
  await expect(page.locator('#anTabs button[data-tab="control"]')).toBeVisible();
  const ext = await page.locator('#anTabs button[data-ext-tab]').count();
  expect(ext, 'the extended tabs must render without a wrapper injecting them').toBeGreaterThan(0);
  expect(errors, errors.join(' | ')).toEqual([]);
  s.close();
});

test('a ?tab= deep link still opens that tab now that nothing is framed', async ({ page }) => {
  const { s, BASE } = await serve();
  await page.goto(BASE + '/data-analysis.html?tab=review-overview');
  await page.waitForTimeout(2500);
  // The extensions read ?tab= off `parent`, which resolves to the window itself
  // when the page is not framed — the deep link has to survive un-framing.
  await expect(page.locator('#anTabs button[data-ext-tab="review-overview"].on')).toBeVisible();
  s.close();
});

test('?mkt= reaches the page that reads it', async ({ page }) => {
  const { s, BASE } = await serve();
  // The page reads mkt off its OWN location.search. The wrapper's iframe src was a
  // bare "/data-analysis.html", so the parameter never arrived and /analytics?mkt=UK
  // rendered US figures under a UK URL — a wrong-market read that looked correct.
  await page.goto(BASE + '/data-analysis.html?mkt=UK');
  await page.waitForTimeout(2400);
  expect(await page.evaluate(() => location.search)).toBe('?mkt=UK');
  const on = await page.locator('#mktToggle button.on').getAttribute('data-mkt');
  expect(on, 'the market named in the URL must be the market rendered').toBe('UK');
  s.close();
});

test('the committed Shopify overlay is never reported as live', async ({ page }) => {
  const { s, BASE } = await serve();
  await page.goto(BASE + '/data-analysis.html');
  await page.waitForTimeout(2200);

  await page.locator('#vh-sync [data-vh="sync"]').click();
  await page.waitForTimeout(1200);
  const report = await page.evaluate(() => window.LifecycleSync.report);
  const da = report.find((r) => /data analysis/i.test(r.label));
  expect(da, `no data-analysis surface in ${JSON.stringify(report)}`).toBeTruthy();
  // data/analytics/live-shopify.json is a file a human pulled through the Shopify
  // MCP. Re-reading it quickly is not reading the store, so 'live' would be a
  // claim the page cannot support however fresh the fetch was.
  expect(da.source, 'a hand-pulled overlay is a snapshot, not a live read').toBe('snapshot');
  expect(da.note, 'the note must say how old the pull is, not just that one happened').toMatch(/pulled/i);
  s.close();
});

test('the footnote derives the overlay age instead of restating a fixed date', () => {
  const html = fs.readFileSync(path.join(ROOT, 'data-analysis.html'), 'utf8');
  expect(html, 'freshness must be derived from pulled_at at render time').toContain('function liveFreshness()');
  expect(html, 'the derived age must reach the reader').toMatch(/stale_days/);
  // The old label said "live Shopify Admin snapshot ... pulled <date>" forever, so
  // a month-old pull still led with the word live. "live" is now conditional.
  const foot = html.slice(html.indexOf('function renderFootnote()'));
  expect(foot.slice(0, 1400)).toContain('is_today');
});

test('the page registers one sync surface, not one per tab visited', async ({ page }) => {
  const { s, BASE } = await serve();
  await page.goto(BASE + '/data-analysis.html');
  await page.waitForTimeout(2200);
  const before = await page.evaluate(() => window.LifecycleSync.sources.slice());
  expect(before, 'the native view must already have a loader').toContain('data-analysis');

  // Walk through several extension tabs. Registering per tab used to add a loader
  // each time, and a later sync then re-opened every one of them in turn, so the
  // view jumped to whichever registered last.
  for (const id of await page.locator('#anTabs button[data-ext-tab]').evaluateAll((els) =>
    els.slice(0, 3).map((e) => e.getAttribute('data-ext-tab')))) {
    await page.locator(`#anTabs button[data-ext-tab="${id}"]`).click();
    await page.waitForTimeout(500);
  }
  const after = await page.evaluate(() => window.LifecycleSync.sources.slice());
  expect(after.filter((x) => /^data-analysis/.test(x)).length,
    `one surface for the page, got ${JSON.stringify(after)}`).toBe(1);
  s.close();
});
