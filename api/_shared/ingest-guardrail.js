'use strict';
/**
 * ingest-guardrail.js — two-phase filter that keeps the daily learning agent
 * ON-CONTEXT: US/UK D2C tea, coffee, supplements & wellness ONLY. Everything
 * else (generic ecommerce listicles, unrelated tech, off-geo pricing, random
 * social chatter) is dropped BEFORE it reaches the KB / vector space.
 *
 *   Phase 1  deterministic pre-filter (NO LLM, no tokens): brand whitelist,
 *            geo + currency gate (US/UK · $/£), relevance lexicon, junk
 *            blocklist. This is the cheap first wall.
 *   Phase 2  LLM gatekeeper (only on Phase-1 survivors): a strict D2C+wellness
 *            relevance judgement. Fails OPEN when no LLM is configured — a
 *            missing key must never silently drop real data — but says so.
 *
 * assess(item)          -> Phase 1 verdict {keep, phase, reason, signals}
 * gatekeep(item,{llm})  -> Phase 1 then (if kept & llm) Phase 2 -> final verdict
 * filterItems(items)    -> {kept, dropped, total} for batch ingestion
 * BRAND_WHITELIST / RELEVANT / BLOCK exported for reuse + tests.
 *
 * An item is any {title?, text?/raw_text?/body?, url?, brand?, source?}.
 */

let callLLM = null; try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }

// Competitor + adjacent US/UK D2C wellness brands we DO learn from. Seeded from
// the competitor list in competitor-core.js + close category adjacents. Match is
// substring on the lowercased haystack (name or domain fragment).
const BRAND_WHITELIST = [
  'vahdam', 'ag1', 'drinkag1', 'ritual', 'seed', 'pukka', 'pukkaherbs', 'pique', 'piquelife', 'piquetea',
  'four sigmatic', 'foursigmatic', 'mudwtr', 'mud\\wtr', 'mud wtr', 'everyday dose', 'everydaydose',
  'beam', 'ryze', 'teapigs', 'yogi tea', 'traditional medicinals', 'twinings', 'clipper teas',
  'bird & blend', 'birdandblend', 't2 tea', 'tea forte', 'harney', 'teabloom', 'vitacup',
  'huel', 'athletic greens', 'moon juice', 'olipop', 'magic mind', 'bloom nutrition',
  'liquid iv', 'liquid i.v', 'hydrant', 'kin euphorics', 'rasa koffee', 'bulletproof', 'rise brewing',
];

// Relevance lexicon: the category + the D2C/lifecycle-marketing angle we care about.
const RELEVANT = [
  'tea', 'chai', 'matcha', 'herbal', 'tisane', 'oolong', 'darjeeling', 'assam', 'green tea', 'black tea', 'rooibos',
  'coffee', 'espresso', 'cold brew', 'mushroom coffee', 'adaptogen', 'ashwagandha', 'turmeric', 'ksm-66',
  'supplement', 'superfood', 'functional beverage', 'nootropic', 'collagen', 'probiotic', 'gut health', 'greens powder',
  'wellness', 'ritual', 'immunity', 'sleep aid', 'energy', 'focus', 'calm', 'stress', 'cortisol', 'longevity', 'hydration',
  // D2C / lifecycle marketing relevance
  'd2c', 'dtc', 'subscription', 'retention', 'lifecycle', 'klaviyo', 'abandoned cart', 'ltv', 'repeat purchase',
  'winback', 'win-back', 'cohort', 'email marketing', 'sms marketing', 'loyalty program', 'replenishment', 'churn',
];

// Hard junk / off-context blocklist — if the item is DOMINATED by these with no
// relevance signal and no whitelisted brand, it is dropped.
const BLOCK = [
  'crypto', 'blockchain', 'nft', 'web3', 'stock market', 'forex', 'real estate', 'mortgage',
  'video game', 'sports betting', 'casino', 'dating app', 'devops', 'kubernetes',
  'javascript framework', 'gpu', 'iphone', 'android update', 'operating system',
  'political', 'election', 'celebrity gossip', 'horoscope',
];

const OK_CURRENCY = /(\$|\busd\b|£|\bgbp\b)/i;
const BAD_CURRENCY = /(€|\beur\b|₹|\binr\b|¥|\bjpy\b|\bcny\b|a\$|\baud\b|c\$|\bcad\b)/i;
const US_UK_GEO = /(united states|u\.s\.|\bus\b|\busa\b|america|united kingdom|\buk\b|britain|england|\.co\.uk)/i;
const NON_US_UK_GEO = /(\.eu\b|\.de\b|\.fr\b|\.in\b|\.au\b|\.ca\b|\.jp\b|europe|germany|france|\bindia\b|australia|\bcanada\b|japan)/i;

