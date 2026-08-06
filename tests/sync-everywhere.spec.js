const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

// EVERY page carries a sync control (product owner, 2026-08-06).
//
// Before this, fifty of fifty-six pages had no way to refresh: they fetched once
// on load and then aged silently, which is worse than showing nothing — the
// figures keep looking authoritative hours later. sync-bar.js is injected by
// auth.js so the guarantee holds for pages added later too, and this spec locks
// both halves: the control exists everywhere, and it never claims a source is
// live when that source returned a snapshot.

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

let apiCalls = 0;
function server() {
  return http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u.startsWith('/api/')) {
      apiCalls++;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true, connected: true, generated_at: new Date().toISOString(),
        market: 'US', level: 'ad', window: { since: '2020-01-01', until: '2026-08-06' },
        kpis: {}, platforms: [], rows: [], today: { ok: true, connected: true }, note: '',
      }));
    }
    const f = SERVABLE.get(u === '/' ? '/index.html' : u);
    if (!f) { res.writeHead(404); return res.end('nf'); }
    const ext = path.extname(f);
    res.writeHead(200, { 'content-type': ext === '.json' ? 'application/json' : ext === '.js' ? 'text/javascript' : 'text/html' });
    res.end(fs.readFileSync(f));
  });
}

test('auth.js injects the sync layer, so the guarantee covers pages added later', () => {
  const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  expect(auth, 'auth.js must load /sync-bar.js on every page').toContain('/sync-bar.js');
  expect(fs.existsSync(path.join(ROOT, 'sync-bar.js'))).toBe(true);
});

test('a page with no live source still gets a working control, and says so', async ({ page }) => {
  const s = server(); await new Promise((r) => s.listen(0, r));
  const BASE = 'http://127.0.0.1:' + s.address().port;
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/frameworks.html');
  await page.waitForTimeout(1600);
  await expect(page.locator('#vh-sync')).toBeVisible();
  // It must NOT imply live data it does not have. The text chip is hidden on
  // narrow viewports, so read it rather than click it.
  expect(await page.textContent('#vh-sync .vh-src')).toBe('page reload');
  // The dot button is the affordance that MUST work on every viewport, including
  // phones where the chip and the auto toggle are hidden. It is asserted here
  // because the first version of this bar shipped an 8px, effectively untappable
  // target as the only mobile route into the panel.
  const dot = page.locator('#vh-sync [data-vh="panel"]');
  await expect(dot).toBeVisible();
  const box = await dot.boundingBox();
  expect(box.width, 'the dot needs a real touch target').toBeGreaterThanOrEqual(24);
  expect(box.height, 'the dot needs a real touch target').toBeGreaterThanOrEqual(24);
  await dot.click();
  await page.waitForTimeout(300);
  expect(await page.textContent('#vh-sync-panel')).toContain('registers no live data source');
  expect(errors, errors.join(' | ')).toEqual([]);
  s.close();
});

test('the ads dashboard registers live surfaces and a sync really refetches them', async ({ page }) => {
  const s = server(); await new Promise((r) => s.listen(0, r));
  const BASE = 'http://127.0.0.1:' + s.address().port;
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/ad-campaigns-master.html');
  await page.waitForTimeout(2000);
  const sources = await page.evaluate(() => window.LifecycleSync.sources);
  expect(sources.length, `expected registered surfaces, got ${JSON.stringify(sources)}`).toBeGreaterThanOrEqual(2);
  const before = apiCalls;
  await page.click('#vh-sync [data-vh="sync"]');
  await page.waitForTimeout(1500);
  // A sync that fires no request is not a sync.
  expect(apiCalls - before).toBeGreaterThan(0);
  expect(await page.textContent('#vh-sync .vh-age')).toMatch(/synced/);
  expect(errors, errors.join(' | ')).toEqual([]);
  s.close();
});

test('a snapshot source is never reported as live', async ({ page }) => {
  const s = server(); await new Promise((r) => s.listen(0, r));
  const BASE = 'http://127.0.0.1:' + s.address().port;
  await page.goto(BASE + '/ad-campaigns-master.html');
  await page.waitForTimeout(2000);
  await page.click('#vh-sync [data-vh="sync"]');
  await page.waitForTimeout(1500);
  const report = await page.evaluate(() => window.LifecycleSync.report);
  // With no connector configured, per-ad detail falls back to the committed
  // snapshot. It must be labelled snapshot, not live.
  const detail = report.find((r) => /campaign & ad detail/.test(r.label));
  expect(detail, `no detail surface in ${JSON.stringify(report)}`).toBeTruthy();
  expect(detail.source, 'the committed snapshot must not be reported as live').not.toBe('live');
  // And the aggregate dot must reflect the worst source, not the best.
  const cls = await page.getAttribute('#vh-sync', 'class');
  expect(cls).toMatch(/warn|bad/);
  s.close();
});

