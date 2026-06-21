'use strict';

/**
 * Master-prompt builder — the single, portable "copy anywhere" prompt.
 *
 * Every generated asset (mailer / ad / landing page) carries a `master_prompt`:
 * one self-contained block a human can paste into a BLANK ChatGPT, Claude, or
 * Gemini session and get the same top-tier, on-brand output the app produces —
 * with zero prior context. So the brand rules, catalog facts, regional details,
 * and the exact output contract are all baked into the string itself.
 *
 * This module is also the single source of truth for the brand constraint block
 * (BRAND_BLOCK) — other prompt sites should import it rather than re-deriving it.
 */

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
NEVER: off-palette tints, medical claims, fake scarcity, ALL-CAPS urgency, fabricated filenames/URLs/selectors.`;

// ── Regional facts ──────────────────────────────────────────────────────────
const REGION = {
  US: { store: 'www.vahdamteas.com', presell: 'try.vahdam.com', currency: '$', locale: 'en-US' },
  UK: { store: 'uk.vahdamteas.com', presell: 'try.vahdam.co.uk', currency: '£', locale: 'en-GB' },
  IN: { store: 'www.vahdamindia.com', presell: 'try.vahdam.com', currency: '₹', locale: 'en-IN' },
  EU: { store: 'eu.vahdamteas.com', presell: 'try.vahdam.com', currency: '€', locale: 'en-IE' },
  AU: { store: 'au.vahdamteas.com', presell: 'try.vahdam.com', currency: 'A$', locale: 'en-AU' },
  Global: { store: 'www.vahdamteas.com', presell: 'try.vahdam.com', currency: '$', locale: 'en' },
};
function regionFacts(market) { return REGION[market] || REGION.Global; }

// ── Product context ─────────────────────────────────────────────────────────
function productLines(products = [], currency = '$') {
  const list = (Array.isArray(products) ? products : []).filter(Boolean).slice(0, 8);
  if (!list.length) return '(no specific products supplied — use a representative VAHDAM single-estate tea or curated assortment).';
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

function adContract(platform) {
  const specs = {
    google: 'Google (Responsive Search + Performance Max): 15 headlines (≤30 chars), 4 descriptions (≤90 chars), long headline (≤90), business name, plus image/video asset briefs at 1.91:1 (1200×628), 1:1 (1200×1200) and a 16:9 video (≤30s).',
    meta: 'Meta (Facebook/Instagram Feed + Reels + Stories): primary text (≤125 chars before truncation), headline (≤40), description, and creative briefs at 1:1 (1080×1080) feed, 9:16 (1080×1920) Reels/Stories, with a short product video/GIF option for Reels.',
    instagram: 'Instagram (Feed + Reels + Stories): caption with hook in first line + hashtags, and creative briefs at 1:1 (1080×1080) and 9:16 (1080×1920), motion-first (Reels/Stories favour video/GIF).',
    tiktok: 'TikTok (In-Feed + Spark): 9:16 (1080×1920) native-feeling video script with a 0–2s hook, on-screen text beats per second, trending-but-brand-safe audio direction, caption, and 3 hashtag options.',
  };
  const spec = specs[platform] || specs.meta;
  return `ASSET: Paid ad creative for ${platform.toUpperCase()} — a FULL ad, not just copy.
The creative itself must combine VISUAL (image / GIF / video) WITH on-creative text overlay (headline + offer) BAKED INTO the image/video — exactly like a real ${platform} ad. The text is part of the rendered creative, NOT a separate caption: specify the exact overlay wording, font (Lao MN headings / Proxima Nova body), colour (on-palette), size and pixel placement within the safe zones, legible at a glance.

━━ STRATEGY — SELL HAPPINESS, NOT FEATURES (Aman's P01 mandate) ━━
TARGET (P01): women 45+ and busy/working mums — high daily stress + cortisol, brain fog, "wired-but-tired" energy, menopause-era changes.
SELL THE EMOTIONAL END-STATE, never the ingredient. The promise is happiness / calm / "feeling like myself again" — e.g. "calmer mornings," "steady energy with no 2pm crash," escaping the "wound-up feeling." NEVER lead with functional ingredients (Ashwagandha/KSM-66/Arabica/Lion's Mane) or feature lists; a feature may appear only as the *reason* a happiness payoff is believable.
THE 1-SECOND SCROLL-STOP: the visual must demand a stop from a stressed, overworked mother in under one second — a visceral image mirroring her chaos OR her desired calm. Do NOT lead with heavy text or ingredient call-outs. Scaling depends on scroll-stop + engagement, not just the click.
CURATE, DON'T INVENT: structure the creative on proven, replicable D2C wellness formats (UGC, split-screen before/after, day-in-the-life), not novel concepts.
OFFER: transition cleanly from the emotional hook into the high-value "Starter Pack — 65% OFF + free gifts worth £40 (frother + scoop)" or quick/Insta delivery — a premium, frictionless CTA, never a cheap pop-up.

Platform spec: ${spec}
Deliver: (a) every text field the platform requires; (b) for each required size/format, a precise creative brief describing the visual, the BAKED-IN text overlay wording + exact placement + safe zones, and the motion (if any); (c) the destination URL.
${VISUAL_CASCADE}`;
}

function landingContract(facts) {
  return `ASSET: Landing page in the try.vahdam.* presell style (reference: https://${facts.presell}/...).
Build a conversion-focused, single-scroll-friendly page using the brand palette/typography.
Sections, in order: sticky announcement bar · hero (headline + sub + primary CTA) · trust/credentials row · problem→solution narrative · product reveal with price (${facts.currency}) · benefit grid · ingredient/origin proof · testimonials as mini-stories · FAQ (accordion) · risk-reversal/guarantee · sticky footer CTA.
Every CTA links to the regional store (https://${facts.store}/products/{handle}). Mobile-first, fast, self-contained HTML/CSS (inline), no external fonts/scripts.
${VISUAL_CASCADE}`;
}

/**
 * Build the single portable master prompt for one asset.
 * @param {object} o
 * @param {'mailer'|'ad'|'landing_page'} o.assetType
 * @param {string} [o.market]
 * @param {string} [o.brief]      campaign brief / objective
 * @param {Array}  [o.products]
 * @param {string} [o.variant]    mailer: 'V1' | 'V2'
 * @param {string} [o.platform]   ad: 'google'|'meta'|'instagram'|'tiktok'
 * @param {string} [o.cohort]
 * @param {string} [o.extra]      any extra constraints to append
 * @returns {string}
 */
function buildMasterPrompt(o = {}) {
  const { assetType = 'mailer', market = 'US', brief = '', products = [], variant = 'V2', platform = 'meta', cohort = '', extra = '' } = o;
  const facts = regionFacts(market);
  let contract;
  if (assetType === 'ad') contract = adContract(String(platform).toLowerCase());
  else if (assetType === 'landing_page' || assetType === 'lp') contract = landingContract(facts);
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
    `QUALITY BAR: premium, specific, sensory, zero filler. No banned phrases. No medical claims. If you must assume a detail, choose the most on-brand option and proceed — do not ask questions.`,
    extra ? `\nADDITIONAL CONSTRAINTS:\n${String(extra).trim()}` : '',
  ].filter((l) => l !== '').join('\n').trim();
}

module.exports = { buildMasterPrompt, BRAND_BLOCK, regionFacts, REGION };
