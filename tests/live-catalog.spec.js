const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The catalog is the factual base of every creative: names, prices, pack shots,
// PDP links, what is in stock. It used to be a BUILD ARTIFACT — three CSV
// exports parsed at deploy time — and six modules each opened those files with
// their own private loader. Anything the store changed after the last export
// (a price, a rename, a sell-out, a new product) was still asserted to
// customers as current. This suite locks the two rules that fix it:
//
//   1. the catalog is FETCHED from the live store, through ONE resolver;
//   2. no creative is generated unless that fetch actually succeeded.
//
// Rule 2 is the one worth being strict about. A stale-catalog mailer does not
// look broken — it looks perfect and is wrong, which is the most expensive
// failure this app can produce.

const ROOT = path.join(__dirname, '..');
const SHARED = path.join(ROOT, 'api', '_shared');

function fresh(rel) {
  const p = require.resolve(path.join(ROOT, rel));
  delete require.cache[p];
  return require(p);
}
function freshCatalog() {
  // catalog-gate holds a reference to catalog-live, so both must reload together
  // or the gate keeps talking to a module whose cache the test just cleared.
  delete require.cache[require.resolve(path.join(SHARED, 'catalog-live.js'))];
  delete require.cache[require.resolve(path.join(SHARED, 'catalog-gate.js'))];
  return {
    live: require(path.join(SHARED, 'catalog-live.js')),
    gate: require(path.join(SHARED, 'catalog-gate.js')),
  };
}
// AWAITS the body before restoring. A sync try/finally around an async fn
// restores the environment the moment fn returns its promise — i.e. at the
// first await — so every env read after that point sees the ORIGINAL value and
// the test silently exercises the wrong configuration.
async function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] == null) delete process.env[k]; else process.env[k] = env[k];
  }
  try { return await fn(); } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] == null) delete process.env[k]; else process.env[k] = prev[k];
    }
  }
}

// A storefront /products.json payload, in Shopify's real shape.
function storefrontPayload(n = 3) {
  const products = [];
  for (let i = 1; i <= n; i++) {
    products.push({
      id: 1000 + i,
      title: `Live Test Tea ${i}`,
      handle: `live-test-tea-${i}`,
      product_type: 'Tea',
      tags: ['bestseller'],
      published_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      images: [{ src: `https://cdn.shopify.com/live-${i}-a.jpg` }, { src: `https://cdn.shopify.com/live-${i}-b.jpg` }],
      variants: [{ id: 9000 + i, sku: `LIVE-SKU-${i}`, price: `${10 + i}.00`, compare_at_price: `${20 + i}.00`, available: true }],
    });
  }
  return { products };
}

