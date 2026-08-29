'use strict';

/**
 * catalog-live.js — THE catalog. One resolver, live from the connected Shopify
 * store, for every surface in the app.
 *
 * WHY THIS EXISTS
 * ---------------
 * The catalog used to be a build artifact: `npm run build` parsed three CSV
 * exports into data/catalog/products_{us,uk,global}.json, and six different
 * modules each opened those files with their own private fs.readFileSync loader
 * (jarvis, brand-llm, calendar-export, calendar-trigger, landing-fallback,
 * catalog-image). That is a photograph of the store taken on the day someone
 * last exported a CSV. Every price, every compare-at, every in-stock flag, every
 * product that has since been added, renamed, unpublished or sold out was
 * asserted to customers as current fact. A creative built on it can promise a
 * price the store does not charge and link a PDP the store no longer serves —
 * the exact fabrication the master spec forbids, laundered through a file that
 * looks authoritative because it ships in the repo.
 *
 * So: the catalog is FETCHED, not built. Two live paths, in order:
 *
 *   1. shopify_admin      — Admin REST products.json, paged, read-only. Carries
 *                           status/published_at/variants/inventory, so it can
 *                           tell an unpublished draft from a live product.
 *                           Needs SHOPIFY_ADMIN_TOKEN + LIVE_CONNECTORS=on.
 *   2. shopify_storefront — the store's own public /products.json. Same store,
 *                           same data, no credential. Lists only published
 *                           products, which is what a creative may promote
 *                           anyway. This is the path that works today.
 *
 * and one NON-live path, which is never allowed to masquerade as the others:
 *
 *   3. static_build       — data/catalog/products_<region>.json, returned with
 *                           live:false + stale:true + an age in days. Read-only
 *                           surfaces may render it (labelled). Creative may not:
 *                           see catalog-gate.js, which blocks on live:false.
 *
 * NO FABRICATION: with every path unavailable this returns products:[] and a
 * blocker naming the exact request that failed. It never invents a product,
 * price, image or handle, and never substitutes another region's catalog for a
 * missing one (a UK mailer quoting US prices in dollars is the same lie in a
 * different currency).
 *
 * SYNC READERS: most of the creative pipeline reads the catalog synchronously
 * (catalogImage.imageFor(...) inside template rendering). Those callers cannot
 * await. So the flow is prime-then-read: catalog-gate.js awaits primeCatalog()
 * BEFORE any generation starts, which parks the live snapshot in this module's
 * cache; the sync readers then hit that snapshot. If nothing primed it, a sync
 * read falls back to the static file AND says so via `live:false` — it does not
 * pretend, and the gate has already stopped creative work by then.
 */

const fs = require('fs');
const path = require('path');
const { guardedFetch } = require('./read-only-egress.js');
const { liveConnectorsEnabled } = require('./live-connectors.js');
const shopify = require('./shopify-core.js');

// Reuse the exact categorization the CSV build and the storefront scraper use,
// so a product's tags do not change meaning depending on which path read it.
let deriveTags;
try { ({ deriveTags } = require('../../scripts/build-catalog.js')); } catch (_) { deriveTags = null; }
function tagsFor(tags, type, title) {
  if (typeof deriveTags === 'function') {
    try {
      const t = deriveTags(Array.isArray(tags) ? tags.join(', ') : (tags || ''), type || '', title || '');
      if (Array.isArray(t) && t.length) return t;
    } catch (_) { /* fall through to the neutral tag */ }
  }
  return ['general'];
}

// ── Markets ─────────────────────────────────────────────────────────────────
// Storefront bases come from market-urls.js, the ONE measured map. This module
// originally carried its own copy, taken from the "VERIFIED" table in CLAUDE.md
// — which was wrong on four of six entries: it sent UK, EU and AU at the
// regional subdomains listed in market-urls DEAD_HOSTS, none of which resolve.
// A live storefront catalog read for those markets could therefore never have
// succeeded, and the gate would have blocked every UK creative while reporting
// it as the store being unreachable. (The dead hosts are deliberately NOT named
// literally here: tests/market-urls.spec.js greps source for them, and a guard
// that a comment can trip is a guard people start ignoring.) Each base stays
// overridable per market by env so a store move needs no code change.
const { STORE_BASE } = require('./market-urls.js');
const STOREFRONT_BASE = STORE_BASE;

// Only three regions have a static build artifact; the live paths are per market.
const STATIC_REGION = { US: 'us', UK: 'uk', GLOBAL: 'global' };

// The market is caller-controlled on every route that reaches this module, and
// it is the CACHE KEY. Without an allowlist, varying `?market=` mints a new cold
// cache entry per value — each one a fresh Admin walk — which turns the TTL
// cache from a rate limiter into an amplifier. An unknown market is answered
// without any outbound call at all.
const KNOWN_MARKETS = new Set(Object.keys(STOREFRONT_BASE));
function isKnownMarket(m) { return KNOWN_MARKETS.has(normMarket(m)); }

