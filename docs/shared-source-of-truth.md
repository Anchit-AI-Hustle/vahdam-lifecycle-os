# Shared Source of Truth & Continuous Synchronization

Status: **design + phased build** (contract is binding — see `campaign-orchestration-master-spec.md`
§24b). This document maps the "one record, many views" rule onto the actual VAHDAM Lifecycle OS
codebase and defines the phases to get there without a rewrite.

## The problem it solves

Today several surfaces can each hold their own copy of the same fact, so they drift:
- the `/audit` page vs. the published Claude Artifact showed two different overall scores (the
  divergence that kicked this off) — two records, no shared source;
- `data/brand-facts/<region>.json` (B1 facts), the built catalog `data/catalog/products_*.json`
  (prices/images), the offer/discount table, and each generated asset (mailer/ad/LP) all carry facts
  that can go out of sync when the underlying value changes;
- Smart Brain prebuilds a campaign bundle and stores it in `smart_generated_campaigns`; if the source
  slot is re-planned the bundle is stale until the `payload.__prebuilt` marker is dropped.

The target: **every feature reads/writes canonical records by stable id; a change fans out to all
dependents; stale outputs are marked and gated before launch.**

## Canonical records (authoritative store)

One authoritative row per entity, keyed by a stable id, in Supabase (Postgres):

| Entity | Canonical home (target) | Today |
|---|---|---|
| campaign / calendar slot | `smart_calendar_entries` | exists (rolling plan) |
| product + regional mapping | `smart_products` + built catalog | exists |
| audience cohort | `cohort_definitions` / `smart_*` | exists |
| offer / price / inventory | `offers`, catalog price, (stock = B3) | partial |
| approved claim / review / rating / image | `brand_facts` (+ `data/brand-facts`) | exists (B1, dark) |
| creative asset (mailer/ad/LP) | `smart_generated_campaigns`, `ads_generated`, `landing_pages_generated` | exists |
| blog / creator concept / social post | (new tables, Phase 3 features) | not built |
| forecast / performance result | `smart_campaign_metrics` | partial |
| source reference / validation / approval / publishing status | columns on the above + `sync_state` (new) | partial |

Rule: features store at most a **versioned snapshot + a reference** (`source_id`, `source_version`) to
the canonical row, plus a freshness status. They never treat their snapshot as truth.

## Freshness model

Add a small shared module `api/_shared/sync-core.js` (NOT a function file) exposing:
- `stamp(record, sourceVersions)` — writes `synced_at`, `validated_at`, `source_version`,
  `campaign_version`, `status`.
- statuses: `CURRENT` · `SYNCING` · `STALE — REGENERATION REQUIRED` · `BLOCKED — SOURCE CONFLICT` ·
  `BLOCKED — SOURCE UNAVAILABLE` · `VALIDATION REQUIRED` · `SYNC FAILED`.
- `isStale(asset, canonical)` — compares the asset's stored `source_version` to the canonical row's
  current version; the generalization of today's `payload.__prebuilt` marker check.
- `preLaunchGate(assetId)` — re-fetches canonical rows, revalidates the launch-critical fields,
  returns `{ ok, blockers[], stale[] }`.

## Event propagation

Events (logical, dispatched in-process on write; a durable queue can back them later):
`campaign.updated`, `product.updated`, `price.updated`, `inventory.updated`, `offer.updated`,
`claim.updated`, `review.updated`, `rating.updated`, `asset.updated`, `audience.updated`,
`forecast.updated`, `approval.updated`, `publication.updated`, `source_conflict.detected`.

Each event runs: dependency lookup → affected-record id → recalculation → revalidation → stale-output
marking → safe preview regeneration → audit-log entry → user-visible status update. This generalizes
what Smart Brain already does on daily sync (material re-plan → drop `__prebuilt` → queue rebuild).

## Conflict handling

Optimistic concurrency: every canonical row carries a `version`. A write includes the base version it
read; a mismatch → `source_conflict.detected` instead of a silent overwrite. Factual / launch-critical
conflicts require an approved resolution; full change history is preserved in the audit log.

## Audit

`sync_audit_log`: previous value, new value, source, initiating feature, actor, timestamp, reason,
affected outputs, regeneration result, validation result.

## Phased build (each phase ships + is verifiable on its own)

1. **Foundations (no behavior change):** `sync-core.js` (statuses, `stamp`, `isStale`, `preLaunchGate`
   scaffold) + `sync_state`/`sync_audit_log` migrations. Generalize the existing `__prebuilt`
   staleness into `isStale`. Gated behind Supabase being reachable (B2).
2. **Freshness surfacing:** stamp generated assets on write; show the status chip on `/assets`, the
   Brain console, the Email Calendar and Campaign Detail. Read-only — no propagation yet.
3. **Pre-launch sync gate:** wire `preLaunchGate` into approve/schedule/export/publish (Brain
   `approveEntry`, `/lp` serve, download bundle). Block launch on a differing critical dependency.
4. **Event propagation:** dispatch the events above on canonical writes; fan out recalculation +
   stale-marking to dependents (price/offer/claim/rating/image/audience first — the highest-drift
   facts).
5. **Conflict + full audit:** version columns, optimistic-concurrency writes, conflict UI, complete
   audit log.
6. **Extend to Phase-3 features** (Blog Agent, Creator Plan, Social Generator) as they are built — they
   consume canonical records from day one, never their own copies.

## Dependencies / blockers

- **B2** (rotate `SUPABASE_SERVICE_ROLE_KEY`): the canonical store is Supabase; propagation + audit need
  a working service-role key in prod.
- **B3** (Klaviyo + Shopify read feeds): inventory, live price/stock and real audience counts become
  canonical inputs only once these feeds are wired.
- **B1** (approved-facts library): `brand_facts` is the canonical claim/review/rating source; populate
  it + flip `REAL_FACTS_ONLY` for the facts propagation to carry real values.
