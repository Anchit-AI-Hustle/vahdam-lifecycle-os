# LOCKED FACTS — VAHDAM UK Lifecycle Week 1 (Jul 3–9, 2026)
Single source of truth for every email in this campaign. Nothing outside this file may be claimed as fact.

## Store
- Base URL: `https://vahdam.co.uk`
- Product page: `https://vahdam.co.uk/products/{handle}`
- Currency: GBP (£)

## Cohorts
- **Cohort A — Non-Buyers / Non-Engagers**: on the list, never purchased, haven't opened/clicked recently. Objective: earn the open, earn the click, first purchase. Tone: no guilt, no pressure; introduce the brand as if for the first time.
- **Cohort B — T&B Buyers / Non-Engagers**: bought Teas & Botanicals before, gone quiet. Objective: reactivate with familiarity, then cross-grade to Coffee/Supplements subscription. Tone: welcome back an old friend; acknowledge the relationship without guilt.

## Product rules
- **Teas & Botanicals (T&B)**: ONE-TIME purchase only. Never use subscription language for T&B.
- **Ashwagandha Coffee**: one-time OR subscription. SUBSCRIPTION IS THE PRIORITY CTA.
- **Supplements**: just launched, zero buyers yet. One-time OR subscription. SUBSCRIPTION IS THE PRIORITY CTA.

## Ashwagandha Coffee (exact pricing — do not alter)
| Pack | One-time | Subscription |
|---|---|---|
| Pack of 1 | £49.99 | £29.99 |
| Pack of 3 | £99.99 | £59.99 |
- Pack of 3 subscription framing: **£59.99 = 2 × £29.99 → buy two packs, the third is free (B2G1)**.
- **7 free gifts with EVERY order (both one-time and subscription)**: Electric Frother, Recipe Booklet, Plantable Paper, Aroma Bean Pouch, Mystery Gift (5 Tea Bags), Wooden Scoop, Stainless Steel Straw.
- **Subscription-only hook: gifts worth more than £105 across the year, arriving with refills.**
- Handle (VERIFIED by user 2026-07-03): `ashwagandha-coffee` → https://vahdam.co.uk/products/ashwagandha-coffee
- No product image available in this environment → coffee emails use typographic hero (brand palette), with an HTML comment marking where a product shot can be dropped in Klaviyo.

## Supplements (just launched — "be among the first" is TRUE and allowed)
- Turmeric Curcumin 1800 MG — handle (VERIFIED by user 2026-07-03): `turmeric-curcumin` → https://vahdam.co.uk/products/turmeric-curcumin
- Green Burner — handle (VERIFIED by user 2026-07-03): `green-burner` → https://vahdam.co.uk/products/green-burner
- Pricing will MIRROR the coffee model (subscription discount vs one-time) — exact numbers TBD. Until numbers arrive: NEVER state a price for supplements. CTA to product page only.
- No product images available → typographic treatment.

## T&B hero products (REAL handles, prices, images from UK store export)
| Product | Handle | Price | Was | Image |
|---|---|---|---|---|
| Assam Spice Masala Chai, 200g loose leaf | `assam-spice-masala-chai-tea` | £12.99 | £14.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/products/assamchaispicedbt_11zon.jpg?v=1675673061 |
| Himalayan Green Tea, 100g loose leaf | `himalayan-green-tea-3-53oz-100g` | £5.99 | £15.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/products/himalayangreentea_11zon_2.jpg?v=1675673283 |
| Earl Grey Black Tea, 100 tea bags | `earl-grey-black-tea-bags-100-tea-bags` | £17.99 | £25.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/files/Earl-grey_ed481d66-3b90-4a08-94a3-2ba4cb94ae5c.jpg?v=1758099441 |
| Chamomile Mint Citrus Green Tea, 200g | `chamomile-mint-citrus-green-tea` | £15.99 | £17.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/products/chamomilemintcitrusgreentea_11zon.jpg?v=1675673420 |
| Assorted Loose Leaf Sampler, 10 teas | `assorted-leaf-teas` | £12.99 | £23.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/files/71d5z4TlNaL._AC_SL1500.jpg?v=1682503156 |
| Turmeric Ashwagandha Herbal Tisane, 100 bags | `turmeric-ashwagandha-herbal-tea-tisane-100-tea-bags` | £24.99 | £34.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/files/81zl0PJEMoL._AC_SL1500.jpg?v=1684996616 |
- "Was" prices are live compare-at prices from the store export — citing them is honest, not an invented discount.
- IMPORTANT: image URLs above may have `?v=` params stripped; use them as given here. Do NOT use any image URL not listed in this file.

## Offer rules
- NO new discount codes may be invented. Only: subscription pricing above, B2G1 framing, the 7 gifts, £105/yr subscription gift value, and real compare-at prices.
- A soft deadline ("closes Sunday") may frame the Jul 9 Pack-of-3 email — no countdown clocks, no caps urgency.

## Brand gates (HARD FAIL if violated)
- **Palette — ONLY these hex values may appear anywhere in the HTML**: `#004A2B` (forest green), `#AB8743` (gold), `#171717` (near-black), `#FBF5EA` (cream). No white `#FFFFFF`, no grays, no other tints. (Case-insensitive; 3-digit shorthand also banned.)
- **Fonts**: headings `'Lao MN','Cormorant Garamond',Georgia,serif` · body `'Proxima Nova','Helvetica Neue',Arial,sans-serif`. No other families.
- **BANNED phrases** (any casing unless noted): "wellness journey", "transform", "liquid gold", "game-changer", "LIMITED TIME" (caps), "hurry", "don't miss out", "last chance", "while supplies last".
- **No em/en dashes anywhere in output copy** - use commas, colons, or plain hyphens.
- **NO FOUNDER VOICE — HARD RULE**: no founder letters, no "from our founder/CEO", no personal-name sign-offs, no first-person-singular ("I") narration. The brand speaks as "we".
- **No medical claims** for ashwagandha/turmeric/supplements: no disease, stress-cure, cortisol, or weight-loss claims. Softest allowed register: "calm", "steady", "balance", "a gentler kind of energy".
- **Voice**: warm, sensory, story-driven. Preferred words: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted. Exemplar sentence: "There is a moment when the right cup of tea does more than warm your hands."

## Email tech spec (all 6)
- Klaviyo paste-ready: one centered 600px `<table role="presentation">`, ALL CSS inline, outer bg `#FBF5EA`.
- Compact: ~1200–1500px rendered height.
- Top of file: HTML comment block with `SUBJECT_PRIMARY`, `SUBJECT_ALT1`, `SUBJECT_ALT2`, `PREHEADER`.
- Hidden preheader `<span>` (display:none) as first body element.
- Bulletproof CTA buttons: table-cell with bgcolor + inline-styled `<a>`, padding ≥ 12px 28px.
- All `<img>` need `alt`, explicit `width`, `style="display:block;max-width:100%"`.
- Footer: VAHDAM® UK · address placeholder `{{ organization.full_address }}` · unsubscribe link `href="{% unsubscribe %}"` (Klaviyo tags).
- Where a Klaviyo discount code could slot, use literal `{{CODE}}` only if the slot brief calls for it (none do this week).
