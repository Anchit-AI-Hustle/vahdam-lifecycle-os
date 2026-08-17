'use strict';

/**
 * Resolve a REAL, already-hosted product image URL (Shopify CDN) from the
 * product catalog, by handle or title, per market. Used as the guaranteed
 * online fallback for generated creatives so an asset never has to ship an
 * unrenderable `data:` URI (email clients strip those) — if generation/upload
 * fails, we use the product's own catalog photo, which is always online.
 *
 * The catalog itself now comes from catalog-live.js, which reads the LIVE store
 * (Admin, then the public storefront) and only falls back to the build artifact
 * when neither is reachable. This module keeps its synchronous API — the
 * template renderers that call it cannot await — by reading the snapshot that
 * catalog-gate.js primes before any creative work starts. sourceFor() exposes
 * which source actually answered, so a caller or test can prove a creative was
 * built on live data rather than on a months-old CSV export.
 */
const catalog = require('./catalog-live.js');

function load(market) { return catalog.catalogSync(market).products; }

/** Provenance of the rows this module is currently serving for a market. */
function sourceFor(market) {
  const s = catalog.catalogSync(market);
  return { live: s.live, source: s.source, fetched_at: s.fetched_at, count: s.count, market: s.market };
}

// Find the REAL catalog row for a handle string or entry/heroProduct-ish object.
// Never fabricates — returns a catalog row or null. Matching (handle → sku →
// exact title → contains → distinctive token, rarest first) lives in
// catalog-live.findProduct so the image path and the copy path can never
// disagree about which product a slot meant.
function match(entryOrHandle, market) {
  const m = catalog.findProduct(entryOrHandle, market);
  return m.product || null;
}

/** Like match(), but keeps HOW the row was found so a caller can refuse a weak hit. */
function matchDetail(entryOrHandle, market) {
  return catalog.findProduct(entryOrHandle, market);
}

// Return an HD variant of a Shopify CDN image by requesting a specific rendered
// width — Shopify serves a right-sized asset, so the photo stays crisp and never
// pixelates (upscaling artifacts avoided). Non-Shopify or empty URLs pass through
// unchanged; a width is only added when one is not already present.
function hd(url, width = 1200) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
  if (!/cdn\.shopify\.com|\/cdn\/shop\//.test(url)) return url;
  if (/[?&]width=/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'width=' + width;
}

// Accepts a handle string, or an entry/heroProduct-ish object. Returns an https
// image URL or null (never a data: URI). Pass a width to get an HD-boosted URL.
function imageFor(entryOrHandle, market, { width = 0 } = {}) {
  const p = match(entryOrHandle, market);
  const url = p && p.i;
  if (!(typeof url === 'string' && /^https?:\/\//.test(url))) return null;
  return width ? hd(url, width) : url;
}

// All REAL catalog image URLs for the matched product, primary first, in catalog
// (PDP gallery) order, de-duplicated and HD-boosted. Lets a caller pull DISTINCT
// real photos of the same product across mailer / ad / landing sections instead
// of repeating one shot. Never fabricates — returns [] when nothing matches.
function imagesFor(entryOrHandle, market, { width = 1200 } = {}) {
  const p = match(entryOrHandle, market);
  if (!p) return [];
  const list = Array.isArray(p.imgs) && p.imgs.length ? p.imgs : (p.i ? [p.i] : []);
  const seen = new Set();
  const out = [];
  for (const u of list) {
    if (typeof u === 'string' && /^https?:\/\//.test(u) && !seen.has(u)) {
      seen.add(u);
      out.push(hd(u, width));
    }
  }
  return out;
}

// Resolve a REAL product handle from the catalog (for building a PDP URL).
// Returns the catalog handle string or null — NEVER a fabricated handle.
function handleFor(entryOrHandle, market) {
  const p = match(entryOrHandle, market);
  return (p && (p.h || p.handle)) || null;
}

module.exports = { imageFor, imagesFor, handleFor, match, matchDetail, sourceFor, load, hd };
