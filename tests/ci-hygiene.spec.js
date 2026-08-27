const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

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
//
// 3. AND NOTHING BOUNDED THE WAIT. GitHub's default job timeout is six hours and
//    .github/workflows/ci.yml set none, so a stalled `npx playwright install`
//    ran 5h49m before a human cancelled it. While it is happening, a hang and a
//    slow suite look identical. That is fixed in the workflow (timeout-minutes
//    on both jobs and on the install step) rather than here, because it is a
//    property of the runner, not of any spec.
//
// Fix 2 was applied to every spec in the suite, not just the three that were
// failing: measured across the fourteen that navigated to a real page, test time
// on desktop-1280 went 421.6s -> 236.0s.

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

// Two specs never navigate to a page that exists. They build a fixture in the
// file and serve it through their own route handlers on an invented host, so
// there is nothing for blockExternal to refuse — and adding it anyway measured
// consistently SLOWER (33.2s / 33.2s without, 35.9s / 36.1s with) because every
// request is then intercepted twice for no change in what reaches the network.
//
// They are exempt BY NAME rather than by a pattern, and the exemption is
// verified below: an exemption nobody checks is how a list of "known costs"
// turns into a list of things nobody looks at again.
const SELF_ROUTED = new Set(['ads-analysis.spec.js', 'motion-system.spec.js']);

/** goto targets that cannot leave the machine: loopback, disk, or an invented host. */
const SAFE_TARGET = /^(https?:\/\/(127\.0\.0\.1|localhost)|file:|https?:\/\/[a-z0-9-]+\.test\/)/;

test('a spec that navigates to a real page does not wait on the public internet', () => {
  const offenders = [];
  for (const [name, src] of Object.entries(SRC)) {
    if (!/page\.goto\(/.test(src)) continue;      // source-only specs never navigate
    if (SELF_ROUTED.has(name)) continue;
    if (!/blockExternal|route\.abort\(/.test(src)) offenders.push(name);
  }
  expect(offenders,
    'These specs navigate to a real page without aborting third-party requests, so every goto\n'
    + 'waits on Google Fonts / esm.sh / Shopify CDN until each connection gives up (measured:\n'
    + '13.0s vs 0.2s). Use blockExternal from tests/lib/page-harness.js:\n  '
    + offenders.join('\n  ')).toEqual([]);
});

test('the self-routed exemption still describes those files', () => {
  const wrong = [];
  for (const name of SELF_ROUTED) {
    const src = SRC[name];
    if (!src) { wrong.push(`${name}: file is gone`); continue; }
    if (!/page\.route\(/.test(src)) wrong.push(`${name}: installs no route of its own`);
    if (!/\.abort\(/.test(src)) wrong.push(`${name}: never aborts an unrecognised request`);
    // Every literal navigation target must be one that cannot reach the internet.
    const targets = [...src.matchAll(/page\.goto\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]);
    for (const t of targets) if (!SAFE_TARGET.test(t)) wrong.push(`${name}: navigates to ${t}`);
  }
  expect(wrong,
    'The exemption above says these files route everything they navigate to. That is no longer\n'
    + 'true, so they need blockExternal like everything else:\n  ' + wrong.join('\n  ')).toEqual([]);
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

  // Same trap on the exemption check: SAFE_TARGET exists to REFUSE a real host,
  // so a pattern that happened to accept everything would pass silently.
  expect(SAFE_TARGET.test('https://ads.test/'), 'an invented .test host is safe').toBe(true);
  expect(SAFE_TARGET.test('http://127.0.0.1:8080/x'), 'loopback is safe').toBe(true);
  expect(SAFE_TARGET.test('file:///repo/dashboard.html'), 'the local disk is safe').toBe(true);
  expect(SAFE_TARGET.test('https://www.vahdam.com/'), 'a real host must NOT read as safe').toBe(false);
  expect(SAFE_TARGET.test('https://fonts.googleapis.com/css'), 'a CDN must NOT read as safe').toBe(false);
});
