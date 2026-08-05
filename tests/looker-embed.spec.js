const { test, expect } = require('@playwright/test');
const path = require('path');

// The embedded Looker Studio report is the dashboard's first EXTERNAL panel,
// and it breaks two assumptions every other view satisfies.
//
// 1. Every other view is computed from the uploaded dataset, so the page hides
//    them all behind `body.no-data .view.active { display:none }`. This report
//    carries its own data and never reads the CSV, so that gate would have made
//    it invisible until someone uploaded a file it does not use - which reads as
//    a broken embed, not as a missing upload.
// 2. It is a third-party request. Firing it on page load would mean every
//    visitor to the dashboard hits Google whether or not they open the view.
//
// Looker Studio exposes no data API, so the iframe is the only integration
// available; these tests pin the two properties that make it behave.

const REPORT_ID = 'b5c3af25-b396-4daf-aede-431d0b494793';
const PAGE_URL = 'file://' + path.join(__dirname, '..', 'dashboard.html');
// Stubbed so the suite never depends on Google being reachable or on the
// report's sharing settings, which this repo cannot control.
const stub = (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>stub</p>' });

// Four of the six projects are <=1024px (320-810), where the sidebar is an
// off-canvas drawer at translateX(-100%). The nav item is in the DOM but sits
// outside the viewport, so it has to be opened the way a real user does before
// any view is reachable. Reaching into the DOM to force the click instead would
// pass while telling us nothing about whether the view is actually reachable.
async function openView(page, view) {
  const mobile = await page.evaluate(() => window.matchMedia('(max-width: 1024px)').matches);
  if (mobile) {
    await page.locator('#sbMobileToggle').click();
    await expect(page.locator('aside.sidebar')).toBeInViewport();
  }
  await page.locator(`.nav-item[data-view="${view}"]`).click();
}

test.describe('the embedded Looker Studio report', () => {
  test('is reachable and visible with NO uploaded data', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**lookerstudio.google.com/**', stub);
    await page.goto(PAGE_URL);
    await page.waitForTimeout(600);

    // Establish that the dashboard really is in the state that hides views.
    expect(await page.evaluate(() => document.body.classList.contains('no-data')),
      'precondition: dashboard should be in its empty state').toBe(true);

    await expect(page.locator('.nav-item[data-view="looker"]'),
      'the view needs its own nav entrance').toHaveCount(1);
    await openView(page, 'looker');
    await page.waitForTimeout(400);

    // The assertion the no-data exemption exists for.
    await expect(page.locator('.view[data-view="looker"]')).toBeVisible();
    const frame = page.locator('#lookerFrame');
    await expect(frame).toBeVisible();
    expect(await frame.getAttribute('src')).toContain(`embed/reporting/${REPORT_ID}`);

    // The escape hatch must work even when the embed cannot render.
    expect(await page.locator('#lookerOpen').getAttribute('href')).toContain(`reporting/${REPORT_ID}`);
    await expect(page.locator('#lookerHelp'),
      'a private report frames a sign-in page; the reason must be stated').toBeVisible();

    // The exemption must be surgical: other views stay gated.
    await openView(page, 'exec');
    await page.waitForTimeout(300);
    await expect(page.locator('.view[data-view="exec"]')).toBeHidden();

    // Tailwind comes from a CDN that is unreachable in an offline file:// run;
    // ignore only that, so a real script error still fails the test.
    expect(errors.filter((e) => !/tailwind/i.test(e))).toEqual([]);
  });

  test('does not request the third party until the view is opened', async ({ page }) => {
    const hits = [];
    await page.route('**lookerstudio.google.com/**', (r) => { hits.push(r.request().url()); stub(r); });
    await page.goto(PAGE_URL);
    await page.waitForTimeout(700);
    expect(hits, 'the embed loaded before anyone opened the view').toEqual([]);

    // No scrolling: opening the view must be enough on its own. The panel is
    // tall, so on a phone the frame starts below the fold - this originally
    // failed on iphone-se and iphone-12 because loading="lazy" deferred the load
    // a second time, on scroll position, and the viewer saw an empty box.
    await openView(page, 'looker');
    await page.waitForTimeout(600);
    expect(hits.length, 'opening the view should mount the embed, without scrolling').toBeGreaterThan(0);

    // Guard the cause, not just the symptom: withholding the src until
    // activation is what makes the request lazy, and it is deterministic.
    // loading="lazy" on top of it re-introduces a scroll dependency.
    expect(await page.locator('#lookerFrame').getAttribute('loading'),
      'loading="lazy" defers the embed on scroll position, so a phone shows an empty panel').toBeNull();
  });

  test('does not carry the session token from a browser URL', async ({ page }) => {
    await page.route('**lookerstudio.google.com/**', stub);
    await page.goto(PAGE_URL);
    await openView(page, 'looker');
    await page.waitForTimeout(400);
    // `?s=<token>` on a Looker browser URL is a session artefact. It grants no
    // access, goes stale, and pasting one into a committed page implies it does
    // something. Access comes from the report's sharing settings only.
    const src = await page.locator('#lookerFrame').getAttribute('src');
    expect(src).not.toContain('s=');
    const href = await page.locator('#lookerOpen').getAttribute('href');
    expect(href).not.toContain('s=');
  });
});
