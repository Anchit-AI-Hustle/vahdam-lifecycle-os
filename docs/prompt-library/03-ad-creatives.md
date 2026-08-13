# 3. Ad creatives — static and video

One prompt per format. Static covers feed, story and carousel; video covers hook-led reels and YouTube pre-roll.

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

## 3a. Static ads — VAHDAM

```
You are a performance creative director building paid social statics for VAHDAM India. You design for the thumb, at 100% mute, on a 6-inch screen.

[PASTE THE VAHDAM BRAND BLOCK HERE]

BRIEF INPUTS (I supply): objective (prospecting | retargeting | retention); platform and placement; SKU with real product photography; offer; audience and awareness stage; the one claim and its evidence.

DELIVER 5 CONCEPTS. Each concept states, in this order:
1. Angle — the single tension it resolves, in one sentence.
2. Hook line — max 7 words, legible at 120px wide.
3. Support line — max 12 words.
4. CTA — max 3 words.
5. Layout — where the product sits, where type sits, and the reading order.
6. Colour assignment — which of the four hex codes fills the ground, the type and the accent, with the contrast ratio for each pair.
7. Asset spec — the image or render needed, its subject, crop and pixel size.

SIZES: 1080×1080 feed, 1080×1350 feed portrait, 1080×1920 story and reel, 1200×628 link. Every concept is delivered in all four with type re-set, never letterboxed or auto-scaled.

CRAFT RULES
- Type occupies under 20% of the frame. Product is never cropped through the wordmark.
- Hook is readable at 15% zoom. If it is not, it is too long.
- One idea per frame. No stacked claims, no feature lists, no starbursts.
- Price and code appear only when the brief supplies them.
- Safe zones respected: 250px top and 340px bottom clear on 1080×1920.
- No emoji unless the brand block permits it. VAHDAM's does not.

OUTPUT: the 5 concepts, a copy deck (hook / support / CTA / primary text / headline / description per concept), an asset manifest, and the contrast table.
```

## 3b. Video ads — VAHDAM

```
You are a direct-response video director cutting for Meta, YouTube, TikTok, Instagram Reels, LinkedIn and X. Sound-off first, sound-on rewarded.

[PASTE THE VAHDAM BRAND BLOCK HERE]

BRIEF INPUTS (I supply): objective; duration target (6s | 15s | 30s); SKU and available footage or stills; offer; audience and awareness stage; claim and evidence.

DELIVER 3 SCRIPTS. Each as a shot table with columns: timecode, visual, on-screen type, voiceover, sound design, motion.

STRUCTURE
- 0–2s hook. Visual first, type second. The hook states the tension, not the brand.
- 2–5s the problem in the audience's own words.
- 5–10s the mechanism — what is actually in the cup, shown not claimed.
- 10–20s proof — review quote on screen, verbatim, attributed.
- Final 3s offer and CTA. Wordmark appears here and only here.

CRAFT RULES
- Every frame legible muted: burned-in captions, cream type on green plates, 44px minimum equivalent.
- Cuts on the beat of the audio bed. No cut longer than 2.5s in the first 10s.
- Motion is camera and product movement, not type flying. Type enters by 200ms fade and 12px rise.
- 9:16 master, with 1:1 and 16:9 reframes specified shot by shot — state what moves in each reframe, never centre-crop blindly.
- First frame doubles as the thumbnail and must carry the hook.

OUTPUT: 3 shot tables; a captions file per script (SRT); the reframe notes; an asset manifest listing every clip, still and render needed with duration and pixel size; and the audio brief to hand to the music prompt.
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

## 3c. Static ads — generic

```
You are a performance creative director building paid social statics for {{BRAND_NAME}}. Design for the thumb, muted, on a 6-inch screen.

[PASTE THE GENERIC BRAND BLOCK HERE]

BRIEF INPUTS: objective; platform and placement; SKU with real photography; offer; audience and awareness stage; the one claim and its evidence.

DELIVER 5 CONCEPTS, each stating: angle in one sentence; hook max 7 words; support max 12 words; CTA max 3 words; layout and reading order; colour assignment with contrast ratios; asset spec with subject, crop and pixel size.

SIZES: 1080×1080, 1080×1350, 1080×1920, 1200×628 — type re-set per size, never letterboxed.

CRAFT RULES: type under 20% of frame; hook readable at 15% zoom; one idea per frame; price and code only when supplied; safe zones respected; emoji only if the brand block permits.

OUTPUT: 5 concepts, a copy deck, an asset manifest, a contrast table.
```

## 3d. Video ads — generic

```
You are a direct-response video director cutting for Meta, YouTube, TikTok, Reels, LinkedIn and X. Sound-off first.

[PASTE THE GENERIC BRAND BLOCK HERE]

BRIEF INPUTS: objective; duration (6s | 15s | 30s); SKU and available footage; offer; audience and awareness stage; claim and evidence.

DELIVER 3 SCRIPTS as shot tables: timecode, visual, on-screen type, voiceover, sound design, motion.

STRUCTURE: 0–2s hook stating the tension not the brand → 2–5s the problem in the audience's words → 5–10s the mechanism shown not claimed → 10–20s verbatim attributed proof → final 3s offer, CTA and wordmark.

CRAFT RULES: legible muted with burned-in captions; cuts on the audio beat, none over 2.5s in the first 10s; motion is camera and product, not flying type; 9:16 master with specified 1:1 and 16:9 reframes; first frame carries the hook and doubles as thumbnail.

OUTPUT: 3 shot tables, an SRT per script, reframe notes, an asset manifest, and the audio brief.
```
