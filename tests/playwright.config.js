// Playwright config — visual + functional regression for the Mailer Studio SPA.
// Run from project root:
//   npx playwright install   (one-time)
//   npx playwright test --reporter=list
// Or with UI to step through visually:
//   npx playwright test --ui
const { defineConfig, devices } = require('@playwright/test');

/**
 * Point a project at a pre-installed Chromium — but ONLY if that project runs
 * Chromium.
 *
 * Why this exists at all: a sandbox that ships chromium-1194 while the package
 * pins 1234 fails every browser spec at `browserType.launch: Executable doesn't
 * exist`, and Playwright counts those as "did not run" rather than failures, so
 * the suite still exits 0. A green run that launched no browser is the exact
 * defect class this repo keeps finding in itself; it does not get to live in the
 * harness.
 *
 * Why it is per-project: setting executablePath globally handed a CHROMIUM
 * binary to the WebKit projects (iPhone SE, iPhone 12, iPad all default to
 * WebKit), which failed 432 tests with "Target page, context or browser has been
 * closed" — a message that reads as 432 broken pages rather than one broken
 * config. CI, which leaves PW_CHROMIUM_PATH unset, passed 2997 on the same
 * commit. A test-harness workaround that manufactures phantom app failures is
 * worse than the gap it was papering over.
 *
 * WebKit projects are left alone. Note what that means in practice: this sandbox
 * has no WebKit at all, so iphone-se, iphone-12 and ipad CANNOT run here and
 * report "Executable doesn't exist at .../webkit-<build>/pw_run.sh". Half the
 * device
 * matrix is therefore only ever exercised in CI, which installs its own
 * browsers. A local run covers pixel-5, desktop-1280 and desktop-1920 — three of
 * six — and saying "the matrix passes locally" would overstate it by half.
 *
 * Run the reachable subset explicitly:
 *   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test \
 *     --project=pixel-5 --project=desktop-1280 --project=desktop-1920
 */
function chromiumPath(use) {
  const p = process.env.PW_CHROMIUM_PATH;
  if (!p) return use;
  const browser = use.defaultBrowserType || use.browserName || 'chromium';
  if (browser !== 'chromium') return use;
  return { ...use, launchOptions: { ...(use.launchOptions || {}), executablePath: p } };
}

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js$/,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  // Retry on CI only. These specs drive real pages that register a service
  // worker and boot auth, so a handful of them are navigation-race prone: three
  // separate tests (ad-creation on WebKit, social-media, ad-preview on Pixel 5)
  // have each failed once and passed on re-run without any code change between.
  // With no retries a single such race fails the whole suite and turns main red,
  // which is exactly what happened. Locally retries stay off so a flake is
  // visible while you are working on it rather than silently absorbed.
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/report' }]],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    // The SPA is a single static HTML file — open it via file:// URL.
    // Override with TARGET_URL env var to test the deployed Vercel URL instead.
    baseURL: process.env.TARGET_URL || 'file://' + require('path').resolve(__dirname, '..', 'vahdam_mailer_architect_v34.html'),
  },
  // Six viewports cover the realistic device matrix.
  projects: [
    { name: 'iphone-se',     use: chromiumPath({ ...devices['iPhone SE'] }) },     // 320x568
    { name: 'iphone-12',     use: chromiumPath({ ...devices['iPhone 12'] }) },     // 390x844
    { name: 'pixel-5',       use: chromiumPath({ ...devices['Pixel 5'] }) },       // 393x851
    { name: 'ipad',          use: chromiumPath({ ...devices['iPad (gen 7)'] }) },  // 810x1080
    { name: 'desktop-1280',  use: chromiumPath({ viewport: { width: 1280, height: 800 } }) },
    { name: 'desktop-1920',  use: chromiumPath({ viewport: { width: 1920, height: 1080 } }) },
  ],
});
