// Sign-in is not required to VIEW any feature (product owner, 2026-08-30), and
// the switch back is one env var: REQUIRE_SIGN_IN.
//
// The load-bearing property is the SCOPE. This toggle governs the front-end
// login wall only. It must not touch the operator gate that guards
// /api/shopify, ?pipeline=1, ?probe=1, forced catalog refresh and the detailed
// health payload - those return real order and customer records, so opening
// the UI is a UX decision and opening them would be a data-exposure one.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib/page-harness.js');

test.use({ serviceWorkers: 'block' });

const AUTH = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');

test('the default is open: no env var means sign-in is not required', () => {
  delete process.env.REQUIRE_SIGN_IN;
  const parse = (v) => /^(1|on|true|yes)$/i.test(String(v || '').trim());
  expect(parse(process.env.REQUIRE_SIGN_IN)).toBe(false);
  // And the in-code default is open too, so an unreachable /api/public-config
  // cannot wall a page by accident. That is the whole point of the change.
  expect(AUTH).toMatch(/var REQUIRE_SIGN_IN = false;/);
});

test('the env var flips it back, in the forms an operator would actually type', () => {
  const parse = (v) => /^(1|on|true|yes)$/i.test(String(v || '').trim());
  for (const on of ['on', 'ON', '1', 'true', 'TRUE', 'yes', ' on ']) {
    expect(parse(on), `${JSON.stringify(on)} should enable the wall`).toBe(true);
  }
  for (const off of ['', 'off', '0', 'false', 'no', undefined]) {
    expect(parse(off), `${JSON.stringify(off)} should leave it open`).toBe(false);
  }
});

test('public-config serves the flag from the env var', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/public-config.js'), 'utf8');
  expect(src).toMatch(/require_sign_in:/);
  expect(src).toMatch(/process\.env\.REQUIRE_SIGN_IN/);
});

test('the wall decision consults the toggle FIRST, before any nav or path flag', () => {
  const fn = AUTH.slice(AUTH.indexOf('function isOpenPage() {'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  // If the toggle check came after the path checks, a page could still wall
  // itself on a nav flag while the toggle said open.
  expect(body.indexOf('signInRequired()')).toBeGreaterThan(-1);
  expect(body.indexOf('signInRequired()')).toBeLessThan(body.indexOf('location.pathname'));
});

// THE BOUNDARY. This is the assertion that matters most in this file.
test('the toggle does not touch the operator gate on privileged APIs', () => {
  const core = fs.readFileSync(path.join(ROOT, 'api/_shared/data-analysis-core.js'), 'utf8');
  expect(core, 'authorize() must not consult the sign-in toggle').not.toMatch(/REQUIRE_SIGN_IN/);
  // authorize() still demands a bearer token; the toggle cannot bypass it.
  expect(core).toMatch(/operator_session_required/);
  // Stronger than checking one route: the toggle must be read in exactly ONE
  // server-side place (public-config, which serves it to the browser) and must
  // never appear in gating logic. /api/shopify is a rewrite, not a file, so
  // naming files would have missed it anyway.
  const cp = require('child_process');
  const hits = cp.execSync("grep -rl 'REQUIRE_SIGN_IN' api lib || true", { cwd: ROOT })
    .toString().trim().split('\n').filter(Boolean);
  expect(hits).toEqual(['api/public-config.js']);
});

test.describe('behaviour on a real page', () => {
  // NOT served from 127.0.0.1. auth.js treats localhost and file:// as "local
  // preview" and injects the top-bar without ever consulting the wall, so a
  // test on the local harness measures that branch and NOTHING about the
  // toggle. The first version of this test passed against both toggle states
  // for exactly that reason. Serving from a non-local hostname is what makes
  // the assertion real.
  const HOST = 'https://vahdam-toggle.test';

  async function load(page, requireSignIn) {
    // ORDER MATTERS AND IS THE OPPOSITE OF WHAT IT LOOKS LIKE: Playwright checks
    // routes in REVERSE registration order, so the LAST registered wins. The
    // catch-all deny goes FIRST (lowest priority); without that it won and
    // called continue(), which tried the real network and failed the navigation
    // outright rather than serving from disk.
    await page.route('**', (route) => route.abort());
    await page.route(`${HOST}/**`, (route) => {
      const p = new URL(route.request().url()).pathname;
      const file = p === '/brain' ? 'smart-brain.html' : p.replace(/^\//, '');
      const full = path.join(ROOT, file);
      if (!fs.existsSync(full)) return route.fulfill({ status: 404, body: '' });
      const type = file.endsWith('.js') ? 'text/javascript'
        : file.endsWith('.css') ? 'text/css' : 'text/html';
      return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(full, 'utf8') });
    });
    await page.route('**/api/public-config*', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        supabase: { url: 'https://stub.supabase.co', anonKey: 'anon' },
        app: { name: 'VAHDAM Lifecycle OS' },
        flags: { require_sign_in: requireSignIn },
      }),
    }));
    await page.goto(`${HOST}/brain`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  }

  test('with the toggle ON, a walled page shows the login wall', async ({ page }) => {
    await load(page, true);
    // Premise first: if this is false the toggle never reached the page and the
    // assertion below would be measuring nothing.
    expect(await page.evaluate(() => window.LifecycleAuth?.signInRequired?.())).toBe(true);
    expect(await page.locator('#lifecycle-loginwall').count()).toBeGreaterThan(0);
  });

  test('with the toggle OFF, the same page renders no wall', async ({ page }) => {
    await load(page, false);
    expect(await page.evaluate(() => window.LifecycleAuth?.signInRequired?.())).toBe(false);
    expect(await page.locator('#lifecycle-loginwall').count()).toBe(0);
  });
});
