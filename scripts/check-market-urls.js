#!/usr/bin/env node
'use strict';

/**
 * Re-measure every storefront host this repo can emit, from wherever you run it.
 *
 * The market map was wrong for a long time because it was labelled "VERIFIED"
 * and nobody re-checked. A claim of verification is worth exactly as much as the
 * last time somebody ran it, so this makes running it a one-liner:
 *
 *   node scripts/check-market-urls.js
 *
 * Exits non-zero if any canonical host fails, so it can gate a release.
 */

const { STORE_BASE, DEAD_HOSTS, REDIRECTING_HOSTS } = require('../api/_shared/market-urls.js');

async function probe(url) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
    clearTimeout(timer);
    return { url, ok: res.ok, status: res.status, final: res.url, ms: Date.now() - started };
  } catch (e) {
    return { url, ok: false, status: 0, final: null, ms: Date.now() - started, error: String((e && e.message) || e).slice(0, 60) };
  }
}

(async () => {
  const canonical = [...new Set(Object.values(STORE_BASE))];
  console.log('Canonical storefronts — these MUST be reachable\n');
  const results = await Promise.all(canonical.map(probe));
  let failed = 0;
  for (const r of results) {
    const redirected = r.final && r.final.replace(/\/$/, '') !== r.url.replace(/\/$/, '');
    if (!r.ok) failed += 1;
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.url.padEnd(30)} ${String(r.status).padEnd(4)} ${r.ms}ms${redirected ? `  → ${r.final}` : ''}${r.error ? `  ${r.error}` : ''}`);
  }

  console.log('\nHosts recorded as dead — a PASS here means the map can be widened again\n');
  for (const h of DEAD_HOSTS) {
    const r = await probe(`https://${h}`);
    console.log(`  ${r.ok ? 'NOW LIVE' : 'dead    '} https://${h}${r.error ? `  ${r.error}` : ''}`);
  }

  console.log('\nHosts that resolve but cost a redirect hop — prefer the canonical form\n');
  for (const h of REDIRECTING_HOSTS) {
    const r = await probe(`https://${h}`);
    console.log(`  ${r.ok ? 'ok' : 'dead'}  https://${h}${r.final ? `  → ${r.final}` : ''}`);
  }

  if (failed) {
    console.error(`\n${failed} canonical storefront(s) unreachable — do not ship links to them.`);
    process.exit(1);
  }
  console.log('\nAll canonical storefronts reachable.');
})();
