'use strict';

/**
 * Lifecycle mailer builder - one calendar row → one brand-compliant mailer.
 *
 * Flow:
 *   row (from lifecycle-calendar-generate.js, by id or inline)
 *   → brief (cohort voice_guide + play mechanic + locked product facts from
 *     data/product-types.json + purchase-mode-correct CTA rules + brand gates)
 *   → ONE llm() call via llm.js - same JSON contract as calendar-trigger.js:
 *     { subject_line, preview_text, hero_headline, hero_subline, body_blocks[], cta_text }
 *   → sanitizeBrand()/assertNoBanned() from scenario-model.js on every LLM string
 *     (single shared banned list - no third copy)
 *   → HTML via renderTextVariant imported from calendar-trigger.js helpers
 *     (style is the play's template_style: pure|visual|editorial - NEVER founder)
 *   → optional hero creative via creative-image.js (silent skip on failure)
 *   → if Supabase is configured: persist into the row's mailer JSONB, status='built'.
 */

const llm = require('./llm.js');
const SM = require('./scenario-model.js');
const { helpers } = require('./calendar-trigger.js');
const { COHORTS, PLAYS, ALLOWED_TEMPLATE_STYLES, purchaseModeForProductType } = require('./lifecycle-cohorts.js');
const { loadProductTypes } = require('./lifecycle-calendar-generate.js');
const CF = require('./copy-frameworks.js');

// ─── Brief builder ───────────────────────────────────────────────────────────

function productFactsBlock(productType) {
  const PT = loadProductTypes();
  if (productType === 'tb') {
    const lines = PT.types.tb.products.map((p) =>
      `- ${p.title} - £${p.price_gbp.toFixed(2)}${p.compare_at_gbp ? ` (compare-at £${p.compare_at_gbp.toFixed(2)}, a live store price - honest to cite)` : ''} - ${PT.store.base_url}/products/${p.handle}`);
    return [
      'PRODUCT FACTS - Teas & Botanicals (ONE-TIME PURCHASE ONLY - never use subscription language):',
      ...lines,
    ].join('\n');
  }
  if (productType === 'coffee') {
    const c = PT.types.coffee;
    return [
      'PRODUCT FACTS - Ashwagandha Coffee (SUBSCRIPTION IS THE PRIORITY CTA; one-time is the quiet secondary):',
      '- Pack of 1: £49.99 one-time / £29.99 subscription.',
      '- Pack of 3: £99.99 one-time / £59.99 subscription. B2G1 framing: £59.99 = 2 x £29.99 - buy two packs, the third is free.',
      `- 7 free gifts with EVERY order (both modes): ${c.gifts.join(', ')}.`,
      `- Subscription-only hook: gifts worth more than £${c.sub_gift_value_per_year_gbp} across the year, arriving with refills.`,
      `- Product URL: ${PT.store.base_url}/products/${c.handle} (handle is a best guess - do not invent others).`,
      '- These are the ONLY prices and offers that exist. NO new discount codes may be invented.',
    ].join('\n');
  }
  const s = PT.types.supplements;
  return [
    'PRODUCT FACTS - Supplements (just launched, zero buyers - "be among the first" is TRUE and allowed; SUBSCRIPTION IS THE PRIORITY CTA):',
    ...s.products.map((p) => `- ${p.title} - ${PT.store.base_url}/products/${p.handle}`),
    '- NO pricing was provided - NEVER state a price for supplements. CTA to the product page only.',
  ].join('\n');
}

function ctaRulesBlock(purchaseMode) {
  if (purchaseMode === 'one_time_only') {
    return 'CTA RULES: This product is ONE-TIME purchase only. The CTA must be a simple purchase/replenishment invitation. Do NOT use the words subscribe, subscription, refill plan, or any recurring-purchase framing anywhere in the email.';
  }
  return 'CTA RULES: This product is SUBSCRIPTION-PRIORITY. The primary CTA must be to subscribe; a one-time purchase may only be mentioned as a quiet secondary option, never the headline.';
}

function brandGatesBlock() {
  return [
    'BRAND GATES (hard fail if violated):',
    '- Palette: only forest green #004A2B, gold #AB8743, near-black #171717, cream #FBF5EA. Never mention other colors.',
    "- Fonts are fixed by the template (Lao MN headings, Proxima Nova body) - do not reference fonts in copy.",
    '- BANNED phrases (any casing unless noted): "wellness journey", "transform", "liquid gold", "game-changer", "LIMITED TIME" in caps, "hurry", "don\'t miss out", "last chance", "while supplies last".',
    '- NO FOUNDER VOICE - no founder letters, no "from our founder/CEO", no personal-name sign-offs, no first-person-singular ("I") narration. The brand speaks as "we".',
    '- NO medical claims for ashwagandha/turmeric/supplements: no disease, stress-cure, cortisol, or weight-loss claims. Softest allowed register: "calm", "steady", "balance", "a gentler kind of energy".',
    '- No invented discounts or codes. Only the exact prices/mechanics in the product facts.',
    '- Voice: warm, sensory, story-driven. Preferred words: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted.',
    '- Exemplar sentence: "There is a moment when the right cup of tea does more than warm your hands."',
  ].join('\n');
}

