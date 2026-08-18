# 1. Landing page development

For presell and PDP-adjacent landing pages that must convert cold and warm traffic and survive a contrast audit.

Two versions follow: **VAHDAM** (production, colour- and voice-locked) and **generic** (same skeleton, placeholder brand block). Both are written to be pasted whole into Claude, ChatGPT, or Gemini.

---

## Brand block — VAHDAM (paste verbatim into every prompt)

BRAND: VAHDAM India — premium Indian heritage tea brand, ethical direct-from-garden sourcing. Wellness-oriented without being clinical. Primarily US audience, globally shipped, loyal repeat-buyer base. Est. 2015, New Delhi. Traceability and origin are always assets, never footnotes.

POSITIONING: Confident artisan. We know tea better than anyone because we source it directly. Premium, warm, aspirational, approachable. Never corporate, never cold.

TONE ALWAYS: Calm, confident, premium. Specific over vague — "single-estate Darjeeling" beats "finest tea". Warm but never gushing.
TONE NEVER: Urgent, pushy, countdown-driven. Generic wellness clichés. Spam subject tactics. Long paragraphs.

BANNED WORDS: wellness journey · transform · liquid gold · game-changer · LIMITED TIME in caps · You won't believe · Hurry · Don't miss out · cheap/budget/bargain framing · Learn More · Click Here
PREFERRED WORDS: ritual · restore · balance · origin · single-estate · hand-picked · steep · heritage · crafted · farm to cup · direct from source
SIGNATURE PHRASES: "Your morning ritual" · "From the gardens of…" · "Steeped in tradition" · "Make every cup count"

COLOUR — these four hex codes only, no others, no tints outside the stated roles:
- #004A2B forest green — hero and trust backgrounds, headings, primary CTA fill, key accents
- #AB8743 gold — secondary CTA and borders, dividers, badges, star ratings, hover, highlights
- #171717 ink — body copy and dark type ONLY. Never a background.
- #FBF5EA cream — page and section backgrounds, light surfaces, type on dark green

CONTRAST RULE: every text/background pair must clear WCAG AA (4.5:1 body, 3:1 large display). Cream on #004A2B and ink on #FBF5EA both pass. Gold #AB8743 on cream is 3.1:1 — large display, badges and icons only, never body copy. Never gold on green for type.

TYPOGRAPHY: Headlines Lao MN / Georgia serif, weight 400–500, never bold-heavy. Body and UI Proxima Nova 300–400. Eyebrow Proxima Nova 10–11px, 0.2em tracking, uppercase.

MARKET URLS (measured 2026-08-13; the four originally listed here did not point where they claimed — see docs/prompt-library/README.md):
US https://www.vahdam.com · UK https://www.vahdam.co.uk · Global/EU/AU/ME https://www.vahdam.global · IN https://www.vahdam.com
SOCIAL: instagram.com/vahdamteas · facebook.com/vahdamteas · youtube.com/@vahdamteas · pinterest.com/vahdamteas

EVIDENCE RULE: every claim traces to catalog data, review data or a sourcing fact. No invented numbers, no invented awards, no invented certifications. If a number is not supplied in the brief, write the copy without it.

---

## The prompt — VAHDAM

```
You are a senior D2C conversion designer and front-end engineer building a production landing page for VAHDAM India. You write one self-contained HTML file. No build step, no framework, no external CSS.

[PASTE THE VAHDAM BRAND BLOCK HERE]

BRIEF INPUTS (I supply; never invent these)
- Product / bundle: {{SKU_NAMES}} with real Shopify CDN image URLs
- Offer: {{PRICE}} / {{COMPARE_AT}} / {{CODE}} / {{SHIPPING_THRESHOLD}}
- Audience and awareness stage: {{COHORT}} — {{PROBLEM_AWARE | SOLUTION_AWARE | BRAND_AWARE}}
- Primary claim + its evidence: {{CLAIM}} → {{SOURCE}}
- Review data: {{RATING}}, {{REVIEW_COUNT}}, 3 real review quotes
- Destination: {{CART_OR_PDP_URL}}

PAGE STRUCTURE — in this order, no extra sections
1. Announcement bar — shipping threshold + code. #004A2B ground, cream 9–10px uppercase 0.2em.
2. Sticky header — wordmark left, single-row nav, cart right. Nav never wraps to a second line: one row with horizontal scroll and arrow affordances when it overflows.
3. Hero — headline max 10 words serif, subhead one sentence max 20 words, primary CTA max 3 words, product shot with visible packaging. Dark green ground, cream type.
4. Value bar — exactly 3 benefits, label + one line each. Cream ground, ink type.
5. What is inside — one row per active with dose and function. Table on desktop, stacked cards under 768px. This section carries the evidence.
6. How to use — 3 numbered steps, one line each.
7. Social proof — rating, review count, 3 real quotes with first name and city.
8. Offer block — price, compare-at, savings, code, CTA. Gold ground permitted here, ink type on gold.
9. FAQ — 5 questions, the 5 real objections for this cohort, answered in 2 sentences.
10. Final CTA — one line, one button. Footer with market-correct links.

MOTION — required, and identical in kind on desktop and mobile web
- Opt-in only, via data attributes. Never a bare tag or universal selector.
- Hero: scale-in from 1.06 plus 0.10 parallax. Ingredient row: golden-angle bundling reveal, 70ms stagger. Steps: 100ms vertical stagger. Reviews: fade-up 90ms stagger. Everything else: fade-up 12px.
- Transforms and opacity only. No clip-path, no mask-image, no position changes — these clip copy and cause section overlap.
- Hidden state is written by JS at runtime so that with JS disabled the page renders fully readable at full opacity.
- Touch parity: where desktop uses cursor parallax or hover, mobile uses scroll position and IntersectionObserver so the same motion reads on a phone. Hover-only reveals are forbidden.
- @media (prefers-reduced-motion: reduce) reveals everything instantly.

HARD RULES
- Four hex codes only. #171717 is type, never a background.
- Every text/background pair states its contrast ratio in an HTML comment at the top of the file. Anything under AA is fixed, not shipped.
- Mobile-first. 44px minimum hit targets. No horizontal scroll at 360px: auto-fit grids use minmax(min(Xpx,100%),1fr).
- Real URLs everywhere. No href="#". No lorem. No placeholder images — if I have not supplied an image, leave a labelled empty slot stating what belongs there.
- Every image gets width, height, loading and alt.

OUTPUT
1. The complete HTML file.
2. A contrast table: element, foreground, background, ratio, pass/fail.
3. An asset manifest: every image slot, its intended subject, aspect ratio and pixel size.
4. A change log ending with the line: No other changes made.
```

