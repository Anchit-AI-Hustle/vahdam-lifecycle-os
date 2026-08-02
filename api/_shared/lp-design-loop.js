'use strict';
// ════════════════════════════════════════════════════════════════════════════
// Landing-page DESIGN loop — bounded critique -> revise pass on generated HTML.
//
// The landing-page generator (landing-page-core.js) is single-shot: one LLM
// call produces the full HTML. This adds the "cascaded loop" that lifts design
// quality without ever breaking the base path:
//
//   1. Score the generated HTML on 6 DESIGN dimensions (fast tier, cheap).
//   2. If overall < PASS -> ONE revision call (premium) that returns the
//      COMPLETE improved HTML, with the concrete fixes embedded.
//   3. Budget-aware + hard time-boxed: the loop only runs when enough of the
//      function's wall-clock budget remains, and on ANY error / timeout /
//      truncated or invalid revision it returns the ORIGINAL html untouched.
//      The caller's request always succeeds with a valid page.
//
// Enforces the governing design HARD rules (docs/campaign-orchestration-master-
// spec.md): brand palette + fonts only, NEVER a black/#171717/dark-neutral
// section background, WCAG-AA contrast (no dark-on-dark / light-on-light),
// equal-size aligned parallel cards, and the required conversion section order.
//
// Usage:
//   const { runDesignLoop } = require('./lp-design-loop.js');
//   const { html, quality } = await runDesignLoop({ html, brief, market, store, channel, timeBoxMs });
//   // quality: { scored:bool, score:number|null, revised:bool, dims:object|null }
// ════════════════════════════════════════════════════════════════════════════

const callLLM = require('./llm.js');
const { parseJSON } = require('./llm.js');

const PASS_THRESHOLD = 8;          // higher bar than the mailer loop — this is a "make it better" pass
const MIN_REVISE_BUDGET_MS = 28000; // don't start a full-HTML revise without this much wall-clock left
const DIMENSIONS = ['visual_hierarchy', 'brand_compliance', 'layout_polish', 'conversion_structure', 'hero_impact', 'mobile_responsiveness'];

const SCORE_SYSTEM = `You are a senior D2C landing-page DESIGN auditor for VAHDAM India (premium Indian heritage tea). You are given the FULL HTML of one generated landing page. Judge only what the code actually renders. Output STRICT JSON, no markdown, no commentary.

Score each dimension 0-10:
- visual_hierarchy: a clear focal path — dominant hero headline + one primary CTA, deliberate type scale, generous whitespace, sections that read in priority order. Penalise flat/monotonous pages where everything competes.
- brand_compliance: ONLY the four brand hex colours (#004A2B green, #AB8743 gold, #171717 ink, #FBF5EA cream) and the brand fonts (Lao MN/serif headings, Proxima Nova/sans body). HARD FAILS (cap this dimension at 3): any black or #171717 or dark-neutral SECTION background; any dark-on-dark or light-on-light text that breaks WCAG-AA contrast; any off-palette colour.
- layout_polish: consistent spacing rhythm, aligned grids, EQUAL-SIZE aligned parallel cards, no cramped or overflowing blocks, balanced composition, tasteful rule lines/badges.
- conversion_structure: announcement (if offer) -> header -> hero (one dominant CTA) -> trust strip -> benefits -> story -> product/offer -> sensory/interactive -> social proof -> FAQ -> final CTA -> footer -> sticky mobile CTA. Score how complete and well-ordered this is.
- hero_impact: an above-the-fold that stops the scroll — a real spatial/product stage, a promise-led headline, immediate CTA, no wall of text.
- mobile_responsiveness: works at 360px with no horizontal overflow, >=44px tap targets, readable clamped type.

Return JSON exactly:
{"scores":{"visual_hierarchy":n,"brand_compliance":n,"layout_polish":n,"conversion_structure":n,"hero_impact":n,"mobile_responsiveness":n},"overall":n,"critique":"1-2 sentences on the biggest design weaknesses","fixes":["specific, actionable design fix","..."]}`;

const REVISE_SYSTEM = `You are a senior interaction designer and front-end developer for VAHDAM India. You are given the CURRENT landing-page HTML and a design auditor's concrete fixes. Return ONE complete, production-ready HTML document from <!doctype html> to </html> that KEEPS every factual detail, offer, product, price and link exactly as-is, but ELEVATES the design by applying the fixes.

OUTPUT CONTRACT (unchanged): one self-contained HTML document. Inline CSS + a small inline JS block only. No external libraries, CDNs, Google Fonts, remote JS or frameworks. Must work by opening the file directly. No markdown fences, no commentary — HTML only.

BRAND TOKENS, EXACT (only these four colours, these fonts):
:root{--font-head:"LAO MN",Georgia,serif;--font-body:"Proxima Nova","Helvetica Neue",Arial,sans-serif;--vahdam-green:#004A2B;--vahdam-gold:#AB8743;--vahdam-ink:#171717;--vahdam-cream:#FBF5EA;}
DESIGN HARD RULES (never violate): NEVER use black, #171717, or any dark-neutral colour as a SECTION background — section backgrounds are cream or green. Enforce WCAG-AA contrast: no dark-on-dark, no light-on-light. Headings green on light / cream on dark; body ink on light / cream on dark. Equal-size, aligned parallel cards. One dominant primary CTA (green bg, cream text). Mobile-first at 360px, no horizontal overflow, >=44px tap targets. Respect prefers-reduced-motion.

Improve hierarchy, spacing rhythm, hero impact, card alignment and the conversion section order. Do not remove sections or invent facts. Return the full improved HTML now.`;