function buildBrief(entry, fw) {
  const cohort = COHORTS[entry.cohort_key] || { label: entry.cohort_label || entry.cohort_key, objective: '', voice_guide: '' };
  const play = PLAYS[entry.play_key] || { name: entry.play_key, mechanic: '', cta_framing_by_purchase_mode: {} };
  const purchaseMode = entry.purchase_mode || purchaseModeForProductType(entry.product_type);
  const ctaFraming = (play.cta_framing_by_purchase_mode || {})[purchaseMode] || '';
  const framework = fw || CF.pickCopyFramework({ framework: entry.framework, play_key: entry.play_key, cohort_key: entry.cohort_key, seed: entry.id || entry.date });

  return [
    `Campaign date: ${entry.date} · Market: ${entry.market || 'UK'} (store: vahdam.co.uk, currency GBP £)`,
    `Cohort: ${cohort.label}`,
    `Cohort objective: ${cohort.objective}`,
    `Cohort voice guide: ${cohort.voice_guide}`,
    '',
    `Play: ${play.name}`,
    `Play mechanic: ${play.mechanic}`,
    ctaFraming ? `Play CTA framing for this purchase mode: ${ctaFraming}` : null,
    entry.festival ? `Cultural moment: ${entry.festival} (weight ${entry.festival_weight}/10) - weave it in lightly.` : null,
    `Hero product: ${entry.hero_product}${entry.hero_price ? ` - ${entry.hero_price}` : ''}`,
    `Subject-line direction: ${entry.subject_hint || ''}`,
    '',
    CF.strategyBriefBlock(entry.cohort_key),
    '',
    productFactsBlock(entry.product_type),
    '',
    ctaRulesBlock(purchaseMode),
    '',
    CF.copyFrameworkBriefBlock(framework),
    '',
    brandGatesBlock(),
  ].filter(Boolean).join('\n');
}

// ─── LLM call (single call, same contract as calendar-trigger.js) ───────────

async function writeCopy(brief, frameworkLine) {
  const out = await llm({
    systemPrompt:
      'You are VAHDAM\'s lifecycle copywriter. Produce a strict JSON object with keys: ' +
      'subject_line (string, ≤ 60 chars), preview_text (string, ≤ 90 chars), ' +
      'hero_headline (string, ≤ 8 words), hero_subline (string, ≤ 18 words), ' +
      'body_blocks (array of {heading, body}), cta_text (string, ≤ 4 words). ' +
      'Use VAHDAM brand voice (warm, sensory, story-driven). ' +
      (frameworkLine ? frameworkLine + ' ' : '') +
      'Obey every brand gate, ' +
      'CTA rule and product fact in the brief exactly - no invented prices, no banned phrases, ' +
      'no founder voice, no medical claims.',
    userMessage: brief,
    responseFormat: { type: 'json_object' },
    maxTokens: 3000,
    temperature: 0.7,
    timeoutMs: 40000,
    stage: 'lifecycle-mailer',
    tier: 'premium', // single mode: lifecycle mailer copy always runs premium
  });
  const json = (llm.parseJSON ? llm.parseJSON(out.text) : JSON.parse(out.text));
  if (!json || !json.subject_line || !json.hero_headline) throw new Error('LLM copy JSON incomplete');
  return { copy: json, provider: out.provider || null, model: out.model || null };
}

// Sanitize every LLM-authored string through the shared brand scrub, then
// tripwire-assert nothing banned survived (scenario-model owns the one list).
function sanitizeCopy(copy, where) {
  const clean = {
    subject_line: SM.sanitizeBrand(copy.subject_line),
    preview_text: SM.sanitizeBrand(copy.preview_text || ''),
    hero_headline: SM.sanitizeBrand(copy.hero_headline),
    hero_subline: SM.sanitizeBrand(copy.hero_subline || ''),
    cta_text: SM.sanitizeBrand(copy.cta_text || 'See the collection'),
    body_blocks: (Array.isArray(copy.body_blocks) ? copy.body_blocks : []).map((b) => ({
      heading: SM.sanitizeBrand(b && b.heading ? b.heading : ''),
      body: SM.sanitizeBrand(b && b.body ? b.body : ''),
    })),
  };
  const flat = [clean.subject_line, clean.preview_text, clean.hero_headline, clean.hero_subline, clean.cta_text]
    .concat(clean.body_blocks.map((b) => `${b.heading} ${b.body}`)).join(' ');
  SM.assertNoBanned(flat, where);
  return clean;
}