---

## Brand block — generic (fill the placeholders, then paste verbatim)

BRAND: {{BRAND_NAME}} — {{CATEGORY}} brand. {{ONE_LINE_POSITIONING}}. Primary market {{MARKET}}, audience {{AUDIENCE}}. Founded {{YEAR}}, {{HQ}}.

POSITIONING: {{ARCHETYPE}}. {{WHY_WE_ARE_CREDIBLE}}.

TONE ALWAYS: {{THREE_TONE_ADJECTIVES}}.
TONE NEVER: {{THREE_ANTI_TONE_ADJECTIVES}}.

BANNED WORDS: {{BANNED_LIST}}
PREFERRED WORDS: {{PREFERRED_LIST}}
SIGNATURE PHRASES: {{SIGNATURE_PHRASES}}

COLOUR — these {{N}} hex codes only, no others:
- {{HEX_1}} — {{ROLE_1}}
- {{HEX_2}} — {{ROLE_2}}
- {{HEX_3}} — {{ROLE_3}}
- {{HEX_4}} — {{ROLE_4}}

CONTRAST RULE: every text/background pair clears WCAG AA (4.5:1 body, 3:1 large display). State which pairs pass and restrict the failing ones to large display, badges and icons.

TYPOGRAPHY: Headlines {{DISPLAY_FONT}} {{WEIGHTS}}. Body and UI {{BODY_FONT}} {{WEIGHTS}}. Eyebrow {{BODY_FONT}} {{SIZE}}, {{TRACKING}}, uppercase.

URLS: {{PRIMARY_STORE_URL}} · {{SECONDARY_URLS}}
SOCIAL: {{SOCIAL_HANDLES}}

EVIDENCE RULE: every claim traces to supplied catalog, review or sourcing data. No invented numbers, awards or certifications.

---

## The prompt — generic

```
You are a senior D2C conversion designer and front-end engineer building a production landing page for {{BRAND_NAME}}. One self-contained HTML file, no build step, no framework.

[PASTE THE GENERIC BRAND BLOCK HERE]

BRIEF INPUTS (I supply; never invent)
- Product: {{SKU_NAMES}} + real image URLs
- Offer: {{PRICE}} / {{COMPARE_AT}} / {{CODE}} / {{SHIPPING_THRESHOLD}}
- Audience and awareness stage: {{COHORT}} — {{AWARENESS_STAGE}}
- Primary claim + evidence: {{CLAIM}} → {{SOURCE}}
- Review data: {{RATING}}, {{REVIEW_COUNT}}, 3 real quotes
- Destination: {{DESTINATION_URL}}

PAGE STRUCTURE: announcement bar → sticky header with a single-row nav → hero → 3-benefit value bar → the evidence section ({{WHAT_MAKES_IT_WORK}}) → how to use → social proof → offer block → 5-question FAQ answering the 5 real objections → final CTA + footer. No extra sections.

MOTION: opt-in via data attributes only; transforms and opacity only; no clip-path or mask-image; hidden state written by JS so no-JS renders readable; touch parity via scroll position and IntersectionObserver wherever desktop uses hover or cursor parallax; prefers-reduced-motion reveals instantly.

HARD RULES: the stated hex codes only; every text/background pair reports its contrast ratio and clears AA; mobile-first with 44px hit targets and no horizontal scroll at 360px; real URLs, no href="#"; no lorem; labelled empty slots instead of placeholder images; width/height/loading/alt on every image.

OUTPUT: the HTML file, a contrast table, an asset manifest, and a change log ending "No other changes made."
```
