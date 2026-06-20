# VAHDAM "Calm Your Cortisol" LP — Creative & Asset Prompt Book

Companion to the landing pages in this folder:

| Route | File |
|---|---|
| `/lp/agent` | `lp_all_in_one_agent_v2.html` (with the all-in-one narrate + ask voice agent) |
| `/lp/cortisol-v1` | `vahdam-uk-presell-cortisol-v1.html` |
| `/lp/cortisol-v2` | `vahdam-uk-presell-cortisol-v2.html` |

Every visual on the page maps to a numbered slot below. Each slot gives a ready-to-paste
generation prompt (image / video / icon). Drop the resulting file on a CDN and replace the
`src` in the HTML (most slots already point at live Shopify CDN URLs — these prompts let you
regenerate brand-correct replacements).

## Global brand constraints (apply to EVERY prompt)
- **Palette only:** forest green `#004A2B`, gold `#AB8743`, near-black `#171717`, cream `#FBF5EA`.
- **Mood:** warm, sensory, editorial, calm. NOT clinical-blue, NOT neon, NOT stocky.
- **Subject:** women 35–55, UK/European, natural and un-retouched, real kitchens / morning light.
- **Typography in-image:** avoid baked-in text; the page supplies all copy. If text is unavoidable, Proxima Nova.
- **Banned visual clichés:** pills-as-hero, lab coats, "before/after" tape measures around waists, fake stock smiles.
- **Aspect ratios** are noted per slot — generate at 2× the listed pixel size for retina.

---

## 1. Hero — "stress → calm" visual  (`.bodydiag.has-hero-image`, square 1:1)
> A serene 48-year-old woman in soft morning kitchen light, holding a warm cup of coffee with both
> hands, eyes gently closed, shoulders dropped — the moment stress leaves the body. Cream and forest-green
> palette, gold rim-light from a window. Editorial wellness photography, shallow depth of field, calm and
> grounded. No text. Square crop.

## 2. Truth section — symptom portrait  (`.truth-photo`, animated GIF, ~3:4)
> Short looping GIF: same woman at a kitchen table at 11am, subtly rubbing her temple / tired but composed,
> then a small exhale of relief. Natural light, cream tones, forest-green accents. Documentary feel, no captions.

## 3. Failed-strategy illustration  (`.stress-illust`, portrait)
> Editorial illustration of a woman's desk overwhelmed by the "things she tried" — a sleep-app phone,
> a detox-tea box, vitamin bottles, a gym pass — arranged like a quiet still life, muted cream background,
> gold and forest-green line accents. Hand-drawn editorial style. No text.

## 4. Cycle illustration — "the cortisol trap"  (`.cycle-illust`, square)
> A clean hand-drawn line illustration of a stress curve that never comes back down — a rising jagged line
> on a cream background, forest-green ink, single gold highlight at the peak. Minimal, editorial, no labels.

## 5. Before / After pair  (`.crack-photo.before` + `.crack-photo.after`, each 3:4)
> Two portraits of the same woman, identical framing. BEFORE: cooler light, tense expression, slightly
> grey skin (cortisol-high). AFTER: warm morning light, calm, rested, healthy glow (cortisol-calmed).
> Cream/green palette, honest and natural — not glamour retouching. No on-image text.

## 6. Enemy section — product in hand  (`.enemy-photo`, animated GIF, 4:5)
> Looping GIF: a woman's hands scooping VAHDAM Ashwagandha Coffee and stirring it into a mug, steam rising,
> dark moody kitchen with a single warm light, gold-and-green packaging visible. Tactile, premium, no text.

## 7. Benefit icons ×6  (`.ben-card .ico-wrap img`, 44×44 line icons, gold on transparent)
Generate as a matched set — thin gold (`#AB8743`) line icons, rounded, 1px-feel, transparent PNG:
1. **Steady Daily Energy** — a sunrise over a coffee cup.
2. **Steadier Mood** — a calm wave / smooth line.
3. **Sharper Focus** — a clear eye / target.
4. **Cravings Stop** — a crossed-out biscuit.
5. **Healthier Ageing** — a leaf with a subtle clock.
6. **Cortisol Belly** — a relaxed waistline silhouette.
> Prompt: "Minimal single-line gold icon of [X], thin even stroke, rounded corners, centred, transparent
> background, no fill, matched icon-set style." (Run once per item.)

