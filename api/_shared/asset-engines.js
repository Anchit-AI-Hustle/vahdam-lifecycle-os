'use strict';

/**
 * asset-engines.js — ONE ENGINE PER ASSET TYPE.
 *
 * THE DEFECT THIS CLOSES
 * ----------------------
 * A mailer, a Google RSA, a TikTok cover, a presell landing page and an
 * Instagram post are five different design problems. They were being generated
 * as five slots of ONE JSON object, from ONE prompt, at ONE temperature, and
 * rendered by ONE hardcoded template each — so nothing in the pipeline knew
 * that a Google headline dies at 30 characters, that an organic caption must
 * NOT carry baked-in text, that a landing page's whole job is to repeat the
 * ad's promise in the ad's own words, or that a video ad has to move inside
 * 0.8 seconds. The rich per-asset contracts already written in
 * `master-prompt.js` were attached to the output as a `master_prompt` for a
 * human to paste elsewhere; the model that actually wrote the shipped copy
 * never saw them.
 *
 * The mailer was the one exception: `mailer-design-strategy.js` picks a real
 * archetype per slot, which drives both the section order and the copy angle.
 * That is exactly the right shape, and it existed for one asset out of nine.
 * This module gives every asset type the same treatment.
 *
 * WHAT AN ENGINE OWNS
 * -------------------
 *   spec      the platform's own dimensions and copy limits — READ FROM
 *             asset-specs.js, never re-typed (see "one source" below)
 *   design()  the layout algorithm: which structure THIS slot gets, and why
 *   contract() the generation directive written for THIS asset alone
 *   params    its own model settings (a 15-headline RSA sweep and a
 *             story-driven email are not the same generation problem)
 *   qa()      its own deterministic validator
 *
 * THREE RULES THAT MAKE IT HOLD
 * -----------------------------
 * 1. ONE SOURCE FOR EVERY LIMIT. Every character cap here is read from
 *    `asset-specs.js`. `ads-qa.js` had grown its own `LIMITS` map and the
 *    banned-phrase regex existed in three files; that is the same drift that
 *    made nine hand-written copies of the market-URL map, four of them wrong
 *    (see CLAUDE.md). A limit that lives in two places is enforced in one.
 *
 * 2. THE DESIGN CHOICE IS DETERMINISTIC AND SEEDED, NOT RANDOM. The same slot
 *    must always produce the same design — otherwise a re-run silently changes
 *    an approved asset, and the reviewer approved something that no longer
 *    exists. The seed mixes the slot identity so two adjacent cohorts on the
 *    same day do not both get archetype #1 and make the whole calendar look
 *    like one template. `Math.random()` would break both properties.
 *
 * 3. QA REPORTS, IT NEVER SILENTLY REPAIRS. A headline three characters over
 *    the Google cap is a copy problem; truncating it mid-word ships a broken
 *    ad that reads as finished. The only mutations here are the ones with a
 *    single correct answer (trimming whitespace). Everything else is reported
 *    with a severity and the exact measured value, in the same idiom the rest
 *    of the repo uses for a blocked build.
 */

const specs = require('./asset-specs.js');
const SM = require('./scenario-model.js');

let mailerDesign = null;
try { mailerDesign = require('./mailer-design-strategy.js'); } catch (_) { mailerDesign = null; }

// ── Shared rule primitives ──────────────────────────────────────────────────
// The banned-phrase list comes from scenario-model, which is where the brand
// scrubber already lives; ads-qa reads the same export. Three copies existed.
const BANNED = SM.BANNED_PHRASES_RX;
const DASH = /[–—]/;                      // en / em dash: brand forbids both
// An offer we cannot verify. There is no approved-offer library in the repo
// yet (CLAUDE.md lists it as a launch dependency), so ANY specific offer in
// generated copy is fabricated by definition, not merely unverified.
const OFFER = /\b\d{1,3}\s?%\s?off\b|\bcode[:\s]|\bpromo\b|\bcoupon\b|\bBOGO\b|\bmoney[\s-]?back\b|\bguarantee\b|\blowest price\b/i;
// Words in an image brief that ask a diffusion model to render letterforms.
// Diffusion models cannot spell; a brief that asks for text produces garbled
// glyphs that read as an obvious fake, which is why organic creatives are
// text-free and ad overlays are composited rather than painted.
const ASKS_FOR_TEXT = /\b(text|headline|caption|word|words|logo|typography|lettering|label reading|sign reading|price tag|overlay)\b/i;

const CRIT = 'critical';
const WARN = 'warn';

