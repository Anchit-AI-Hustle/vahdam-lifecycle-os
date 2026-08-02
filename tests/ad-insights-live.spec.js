const { test, expect } = require('@playwright/test');
const path = require('path');

// The paid-media stack reports 0 of 3 live because Meta/Google/TikTok
// credentials are not set in Vercel. Adding those tokens is an act of faith
// unless the live code path is known to work — otherwise the operator provisions
// three sets of credentials, still sees nothing, and blames the tokens.
//
// So these tests SIMULATE credentials and stub global.fetch, exercising the real
// module end to end: request shape, auth placement, success parsing, and honest
// error surfacing. They prove that the moment real tokens land, the path works.
//
// They also pin the kill switch. This module used to be the one outbound
// connector that ignored LIVE_CONNECTORS entirely and called all three
// platforms regardless.

const MOD = path.join(__dirname, '..', 'api', '_shared', 'ad-insights-core.js');

function freshModule(env) {
  for (const k of Object.keys(require.cache)) if (k.includes('ad-insights-core') || k.includes('live-connectors')) delete require.cache[k];
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const mod = require(MOD);
  return { mod, restore: () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } } };
}

// Exact-host match. Substring matching on a URL is the classic sanitization bug
// (an attacker-controlled path or query can carry the trusted host as text), so
// even a test stub routes on the parsed hostname.
function hostOf(url) {
  try { return new URL(String(url)).hostname; } catch (_) { return ''; }
}

// Records every outbound call and replies with a canned platform response.
function stubFetch(reply) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const r = typeof reply === 'function' ? reply(String(url), opts) : reply;
    return {
      ok: r.ok !== false, status: r.status || 200,
      text: async () => JSON.stringify(r.body === undefined ? {} : r.body),
    };
  };
  return { calls, restore: () => { global.fetch = real; } };
}

const CREDS = {
  LIVE_CONNECTORS: 'on',
  META_ACCESS_TOKEN: 'meta-tok', META_AD_ACCOUNT_ID: '1234567890',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-tok', GOOGLE_ADS_CLIENT_ID: 'cid',
  GOOGLE_ADS_CLIENT_SECRET: 'csec', GOOGLE_ADS_REFRESH_TOKEN: 'rtok',
  GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
  TIKTOK_ACCESS_TOKEN: 'tt-tok', TIKTOK_ADVERTISER_ID: 'adv-1',
};
const NO_CREDS = Object.fromEntries(Object.keys(CREDS).map((k) => [k, undefined]));

test.describe('Meta live path', () => {
  test('with credentials it calls the Graph API correctly and parses the result', async () => {
    const { mod, restore } = freshModule(CREDS);
    const f = stubFetch({ body: { data: [{ account_id: '1234567890', spend: '114.48', impressions: '10500', clicks: '115' }] } });
    try {
      const r = await mod.insights({ platform: 'meta', market: 'US', level: 'campaign', since: '2026-08-01', until: '2026-08-02' });
      expect(r.ok, 'live call must succeed').toBe(true);
      expect(r.connected).toBe(true);
      expect(r.not_connected).toBeFalsy();
      expect(r.data[0].spend).toBe('114.48');
      expect(r.source).toContain('meta_graph_insights');
      expect(r.fetched_at, 'must stamp when it was read').toBeTruthy();

      expect(f.calls.length).toBe(1);
      const url = f.calls[0].url;
      expect(url).toContain('graph.facebook.com');
      expect(url, 'must target the configured account').toContain('/act_1234567890/insights');
      expect(url, 'token goes in the query for Graph').toContain('access_token=meta-tok');
      expect(url, 'level must be honoured').toContain('level=campaign');
      expect(decodeURIComponent(url), 'the requested window must be sent').toContain('2026-08-01');
    } finally { f.restore(); restore(); }
  });

  test('a platform error is surfaced, never turned into zeros', async () => {
    const { mod, restore } = freshModule(CREDS);
    const f = stubFetch({ ok: false, status: 401, body: { error: { message: 'Invalid OAuth access token.' } } });
    try {
      const r = await mod.insights({ platform: 'meta', market: 'US' });
      expect(r.ok).toBe(false);
      expect(r.connected, 'we did reach the platform').toBe(true);
      expect(r.status).toBe(401);
      expect(r.error).toContain('Invalid OAuth access token');
      expect(r.data, 'must not invent an empty dataset that reads as "no spend"').toBeUndefined();
    } finally { f.restore(); restore(); }
  });
});

