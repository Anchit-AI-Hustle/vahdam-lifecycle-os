#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
// run-evals.js — evaluate the agent layer.
//
//   node scripts/run-evals.js            structural only (no key, deterministic)
//   node scripts/run-evals.js --live     also run the real chat loop
//
// Structural evaluation is what CI gates on (tests/agent-evals.spec.js): it
// checks the routing SIGNAL — the tool names and descriptions a prompt-routed
// agent actually chooses from. Live evaluation runs the model and compares the
// observed tool trace to the expectation; it needs a provider key, costs quota,
// and is sampled rather than proof, so it is opt-in and never a merge gate.
// ════════════════════════════════════════════════════════════════════════════

const path = require('path');
const { structuralEval, liveEval } = require(path.join(__dirname, '..', 'evals', 'lib', 'evaluate.js'));
const dataset = require(path.join(__dirname, '..', 'evals', 'data', 'tool-routing.test.json'));
const brand = require(path.join(__dirname, '..', 'api', '_shared', 'brand-llm.js'));

const LIVE = process.argv.includes('--live');
const MARKET = (process.argv.find((a) => a.startsWith('--market=')) || '').split('=')[1] || 'US';

(async () => {
  const s = structuralEval(dataset, brand.toolManifest());
  console.log(`\nSTRUCTURAL — ${s.cases} cases, ${s.tools} tools, ${s.checks} checks`);
  if (s.ok) console.log('  ✓ routing signal intact');
  else s.failures.forEach((f) => console.log('  ✗ ' + f));

  if (!LIVE) {
    console.log('\n(live evaluation skipped — pass --live to run the real model)\n');
    process.exit(s.ok ? 0 : 1);
  }

  console.log(`\nLIVE — running ${dataset.length} cases through the real loop (market ${MARKET})`);
  const l = await liveEval(dataset, brand.chat, { market: MARKET });
  for (const r of l.results) {
    if (r.pass) { console.log(`  ✓ ${r.id}  [${r.observed.join(', ') || 'no tools'}]`); continue; }
    console.log(`  ✗ ${r.id}  observed: [${r.observed.join(', ') || 'none'}]`);
    if (r.error) console.log(`      error: ${r.error}`);
    if (r.missed.length) console.log(`      expected but not called: ${r.missed.join(', ')}`);
    if (r.forbidden.length) console.log(`      called but should not have been: ${r.forbidden.join(', ')}`);
    if (r.unmentioned.length) console.log(`      reply never mentioned: ${r.unmentioned.join(', ')}`);
  }
  console.log(`\n  ${l.passed}/${l.total} live cases passed`);
  // A live miss is a signal to investigate, not a build failure: the model is
  // sampled and the providers rotate. Only the structural half gates.
  console.log(l.ok ? '' : '  (live misses are advisory — investigate, but they do not gate CI)\n');
  process.exit(s.ok ? 0 : 1);
})();
