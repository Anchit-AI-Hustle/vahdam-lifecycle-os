const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const yaml = (() => { try { return require('js-yaml'); } catch (_) { return null; } })();

// Every failing CI run logged this and nobody noticed:
//
//   ##[warning]No files were found with the provided path: tests/report/.
//   No artifacts will be uploaded.
//
// The workflow ran `npx playwright test --reporter=list`. A --reporter flag
// REPLACES the whole reporter array from playwright.config.js, so the html
// reporter never ran and tests/report/ was never created. The upload step then
// pointed at that empty path.
//
// Worse, the screenshots, videos and traces for each failure land in
// test-results/, which was never uploaded at all. So a run failed, said which
// test failed, and threw away every artifact that would explain WHY.
//
// That is what made brain-calendar-card unfixable: it reproduces only on the
// WebKit projects, and WebKit cannot be installed in the dev sandbox (the
// Playwright download host is blocked by proxy policy). No local repro, no
// screenshot, no trace.

const ROOT = path.join(__dirname, '..');
const CI = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const CONFIG = fs.readFileSync(path.join(ROOT, 'tests', 'playwright.config.js'), 'utf8');

test('the suite is not run with a --reporter override', () => {
  // The override is the whole bug: it silently drops the html reporter.
  const runs = [...CI.matchAll(/run:\s*(npx playwright test[^\n]*)/g)].map((m) => m[1]);
  expect(runs.length, 'the workflow no longer runs playwright').toBeGreaterThan(0);
  for (const r of runs) {
    expect(r, `"${r}" overrides the config reporter, so no html report is written`)
      .not.toMatch(/--reporter/);
  }
});

test('the config still writes the html report the upload expects', () => {
  // The two have to agree, and this is the pairing that broke.
  expect(CONFIG).toMatch(/outputFolder:\s*'tests\/report'/);
  expect(CI, 'the upload no longer collects the html report').toContain('tests/report/');
});

test('the failure artifacts themselves are uploaded', () => {
  // test-results/ is where the screenshot, video and trace actually are.
  // Uploading only the html report loses them.
  expect(CI, 'screenshots, videos and traces are still not collected').toContain('test-results/');
});

test('a missing artifact path warns instead of failing the job', () => {
  expect(CI).toMatch(/if-no-files-found:\s*warn/);
});

test('the upload still only runs on failure, so green runs stay cheap', () => {
  const idx = CI.indexOf('upload-artifact');
  expect(idx).toBeGreaterThan(-1);
  expect(CI.slice(Math.max(0, idx - 400), idx)).toMatch(/if:\s*failure\(\)/);
});

test('the workflow is valid YAML and still defines both jobs', () => {
  test.skip(!yaml, 'js-yaml not installed');
  const d = yaml.load(CI);
  expect(Object.keys(d.jobs)).toEqual(expect.arrayContaining(['build', 'e2e']));
  const steps = d.jobs.e2e.steps.map((s) => s.name).filter(Boolean);
  expect(steps).toEqual(expect.arrayContaining(['Run Playwright suite', 'Upload report on failure']));
});