function haystack(item) {
  return [item && item.title, (item && (item.text || item.raw_text || item.body)) || '', item && item.url, item && item.brand, item && item.source]
    .filter(Boolean).join(' \n ').toLowerCase();
}
function hits(hay, list) { const found = []; for (const w of list) if (hay.includes(w)) found.push(w); return found; }

// ── Phase 1: deterministic pre-filter ───────────────────────────────────────
function assess(item) {
  const hay = haystack(item || {});
  if (!hay.trim()) return { keep: false, phase: 1, reason: 'empty content' };
  const rel = hits(hay, RELEVANT);
  const blk = hits(hay, BLOCK);
  const brand = BRAND_WHITELIST.find((b) => hay.includes(b)) || null;
  // Currency gate: a non-US/UK currency with NO $/£ present is off-market pricing.
  if (BAD_CURRENCY.test(hay) && !OK_CURRENCY.test(hay)) return { keep: false, phase: 1, reason: 'non-US/UK currency (no $/£)', signals: { brand } };
  // Geo gate: an explicit non-US/UK geo with no US/UK signal and no known brand.
  if (NON_US_UK_GEO.test(hay) && !US_UK_GEO.test(hay) && !brand) return { keep: false, phase: 1, reason: 'off-geo (not US/UK)', signals: { brand } };
  // Junk-dominated with no relevance and not a whitelisted brand.
  if (blk.length >= 2 && rel.length === 0 && !brand) return { keep: false, phase: 1, reason: `junk/off-context (${blk.slice(0, 3).join(', ')})`, signals: { brand } };
  // Must carry a category/D2C relevance signal OR come from a whitelisted brand.
  if (rel.length === 0 && !brand) return { keep: false, phase: 1, reason: 'no tea/coffee/supplement/wellness or D2C signal' };
  return { keep: true, phase: 1, reason: brand ? `whitelisted brand: ${brand}` : `relevant (${rel.slice(0, 4).join(', ')})`, signals: { brand, relevanceHits: rel.length } };
}

// ── Phase 2: LLM gatekeeper (strict) ─────────────────────────────────────────
const P2_SYS = `You are a strict relevance gatekeeper for a US/UK D2C tea, coffee, supplements & wellness brand's competitive-intelligence knowledge base. Decide whether the content is DIRECTLY useful to that exact context: a relevant brand/product, its marketing/lifecycle/retention, category trends, or consumer wellness insight for the US or UK market. REJECT generic ecommerce listicles, unrelated tech, other geographies or product categories, and social chatter. Return STRICT JSON ONLY: {"relevant":true|false,"topic":"<3-6 words>","reason":"<one short line>"}.`;

async function phase2(item) {
  if (!callLLM) return { relevant: true, skipped: true, reason: 'no LLM configured — Phase 2 skipped (kept)' };
  const body = String((item && (item.text || item.raw_text || item.body)) || '').slice(0, 6000);
  const user = `TITLE: ${(item && item.title) || ''}\nURL: ${(item && item.url) || ''}\nCONTENT:\n"""\n${body}\n"""\nReturn the JSON verdict.`;
  try {
    const out = await callLLM({ systemPrompt: P2_SYS, userMessage: user, responseFormat: { type: 'json_object' }, maxTokens: 120, temperature: 0, timeoutMs: 20000, stage: 'ingest-guardrail', tier: 'fast' });
    if (!out || !out.ok || !out.text) return { relevant: true, skipped: true, reason: 'LLM unavailable — kept' };
    const j = JSON.parse(out.text.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, '$1'));
    return { relevant: j.relevant !== false, topic: j.topic || null, reason: j.reason || '' };
  } catch (e) { return { relevant: true, skipped: true, reason: `Phase 2 error (${e.message}) — kept` }; }
}

// ── Combined gate ────────────────────────────────────────────────────────────
async function gatekeep(item, { llm = true } = {}) {
  const p1 = assess(item);
  if (!p1.keep) return { keep: false, phase: 1, reason: p1.reason, p1 };
  if (!llm) return { keep: true, phase: 1, reason: p1.reason, p1 };
  const p2 = await phase2(item);
  if (!p2.relevant) return { keep: false, phase: 2, reason: `LLM gatekeeper: ${p2.reason || 'not relevant'}`, p1, p2 };
  return { keep: true, phase: p2.skipped ? 1 : 2, reason: p2.skipped ? p1.reason : `relevant: ${p2.topic || p2.reason}`, p1, p2 };
}

async function filterItems(items, opts) {
  const kept = [], dropped = [];
  for (const it of (items || [])) { const v = await gatekeep(it, opts); (v.keep ? kept : dropped).push({ item: it, verdict: v }); }
  return { kept, dropped, total: (items || []).length };
}

module.exports = { assess, phase2, gatekeep, filterItems, BRAND_WHITELIST, RELEVANT, BLOCK };