## 8. Ingredient cards ×5  (`.ing-card .iimg img`, ~300px PNG, transparent)
Photoreal cut-outs on transparent background, soft top light, gold radial glow behind:
1. **KSM-66® Ashwagandha** — ashwagandha root + powder.
2. **Arabica Coffee** — roasted coffee beans.
3. **Turmeric** — turmeric root + powder.
4. **Lion's Mane** — lion's mane mushroom.
5. **Chaga** — chaga mushroom chunk.
> Prompt: "Studio macro of [ingredient], whole + ground, on pure transparent background, warm directional
> light, ultra-sharp, premium supplement photography, no props, no text."

## 9. UGC video reviews ×7  (`.ugc-card video`, vertical 9:16 .mp4)
Authentic talking-head testimonials, phone-shot feel, real women 35–55, UK accents. One claim each
(captions optional, burned-in bottom-third in cream):
1. "No 3pm crash or jitters"  2. "The bloat is completely gone"  3. "Feel calm, focused & energized"
4. "Tastes incredible — I crave it"  5. "Just replaced my morning coffee"  6. "My cortisol levels dropped"
7. "Lost weight and gained energy"
> Brief: "15–25s vertical UGC selfie video, kitchen/living-room, natural light, conversational, holding the
> VAHDAM pack at the end. Honest, unscripted tone." (Source from real customers where possible — synthetic
> avatars only if disclosed.)

## 10. Starter-kit pack shot  (sticky bar `.pack-mini`, square)
> VAHDAM Ashwagandha Coffee starter kit — pouch + mug + scoop arranged on a cream surface with a sprig of
> coffee cherry, gold-and-green packaging, soft daylight, premium e-commerce hero. No text overlay.

## 11. Text-only blocks (no image generation — copywriting reference)
- **Testimonials carousel** — 5 verified-style reviews, UK cities, first-name + initial, results-led.
- **Comparison table** — VAHDAM vs Mushroom Coffees, 10 rows, ✓ / ✕ / ?.
- **Featured-in** — The New York Times, Forbes, Women's Health, Inc. (use licensed logos in production).

---

## 12. All-in-one voice agent — scripts & behaviour  (`lp_all_in_one_agent_v2.html`)
The agent **asks the visitor up front** how they want to engage and supports **narration and interaction
together** — neither is exclusive.

**Opening question (spoken + on screen):**
> "👋 Hi — I'm your VAHDAM guide. I can do both: narrate this page for you, and answer anything you ask, by
> text or voice. How would you like to start?"
> Buttons: **✨ Narrate & let me ask** · **🔊 Just narrate** · **💬 Just chat / talk**

**Narration walkthrough** (British voice, scrolls the page section-by-section; interruptible at any point —
typing or tapping the mic pauses it, answers, then offers "▶ Resume the walkthrough"):
1. Hero — cortisol is the cause; the coffee is built to calm it.
2. Symptoms — tired-but-wired, 4pm fuse, dull skin — it's cortisol, not age.
3. Why everything failed — those chased symptoms; the cause is upstream.
4. Formula — 300mg KSM-66, 50+ trials, Arabica, turmeric, Lion's Mane, Chaga.
5. Proof — 148,000+ women, 4.8★.
6. Offer — 65% off (£29 vs £83), £49 gifts, free UK shipping, 90-day guarantee.

**Interaction knowledge base** (typed or spoken; answered in voice + text): help-me-choose, what's-inside,
safety, the offer, how cortisol works, taste, caffeine, shipping, how-to-use. Voice input via Web Speech
`SpeechRecognition`; voice output via `speechSynthesis` (British female/male selectable).

> ⚠️ Deploy note: the agent's microphone needs `Permissions-Policy: microphone=(self)` (set in `vercel.json`).
> Browsers also require HTTPS + a user gesture before mic/voice will start.
