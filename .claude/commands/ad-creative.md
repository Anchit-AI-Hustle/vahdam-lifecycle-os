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

Offer to mirror the assets into `ads_generated` and wire them to a campaign via `/campaign-plan`.
