---
description: Pull Vahdam store data by scraping the public storefronts (US / UK / Global) — products, prices, collections, content. No Admin API / connector.
argument-hint: "[ask, e.g. 'all ashwagandha coffee products + prices, US vs UK']"
---

# Store data — public storefront scrape

Answer: `$ARGUMENTS`. **Do NOT use the Shopify Admin MCP connector** (no auth granted). Scrape the public storefronts only, for these three markets:

| Market | Live storefront | Status (verified 2026-06-21) |
|---|---|---|
| US | `https://www.vahdamteas.com` | ✓ `/products.json` returns live catalog (USD) |
| Global | `https://www.vahdamteas.com` | ✓ same origin as US; differs by currency |
| UK | — | ✗ no reachable JSON storefront: `uk.vahdamteas.com` is **NXDOMAIN**, `www.vahdamteas.co.uk` is a holding/lander page. **Use local `data/catalog/products_uk.json`** for UK products; flag to the user if live UK pricing is required. |

## Public endpoints (no auth — these are open on every Shopify storefront)
- **Full catalog:** `{base}/products.json?limit=250&page=N` — paginate until empty. Returns title, handle, variants (price, sku, available), images, product_type, tags.
- **Single product:** `{base}/products/{handle}.js` (or `.json`) — live price/variant/inventory-ish availability.
- **Collection:** `{base}/collections/{slug}/products.json?limit=250` — products in a collection.
- **Page content / reviews / copy:** `WebFetch` (or Claude-in-Chrome for JS-rendered bits) on `{base}/products/{handle}`.

## Prefer local first
The repo already builds catalog JSON from CSV exports at `data/catalog/products_{us,uk,global}.json` (via `scripts/build-catalog.js`). Use those for stable catalog facts; **scrape the storefront only for live/current data** (today's price, availability, new SKUs, on-page copy) or to fill gaps.

## Rules
- Be polite: paginate sequentially, don't hammer; cache results in scratchpad for the session.
- Report which market each figure came from; US and Global share an origin so note currency explicitly.
- Reads only — scraping never writes to the store.

Feed insights into `/campaign-plan` or `/analytics`.
