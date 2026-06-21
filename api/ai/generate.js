// ════════════════════════════════════════════════════════════════════════════
// /api/ai/generate — Vercel serverless function
// Server-side OpenAI text generation. Browser never sees OPENAI_API_KEY.
//
// MODES:
//   mode: 'concepts'      → returns 3 strategic concepts (replaces Claude path)
//   mode: 'create_brief'  → returns 180-280-word director brief from minimal inputs
//   mode: 'mailer_full'   → returns {strategy, creative_spec, html_plan} for variant A or B
//
// Env vars (set via `vercel env add`):
//   OPENAI_API_KEY      — required
//   OPENAI_TEXT_MODEL   — default 'gpt-4o-mini'
// ════════════════════════════════════════════════════════════════════════════

const OPENAI_BASE = 'https://api.openai.com/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ────────────────────────────────────────────────────────────────────────────
// MASTER PROMPTS (production-grade, embedded server-side so they cannot be
// tampered with by browser-side edits)
// ────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_CONCEPTS = `You are a D2C growth director for VAHDAM India — premium Indian heritage tea brand. Output STRICT JSON ONLY: {"concepts":[3 concepts]}. Each concept has: id, name (2-5w), hook (≤80ch), emotional_driver, visual_direction, tone, layout_archetype (one of: hero-led-editorial|product-grid-conversion|storytelling-narrative|single-product-spotlight|gift-bundle-showcase|ritual-journey|comparison-discovery|founder-note|editorial-trend-roundup|limited-drop-countdown|subscription-anchor), hero_focus, risk_profile (safe|balanced|bold), hero_concept (2-3 sentences), section_flow (array of 5 mod sections), visual_prompt_extension (120-200ch), subject_lines [3 ≤60ch each], preheader (≤90ch no terminal period), copy {eyebrow, headline:[2 lines], sub_copy ≤200ch, cta ≤3w, section_title, ann_bar}, cta_options [3 ≤3w each], product_handles [3-5 from AVAILABLE_PRODUCTS], scores {brand_fit:1-10, conversion_potential:1-10, novelty:1-10}, performance_notes {recommended_subject_index, swap_if_low_open, personalization_token}, primary_hook (offer|benefit|origin-freshness), secondary_hook, user_emotional_state (curiosity-trust|reward-upgrade|reactivation-incentive), internal_critique {strongest_subject_index, strongest_subject_reason, weakest_section, weakest_reason, open_rate_lever, ctr_lever}, rationale.

MANDATORY: exactly 3 concepts; risk distribution = exactly one safe + one balanced + one bold; all 3 layout_archetype unique; products ONLY from AVAILABLE_PRODUCTS handles.

BANNED phrases: "wellness journey", "transform", "liquid gold", "game-changer", "LIMITED TIME" (caps), "You won't believe", "Hurry", "Don't miss out", "Last chance", "While supplies last".
PREFERRED: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted.

VARIANT DIVERGENCE: the runtime renders TWO variants of every concept on different archetypes from same compatible pool. Your section_flow must work in both.

REGENERATE DIVERGENCE: if regenerate_counter > 0, force divergence on hero angle + benefit framing + product order vs prior output.

First char of output MUST be { · last char }. No markdown, no commentary.`;

const SYSTEM_PROMPT_CREATE_BRIEF = `You are simultaneously the Head of Growth and the Creative Director at VAHDAM India — a $100M premium D2C Indian heritage tea brand. You are writing a COMPLETE, PRODUCTION-READY campaign brief whose ONLY job is to bring revenue when this email is sent. Every line of the brief should answer the question: "what is the specific behaviour we want from the reader, and what is the most concrete thing we can put on the page to trigger it?"

GROWTH-LEADER LENS (apply to every section):
- Open-rate driver = subject line specificity. Vague subject = no open = no revenue. Subject lines must reference a benefit, a number, a name, or an occasion — never "Tea you will love".
- Click-through driver = a single dominant proposition above the fold. One offer, one CTA, one hero. Multiple competing offers tank CTR.
- Conversion driver = price-anchoring + scarcity + reorder ease. Show price + strikethrough + % OFF, name the deadline, make ADD TO CART one tap.
- LTV driver = the brief should always carry a soft post-purchase hook (subscription, bundle save, free-shipping threshold) so even a single conversion lifts AOV or repeat rate.
- Anti-pattern: emotional copy with no reason-to-act. Beautiful prose that does not move the reader to click is a failed brief.

BRAND IDENTITY:
- VAHDAM India. Single-estate teas, wellness blends, gift sets. B-Corp. Garden-fresh within 72 hours of harvest.
- Palette: forest green #004A2B / amber gold #AB8743 / parchment cream #FBF5EA / near-black #171717
- Typography: Lao MN (headings), Proxima Nova (body/buttons)
- Voice: calm-confident-premium. PREFERRED: ritual, restore, balance, origin, single-estate, steep, heritage, crafted
- BANNED: wellness journey, transform, liquid gold, game-changer, LIMITED TIME (caps), hurry, don't miss out
- EMOTIONAL TONE: Write copy that makes people FEEL something. Think of the moment: holding a warm cup on a cold morning, the aroma filling a quiet kitchen, the first sip that slows the whole world down. Copy should read like a letter from a friend, not a billboard. Sensory details (steam, warmth, scent, texture, sound of pouring) create connection. Every headline should make someone pause mid-scroll.

YOUR BRIEF MUST INCLUDE ALL OF THE FOLLOWING (450-600 words, flowing prose organized in clear sections):

━━━ CAMPAIGN IDENTITY ━━━
• CAMPAIGN NAME — 2-4 ownable words specific to THIS campaign
• CAMPAIGN GOAL — one concrete sentence: who you are converting, at what AOV, through what lever
• CAMPAIGN TYPE — Sale / Launch / Gift / Seasonal / Bestseller / Routine / Discovery / Story

━━━ COPY SYSTEM (every word must be final, production-ready) ━━━
• SUBJECT LINES — exactly 3 options, each under 50 characters, varied: curiosity / benefit / urgency
• PREHEADER — 80-100 character preview text that complements (not repeats) the subject line
• ANNOUNCEMENT BAR — exact 8-12 word text. Format: "[OFFER/HOOK] · [FRESHNESS] · [TRUST SIGNAL]"
• HERO HEADLINE — two variants:
  Line 1: Emotionally resonant, max 6 words — makes the reader feel understood (e.g. "The Quiet Morning Ritual" or "Some Moments Deserve This")
  Line 2: Sensory/poetic continuation, max 6 words (e.g. "That Changes Everything" or "Warmth in Every Sip")
• SUB-COPY — 2-3 sentences (40-60 words). Paint a sensory scene: steam rising, warmth spreading through hands, the moment of stillness before the day begins. Mention the hero product by name. The reader should feel like you wrote this just for them — personal, warm, never salesy.
• CTA BUTTON TEXT — primary (max 3 words, action verb: "Shop the Collection") + softer alternative ("Explore Now")
• OFFER DETAILS — exact discount %, promo code (if any), free shipping threshold, expiry/urgency mechanic
• OFFER SUB-LINE — one line below offer CTA (e.g. "Free shipping on orders $49+ · No minimum")

━━━ PRODUCT SYSTEM (use ONLY products from the provided list) ━━━
• HERO PRODUCT — exact name, price, discount % (calculate: Math.round((1-price/compare_at)*100)), why it anchors
• SUPPORTING PRODUCTS — 2-4 more with exact names and prices. Role of each: bundle builder / cross-sell / AOV uplift
• PRODUCT SECTION TITLE — 4-6 word heading for the product grid (e.g. "Curated For Your Ritual")