test('auto-refresh never polls a hidden tab', () => {
  const src = fs.readFileSync(path.join(ROOT, 'sync-bar.js'), 'utf8');
  // Polling an operator-gated, quota-metered API into a background tab spends
  // money to refresh a screen nobody is looking at.
  expect(src).toContain("document.visibilityState !== 'visible'");
  expect(src).toContain('navigator.onLine === false');
});

test('ads-live-core honours the LIVE_CONNECTORS kill switch', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'ads-live-core.js'), 'utf8');
  // It was the last outbound connector that ignored the switch, which made the
  // switch untrustworthy. A kill switch with an exception is not a kill switch.
  expect(src).toContain('liveConnectorsEnabled');
  const fn = src.slice(src.indexOf('function metaConfigured()'));
  expect(fn.slice(0, 220)).toContain('liveConnectorsEnabled()');
});

// ── The data surfaces the owner named explicitly ────────────────────────────
// "all the data analysis, calendar of past days etc and all data related metrics
// fields" must refresh on a frequency, not just on a page reload. A registered
// loader is the difference between a real in-place refresh and a reload, so this
// asserts registration rather than merely the presence of the bar.
const REGISTERED = [
  ['/smart-brain.html', 'brain:plan'],
  ['/all-in-one.html', 'os:dashboard'],
  ['/social-media.html', 'social:posts'],
];
for (const [route, surface] of REGISTERED) {
  test(`${route} registers a live loader (${surface}), not just the reload fallback`, async ({ page }) => {
    const s = server(); await new Promise((r) => s.listen(0, r));
    const BASE = 'http://127.0.0.1:' + s.address().port;
    await page.goto(BASE + route);
    await page.waitForTimeout(2200);
    const sources = await page.evaluate(() => (window.LifecycleSync && window.LifecycleSync.sources) || []);
    expect(sources, `${route} should register ${surface}; got ${JSON.stringify(sources)}`).toContain(surface);
    expect(await page.textContent('#vh-sync .vh-src')).not.toBe('page reload');
    s.close();
  });
}

test('on a phone, auto-refresh stays controllable even though the bar hides it', async ({ page }) => {
  const s = server(); await new Promise((r) => s.listen(0, r));
  const BASE = 'http://127.0.0.1:' + s.address().port;
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(BASE + '/ad-campaigns-master.html');
  await page.waitForTimeout(2200);
  // The bar's own toggle is hidden under 520px by design (no room).
  await expect(page.locator('#vh-sync .vh-auto')).toBeHidden();
  // So the capability has to live in the panel, or a phone user can never stop
  // the polling — hiding a control must not remove the capability.
  await page.locator('#vh-sync [data-vh="panel"]').click();
  await page.waitForTimeout(300);
  const toggle = page.locator('#vh-sync-panel [data-vh="auto2"]');
  await expect(toggle).toBeVisible();
  await toggle.uncheck();
  expect(await page.evaluate(() => document.querySelector('#vh-sync [data-vh=\"auto\"]').checked))
    .toBe(false);
  s.close();
});

test('opening a page does not trigger a second fetch on top of its own startup load', async ({ page }) => {
  // The refocus catch-up must not fire when nothing has synced yet. It did at
  // first, so every registered page fetched twice on open — double the calls
  // against metered connectors, and the two runs interleaved badly: a page whose
  // loader clears its error banner on entry had the banner wiped by the second
  // run. The page's own startup owns the first fetch.
  const src = fs.readFileSync(path.join(ROOT, 'sync-bar.js'), 'utf8');
  const handler = src.slice(src.indexOf("addEventListener('visibilitychange'"));
  const body = handler.slice(0, handler.indexOf('});'));
  expect(body, 'refocus must bail out when nothing has synced yet').toContain('if (lastOk == null) return;');
  expect(body, 'refocus must not sync merely because lastOk is null').not.toMatch(/lastOk == null \|\|/);

  const s = server(); await new Promise((r) => s.listen(0, r));
  const BASE = 'http://127.0.0.1:' + s.address().port;
  const before = apiCalls;
  await page.goto(BASE + '/all-in-one.html');
  await page.waitForTimeout(2500);
  const onOpen = apiCalls - before;
  // Its startup load() fires one request; the bar must add none.
  expect(onOpen, `expected the page's own startup fetch only, got ${onOpen} calls`).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => window.LifecycleSync.lastSyncedAt)).toBeNull();
  s.close();
});
