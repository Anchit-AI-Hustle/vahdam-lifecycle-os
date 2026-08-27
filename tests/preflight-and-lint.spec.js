const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Six pushes went red on CI in one session, and not one of them would have been
// caught by running the test suite - which was already being run every time.
// They failed for reasons a plain local run cannot see: a spec that depended on
// CLIs installed here but absent on the runner, three CodeQL regex findings,
// and an unused import in a repo with no linter.
//
// So the gate is two things: a linter configured as a RATCHET (error-level
// rules all at zero, so it can only go red on newly broken code) and a
// preflight script that reproduces the CI environment locally.

const ROOT = path.join(__dirname, '..');
const CFG = path.join(ROOT, 'eslint.config.mjs');
const PRE = path.join(ROOT, 'scripts', 'preflight-push.sh');

test('the lint config exists and is wired into npm and CI', () => {
  expect(fs.existsSync(CFG)).toBe(true);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts.lint).toBe('eslint .');
  expect(pkg.devDependencies.eslint, 'eslint is not pinned as a devDependency').toBeTruthy();
  expect(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')).toContain('npx eslint .');
});

test('lint reports ZERO errors, so the gate is a ratchet not a backlog', () => {
  const r = spawnSync('npx', ['--no-install', 'eslint', '.', '-f', 'json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  test.skip(!r.stdout, 'eslint not installed in this environment');
  const out = JSON.parse(r.stdout);
  const errors = out.flatMap((f) => f.messages.filter((m) => m.severity === 2)
    .map((m) => `${f.filePath.split('vahdam-lifecycle-os/')[1]}:${m.line} ${m.ruleId}`));
  expect(errors, `lint errors:\n  ${errors.join('\n  ')}`).toEqual([]);
});

test('no-undef is error-level — it is the rule that found a real 500', () => {
  const cfg = fs.readFileSync(CFG, 'utf8');
  // The cosmetic backlog is warn; the correctness set must stay error, or the
  // ratchet quietly becomes advisory.
  expect(cfg).toMatch(/'no-undef':\s*'error'/);
  expect(cfg).toMatch(/'no-const-assign':\s*'error'/);
  expect(cfg).toMatch(/'no-dupe-keys':\s*'error'/);
  expect(cfg).toMatch(/'no-unused-vars':\s*\['warn'/);
});

test('the calendar scope bug the linter found stays fixed', () => {
  // `const q` lived inside the lifecycle-list branch and was referenced from
  // lifecycle-build-mailer, a different block. Because || short-circuits, the
  // ReferenceError only fired when body.force was falsy - the DEFAULT call.
  const src = fs.readFileSync(path.join(ROOT, 'api', 'calendar.js'), 'utf8');
  const uses = [...src.matchAll(/\bq\s*&&\s*q\./g)];
  expect(uses.length, 'the guarded q usage is gone entirely; this test needs updating').toBeGreaterThan(0);
  // q must be declared BEFORE the first branch that reads it.
  const decl = src.indexOf('const q = req.query || {}');
  expect(decl, 'q is no longer declared').toBeGreaterThan(-1);
  expect(decl).toBeLessThan(src.indexOf("action === 'lifecycle-list'"));
  expect(decl).toBeLessThan(src.indexOf("action === 'lifecycle-build-mailer'"));
  // And no second declaration shadowing it inside a branch.
  expect([...src.matchAll(/const q = req\.query/g)].length, 'q is declared twice again').toBe(1);
});

test('the preflight runs the real specs rather than reimplementing them', () => {
  const sh = fs.readFileSync(PRE, 'utf8');
  // The first version inlined its own inline-JS extractor and immediately
  // drifted - it did not handle type="module" and reported 7 false failures.
  expect(sh, 'the preflight reimplements the inline-JS check instead of running it')
    .toContain('tests/inline-js-parses.spec.js');
  expect(sh).toContain('eslint');
  expect(sh).toContain('node --check');
});

test('the preflight reproduces the CI environment, and admits what it cannot', () => {
  const sh = fs.readFileSync(PRE, 'utf8');
  // A bare PATH is what caught the CLI-dependent spec class.
  expect(sh).toMatch(/BARE|bare/);
  expect(sh).toContain('PATH="$BARE"');
  // It must not imply a green local run guarantees green CI.
  expect(sh).toMatch(/WebKit cannot be installed/i);
  expect(sh).toMatch(/CodeQL/);
  // A local run with no PW_CHROMIUM_PATH silently runs no browser at all.
  expect(sh).toContain('PW_CHROMIUM_PATH');
});

test('the preflight is executable and fails loudly', () => {
  expect(fs.statSync(PRE).mode & 0o111).toBeTruthy();
  const sh = fs.readFileSync(PRE, 'utf8');
  expect(sh).toMatch(/exit 1/);
  expect(sh).toMatch(/PREFLIGHT FAILED/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts['preflight:push']).toBeTruthy();
});

test('a spec that walks many controls budgets more time than its worst case', () => {
  // This is why CI went red on iphone-12: cta-and-filters walks up to 20
  // controls with a 5s click cap, a ~100s worst case inside the 60s default
  // test timeout. It was not flaky by chance - it could not fit, and only
  // passed because clicks usually land fast. Pin the relationship so the
  // budget cannot silently fall behind the work again.
  const src = fs.readFileSync(path.join(ROOT, 'tests', 'cta-and-filters.spec.js'), 'utf8');

  // EVERY occurrence, not the first. This guard was vacuous: that file has TWO
  // control-walking loops, and a single .exec() reads only the earlier one. So
  // it validated the filters loop's 2s cap while the CTA loop's 4s cap - the
  // real dominant term - was invisible, and `settle` came from ready()'s
  // waitForTimeout(700) rather than from either loop. It certified a 75s worst
  // case for a test that was timing out at 120s on the two WebKit projects.
  // Take the WORST of each, so a second loop can never hide behind the first.
  const all = (re) => [...src.matchAll(re)].map((m) => Number(m[1]));
  const limits = all(/Math\.min\(n,\s*(\d+)\)/g);
  const clickCaps = all(/click\(\{\s*timeout:\s*(\d+)/g);
  const settles = all(/waitForTimeout\((\d+)\)/g);
  expect(limits.length, 'no control-walking loop found - has this spec been rewritten?').toBeGreaterThan(0);
  expect(clickCaps.length, 'no click cap found').toBeGreaterThan(0);
  const limit = Math.max(...limits);
  const clickCap = Math.max(...clickCaps);
  const settle = Math.max(...settles);
  const budget = Number(/describe\.configure\(\{\s*timeout:\s*([\d_]+)/.exec(src)[1].replace(/_/g, ''));

  // Per control, plus an allowance for the page load and the evaluates.
  //
  // The per-control allowance is 1000ms, not 300ms. 300ms was optimistic to the
  // point of being useless: each iteration does textContent + getAttribute +
  // isVisible (three locator round-trips) BEFORE the click, and then the click
  // runs its own actionability polling - on an emulated mobile WebKit project
  // sharing a CI runner. The evidence is empirical rather than theoretical: at
  // 300ms this guard certified a 115s worst case for the 4s cap, 5s inside the
  // 120s budget, while [ipad] and [iphone-se] were really timing out at 120s on
  // mailer-discovery.html. A margin that thin is not a check.
  const worstCase = limit * (clickCap + settle + 1000) + 15_000;
  expect(budget,
    `budget ${budget}ms is under the ${worstCase}ms worst case (${limit} controls x ${clickCap}ms click cap)`
  ).toBeGreaterThan(worstCase);

  // And the budget must not have been "fixed" by cutting coverage.
  expect(limit, 'the per-page control cap was reduced, which loses coverage').toBeGreaterThanOrEqual(20);
});

test('--fix cannot strip a deliberate eslint-disable comment', () => {
  // It did exactly that on first run: six files lost suppressions written by
  // whoever anticipated a linter, and gained trailing whitespace. An autofix
  // that deletes intent is worse than no autofix.
  expect(fs.readFileSync(CFG, 'utf8')).toMatch(/reportUnusedDisableDirectives:\s*'off'/);
  // And the suppressions those files rely on are still present.
  for (const f of ['tests/calendar-today.spec.js', 'tests/funnel-drill.spec.js',
                   'api/_shared/social-core.js', 'api/_shared/smart-brain-plan.js']) {
    expect(fs.readFileSync(path.join(ROOT, f), 'utf8'),
      `${f} lost its eslint-disable comment`).toMatch(/eslint-disable/);
  }
});

// A check that depends on somebody remembering to run it is not a check. The
// push that ADDED preflight-push.sh went red on CI because I pushed without
// running it, which is the whole argument for wiring it to the push itself.
test('the fast preflight runs automatically on push', () => {
  const hook = path.join(ROOT, '.githooks/pre-push');
  expect(fs.existsSync(hook), '.githooks/pre-push is missing').toBe(true);
  const src = fs.readFileSync(hook, 'utf8');
  expect(src).toContain('preflight-push.sh');
  // --fast on purpose: ~19s, and it covers every class that actually went red
  // this session. The 8-minute browser suite would make the hook something
  // people routinely bypass, which is worse than not having it.
  expect(src).toContain('--fast');
  // The escape hatch must stay documented in the failure message: a hook that
  // can wedge someone out of pushing is worse than the bug it prevents.
  expect(src).toContain('--no-verify');
  expect(fs.statSync(hook).mode & 0o111, 'pre-push is not executable').toBeTruthy();
});

test('prepare wires the hook and cannot fail an install', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts.prepare).toContain('core.hooksPath .githooks');
  // prepare ALSO runs during `npm ci` on Vercel, and a non-zero prepare fails
  // the install, which fails the deployment. It must swallow its own failure -
  // a repo with no .git (or no git binary) has to install cleanly.
  expect(pkg.scripts.prepare).toMatch(/\|\|\s*true/);
  const rc = spawnSync('sh', ['-c', pkg.scripts.prepare], { cwd: require('os').tmpdir() });
  expect(rc.status, 'prepare exits non-zero outside a git repo').toBe(0);
});