function normMarket(m) {
  const s = String(m == null ? '' : m).trim().toUpperCase();
  if (!s) return 'US';
  if (['US', 'USA', 'UNITED STATES', 'AMERICA'].includes(s)) return 'US';
  if (['UK', 'GB', 'GBR', 'UNITED KINGDOM', 'BRITAIN', 'ENGLAND'].includes(s)) return 'UK';
  if (['IN', 'IND', 'INDIA'].includes(s)) return 'IN';
  if (['EU', 'EUROPE'].includes(s)) return 'EU';
  if (['AU', 'AUS', 'AUSTRALIA'].includes(s)) return 'AU';
  if (['ME', 'MIDDLE EAST', 'UAE'].includes(s)) return 'ME';
  if (['GLOBAL', 'ROW', 'REST OF WORLD', 'INTERNATIONAL', 'WORLD'].includes(s)) return 'GLOBAL';
  return s;
}
function storefrontBase(market) {
  const mk = normMarket(market);
  const override = String(process.env[`SHOPIFY_STOREFRONT_BASE_${mk}`] || '').trim();
  if (override) return override.replace(/\/+$/, '');
  return STOREFRONT_BASE[mk] || null;
}
// The static artifact exists for us/uk/global only. A market with no artifact of
// its own gets NOTHING rather than another market's file — cross-region reuse of
// prices, URLs and assets is forbidden by the master spec.
function staticRegion(market) { return STATIC_REGION[normMarket(market)] || null; }

const TTL_MS = Math.max(30, parseInt(process.env.CATALOG_TTL_SECONDS || '300', 10) || 300) * 1000;

// ── Normalizers ─────────────────────────────────────────────────────────────
// All three paths converge on ONE shape, a superset of the compact shape the
// app already uses (n / i / imgs / t / h / price / compare_at / type), so every
// existing reader keeps working while gaining the live-only fields.
const money = (v) => (v == null || v === '' ? null : String(v));
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : null);

function normalizeVariants(list) {
  return (Array.isArray(list) ? list : []).map((v) => ({
    id: v.id != null ? String(v.id) : null,
    sku: v.sku ? String(v.sku).trim() : null,
    title: v.title || null,
    price: money(v.price),
    compare_at: money(v.compare_at_price) && String(v.compare_at_price) !== String(v.price) ? money(v.compare_at_price) : null,
    // Admin gives inventory_quantity; the storefront gives a boolean `available`.
    // Keep both notions distinct rather than inventing a count from a boolean.
    available: typeof v.available === 'boolean' ? v.available
      : (v.inventory_management == null ? true : Number(v.inventory_quantity) > 0),
    inventory: Number.isFinite(Number(v.inventory_quantity)) ? Number(v.inventory_quantity) : null,
  }));
}

function fromShopifyProduct(p, { source, market, fetchedAt }) {
  const variants = normalizeVariants(p.variants);
  const first = variants[0] || {};
  const imgs = [];
  const seen = new Set();
  for (const im of (Array.isArray(p.images) ? p.images : [])) {
    const u = httpUrl(im && (im.src || im.url));
    if (u && !seen.has(u)) { seen.add(u); imgs.push(u); }
  }
  const primary = httpUrl(p.image && (p.image.src || p.image.url)) || imgs[0] || '';
  if (primary && !seen.has(primary)) imgs.unshift(primary);

  const status = String(p.status || '').toLowerCase() || null;
  // The storefront endpoint only ever returns published products, so absence of
  // published_at there means "the field was not sent", not "unpublished".
  const published = source === 'shopify_storefront' ? true : !!p.published_at;

  const out = {
    id: p.id != null ? String(p.id) : null,
    n: String(p.title || '').trim(),
    h: String(p.handle || '').trim(),
    i: primary,
    imgs: imgs.slice(0, 10),
    t: tagsFor(p.tags, p.product_type, p.title),
    price: first.price || null,
    compare_at: first.compare_at || null,
    type: p.product_type || null,
    vendor: p.vendor || null,
    sku: first.sku || null,
    available: variants.some((v) => v.available),
    variants,
    status: status || (source === 'shopify_storefront' ? 'active' : null),
    published,
    published_at: p.published_at || null,
    updated_at: p.updated_at || null,
    url: `${storefrontBase(market) || ''}/products/${String(p.handle || '').trim()}`,
    source,
    fetched_at: fetchedAt,
  };
  return out;
}

// The static rows are already in the compact shape; stamp provenance on them so
// a downstream reader can never mistake one for a live row.
function fromStaticRow(row, { market, fetchedAt, ageDays }) {
  const imgs = Array.isArray(row.imgs) && row.imgs.length ? row.imgs.filter(httpUrl) : (httpUrl(row.i) ? [row.i] : []);
  return Object.assign({}, row, {
    imgs,
    t: Array.isArray(row.t) && row.t.length ? row.t : ['general'],
    url: row.url || `${storefrontBase(market) || ''}/products/${row.h || ''}`,
    // Deliberately NOT defaulted to true: the CSV export has no availability
    // column, so "in stock" is unknown here, and unknown must not read as yes.
    available: typeof row.available === 'boolean' ? row.available : null,
    published: null,
    status: row.status || null,
    source: 'static_build',
    fetched_at: fetchedAt,
    stale: true,
    stale_days: ageDays,
  });
}

function usable(p) { return !!(p && p.n && p.h); }

// ── Fetchers ────────────────────────────────────────────────────────────────
async function fetchAdmin(market) {
  const r = await shopify.readPagedProducts(market, { maxPages: 12 });
  if (!r || !r.ok) {
    return {
      ok: false, source: 'shopify_admin',
      blocker: (r && (r.blocker || r.error)) || 'Shopify Admin products read failed.',
      would_request: r && r.would_request ? r.would_request : null,
      status: r && r.status ? r.status : null,
    };
  }
  const fetchedAt = r.fetched_at || new Date().toISOString();
  const products = (r.products || [])
    .map((p) => fromShopifyProduct(p, { source: 'shopify_admin', market, fetchedAt }))
    // Only sellable products may reach a creative: a draft/archived or
    // unpublished product has no live PDP to send a click to.
    .filter((p) => usable(p) && p.status === 'active' && p.published);
  return { ok: true, source: 'shopify_admin', products, fetched_at: fetchedAt, truncated: !!r.truncated, pages: r.pages };
}

