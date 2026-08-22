const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

// "None of the assets are getting created" looked, in the UI, like this:
//
//   [final]  Final generated version - the best version of each asset,
//            ready to view and download.
//   Copy by template  ·  channels: email, meta, google, tiktok, landing_page
//   Agent pipeline: [warning] Live Catalog Gate
//
// Every one of those lines is on the same screen and the first contradicts the
// other two. The run had NOT generated: no LLM provider answered, so copy fell
// back to templates, and the catalog gate did not pass. The header still said
// "final, ready to download".
//
// Underneath it was an off-by-falsy bug. The label prints "template" when
// `cw.provider` is MISSING (`esc(cw.provider || 'template')`), but the block
// that explains the fallback tested `/template/.test(String(cw.provider||''))`,
// which is false for an empty provider.
//
// Precisely: a run that executed and fell back writes
// copywriter.provider = 'template-fallback', which the old check DID catch. The
// blind spot was a campaign whose stored payload never carried `copywriter` at
// all - it renders the bare word "template" with no explanation beside it, which
// is exactly the screen in the report.

const ROOT = path.join(__dirname, '..');

// The shape smart-brain.html renders, matching the screenshot: no copy provider,
// and a catalog-gate step that did not pass.
const DEGRADED = {
  ok: true,
  entry: { id: 'cal_2026-08-22_us_loyalists', date: '2026-08-22', market: 'US', status: 'final',
    cohort: { name: 'Loyalists', size: 245 }, objective: 'premium bundle expansion',
    channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'] },
  campaign: {
    // `copywriter` ABSENT is the bug's trigger and the state in the report: the
    // label falls back to the word "template" while the old check saw ''. A live
    // run sets copywriter.provider = 'template-fallback', which the old check DID
    // catch; a stored campaign that never carried the field did not.
    campaign_id: 'camp_1',
    agent_trace: [
      { agent: 'Strategy Analyst', role: 'Growth Strategy', ok: true, provider: 'anthropic' },
      { agent: 'Live Catalog Gate', role: 'Pre-creative gate', ok: false,
        output: { reason: 'Live catalog unavailable for US', blocker: 'Live catalog unavailable for US',
          remediation: ['Set LIVE_CONNECTORS=on so the app may read the store.'] } },
    ],
    assets: { email: { subject: 'S', html: '<p>hi</p>' }, ads: [], landing_pages: [] },
  },
};
const HEALTHY = JSON.parse(JSON.stringify(DEGRADED));
HEALTHY.campaign.copywriter = { provider: 'anthropic', model: 'claude-sonnet-5' };
HEALTHY.campaign.agent_trace = [{ agent: 'Strategy Analyst', role: 'Growth Strategy', ok: true, provider: 'anthropic' }];

let server; let origin; let payload = DEGRADED;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // smart-brain.html asks for the plan, then previews an entry.
      if (u.searchParams.get('action') === 'smart-brain-plan') {
        return res.end(JSON.stringify({ ok: true, mode: 'preview', entries: [payload.entry] }));
      }
      return res.end(JSON.stringify(payload));
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

// ── Source-level: the condition that broke ──────────────────────────────────
const SRC = fs.readFileSync(path.join(ROOT, 'smart-brain.html'), 'utf8');

test('the fallback check tests the same thing the label prints', () => {
  // The label is `cw.provider || 'template'`, so a MISSING provider reads as
  // "template" on screen. The check must therefore treat a missing provider as
  // a fallback too, or the two disagree exactly when it matters.
  expect(SRC).toMatch(/_copyFellBack = !cw\.provider \|\| \/template\/i\.test/);
  expect(SRC, 'the old falsy-blind check is still present')
    .not.toMatch(/isFallback = \/template\/\.test\(String\(cw\.provider\|\|''\)\)/);
});

// ── Behavioural: drive the real page ────────────────────────────────────────
test.describe('a degraded run says so', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'behaviour test, one engine');
  test.use({ serviceWorkers: 'block' });

  async function render(page, data) {
    payload = data;
    await page.goto(origin + '/smart-brain.html');
    await page.waitForFunction(() => document.readyState === 'complete');
    // Render the preview panel directly with the captured payload: this is the
    // function the page calls after a preview/approve round-trip.
    await page.evaluate(({ d, i }) => {
      const host = document.getElementById('preview') || document.body;
      window.renderPreview(d, d.entry, i, { persisted: true, target: host });
    }, { d: data, i: 0 });
    return page.locator('.pvroot');
  }

  test('it does not call a template run "final, ready to download"', async ({ page }) => {
    const root = await render(page, DEGRADED);
    await expect(root).toContainText('Saved, but NOT fully generated');
    await expect(root).toContainText('copy is the template fallback');
    await expect(root).toContainText('the live catalog gate blocked');
    // The claim that started this must be gone in this state.
    await expect(root).not.toContainText('ready to view and download');
  });

  test('the reason and the fix are on screen, not in a tooltip', async ({ page }) => {
    const root = await render(page, DEGRADED);
    // Why the copy is template: the explanation the falsy bug used to suppress.
    await expect(root).toContainText('template fallback');
    await expect(root).toContainText('OPENAI_API_KEY');
    // Why the gate did not pass, and what to do about it.
    await expect(root).toContainText('Live catalog unavailable for US');
    await expect(root).toContainText('LIVE_CONNECTORS=on');
  });

  test('the live fallback marker is caught too', async ({ page }) => {
    // The other shape: a run that DID execute and fell back, so the server wrote
    // provider:'template-fallback'. Both paths must reach the same warning.
    const live = JSON.parse(JSON.stringify(DEGRADED));
    live.campaign.copywriter = { provider: 'template-fallback', model: null };
    const root = await render(page, live);
    await expect(root).toContainText('Saved, but NOT fully generated');
    await expect(root).toContainText('copy is the template fallback');
  });

  test('a genuinely complete run is still called final', async ({ page }) => {
    // The banner must not cry wolf: a clean run keeps its confident header.
    const root = await render(page, HEALTHY);
    await expect(root).toContainText('Final generated version');
    await expect(root).not.toContainText('Saved, but NOT fully generated');
    await expect(root).toContainText('anthropic');
  });
});
