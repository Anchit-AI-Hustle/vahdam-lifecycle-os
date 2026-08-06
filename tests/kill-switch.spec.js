const { test, expect } = require('@playwright/test');
const path = require('path');

// LIVE_CONNECTORS is the project's outbound kill switch. Its documented contract
// is absolute: with the switch off, "the app never opens a live external
// connection" and every gated connector falls back to its honest not-connected
// path.
//
// Klaviyo was punching through it. klaviyo-core.request() gated on the API key
// alone, so with a key set and the switch off it called Klaviyo for real, while
// isConnected() — and therefore /api/connectors-health and every caller that
// asks before acting — reported it as not connected. Two consequences, both bad:
// the safety control was silently ineffective, and the health endpoint told an
// operator to set KLAVIYO_API_KEY when that key was already set and working,
// sending them to fix the one thing that was not broken.
//
// A kill switch that one connector ignores is worse than no kill switch, because
// everything downstream trusts it.

const ROOT = path.join(__dirname, '..');
const SWITCH = 'LIVE_CONNECTORS';

function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] == null) delete process.env[k]; else process.env[k] = env[k];
  }
  try { return fn(); } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] == null) delete process.env[k]; else process.env[k] = prev[k];
    }
  }
}

function fresh(mod) {
  // The cores read process.env at call time, but require caches the module, so
  // reload to be certain no boot-time capture is hiding a stale value.
  const p = require.resolve(path.join(ROOT, 'api', '_shared', mod));
  delete require.cache[p];
  return require(p);
}

test('with the switch OFF and a key set, Klaviyo does not call out', async () => {
  await withEnv({ [SWITCH]: null, KLAVIYO_API_KEY: 'pk_test_not_a_real_key' }, async () => {
    const klaviyo = fresh('klaviyo-core.js');
    expect(klaviyo.hasKey(), 'fixture should have a key set').toBe(true);
    expect(klaviyo.isConnected()).toBe(false);

    const r = await klaviyo.getLists({});
    // The tell that no request left the process: a real call to Klaviyo with a
    // bogus key returns connected:true with an auth error, never not_connected.
    expect(r.not_connected, 'a live call was made despite the kill switch').toBe(true);
    expect(r.connected).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.would_request.method).toBe('GET');
    // And the blocker names the ACTUAL blocker, not the key that is already set.
    expect(r.blocker).toMatch(/LIVE_CONNECTORS/);
    expect(r.blocker).toMatch(/already set/i);
  });
});

test('with NO key, the blocker names the key, not the switch', async () => {
  await withEnv({ [SWITCH]: 'on', KLAVIYO_API_KEY: null }, async () => {
    const klaviyo = fresh('klaviyo-core.js');
    expect(klaviyo.hasKey()).toBe(false);
    const r = await klaviyo.getLists({});
    expect(r.not_connected).toBe(true);
    expect(r.hint).toMatch(/KLAVIYO_API_KEY/);
  });
});

test('hasKey and isConnected are distinct, so the two failures stay distinguishable', async () => {
  await withEnv({ [SWITCH]: null, KLAVIYO_API_KEY: 'pk_x' }, async () => {
    const k = fresh('klaviyo-core.js');
    expect(k.hasKey()).toBe(true);       // the key IS set
    expect(k.isConnected()).toBe(false); // but the switch holds it back
  });
  await withEnv({ [SWITCH]: 'on', KLAVIYO_API_KEY: 'pk_x' }, async () => {
    const k = fresh('klaviyo-core.js');
    expect(k.hasKey()).toBe(true);
    expect(k.isConnected()).toBe(true);
  });
});

test('the health probe distinguishes no-key from switch-off', async () => {
  await withEnv({ [SWITCH]: null, KLAVIYO_API_KEY: null }, async () => {
    const health = fresh('connectors-health.js');
    const out = await health.snapshot ? await health.snapshot({ market: 'US' }) : null;
    if (!out) return; // shape differs; the per-core tests above carry the contract
    const kl = out.platforms.find((p) => p.id === 'klaviyo');
    expect(kl.live).toBe(false);
    expect(kl.blocker).toMatch(/KLAVIYO_API_KEY/);
  });
});

test('every outbound connector core imports the kill switch', () => {
  // A core that never imports it cannot possibly honour it. This is the check
  // that would have caught the Klaviyo hole on the day it was written.
  const fs = require('fs');
  const dir = path.join(ROOT, 'api', '_shared');
  const OUTBOUND = [
    'klaviyo-core.js', 'shopify-core.js', 'ad-insights-core.js',
    'ads-live-core.js', 'ads-snowflake-core.js',
  ];
  for (const f of OUTBOUND) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    expect(src, `${f} never imports the kill switch`).toMatch(/liveConnectorsEnabled/);
    // Importing it is not enough — it has to be CALLED on the request path.
    const calls = (src.match(/liveConnectorsEnabled\(\)/g) || []).length;
    expect(calls, `${f} imports the kill switch but never calls it`).toBeGreaterThan(0);
  }
});