async function fetchStorefront(market, { timeoutMs = 15000 } = {}) {
  const base = storefrontBase(market);
  const url = base ? `${base}/products.json?limit=250&page=1` : null;
  if (!base) {
    return { ok: false, source: 'shopify_storefront', blocker: `No storefront base is configured for market ${normMarket(market)}. Set SHOPIFY_STOREFRONT_BASE_${normMarket(market)}.` };
  }
  if (!liveConnectorsEnabled()) {
    // The kill switch is absolute: an unauthenticated public read is still an
    // outbound live connection, and a switch one connector ignores is worse than
    // no switch (see tests/kill-switch.spec.js).
    return {
      ok: false, source: 'shopify_storefront',
      blocker: 'Live connectors are disabled - set LIVE_CONNECTORS=on to allow the live catalog read.',
      would_request: { method: 'GET', url },
    };
  }
  const raw = [];
  const fetchedAt = new Date().toISOString();
  for (let page = 1; page <= 6; page++) {
    const pageUrl = `${base}/products.json?limit=250&page=${page}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await guardedFetch(pageUrl, {
        signal: ctrl.signal, cache: 'no-store',
        headers: { Accept: 'application/json', 'User-Agent': 'vahdam-lifecycle-os/catalog-live' },
      });
    } catch (e) {
      if (e && e.read_only_blocked) throw e;
      return { ok: false, source: 'shopify_storefront', blocker: `Storefront read failed: ${e.message}`, would_request: { method: 'GET', url: pageUrl } };
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      return { ok: false, source: 'shopify_storefront', blocker: `Storefront read returned HTTP ${res.status} for ${pageUrl}`, status: res.status, would_request: { method: 'GET', url: pageUrl } };
    }
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    const list = (body && body.products) || [];
    if (!list.length) break;
    raw.push(...list);
    if (list.length < 250) break;
  }
  const products = raw
    .map((p) => fromShopifyProduct(p, { source: 'shopify_storefront', market, fetchedAt }))
    .filter(usable);
  if (!products.length) {
    return { ok: false, source: 'shopify_storefront', blocker: `Storefront ${base}/products.json returned no products.`, would_request: { method: 'GET', url } };
  }
  return { ok: true, source: 'shopify_storefront', products, fetched_at: fetchedAt };
}

// Parsed once per region and held. The sync accessor is called dozens of times
// while a single mailer renders (one per image lookup), and re-reading a 200KB
// JSON file each time would turn a template render into disk-bound work.
const STATIC_CACHE = Object.create(null);

// A deployed file's mtime is frequently normalised to a build-system constant.
// 1540000000 is the value Vercel uses; anything at or before the repo's first
// commit is likewise a sentinel rather than an observation. Neither is evidence
// about when the catalog was built.
const MTIME_SENTINELS = new Set([1540000000000]);
function plausibleMtime(d) {
  const t = d.getTime();
  if (!Number.isFinite(t) || MTIME_SENTINELS.has(t)) return false;
  // Before 2024 this repo did not exist, and no artifact can predate its build.
  if (t < Date.parse('2024-01-01T00:00:00Z')) return false;
  return t <= Date.now() + 86400000; // a future mtime is a clock problem, not an age
}

function readStatic(market) {
  const region = staticRegion(market);
  if (!region) {
    return { ok: false, source: 'static_build', blocker: `No catalog artifact exists for market ${normMarket(market)} (only us/uk/global are built), and another region's catalog must never be substituted.` };
  }
  if (STATIC_CACHE[region]) return STATIC_CACHE[region];
  const file = path.join(process.cwd(), 'data', 'catalog', `products_${region}.json`);
  const alt = path.join(__dirname, '..', '..', 'data', 'catalog', `products_${region}.json`);
  const p = fs.existsSync(file) ? file : alt;
  let raw, mtime;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    mtime = fs.statSync(p).mtime;
  } catch (e) {
    // NOT cached: a missing artifact on a cold boot may simply mean the build
    // has not written it yet, and caching the miss would make that permanent.
    return { ok: false, source: 'static_build', blocker: `Static catalog products_${region}.json is unreadable: ${e.message}` };
  }
  const arr = Array.isArray(raw) ? raw : (raw.products || raw.items || []);
  // THE FILE'S mtime IS NOT A FACT ONCE DEPLOYED. Vercel normalises mtimes on
  // deployed files to a constant - 1540000000, i.e. 2018-10-20T01:46:40Z - so
  // this computed ~2871 days for an artifact `npm run build` had just written
  // minutes earlier, and the studio reported a seven-year-old catalog. That is
  // a fabricated fact in the one place the app exists to prevent them.
  //
  // So: prefer the stamp the build writes. Fall back to mtime only when it is
  // plausible. If neither can be trusted, report the age as UNKNOWN rather than
  // invent a number - a wrong date beside the word "stale" is worse than no
  // date, because it is actionable and false.
  let fetchedAt = null;
  try {
    const meta = JSON.parse(fs.readFileSync(p.replace(/\.json$/, '.meta.json'), 'utf8'));
    if (meta && meta.generated_at && !Number.isNaN(Date.parse(meta.generated_at))) fetchedAt = meta.generated_at;
  } catch (e) { /* no sidecar: fall through to mtime */ }
  if (!fetchedAt && mtime instanceof Date && plausibleMtime(mtime)) fetchedAt = mtime.toISOString();
  const ageDays = fetchedAt
    ? Math.max(0, Math.round((Date.now() - new Date(fetchedAt).getTime()) / 86400000))
    : null;
  STATIC_CACHE[region] = {
    ok: true, source: 'static_build', stale: true, stale_days: ageDays, fetched_at: fetchedAt,
    products: arr.filter(usable).map((row) => fromStaticRow(row, { market, fetchedAt, ageDays })),
  };
  return STATIC_CACHE[region];
}

