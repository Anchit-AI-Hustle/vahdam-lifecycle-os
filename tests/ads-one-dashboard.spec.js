// ONE ads dashboard, region-mapped ad accounts.
//
// Two product-owner rules are locked here:
//  1. Ad analysis has a single LHS entrance - the Ad Campaigns Master Dashboard -
//     and every unique analysis lives on it, including the cross-platform Live Ads
//     Intelligence view that used to be a separate Data Analysis tab.
//  2. Wherever a region can be chosen, the next level down is an ad-account
//     dropdown built from the REAL registry (data/ads/ad-accounts.json), mapped
//     region-wise and labelled with the real account id.
//
// The fixture deliberately mixes states - two platforms live, one unconnected, one
// account failing - because the thing most likely to rot is not the layout but the
// honesty: a blocked platform must never render as a zero, and a partial read must
// never render as a complete one.
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let server, BASE;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      // Two platforms live (one partially), one not connected — the honest mix.
      return res.end(JSON.stringify({
        ok: true, generated_at: '2026-08-06T10:00:00Z', market: 'US', level: 'ad',
        window: { since: '2020-01-01', until: '2026-08-06' }, freshness: 'Fetched on request.',
        connected_platforms: ['meta', 'google'], pending_platforms: ['tiktok'],
        accounts_read: ['1303870183798748', '804570870670763', '9797311905'],
        account_errors: [{ platform: 'google', account_id: '3036820580', error: 'PERMISSION_DENIED' }],
        kpis: { spend: 5706.88, revenue: 18231.51, roas: 3.19, impressions: 175868, reach: 90210, clicks: 5644, ctr: 0.0321, cpc: 1.01, cpm: 32.45, conversions: 118, conversion_rate: 0.0209, cpa: 48.36 },
        platforms: [
          { platform: 'meta', connected: true, ok: true, source: 'meta_graph_insights_v25.0', fetched_at: '2026-08-06T10:00:00Z', need_env: [], rows: [1, 2] },
          { platform: 'google', connected: true, ok: true, source: 'google_ads_api_v24', need_env: [], rows: [1] },
          { platform: 'tiktok', connected: false, ok: false, need_env: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'], rows: [] },
        ],
        rows: [
          { platform: 'meta', level: 'ad', entity: 'TOF_ASC_GIF_ThatCoffeeThatCurbsCravings_18202025_CopyTest_AllPlacements', entity_id: '120210987654321098', campaign: 'Conversion_BCAP_Coffee_NewBuyers_LookalikeAudience_2025_Q3_Broad_Prospecting_v4', ad_group: 'AS_Broad_25-54', status: 'ACTIVE', account_id: '1303870183798748', spend: 3706.88, impressions: 120868, reach: 60210, frequency: 2.01, clicks: 3644, ctr: 0.0301, cpc: 1.02, cpm: 30.67, conversions: 88, conversion_rate: 0.0241, cpa: 42.12, revenue: 14231.51, roas: 3.84 },
          { platform: 'google', level: 'ad', entity: 'RSA — Darjeeling', entity_id: '778899', campaign: 'Search_Brand', ad_group: 'Brand_Exact', status: 'ENABLED', account_id: '9797311905', spend: 2000, impressions: 55000, reach: 30000, frequency: 1.1, clicks: 2000, ctr: 0.0363, cpc: 1.0, cpm: 36.36, conversions: 30, conversion_rate: 0.015, cpa: 66.67, revenue: 4000, roas: 2.0 },
        ],
        note: 'Fresh figures returned from all connected platforms.',
      }));
    }
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    const ext = path.extname(f);
    res.writeHead(200, { 'content-type': ext === '.json' ? 'application/json' : ext === '.js' ? 'text/javascript' : 'text/html' });
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, r));
  BASE = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(() => server && server.close());

