# VAHDAM — Product Catalog

The product architecture, hero products, and the URL patterns every tool uses to link to the live storefronts.

## Catalog sizes (active products)

| Market | Active products |
|---|---|
| US | 173 |
| UK | 101 |
| Global | 102 |

Catalogs are built at deploy time from `products_export_{usa,uk,global}.csv` via `scripts/build-catalog.js` into `data/catalog/products_{region}.json`. Each product record exposes a handle field (`h`) used to build product-detail-page URLs.

## Category architecture

VAHDAM's range organises into five buyable families:

1. **Teas & Botanicals** — the heritage core: black teas, chai/masala chai, green teas, herbal/wellness infusions. Sold as loose leaf and tea bags. One-time-purchase framing (see offers file).
2. **Coffee / Ashwagandha** — the functional-coffee franchise. Subscription-first framing; the single largest revenue line.
3. **Supplements** — Turmeric Curcumin, Green Burner, Ashwagandha capsules. Subscription-first framing (refill rhythm).
4. **Gifts & Samplers** — advent calendars, gift sets, private-reserve tins, sampler/starter kits. Occasion- and discovery-driven.
5. **Accessories** — brewing and serving hardware (infusers, kettles, serveware) that support the ritual.

## Hero products (use these exact names)

### Coffee / Ashwagandha franchise
- **Ashwagandha Coffee** — the flagship. Top US product by net sales; the top UK products are all part of this franchise.
- **Ashwagandha Coffee Refill** — subscription/repurchase SKU; a top UK seller.
- **Ashwagandha Coffee Starter Kit** — entry bundle (includes a gift/starter component); a top UK seller.
- **Ashwagandha Coffee 3-Packs** — multi-unit pack, the anchor for Buy-2-Get-1 mechanics.

### Teas & Botanicals
- **India's Original Masala Chai** — the signature chai.
- **Double Spice Masala Chai** — the bolder chai variant.
- **Daily Assam** — everyday black tea.
- **English Breakfast** — classic black-tea staple.
- **Himalayan Green** — the green-tea hero.
- **Turmeric Ginger Herbal** — the herbal/wellness hero.

### Supplements
- **Ashwagandha 1800mg Capsules** — the supplement hero.

### Gifts & Samplers
- **Advent Calendar** gift sets — seasonal gifting anchor.
- **Signature Private Reserve** — premium tin / gifting piece.

> Do not invent product names beyond those listed above. Categories may be referenced generally; individual SKUs must come from the live catalog JSON.

## Top-selling context (US, trailing 12 months)

Top US product: **Ashwagandha Coffee** (~$115,600 net). Top US categories in order: **Coffee, Black Teas (Loose Leaf), Chai Teas (Loose Leaf), Herbal Teas (Tea Bags), Christmas Gifts.** See `06-market-intelligence-summary.md` for full performance headlines.

## Market store URLs (VERIFIED)

| Market | Store base URL |
|---|---|
| US | `www.vahdamteas.com` |
| UK | `uk.vahdamteas.com` |
| IN (India) | `www.vahdamindia.com` |
| EU | `eu.vahdamteas.com` |
| AU | `au.vahdamteas.com` |
| Global / ME | `www.vahdamteas.com` |

### URL patterns

- **Product detail page (PDP):** `{base}/products/{handle}` — where `{handle}` is the `h` field in the catalog JSON.
- **Collection page:** `{base}/collections/{slug}` — resolved via the `heroMap` in `collectionUrl()`.

Always pick the base URL that matches the recipient's market. A US mailer must link to `www.vahdamteas.com`; a UK mailer to `uk.vahdamteas.com`; and so on.
