const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// TWO WAYS THIS SUITE WENT RED WITHOUT ANY PRODUCT CODE BEING WRONG.
//
// 1. A SKIPPED DESCRIBE STILL RUNS afterAll.
//
//    tests/asset-vs-element-prompts.spec.js carries
//      test.skip(({ browserName }) => browserName !== 'chromium', ...)
//    so on iphone-se / iphone-12 / ipad every test in it is skipped. Playwright
//    then does NOT run beforeAll — but it DOES run afterAll. `server` was never
//    assigned, so `server.close(r)` threw
//      TypeError: Cannot read properties of undefined (reading 'close')
//    and Playwright reported it against the last test: a 0ms failure whose retry
//    was skipped, on all three WebKit projects, run after run. FIVE spec files
//    had the same unguarded shape.
//
// 2. goto WAITS ON THIRD PARTIES THAT CANNOT RESOLVE IN CI.
//
//    page.goto defaults to waitUntil:'load'. index.html links Google Fonts,
//    Vercel speed-insights, esm.sh/three and dozens of Shopify CDN images.
//    MEASURED on pixel-5: goto 13,035ms, against 657ms for the click it was
//    setting up. With third-party requests aborted the same goto took 210ms and
//    the whole test went 17.3s -> 2.9s. At a 60s per-test timeout that is the
//    margin between passing and timing out on a loaded runner, which is exactly
//    how tests/homepage-signin.spec.js failed on main.
//
// Neither is a flake in the ordinary sense. Both are deterministic given the
// environment, which is why they recurred instead of washing out on retry.

const TESTS = __dirname;
const specFiles = fs.readdirSync(TESTS)
  .filter((f) => f.endsWith('.spec.js') && f !== path.basename(__filename));
const SRC = Object.fromEntries(specFiles.map((f) => [f, fs.readFileSync(path.join(TESTS, f), 'utf8')]));

/** The body of an afterAll arrow, or '' when the shape does not match. */
function afterAllBodies(src) {
  const out = [];
  const re = /afterAll\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{?([^\n]*)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function guarded(body) {
  return /if\s*\(\s*\w+\s*\)/.test(body) || /\w+\s*&&\s*\w+\.close/.test(body);
}

test('no afterAll closes a server it cannot know exists', () => {
  const offenders = [];
  for (const [name, src] of Object.entries(SRC)) {
    for (const body of afterAllBodies(src)) {
      if (!/\.close\s*\(/.test(body)) continue;
      if (!guarded(body)) offenders.push(`${name}: ${body.trim().slice(0, 90)}`);
    }
  }
  expect(offenders,
    'These afterAll hooks close a server without checking it was created. A describe-level\n'
    + 'test.skip() stops beforeAll running but NOT afterAll, so the hook throws and Playwright\n'
    + 'reports a passing file as failed:\n  ' + offenders.join('\n  ')).toEqual([]);
});

// Specs that pre-date this guard and still pay the third-party wait. They are
// LISTED rather than silently excluded: each one's goto waits on fonts/CDN the
// same way, so this is a known cost, not a clean bill of health. None of them is
// failing today — the three that were failing have been converted — so the guard
// exists to stop the list growing while these are worked through.
const PRE_EXISTING = new Set([
  'ad-creation.spec.js', 'ad-preview.spec.js', 'ads-account-filter.spec.js',
  'ads-analysis.spec.js', 'ads-one-dashboard.spec.js', 'analytics-surface.spec.js',
  'degraded-run-honesty.spec.js', 'funnel-drill-live.spec.js', 'gate-notice.spec.js',
  'looker-embed.spec.js', 'motion-system.spec.js', 'social-media.spec.js',
  'studio.spec.js', 'sync-everywhere.spec.js',
]);

test('a NEW spec that serves its own pages does not wait on the public internet', () => {
  const offenders = [];
  for (const [name, src] of Object.entries(SRC)) {
    if (!/page\.goto\(/.test(src)) continue;      // source-only specs never navigate
    if (PRE_EXISTING.has(name)) continue;
    if (!/blockExternal|route\.abort\(/.test(src)) offenders.push(name);
  }
  expect(offenders,
    'These specs navigate to a real page without aborting third-party requests, so every goto\n'
    + 'waits on Google Fonts / esm.sh / Shopify CDN until each connection gives up (measured:\n'
    + '13.0s vs 0.2s). Use blockExternal from tests/lib/page-harness.js:\n  '
    + offenders.join('\n  ')).toEqual([]);
});

test('the pre-existing list does not rot', () => {
  // An allowlist that keeps entries it no longer needs becomes a permanent
  // excuse. A spec that has since been converted must leave the list.
  const stale = [...PRE_EXISTING].filter((name) => {
    const src = SRC[name];
    if (!src) return true;                              // file gone
    return /blockExternal|route\.abort\(/.test(src);    // already converted
  });
  expect(stale,
    'These no longer belong on the pre-existing list — remove them:\n  ' + stale.join('\n  ')).toEqual([]);
});

test('the guards actually catch their own bugs', () => {
  // An empty offender list is the pass condition for both guards, and an
  // over-narrow matcher produces one for the wrong reason. Prove the matcher
  // fires on the real shapes.
  const body = (s) => afterAllBodies(s)[0] || '';
  expect(guarded(body('test.afterAll(async () => { await new Promise((r) => server.close(r)); });')),
    'the matcher would have missed the real bug').toBe(false);
  expect(guarded(body('test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });')),
    'the matcher rejects a correctly guarded hook').toBe(true);
  expect(guarded(body('test.afterAll(() => server && server.close());')),
    'the matcher rejects the && form').toBe(true);
});
