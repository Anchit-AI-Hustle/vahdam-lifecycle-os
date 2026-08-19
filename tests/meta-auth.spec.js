const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Meta authentication, and the thing people get wrong about it.
//
// An App ID and App Secret are NOT credentials for reading ad performance. The
// app access token you can build from them (`{app-id}|{app-secret}`) is rejected
// by the Marketing API: Insights needs a USER or SYSTEM USER token with
// `ads_read`. Sending an app secret to a reporting call buys nothing and puts a
// long-lived secret in a request log.
//
// The secret's one correct use server-side is `appsecret_proof`: an HMAC of the
// access token, keyed by the secret, that proves the call came from the app the
// token belongs to. It is opt-in here, because a proof computed from the WRONG
// secret fails every call with an opaque OAuth error.

const ROOT = path.join(__dirname, '..');
const metaAuth = require(path.join(ROOT, 'api', '_shared', 'meta-auth.js'));

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k] of Object.entries(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

test('with no app secret configured, no proof is sent', () => {
  // The hardening is opt-in: a deployment that never sets it must behave
  // exactly as it did before, not start failing on a proof it cannot compute.
  withEnv({ META_APP_SECRET: undefined, META_APP_SECRET_US: undefined }, () => {
    expect(metaAuth.authParams('TOKEN', 'US')).toEqual({ access_token: 'TOKEN' });
    expect(metaAuth.appsecretProof('TOKEN', 'US')).toBe('');
    expect(metaAuth.proofEnabled('US')).toBe(false);
  });
});

test('the proof is the HMAC Meta specifies: sha256 of the token, keyed by the secret', () => {
  withEnv({ META_APP_SECRET: 'app-secret-value', META_APP_SECRET_US: undefined }, () => {
    const expected = crypto.createHmac('sha256', 'app-secret-value').update('TOKEN').digest('hex');
    expect(metaAuth.appsecretProof('TOKEN', 'US')).toBe(expected);
    expect(metaAuth.authParams('TOKEN', 'US')).toEqual({ access_token: 'TOKEN', appsecret_proof: expected });
    expect(metaAuth.proofEnabled('US')).toBe(true);
  });
});

test('the proof is bound to the token, so a different token gives a different proof', () => {
  withEnv({ META_APP_SECRET: 'app-secret-value' }, () => {
    expect(metaAuth.appsecretProof('TOKEN_A')).not.toBe(metaAuth.appsecretProof('TOKEN_B'));
  });
});

test('a per-market secret overrides the global one', () => {
  withEnv({ META_APP_SECRET: 'global', META_APP_SECRET_UK: 'uk-only' }, () => {
    expect(metaAuth.appsecretProof('T', 'UK')).toBe(crypto.createHmac('sha256', 'uk-only').update('T').digest('hex'));
    expect(metaAuth.appsecretProof('T', 'US')).toBe(crypto.createHmac('sha256', 'global').update('T').digest('hex'));
  });
});

test('no token means no auth params at all, never a bare proof', () => {
  withEnv({ META_APP_SECRET: 'app-secret-value' }, () => {
    expect(metaAuth.authParams('', 'US')).toEqual({});
    expect(metaAuth.authParams(undefined, 'US')).toEqual({});
  });
});

// ── Nothing leaks ───────────────────────────────────────────────────────────
test('both secrets are redacted from anything that gets logged or returned', () => {
  const url = 'https://graph.facebook.com/v21.0/act_1/insights?level=ad&access_token=EAAsecret&appsecret_proof=deadbeef&limit=500';
  const out = metaAuth.redact(url);
  expect(out).not.toContain('EAAsecret');
  expect(out).not.toContain('deadbeef');
  expect(out).toContain('access_token=REDACTED');
  expect(out).toContain('appsecret_proof=REDACTED');
  expect(out, 'redaction must not eat the rest of the query').toContain('level=ad');
  expect(out).toContain('limit=500');
});

test('the not_connected stub for the live dashboard redacts the proof too', () => {
  // ads-live-core built its stub with a regex that only knew about
  // access_token, so once a proof was added it would have been published in the
  // would_request payload the UI renders.
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'ads-live-core.js'), 'utf8');
  expect(src, 'the stub still uses the access_token-only regex')
    .not.toMatch(/replace\(\/access_token=\[\^&\]\*\/, 'access_token=REDACTED'\)/);
  expect(src).toMatch(/metaAuth\.redact\(metaUrl\(opts\)\)/);
});

