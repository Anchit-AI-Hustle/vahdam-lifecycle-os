const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

// SERVICE WORKERS ARE BLOCKED, AND THAT IS NOT A CONVENIENCE.
// auth.js registers sw.js on window 'load' - independent of init() - and its
// controllerchange handler calls location.reload() 50ms later as a deliberate
// PWA self-heal. Any spec that navigates and then reads page state is racing
// that reload: on a loaded machine it lands mid-assertion and the page is gone,
// which surfaces as "Execution context was destroyed, most likely because of a
// navigation". It passes when the file is run alone and fails in the full suite,
// which is what makes it look like a flake instead of a race.
// The SW is not under test here, so it is switched off.
test.use({ serviceWorkers: 'block' });

// The combined Revenue Analysis + Platform Agents report, mounted on the ads
// dashboard as a second view onto the SAME endpoints Data Analysis uses.
//
// This locks the entrance as well as the behaviour. Per CLAUDE.md, the way
// features die in this repo is not deletion — it is a consolidation that keeps
// the code and removes the nav row, the deep link and the INFO entry. Ad
// creation already vanished that way once.

const ROOT = path.join(__dirname, '..');
let server; let BASE = ''; let failNext401 = 0;

const REVENUE = {
  ok: true, market: 'US',
  summary: { orders: 11622, total_sales: 599059.36, net_sales: 506785.46, aov: 43.607, returning_rate: 0.5432 },
  coverage: { total_cuts: 5, available: 2, blocked: 3 },
  ad_accounts: { feeds: 15, live: 7, revenue_capable: 6, traffic_only: 9,
    by_platform: { meta: 8, google: 4, tiktok: 1 },
    note: 'traffic_only accounts are retail-media feeds whose checkout happens on a third-party site.' },
  cuts: [
    // Deliberately out of order: the page must sort paid media to the front.
    { key: 'channel', label: 'Revenue by sales channel', grain: 'channel', available: true,
      source: 'Shopify CSV export', rows: [{ channel: 'Online Store', orders: 17596, sales: 1002257.53, share_of_sales: 0.894 }] },
    { key: 'ad', label: 'Revenue by ad / creative', grain: 'ad', available: false, rows: [],
      blocker: 'meta: set META_ACCESS_TOKEN · google: set GOOGLE_ADS_DEVELOPER_TOKEN · tiktok: set TIKTOK_ACCESS_TOKEN' },
    { key: 'platform', label: 'Revenue by platform', grain: 'platform', available: false, rows: [],
      blocker: 'meta: set META_ACCESS_TOKEN, META_AD_ACCOUNT_ID' },
    { key: 'campaign', label: 'Revenue by campaign', grain: 'campaign', available: true,
      source: 'Ad platform reporting APIs — meta (2)',
      rows: [{ platform: 'Meta', campaign: 'Conversion_BCAP_Coffee', spend: 5706.88, revenue: 18231.51, roas: 3.19, ctr: 0.0321 }] },
    { key: 'adset', label: 'Revenue by ad set / ad group', grain: 'adset', available: false, rows: [], blocker: 'meta: set META_ACCESS_TOKEN' },
  ],
  excluded_sources: [{ source: 'supabase smart_orders', excluded_because: 'Seed fixtures, not real trade.' }],
  note: 'Every revenue cut is listed whether or not it has data.',
};

const AGENTS = {
  ok: true,
  coverage: { total: 7, connected: 0, analysed: 0, blocked: 7 },
  agents: [
    { agent: 'shopify', label: 'Shopify', connected: false, analysed: false, blocker: 'Set SHOPIFY_STORE_DOMAIN', insights: [], action_items: [] },
    { agent: 'tiktok', label: 'TikTok Ads', connected: false, analysed: false, blocker: 'Set TIKTOK_ACCESS_TOKEN', insights: [], action_items: [] },
    { agent: 'meta', label: 'Meta Ads', connected: false, analysed: false, blocker: 'Set META_ACCESS_TOKEN', insights: [], action_items: [] },
    { agent: 'google', label: 'Google Ads', connected: false, analysed: false, blocker: 'Set GOOGLE_ADS_DEVELOPER_TOKEN', insights: [], action_items: [] },
  ],
  action_queue: [
    { priority: 'P0', platform: 'Meta Ads', action: 'Connect Meta Ads', why: 'Set META_ACCESS_TOKEN', effort: 'low', owner: 'ops' },
    { priority: 'P0', platform: 'Google Ads', action: 'Connect Google Ads', why: 'Set GOOGLE_ADS_DEVELOPER_TOKEN', effort: 'low', owner: 'ops' },
  ],
  note: 'An unconnected platform is never analysed.',
};

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    if (p.startsWith('/api/public-config') && u.searchParams.get('action') === 'data-analysis') {
      const view = u.searchParams.get('view');
      // While failNext401 > 0, answer like the real endpoint does before
      // auth.js has produced a token: HTTP 401.
      if (failNext401 > 0) { failNext401--; res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"ok":false,"error":"operator_session_required"}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(view === 'agents' ? AGENTS : REVENUE));
    }
    // Everything else the page reaches for is irrelevant here.
    if (p.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":false}'); }
    if (p === '/ads-master') p = '/ad-campaigns-master.html';
    const f = path.join(ROOT, p);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
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

test.use({ viewport: { width: 1280, height: 900 } });
test.describe.configure({ mode: 'serial' });

async function openPanel(page) {
  await blockExternal(page, BASE);
  await page.goto(`${BASE}/ads-master`, { waitUntil: 'domcontentloaded' });
  await page.click('#tabs button[data-p="revenue"]');
  await expect(page.locator('#p-revenue')).toHaveClass(/\bon\b/);
  await expect(page.locator('#rev-kpis .card').first()).toBeVisible();
}


/**
 * Only our own server may be waited on. The pages under test link Google Fonts,
 * Vercel speed-insights, esm.sh and Shopify CDN images; in CI none of them
 * resolve, and page.goto waits on them. Measured on the homepage: goto took
 * 13,035ms with them and 210ms without, which is what pushed sibling specs past
 * the 60s test timeout. Aborting them is also what makes an offline CI run
 * behave like the offline run it actually is.
 */
function blockExternal(page, own) {
  return page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(own) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort('failed');
  });
}

