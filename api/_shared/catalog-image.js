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

// Find the REAL catalog row for a handle string or entry/heroProduct-ish object.
// Never fabricates — returns a catalog row or null.
function match(entryOrHandle, market) {
  const arr = load(market);
  if (!arr.length) return null;
  let handle = null, title = null;
  if (typeof entryOrHandle === 'string') { handle = entryOrHandle; title = entryOrHandle.replace(/[-_]+/g, ' '); }
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
    // Keyword fallback: a handle like "turmeric-curcumin" or "green-burner" has
    // no exact catalog row, but a distinctive token ("turmeric", "burner") does.
    // Try the longest tokens first so the rare, specific word wins over a common
    // one ("burner" before "green"), keeping a real match instead of a miss.
    if (!p) {
      const toks = t.split(/\s+/).filter((w) => w.length >= 5).sort((a, b) => b.length - a.length);
      for (const w of toks) { p = arr.find((x) => (x.n || '').toLowerCase().includes(w)); if (p) break; }
    }
  }
  return p || null;
}

// Accepts a handle string, or an entry/heroProduct-ish object. Returns an https
// image URL or null (never a data: URI).
function imageFor(entryOrHandle, market) {
  const p = match(entryOrHandle, market);
  const url = p && p.i;
  return (typeof url === 'string' && /^https?:\/\//.test(url)) ? url : null;
}

// Resolve a REAL product handle from the catalog (for building a PDP URL).
// Returns the catalog handle string or null — NEVER a fabricated handle.
function handleFor(entryOrHandle, market) {
  const p = match(entryOrHandle, market);
  return (p && (p.h || p.handle)) || null;
}

module.exports = { imageFor, handleFor, match };
