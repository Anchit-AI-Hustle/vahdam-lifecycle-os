const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Insights / Actionables / Creative Analysis on the ads dashboard.
//
// These three panels are the highest-risk surface in the app for fabrication:
// they read as analyst judgement, so a made-up observation about ad spend gets
// ACTED ON. The rules therefore only ever emit a finding that cites figures from
// the rows it was given, and an unconnected platform must reach the screen as
// its own blocker rather than as an empty table — an empty table reads as "no
// activity", which is a different and much more damaging claim than "not
// connected".

const ROOT = path.join(__dirname, '..');

// Count Vercel Serverless Function files WITHOUT a shell. The obvious version
// shells out to `find` with a path built from __dirname, and CodeQL flags that
// (correctly) as a command built from an uncontrolled absolute path — the same
// finding this repo already hit once in ads-one-dashboard.spec.js. A directory
// walk needs no shell, no quoting, and no interpolation of any path into a
// command string, so the whole class of issue disappears rather than being
// escaped around.
function functionFileCount(dir = path.join(ROOT, 'api'), depth = 0) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_shared') continue;   // _shared is excluded by Vercel
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (depth < 6) n += functionFileCount(full, depth + 1); }
    else if (entry.name.endsWith('.js')) n += 1;
  }
  return n;
}

const engine = require(path.join(ROOT, 'api', '_shared', 'ads-insight-engine.js'));

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
const PAGE = fs.readFileSync(path.join(ROOT, 'ad-campaigns-master.html'), 'utf8');
const BRAIN = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');

const ROWS = [
  { campaign_name: 'Prospecting', platform: 'meta', spend: 4820.5, impressions: 912000, clicks: 5100, reach: 210000, frequency: 4.34, conversions: 0, video_3s_views: 120000, video_p75_watched: 9000, currency: '$' },
  { campaign_name: 'Retargeting', platform: 'meta', spend: 1210, impressions: 180000, clicks: 4300, reach: 90000, frequency: 2.0, conversions: 96, revenue: 7400, video_3s_views: 70000, video_p75_watched: 31000, currency: '$' },
  { campaign_name: 'Gifting', platform: 'meta', spend: 640.25, impressions: 150000, clicks: 520, reach: 120000, frequency: 1.25, conversions: 4, revenue: 210, currency: '$' },
  { campaign_name: 'Supplements', platform: 'meta', spend: 310, impressions: 40000, clicks: 120, reach: 35000, frequency: 1.14, conversions: 0, currency: '$' },
  { campaign_name: 'Lookalike', platform: 'meta', spend: 980, impressions: 220000, clicks: 1900, reach: 150000, frequency: 1.47, conversions: 41, revenue: 3100, currency: '$' },
];

test.describe('nothing is invented when there is nothing to analyse', () => {
  test('no rows produces no insights and no actions', () => {
    const i = engine.deriveInsights([]);
    const a = engine.deriveActionables([]);
    expect(i.insights).toEqual([]);
    expect(a.actions).toEqual([]);
    // And it says so, rather than returning an empty list with no explanation.
    expect(i.note).toMatch(/nothing is analysed|Nothing is inferred/i);
  });

  test('every insight cites evidence drawn from the rows it was given', () => {
    const { insights } = engine.deriveInsights(ROWS);
    expect(insights.length).toBeGreaterThan(0);
    const names = ROWS.map((r) => r.campaign_name);
    for (const ins of insights) {
      expect(ins.title, `${ins.id} has no title`).toBeTruthy();
      expect(ins.detail, `${ins.id} has no detail`).toBeTruthy();
      // A finding with no citable evidence is exactly the shape of a fabricated
      // one, so the only insight allowed to carry none is the one whose entire
      // point is that a metric is ABSENT.
      if (ins.id !== 'no-conversion-coverage') {
        expect(ins.evidence.length, `${ins.id} cites nothing`).toBeGreaterThan(0);
        for (const e of ins.evidence) expect(names).toContain(e.name);
      }
    }
  });

  test('an action is only proposed where there is something specific to do', () => {
    const { actions } = engine.deriveActionables(ROWS);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(a.action).toBeTruthy();
      expect(a.why, 'an action with no justification is a guess').toBeTruthy();
      expect(a.target_metric).toBeTruthy();
      // "Monitor performance" is not an action and must never appear.
      expect(a.action.toLowerCase()).not.toMatch(/^monitor\b|keep an eye/);
    }
  });
});

