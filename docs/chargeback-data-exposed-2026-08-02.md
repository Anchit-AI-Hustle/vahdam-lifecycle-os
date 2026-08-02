# VAHDAM USA — all chargeback data, exposed

**Date:** 2026-08-02
**Scope change:** the earlier pass (`chargeback-data-pull-2026-08-02.md`) stopped at the Shopify
connector gate and deliberately queried nothing else. The instruction "expose all chargeback data"
lifts that restriction, so this pass reads every source that actually holds chargeback data.
**Where the two documents disagree, this one is correct** — it is measured, that one recorded a block.

**Primary source:** `VAHDAM_DB.DC_RAW.SHOPGQL_VAHDAM_VAHDAMUSA_US_SHOPGQL_ORDERS_DISPUTES`
joined to `..._SHOPGQL_ORDERS` and `..._SHOPGQL_ORDERS_EVENTS`, in Snowflake.
Every figure below is **measured** from that warehouse unless explicitly marked inferred.

---

## 0. The one thing that is genuinely not there: reason codes

**Gap 1 cannot be closed from any source available, and now I can prove why rather than assume it.**

The disputes table has exactly six columns:

| Column | Meaning |
|---|---|
| `row_id`, `ts_created` | warehouse bookkeeping |
| `id` | Shopify dispute GID |
| `initiatedas` | `CHARGEBACK` or `INQUIRY` |
| `status` | `LOST` / `WON` / `NEEDS_RESPONSE` / `UNDER_REVIEW` |
| `vahdam_vahdamusa_us_shopgql_orders_id` | FK to the order |

There is **no `reason` column, and no other table in the warehouse has one.** This is not a sync
failure — it is what Shopify's API returns at this level. The connector pulls the order-level
`OrderDisputeSummary` object, which by design carries only id/status/initiatedAs. Reason codes
(`fraudulent`, `unrecognized`, `subscription_canceled`, …) live on `ShopifyPaymentsDispute` under
`shopifyPaymentsAccount.disputes`, a different query root that was never synced.

Checked and empty: the only other dispute tables are `SHOPGQL_TMP_*` staging copies, both 0 rows.
The `AMAZON_IN_V1_LISTFINANCIALEVENTS_CHARGEBACKEVENTLIST*` tables are Amazon India marketplace
events — a different entity, different payment rail, irrelevant to the Shopify Payments rate.

**Consequence:** the prediction that `fraudulent`/`unrecognized` dominate remains **untested**. Nothing
below confirms or refutes it. Anyone who states a reason-code distribution today is inventing it.

---

## 1. Headline numbers — Shopify Payments, Aug 2025 – May 2026, UTC

| Metric | Value | Status |
|---|---|---|
| Distinct Shopify Payments orders | **15,265** | measured |
| Disputed orders | **52** | measured |
| Blended dispute rate | **0.341%** | measured |
| Total disputed value | **$3,404.39** | measured |
| Average disputed order value | **$65.47** | measured |
| Total disputes on record (all time) | **327** | measured |

The order count and the disputed value both reproduce the brief's previously-verified figures
exactly — 15,265 orders and $3,404.39 to the cent. That is a strong independent corroboration of the
prior analysis.

### ⚠️ Deduplication is load-bearing

The raw orders table holds **84,735 rows for 82,086 distinct orders** — 2,649 duplicate rows, of
which **2,253 fall inside this window**. A naive `COUNT(*)` returns **17,518** orders and a blended
rate of 0.297%; the correct `COUNT(DISTINCT "id")` returns 15,265 and 0.341%. The duplication is
visible in the data: `paymentgatewaynames` appears in two serialisations (`['shopify_payments']` and
`["shopify_payments"]`), i.e. two sync generations landed the same orders twice.

**Any future query against this table must dedupe on `id`, or it will understate the dispute rate by
about 13%.** This is the single easiest way to get a wrong answer here.

---

## 2. Where the disputes come from

