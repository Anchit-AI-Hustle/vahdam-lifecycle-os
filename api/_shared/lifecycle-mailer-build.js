'use strict';

/**
 * Lifecycle mailer builder — one calendar row → one brand-compliant mailer.
 *
 * Flow:
 *   row (from lifecycle-calendar-generate.js, by id or inline)
 *   → brief (cohort voice_guide + play mechanic + locked product facts from
 *     data/product-types.json + purchase-mode-correct CTA rules + brand gates)
 *   → ONE llm() call via llm.js — same JSON contract as calendar-trigger.js:
 *     { subject_line, preview_text, hero_headline, hero_subline, body_blocks[], cta_text }
 *   → sanitizeBrand()/assertNoBanned() from scenario-model.js on every LLM string
 *     (single shared banned list — no third copy)
 *   → HTML via renderTextVariant imported from calendar-trigger.js helpers
 *     (style is the play's template_style: pure|visual|editorial — NEVER founder)
 *   → optional hero creative via creative-image.js (silent skip on failure)
 *   → if Supabase is configured: persist into the row's mailer JSONB, status='built'.
 */

const llm = require('./llm.js');
const SM = require('./scenario-model.js');
const { helpers } = require('./calendar-trigger.js');
const { COHORTS, PLAYS, ALLOWED_TEMPLATE_STYLES, purchaseModeForProductType } = require('./lifecycle-cohorts.js');
const { loadProductTypes } = require('./lifecycle-calendar-generate.js');
const creative = require('./creative-image.js');

// ─── Brief builder ───────────────────────────────────────────────────────────

function productFactsBlock(productType) {
  const PT = loadProductTypes();
  if (productType === 'tb') {
    const lines = PT.types.tb.products.map((p) =>
      `- ${p.title} — £${p.price_gbp.toFixed(2)}${p.compare_at_gbp ? ` (compare-at £${p.compare_at_gbp.toFixed(2)}, a live store price — honest to cite)` : ''} — ${PT.store.base_url}/products/${p.handle}`);
    return [
      'PRODUCT FACTS — Teas & Botanicals (ONE-TIME PURCHASE ONLY — never use subscription language):',
      ...lines,
    ].join('\n');
  }
  if (productType === 'coffee') {
    const c = PT.types.coffee;
    return [
      'PRODUCT FACTS — Ashwagandha Coffee (SUBSCRIPTION IS THE PRIORITY CTA; one-time is the quiet secondary):',
      '- Pack of 1: £49.99 one-time / £29.99 subscription.',
      '- Pack of 3: £99.99 one-time / £59.99 subscription. B2G1 framing: £59.99 = 2 x £29.99 — buy two packs, the third is free.',
      `- 7 free gifts with EVERY order (both modes): ${c.gifts.join(', ')}.`,
      `- Subscription-only hook: gifts worth more than £${c.sub_gift_value_per_year_gbp} across the year, arriving with refills.`,
      `- Product URL: ${PT.store.base_url}/products/${c.handle} (handle is a best guess — do not invent others).`,
      '- These are the ONLY prices and offers that exist. NO new discount codes may be invented.',
    ].join('\n');
  }
  const s = PT.types.supplements;
  return [
    'PRODUCT FACTS — Supplements (just launched, zero buyers — "be among the first" is TRUE and allowed; SUBSCRIPTION IS THE PRIORITY CTA):',
    ...s.products.map((p) => `- ${p.title} — ${PT.store.base_url}/products/${p.handle}`),
    '- NO pricing was provided — NEVER state a price for supplements. CTA to the product page only.',
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
    "- Fonts are fixed by the template (Lao MN headings, Proxima Nova body) — do not reference fonts in copy.",
    '- BANNED phrases (any casing unless noted): "wellness journey", "transform", "liquid gold", "game-changer", "LIMITED TIME" in caps, "hurry", "don\'t miss out", "last chance", "while supplies last".',
    '- NO FOUNDER VOICE — no founder letters, no "from our founder/CEO", no personal-name sign-offs, no first-person-singular ("I") narration. The brand speaks as "we".',
    '- NO medical claims for ashwagandha/turmeric/supplements: no disease, stress-cure, cortisol, or weight-loss claims. Softest allowed register: "calm", "steady", "balance", "a gentler kind of energy".',
    '- No invented discounts or codes. Only the exact prices/mechanics in the product facts.',
    '- Voice: warm, sensory, story-driven. Preferred words: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted.',
    '- Exemplar sentence: "There is a moment when the right cup of tea does more than warm your hands."',
  ].join('\n');
}

function buildBrief(entry) {
  const cohort = COHORTS[entry.cohort_key] || { label: entry.cohort_label || entry.cohort_key, objective: '', voice_guide: '' };
  const play = PLAYS[entry.play_key] || { name: entry.play_key, mechanic: '', cta_framing_by_purchase_mode: {} };
  const purchaseMode = entry.purchase_mode || purchaseModeForProductType(entry.product_type);
  const ctaFraming = (play.cta_framing_by_purchase_mode || {})[purchaseMode] || '';

  return [
    `Campaign date: ${entry.date} · Market: ${entry.market || 'UK'} (store: vahdam.co.uk, currency GBP £)`,
    `Cohort: ${cohort.label}`,
    `Cohort objective: ${cohort.objective}`,
    `Cohort voice guide: ${cohort.voice_guide}`,
    '',
    `Play: ${play.name}`,
    `Play mechanic: ${play.mechanic}`,
    ctaFraming ? `Play CTA framing for this purchase mode: ${ctaFraming}` : null,
    entry.festival ? `Cultural moment: ${entry.festival} (weight ${entry.festival_weight}/10) — weave it in lightly.` : null,
    `Hero product: ${entry.hero_product}${entry.hero_price ? ` — ${entry.hero_price}` : ''}`,
    `Subject-line direction: ${entry.subject_hint || ''}`,
    '',
    productFactsBlock(entry.product_type),
    '',
    ctaRulesBlock(purchaseMode),
    '',
    brandGatesBlock(),
  ].filter(Boolean).join('\n');
}