test('the report has its own entrance on the ads dashboard', async ({ page }) => {
  await blockExternal(page, BASE);
  await page.goto(`${BASE}/ads-master`, { waitUntil: 'domcontentloaded' });
  const btn = page.locator('#tabs button[data-p="revenue"]');
  await expect(btn).toHaveCount(1);
  await expect(btn).toContainText('Revenue');
  await expect(page.locator('#p-revenue')).toHaveCount(1);
});

test('opening it loads the real summary from the shared endpoint', async ({ page }) => {
  await openPanel(page);
  const kpis = await page.locator('#rev-kpis .card').allTextContents();
  const joined = kpis.join(' | ');
  expect(joined).toContain('Orders');
  expect(joined).toMatch(/11,622/);
  expect(joined).toMatch(/\$599,059|\$599,060/);
  expect(joined).toContain('2 / 5');
});

test('the ad account estate is stated, including how many cannot report revenue', async ({ page }) => {
  await openPanel(page);
  const t = await page.locator('#rev-accounts').textContent();
  expect(t).toContain('15 feeds');
  expect(t).toContain('6');   // revenue capable
  expect(t).toContain('9');   // traffic only
  expect(t).toMatch(/traffic-only/i);
});

test('paid-media cuts are ordered first — this is the ads dashboard', async ({ page }) => {
  await openPanel(page);
  const order = await page.locator('#rev-cutnav button[data-cut]').evaluateAll(
    (els) => els.map((e) => e.dataset.cut));
  expect(order.slice(0, 4)).toEqual(['platform', 'campaign', 'adset', 'ad']);
  // The non-paid cut is still reachable — scope stays visible.
  expect(order).toContain('channel');
});

test('a cut with no connected source shows the blocker, never zeroes', async ({ page }) => {
  await openPanel(page);
  // "platform" is first and unavailable, so it renders on open.
  const body = await page.locator('#rev-cut').textContent();
  expect(body).toMatch(/not available/i);
  expect(body).toContain('META_ACCESS_TOKEN');
  await expect(page.locator('#rev-cut table')).toHaveCount(0);
  expect(body).not.toMatch(/\$0\b/);
});

test('an available cut renders its rows with real figures', async ({ page }) => {
  await openPanel(page);
  await page.click('#rev-cutnav button[data-cut="campaign"]');
  await expect(page.locator('#rev-cut table')).toHaveCount(1);
  const body = await page.locator('#rev-cut').textContent();
  expect(body).toContain('Conversion_BCAP_Coffee');
  expect(body).toContain('3.19x');       // roas formatted
  expect(body).toMatch(/\$5,707|\$5,706/); // spend as money
  expect(body).toContain('Ad platform reporting APIs');
});

test('agents render with the ad platforms first and a ranked action queue', async ({ page }) => {
  await openPanel(page);
  await expect(page.locator('#rev-agents .card').first()).toBeVisible();
  const titles = await page.locator('#rev-agents .card h4').allTextContents();
  expect(titles[0]).toContain('Meta');
  expect(titles[1]).toContain('Google');
  expect(titles[2]).toContain('TikTok');
  // No data, so no insights may be shown for any agent.
  await expect(page.locator('#rev-agents .card ul')).toHaveCount(0);
  const q = await page.locator('#rev-actions').textContent();
  expect(q).toContain('Connect Meta Ads');
  expect(q).toContain('P0');
});

test('a 401 does not brick the panel: it un-latches and Retry reloads', async ({ page }) => {
  // Codex caught the race: opening #revenue before auth.js finishes yields an
  // empty token, both calls 401, and the old latch made switching away and
  // back a no-op — the panel stayed dead. Now a failed load un-latches and
  // offers Retry.
  failNext401 = 2; // both calls of the first open fail like the real race
  await blockExternal(page, BASE);
  await page.goto(`${BASE}/ads-master`, { waitUntil: 'domcontentloaded' });
  await page.click('#tabs button[data-p="revenue"]');
  await expect(page.locator('#rev-kpis')).toContainText(/sign in/i);
  const retry = page.locator('#rev-retry');
  await expect(retry).toHaveCount(1);
  await retry.click(); // auth has "arrived" — the stub now answers 200
  await expect(page.locator('#rev-kpis .card').first()).toBeVisible();
  await expect(page.locator('#rev-kpis')).toContainText('Orders');
});

test('the panel does not fetch until it is opened', async ({ page }) => {
  const calls = [];
  // blockExternal FIRST: Playwright matches routes in reverse registration order,
  // so a block registered after this counting route would win for /api/* too and
  // continue() the request without the counter ever seeing it - the count then
  // reads 0 and looks like "the panel never fetched".
  await blockExternal(page, BASE);
  await page.route('**/api/public-config**', (route) => { calls.push(route.request().url()); route.continue(); });
  await page.goto(`${BASE}/ads-master`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const before = calls.filter((u) => u.includes('data-analysis')).length;
  await page.click('#tabs button[data-p="revenue"]');
  await expect(page.locator('#rev-kpis .card').first()).toBeVisible();
  const after = calls.filter((u) => u.includes('data-analysis')).length;
  expect(before, 'must not fetch the report on page load').toBe(0);
  expect(after, 'opening the tab fetches revenue + agents').toBe(2);
});