| Channel (`app_name`) | Orders | Disputed | Rate |
|---|---|---|---|
| Online Store | 13,620 | 29 | 0.213% |
| **Loop Subscriptions** | **1,212** | **22** | **1.815%** |
| Shop | 344 | 1 | 0.291% |
| tectonic-commerce | 82 | 0 | 0.000% |
| Draft Orders | 7 | 0 | 0.000% |
| **Total** | **15,265** | **52** | **0.341%** |

Loop is **7.9% of volume but 42% of disputes** — an 8.5× higher rate than the Online Store.

Excluded from Shopify's metric, correctly: PayPal and other non-Shopify-Payments gateways. PayPal
disputes resolve inside PayPal and never reach this rate.

### Outcomes for the 52 in-window disputes

| Status | Count | Loop | Non-Loop |
|---|---|---|---|
| Lost — chargeback | 21 | 4 | 17 |
| **Needs response** | **16** | **10** | **6** |
| Won — chargeback | 10 | 4 | 6 |
| Under review | 5 | 4 | 1 |

Win rate on resolved in-window disputes: **10 of 31 = 32.3%.** Across all 327 on record it is 33.8%
(102 won / 200 lost / 16 needs response / 5 under review / 4 won-inquiry).

**All 16 "needs response" disputes on the entire record sit inside this window, and 10 of them are
Loop.** They were open at the 31 May snapshot. Dispute response windows are short, so most have
likely lapsed by now — but that is an inference from the calendar, not a measurement. The live
Shopify admin is the only way to know, and it is worth checking today.

---

## 3. Monthly series — and exactly where the data stops

| Month | SP orders | Loop orders | Loop share | Disputed | Rate |
|---|---|---|---|---|---|
| 2025-08 | 903 | 40 | 4.43% | 1 | 0.111% |
| 2025-09 | 914 | 32 | 3.50% | 1 | 0.109% |
| 2025-10 | 1,051 | 41 | 3.90% | 1 | 0.095% |
| 2025-11 | 2,485 | 58 | 2.33% | 5 | 0.201% |
| 2025-12 | 2,212 | 66 | 2.98% | 10 | 0.452% |
| 2026-01 | 1,200 | 60 | 5.00% | 5 | 0.417% |
| 2026-02 | 1,032 | 43 | 4.17% | 1 | 0.097% |
| 2026-03 | 1,447 | 101 | 6.98% | 7 | 0.484% |
| 2026-04 | 1,942 | 232 | 11.95% | 13 | 0.669% |
| 2026-05 | 2,079 | 539 | 25.93% | 8 | 0.385% |
| 2026-06 | **4** | 0 | 0.00% | 0 | — |

**Loop volume grew 13.5× from August to May, and its share of Shopify Payments volume grew from 4.4%
to 25.9%.** That mix shift, not any deterioration in behaviour, is what moves the blended rate.

### Gap 2: May is real, June does not exist

- **May 2026 is complete on the order side**: 2,079 Shopify Payments orders — measured.
- **June 2026 has 4 orders.** The `vahdamusa_us` connector stopped landing on 1 June 2026. The last
  dispute sync timestamp is 2026-05-31. June is absent, not low.

The May dispute count (8, by order date) is **not comparable** to the brief's expected 12–13 per
month, for two reasons: it counts by order-creation date rather than dispute date, and disputes lag
their orders by weeks, so recent months are structurally immature — a dispute filed in June against a
May order was never synced. **May's 8 is a floor, not a count.** June cannot be estimated at all.

---

## 4. Gap 3: the retry pattern — partially confirmed, and it concentrates in Loop

There is no transactions table in the warehouse. But `..._SHOPGQL_ORDERS_EVENTS` (818,903 rows)
carries a `sale_failure` action — declined payment attempts — with messages of the form
*"Unable to process a payment for $48.13 USD using a Mastercard ending in 1264."*

