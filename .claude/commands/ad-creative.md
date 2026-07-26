---
description: Generate Vahdam paid-social ad creatives — static image, video, and GIF — with baked-in "sell happiness" copy.
argument-hint: "[product + format, e.g. 'ashwagandha coffee, Meta static + Reels']"
---

# Ad creative generation

Create paid-social creatives for: `$ARGUMENTS`.

## Engine
Use the Higgsfield skills via the `higgsfield-*` toolchain:
- **Product/lifestyle stills, ad packs** → `higgsfield-product-photoshoot` (modes: `ad_creative_pack`, `lifestyle_scene`, `closeup_product_with_person`, `hero_banner`, `social_carousel`).
- **Video / Reels / UGC / animated** → `higgsfield-generate` (Seedance video, Marketing Studio for ads, image-to-video for animating a still).
- **GIF preview** → derive from the video.
- **Face/identity consistency** across a campaign → chain `higgsfield-soul-id`.
- When unsure which model, call `models_explore(action:'recommend')` first.

### Talking-head / creator-style video: LongCat-Video-Avatar 1.5 (evaluated, NOT wired up)
`meituan-longcat/LongCat-Video-Avatar-1.5` on Hugging Face is audio-driven human video
generation — a still image plus an audio track becomes a lip-synced talking-head clip.
Relevant here because the UGC programme is built on creator talking-heads, and the
Creative Library shows that identity-first hooks delivered spoken to camera are what
score: the highest-scoring TikTok video in the June set opens "This might be the smartest
coffee I've ever found at Target."

| | |
|---|---|
| Tasks | audio+text→video, audio+text+**image**→video (the useful one), video continuation |
| Output | 480p or 720p |
| Audio encoder | Whisper-Large, 8-step distilled inference |
| Weights licence | **MIT** — commercial use permitted |
| Run | local `torchrun`, **multi-GPU (2 tested)**, INT8 quantisation to cut VRAM |
| Vendor states | e-commerce marketing and commercial promotion as target use cases |

**Why it is not the default.** It needs two local GPUs. This repo deploys to Vercel
serverless and the Snowflake app runs inside a warehouse; neither can host it, and there
is no hosted API. Higgsfield stays the engine for anything generated from here.

**When to reach for it instead.** A campaign needing many variants of the same spokesperson
saying different scripts — where per-clip vendor cost dominates and an MIT licence plus a
GPU box is cheaper. The scripts already exist: the Creative Library holds 182 full scripts
with their organic scores, so a LongCat run can be fed a proven script rather than a new
one. Requires provisioning a 2-GPU host first; treat that as the blocker, not the model.

## Formats to deliver (match what was just shipped)
- Meta static `1080x1080` PNG
- Reels/Stories `1080x1920` MP4
- Reels preview `540x960` GIF

## Hard constraints
- **Bake the approved happiness-first copy directly into the creative** (P01 mandate; enforced in `api/_shared/master-prompt.js` + `api/ai/image.js`). Do not rely on platform text overlays.
- Only the 4 brand colors; Lao MN / Proxima Nova type feel.
- **No banned phrases.** Lead with the feeling (calm, warmth, ritual), not the ingredient spec.
- Save outputs to the repo root with descriptive names: `vahdam_{product}_{platform}_{format}_{WxH}.{ext}`.

## Reels-grade quality bar (the "as good as real Reels" standard)
The bar is what top reels actually do — not a slideshow of stills:
1. **Stills built to animate**: generate hero frames via Higgsfield product-photoshoot or `/api/ai/image` with `mode:'reels'` (cinematic 9:16, depth-separated layers for parallax, negative space for type, NO baked text).
2. **Real motion**: animate each frame with `higgsfield-generate` image-to-video (subtle push/pan/drift + organic motion only — steam, light; never added objects). Hook must move within 0.8s.
3. **Kinetic type**: headlines animate in word-staggered, not all at once; hard cut only into the CTA card.
4. **Instant preview / no-API fallback**: `scripts/lib/motion-ad.js` — `renderMotionAd(spec)` outputs a self-contained animated 9:16 HTML creative (layered Ken Burns, parallax veils, crossfades, kinetic type, CTA card), and `motionBrief(spec)` emits the same design as a shot-by-shot brief for Higgsfield/CapCut so the shipped MP4 matches the preview.
5. **Non-negotiables**: real SKU packaging only (never AI-invented tins), one filmic grade, licensed audio only, total under 15s, safe-areas (7% sides, bottom 18% clear).

## Spokesperson / UGC talking-head ads (avatar video)
For lip-synced spokesperson or creator-style ads, use `scripts/lib/avatar-video.js` (`avatarBrief`) — it targets the open-source **LongCat-Video-Avatar-1.5** (Meituan, MIT): audio-driven AT2V / ATI2V, multi-person dual-audio, length via `num_segments`, `--use_int8` for lower VRAM, `--use_distill` for 8-step serving.
- It emits a **run-ready command + descriptive prompt**, not an API call: LongCat is self-hosted and needs a GPU host (`torchrun`), which Vercel functions do not have. Run it on a GPU box / Modal / RunPod, then finish captions + CTA in `motion-ad.js`.
- **Refuses to brief** unless `consent: true` (the likeness is a creator/model who signed off on synthetic video), audio is supplied (the model does not synthesize speech), and the language is within the model's evaluated set (**English or Chinese only** — Hindi/Tamil/Telugu/Kannada/Malayalam need a different lip-sync path, never unevaluated output).
- Never fabricate a testimonial, rating or endorsement for the avatar to speak; it may only say what that person agreed to say.
- Hosted, non-avatar video stays on the `api/_shared/video-core.js` cascade (Veo 3.1 → Sora 2 → Higgsfield → Runway).

Offer to mirror the assets into `ads_generated` and wire them to a campaign via `/campaign-plan`.
