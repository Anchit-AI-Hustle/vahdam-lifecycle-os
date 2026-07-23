# VAHDAM Lifecycle OS — Streamlit-in-Snowflake distribution

**Branch: `snowflake-streamlit-app` — permanently separate. NEVER merge into `main`.**
(Enforced by `main`'s required check `.github/workflows/protect-main-from-sis.yml`,
which fails any PR from this branch. Port changes by hand in either direction.)

This branch is a self-contained version of the Lifecycle OS analytics stack that
runs **natively inside Snowflake**: authentication and warehouse come from the
logged-in session (`get_active_session()`) — no Vercel, no Supabase, no PAT, no
HTML pages. Charts are Altair. Everything is **read-only** and zero-fabrication:
a metric or task whose source table is not in the warehouse shows a declared
gap, never an estimated number.

## Sections (sidebar)
| Section | What it renders | Tables |
|---|---|---|
| **Data Analysis** | sources & budget pacing (Target $1,000/day · Costco $300/day), portfolio KPIs, the 42-metric catalog + live accuracy calculator | Meta/TikTok/Google ads tables |
| **Ads Analytics** | six analysis views: Overview · **Single campaign** (config + audience fields, every base+derived metric, daily trend, per-ad breakdown, breakdown-table audience, creatives register) · **Multi-campaign compare** (every metric × campaign side-by-side + charts) · **Ad explorer** (ALL columns the table carries, field map by role, CSV export) · Campaign/ad rows · Cohorts. **Account** = the real Meta ad accounts (live from `account_name`); **Marketplace (Target/Costco)** is derived from the ad names as its own filter/dimension | `VAHDAM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS`, `MAPLEMONK1` breakdowns + `META_USA_AD_CREATIVES`, `DATON.RAW.TIKTOK_ADS_USA_*`, `MAPLEMONK.GOOGLE_ADS_USA` |
| **Mailer Intelligence** | Klaviyo / WebEngage campaigns, flows and events — discovers the real mailer tables loaded in the warehouse; declared gaps otherwise | whatever mailer exports are synced |

(The Business Review and Roles & Permissions sections were removed from this app
on request — the sidebar carries exactly three sections: Data Analysis, Ads
Analytics, Mailer Intelligence.)

## Deploy (mints the URL)
Fastest — **Snowsight → Projects → Streamlit → + Streamlit App**: pick a
database/schema + warehouse, paste `streamlit_app.py` (single file), add
`altair` in Packages, Run.

Git-native — link this repo/branch in a Snowsight Workspace and deploy with
`snowflake.yml` (main_file `streamlit_app.py`, artifacts only that file +
`environment.yml`), or run `deploy.sql`.

Dependencies (all Snowflake Anaconda channel — **no** PyPI integration needed):
`streamlit · pandas · altair · snowflake-snowpark-python`.

Known URL pattern once created:
`https://app.snowflake.com/uxdeihw/mo06981/#/streamlit-apps/<DB>.<SCHEMA>.<APP_NAME>`

## What this branch deliberately does NOT contain
The web app (mailers, calendars, ChaiGPT, generation pipelines, serverless
`api/`, Supabase) lives on `main` and deploys to Vercel. This branch carries
only what runs inside Snowflake. That divergence is the point — hence the
never-merge rule.
