# VAHDAM Lifecycle OS — Streamlit-in-Snowflake distribution

**Branch: `snowflake-streamlit-app` — permanently separate. NEVER merge into `main`.**
(Enforced by `main`'s required check `.github/workflows/protect-main-from-sis.yml`,
which fails any PR from this branch. Port changes by hand in either direction.)

## THE app (there is exactly one)

| | |
|---|---|
| **App object** | `VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA` |
| **Title in Snowsight** | **Ads Dashboard USA** |
| **URL** | <https://app.snowflake.com/streamlit/uxdeihw/mo06981/#/apps/VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA> |

Every deploy from this branch targets that one object, so the URL never changes.
Any other Streamlit app in the account (e.g. an old "VAHDAM Analytics" /
"Ads Dashboard" object) is a stale duplicate — `deploy.sql` §3 drops the retired
`VAHDAM_DB.APPS.VAHDAM_ADS_ANALYSIS` so it cannot be opened by mistake.
If the app you open does not match this README, you are on the wrong object or
a stale build: run `SHOW STREAMLITS IN DATABASE VAHDAM_DB;` and redeploy.

This branch runs **natively inside Snowflake**: authentication and warehouse
come from the logged-in session (`get_active_session()`) — no Vercel, no
Supabase, no PAT, no HTML pages. Charts are Altair. Sources are **read-only**
and zero-fabrication: a metric whose source table is not in the warehouse shows
a declared gap, never an estimated number. (The one write path is the Feedback
tab's own dedicated table — never a source/platform table.)

## Current UI contract

**LHS sidebar = navigation only** (Section + Analysis view). **All data filters
live in the top bar of the page** (Channel · Account · Marketplace · Level ·
Objective · Status · Date range · Refresh). All tables default to **descending**
sort (spend, else the first metric; raw views newest-first).

### Section 1 — Ads Analysis (8 analysis views in the LHS menu)
1. **Omnichannel Master View** — dynamic title per filters, KPI strip, the
   spec column array (hierarchy → Created At/Edited On → Delivery → Engagement
   → Conversion metrics), paginated (no row caps), per-row detail opener
2. **Comparison Engine** — 2-10 campaigns, every metric side-by-side with
   Δ-vs-average shading, metric chart + daily overlay
3. **Cohort Exploration** — age/gender/region/state (+ US census-region rollup),
   country, DMA, device, placement — dimensions discovered live; each cohort
   opens a detail page incl. exact Meta targeting conditions (no invented geo keys)
4. **Overview & priority metrics** — exact SQL totals + the full metric catalog
   under category tabs ("unavailable — needs: X" when an input column is absent)
5. **Single entity deep-dive** — Campaign / Ad Set / Ad drill-down: config +
   audience fields, every base+derived metric, daily trend, per-ad breakdown,
   creatives register with previews
6. **Ad explorer (all fields)** — every column the source carries, field map by
   role, paginated, CSV export
7. **Spend tracker** — monthly channel × marketplace matrix + day-wise campaign
   matrix (live replica of the Ad-Spends tracker)
8. **UGC creator ads** — per-creator/per-ad paid performance + the UGC scoring
   engine over the loaded tracker

### Section 2 — Ads Intelligence (7 tabs)
Ad platform tables · Creatives & assets · Trackers (UGC/retail/sales) ·
Metric catalog (the ONE catalog, mirrored from the web app) · Accuracy
calculator · **Insights generated** (evidence-quoting, computed live; optional
Snowflake Cortex narrative) · **Feedback** (logs to
`VAHDAM_DB.MAPLEMONK.DASHBOARD_FEEDBACK`, newest first)

### Data sources
Meta reads a **live-discovered union**: `VAHDAM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS`
plus every warehouse table matching regex `META.*USA.*TEA` (validated
insights-shaped; columns aligned, missing ones NULL). The sidebar lists the
discovered sources. Breakdowns: `MAPLEMONK1` age/gender + device tables and
`META_USA_AD_CREATIVES`. TikTok: `DATON.RAW.TIKTOK_ADS_USA_*` (our Ad Set level
maps to TikTok's ADGROUP tables). Google: `MAPLEMONK.GOOGLE_ADS_USA`.
Trackers: `VAHDAM_DB.TRACKERS.*` via `trackers/load_trackers.sql`.
Created At / Edited On render only when the source truly carries those columns
(Meta's insights sync does not — honestly omitted, never substituted).

## Deploy — always to ADSDASHBOARDUSA
1. **CI (preferred):** push to this branch → `.github/workflows/deploy-sis.yml`
   runs `snow streamlit deploy --replace`. Needs repo secrets
   `SNOWFLAKE_ACCOUNT` · `SNOWFLAKE_USER` · `SNOWFLAKE_PAT` ·
   `SNOWFLAKE_WAREHOUSE` · `SNOWFLAKE_ROLE` (PAT requires the user's network
   policy; regenerate the PAT after attaching it).
2. **Snowsight Git workspace:** Pull this branch → Deploy to the EXISTING
   `VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA` (replace) → hard-refresh the app.
3. **Worksheet:** run `deploy.sql` (stage upload + CREATE OR REPLACE + retires
   the old duplicate object).

Config: `snowflake.yml` (identifier `ADSDASHBOARDUSA`, title "Ads Dashboard
USA", main_file `streamlit_app.py`, artifacts only that file +
`environment.yml`). Dependencies (Snowflake Anaconda channel — **no** PyPI
integration): `streamlit · pandas · altair · snowflake-snowpark-python`.

**Stale-build check:** open the app and confirm the sidebar shows exactly two
sections — *Ads Analysis* and *Ads Intelligence*. Anything else (a "Data
Analysis" or "Mailer Intelligence" section, filters in the sidebar) means an
old build or the wrong app object.

## What this branch deliberately does NOT contain
The web app (mailers, calendars, ChaiGPT, generation pipelines, serverless
`api/`, Supabase) lives on `main` and deploys to Vercel. This branch carries
only what runs inside Snowflake. That divergence is the point — hence the
never-merge rule.