test('this repository stores no Meta secret, only reads one from the environment', () => {
  // The repo is public. Every value must come from process.env at call time.
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'meta-auth.js'), 'utf8');
  // No long hex/base64-ish literal that could be a real secret or token.
  const literals = src.match(/['"][A-Za-z0-9_-]{24,}['"]/g) || [];
  expect(literals, `suspicious literal(s) in meta-auth.js: ${literals}`).toEqual([]);
  expect(src).toMatch(/process\.env/);
});

// ── The callers use it ──────────────────────────────────────────────────────
test('both Meta callers go through the shared helper', () => {
  for (const f of ['ad-insights-core.js', 'ads-live-core.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', f), 'utf8');
    expect(src, `${f} does not import meta-auth`).toMatch(/require\('\.\/meta-auth\.js'\)/);
    expect(src, `${f} does not call authParams`).toMatch(/metaAuth\.authParams\(/);
  }
});

test('ad-insights sends the proof on the real Insights request', async () => {
  // Run the actual request builder against a stubbed fetch and read the URL it
  // produced, rather than asserting on the source.
  const core = path.join(ROOT, 'api', '_shared', 'ad-insights-core.js');
  const seen = [];
  const realFetch = global.fetch;
  // fetchJson reads res.text() and parses it, so the stub has to answer that.
  global.fetch = async (u) => {
    seen.push(String(u));
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"data":[]}', json: async () => ({ data: [] }) };
  };
  try {
    await withEnv({
      META_ACCESS_TOKEN: 'TOKEN123', META_AD_ACCOUNT_ID: '999', META_APP_SECRET: 'app-secret-value',
      LIVE_CONNECTORS: 'on',
    }, async () => {
      delete require.cache[require.resolve(core)];
      const insights = require(core);
      await insights.insights({ platform: 'meta', market: 'US', level: 'account' });
    });
  } finally {
    global.fetch = realFetch;
    delete require.cache[require.resolve(core)];
    require(core);
  }
  const graph = seen.find((u) => u.includes('graph.facebook.com'));
  expect(graph, `no Meta call was made; saw: ${seen.join(', ')}`).toBeTruthy();
  const proof = crypto.createHmac('sha256', 'app-secret-value').update('TOKEN123').digest('hex');
  expect(graph).toContain(`appsecret_proof=${proof}`);
  expect(graph).toContain('access_token=TOKEN123');
});

test('an app id and app secret alone are still reported as not connected', () => {
  // The failure this whole module exists to prevent: believing that having an
  // app means having ads access. Without META_ACCESS_TOKEN there is no read.
  const core = path.join(ROOT, 'api', '_shared', 'ad-insights-core.js');
  return withEnv({
    META_ACCESS_TOKEN: undefined, META_AD_ACCOUNT_ID: undefined,
    META_APP_ID: '1234567890', META_APP_SECRET: 'app-secret-value', LIVE_CONNECTORS: 'on',
  }, async () => {
    delete require.cache[require.resolve(core)];
    const insights = require(core);
    const r = await insights.insights({ platform: 'meta', market: 'US', level: 'account' });
    delete require.cache[require.resolve(core)];
    require(core);
    expect(r.connected).toBe(false);
    expect(r.need_env).toContain('META_ACCESS_TOKEN');
    expect(r.need_env).toContain('META_AD_ACCOUNT_ID');
    expect(r.data, 'never a fabricated figure').toBeUndefined();
  });
});

test('the setup steps name the env vars the code actually reads', () => {
  const steps = metaAuth.SETUP_STEPS.join(' ');
  for (const v of ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_APP_SECRET', 'LIVE_CONNECTORS']) {
    expect(steps, `setup steps omit ${v}`).toContain(v);
  }
  expect(steps).toMatch(/ads_read/);
  expect(steps).toMatch(/system user/i);
});
