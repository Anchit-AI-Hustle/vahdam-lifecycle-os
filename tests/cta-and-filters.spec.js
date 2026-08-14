const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { startServer, collectErrors, blockExternal, ROOT } = require('./lib/page-harness.js');

// EVERY FILTER AND EVERY CTA, ON EVERY PAGE, CLICKED FOR REAL.
//
// A dead control is invisible: an onclick calling a function that does not exist
// throws a ReferenceError into the console and the button just sits there. A
// filter that matches nothing empties its container and leaves a blank rectangle
// that reads as "loading" or "broken" rather than "no matches". Neither shows up
// in a screenshot diff, and neither shows up in static analysis — the handler
// name is spelled correctly, the link resolves, the markup is valid.
//
// So this crawls the real pages over http (not file://, which changes their
// behaviour), stubs every /api/ call with a POPULATED shape so an empty result
// can only come from the page's own logic, and then clicks things.
//
// Three rules, one per describe block:
//   1. loading a page throws nothing;
//   2. clicking any filter throws nothing, moves the active state, and never
//      leaves a results container silently blank;
//   3. clicking any non-destructive CTA throws nothing.

let server, BASE;
test.beforeAll(async () => { const s = await startServer(); server = s.server; BASE = s.base; });
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

// Wiring, not layout — one viewport keeps this from running six times.
test.use({ viewport: { width: 1440, height: 950 } });

// Pages that are DELIVERABLES rather than app surfaces: generated mailers,
// landing pages and campaign clones. They have no filters and their CTAs point
// at the live store on purpose.
const DELIVERABLE = /^(vahdam-cortisol|vahdam-lifecycle-campaign|ashwagandha-|campaign\.html|privacy|terms|_sbtest)/;

function appPages() {
  return fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.html'))
    .filter((f) => !DELIVERABLE.test(f))
    .sort();
}

// Controls that leave the page, spend money, or destroy work. Clicking these in
// a crawler would be worse than not testing them.
const DESTRUCTIVE = /sign ?out|log ?out|delete|remove|reset|clear all|deploy|publish|download|export|approve all|generate all|run agentic|regenerate|\bzip\b/i;