**Failed attempts per order, Aug 2025 – May 2026:**

| Order channel | Failure events | Orders affected | Attempts per order |
|---|---|---|---|
| **Loop Subscriptions** | **223** | **69** | **3.23** |
| Online Store | 187 | 135 | 1.39 |
| Shop | 10 | 7 | 1.43 |
| tectonic-commerce | 2 | 2 | 1.00 |

**A Loop order that fails gets retried 2.3× more often than an Online Store order that fails.** That
is the retry concentration, measured.

**May 2026 alone:** 51 orders with failures, 141 attempts, worst single order 8 attempts, longest
span 15 days, **zero orders reaching 10+ attempts.**

Monthly escalation tracks Loop's growth: 19 events (Feb) → 38 (Mar) → 59 (Apr) → **141 (May)**.

### What this does and does not confirm

The brief's figures were 147 orders / 590 attempts across **May–July**, 12 orders at 10+ attempts,
worst 22 attempts over 80 days. I can only see through 31 May, so:

- **Directionally confirmed** — a real, escalating retry problem concentrated in Loop rebills.
- **Not confirmed** — the specific counts. May alone gives 51 orders / 141 attempts. Extrapolating to
  three months is in the right neighbourhood but an 80-day span and 22 attempts necessarily extend
  past the data's edge.

### Who generates the retries — a partial answer

Every `sale_failure` event carries **`attributeToApp = false` and an empty `appTitle`.** Shopify is
not attributing these retries to any third-party app. They are recorded as plain gateway-level sale
failures, not as Loop-app API calls.

**Read this carefully:** it means the events cannot be used to pin the retries on Loop's scheduler.
It does not prove Shopify dunning owns them either — `attributeToApp` is unreliable for subscription
rebills, which are often submitted through the merchant's own payment session. The concentration
(3.23 vs 1.39 attempts/order) says the Loop rebill path is where retries accumulate; **who sets the
cadence still requires Loop's own retry-settings dashboard.** That remains the open question, and it
is the one that determines who can turn it down.

---

## 5. The two figures to check — both CONFIRMED

### Renewal identification via `app_name` — **CONFIRMED, and the risk is real**

A subscription order is identified by the **selling plan on its line items**
(`SHOPGQL_..._ORDERS_LINEITEMS.sellingplan_sellingplanid IS NOT NULL`) — the actual
subscription relationship, not an inference from customer history:

| Segment | Orders | Disputed | Rate |
|---|---|---|---|
| Loop renewal (tagged `Loop Subscriptions`) | 1,212 | 22 | 1.815% |
| **Subscription sign-up — has a selling plan, NOT tagged Loop** | **1,872** | **8** | **0.427%** |
| One-off (no selling plan) | 12,181 | 22 | 0.181% |

**1,872 orders carry a subscription selling plan and are not tagged `Loop Subscriptions`.** The tag
captures renewals only; sign-ups land as `Online Store`. Confirmed on the subscription relationship
itself, which is what makes this decisive rather than suggestive.

This reproduces the brief's segmentation almost exactly — **the dispute counts match to the unit
(22 / 8 / 22)** and the rates to three decimals; only the denominators differ by 7–18 orders. That
mutual agreement, reached by two independent routes, is the strongest evidence in this document.

Corroborating case: customer `7410628165675` below — order #1 is `Online Store`, orders #2–11 are all
`Loop Subscriptions`.

> **Method note — a wrong approach that was tried first.** An earlier cut of this table defined the
> middle segment as "any non-Loop order from a customer who ever placed a Loop order" and reported
> 927 orders / 4 disputes. **That was wrong and has been replaced.** The predicate sweeps in ordinary
> one-off purchases that a subscriber happens to make before or after a renewal, so it neither counts
> sign-ups nor proves they are sign-ups. It also missed genuine sign-ups whose subscription never
> renewed. Do not use association-with-a-Loop-customer as a subscription test; use the selling plan.

