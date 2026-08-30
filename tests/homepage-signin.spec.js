const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

// The homepage's main "Sign in with Google" CTA hand-rolled its own
// signInWithOAuth call with redirectTo = origin + '/dashboard'.
//
// /dashboard is not a route. dashboard.html is served at /rfm, and cleanUrls is
// false, so the extensionless /dashboard matches no rewrite. Google completed
// the sign-in and dropped the user on a 404. It fails a second way too: auth.js
// already documents that Supabase bounces to the Site URL when the exact path
// is not in the redirect allow-list, and a path nobody uses is not in it.
//
// The footer button on the SAME page worked, because it goes through auth.js,
// which uses origin + pathname. That is the tell: two implementations of one
// thing, and only the copy drifted. So the fix is one implementation
// (LifecycleAuth.signIn), not a corrected second copy.

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const AUTH = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

test('sign-in has exactly one implementation, and it lives in auth.js', () => {
  const files = require('child_process')
    .execSync('git ls-files "*.html" "*.js"', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => !f.startsWith('tests/') && !f.startsWith('scripts/') && !f.startsWith('node_modules/'));
  const callers = files.filter((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // Ignore prose: only count a real call, i.e. followed by an opening paren.
    return /\.auth\.signInWithOAuth\s*\(/.test(src);
  });
  expect(callers, `sign-in is implemented in more than one place:\n  ${callers.join('\n  ')}`)
    .toEqual(['auth.js']);
});

test('auth.js exposes signIn so a page never needs its own', () => {
  expect(AUTH).toMatch(/async function signIn\s*\(/);
  expect(AUTH, 'signIn is not on window.LifecycleAuth').toMatch(/\n\s*signIn,/);
  // It must still remember where the user was; that is why the bounce recovers.
  // Sliced to the function rather than matched within a fixed character window:
  // the reachability guard now sits between the declaration and this call, and a
  // char-count window turns any future line added to signIn() into a failure
  // that says nothing about what actually broke.
  const body = AUTH.slice(AUTH.indexOf('async function signIn('),
    AUTH.indexOf('function restoreReturnTo'));
  expect(body, 'signIn no longer remembers where the user was').toMatch(/rememberReturnTo\(\)/);
});

test('the homepage CTA delegates instead of rolling its own', () => {
  expect(INDEX).toMatch(/window\.LifecycleAuth\.signIn\(\)/);
  expect(INDEX, "the homepage still points OAuth at /dashboard")
    .not.toContain("location.origin + '/dashboard'");
});

test('no sign-in redirect points at a path that is not a route', () => {
  // The general guard. Any hard-coded absolute path handed to redirectTo must
  // resolve to something the deployment actually serves.
  const routes = new Set([
    ...(VERCEL.rewrites || []).map((r) => r.source),
    ...(VERCEL.redirects || []).map((r) => r.source),
    '/',
  ]);
  const hits = [];
  for (const [file, src] of [['index.html', INDEX], ['auth.js', AUTH]]) {
    for (const m of src.matchAll(/redirectTo:\s*location\.origin\s*\+\s*'([^']+)'/g)) {
      if (!routes.has(m[1])) hits.push(`${file}: redirectTo ${m[1]} is not a route`);
    }
  }
  expect(hits, hits.join('\n')).toEqual([]);
});

test('/dashboard really is not a route, so the premise holds', () => {
  // Guards the whole file: if /dashboard is ever added as a real route this
  // test tells you, rather than the suite quietly proving nothing.
  const sources = (VERCEL.rewrites || []).map((r) => r.source);
  expect(sources).not.toContain('/dashboard');
  expect(sources, 'the RFM dashboard is served at /rfm').toContain('/rfm');
});

// ── Behavioural: click the real button on the real page ─────────────────────

/**
 * Nothing but our own server may be waited on.
 *
 * page.goto defaults to waitUntil:'load', and index.html links Google Fonts,
 * Vercel speed-insights, esm.sh/three and dozens of Shopify CDN images. In CI
 * those cannot resolve, so goto sat there until each connection gave up:
 * MEASURED 13,035ms for the goto against 657ms for the click it was setting up.
 * That is what pushed this spec past the 60s test timeout on pixel-5 - not the
 * click, and not the page. With third-party requests aborted the same goto
 * takes 210ms.
 */
function blockExternal(page, own) {
  return page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(own) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort('failed');
  });
}