test('Google Ads live path exchanges the refresh token then runs GAQL', async () => {
  const { mod, restore } = freshModule(CREDS);
  const f = stubFetch((url) => {
    // Match the HOST exactly, not a substring. `url.includes('oauth2.googleapis.com')`
    // also matches https://evil.test/?x=oauth2.googleapis.com — harmless in a stub,
    // but it is the same sloppy pattern that becomes a real SSRF check elsewhere,
    // so do not model it here.
    if (hostOf(url) === 'oauth2.googleapis.com') return { body: { access_token: 'ya29.fresh' } };
    return { body: [{ results: [{ campaign: { id: '77', name: 'Brand' }, metrics: { costMicros: '4500000', conversions: 3 } }] }] };
  });
  try {
    const r = await mod.insights({ platform: 'google', market: 'US', level: 'campaign', since: '2026-08-01', until: '2026-08-02' });
    expect(r.ok).toBe(true);
    expect(r.connected).toBe(true);
    expect(r.query, 'the GAQL actually sent must be returned for auditability').toContain('FROM campaign');
    expect(r.query).toContain("BETWEEN '2026-08-01' AND '2026-08-02'");

    expect(f.calls.length, 'token exchange + search').toBe(2);
    expect(f.calls[0].url).toContain('oauth2.googleapis.com');
    expect(f.calls[0].opts.body, 'must use refresh_token grant').toContain('grant_type=refresh_token');
    const search = f.calls[1];
    expect(search.url).toContain('googleads.googleapis.com');
    expect(search.url, 'customer id must be stripped of dashes').toContain('/customers/1234567890/');
    expect(search.opts.headers.authorization).toBe('Bearer ya29.fresh');
    expect(search.opts.headers['developer-token']).toBe('dev-tok');
  } finally { f.restore(); restore(); }
});

test('TikTok live path sends the token as a header and honours a business-API error code', async () => {
  const { mod, restore } = freshModule(CREDS);
  let f = stubFetch({ body: { code: 0, data: { list: [{ dimensions: { advertiser_id: 'adv-1' }, metrics: { spend: '21.79' } } ] } } });
  try {
    const r = await mod.insights({ platform: 'tiktok', market: 'US', level: 'campaign' });
    expect(r.ok).toBe(true);
    expect(f.calls[0].url).toContain('business-api.tiktok.com');
    expect(f.calls[0].url).toContain('data_level=AUCTION_CAMPAIGN');
    expect(f.calls[0].opts.headers['Access-Token'], 'TikTok auth is a header, not a query param').toBe('tt-tok');
  } finally { f.restore(); }

  // TikTok returns HTTP 200 with a non-zero `code` on failure — the classic trap.
  f = stubFetch({ ok: true, status: 200, body: { code: 40001, message: 'Advertiser id is invalid' } });
  try {
    const r = await mod.insights({ platform: 'tiktok', market: 'US' });
    expect(r.ok, 'HTTP 200 with code!=0 is still a failure').toBe(false);
    expect(r.error).toContain('Advertiser id is invalid');
  } finally { f.restore(); restore(); }
});

test('market-specific credentials override the global ones', async () => {
  const { mod, restore } = freshModule({ ...CREDS, META_ACCESS_TOKEN_UK: 'uk-tok', META_AD_ACCOUNT_ID_UK: '999' });
  const f = stubFetch({ body: { data: [] } });
  try {
    await mod.insights({ platform: 'meta', market: 'UK' });
    expect(f.calls[0].url, 'UK must use the UK account').toContain('act_999');
    expect(f.calls[0].url).toContain('access_token=uk-tok');
    f.calls.length = 0;
    await mod.insights({ platform: 'meta', market: 'US' });
    expect(f.calls[0].url, 'US falls back to the unsuffixed account').toContain('act_1234567890');
  } finally { f.restore(); restore(); }
});

test.describe('honest offline behaviour', () => {
  test('no credentials means no request and no invented figure', async () => {
    const { mod, restore } = freshModule(NO_CREDS);
    const f = stubFetch({ body: {} });
    try {
      for (const platform of ['meta', 'google', 'tiktok']) {
        const r = await mod.insights({ platform, market: 'US' });
        expect(r.ok, `${platform} must not claim success`).toBe(false);
        expect(r.not_connected).toBe(true);
        expect(r.would_request, `${platform} must name the call it would have made`).toBeTruthy();
        expect(r.need_env.length, `${platform} must name the env vars needed`).toBeGreaterThan(0);
        expect(r.data, `${platform} must not return a dataset`).toBeUndefined();
      }
      expect(f.calls.length, 'not one byte should leave the box without credentials').toBe(0);
    } finally { f.restore(); restore(); }
  });

  test('the kill switch stops all three even when credentials exist', async () => {
    // The regression this module shipped with: LIVE_CONNECTORS off, credentials
    // present, and it called Meta/Google/TikTok anyway.
    const { mod, restore } = freshModule({ ...CREDS, LIVE_CONNECTORS: 'off' });
    const f = stubFetch({ body: { data: [] } });
    try {
      for (const platform of ['meta', 'google', 'tiktok']) {
        const r = await mod.insights({ platform, market: 'US' });
        expect(r.ok).toBe(false);
        expect(r.live_connectors_disabled, `${platform} must report the switch, not a missing key`).toBe(true);
        expect(r.hint).toContain('LIVE_CONNECTORS=on');
      }
      expect(f.calls.length, 'the kill switch must actually stop egress').toBe(0);
    } finally { f.restore(); restore(); }
  });

  test('"switch off" and "no credentials" are distinguishable — they need different fixes', async () => {
    const off = freshModule({ ...CREDS, LIVE_CONNECTORS: 'off' });
    const rOff = await off.mod.insights({ platform: 'meta', market: 'US' });
    off.restore();
    const none = freshModule(NO_CREDS);
    const rNone = await none.mod.insights({ platform: 'meta', market: 'US' });
    none.restore();
    expect(rOff.live_connectors_disabled).toBe(true);
    expect(rNone.live_connectors_disabled).toBeFalsy();
    expect(rOff.hint).not.toBe(rNone.hint);
  });
});
