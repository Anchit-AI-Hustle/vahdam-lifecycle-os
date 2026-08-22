'use strict';

/**
 * A static server + API stub shared by the page-wide interaction crawlers.
 *
 * Every page in this app is a standalone HTML file that boots auth, registers a
 * service worker and calls live endpoints. Opening one over file:// changes its
 * behaviour (no origin, no fetch); pointing it at production makes a test suite
 * spend LLM and image quota. So: serve the real files over http, honour the same
 * friendly routes vercel.json does, and answer every /api/ call with a shaped
 * stub so the page renders its populated state rather than its error state.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.csv': 'text/csv', '.txt': 'text/plain',
};

/** Friendly URL → file, read from vercel.json so the test cannot drift from prod. */
function routeMap() {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const map = new Map();
  for (const r of v.rewrites || []) {
    if (r.source.includes(':') || r.destination.startsWith('/api/')) continue;
    map.set(r.source, r.destination);
  }
  for (const r of v.redirects || []) {
    if (r.source.includes(':')) continue;
    map.set(r.source, r.destination);
  }
  return map;
}

// A generous, SHAPED stub. Returning `{}` would make every page render its
// empty state, and an empty state is exactly what these crawlers are trying to
// tell apart from a broken filter — so the stub has to produce rows.
function apiStub(pathname, search) {
  const action = search.get('action') || '';
  const today = new Date().toISOString().slice(0, 10);
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  const rows = (n, extra = () => ({})) => Array.from({ length: n }, (_, i) => ({ ...extra(i) }));

  // The generation endpoints need REAL-SHAPED answers. A generic {ok:true} makes
  // the Mailer Studio log "Brief creation failed — using heuristic", which is the
  // page handling a bad response correctly and saying so out loud. Treating that
  // as a defect would be blaming the app for the stub; suppressing the message
  // would hide a genuine failure later. Answering properly does neither, and
  // exercises the success path instead of the fallback.
  if (pathname.startsWith('/api/ai/generate') || pathname.startsWith('/api/ai/pipeline')) {
    return {
      ok: true,
      text: JSON.stringify({
        subject: 'A quieter morning, one cup at a time',
        preheader: 'Single-estate leaves, picked this season',
        hero: 'Steep closer to origin', sub: 'Hand-picked single-estate tea',
        offer: '', notes: 'stub brief', headline: 'headline', primary: 'primary',
        blocks: [{ type: 'hero', copy: 'stub' }],
      }),
      brief: { hero: 'Steep closer to origin', sub: 'Hand-picked single-estate tea', offer: '', notes: 'stub brief' },
      hero: 'Steep closer to origin', sub: 'Hand-picked single-estate tea', offer: '', notes: 'stub brief',
      concepts: [{ name: 'Origin ritual', angle: 'single-estate freshness' }],
      html: '<!doctype html><html><body><h1>Stub mailer</h1></body></html>',
      creative_spec: [{ size: '1080x1080', overlay: { headline: 'OV', sub: 'SUB', offer: '' } }],
      master_prompt: 'stub', landing_page_brief: 'stub brief', reference_warnings: [],
      suggestions: {}, score: { total: 9.6, dimensions: {} },
    };
  }
  if (pathname.startsWith('/api/ai/image')) {
    // A 1x1 transparent PNG: enough for an <img> to load without reaching a
    // provider or spending image quota.
    return { ok: true, provider: 'stub', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' };
  }
  if (pathname.startsWith('/api/public-config')) {
    return { ok: true, build: 'test', ts: new Date().toISOString(), supabaseUrl: '', supabaseAnonKey: '' };
  }
  if (action === 'daily-calendar') {
    return {
      ok: true, connected: true, today, market: 'all',
      window: { from: day(-3), to: day(3), days: 7 },
      horizon_days: 90,
      freshness: {
        today, timezone: 'UTC',
        plan_persistence: { last_run_at: new Date().toISOString(), age_hours: 1, ran_today: true, state: 'current', current: true, note: 'Last ran 1h ago.' },
        plan_run: { last_run_at: null, age_hours: null, ran_today: false, state: 'never_run', current: false, note: 'No recorded run.' },
        daily_job: { last_run_at: new Date().toISOString(), age_hours: 2, ran_today: true, state: 'current', current: true, note: 'ok', status: 'success', steps_ok: 5, steps_failed: 0, summary: '5/12 steps ok' },
        coverage: { horizon_days: 90, first_day: today, last_planned_day: day(60), covered_days: 61, missing_days: 29, missing_sample: [day(61)], complete: false, note: '29 of 90 days have no planned slot.' },
        assets: { slots_ahead: 6, ready: 3, partial: 1, none: 2, last_prebuild: null },
      },
      blockers: [{ subsystem: 'plan_sync', detail: 'Window is short.', fix: 'Run the sync.' }],
      totals: { planned: 6, approved: 3, assets_ready: 3, past_days: 3, future_days: 3 },
      days: rows(7, (i) => ({
        date: day(i - 3), bucket: i < 3 ? 'past' : (i === 3 ? 'today' : 'future'), weekday: 'Mon',
        slots: i % 2 ? [] : [{
          id: `cal_${day(i - 3)}_us_nurture`, market: 'US', cohort: 'Nurture', status: 'approved',
          objective: 'education-led conversion', festival: null, hero: 'Turmeric Tea', confidence: 0.7,
          channels: ['email', 'meta'], campaign_id: 'c1', campaign_status: 'approved',
          assets: { email: true, meta: true, google: false, tiktok: false, landing_page: false },
          assets_missing: [], assets_ready: true, images: 3, video: null,
          prebuilt_at: null, approved_at: null, updated_at: new Date().toISOString(), landing_url: '/lp/c1',
        }],
        counts: { planned: i % 2 ? 0 : 1, approved: i % 2 ? 0 : 1, tentative: 0, rejected: 0, archived: 0, assets_ready: i % 2 ? 0 : 1, assets_missing: 0 },
        measured: i < 3 ? { basis: 'stored orders (smart_orders)', orders: 4, revenue: 320 } : null,
        blockers: [],
      })),
    };
  }
  if (action === 'connectors-health' || pathname.includes('connectors-health')) {
    return {
      ok: true, checked_at: new Date().toISOString(), market: 'US',
      summary: { live: 1, blocked: 6, total: 7 },
      groups: { paid_media: { live: 0, total: 3 }, lifecycle: { live: 0, total: 2 }, commerce: { live: 0, total: 1 } },
      platforms: [
        { id: 'klaviyo', name: 'Klaviyo', kind: 'live-api', live: false, blocker: 'Set LIVE_CONNECTORS=on.' },
        { id: 'supabase', name: 'Supabase', kind: 'database', live: true, latency_ms: 12, error: null },
      ],
    };
  }
  if (action === 'smart-brain-plan' || action === 'plan') {
    return { ok: true, mode: 'db-linked', stored: true, entries: [] };
  }
  // Generic shape: every common container key present and non-empty, so a page
  // that renders "nothing" is doing so because of its own logic, not the stub.
  return {
    ok: true, connected: true, generated_at: new Date().toISOString(),
    entries: [], rows: [], items: [], data: [], campaigns: [], platforms: [], days: [],
    summary: {}, counts: {}, totals: {}, blockers: [], note: 'test stub',
  };
}

async function startServer() {
  const map = routeMap();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);

    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(apiStub(p, u.searchParams)));
    }
    if (map.has(p)) p = map.get(p).split('#')[0].split('?')[0];
    if (p === '/') p = '/index.html';

    const f = path.join(ROOT, p);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/**
 * Collect anything that would show up in a browser console as broken. Inline
 * handlers are the point: a dead `onclick` throws a ReferenceError and the
 * button simply does nothing, which is invisible to a screenshot test.
 */
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Network noise from stubbed/absent third-party assets is not a code defect.
    if (/favicon|manifest|service ?worker|sw\.js|Failed to load resource|net::ERR/i.test(t)) return;
    // A SECURITY CONTROL DOING ITS JOB IS NOT A BUG. The Knowledge Base and the
    // mailer previews render stored third-party HTML — captured competitor
    // emails, generated mailers — inside `sandbox=""` iframes, which is exactly
    // right: that content must never execute script in this origin. Chromium
    // logs "Blocked script execution ... the 'allow-scripts' permission is not
    // set" every time it enforces that, and this crawler flagged it as a page
    // error. Left in, the pressure to make the suite green points at adding
    // allow-scripts, which would turn a stored email into an XSS vector. So it
    // is ignored HERE, deliberately, and the sandbox stays shut.
    if (/Blocked script execution.*sandboxed/i.test(t)) return;
    // motion.css declares `@view-transition { navigation: auto }`, so the BROWSER
    // runs a cross-document transition on same-origin navigation. Start a second
    // navigation before the first finishes and it abandons the transition and
    // logs "Transition was skipped". There is no promise for the page to catch —
    // the transition is declared in CSS and managed by the browser — and the
    // effect is cosmetic: the navigation still completes. A crawler clicking
    // every 180ms provokes it by construction, which is how it reached CI as a
    // failure on 2 of 6 viewports while the other 4 raced the other way.
    if (/Transition was skipped/i.test(t)) return;
    errors.push(t);
  });
  return errors;
}

