'use strict';
/**
 * claims-library.js — the approved-claims source of truth.
 *
 * `claim compliance` carries weight 8 and is a CRITICAL dimension, and the
 * repo had no library at all: every benefit, certification and comparison a
 * generator wrote went out unverified. CLAUDE.md has listed this as a known
 * gap for a long time; nothing enforced it because nothing could.
 *
 * The library ships EMPTY, deliberately. Seeding it with plausible-sounding
 * claims would be precisely the fabrication the spec forbids - approval is a
 * human act by brand/legal, recorded with a source and a date. So until it is
 * populated the gate BLOCKS any campaign that makes a claim, which is the
 * correct answer rather than a convenient one.
 *
 * Detection is deliberately conservative: it flags sentences that ASSERT
 * something checkable (a number, a superlative, a certification, a health or
 * comparison statement) and ignores ordinary sensory copy, because a false
 * positive on "warm and malty" would train people to bypass the gate.
 */

const fs = require('fs');
const path = require('path');

let CACHE = null;
function load() {
  if (CACHE) return CACHE;
  try {
    const p = path.join(__dirname, '..', '..', 'data', 'approved', 'claims.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    CACHE = Array.isArray(j.claims) ? j.claims : [];
  } catch (_) { CACHE = []; }
  return CACHE;
}

// Sentences that assert something a regulator or a customer could check.
const CLAIMY = [
  /\b\d+(\.\d+)?\s*%/,                              // a percentage
  /\b\d[\d,]{2,}\+?\s+(customers|reviews|orders|cups|people)/i,
  /\b\d(\.\d)?\s*(\/|out of)\s*5\b/i,               // a rating
  /\b(clinically|scientifically|proven|guaranteed|certified|organic|usda|fda|non-gmo|fair ?trade)\b/i,
  /\b(no\.? ?1|number one|best[- ]selling|award[- ]winning|world'?s|india'?s)\b/i,
  /\b(cures?|treats?|prevents?|reduces?|boosts?|detox|weight loss|immunity|lowers?)\b/i,
  // A comparison claim needs a MEASURABLE or a competitor reference. A bare
  // "more than" swallows ordinary prose - "does more than warm your hands" is
  // sensory copy, and flagging it would train people to bypass the gate.
  /\b\d+\s*(x|times|%)\s+(more|less|better|stronger|faster)\b/i,
  /\b(more|less|better|cheaper|stronger)\s+than\s+(any|other|most|leading|ordinary|regular|standard|competing|supermarket)\b/i,
];

function sentences(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')     // markup is not copy
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 8);
}

/**
 * Collect the human-readable strings out of a campaign, one per line.
 * JSON.stringify would work as a haystack but destroys sentence boundaries,
 * so a single claim anywhere made the ENTIRE payload read as one claim.
 */
function copyOf(obj, out = [], depth = 0) {
  if (depth > 8 || obj == null) return out;
  if (typeof obj === 'string') { out.push(obj); return out; }
  if (Array.isArray(obj)) { for (const v of obj) copyOf(v, out, depth + 1); return out; }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (/^(id|url|href|src|handle|sku|slug|_.*)$/i.test(k)) continue;  // identifiers are not copy
      copyOf(v, out, depth + 1);
    }
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 %./]/g, '').trim();

/** Extract claim-like sentences from arbitrary campaign copy. */
function extractClaims(text) {
  return sentences(text).filter((s) => CLAIMY.some((re) => re.test(s)));
}

/**
 * Verify a campaign's copy against the approved library.
 * @returns {{checked, approved, unapproved, items, library_size, populated}}
 */
function verify(campaignOrText, region) {
  // Join with newlines, not the default comma: sentences() splits on them,
  // so a comma-joined array bleeds one field into the next.
  const text = typeof campaignOrText === 'string' ? campaignOrText : copyOf(campaignOrText).join('\n');
  const lib = load();
  const approvedNow = lib.filter((c) => {
    if (region && Array.isArray(c.regions) && c.regions.length && !c.regions.includes(region) && !c.regions.includes('GLOBAL')) return false;
    if (c.expires_at && new Date(c.expires_at) < new Date()) return false;
    return true;
  }).map((c) => norm(c.text));

  const found = extractClaims(text);
  const items = found.map((s) => {
    const n = norm(s);
    const ok = approvedNow.some((a) => a && (n === a || n.includes(a)));
    return { text: s.slice(0, 160), approved: ok };
  });
  return {
    checked: items.length,
    approved: items.filter((i) => i.approved).length,
    unapproved: items.filter((i) => !i.approved).length,
    items: items.filter((i) => !i.approved).slice(0, 10),
    library_size: lib.length,
    populated: lib.length > 0,
  };
}

module.exports = { verify, extractClaims, copyOf, load, _reset: () => { CACHE = null; } };
