# Catalogue verification — US, read 2026-09-02

Source: Shopify Admin API, **VAHDAM® USA** (`www.vahdam.com`), Shopify Plus, USD, EDT.
Every price used in this campaign was read here, not taken from the brief.

## The brief's price list is wrong in four places

The standing brief carries a catalogue summary captioned as store structure. Checked
against the live store, four of its statements do not hold. This is exactly why it
says never to print a price from it unchecked.

| Brief says | Live store says | Nature of the error |
|---|---|---|
| Chai Teas `$12.49-$22.99` | Sweet Cinnamon Masala Chai 3.53 oz is **$10.99** | Band floor too high |
| Chai Teas `$12.49-$22.99` **and** "India's Original Masala Chai 12oz $25.99" | — | **Self-contradictory**: the line item sits above its own band ceiling |
| Herbal/Tisanes `$7.49-$24.99` | Turmeric Ginger 100 Count is **$25.99** | Band ceiling too low |
| "India's Original Masala Chai 12oz $25.99 and 100ct $23.99" | Search returned the **30 Count at $12.49**; no 12 oz or 100 ct surfaced | **Unverified** — not used anywhere in this campaign |

## Verified and used in this campaign

| Product | Price | SKU | Units | Used in |
|---|---|---|---|---|
| Turmeric Ginger Herbal Tea Tisane, 100 Count | **$25.99** | `H7-6EH0-6NM0` | 1,913 | Meta control, TikTok, Instagram, reel |
| Daily Assam Black Tea, 12 oz | **$25.99** | `AMZBK2` | 924 | Meta retargeting, email hero |
| English Breakfast Black Tea, 12 oz | **$23.99** | `AMZBK3` | 908 | Email cross-sell |
| Foldable Advent Calendar, 24 Teas, 1.69 Oz | **$17.49** | `FZ-773E-9QZN` | 245 | Story, YouTube end card |

Confirmed but **deliberately not used**:

| Product | Price | Units | Why not |
|---|---|---|---|
| Turmeric Ginger, 30 Count | $9.99 | 280 | Best cold-traffic price in the store, but 280 units is ~$2,800 of sellable stock. That will not carry paid prospecting. Belongs on the landing page as a trade-down, not as an ad hero. |
| Classic Advent Calendar, 24 Teas | $42.49 | **25** | 25 units cannot absorb any media spend. Excluded from paid entirely. |
| Turmeric Ginger, 18 Count | $3.09 | **0** | Out of stock and still `ACTIVE`. Sellable-looking, unsellable. |
| 2026 Halmari Clonal Assam Second Flush | $29.99 | 71 | Pre-booking item; its own description says orders ship from 2026-08-30. Needs ops confirmation before it is advertised. |

## Two catalogue problems that need a human

**1. The Foldable Advent Calendar is listed twice, both active, both $17.49.**

| Product ID | SKU | Units | Product type | Handle |
|---|---|---|---|---|
| 7269352210475 | `FZ-773E-9QZN` | 245 | Gifts \| Christmas | `foldable-advent-calendar-tea-gift-24-teas-1-69-oz-48g` |
| 7271460569131 | `6F-EO9M-147Y` | 307 | Gifts \| Occasion | `...-48g-1` (note the trailing `-1`) |

The creative points at the first. That splits 552 units of real inventory across two
PDPs, splits the conversion data for the same product, and means a shopper who lands
on one can see the other sold out. **Resolve before spending**: merge, or redirect one
handle to the other. This is not a creative decision.

**2. `NET WT.` is unconfirmed for two SKUs.** Turmeric Ginger 30 Count and English
Breakfast 12 oz are bracketed in `build/catalog.js` rather than guessed. Neither
appears on a creative carrying a weight declaration.

## Market lock

Every pack shot was opened and read before use. All show US dual declaration:

- Turmeric Ginger 100 ct — `NET WT. 7.05 OZ (200g) • 100 INFUSION BAGS`, USDA Organic, Non-GMO Project Verified
- Daily Assam 12 oz — `NET WT. 12 OZ 340 g`, Climate Neutral Certified, Non-GMO Project Verified, Certified Plastic Neutral
- Foldable Advent — `1.69 Oz, 48g` per the product title

No metric-only weight, no `£`/`€`, no "FOOD SUPPLEMENT" wording. **Zero UK/EU assets
were used, and none were rejected, because none entered the pipeline**: the source is
the US store's own Admin API, which cannot return another market's catalogue.

## Correction to repo memory

`CLAUDE.md` states *"Shopify Admin connector NOT authorized; use public storefront
scraping via `/shopify`"*. That is now stale — the Admin connector authenticated and
returned live data throughout this build. Worth fixing, because it currently tells the
next person to use a weaker source than the one available.
