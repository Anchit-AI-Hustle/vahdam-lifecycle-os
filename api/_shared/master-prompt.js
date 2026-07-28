'use strict';

/**
 * Master-prompt builder — the single, portable "copy anywhere" prompt.
 *
 * Every generated asset (mailer / ad / landing page / social / playable / video)
 * carries a `master_prompt`: one self-contained block a human can paste into a
 * BLANK ChatGPT, Claude, or Gemini session and get the same top-tier, on-brand
 * output the app produces — with zero prior context.
 *
 * This module is the single source of truth for the brand constraint block
 * (BRAND_BLOCK) — all prompt sites import it rather than re-deriving it.
 *
 * Version 2.0 — 2026-07-29
 * Added: social media contracts, playable ad contract, video/motion contract,
 *        organic social contracts, streaming output format, per-platform specs.
 */

const assetSpecs = require('./asset-specs');

// ── Brand constants (source of truth: Brand style guide.pdf) ────────────────
const BRAND_BLOCK = `BRAND: VAHDAM India — premium single-estate Indian teas & wellness.
VOICE: warm, sensory, emotionally resonant, story-driven. Testimonials read as tiny personal stories, not reviews.
PALETTE (use ONLY these four): #004A2B forest green · #AB8743 gold · #171717 near-black · #FBF5EA cream.
CONTRAST (strict): on cream bg → body text MUST be #171717, headings #004A2B or #171717 (never cream text). On green/ink bg → ALL text MUST be #FBF5EA cream (never ink). Gold as text on cream/green MUST use font-weight 600/700.
TYPOGRAPHY (strict): Headings = 'LAO MN' (fallback Georgia,'Times New Roman',serif). Body = 'Proxima Nova' (fallback 'Helvetica Neue',Arial,sans-serif). Never introduce other fonts. For any HTML asset, inject these EXACT @font-face into the <head> <style> before app rules:
  @font-face{font-family:"LAO MN";src:url("https://cdn.nector.io/nector-static/fonts/LaoMN-01.ttf") format("truetype");}
  @font-face{font-family:"Proxima Nova";src:url("https://cdn-widgetsrepository.yotpo.com/brandkit/custom-fonts/nULz3c4cbjU7NEqLKreeoyIyIP4L5pnrZ53k1952/proximanova-regular/proximanova-regular.woff2") format("woff2");}
LOGO (header, exact — never substitute): <img src="https://www.vahdam.co.uk/cdn/shop/files/logo-website_3.png?v=1756808809&width=310" alt="VAHDAM India" /> at a restrained header height (~30px).
FOOTER: "Privacy Policy" and "Terms of Service" must be plain labels with href="#" and no target/onclick routing.
PREFERRED words: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted.
BANNED phrases (never use): "wellness journey", "transform", "liquid gold", "game-changer", "LIMITED TIME" (in caps), "hurry", "don't miss out", "last chance", "while supplies last".
NEVER: off-palette tints, medical claims, fake scarcity, ALL-CAPS urgency, fabricated filenames/URLs/selectors, em-dashes (—), en-dashes (–). Use commas, colons, or plain hyphens instead.`;

// ── Regional facts ──────────────────────────────────────────────────────────
const REGION = {
  US: { store: 'www.vahdamteas.com', presell: 'try.vahdam.com', currency: '$', locale: 'en-US', shipping: 'Free US shipping over $59' },
  UK: { store: 'uk.vahdamteas.com', presell: 'try.vahdam.co.uk', currency: '£', locale: 'en-GB', shipping: 'Free UK shipping over £50' },
  IN: { store: 'www.vahdamindia.com', presell: 'try.vahdam.com', currency: '₹', locale: 'en-IN', shipping: 'Free India shipping over ₹2,000' },
  EU: { store: 'eu.vahdamteas.com', presell: 'try.vahdam.com', currency: '€', locale: 'en-IE', shipping: 'Free EU shipping over €60' },
  AU: { store: 'au.vahdamteas.com', presell: 'try.vahdam.com', currency: 'A$', locale: 'en-AU', shipping: 'Free AU shipping over A$80' },
  Global: { store: 'www.vahdamteas.com', presell: 'try.vahdam.com', currency: '$', locale: 'en', shipping: 'Free shipping on orders over $59' },
};
function regionFacts(market) { return REGION[market] || REGION.Global; }

