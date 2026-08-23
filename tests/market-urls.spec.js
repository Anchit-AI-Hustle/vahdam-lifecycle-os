const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const MARKET = require('../api/_shared/market-urls.js');

// NINE COPIES OF THE MARKET MAP, MOST OF THEM POINTING AT DEAD HOSTS.
//
// Measured 2026-08-13: uk.vahdamteas.com, eu.vahdamteas.com, au.vahdamteas.com,
// eu.vahdam.com and au.vahdam.com do not resolve. They were in the mailer
// pipeline, the ad generator, the landing-page builder, the review-recovery
// mailer, the competitive benchmark and the playbook generator — so every UK, EU
// or AU asset this repo produced linked nowhere.
//
// Every one of those copies carried a comment saying "VERIFIED, per CLAUDE.md",
// and CLAUDE.md's own table was wrong on four of six entries. The word
// "verified" is what stopped anyone re-checking for months. A brand-contract
// document supplied later repeated the same four wrong URLs — that is how the
// error survived: it got copied into the document you would check it against.
//
// Somebody DID find part of it. scripts/scrape-catalog.js carried a note dated
// 2026-06-21 recording uk.vahdamteas.com as NXDOMAIN, and worked around it by
// skipping the UK catalog entirely. The finding never propagated anywhere else.
//
// So this test does not check that the map is pretty. It checks that no dead
// host can reach generated output again, and that the copies stay in step.

const ROOT = path.join(__dirname, '..');

// Places that legitimately NAME a dead host: this test, the map that records
// them, and the docs that explain the history. Everything else is emitting one.
const ALLOWED_TO_MENTION = new Set([
  'tests/market-urls.spec.js',
  'api/_shared/market-urls.js',
  'scripts/check-market-urls.js',
  'scripts/scrape-catalog.js',            // header records the June finding
  'CLAUDE.md',
  'docs/prompt-library/README.md',
]);

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|\.git|test-results|tests\/report|vendor|data)$/.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1);
    else if (/\.(js|html|json|md)$/.test(e.name)) out.push(full);
  }
  return out;
}

