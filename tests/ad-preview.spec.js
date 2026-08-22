const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const http = require('http');

const { blockExternal } = require('./lib/page-harness');

// page.goto waits for `load`, and every page here links Google Fonts and CDN
// assets that cannot resolve in CI, so each navigation sat waiting for those
// connections to give up (measured: 13.0s per goto, 0.2s with them refused).
// Registered in a file-level beforeEach so it lands BEFORE any route a test
// installs for itself: Playwright matches routes in reverse registration order,
// so a per-test stub declared later still wins over this catch-all.
test.beforeEach(async ({ page }) => { await blockExternal(page); });

// An ad has one true shape. These stages used a FIXED height across the full
// card width, so a 1:1 creative was cover-cropped into roughly an 8:1 band —
// the packshot blown up past recognition while the corner badge read "1:1".
// And there was no way to open the finished unit at a size you could judge.

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'smart-brain.html'), 'utf8');

// The page is served for real rather than eval'd: its script bootstraps the DOM
// on load, so running it in a bare document throws before reaching the helpers.
let server, BASE;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":false}'); }
    // Confine to ROOT. Joining a request path straight onto a directory lets
    // "/../../etc/passwd" out of the tree — harmless in a test fixture, but it
    // is the same mistake that matters in a real handler, so do it properly.
    let rel;
    try { rel = decodeURIComponent(u === '/' ? 'index.html' : u); } catch (_) { rel = ''; }
    const f = path.resolve(ROOT, '.' + path.posix.normalize('/' + rel));
    if (!f.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('outside root'); }
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f);
      res.writeHead(200, { 'Content-Type': ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html' });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404); res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

test.describe('ads render at their real aspect', () => {
  test('aspect comes from the ad, then the platform, never a fixed height', async ({ page }) => {
    // smart-brain.html boots auth and registers a service worker after load, so
    // a bare goto() can still be navigating when evaluate() runs — that races to
    // "Execution context was destroyed". Wait for the network to settle, then
    // for the function under test to exist: waitForFunction is re-injected
    // across navigations, so it survives the redirect that evaluate() cannot.
    await page.goto(`${BASE}/smart-brain.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.adAspect === 'function' && typeof window.adFrameCss === 'function');
    const out = await page.evaluate(() => {
      return {
        explicit: adAspect({ aspect: '4:5' }),
        meta: adAspect({ platform: 'meta' }),
        tiktok: adAspect({ platform: 'tiktok' }),
        google: adAspect({ platform: 'google' }),
        youtube: adAspect({ platform: 'youtube' }),
        css: adFrameCss({ platform: 'meta' }),
        tallCss: adFrameCss({ platform: 'tiktok' }),
      };
    });
    expect(out.explicit).toBe('4/5');
    expect(out.meta).toBe('1/1');
    expect(out.tiktok).toBe('9/16');
    expect(out.google).toBe('16/9');
    expect(out.youtube).toBe('16/9');
    expect(out.css).toContain('aspect-ratio:1/1');
    expect(out.tallCss).toContain('aspect-ratio:9/16');
    // Portrait units are capped narrower so they do not tower over the panel.
    expect(out.tallCss).toContain('max-width:300px');
  });

  test('no stage carries a hard-coded height any more', () => {
    // The exact shape of the bug: height:190px on the static, 220px on the video.
    expect(HTML).not.toContain('border-radius:12px;height:190px');
    expect(HTML).not.toContain('overflow:hidden;height:220px');
  });

  test('the packshot is contained, not cropped to fill', () => {
    // cover on a mismatched frame is what destroyed the product shot.
    expect(HTML).toContain('background-size:auto 100%,contain');
  });
});

test.describe('the complete ad can be opened', () => {
  test('both card types offer a preview control', () => {
    expect(HTML).toContain('\\u26f6 Preview ad');
    // Registered once, used by the video card and the static card.
    expect((HTML.match(/\$\{__apBtn\}/g) || []).length).toBe(2);
  });

  test('the preview is reachable from the card handler', () => {
    expect(HTML).toContain('window.previewAd = function(key)');
    expect(HTML).toContain("onclick=\"previewAd('${__apKey}')\"");
  });

  test('a rendered MP4 plays; an unrendered one says so instead of faking it', () => {
    const fnSrc = HTML.slice(HTML.indexOf('window.previewAd = function(key)'), HTML.indexOf('function analysisPanelHTML'));
    expect(fnSrc).toContain('controls autoplay playsinline');
    expect(fnSrc).toContain('No MP4 yet');
    // And the stage honours the aspect in the modal too.
    expect(fnSrc).toContain("aspect-ratio:' + a + ';object-fit:contain");
  });

  test('previewAd can reach adAspect — they share a scope', async ({ page }) => {
    // The bug this catches: the helpers were first inserted INSIDE renderAd, so
    // previewAd (defined outside it) threw ReferenceError on every open.
    await page.goto(`${BASE}/smart-brain.html`);
    const ok = await page.evaluate(() => typeof adAspect === 'function' && typeof window.previewAd === 'function');
    expect(ok).toBe(true);
  });

  test('opening a preview actually renders a stage at the right aspect', async ({ page }) => {
    await page.goto(`${BASE}/smart-brain.html`);
    const res = await page.evaluate(() => {
      window.__AD_PREVIEW.t1 = { platform: 'tiktok', __ctype: 'static', headline: 'Calmer mornings', creative: {}, cta: 'Shop Now' };
      window.previewAd('t1');
      const m = document.getElementById('ad-preview');
      const stage = m.querySelector('[data-apstage]').innerHTML;
      return { open: m.classList.contains('open'), title: m.querySelector('[data-apt]').textContent, hasAspect: stage.includes('aspect-ratio:9/16'), copy: m.querySelector('[data-apcopy]').textContent };
    });
    expect(res.open).toBe(true);
    expect(res.title).toContain('TIKTOK');
    expect(res.hasAspect).toBe(true);
    expect(res.copy).toContain('Calmer mornings');
  });
});

test.describe('the master prompt ships with the asset', () => {
  test('every asset type gets one attached server-side', () => {
    const plan = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'), 'utf8');
    const at = plan.indexOf('function attachMasterPrompts');
    const fn = plan.slice(at, plan.indexOf('\n}', at));
    expect(fn).toContain("assetType: 'mailer', variant: 'V1'");
    expect(fn).toContain("assetType: 'mailer', variant: 'V2'");
    expect(fn).toContain("assetType: 'landing_page'");
    expect(fn).toContain("assetType: 'ad', platform: ad.platform");
  });

  test('the preview shows it and offers a one-click copy', async ({ page }) => {
    await page.goto(`${BASE}/smart-brain.html`);
    const r = await page.evaluate(() => {
      window.__AD_PREVIEW.mp = {
        platform: 'meta', __ctype: 'static', headline: 'Calmer mornings', creative: {},
        master_prompt: 'You are a D2C creative director for VAHDAM. Produce a 1:1 Meta static ad...',
      };
      window.previewAd('mp');
      const m = document.getElementById('ad-preview');
      const ta = m.querySelector('[data-apmptext]');
      return { shown: !!ta, value: ta ? ta.value : '', btnDisabled: m.querySelector('[data-apmp]').disabled };
    });
    expect(r.shown).toBe(true);
    expect(r.value).toContain('VAHDAM');
    expect(r.btnDisabled).toBe(false);
  });

  test('an asset without one says so rather than showing an empty box', async ({ page }) => {
    await page.goto(`${BASE}/smart-brain.html`);
    const r = await page.evaluate(() => {
      window.__AD_PREVIEW.np = { platform: 'meta', __ctype: 'static', creative: {} };
      window.previewAd('np');
      const m = document.getElementById('ad-preview');
      return { text: m.querySelector('[data-apcopy]').textContent, btnDisabled: m.querySelector('[data-apmp]').disabled };
    });
    expect(r.text).toContain('Not attached');
    expect(r.btnDisabled).toBe(true);
  });
});