// ── Collections ─────────────────────────────────────────────────────────────
// The store's REAL merchandising structure, not a keyword guess.
//
// Until now, "collections" in this app were INVENTED: scripts/build-catalog.js
// deriveTags() bucketed products by matching words in the title and tag string
// ("premium" meant the tags contained 'oolong' or 'white tea'), and the Mailer
// Studio rendered twelve hardcoded chips over those buckets. Nothing in that
// chain came from the store, so a "Premium" filter showed whatever the keyword
// list happened to catch, and link builders pointed at /collections/wellness-tea
// without anyone checking the store had such a collection.
//
// A collection is a real, named thing with a real URL that a customer can be
// sent to. So it is read, never derived. Two live paths, same ladder as products:
//   1. shopify_admin      — custom_collections + smart_collections, membership
//                           via /collections/{id}/products.json (ids only).
//   2. shopify_storefront — /collections.json, membership via
//                           /collections/{handle}/products.json. No credential.
// There is NO third path: the CSV artifact has no collection data, and deriving
// one from keywords is the fabrication this replaces. With neither live path
// available the answer is "unknown", and callers show no collections at all.
const COLLECTION_CONCURRENCY = 6;
const MAX_COLLECTIONS = Math.max(1, parseInt(process.env.CATALOG_MAX_COLLECTIONS || '60', 10) || 60);

// Membership is fetched per collection, so it is bounded twice over: by the
// number of collections walked and by the concurrency of that walk.
async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (_) { out[idx] = null; }
    }
  }));
  return out;
}

async function fetchCollectionsAdmin(market) {
  const list = await shopify.collections({ market, limit: 250 });
  if (!list.ok) return { ok: false, source: 'shopify_admin', blocker: list.blocker || list.error || 'Admin collections read failed.' };
  const rows = (list.collections || []).slice(0, MAX_COLLECTIONS);
  const members = await mapLimited(rows, COLLECTION_CONCURRENCY, async (c) => {
    const r = await shopify.collectionProductIds({ market, id: c.id, limit: 250 });
    return r && r.ok ? r.product_ids : null;
  });
  return {
    ok: true, source: 'shopify_admin', fetched_at: list.fetched_at,
    truncated: (list.collections || []).length > rows.length,
    partial: !!list.partial, partial_reason: list.partial_reason || null,
    collections: rows.map((c, n) => ({
      id: c.id != null ? String(c.id) : null,
      handle: String(c.handle || '').trim(),
      title: String(c.title || '').trim(),
      kind: c.kind || null,
      published: c.published_at !== null && c.published_at !== undefined,
      // null (not []) when the membership call failed, so "we could not read the
      // members" never renders as "this collection is empty".
      product_ids: members[n],
      products_count: Array.isArray(members[n]) ? members[n].length : (Number.isFinite(Number(c.products_count)) ? Number(c.products_count) : null),
      source: 'shopify_admin',
    })).filter((c) => c.handle && c.title),
  };
}

async function fetchCollectionsStorefront(market, { timeoutMs = 15000 } = {}) {
  const base = storefrontBase(market);
  if (!base) return { ok: false, source: 'shopify_storefront', blocker: `No storefront base configured for ${normMarket(market)}.` };
  if (!liveConnectorsEnabled()) {
    return { ok: false, source: 'shopify_storefront', blocker: 'Live connectors are disabled - set LIVE_CONNECTORS=on to allow the live collections read.', would_request: { method: 'GET', url: `${base}/collections.json?limit=250` } };
  }
  const getJson = async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await guardedFetch(url, { signal: ctrl.signal, cache: 'no-store', headers: { Accept: 'application/json', 'User-Agent': 'vahdam-lifecycle-os/catalog-live' } });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      if (e && e.read_only_blocked) throw e;
      return null;
    } finally { clearTimeout(timer); }
  };

  const listUrl = `${base}/collections.json?limit=250`;
  const body = await getJson(listUrl);
  const raw = (body && body.collections) || [];
  if (!raw.length) return { ok: false, source: 'shopify_storefront', blocker: `Storefront ${listUrl} returned no collections.`, would_request: { method: 'GET', url: listUrl } };
  const rows = raw.slice(0, MAX_COLLECTIONS);
  const fetchedAt = new Date().toISOString();
  // The storefront exposes membership only per collection, keyed by handle.
  const members = await mapLimited(rows, COLLECTION_CONCURRENCY, async (c) => {
    const b = await getJson(`${base}/collections/${encodeURIComponent(c.handle)}/products.json?limit=250`);
    if (!b || !Array.isArray(b.products)) return null;
    return b.products.map((p) => String(p.id));
  });
  return {
    ok: true, source: 'shopify_storefront', fetched_at: fetchedAt,
    truncated: raw.length > rows.length,
    collections: rows.map((c, n) => ({
      id: c.id != null ? String(c.id) : null,
      handle: String(c.handle || '').trim(),
      title: String(c.title || '').trim(),
      kind: null,
      published: true, // the public endpoint only lists published collections
      product_ids: members[n],
      products_count: Array.isArray(members[n]) ? members[n].length : (Number.isFinite(Number(c.products_count)) ? Number(c.products_count) : null),
      source: 'shopify_storefront',
    })).filter((c) => c.handle && c.title),
  };
}