### Customer `7410628165675` — **CONFIRMED, and worse than described**

11 orders, all PAID, **none cancelled**:

| # | Order | Date | Channel | Amount | Disputed |
|---|---|---|---|---|---|
| 1 | #US25981991 | 2025-04-20 | **Online Store** | $65.84 | |
| 2 | #US26112291 | 2025-05-30 | Loop | $49.37 | |
| 3 | #US26266891 | 2025-07-09 | Loop | $49.37 | |
| 4 | #US26396691 | 2025-08-18 | Loop | $65.84 | ✔ |
| 5 | #US26536791 | 2025-09-27 | Loop | $60.35 | ✔ |
| 6 | #US26694491 | 2025-11-06 | Loop | $60.35 | ✔ |
| 7 | #US27120691 | 2025-12-16 | Loop | $60.35 | ✔ |
| 8 | #US27316991 | 2026-01-25 | Loop | $60.35 | ✔ |
| 9 | #US27497791 | 2026-03-06 | Loop | $60.35 | ✔ |
| 10 | #US27745491 | 2026-04-15 | Loop | $60.35 | |
| 11 | #US28025191 | **2026-05-25** | Loop | $60.35 | |

Six consecutive disputed renewals, Aug 2025 – Apr 2026 (the brief's dates are exact), **$367.59
disputed**. The subscription was never cancelled — and it **billed again on 25 May 2026, after the
sixth dispute**, on the last day the feed has data. The account was still active at the edge of the
data. Whether it is active *today* needs the live admin.

This one customer is **6 of the 22 Loop disputes — 27%.** Removing them takes the Loop renewal rate
from 1.815% to **1.32%** (16 of 1,206), close to the brief's predicted 1.33%.

They are the only customer with more than 2 disputes. Five others have exactly 2, four of those Loop.

---

## 6. Where this contradicts the brief

Stated explicitly rather than quietly absorbed:

| Figure | Brief | Measured | Note |
|---|---|---|---|
| SP orders in window | 15,265 | **15,265** | exact match |
| Disputes / value | 52 / $3,404.39 | **52 / $3,404.39** | exact match |
| Renewals | 1,205 / 22 / 1.83% | **1,212 / 22 / 1.815%** | 7 orders apart, disputes identical |
| Subscription first orders | 1,861 / 8 / 0.43% | **1,872 / 8 / 0.427%** | 11 orders apart, disputes identical |
| One-off | 12,199 / 22 / 0.18% | **12,181 / 22 / 0.181%** | 18 orders apart, disputes identical |
| PayPal orders | 1,865 | 1,836 in prior analysis | not re-measured here |
| Retry pattern | 147 orders / 590 attempts (May–Jul) | 51 / 141 (May only) | window truncated at 31 May |

The segmentation now **agrees with the brief on every dispute count** (22 / 8 / 22) and every rate;
only the denominators move by 7–18 orders, consistent with minor boundary handling (Draft Orders,
split-tender). Totals reconcile exactly: 1,212 + 1,872 + 12,181 = 15,265 and 22 + 8 + 22 = 52.

Two independent methods — the brief's and this one — landing on the same dispute counts is the
strongest single validation available here, and it is the reason the segment rates can be relied on
even though reason codes cannot be recovered.

---

## 7. Which recommendation actually matters

**Still not answerable on reason codes** — those do not exist in any accessible system, so the
decision table in the brief (fraud → billing recognition, `subscription_canceled` → cancellation
flow, `product_unacceptable` → the Coffee product) cannot be resolved. That has not changed.

But the data answers a *different* and more actionable question, and the answer is unambiguous:
**this is a Loop rebill problem, and the blended rate is being driven by mix, not by decay.**

Loop's own rate has been roughly stable while its share of volume went 4.4% → 25.9% in ten months.

> **On the "80% Loop mix" crossover — inferred, and not directly comparable to Shopify's threshold.**
> Holding both segment rates constant, this document's blended rate reaches 1.5% at about 80% Loop
> mix. **That crossover must not be read as "Shopify will act at 80% mix."** These rates attribute
> disputes to order-creation cohorts; Shopify measures by dispute date against settled transactions,
> and §Method notes states the two do not reconcile. Comparing them directly is an apples-to-oranges
> bridge.
> The direction of the error is worth stating: recent cohorts are **immature** (disputes lag their
> orders, and the sync stopped 31 May), so the observed segment rates are understated for recent
> months. **The true crossover is therefore likely to arrive at a mix lower than 80%, not higher.**
> The caveat cuts against safety. Treat 80% as a rough ceiling on the mix headroom, not a target, and
> recompute on Shopify's own metric once the feed is restored and dispute periods have matured.

What is *not* in doubt is the shape: the blended rate is rising because Loop's share is rising, not
because any segment is deteriorating. Three things are worth doing before the reason codes ever
arrive, because none of them depend on knowing the reason:

1. **The 16 open "needs response" disputes** — 10 of them Loop, all still open at the 31 May snapshot.
   Check the live admin today. This is the only item with a deadline.
2. **Customer `7410628165675`** — six disputes, still billing as of 25 May, never cancelled. One
   account is 27% of the Loop dispute count. Cancel it.
3. **The Loop retry cadence** — Loop orders retry 2.3× more per failure than Online Store orders, and
   failures grew 7× from February to May. Get Loop's retry-settings dashboard to find who owns the
   schedule.

Do not slow Loop growth. The channel is performing; the rebill experience around it is what needs
work.

---

## 8. Still requires live Shopify Admin

| Question | Why the warehouse cannot answer |
|---|---|
| **Dispute reason codes** | Not in the API object that was synced. Needs `shopifyPaymentsAccount.disputes`. |
| **June + July 2026** | Connector dead since 1 June. |
| **Current status of the 16 open disputes** | Snapshot is 31 May; windows have likely lapsed. |
| **Is `7410628165675` active today?** | Last observation 25 May. |
| **Retry ownership (Loop vs Shopify dunning)** | `attributeToApp=false` on every event; needs Loop's dashboard. |
| **Reconciliation to Shopify's own 1.01%** | Payout reports count by settlement date; this counts by order date. They will not reconcile — do not force them. |

**Restoring the `vahdamusa_us` connector as it stands fixes rows 2–5 only. It does NOT deliver reason
codes.** The feed syncs `OrderDisputeSummary`, which has no `reason` field at all (§0) — so a restored
connector will resume landing the same six columns and the reason-code gap will persist unchanged.

Reason codes need a **separate ingestion change**: add the `shopifyPaymentsAccount.disputes` query
root (fields `reasonDetails { reason networkReasonCode }`) to the sync, which is a new object and a
new table, not a restart of the existing one. Two distinct pieces of work — do not let the connector
restoration close out the reason-code ask.

---

## Method notes

- All timestamps UTC; month boundaries computed in UTC.
- Shopify Payments only: `paymentgatewaynames ILIKE '%shopify_payments%'`, which correctly includes
  split-tender orders (`shop_cash` + `shopify_payments`, `gift_card` + `shopify_payments`).
- Every count deduped with `COUNT(DISTINCT "id")` — see §1.
- Subscription orders are identified by **selling plan on the line item**
  (`ORDERS_LINEITEMS.sellingplan_sellingplanid IS NOT NULL`), never by customer association — see the
  method note in §5 for why the association approach is invalid.
- Dispute attribution is by **order creation date**, not dispute date. Shopify's own metric uses
  dispute date against settled transactions. These are directionally sound but not arithmetically
  identical to Shopify's 1.01%, and **any figure in this document that is compared to Shopify's 1.5%
  threshold inherits that mismatch** — see the caveat in §7.
- Warehouse columns are lowercase and must be double-quoted in Snowflake SQL.