test.describe('null is not zero', () => {
  test('rows without conversion tracking are not reported as zero-conversion', () => {
    // The warehouse mirror has no conversion column. Counting those nulls as 0
    // would report "these campaigns sold nothing" when the truth is "this source
    // cannot see sales" — the single most damaging misread available here.
    const noConv = ROWS.map(({ conversions, revenue, ...rest }) => rest);
    const { insights } = engine.deriveInsights(noConv);
    expect(insights.find((i) => i.id === 'zero-conversion-spend'), 'null conversions were treated as zero').toBeFalsy();
    const cov = insights.find((i) => i.id === 'no-conversion-coverage');
    expect(cov, 'the absence of conversion data was not reported at all').toBeTruthy();
    expect(cov.detail).toMatch(/property of the source, not a result of zero sales/i);
  });

  test('zero-conversion is reported only for rows that actually measure zero', () => {
    const { insights } = engine.deriveInsights(ROWS);
    const dead = insights.find((i) => i.id === 'zero-conversion-spend');
    expect(dead).toBeTruthy();
    // Prospecting (4820.50) + Supplements (310) are the only measured zeros.
    expect(dead.value).toBeCloseTo(5130.5, 2);
    expect(dead.evidence.map((e) => e.name).sort()).toEqual(['Prospecting', 'Supplements']);
  });
});

test.describe('creative analysis distinguishes the failure it can see', () => {
  test('a weak hook and a weak hold are named differently', () => {
    const { creatives } = engine.deriveCreativeAnalysis(ROWS);
    const pros = creatives.find((c) => c.name === 'Prospecting');
    // 120k 3-second views on 912k impressions = 13.2% hook.
    expect(pros.hook_rate).toBeCloseTo(13.16, 1);
    expect(pros.diagnosis).toMatch(/Weak hook/i);
    const ret = creatives.find((c) => c.name === 'Retargeting');
    expect(ret.hook_rate).toBeGreaterThan(20);
    expect(ret.diagnosis).not.toMatch(/Weak hook/i);
  });

  test('a row with no video metrics is not judged as a bad creative', () => {
    const { creatives, coverage } = engine.deriveCreativeAnalysis(ROWS);
    const gift = creatives.find((c) => c.name === 'Gifting');
    expect(gift.hook_rate).toBeNull();
    expect(gift.diagnosis).toMatch(/cannot be computed|Not a judgement/i);
    expect(coverage.with_video_metrics).toBe(2);
  });
});