test.describe('the CTA actually starts sign-in', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'behaviour test, one engine');
  test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

  let server; let origin;
  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      const f = path.join(ROOT, u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname));
      if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        const ext = path.extname(f);
        res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/plain' });
        return res.end(fs.readFileSync(f));
      }
      res.writeHead(404); res.end('not found');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    origin = 'http://127.0.0.1:' + server.address().port;
  });
  test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

  test('clicking it calls LifecycleAuth.signIn, not a private OAuth call', async ({ page }) => {
    await blockExternal(page, origin);
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    // Stand in for auth.js's real client so nothing leaves the page.
    await page.evaluate(() => {
      window.__calls = [];
      window.LifecycleAuth = window.LifecycleAuth || {};
      window.LifecycleAuth.client = { auth: { signInWithOAuth: (o) => { window.__calls.push(['private', o]); return { error: null }; } } };
      window.LifecycleAuth.signIn = async () => { window.__calls.push(['signIn', location.origin + location.pathname]); };
      window.LifecycleAuth.user = null;
    });
    const btn = page.locator('#home-signin');
    await btn.evaluate((el) => { el.hidden = false; });
    await btn.click();
    const calls = await page.evaluate(() => window.__calls);
    expect(calls.length, 'the button did nothing').toBeGreaterThan(0);
    expect(calls[0][0], 'the CTA bypassed auth.js and called OAuth itself').toBe('signIn');
    // And the destination is the page the user is standing on, which exists.
    expect(calls[0][1]).toBe(origin + '/');
  });

  test('a failed sign-in restores the button instead of stranding it', async ({ page }) => {
    await blockExternal(page, origin);
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.LifecycleAuth = window.LifecycleAuth || {};
      window.LifecycleAuth.signIn = async () => { throw new Error('nope'); };
      window.LifecycleAuth.user = null;
    });
    const btn = page.locator('#home-signin');
    await btn.evaluate((el) => { el.hidden = false; });
    const before = await btn.textContent();
    await btn.click();
    await expect(btn).toBeEnabled();
    // It must not be left reading "Redirecting to Google…" forever.
    await expect(btn).toHaveText(before.trim());
  });
});