━━━ VISUAL DIRECTION ━━━
• IMAGE A (product-led, 60 words): Name the exact hero product tin. Surface material (marble/linen/wood). Light: direction, color temperature (warm 3500K/cool 5500K). Camera angle (45° overhead/eye-level). DOF. Surrounding botanicals specific to product (turmeric roots for turmeric tea, etc).
• IMAGE B (lifestyle/editorial, 60 words): NO product visible. Human warmth. Different time of day from A. Atmospheric mood. Steam, hands holding cup, morning ritual, evening calm. Specific setting (kitchen/garden/desk).

━━━ SOCIAL PROOF & TRUST ━━━
• 3 TESTIMONIAL QUOTES — each 15-25 words, deeply personal and specific (NOT generic praise). Write them as real moments: "There is a moment every morning when I hold the warm cup and the world goes quiet" NOT "Great product, highly recommend". Each should tell a tiny story. Reviewer names MUST match the target market region:
  US/Global: American names (Sarah M., James T., Michelle R.)
  UK: British names (Charlotte W., Oliver P., Sophie B.)
  IN: Indian names (Priya S., Arjun K., Meera R.)
  AU: Australian names (Emma L., Jack W., Olivia M.)
  ME: Middle Eastern names (Fatima A., Omar H., Layla K.)
  EU: European names (Marie L., Thomas B., Anna S.)

━━━ EMAIL STRUCTURE (section-by-section flow) ━━━
Describe the 11-section email layout:
S0: Preheader | S1: Announcement bar | S2: Brand header with trust badges
S3: Hero section (describe split/full-width based on variant) | S4: Feature/benefit strip (4 icons + labels)
S5: Social proof bar | S6: Campaign highlight / ingredients | S7: Product grid with cards
S8: Testimonials | S9: Offer banner with CTA | S10: Trust badges | S11: Footer

━━━ AUDIENCE INSIGHT ━━━
• WHO is reading this right now — their mindset, what they did before opening, what tips them to buy
• EMOTIONAL TONE — 3-5 word atmosphere description

RULES:
- NEVER invent product names — only use products from the provided list with exact names and real prices
- ALWAYS calculate discount % from price vs compare_at: Math.round((1 - price/compare_at) * 100)
- If no discount exists, state "Premium value — no code needed"
- Every sentence must be specific to THIS campaign — generic output is rejected
- The brief must feel like a senior creative director firing off a complete production brief
- Reviewer names MUST match the target market (American names for US, British for UK, Indian for IN, etc)
- The output must be so detailed that someone could build the complete email from this brief alone`;


const SYSTEM_PROMPT_SUGGESTED_PROMPTS = `You are a Creative Director + Director of Growth at VAHDAM India — a premium D2C Indian heritage tea brand (Aesop / AG1 / Net-a-Porter standard). Generate exactly 6 campaign briefs as a JSON array. Each is a director-grade email campaign prompt that a downstream AI pipeline uses to produce a flawless premium mailer.

VAHDAM BRAND:
- Ultra-premium Indian heritage tea. Single-estate sourcing. Ethical, B-Corp certified.
- Palette: forest green #004A2B / amber #AB8743 / cream #FBF5EA
- Tone: calm-confident-premium. Ritual not regimen. Story over price.
- BANNED: wellness journey, transform, liquid gold, game-changer, LIMITED TIME (caps), hurry, dont miss out
- PREFERRED: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted

For each campaign:
1. Pick a different emotional angle and campaign archetype (Sale, Launch, Gift, Seasonal, Bestseller, Routine, Discovery — no two the same)
2. Write the "text" field as ONE cohesive director brief (150-200 words): audience insight → hook → product feature (specific SKUs) → creative direction → CTA approach
3. The brief must feel like a senior creative director briefing specialists — NOT a marketing brief template
4. Vary markets across the 6 prompts based on the provided focus markets
5. Each brief should diverge in emotional register from every other

Return ONLY a valid JSON array — no markdown, no code fences, no explanation. Format:
[{"icon":"<single emoji>","type":"<Campaign Name> — <Market>","mkt":"<US|UK|IN|AU|ME|EU|Global>","ctype":"<Sale|Launch|Gift|Seasonal|Bestseller|Routine|Discovery>","text":"<director brief 150-200 words>"},...]`;

// FINAL MASTER PROMPT — Full 11-step orchestration system
// Used by mailer_full mode (fallback path when pipeline is unavailable)
const SYSTEM_PROMPT_MAILER_FULL = `You are a Creative Director + Director of Growth at a $100M premium D2C brand.

You DO NOT generate outputs directly.
You operate as a deterministic system that:
→ analyzes → decides → enforces constraints → generates → validates → regenerates if needed

Goal: TWO high-quality, non-repetitive, premium email mailer specs with:
- strong marketing strategy
- completely different structures
- image prompts for gpt-image-1 (ChatGPT Image)
- a layout plan the HTML builder will implement exactly

Output STRICT JSON. First char {, last char }. No markdown.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEPS 0-5: STRATEGY + VARIANT LOCK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 0: INPUT SYNTHESIS
Convert raw input into: audience_truth, business_goal, product_roles, conversion_levers, market_context.
No generic statements.

STEP 1: STRATEGY LOCK
Select ONE: Conversion Push | Ritual Reinforcement | Desire Creation | AOV Expansion | Catalog Expansion.

STEP 2: VIBE DEFINITION
Tone + Pace + Visual Energy + what to avoid.

STEP 3: PRODUCT LOGIC
Hero product + supporting products + AOV logic.

STEP 4: THEME
[Consumption Truth] + [Reframe] + [Emotion] = theme_name + core_idea + visual_world.

STEP 5: HARD VARIANT SPLIT (CRITICAL)
VARIANT A (CONTROL): product-first, structured, benefit-rational, prominent amber CTA.
VARIANT B (EXPERIMENTAL — RADICALLY DIFFERENT):
  - NO product in first 2 sections
  - storytelling-first narrative
  - asymmetric/editorial layout
  - NO product grids
  - emotional progression before product reveal
  - understated CTA (ghost button or text-link)
