'use strict';

/**
 * catalog-gate.js — the check that runs BEFORE any creative is generated.
 *
 * THE RULE (product owner): if the catalog in front of the generator is not the
 * live store, there is no point proceeding. A mailer, ad, landing page or social
 * post built on a stale catalog is not "mostly right" — it is a set of confident
 * claims about prices, stock and products that the store does not back. Every
 * downstream cost (LLM spend, image generation, review time, send reputation)
 * is spent producing something that has to be thrown away, and the failure is
 * invisible: the output looks perfect.
 *
 * So this gate is a HARD STOP, not a warning, and it runs first — before the
 * first token of copy and before the first image call.
 *
 * It checks four things, in order, and names which one failed:
 *   1. LIVE      — the catalog came from the store (Admin or storefront), not
 *                  from the build artifact.
 *   2. FRESH     — the live read is within CATALOG_MAX_AGE_MINUTES.
 *   3. POPULATED — it actually contains sellable products.
 *   4. SELECTED  — every product this creative intends to name resolves to a
 *                  live row, unambiguously, and is active / published / priced /
 *                  in stock. A weak (token) match is a failure, not a pass.
 *
 * On success it returns the verified rows, so the caller builds from the live
 * price, live image and live PDP URL rather than from whatever it was carrying.
 *
 * Passing it also PRIMES the snapshot the synchronous readers use
 * (catalog-live.catalogSync), which is why the gate has to be awaited rather
 * than merely consulted: it is both the check and the load.
 *
 * BYPASS: CATALOG_GATE=off exists for local work with no store access. It never
 * fakes a pass — the result carries bypassed:true, live:false and a
 * DATA REQUIRED line that every generated artifact inherits, and
 * /api/connectors-health reports the bypass as a live defect. Nothing that ships
 * to a customer may carry it.
 */

const catalog = require('./catalog-live.js');

const MAX_AGE_MIN = Math.max(1, parseInt(process.env.CATALOG_MAX_AGE_MINUTES || '60', 10) || 60);

function gateMode() {
  const v = String(process.env.CATALOG_GATE == null ? '' : process.env.CATALOG_GATE).trim().toLowerCase();
  return (v === 'off' || v === '0' || v === 'false' || v === 'disabled') ? 'off' : 'enforce';
}

const CODES = {
  NOT_LIVE: 'CATALOG_NOT_LIVE',
  STALE: 'CATALOG_STALE',
  EMPTY: 'CATALOG_EMPTY',
  PRODUCTS_UNVERIFIED: 'PRODUCTS_NOT_IN_LIVE_CATALOG',
};

// The remediation is the point of the block: an operator reading it should know
// the one thing to change, not be handed a list of everything that could matter.
function remediationFor(code, snap) {
  const attempts = (snap && snap.attempts) || [];
  const blockers = attempts.map((a) => a.blocker).filter(Boolean);
  switch (code) {
    case CODES.NOT_LIVE:
      return [
        'Set LIVE_CONNECTORS=on so the app may read the store.',
        'For Admin reads also set SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_TOKEN (read_products scope; append _US / _UK / _IN per market).',
        'Without a token the public storefront path is used instead - it needs no credential, only the kill switch on and a reachable storefront base.',
      ].concat(blockers.length ? [`Paths tried: ${blockers.join(' | ')}`] : []);
    case CODES.STALE:
      return [`The live snapshot is older than CATALOG_MAX_AGE_MINUTES (${MAX_AGE_MIN} min). Re-run with fresh:true, or via /api/catalog?op=refresh.`];
    case CODES.EMPTY:
      return ['The live read succeeded but returned no sellable products. Check that products are active, published to this sales channel, and in stock for this market.'];
    case CODES.PRODUCTS_UNVERIFIED:
      return [
        'Every product named in a creative must resolve to a live catalog row by handle, SKU or exact title.',
        'Fix the slot to reference a live handle, or let the generator pick from the live catalog (catalog-live.pickProducts).',
      ];
    default:
      return [];
  }
}

function dataRequiredLine(code, market, detail) {
  // The master spec's missing-data marker, so a blocked build is legible in the
  // same vocabulary as every other unmet dependency.
  return `[DATA REQUIRED BEFORE LAUNCH: live Shopify catalog (${code}), ${market}${detail ? `, ${detail}` : ''}]`;
}

