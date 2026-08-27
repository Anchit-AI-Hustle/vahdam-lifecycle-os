const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { generateKeyPairSync } = require('crypto');
const { google } = require('googleapis');

// api/_shared/competitor-core.js is the repo's ONLY consumer of googleapis, and
// it had no test coverage of any kind. `node --check` parses it; nothing
// exercised it. So a breaking change in a large, frequently-bumped dependency
// could only surface as a competitor sync failing in production, days later,
// with the bump long since merged.
//
// That gap was not hypothetical. The WIF (keyless) auth mode built an
// OAuth2Client and then overrode its public getAccessToken / getRequestHeaders
// / request methods to inject the impersonated token. OAuth2Client.requestAsync
// calls the PRIVATE getRequestMetadataAsync instead, so the override never ran
// and every Sheets call in WIF mode threw "No access, refresh token, API key or
// refresh handler callback is set" before reaching the network. Measured dead on
// google-auth-library 9.15.1, 10.5.0 and 11.0.2 — it never worked as written.
//
// These tests therefore do not stop at "the module loads". They drive a real
// googleapis request, from the real auth client, at a local server, and read the
// Authorization header off the wire. A client that cannot authorise a request
// fails here instead of at 03:30 UTC.

const ROOT = path.join(__dirname, '..');
const CORE = path.join(ROOT, 'api', '_shared', 'competitor-core.js');

// A throwaway key so the JWT client signs something structurally real. It
// authorises nothing — no Google account has the public half.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const GOOGLE_ENV = [
  'GCP_WORKLOAD_IDENTITY_PROVIDER', 'GCP_SERVICE_ACCOUNT_EMAIL', 'VERCEL_OIDC_TOKEN',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'GOOGLE_SHEET_ID', 'GOOGLE_SHEET_TAB',
];

function loadCore() {
  delete require.cache[require.resolve(CORE)];
  return require(CORE).__testing;
}

/** A stand-in Sheets host that records what arrived. */
async function sheetsStub() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization || null });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sheets: [{ properties: { title: 'Emails' } }] }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    seen,
    rootUrl: `http://127.0.0.1:${srv.address().port}/`,
    close: () => srv.close(),
  };
}

/** The one call every sheet helper in the core starts from. */
function get(auth, rootUrl) {
  return google.sheets({ version: 'v4', auth, rootUrl })
    .spreadsheets.get({ spreadsheetId: 'sheet-id', fields: 'sheets.properties.title' });
}

let savedEnv;
test.beforeEach(() => {
  savedEnv = {};
  for (const k of GOOGLE_ENV) { savedEnv[k] = process.env[k]; delete process.env[k]; }
});
test.afterEach(() => {
  for (const k of GOOGLE_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('the module still loads and exposes what api/competitor.js dispatches to', () => {
  delete require.cache[require.resolve(CORE)];
  const core = require(CORE);
  // api/competitor.js reaches for these by name; a bump that broke the require
  // (or the googleapis import inside it) would take the whole router with it.
  for (const fn of ['getAllEmails', 'getEmailHtml', 'getRawHtml', 'runSync', 'ensureHeaderRow', 'ingestEmail']) {
    expect(typeof core[fn], `${fn} must stay callable`).toBe('function');
  }
});

test('with neither auth mode configured, the error names both of them', () => {
  const { sheetsClient, resetSheetsClient } = loadCore();
  resetSheetsClient();
  let msg = '';
  try { sheetsClient(); } catch (e) { msg = e.message; }
  // An operator reading a log needs the fix, not "auth failed".
  expect(msg).toContain('GCP_WORKLOAD_IDENTITY_PROVIDER');
  expect(msg).toContain('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
});

test('WIF mode: a Sheets call really carries the impersonated token', async () => {
  const { buildWifAuth } = loadCore();
  process.env.GCP_WORKLOAD_IDENTITY_PROVIDER = 'projects/1/locations/global/workloadIdentityPools/p/providers/v';
  process.env.GCP_SERVICE_ACCOUNT_EMAIL = 'sheets-sa@example.iam.gserviceaccount.com';
  process.env.VERCEL_OIDC_TOKEN = 'oidc.subject.token';

  const exchanges = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    exchanges.push(String(url));
    if (String(url).startsWith('https://sts.googleapis.com/')) {
      expect(String(opts.body), 'the OIDC token is the subject of the exchange').toContain('oidc.subject.token');
      return { ok: true, json: async () => ({ access_token: 'federated-token' }) };
    }
    if (String(url).startsWith('https://iamcredentials.googleapis.com/')) {
      expect(opts.headers.Authorization, 'impersonation must present the federated token').toBe('Bearer federated-token');
      return {
        ok: true,
        json: async () => ({
          accessToken: 'sa-impersonated-token',
          expireTime: new Date(Date.now() + 3600_000).toISOString(),
        }),
      };
    }
    throw new Error(`unexpected outbound call: ${url}`);
  };

  const stub = await sheetsStub();
  try {
    const res = await get(buildWifAuth(), stub.rootUrl);
    expect(res.data.sheets[0].properties.title).toBe('Emails');
  } finally {
    global.fetch = realFetch;
    stub.close();
  }

  // The assertion the old code could never have passed: the request reached the
  // server AND arrived authorised. Both halves matter — the previous client
  // threw before the request was sent at all, so `seen` was empty.
  expect(stub.seen.length, 'the Sheets request must actually be sent').toBe(1);
  expect(stub.seen[0].authorization).toBe('Bearer sa-impersonated-token');
  expect(exchanges.filter((u) => u.includes('sts.'))).toHaveLength(1);
  expect(exchanges.filter((u) => u.includes('iamcredentials.'))).toHaveLength(1);
});

test('WIF mode: the token is exchanged once and reused, not re-minted per call', async () => {
  const { buildWifAuth } = loadCore();
  process.env.GCP_WORKLOAD_IDENTITY_PROVIDER = 'projects/1/locations/global/workloadIdentityPools/p/providers/v';
  process.env.GCP_SERVICE_ACCOUNT_EMAIL = 'sheets-sa@example.iam.gserviceaccount.com';
  process.env.VERCEL_OIDC_TOKEN = 'oidc.subject.token';

  let mints = 0;
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).startsWith('https://sts.googleapis.com/')) {
      return { ok: true, json: async () => ({ access_token: 'federated-token' }) };
    }
    mints++;
    return {
      ok: true,
      json: async () => ({
        accessToken: 'sa-impersonated-token',
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      }),
    };
  };

  const stub = await sheetsStub();
  try {
    // runSync makes many sheet calls in one invocation. A token minted per call
    // is two extra round-trips each, against an API with a quota.
    const auth = buildWifAuth();
    await get(auth, stub.rootUrl);
    await get(auth, stub.rootUrl);
    await get(auth, stub.rootUrl);
  } finally {
    global.fetch = realFetch;
    stub.close();
  }
  expect(stub.seen).toHaveLength(3);
  expect(mints, 'one impersonation should cover the whole invocation').toBe(1);
});

