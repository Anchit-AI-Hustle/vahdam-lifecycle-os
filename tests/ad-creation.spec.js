const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Ad creation is the feature that went missing in plain sight. It was never
// deleted -- the /ads page was merged into ad-campaigns-master.html as the
// Creative Studio tab -- but every route into it was removed at the same time:
// the nav row was renamed to a dashboard, nothing deep-linked to #crestudio,
// and the info popup listed eleven tabs that did not include it.
//
// So this spec locks the ENTRANCES as tightly as the behaviour. If a future
// consolidation renames the row or drops the hash link again, these fail rather
// than the feature quietly becoming unreachable a second time.
//
// It also locks the five operations (Fill / Suggest / New / Enhance / Clear),
// the media inputs that let a campaign start from an image or a video, and the
// standing rule that saving an asset builds the landing page it points at.
//
// /api/ai/generate is stubbed: the point is the contract between page and
// endpoint (what gets POSTed, what gets done with the reply), not the LLM.

const ROOT = path.join(__dirname, '..');

// Port 0, not a fixed number: the suite runs six device projects, each in its
// own worker, and every worker executes this beforeAll. A hardcoded port makes
// the second worker die with EADDRINUSE.
let server;
let BASE = '';
let lastReq = null;

test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);

    if (p.startsWith('/api/ai/generate')) {
      let body = '';
      for await (const c of req) body += c;
      lastReq = { query: Object.fromEntries(u.searchParams), body: JSON.parse(body || '{}') };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (u.searchParams.get('action') === 'landing-page') {
        return res.end(JSON.stringify({ ok: true, html: '<!doctype html><html><body><h1>LP</h1></body></html>' }));
      }
      if (lastReq.body.op === 'suggest') {
        return res.end(JSON.stringify({
          ok: true, op: 'suggest',
          suggestions: { name: ['Alpha name', 'Beta name', 'Gamma name'], headline: ['H one', 'H two', 'H three'] },
        }));
      }
      return res.end(JSON.stringify({
        ok: true, op: lastReq.body.op,
        text: JSON.stringify({ name: 'Stub ' + lastReq.body.op, obj: 'Traffic', budget: 55, market: 'UK', place: 'Feed', aud: 'aud', primary: 'primary', headline: 'headline' }),
        creative_spec: [{ size: '1080x1080', overlay: { headline: 'OV', sub: 'SUB', offer: 'OFFER' } }],
        master_prompt: 'MP',
        landing_page_brief: 'BRIEF FROM AD',
        reference_warnings: (lastReq.body.media || []).length ? ['Reference video could not be read (no vision provider).'] : [],
      }));
    }

    if (p === '/ads-master') p = '/ad-campaigns-master.html';
    if (p === '/landing-pages') p = '/landing-pages.html';
    const f = path.join(ROOT, p);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f);
      const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.json' ? 'application/json' : 'text/plain';
      res.writeHead(200, { 'Content-Type': type });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

// One viewport is enough: this is wiring, not layout.
test.use({ viewport: { width: 1280, height: 900 } });
test.describe.configure({ mode: 'serial' });

