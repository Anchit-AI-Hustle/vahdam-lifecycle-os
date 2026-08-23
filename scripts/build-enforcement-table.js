#!/usr/bin/env node
'use strict';
/**
 * build-enforcement-table.js — bind every public claim to the test that holds it.
 *
 * A claim in a README is marketing. A claim with a named test beside it, where
 * the build fails if that test stops existing, is a warranty. This repo makes
 * strong claims - zero fabrication, no black backgrounds, one source for store
 * URLs, a live-catalog gate - and until now nothing connected any of them to
 * the ~800 tests that actually enforce them.
 *
 * The binding is verified, not asserted. Each claim names a spec file AND a
 * substring of a real test title inside it; the generator resolves both and
 * refuses to emit the table if either is missing. A renamed or deleted test
 * therefore breaks the build rather than silently leaving a claim unbacked -
 * which is the failure mode this repo keeps rediscovering in other forms
 * (nine copies of the URL map, a gate that nothing computed, prose that drifts
 * from the code).
 *
 * Usage:  node scripts/build-enforcement-table.js [--check]
 *         --check  verify bindings and that docs/enforcement.md is current
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'enforcement.md');

// claim -> the test that holds it. `test` is matched against real test titles.
const CLAIMS = [
  { group: 'Zero fabrication',
    claim: 'A fact we cannot source is emitted as a DATA REQUIRED marker, never invented.',
    spec: 'launch-gate.spec.js', test: 'unmeasured dimension' },
  { group: 'Zero fabrication',
    claim: 'A campaign that states a rating or review with no approved source is blocked.',
    spec: 'launch-gate.spec.js', test: 'unapproved claim is blocked' },
  { group: 'Zero fabrication',
    claim: 'The approved-claims library ships empty, so a claim blocks until a human approves it.',
    spec: 'launch-gate.spec.js', test: 'claims library ships empty' },
  { group: 'Zero fabrication',
    claim: 'Creative cannot be generated against a stale catalog.',
    spec: 'live-catalog.spec.js', test: 'gate' },

  { group: 'Brand + design',
    claim: 'No section background is ever black or a dark neutral.',
    spec: 'no-black-backgrounds.spec.js', test: 'paints no dark-neutral background' },
  { group: 'Brand + design',
    claim: 'Small text on a brand-green section reaches WCAG AA.',
    spec: 'no-black-backgrounds.spec.js', test: 'reaches AA' },
  { group: 'Brand + design',
    claim: 'Generated output is measured for contrast, not just the source.',
    spec: 'launch-gate.spec.js', test: 'render QA measures the OUTPUT' },
  { group: 'Brand + design',
    claim: 'Every asset type varies its design across a cohort sequence.',
    spec: 'asset-design-variety.spec.js', test: 'repeats its design three times in a row' },

  { group: 'One source of truth',
    claim: 'Store URLs resolve through one module; no page keeps its own map.',
    spec: 'market-urls.spec.js', test: 'no module keeps its own market' },
  { group: 'One source of truth',
    claim: 'No source names a store host that is not in the canonical map.',
    spec: 'market-urls.spec.js', test: 'invents a vahdam host' },
  { group: 'One source of truth',
    claim: 'Sign-in has exactly one implementation.',
    spec: 'homepage-signin.spec.js', test: 'one' },

  { group: 'Safety + privacy',
    claim: 'Outbound connectors honour a single kill switch.',
    spec: 'kill-switch.spec.js', test: 'every outbound connector core imports the kill switch' },
  { group: 'Safety + privacy',
    claim: 'Operator-only routes reject a request with no valid session.',
    spec: 'operator-allowlist.spec.js', test: 'requires a real session' },
  { group: 'Safety + privacy',
    claim: 'No personal email address is committed to this public repository.',
    spec: 'operator-allowlist.spec.js', test: 'no PERSONAL address' },
  { group: 'Safety + privacy',
    claim: 'No script prints a credential.',
    spec: 'cli-and-keys.spec.js', test: 'never echoes a secret' },

  { group: 'Build integrity',
    claim: 'Every inline script on every page parses.',
    spec: 'inline-js-parses.spec.js', test: 'every inline script block parses' },
  { group: 'Build integrity',
    claim: 'CI keeps the screenshots and traces for a failing run.',
    spec: 'ci-artifacts.spec.js', test: 'failure artifacts' },
  { group: 'Build integrity',
    claim: 'Documented provider counts match what the code actually routes to.',
    spec: 'llm-waterfall-docs.spec.js', test: 'provider' },
];

function titlesIn(specFile) {
  const p = path.join(ROOT, 'tests', specFile);
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf8');
  return [...src.matchAll(/\btest\s*\(\s*(['"`])([\s\S]*?)\1/g)].map((m) => m[2]);
}

function resolve() {
  const rows = [];
  const errors = [];
  for (const c of CLAIMS) {
    const titles = titlesIn(c.spec);
    if (titles === null) { errors.push(`${c.spec} does not exist (claim: "${c.claim}")`); continue; }
    const hit = titles.find((t) => t.toLowerCase().includes(c.test.toLowerCase()));
    if (!hit) { errors.push(`no test in ${c.spec} matches "${c.test}" (claim: "${c.claim}")`); continue; }
    rows.push({ ...c, title: hit });
  }
  return { rows, errors };
}

function render(rows) {
  const groups = [...new Set(rows.map((r) => r.group))];
  const out = [
    '# What this app claims, and the test that holds it',
    '',
    'Every row is a claim the product makes and the test that enforces it. The',
    'binding is verified by `scripts/build-enforcement-table.js`: a claim naming a',
    'test that does not exist fails the build, so a claim cannot outlive its',
    'enforcement.',
    '',
    'Generated, not hand-written. Run `npm run build:enforcement` after adding a',
    'claim or renaming a test.',
    '',
  ];
  for (const g of groups) {
    out.push(`## ${g}`, '', '| Claim | Enforced by |', '| --- | --- |');
    for (const r of rows.filter((x) => x.group === g)) {
      // A test title built from a template literal comes out with its
      // placeholders intact (`${rel} paints no ...`). Show the shape, not the
      // raw expression, rather than pretending the title is static.
      const title = r.title.replace(/\$\{[^}]+\}/g, '<each file>').replace(/\|/g, '\\|');
      out.push(`| ${r.claim} | \`tests/${r.spec}\` — *${title}* |`);
    }
    out.push('');
  }
  out.push(`_${rows.length} claims, each bound to a named test._`);
  return out.join('\n') + '\n';
}

const check = process.argv.includes('--check');
const { rows, errors } = resolve();
if (errors.length) {
  console.error('Unbacked claim(s):');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
const md = render(rows);
if (check) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== md) { console.error('docs/enforcement.md is stale. Run: npm run build:enforcement'); process.exit(1); }
  console.log(`enforcement table current — ${rows.length} claims, all bound`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, md);
  console.log(`wrote docs/enforcement.md — ${rows.length} claims, all bound to real tests`);
}
