# VAHDAM — Brand Foundation

The verbal and visual identity for VAHDAM Teas. This file governs how every mailer, ad, landing page, and message sounds and looks.

## Brand story

VAHDAM Teas is a premium, direct-to-consumer Indian heritage tea brand. Its founding idea is simple and unusually literal: bring tea straight from the source. India grows some of the world's finest tea, yet historically the best leaves were auctioned, shipped, blended, and aged for months before reaching a cup abroad. VAHDAM shortened that path — sourcing directly from single estates in Darjeeling, Assam, and the Nilgiris and shipping garden-fresh, so the tea a customer steeps is closer to the season it was picked in.

The brand has since grown beyond tea into functional wellness: **Ashwagandha Coffee** (a functional coffee built around the adaptogen ashwagandha) is now its single largest product, alongside a focused supplements range (Turmeric Curcumin, Green Burner, Ashwagandha capsules). The through-line is unchanged: origin-first, honestly sourced, made to become part of someone's daily ritual.

## Positioning

- **Single-estate, Indian heritage.** Tea and botanicals traced to named gardens and regions, not commodity blends.
- **Garden-fresh.** Direct sourcing means shorter time from harvest to cup; freshness is a genuine, provable differentiator.
- **Ethical and sustainable.** B-Corp-minded sourcing, fair grower relationships, and a sustainability story that is stated plainly rather than dressed up.
- **Wellness with proof, not hype.** Functional benefits (adaptogens, curcumin) are framed with restraint — never as miracle claims.

Positioning line to hold in mind: VAHDAM sells **origin and ritual**, not novelty. Copy should feel like an invitation into something crafted and lasting.

## Mission

Make the world's finest, freshest, ethically sourced Indian teas and botanicals part of everyday life — connecting the people who grow them directly to the people who drink them, and building daily rituals of restore and balance around them.

## Visual identity

### Palette — ONLY these four colors

| Role | Name | Hex |
|---|---|---|
| Primary | Forest green | `#004A2B` |
| Accent | Gold | `#AB8743` |
| Ink | Near-black | `#171717` |
| Ground | Cream | `#FBF5EA` |

Do **not** introduce off-palette tints. Known drift values that are banned: `#0f2a1c`, `#d4873a`, `#fdf6e8`, `#1a3a28`, `#1a1a1a`, `#faf8f4`. When a design needs contrast or depth, use opacity/spacing/typography — never a new hue.

### Typography — strict

- **Headings:** Lao MN, Regular and Bold. Fallback stack: `'Lao MN','Cormorant Garamond',Georgia,serif`.
- **Body:** Proxima Nova. Fallback stack: `'Proxima Nova','Helvetica Neue',Arial,sans-serif`.

The style guide forbids any other font for emailers. Never use Cormorant or DM Sans as the *primary* family (they exist only in the fallback chain). In JS template strings, never wrap font names in quotes in a way that breaks the literal — build the stack as a plain string.

## Verbal identity

### Banned phrases (never use)

`wellness journey`, `transform`, `liquid gold`, `game-changer`, `LIMITED TIME` (in caps), `hurry`, `don't miss out`, `last chance`, `while supplies last`.

Also banned everywhere in output copy: **em dashes and en dashes**. Use commas, colons, or plain hyphens instead. (This is enforced programmatically by `scrubDashes()` / `sanitizeBrand()` in `api/_shared/scenario-model.js`.)

### Preferred lexicon

`ritual`, `restore`, `balance`, `origin`, `single-estate`, `hand-picked`, `steep`, `heritage`, `crafted`.

### Copy voice

Warm, sensory, emotionally resonant, story-driven. Testimonials read as tiny personal stories, not star-rating reviews. Copy leads with a felt moment, then earns the product. It respects the reader's intelligence: no false urgency, no hype, no exclamation-mark stacking.

## On-brand sample paragraphs

> There is a moment, just after the water settles, when the leaves open and the whole kitchen smells of the garden they came from. That is the moment we chase. Every batch of our Darjeeling is hand-picked at a single estate and shipped while it is still garden-fresh, so the cup in your hands carries the season it was grown in.

> Mornings do not need to be loud to be good. A slow steep of India's Original Masala Chai, the spices blooming in the milk, and a few unhurried minutes before the day begins. This is the ritual we make our tea for: not a reset, just a small return to balance.

> Coffee you already love, with something quietly useful folded in. Our Ashwagandha Coffee is crafted around a single-origin roast and the adaptogen ashwagandha, so your usual cup does a little more for the way you feel through the afternoon. Same ritual, steadier ground.
