const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

// The gates answer HTTP 200 with { ok:false, blocked:true, message, blocker,
// data_required, remediation }. Every front end read only `j.error`, which that
// payload does not carry, so:
//   social-media.html -> "Pipeline call failed: HTTP 200 - is the API deployed/reachable?"
//   smart-brain.html  -> "Generation failed"
// The first reports the status of a SUCCESSFUL response as the failure reason
// and sends the operator to check a healthy deployment; the second discards the
// reason entirely. Both hid the one sentence that would have fixed it:
// "Live catalog unavailable - set LIVE_CONNECTORS=on".

const ROOT = path.join(__dirname, '..');

// The exact payload social-core.runDaily returns when the catalog gate blocks,
// captured from a real local run rather than hand-written.
const BLOCKED = {
  ok: false, blocked: true, reason: 'live_catalog_required', code: 'CATALOG_NOT_LIVE',
  status: 'NOT LAUNCH READY - DATA DEPENDENCY',
  message: 'social posts generation stopped: Live catalog unavailable for UK; falling back to the static build artifact',
  blocker: 'Live catalog unavailable for UK',
  data_required: '[DATA REQUIRED BEFORE LAUNCH: live Shopify catalog (CATALOG_NOT_LIVE), UK, catalog source is static_build]',
  remediation: ['Set LIVE_CONNECTORS=on so the app may read the store.'],
  catalog: { market: 'UK', live: false, source: 'static_build' },
  date: '2026-08-19', market: 'UK', posts: [], trace: [],
};

let server; let origin;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/brain') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); // 200 ON PURPOSE
      return res.end(JSON.stringify(BLOCKED));
    }
    const f = path.join(ROOT, u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname));
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f);
      res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/plain' });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404); res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = 'http://127.0.0.1:' + server.address().port;
});
// A describe/file-level test.skip() means Playwright never runs beforeAll -
// but it DOES run afterAll. Without the guard, `server` is undefined here and
// server.close() throws, which Playwright reports as a FAILED test. That is
// what reddened every CI run on the three WebKit projects for this file.
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

test.describe('a blocked generation explains itself', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'behaviour test, one engine');
  // auth.js registers sw.js on `load`; sw.js calls clients.claim(), which fires
  // controllerchange, which reloads the page 50ms later (the PWA self-heal path).
  // That reload lands AFTER the click on a loaded machine and wipes the banner
  // this test is reading — the failure is the PWA update race, not the explainer.
  // The service worker is not what is under test, so it is blocked here.
  test.use({ serviceWorkers: 'block' });

  test('the module turns a block into the reason and the fix', async ({ page }) => {
    await page.goto(origin + '/social-media.html');
    await expect.poll(() => page.evaluate(() => !!window.GateNotice)).toBe(true);
    const out = await page.evaluate((b) => window.GateNotice.message('Pipeline call failed', b, { ok: true, status: 200 }), BLOCKED);
    expect(out.blocked).toBe(true);
    // Says what happened, what is missing, and what to do.
    expect(out.text).toContain('Live catalog unavailable');
    expect(out.text).toContain('DATA REQUIRED BEFORE LAUNCH');
    expect(out.text).toContain('LIVE_CONNECTORS=on');
    // And never the two lies.
    expect(out.text).not.toContain('HTTP 200');
    expect(out.text).not.toMatch(/is the API deployed/);
  });

  test('a real transport failure may still ask about reachability', async ({ page }) => {
    await page.goto(origin + '/social-media.html');
    const out = await page.evaluate(() => window.GateNotice.explain(null, { ok: false, status: 502 }));
    expect(out.blocked).toBe(false);
    expect(out.text).toContain('HTTP 502');
    expect(out.text).toMatch(/is the API deployed/);
  });

  test('ok:false with no reason is reported, not disguised as a status code', async ({ page }) => {
    await page.goto(origin + '/social-media.html');
    const out = await page.evaluate(() => window.GateNotice.explain({ ok: false }, { ok: true, status: 200 }));
    expect(out.text).toMatch(/no reason given/);
    expect(out.text).not.toContain('HTTP 200');
  });

  test('the social page shows the blocker instead of "HTTP 200"', async ({ page }) => {
    await page.goto(origin + '/social-media.html');
    // The click handler is attached by the LAST statement of the trailing inline
    // script, so waiting for the button to EXIST is not enough — it is parsed
    // before the script that wires it. readyState 'complete' is the guarantee
    // that the document, including that script, has finished running.
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.click('#runBtn');
    const banner = page.locator('#banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Live catalog unavailable');
    await expect(banner).toContainText('LIVE_CONNECTORS=on');
    await expect(banner).not.toContainText('HTTP 200');
    await expect(banner).not.toContainText('is the API deployed');
  });

  test('no page still prints a status code as the reason a 200 failed', () => {
    for (const f of ['social-media.html', 'smart-brain.html']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, `${f} still falls back to the HTTP status of a 200`).not.toMatch(/error \|\| \('HTTP ' \+ r\.status\)/);
      expect(src, `${f} does not load the shared explainer`).toMatch(/gate-notice\.js/);
    }
  });
});
