const { test, expect } = require('@playwright/test');
const { startServer, blockExternal } = require('./lib/page-harness.js');

// "BRIEF CREATION FAILED — SERVER_ERROR" WHILE THE SERVER WAS EXPLAINING ITSELF.
//
// Clicking Enhance with AI in Mailer Studio showed a red toast reading
// "Brief creation failed — using heuristic / server_error". Nothing had
// crashed. Measured against the live deployment, /api/ai/generate answers:
//
//   HTTP 409 {"ok":false,"blocked":true,"reason":"live_catalog_required",
//             "code":"CATALOG_NOT_LIVE",
//             "message":"... Live connectors are disabled — set LIVE_CONNECTORS=on ..."}
//
// The client read only errBody.error and errBody.detail. This payload carries
// NEITHER — it carries message/blocker/reason/code — so `errBody.error ||
// 'server_error'` produced the literal string "server_error" and the detail
// clause appended nothing. The one sentence that fixes the problem was in the
// response body the whole time.
//
// gate-notice.js exists for exactly this and was already loaded on this page;
// it had simply never been called here. It tests `blocked` BEFORE the HTTP
// status, so a 409 block reads as a verdict rather than "is the API reachable?".

let server, BASE;
test.beforeAll(async () => { const s = await startServer(); server = s.server; BASE = s.base; });
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });
test.use({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });

/** The exact shape the deployed catalog gate returns, status included. */
const BLOCKED = {
  ok: false, blocked: true, reason: 'live_catalog_required', code: 'CATALOG_NOT_LIVE',
  status: 'NOT LAUNCH READY - DATA DEPENDENCY',
  message: 'create_brief copy generation stopped: Live catalog unavailable for US; falling back to the '
    + 'static build artifact from 2018-10-20T01:46:40.000Z (2861 day(s) old). Live connectors are '
    + 'disabled - set LIVE_CONNECTORS=on to allow outbound reads.',
  blocker: 'Live catalog unavailable for US.',
  data_required: '[DATA REQUIRED BEFORE LAUNCH: live catalog, US]',
};

test('a gate block is reported with the reason, not as "server_error"', async ({ page }) => {
  await blockExternal(page);
  await page.route((url) => url.pathname.startsWith('/api/'),
    (r) => r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await page.route((url) => url.pathname.includes('/api/ai/generate'),
    (r) => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(BLOCKED) }));

  await page.goto(`${BASE}/vahdam_mailer_architect_v34.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // Drive the real client path rather than asserting on source text.
  const shown = await page.evaluate(async () => {
    const res = await fetch('/api/ai/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'create_brief', market: 'US' }),
    });
    const body = await res.json().catch(() => ({}));
    return window.GateNotice ? window.GateNotice.explain(body, res).text : '(GateNotice missing)';
  });

  expect(shown, 'GateNotice is not loaded on the studio page').not.toContain('GateNotice missing');
  // The actionable sentence must survive to the user.
  expect(shown).toContain('LIVE_CONNECTORS=on');
  // And the two misleading readings must not.
  expect(shown).not.toMatch(/server_error/);
  expect(shown, 'a block must never be reported as an unreachable API')
    .not.toMatch(/deployed\/reachable/);
});

test('the studio actually calls GateNotice on a failed generate', async () => {
  // Guards the wiring itself: the page loaded gate-notice.js long before this
  // fix and never called it, which is why the bug survived.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'vahdam_mailer_architect_v34.html'), 'utf8');
  const doCreate = src.slice(src.indexOf('async function _doCreate'), src.indexOf('async function _doCreate') + 3000);
  expect(doCreate, '_doCreate does not consult GateNotice').toContain('GateNotice');
  expect(doCreate, "_doCreate still falls back to the bare literal 'server_error' first")
    .toMatch(/GateNotice[\s\S]{0,400}errBody\.message/);
});