test.describe('the dashboard renders the blocker, never a bare empty table', () => {
  const PAYLOAD = (connected) => (connected
    ? { ok: true, rows_analysed: ROWS.length, connected: true, blockers: [], fetched_at: new Date().toISOString(), window: { since: '2026-07-13', until: '2026-08-12' }, ...engine.deriveInsights(ROWS), ...engine.deriveActionables(ROWS), ...engine.deriveCreativeAnalysis(ROWS) }
    : { ok: true, rows_analysed: 0, connected: false, fetched_at: new Date().toISOString(), blockers: [{ platform: 'meta', blocker: 'Set META_ACCESS_TOKEN, META_AD_ACCOUNT_ID in Vercel env.', need_env: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'], would_request: { method: 'GET', url: 'https://graph.facebook.com/v25.0/act_X/insights' } }], ...engine.deriveInsights([]), ...engine.deriveActionables([]), ...engine.deriveCreativeAnalysis([]) });

  async function open(page, connected, tab) {
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/*', (r) => {
      const u = r.request().url();
      if (u.includes('action=ads-analysis')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(PAYLOAD(connected)) });
      if (u === 'https://ads.test/') return r.fulfill({ contentType: 'text/html', body: PAGE });
      if (u.startsWith('https://ads.test/')) return r.fulfill({ status: 204, body: '' });
      if (u.includes('lookerstudio')) return r.fulfill({ contentType: 'text/html', body: '<p>stub</p>' });
      return r.abort();
    });
    await page.goto('https://ads.test/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.click(`#tabs button[data-p="${tab}"]`);
    await page.waitForTimeout(700);
    return errs;
  }

  test('with no credentials, each panel names the missing env vars', async ({ page }) => {
    const errs = await open(page, false, 'insights');
    const t = await page.locator('#insOut').textContent();
    expect(t).toContain('Not connected');
    expect(t).toContain('META_ACCESS_TOKEN');
    // The promise that makes this safe to look at.
    expect(t).toMatch(/No figure is estimated/i);
    expect(errs).toEqual([]);
  });

  test('with live rows, real figures reach the screen', async ({ page }) => {
    await open(page, true, 'insights');
    const t = await page.locator('#insOut').textContent();
    expect(t).not.toContain('Not connected');
    expect(t).toContain('5130.50');   // the measured zero-conversion spend
    expect(t).toMatch(/Prospecting/);
  });

  test('creative analysis shows hook and through rate per creative', async ({ page }) => {
    await open(page, true, 'creativeanalysis');
    const t = await page.locator('#craOut').textContent();
    expect(t).toContain('Hook %');
    expect(t).toContain('Through %');
    expect(t).toMatch(/Weak hook/i);
  });
});

test.describe('wiring', () => {
  test('all four tabs exist with panels, and there is still ONE ads dashboard', () => {
    for (const t of ['insights', 'actionables', 'creativeanalysis', 'looker']) {
      expect(PAGE, `tab ${t} missing`).toContain(`data-p="${t}"`);
      expect(PAGE, `panel ${t} missing`).toContain(`id="p-${t}"`);
    }
    // CLAUDE.md's standing rule: ad analysis lives on this page and nowhere else.
    expect(fs.existsSync(path.join(ROOT, 'ads-insights.html'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'ads-looker.html'))).toBe(false);
  });

  test('the analysis route adds no Serverless Function', () => {
    // The Hobby cap is 12 and the repo sits at 12, so this had to be one more
    // case on an existing router with the engine in _shared.
    expect(BRAIN).toContain("case 'ads-analysis'");
    expect(fs.existsSync(path.join(ROOT, 'api', 'ads-analysis.js'))).toBe(false);
    expect(functionFileCount()).toBeLessThanOrEqual(12);
  });

  test('the Looker report is lazy: no third-party request until the tab opens', async ({ page }) => {
    const hits = [];
    await page.route('**/*', (r) => {
      const u = r.request().url();
      if (u.includes('lookerstudio')) { hits.push(u); return r.fulfill({ contentType: 'text/html', body: '<p>stub</p>' }); }
      if (u === 'https://ads.test/') return r.fulfill({ contentType: 'text/html', body: PAGE });
      if (u.startsWith('https://ads.test/')) return r.fulfill({ status: 204, body: '' });
      return r.abort();
    });
    await page.goto('https://ads.test/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    expect(hits, 'Google was contacted before anyone opened the report').toEqual([]);
    await page.click('#tabs button[data-p="looker"]');
    await page.waitForTimeout(700);
    expect(hits.length, 'opening the tab did not load the report').toBeGreaterThan(0);
  });

  test('the analysis tabs are registered with the shared sync layer', () => {
    expect(PAGE).toContain('ads:analysis');
    // And the registration must report `unavailable` when the panel is showing a
    // blocker — a sync bar showing green over a "not connected" panel would be
    // the same lie the Klaviyo health check told.
    const reg = PAGE.slice(PAGE.indexOf('ads:analysis'), PAGE.indexOf('ads:analysis') + 1400);
    expect(reg).toContain('unavailable');
  });
});
