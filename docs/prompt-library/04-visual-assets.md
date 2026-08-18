# 4. Images, GIFs and informative visuals

For generated and art-directed imagery, animated GIFs, and data or explainer graphics. Written for image models and for a designer alike.

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

## 4a. Product and lifestyle imagery — VAHDAM

```
Art-direct one image. Return the prompt, the negative prompt, and the spec.

[PASTE THE VAHDAM BRAND BLOCK HERE]

SUBJECT: {{WHAT_IS_IN_FRAME}}
USE: {{WHERE_IT_RUNS}} — hero | PDP secondary | ad | mailer | reel still
PIXELS: {{W}}×{{H}}, {{ASPECT}}, safe zone {{IF_ANY}}

PROMPT SKELETON
"{{Subject}}, {{material and surface detail}}, {{setting}}, {{light direction and quality}}, {{camera and lens}}, {{depth of field}}, {{colour palette named by hex role — forest green ground, cream surfaces, gold accents only}}, {{mood}}, photographic, no text, no logo."

DIRECTION LOCKS
- Light: single soft directional source, morning quality, visible falloff. No ring light, no flat product-catalogue lighting.
- Surfaces: linen, unglazed ceramic, aged brass, dark timber, raw paper. No marble, no acrylic, no glitter.
- Steam and pour are earned details, not effects. If steam appears it must match the cup temperature implied.
- Loose leaf must read as leaf, not dust. Grade and cut are visible.
- Frame leaves room for type in the stated safe zone.

NEGATIVE PROMPT: text, watermark, logo, lettering, packaging copy, extra fingers, plastic sheen, HDR halo, oversaturation, teal-orange grade, stock-photo smile, marble surface, neon, lens flare.

REALITY RULE: generated imagery never depicts the actual product packaging, a certification mark, an award, or a named person. Packaging is shot, not generated. If the brief needs packaging, the output is a labelled empty slot stating the shot required.

OUTPUT: prompt, negative prompt, pixel size, aspect, where the type goes, and the fallback shot brief if generation cannot be used.
```

## 4b. Animated GIFs — VAHDAM

```
Design one GIF for {{PLACEMENT}} — mailer hero | ad | PDP loop.

[PASTE THE VAHDAM BRAND BLOCK HERE]

CONSTRAINTS
- Under 1MB. 600px wide for mailers, 1080px for ads.
- 12–18 frames, 2–4s loop, seamless — first and last frame match.
- The first frame carries the entire message. Outlook shows only that frame.
- One movement only: pour, steam drift, leaf settle, or a single reveal. No text animation, no wipe transitions.
- Palette limited to the four brand hex codes plus the photographic range of the subject.

OUTPUT: frame-by-frame description, the still fallback, file size strategy (frame count vs dither vs palette), and the exact first frame composition.
```

## 4c. Informative visuals — VAHDAM

```
Design one explainer or data graphic.

[PASTE THE VAHDAM BRAND BLOCK HERE]

INPUTS (I supply; never invent a number): the data table or the process steps, the single takeaway, the audience, the placement and pixel size.

RULES
- One takeaway per graphic, stated as the title in plain words.
- Chart type follows the data: comparison → bars; composition → stacked bar, never a pie unless two slices; change over time → line; process → numbered steps; dose or ingredient → labelled table.
- Encode with position and length. No 3D, no shadow on data, no gradient fills on bars.
- #004A2B is the data colour, #AB8743 the highlight for the one series that matters, #171717 the labels, #FBF5EA the ground. Nothing else.
- Label directly on the mark. A legend only when direct labelling is impossible.
- Axis starts at zero for any length encoding. Units and source line always present.
- Minimum 12pt equivalent for print, 24px for slides, 14px for web.

OUTPUT: the graphic as inline HTML and SVG-free CSS where possible, the data table it was built from, the source line, and the contrast table.
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

## 4d. Imagery, GIFs and informative visuals — generic

```
[PASTE THE GENERIC BRAND BLOCK HERE]

IMAGERY. Subject {{SUBJECT}}, use {{PLACEMENT}}, {{W}}×{{H}}. Prompt skeleton: "{{subject}}, {{material detail}}, {{setting}}, {{light direction and quality}}, {{camera and lens}}, {{depth of field}}, {{palette named by hex role}}, {{mood}}, photographic, no text, no logo." Direction locks: one soft directional source; the material and surface list from the brand block; effects only where physically justified; frame leaves room for type in the stated safe zone. Negative prompt: text, watermark, logo, lettering, extra fingers, plastic sheen, HDR halo, oversaturation, teal-orange grade, stock-photo smile, neon, lens flare. Reality rule: never depict actual packaging, certification marks, awards or named people — those are photographed, and the output is a labelled empty slot naming the shot required.

GIFS. Under 1MB, {{WIDTH}}px, 12–18 frames, 2–4s seamless loop, first and last frame matching. First frame carries the whole message. One movement only. Palette limited to the brand hex codes plus the subject's photographic range.

INFORMATIVE VISUALS. One takeaway per graphic, stated as the title. Chart type follows the data — comparison bars, composition stacked, change over time line, process numbered steps. Position and length encodings only; no 3D, no shadows on data, no gradient bars. Primary hex is the data colour, accent hex highlights the one series that matters. Direct labels over legends. Zero baseline for length encodings. Units and source line always present. Minimum 12pt print, 24px slide, 14px web.

OUTPUT for each: the asset or its spec, the data or shot list behind it, and a contrast table.
```