/**
 * Fail every third-party request immediately instead of letting it hang.
 *
 * Two reasons, and the second is the real one.
 *
 * 1. Speed: unreachable CDN hosts hold each page for 20-25s, which turned a
 *    130-check crawl into a 40-minute run nobody will wait for.
 * 2. Determinism: this reproduces, exactly and on demand, the condition that
 *    produced every third-party defect found so far — Tailwind, Chart.js and
 *    ApexCharts all unreachable. An ad-blocker, a corporate proxy, a CDN
 *    outage and an offline PWA launch all look like this to the page.
 *
 * So a crawl with this on is a DEGRADED-MODE test, and should be described that
 * way: it proves the app survives its third parties being gone. It does NOT
 * exercise the happy path where those libraries load, and must not be read as
 * if it did.
 */
// LOCAL means "cannot leave this machine", which is a wider set than the loopback
// server: `file:` is the local disk and several specs open the page that way
// (studio.spec.js reads vahdam_mailer_architect_v34.html straight off disk, and
// looker-embed.spec.js does the same with dashboard.html). Aborting `file:` would
// have blocked those pages' OWN scripts and stylesheets and broken them, which is
// how a blanket "abort anything not http://127.0.0.1" would have looked like the
// app failing rather than the harness overreaching.
//
// `about:` covers the blank document a context starts on. Everything else — every
// http(s) host that is not loopback — is the public internet and is refused.
function isLocalUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)
    || /^(data|blob|file|about):/.test(url);
}

function blockExternal(page) {
  return page.route('**/*', (route) => {
    if (isLocalUrl(route.request().url())) return route.continue();
    return route.abort('failed');
  });
}

module.exports = { startServer, collectErrors, routeMap, blockExternal, isLocalUrl, ROOT };