// ── Deterministic slot seed ─────────────────────────────────────────────────
// FNV-1a over the slot identity, then a murmur3 finalizer. Stable across
// processes and deploys, which is what makes "the same slot always renders the
// same design" true in a serverless environment where nothing is cached
// between invocations.
//
// The finalizer is load-bearing, not decoration. FNV-1a's LOW bits are weak:
// `h mod 4` depends only on the low bits of the input bytes, so hashing the
// same slot with two different salts produced two indices separated by a
// CONSTANT offset. Every ad format was therefore paired with the same social
// angle on every slot in the calendar - 4 distinct combinations out of 16,
// which is lockstep dressed up as variety. fmix32 avalanches the high bits
// down, and the pairing spreads across the full product.
function seed(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  // murmur3 fmix32
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
function slotKey(ctx = {}) {
  return [ctx.id, ctx.date, ctx.market, ctx.cohort && (ctx.cohort.key || ctx.cohort.name), ctx.objective]
    .filter(Boolean).join('|') || 'default';
}
// Pick from an ordered list by seed. `salt` separates the choices made by
// different engines for the SAME slot — without it a landing page and an ad on
// the same slot would always land on the same index of their own lists, which
// couples two decisions that have nothing to do with each other.
function pickBySeed(list, ctx, salt) {
  if (!list.length) return null;
  return list[seed(slotKey(ctx) + '#' + salt) % list.length];
}

// ── Measurement helpers ─────────────────────────────────────────────────────
const str = (v) => (v == null ? '' : String(v));
const len = (v) => str(v).trim().length;

function checkText(issues, label, value, max, sev = CRIT) {
  const n = len(value);
  if (!n) return;
  if (max && n > max) issues.push({ sev, field: label, msg: `${label} is ${n} chars, over the ${max}-char platform limit`, measured: n, limit: max });
}
function checkBrandVoice(issues, label, value) {
  const v = str(value);
  if (!v) return;
  if (BANNED.test(v)) issues.push({ sev: CRIT, field: label, msg: `${label} contains a banned phrase` });
  if (DASH.test(v)) issues.push({ sev: CRIT, field: label, msg: `${label} contains an en/em dash (brand forbids both)` });
}
function checkNoInventedOffer(issues, label, value) {
  const v = str(value);
  if (v && OFFER.test(v)) {
    issues.push({ sev: CRIT, field: label, msg: `${label} states an offer or guarantee, and there is no approved offer library to verify it against`, data_required: '[DATA REQUIRED BEFORE LAUNCH: approved offer/claims library]' });
  }
}
function checkRequired(issues, obj, fields, sev = CRIT) {
  for (const f of fields) if (!len(obj && obj[f])) issues.push({ sev, field: f, msg: `${f} is empty` });
}
// Every asset's copy goes through the same brand pass. Kept separate from the
// per-asset checks so an engine cannot forget it.
function brandPass(issues, obj, fields) {
  for (const f of fields) { checkBrandVoice(issues, f, obj && obj[f]); }
}

// ════════════════════════════════════════════════════════════════════════════
// ENGINE: EMAIL MAILER
// ════════════════════════════════════════════════════════════════════════════
// The design algorithm already exists (mailer-design-strategy.js, 7 archetypes
// chosen from cohort + objective). This engine does NOT re-implement it — it
// delegates, so there is still one mailer design algorithm, and adds the
// structure contract and the deterministic QA the mailer never had. The
// existing quality-loop.js is an LLM critic on the /api/ai mailer_full path
// only; it does not run on the Smart Brain path and it cannot count characters.
const mailerEngine = {
  id: 'mailer',
  label: 'Email mailer',
  channel: 'email',
  media: 'html',
  // Subject/preheader caps are inbox truncation points, not hard limits: over
  // them the copy still sends, it just gets cut in the list view. Warn, do not
  // block. Everything below is a real structural requirement.
  limits: { subject: 50, preheader: 90 },
  required: ['subject', 'preheader', 'hero_headline', 'intro_paragraph', 'cta'],
  params: { temperature: 0.75, maxTokens: 1800 },

  design(ctx = {}) {
    const fallback = { key: 'hero-spotlight', label: 'Hero spotlight', order: ['heroEditorial', 'bodyStory', 'productGrid'], influencerAngle: '' };
    let s = fallback;
    if (mailerDesign && typeof mailerDesign.strategyFor === 'function') {
      try { s = mailerDesign.strategyFor(ctx) || fallback; } catch (_) { s = fallback; }
    }
    return {
      archetype: s.key || s.archetypeKey || 'hero-spotlight',
      label: s.label || 'Hero spotlight',
      order: s.order || fallback.order,
      angle: s.influencerAngle || '',
      spec: specs.mailerSpecText(),
      why: 'Mailer layout comes from mailer-design-strategy.js so there is one mailer design algorithm, not two.',
    };
  },

  contract(ctx = {}) {
    const d = this.design(ctx);
    return [
      `EMAIL MAILER (${d.label}). Sections in THIS order: ${d.order.join(' -> ')}.`,
      d.angle,
      `Subject <=${this.limits.subject} chars so it survives the inbox list view; preheader <=${this.limits.preheader} and it must NOT repeat the subject.`,
      'Write for images-off: a large share of opens suppress images, so the case must land with every image gone. Alt text carries meaning, never "hero image".',
      d.spec,
    ].filter(Boolean).join('\n');
  },

  qa(asset = {}, ctx = {}) {
    const issues = [];
    checkRequired(issues, asset, this.required);
    checkText(issues, 'subject', asset.subject, this.limits.subject, WARN);
    checkText(issues, 'preheader', asset.preheader, this.limits.preheader, WARN);
    brandPass(issues, asset, ['subject', 'preheader', 'hero_headline', 'intro_paragraph', 'body_paragraph', 'cta']);
    // A preheader that repeats the subject wastes the second line of inbox real
    // estate — the single most common template mistake in email.
    if (len(asset.subject) && str(asset.preheader).trim().toLowerCase() === str(asset.subject).trim().toLowerCase()) {
      issues.push({ sev: WARN, field: 'preheader', msg: 'preheader duplicates the subject, wasting the second inbox line' });
    }
    if (asset.image_brief && ASKS_FOR_TEXT.test(str(asset.image_brief))) {
      issues.push({ sev: WARN, field: 'image_brief', msg: 'image_brief asks for rendered text; diffusion models cannot spell, so this returns garbled letterforms' });
    }
    return finish(this, issues);
  },
};

// ════════════════════════════════════════════════════════════════════════════
// ENGINE: PAID AD (one instance per platform)
// ════════════════════════════════════════════════════════════════════════════
// Per-platform because the deliverable genuinely differs: Meta wants one
// primary text plus a headline, Google wants a SWEEP of short headlines the
// system recombines, TikTok wants a script whose hook lands in the first two
// seconds. Treating them as one "ad" is what produced Google headlines written
// at Meta length.
function adEngine(platform) {
  const p = specs.ADS[platform] ? platform : 'meta';
  const copy = specs.ADS[p].copy || {};
  const produced = (specs.ADS[p].placements || []).filter((x) => x.produced);

  return {
    id: 'ad_' + p,
    label: specs.ADS[p].label,
    channel: 'paid',
    platform: p,
    media: 'image',
    limits: copy,
    placements: produced,
    // Ad copy is a constrained-length problem, not a prose problem: a lower
    // temperature keeps the model inside the character budget instead of
    // writing something lovely and 20 chars too long.
    params: { temperature: 0.6, maxTokens: 1200 },

    design(ctx = {}) {
      // Proven, replicable D2C formats — the P01 mandate is explicitly
      // "curate, don't invent" (CLAUDE.md), so the list is short and known.
      const formats = [
        { key: 'ugc-testimonial', label: 'UGC testimonial', beats: ['real-person moment', 'the promise in her words', 'product in hand', 'CTA'] },
        { key: 'before-after', label: 'Split-screen before/after', beats: ['the chaos', 'the calm', 'product as the hinge', 'CTA'] },
        { key: 'day-in-the-life', label: 'Day in the life', beats: ['6am reality', 'the ritual', 'how the day goes instead', 'CTA'] },
        { key: 'product-hero', label: 'Product hero', beats: ['single-source light on the real SKU', 'the promise', 'one reason to believe', 'CTA'] },
      ];
      const f = pickBySeed(formats, ctx, 'ad:' + p);
      return {
        archetype: f.key,
        label: f.label,
        order: f.beats,
        spec: specs.adSpecText(p, { onlyProduced: true }),
        // 1:1, 4:5 and 9:16 are three compositions, not three crops of one.
        compositions: produced.map((x) => `${x.key} ${x.size} (${x.ratio})${x.safe ? ' safe: ' + x.safe : ''}`),
        why: 'Format is picked deterministically per slot so a calendar of ads is varied without any single ad being a novel experiment.',
      };
    },

    contract(ctx = {}) {
      const d = this.design(ctx);
      const fields = p === 'google'
        ? `Deliver ${copy.headlines ? copy.headlines.count : 15} headlines (<=${copy.headlines ? copy.headlines.max : 30} chars EACH, and they must be genuinely different angles, not one line reworded) and ${copy.descriptions ? copy.descriptions.count : 4} descriptions (<=${copy.descriptions ? copy.descriptions.max : 90}). Google recombines them, so any two that say the same thing waste a slot.`
        : p === 'tiktok'
          ? `Deliver a native-feeling script whose hook lands inside ${copy.scriptHookSec || 2}s, on-screen text beats, and a caption <=${copy.caption || 100} chars with <=${copy.hashtags || 5} hashtags.`
          : `Deliver primary text <=${copy.primaryText || 125} chars (it truncates there, so the promise must be complete before the cut), headline <=${copy.headline || 40}, description <=${copy.description || 30}.`;
      return [
        `PAID AD, ${this.label}. Format for this slot: ${d.label}, beats: ${d.order.join(' -> ')}.`,
        fields,
        `Produced sizes are separate COMPOSITIONS, not crops: ${d.compositions.join(' | ')}.`,
        'Sell the emotional end-state, never the ingredient. No invented offer, code, percentage, guarantee or price: there is no approved offer library to verify one against.',
      ].join('\n');
    },

    qa(asset = {}, ctx = {}) {
      const issues = [];
      if (p === 'google') {
        const heads = (asset.headlines || []).filter(Boolean);
        const descs = (asset.descriptions || []).filter(Boolean);
        if (!heads.length) issues.push({ sev: CRIT, field: 'headlines', msg: 'no headlines' });
        if (!descs.length) issues.push({ sev: CRIT, field: 'descriptions', msg: 'no descriptions' });
        heads.forEach((h, i) => { checkText(issues, `headlines[${i}]`, h, copy.headlines && copy.headlines.max); checkBrandVoice(issues, `headlines[${i}]`, h); checkNoInventedOffer(issues, `headlines[${i}]`, h); });
        descs.forEach((d, i) => { checkText(issues, `descriptions[${i}]`, d, copy.descriptions && copy.descriptions.max); checkBrandVoice(issues, `descriptions[${i}]`, d); checkNoInventedOffer(issues, `descriptions[${i}]`, d); });
        // Responsive Search Ads only work if the pool is genuinely varied; a
        // pool of near-duplicates is why an RSA underperforms a manual ad.
        const uniq = new Set(heads.map((h) => str(h).trim().toLowerCase()));
        if (heads.length && uniq.size < heads.length) issues.push({ sev: WARN, field: 'headlines', msg: `${heads.length - uniq.size} duplicate headline(s): Google recombines them, so duplicates waste slots` });
      } else if (p === 'tiktok') {
        checkRequired(issues, asset, ['caption']);
        checkText(issues, 'caption', asset.caption, copy.caption);
        brandPass(issues, asset, ['caption', 'script']);
        checkNoInventedOffer(issues, 'caption', asset.caption);
        if (asset.creative_type === 'video' && !len(asset.script)) issues.push({ sev: CRIT, field: 'script', msg: 'video ad has no script' });
        // `script` on a static ad is the exact defect ads-qa already flags: the
        // static compositor has nowhere to put it, so it ships as a text block.
        if (asset.creative_type === 'static' && len(asset.script)) issues.push({ sev: CRIT, field: 'script', msg: 'static ad carries a video script field' });
      } else {
        checkRequired(issues, asset, ['primary_text', 'headline']);
        checkText(issues, 'primary_text', asset.primary_text, copy.primaryText);
        checkText(issues, 'headline', asset.headline, copy.headline);
        checkText(issues, 'description', asset.description, copy.description);
        brandPass(issues, asset, ['primary_text', 'headline', 'description']);
        ['primary_text', 'headline', 'description'].forEach((f) => checkNoInventedOffer(issues, f, asset[f]));
      }
      if (!len(asset.image_brief) && !len(asset.creative_brief)) {
        issues.push({ sev: CRIT, field: 'image_brief', msg: 'ad has no creative brief, so it would render as text only' });
      }
      return finish(this, issues);
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ENGINE: LANDING PAGE
// ════════════════════════════════════════════════════════════════════════════
// Every generated page came out of ONE hardcoded section order (hero, why,
// product, proof, FAQ) regardless of who it was for or what the click promised
// — the same defect the mailer had before it got archetypes. A winback page and
// a first-purchase presell are not the same page.
const landingEngine = {
  id: 'landing_page',
  label: 'Landing page',
  channel: 'web',
  media: 'html',
  limits: { seo_title: 60, meta_description: 160 },
  required: ['hero_headline', 'hero_sub', 'cta'],
  params: { temperature: 0.7, maxTokens: 2200 },

  // Which copy key each section renders from. A section whose key the model did
  // not fill is OMITTED by the renderer, never padded with invented content: a
  // missing section is reviewable, a fabricated one is not.
  sectionCopy: {
    hero: 'hero_headline', why: 'why_bullets', product: null, proof: 'proof_quote',
    faq: 'faq', guarantee: null, cta: 'cta',
    problem: 'problem', mechanism: 'mechanism', steps: 'steps',
    comparison: 'comparison', picks: 'picks',
  },

  // Each archetype is a real page shape with a reason it exists, not a shuffle
  // of the same blocks. `order` is the section sequence the renderer follows.
  archetypes: [
    { key: 'presell-narrative', label: 'Presell narrative', order: ['hero', 'problem', 'mechanism', 'product', 'proof', 'faq', 'guarantee', 'cta'], fit: 'cold traffic that has to be convinced there is a problem before a product' },
    { key: 'proof-first', label: 'Proof first', order: ['hero', 'proof', 'why', 'product', 'faq', 'guarantee', 'cta'], fit: 'winback and at-risk, where trust is the blocker, not information' },
    { key: 'ritual-howto', label: 'Ritual how-to', order: ['hero', 'steps', 'product', 'why', 'proof', 'cta'], fit: 'new and activation, where the question is how this fits a morning' },
    { key: 'comparison', label: 'Honest comparison', order: ['hero', 'comparison', 'why', 'product', 'proof', 'faq', 'cta'], fit: 'discovery and sampler traffic choosing between options' },
    { key: 'gift-curation', label: 'Gift curation', order: ['hero', 'picks', 'why', 'proof', 'faq', 'cta'], fit: 'gifting moments, where the reader is not the drinker' },
  ],

  design(ctx = {}) {
    const obj = String(ctx.objective || '').toLowerCase();
    const coh = String((ctx.cohort && (ctx.cohort.key || ctx.cohort.name)) || '').toLowerCase();
    const hay = obj + ' ' + coh;
    // Intent first: a page whose audience is named should not be left to the
    // seed. The seed only decides where intent is genuinely ambiguous.
    // Word-anchored. Unanchored, `new` matched "renewal" and "newsletter", so a
    // renewal reminder was designed as a first-purchase how-to page. Same defect
    // class as the market-URL suffix match: a substring is not a token.
    const byIntent =
      /\b(gift|gifting|festive|diwali|christmas|holiday)\b/.test(hay) ? 'gift-curation'
      : /\b(winback|win.?back|lapsed|at.?risk|churn|non.?engagers?|dormant)\b/.test(hay) ? 'proof-first'
      : /\b(new|welcome|activation|activate|first.?purchase|onboarding|onboard)\b/.test(hay) ? 'ritual-howto'
      : /\b(discover|discovery|sampler|cross.?sell|explore)\b/.test(hay) ? 'comparison'
      : null;
    const a = byIntent
      ? this.archetypes.find((x) => x.key === byIntent)
      : pickBySeed(this.archetypes, ctx, 'lp');
    return {
      archetype: a.key,
      label: a.label,
      order: a.order,
      fit: a.fit,
      keys: a.order.map((sec) => this.sectionCopy[sec]).filter(Boolean),
      spec: specs.LANDING.rule,
      breakpoints: specs.LANDING.breakpoints,
      why: byIntent ? `chosen from the slot's stated intent (${byIntent})` : 'no stated intent to key on, so chosen deterministically from the slot seed',
    };
  },

  contract(ctx = {}) {
    const d = this.design(ctx);
    return [
      `LANDING PAGE (${d.label}, ${d.fit}). Sections in THIS order: ${d.order.join(' -> ')}.`,
      'MESSAGE MATCH is the whole job: this page is the destination of a specific ad or email, so it opens on the EXACT promise that click was made on, in that creative\'s own words. Introduce no price, discount, rating, review count, guarantee or claim the originating creative did not state.',
      'Above the fold must answer what this is, who it is for, and what to do next, without scrolling. One primary action, repeated; never two competing CTAs.',
      `SEO title <=${this.limits.seo_title} chars, meta description <=${this.limits.meta_description}.`,
      // Naming the JSON keys is what makes the section order real: an archetype
      // that asks for a "problem" section and a schema with nowhere to put one
      // renders as the same page with the blocks in a different order.
      d.keys.length ? `This shape needs these landing keys filled: ${d.keys.join(', ')}. Leave a key out entirely rather than filling it with something you cannot support.` : '',
      d.spec,
    ].filter(Boolean).join('\n');
  },

  qa(asset = {}, ctx = {}) {
    const issues = [];
    checkRequired(issues, asset, this.required);
    checkText(issues, 'seo_title', asset.seo_title, this.limits.seo_title, WARN);
    checkText(issues, 'meta_description', asset.meta_description, this.limits.meta_description, WARN);
    brandPass(issues, asset, ['hero_headline', 'hero_sub', 'why_title', 'proof_quote', 'cta']);
    (asset.why_bullets || []).forEach((b, i) => checkBrandVoice(issues, `why_bullets[${i}]`, b));
    // Message match, checked the only way a deterministic pass can check it:
    // the page may not introduce an offer the originating creative did not
    // state. ctx.source_copy is that creative's text when the caller has it.
    const src = str(ctx.source_copy);
    for (const f of ['hero_headline', 'hero_sub', 'cta']) {
      const v = str(asset[f]);
      if (v && OFFER.test(v) && !(src && OFFER.test(src))) {
        issues.push({ sev: CRIT, field: f, msg: `${f} introduces an offer or guarantee the originating ad/email did not state (message-match break)` });
      }
    }
    if (!src) issues.push({ sev: WARN, field: 'message_match', msg: 'no source creative supplied, so message match could not be verified' });
    return finish(this, issues);
  },
};

// ════════════════════════════════════════════════════════════════════════════
// ENGINE: ORGANIC SOCIAL (one instance per platform)
// ════════════════════════════════════════════════════════════════════════════
// Organic is not a paid ad with the budget removed. Text lives in the caption,
// the image is TEXT-FREE, and the first line is truncated in-feed so it has to
// work as a standalone sentence.
function socialEngine(platform) {
  const p = specs.SOCIAL[platform] ? platform : 'instagram';
  const cfg = specs.SOCIAL[p];
  const copy = cfg.copy || {};
  const capLimit = copy.caption || copy.post || copy.title || 2200;

  return {
    id: 'social_' + p,
    label: p,
    channel: 'organic',
    platform: p,
    media: 'image',
    limits: copy,
    params: { temperature: 0.85, maxTokens: 900 },

    design(ctx = {}) {
      const angles = [
        { key: 'give-something-away', label: 'Give something away', beats: ['a brewing ratio or origin detail worth knowing', 'why it matters', 'the product as the reason it is possible'] },
        { key: 'behind-the-origin', label: 'Behind the origin', beats: ['the estate, the picker, the week of harvest', 'what that changes in the cup', 'soft CTA'] },
        { key: 'common-mistake', label: 'The mistake people make', beats: ['the mistake, named plainly', 'the correction', 'what it tastes like when it is right'] },
        { key: 'tiny-story', label: 'Tiny story', beats: ['one person, one morning, one specific detail', 'the turn', 'no hard sell'] },
      ];
      const a = pickBySeed(angles, ctx, 'social:' + p);
      return {
        archetype: a.key, label: a.label, order: a.beats,
        spec: specs.socialSpecText(p),
        why: 'Organic angles rotate per slot so a week of posts is not four versions of one post.',
      };
    },

    contract(ctx = {}) {
      const d = this.design(ctx);
      return [
        `ORGANIC SOCIAL, ${p} (${d.label}). Beats: ${d.order.join(' -> ')}.`,
        `Caption <=${capLimit} chars${copy.hashtags ? `, hashtags <=${copy.hashtags} and budgeted INSIDE that caption count` : ''}.`,
        'The image is TEXT-FREE: no overlay, no headline burned into the creative. All words live in the caption.',
        'The first line appears truncated in-feed, so it must stand alone and earn the tap. Never open with the product name.',
        d.spec,
      ].join('\n');
    },

    qa(asset = {}, ctx = {}) {
      const issues = [];
      const caption = asset.caption || asset.post || asset.text;
      checkRequired(issues, { caption }, ['caption']);
      const tags = Array.isArray(asset.hashtags) ? asset.hashtags : str(asset.hashtags).split(/\s+/).filter((t) => t.startsWith('#'));
      // Hashtags count against the caption on every platform that has both, so
      // measuring the caption alone under-reports the real length.
      const total = len(caption) + (tags.length ? tags.join(' ').length + 1 : 0);
      if (capLimit && total > capLimit) issues.push({ sev: CRIT, field: 'caption', msg: `caption plus hashtags is ${total} chars, over the ${capLimit}-char limit`, measured: total, limit: capLimit });
      if (copy.hashtags && tags.length > copy.hashtags) issues.push({ sev: CRIT, field: 'hashtags', msg: `${tags.length} hashtags, over the ${copy.hashtags} allowed`, measured: tags.length, limit: copy.hashtags });
      checkBrandVoice(issues, 'caption', caption);
      checkNoInventedOffer(issues, 'caption', caption);
      // The rule that separates organic from paid, and the one most often lost.
      if (asset.image_brief && ASKS_FOR_TEXT.test(str(asset.image_brief))) {
        issues.push({ sev: CRIT, field: 'image_brief', msg: 'organic creative must be text-free, but the image brief asks for rendered text' });
      }
      return finish(this, issues);
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ENGINE: VIDEO / MOTION
// ════════════════════════════════════════════════════════════════════════════
const videoEngine = {
  id: 'video',
  label: 'Video / motion ad',
  channel: 'paid',
  media: 'video',
  limits: { ad_seconds: 15, organic_seconds: 60, hook_seconds: 0.8 },
  params: { temperature: 0.8, maxTokens: 1600 },

  design(ctx = {}) {
    const cuts = [
      { key: 'hook-turn-payoff', label: 'Hook / turn / payoff', beats: ['motion in frame before 0.8s', 'the turn', 'product', 'CTA card'] },
      { key: 'ritual-loop', label: 'Ritual loop', beats: ['pour', 'steam', 'first sip', 'CTA card'] },
      { key: 'split-contrast', label: 'Split contrast', beats: ['the wound-up morning', 'hard cut', 'the calm one', 'CTA card'] },
    ];
    const c = pickBySeed(cuts, ctx, 'video');
    return {
      archetype: c.key, label: c.label, order: c.beats,
      spec: '9:16 1080x1920. Sides 7% clear, bottom 18% clear of platform UI chrome.',
      why: 'A shot list, not a mood: the renderer needs per-shot duration and movement or it produces a slideshow of stills.',
    };
  },

  contract(ctx = {}) {
    const d = this.design(ctx);
    return [
      `VIDEO AD (${d.label}). Shots: ${d.order.join(' -> ')}.`,
      `Something must MOVE inside ${this.limits.hook_seconds}s or the view is already gone. Total under ${this.limits.ad_seconds}s for an ad.`,
      'Per shot give: duration to one decimal, lens and camera move, subject and action, on-screen text with its timing, audio direction, transition out.',
      'Real motion only (push, drift, parallax, steam, pour). Never animate an object into existence, never an invented tin or label.',
      'Supply an explicit audio direction: the renderer generates SILENT unless one is passed, and Runway carries no audio track at all.',
      d.spec,
    ].join('\n');
  },

  qa(asset = {}, ctx = {}) {
    const issues = [];
    const shots = asset.storyboard || asset.shots || [];
    if (!shots.length) issues.push({ sev: CRIT, field: 'storyboard', msg: 'no storyboard: a video brief without shots renders as a slideshow of stills' });
    if (shots.length && shots.length < 3) issues.push({ sev: WARN, field: 'storyboard', msg: `${shots.length} shot(s); under three reads as a static card` });
    const total = shots.reduce((n, s) => n + (Number(s && (s.duration_s || s.seconds || s.duration)) || 0), 0);
    if (total > this.limits.ad_seconds) issues.push({ sev: WARN, field: 'storyboard', msg: `total run time ${total}s exceeds the ${this.limits.ad_seconds}s ad target`, measured: total, limit: this.limits.ad_seconds });
    // The audio invariant, checked rather than assumed: the storyboard asking
    // for music and the renderer being handed none is exactly how ads shipped
    // silent (see CLAUDE.md, video audio is opt-in per call).
    if (!len(asset.audio) && !shots.some((s) => s && len(s.audio))) {
      issues.push({ sev: WARN, field: 'audio', msg: 'no audio direction, so the clip renders silent' });
    }
    if (asset.audio_requested && asset.audio_supported === false) {
      issues.push({ sev: CRIT, field: 'audio', msg: 'music was requested but the provider that rendered this clip has no audio track, so the delivered file is silent' });
    }
    shots.forEach((s, i) => checkBrandVoice(issues, `storyboard[${i}].on_screen_text`, s && (s.on_screen_text || s.text)));
    return finish(this, issues);
  },
};

// ════════════════════════════════════════════════════════════════════════════
// ENGINE: PLAYABLE
// ════════════════════════════════════════════════════════════════════════════
// The rules here are the ones that actually cause store rejections, and they
// are already enforced at render time in scripts/lib/playable-ad.js. This
// engine states them at BRIEF time so a playable is not written in a shape
// that the renderer will then refuse.
const playableEngine = {
  id: 'playable',
  label: 'Playable ad',
  channel: 'paid',
  media: 'html',
  limits: { meta_mb: 2, tiktok_mb: 2, google_mb: 5 },
  params: { temperature: 0.7, maxTokens: 1800 },

  design(ctx = {}) {
    return {
      archetype: 'tap-to-build',
      label: 'Tap to build',
      order: ['hook screen 0-2s', 'interactive stage', 'end card with CTA'],
      spec: 'One self-contained HTML file. Every asset a data: URI. Portrait and landscape. Muted by default.',
      why: 'Reviewers test offline, so a single external request fails the unit regardless of how good it is.',
    };
  },

  contract(ctx = {}) {
    const d = this.design(ctx);
    return [
      `PLAYABLE AD (${d.label}). Flow: ${d.order.join(' -> ')}.`,
      d.spec,
      `Size caps: Meta and TikTok <=${this.limits.meta_mb}MB, Google <=${this.limits.google_mb}MB.`,
      'CTA fires the HOST API (FbPlayableAd.onCTAClick / openAppStore / mraid.open), never window.open.',
    ].join('\n');
  },

  qa(asset = {}, ctx = {}) {
    const issues = [];
    const html = str(asset.html);
    if (!html) { issues.push({ sev: CRIT, field: 'html', msg: 'no playable HTML' }); return finish(this, issues); }
    if (/(?:src|href)\s*=\s*["']https?:/i.test(html)) issues.push({ sev: CRIT, field: 'html', msg: 'playable references an external URL; reviewers test offline, so it must inline every asset as a data: URI' });
    if (/window\.open\s*\(/.test(html)) issues.push({ sev: CRIT, field: 'html', msg: 'CTA uses window.open instead of the host CTA API' });
    if (!/FbPlayableAd|openAppStore|mraid\.open|dapi/.test(html)) issues.push({ sev: CRIT, field: 'html', msg: 'no host CTA API call, so the CTA is inert in every network' });
    const mb = Buffer.byteLength(html, 'utf8') / (1024 * 1024);
    if (mb > this.limits.meta_mb) issues.push({ sev: WARN, field: 'html', msg: `${mb.toFixed(2)}MB exceeds the ${this.limits.meta_mb}MB Meta/TikTok cap`, measured: Number(mb.toFixed(2)), limit: this.limits.meta_mb });
    return finish(this, issues);
  },
};

// ════════════════════════════════════════════════════════════════════════════
// ENGINE: BLOG / LONG-FORM
// ════════════════════════════════════════════════════════════════════════════
const blogEngine = {
  id: 'blog',
  label: 'Blog post',
  channel: 'owned',
  media: 'html',
  limits: (specs.SOCIAL.blog && specs.SOCIAL.blog.copy) || { title: 60, metaDescription: 160 },
  required: ['title', 'meta_description', 'h1'],
  params: { temperature: 0.8, maxTokens: 3000 },

  design(ctx = {}) {
    const shapes = [
      { key: 'how-to', label: 'How-to', order: ['problem', 'method steps', 'common mistakes', 'product as the tool', 'FAQ'] },
      { key: 'origin-explainer', label: 'Origin explainer', order: ['the estate', 'the harvest', 'what it changes in the cup', 'how to brew it', 'shop'] },
      { key: 'comparison', label: 'Comparison', order: ['the question', 'option A', 'option B', 'who each is for', 'shop'] },
    ];
    const s = pickBySeed(shapes, ctx, 'blog');
    return { archetype: s.key, label: s.label, order: s.order, spec: `Title <=${this.limits.title}, meta description <=${this.limits.metaDescription}.`, why: 'Search intent decides the shape; the shape decides the H2 outline.' };
  },

  contract(ctx = {}) {
    const d = this.design(ctx);
    return [
      `BLOG POST (${d.label}). H2 outline in THIS order: ${d.order.join(' -> ')}.`,
      d.spec,
      'One question answered per H2. No section whose only job is to introduce the next one.',
    ].join('\n');
  },

  qa(asset = {}, ctx = {}) {
    const issues = [];
    checkRequired(issues, asset, this.required);
    checkText(issues, 'title', asset.title, this.limits.title, WARN);
    checkText(issues, 'meta_description', asset.meta_description, this.limits.metaDescription, WARN);
    brandPass(issues, asset, ['title', 'meta_description', 'h1']);
    const heads = asset.h2 || asset.headings || [];
    if (!heads.length) issues.push({ sev: WARN, field: 'h2', msg: 'no H2 outline, so the post has no scannable structure' });
    return finish(this, issues);
  },
};

// ── Verdict shape ───────────────────────────────────────────────────────────
// Deliberately the same idiom the gates use: a machine-readable verdict plus a
// sentence an operator can act on. `ok` is false only on a CRITICAL — a warning
// is information, not a block, and conflating the two is how a build either
// ships broken copy or refuses to ship over a preheader.
function finish(engine, issues) {
  const critical = issues.filter((i) => i.sev === CRIT);
  return {
    engine: engine.id,
    label: engine.label,
    ok: critical.length === 0,
    issues,
    critical: critical.length,
    warnings: issues.length - critical.length,
    summary: critical.length
      ? `${engine.label}: ${critical.length} critical issue(s): ${critical[0].msg}`
      : issues.length ? `${engine.label}: ${issues.length} warning(s)` : `${engine.label}: clean`,
  };
}

// ── Registry ────────────────────────────────────────────────────────────────
const ENGINES = {
  mailer: mailerEngine,
  landing_page: landingEngine,
  video: videoEngine,
  playable: playableEngine,
  blog: blogEngine,
};
for (const p of Object.keys(specs.ADS)) ENGINES['ad_' + p] = adEngine(p);
for (const p of Object.keys(specs.SOCIAL)) { if (p !== 'blog') ENGINES['social_' + p] = socialEngine(p); }

/**
 * engineFor('ad', 'google') → the Google ad engine.
 * Accepts the asset-type names already used across the repo (`lp`, `email`,
 * `motion`) so callers do not have to normalise before asking.
 */
function engineFor(assetType, platform) {
  const t = String(assetType || '').toLowerCase();
  const p = String(platform || '').toLowerCase();
  if (t === 'ad' || t === 'paid') return ENGINES['ad_' + p] || ENGINES.ad_meta;
  if (t === 'social' || t === 'organic') return ENGINES['social_' + p] || ENGINES.social_instagram;
  if (t === 'lp' || t === 'landing' || t === 'landing_page') return ENGINES.landing_page;
  if (t === 'email' || t === 'mailer') return ENGINES.mailer;
  if (t === 'motion' || t === 'video') return ENGINES.video;
  return ENGINES[t] || null;
}

/** QA one asset through its own engine. Unknown type → reported, never silent. */
function qaAsset(assetType, asset, ctx = {}, platform) {
  const e = engineFor(assetType, platform || (asset && asset.platform));
  if (!e) return { engine: null, ok: false, issues: [{ sev: CRIT, field: 'asset_type', msg: `no engine for asset type "${assetType}"` }], critical: 1, warnings: 0, summary: `no engine for asset type "${assetType}"` };
  return e.qa(asset || {}, ctx);
}

/**
 * QA a whole generated campaign: every asset through the engine that owns it.
 * Returns one verdict per asset plus a roll-up, so a caller can surface
 * "3 assets have critical issues" without re-deriving it.
 */
function qaCampaign(campaign = {}, ctx = {}) {
  const a = campaign.assets || {};
  const results = [];
  if (a.email) results.push({ asset: 'email', ...qaAsset('mailer', a.email, ctx) });
  for (const lp of a.landing_pages || []) results.push({ asset: `landing_page${lp.variant ? ':' + lp.variant : ''}`, ...qaAsset('landing_page', lp, ctx) });
  for (const ad of a.ads || []) results.push({ asset: `ad:${ad.platform}${ad.variant ? ':' + ad.variant : ''}`, ...qaAsset('ad', ad, ctx, ad.platform) });
  for (const post of a.social || []) results.push({ asset: `social:${post.platform}`, ...qaAsset('social', post, ctx, post.platform) });
  const critical = results.reduce((n, r) => n + r.critical, 0);
  const warnings = results.reduce((n, r) => n + r.warnings, 0);
  return {
    ok: critical === 0,
    checked: results.length,
    critical,
    warnings,
    results,
    summary: critical
      ? `${critical} critical issue(s) across ${results.filter((r) => !r.ok).length} of ${results.length} assets`
      : `${results.length} assets checked, ${warnings} warning(s), no critical issues`,
  };
}

/**
 * The per-asset generation directives for one slot, assembled from the engines
 * that will actually produce the assets. This is what makes the copy prompt
 * asset-specific instead of one shape for everything.
 */
function contractsFor(assetTypes, ctx = {}) {
  return (assetTypes || []).map((t) => {
    const [type, platform] = String(t).split(':');
    const e = engineFor(type, platform);
    return e ? { id: e.id, contract: e.contract(ctx), design: e.design(ctx), params: e.params } : null;
  }).filter(Boolean);
}

module.exports = {
  ENGINES, engineFor, qaAsset, qaCampaign, contractsFor,
  // Exported for tests and for callers that need the same primitives.
  seed, slotKey, pickBySeed, OFFER, DASH, ASKS_FOR_TEXT, CRIT, WARN,
};
