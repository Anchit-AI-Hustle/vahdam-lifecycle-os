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

## Playable ads (interactive + video)
`scripts/lib/playable-ad.js` builds the ad unit itself, ready to upload:
- `renderPlayable(spec)` — interactive unit (tap ingredients, the cup fills, offer + CTA end card).
- `renderPlayableVideo(spec)` — inlined muted-autoplay video with an interactive end card.
- `playableSpecSheet()` — what each network checks, for the hand-off.

Non-negotiables it enforces so creatives are not rejected:
- **ONE self-contained .html**, every asset a `data:` URI — it **throws** on any `http(s)` asset, because reviewers test with the network cut.
- **Size budget validated** against the chosen network (Meta 2MB · TikTok 2MB · Google/AppLovin/Unity 5MB).
- **CTA calls the host API**, not `window.open`: `FbPlayableAd.onCTAClick()` (Meta), `openAppStore()` / `playableSDK` (TikTok), `mraid.open(url)` (Google/AppLovin/ironSource), `dapi`/postMessage (Unity), with a plain-link fallback for preview — one file works across networks.
- Portrait **and** landscape, first tap within ~2s, **muted** by default (sound only after a tap).
- Honesty: no fake discount codes, no invented ratings, no resetting countdowns.

## Spokesperson / UGC talking-head ads (avatar video)
For lip-synced spokesperson or creator-style ads, use `scripts/lib/avatar-video.js` (`avatarBrief`) — it targets the open-source **LongCat-Video-Avatar-1.5** (Meituan, MIT): audio-driven AT2V / ATI2V, multi-person dual-audio, length via `num_segments`, `--use_int8` for lower VRAM, `--use_distill` for 8-step serving.
- It emits a **run-ready command + descriptive prompt**, not an API call: LongCat is self-hosted and needs a GPU host (`torchrun`), which Vercel functions do not have. Run it on a GPU box / Modal / RunPod, then finish captions + CTA in `motion-ad.js`.
- **Refuses to brief** unless `consent: true` (the likeness is a creator/model who signed off on synthetic video), audio is supplied (the model does not synthesize speech), and the language is within the model's evaluated set (**English or Chinese only** — Hindi/Tamil/Telugu/Kannada/Malayalam need a different lip-sync path, never unevaluated output).
- Never fabricate a testimonial, rating or endorsement for the avatar to speak; it may only say what that person agreed to say.
- Hosted, non-avatar video stays on the `api/_shared/video-core.js` cascade (Veo 3.1 → Sora 2 → Higgsfield → Runway).

Offer to mirror the assets into `ads_generated` and wire them to a campaign via `/campaign-plan`.