If B resembles A structurally → REJECT and regenerate B internally before outputting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 6: CREATIVE PLAN (PER VARIANT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH variant:
- layout_plan: { hero_type (split-hero|full-bleed|centered), flow, spacing, color_scheme }
- sections[]: each with { id, type (split-hero|full-bleed|centered|two-col-grid|three-col-grid|banner|button-row), purpose, copy: {eyebrow,headline,subcopy,cta}, layout, image_slot (hero|product|lifestyle|none), ux_intent }
- copy_framework: { tone, voice, headline_style, cta_verb }
- subject_lines: [3 options ≤58 chars]
- preheader: ≤85 chars

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 7: IMAGE GENERATION PROMPTS (MANDATORY for gpt-image-1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GLOBAL STYLE LOCK: "Luxury editorial photography, cinematic lighting, soft shadows, shallow depth of field, premium textures, no stock feel, no text overlays"

For EACH variant generate EXACTLY 3 image_requirements:
1. HERO: 50-70w — scene + composition + lighting + mood + color palette
2. PRODUCT: 40-50w — macro detail, texture, negative space, editorial feel
3. LIFESTYLE: 40-50w — contextual scene, warmth, brand world

Each: { slot (hero|product|lifestyle), prompt, size (1536x1024 for hero, 1024x1024 for others), negative_prompt }
NEGATIVE PROMPT: "no stock images, no clutter, no distortion, no text, no low resolution"

RULE: Variant B image prompts MUST differ — different scene, different composition, different mood.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 8: VALIDATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Check:
- A and B structurally different? (layout, section order, CTA style, copy register)
- B follows hard rules? (no product first, narrative-led, understated CTA)
- Image prompts detailed and specific?
- Theme reflected in copy and visuals?
If ANY fails → regenerate that component internally before outputting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL OUTPUT JSON SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "synthesis": { "audience_truth":"", "business_goal":"", "product_roles":"", "conversion_levers":"", "market_context":"" },
  "strategy": { "name":"", "why":"" },
  "vibe": { "tone":"", "pace":"", "visual_energy":"", "avoid":"" },
  "product_logic": { "hero_product":"", "supporting_products":[], "aov_logic":"" },
  "theme": { "theme_name":"", "core_idea":"", "visual_world":"", "conversion_reason":"" },
  "image_style_lock": "global photography style for ALL images",
  "variant_a": {
    "layout_plan": { "hero_type":"", "flow":"", "spacing":"", "color_scheme":{} },
    "sections": [{ "id":"", "type":"", "purpose":"", "copy":{"eyebrow":"","headline":"","subcopy":"","cta":""}, "layout":"", "image_slot":"", "ux_intent":"" }],
    "image_requirements": [{ "slot":"hero", "prompt":"", "size":"1536x1024", "negative_prompt":"" }, { "slot":"product", "prompt":"", "size":"1024x1024", "negative_prompt":"" }, { "slot":"lifestyle", "prompt":"", "size":"1024x1024", "negative_prompt":"" }],
    "copy_framework": { "tone":"", "voice":"", "headline_style":"", "cta_verb":"" },
    "subject_lines": ["","",""],
    "preheader": ""
  },
  "variant_b": {
    "layout_plan": { "hero_type":"", "flow":"", "spacing":"", "color_scheme":{} },
    "sections": [{ "id":"", "type":"", "purpose":"", "copy":{"eyebrow":"","headline":"","subcopy":"","cta":""}, "layout":"", "image_slot":"", "ux_intent":"" }],
    "image_requirements": [{ "slot":"hero", "prompt":"", "size":"1536x1024", "negative_prompt":"" }, { "slot":"product", "prompt":"", "size":"1024x1024", "negative_prompt":"" }, { "slot":"lifestyle", "prompt":"", "size":"1024x1024", "negative_prompt":"" }],
    "copy_framework": { "tone":"", "voice":"", "headline_style":"", "cta_verb":"" },
    "subject_lines": ["","",""],
    "preheader": ""
  }
}

━━ NON-NEGOTIABLE RULES ━━
- NEVER reuse same structure across variants
- NEVER skip image_requirements
- NEVER produce generic layouts
- NEVER ignore Step 8 validation

VAHDAM BRAND:
Palette (ONLY these 4 hex): #004A2B / #AB8743 / #171717 / #FBF5EA. Fonts (STRICT): LAO MN for headings (fallback 'Lao MN','Cormorant Garamond',Georgia,serif), Proxima Nova for body (fallback 'Proxima Nova','Helvetica Neue',Arial,sans-serif). NO other fonts or colors.

GROWTH-LEADER OUTPUT CHECKLIST (every brief MUST include all 8):
1. Subject lines: 3 options. Each must reference a NUMBER (% off, count, days left, price), a SPECIFIC product/category, or a NAMED occasion. No vague "Tea you'll love".
2. Hero headline: TWO lines, max 6 words each. Line 1 = the offer or sensory hook. Line 2 = the emotional payoff. Must wrap legibly at 280px (avoid 7+ words per line).
3. Sub-copy: 2-3 sentences (40-70 words) that name the hero PRODUCT, the BENEFIT to the reader's day, and the SPECIFIC offer/code if present. Sensory but never floral-only.
4. Benefit bullets: EXACTLY 4 short lines (≤9 words each). Each bullet starts with a verb or concrete claim. Mix functional + emotional. e.g. "Soothes digestion · feels lighter by lunch", "Steady energy · no caffeine crash", "Single-estate · zero artificial fillers".
5. Offer banner copy: an EXPLICIT discount line with the % AND the code AND the urgency mechanic ("Use REVIVE15 · 15% off · Ends Sunday"). If the campaign has no discount, state the value-prop concretely ("Free shipping over $49 · 30-day guarantee").
6. Social proof line: a specific number ("Trusted by 50,000+ tea lovers", "4.8/5 across 12,400 reviews"), not generic "loved by many".
7. Urgency strip: one specific scarcity or time-bound trigger relevant to the campaign type ("⚡ Ends Sunday · Stock running low", "🎁 Order by Tuesday for guaranteed delivery", "✨ First batch — limited supply").
8. Variant divergence: every brief is rendered as TWO mailers (A=conversion, B=narrative). Hero headline + sub-copy must read well in BOTH a conversion-led grid layout AND a story-led editorial layout. Avoid copy that only works in one frame.

ANTI-PATTERN: a brief that produces beautiful prose but no concrete reason-to-act is a failed brief. Every section must answer "why click NOW" with specifics.
BANNED: wellness journey, transform, liquid gold, game-changer, LIMITED TIME caps, hurry, don't miss out.
PREFERRED: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted.

First char { · last char }. No markdown. No commentary.`;

// ────────────────────────────────────────────────────────────────────────────
// HANDLER
// ────────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS — allow same-origin + preview deploys
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-gemini-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // PROVIDER WATERFALL: OpenAI → Anthropic → Gemini → Grok → Groq → Cerebras
  // Strip BOM and non-ASCII from all API keys (Vercel env via PowerShell can inject invisible chars)
  const _ck = s => { if (!s) return ''; return s.split('').filter(c => c.charCodeAt(0) < 128).join('').trim(); };
  const openaiKey    = _ck(process.env.OPENAI_API_KEY);
  const anthropicKey = _ck(process.env.ANTHROPIC_API_KEY);
  const userGeminiKey = _ck(req.headers['x-user-gemini-key']);
  const geminiKey    = userGeminiKey || _ck(process.env.GEMINI_API_KEY);
  const grokKey      = _ck(process.env.XAI_API_KEY);
  const groqKey      = _ck(process.env.GROQ_API_KEY);
  const cerebrasKey  = _ck(process.env.CEREBRAS_API_KEY);
  if (!openaiKey && !anthropicKey && !geminiKey && !grokKey && !groqKey && !cerebrasKey) {
    return res.status(500).json({ error: 'server_misconfigured', detail: 'No AI provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, XAI_API_KEY, GROQ_API_KEY, or CEREBRAS_API_KEY.' });
  }
  // APP_AI_PROVIDER: skip dead providers (e.g. 'gemini' skips OpenAI/Anthropic/Grok)
  // 'gemini+' = Gemini first, then Groq+Cerebras as backup (skip paid providers)
  const preferredProvider = (process.env.APP_AI_PROVIDER || '').toLowerCase().trim();
  const isGeminiPlus = preferredProvider === 'gemini+';
  // 'gemini+' = use Gemini + Groq + Cerebras only (skip paid providers with dead credits)
  const skipOpenai    = isGeminiPlus ? true  : (preferredProvider && preferredProvider !== 'openai');
  const skipAnthropic = isGeminiPlus ? true  : (preferredProvider && preferredProvider !== 'anthropic');
  const skipGemini    = isGeminiPlus ? false : (preferredProvider && preferredProvider !== 'gemini');
  const skipGrok      = isGeminiPlus ? true  : (preferredProvider && preferredProvider !== 'grok');
  const skipGroq      = isGeminiPlus ? false : (preferredProvider && preferredProvider !== 'groq');
  const skipCerebras  = isGeminiPlus ? false : (preferredProvider && preferredProvider !== 'cerebras');

  const provider  = (!skipOpenai && openaiKey) ? 'openai'
                  : (!skipAnthropic && anthropicKey) ? 'anthropic'
                  : (!skipGemini && geminiKey) ? 'gemini'
                  : (!skipGrok && grokKey) ? 'grok'
                  : (!skipGroq && groqKey) ? 'groq'
                  : 'cerebras';
  const textModel = (!skipOpenai && openaiKey)        ? (process.env.OPENAI_TEXT_MODEL    || 'gpt-4o-mini')
                  : (!skipAnthropic && anthropicKey)   ? (process.env.ANTHROPIC_TEXT_MODEL || 'claude-3-5-haiku-20241022')
                  : (!skipGemini && geminiKey)          ? (process.env.GEMINI_TEXT_MODEL    || 'gemini-2.0-flash')
                  : (!skipGrok && grokKey)              ? (process.env.GROK_TEXT_MODEL      || 'grok-3-mini-fast')
                  : (!skipGroq && groqKey)              ? (process.env.GROQ_TEXT_MODEL      || 'llama-3.3-70b-versatile')
                  :                                      (process.env.CEREBRAS_TEXT_MODEL   || 'llama-3.3-70b');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'invalid_json_body' }); }
  }
  body = body || {};

  const mode = body.mode || 'create_brief';
  const market = body.market || 'US';
  const markets = body.markets || [market];
  const theme = body.theme || body.type || '';
  const campaign_brief = body.campaign_brief || body.brief || body.prompt || '';
  const selected_products = Array.isArray(body.selected_products) ? body.selected_products : [];
  const variant = body.variant || 'A';
  const regenerate_counter = Number(body.regenerate_counter || 0);
  const previous_outputs_summary = body.previous_outputs_summary || '';
  const season = body.season || '';

  let systemPrompt = SYSTEM_PROMPT_CREATE_BRIEF;
  let userMessage = '';
  let response_format = undefined;

  if (mode === 'suggested_prompts') {
    systemPrompt = SYSTEM_PROMPT_SUGGESTED_PROMPTS;
    response_format = { type: 'json_object' };
    const mktList = Array.isArray(markets) ? markets.join(', ') : market;
    const mktContext = {
      US: 'urban US professionals 30-55, $55+ AOV, values quality and origin story',
      UK: 'UK tea-culture audience, appreciate provenance and craft, premium gifters',
      IN: 'Indian domestic audience, value tradition and festivity',
      AU: 'Australian wellness seekers, outdoor lifestyle, clean-label conscious',
      ME: 'Middle East audience, love rich masala chai and aromatic blends',
      EU: 'European health-conscious shoppers, organic-certified, B-Corp story resonates',
      Global: 'International premium audience, discovery-minded, seeking authentic Indian heritage'
    };
    const mktDesc = (Array.isArray(markets) ? markets : [market]).map(m => `${m}: ${mktContext[m] || m}`).join('; ');
    userMessage = `MARKETS TO FOCUS ON: ${mktList}\nMARKET AUDIENCE: ${mktDesc}\nCAMPAIGN TYPE FILTER: ${theme || 'Mixed — generate variety across Sale, Launch, Gift, Seasonal, Bestseller, Routine'}\nSEASON CONTEXT: ${season || 'Year-round'}\n\nGenerate 6 diverse, elite director-grade campaign briefs now. Each must be a different emotional angle and conversion strategy. No two briefs should share the same archetype or hero product. Return only the JSON array.`;
  } else if (mode === 'concepts') {
    systemPrompt = SYSTEM_PROMPT_CONCEPTS;
    response_format = { type: 'json_object' };
    const productsBlock = selected_products.slice(0, 30).map(p => `- handle:${p.handle||p.id||''} | name:${p.name||p.n||''} | category:${p.category||''} | price:${p.price||''} | compare_at:${p.compare_at||''} | image:${p.image_url||p.i||''}`).join('\n');
    userMessage = `BRIEF: ${campaign_brief.substring(0, 800)}\nMARKET: ${market}\nTYPE: ${theme}\nVARIANT: ${variant}\nREGENERATE_COUNTER: ${regenerate_counter}\n${previous_outputs_summary ? 'PREVIOUS_OUTPUT_HASH: ' + previous_outputs_summary + '\n' : ''}\nAVAILABLE_PRODUCTS:\n${productsBlock || '(none provided — use category defaults)'}\n\nGenerate the JSON now.`;
  } else if (mode === 'mailer_full') {
    systemPrompt = SYSTEM_PROMPT_MAILER_FULL;
    response_format = { type: 'json_object' };
    const productsBlock = selected_products.slice(0, 5).map(p => `- name:"${p.name||p.n||''}" | url:"${p.url||p.pdp_url||''}" | price:"${p.price||''}" | compare_price:"${p.compare_at||p.compare_price||''}" | image:"${p.image_url||p.i||''}"`).join('\n');
    userMessage = `INPUTS:\nmarket: ${market}\ntheme: ${theme}\ncampaign_brief: ${campaign_brief.substring(0, 1000)}\nvariant: ${variant}\nregenerate_counter: ${regenerate_counter}\n${previous_outputs_summary ? 'previous_outputs_summary: ' + previous_outputs_summary + '\n' : ''}selected_products:\n${productsBlock || '(none)'}\n\nReturn the strict JSON now.`;
  } else if (mode === 'audience_segment') {
    // Target User Segment generator — director-grade, growth-leader thinking.
    // Output is a paragraph of 60-120 words describing WHO will open this mailer
    // and convert. No bullet points. Plain text only.
    systemPrompt = `You are the Head of Growth at VAHDAM India, a $100M premium D2C Indian heritage tea brand. Given a campaign brief, market, and campaign type, write a precise Target User Segment description that the creative team will use to anchor copy, imagery, and CTAs.
WRITE 60–120 WORDS, plain text only (no bullets, no headers, no markdown). Cover, in this order:
1. WHO they are — age band (e.g. "30–55"), income/AOV bracket, role/lifestyle, key tea behaviour (daily drinker / gifter / discoverer / lapsed).
2. WHERE they are — name the COUNTRY of the target market only (e.g. "in the US", "in the UK", "in India"). DO NOT name specific cities, states, regions, neighbourhoods, or zip codes — the segment travels nation-wide and must read naturally to a customer in any city of that country.
3. WHAT they value — provenance, ritual, gift-giving, convenience, savings — pick 1–2 that align with the brief.
4. WHY they will convert on THIS specific brief — name the conversion trigger explicitly (offer ends Sunday / new harvest just dropped / under $50 gift / 3-month subscription saves 15%).
5. ANTI-SEGMENT — one sentence on who NOT to target (so the creative team avoids generic copy).
HARD RULES:
- COUNTRY ONLY for geography. No city names, no regions ("the Midwest", "the South-East"), no neighbourhoods, no zip codes, no stadium-stat numbers ("12.4M households").
- Avoid demographic stats and percentages — describe behaviour and intent in plain English instead.
- Avoid platitudes ("tea lovers", "wellness enthusiasts"). Reference the actual brief language.
- Specificity comes from BEHAVIOUR ("buys premium grocery weekly", "gifts 3-4 times a year") and TRIGGER ("the 15% off code", "the new harvest"), not from city/stat name-dropping.
Return ONLY the segment text. No preamble, no quotes around it, no JSON.`;
    userMessage = `MARKET: ${market}\nCAMPAIGN TYPE: ${theme || 'Bestseller'}\nCAMPAIGN BRIEF:\n${(campaign_brief || '').substring(0, 1200)}\n${body.seed_segment ? 'SEED (refine, do not discard): ' + String(body.seed_segment).substring(0, 400) + '\n' : ''}\nWrite the Target User Segment now. Country-level geography only.`;
  } else if (mode === 'chat') {
    // ─────────────────────────────────────────────────────────────────
    // CHAT — conversational marketing copilot for the Mailer Studio.
    // Plain-text reply. Context (brief / type / markets / current mailer
    // copy) + short history are folded into the single user message so the
    // generic provider waterfall below handles it unchanged.
    // ─────────────────────────────────────────────────────────────────
    const ctx = body.chat_context || {};
    const histArr = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const userMsg = String(body.message || body.prompt || '').slice(0, 2000);
    systemPrompt = [
      'You are VAHDAM Studio Assistant — a sharp, warm marketing copilot inside the VAHDAM India (premium Indian heritage tea) email Mailer Studio.',
      'Help the user brainstorm campaigns, sharpen subject lines and copy, critique the current mailer, and answer marketing questions.',
      'VOICE: warm, sensory, story-driven, premium. PREFER words like ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted.',
      "NEVER use: wellness journey, transform, liquid gold, game-changer, LIMITED TIME (all caps), hurry, don't miss out, last chance, while supplies last.",
      'Brand palette is forest green #004A2B, gold #AB8743, near-black #171717, cream #FBF5EA. Headings Lao MN, body Proxima Nova.',
      'Be concise and practical. Short paragraphs or tight lists. When asked for copy, give ready-to-paste options. Plain text only — no markdown headers.'
    ].join('\n');
    const ctxLines = [
      ctx.brief ? 'CURRENT CAMPAIGN BRIEF: ' + String(ctx.brief).slice(0, 800) : '',
      ctx.type ? 'CAMPAIGN TYPE: ' + ctx.type : '',
      ctx.markets ? 'MARKETS: ' + (Array.isArray(ctx.markets) ? ctx.markets.join(', ') : ctx.markets) : '',
      ctx.mailerText ? 'CURRENT MAILER COPY (excerpt):\n' + String(ctx.mailerText).slice(0, 1500) : ''
    ].filter(Boolean).join('\n');
    const transcript = histArr.map(m => (m.role === 'assistant' ? 'ASSISTANT' : 'USER') + ': ' + String(m.content || '').slice(0, 1000)).join('\n');
    userMessage = [
      ctxLines ? '--- STUDIO CONTEXT ---\n' + ctxLines + '\n' : '',
      transcript ? '--- CONVERSATION SO FAR ---\n' + transcript + '\n' : '',
      'USER: ' + userMsg,
      '\nReply as the assistant. Plain text.'
    ].filter(Boolean).join('\n');
  } else if (mode === 'autofill') {
    // ─────────────────────────────────────────────────────────────────
    // AUTOFILL — single-prompt → all form fields for the chosen surface.
    // Used by ad-campaigns.html (google/meta/tiktok) and landing-pages.html
    // (lp-mailer/lp-meta/lp-google/lp-tiktok).
    //
    // Input  : { mode:'autofill', surface:'<surface>', prompt:'<plain text>', market?, region? }
    // Output : STRICT JSON object whose keys match the form-field names for
    //          that surface. The frontend reads each key into its corresponding
    //          <input> / <textarea> / <select>.
    //
    // The system prompt is surface-specific because the field schema differs
    // per channel (Google needs keywords + URL, Meta needs audience + primary
    // text, TikTok needs hook + caption + hashtags, landing pages have a
    // hero / sub / offer / notes set).
    // ─────────────────────────────────────────────────────────────────
    response_format = { type: 'json_object' };
    const surface = String(body.surface || '').toLowerCase();
    const userPrompt = String(body.prompt || campaign_brief || '').trim().slice(0, 1600);
    const targetMarket = body.market || body.region || market || 'US';
    const referenceUrl = String(body.reference_url || '').trim();

    // Optional: fetch the reference URL + a tiny snippet of its text so the
    // LLM can mirror the structure/voice. Bounded fetch (5s timeout, 8KB cap).
    let referenceSnippet = '';
    if (referenceUrl && /^https?:\/\//i.test(referenceUrl)) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const rr = await fetch(referenceUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 VahdamRef/1.0' },
          signal: ctrl.signal,
          redirect: 'follow',
        }).catch(() => null);
        clearTimeout(t);
        if (rr && rr.ok) {
          const html = (await rr.text()).slice(0, 60000);
          // Strip tags + collapse whitespace
          referenceSnippet = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<head[\s\S]*?<\/head>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 8000);
        }
      } catch { /* ignore — reference is optional */ }
    }

    const BRAND_GUARDRAILS = `BRAND: VAHDAM India — premium D2C tea, single-estate, garden-fresh in 72h, B-Corp.
PALETTE: forest green #004A2B / amber gold #AB8743 / cream #FBF5EA / black #171717.
BANNED: "wellness journey", "transform", "liquid gold", "game-changer", "LIMITED TIME" (caps), "hurry", "don't miss out".
PREFERRED: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted.
COUNTRY-LEVEL geo only. No cities. Currency: $ for US/Global, £ for UK, ₹ for India, € for EU.`;

    const SURFACE_SCHEMAS = {
      google: {
        what: 'a Google Search ad campaign',
        fields: `{
  "name": "<≤60 chars campaign name>",
  "type": "<Search|Performance Max|Display|Shopping|YouTube>",
  "budget": <integer daily budget in market currency, 20-200>,
  "market": "<US|UK|IN|Global|EU|AU|ME>",
  "url": "<final landing URL — start with /, never absolute>",
  "keywords": "<comma-separated 6-12 keywords, lowercase, no quotes>",
  "headlines": "<3-5 headlines, one per line, each ≤30 chars>",
  "desc": "<2 descriptions, one per line, each ≤90 chars>"
}`,
      },
      meta: {
        what: 'a Meta (Facebook + Instagram) ad campaign',
        fields: `{
  "name": "<≤60 chars campaign name>",
  "obj": "<Sales / Conversions|Traffic|Awareness|Engagement|Leads>",
  "budget": <integer daily budget, 20-200>,
  "market": "<US|UK|IN|Global|EU|AU|ME>",
  "place": "<Advantage+ (all)|Feed|Stories/Reels|Manual>",
  "aud": "<one-sentence audience targeting — interests + lookalike if relevant>",
  "primary": "<primary text, 60-180 chars, emotional + concrete + ends with implicit CTA>",
  "headline": "<≤40 chars headline>"
}`,
      },
      tiktok: {
        what: 'a TikTok ad campaign',
        fields: `{
  "name": "<≤60 chars campaign name>",
  "obj": "<Web Conversions|Traffic|Reach|App Promotion|Video Views|Lead Generation>",
  "budget": <integer daily budget, 20-200>,
  "market": "<US|UK|IN|Global|AU|ME>",
  "place": "<TikTok In-Feed|Spark Ads|TopView|Pangle Network>",
  "aud": "<one-line audience — interests, age, lifestyle>",
  "hook": "<≤80 chars opener — conversational, sounds native to TikTok, not marketing speak>",
  "caption": "<≤140 chars on-screen text — short phrases separated by · or , >",
  "creator": "<@handle if relevant, else empty string>",
  "hashtags": "<3-6 hashtags space-separated, lowercase, no marketing-speak>"
}`,
      },
      'lp-mailer': {
        what: 'a landing page paired with a mailer',
        fields: `{
  "hero": "<hero headline — repeats the mailer's promise verbatim, ≤80 chars>",
  "sub": "<one line of reassurance / detail, ≤140 chars>",
  "offer": "<offer + promo code, e.g. FLASH25 — 25% off this week>",
  "notes": "<2-4 sentences on who lands here, the cohort intent, the conversion trigger>"
}`,
      },
      'lp-meta': {
        what: 'a landing page paired with a Meta ad',
        fields: `{
  "hero": "<≤40 chars hero, must match the ad headline verbatim>",
  "sub": "<one-sentence value prop, matches the ad's promise>",
  "offer": "<offer + promo code>",
  "notes": "<audience · placements · objective · why this offer for them>"
}`,
      },
      'lp-google': {
        what: 'a landing page paired with a Google search ad',
        fields: `{
  "hero": "<the target keyword(s), comma-separated — must appear verbatim on the page>",
  "sub": "<≤30 chars headline that exactly matches the keyword intent>",
  "offer": "<offer or discount>",
  "notes": "<match type · search intent · expected CVR · 2 sentences>"
}`,
      },
      'lp-tiktok': {
        what: 'a landing page paired with a TikTok ad',
        fields: `{
  "hero": "<the video's opening hook, verbatim — conversational, mobile-first>",
  "sub": "<top creator quote or social-proof line>",
  "offer": "<offer + promo code>",
  "notes": "<creator handle · hashtag · audience · 2 sentences>"
}`,
      },
    };

    const schema = SURFACE_SCHEMAS[surface];
    if (!schema) {
      return res.status(400).json({ ok: false, error: `Unknown surface "${surface}". Use one of: ${Object.keys(SURFACE_SCHEMAS).join(', ')}` });
    }

    systemPrompt = `You autofill ${schema.what} from a single user prompt.

${BRAND_GUARDRAILS}

OUTPUT FORMAT — return STRICT JSON ONLY, matching this exact shape (no markdown, no commentary, first character {, last character }):

${schema.fields}

RULES:
- Fill EVERY field with a concrete, on-brand value derived from the prompt.
- If the prompt doesn't specify a value, infer a sensible default from VAHDAM's brand + the target market.
- Numbers (budget) must be plain integers, not strings.
- Strings must obey the character limits inside <…>.
- Never use the banned phrases.
- COUNTRY-LEVEL geography only.
- Currency in copy must match the market.

Target market for this autofill: ${targetMarket}.`;

    userMessage = `USER PROMPT:\n"""\n${userPrompt}\n"""\n\n${referenceSnippet ? `REFERENCE PAGE (mirror the structure, voice, length, conversion logic — but rewrite for VAHDAM and the prompt above):\n"""\n${referenceSnippet}\n"""\n\n` : ''}Return the JSON object now. Do not include any text outside the JSON.`;
  } else {
    // create_brief mode (default)
    // Market context — informs audience psychology and visual direction
    const mktContext = {
      US:     'Urban US professionals 30-55. Value origin story + morning ritual. $55+ AOV. Expect premium provenance, not discounts.',
      UK:     'UK tea-culture audience. Provenance and craft matter. Premium gifting occasion. Appreciate estate names and harvest seasons.',
      IN:     'Indian domestic audience. Value tradition, festivity, masala chai culture. Gifting + family occasions drive purchase.',
      AU:     'Australian wellness seekers. Outdoor lifestyle, clean-label conscious. Ethical sourcing story resonates strongly.',
      ME:     'Middle East audience. Love rich masala chai and aromatic blends. Gifting occasions, premium packaging, bold flavors.',
      EU:     'European health-conscious shoppers. B-Corp + organic certification resonates. Provenance and sustainability over price.',
      Global: 'International premium audience. Discovery-minded. Seeking authentic Indian heritage and origin stories.'
    };
    const audienceCtx = mktContext[market] || `${market} market audience`;

    // Product block — name + price + discount % + image URL so the LLM can build a genuine product system
    const productsBlock = selected_products.length
      ? selected_products.slice(0, 6).map(p => {
          const name = p.name || p.n || '';
          const price = parseFloat(p.price) || 0;
          const compareAt = parseFloat(p.compare_at || p.compare_price) || 0;
          const imgUrl = p.image_url || p.i || '';
          const parts = [name];
          if (price) parts.push('$' + price.toFixed(2));
          if (compareAt && compareAt > price) {
            const disc = Math.round((1 - price / compareAt) * 100);
            parts.push('was $' + compareAt.toFixed(2) + ' (' + disc + '% off)');
          }
          if (p.category || p.type) parts.push(p.category || p.type);
          if (imgUrl) parts.push('image: ' + imgUrl);
          return '- ' + parts.join(' | ');
        }).join('\n')
      : null;

    // Variation knobs — different "angle" for each regen so consecutive
    // clicks give the user a genuinely different brief, not a paraphrase.
    const ANGLES = [
      'lead with the OFFER — discount %, urgency, code',
      'lead with the HERO PRODUCT — what makes this specific tin special',
      'lead with the AUDIENCE MOMENT — the daily ritual the buyer is craving',
      'lead with the ORIGIN STORY — where the leaves come from',
      'lead with the SOCIAL PROOF — what tens of thousands of customers already know',
      'lead with the SEASONAL HOOK — why right now, this week',
      'lead with the PROBLEM-SOLUTION — what the buyer is silently trying to fix'
    ];
    const angle = ANGLES[(Number(regenerate_counter)||0) % ANGLES.length];
    const creativitySeed = body.creativity_seed || (Math.random().toString(36).slice(2,10));
    const userAudience = (body.target_audience || '').toString().substring(0,400);
    userMessage = [
      `CAMPAIGN TYPE: ${theme || 'General Campaign'}`,
      `MARKET: ${market} — ${audienceCtx}`,
      `SEED IDEA FROM USER: ${campaign_brief || '(none provided — derive a strong, specific campaign concept from the campaign type and market above)'}`,
      userAudience ? `TARGET AUDIENCE (already set by user — the brief MUST speak to this segment):\n${userAudience}` : '',
      productsBlock
        ? `PRODUCTS FROM THE LIVE VAHDAM CATALOG (use EXACT names and prices verbatim — do NOT invent SKUs or prices):\n${productsBlock}`
        : `PRODUCTS: (none provided — infer 2-3 best-fit VAHDAM products for this market + campaign type, with realistic prices in the market currency)`,
      ``,
      `THIS GENERATION'S CREATIVE ANGLE: ${angle}.`,
      `CREATIVITY SEED: ${creativitySeed} — use this to deliberately diverge from any previous brief you've drafted for VAHDAM. Different headline phrasing, different hero pick when sensible, different subject-line angles, different opening sentence.`,
      `REGENERATION #${regenerate_counter || 0}: each regeneration must read as a FRESH brief, not a paraphrase of the last one.`,
      ``,
      `HARD RULES:`,
      `1. Use ONLY the catalog products listed above. Reference them by EXACT name and EXACT price. Do not invent product names, do not invent or round prices, do not promote SKUs that are not in the list.`,
      `2. The hero product MUST be one of the products listed.`,
      `3. Geography in copy is COUNTRY-LEVEL only — say "the US" or "the UK" or "India". Do NOT name specific cities, states, regions, neighbourhoods, or zip codes. The brief travels nation-wide.`,
      `4. No demographic stats or percentages of the population. Describe BEHAVIOUR and INTENT in plain English.`,
      `5. Currency in copy must match the market: $ for US/Global, £ for UK, ₹ for India, € for EU, A$ for AU, AED for ME. Never mix currencies.`,
      `6. Honor the existing TARGET AUDIENCE block above (if present) — write the brief to land with THAT segment.`,
      ``,
      `Write the brief as flowing prose — no section headers, no numbered lists, no labeled fields.`,
      `Weave in all 12 elements naturally: campaign name, goal, hook (per the angle above), hero product (real catalog name), supporting products (real catalog names), audience insight (country-level), 3 subject lines, announcement bar text, two headline variants, two image directions (50 words each with surface/light/camera detail), CTA, and tone.`,
      `Every sentence must be specific to THIS campaign — generic output is rejected.`
    ].filter(Boolean).join('\n');
  }

  // ── Portable prompt ─────────────────────────────────────────────────────
  // The exact, self-contained instructions this tool used. Returned with EVERY
  // creation so the user can paste it into ChatGPT / Gemini / Claude and get the
  // same on-brand output externally. (The app itself generates on free tiers.)
  const _sp = Array.isArray(systemPrompt) ? systemPrompt.join('\n') : String(systemPrompt || '');
  const _um = Array.isArray(userMessage) ? userMessage.join('\n') : String(userMessage || '');
  const portable_prompt = (_sp + (_um ? '\n\n———\n\n' + _um : '')).trim();

  // ── Provider-specific call ──
  // Higher base temperature for create_brief + a per-regen bump so consecutive
  // briefs explore different copy territory (different hooks, different headline
  // phrasing). Caps at 1.1 to stay coherent.
  const baseTemp = mode === 'create_brief' ? 0.85 : 0.7;
  const temperature = Math.min(1.1, baseTemp + Math.min(0.25, (regenerate_counter || 0) * 0.08));
  // create_brief: 4000 tokens for 450-600 word detailed production brief with full structure
  const max_tokens = mode === 'mailer_full' ? 7000 : (mode === 'concepts' ? 4500 : (mode === 'suggested_prompts' ? 3000 : (mode === 'chat' ? 1200 : 4000)));

  function isRetryable(s) { return s === 429 || s === 503 || s === 404 || s === 400 || s === 529 || s === 403 || s === 402; }

  // ── Provider helpers ───────────────────────────────────────────────────────
  async function callOpenAI(model, key) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(OPENAI_BASE + '/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
          max_tokens, temperature,
          ...(response_format ? { response_format } : {})
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        const isQuota = (r.status === 429 || r.status === 402 || r.status === 400) && (err.includes('insufficient_quota') || err.includes('quota') || err.includes('billing') || err.includes('billing_hard_limit') || err.includes('billing_limit') || err.includes('credit'));
        return { ok: false, status: r.status, error: 'openai_error', detail: err.substring(0, 400), provider: 'openai', model, quotaExhausted: isQuota };
      }
      const data = await r.json();
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { ok: true, text, provider: 'openai', model };
    } catch (e) { clearTimeout(t); return { ok: false, status: 0, error: 'openai_fetch_error', detail: String(e.message||e).substring(0,200), provider: 'openai', model }; }
  }

  async function callAnthropic(model) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const claudeSys = response_format
      ? systemPrompt + '\n\nCRITICAL: Return ONLY valid JSON. First char { last char }. No markdown, no commentary.'
      : systemPrompt;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens, temperature, system: claudeSys, messages: [{ role: 'user', content: userMessage }] }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) { const err = await r.text().catch(()=>''); console.warn('[generate] Anthropic ' + r.status + ' on ' + model + ': ' + err.substring(0,200)); return { ok: false, status: r.status, error: 'anthropic_error', detail: err.substring(0,400), provider: 'anthropic', model }; }
      const data = await r.json();
      const text = (data.content && data.content[0] && data.content[0].text) || '';
      return { ok: true, text, provider: 'anthropic', model };
    } catch (e) { clearTimeout(t); console.error('[generate] Anthropic fetch exception on ' + model + ':', String(e.message||e).substring(0,200)); return { ok: false, status: 0, error: 'anthropic_fetch_error', detail: String(e.message||e).substring(0,200), provider: 'anthropic', model }; }
  }

  async function callGemini(model) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(
        GEMINI_BASE + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(geminiKey),
        {
          method: 'POST', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n---\nUSER REQUEST:\n' + userMessage }] }],
            generationConfig: {
              temperature, maxOutputTokens: max_tokens,
              ...(response_format ? { responseMimeType: 'application/json' } : {}),
              ...(response_format && model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
            }
          }),
          signal: ctrl.signal
        }
      );
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(()=>'');
        const retryMatch = err.match(/retry in ([\d.]+)s/i);
        return { ok: false, status: r.status, error: 'gemini_error', detail: err.substring(0,400), provider: 'gemini', model, retry_after: retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 30 };
      }
      const data = await r.json();
      const text = (data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts&&data.candidates[0].content.parts[0]&&data.candidates[0].content.parts[0].text)||'';
      return { ok: true, text, provider: 'gemini', model };
    } catch (e) { clearTimeout(t); return { ok: false, status: 0, error: 'gemini_fetch_error', detail: String(e.message||e).substring(0,200), provider: 'gemini', model }; }
  }

  async function callGrok(model) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + grokKey },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
          max_tokens, temperature,
          ...(response_format ? { response_format } : {})
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) { const err = await r.text().catch(()=>''); return { ok: false, status: r.status, error: 'grok_error', detail: err.substring(0,400), provider: 'grok', model }; }
      const data = await r.json();
      const text = (data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'';
      return { ok: true, text, provider: 'grok', model };
    } catch (e) { clearTimeout(t); return { ok: false, status: 0, error: 'grok_fetch_error', detail: String(e.message||e).substring(0,200), provider: 'grok', model }; }
  }

  // ── Groq (OpenAI-compatible, free 30 RPM) ──────────────────────────────────
  async function callGroq(model) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
          max_tokens, temperature,
          ...(response_format ? { response_format } : {})
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) { const err = await r.text().catch(()=>''); return { ok: false, status: r.status, error: 'groq_error', detail: err.substring(0,400), provider: 'groq', model }; }
      const data = await r.json();
      const text = (data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'';
      return { ok: true, text, provider: 'groq', model };
    } catch (e) { clearTimeout(t); return { ok: false, status: 0, error: 'groq_fetch_error', detail: String(e.message||e).substring(0,200), provider: 'groq', model }; }
  }

  // ── Cerebras (OpenAI-compatible, free 30 RPM, ultra-fast) ─────────────────
  async function callCerebras(model) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cerebrasKey },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
          max_tokens: Math.min(max_tokens, 8192), temperature
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) { const err = await r.text().catch(()=>''); return { ok: false, status: r.status, error: 'cerebras_error', detail: err.substring(0,400), provider: 'cerebras', model }; }
      const data = await r.json();
      const text = (data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'';
      return { ok: true, text, provider: 'cerebras', model };
    } catch (e) { clearTimeout(t); return { ok: false, status: 0, error: 'cerebras_fetch_error', detail: String(e.message||e).substring(0,200), provider: 'cerebras', model }; }
  }

  // ── 6-provider cascade: OpenAI → Claude → Gemini → Grok → Groq → Cerebras ─
  let result = null;

  try {
    // 1. OpenAI (multi-key rotation on quota exhaustion)
    if (openaiKey && !skipOpenai) {
      const openaiKeys = [openaiKey, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3].filter(Boolean);
      const model = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
      for (const key of openaiKeys) {
        result = await callOpenAI(model, key);
        if (result.ok) break;
        if (result.quotaExhausted) { console.warn('[generate] OpenAI key quota exhausted — rotating'); continue; }
        console.warn('[generate] OpenAI ' + result.status + ' — falling through to Claude');
        break;
      }
    }

    // 2. Anthropic (Claude) — if OpenAI unavailable or failed
    if (anthropicKey && (!result || !result.ok) && !skipAnthropic) {
      console.warn('[generate] Trying Anthropic (Claude)');
      for (const model of [process.env.ANTHROPIC_TEXT_MODEL || 'claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022']) {
        result = await callAnthropic(model);
        if (result.ok) break;
        if (isRetryable(result.status)) { console.warn('[generate] Anthropic ' + result.status + ' on ' + model + ' — next model'); continue; }
        break;
      }
    }

    // 3. Gemini — if Claude unavailable or failed
    //    De-duplicate models: env var might equal a hardcoded fallback
    if (geminiKey && (!result || !result.ok) && !skipGemini) {
      console.warn('[generate] Trying Gemini');
      const geminiModels = [];
      const seen = new Set();
      for (const m of [process.env.GEMINI_TEXT_MODEL || 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite']) {
        if (!seen.has(m)) { seen.add(m); geminiModels.push(m); }
      }
      for (const model of geminiModels) {
        console.log('[generate] Trying Gemini model:', model);
        result = await callGemini(model);
        if (result.ok) break;
        if (isRetryable(result.status)) { console.warn('[generate] Gemini ' + result.status + ' on ' + model + ' — next model'); continue; }
        break;
      }
    }

    // 4. Grok (xAI)
    if (grokKey && (!result || !result.ok) && !skipGrok) {
      console.warn('[generate] Trying Grok (xAI)');
      for (const model of [process.env.GROK_TEXT_MODEL || 'grok-3-mini-fast', 'grok-3-mini']) {
        result = await callGrok(model);
        if (result.ok) break;
        if (isRetryable(result.status)) { console.warn('[generate] Grok ' + result.status + ' on ' + model + ' — next model'); continue; }
        break;
      }
    }

    // 5. Groq (free tier — Llama 3.3 70B, 30 RPM)
    if (groqKey && (!result || !result.ok) && !skipGroq) {
      console.warn('[generate] Trying Groq (free tier)');
      for (const model of [process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant']) {
        result = await callGroq(model);
        if (result.ok) break;
        if (isRetryable(result.status)) { console.warn('[generate] Groq ' + result.status + ' on ' + model + ' — next model'); continue; }
        break;
      }
    }

    // 6. Cerebras (free tier — Llama 3.3 70B, 30 RPM, ultra-fast)
    if (cerebrasKey && (!result || !result.ok) && !skipCerebras) {
      console.warn('[generate] Trying Cerebras (free tier)');
      for (const model of [process.env.CEREBRAS_TEXT_MODEL || 'llama-3.3-70b', 'llama-3.1-8b']) {
        result = await callCerebras(model);
        if (result.ok) break;
        if (isRetryable(result.status)) { console.warn('[generate] Cerebras ' + result.status + ' on ' + model + ' — next model'); continue; }
        break;
      }
    }

    if (!result || !result.ok) {
      // ── HEURISTIC FALLBACK for create_brief mode ─────────────────────────
      // When all providers fail, generate a structured brief from inputs so the
      // "Enhance with AI" button always returns something useful.
      if (mode === 'create_brief') {
        console.warn('[generate] All providers failed for create_brief — using heuristic fallback');
        const typeMap = { Sale: 'conversion-focused flash sale', Launch: 'new product launch', Gift: 'premium gifting', Seasonal: 'seasonal campaign', Bestseller: 'bestseller showcase', Story: 'brand storytelling', Routine: 'daily ritual', Discovery: 'product discovery' };
        const typeDesc = typeMap[theme] || theme || 'premium campaign';
        const mktMap = { US: 'US professionals 30-55', UK: 'UK tea lovers', IN: 'Indian consumers', AU: 'Australian wellness seekers', ME: 'Middle East audience', EU: 'European premium shoppers', Global: 'global audience' };
        const audience = mktMap[market] || 'premium tea audience';
        const prodNames = selected_products.slice(0, 3).map(p => p.name || p.n || '').filter(Boolean);
        const heroProduct = prodNames[0] || 'VAHDAM Signature Collection';
        const supportProducts = prodNames.slice(1).join(' and ') || 'complementary wellness blends';

        const offerMatch = campaign_brief.match(/(\d{1,2})\s*%/);
        const offerPct = offerMatch ? offerMatch[1] : '20';
        const codeMatch = campaign_brief.match(/(?:code|coupon)\s+([A-Z0-9]{4,15})/i);
        const promoCode = codeMatch ? codeMatch[1].toUpperCase() : 'VAHDAM' + offerPct;

        const heuristicBrief = `Our next ${typeDesc} targets ${audience}, aiming for an AOV exceeding $55 by leveraging the unmatched premium provenance of our single-estate teas. We're leading with a compelling offer: experience the crisp clarity of our finest teas with up to ${offerPct}% off for a limited time using code ${promoCode}. This isn't just a discount — it's an invitation to elevate your daily ritual with garden-fresh teas, picked and packed within 72 hours of harvest.\n\nOur hero product anchoring this campaign is ${heroProduct}, a single-estate jewel perfect for a discerning morning ritual. To build a richer basket we'll feature ${supportProducts} as supporting products. These selections offer variety and cater to both the ritualistic black tea drinker and the health-conscious individual.\n\nOur audience craves moments of calm and intentionality — they're seeking authenticity and connection, a premium experience that integrates into their demanding lives. A truly authentic tea with a clear origin story tips them towards purchase.\n\nFor subject lines, test these: Your Morning Ritual, Elevated. | ${offerPct}% Off — Premium Teas, Limited Time. | Freshness From The Himalayas Awaits.`;

        return res.status(200).json({
          ok: true, mode, provider: 'heuristic', model: 'fallback-v1', text: heuristicBrief,
          portable_prompt,
          _heuristic: true,
          _llm_error: String((result && result.detail) || 'All providers failed').substring(0, 200)
        });
      }

      const is429 = result && result.status === 429;
      // Never forward Gemini/OpenAI's 404 (model not found) as our response status —
      // that confuses clients into thinking the endpoint doesn't exist. Use 503 instead.
      const clientStatus = !result ? 500
        : result.status === 404 ? 503
        : (result.status || 500);
      return res.status(clientStatus).json({
        error: result ? result.error : 'no_provider',
        detail: result ? result.detail : 'All providers failed',
        provider: result ? result.provider : provider,
        model: result ? result.model : textModel,
        // Include retry_after so the frontend can show a countdown and auto-retry
        ...(is429 ? { retry_after: result.retry_after || 30, rate_limited: true } : {})
      });
    }

    const text = result.text || '';
    if (mode === 'concepts' || mode === 'mailer_full' || mode === 'suggested_prompts') {
      let parsed;
      // Robust JSON extraction: handles markdown fences, prose prefix/suffix (Gemini habit)
      const tryParse = (t) => {
        try { return JSON.parse(t); } catch (_) {}
        const s = t.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/m, '').trim();
        try { return JSON.parse(s); } catch (_) {}
        const bs = t.indexOf('{'), be = t.lastIndexOf('}');
        if (bs !== -1 && be > bs) { try { return JSON.parse(t.slice(bs, be + 1)); } catch (_) {} }
        // Also try array extraction for suggested_prompts
        const as = t.indexOf('['), ae = t.lastIndexOf(']');
        if (as !== -1 && ae > as) { try { return JSON.parse(t.slice(as, ae + 1)); } catch (_) {} }
        return null;
      };
      parsed = tryParse(text);
      if (!parsed) {
        return res.status(502).json({ error: 'json_parse_failed', provider: result.provider, raw: text.substring(0, 600) });
      }
      return res.status(200).json({ ok: true, mode, provider: result.provider, model: result.model, data: parsed, portable_prompt });
    }
    return res.status(200).json({ ok: true, mode, provider: result.provider, model: result.model, text, portable_prompt });

  } catch (e) {
    return res.status(500).json({ error: 'server_error', provider, detail: String(e && e.message || e).substring(0, 300) });
  }
};
