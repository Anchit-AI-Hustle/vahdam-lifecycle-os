const callLLM = require('./llm.js');
const SM = require('./scenario-model.js');
let DESIGN = null;
try { DESIGN = require('../../data/design-intelligence.js'); } catch (_) { DESIGN = null; }

const scrub = (value) => {
  try { return SM.sanitizeBrand ? SM.sanitizeBrand(String(value || '')) : SM.scrubDashes(String(value || '')); }
  catch (_) { return String(value || '').replace(/[\u2013\u2014]/g, '-'); }
};

const STORE = {
  US: 'https://vahdam.com',
  UK: 'https://vahdam.co.uk',
  India: 'https://vahdam.in',
  IN: 'https://vahdam.in',
  Global: 'https://vahdam.com',
  EU: 'https://vahdam.com',
  AU: 'https://vahdam.com',
  ME: 'https://vahdam.com',
};

let runDesignLoop = null;
try { ({ runDesignLoop } = require('./lp-design-loop.js')); } catch (_) { runDesignLoop = null; }

module.exports = async function handler(req, res) {
  const t0 = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'invalid_json_body' }); }
  }

  const market = String(body.market || body.region || 'US');
  const channel = String(body.channel || 'landing');
  const store = STORE[market] || STORE.US;
  const motionProfile = String(body.motion_profile || 'immersive-balanced');
  const brief = String(body.brief || body.prompt || '').slice(0, 9000);
  if (brief.trim().length < 20) return res.status(400).json({ error: 'brief_required' });

  // Design-intelligence directive (from data/design-intelligence.js): when the
  // caller requests a variation (big-number-hero, problem-solution-presell,
  // social-proof-led, long-form-story), inject that design pattern.
  const designVariation = String(body.design_variation || body.variation || '');
  const designDirective = (DESIGN && designVariation) ? DESIGN.directivePrompt('landing_page', designVariation) : '';

  const systemPrompt = `You are a senior D2C conversion copywriter, interaction designer, and front-end developer for VAHDAM India.

OUTPUT CONTRACT
Return ONLY one complete production-ready HTML document from <!doctype html> to </html>. No markdown fences or commentary. Use inline CSS and a small inline JavaScript block. No external libraries, CDNs, Google Fonts, remote JS, React, Three.js, Framer runtime, or Motion runtime. The page must work by opening the downloaded HTML file directly.

BRAND TOKENS, EXACT
:root {
  --font-head: "LAO MN", Georgia, "Times New Roman", serif;
  --font-body: "Proxima Nova", "Helvetica Neue", Arial, sans-serif;
  --vahdam-green: #004A2B;
  --vahdam-gold: #AB8743;
  --vahdam-ink: #171717;
  --vahdam-cream: #FBF5EA;
}
Only these four hex colours may appear. Apply var(--font-head) to h1, h2, h3, h4, .heading, .title, .subhead, .eyebrow. Apply var(--font-body) to body, p, li, span, button, input, label, .body-text.
Primary CTA: green background and cream text. Secondary CTA: gold border or background and green text. Headings green on light surfaces and cream on dark surfaces. Body text ink. Default section background cream. Gold for rule lines, badges, hover and active accents.

VOICE
Warm, sensory, story-driven, premium. Prefer ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted. Never use wellness journey, transform, liquid gold, game-changer, LIMITED TIME, hurry, don't miss out, last chance, while supplies last. No fabricated ratings, review counts, medical claims, prices, products or guarantees.

FRAMER AND MOTION-INSPIRED INTERACTION SYSTEM
Treat 3D, 4D and 5D as concrete interaction layers, not labels pasted onto the page.

MOTION IS SECTION-SCOPED, NEVER PAGE-WIDE. Every animation belongs to, and is confined to, the ONE section whose content it illustrates - it must not be applied to the <body>, a full-page wrapper, or any other section. Each effect matches its section's function:
- A "bundling"/assembly effect - ingredients or components spiralling, orbiting or converging into the product - is the SIGNATURE of the ingredients / what's-inside section ONLY. It must live inside that section's container (scoped selector, its own IntersectionObserver / scroll range) and stop there. Never let a spiral, swirl, orbit or converge animation run behind the hero, benefits, proof, FAQ or footer.
- Hero: pointer/scroll parallax and the 3D product stage only.
- Benefits / features: staggered reveal-on-scroll (opacity + translateY).
- Proof / testimonials: gentle fade/slide as they enter; no continuous motion.
- Ingredients / composition: the bundling/spiral assembly, scoped to this block.
- Offer / product: restrained hover depth on the card.
- FAQ / footer: static, or a plain reveal - no depth effects.
Give each animated section its own scoped CSS class or id so its keyframes and transforms cannot leak onto siblings; a shared global class that animates "every section the same way" is wrong.

3D SPATIAL DEPTH
- Build an above-the-fold product stage using CSS perspective, transform-style: preserve-3d, layered planes, a six-face or convincing multi-surface product pack, floating botanicals and a cup or liquid sphere.
- Product responds subtly to pointer position using requestAnimationFrame and rotateX/rotateY. Touch users get a gentle automatic orbit.
- Cards use restrained hover and press depth similar to Framer component hover/press effects.
- Never rely on an image to fake the entire 3D scene. Use semantic HTML/CSS shapes and an optional labelled product-image slot.

4D TIME AND SCROLL
- Use scroll progress as a timeline, inspired by Framer Scroll Transform and Motion useScroll/useTransform patterns.
- Include one sticky storytelling section where product scale, rotation, opacity or ingredient positions interpolate smoothly as the user scrolls.
- Reveal sections with IntersectionObserver. Use transform and opacity only for performance.
- Add a thin progress indicator tied to document scroll.
- Motion must guide attention toward proof and CTA, never delay access to content.

5D PARTICIPATION AND SENSORY STATE
- Include an interactive sensory or ritual component with at least four selectable states such as Aroma, Body, Brightness, Finish or Morning, Afternoon, Evening, Gift.
- Changing state must update visible copy and at least one visual property using accessible buttons and aria-pressed.
- Add a Pause Motion control.
- Respect prefers-reduced-motion. In reduced motion, all content is immediately visible and interactions still work without continuous movement.

MOTION PROFILE
Requested profile: ${motionProfile}.
- subtle-premium: restrained reveals, maximum 4deg card tilt, slow orbit.
- immersive-balanced: visible spatial hero, scroll transforms, sensory state changes, no excessive looping.
- editorial-cinematic: larger sticky scroll sequence and stronger depth, while preserving readability and mobile performance.

CONVERSION ARCHITECTURE
Mobile-first at 360px. No horizontal overflow. Tap targets at least 44px. Required order: announcement bar when offer exists, header, hero with one dominant CTA and spatial product stage, trust strip, benefits, sticky 4D origin or product story, product or offer block with only supplied commercial facts, interactive 5D sensory section, social proof framed as representative themes unless exact quotes are supplied, FAQ, final CTA, footer, sticky mobile CTA.

TECHNICAL QUALITY
- Semantic HTML, accessible labels, visible focus states, responsive clamp typography.
- Inline JS must be defensive and under roughly 8KB.
- Use requestAnimationFrame for pointer transforms and passive scroll listeners.
- Avoid layout-shifting animation and heavy box-shadow animation.
- All content must remain readable when JavaScript is disabled.
- Currency and links must match ${market}. Primary store base: ${store}.
- Channel intent: ${channel}. Match message continuity to how visitors arrive.`;

  const userMessage = `Create the final page from this exact input. Preserve every supplied factual detail and offer, but do not invent missing facts.\n\n${brief}`
    + (designDirective ? `\n\n${designDirective}` : '');

  try {
    const out = await callLLM({
      tier: 'premium',
      systemPrompt,
      userMessage,
      temperature: 0.65,
      // 15000 exceeds the free-tier per-minute token budgets (Groq ~6K TPM,
      // Cerebras ~8K output), which forced an instant 429 and left no working
      // fallback rung. 8000 fits the free rungs so the cascade can actually
      // complete; paid providers (if keyed) still get the full budget.
      maxTokens: 8000,
      timeoutMs: 110000,
      stage: 'landing-page-spatial',
    });
    let html = scrub(out && out.text);
    html = String(html).replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (!/<!doctype/i.test(html) || !/<body/i.test(html) || !/<\/html>/i.test(html)) {
      return res.status(502).json({ error: 'invalid_html_generation' });
    }
    // Cascaded design loop: score the generated page and, when wall-clock budget
    // remains, apply ONE critique-driven revision to lift design quality. Budget-
    // aware — it skips cleanly if time is short, so the base page always ships.
    let quality = null;
    const refine = String(process.env.LP_DESIGN_REFINE || '').toLowerCase() !== 'off' && body.refine !== false;
    if (refine && runDesignLoop) {
      const budget = 118000 - (Date.now() - t0); // stay under the 120s function cap
      if (budget > 30000) {
        try {
          const r = await runDesignLoop({ html, brief, market, store, channel, timeBoxMs: budget, userGeminiKey: body.userGeminiKey || body.geminiKey || '', scrub });
          html = r.html; quality = r.quality;
        } catch (_) { /* keep the base page */ }
      }
    }
    return res.status(200).json({ ok: true, html, quality });
  } catch (error) {
    const msg = error && error.message ? error.message : String(error);
    const busy = /rate limit|rate.?limit|quota|429|credit|balance|insufficient|overloaded/i.test(msg);
    return res.status(busy ? 503 : 500).json({
      error: busy ? 'providers_busy' : 'generation_failed',
      detail: busy
        ? 'AI providers are rate-limited or out of quota right now. Please retry in a minute. For reliable generation, add a paid provider key (OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY) in Vercel.'
        : msg
    });
  }
};

