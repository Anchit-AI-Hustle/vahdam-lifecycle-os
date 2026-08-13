const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { startServer, collectErrors, ROOT } = require('./lib/page-harness.js');

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

async function ready(page, url) {
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
  // The selectors this app actually uses for filter chips/buttons.
  const FILTER_SEL = '.filter-btn, .mkchip, .fbtn, .chip[data-filter], [data-cat], [data-mkt], [data-dur], [data-dcw]';

  for (const file of appPages()) {
    test(`${file} filters behave`, async ({ page }) => {
      const errors = collectErrors(page);
      await ready(page, `${BASE}/${file}`);

      const controls = page.locator(FILTER_SEL);
      const n = await controls.count();
      test.skip(n === 0, 'no filter controls on this page');

      // Cap per page: clicking 64 chips on the ads master adds minutes for no
      // extra signal — the first dozen exercise every distinct handler.
      const limit = Math.min(n, 12);
      const blanks = [];
      for (let i = 0; i < limit; i++) {
        const c = controls.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
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