// ── Product context ─────────────────────────────────────────────────────────
function productLines(products = [], currency = '$') {
  const list = (Array.isArray(products) ? products : []).filter(Boolean).slice(0, 8);
  if (!list.length) return '(no specific products supplied — refer to VAHDAM offerings at CATEGORY level only, e.g. "single-estate Darjeeling" or "ashwagandha coffee". Do NOT invent a specific product name, price, or handle/URL.)';
  return list.map((p) => {
    const title = p.title || p.name || p.t || 'VAHDAM tea';
    const price = p.price ?? p.p;
    const handle = p.handle || p.h;
    const cat = p.category || p.cat || p.c || 'tea';
    return `- ${title}${price != null ? ` (${currency}${price})` : ''}${cat ? ` · ${cat}` : ''}${handle ? ` · handle: ${handle}` : ''}`;
  }).join('\n');
}

// ── Per-asset output contracts ──────────────────────────────────────────────
// The visual cascade for every visual asset, in the order the operator chose:
const VISUAL_CASCADE = `VISUALS — use this source order: (1) if a hosted media URL is provided, embed it (product image/GIF/MP4, e.g. a Shopify product video); (2) else describe an auto-generated animated GIF (2–4 still frames, gentle Ken-Burns or cross-fade) the team can produce from product photography; (3) AI-generated video only as a last resort. Every visual must be photoreal, on-palette, text-free in the image itself (text lives in the layout, not burned into the photo) unless the asset is an ad creative.`;

// ── EMAIL MAILER CONTRACT ───────────────────────────────────────────────────
function mailerContract(variant) {
  if (variant === 'V1') {
    return `ASSET: Email mailer — VARIANT V1 (COMPLETE TEXTUAL CONTENT, no imagery).
Produce a fully text-driven email that stands on its own with zero images.
Deliver, in order:
1. 3 subject-line options (≤50 chars) + 1 preheader (≤90 chars).
2. Editorial hero headline + opening line that earns the scroll.
3. Body: 2–3 short story-driven paragraphs (origin, ritual, why-now).
4. A benefit triplet (3 crisp lines).
5. One tiny personal testimonial (story, not a star rating).
6. Clear CTA copy + the destination store URL.
7. Plain-text version suitable for deliverability.
Compact (~two scrolls). No layout/visual instructions — pure copy.`;
  }
  return `ASSET: Email mailer — VARIANT V2 (TEXTUAL + VISUAL).
Produce the same persuasive copy as V1 PLUS a complete visual layout.
Deliver, in order:
1. 3 subject lines + preheader.
2. Section-by-section layout: for each section give the COPY and the VISUAL (hero, lifestyle, product packshot, motion moment).
3. At least one motion slot (animated GIF or short product video) with an exact creative brief and where it sits.
4. Benefit strip, social proof, offer bar, CTA — each with copy + visual direction.
5. Responsive, email-client-safe structure (Outlook bgcolor on colored cells; max ~1200–1500px tall).
${VISUAL_CASCADE}`;
}