const COLS = Object.create(null);       // market -> resolved collections
const COLS_MISS = Object.create(null);  // market -> recent failure
let COLS_INFLIGHT = Object.create(null);

/**
 * resolveCollections() — the live collection list for a market, with membership.
 * Never derives: a failure yields collections:[] plus a blocker, so a caller
 * renders nothing rather than a keyword-invented taxonomy.
 */
async function resolveCollections(market, { fresh = false } = {}) {
  const mk = normMarket(market);
  if (!isKnownMarket(mk)) {
    return { ok: false, live: false, market: mk, collections: [], count: 0, blocker: `Unknown market "${mk}". No store read was attempted.` };
  }
  if (!fresh) {
    const hit = COLS[mk];
    if (hit && Date.now() - hit.cached_at <= TTL_MS) return Object.assign({}, hit, { cache: 'hit' });
    const miss = COLS_MISS[mk];
    if (miss && Date.now() - miss.cached_at <= MISS_TTL_MS) return Object.assign({}, miss, { cache: 'miss-hit' });
    if (COLS_INFLIGHT[mk]) return COLS_INFLIGHT[mk];
  }
  const run = (async () => {
    const attempts = [];
    for (const [name, fn] of [['shopify_admin', fetchCollectionsAdmin], ['shopify_storefront', fetchCollectionsStorefront]]) {
      if (name === 'shopify_admin' && !shopify.isConnected(mk)) {
        attempts.push({ source: name, ok: false, blocker: shopify.status(mk).blocker });
        continue;
      }
      let r;
      try { r = await fn(mk); } catch (e) {
        if (e && e.read_only_blocked) throw e;
        r = { ok: false, source: name, blocker: e.message };
      }
      if (r.ok && r.collections.length) {
        const snap = {
          ok: true, live: true, market: mk, source: r.source, collections: r.collections,
          count: r.collections.length, fetched_at: r.fetched_at, truncated: !!r.truncated,
          partial: !!r.partial, partial_reason: r.partial_reason || null,
          attempts, cached_at: Date.now(), blocker: null,
        };
        COLS[mk] = snap;
        joinCollections(mk);
        return Object.assign({}, snap, { cache: 'miss' });
      }
      attempts.push({ source: name, ok: false, blocker: r.blocker, would_request: r.would_request || null });
    }
    const failed = {
      ok: false, live: false, market: mk, source: null, collections: [], count: 0,
      fetched_at: null, attempts, cached_at: Date.now(), cache: 'miss',
      blocker: `No live collections for ${mk}. ${attempts.map((a) => a.blocker).filter(Boolean).join(' | ')} There is no offline fallback: collections are read from the store or not shown, never derived from product keywords.`,
    };
    COLS_MISS[mk] = failed;
    return failed;
  })();
  COLS_INFLIGHT[mk] = run;
  try { return await run; } finally { delete COLS_INFLIGHT[mk]; }
}

/** Sync accessor over the primed collection snapshot (same prime-then-read contract). */
function collectionsSync(market) {
  const mk = normMarket(market);
  const hit = COLS[mk];
  if (hit && hit.collections.length) {
    return { collections: hit.collections, live: true, source: hit.source, market: mk, fetched_at: hit.fetched_at, count: hit.count };
  }
  return { collections: [], live: false, source: null, market: mk, fetched_at: null, count: 0, blocker: (COLS_MISS[mk] && COLS_MISS[mk].blocker) || 'Collections have not been read for this market yet.' };
}

/**
 * findCollection() — resolve a slug/title to a REAL collection, or null.
 * This is what stops a link builder emitting /collections/wellness-tea for a
 * store that has no such collection: an unresolved name yields null, and the
 * caller links the PDP or the catalog root instead of a guessed 404.
 */
function findCollection(nameOrHandle, market) {
  const list = collectionsSync(market).collections;
  if (!list.length) return null;
  const q = String(nameOrHandle == null ? '' : nameOrHandle).trim().toLowerCase();
  if (!q) return null;
  const slug = q.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return list.find((c) => c.handle.toLowerCase() === q)
    || list.find((c) => c.handle.toLowerCase() === slug)
    || list.find((c) => c.title.toLowerCase() === q)
    || list.find((c) => c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slug)
    || null;
}

/** The real collections a product belongs to, by product id. Never guessed. */
function collectionsForProduct(product, market) {
  const id = product && (product.id != null ? String(product.id) : null);
  if (!id) return [];
  return collectionsSync(market).collections
    .filter((c) => Array.isArray(c.product_ids) && c.product_ids.includes(id))
    .map((c) => ({ id: c.id, handle: c.handle, title: c.title }));
}

/**
 * joinCollections() — stamp each primed product row with the REAL collections it
 * belongs to. Called whenever either half (products or collections) finishes, so
 * the join happens regardless of which resolved first.
 *
 * A product row carries `collections: []` only once collections have actually
 * been read; until then the field is absent, which is how a caller tells "this
 * product is in no collection" apart from "we have not read the collections".
 */