// ─── Hero image resolution - CORRECT IMAGES ONLY ────────────────────────────
// We never ship an AI-generated hero (those can render garbled text/artifacts).
// Text + Visual variants use the REAL catalog product image when the slot has
// one; otherwise a clean, on-brand PLACEHOLDER of the ideal size that the user
// drops a real image URL into (the exact prompt to generate one rides in the
// variant metadata). This guarantees every shipped image is correct.

function placeholderImage(label, w, h) {
  const t = String(label || 'Product image').replace(/[<&>]/g, ' ').slice(0, 42);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="100%" height="100%" fill="#FBF5EA"/>` +
    `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" fill="none" stroke="#AB8743" stroke-width="2" stroke-dasharray="9 7"/>` +
    `<text x="50%" y="45%" text-anchor="middle" fill="#004A2B" font-family="Georgia,serif" font-size="21">${t}</text>` +
    `<text x="50%" y="59%" text-anchor="middle" fill="#AB8743" font-family="Arial,Helvetica,sans-serif" font-size="13">Drop your image URL here · ${w} x ${h}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function resolveHero(entry, w, h) {
  if (entry.hero_image) {
    return { url: entry.hero_image, mode: 'catalog', size: `${w}x${h}`, prompt: null };
  }
  const prompt =
    `On-brand VAHDAM email hero for "${entry.hero_product || entry.product_type}". Editorial product ` +
    `photography, single-estate provenance, elegant negative space, warm cinematic light. Brand palette ` +
    `only (forest #004A2B, gold #AB8743, cream #FBF5EA). No text on the image. Ideal size ${w} x ${h}.`;
  return { url: placeholderImage(entry.hero_product || 'Product image', w, h), mode: 'placeholder', size: `${w}x${h}`, prompt };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function supaIfConfigured() {
  try {
    const supa = require('./supa.js');
    supa.env();
    return supa;
  } catch (_) { return null; }
}

async function loadEntryById(id) {
  const supa = supaIfConfigured();
  if (!supa) return null;
  const rows = await supa.select('lifecycle_calendar_entries', { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
  const row = rows && rows[0];
  return row ? (row.payload || null) : null;
}

async function persistMailer(id, mailer) {
  const supa = supaIfConfigured();
  if (!supa || !id) return { persisted: false, reason: supa ? 'no_entry_id' : 'supabase_not_configured' };
  try {
    await supa.update('lifecycle_calendar_entries',
      { mailer, status: 'built', generated_by: mailer.generated_by || null, updated_at: new Date().toISOString() },
      { id: `eq.${id}` });
    return { persisted: true };
  } catch (e) {
    console.warn('[lifecycle-mailer] persistence failed (mailer still returned):', e.message);
    return { persisted: false, reason: e.message };
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

async function buildLifecycleMailer({ id = null, entry = null } = {}) {
  let row = entry;
  if (!row && id) row = await loadEntryById(id);
  if (!row) throw new Error('entry not found - pass { entry } inline or an { id } that exists in lifecycle_calendar_entries');
  if (!row.cohort_key || !row.product_type) throw new Error('entry must include cohort_key and product_type (a row from lifecycle-generate)');

  const PT = loadProductTypes();
  const ctaUrl = row.hero_handle
    ? `${PT.store.base_url}/products/${row.hero_handle}`
    : (row.product_type === 'coffee' && PT.types.coffee.collection_slug
        ? `${PT.store.base_url}/collections/${PT.types.coffee.collection_slug}`
        : PT.store.base_url);

  // Two diverging framework angles → two premium copy sets, generated in
  // parallel (same wall-clock as one call). A = the play's preferred framework;
  // B = a deterministically-chosen different one, so the two directions read
  // genuinely differently rather than being the same copy in two skins.
  const fwA = CF.pickCopyFramework({ framework: row.framework, play_key: row.play_key, cohort_key: row.cohort_key, seed: row.id || row.date });
  const otherKeys = Object.keys(CF.COPY_FRAMEWORKS).filter((k) => k !== fwA.key);
  const fwB = CF.frameworkByKey(otherKeys[CF.stableIndex(`${row.id || row.date}|b`, otherKeys.length)]) || fwA;

  // Partial-failure tolerant: if one premium copy call fails we still ship with
  // the one that succeeded (both diverge only by framework). Fail only if BOTH
  // reject.
  const [pA, pB] = await Promise.allSettled([
    writeCopy(buildBrief(row, fwA), CF.copyFrameworkSystemLine(fwA)),
    writeCopy(buildBrief(row, fwB), CF.copyFrameworkSystemLine(fwB)),
  ]);
  if (pA.status !== 'fulfilled' && pB.status !== 'fulfilled') {
    throw new Error('mailer copy generation failed for both variants: ' + String((pA.reason && pA.reason.message) || pA.reason));
  }
  const rA = pA.status === 'fulfilled' ? pA.value : pB.value;
  const rB = pB.status === 'fulfilled' ? pB.value : pA.value;
  const SA = sanitizeCopy(rA.copy, `lifecycle-mailer:${row.id || row.play_key}:a`);
  const SB = sanitizeCopy(rB.copy, `lifecycle-mailer:${row.id || row.play_key}:b`);

  // Real catalog image if the slot has one; else a clean placeholder to fill.
  const hero = resolveHero(row, 536, 340);

  const market = row.market || 'UK';
  const meta = (S) => ({
    subject_line: S.subject_line, preview_text: S.preview_text,
    hero_headline: S.hero_headline, hero_subline: S.hero_subline, cta_text: S.cta_text,
  });
  const render = (S, style, opts = {}) => helpers.renderTextVariant({
    style, subject: S.subject_line, preheader: S.preview_text,
    hero_headline: S.hero_headline, hero_subline: S.hero_subline,
    body_blocks: S.body_blocks, cta_text: S.cta_text, cta_url: ctaUrl, market,
    hero_product: row.hero_product, ...opts,
  });

  // Only a REAL catalog photo is embedded as a live <img>. When the slot has no
  // catalog image we pass the generation prompt so the renderer emits the
  // gold-standard IMAGE GENERATION PROMPT comment + PASTE_IMAGE_URL_HERE slot,
  // which the asset agent (asset-agent.js) later fills with a generated image.
  const heroImg = hero.mode === 'catalog' ? hero.url : null;

  // Exactly the two named mailer types, two variants each (mailer taxonomy):
  //   Text          = colour + type + structural elements (buttons, tables,
  //                   dividers, badges), NO images / video / gif.
  //   Text + Visual = the same, plus a hero image (real catalog or a fillable slot).
  const variants = [
    { key: 'text_a',   type: 'Text',          label: `Text · ${fwA.name}`,          framework: fwA.key, image: null, ...meta(SA), html: render(SA, 'pure') },
    { key: 'text_b',   type: 'Text',          label: `Text · ${fwB.name}`,          framework: fwB.key, image: null, ...meta(SB), html: render(SB, 'editorial') },
    { key: 'visual_a', type: 'Text + Visual', label: `Text + Visual · ${fwA.name}`, framework: fwA.key, image: hero, ...meta(SA), html: render(SA, 'visual', { hero_image_url: heroImg, hero_prompt: hero.prompt }) },
    { key: 'visual_b', type: 'Text + Visual', label: `Text + Visual · ${fwB.name}`, framework: fwB.key, image: hero, ...meta(SB), html: render(SB, 'visual', { hero_image_url: heroImg, hero_prompt: hero.prompt }) },
  ];

  const primary = variants[2]; // visual_a, for backward-compatible top-level fields
  const provider = rA.provider || rB.provider || null;
  const model = rA.model || rB.model || null;

  const mailer = {
    built_at: new Date().toISOString(),
    entry_id: row.id || null,
    cohort_key: row.cohort_key,
    play_key: row.play_key,
    frameworks: [fwA.key, fwB.key],
    purchase_mode: row.purchase_mode || purchaseModeForProductType(row.product_type),
    // Backward-compatible top-level fields mirror the primary (visual A) variant.
    subject_line: primary.subject_line,
    preview_text: primary.preview_text,
    hero_headline: primary.hero_headline,
    hero_subline: primary.hero_subline,
    cta_text: primary.cta_text,
    cta_url: ctaUrl,
    html: primary.html,
    image: hero,
    // The four deliverables: 2 Text + 2 Text + Visual.
    variants,
    generated_by: provider ? `${provider}${model ? `/${model}` : ''}` : null,
  };

  const persistence = await persistMailer(row.id, mailer);

  return { ok: true, id: row.id || null, entry: row, mailer, variants, persisted: persistence.persisted, persistence };
}

module.exports = { buildLifecycleMailer, buildBrief, sanitizeCopy };
