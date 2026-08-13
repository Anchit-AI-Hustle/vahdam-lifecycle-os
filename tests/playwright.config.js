// Playwright config — visual + functional regression for the Mailer Studio SPA.
// Run from project root:
//   npx playwright install   (one-time)
//   npx playwright test --reporter=list
// Or with UI to step through visually:
//   npx playwright test --ui
const { defineConfig, devices } = require('@playwright/test');

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
    // Use a pre-installed Chromium when one is provided instead of the exact
    // build this @playwright/test version pins.
    //
    // THIS IS NOT A CONVENIENCE. In a sandbox that ships chromium-1194 while the
    // package wants 1234, every browser-driving spec dies at
    // `browserType.launch: Executable doesn't exist` — and Playwright reports
    // those as "did not run", not as failures, so the suite still exits 0. The
    // run looks like a pass and is really a pass of the file-reading specs only.
    // That is precisely the shape of defect this repo keeps finding in itself, so
    // it does not get to live in the test harness.
    //
    // CI installs its own browsers and leaves PW_CHROMIUM_PATH unset, so this is
    // inert there.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    // The SPA is a single static HTML file — open it via file:// URL.
    // Override with TARGET_URL env var to test the deployed Vercel URL instead.
    baseURL: process.env.TARGET_URL || 'file://' + require('path').resolve(__dirname, '..', 'vahdam_mailer_architect_v34.html'),
  },
  // Six viewports cover the realistic device matrix.
  projects: [
    { name: 'iphone-se',     use: { ...devices['iPhone SE'] } },          // 320x568
    { name: 'iphone-12',     use: { ...devices['iPhone 12'] } },          // 390x844
    { name: 'pixel-5',       use: { ...devices['Pixel 5'] } },            // 393x851
    { name: 'ipad',          use: { ...devices['iPad (gen 7)'] } },       // 810x1080
    { name: 'desktop-1280',  use: { viewport: { width: 1280, height: 800 } } },
    { name: 'desktop-1920',  use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