test.describe('ad creation is reachable and works', () => {
  test('the nav offers ad creation as its own destination, deep-linked to the builder', async ({ page }) => {
    await page.goto(`${BASE}/ad-campaigns-master.html`);
    const nav = await page.evaluate(() => {
      const src = document.querySelector('script[src^="/auth.js"]');
      return src ? 'loaded' : 'missing';
    });
    expect(nav).toBe('loaded');

    // The rail model is data in auth.js; assert on that rather than on a
    // rendered rail, which needs Supabase to boot.
    const authJs = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
    expect(authJs).toContain("href: '/ads-master#crestudio'");
    expect(authJs).toMatch(/id: 'ads',\s*label: 'Ad Creation \(Creative Studio\)'/);
    // The info popup must not claim a tab list that omits the builder.
    expect(authJs).not.toContain('Eleven tabs');
    expect(authJs).toContain('Creative Studio');
  });

  test('#crestudio opens the builder directly', async ({ page }) => {
    await page.goto(`${BASE}/ads-master#crestudio`);
    await expect(page.locator('#p-crestudio')).toHaveClass(/\bon\b/);
  });

  test('every ad form carries the five operations and the media inputs', async ({ page }) => {
    await page.goto(`${BASE}/ads-master#crestudio`);
    for (const surface of ['google', 'meta', 'tiktok']) {
      const ops = await page.$$eval(`.ai-bar[data-surface="${surface}"] [data-aisb-op]`,
        (els) => els.map((e) => e.getAttribute('data-aisb-op')));
      expect(ops, `${surface} operations`).toEqual(['fill', 'suggest', 'new', 'enhance', 'clear']);
      for (const sel of ['[data-aisb-img-url]', '[data-aisb-img-file]', '[data-aisb-vid-url]', '[data-aisb-vid-file]']) {
        await expect(page.locator(`.ai-bar[data-surface="${surface}"] ${sel}`)).toHaveCount(1);
      }
      // Every ad ships with its page: the toggle exists and starts on.
      await expect(page.locator(`.ai-bar[data-surface="${surface}"] [data-aisb-lp]`)).toBeChecked();
    }
  });

  test('a campaign can be built from an image and a video, and unread references are admitted', async ({ page }) => {
    await page.goto(`${BASE}/ads-master#crestudio`);
    await page.click('#p-crestudio .tab[data-tab="meta"]');
    const bar = '.ai-bar[data-surface="meta"]';
    await page.fill(`${bar} [data-ai-prompt]`, 'Launch the chai sampler in the UK');
    await page.fill(`${bar} [data-aisb-img-url]`, 'https://example.com/ad.jpg');
    await page.locator(`${bar} [data-aisb-vid-url]`).fill('https://example.com/clip.mp4');
    await page.locator(`${bar} [data-aisb-vid-url]`).blur();
    await expect(page.locator(`${bar} .aisb-chip`)).toHaveCount(2);

    await page.click(`${bar} [data-aisb-op="fill"]`);
    await expect(page.locator('#m-name')).toHaveValue('Stub fill');

    expect(lastReq.body.op).toBe('fill');
    expect(lastReq.body.media.map((m) => m.kind)).toEqual(['image', 'video']);
    // A select is written by fuzzy match, not by exact value.
    await expect(page.locator('#m-market')).toHaveValue('UK');
    // A reference the server could not read is stated, never silently dropped.
    await expect(page.locator(`${bar} .aisb-warn`)).toContainText('could not be read');
  });

  test('enhance works from the current draft rather than from nothing', async ({ page }) => {
    await page.goto(`${BASE}/ads-master#crestudio`);
    await page.click('#p-crestudio .tab[data-tab="meta"]');
    await page.fill('#m-name', 'Hand typed campaign');
    await page.click('.ai-bar[data-surface="meta"] [data-aisb-op="enhance"]');
    await expect(page.locator('#m-name')).toHaveValue('Stub enhance');
    expect(lastReq.body.op).toBe('enhance');
    expect(lastReq.body.current.name).toBe('Hand typed campaign');
  });

  test('suggest offers options and leaves the form alone until one is picked', async ({ page }) => {
    await page.goto(`${BASE}/ads-master#crestudio`);
    await page.click('#p-crestudio .tab[data-tab="meta"]');
    const bar = '.ai-bar[data-surface="meta"]';
    await page.fill('#m-name', 'Untouched');
    await page.click(`${bar} [data-aisb-op="suggest"]`);
    await expect(page.locator(`${bar} .aisb-sugg-o`)).toHaveCount(6);
    await expect(page.locator('#m-name')).toHaveValue('Untouched');
    await page.click(`${bar} .aisb-sugg-o[data-aisb-k="name"][data-aisb-i="1"]`);
    await expect(page.locator('#m-name')).toHaveValue('Beta name');
  });

  test('clear empties the form and drops the attachments', async ({ page }) => {
    await page.goto(`${BASE}/ads-master#crestudio`);
    await page.click('#p-crestudio .tab[data-tab="meta"]');
    const bar = '.ai-bar[data-surface="meta"]';
    await page.fill('#m-name', 'Something');
    await page.fill(`${bar} [data-aisb-img-url]`, 'https://example.com/a.jpg');
    await page.locator(`${bar} [data-aisb-img-url]`).blur();
    await expect(page.locator(`${bar} .aisb-chip`)).toHaveCount(1);
    await page.click(`${bar} [data-aisb-op="clear"]`);
    await expect(page.locator('#m-name')).toHaveValue('');
    await expect(page.locator(`${bar} .aisb-chip`)).toHaveCount(0);
  });

  test('saving a campaign builds the landing page it points at, from that ad own copy', async ({ page }) => {
    await page.goto(`${BASE}/ads-master#crestudio`);
    await page.click('#p-crestudio .tab[data-tab="meta"]');
    const bar = '.ai-bar[data-surface="meta"]';
    await page.fill(`${bar} [data-ai-prompt]`, 'chai sampler UK');
    await page.click(`${bar} [data-aisb-op="fill"]`);
    await expect(page.locator('#m-name')).toHaveValue('Stub fill');

    await page.click('#m-save');
    await expect(page.locator('#m-list')).toContainText('Landing page:');
    await expect(page.locator('#m-list')).toContainText('ready');

    expect(lastReq.query.action).toBe('landing-page');
    // Message match: the page brief is derived from the ad, not retyped.
    expect(String(lastReq.body.brief)).toContain('BRIEF FROM AD');

    await expect(page.locator('#m-list [data-lp-view]')).toHaveCount(1);
    await expect(page.locator('#m-list [data-lp-copy]')).toHaveCount(1);
    await expect(page.locator('#m-list [data-lp-dl]')).toHaveCount(1);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('vahdam-ads-v1')).landing.length);
    expect(stored).toBe(1);
  });

  test('unchecking the toggle is respected', async ({ page }) => {
    await page.goto(`${BASE}/ads-master#crestudio`);
    await page.click('#p-crestudio .tab[data-tab="meta"]');
    await page.uncheck('.ai-bar[data-surface="meta"] [data-aisb-lp]');
    await page.fill('#m-name', 'No page please');
    lastReq = null;
    await page.click('#m-save');
    await expect(page.locator('#m-list')).toContainText('No page please');
    expect(lastReq === null || lastReq.query.action !== 'landing-page').toBe(true);
  });

  test('the landing-page builder carries the same five operations', async ({ page }) => {
    await page.goto(`${BASE}/landing-pages`);
    const bar = '.ai-bar[data-surface="lp-mailer"]';
    await expect(page.locator(`${bar} [data-aisb-op]`)).toHaveCount(5);
    const ops = await page.$$eval(`${bar} [data-aisb-op]`, (els) => els.map((e) => e.getAttribute('data-aisb-op')));
    expect(ops).toEqual(['fill', 'suggest', 'new', 'enhance', 'clear']);
    await expect(page.locator(`${bar} [data-aisb-vid-url]`)).toHaveCount(1);
    // This page IS the landing-page builder, so the auto-page toggle would be circular.
    await expect(page.locator(`${bar} [data-aisb-lp]`)).toHaveCount(0);

    await page.fill(`${bar} [data-ai-prompt]`, 'page for the chai sampler');
    await page.click(`${bar} [data-aisb-op="fill"]`);
    await expect.poll(() => lastReq && lastReq.body.surface).toBe('lp-mailer');
  });
});