function joinCollections(market) {
  const mk = normMarket(market);
  const snap = SNAP[mk];
  const cols = COLS[mk];
  if (!snap || !cols || !cols.collections.length) return;
  const byProduct = new Map();
  for (const c of cols.collections) {
    if (!Array.isArray(c.product_ids)) continue;
    for (const pid of c.product_ids) {
      if (!byProduct.has(pid)) byProduct.set(pid, []);
      byProduct.get(pid).push({ id: c.id, handle: c.handle, title: c.title });
    }
  }
  for (const p of snap.products) {
    if (p.id) p.collections = byProduct.get(p.id) || [];
  }
  snap.collections_joined_at = cols.fetched_at;
}

/** Prime BOTH halves and join them. This is what the pre-creative gate awaits. */
async function primeAll(market, opts = {}) {
  const [catalog, collections] = await Promise.all([
    resolve(market, opts),
    resolveCollections(market, opts).catch((e) => ({ ok: false, live: false, collections: [], count: 0, blocker: e.message })),
  ]);
  joinCollections(market);
  return { catalog, collections };
}

// ── Cache + resolution ──────────────────────────────────────────────────────
const SNAP = Object.create(null);   // market → resolved live snapshot
const MISS = Object.create(null);   // market → recent FAILED resolution
let INFLIGHT = Object.create(null); // market → promise, so a burst of callers makes one call

// A failure has to be remembered too, or only the happy path is rate-limited.
// With success-only caching, a store that is unreachable or misconfigured is
// re-walked on EVERY call — so the moment the catalog is actually broken, each
// page load and each hit on the unauthenticated health route fires a fresh Admin
// walk. That is exactly when you least want a retry storm. Short by design: it
// bounds the hammer without meaningfully delaying recovery once the store is back.
const MISS_TTL_MS = Math.max(10, parseInt(process.env.CATALOG_MISS_TTL_SECONDS || '60', 10) || 60) * 1000;

function cached(market) {
  const s = SNAP[normMarket(market)];
  if (!s) return null;
  if (Date.now() - s.cached_at > TTL_MS) return null;
  return s;
}
function cachedMiss(market) {
  const m = MISS[normMarket(market)];
  if (!m) return null;
  if (Date.now() - m.cached_at > MISS_TTL_MS) return null;
  return m;
}

/**
 * resolve() — try each live path in order, then report. Never throws for a
 * missing credential; `attempts` records why each path was skipped or failed so
 * the operator is pointed at the ONE thing that is actually broken.
 */
async function resolve(market, { fresh = false } = {}) {
  const mk = normMarket(market);
  if (!isKnownMarket(mk)) {
    return {
      ok: false, live: false, market: mk, source: null, products: [], count: 0,
      fetched_at: null, attempts: [], cache: 'skip',
      blocker: `Unknown market "${mk}". Known markets: ${[...KNOWN_MARKETS].join(', ')}. No store read was attempted.`,
    };
  }
  if (!fresh) {
    const hit = cached(mk);
    if (hit) return Object.assign({}, hit, { cache: 'hit' });
    const miss = cachedMiss(mk);
    if (miss) return Object.assign({}, miss, { cache: 'miss-hit' });
    if (INFLIGHT[mk]) return INFLIGHT[mk];
  }
  const run = (async () => {
    const attempts = [];
    for (const [name, fn] of [['shopify_admin', fetchAdmin], ['shopify_storefront', fetchStorefront]]) {
      if (name === 'shopify_admin' && !shopify.isConnected(mk)) {
        attempts.push({ source: name, ok: false, blocker: shopify.status(mk).blocker });
        continue;
      }
      let r;
      try { r = await fn(mk); } catch (e) {
        if (e && e.read_only_blocked) throw e;
        r = { ok: false, source: name, blocker: e.message };
      }
      if (r.ok && r.products.length) {
        const snap = {
          ok: true, live: true, market: mk, source: r.source, products: r.products,
          count: r.products.length, fetched_at: r.fetched_at, truncated: !!r.truncated,
          attempts, cached_at: Date.now(), blocker: null,
        };
        SNAP[mk] = snap;
        joinCollections(mk);
        return Object.assign({}, snap, { cache: 'miss' });
      }
      attempts.push({ source: name, ok: false, blocker: r.blocker, status: r.status || null, would_request: r.would_request || null });
    }
    // Every live path failed. Report the static artifact as what it is, and
    // remember the failure briefly so the next caller does not re-walk.
    const st = readStatic(mk);
    const failed = {
      ok: !!st.ok, live: false, market: mk, source: st.ok ? 'static_build' : null,
      products: st.ok ? st.products : [], count: st.ok ? st.products.length : 0,
      fetched_at: st.fetched_at || null, stale: true, stale_days: st.ok ? st.stale_days : null,
      attempts, cached_at: Date.now(), cache: 'miss',
      blocker: st.ok
        ? `Live catalog unavailable for ${mk}; falling back to the static build artifact ${st.fetched_at ? `built ${st.fetched_at} (${st.stale_days} day(s) old)` : 'whose build time could not be determined'}. ${attempts.map((a) => a.blocker).filter(Boolean).join(' | ')}`
        : `No catalog at all for ${mk}. ${attempts.map((a) => a.blocker).filter(Boolean).concat([st.blocker]).filter(Boolean).join(' | ')}`,
    };
    MISS[mk] = failed;
    return failed;
  })();
  INFLIGHT[mk] = run;
  try { return await run; } finally { delete INFLIGHT[mk]; }
}