/**
 * requireLiveCatalog({ market, products, purpose, fresh, select })
 *
 * @returns on pass  { ok:true, live:true, catalog:{...}, products:[verified], provenance:{...} }
 *          on block { ok:false, blocked:true, code, blocker, remediation:[], provenance:{...},
 *                     data_required, status: 'NOT LAUNCH READY - DATA DEPENDENCY' }
 */
async function requireLiveCatalog({
  market = 'US',
  products = null,
  purpose = 'creative',
  fresh = false,
  select = {},
} = {}) {
  const mk = catalog.normMarket(market);
  const snap = await catalog.primeCatalog(mk, { fresh });

  const provenance = {
    market: mk,
    live: !!snap.live,
    source: snap.source || null,
    count: snap.count || 0,
    fetched_at: snap.fetched_at || null,
    truncated: !!snap.truncated,
    checked_at: new Date().toISOString(),
    purpose,
  };

  const block = (code, detail) => {
    const bypassed = gateMode() === 'off';
    const base = {
      code,
      blocker: snap.blocker || detail || code,
      detail: detail || null,
      remediation: remediationFor(code, snap),
      provenance,
      data_required: dataRequiredLine(code, mk, detail),
      purpose,
    };
    if (bypassed) {
      // Explicitly bypassed: proceed, but the output is stamped, not laundered.
      return Object.assign({}, base, {
        ok: true, blocked: false, bypassed: true, live: false,
        catalog: { products: catalog.catalogSync(mk).products, market: mk, live: false, source: snap.source || null },
        products: Array.isArray(products) ? products : [],
        warning: `CATALOG_GATE=off - creative is being generated against a NON-LIVE catalog (${snap.source || 'none'}). ${base.data_required}`,
        status: 'GENERATED WITHOUT LIVE CATALOG VERIFICATION',
      });
    }
    return Object.assign({}, base, {
      ok: false, blocked: true, bypassed: false, live: false,
      status: 'NOT LAUNCH READY - DATA DEPENDENCY',
      message: `${purpose} generation stopped: ${base.blocker}`,
    });
  };

  if (!snap.live) return block(CODES.NOT_LIVE, `catalog source is ${snap.source || 'unavailable'}`);

  const ageMin = snap.fetched_at ? (Date.now() - new Date(snap.fetched_at).getTime()) / 60000 : Infinity;
  if (!(ageMin < MAX_AGE_MIN)) return block(CODES.STALE, `live read is ${Math.round(ageMin)} min old`);

  if (!snap.count) return block(CODES.EMPTY, 'live catalog returned 0 sellable products');

  // 4. The products this creative will actually name.
  let verified = null;
  if (Array.isArray(products) && products.length) {
    const v = catalog.verifySelection(products, mk, select);
    if (!v.all_verified) {
      const why = v.rejected.map((r) => `${(r.input && (r.input.handle || r.input.title || r.input.sku)) || '?'}: ${r.reason}`).join('; ');
      return block(CODES.PRODUCTS_UNVERIFIED, why);
    }
    verified = v.verified;
  }

  return {
    ok: true, blocked: false, bypassed: false, live: true,
    status: 'LIVE CATALOG VERIFIED',
    code: 'OK',
    catalog: { products: snap.products, market: mk, live: true, source: snap.source, count: snap.count, fetched_at: snap.fetched_at },
    products: verified || [],
    provenance,
    purpose,
  };
}

/**
 * The shape a blocked gate should be returned to an HTTP caller as. Kept here so
 * every endpoint reports a block identically and none of them invents a
 * half-generated response that looks like a success.
 */
function blockedResponse(gate) {
  return {
    ok: false,
    blocked: true,
    reason: 'live_catalog_required',
    code: gate.code,
    status: gate.status,
    message: gate.message || gate.blocker,
    blocker: gate.blocker,
    data_required: gate.data_required,
    remediation: gate.remediation,
    catalog: gate.provenance,
  };
}

/** Provenance to stamp on a generated artifact, so the record travels with it. */
function stamp(gate) {
  if (!gate) return null;
  return {
    catalog_live: !!gate.live,
    catalog_source: (gate.provenance && gate.provenance.source) || null,
    catalog_fetched_at: (gate.provenance && gate.provenance.fetched_at) || null,
    catalog_count: (gate.provenance && gate.provenance.count) || 0,
    catalog_verified_at: (gate.provenance && gate.provenance.checked_at) || null,
    gate_bypassed: !!gate.bypassed,
    data_required: gate.bypassed ? gate.data_required : null,
  };
}

module.exports = { requireLiveCatalog, blockedResponse, stamp, gateMode, CODES, MAX_AGE_MIN };