function withDeadline(promise, ms) {
  if (!(ms > 0)) return Promise.reject(new Error('deadline exceeded'));
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

function computeOverall(scored) {
  if (!scored || typeof scored !== 'object') return null;
  const s = scored.scores || {};
  const vals = DIMENSIONS.map((k) => Number(s[k])).filter((v) => Number.isFinite(v));
  if (vals.length < 4) return Number.isFinite(Number(scored.overall)) ? Number(scored.overall) : null;
  // Brand compliance is a gate: a hard fail there caps the overall regardless of the rest.
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const brand = Number(s.brand_compliance);
  return Number.isFinite(brand) && brand <= 3 ? Math.min(avg, brand + 1) : avg;
}

const validHtml = (h) => typeof h === 'string' && /<!doctype/i.test(h) && /<body/i.test(h) && /<\/html>\s*$/i.test(h.trim());

async function runDesignLoop({ html, brief = '', market = 'US', store = '', channel = 'landing', timeBoxMs = 45000, userGeminiKey = '', scrub } = {}) {
  const quality = { scored: false, score: null, revised: false, dims: null };
  const clean = (v) => { try { return scrub ? scrub(v) : String(v || ''); } catch (_) { return String(v || ''); } };
  if (!validHtml(html)) return { html, quality };
  const deadline = Date.now() + timeBoxMs;
  const remaining = () => deadline - Date.now();

  try {
    // ── 1. Score (fast tier, cheap) ─────────────────────────────────────────
    const scoreOut = await withDeadline(callLLM({
      systemPrompt: SCORE_SYSTEM,
      userMessage: (brief ? 'BRIEF:\n' + String(brief).slice(0, 1200) + '\n\n' : '') +
        'LANDING PAGE HTML:\n' + String(html).slice(0, 40000) + '\n\nScore all 6 dimensions now. Return the JSON.',
      responseFormat: { type: 'json_object' },
      maxTokens: 700, temperature: 0.15,
      timeoutMs: Math.min(20000, Math.max(1, remaining())),
      stage: 'lp-design-score', tier: 'fast', userGeminiKey,
    }), remaining());

    const scored = parseJSON(scoreOut && scoreOut.text);
    const overall = computeOverall(scored);
    if (overall === null) return { html, quality };
    quality.scored = true;
    quality.score = Math.round(overall * 10) / 10;
    quality.dims = (scored && scored.scores) || null;

    if (overall >= PASS_THRESHOLD) return { html, quality };
    if (remaining() < MIN_REVISE_BUDGET_MS) return { html, quality }; // not enough budget for a full-HTML revise

    // ── 2. ONE revision (premium tier), concrete fixes embedded ─────────────
    const fixes = Array.isArray(scored.fixes) ? scored.fixes.slice(0, 8).map((f) => '- ' + String(f)).join('\n') : '';
    const reviseOut = await withDeadline(callLLM({
      systemPrompt: REVISE_SYSTEM,
      userMessage: 'AUDITOR SCORES: ' + JSON.stringify(scored.scores || {}) + ' (overall ' + quality.score + '/10, pass ' + PASS_THRESHOLD + ')\n' +
        'AUDITOR CRITIQUE: ' + String(scored.critique || '').slice(0, 600) + '\n' +
        (fixes ? 'FIXES TO APPLY:\n' + fixes + '\n' : '') +
        'MARKET: ' + market + (store ? ' · store base ' + store : '') + ' · channel ' + channel + '\n\n' +
        'CURRENT HTML:\n' + String(html).slice(0, 60000) + '\n\nReturn the complete improved HTML now.',
      temperature: 0.5, maxTokens: 8000,
      timeoutMs: Math.max(1, remaining() - 1500),
      stage: 'lp-design-revise', tier: 'premium', userGeminiKey,
    }), remaining());

    let revised = clean(reviseOut && reviseOut.text);
    revised = String(revised).replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
    // Guard against truncation/garbage: must be a full doc AND not drastically shorter than the original.
    if (validHtml(revised) && revised.length >= Math.floor(String(html).length * 0.6)) {
      quality.revised = true;
      return { html: revised, quality };
    }
    return { html, quality };
  } catch (e) {
    console.warn('[lp-design-loop] skipped: ' + String((e && e.message) || e).slice(0, 160));
    return { html, quality };
  }
}

module.exports = { runDesignLoop, PASS_THRESHOLD };