<<<<<<< Updated upstream
// The studio compositor (Creative Studio tab of ad-campaigns-master.html) renders ONE
// still PNG per size with
// the text overlay baked in. Be honest about that: list the exact static sizes
// it produces and treat motion as an OPTIONAL hand-off brief, never a delivered
// asset. The text fields (headlines/captions/scripts) are still authored as copy.
=======
// ── PAID AD CONTRACT (per platform) ─────────────────────────────────────────
>>>>>>> Stashed changes
function adContract(platform) {
  const copyGuide = {
    google: 'Google (Responsive Search + Performance Max): 15 headlines (≤30 chars), 4 descriptions (≤90 chars), long headline (≤90), business name.',
    meta: 'Meta (Facebook/Instagram Feed + Reels + Stories): primary text (≤125 chars before truncation), headline (≤40), description.',
    instagram: 'Instagram (Feed + Reels + Stories): caption with hook in first line + hashtags.',
    tiktok: 'TikTok (In-Feed + Spark): native-feeling video script with a 0–2s hook, on-screen text beats, brand-safe audio direction, caption (≤100 chars), and 3 hashtag options. The produced creative is a cover keyframe (the script is a brief for a separate shoot/edit).',
  };
  const sizeKey = assetSpecs.ADS[platform] ? platform : 'meta';
  const spec = (copyGuide[platform] || copyGuide.meta) + ' PRODUCED at each placement — ' + assetSpecs.adSpecText(sizeKey, { onlyProduced: true });
  return `ASSET: Paid ad creative for ${platform.toUpperCase()} — a FULL ad, not just copy.
The PRODUCED creative is a still, photoreal, on-palette image at each size below, with the on-creative text overlay BAKED INTO the image — exactly like a real ${platform} ad. The text is part of the rendered creative, NOT a separate caption: specify the exact overlay wording, font (Lao MN headings / Proxima Nova body), colour (use ONLY #004A2B / #AB8743 / #FBF5EA / #171717), size and pixel placement within the safe zones (on 9:16 keep all text clear of the bottom 20% platform-UI chrome), legible at a glance.

━━ STRATEGY — SELL HAPPINESS, NOT FEATURES (Aman's P01 mandate) ━━
TARGET (P01): women 45+ and busy/working mums — high daily stress + cortisol, brain fog, "wired-but-tired" energy, menopause-era changes.
SELL THE EMOTIONAL END-STATE, never the ingredient. The promise is happiness / calm / "feeling like myself again" — e.g. "calmer mornings," "steady energy with no 2pm crash," escaping the "wound-up feeling." NEVER lead with functional ingredients (Ashwagandha/KSM-66/Arabica/Lion's Mane) or feature lists; a feature may appear only as the *reason* a happiness payoff is believable.
THE 1-SECOND SCROLL-STOP: the visual must demand a stop from a stressed, overworked mother in under one second — a visceral image mirroring her chaos OR her desired calm. Do NOT lead with heavy text or ingredient call-outs. Scaling depends on scroll-stop + engagement, not just the click.
CURATE, DON'T INVENT: structure the creative on proven, replicable D2C wellness formats (UGC, split-screen before/after, day-in-the-life), not novel concepts.
OFFER: transition cleanly from the emotional hook into the high-value offer or quick delivery — a premium, frictionless CTA, never a cheap pop-up. This exact offer line is the on-creative offer baked into the image.

Platform spec: ${spec}
Deliver: (a) every text field the platform requires; (b) for EACH static size above, a precise creative brief describing the still visual, the BAKED-IN overlay wording (headline + offer) + exact pixel placement + safe zones; (c) the destination URL.
VISUALS (produced asset): one still, on-palette, photoreal image per size with the overlay baked in — this is exactly what the studio compositor renders. If a hosted product image/MP4 URL is supplied, its first frame is used as the base still. Motion (animated GIF / short video) is an OPTIONAL follow-up brief for the team — describe it only as a next step, NEVER as a delivered asset here. To produce the actual video ad from this brief, hand it to OpenMontage (open-source agentic video pipeline): https://github.com/Open-Montage/OpenMontage`;
}

