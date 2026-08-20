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
  expect(AUTH).toMatch(/async function signIn[\s\S]{0,400}rememberReturnTo\(\)/);
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
test.describe('the CTA actually starts sign-in', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'behaviour test, one engine');
  test.use({ serviceWorkers: 'block' });

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
    await page.goto(origin + '/');
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
    await page.goto(origin + '/');
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
