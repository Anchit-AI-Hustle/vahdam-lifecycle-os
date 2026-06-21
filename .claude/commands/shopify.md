---
description: Query and act on the Vahdam Shopify store — products, orders, customers, inventory, analytics, discounts.
argument-hint: "[ask, e.g. 'top 10 products by revenue last 30 days, US']"
---

# Shopify commerce

Answer/act on: `$ARGUMENTS` using the **Shopify MCP** connector.

## Tool routing
- Prefer built-in tools when they fit: `search_products`, `get-product`, `list-orders`, `get-order`, `list-customers`, `get-inventory-levels`, `set-inventory`, `run-analytics-query` (ShopifyQL), `create-discount`, `search_collections`.
- For resources without a built-in tool (metafields, markets, pages, etc.) use `graphql_query` / `graphql_mutation`. Validate with `graphql_schema` / `validate_graphql_codeblocks` first.
- Multi-market: confirm which store/market (`switch-shop` / `get-shop-info`) before reading or writing.

## Guardrails
- **Reads are free; confirm before any write** (inventory, product status, discounts) — these are outward-facing.
- Use real handles for any links: `{marketStoreBase}/products/{handle}`.

Feed insights into `/campaign-plan` or `/analytics` when the ask is strategic.