// ── ORGANIC SOCIAL CONTRACT (per platform) ──────────────────────────────────
// Social posts differ from paid ads: no baked-in text overlay, hashtags budgeted
// into char count, more conversational tone, image goes in caption not on creative.
function socialContract(platform) {
  const specs = {
    instagram: {
      sizes: assetSpecs.socialSpecText('instagram'),
      copy: 'Caption: ≤2200 chars (hashtags budgeted into this limit). Hashtags: ≤30.',
      tone: 'Hook in first line. Story-driven. Sensory language. Emoji sparingly.',
      format: 'Instagram (Feed + Reels + Stories)',
    },
    facebook: {
      sizes: assetSpecs.socialSpecText('facebook'),
      copy: 'Caption: ≤2200 chars.',
      tone: 'More conversational than Instagram. Can be longer. Link posts perform well.',
      format: 'Facebook',
    },
    linkedin: {
      sizes: assetSpecs.socialSpecText('linkedin'),
      copy: 'Caption: ≤3000 chars. Hashtags: ≤5.',
      tone: 'Professional. Thought leadership. Origin story angle. Employee advocacy voice.',
      format: 'LinkedIn',
    },
    x: {
      sizes: assetSpecs.socialSpecText('x'),
      copy: 'Post: ≤280 chars (concise, punchy).',
      tone: 'One image per post. Thread potential for longer stories. Direct.',
      format: 'X / Twitter',
    },
    youtube: {
      sizes: assetSpecs.socialSpecText('youtube'),
      copy: 'Title: ≤100 chars. Description: ≤5000 chars.',
      tone: 'Thumbnail must be clickable. Shorts = 9:16 vertical, <60s.',
      format: 'YouTube',
    },
    pinterest: {
      sizes: assetSpecs.socialSpecText('pinterest'),
      copy: 'Title: ≤100 chars. Description: ≤500 chars.',
      tone: 'Aspirational. Recipe/ritual focused. Link to PDP. 2:3 vertical.',
      format: 'Pinterest',
    },
  };
  const s = specs[platform] || specs.instagram;
  return `ASSET: Organic social post for ${s.format} — NOT a paid ad.
This is an ORGANIC post: text goes in the CAPTION, not baked into the image.
Image must be text-free (no overlay, no headline on the creative).

Platform spec: ${s.sizes}
Copy limits: ${s.copy}
Tone: ${s.tone}

Deliver:
1. Caption (within char limit, hook in first line)
2. Hashtags (within platform budget, budgeted into char count)
3. Image direction (size + brief for the photographer/designer)
4. First comment (Instagram only, for additional hashtags/links)

BRAND RULES apply: palette, typography, voice, banned phrases, no dashes, no fabricated facts.`;
}

// ── LANDING PAGE CONTRACT ───────────────────────────────────────────────────
function landingContract(facts) {
  return `ASSET: Landing page in the try.vahdam.* presell style (reference: https://${facts.presell}/...).
Build a conversion-focused, single-scroll-friendly page using the brand palette/typography.
Sections, in order: sticky announcement bar · hero (headline + sub + primary CTA) · trust/credentials row (4.9/5 · 250K+ reviews · Oprah's Fav · B-Corp) · problem→solution narrative · product reveal with price (${facts.currency}) · benefit grid · ingredient/origin proof · testimonials as mini-stories (NOT star ratings) · FAQ (accordion, 3-5 Qs) · risk-reversal/guarantee · sticky footer CTA.
Every CTA links to the regional store (https://${facts.store}/products/{handle}). Mobile-first, fast, self-contained HTML/CSS (inline), no external fonts/scripts.
${facts.shipping ? `Shipping line for offer bar: ${facts.shipping}` : ''}
${VISUAL_CASCADE}`;
}

// ── PLAYABLE AD CONTRACT ────────────────────────────────────────────────────
function playableContract(facts) {
  return `ASSET: Playable ad — interactive HTML5 ad unit for Meta/TikTok/Google.
A playable is NOT a video with a button. It is an interactive unit the user can TAP/CLICK through.

REQUIREMENTS:
  - ONE self-contained HTML file
  - ALL assets as data: URIs (no external requests — reviewers test offline)
  - Per-network size caps: Meta/TikTok ≤2MB, Google/AppLovin/Unity ≤5MB
  - Portrait AND landscape orientations
  - Muted by default
  - Host CTA APIs (NOT window.open):
      Meta:     FbPlayableAd.onCTAClick()
      TikTok:   window.openAppStore() / playableSDK.openAppStore()
      Google:   mraid.open()
      Generic:  dapi (MRAID)

INTERACTION FLOW:
  1. Hook screen (0-2s): brand visual + "Tap to start"
  2. Interactive stage: tap-to-build (e.g. build a cup of tea, steep ritual)
  3. End card: product reveal + CTA button (fires host CTA API)

Deliver: complete self-contained HTML with inlined data:URI assets.
${facts.shipping ? `Shipping line for offer: ${facts.shipping}` : ''}`;
}