// Stub fetch at the module boundary the live path actually uses.
function stubFetch(handler) {
  const real = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = real; };
}
function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test.describe('the catalog is fetched live, through one resolver', () => {
  test('a live storefront read wins, and is normalized with prices, handles and images', async () => {
    await withEnv({ LIVE_CONNECTORS: 'on', SHOPIFY_ADMIN_TOKEN: null, SHOPIFY_STORE_DOMAIN: null }, async () => {
      const { live } = freshCatalog();
      const calls = [];
      const restore = stubFetch(async (url) => {
        calls.push(String(url));
        // Page 2 is empty, which is how the pager knows to stop.
        return jsonResponse(/page=1/.test(String(url)) ? storefrontPayload(3) : { products: [] });
      });
      try {
        const snap = await live.primeCatalog('US', { fresh: true });
        expect(snap.live, 'a successful store read must be reported as live').toBe(true);
        expect(snap.source).toBe('shopify_storefront');
        expect(snap.count).toBe(3);
        expect(calls[0]).toContain('/products.json');

        const p = snap.products[0];
        expect(p.n).toBe('Live Test Tea 1');
        expect(p.h).toBe('live-test-tea-1');
        expect(p.price).toBe('11.00');        // from the variant, not invented
        expect(p.compare_at).toBe('21.00');
        expect(p.sku).toBe('LIVE-SKU-1');
        expect(p.available).toBe(true);
        expect(p.imgs.length).toBe(2);        // the whole gallery, not just one
        expect(p.i).toContain('https://');
        expect(p.source).toBe('shopify_storefront');

        // And the SYNC readers — the ones inside template rendering that cannot
        // await — see the same live rows once primed. That is the whole point of
        // prime-then-read.
        const sync = live.catalogSync('US');
        expect(sync.live).toBe(true);
        expect(sync.products[0].h).toBe('live-test-tea-1');
      } finally { restore(); live.clearCache(); }
    });
  });

  test('the kill switch holds for the catalog too — no credential-free read sneaks past it', async () => {
    await withEnv({ LIVE_CONNECTORS: null }, async () => {
      const { live } = freshCatalog();
      let called = false;
      const restore = stubFetch(async () => { called = true; return jsonResponse(storefrontPayload(1)); });
      try {
        const snap = await live.primeCatalog('US', { fresh: true });
        expect(called, 'a request left the process despite LIVE_CONNECTORS being off').toBe(false);
        expect(snap.live).toBe(false);
        expect(snap.blocker).toMatch(/LIVE_CONNECTORS/);
      } finally { restore(); live.clearCache(); }
    });
  });

  test('a failed live read falls back to the artifact but never calls it live', async () => {
    await withEnv({ LIVE_CONNECTORS: 'on' }, async () => {
      const { live } = freshCatalog();
      const restore = stubFetch(async () => jsonResponse({ errors: 'nope' }, 503));
      try {
        const snap = await live.primeCatalog('US', { fresh: true });
        expect(snap.live).toBe(false);
        expect(snap.source).toBe('static_build');
        expect(snap.stale).toBe(true);
        expect(snap.blocker).toBeTruthy();
        // Every row carries its own provenance, so a row cannot be laundered
        // into a live one by being copied out of the snapshot.
        expect(snap.products.every((p) => p.source === 'static_build')).toBe(true);
      } finally { restore(); live.clearCache(); }
    });
  });

  test('a market with no artifact gets nothing, never another region\'s catalog', () => {
    const { live } = freshCatalog();
    const r = live.readStatic('IN');
    expect(r.ok).toBe(false);
    expect(r.blocker).toMatch(/never be substituted/i);
  });

  test('no module keeps its own private catalog loader any more', () => {
    // Six modules used to readFileSync data/catalog/products_*.json themselves.
    // One resolver is the fix; a seventh private copy would silently un-fix it.
    const offenders = [];
    // Comments are stripped first — several modules legitimately DESCRIBE the
    // artifact in prose ("live Shopify first, build artifact only as a labelled
    // fallback"), and flagging a comment would make this test noise.
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of fs.readdirSync(SHARED)) {
      if (!f.endsWith('.js') || f === 'catalog-live.js') continue;
      const src = stripComments(fs.readFileSync(path.join(SHARED, f), 'utf8'));
      // The thing that matters is an actual READ of the artifact, in code.
      if (/readFileSync\([^)]*catalog/.test(src) || /products_(us|uk|global)\.json/.test(src)) offenders.push(f);
    }
    expect(offenders, `these read the catalog artifact directly instead of catalog-live.js: ${offenders.join(', ')}`).toEqual([]);
  });
});