// A PAUSED SUPABASE PROJECT KEEPS ITS URL, AND THAT IS WHY THIS BROKE SILENTLY.
//
// Reported live: /ads-master rendered the sign-in wall, the button was enabled,
// and clicking it navigated to
//   https://<ref>.supabase.co/auth/v1/authorize?provider=google&redirect_to=...
// which returned DNS_PROBE_FINISHED_NXDOMAIN. Supabase pauses inactive free-tier
// projects and de-provisions the API hostname; the project and the URL both
// stay correct. So every "is Supabase configured" check passed - the wall's own
// warning was `window.__SUPABASE__?.url ? '' : ...`, i.e. it only fired when the
// URL was MISSING - and the user was handed to a browser DNS error page with no
// banner, no cause and no way back.
//
// signInWithOAuth is a full-page navigation, so after it fires there is nothing
// left in this app to report anything. Reachability must be checked BEFORE it.
test.describe('sign-in refuses to navigate into an unreachable auth backend', () => {
  test('the probe is made before signInWithOAuth, not after', () => {
    // COMMENTS ARE STRIPPED FIRST. The comment explaining the guard names
    // signInWithOAuth, so scanning the raw source found the explanation at a
    // lower index than the call and failed - and a guard that trips on the
    // note describing the bug it prevents only teaches people to delete the
    // note. This repo has now hit that exact trap three times (the asset-prompt
    // guard and the llm.js format-string guard were the first two).
    const raw = AUTH.slice(AUTH.indexOf('async function signIn('), AUTH.indexOf('function restoreReturnTo'));
    const fn = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(fn, 'signIn() does not check reachability').toMatch(/authBackendReachable\s*\(/);
    expect(fn, 'the premise is gone: signIn no longer navigates via signInWithOAuth')
      .toMatch(/signInWithOAuth/);
    expect(fn.indexOf('authBackendReachable'),
      'the reachability check must run BEFORE the navigation, or it cannot prevent it')
      .toBeLessThan(fn.indexOf('signInWithOAuth'));
  });

  test('a CORS policy is never read as "the backend is down"', () => {
    // no-cors is load-bearing: an opaque response still proves the network
    // reached the host. A cors-mode probe would reject on a CORS header and
    // report a perfectly healthy backend as unreachable.
    const probe = AUTH.slice(AUTH.indexOf('async function authBackendReachable'),
      AUTH.indexOf('function supabaseRefAndHost'));
    expect(probe).toMatch(/mode:\s*'no-cors'/);
    expect(probe, 'an unbounded probe would hang the click').toMatch(/AbortController|signal/);
  });

  test('the wall notice covers unreachable, not only unconfigured', () => {
    // The original guard keyed on a MISSING url, which is exactly the case that
    // was not happening. Assert the shipped markup no longer does that.
    expect(AUTH).toMatch(/id="llw-notice"/);
    expect(AUTH, 'the wall still gates its warning on the url merely being present')
      .not.toMatch(/\$\{window\.__SUPABASE__\?\.url \? '' :/);
  });

  test('the verdict names a likely cause and both remedies, and never asserts one as fact', () => {
    const notice = AUTH.slice(AUTH.indexOf('function authBackendNoticeHtml'),
      AUTH.indexOf('function showAuthBackendNotice'));
    expect(notice, 'the notice does not mention the paused-project cause').toMatch(/paused/i);
    expect(notice, 'a probe cannot distinguish paused from deleted, so it must hedge')
      .toMatch(/most likely/i);
    expect(notice, 'the deleted/replaced remedy is missing').toMatch(/SUPABASE_URL/);
    expect(notice, 'offline must not be reported as a broken backend').toMatch(/offline/i);
  });

  test('the dashboard link is derived from the configured url, never a constant', () => {
    const ref = AUTH.slice(AUTH.indexOf('function supabaseRefAndHost'),
      AUTH.indexOf('function authBackendNoticeHtml'));
    expect(ref).toMatch(/new URL\(window\.__SUPABASE__\.url\)/);
    // No hard-coded project ref anywhere in the dashboard link.
    expect(AUTH).not.toMatch(/supabase\.com\/dashboard\/project\/[a-z0-9]{8,}/);
  });

  test('there is ONE explainer, and the homepage CTA uses it', () => {
    expect(AUTH, 'the explainer is not exposed, so a page must write its own')
      .toMatch(/signInBlockedHtml:\s*authBackendNoticeHtml/);
    expect(INDEX).toMatch(/signInBlockedHtml/);
    // The CTA used to swallow the error and silently reset - a button that does
    // nothing. It must now surface the verdict.
    expect(INDEX).toMatch(/e\.authBackend/);
  });
});

test.describe('a dead backend opens the app instead of navigating to it', () => {
  const { blockExternal } = require('./lib/page-harness.js');
  let server, origin;
  test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/api/public-config') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // A host that cannot resolve, exactly like a paused project's.
        return res.end(JSON.stringify({
          supabase: { url: 'https://paused-project-does-not-resolve.supabase.co', anonKey: 'x.y.z' },
        }));
      }
      if (u.pathname.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      const f = path.join(ROOT, u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname));
      if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        const ext = path.extname(f);
        res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/plain' });
        return res.end(fs.readFileSync(f));
      }
      res.writeHead(404); res.end('not found');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    origin = 'http://127.0.0.1:' + server.address().port;
  });
  test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

  // SUPERSEDED, deliberately. This used to assert that the wall STAYS and
  // explains itself with the button disabled. That was the right answer while
  // the wall was assumed to be protecting something; it is not, when the host
  // it gates does not resolve. No session can be obtained and no query can
  // succeed, so the wall costs every feature and defends nothing.
  //
  // What this test was really guarding survives unchanged and is asserted
  // below: the user must still be HERE, never handed to a DNS error page.
  test('the app opens, names the dead host, and never navigates to it', async ({ page }) => {
    // Everything off-origin fails, which is what a de-provisioned host does to
    // the reachability probe AND to the authorize navigation.
    await blockExternal(page, origin);
    // Registered AFTER blockExternal on purpose: Playwright checks routes in
    // REVERSE registration order, so the later handler wins. Registered first,
    // this stub is shadowed by blockExternal's '**/*' and the CDN is aborted.
    //
    // The supabase-js CDN is stubbed rather than blocked because blocking it
    // makes init() reject, which is a DIFFERENT failure (one this pass also
    // fixed). Stubbing keeps this test about the thing it names: a configured
    // backend whose HOST is not there.
    await page.route('**/cdn.jsdelivr.net/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `window.supabase = { createClient: () => ({ auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithOAuth: async (o) => { location.href = o.options.redirectTo; return {}; },
      } }) };`,
    }));
    const navs = [];
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs.push(f.url()); });

    // This test is ABOUT the login wall, so it turns the wall on explicitly
    // rather than relying on a default. Sign-in became optional by default on
    // 2026-08-30 (REQUIRE_SIGN_IN), which stopped this page from walling and
    // left the test waiting for a notice that could never appear. The override
    // exists for exactly this: assert wall behaviour without depending on the
    // deployment-wide setting.
    await page.addInitScript(() => { window.__REQUIRE_SIGN_IN__ = true; });

    await page.goto(origin + '/ad-campaigns-master.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
    // auth.js resolves the config, finds the host does not answer, and opens.
    const notice = page.locator('#lc-nobackend');
    await expect(notice, 'the app never explained why it has no data')
      .toContainText(/cannot be reached/i, { timeout: 20000 });
    // Naming the host is the difference between a status and a remedy: it is
    // the value the operator has to change.
    await expect(notice).toContainText('paused-project-does-not-resolve.supabase.co');
    // And the page is genuinely usable, not a wall wearing a new id.
    await expect(page.locator('#lifecycle-loginwall'),
      'an unpassable wall was left in front of a backend that does not exist').toHaveCount(0);
    await expect(page.locator('#lifecycle-nav'),
      'the nav did not render, so nothing is reachable').toHaveCount(1);

    // And the critical part: the user is still HERE, not on a DNS error page.
    expect(navs.filter((u) => /supabase\.co/.test(u)),
      'the app navigated to the dead auth host anyway').toEqual([]);
    expect(page.url()).toContain('127.0.0.1');
  });
});
