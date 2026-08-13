'use strict';

/**
 * semver-lite — just enough semver to answer "does this locked version satisfy
 * this package.json range?", with no dependency.
 *
 * DELIBERATELY CONSERVATIVE: a range shape this does not understand returns
 * `true` (satisfied) rather than false. The caller is a CI guard, and a guard
 * that fails on syntax it merely cannot parse trains people to ignore it. It
 * covers the forms npm and dependabot actually write into this repo's
 * package.json — caret, tilde, exact, comparators, wildcards and || unions —
 * and abstains on anything else.
 */

function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v || '').trim());
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

function cmp(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

// ^1.2.3 → >=1.2.3 <2.0.0 ; ^0.2.3 → >=0.2.3 <0.3.0 ; ^0.0.3 → >=0.0.3 <0.0.4
// The 0.x rules are not pedantry: npm treats a leading zero as unstable, so a
// caret there is far narrower than it looks, and getting it wrong would make
// this guard pass a genuine mismatch.
function caretUpper(b) {
  if (b.major > 0) return { major: b.major + 1, minor: 0, patch: 0 };
  if (b.minor > 0) return { major: 0, minor: b.minor + 1, patch: 0 };
  return { major: 0, minor: 0, patch: b.patch + 1 };
}

function satisfiesSimple(version, range) {
  const v = parse(version);
  if (!v) return true;                       // unparseable version: abstain
  const r = String(range || '').trim();
  if (!r || r === '*' || r === 'latest' || r === 'x') return true;
  // Anything that is not a plain version range (git url, file:, npm alias,
  // workspace protocol) is outside what this can judge.
  if (/[a-z]+:/i.test(r) && !/^[<>=~^ ]/.test(r)) return true;

  if (r.startsWith('^')) {
    const b = parse(r.slice(1));
    if (!b) return true;
    return cmp(v, b) >= 0 && cmp(v, caretUpper(b)) < 0;
  }
  if (r.startsWith('~')) {
    const b = parse(r.slice(1));
    if (!b) return true;
    const upper = { major: b.major, minor: b.minor + 1, patch: 0 };
    return cmp(v, b) >= 0 && cmp(v, upper) < 0;
  }
  if (r.startsWith('>=')) { const b = parse(r.slice(2)); return b ? cmp(v, b) >= 0 : true; }
  if (r.startsWith('<=')) { const b = parse(r.slice(2)); return b ? cmp(v, b) <= 0 : true; }
  if (r.startsWith('>'))  { const b = parse(r.slice(1)); return b ? cmp(v, b) > 0 : true; }
  if (r.startsWith('<'))  { const b = parse(r.slice(1)); return b ? cmp(v, b) < 0 : true; }
  if (r.startsWith('='))  { const b = parse(r.slice(1)); return b ? cmp(v, b) === 0 : true; }

  const exact = parse(r);
  if (exact) return cmp(v, exact) === 0;
  return true;                               // shape not understood: abstain
}

/** A range may be a || union of space-separated AND clauses. */
function satisfies(version, range) {
  const unions = String(range || '').split('||');
  return unions.some((u) => u.trim().split(/\s+/).filter(Boolean).every((part) => satisfiesSimple(version, part)));
}

module.exports = { satisfies, parse, cmp };