/**
 * primeCatalog() — resolve and park a LIVE snapshot for the sync readers.
 * This is what catalog-gate.js awaits before any creative work begins.
 */
async function primeCatalog(market, opts = {}) { return resolve(market, opts); }

/**
 * catalogSync() — the synchronous accessor every in-template reader uses.
 * Returns the primed live snapshot when there is one, otherwise the static
 * artifact, ALWAYS labelled with which. Never fetches (it cannot: it is sync).
 */
function catalogSync(market) {
  const mk = normMarket(market);
  const hit = SNAP[mk];
  if (hit && hit.products.length) {
    return {
      products: hit.products, live: true, source: hit.source, market: mk,
      fetched_at: hit.fetched_at, count: hit.products.length, stale: false,
    };
  }
  const st = readStatic(mk);
  return {
    products: st.ok ? st.products : [], live: false, source: st.ok ? 'static_build' : null,
    market: mk, fetched_at: st.fetched_at || null, count: st.ok ? st.products.length : 0,
    stale: true, stale_days: st.ok ? st.stale_days : null, blocker: st.blocker || null,
  };
}

/** Provenance without fetching — safe to call from a health probe or a UI badge. */
function statusFor(market) {
  const mk = normMarket(market);
  const hit = SNAP[mk];
  return {
    market: mk,
    live: !!(hit && hit.products.length),
    source: hit ? hit.source : null,
    count: hit ? hit.count : 0,
    fetched_at: hit ? hit.fetched_at : null,
    age_seconds: hit ? Math.round((Date.now() - hit.cached_at) / 1000) : null,
    ttl_seconds: Math.round(TTL_MS / 1000),
    admin_connected: shopify.isConnected(mk),
    storefront_base: storefrontBase(mk),
    live_connectors: liveConnectorsEnabled(),
  };
}

function clearCache(market) {
  if (market) {
    delete SNAP[normMarket(market)];
    delete MISS[normMarket(market)];
    delete COLS[normMarket(market)];
    delete COLS_MISS[normMarket(market)];
    const r = staticRegion(market);
    if (r) delete STATIC_CACHE[r];
  } else {
    for (const k of Object.keys(SNAP)) delete SNAP[k];
    for (const k of Object.keys(MISS)) delete MISS[k];
    for (const k of Object.keys(COLS)) delete COLS[k];
    for (const k of Object.keys(COLS_MISS)) delete COLS_MISS[k];
    for (const k of Object.keys(STATIC_CACHE)) delete STATIC_CACHE[k];
  }
  INFLIGHT = Object.create(null);
  COLS_INFLIGHT = Object.create(null);
}

// ── Product selection ───────────────────────────────────────────────────────
// Selecting the WRONG product is as damaging as inventing one: the mailer shows
// a tin the copy does not describe, at a price that belongs to something else,
// linking a PDP the reader did not click for. So every match records HOW it was
// made and how confident that is, and a weak match is reported as weak rather
// than being quietly promoted to a fact.
const STOP = new Set([
  'tea', 'teas', 'chai', 'the', 'and', 'with', 'for', 'vahdam', 'blend', 'blends',
  'organic', 'loose', 'leaf', 'green', 'black', 'herbal', 'wellness', 'spiced',
  'masala', 'gift', 'set', 'pack', 'box', 'bags', 'premium', 'pure', 'collection',
]);
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function queryOf(q) {
  if (q == null) return {};
  if (typeof q === 'string') return { handle: q, title: q.replace(/[-_]+/g, ' ') };
  const hp = q.heroProduct || q;
  return {
    id: hp.id != null ? String(hp.id) : null,
    handle: hp.handle || hp.h || q.hero_handle || null,
    sku: hp.sku || q.sku || null,
    title: hp.title || hp.n || hp.name || q.hero_product || null,
  };
}

/**
 * findProduct() — resolve one product against the live catalog for a market.
 * Returns { product, match_method, confidence, ambiguous, candidates } or a
 * null product with a reason. NEVER returns a product from another market.
 *
 * confidence: 'exact'  — id, handle, or SKU matched, or the full title did
 *             'strong' — normalized title matched exactly
 *             'weak'   — matched only on a distinctive token; usable for a
 *                        thumbnail, NOT for a priced claim (the gate rejects it)
 */