// ─── LLM call (single call, same contract as calendar-trigger.js) ───────────

async function writeCopy(brief) {
  const out = await llm({
    systemPrompt:
      'You are VAHDAM\'s lifecycle copywriter. Produce a strict JSON object with keys: ' +
      'subject_line (string, ≤ 60 chars), preview_text (string, ≤ 90 chars), ' +
      'hero_headline (string, ≤ 8 words), hero_subline (string, ≤ 18 words), ' +
      'body_blocks (array of {heading, body}), cta_text (string, ≤ 4 words). ' +
      'Use VAHDAM brand voice (warm, sensory, story-driven). Obey every brand gate, ' +
      'CTA rule and product fact in the brief exactly — no invented prices, no banned phrases, ' +
      'no founder voice, no medical claims.',
    userMessage: brief,
    responseFormat: { type: 'json_object' },
    maxTokens: 3000,
    temperature: 0.7,
    timeoutMs: 40000,
    stage: 'lifecycle-mailer',
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

// ─── Optional hero creative (never blocks the mailer) ───────────────────────

async function heroCreative(entry) {
  // 1. Real catalog image (T&B heroes) — free, verified, deterministic.
  if (entry.hero_image) return { image: entry.hero_image, provider: 'catalog', brief: null };
  // 2. Visual-style slots try one generated hero; anything else ships typographic.
  if (entry.template_style !== 'visual') return null;
  const brief =
    `On-brand VAHDAM email hero for "${entry.hero_product}". Editorial product photography, ` +
    'single-estate provenance, elegant negative space, cinematic light. Brand palette only ' +
    '(forest #004A2B, gold #AB8743, cream #FBF5EA). Mood: warm, restrained. No on-image text.';
  try {
    const gen = await creative.generateCreativeImage(brief, { size: '1536x1024' });
    if (!gen || !gen.image) return null;
    const hosted = await creative.uploadCreative(gen.image, `lifecycle-${entry.id || 'slot'}`).catch(() => null);
    return { image: hosted || gen.image, provider: gen.provider || null, brief };
  } catch (_) { return null; }
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
  if (!row) throw new Error('entry not found — pass { entry } inline or an { id } that exists in lifecycle_calendar_entries');
  if (!row.cohort_key || !row.product_type) throw new Error('entry must include cohort_key and product_type (a row from lifecycle-generate)');

  // NO-FOUNDER hard gate: the founder render branch must never be reachable.
  let style = String(row.template_style || (PLAYS[row.play_key] && PLAYS[row.play_key].template_style) || 'editorial');
  if (!ALLOWED_TEMPLATE_STYLES.includes(style)) style = 'editorial';

  const PT = loadProductTypes();
  const ctaUrl = row.hero_handle
    ? `${PT.store.base_url}/products/${row.hero_handle}`
    : (row.product_type === 'coffee' && PT.types.coffee.collection_slug
        ? `${PT.store.base_url}/collections/${PT.types.coffee.collection_slug}`
        : PT.store.base_url);

  const brief = buildBrief(row);
  const { copy, provider, model } = await writeCopy(brief);
  const S = sanitizeCopy(copy, `lifecycle-mailer:${row.id || row.play_key}`);

  const html = helpers.renderTextVariant({
    style,
    subject: S.subject_line,
    hero_headline: S.hero_headline,
    hero_subline: S.hero_subline,
    body_blocks: S.body_blocks,
    cta_text: S.cta_text,
    cta_url: ctaUrl,
    market: row.market || 'UK',
    hero_product: row.hero_product,
  });

  const heroImage = await heroCreative(row);

  const mailer = {
    built_at: new Date().toISOString(),
    entry_id: row.id || null,
    cohort_key: row.cohort_key,
    play_key: row.play_key,
    template_style: style,
    purchase_mode: row.purchase_mode || purchaseModeForProductType(row.product_type),
    subject_line: S.subject_line,
    preview_text: S.preview_text,
    hero_headline: S.hero_headline,
    hero_subline: S.hero_subline,
    body_blocks: S.body_blocks,
    cta_text: S.cta_text,
    cta_url: ctaUrl,
    html,
    // Hero creative rides alongside the HTML (typographic templates stay
    // intact); paste it into Klaviyo where the product-shot slot is marked.
    creative: heroImage,
    generated_by: provider ? `${provider}${model ? `/${model}` : ''}` : null,
  };

  const persistence = await persistMailer(row.id, mailer);

  return { ok: true, id: row.id || null, entry: row, mailer, persisted: persistence.persisted, persistence };
}

module.exports = { buildLifecycleMailer, buildBrief, sanitizeCopy };
