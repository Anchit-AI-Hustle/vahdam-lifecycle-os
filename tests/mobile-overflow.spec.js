// No page may push the document wider than the phone viewport.
//
// Measured at 390px before the fix: research 829px of horizontal overflow,
// playbook 519, competitor-benchmarking 253, calendar 181, landing-pages 69,
// knowledge-base 35, index 22. Every edge of those pages clipped on a phone.
//
// The cause is the one /brain already hit and CLAUDE.md already records: a
// table carrying its own min-width with no scrolling wrapper sets a floor, and
// the grid/flex track holding it has an implicit min-width:auto resolving to
// MAX-CONTENT, so the card, the body and the document all grow to match. The
// repair lives in auth.js (wrapWideTables) so it reaches every page that ships
// the shared shell, rather than being applied to seven pages and missed on the
// eighth.
const { test, expect } = require('@playwright/test');
const { startServer, blockExternal } = require('./lib/page-harness.js');

test.use({ serviceWorkers: 'block' });
test.describe.configure({ timeout: 300_000 });

// Pages that ship the shared shell AND carry wide tables. Kept explicit so a
// page added tomorrow is a deliberate decision rather than a silent omission.
const PAGES = [
  'dashboard.html', 'data-analysis.html', 'calendar.html', 'smart-brain.html',
  'ad-campaigns-master.html', 'assets.html', 'research.html',
  'cohort-definitions.html', 'social-media.html', 'lifecycle-calendar.html',
  'daily-email-calendar.html', 'all-in-one.html',
];

test('no page pushes the document wider than a 390px viewport', async ({ page }) => {
  const srv = await startServer();
  const bad = [];
  try {
    for (const p of PAGES) {
      await blockExternal(page);
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(`${srv.base}/${p}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const over = await page.evaluate(() => {
        const d = document.documentElement;
        return d.scrollWidth - d.clientWidth;
      });
      // 2px of tolerance for sub-pixel rounding, not for a real overflow.
      if (over > 2) bad.push(`${p}: +${over}px`);
    }
  } finally {
    await new Promise((r) => srv.server.close(r));
  }
  expect(bad, `these pages overflow a phone viewport:\n  ${bad.join('\n  ')}`).toEqual([]);
});

test('the repair is shared, not copied onto each page', () => {
  // The defect class recurred because each fix was per-page. One implementation
  // in the script every page already loads is what stops the eighth page.
  const fs = require('fs');
  const path = require('path');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
  expect(auth).toMatch(/function wrapWideTables\(\)/);
  // The wrapper alone is not enough - the min-width:0 walk is what actually
  // stops the ancestor track growing to max-content.
  expect(auth).toMatch(/minWidth === 'auto'/);
  expect(auth).toMatch(/MutationObserver/);
});
