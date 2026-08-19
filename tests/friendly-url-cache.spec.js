const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// A shipped fix can be invisible in the browser, and this is how.
//
// The no-cache rule was `/(.*)\.html`, which only matches a path ENDING in
// .html. But nothing navigates that way: the nav links to /ads-master, /brain,
// /studio, /analytics, and vercel.json rewrites those to the .html files. Those
// paths carry no extension, so the rule matched NONE of the pages anyone
// actually opens, and none of them carried a revalidate header.
//
// The tell is a page showing a NEW sidebar next to OLD table CSS: auth.js is a
// separate request that came back fresh, while the page HTML on the friendly
// URL was served from cache. Two different ages of the same deploy on one
// screen, which reads as "the fix did not work".
//
// The shared front-end modules had no rule at all either (only /sw.js did), and
// they are unhashed and shared by every page, so a stale auth.js or
// gate-notice.js makes a shipped fix look unapplied everywhere at once.

const ROOT = path.join(__dirname, '..');
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

// Vercel header sources are path-to-regexp with regex allowed inside a group.
// The forms this file uses are plain enough to evaluate directly.
function sourceToRegExp(source) {
  return new RegExp('^' + source.replace(/\/$/, '') + '$');
}
function headersFor(pathname) {
  const out = {};
  for (const rule of VERCEL.headers || []) {
    let re;
    try { re = sourceToRegExp(rule.source); } catch (_) { continue; }
    if (!re.test(pathname)) continue;
    // Later matching rules win for the same key, which is how /sw.js keeps its
    // own policy despite the broader .js rule above it.
    for (const h of rule.headers || []) out[h.key] = h.value;
  }
  return out;
}
const revalidates = (p) => /no-store|max-age=0/.test(headersFor(p)['Cache-Control'] || '');

// Every friendly URL that serves a page, read from the rewrites rather than
// listed here, so a new page is covered the day it is added.
const PAGE_ROUTES = (VERCEL.rewrites || [])
  .filter((r) => /\.html($|\?)/.test(r.destination || '') && !String(r.source).startsWith('/api'))
  .map((r) => r.source)
  .filter((s) => !s.includes(':'));   // parameterised routes are matched differently

test('the rewrites really do serve pages on extensionless paths', () => {
  // Guards the premise. If this ever returns nothing, the rest proves nothing.
  expect(PAGE_ROUTES.length).toBeGreaterThan(20);
  expect(PAGE_ROUTES).toContain('/ads-master');
  expect(PAGE_ROUTES.filter((s) => s.endsWith('.html')).length,
    'these should be the FRIENDLY paths, not .html ones').toBe(0);
});

test('every friendly page route must revalidate', () => {
  const uncovered = PAGE_ROUTES.filter((r) => !revalidates(r));
  expect(uncovered, `page routes served without a revalidate header:\n  ${uncovered.join('\n  ')}`).toEqual([]);
});

test('the routes named in the bug report are covered', () => {
  // /ads-master is the one that showed a new sidebar over old CSS.
  for (const r of ['/ads-master', '/brain', '/studio', '/analytics', '/social', '/']) {
    expect(revalidates(r), `${r} can be served stale after a deploy`).toBe(true);
  }
});

test('the shared front-end modules must revalidate too', () => {
  // Unhashed and loaded by every page: one stale copy hides a fix everywhere.
  for (const f of ['/auth.js', '/gate-notice.js', '/table-sort.js', '/chart-enhance.js', '/funnel-drill.js', '/ai-studio-bar.js', '/theme.css']) {
    expect(revalidates(f), `${f} can be served stale after a deploy`).toBe(true);
  }
});

test('.html paths keep their existing coverage', () => {
  // The original rule still has to work for anyone who lands on a bare file.
  for (const f of ['/ad-campaigns-master.html', '/index.html', '/smart-brain.html']) {
    expect(revalidates(f), `${f} lost its revalidate header`).toBe(true);
  }
});

test('the API and the data files keep their own policies', () => {
  // The broad new rules must not reach past pages and shared modules.
  const api = headersFor('/api/brain');
  expect(api['Cache-Control'], 'the API cache policy was overwritten').toBeTruthy();
  expect(api['Cache-Control']).toMatch(/no-store|no-cache/);
  // The built catalog is deliberately cacheable; it must not have been swept up.
  const cat = headersFor('/data/catalog/products_us.json');
  expect(cat['Cache-Control'], 'the catalog lost its cache policy').toBeTruthy();
  expect(cat['Cache-Control'], 'the catalog was made uncacheable').not.toMatch(/max-age=0/);
});

test('sw.js keeps its own policy despite the broader .js rule', () => {
  // The service worker script has deliberate handling; a later rule must win.
  const sw = headersFor('/sw.js');
  expect(sw['Service-Worker-Allowed'], 'sw.js lost its scope header').toBeTruthy();
  expect(sw['Cache-Control']).toBeTruthy();
});

test('security headers still apply to everything', () => {
  for (const p of ['/ads-master', '/auth.js', '/index.html']) {
    expect(headersFor(p)['X-Content-Type-Options'], `${p} lost its security headers`).toBe('nosniff');
  }
});