test('WIF mode: a failed exchange surfaces the status and body, not a bare throw', async () => {
  const { buildWifAuth } = loadCore();
  process.env.GCP_WORKLOAD_IDENTITY_PROVIDER = 'projects/1/locations/global/workloadIdentityPools/p/providers/v';
  process.env.GCP_SERVICE_ACCOUNT_EMAIL = 'sheets-sa@example.iam.gserviceaccount.com';
  process.env.VERCEL_OIDC_TOKEN = 'oidc.subject.token';

  const realFetch = global.fetch;
  global.fetch = async () => ({
    ok: false, status: 403, text: async () => 'The caller does not have permission',
  });
  const stub = await sheetsStub();
  let msg = '';
  try { await get(buildWifAuth(), stub.rootUrl); } catch (e) { msg = e.message; } finally {
    global.fetch = realFetch;
    stub.close();
  }
  // A misconfigured pool is the likeliest WIF failure; the reason has to reach
  // the log or the operator is left guessing at IAM.
  expect(msg).toContain('403');
  expect(msg).toContain('does not have permission');
  expect(stub.seen, 'no Sheets call should be attempted without a token').toHaveLength(0);
});

test('legacy JWT mode: the client is built from the env pair, with escaped newlines restored', () => {
  const { buildJwtAuth } = loadCore();
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'legacy@example.iam.gserviceaccount.com';
  // Vercel stores the PEM with literal \n, wrapped in quotes by some shells.
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = `"${privateKey.replace(/\n/g, '\\n')}"`;

  const auth = buildJwtAuth();
  expect(auth.email).toBe('legacy@example.iam.gserviceaccount.com');
  expect(auth.scopes).toContain('https://www.googleapis.com/auth/spreadsheets');
  // If the unescaping regressed, the key would still be a string and would still
  // construct — it would fail only at sign time, in production.
  expect(auth.key.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);
  expect(auth.key).not.toContain('\\n');
});

test('legacy JWT mode: googleapis attaches that client\'s token to the request', async () => {
  const { buildJwtAuth } = loadCore();
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'legacy@example.iam.gserviceaccount.com';
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey;

  const auth = buildJwtAuth();
  // The signed assertion cannot be redeemed offline (no real Google account
  // matches this key), so the granted credential is injected and what is under
  // test is the half that can be tested here: that googleapis carries a JWT
  // client's token onto the wire.
  auth.credentials = { access_token: 'jwt-granted-token', expiry_date: Date.now() + 3600_000 };
  const stub = await sheetsStub();
  try {
    await get(auth, stub.rootUrl);
  } finally { stub.close(); }
  expect(stub.seen).toHaveLength(1);
  expect(stub.seen[0].authorization).toBe('Bearer jwt-granted-token');
});

test('WIF is only preferred when Vercel has actually injected an OIDC token', () => {
  const { sheetsClient, resetSheetsClient } = loadCore();
  process.env.GCP_WORKLOAD_IDENTITY_PROVIDER = 'projects/1/locations/global/workloadIdentityPools/p/providers/v';
  process.env.GCP_SERVICE_ACCOUNT_EMAIL = 'sheets-sa@example.iam.gserviceaccount.com';
  // No VERCEL_OIDC_TOKEN, and no JWT pair either: the fallback must be the JWT
  // path, which means the "configure one of..." error. Choosing WIF here would
  // instead fail later, mid-request, with an STS error about a missing subject.
  resetSheetsClient();
  let msg = '';
  try { sheetsClient(); } catch (e) { msg = e.message; }
  expect(msg).toContain('Google auth not configured');
});

test('the WIF client uses the library refresh seam, not an override of a public getter', () => {
  const src = fs.readFileSync(CORE, 'utf8');
  const fn = src.slice(src.indexOf('function buildWifAuth()'), src.indexOf('async function fetchWifAccessToken'));
  expect(fn, 'refreshHandler is the seam OAuth2Client actually consults').toContain('auth.refreshHandler');
  // These three are the exact overrides that silently did nothing. They are
  // pinned by name because the mistake is a plausible one to make again: the
  // methods exist, assigning to them succeeds, and the failure only shows up on
  // a live request.
  for (const dead of ['auth.getAccessToken =', 'auth.getRequestHeaders =', 'auth.request =']) {
    expect(fn, `${dead} does not affect OAuth2Client.requestAsync`).not.toContain(dead);
  }
});