// ── VIDEO / MOTION AD CONTRACT ──────────────────────────────────────────────
function videoContract(facts) {
  return `ASSET: Video / motion ad — two deliverables:

A. MOTION AD (self-contained animated HTML):
  - 9:16 aspect ratio (1080x1920)
  - Inlined muted autoplay video or CSS animation
  - Interactive end card with CTA
  - Scene-by-scene breakdown with timing
  - File size: Meta/TikTok ≤2MB, Google ≤5MB

B. VIDEO BRIEF (for Higgsfield / OpenMontage / external production):
  Deliver a shot-by-shot brief:
  1. Shot number + duration (seconds)
  2. Camera angle + movement
  3. Subject + action
  4. On-screen text (word, timing, animation)
  5. Audio direction (music mood, SFX, voiceover)
  6. Transition to next shot
  Total duration: <15 seconds for ads, <60s for organic

Deliver: complete motion ad HTML + shot-by-shot brief for external production.
${facts.shipping ? `Shipping line for CTA: ${facts.shipping}` : ''}`;
}

/**
 * Build the single portable master prompt for one asset.
 * @param {object} o
 * @param {'mailer'|'ad'|'landing_page'|'social'|'playable'|'video'} o.assetType
 * @param {string} [o.market]
 * @param {string} [o.brief]      campaign brief / objective
 * @param {Array}  [o.products]
 * @param {string} [o.variant]    mailer: 'V1' | 'V2'
 * @param {string} [o.platform]   ad/social: 'google'|'meta'|'instagram'|'tiktok'|'facebook'|'linkedin'|'x'|'youtube'|'pinterest'
 * @param {string} [o.cohort]
 * @param {string} [o.extra]      any extra constraints to append
 * @returns {string}
 */
function buildMasterPrompt(o = {}) {
  const { assetType = 'mailer', market = 'US', brief = '', products = [], variant = 'V2', platform = 'meta', cohort = '', extra = '' } = o;
  const facts = regionFacts(market);
  let contract;
  if (assetType === 'ad') contract = adContract(String(platform).toLowerCase());
  else if (assetType === 'social') contract = socialContract(String(platform).toLowerCase());
  else if (assetType === 'landing_page' || assetType === 'lp') contract = landingContract(facts);
  else if (assetType === 'playable') contract = playableContract(facts);
  else if (assetType === 'video' || assetType === 'motion') contract = videoContract(facts);
  else contract = mailerContract(variant === 'V1' ? 'V1' : 'V2');

  return [
    `You are VAHDAM India's senior lifecycle creative director. Produce best-in-class, ready-to-ship output. Follow every rule exactly.`,
    ``,
    BRAND_BLOCK,
    ``,
    `MARKET: ${market} · Store: https://${facts.store} · Currency: ${facts.currency}${cohort ? ` · Audience cohort: ${cohort}` : ''}`,
    brief ? `\nCAMPAIGN BRIEF:\n${String(brief).trim()}` : '',
    ``,
    `PRODUCTS IN SCOPE:\n${productLines(products, facts.currency)}`,
    ``,
    contract,
    ``,
    `QUALITY BAR: premium, specific, sensory, zero filler. No banned phrases. No medical claims. No fabricated reviews, ratings, prices, or URLs. If you must assume a detail, choose the most on-brand option and proceed — do not ask questions.`,
    extra ? `\nADDITIONAL CONSTRAINTS:\n${String(extra).trim()}` : '',
  ].filter((l) => l !== '').join('\n').trim();
}

module.exports = { buildMasterPrompt, BRAND_BLOCK, regionFacts, REGION };