test.describe('the market map', () => {
  test('no source file emits a storefront host that does not resolve', () => {
    // Plain substring search, not a built regex. These are literal hostnames, so
    // a regex buys nothing and costs correctness: escaping `.` but not `\` is the
    // same defect CodeQL flagged in the crawler spec, and I wrote it twice.
    // indexOf cannot be under- or over-escaped.
    const offenders = [];
    for (const file of walk(ROOT)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOWED_TO_MENTION.has(rel)) continue;
      // Generated deliverables already shipped are a separate, larger cleanup;
      // this guard stops the GENERATORS producing new ones.
      if (rel.startsWith('landing-pages/') || rel.startsWith('mailers/') || rel.startsWith('ads/') || rel.startsWith('reports/')) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const host of MARKET.DEAD_HOSTS) {
        const at = src.indexOf(host);
        if (at === -1) continue;
        offenders.push(`${rel}:${src.slice(0, at).split('\n').length} → ${host}`);
        break;
      }
    }
    expect(offenders, `these point at storefronts that do not resolve:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  test('every market resolves to a canonical host, never a redirecting one', () => {
    // A redirect hop costs latency on the click that matters most and gives one
    // more place for tracking parameters to be dropped.
    for (const [market, base] of Object.entries(MARKET.STORE_BASE)) {
      const host = base.replace(/^https?:\/\//, '');
      expect(MARKET.DEAD_HOSTS, `${market} points at a dead host`).not.toContain(host);
      expect(MARKET.REDIRECTING_HOSTS, `${market} points at ${host}, which redirects`).not.toContain(host);
    }
  });

  test('the helpers build the URL shapes the rest of the app expects', () => {
    expect(MARKET.storeBase('UK')).toBe('https://www.vahdam.co.uk');
    expect(MARKET.storeBase('uk')).toBe('https://www.vahdam.co.uk');
    expect(MARKET.storeBase('India')).toBe(MARKET.storeBase('IN'));
    // An unknown market must land somewhere real rather than undefined.
    expect(MARKET.storeBase('MARS')).toBe(MARKET.STORE_BASE.GLOBAL);
    expect(MARKET.storeHost('UK')).toBe('www.vahdam.co.uk');
    expect(MARKET.productUrl('UK', 'masala-chai')).toBe('https://www.vahdam.co.uk/products/masala-chai');
    expect(MARKET.productUrl('UK', '/masala-chai'), 'a leading slash must not double up').toBe('https://www.vahdam.co.uk/products/masala-chai');
    expect(MARKET.collectionUrl('US')).toBe('https://www.vahdam.com/collections/all');
  });

  test('currency never crosses a market', () => {
    expect(MARKET.currency('UK').symbol).toBe('£');
    expect(MARKET.currency('US').symbol).toBe('$');
    expect(MARKET.currency('EU').code).toBe('EUR');
  });

  test('the front-end copies agree with the canonical map', () => {
    // Browser pages cannot require() the module, so they keep their own literal
    // map. That is fine as long as it MATCHES — drift between them is what
    // produced nine different answers to the same question.
    const pages = ['landing-page-agent.html', 'landing-pages.html', 'vahdam_mailer_architect_v34.html'];
    const wrong = [];
    for (const p of pages) {
      const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
      for (const host of MARKET.DEAD_HOSTS) {
        if (src.includes(host)) wrong.push(`${p} still names ${host}`);
      }
    }
    expect(wrong, wrong.join('\n  ')).toEqual([]);
  });

  test('the re-measure script exists and is runnable', () => {
    // The whole failure mode was a claim of verification with no way to re-check
    // it cheaply. `node scripts/check-market-urls.js` is that way.
    const p = path.join(ROOT, 'scripts', 'check-market-urls.js');
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, 'utf8')).toMatch(/DEAD_HOSTS/);
  });
});

// ── No hand-written copies of the map, ever again ──────────────────────────
// The existing tests catch a DEAD host reappearing. They cannot catch a map of
// LIVE-looking hosts, which is how three copies survived the consolidation:
//   api/ai/generate.js        LP_STORE, with an apex domain and a vahdam.in
//   api/_shared/brand-llm.js  STORE_BASE, whose comment asserted that vahdam.in
//   api/_shared/landing-page-core.js  STORE, which sent Global / EU / AU / ME
//                                     to the US store entirely
// The last one is the reason this guard exists: every one of those maps looked
// plausible, and one of them silently pointed a whole region at the wrong
// storefront, currency and catalog.
test('no module keeps its own market -> store map', () => {
  const files = require('child_process')
    .execSync("git ls-files 'api/**/*.js' 'lib/**/*.js' 'scripts/**/*.js'", { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => !/market-urls\.js$/.test(f));
  const offenders = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // Two or more region keys mapped to a vahdam host in one object literal.
    for (const m of src.matchAll(/\{[^{}]*?(?:US|UK|IN|GLOBAL|Global)\s*:\s*['"`]https?:\/\/[^'"`]*vahdam[^{}]*\}/g)) {
      const hits = (m[0].match(/vahdam/g) || []).length;
      if (hits >= 2) offenders.push(`${rel}: ${m[0].slice(0, 90).replace(/\s+/g, ' ')}...`);
    }
    // Or the same shape spread over consecutive lines.
    if (/^\s*(US|UK|GLOBAL|IN)\s*:\s*['"`]https?:\/\/[^'"`]*vahdam/m.test(src)
        && (src.match(/^\s*(US|UK|GLOBAL|IN|Global|EU|AU|ME|India)\s*:\s*['"`]https?:\/\/[^'"`]*vahdam/gm) || []).length >= 2) {
      offenders.push(`${rel}: multi-line region -> vahdam host map`);
    }
  }
  expect([...new Set(offenders)],
    `hand-written store map(s) found. Use storeBase() from market-urls:\n  ${[...new Set(offenders)].join('\n  ')}`).toEqual([]);
});

test('no source invents a vahdam host the canonical map does not have', () => {
  const known = new Set(Object.values(MARKET.STORE_BASE).map((u) => new URL(u).host));
  const files = require('child_process')
    .execSync("git ls-files 'api/**/*.js' 'lib/**/*.js'", { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean).filter((f) => !/market-urls\.js$/.test(f));
  const bad = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]*vahdam[a-z0-9.-]*)/gi)) {
      const host = m[1].toLowerCase();
      if (known.has(host)) continue;
      if (/^try\.vahdam\./.test(host)) continue;            // documented landing subdomains
      if (/myshopify\.com$/.test(host)) continue;            // the admin host, not a storefront
      if (/vercel\.app$/.test(host)) continue;               // THIS app's own origin, not a storefront
      bad.push(`${rel}: ${host}`);
    }
  }
  // vahdam.in is the one this caught: CLAUDE.md records that there is no
  // separate IN storefront today, so IN resolves to the .com store.
  expect([...new Set(bad)], `host(s) not in the canonical map:\n  ${[...new Set(bad)].join('\n  ')}`).toEqual([]);
});