function findProduct(query, market, { products = null } = {}) {
  const cat = products || catalogSync(market).products;
  const q = queryOf(query);
  if (!cat.length) return { product: null, match_method: null, confidence: null, reason: 'catalog empty' };

  if (q.id) {
    const hit = cat.find((p) => p.id && p.id === String(q.id));
    if (hit) return { product: hit, match_method: 'id', confidence: 'exact' };
  }
  if (q.handle) {
    const h = String(q.handle).trim().toLowerCase();
    const hit = cat.find((p) => (p.h || '').toLowerCase() === h);
    if (hit) return { product: hit, match_method: 'handle', confidence: 'exact' };
  }
  if (q.sku) {
    const s = String(q.sku).trim().toLowerCase();
    const hit = cat.find((p) => (p.sku && p.sku.toLowerCase() === s)
      || (p.variants || []).some((v) => v.sku && v.sku.toLowerCase() === s));
    if (hit) return { product: hit, match_method: 'sku', confidence: 'exact' };
  }
  if (q.title) {
    const t = norm(q.title);
    if (t) {
      const exact = cat.find((p) => norm(p.n) === t);
      if (exact) return { product: exact, match_method: 'title', confidence: 'exact' };
      const contains = cat.filter((p) => norm(p.n).includes(t) || t.includes(norm(p.n)));
      if (contains.length === 1) return { product: contains[0], match_method: 'title-contains', confidence: 'strong' };
      if (contains.length > 1) {
        return {
          product: contains[0], match_method: 'title-contains', confidence: 'weak', ambiguous: true,
          candidates: contains.slice(0, 5).map((p) => ({ n: p.n, h: p.h })),
          reason: `${contains.length} products match "${q.title}" by title`,
        };
      }
      // Token fallback, rarest token first so "burner" beats "green".
      const toks = t.split(' ').filter((w) => w.length >= 5 && !STOP.has(w)).sort((a, b) => b.length - a.length);
      for (const w of toks) {
        const hits = cat.filter((p) => norm(p.n).includes(w));
        if (hits.length === 1) return { product: hits[0], match_method: `token:${w}`, confidence: 'weak' };
        if (hits.length > 1) {
          return {
            product: hits[0], match_method: `token:${w}`, confidence: 'weak', ambiguous: true,
            candidates: hits.slice(0, 5).map((p) => ({ n: p.n, h: p.h })),
            reason: `${hits.length} products contain "${w}"`,
          };
        }
      }
    }
  }
  return {
    product: null, match_method: null, confidence: null,
    reason: `no product in the ${normMarket(market)} catalog matches ${JSON.stringify(q.handle || q.title || q.sku || q.id || '')}`,
  };
}

/**
 * sellable() — is this product fit to be promoted right now? Each failure is
 * named, because "do not use this product" and "use it but omit the price" are
 * different instructions to a generator.
 */
function sellable(p, { requireImage = true, requirePrice = true, requireStock = true } = {}) {
  const problems = [];
  if (!p) return { ok: false, problems: ['product not found'] };
  if (p.status && p.status !== 'active') problems.push(`status=${p.status}`);
  if (p.published === false) problems.push('not published');
  if (requirePrice && !p.price) problems.push('no price');
  if (requireImage && !httpUrl(p.i)) problems.push('no image');
  // available === null means the source could not tell us (the CSV artifact has
  // no stock column). Unknown is not the same as out of stock, and is not the
  // same as in stock either — it is reported, and the gate treats a non-live
  // source as blocking anyway.
  if (requireStock && p.available === false) problems.push('out of stock');
  return { ok: problems.length === 0, problems, stock_unknown: p.available == null };
}

/**
 * verifySelection() — check a list of products a caller intends to put in a
 * creative against the live catalog. Returns the verified rows (with live
 * price/image/url substituted for whatever the caller carried) plus the
 * rejects, each with a reason. This is what stops a stale price from a cached
 * plan reaching a mailer even when the catalog itself is live.
 */
function verifySelection(list, market, opts = {}) {
  const snap = catalogSync(market);
  const verified = [];
  const rejected = [];
  for (const item of (Array.isArray(list) ? list : [])) {
    const m = findProduct(item, market, { products: snap.products });
    if (!m.product) { rejected.push({ input: queryOf(item), reason: m.reason || 'not found in live catalog' }); continue; }
    const fit = sellable(m.product, opts);
    // A weak (token) match may not carry a price into copy — that is how a
    // "green tea" request ends up quoting the price of a different green tea.
    if (m.confidence === 'weak' && opts.strict !== false) {
      rejected.push({
        input: queryOf(item), reason: `match too weak to price (${m.match_method}${m.ambiguous ? ', ambiguous' : ''})`,
        candidates: m.candidates || [{ n: m.product.n, h: m.product.h }],
      });
      continue;
    }
    if (!fit.ok) { rejected.push({ input: queryOf(item), matched: { n: m.product.n, h: m.product.h }, reason: fit.problems.join(', ') }); continue; }
    verified.push(Object.assign({}, m.product, { match_method: m.match_method, match_confidence: m.confidence }));
  }
  return {
    live: snap.live, source: snap.source, market: normMarket(market),
    fetched_at: snap.fetched_at, verified, rejected,
    all_verified: rejected.length === 0 && verified.length > 0,
  };
}

/**
 * pickProducts() — choose N sellable products for a creative when the caller
 * has no explicit list. Deterministic (sorted by handle) so the same slot does
 * not silently change product between a preview and the approved send.
 */
function pickProducts(market, { limit = 6, tag = null, exclude = [], opts = {} } = {}) {
  const snap = catalogSync(market);
  const skip = new Set((exclude || []).map((h) => String(h).toLowerCase()));
  const pool = snap.products
    .filter((p) => sellable(p, opts).ok)
    .filter((p) => !skip.has((p.h || '').toLowerCase()))
    .filter((p) => !tag || (p.t || []).includes(tag))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
  return { live: snap.live, source: snap.source, fetched_at: snap.fetched_at, products: pool.slice(0, limit), pool_size: pool.length };
}

module.exports = {
  primeCatalog, primeAll, resolve, catalogSync, statusFor, clearCache,
  resolveCollections, collectionsSync, findCollection, collectionsForProduct,
  findProduct, verifySelection, pickProducts, sellable,
  normMarket, isKnownMarket, KNOWN_MARKETS, storefrontBase, staticRegion, readStatic,
  fromShopifyProduct, fromStaticRow,
};
