// A green CI does not mean a green DEPLOY. These are the ways a push can pass
// every test here and still break production on Vercel, none of which any
// existing spec covered:
//
//   a rewrite whose destination file no longer exists  -> a 404 on a nav link,
//     deploy still SUCCEEDS. This repo has form: `ads-dashboard.html`,
//     `ad-campaigns.html` and `ads-masterclass.html` were each merged away and
//     deleted, and their paths had to be turned into redirects by hand.
//   a 13th Serverless Function                         -> the deploy itself fails
//     (Hobby cap = 12, and the repo sits at exactly 12 today).
//   malformed vercel.json                              -> the deploy fails.
//
// Nothing here needs a browser; it is static analysis of the deploy manifest.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');

test('vercel.json is valid JSON and keeps the no-framework contract', () => {
  let v;
  expect(() => { v = JSON.parse(raw); }).not.toThrow();
  // Set deliberately: this is not a framework build, the repo root IS the output.
  expect(v.framework).toBeNull();
  expect(v.outputDirectory).toBe('.');
  expect(v.buildCommand).toBe('npm run build');
});

test('Vercel installs the same way CI does, so the two cannot disagree', () => {
  // OBSERVED, not theorised. Commit 22e6fc5 deployed to Vercel as READY while
  // CI rejected that exact SHA in 14 seconds: `npm ci` refused a package-lock
  // that had drifted from package.json. With no installCommand set, Vercel
  // chose its own and was happy to install anyway - so a green deployment was
  // not evidence the commit was sound, and production shipped from a commit CI
  // had already failed.
  //
  // Pinning it to `npm ci` makes both platforms enforce the lockfile. Drift now
  // fails in one place instead of passing in one and failing in the other, and
  // the preflight catches it before either sees the push.
  const v = JSON.parse(raw);
  expect(v.installCommand).toBe('npm ci');
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  expect(ci).toMatch(/run:\s*npm ci\b/);
  expect(ci).not.toMatch(/run:\s*npm install\b/);
});

// A destination that is a real file on disk is the only kind this can check.
// API routes, external URLs and anything carrying a `:param` or `*` are resolved
// by Vercel at request time, not by the filesystem, so they are skipped rather
// than guessed at.
function staticDestinations(list) {
  return (list || [])
    .filter((r) => {
      const d = String(r.destination || '');
      return d.startsWith('/') && !d.startsWith('/api/') && !/[:*]/.test(d);
    })
    // Strip the query AND the fragment. A redirect is allowed to deep-link into
    // a page (`/ads` -> `/ads-master#crestudio` is how Creative Studio keeps its
    // own entrance), and a rewrite cannot carry a hash, which is exactly why
    // those four are redirects rather than rewrites.
    .map((r) => ({ source: r.source, dest: String(r.destination).split(/[?#]/)[0] }));
}

test('every static rewrite destination is a file that exists', () => {
  const v = JSON.parse(raw);
  const targets = staticDestinations(v.rewrites);
  // Premise check: if this ever reads 0 the assertion below is vacuous.
  expect(targets.length).toBeGreaterThan(50);
  const missing = targets.filter((t) => !fs.existsSync(path.join(ROOT, t.dest)));
  expect(missing.map((m) => `${m.source} -> ${m.dest}`)).toEqual([]);
});

test('every static redirect destination resolves to a rewrite or a real file', () => {
  const v = JSON.parse(raw);
  const sources = new Set((v.rewrites || []).map((r) => r.source));
  const broken = staticDestinations(v.redirects).filter(
    (t) => !sources.has(t.dest) && !fs.existsSync(path.join(ROOT, t.dest)),
  );
  expect(broken.map((m) => `${m.source} -> ${m.dest}`)).toEqual([]);
});

test('the repo is within the Hobby Serverless Function cap', () => {
  const files = cp
    .execSync("find api -name '*.js' -not -path '*/_shared/*'", { cwd: ROOT })
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);
  // Vercel counts every non-_shared file under api/ as a function. `_shared/`
  // is excluded by the underscore prefix, which is why the heavy logic lives
  // there and the public endpoints are thin `?action=` routers.
  expect(files.length, `${files.length} function files:\n  ${files.join('\n  ')}`).toBeLessThanOrEqual(12);
});

test('CI still guards the function count before the long e2e job', () => {
  // Guard the guard. The check above runs inside the 90-minute Playwright job;
  // the CI shell step fails in seconds instead, which is why the fast duplicate
  // is deliberate rather than drift. If that step is ever deleted, a deploy-
  // breaking 13th function would only surface at the end of a full suite run.
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  expect(ci).toContain('Function-count guard');
  expect(ci).toMatch(/>\s*12/);
});