test.describe('the gate stops creative work when the catalog is not live', () => {
  test('a non-live catalog blocks, and says exactly what to fix', async () => {
    await withEnv({ LIVE_CONNECTORS: null, CATALOG_GATE: null }, async () => {
      const { gate } = freshCatalog();
      const r = await gate.requireLiveCatalog({ market: 'US', purpose: 'mailer' });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.code).toBe(gate.CODES.NOT_LIVE);
      expect(r.status).toMatch(/NOT LAUNCH READY/);
      // The missing-data marker the master spec uses everywhere else.
      expect(r.data_required).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
      expect(r.remediation.join(' ')).toMatch(/LIVE_CONNECTORS/);
      // It must NOT hand back products — a blocked gate that still returns rows
      // invites a caller to use them anyway.
      expect(r.products).toBeUndefined();
    });
  });

  test('live catalog + a real product passes, and returns the LIVE row to build from', async () => {
    await withEnv({ LIVE_CONNECTORS: 'on', CATALOG_GATE: null }, async () => {
      const { live, gate } = freshCatalog();
      const restore = stubFetch(async (url) => jsonResponse(/page=1/.test(String(url)) ? storefrontPayload(3) : { products: [] }));
      try {
        // The caller carries a STALE price; the gate must replace it, not trust it.
        const r = await gate.requireLiveCatalog({
          market: 'US', purpose: 'mailer',
          products: [{ handle: 'live-test-tea-2', price: '999.00' }],
        });
        expect(r.ok).toBe(true);
        expect(r.blocked).toBe(false);
        expect(r.live).toBe(true);
        expect(r.products).toHaveLength(1);
        expect(r.products[0].price, 'the live price must override what the caller carried').toBe('12.00');
        expect(r.products[0].match_confidence).toBe('exact');
        const stamp = gate.stamp(r);
        expect(stamp.catalog_live).toBe(true);
        expect(stamp.gate_bypassed).toBe(false);
      } finally { restore(); live.clearCache(); }
    });
  });

  test('a product that is not in the live catalog blocks the build', async () => {
    await withEnv({ LIVE_CONNECTORS: 'on', CATALOG_GATE: null }, async () => {
      const { live, gate } = freshCatalog();
      const restore = stubFetch(async (url) => jsonResponse(/page=1/.test(String(url)) ? storefrontPayload(3) : { products: [] }));
      try {
        const r = await gate.requireLiveCatalog({ market: 'US', products: [{ handle: 'discontinued-tea' }] });
        expect(r.blocked).toBe(true);
        expect(r.code).toBe(gate.CODES.PRODUCTS_UNVERIFIED);
        expect(r.detail).toMatch(/discontinued-tea/);
      } finally { restore(); live.clearCache(); }
    });
  });

  test('a weak (token) match is a block, not a silent substitution', async () => {
    await withEnv({ LIVE_CONNECTORS: 'on', CATALOG_GATE: null }, async () => {
      const { live, gate } = freshCatalog();
      const restore = stubFetch(async (url) => jsonResponse(/page=1/.test(String(url)) ? storefrontPayload(3) : { products: [] }));
      try {
        // "Test Tea" matches all three fixtures. Picking the first would put one
        // product's price under another product's name.
        const r = await gate.requireLiveCatalog({ market: 'US', products: [{ title: 'Test Tea' }] });
        expect(r.blocked).toBe(true);
        expect(r.code).toBe(gate.CODES.PRODUCTS_UNVERIFIED);
      } finally { restore(); live.clearCache(); }
    });
  });

  test('a stale live read is blocked as stale, not accepted because it was once live', async () => {
    await withEnv({ LIVE_CONNECTORS: 'on', CATALOG_GATE: null, CATALOG_MAX_AGE_MINUTES: '60' }, async () => {
      const { live, gate } = freshCatalog();
      const old = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
      const payload = storefrontPayload(1);
      const restore = stubFetch(async (url) => jsonResponse(/page=1/.test(String(url)) ? payload : { products: [] }));
      try {
        await live.primeCatalog('US', { fresh: true });
        // Backdate the snapshot the way a long-lived warm lambda would.
        live.catalogSync('US').products.forEach((p) => { p.fetched_at = old; });
        const snap = await live.primeCatalog('US');
        snap.fetched_at = old;
        const r = await gate.requireLiveCatalog({ market: 'US' });
        // Either it re-read (fresh, passes) or it used the backdated snapshot
        // (blocked as stale) — what must never happen is a pass on stale data.
        if (r.blocked) expect(r.code).toBe(gate.CODES.STALE);
        else expect(new Date(r.provenance.fetched_at).getTime()).toBeGreaterThan(Date.now() - 3600 * 1000);
      } finally { restore(); live.clearCache(); }
    });
  });

  test('CATALOG_GATE=off proceeds but stamps the output — it never fakes a pass', async () => {
    await withEnv({ LIVE_CONNECTORS: null, CATALOG_GATE: 'off' }, async () => {
      const { gate } = freshCatalog();
      const r = await gate.requireLiveCatalog({ market: 'US', purpose: 'mailer' });
      expect(r.ok).toBe(true);
      expect(r.bypassed).toBe(true);
      expect(r.live, 'a bypass must never report the catalog as live').toBe(false);
      expect(r.warning).toMatch(/NON-LIVE/);
      const stamp = gate.stamp(r);
      expect(stamp.gate_bypassed).toBe(true);
      expect(stamp.data_required).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
    });
  });
});

