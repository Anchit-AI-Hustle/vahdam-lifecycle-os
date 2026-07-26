# VAHDAM Lifecycle OS — Streamlit-in-Snowflake distribution

**Branch: `snowflake-streamlit-app` — permanently separate. NEVER merge into `main`.**
(Enforced by `main`'s required check `.github/workflows/protect-main-from-sis.yml`,
which fails any PR from this branch. Port changes by hand in either direction.)

## THE app (there is exactly one) — it is a WORKSPACES app, not a stage app

Corrected 2026-07-26 against the live account. This README previously named an
object that **does not exist**, which is what produced
`Stage 'VAHDAM_DB.MAPLEMONK.STREAMLIT_STAGE' does not exist or not authorized`.

| | |
|---|---|
| **App object** | `USER$.PUBLIC.ST16DFD18C278CC8519B9BDD3318FC9CB3980ABC72` |
| **Title in Snowsight** | **Ads Dashboard USA** |
| **Backed by** | Snowsight Workspace `Ads Dashboard` → `/ws/USER$/PUBLIC/DEFAULT$/Ads Dashboard/streamlit_app.py` |
| **`url_id`** | `6pijhfqfbcoleaokckpm` |
| **Owner** | `ANCHITTANDON` (USER role type) |

`SHOW STREAMLITS IN ACCOUNT` returns exactly this one row.
`VAHDAM_DB.MAPLEMONK.ADSDASHBOARDUSA` is **not** in the account, and
`SHOW STAGES IN DATABASE VAHDAM_DB` returns **zero rows** — there is no
`STREAMLIT_STAGE`. A Workspaces app does not use one; Snowsight serves the app
straight out of the Git-linked workspace folder.

### Deploy: Pull, then Run. No SQL, no stage.
1. Snowsight → **Projects → Workspaces → "Ads Dashboard"**
2. **Pull** — brings this branch in, including `.streamlit/config.toml` **and**
   `data/ads/*.json`. Both are required: the first forces the light theme, the
   second feeds the governance tabs.
3. **Run**

The sidebar prints the build id and the active theme. If the build id is older
than the one in `streamlit_app.py`, the Pull did not take. Do **not** run
`deploy.sql` to fix a deploy — it targets the alternative stage flow, needs
`CREATE STAGE` + `CREATE STREAMLIT` on `VAHDAM_DB.MAPLEMONK` (which `CLAUDE_ROLE`
does not hold), and would mint a **different URL** from the app in use today.

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

### Every table and chart carries the FULL metric set
Rule for this app: a table or chart shows **every metric the source supports**, never a
hand-picked handful. `sql_group_sums` sums every additive column in SQL over all rows in
scope; `full_metric_frame` then adds every **derived** metric from the one catalog on
those sums, so CTR/CPC/CPM/CPP/frequency/ROAS/hook-rate and the rest appear wherever
their inputs exist. A derived metric whose inputs are absent stays absent rather than
rendering as `0`; `order_table` sinks all-empty columns to the right so the schema stays
honest without getting in the way. Charts take a metric multi-select rather than being
hardwired to spend.

⚠️ **Ratios must never be summed, and 16 columns were being summed.** `RATIO_COLS` was
an explicit 9-name set; it caught `ctr`/`cpc`/`cpm`/`cpp`/`frequency` but missed
`unique_ctr`, every `cost_per_*`, every `*_rate`, the auction bids and the canvas
averages. Measured live on `Target - In-house - Sales PageDeck Campaign` (1,133 rows,
July 2026):

| Column | Summed (what was shown) | Correct | Wrong by |
|---|---|---|---|
| `ctr` | 3,891.83 | 4.7051 | 827× |
| `unique_ctr` | 3,639.40 | ~4.7 | ~775× |
| `cost_per_inline_link_click` | **$107.65** | **$0.2684** | **401×** |
| `frequency` | 556.95 | ~1.07 | impossible |

This is the most dangerous class of wrong: nothing errors, and the output still looks
like a metric. Now detected by **name pattern** (`is_ratio_col`) rather than an explicit
list, so columns Meta adds later are caught too, and those columns are still **shown** —
as an **impression-weighted average** instead of a sum. Cross-validated: weighted
`cost_per_inline_link_click` = $0.2702 against $0.2684 recomputed independently from
sums, and frequency = 1.068.

### Section 1 — Ad Campaigns Master (11 tabs, the landing section)
Mirrors `ad-campaigns-master.html` **tab for tab, in the same order, with the same
labels**, so the Snowflake app and the web app are the same dashboard rather than
two different products:

**Live Now · Calendar · Tracker · Accounts · SOP · Overview · Campaigns & Ads ·
Creative Intel · Organic & UGC · Knowledge Base · Ops & Data Sources**

