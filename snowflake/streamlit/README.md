# VAHDAM Ads Analysis — Streamlit in Snowflake

A native Snowflake app (Streamlit-in-Snowflake) for paid-media analysis. It runs
**inside** Snowflake and authenticates through the logged-in session
(`get_active_session()`), so there are **no keys, no PAT, no Supabase** — it reads
the warehouse tables the Daton / Maplemonk pipelines already load, read-only.

- **Charts:** Altair (not Plotly).
- **Data:** pulled from Snowflake (replacing the Supabase-backed path) —
  `VAHDAM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS`, the Meta `..._AGE_AND_GENDER` /
  `..._PLATFORM_AND_DEVICE` cohort tables, and the `DATON.RAW.TIKTOK_ADS_USA_*`
  report + breakdown tables. Google via `VAHDAM_DB.MAPLEMONK.GOOGLE_ADS_USA`.
- **Views:** Overview (priority metrics), Campaign/Ad rows, Cohorts
  (age×gender, device, country) for the Costco + Target US accounts.

## Deploy (mints the URL)

Fastest — **Snowsight → Projects → Streamlit → + Streamlit App**: choose
`VAHDAM_DB.APPS` and a warehouse, paste `streamlit_app.py`, add `altair` in the
Packages picker, Run. Snowflake creates the app and its URL on save.

Scripted — run `deploy.sql` (creates the stage + `CREATE STREAMLIT`). Upload
`streamlit_app.py` and `environment.yml` to the stage first.

**App URL** (once created):
`https://app.snowflake.com/uxdeihw/mo06981/#/streamlit-apps/VAHDAM_DB.APPS.VAHDAM_ADS_ANALYSIS`

## Scope note

This SiS app is the **analytics** surface. The full marketing OS (Mailer Studio,
calendars, ChaiGPT, generation, landing pages) remains the web app at
`vahdam-lifecycle-os.anchit-tandon.com` — unchanged by this folder. Adding these
files does not touch any web route or the Vercel build.
