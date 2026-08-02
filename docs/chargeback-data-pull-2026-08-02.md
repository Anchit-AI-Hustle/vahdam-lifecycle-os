# VAHDAM USA — chargeback data pull

**Date:** 2026-08-02
**Status:** **BLOCKED — Shopify connector not authorised against the store. No data pulled.**
**Store targeted:** `vahdamusa.myshopify.com`

---

## Step 0 result: connector capability check

The brief's own gate applies: *"If you only have `find-sample-product`, the connector is not
authorised against the store and nothing below will work. Say so and stop."*

That is exactly the state of this session.

`get-shop-info` was not run because it does not exist in this session. The Shopify MCP server is
connected and its instructions advertise order, customer, inventory, analytics (ShopifyQL) and
`graphql_query` tools — but the tool registry actually exposes **one** tool:

| Tool required by the brief | Present in this session |
|---|---|
| `get-shop-info` | **No** |
| `list-orders` | **No** |
| `get-order` | **No** |
| `list-customers` | **No** |
| `graphql_query` (general Admin API fallback) | **No** |
| `find-sample-product` | Yes — the only Shopify tool available |

`find-sample-product` reads mock.shop, not the merchant's store. It returns candidate products a
merchant *could* sell. It cannot see orders, customers, disputes, transactions or payouts, and it is
not bound to `vahdamusa.myshopify.com` at all.

Three lookups were run against the tool registry to confirm this, including a direct
select-by-name for the four tools the brief names. All four resolved to nothing.

This matches the standing note in `CLAUDE.md`: *"Shopify — ⚠️ Admin connector NOT authorized."*

---

## Consequence for each item in the brief

Nothing below was estimated, inferred from the repo, or substituted from another platform. Every
item is unmeasured.

### 1. Dispute reason frequency table — **NOT PULLED**

Requires per-dispute reason codes for the 52 disputed orders (1 Aug 2025 – 31 May 2026). Reason
codes live on the Shopify Payments dispute object, reachable only via the Admin API
(`shopifyPaymentsAccount.disputes`, or `order.disputes { reason status }` per order).

No frequency table can be produced. The stated prediction — that `fraudulent` and `unrecognized`
dominate — is **untested**; it is neither confirmed nor contradicted here.

### 2. May and June 2026 charge and dispute counts — **NOT PULLED**

Requires order + transaction listing filtered to `gateway:shopify_payments`, UTC month boundaries,
paginated across ~15k orders. The expectation of roughly 12–13 disputes a month remains an
expectation.

July 2026 (1,190 charges / 12 disputes / 1.008%) is carried forward as previously verified from
Shopify's payout report — not re-derived here.

### 3. Declined-payment retry pattern — **NOT CONFIRMED**

The 147 orders / 590 attempts / worst case 22 attempts over 80 days figures come from a prior
transactions export. They could not be re-measured, and the originator of the retries (Shopify
dunning vs. Loop's retry schedule vs. manual reattempts) could not be identified — that requires
reading `transaction.gateway` / `processedAt` sequences and the Loop subscription contract's billing
attempt history.

**This is the item that most needs the connector.** Who owns the retry schedule determines who can
turn it down, and no repo-side artefact answers it.

### 4. The two figures to check — **NEITHER CONFIRMED**

- **Renewal identification via `app_name = "Loop Subscriptions"`.** Unverified. The risk named in
  the brief stands unexamined: if sign-ups really do land as `Online Store`, tag-only segmentation
  misfiles 1,861 subscription first orders. The whole renewal/first-order/one-off split rests on
  this and it remains an assumption.
- **Customer `7410628165675`, six consecutive disputed renewals.** Unverified, and account status
  unknown. The 1.83% → 1.33% renewal dispute rate drop that removing this customer would produce is
  therefore also unverified.

### 5. Which recommendation matters — **CANNOT BE ANSWERED**

The brief makes the recommendation a function of the dominant reason code. Without the reason codes
there is no basis to choose between billing recognition, cancellation flow, the Coffee product, and
fulfilment. Picking one now would be a guess dressed as an analysis.

What can be said without new data: no penalty is in force, the measured rate is 1.008% (July) against
a 1.5% reserve threshold, so there is headroom to get the reason codes before committing to a fix.

---

## What unblocks this

One of:

1. **Authorise the Shopify MCP connector against `vahdamusa.myshopify.com`** with read scopes for
   orders, customers and Shopify Payments disputes (`read_orders`, `read_customers`,
   `read_shopify_payments_disputes`, `read_shopify_payments_payouts`). Then re-run this brief
   unchanged.
2. **Set `SHOPIFY_*` credentials in Vercel** so this repo's own read-only Admin core
   (`api/_shared/shopify-core.js`, `/api/shopify?op=orders|customers|summary`) goes live. Note it has
   no dispute op today — `op=disputes` would need adding, and it is gated on `LIVE_CONNECTORS`.

Two other live sources exist in this session — Snowflake (`sql_exec_tool`) and Supermetrics (which
carries a Shopify data source). **Neither was used.** Both were excluded deliberately: the brief
prohibits substituting another data source, and neither is Shopify's dispute object, which is the
only authoritative record of a reason code.

---

## Figures carried forward, all previously measured, none re-verified here

| | | Basis |
|---|---|---|
| US orders, Aug 2025 – May 2026, Shopify Payments | 15,265 | prior work — measured |
| Disputes in window | 52, $3,404.39 | prior work — measured |
| Renewals | 1,205 orders, 22 disputes, 1.83% | prior work — measured, but see §4 |
| Subscription first orders | 1,861 orders, 8 disputes, 0.43% | prior work — measured, but see §4 |
| One-off orders | 12,199 orders, 22 disputes, 0.18% | prior work — measured, but see §4 |
| Underlying renewal rate, maturity-controlled | 1.60% | prior work — inferred |
| Dispute fee | $15.00 | prior work — measured |
| July 2026 | 1,190 charges, 12 disputes, 1.008% | Shopify payout report — measured |
| Order counts vs Shopify export | 99.92% agreement | prior work — measured |
| Renewal disputes that were a first automatic charge | 16 of 22 | prior work — measured |

The three segment rows are flagged because their denominators depend on the unverified
`app_name` segmentation in §4. If that assumption is wrong, all three shift.

---

## Traps — recorded for the re-run, not applied to anything here

- Order timestamps are UTC; keep month boundaries in UTC or counts drift.
- Filter to Shopify Payments only; PayPal (1,865 orders in window) resolves disputes inside PayPal
  and never reaches this metric.
- Payout reports count by settlement date, order lists by creation date. They do not reconcile —
  no creation-date window reproduces the payout report's 1,190. Do not force them to match.
- 15,000+ orders: paginate fully and verify totals rather than trusting a first page.