test('Live Ads Intelligence: region + ad account, all fields, honest connector state', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/ad-campaigns-master.html');
  await page.waitForTimeout(1200);

  await page.click('#tabs button[data-p="liveintel"]');
  await page.waitForTimeout(900);

  // Region dropdown built from the real registry.
  const regions = await page.$$eval("#li-regionacct select[data-ra='region'] option", (o) => o.map((x) => x.value));
  expect(regions).toEqual(['US', 'UK', 'IN']);

  // Ad account dropdown, grouped by platform, showing real ids.
  const accts = await page.$$eval("#li-regionacct select[data-ra='account'] option", (o) => o.map((x) => x.textContent.trim()));
  console.log('US accounts:', JSON.stringify(accts, null, 1));
  expect(accts.join(' ')).toContain('1303870183798748');
  expect(accts.join(' ')).toContain('804570870670763');
  const groups = await page.$$eval("#li-regionacct select[data-ra='account'] optgroup", (o) => o.map((x) => x.label));
  console.log('platform groups:', groups);

  // Switching region repopulates accounts.
  await page.selectOption("#li-regionacct select[data-ra='region']", 'IN');
  await page.waitForTimeout(500);
  const inAccts = await page.$$eval("#li-regionacct select[data-ra='account'] option", (o) => o.map((x) => x.textContent.trim()));
  console.log('IN accounts:', inAccts);
  expect(inAccts.join(' ')).toContain('70950428');

  await page.selectOption("#li-regionacct select[data-ra='region']", 'US');
  await page.waitForTimeout(600);

  // All 20 columns rendered.
  const heads = await page.$$eval('#li-tbl th', (t) => t.map((x) => x.textContent.trim()));
  console.log('columns (' + heads.length + '):', heads.join(' | '));
  expect(heads.length).toBe(20);
  for (const c of ['Reach', 'Frequency', 'CPM', 'CVR', 'Entity ID', 'Level']) expect(heads).toContain(c);

  // Connector honesty: tiktok shows its blocker, not a zero.
  const conn = await page.textContent('#li-connectors');
  expect(conn).toContain('TIKTOK');
  expect(conn).toContain('TIKTOK_ACCESS_TOKEN');

  // Partial-read honesty.
  const contract = await page.textContent('#li-contract');
  expect(contract).toContain('accounts read');
  expect(contract).toContain('Partial');
  expect(contract).toContain('3036820580');

  // Geometry: no cell overflows, no two cells in a row overlap.
  const bad = await page.evaluate(() => {
    const over = [], hit = [];
    document.querySelectorAll('#li-tbl td').forEach((el) => { if (el.scrollWidth > el.clientWidth + 1) over.push(el.textContent.slice(0, 30)); });
    document.querySelectorAll('#li-tbl tr').forEach((tr, r) => {
      const b = [...tr.children].map((c) => c.getBoundingClientRect());
      for (let i = 1; i < b.length; i++) if (b[i].left < b[i - 1].right - 0.5) hit.push({ r, i });
    });
    return { over, hit, bodyScroll: document.body.scrollWidth > window.innerWidth + 1 };
  });
  console.log('geometry:', JSON.stringify(bad));
  expect(bad.over).toEqual([]);
  expect(bad.hit).toEqual([]);

  expect(errors, 'page errors: ' + errors.join(' | ')).toEqual([]);
});

test('every market selector is followed by a region-mapped ad account dropdown', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/ad-campaigns-master.html');
  await page.waitForTimeout(1200);

  // Creative Studio forms. Each channel is its own sub-tab, so open it first.
  await page.click('#tabs button[data-p="crestudio"]');
  await page.waitForTimeout(400);
  for (const [p, plat] of [['g', 'google'], ['m', 'meta'], ['t', 'tiktok']]) {
    await page.click(`#cre-tabs button[data-tab="${plat}"]`);
    await page.waitForTimeout(200);
    const opts = await page.$$eval('#' + p + '-account option', (o) => o.map((x) => x.textContent.trim()));
    console.log(p + ' (' + plat + ') US:', opts);
    expect(opts.length).toBeGreaterThan(0);
    // The dropdown is filtered to the platform the form actually builds for.
    expect(opts.join(' ').toLowerCase(), `${plat} form must not offer another platform's account`)
      .not.toMatch(new RegExp(['google', 'meta', 'tiktok'].filter((x) => x !== plat).join('|')));
  }

  // Meta US must offer BOTH live US Meta accounts — the DTC account and the
  // Target/Costco retail account are different scorecards, not one account.
  await page.click('#cre-tabs button[data-tab="meta"]');
  await page.waitForTimeout(200);
  const mOpts = await page.$$eval('#m-account option', (o) => o.map((x) => x.textContent));
  expect(mOpts.join(' ')).toContain('1303870183798748');
  expect(mOpts.join(' ')).toContain('804570870670763');

  // A market with no mapped account says so rather than offering a blank list.
  await page.selectOption('#m-market', 'EU');
  await page.waitForTimeout(200);
  const eu = await page.$$eval('#m-account option', (o) => o.map((x) => x.textContent.trim()));
  console.log('meta EU:', eu);
  expect(eu.join(' ')).toContain('No meta account mapped to EU');

  // Accounts tab picker.
  await page.click('#tabs button[data-p="accounts"]');
  await page.waitForTimeout(500);
  const accRegions = await page.$$eval("#acct-regionacct select[data-ra='region'] option", (o) => o.map((x) => x.value));
  console.log('accounts tab regions:', accRegions);
  expect(accRegions[0]).toBe('ALL');

  // Selecting a region narrows the feed table.
  const before = await page.$$eval('#acct-tbl tbody tr', (r) => r.length);
  await page.selectOption("#acct-regionacct select[data-ra='region']", 'UK');
  await page.waitForTimeout(400);
  const after = await page.$$eval('#acct-tbl tbody tr', (r) => r.length);
  console.log('feed rows all=' + before + ' uk=' + after);
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);

  expect(errors, 'page errors: ' + errors.join(' | ')).toEqual([]);
});
