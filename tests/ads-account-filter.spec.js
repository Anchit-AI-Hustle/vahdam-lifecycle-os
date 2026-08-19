const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

// The ACCOUNT chips on Live Now (Both / Target-Costco / DTC) re-rendered the
// page but only ever filtered the ADS TABLE. LVACCT was read in renderLiveAds
// and nowhere else, so the five KPI tiles kept showing the blended totals:
// picking "Target / Costco" displayed $136.27, which is DTC's $21.79 plus
// retail's $114.48. One account's heading over both accounts' money.
//
// A filter that visibly does nothing is worse than no filter at all, because
// the number looks answered.
//
// Every assertion here RUNS liveScope against the real snapshot shape and reads
// what it returned.

const ROOT = path.join(__dirname, '..');

// The real per-account figures from data/ads/ads-live-snapshot.json.
const SNAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ads', 'ads-live-snapshot.json'), 'utf8'));
const BY = SNAP.today.by_account;
const NOT_CONNECTED = { ok: false, connected: false };

let server; let origin;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, connected: false, hint: 'no live source in test' }));
    }
    const f = path.join(ROOT, u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname));
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f);
      res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.json' ? 'application/json' : 'text/plain' });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404); res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

test.describe('the account chips actually filter', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'behaviour test, one engine');
  test.use({ serviceWorkers: 'block' });

  async function load(page) {
    await page.goto(origin + '/ad-campaigns-master.html');
    await page.waitForFunction(() => window.__adsMaster && window.__adsMaster.liveScope);
    // The page fetches its own snapshot; make the fixture explicit either way.
    await page.evaluate((snap) => window.__adsMaster.setSnap(snap), SNAP);
  }
  const scope = (page, acct) => page.evaluate(({ a, nc }) => {
    window.__adsMaster.setAccount(a);
    return window.__adsMaster.liveScope(nc, false);
  }, { a: acct, nc: NOT_CONNECTED });

  test('the snapshot really does hold two accounts that sum to the blended total', () => {
    // Guards the premise: if this ever stops being true the rest is meaningless.
    const sum = BY.dtc.spend + BY.retail.spend;
    expect(Math.round(sum * 100) / 100).toBe(SNAP.today.spend_so_far);
    expect(BY.dtc.spend).not.toBe(BY.retail.spend);
  });

  test('"Both accounts" gives the blended total', async ({ page }) => {
    await load(page);
    const s = await scope(page, '');
    expect(s.scoped).toBe(false);
    expect(s.tot.spend).toBe(SNAP.today.spend_so_far);
    expect(s.liveN).toBe(SNAP.today.ads_live);
  });

  test('selecting one account gives THAT account, not the blend', async ({ page }) => {
    await load(page);
    const retail = await scope(page, 'retail');
    expect(retail.scoped).toBe(true);
    expect(retail.label).toBe('Target / Costco');
    expect(retail.tot.spend, 'the exact bug: retail showed the blended total').toBe(BY.retail.spend);
    expect(retail.tot.spend).not.toBe(SNAP.today.spend_so_far);
    expect(retail.tot.impressions).toBe(BY.retail.impressions);
    expect(retail.liveN).toBe(BY.retail.ads_live);

    const dtc = await scope(page, 'dtc');
    expect(dtc.tot.spend).toBe(BY.dtc.spend);
    expect(dtc.label).toBe('DTC');
    // The two selections must differ, or the filter is decorative.
    expect(dtc.tot.spend).not.toBe(retail.tot.spend);
  });

  test('the previous-day tile is scoped only where that day has the breakdown', async ({ page }) => {
    await load(page);
    const prev = SNAP.daily[SNAP.daily.length - 2];
    const retail = await scope(page, 'retail');
    if (prev && prev.accounts && prev.accounts.retail) {
      expect(retail.yest.spend).toBe(prev.accounts.retail.spend);
      expect(retail.yest.spend, 'previous day still blended').not.toBe(prev.spend);
    } else {
      // No per-account figures for that day: it must report nothing rather than
      // put a blended number under an account heading.
      expect(retail.yest).toBeNull();
    }
  });

  test('an account with no row reports nothing, never the blended fallback', async ({ page }) => {
    await load(page);
    const s = await scope(page, 'an-account-that-does-not-exist');
    expect(s.missing).toBe(true);
    expect(s.tot.spend).toBeNull();
    expect(s.liveN).toBeNull();
  });

  test('clicking a chip changes the rendered tiles on the page', async ({ page }) => {
    // End to end: the click handler, the re-render and the tiles together.
    await load(page);
    await page.evaluate((snap) => {
      window.__adsMaster.setSnap(snap);
      window.__adsMaster.setAccount('');
    }, SNAP);
    const chips = page.locator('#live-acct-chips button[data-lva]');
    await expect.poll(() => chips.count()).toBeGreaterThan(1);

    const readSpend = () => page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#live-cards .sc'));
      const c = cards.find((x) => /Spend/i.test(x.querySelector('.k').textContent));
      return c ? { k: c.querySelector('.k').textContent, v: c.querySelector('.v').textContent } : null;
    });

    await chips.filter({ hasText: 'Both accounts' }).click();
    const both = await readSpend();

    await chips.filter({ hasText: 'Target / Costco' }).click();
    const retail = await readSpend();

    expect(retail.v, `both=${both && both.v} retail=${retail.v}: the tile did not change`).not.toBe(both.v);
    // And the heading must name the account, so a scoped figure cannot be read
    // as the whole estate.
    expect(retail.k).toMatch(/Target \/ Costco/);
  });
});