Governance content is read from the **same four files the web page fetches** —
`data/ads/master-kb.json`, `ads-live-snapshot.json`, `ad-accounts.json`,
`target-ads-meta-2026-07-20.json` — off the app root rather than over HTTP. They
are ported by hand onto this branch (the SiS branch is a separate distribution)
and listed in `snowflake.yml` `artifacts`. A file that is genuinely absent yields a
**declared gap**, never invented content. Every top-level key in the knowledge base
is surfaced by some tab; a generic renderer handles each JSON shape (lists of
uniform dicts become sortable tables, scalar dicts become field/value tables,
nested dicts recurse) so no field is silently dropped.

Where the web page can only show its committed snapshot, this section reads the
warehouse **live** — today's per-account delivery, the daily spend series, ad-level
"is it serving yet", live campaign rows in tracker shape, live creator posts from
`JB_USA`, and a source-freshness check run at render time. That is the one place
the two surfaces intentionally differ, and each figure is labelled so it is never
ambiguous which is which.

### Section 2 — Ads Analysis (11 analysis views in the LHS menu)
View 2 is **Platform parity — every metric**: whatever can be analysed in Meta Ads
Manager or the Google Ads UI is analysable here, proven field by field. The field
inventory is read from `INFORMATION_SCHEMA` at render time (not curated, so nothing
can be quietly omitted) — **119 columns** on Meta DTC insights, **112** on Meta
retail, **145** on the Google ad-level report. Includes results by action type with
all six attribution windows, the video funnel and retention curve, Meta's three
relevance rankings, and breakdowns carrying their own per-action-type detail.
A capability that genuinely is not synced is a **declared gap** naming what and why.

⚠️ **The Meta sidecars must be deduped before joining.** Airbyte appends on every
incremental sync instead of replacing: `META_USA_ADS_INSIGHTS_ACTIONS` holds
1,836,934 rows for only 404,006 distinct `(hashid, action_type)` keys — one key alone
has 600 rows across 25 `_AIRBYTE_EMITTED_AT` values. Joining the raw children fans
out catastrophically: July DTC purchases came back as **51,941 worth $2,331,289.84
against $15,499.25 of spend** — a 194× overstatement, and more than the all-time raw
sum for that action type. Keeping only the newest emission per
`(hashid, action_type, target, destination)` and pre-aggregating each child before
joining gives **267 purchases worth $11,456.03 (0.74 ROAS)** inside a coherent funnel
of 13,510 link clicks → 1,850 checkouts → 376 add-to-cart. Also note
`COST_PER_ACTION_TYPE` is **empty (0 rows)**, so cost per result is derived from spend
rather than shown as permanently blank.

Known gaps, all the same shape (a report the pipeline does not sync): Google
impression share / lost IS (budget, rank), search terms, geo and audience segments;
Google keywords exist only as a stale stub (1,166 rows, 2026-02-27 to 2026-03-30);
Meta hourly breakdown. Impression share cannot be derived from spend and clicks, so
no substitute is offered.


0. **Ad accounts & retail funnel** *(landing view)* — the whole ad-account estate,
   described account by account: what each one is FOR, which KPI it can honestly
   be judged on, its currency, its warehouse table and how fresh that feed is,
   with live spend/ROAS-or-CTR read for the selected window. Then the **retail
   funnel**, which joins spend in `MAPLEMONK` to outcomes in `MAPLEMONK1` (Target
   Roundel attributed sales + real Target store sell-through) — the only honest
   way to answer "is the Target programme working", because the Target/Costco
   Meta account records zero purchases by construction. Closes with the
   `MAPLEMONK1` retail measurement layer and the data-shape traps in it
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
9. **UGC command center** — native rebuild of the JB UGC tracker dashboard
   (vahdam-june-usa-ugc-dashboard.netlify.app): Overview · Scoring & Logic
   (log-normalised weights, view-confidence multipliers, ad-rec thresholds,
   score benchmarks — methodology mirrored exactly) · View Summary · TikTok /
   Instagram Top 25 · All Creators (filterable, CSV) · Ad Performance (tracker
   sheets + live warehouse UGC ads) · Hook & Script Bible. All figures computed
   live from `VAHDAM_DB.TRACKERS.*`; unloaded sheets show declared gaps

### Section 3 — Ads Intelligence (7 tabs)
Ad platform tables · Creatives & assets · Trackers (UGC/retail/sales) ·
Metric catalog (the ONE catalog, mirrored from the web app) · Accuracy
calculator · **Insights generated** (evidence-quoting, computed live; optional
Snowflake Cortex narrative) · **Feedback** (logs to
`VAHDAM_DB.MAPLEMONK.DASHBOARD_FEEDBACK`, newest first)

