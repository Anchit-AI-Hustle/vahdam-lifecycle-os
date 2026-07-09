'use strict';

/**
 * Resolve a REAL, already-hosted product image URL (Shopify CDN) from the built
 * product catalog, by handle or title, per market. Used as the guaranteed
 * online fallback for generated creatives so an asset never has to ship an
 * unrenderable `data:` URI (email clients strip those) — if generation/upload
 * fails, we use the product's own catalog photo, which is always online.
 */
const fs = require('fs');
const path = require('path');

const CACHE = {};
function regionKey(market) {
  const m = String(market || 'US').toLowerCase();
  if (m.startsWith('uk')) return 'uk';
  if (/global|eu|au|me|row|rest/.test(m)) return 'global';
  return 'us';
}
function load(market) {
  const r = regionKey(market);
  if (CACHE[r]) return CACHE[r];
  let arr = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'catalog', `products_${r}.json`), 'utf8'));
    arr = Array.isArray(raw) ? raw : (raw.products || raw.items || []);
  } catch (_) { arr = []; }
  CACHE[r] = arr;
  return arr;
}

// Accepts a handle string, or an entry/heroProduct-ish object. Returns an https
// image URL or null (never a data: URI).
function imageFor(entryOrHandle, market) {
  const arr = load(market);
  if (!arr.length) return null;
  let handle = null, title = null;
  if (typeof entryOrHandle === 'string') handle = entryOrHandle;
  else if (entryOrHandle && typeof entryOrHandle === 'object') {
    const hp = entryOrHandle.heroProduct || entryOrHandle;
    handle = hp.handle || hp.h || entryOrHandle.hero_handle || null;
    title = hp.title || hp.n || entryOrHandle.hero_product || null;
  }
  let p = handle && arr.find((x) => x.h === handle);
  if (!p && title) {
    const t = String(title).toLowerCase();
    p = arr.find((x) => (x.n || '').toLowerCase() === t)
      || arr.find((x) => (x.n || '').toLowerCase().includes(t.slice(0, 18)));
  }
  const url = p && p.i;
  return (typeof url === 'string' && /^https?:\/\//.test(url)) ? url : null;
}

module.exports = { imageFor };