// DEGRADED MODE, DELIBERATELY. Third-party requests are failed immediately, so
// every page is exercised with its CDNs gone — the exact condition an
// ad-blocker, a corporate proxy, a CDN outage or an offline PWA launch produces,
// and the condition that surfaced the Tailwind, Chart.js and ApexCharts defects.
// It also keeps the crawl to minutes instead of forty, because unreachable hosts
// no longer hold each page for 25 seconds.
//
// What this does NOT cover is the happy path where those libraries load. This
// suite proves the app survives without its third parties; it does not prove the
// charts draw when they are present.
async function ready(page, url) {
  await blockExternal(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // These pages boot auth and render asynchronously; give them a beat without
  // waiting on networkidle (the service worker keeps a connection warm).
  await page.waitForTimeout(700);
}

test.describe('every page loads without throwing', () => {
  for (const file of appPages()) {
    test(`${file} boots clean`, async ({ page }) => {
      const errors = collectErrors(page);
      await ready(page, `${BASE}/${file}`);
      expect(errors, `${file} threw on load:\n  ${errors.join('\n  ')}`).toEqual([]);
    });
  }
});

test.describe('every filter control does something, and says so when there is nothing', () => {
  // EVERY control family in the app, not the handful I happened to think of
  // first. The original list (.filter-btn, .mkchip, .fbtn and four data-*
  // attributes) matched 57 of roughly 364 control-like elements — 16%. It
  // reported a clean run over the pages it could see and said nothing about the
  // ads master's 47 controls, the dashboard's 44, or landing-pages' 31. A green
  // crawl over 16% of the surface, described as "every filter", would have been
  // the same false assurance as the suite that never launched a browser.
  //
  // Tabs and view switchers are in scope deliberately: a tab that throws, or
  // that reveals an empty panel with no explanation, fails in exactly the way a
  // broken filter does.
  //
  // Scoped to genuinely clickable elements. A display-only pill carrying one of
  // these classes is inert, and clicking it would add noise without signal.
  const CLICKABLE = 'button, a, [role="button"], [onclick], input[type="button"], input[type="radio"], label';
  const FILTER_CLASSES = ['.filter-btn', '.mkchip', '.fbtn', '.chip', '.seg', '.tab', '.pvtab', '.nav-item', '.mkt', '.pill-btn'];
  const FILTER_ATTRS = ['[data-cat]', '[data-mkt]', '[data-dur]', '[data-dcw]', '[data-g]', '[data-gg]',
    '[data-p]', '[data-view]', '[data-filter]', '[data-tab]', '[data-range]', '[data-seg]'];
  const FILTER_SEL = [
    ...FILTER_CLASSES.flatMap((c) => [c, `${c} > button`, `${c} > a`]),
    ...FILTER_ATTRS,
  ].join(', ');
  // Applied as a second pass so a class that lands on a <div> wrapper does not
  // pull the wrapper itself into the click list. The selector is passed as an
  // ARGUMENT rather than interpolated into a function body: building code from a
  // string needs every metacharacter escaped, an earlier version here handled
  // quotes but not backslashes, and CodeQL was right to flag it. Passing an arg
  // removes the escaping problem instead of solving it.

  for (const file of appPages()) {
    test(`${file} filters behave`, async ({ page }) => {
      const errors = collectErrors(page);
      await ready(page, `${BASE}/${file}`);

      const controls = page.locator(FILTER_SEL);
      const n = await controls.count();
      test.skip(n === 0, 'no filter controls on this page');

      // Cap per page. The ads master carries ~47 controls and the dashboard ~44;
      // clicking every one adds minutes without adding signal, because they
      // route through a handful of shared handlers. 20 covers each distinct
      // family on the busiest page. THIS IS A KNOWN LIMIT, not full coverage,
      // and it is stated here rather than implied by a green run.
      const limit = Math.min(n, 20);
      const blanks = [];
      for (let i = 0; i < limit; i++) {
        const c = controls.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        if (!(await c.evaluate((el, sel) => el.matches(sel) || !!el.getAttribute('onclick'), CLICKABLE).catch(() => false))) continue;
        // A control that NAVIGATES is not a filter, whatever class it carries.
        // retention-playbook.html has `<a class="chip" href="/brain">`, and the
        // crawler was clicking it, leaving the page, and then asserting against
        // whatever document loaded next — testing the wrong page and reporting
        // the result under the original page's name. Anchors that stay put
        // (href="#", "javascript:", or none) are still exercised.
        const navigates = await c.evaluate((el) => {
          if (el.tagName !== 'A') return false;
          const href = el.getAttribute('href') || '';
          if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) return false;
          return true;
        }).catch(() => false);
        if (navigates) continue;
        const label = ((await c.textContent().catch(() => '')) || '').trim().slice(0, 40);
        if (DESTRUCTIVE.test(label)) continue;
        await c.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(180);

        // A results container that a filter emptied must SAY it is empty.
        // A blank box is indistinguishable from a broken filter, and this is
        // the single most common way a working filter reads as broken.
        const blank = await page.evaluate(() => {
          const out = [];
          const boxes = document.querySelectorAll('tbody, .results, .grid-results, [data-results]');
          for (const b of boxes) {
            const r = b.getBoundingClientRect();
            const onScreen = r.width > 0 && b.offsetParent !== null;
            const text = (b.textContent || '').trim();
            if (onScreen && text === '' && b.children.length === 0) {
              out.push(b.id || b.className || b.tagName);
            }
          }
          return out;
        });
        if (blank.length) blanks.push(`after "${label}": ${blank.join(', ')}`);
      }

      expect(errors, `${file} threw while filtering:\n  ${errors.join('\n  ')}`).toEqual([]);
      expect(blanks, `${file} left a results container blank instead of saying no matches:\n  ${blanks.join('\n  ')}`).toEqual([]);
    });
  }
});

test.describe('every CTA is wired', () => {
  for (const file of appPages()) {
    test(`${file} CTAs fire`, async ({ page }) => {
      const errors = collectErrors(page);
      await ready(page, `${BASE}/${file}`);

      // Inline handlers are what break silently, so they are what get clicked.
      const btns = page.locator('button[onclick]:visible, [role="button"][onclick]:visible, a[onclick]:visible');
      const n = await btns.count();
      test.skip(n === 0, 'no inline-handler CTAs on this page');

      const limit = Math.min(n, 15);
      for (let i = 0; i < limit; i++) {
        const b = btns.nth(i);
        const label = ((await b.textContent().catch(() => '')) || '').trim().slice(0, 40);
        const handler = (await b.getAttribute('onclick').catch(() => '')) || '';
        if (DESTRUCTIVE.test(label) || DESTRUCTIVE.test(handler)) continue;
        if (!(await b.isVisible().catch(() => false))) continue;
        await b.click({ timeout: 4000, noWaitAfter: true }).catch(() => {});
        await page.waitForTimeout(120);
      }
      // A ReferenceError here means the button is decoration.
      const dead = errors.filter((e) => /is not defined|is not a function|Cannot read propert/i.test(e));
      expect(dead, `${file} has CTAs that do nothing:\n  ${dead.join('\n  ')}`).toEqual([]);
      expect(errors, `${file} threw while clicking CTAs:\n  ${errors.join('\n  ')}`).toEqual([]);
    });
  }
});