### Data sources
Meta reads a **live-discovered union**: `VAHDAM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS`
plus every table matching `%TEA_ADS_ADS_INSIGHTS` in `MAPLEMONK`/`MAPLEMONK1` and
every table matching regex `META.*USA.*TEA` (validated insights-shaped; columns
aligned, missing ones NULL). The sidebar lists the discovered sources. Breakdowns:
`MAPLEMONK1` age/gender + device tables and `META_USA_AD_CREATIVES`. TikTok:
`DATON.RAW.TIKTOK_ADS_USA_*` (our Ad Set level maps to TikTok's ADGROUP tables).
Google: `MAPLEMONK.US_GOOGLE_ADS_CONSOLIDATED`.
Trackers: `VAHDAM_DB.TRACKERS.*` via `trackers/load_trackers.sql`.

#### Two source corrections (2026-07-26, both verified live)
- **The Target/Costco Meta account is in the warehouse.** It is
  `MAPLEMONK.USA_TEA_ADS_ADS_INSIGHTS` — a name carrying no `META`, so the
  `META.*TEA` regex never matched it and the account was invisible. 6,556 rows,
  26 campaigns, $50,248.24, fresh to 2026-07-25. Its May ($3,608.06) and June
  ($14,422.93) spend match the KT Master Ad Tracking Sheet to the cent.
- **US Google was never stale.** `GOOGLE_ADS_USA` does not exist, and
  `GOOGLE_ADS_US_AD_GROUP_AD_REPORT` holds the *retired* customer `2769294429`
  and correctly stops 2023-11-24. The live customer is `9797311905` in
  `US_GOOGLE_ADS_CONSOLIDATED`, fresh to 2026-07-25 at 1.98 ROAS in 2026 YTD.

#### `MAPLEMONK1` is not just Meta breakdown tables
It carries the whole retail-partner stack, and that is where the Target programme
is actually measured: `TARGET_ADS_DAY_TARGET_ADS_REPORT` (**Target Roundel** — an
entire additional ad platform, with Target-attributed sales and a real ROAS),
`TARGET_ADS_KEYWORD_TARGET_ADS_REPORT`, `TARGET_SALES_TARGET_SALES` (real store
sell-through: $129,605 / 10,406 units across 1,210 stores, fresh to 2026-07-23),
`TARGET_AISLE_*`, `TARGET_IBOTTA_*`, `JB_USA` (JoinBrands UGC, posts through
2026-07-22), `WALMART_SALES_*`, `CADS_USA_*` (Amazon Ads) and `AVP_NOW_*`.

⚠️ **Data-shape traps in those feeds.** They are Airbyte CSV loads. Money arrives
as TEXT with a currency symbol and thousands separators (`'$125.95'`,
`'2,907,903'`) so a direct numeric cast fails outright, and dates carry TWO shapes
in one column (`DD-MM-YYYY` on older rows, `DD-MM-YYYY H:MI` on newer ones).
Parsing only the bare date form silently drops the newest rows — it made Target
sell-through look like it ended 2026-07-13 when it runs to 2026-07-23,
understating July by $28,446. Use the `sf_cash` / `sf_qty` / `sf_day` helpers.

#### Theme — white + green, forced light (three layers, all required)
White surfaces, forest-green (`#004A2B`) headings, metric cards and table headers,
dark text on light backgrounds everywhere, never a dark panel and **never a blue**.
Where a chart needs a second categorical colour the two greens differ by **shade,
not hue** (`GREEN_SOFT` vs `GREEN`), so the palette holds while series stay
distinguishable.

Snowsight runs its own dark UI and the embedded app **inherits it**, so the theme
has to be forced in three places. Skip any one and it goes dark again:

| Layer | Fixes | Why CSS alone is not enough |
|---|---|---|
| **`.streamlit/config.toml`** (`base="light"`, `primaryColor="#004A2B"`) | data grids, BaseWeb defaults | `st.dataframe` renders through glide-data-grid on a **canvas**, themed from Streamlit's JS theme object — the DOM is never consulted, so no injected CSS can reach the cells |
| **CSS in `streamlit_app.py`** | select controls, dropdown popovers, option rows, selection chips, calendar, tabs, code blocks | Selects/menus/calendars render in a **portal at `body` level, outside `.stApp`** — scoping the rules to `.stApp` is exactly what left the dropdowns dark and their options unreadable. These selectors are deliberately unscoped. BaseWeb's accent is **blue** and leaks through any theme that only sets backgrounds, so every checked/hover/focus/chip state is overridden to green |
| **Altair theme** (registered at import) | chart canvas, axes, legends, categorical ramp | Streamlit hands Vega-Lite a theme following the host UI, so charts come back dark-on-dark under Snowsight dark mode. Registered via `alt.theme.register` with a fallback to the pre-5.5 `alt.themes` API |

⚠️ **`config.toml` must land in the `.streamlit/` SUBFOLDER of the app root**, not
beside `streamlit_app.py`. In the wrong place it is silently ignored. It is listed
in `snowflake.yml` `artifacts` so `snow streamlit deploy` places it correctly;
if you upload by hand, check with
`LIST @VAHDAM_DB.MAPLEMONK.STREAMLIT_STAGE/adsdashboardusa;`.
The sidebar prints the **active** theme and warns loudly when it is not `light`,
so a config that failed to reach the stage is visible instead of puzzling.
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
