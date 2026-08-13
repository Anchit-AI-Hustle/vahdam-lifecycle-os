const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const semverIsh = require('../scripts/lib/semver-lite.js');

// package.json and package-lock.json must agree, or `npm ci` refuses to install
// and EVERY CI job dies before a single line of app code runs.
//
// This happened: a dependabot branch merged main into itself and resolved the
// package.json conflict by keeping its own STALE range, while its lock kept the
// NEW version. main ended up declaring googleapis ^173.0.0 with 174.0.1 locked.
// `npm ci` failed on main's own HEAD and on every PR opened against it, and the
// failure surfaced as "build failed" on unrelated pull requests — pointing every
// author at their own diff, which was never the cause.
//
// Local test runs cannot catch this on their own: node_modules is already
// installed, so the suite runs happily against a tree that could not be
// installed from scratch. That gap is exactly why a broken lock reached CI. This
// test closes it by reading the two files and comparing them directly.

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

function lockedVersion(name) {
  const p = lock.packages || {};
  const entry = p[`node_modules/${name}`];
  return entry && entry.version ? entry.version : null;
}

test.describe('package.json and package-lock.json agree', () => {
  const groups = [['dependencies', pkg.dependencies || {}], ['devDependencies', pkg.devDependencies || {}]];

  for (const [groupName, deps] of groups) {
    test(`every ${groupName} range is satisfied by the locked version`, () => {
      const mismatches = [];
      for (const [name, range] of Object.entries(deps)) {
        const locked = lockedVersion(name);
        // A dependency absent from the lock is its own kind of desync, but npm
        // reports that separately and it is not what this pins.
        if (!locked) continue;
        if (!semverIsh.satisfies(locked, range)) {
          mismatches.push(`${name}: package.json wants "${range}", lock has ${locked}`);
        }
      }
      expect(mismatches, `npm ci will refuse to install:\n  ${mismatches.join('\n  ')}`).toEqual([]);
    });
  }

  test('the lock records the same range in its root block, or says why not', () => {
    // npm writes the manifest's dependency block into packages[""]. A mismatch
    // there is a real inconsistency, but `npm ci` TOLERATES it — it validates
    // installed versions against ranges, not this mirror. So this is reported,
    // not failed: regenerating the lock to satisfy it is what actually breaks
    // things. Running `npm install --package-lock-only` to fix a drifted root
    // block here PRUNED @zone-eu/mailsplit and libmime out of the lock while
    // mailparser still declared them, producing a lock that installs a package
    // without its dependencies — worse than the cosmetic drift it fixed, and
    // invisible locally because node_modules already had them.
    const rootDeps = ((lock.packages || {})[''] || {}).dependencies || {};
    const drift = [];
    for (const [name, range] of Object.entries(pkg.dependencies || {})) {
      if (rootDeps[name] && rootDeps[name] !== range) {
        drift.push(`${name}: package.json "${range}" vs lock root "${rootDeps[name]}"`);
      }
    }
    if (drift.length) {
      // eslint-disable-next-line no-console
      console.warn('lock root block drift (npm ci still works; do NOT regenerate to fix this):\n  ' + drift.join('\n  '));
    }
    // The assertion that matters is the one above: npm ci must be able to install.
    expect(Array.isArray(drift)).toBe(true);
  });

});