test.describe('the live paths do not leak the store\'s private side', () => {
  // Read-only is not the same as public. The Admin token can see draft and
  // archived products, per-variant inventory counts, internal SKUs, and the
  // customer list — and every Admin call spends store quota and serverless
  // time. An unauthenticated route backed by that token is both a disclosure
  // and a free quota-drain vector, so these are the boundaries that hold it in.

  test('a caller cannot choose an arbitrary product status', async () => {
    await withEnv({ LIVE_CONNECTORS: 'on' }, async () => {
      const shopify = fresh('api/_shared/shopify-core.js');
      // Junk, injection attempts and empty all resolve to the live catalog,
      // never to drafts, and never straight into the Admin query string.
      for (const bad of ['any', 'ANY', '', null, 'active,draft', 'draft%20OR%201', { evil: true }]) {
        const r = await shopify.products({ market: 'US', status: bad });
        expect(r.would_request.url, `status=${JSON.stringify(bad)} reached the Admin API`).toContain('status=active');
      }
      // The three real Shopify values are still reachable — for an operator.
      const draft = await shopify.products({ market: 'US', status: 'draft' });
      expect(draft.would_request.url).toContain('status=draft');
    });
  });

  test('maxPages is clamped, so nobody can walk the Admin API indefinitely', async () => {
    await withEnv({ LIVE_CONNECTORS: 'on', SHOPIFY_STORE_DOMAIN: 'x.myshopify.com', SHOPIFY_ADMIN_TOKEN: 't' }, async () => {
      const shopify = fresh('api/_shared/shopify-core.js');
      let calls = 0;
      const restore = stubFetch(async () => {
        calls++;
        return {
          ok: true, status: 200,
          // Always advertise a next page, so only the cap can stop the walk.
          headers: { get: (h) => (String(h).toLowerCase() === 'link' ? '<https://x.myshopify.com/next>; rel="next"' : null) },
          json: async () => storefrontPayload(1),
          text: async () => JSON.stringify(storefrontPayload(1)),
        };
      });
      try {
        const r = await shopify.readPagedProducts('US', { maxPages: 100000 });
        expect(r.truncated).toBe(true);
        expect(calls, 'the page cap did not hold').toBeLessThanOrEqual(12);
      } finally { restore(); }
    });
  });

  test('the dispatcher passes named params, not the caller\'s whole query', () => {
    const src = fs.readFileSync(path.join(SHARED, 'shopify-core.js'), 'utf8');
    // `(p) => readPagedProducts(p.market, p)` splats the request query into the
    // core; that is what let a caller pick status and maxPages.
    expect(src).not.toMatch(/readPagedProducts\(\s*p\.market\s*,\s*p\s*\)/);
  });

  test('the Shopify route and forced refreshes are operator-only', () => {
    const src = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
    const shopifyCase = src.slice(src.indexOf("case 'shopify':"), src.indexOf("case 'shopify':") + 400);
    expect(shopifyCase, 'the shopify dispatcher must require an operator').toMatch(/requireOperator/);
    const catalogCase = src.slice(src.indexOf("case 'catalog':"), src.indexOf("case 'catalog':") + 1600);
    expect(catalogCase, 'a forced Admin refresh must require an operator').toMatch(/wantsFresh[\s\S]*requireOperator/);
    // And the anonymous projection must not hand out Admin-only fields.
    expect(catalogCase).toMatch(/const project =/);
    expect(catalogCase).not.toMatch(/products:\s*p\.summary === '1' \? undefined : snap\.products\b/);
  });

  test('the unauthenticated health probe cannot force an Admin walk', async () => {
    await withEnv({ LIVE_CONNECTORS: 'on', SHOPIFY_STORE_DOMAIN: 'x.myshopify.com', SHOPIFY_ADMIN_TOKEN: 't' }, async () => {
      const { live } = freshCatalog();
      delete require.cache[require.resolve(path.join(SHARED, 'connectors-health.js'))];
      const healthMod = require(path.join(SHARED, 'connectors-health.js'));
      let calls = 0;
      const restore = stubFetch(async () => { calls++; return jsonResponse({ products: [] }); });
      try {
        await healthMod.probeCatalog('US');
        const afterFirst = calls;
        expect(afterFirst).toBeGreaterThan(0); // it really does attempt the read
        // Ten more anonymous hits must add nothing. Without a NEGATIVE cache a
        // failing store is re-walked on every request — a retry storm that fires
        // precisely when the catalog is already broken.
        for (let i = 0; i < 10; i++) await healthMod.probeCatalog('US');
        expect(calls, 'anonymous health hits re-walked the Admin API').toBe(afterFirst);
        // And it says the verdict came from cache rather than a live attempt.
        const r = await healthMod.probeCatalog('US');
        expect(r.read).toBe('cached-failure');
        // The operator path may still force one.
        const before = calls;
        const forced = await healthMod.probeCatalog('US', { fresh: true });
        expect(calls).toBeGreaterThan(before);
        expect(forced.read).toBe('forced-fresh');
      } finally { restore(); live.clearCache(); }
    });
  });

  test('an unknown market costs zero outbound calls (the cache key is caller-controlled)', async () => {
    await withEnv({ LIVE_CONNECTORS: 'on', SHOPIFY_STORE_DOMAIN: 'x.myshopify.com', SHOPIFY_ADMIN_TOKEN: 't' }, async () => {
      const { live } = freshCatalog();
      let calls = 0;
      const restore = stubFetch(async () => { calls++; return jsonResponse({ products: [] }); });
      try {
        // Each distinct market is a distinct cache key, so without an allowlist
        // varying ?market= turns the TTL cache from a rate limiter into an
        // amplifier: every junk value is a fresh cold read.
        for (const m of ['ZZ', '../etc', 'US-EVIL', 'x1', 'x2', 'x3', 'DROP TABLE']) {
          const r = await live.resolve(m);
          expect(r.live).toBe(false);
          expect(r.blocker).toMatch(/Unknown market/);
        }
        expect(calls, 'an unknown market reached the network').toBe(0);
        // A real market still works.
        expect(live.isKnownMarket('uk')).toBe(true);
        expect(live.isKnownMarket('')).toBe(true); // empty normalises to US
      } finally { restore(); live.clearCache(); }
    });
  });

  test('the health route only honours ?fresh=1 for an operator', () => {
    const src = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
    const i = src.indexOf("case 'connectors-health':");
    const block = src.slice(i, i + 900);
    expect(block).toMatch(/wantsFresh[\s\S]*authorize\(req\)/);
    expect(block, 'the probe must not be handed an unauthenticated fresh:true').not.toMatch(/fresh:\s*true/);
  });

  test('the public projection drops inventory, SKUs and the variant list', () => {
    // Build a row the way an Admin read would, then apply the same field list
    // the anonymous branch uses, and assert what survives.
    const { live } = freshCatalog();
    const row = live.fromShopifyProduct(
      { id: 1, title: 'T', handle: 't', published_at: '2026-01-01T00:00:00Z', images: [{ src: 'https://x/i.jpg' }],
        variants: [{ id: 2, sku: 'SECRET-SKU', price: '9.00', inventory_quantity: 41, inventory_management: 'shopify' }] },
      { source: 'shopify_admin', market: 'US', fetchedAt: '2026-08-17T00:00:00Z' }
    );
    // The full in-process row legitimately holds all of it (the gate needs it).
    expect(row.variants[0].inventory).toBe(41);
    expect(row.sku).toBe('SECRET-SKU');

    const PUBLIC = ['id', 'n', 'h', 'i', 'imgs', 't', 'price', 'compare_at', 'type', 'available', 'url', 'source', 'fetched_at'];
    const projected = {};
    for (const k of PUBLIC) projected[k] = row[k];
    expect(Object.keys(projected)).not.toContain('variants');
    expect(Object.keys(projected)).not.toContain('sku');
    expect(JSON.stringify(projected)).not.toContain('SECRET-SKU');
    expect(JSON.stringify(projected)).not.toContain('41');
    // What a page actually needs still survives the projection.
    expect(projected.n).toBe('T');
    expect(projected.price).toBe('9.00');
    expect(projected.i).toBe('https://x/i.jpg');
  });
});

test.describe('every creative entry point runs the gate', () => {
  // The gate only works if the paths that spend money actually call it. A new
  // generator that forgets to is the exact regression this catches.
  const ENTRIES = [
    ['api/_shared/smart-brain-plan.js', 'campaign build (mailer + ads + landing page)'],
    ['api/_shared/social-core.js', 'social posts'],
    ['api/ai/generate.js', 'LLM copy with selected products'],
  ];
  for (const [rel, what] of ENTRIES) {
    test(`${what} imports AND calls the gate`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src, `${rel} does not require catalog-gate.js`).toMatch(/require\(['"][^'"]*catalog-gate\.js['"]\)/);
      expect(src, `${rel} imports the gate but never calls requireLiveCatalog`).toMatch(/requireLiveCatalog\s*\(/);
    });
  }

  test('a blocked campaign build returns the block instead of empty assets', async () => {
    await withEnv({ LIVE_CONNECTORS: null, CATALOG_GATE: null }, async () => {
      freshCatalog();
      const plan = fresh('api/_shared/smart-brain-plan.js');
      const out = await plan.buildCampaign(
        { id: 'test-slot', date: '2026-08-17', market: 'US', theme: 'test', heroProduct: { title: 'Nothing Real', handle: 'nothing-real' } },
        {}, { withCreatives: false, noLLM: true }
      );
      expect(out.blocked).toBe(true);
      expect(out.reason).toBe('live_catalog_required');
      expect(out.assets).toBeNull();
      expect(out.data_required).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
    });
  });
});
