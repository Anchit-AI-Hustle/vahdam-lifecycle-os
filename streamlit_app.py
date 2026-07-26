"""
VAHDAM Lifecycle OS — Ads Analysis + Ads Intelligence (Streamlit in Snowflake).

Runs NATIVELY inside Snowflake. Authentication and warehouse come from the
logged-in Snowflake session via get_active_session() — no external keys, no PAT,
no Supabase. Every figure is read directly (read-only) from the warehouse tables
the Daton / Maplemonk pipelines already load. Charts use Altair (not Plotly).

The landing view is "Ad accounts & retail funnel": the whole ad-account estate
described account by account (what each is FOR and which KPI it can honestly be
judged on), plus the retail funnel that joins spend in MAPLEMONK to outcomes in
MAPLEMONK1 — Target Roundel attributed sales and real Target store sell-through.
That join is the only honest way to answer "is the Target programme working",
because the Target/Costco Meta account records zero purchases by construction:
its shoppers check out inside Target, so no VAHDAM pixel ever fires.

Two sections (parity comes from ONE source of truth — these Snowflake tables +
the ONE metric catalog below, mirrored field-for-field from the web app's
api/_shared/ad-metrics-catalog.js so a metric is defined once and computed
identically everywhere):

  • Ads Analysis      — Meta / Google / TikTok, per campaign / ad set / ad, plus
    demographic / geo / device cohorts, comparison engine, spend + UGC trackers.
  • Ads Intelligence  — discovery over the ads warehouse (every ad/creative/
    tracker table that really exists), the full metric catalog (definition +
    formula per metric), the live accuracy calculator, generated insights
    (evidence-quoting, computed live) and the feedback log.

Deploy: snowflake/streamlit/deploy.sql (CREATE STREAMLIT ...). Snowflake mints
the app URL when the Streamlit object is created in the account.
"""

import json
import math
import re
import traceback

import altair as alt
import pandas as pd
import streamlit as st
from snowflake.snowpark.context import get_active_session

# ── Session (always) ─────────────────────────────────────────────────────────
session = get_active_session()

st.set_page_config(page_title="VAHDAM Analytics", layout="wide")

# Bumped on every code change — the sidebar shows it, so a stale deployment is
# instantly recognisable (if the running app shows an older build id, the
# workspace was not redeployed after the last pull).
APP_BUILD = "2026-07-26.1"

# Layout hygiene: Streamlit columns overflow instead of shrinking by default,
# so long metric values / widget labels / headings visually overlap their
# neighbours. Force everything to wrap INSIDE its own column.
# White + GREEN only. Mirrors the web app's contrast tokens (ad-campaigns-master
# .html :root): white surfaces, forest-green headers and accents, dark text on
# light backgrounds everywhere, never a dark panel. Where a second categorical
# colour is needed the two greens differ by SHADE, not hue, so the palette stays
# white-and-green while remaining distinguishable.
st.markdown("""
<style>
  :root {
    --green: #004A2B; --green-mid: #0E5C36; --green-soft: #DCEDE3;
    --bg: #F5F8F6; --surface: #FFFFFF; --surface-2: #F0F5F2;
    --line: #DCE7E0; --line-strong: #B8CCC0;
    --text: #1F2A23; --dim: #3D4A42;
  }
  .stApp, [data-testid="stAppViewContainer"] { background: var(--bg); }
  [data-testid="stHeader"] { background: transparent; }
  [data-testid="stSidebar"] { background: var(--surface); border-right: 1px solid var(--line-strong); }
  [data-testid="stSidebar"] * { color: var(--text); }
  html, body, [data-testid="stAppViewContainer"] * { font-weight: 500; }
  h1, h2, h3, h4, h5 { color: var(--green) !important; font-weight: 700 !important; }
  p, li, span, label, div { color: var(--text); }
  /* Metrics as white cards with a green rule, like the web app's .sc tiles. */
  div[data-testid="stMetric"] {
    background: var(--surface); border: 1px solid var(--line);
    border-left: 4px solid var(--green); border-radius: 11px;
    padding: 0.7rem 0.9rem !important; box-shadow: 0 4px 16px rgba(0,74,43,.08);
  }
  div[data-testid="stMetricValue"] { color: var(--green) !important; font-weight: 700 !important; }
  div[data-testid="stMetricLabel"], div[data-testid="stMetricLabel"] p {
    color: var(--dim) !important; text-transform: uppercase; letter-spacing: .05em;
  }
  /* Green table headers with white text, striped white/very-light-green body. */
  [data-testid="stDataFrame"] thead tr th, [data-testid="stTable"] thead tr th {
    background: var(--green) !important; color: #fff !important; font-weight: 700 !important;
  }
  [data-testid="stDataFrame"] tbody tr:nth-child(even) td { background: var(--surface-2); }
  [data-testid="stTable"] tbody tr:nth-child(even) td { background: var(--surface-2); }
  /* Tabs and expanders on white, active tab underlined green. */
  button[data-baseweb="tab"] { color: var(--dim) !important; font-weight: 700 !important; }
  button[data-baseweb="tab"][aria-selected="true"] { color: var(--green) !important; }
  [data-baseweb="tab-highlight"] { background: var(--green) !important; }
  [data-testid="stExpander"] { background: var(--surface); border: 1px solid var(--line); border-radius: 11px; }
  .stButton > button { background: var(--green); color: #fff; border: 1px solid var(--green); font-weight: 700; }
  .stButton > button:hover { background: var(--green-mid); border-color: var(--green-mid); }
  [data-testid="stAlert"] { background: var(--green-soft); border-left: 4px solid var(--green); color: var(--text); }
  hr { border-color: var(--line-strong); }
  a { color: var(--green) !important; }
  div[data-testid="column"] { min-width: 0; }
  div[data-testid="stMetric"] { padding: 0.15rem 0.4rem 0.15rem 0; overflow: hidden; }
  div[data-testid="stMetricValue"] {
    font-size: clamp(0.95rem, 1.4vw, 1.45rem);
    white-space: normal; overflow-wrap: anywhere; line-height: 1.15;
  }
  div[data-testid="stMetricLabel"], div[data-testid="stMetricLabel"] p {
    white-space: normal; overflow-wrap: anywhere; font-size: 0.78rem;
  }
  div[data-testid="stWidgetLabel"] p {
    white-space: normal; overflow-wrap: anywhere; font-size: 0.82rem;
  }
  h1, h2, h3, h4 { overflow-wrap: anywhere; }
  div[data-testid="stCaptionContainer"] p { overflow-wrap: anywhere; }
</style>
""", unsafe_allow_html=True)

# Brand palette (docs/CLAUDE.md — the only four colours)
GREEN, GOLD, INK, CREAM = "#004A2B", "#AB8743", "#171717", "#FBF5EA"

# ── Source tables (verified live against the warehouse) ──────────────────────
META_ADS = "VAHDAM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS"
META_AGE_GENDER = "VAHDAM_DB.MAPLEMONK1.META_USA_ADS_INSIGHTS_AGE_AND_GENDER"
META_DEVICE = "VAHDAM_DB.MAPLEMONK1.META_USA_ADS_INSIGHTS_PLATFORM_AND_DEVICE"
TIKTOK = {
    "campaign": "DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY",
    "adgroup": "DATON.RAW.TIKTOK_ADS_USA_ADGROUP_REPORT_DAILY",
    "ad": "DATON.RAW.TIKTOK_ADS_USA_AD_REPORT_DAILY",
    "age_gender": "DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY_AGE_GENDER",
    "country": "DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY_COUNTRY",
}
# GOOGLE_ADS_USA does not exist in the warehouse, and neither does the live US
# Google feed live in GOOGLE_ADS_US_AD_GROUP_AD_REPORT — that table holds the
# RETIRED customer 2769294429 and stops 2023-11-24, which is what made US Google
# look dead. The live account is 9797311905 in the consolidated view, fresh to
# 2026-07-25 (verified live 2026-07-26).
GOOGLE_ADS = "VAHDAM_DB.MAPLEMONK.US_GOOGLE_ADS_CONSOLIDATED"
GOOGLE_ADS_FILTER = "ACCOUNT = 'Google US CONSOLIDATED'"
GOOGLE_ADGROUP_AD = "VAHDAM_DB.MAPLEMONK.US_GADS_AD_GROUP_AD_REPORT"
GOOGLE_AMAZON = "VAHDAM_DB.MAPLEMONK.US_AMZ_GADS_AD_GROUP_AD_REPORT"

# The Target/Costco retail Meta account. It sits in MAPLEMONK under a name that
# does NOT match META_USA%, which is why a name-based search finds only the DTC
# account and the retail programme looked absent from the warehouse.
META_RETAIL = "VAHDAM_DB.MAPLEMONK.USA_TEA_ADS_ADS_INSIGHTS"

# MAPLEMONK1 is not just Meta breakdown tables — it carries the whole retail
# partner stack, which is where the Target programme is actually measured.
TARGET_ROUNDEL = "VAHDAM_DB.MAPLEMONK1.TARGET_ADS_DAY_TARGET_ADS_REPORT"
TARGET_ROUNDEL_KW = "VAHDAM_DB.MAPLEMONK1.TARGET_ADS_KEYWORD_TARGET_ADS_REPORT"
TARGET_SALES = "VAHDAM_DB.MAPLEMONK1.TARGET_SALES_TARGET_SALES"
TARGET_AISLE = "VAHDAM_DB.MAPLEMONK1.TARGET_AISLE_TARGET_AISLE_REPORT"
TARGET_IBOTTA = "VAHDAM_DB.MAPLEMONK1.TARGET_IBOTTA_REPORT_TARGET_IBOTTA_REPORT"
JB_UGC = "VAHDAM_DB.MAPLEMONK1.JB_USA"

# Daily budget caps (USD). Reference/alerting only — nothing is ever written back.
BUDGETS = {"target": 1000, "costco": 300}

# ── AD-ACCOUNT REGISTRY ───────────────────────────────────────────────────────
# Mirrors adAccounts() in the web app's api/_shared/ads-snowflake-core.js, field
# for field, so the Snowflake app and the web app describe the estate identically
# (spec 24b: one authoritative record, many views).
#
# Enumerated LIVE on 2026-07-26 by unioning every base insights / ad-performance
# table in VAHDAM_DB and grouping by account: 19 feeds across 14 distinct
# accounts. Two things make the registry necessary rather than optional:
#
#  1. Accounts do not share a schema or a naming convention. The Target/Costco
#     Meta account is USA_TEA_ADS_ADS_INSIGHTS (not META_USA%), the live US
#     Google feed is US_GOOGLE_ADS_CONSOLIDATED (not the retired
#     GOOGLE_ADS_US_AD_GROUP_AD_REPORT), and Target Roundel — a whole additional
#     ad platform — sits in MAPLEMONK1. Searching by the obvious name finds one
#     account and makes the rest look absent.
#  2. The accounts are NOT comparable on one KPI. DTC, Google and Roundel can
#     attribute a sale, so ROAS is real. The retail Meta and Amazon accounts send
#     shoppers to target.com, Instacart and amazon.com, so they record zero
#     purchases BY CONSTRUCTION. Ranking those on ROAS would report every retail
#     campaign as a total failure, so each entry declares its own kpi and the
#     views show n/a rather than 0.00x.
#
# "kpi": roas    -> a pixel or platform conversion is tracked; revenue is real.
#        traffic -> third-party checkout; judge on CTR / CPC / CPM / reach.
AD_ACCOUNTS = [
    dict(id="dtc", platform="Meta", region="US", status="live",
         label="Vahdam India USA New EST Main Account", account_id="1303870183798748",
         table=META_ADS, schema="MAPLEMONK", fresh_to="2026-07-25", partial_day=True,
         kpi="roas", attribution="Meta pixel", currency="USD",
         used_for="Prospecting and retargeting to own-site checkout",
         purpose=("US direct-to-consumer storefront. The revenue account: coffee, ashwagandha "
                  "and supplement scale campaigns plus evergreen tea, all landing on "
                  "vahdamteas.com with the Meta pixel firing."),
         verified="129,741 rows · 2024-05-15 to 2026-07-25 · 106 campaigns · 2,299 ads · $425,107.22"),
    dict(id="retail", platform="Meta", region="US", status="live",
         label="VAHDAM USA - Tea Ad Account (Target / Costco)", account_id="804570870670763",
         table=META_RETAIL, schema="MAPLEMONK", fresh_to="2026-07-25", partial_day=True,
         kpi="traffic", attribution="none", currency="USD",
         used_for="Sell-through at Target and Costco (third-party checkout)",
         purpose=("US retail-partner demand generation. Drives shoppers to Target stores and "
                  "target.com, and to Costco via Instacart: the Page Deck sales sets, scored "
                  "UGC video sets, influencer link-click sets, Costco Bay Area reach buys and "
                  "Target giveaways."),
         attribution_note=("Zero purchases by construction: checkout happens on target.com, "
                           "Instacart or in store, so no VAHDAM pixel fires. Judge on CTR, CPC, "
                           "CPM and reach, never ROAS. The outcome is reported by Target instead "
                           "-- see the Retail funnel below."),
         verified="6,556 rows · 2025-09-24 to 2026-07-25 · 26 campaigns · 214 ads · $50,248.24"),
    dict(id="target_roundel", platform="Target Roundel", region="US", status="live",
         label="VAHDAM Teas Global Inc. - RMS", account_id="RMS",
         table=TARGET_ROUNDEL, schema="MAPLEMONK1", fresh_to="2026-07-22", partial_day=False,
         kpi="roas", attribution="Target-attributed sales", currency="USD",
         used_for="Paid placement inside Target search and Target.com",
         purpose=("Target Roundel Media Studio -- retail media bought inside Target. Unlike the "
                  "Meta retail account this one DOES report attributed sales and units, because "
                  "Target matches the ad to the basket, so it is the one Target channel with a "
                  "real ROAS."),
         attribution_note=("ROAS is Target-attributed sales over actualized vendor spend, matched "
                           "by Target, not pixel-based. Comparable across Roundel campaigns but "
                           "not directly against Meta pixel ROAS."),
         verified="804 rows · 2026-05-04 to 2026-07-22 · 10 campaigns · $40,314.74 spend · $23,264.68 attributed · 0.58 ROAS"),
    dict(id="google_us", platform="Google", region="US", status="live",
         label="VAHDAM (US Google Ads)", account_id="9797311905",
         table=GOOGLE_ADS, schema="MAPLEMONK", fresh_to="2026-07-25", partial_day=True,
         kpi="roas", attribution="Google conversions", currency="USD",
         used_for="US search, Shopping and PMax demand capture",
         purpose=("US Google Ads: brand and non-brand search, the VM_ PMax family across all "
                  "products and top cities, Shopping, Demand Gen and remarketing. Carries "
                  "Google-attributed conversions and conversion value."),
         verified="2026 YTD: 23 campaigns · $72,343.46 spend · $142,983.81 conversion value · 1.98 ROAS"),
    dict(id="google_amazon", platform="Google", region="US", status="live",
         label="Raghuvansh (Amazon marketplace, Ampd)", account_id="3036820580",
         table=GOOGLE_AMAZON, schema="MAPLEMONK", fresh_to="2026-07-25", partial_day=True,
         kpi="traffic", attribution="marketplace", currency="USD",
         used_for="Amazon marketplace demand capture",
         purpose=("Google Ads bought through Ampd to drive traffic to VAHDAM ASINs on amazon.com "
                  "and amazon.ca. One campaign per ASIN -- Hibiscus, Amla, Moringa, Curcumin, "
                  "Dandelion Root, Chamomile."),
         attribution_note=("Records zero Google conversions because checkout happens inside "
                           "Amazon; sales appear in Seller Central, not here. Judge on CTR and CPC."),
         verified="5,417 rows · 2024-05-11 to 2026-07-25 · 64 campaigns · $66,839.97"),
    dict(id="tiktok_us", platform="TikTok", region="US", status="paused",
         label="VAHDAM USA (TikTok Ads)", account_id="7393105007056388112",
         table=TIKTOK["ad"], schema="DATON.RAW", fresh_to="2026-07-14", partial_day=False,
         kpi="traffic", attribution="TikTok pixel", currency="USD",
         used_for="US TikTok traffic",
         purpose="US TikTok Ads, run as link-click traffic buys.",
         attribution_note="Last spend 2026-07-14 -- the account is paused, not disconnected.",
         verified="13,838 rows · 2025-04-01 to 2026-07-14 · 25 campaigns · $68,178.71"),
    dict(id="meta_uk", platform="Meta", region="UK", status="live",
         label="VAHDAM UK", account_id="573128874469619",
         table="VAHDAM_DB.MAPLEMONK.META_UK_ADS_INSIGHTS", schema="MAPLEMONK",
         fresh_to="2026-07-26", partial_day=True, kpi="roas", attribution="Meta pixel",
         currency="GBP", used_for="UK D2C acquisition and retention",
         purpose="UK direct-to-consumer account on uk.vahdamteas.com. The freshest feed in the warehouse.",
         verified="154,585 rows · 37 campaigns · GBP 661,518.68"),
    dict(id="meta_in", platform="Meta", region="IN", status="live",
         label="VAHDAM India", account_id="70950428",
         table="VAHDAM_DB.MAPLEMONK.META_INDIA_ADS_INSIGHTS", schema="MAPLEMONK",
         fresh_to="2026-07-25", partial_day=True, kpi="roas", attribution="Meta pixel",
         currency="INR", used_for="India D2C acquisition and retention",
         purpose=("India D2C account on vahdamindia.com and by far the largest Meta spender in "
                  "the group. Reports in INR, so never sum it with the USD accounts."),
         verified="117,863 rows · 89 campaigns · INR 36,866,447.39"),
    dict(id="google_uk", platform="Google", region="UK", status="live",
         label="VAHDAM UK (Google Ads)", account_id="3861674115",
         table="VAHDAM_DB.MAPLEMONK.GOOGLE_ADS_UK_AD_GROUP_AD_REPORT", schema="MAPLEMONK",
         fresh_to="2026-07-25", partial_day=True, kpi="roas", attribution="Google conversions",
         currency="GBP", used_for="UK search and Shopping demand capture",
         purpose="UK Google Ads, a tight 5-campaign account.",
         verified="1,352 rows · 2025-09-17 to 2026-07-25 · 5 campaigns · GBP 51,968.24"),
    dict(id="google_in", platform="Google", region="IN", status="live",
         label="VAHDAM - India (Google Ads)", account_id="7719984554",
         table="VAHDAM_DB.MAPLEMONK.GADS_IN_AD_GROUP_AD_REPORT", schema="MAPLEMONK",
         fresh_to="2026-07-25", partial_day=True, kpi="roas", attribution="Google conversions",
         currency="INR", used_for="India search, Shopping and PMax demand capture",
         purpose=("India Google Ads, the longest-running account in the warehouse (from "
                  "2019-08-03) and the largest by spend. Reports in INR."),
         verified="204,660 rows · 2019-08-03 to 2026-07-25 · 260 campaigns · INR 11,715,204.83"),
    # ---- Superseded / archive: kept so history stays queryable and so a reader
    # ---- can see WHY a familiar table is not the one being reported from.
    dict(id="google_us_retired", platform="Google", region="US", status="archive",
         label="VAHDAM - USA - Old (retired Google customer)", account_id="2769294429",
         table="VAHDAM_DB.MAPLEMONK.GOOGLE_ADS_US_AD_GROUP_AD_REPORT", schema="MAPLEMONK",
         fresh_to="2023-11-24", partial_day=False, kpi="roas",
         attribution="Google conversions", currency="USD",
         used_for="Pre-migration Google history (2018-2023)",
         purpose=("The retired US Google customer 2769294429, migrated to 9797311905 in 2023. "
                  "This is the table that made US Google look dead: the pipeline still refreshes "
                  "it but it has held no new rows since 2023-11-24."),
         attribution_note=("Ends 2023-11-24 by design -- the ACCOUNT closed, not the feed. Point "
                           "current US Google reporting at US_GOOGLE_ADS_CONSOLIDATED."),
         verified="91,135 rows · 2018-12-19 to 2023-11-24 · 294 campaigns · $514,353.99"),
    dict(id="retail_dc", platform="Meta", region="US", status="superseded",
         label="VAHDAM USA - Tea Ad Account (Datachannel mirror)", account_id="804570870670763",
         table="VAHDAM_DB.DC_RAW.FB2_VAHDAM_VAHDAMUSATEA_US_FBADS_ADPERFORMANCE", schema="DC_RAW",
         fresh_to="2026-05-31", partial_day=False, kpi="traffic", attribution="none",
         currency="USD", used_for="History only -- do not use for current retail reporting",
         purpose=("Older Datachannel mirror of the same retail account, superseded by the "
                  "Maplemonk feed which is both fresher and far more complete "
                  "(26 campaigns / $50,248.24 against 7 / $4,056.11)."),
         verified="8,953 rows · 2024-11-11 to 2026-05-31 · 7 campaigns · $4,056.11"),
    dict(id="dtc_dc", platform="Meta", region="US", status="superseded",
         label="Vahdam India USA New EST Main (Datachannel mirror)", account_id="1303870183798748",
         table="VAHDAM_DB.DC_RAW.FB2_VAHDAM_VAHDAMINDIAUSA_US_FBADS_ADPERFORMANCE", schema="DC_RAW",
         fresh_to="2026-06-01", partial_day=False, kpi="traffic", attribution="none",
         currency="USD", used_for="Pre-May-2024 DTC history",
         purpose=("Datachannel mirror of the DTC account. Its value is DEPTH, not freshness: it "
                  "reaches back to 2023-01-16 with 147 campaigns against the Maplemonk feed's "
                  "106 from 2024-05-15."),
         verified="133,948 rows · 2023-01-16 to 2026-06-01 · 147 campaigns · $471,130.03"),
    dict(id="meta_us_2022", platform="Meta", region="US", status="archive",
         label="Vahdam Teas - USA (pre-2023 main account)", account_id="591998667827917",
         table="VAHDAM_DB.MAPLEMONK.FB_USA_MAIN_ADS_INSIGHTS", schema="MAPLEMONK",
         fresh_to="2022-08-08", partial_day=False, kpi="traffic", attribution="none",
         currency="USD", used_for="Historic benchmark",
         purpose=("The original US main account and still the largest single US Meta spender on "
                  "record. Useful as a long-run benchmark for 2021-22 US scale."),
         verified="308,008 rows · 2021-01-01 to 2022-08-08 · 228 campaigns · $1,108,896.95"),
]

# The retail-partner measurement layer in MAPLEMONK1 — not ad accounts, but the
# tables that make the retail ad accounts measurable at all.
RETAIL_MEASUREMENT = [
    dict(label="Target store sell-through", table=TARGET_SALES, fresh_to="2026-07-23",
         what=("Dollars and units actually rung up across Target stores, by store, district and "
               "region. The ground truth for whether the Target programme works."),
         verified="12,291 rows · 2026-05-01 to 2026-07-23 · $129,605 · 10,406 units · 1,210 stores"),
    dict(label="Target Roundel keyword detail", table=TARGET_ROUNDEL_KW, fresh_to="2026-07-22",
         what="The same Roundel spend split by keyword, for search-term diagnosis.",
         verified="98,647 rows"),
    dict(label="Target Aisle", table=TARGET_AISLE, fresh_to="2026-07-24",
         what="Target Aisle, carrying its own ROI, fees, payout, sign-ups and redemptions.",
         verified="25 rows"),
    dict(label="Target Ibotta rebates", table=TARGET_IBOTTA, fresh_to="2026-07-24",
         what=("Ibotta rebate offers across Walmart, Instacart, DoorDash, Uber, Schnucks, Giant "
               "Eagle, Family Dollar and Dollar General, with unlocks, redemptions and units moved."),
         verified="143 rows"),
    dict(label="JoinBrands UGC creator posts", table=JB_UGC, fresh_to="2026-07-23",
         what=("Creator posts with platform, handle, post link, posted date, job price, views, "
               "likes and comments. The only creator feed current to last week -- posts run "
               "through 2026-07-22, while the Master UGC Tracker's own posts stop 2026-07-16."),
         verified="471 posts · 302 creators · $36,100.15 creator cost · 107,037 views"),
]

# These retail feeds are Airbyte CSV loads: money arrives as TEXT carrying a
# currency symbol and thousands separators ('$125.95', '2,907,903') so a direct
# numeric cast fails outright, and dates carry TWO shapes in one column
# ('DD-MM-YYYY' on older rows, 'DD-MM-YYYY H:MI' on newer ones). Parsing only the
# bare date form silently drops the newest rows -- it made Target sell-through
# look like it ended 2026-07-13 when it runs to 2026-07-23, understating July by
# $28,446. Always clean with these helpers, never cast directly.
def sf_cash(col: str) -> str:
    """SQL for a money column stored as text with $ and thousands separators."""
    return f"try_to_double(replace(replace(\"{col}\", '$', ''), ',', ''))"


def sf_qty(col: str) -> str:
    """SQL for a count column stored as text with thousands separators."""
    return f"try_to_double(replace(\"{col}\", ',', ''))"


def sf_day(col: str) -> str:
    """SQL for a DD-MM-YYYY date column that may carry a trailing time."""
    return f"try_to_date(split_part(\"{col}\", ' ', 1), 'DD-MM-YYYY')"




# ── ONE metric catalog — mirrors api/_shared/ad-metrics-catalog.js ────────────
# Keep in lock-step with the JS catalog: same keys, categories, formulas. base =
# read directly from the platform; derived = computed by the formula shown. Ratios
# guard the denominator and return None (never a fabricated 0) when inputs are
# missing, so "no data" never masquerades as a real figure.
CATEGORIES = [
    ("delivery", "Delivery & Reach", "How widely and how often the ad was served."),
    ("cost", "Cost & Efficiency", "What each unit of delivery/result costs."),
    ("click", "Click Engagement", "Clicks and click-through behaviour."),
    ("video", "Video Engagement", "Hook, hold and completion of video creative."),
    ("conversion", "Conversion & Value", "Purchases, revenue and return."),
    ("landing", "Landing Page", "What happens after the click, on the page."),
    ("experiment", "Experiment (A/B)", "Variant lift, confidence and significance."),
]


def _n(x):
    try:
        if x is None or x == "" or pd.isna(x):
            return None
        return float(x)
    except (TypeError, ValueError):
        return None


def _div(a, b):
    a, b = _n(a), _n(b)
    return None if (a is None or not b) else a / b


def _pct(a, b):
    r = _div(a, b)
    return None if r is None else r * 100


# Each metric: key, label, category, unit, tier, inputs, formula, def, compute(r).
METRICS = [
    # Delivery & Reach
    ("impressions", "Impressions", "delivery", "int", "base", ["impressions"], "impressions (as served)", "Times the ad was shown.", lambda r: _n(r.get("impressions"))),
    ("reach", "Reach", "delivery", "int", "base", ["reach"], "reach (unique people)", "Unique people who saw the ad.", lambda r: _n(r.get("reach"))),
    ("frequency", "Frequency", "delivery", "ratio", "derived", ["impressions", "reach"], "impressions / reach", "Average times each person saw the ad. Watch for fatigue above ~2-3.", lambda r: _div(r.get("impressions"), r.get("reach"))),
    # Cost & Efficiency
    ("spend", "Amount spent", "cost", "usd", "base", ["spend"], "spend", "Total amount spent.", lambda r: _n(r.get("spend"))),
    ("cpm", "CPM (cost / 1,000 impressions)", "cost", "usd", "derived", ["spend", "impressions"], "spend / impressions x 1000", "Cost to reach a thousand impressions.", lambda r: (lambda d: None if d is None else d * 1000)(_div(r.get("spend"), r.get("impressions")))),
    ("cpc", "CPC (cost / link click)", "cost", "usd", "derived", ["spend", "inline_link_clicks"], "spend / link clicks", "Cost per link click.", lambda r: _div(r.get("spend"), r.get("inline_link_clicks"))),
    ("cpp", "Cost per 1,000 reached (CPP)", "cost", "usd", "derived", ["spend", "reach"], "spend / reach x 1000", "Cost to reach a thousand unique people.", lambda r: (lambda d: None if d is None else d * 1000)(_div(r.get("spend"), r.get("reach")))),
    ("cost_per_reach", "Cost per reach", "cost", "usd4", "derived", ["spend", "reach"], "spend / reach", "Cost per unique person reached.", lambda r: _div(r.get("spend"), r.get("reach"))),
    ("cost_per_3s", "Cost per 3-sec video play", "cost", "usd", "derived", ["spend", "video_3s"], "spend / 3-sec plays", "Cost per 3-second (hook) view.", lambda r: _div(r.get("spend"), r.get("video_3s"))),
    ("cost_per_thruplay", "Cost per ThruPlay", "cost", "usd", "derived", ["spend", "thruplays"], "spend / thruplays", "Cost per ThruPlay (15s or complete).", lambda r: _div(r.get("spend"), r.get("thruplays"))),
    ("cost_per_purchase", "Cost per purchase (CPA)", "cost", "usd", "derived", ["spend", "purchases"], "spend / purchases", "Acquisition cost per purchase.", lambda r: _div(r.get("spend"), r.get("purchases"))),
    ("cost_per_lpv", "Cost per landing-page view", "cost", "usd", "derived", ["spend", "landing_page_views"], "spend / landing-page views", "Cost per fully-loaded landing-page view.", lambda r: _div(r.get("spend"), r.get("landing_page_views"))),
    # Click Engagement
    ("clicks", "Clicks (all)", "click", "int", "base", ["clicks"], "clicks", "All clicks (incl. non-link).", lambda r: _n(r.get("clicks"))),
    ("link_clicks", "Link clicks", "click", "int", "base", ["inline_link_clicks"], "inline_link_clicks", "Clicks on the ad link.", lambda r: _n(r.get("inline_link_clicks"))),
    ("ctr", "CTR (all clicks)", "click", "pct", "derived", ["clicks", "impressions"], "clicks / impressions x 100", "Click-through rate on all clicks.", lambda r: _pct(r.get("clicks"), r.get("impressions"))),
    ("link_ctr", "Link CTR", "click", "pct", "derived", ["inline_link_clicks", "impressions"], "link clicks / impressions x 100", "Click-through rate on link clicks (the honest CTR).", lambda r: _pct(r.get("inline_link_clicks"), r.get("impressions"))),
    ("outbound_ctr", "Outbound CTR", "click", "pct", "derived", ["outbound_clicks", "impressions"], "outbound clicks / impressions x 100", "Clicks that left the platform, per impression.", lambda r: _pct(r.get("outbound_clicks"), r.get("impressions"))),
    ("unique_ctr", "Unique link CTR", "click", "pct", "derived", ["inline_link_clicks", "reach"], "link clicks / reach x 100", "Link clicks per unique person reached.", lambda r: _pct(r.get("inline_link_clicks"), r.get("reach"))),
    # Video Engagement (hook -> hold -> through funnel)
    ("video_3s", "3-second video plays", "video", "int", "base", ["video_3s"], "3-sec plays", "Plays of at least 3 seconds (the hook).", lambda r: _n(r.get("video_3s"))),
    ("thruplays", "ThruPlays", "video", "int", "base", ["thruplays"], "thruplays", "Plays to completion or 15s.", lambda r: _n(r.get("thruplays"))),
    ("video_p25", "Video plays 25%", "video", "int", "base", ["video_p25"], "p25 watched", "Reached 25% of the video.", lambda r: _n(r.get("video_p25"))),
    ("video_p50", "Video plays 50%", "video", "int", "base", ["video_p50"], "p50 watched", "Reached 50%.", lambda r: _n(r.get("video_p50"))),
    ("video_p75", "Video plays 75%", "video", "int", "base", ["video_p75"], "p75 watched", "Reached 75%.", lambda r: _n(r.get("video_p75"))),
    ("video_p100", "Video plays 100%", "video", "int", "base", ["video_p100"], "p100 watched", "Watched to the end.", lambda r: _n(r.get("video_p100"))),
    ("hook_rate", "Hook Rate", "video", "pct", "derived", ["video_3s", "impressions"], "3-sec plays / impressions x 100", "Share of impressions that stopped to watch 3s. Creative-hook strength.", lambda r: _pct(r.get("video_3s"), r.get("impressions"))),
    ("hold_rate", "Hold Rate", "video", "pct", "derived", ["thruplays", "video_3s"], "thruplays / 3-sec plays x 100", "Of those hooked (3-sec), how many held to ThruPlay. Mid-video retention.", lambda r: _pct(r.get("thruplays"), r.get("video_3s"))),
    ("thruplay_rate", "ThruPlay Rate", "video", "pct", "derived", ["thruplays", "impressions"], "thruplays / impressions x 100", "Share of impressions that reached ThruPlay (15s/complete).", lambda r: _pct(r.get("thruplays"), r.get("impressions"))),
    ("through_rate", "Completion Rate", "video", "pct", "derived", ["video_p100", "impressions"], "100% plays / impressions x 100", "Share of impressions that watched to the end.", lambda r: _pct(r.get("video_p100"), r.get("impressions"))),
    ("completion_of_starts", "Completion of starts", "video", "pct", "derived", ["video_p100", "video_3s"], "100% plays / 3-sec plays x 100", "Of viewers who started, how many finished.", lambda r: _pct(r.get("video_p100"), r.get("video_3s"))),
    # Conversion & Value
    ("purchases", "Purchases", "conversion", "int", "base", ["purchases"], "purchases", "Attributed purchases.", lambda r: _n(r.get("purchases"))),
    ("purchase_value", "Purchase value", "conversion", "usd", "base", ["purchase_value"], "conversion value", "Attributed revenue.", lambda r: _n(r.get("purchase_value"))),
    ("roas", "ROAS", "conversion", "ratio", "derived", ["purchase_value", "spend"], "purchase value / spend", "Return on ad spend.", lambda r: _div(r.get("purchase_value"), r.get("spend"))),
    ("cvr", "Conversion rate (CVR)", "conversion", "pct", "derived", ["purchases", "inline_link_clicks"], "purchases / link clicks x 100", "Purchases per link click.", lambda r: _pct(r.get("purchases"), r.get("inline_link_clicks"))),
    ("aov", "AOV (attributed)", "conversion", "usd", "derived", ["purchase_value", "purchases"], "purchase value / purchases", "Average order value of attributed purchases.", lambda r: _div(r.get("purchase_value"), r.get("purchases"))),
    ("results", "Results", "conversion", "int", "base", ["results"], "results (per objective)", "Result events as configured by the campaign objective.", lambda r: _n(r.get("results"))),
    ("cost_per_result", "Cost per Result", "cost", "usd", "derived", ["spend", "results"], "spend / results", "Cost per objective result.", lambda r: _div(r.get("spend"), r.get("results"))),
    ("unique_outbound_clicks", "Unique outbound clicks", "click", "int", "base", ["unique_outbound_clicks"], "unique_outbound_clicks", "Unique people who clicked out.", lambda r: _n(r.get("unique_outbound_clicks"))),
    ("cost_per_unique_outbound_click", "Cost per unique outbound click", "cost", "usd", "derived", ["spend", "unique_outbound_clicks"], "spend / unique outbound clicks", "Cost per unique outbound clicker.", lambda r: _div(r.get("spend"), r.get("unique_outbound_clicks"))),
    ("add_to_cart", "Adds to Cart", "conversion", "int", "base", ["add_to_cart"], "add_to_cart", "Attributed add-to-cart events.", lambda r: _n(r.get("add_to_cart"))),
    ("cart_abandonment", "Cart Abandonment Rate", "conversion", "pct", "derived", ["purchases", "add_to_cart"], "(1 - purchases / adds to cart) x 100", "Share of carts that never purchased.", lambda r: (lambda p: None if p is None else 100 - p)(_pct(r.get("purchases"), r.get("add_to_cart")))),
    ("mer", "MER (Marketing Efficiency Ratio)", "conversion", "ratio", "derived", ["total_revenue", "spend"], "total revenue / total ad spend", "Blended, attribution-proof media efficiency. Needs realized revenue joined in.", lambda r: _div(r.get("total_revenue"), r.get("spend"))),
    ("ncac", "nCAC (New-Customer CAC)", "conversion", "usd", "derived", ["spend", "net_new_customers"], "spend / net new customers", "Acquisition cost counting NEW customers only. Needs a new-customer feed.", lambda r: _div(r.get("spend"), r.get("net_new_customers"))),
    ("ga4_sessions", "GA4 Sessions", "landing", "int", "base", ["ga4_sessions"], "ga4 sessions", "Sessions landed (GA4).", lambda r: _n(r.get("ga4_sessions"))),
    ("click_to_session_yield", "Click-to-Session Yield", "landing", "pct", "derived", ["ga4_sessions", "outbound_clicks"], "GA4 sessions / outbound clicks x 100", "Share of outbound clicks that became real sessions.", lambda r: _pct(r.get("ga4_sessions"), r.get("outbound_clicks"))),
    # Landing Page
    ("landing_page_views", "Landing-page views", "landing", "int", "base", ["landing_page_views"], "landing_page_view actions", "Fully-loaded landing-page views after the click.", lambda r: _n(r.get("landing_page_views"))),
    ("lpv_rate", "LP-view rate (load quality)", "landing", "pct", "derived", ["landing_page_views", "inline_link_clicks"], "landing-page views / link clicks x 100", "Share of clicks that actually loaded the page. Low = slow page / drop-off.", lambda r: _pct(r.get("landing_page_views"), r.get("inline_link_clicks"))),
    ("click_to_lpv_dropoff", "Click->LPV drop-off", "landing", "pct", "derived", ["landing_page_views", "inline_link_clicks"], "100 - LP-view rate", "Clicks lost before the page loaded.", lambda r: (lambda p: None if p is None else 100 - p)(_pct(r.get("landing_page_views"), r.get("inline_link_clicks")))),
    ("lp_bounce_rate", "LP bounce rate", "landing", "pct", "derived", ["bounces", "sessions"], "bounces / sessions x 100  (PageDeck)", "Single-page sessions on the landing page.", lambda r: _pct(r.get("bounces"), r.get("sessions"))),
    ("lp_conversion_rate", "LP conversion rate", "landing", "pct", "derived", ["lp_conversions", "sessions"], "LP conversions / sessions x 100  (PageDeck)", "Conversions per landing-page session.", lambda r: _pct(r.get("lp_conversions"), r.get("sessions"))),
    ("avg_time_on_page", "Avg time on page", "landing", "sec", "base", ["time_on_page"], "avg session duration (PageDeck)", "Average time on the landing page.", lambda r: _n(r.get("time_on_page"))),
    # Experiment (A/B — PageDeck)
    ("variant_lift", "Variant lift", "experiment", "pct", "derived", ["variant_rate", "control_rate"], "(variant - control) / control x 100", "Relative lift of the variant over control.", lambda r: (lambda v, c: None if (v is None or not c) else (v - c) / c * 100)(_n(r.get("variant_rate")), _n(r.get("control_rate")))),
    ("confidence", "Confidence", "experiment", "pct", "base", ["confidence"], "statistical confidence (PageDeck)", "Probability the lift is real (>=95% to call).", lambda r: _n(r.get("confidence"))),
]
CAT_LABEL = {k: lbl for k, lbl, _ in CATEGORIES}
# derived key -> platform-reported field to cross-check for the accuracy drift test
SOURCED_EQUIVALENT = {"ctr": "ctr", "cpc": "cpc", "cpm": "cpm", "frequency": "frequency", "link_ctr": "inline_link_click_ctr"}


def compute_all(r):
    out = {}
    for key, _lbl, _cat, _u, _t, _inp, _f, _d, fn in METRICS:
        try:
            out[key] = fn(r or {})
        except Exception:  # noqa: BLE001
            out[key] = None
    return out


def catalog_df():
    rows = []
    for key, lbl, cat, unit, tier, inp, formula, dfn, _fn in METRICS:
        rows.append({
            "Category": CAT_LABEL[cat], "Metric": lbl, "Key": key, "Tier": tier,
            "Unit": unit, "Formula": formula, "Inputs": ", ".join(inp), "Definition": dfn,
        })
    return pd.DataFrame(rows)


def accuracy(records):
    """Mirror of ad-metrics-catalog.js accuracy(): per-metric coverage +
    agreement vs the platform-reported value, and an overall confidence label."""
    rows = list(records or [])
    per = []
    for key, lbl, cat, _u, _t, inp, _f, _d, fn in METRICS:
        covered, agree_sum, agree_n = 0, 0.0, 0
        for r in rows:
            if all(_n(r.get(f)) is not None for f in inp):
                covered += 1
            src = SOURCED_EQUIVALENT.get(key)
            if src and _n(r.get(src)) is not None:
                derived, sourced = fn(r), _n(r.get(src))
                if derived is not None and sourced:
                    agree_n += 1
                    agree_sum += max(0.0, 1 - abs(derived - sourced) / abs(sourced))
        coverage = covered / len(rows) if rows else 0
        agreement = (agree_sum / agree_n) if agree_n else None
        if coverage >= 0.9 and (agreement is None or agreement >= 0.98):
            conf = "high"
        elif coverage >= 0.6:
            conf = "medium"
        elif coverage > 0:
            conf = "low"
        else:
            conf = "unavailable"
        per.append({
            "Category": CAT_LABEL[cat], "Metric": lbl, "Coverage %": round(coverage * 1000) / 10,
            "Cross-checked": "yes" if agree_n else "no",
            "Agreement %": None if agreement is None else round(agreement * 1000) / 10,
            "Confidence": conf,
        })
    return pd.DataFrame(per)


# ── Query helpers ─────────────────────────────────────────────────────────────
# show_spinner is a visible label ON PURPOSE: warehouse scans can take a while,
# and a silent spinner makes a tab look like it is not loading at all.
@st.cache_data(ttl=600, show_spinner="Querying Snowflake…")
def q(sql: str) -> pd.DataFrame:
    """Run a read-only query and return a DataFrame (lower-cased columns)."""
    df = session.sql(sql).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    return df


def acct_clause(col: str, account) -> str:
    """Filter by the REAL platform ad-account name(s) (exact, case-insensitive).
    Accepts one value or a multi-select list. Target/Costco are NOT accounts —
    they live in the ad names (see Marketplace)."""
    vals = [account] if isinstance(account, str) else list(account or [])
    vals = [v for v in vals if v]
    if not vals or not col:
        return ""
    inlist = ",".join("'" + str(v).lower().replace("'", "''") + "'" for v in vals)
    return f" and lower({col}) in ({inlist})"


# Marketplace (Target / Costco / Amazon / Walmart / …) is carried in the AD
# NAMES, not the account field — derive/filter it from ad_name so it acts as
# its own dimension. Candidate marketplaces are checked LIVE against the ad
# names; only ones that actually appear become options (plus D2C / Other).
MARKETPLACE_SEARCH = {"Target": "target", "Costco": "costco", "Amazon": "amazon",
                      "Walmart": "walmart", "Sams Club": "sams", "Kroger": "kroger",
                      "Instacart": "instacart", "eBay": "ebay", "Etsy": "etsy",
                      "Walgreens": "walgreens", "CVS": "cvs",
                      "UGC Creator Ads": "ugc"}


@st.cache_data(ttl=300, show_spinner=False)
def detected_marketplaces():
    """Which marketplace names REALLY appear in the ad names — checked live,
    so the filter never offers a marketplace with zero data."""
    sel = ", ".join(
        f"max(case when ad_name ilike '%{tok}%' then 1 else 0 end) as m{i}"
        for i, tok in enumerate(MARKETPLACE_SEARCH.values()))
    try:
        r = q(f"select {sel} from {META_SRC}")
        return [name for i, name in enumerate(MARKETPLACE_SEARCH)
                if int(r.iloc[0][f"m{i}"] or 0) == 1]
    except Exception:  # noqa: BLE001
        return ["Target", "Costco"]


def mkt_clause(marketplace, col: str = "ad_name") -> str:
    """Marketplace filter — one value or a multi-select list; D2C / Other means
    'none of the detected marketplace tokens appear in the ad name'."""
    vals = [marketplace] if isinstance(marketplace, str) else list(marketplace or [])
    vals = [v for v in vals if v]
    if not vals:
        return ""
    parts = []
    for v in vals:
        if v == "D2C / Other":
            toks = [MARKETPLACE_SEARCH[t] for t in detected_marketplaces()]
            if toks:
                parts.append("not (" + " or ".join(f"{col} ilike '%{t}%'" for t in toks) + ")")
        else:
            tok = MARKETPLACE_SEARCH.get(v, str(v).lower()).replace("'", "''")
            parts.append(f"{col} ilike '%{tok}%'")
    return f" and ({' or '.join(parts)})" if parts else ""


def mkt_case(col: str = "ad_name") -> str:
    """SQL CASE deriving the marketplace from the ad name (detected set + D2C)."""
    whens = " ".join(f"when {col} ilike '%{MARKETPLACE_SEARCH[t]}%' then '{t}'"
                     for t in detected_marketplaces())
    return f"(case {whens} else 'D2C / Other' end)" if whens else "'D2C / Other'"


@st.cache_data(ttl=300, show_spinner=False)
def meta_accounts():
    """Real Meta ad-account names present in the warehouse (Account options)."""
    try:
        df = q(f"select distinct account_name from {META_SRC} "
               f"where account_name is not null order by 1")
        return [str(x) for x in df.iloc[:, 0].dropna().tolist()]
    except Exception:  # noqa: BLE001 — no grant/rows: empty list, never invented
        return []


@st.cache_data(ttl=3600, show_spinner=False)
def has_column(table: str, col: str) -> bool:
    """True when the table really has the column (guards optional filters).
    For the Meta union relation, true when ANY member table has it."""
    if table.startswith("("):
        return any(col.lower() in cols for _, cols in meta_source_tables())
    try:
        db, schema, name = table.split(".", 2)
        r = q(f"select column_name from {db}.information_schema.columns "
              f"where table_schema = '{schema}' and table_name = '{name}'")
        return col.lower() in [str(c).lower() for c in r.iloc[:, 0].tolist()]
    except Exception:  # noqa: BLE001
        return False


# ── META SOURCE UNION — base insights table + every META*USA*TEA account
# table found by regex in the warehouse. Discovered LIVE and validated to be
# insights-shaped (campaign_name, spend, date_start); a table that does not
# really exist is never referenced, and columns one member lacks are selected
# as NULL so the union is always well-formed.
# Columns that mark a table as a BREAKDOWN of the base insights (the same
# spend split by a dimension). Unioning one into the base would COUNT THE SAME
# SPEND TWICE, so any table carrying these is excluded from the source union
# (they still power Cohort Exploration separately).
BREAKDOWN_MARKERS = {"age", "gender", "country", "region", "state", "dma", "city",
                     "impression_device", "device_platform", "publisher_platform",
                     "platform_position", "placement"}


@st.cache_data(ttl=3600, show_spinner=False)
def meta_source_report():
    """Discover the Meta insights source tables with a NO-DOUBLE-COUNTING
    guarantee. Candidates: every table named META_USA_ADS* in the MAPLEMONK and
    MAPLEMONK1 schemas, plus any META*TEA* table anywhere in VAHDAM_DB/DATON.
    A candidate is EXCLUDED (with the reason recorded) when it is:
      - not insights-shaped (missing campaign_name / spend / date_start),
      - a breakdown table (age/gender/device/geo columns - same spend, split),
      - an exact duplicate feed (identical row count + total spend + date range
        as an already-included table, checked against the LIVE data)."""
    def _cols(db, schema, name):
        try:
            c = q(f"select column_name from {db}.information_schema.columns "
                  f"where table_schema = '{schema}' and table_name = '{name}' "
                  "order by ordinal_position")
            return tuple(str(x).lower() for x in c.iloc[:, 0].tolist())
        except Exception:  # noqa: BLE001
            return ()

    def _sig(fqn):
        """Live data signature: exact duplicates of a feed share all four."""
        try:
            r = q(f'select count(*) as n, round(coalesce(sum("SPEND"), 0), 2) as s, '
                  f'min("DATE_START") as d0, max("DATE_START") as d1 from {fqn}')
            row = r.iloc[0]
            return (int(row["n"]), float(row["s"]), str(row["d0"]), str(row["d1"]))
        except Exception:  # noqa: BLE001
            return None

    # 1) Collect candidates (base table first so it always wins ties).
    cands = []
    try:
        t = q("select table_schema, table_name from VAHDAM_DB.information_schema.tables "
              "where table_type = 'BASE TABLE' and ("
              "  (table_schema in ('MAPLEMONK', 'MAPLEMONK1') and table_name ilike 'META_USA_ADS%')"
              # The Target/Costco retail account is USA_TEA_ADS_ADS_INSIGHTS — it
              # carries no META in its name, so the META.*TEA regex below never
              # matched it and the account was invisible. Match TEA_ADS directly.
              "  or (table_schema in ('MAPLEMONK', 'MAPLEMONK1') and table_name ilike '%TEA_ADS_ADS_INSIGHTS')"
              "  or regexp_like(table_name, '.*META.*TEA.*|.*TEA.*META.*', 'i'))")
        cands += [("VAHDAM_DB", str(r["table_schema"]), str(r["table_name"]))
                  for _, r in t.iterrows()]
    except Exception:  # noqa: BLE001
        pass
    try:
        t = q("select table_schema, table_name from DATON.information_schema.tables "
              "where table_type = 'BASE TABLE' "
              "and regexp_like(table_name, '.*META.*TEA.*|.*TEA.*META.*', 'i')")
        cands += [("DATON", str(r["table_schema"]), str(r["table_name"]))
                  for _, r in t.iterrows()]
    except Exception:  # noqa: BLE001
        pass
    base_db, base_schema, base_name = META_ADS.split(".", 2)
    cands = [(base_db, base_schema, base_name)] + \
            sorted({c for c in cands if f"{c[0]}.{c[1]}.{c[2]}".upper() != META_ADS.upper()})

    def _accounts(fqn, cset, label):
        """The distinct Account values this source contributes (nulls and a
        missing column both fall back to the source-table label)."""
        try:
            if "account_name" in cset:
                d = q(f'select distinct coalesce("ACCOUNT_NAME", \'{label}\') as v '
                      f"from {fqn} limit 20")
                vals = sorted(str(x) for x in d["v"].dropna().tolist())
                return vals or [label]
            return [label]
        except Exception:  # noqa: BLE001
            return []

    def _same_feed(fa, ca, fb, cb):
        """True when two tables are the SAME feed: per (campaign, day), spend
        matches across their overlapping dates (>=10 shared rows, >=95% equal).
        Catches longer-history copies that exact signatures miss."""
        key = "CAMPAIGN_ID" if ("campaign_id" in ca and "campaign_id" in cb) else "CAMPAIGN_NAME"
        try:
            r = q(f'with a as (select "{key}" as cid, "DATE_START" as d, '
                  f'round(sum("SPEND"), 2) as s from {fa} group by 1, 2), '
                  f'b as (select "{key}" as cid, "DATE_START" as d, '
                  f'round(sum("SPEND"), 2) as s from {fb} group by 1, 2), '
                  "j as (select a.s as sa, b.s as sb from a join b on a.cid = b.cid and a.d = b.d) "
                  "select count(*) as n, sum(iff(sa = sb, 1, 0)) as m from j")
            n = int(r.iloc[0]["n"] or 0)
            m = int(r.iloc[0]["m"] or 0)
            return n >= 10 and m >= 0.95 * n
        except Exception:  # noqa: BLE001
            return False

    def _span_days(sig):
        try:
            return (pd.Timestamp(sig[3]) - pd.Timestamp(sig[2])).days
        except Exception:  # noqa: BLE001
            return -1

    # 2) Gate each candidate; record every exclusion with its reason.
    detail, excluded, seen_sigs = [], [], {}
    for db, schema, name in cands:
        fqn = f"{db}.{schema}.{name}"
        cols = _cols(db, schema, name)
        if not cols:
            excluded.append((fqn, "columns unreadable for this role"))
            continue
        cset = set(cols)
        if not {"campaign_name", "spend", "date_start"} <= cset:
            excluded.append((fqn, "not insights-shaped (needs campaign_name, spend, date_start)"))
            continue
        marks = sorted(cset & BREAKDOWN_MARKERS)
        if marks:
            excluded.append((fqn, "breakdown table (" + ", ".join(marks)
                             + ") - same spend split by dimension; unioning would double-count"))
            continue
        sig = _sig(fqn)
        if sig is not None and sig in seen_sigs:
            excluded.append((fqn, f"exact duplicate of {seen_sigs[sig]} "
                                  f"(rows={sig[0]:,}, spend={sig[1]:,.2f}, {sig[2]}..{sig[3]})"))
            continue
        # Same-feed check vs everything already included: a longer-history COPY
        # of an included feed is NOT new data — keep whichever covers more days.
        dup_of = next((e for e in detail
                       if _same_feed(fqn, cset, e["fqn"], set(e["cols"]))), None)
        if dup_of is not None:
            if sig is not None and _span_days(sig) > _span_days(dup_of["sig"]):
                excluded.append((dup_of["fqn"],
                                 f"same feed as {fqn} (spend matches per campaign+day over the "
                                 "overlap) - kept the longer-history table instead"))
                detail.remove(dup_of)
            else:
                excluded.append((fqn, f"same feed as {dup_of['fqn']} (spend matches per "
                                      "campaign+day over the overlap) - excluded to avoid double counting"))
                continue
        if sig is not None:
            seen_sigs[sig] = fqn
        label = name.lower()
        detail.append({"fqn": fqn, "cols": cols, "sig": sig,
                       "accounts": _accounts(fqn, cset, label)})
    if not detail:  # never let discovery failures blank the app
        detail = [{"fqn": META_ADS, "cols": _cols(base_db, base_schema, base_name),
                   "sig": None, "accounts": []}]
    return {"included": [(e["fqn"], e["cols"]) for e in detail],
            "excluded": excluded, "detail": detail}


def meta_source_tables():
    return meta_source_report()["included"]


def _meta_src():
    srcs = meta_source_tables()
    if not srcs or not srcs[0][1]:
        return META_ADS
    if len(srcs) == 1:
        return srcs[0][0]
    all_cols = []
    for _, cols in srcs:
        for c in cols:
            if c not in all_cols:
                all_cols.append(c)
    selects = []
    for fqn, cols in srcs:
        have = set(cols)
        label = fqn.split(".")[-1].lower().replace("'", "''")
        parts = []
        for c in all_cols:
            if c == "account_name":
                # Every member MUST yield a selectable Account: a missing
                # account_name column OR null values in it get the SOURCE
                # TABLE name as the label (honest provenance, not an
                # invented Meta account name) — otherwise that account's
                # rows are invisible in the Account filter.
                if c in have:
                    parts.append(f'coalesce("ACCOUNT_NAME", \'{label}\') as "ACCOUNT_NAME"')
                else:
                    parts.append(f"'{label}' as \"ACCOUNT_NAME\"")
            elif c in have:
                parts.append(f'"{c.upper()}"')
            else:
                parts.append(f'null as "{c.upper()}"')
        selects.append(f"select {', '.join(parts)} from {fqn}")
    return "(" + " union all ".join(selects) + ")"


META_SRC = _meta_src()


def date_clause(col: str, since, until) -> str:
    if not since or not until:
        return ""
    return f" and {col} between '{since}' and '{until}'"


def money(v):
    """Adaptive precision: totals as whole dollars, unit costs with cents, and
    sub-dollar unit costs (CPC, cost/reach) with 4 decimals - $0.0442 must
    never render as the false '$0'."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "—"
    a = abs(v)
    if a >= 100:
        return f"${v:,.0f}"
    if a >= 1:
        return f"${v:,.2f}"
    if a == 0:
        return "$0"
    return f"${v:,.4f}"


def pctf(v):
    return "—" if v is None or (isinstance(v, float) and pd.isna(v)) else f"{v:.2f}%"


# Meta base-table columns verified: spend, impressions, reach, frequency, clicks,
# inline_link_clicks, inline_link_click_ctr, cpc, cpm, ctr, account_name,
# campaign_name, ad_name, adset_name, date_start. Video quartiles live in separate
# child tables (not flattened yet) so hook/hold/through show 'unavailable' until wired.
def meta_rows(account, level, since, until):
    name_col = LEVEL_COL.get(level, "campaign_name")
    where = ("where 1=1" + acct_clause("account_name", account)
             + mkt_clause(marketplace) + date_clause("date_start", since, until))
    sql = f"""
        select {name_col} as name,
               sum(spend) as spend, sum(impressions) as impressions, sum(reach) as reach,
               sum(clicks) as clicks, sum(inline_link_clicks) as inline_link_clicks,
               avg(frequency) as frequency, avg(ctr) as ctr, avg(cpc) as cpc, avg(cpm) as cpm,
               avg(inline_link_click_ctr) as inline_link_click_ctr
        from {META_SRC} {where}
        group by {name_col} order by spend desc nulls last limit 500
    """
    df = q(sql)
    if df.empty:
        return df
    # Derived metrics from the ONE catalog, so numbers match the web exactly.
    for key in ("cpm", "cpc", "cost_per_reach", "link_ctr"):
        fn = next(m[8] for m in METRICS if m[0] == key)
        df[key] = df.apply(lambda row, f=fn: f(row.to_dict()), axis=1)
    return df


def generic_rows(table):
    """Google / TikTok: recent rows with whatever columns exist. Daton/Maplemonk
    schemas vary, so pull recent rows rather than assume a date/account column.
    Default sort: newest first (descending) when a date column exists."""
    try:
        dc = table_date_col(table)
        ob = f' order by "{dc.upper()}" desc' if dc else ""
        return q(f"select * from {table}{ob} limit 500")
    except Exception as e:  # noqa: BLE001
        st.info(f"Could not read {table}: {e}")
        return pd.DataFrame()


# ── Sidebar: section + shared filters ────────────────────────────────────────
st.sidebar.title("VAHDAM · Lifecycle OS on Snowflake")
section = st.sidebar.radio(
    "Section",
    ["Ads Analysis", "Ads Intelligence"],
)

# The LHS menu carries the ANALYSIS VIEWS (use cases); the data filters live in
# the top bar of the page, never in this menu.
ADS_VIEWS = ["Ad accounts & retail funnel",
             "Omnichannel Master View", "Comparison Engine", "Cohort Exploration",
             "Overview & priority metrics", "Single entity deep-dive",
             "Ad explorer (all fields)", "Spend tracker", "UGC creator ads",
             "UGC command center"]
if section == "Ads Analysis":
    view = st.sidebar.radio("Analysis view", ADS_VIEWS)
else:
    view = None
st.sidebar.markdown("---")
# ── Channel → Account → Marketplace model ────────────────────────────────────
# Channels are the ad platforms (Meta Ads / Google Ads / TikTok Ads). Accounts
# are the CHANNEL'S OWN real ad accounts, read live from that channel's table.
# Marketplace (Target / Costco / Amazon / Walmart / … / D2C) lives in the ad
# names and is a separate dimension — never an account.
ACCOUNT_COL_CANDIDATES = ("account_name", "customer_descriptive_name", "customer_name",
                          "advertiser_name", "account", "advertiser_id", "account_id",
                          "customer_id")


@st.cache_data(ttl=300, show_spinner=False)
def channel_accounts(channel):
    """(account_column, [real account values]) from the channel's own table."""
    table = META_SRC if channel == "Meta" else (GOOGLE_ADS if channel == "Google" else TIKTOK["campaign"])
    col = next((c for c in ACCOUNT_COL_CANDIDATES if has_column(table, c)), None)
    if not col:
        return None, []
    try:
        df = q(f'select distinct "{col.upper()}" as v from {table} '
               f'where "{col.upper()}" is not null order by 1 limit 200')
        return col, [str(x) for x in df["v"].dropna().tolist()]
    except Exception:  # noqa: BLE001
        return col, []


# ── TOP FILTER BAR ── the dashboard filters ALWAYS sit at the top of the page
# (the LHS menu only carries the section + analysis views).
LEVEL_COL = {"campaign": "campaign_name", "adset": "adset_name", "ad": "ad_name"}
LEVEL_LABEL = {"campaign": "Campaign", "adset": "Ad Set", "ad": "Ad"}


@st.cache_data(ttl=300, show_spinner=False)
def distinct_values(col):
    """Distinct values of an optional filter column (objective / status)."""
    try:
        d = q(f'select distinct "{col.upper()}" as v from {META_SRC} '
              f'where "{col.upper()}" is not null order by 1 limit 100')
        return [str(x) for x in d["v"].dropna().tolist()]
    except Exception:  # noqa: BLE001
        return []


# Every multi-value filter carries an explicit "All" option (the default) and
# stays a MULTISELECT, so several specific options are selectable together.
# Picking "All" (or clearing the box) means no filter on that dimension.
ALL_OPT = "All"


def _resolve_all(selection):
    vals = [v for v in (selection or []) if v != ALL_OPT]
    return [] if (not selection or ALL_OPT in selection) else vals


_f1, _f2, _f3, _f4 = st.columns([1.0, 1.6, 1.5, 0.9])
platform_label = _f1.selectbox("Channel", ["Meta Ads", "Google Ads", "TikTok Ads"])
platform = platform_label.replace(" Ads", "")
acct_col, _acct_opts = channel_accounts(platform)
# Cascade: options come from THIS channel's own table, so picking Meta Ads only
# ever offers Meta ad accounts. Labels stay SHORT so they never collide with
# neighbouring columns; detail lives in help.
account = _resolve_all(_f2.multiselect(
    "Account", [ALL_OPT] + _acct_opts, default=[ALL_OPT],
    help=f"Real {platform_label} ad accounts read live from the warehouse. "
         "All = every account; deselect All to pick one or several together."))
marketplace = _resolve_all(_f3.multiselect(
    "Marketplace", [ALL_OPT] + detected_marketplaces() + ["D2C / Other"], default=[ALL_OPT],
    help="Derived from the ad names (Target, Costco, Amazon, UGC Creator Ads, …). "
         "All = every marketplace; deselect All to pick one or several together."))
if section == "Ads Analysis":
    _level_label = _f4.selectbox("Level", ["Campaign", "Ad Set", "Ad Level"])
    level = {"Campaign": "campaign", "Ad Set": "adset", "Ad Level": "ad"}[_level_label]
else:
    level = "campaign"

OBJ_COL = next((c for c in ("objective", "campaign_objective")
                if platform == "Meta" and has_column(META_SRC, c)), None)
STATUS_COL = next((c for c in ("ad_delivery", "effective_status", "configured_status",
                               "delivery_status", "status")
                   if platform == "Meta" and has_column(META_SRC, c)), None)
_g1, _g2, _g3, _g4, _g5, _g6 = st.columns([1.3, 1.3, 1.1, 1.0, 1.0, 0.8])
objective_sel = _resolve_all(_g1.multiselect(
    "Objective", [ALL_OPT] + distinct_values(OBJ_COL), default=[ALL_OPT])) if OBJ_COL else []
status_sel = _resolve_all(_g2.multiselect(
    "Status", [ALL_OPT] + distinct_values(STATUS_COL), default=[ALL_OPT],
    help="Campaign delivery status. All = any status.")) if STATUS_COL else []

today = pd.Timestamp.utcnow().normalize()
_preset = _g3.selectbox("Date range",
                        ["Last 30 days", "Last 7 days", "MTD", "Last quarter", "Custom"])
if _preset == "Last 7 days":
    since, until = (today - pd.Timedelta(days=7)).date(), today.date()
elif _preset == "MTD":
    since, until = today.replace(day=1).date(), today.date()
elif _preset == "Last quarter":
    _qs = pd.Timestamp(today.year, 3 * ((today.month - 1) // 3) + 1, 1)
    _pq_end = _qs - pd.Timedelta(days=1)
    _pq_start = pd.Timestamp(_pq_end.year, 3 * ((_pq_end.month - 1) // 3) + 1, 1)
    since, until = _pq_start.date(), _pq_end.date()
elif _preset == "Custom":
    since = _g4.date_input("Since", (today - pd.Timedelta(days=30)).date())
    until = _g5.date_input("Until", today.date())
else:
    since, until = (today - pd.Timedelta(days=30)).date(), today.date()
window_days = max(1, (pd.Timestamp(until) - pd.Timestamp(since)).days + 1)
_g6.markdown("")
# Every view queries the warehouse LIVE at render time — new campaigns/ads
# appear automatically. Option lists cache for 5 minutes; this clears them now.
if _g6.button("🔄 Refresh"):
    st.cache_data.clear()
    st.rerun()
st.markdown("---")
st.sidebar.markdown("---")
st.sidebar.caption(
    "All figures are queried live from Snowflake on every view. New campaigns, "
    "ads, accounts and marketplaces appear automatically (option lists refresh "
    "within 5 minutes, or instantly with the button). Freshness of the source "
    "tables themselves follows the Daton/Maplemonk sync schedule."
)
st.sidebar.caption(
    f"Daily budget caps (reference): Target ${BUDGETS['target']:,} · "
    f"Costco ${BUDGETS['costco']:,}. Read-only — never written back to any platform."
)
st.sidebar.caption(f"Build {APP_BUILD}")
try:
    _mrep = meta_source_report()
    st.sidebar.caption("Meta sources (" + str(len(_mrep["included"])) + "): "
                       + " · ".join(t.split(".")[-1] for t, _ in _mrep["included"]))
    with st.sidebar.expander("Meta source detail (live diagnostics)"):
        for _e in _mrep.get("detail", []):
            _s = _e.get("sig")
            _stats = (f"{_s[0]:,} rows · ${_s[1]:,.0f} · {_s[2]} → {_s[3]}"
                      if _s else "stats unavailable")
            st.caption(f"`{_e['fqn'].split('.', 1)[1]}` — {_stats}")
            st.caption("↳ accounts: " + (", ".join(_e.get("accounts") or []) or "(none readable)"))
    if _mrep["excluded"]:
        with st.sidebar.expander(f"Excluded Meta tables ({len(_mrep['excluded'])}) — no double counting"):
            for _xf, _xr in _mrep["excluded"]:
                st.caption(f"`{_xf.split('.', 1)[1]}` — {_xr}")
except Exception:  # noqa: BLE001 — informational only
    pass


# ═════════════════════════════════════════════════════════════════════════════
# AD-LEVEL DEPTH HELPERS — expose EVERYTHING the warehouse carries.
# The UI derives every field list from the table's REAL schema
# (INFORMATION_SCHEMA), so no available column is hidden and no absent one is
# invented. Ratio columns are never summed; derived metrics are recomputed from
# the ONE catalog on aggregated sums.
# ═════════════════════════════════════════════════════════════════════════════
META_CREATIVES = "VAHDAM_DB.MAPLEMONK1.META_USA_AD_CREATIVES"
CATALOG_FN = {m[0]: m[8] for m in METRICS}
RATIO_COLS = {"ctr", "cpc", "cpm", "cpp", "frequency", "inline_link_click_ctr",
              "cost_per_reach", "cost_per_unique_click", "cost_per_thruplay"}


@st.cache_data(ttl=3600, show_spinner=False)
def table_columns(table: str):
    """All (column, type) pairs the table really has, in ordinal order. For
    the Meta union relation: the merged columns of every member table."""
    if table.startswith("("):
        seen, out = set(), []
        for fqn, _ in meta_source_tables():
            for c, t in table_columns(fqn):
                if c not in seen:
                    seen.add(c)
                    out.append((c, t))
        return out
    try:
        db, schema, name = table.split(".", 2)
        df = q(f"select column_name, data_type from {db}.information_schema.columns "
               f"where table_schema = '{schema}' and table_name = '{name}' "
               f"order by ordinal_position")
        return list(zip(df["column_name"].str.lower(), df["data_type"].astype(str)))
    except Exception:  # noqa: BLE001
        return []


AUDIENCE_HINTS = ("age", "gender", "audience", "geo", "country", "region", "city",
                  "language", "device", "platform", "placement", "publisher", "targeting")
CONFIG_HINTS = ("name", "id", "status", "objective", "buying", "optimization", "bid",
                "budget", "type", "currency", "created", "updated", "account", "level")


def classify_columns(cols):
    """Group the table's real columns by analysis role: identity/config,
    audience/targeting, time, metrics."""
    groups = {"identity_config": [], "audience_targeting": [], "time": [], "metrics": [], "other": []}
    for c, t in cols:
        lc, ut = c.lower(), str(t).upper()
        if ut.startswith(("DATE", "TIMESTAMP")) or lc in ("date_start", "date_stop"):
            groups["time"].append(c)
        elif any(h in lc for h in AUDIENCE_HINTS):
            groups["audience_targeting"].append(c)
        elif ut.startswith(("NUMBER", "FLOAT", "DECIMAL", "INT")):
            groups["metrics"].append(c)
        elif any(h in lc for h in CONFIG_HINTS) or ut in ("TEXT", "BOOLEAN", "VARIANT"):
            groups["identity_config"].append(c)
        else:
            groups["other"].append(c)
    return groups


@st.cache_data(ttl=600, show_spinner=False)
def meta_raw(account, marketplace, since, until, campaigns=None, limit=20000, offset=0):
    """Raw ad-level daily rows with EVERY column (select *), scoped by the
    sidebar filters and optionally to specific campaigns. Paged via
    limit/offset so EVERY row is reachable — no hidden cap."""
    where = ("where 1=1" + acct_clause("account_name", account)
             + mkt_clause(marketplace) + date_clause("date_start", since, until))
    if campaigns:
        inlist = ",".join("'" + str(c).replace("'", "''") + "'" for c in campaigns)
        where += f" and campaign_name in ({inlist})"
    return q(f"select * from {META_SRC} {where} order by date_start desc "
             f"limit {int(limit)} offset {int(offset)}")


@st.cache_data(ttl=600, show_spinner=False)
def campaign_options(account, marketplace, since, until, col="campaign_name"):
    where = ("where 1=1" + acct_clause("account_name", account)
             + mkt_clause(marketplace) + date_clause("date_start", since, until))
    try:
        df = q(f"select {col}, sum(spend) as spend from {META_SRC} {where} "
               f"group by 1 order by spend desc nulls last limit 500")
        return [str(x) for x in df[col].dropna().tolist()]
    except Exception:  # noqa: BLE001
        return []


def aggregate_all(df):
    """Sum every ADDITIVE numeric column (ratio columns are excluded — summing
    a CTR is meaningless), then recompute the full derived catalog on the sums.
    Note: summed daily reach can overcount uniques across days — labelled in UI."""
    sums = {}
    for c in df.columns:
        if c in RATIO_COLS:
            continue
        if pd.api.types.is_numeric_dtype(df[c]):
            sums[c] = float(df[c].sum())
    return sums, compute_all(sums)


def metric_sheet(sums, derived):
    """One table with EVERY metric: catalog-derived values first (labelled,
    with formula), then any remaining raw table sums not covered by the catalog."""
    label = {m[0]: m[1] for m in METRICS}
    formula = {m[0]: m[6] for m in METRICS}
    rows, seen = [], set()
    for k, v in derived.items():
        if v is None:
            continue
        rows.append({"Metric": label.get(k, k), "Key": k, "Value": round(v, 4),
                     "Formula": formula.get(k, ""), "Source": "catalog"})
        seen.add(k)
    for k, v in sorted(sums.items()):
        if k in seen:
            continue
        rows.append({"Metric": k, "Key": k, "Value": round(v, 4),
                     "Formula": "sum over rows", "Source": "table"})
    return pd.DataFrame(rows)


# ── NO-LIMIT PAGINATION + SQL-EXACT AGGREGATION ──────────────────────────────
# No hidden caps anywhere: aggregates are computed in SQL over ALL rows in
# scope, and raw rows are served page by page so every row is reachable.
def pager(total_rows, key, default_size=500):
    sizes = [100, 500, 1000, 5000, 10000]
    c1, c2, c3 = st.columns([1, 1, 2])
    size = c1.selectbox("Rows / page", sizes, index=sizes.index(default_size), key=key + "_ps")
    pages = max(1, math.ceil(max(0, int(total_rows)) / size))
    page = c2.number_input("Page", min_value=1, max_value=pages, value=1, step=1, key=key + "_pg")
    c3.caption(f"{int(total_rows):,} rows · {pages:,} page(s) — every row reachable, nothing silently dropped")
    return int(size), (int(page) - 1) * int(size)


@st.cache_data(ttl=600, show_spinner=False)
def count_rows(table, where=""):
    try:
        return int(q(f"select count(*) as n from {table} {where}").iloc[0]["n"])
    except Exception:  # noqa: BLE001
        return 0


def _inlist_clause(col, vals):
    vv = [v for v in (vals or []) if v]
    if not col or not vv:
        return ""
    inlist = ",".join("'" + str(v).replace("'", "''") + "'" for v in vv)
    return f' and "{col.upper()}" in ({inlist})'


def ident_cols(level):
    """Identifier columns that must ALWAYS lead a row table so every row is
    attributable: campaign name+id at every grain, plus adset/ad name+id at
    those grains (only columns the table really has)."""
    cols = [c for c in ("campaign_name", "campaign_id") if has_column(META_SRC, c)]
    if level in ("adset", "ad"):
        cols += [c for c in ("adset_name", "adset_id") if has_column(META_SRC, c)]
    if level == "ad":
        cols += [c for c in ("ad_name", "ad_id") if has_column(META_SRC, c)]
    return cols or [LEVEL_COL.get(level, "campaign_name")]


def count_distinct(table, where, cols):
    sel = ", ".join(f'"{c.upper()}"' for c in cols)
    try:
        return int(q(f"select count(*) as n from (select distinct {sel} from {table} {where})").iloc[0]["n"])
    except Exception:  # noqa: BLE001
        return 0


IDENT_LEAD = ("campaign_name", "campaign_id", "adset_name", "adset_id",
              "ad_name", "ad_id", "creator", "cohort")

# Created / Edited fields sit right after the identifiers in every table.
TIMESTAMP_LEAD = ("date_created", "created_time", "created_at", "ad_created_time",
                  "updated_time", "last_updated", "modified_time", "edited_on")

# Metric display priority (the workbook's priority set first, then the funnel).
METRIC_PRIORITY = ["spend", "impressions", "reach", "frequency", "clicks",
                   "inline_link_clicks", "link_ctr", "ctr", "outbound_clicks",
                   "unique_outbound_clicks", "cpc", "cpm", "cpp", "cost_per_reach",
                   "results", "cost_per_result", "video_3s", "thruplays",
                   "video_p25", "video_p50", "video_p75", "video_p100",
                   "hook_rate", "hold_rate", "thruplay_rate", "through_rate",
                   "purchases", "purchase_value", "roas", "cvr", "aov",
                   "landing_page_views", "add_to_cart", "date_start"]


CREATED_CANDS = ("date_created", "created_time", "created_at", "ad_created_time")
EDITED_CANDS = ("updated_time", "last_updated", "modified_time", "edited_on")
DISPLAY_NAME = {"campaign_name": "Campaign", "adset_name": "Ad Set", "ad_name": "Ad",
                "campaign_id": "Campaign ID", "adset_id": "Ad Set ID", "ad_id": "Ad ID",
                "spend": "Spend", "impressions": "Impressions", "reach": "Reach",
                "cpm": "CPM", "clicks": "Clicks", "ctr": "CTR", "link_ctr": "Link CTR",
                "cpc": "CPC", "inline_link_clicks": "Link Clicks", "frequency": "Frequency",
                "cost_per_reach": "Cost per Reach", "add_to_cart": "Add to Cart",
                "purchases": "Purchases", "cost_per_purchase": "CPA", "roas": "ROAS"}
SPEC_METRIC_ORDER = ["Spend", "Impressions", "Reach", "CPM",          # 1. Delivery
                     "Clicks", "CTR", "Link CTR", "CPC",              # 2. Engagement
                     "Add to Cart", "Purchases", "CPA", "ROAS"]       # 3. Conversion


def spec_frame(df):
    """THE dynamic column-array logic: hierarchy columns (per the Granularity
    filter — Campaign / +Ad Set / +Ad) left-most, then Created At + Edited On,
    then metrics strictly in Delivery -> Engagement -> Conversion order, then
    ids/extras, all-empty columns last (order_table already sank them)."""
    if df is None or getattr(df, "empty", True):
        return df
    df = order_table(df)
    ren = {}
    for c in df.columns:
        if c in CREATED_CANDS and "Created At" not in ren.values():
            ren[c] = "Created At"
        elif c in EDITED_CANDS and "Edited On" not in ren.values():
            ren[c] = "Edited On"
        elif c in DISPLAY_NAME:
            ren[c] = DISPLAY_NAME[c]
    df = df.rename(columns=ren)
    df = df.loc[:, ~df.columns.duplicated()]
    hier = [h for h in ("Campaign", "Ad Set", "Ad") if h in df.columns]
    meta = [m for m in ("Created At", "Edited On") if m in df.columns]
    prio = [p for p in SPEC_METRIC_ORDER if p in df.columns and df[p].notna().any()]
    ids = [i for i in ("Campaign ID", "Ad Set ID", "Ad ID") if i in df.columns]
    rest = [c for c in df.columns if c not in hier + meta + prio + ids]
    return df[hier + meta + prio + ids + rest]


def spec_colcfg():
    """st.column_config formatting: currency for Spend/CPA/CPM/CPC/Cost-per-
    Reach, percentages for CTRs, x-multiple for ROAS. Returns None (no config,
    plain table — never a crash) on Streamlit builds without column_config."""
    if not hasattr(st, "column_config"):
        return None
    money_fmt = {"format": "$%.2f"}
    return {
        "Spend": st.column_config.NumberColumn("Spend", **money_fmt),
        "CPM": st.column_config.NumberColumn("CPM", **money_fmt),
        "CPC": st.column_config.NumberColumn("CPC", **money_fmt),
        "CPA": st.column_config.NumberColumn("CPA", **money_fmt),
        "Cost per Reach": st.column_config.NumberColumn("Cost per Reach", format="$%.4f"),
        "CTR": st.column_config.NumberColumn("CTR", format="%.2f%%"),
        "Link CTR": st.column_config.NumberColumn("Link CTR", format="%.2f%%"),
        "ROAS": st.column_config.NumberColumn("ROAS", format="%.2fx"),
        "Impressions": st.column_config.NumberColumn("Impressions", format="%d"),
        "Reach": st.column_config.NumberColumn("Reach", format="%d"),
        "Clicks": st.column_config.NumberColumn("Clicks", format="%d"),
    }


def order_table(df, lead=IDENT_LEAD):
    """Presentation order for EVERY table: identifier columns first, populated
    columns next, columns whose values are ALL empty pushed to the end (kept
    visible so the schema is honest, but never in the way of real data)."""
    if df is None or getattr(df, "empty", True):
        return df
    cols = list(df.columns)

    def _all_empty(c):
        s = df[c]
        try:
            if s.notna().sum() == 0:
                return True
            return bool(s.astype(str).str.strip().isin(["", "None", "nan", "NaN", "--", "-"]).all())
        except Exception:  # noqa: BLE001
            return False

    lead_cols = [c for c in lead if c in cols]
    ts_cols = [c for c in TIMESTAMP_LEAD if c in cols and c not in lead_cols]
    taken = set(lead_cols) | set(ts_cols)
    empty_cols = [c for c in cols if c not in taken and _all_empty(c)]
    rest = [c for c in cols if c not in taken and c not in empty_cols]
    prio = [c for c in METRIC_PRIORITY if c in rest]
    tail = [c for c in rest if c not in prio]
    return df[lead_cols + ts_cols + prio + tail + empty_cols]


def meta_where(campaigns=None):
    w = ("where 1=1" + acct_clause("account_name", account)
         + mkt_clause(marketplace) + date_clause("date_start", since, until)
         + _inlist_clause(OBJ_COL, objective_sel) + _inlist_clause(STATUS_COL, status_sel))
    if campaigns:
        inlist = ",".join("'" + str(c).replace("'", "''") + "'" for c in campaigns)
        w += f" and campaign_name in ({inlist})"
    return w


def _additive_cols(table):
    return [c for c, t in table_columns(table)
            if str(t).upper().startswith(("NUMBER", "FLOAT", "DECIMAL", "INT")) and c not in RATIO_COLS]


@st.cache_data(ttl=600, show_spinner=False)
def sql_sums(table, where):
    """EXACT totals over ALL rows in scope, computed in SQL (no fetch cap).
    Additive columns only; derived metrics come from the catalog on these sums."""
    nums = _additive_cols(table)
    if not nums:
        return {}
    sel = ", ".join(f'sum("{c.upper()}") as {c}' for c in nums)
    try:
        row = q(f"select {sel} from {table} {where}")
    except Exception:  # noqa: BLE001
        return {}
    out = {}
    for c in nums:
        v = row.iloc[0].get(c)
        if v is not None and pd.notna(v):
            out[c] = float(v)
    return out


@st.cache_data(ttl=600, show_spinner=False)
def sql_group_sums(table, where, group_cols, limit=None, offset=0):
    """Group-by aggregation in SQL over ALL rows in scope — additive sums per
    group; optional server-side pagination for very wide group lists."""
    gcols = [group_cols] if isinstance(group_cols, str) else list(group_cols)
    nums = [c for c in _additive_cols(table) if c not in gcols]
    gsel = ", ".join(f'"{c.upper()}" as {c}' for c in gcols)
    gpos = ", ".join(str(i + 1) for i in range(len(gcols)))
    sel = ", ".join(f'sum("{c.upper()}") as {c}' for c in nums)
    # Created/edited per entity (true columns ONLY, when the table has them) -
    # timestamps are not additive, so they must be aggregated explicitly or
    # they silently vanish from grouped tables. Nothing is derived or invented
    # when the source table carries no created/edited columns.
    tcols = {c for c, _ in table_columns(table)}
    extras = []
    for c in CREATED_CANDS:
        if c in tcols:
            extras.append(f'min("{c.upper()}") as {c}')
            break
    for c in EDITED_CANDS:
        if c in tcols:
            extras.append(f'max("{c.upper()}") as {c}')
            break
    parts = ([sel] if sel else []) + extras
    # Default sort: ALWAYS descending — spend first, else the first metric.
    if "spend" in nums:
        ob = " order by spend desc nulls last"
    elif nums:
        ob = f" order by {nums[0]} desc nulls last"
    else:
        ob = ""
    lim = f" limit {int(limit)} offset {int(offset)}" if limit else ""
    tail = (", " + ", ".join(parts)) if parts else ""
    return q(f"select {gsel}{tail} from {table} {where} group by {gpos}{ob}{lim}")


@st.cache_data(ttl=600, show_spinner=False)
def daily_series(table, where, metric, by=None):
    byc = f', "{by.upper()}" as {by}' if by else ""
    byg = ", 2" if by else ""
    return q(f'select "DATE_START" as date_start{byc}, sum("{metric.upper()}") as {metric} '
             f"from {table} {where} group by 1{byg} order by 1")


# Date columns the Google / TikTok (Daton) tables actually use vary by feed.
DATE_COL_CANDIDATES = ("date_start", "segments_date", "date", "stat_time_day",
                       "stat_date", "day", "date_stop")


def table_date_col(table):
    cols = {c for c, _ in table_columns(table)}
    return next((c for c in DATE_COL_CANDIDATES if c in cols), None)


def generic_where(table):
    """Account + date scoping for Google/TikTok tables using whatever columns
    they REALLY have. account is the top-bar multiselect (a LIST — never call
    .replace on it); acct_clause handles one value or many."""
    w = "where 1=1"
    if account and acct_col and has_column(table, acct_col):
        w += acct_clause(f'"{acct_col.upper()}"', account)
    dc = table_date_col(table)
    if dc:
        w += date_clause(f'"{dc.upper()}"', since, until)
    return w


def tiktok_table(lvl):
    """TikTok's grain naming differs: our 'adset' level is TikTok's 'adgroup'."""
    return TIKTOK.get({"adset": "adgroup"}.get(lvl, lvl), TIKTOK["campaign"])


def cohort_chart(df, dim, title):
    """Cohort bar chart (spend by dimension) + the aggregated rows. Used by the
    TikTok cohort panels; falls back to a plain table when spend is absent."""
    numc = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c not in RATIO_COLS]
    if "spend" not in df.columns or dim not in df.columns or not numc:
        st.dataframe(df, use_container_width=True, height=360)
        return
    g = df.groupby(dim, as_index=False)[numc].sum().sort_values("spend", ascending=False)
    top = g.head(30)
    st.altair_chart(
        alt.Chart(top).mark_bar(color=GREEN).encode(
            x=alt.X("spend:Q", title="Spend"),
            y=alt.Y(f"{dim}:N", sort="-x", title=None),
            tooltip=[dim, alt.Tooltip("spend:Q", format="$,.2f")],
        ).properties(height=max(140, 24 * len(top)), title=title),
        use_container_width=True)
    st.dataframe(order_table(g, lead=(dim,) + IDENT_LEAD),
                 use_container_width=True, height=280)


# ── COHORT FRAMEWORK — dimensions discovered live; census rollup; targeting ──
DIM_COLS = ("age", "gender", "region", "state", "country", "dma", "city",
            "impression_device", "device_platform", "publisher_platform",
            "platform_position", "placement")

# Standard US census-region classification (fixed public mapping, not data).
US_CENSUS_REGION = {
    "Connecticut": "Northeast", "Maine": "Northeast", "Massachusetts": "Northeast",
    "New Hampshire": "Northeast", "Rhode Island": "Northeast", "Vermont": "Northeast",
    "New Jersey": "Northeast", "New York": "Northeast", "Pennsylvania": "Northeast",
    "Illinois": "Midwest", "Indiana": "Midwest", "Michigan": "Midwest", "Ohio": "Midwest",
    "Wisconsin": "Midwest", "Iowa": "Midwest", "Kansas": "Midwest", "Minnesota": "Midwest",
    "Missouri": "Midwest", "Nebraska": "Midwest", "North Dakota": "Midwest", "South Dakota": "Midwest",
    "Delaware": "South", "Florida": "South", "Georgia": "South", "Maryland": "South",
    "North Carolina": "South", "South Carolina": "South", "Virginia": "South",
    "District Of Columbia": "South", "West Virginia": "South", "Alabama": "South",
    "Kentucky": "South", "Mississippi": "South", "Tennessee": "South", "Arkansas": "South",
    "Louisiana": "South", "Oklahoma": "South", "Texas": "South",
    "Arizona": "West", "Colorado": "West", "Idaho": "West", "Montana": "West",
    "Nevada": "West", "New Mexico": "West", "Utah": "West", "Wyoming": "West",
    "Alaska": "West", "California": "West", "Hawaii": "West", "Oregon": "West",
    "Washington": "West",
}


@st.cache_data(ttl=3600, show_spinner=False)
def discover_breakdowns():
    """Every Meta insights breakdown table that actually exists in the
    warehouse + its dimension columns — discovered live, never assumed."""
    found = []
    for schema in ("MAPLEMONK1", "MAPLEMONK"):
        try:
            t = q("select table_name from VAHDAM_DB.information_schema.tables "
                  f"where table_schema = '{schema}' and table_name ilike 'META%INSIGHTS%'")
        except Exception:  # noqa: BLE001
            continue
        for name in t["table_name"].astype(str).tolist():
            fqn = f"VAHDAM_DB.{schema}.{name}"
            cols = [c for c, _ in table_columns(fqn)]
            dims = [c for c in cols if c in DIM_COLS]
            if dims:
                found.append({"table": fqn, "dims": dims,
                              "has_campaign": "campaign_name" in cols,
                              "has_date": "date_start" in cols,
                              "has_account": "account_name" in cols,
                              "has_ad": "ad_name" in cols})
    return found


def meta_targeting_conditions(selection):
    """Ads Manager conditions + Marketing API targeting JSON for a cohort.
    Zero fabrication: Meta's numeric geo keys are NEVER invented — any key that
    needs Meta's Targeting Search API is marked '<lookup …>' explicitly."""
    ui, notes = [], []
    spec = {"geo_locations": {"countries": ["US"]}}
    for dim, val in selection.items():
        v = str(val).strip()
        if dim == "age":
            m = re.match(r"(\d+)\s*-\s*(\d+)", v)
            if m:
                spec["age_min"], spec["age_max"] = int(m.group(1)), int(m.group(2))
            elif v.endswith("+") and v[:-1].isdigit():
                spec["age_min"] = int(v[:-1])
                notes.append("Open-ended age bucket: set only age_min; Meta reports 65+ as one bucket.")
            ui.append(f"Audience > Age: {v}")
        elif dim == "gender":
            g = v.lower()
            if g in ("female", "f"):
                spec["genders"] = [2]
            elif g in ("male", "m"):
                spec["genders"] = [1]
            else:
                notes.append(f"Gender '{v}' is a reporting bucket only — it cannot be targeted on Meta.")
            ui.append(f"Audience > Gender: {v}")
        elif dim in ("region", "state"):
            spec["geo_locations"]["regions"] = [
                {"key": f"<lookup '{v}' via Targeting Search API type=adgeolocation>", "name": v}]
            ui.append(f"Audience > Location: United States > {v}")
        elif dim == "census_region":
            ui.append(f"Audience > Location: United States > every {v} state (member list shown above)")
            notes.append("Census region is an analysis rollup — on Meta, add each member state under Locations.")
        elif dim == "country":
            spec["geo_locations"] = {"countries": [v.upper()[:2] if len(v) == 2 else v]}
            ui.append(f"Audience > Location: {v}")
        elif dim == "dma":
            spec["geo_locations"]["geo_markets"] = [
                {"key": f"<lookup DMA '{v}' via Targeting Search API>", "name": v}]
            ui.append(f"Audience > Location: DMA {v}")
        elif dim == "city":
            spec["geo_locations"]["cities"] = [
                {"key": f"<lookup city '{v}' via Targeting Search API>", "name": v}]
            ui.append(f"Audience > Location: city {v}")
        elif dim in ("impression_device", "device_platform"):
            if v.lower() in ("mobile", "desktop"):
                spec["device_platforms"] = [v.lower()]
            else:
                notes.append(f"Device '{v}' maps to user_device/user_os — set under Placements > Devices.")
            ui.append(f"Placements > Devices: {v}")
        elif dim == "publisher_platform":
            spec["publisher_platforms"] = [v.lower()]
            ui.append(f"Placements > Platforms: {v}")
        elif dim in ("platform_position", "placement"):
            spec["positions_note"] = v
            ui.append(f"Placements > Position: {v}")
    return ui, spec, notes


# ── CAMPAIGN DETAIL PAGE — reused by EVERY tab so any campaign row can be
# opened for full analysis (config, all metrics, trend, per-ad, audience,
# creatives). key_prefix keeps widget ids unique per tab.
def render_campaign_detail(camp, key_prefix="cd", entity_col="campaign_name"):
    _ev = str(camp).replace("'", "''")
    ew = meta_where() + f" and \"{entity_col.upper()}\" = '{_ev}'"
    df = q(f"select * from {META_SRC} {ew} order by date_start desc limit 2000")
    if df.empty:
        st.warning("No rows for this campaign in the window.")
    else:
        groups = classify_columns(table_columns(META_SRC))
        sums = sql_sums(META_SRC, ew)
        derived = compute_all(sums)
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Spend", money(sums.get("spend")))
        c2.metric("Impressions", f"{sums.get('impressions', 0):,.0f}")
        c3.metric("Link clicks", f"{sums.get('inline_link_clicks', 0):,.0f}")
        c4.metric("Link CTR", pctf(derived.get("link_ctr")))
        c5.metric("CPC", money(derived.get("cpc")))
        n_ads = df["ad_name"].nunique() if "ad_name" in df.columns else 0
        n_sets = df["adset_name"].nunique() if "adset_name" in df.columns else 0
        st.caption(f"{n_ads} ads · {n_sets} ad sets · {len(df):,} sampled rows (aggregates are exact via SQL). "
                   "Reach here is a sum of daily reach — uniques may overlap across days.")

        st.subheader("Campaign configuration & audience fields (everything the table carries)")
        conf_rows = []
        for c in groups["identity_config"] + groups["audience_targeting"]:
            if c in df.columns:
                vals = df[c].dropna().astype(str).unique()[:6]
                if len(vals):
                    conf_rows.append({"Field": c,
                                      "Group": "audience/targeting" if c in groups["audience_targeting"] else "identity/config",
                                      "Distinct values (up to 6)": " · ".join(vals),
                                      "Distinct count": int(df[c].nunique())})
        st.dataframe(pd.DataFrame(conf_rows), use_container_width=True, hide_index=True, height=280)

        st.subheader("Every metric — base table sums + full derived catalog")
        st.dataframe(metric_sheet(sums, derived), use_container_width=True, hide_index=True, height=420)

        st.subheader("Daily trend")
        mcols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c not in RATIO_COLS]
        if not mcols:
            st.info("No additive numeric columns to trend at this grain.")
        else:
            mm = st.selectbox("Measure", mcols, index=mcols.index("spend") if "spend" in mcols else 0,
                              key=key_prefix + "_measure")
            g = daily_series(META_SRC, ew, mm)
            if g.empty:
                st.info("No daily rows in the window for this measure.")
            else:
                st.altair_chart(
                    alt.Chart(g).mark_line(color=GREEN, point=True).encode(
                        x=alt.X("date_start:T", title=None), y=alt.Y(f"{mm}:Q", title=mm),
                        tooltip=["date_start", mm]).properties(height=260),
                    use_container_width=True)

        st.subheader("Per-ad breakdown (all metric fields + derived)")
        if "ad_name" in df.columns:
            per_ad = sql_group_sums(META_SRC, ew, ident_cols("ad"))
            if per_ad.empty:
                st.info("No per-ad rows in the window.")
            else:
                for k in ("link_ctr", "ctr", "cpc", "cpm", "cost_per_reach", "frequency", "roas", "cost_per_purchase"):
                    fn = CATALOG_FN.get(k)
                    if fn:
                        per_ad[k] = per_ad.apply(lambda r, f=fn: f(r.to_dict()), axis=1)
                if "spend" in per_ad.columns:
                    per_ad = per_ad.sort_values("spend", ascending=False)
                st.dataframe(spec_frame(per_ad), use_container_width=True, height=420,
                             hide_index=True, column_config=spec_colcfg())
        else:
            st.info("No ad_name column at this grain.")

        st.subheader("Audience delivery (platform breakdown tables)")
        ac1, ac2 = st.columns(2)
        with ac1:
            st.markdown("**Age × gender**")
            if entity_col == "campaign_name" and has_column(META_AGE_GENDER, "campaign_name"):
                agw = ("where campaign_name = '" + camp.replace("'", "''") + "'"
                       + date_clause("date_start", since, until))
                try:
                    ag = q(f"select age, gender, sum(spend) as spend, sum(impressions) as impressions "
                           f"from {META_AGE_GENDER} {agw} group by age, gender order by spend desc nulls last")
                    st.dataframe(ag, use_container_width=True, height=260)
                except Exception as e:  # noqa: BLE001
                    st.info(f"Age/gender unavailable: {e}")
            else:
                st.info("Age/gender table carries no campaign_name — see Cohorts for account-level splits.")
        with ac2:
            st.markdown("**Device / placement**")
            if entity_col == "campaign_name" and has_column(META_DEVICE, "campaign_name"):
                dvw = ("where campaign_name = '" + camp.replace("'", "''") + "'"
                       + date_clause("date_start", since, until))
                try:
                    _dvo = ' order by "SPEND" desc nulls last' if has_column(META_DEVICE, "spend") else ""
                    dv = q(f"select * from {META_DEVICE} {dvw}{_dvo} limit 2000")
                    st.dataframe(dv, use_container_width=True, height=260)
                except Exception as e:  # noqa: BLE001
                    st.info(f"Device breakdown unavailable: {e}")
            else:
                st.info("Device table carries no campaign_name — see Cohorts for account-level splits.")

        st.subheader("Ad creatives / configuration register")
        ccols = [c for c, _ in table_columns(META_CREATIVES)]
        if not ccols:
            st.info("Creatives table not readable for this role.")
        elif "ad_name" in ccols and "ad_name" in df.columns:
            names = df["ad_name"].dropna().astype(str).unique()[:200]
            inlist = ",".join("'" + n.replace("'", "''") + "'" for n in names)
            try:
                cr = q(f"select * from {META_CREATIVES} where ad_name in ({inlist}) limit 500")
                if cr.empty:
                    st.info("No creative rows match this campaign's ads.")
                else:
                    st.dataframe(cr, use_container_width=True, height=300)
                    _imgc = next((c for c in cr.columns if any(k in c for k in
                                  ("image_url", "thumbnail", "image_link", "creative_url", "picture"))), None)
                    if _imgc:
                        _urls = [u for u in cr[_imgc].dropna().astype(str).tolist() if u.startswith("http")][:6]
                        if _urls:
                            st.markdown("**Creative previews**")
                            try:
                                st.image(_urls, width=160)
                            except Exception:  # noqa: BLE001
                                pass
            except Exception as e:  # noqa: BLE001
                st.info(f"Creatives unavailable: {e}")
        else:
            st.info("No shared ad_name key between insights and creatives — browse creatives via Ad explorer.")


# ── ALL-CAMPAIGNS BLOCK — every campaign as a row (paginated, no cap) plus
# a detail-page opener. Mounted on every Ads Analytics tab.
def all_campaigns_block(key):
    lbl = LEVEL_LABEL.get(level, "Campaign")
    st.subheader(f"All {lbl}s — one row per {lbl.lower()}")
    st.caption(f"Grain follows the Level filter ({lbl}): the identifier chain leads every row "
               f"(Campaign{' > Ad Set' if level in ('adset', 'ad') else ''}{' > Ad' if level == 'ad' else ''}), "
               "then created/edited fields, then metrics in priority order.")
    w = meta_where()
    gcols = ident_cols(level)
    total = count_distinct(META_SRC, w, gcols)
    if not total:
        st.info("No campaigns in scope.")
        return
    size, off = pager(total, key + "_cr")
    df = sql_group_sums(META_SRC, w, gcols, limit=size, offset=off)
    for k in ("link_ctr", "ctr", "cpc", "cpm", "cost_per_reach", "frequency", "roas", "cost_per_purchase"):
        fn = CATALOG_FN.get(k)
        if fn:
            df[k] = df.apply(lambda r, f=fn: f(r.to_dict()), axis=1)
    st.dataframe(spec_frame(df), use_container_width=True, height=420,
                 hide_index=True, column_config=spec_colcfg())
    opts = campaign_options(account, marketplace, since, until, LEVEL_COL.get(level, "campaign_name"))
    pick = st.selectbox(f"Open a {LEVEL_LABEL.get(level, 'Campaign').lower()} detail page",
                        ["—"] + opts, key=key + "_open")
    if pick != "—":
        st.markdown("---")
        st.markdown(f"### {LEVEL_LABEL.get(level, 'Campaign')} detail — {pick}")
        render_campaign_detail(pick, key, LEVEL_COL.get(level, "campaign_name"))


# ═════════════════════════════════════════════════════════════════════════════
# ADS ANALYTICS
# ═════════════════════════════════════════════════════════════════════════════
# ── AD ACCOUNTS & RETAIL FUNNEL ───────────────────────────────────────────────
def _kpi_badge(kpi: str) -> str:
    return ("judged on ROAS" if kpi == "roas"
            else "judged on traffic (CTR / CPC / CPM)")


@st.cache_data(ttl=300, show_spinner=False)
def account_live_figures(acct_id: str, table: str, kpi: str, since, until):
    """Live spend / delivery / revenue for one registry account, read with that
    account's own column names. Returns None when the table or grant is missing —
    an unreadable account is reported as unreadable, never as zero."""
    reg = {a["id"]: a for a in AD_ACCOUNTS}.get(acct_id)
    if not reg:
        return None
    try:
        if acct_id == "target_roundel":
            sql = (f"select {sf_cash('Actualized Vendor Spend')} as spend, "
                   f"{sf_qty('IMPRESSIONS')} as impressions, {sf_qty('CLICKS')} as clicks, "
                   f"{sf_cash('Attributed Total Sales')} as revenue, "
                   f'"Campaign Name" as campaign from {table} '
                   f"where {sf_day('Event Date')} between '{since}' and '{until}'")
        elif reg["platform"] == "Google":
            if acct_id == "google_us":
                sql = (f"select SPEND as spend, IMPRESSIONS as impressions, CLICKS as clicks, "
                       f"CONVERSION_VALUE as revenue, CAMPAIGN_NAME as campaign from {table} "
                       f"where SEGMENTS_DATE between '{since}' and '{until}' "
                       f"and {GOOGLE_ADS_FILTER}")
            else:
                sql = (f'select "metrics.cost_micros" / 1000000.0 as spend, '
                       f'"metrics.impressions" as impressions, "metrics.clicks" as clicks, '
                       f'"metrics.conversions_value" as revenue, "campaign.name" as campaign '
                       f'from {table} where "segments.date" between \'{since}\' and \'{until}\'')
        elif reg["platform"] == "TikTok":
            sql = (f"select SPEND::float as spend, IMPRESSIONS::float as impressions, "
                   f"CLICKS::float as clicks, null as revenue, CAMPAIGN_NAME as campaign "
                   f"from {table} where STAT_TIME_DAY between '{since}' and '{until}'")
        else:  # Meta
            sql = (f"select SPEND as spend, IMPRESSIONS as impressions, "
                   f"INLINE_LINK_CLICKS as clicks, null as revenue, CAMPAIGN_NAME as campaign "
                   f"from {table} where DATE_START between '{since}' and '{until}'")
        df = q(f"select round(sum(spend), 2) as spend, sum(impressions) as impressions, "
               f"sum(clicks) as clicks, round(sum(revenue), 2) as revenue, "
               f"count(distinct campaign) as campaigns from ({sql})")
        if df.empty:
            return None
        r = df.iloc[0]
        return dict(spend=_n(r["SPEND"]) or 0.0, impressions=_n(r["IMPRESSIONS"]) or 0,
                    clicks=_n(r["CLICKS"]) or 0, revenue=_n(r["REVENUE"]),
                    campaigns=int(_n(r["CAMPAIGNS"]) or 0))
    except Exception:  # noqa: BLE001 — missing table/grant: say so, never invent
        return None


@st.cache_data(ttl=300, show_spinner=False)
def retail_funnel(since, until):
    """Spend in MAPLEMONK joined to outcomes in MAPLEMONK1.

    The Meta retail account records zero purchases because its shoppers check out
    inside Target, so judged on its own it can only ever look like cost. Target
    reports the outcome instead: Roundel matches ads to baskets, and TARGET_SALES
    carries the dollars actually rung up in store. Reading BOTH schemas is the only
    honest way to answer "is retail working"."""
    sql = f"""
with meta as (
  select DATE_START::date as d, SPEND::float as spend
    from {META_RETAIL} where DATE_START between '{since}' and '{until}'
), roundel as (
  select {sf_day('Event Date')} as d, {sf_cash('Actualized Vendor Spend')} as spend,
         {sf_cash('Attributed Total Sales')} as attr_sales,
         {sf_qty('Attributed Total Units')} as attr_units
    from {TARGET_ROUNDEL}
   where {sf_day('Event Date')} between '{since}' and '{until}'
), sales as (
  select {sf_day('DATE')} as d, {sf_cash('SALES $')} as sell_through,
         {sf_qty('SALES U')} as units, "LOCATION ID" as store
    from {TARGET_SALES}
   where {sf_day('DATE')} between '{since}' and '{until}'
), g as (
  select date_trunc('month', d) as period, sum(spend) as meta_spend,
         0 as roundel_spend, 0 as attr_sales, 0 as attr_units,
         0 as sell_through, 0 as units, null as stores from meta group by 1
  union all
  select date_trunc('month', d), 0, sum(spend), sum(attr_sales), sum(attr_units),
         0, 0, null from roundel group by 1
  union all
  select date_trunc('month', d), 0, 0, 0, 0, sum(sell_through), sum(units),
         count(distinct store) from sales group by 1
)
select period, round(sum(meta_spend), 2) as meta_spend,
       round(sum(roundel_spend), 2) as roundel_spend,
       round(sum(attr_sales), 2) as attr_sales, sum(attr_units)::int as attr_units,
       round(sum(sell_through), 2) as sell_through, sum(units)::int as units,
       max(stores) as stores
  from g group by period order by period"""
    return q(sql)


def render_ad_accounts():
    st.subheader("The ad-account estate")
    st.caption(
        "Every VAHDAM ad account held in the warehouse, enumerated live by unioning every base "
        "insights and ad-performance table in VAHDAM_DB and grouping by account. Accounts do not "
        "share a schema or a naming convention, so searching by the obvious name finds one and "
        "makes the rest look absent: the Target/Costco Meta account is USA_TEA_ADS_ADS_INSIGHTS "
        "(not META_USA%), the live US Google feed is US_GOOGLE_ADS_CONSOLIDATED (not the retired "
        "GOOGLE_ADS_US_AD_GROUP_AD_REPORT, which stops 2023-11-24), and Target Roundel — a whole "
        "additional ad platform — sits in MAPLEMONK1."
    )

    live = [a for a in AD_ACCOUNTS if a["status"] == "live"]
    ids = {(a["platform"], a["account_id"]) for a in AD_ACCOUNTS}
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Ad accounts", len(ids))
    c2.metric("Warehouse feeds", len(AD_ACCOUNTS))
    c3.metric("Live feeds", len(live))
    c4.metric("Judged on ROAS", sum(1 for a in AD_ACCOUNTS if a["kpi"] == "roas"))
    c5.metric("Judged on traffic", sum(1 for a in AD_ACCOUNTS if a["kpi"] == "traffic"))

    st.info(
        "**Two kinds of account, two kinds of scorecard.** Where a pixel or a platform conversion "
        "is tracked, revenue / ROAS / CPA are real. Where checkout happens on a third-party site "
        "(target.com, Instacart, amazon.com) no purchase can ever be attributed, so those accounts "
        "show **n/a** rather than 0 and must be judged on CTR, CPC, CPM and reach. A 0.00x ROAS on "
        "a retail account is a measurement artefact, not a result."
    )

    # ---- Live accounts, described. One card per account, equal size, aligned.
    st.markdown("#### Live accounts — what each one is for")
    for i in range(0, len(live), 2):
        cols = st.columns(2)
        for col, a in zip(cols, live[i:i + 2]):
            with col:
                with st.container(border=True):
                    st.markdown(f"**{a['label']}**")
                    st.caption(
                        f"{a['platform']} · {a['region']} · `{a['account_id']}` · "
                        f"fresh to {a['fresh_to']}"
                        f"{' (incl. current partial day)' if a.get('partial_day') else ''} · "
                        f"{_kpi_badge(a['kpi'])} · {a['currency']}"
                    )
                    st.markdown(f"**Used for.** {a['used_for']}")
                    st.markdown(a["purpose"])
                    if a.get("attribution_note"):
                        st.warning(f"**Attribution.** {a['attribution_note']}")
                    f = account_live_figures(a["id"], a["table"], a["kpi"], since, until)
                    m1, m2, m3 = st.columns(3)
                    if f is None:
                        m1.metric("Spend in window", "unreadable")
                        st.caption("No rows or no grant for this table in the selected window — "
                                   "reported as unreadable rather than as zero.")
                    else:
                        m1.metric("Spend in window", money(f["spend"]))
                        if a["kpi"] == "roas" and f["revenue"] is not None and f["spend"]:
                            m2.metric("ROAS", f"{f['revenue'] / f['spend']:.2f}x")
                            m3.metric("Revenue", money(f["revenue"]))
                        else:
                            m2.metric("CTR", pctf(_pct(f["clicks"], f["impressions"])))
                            m3.metric("CPC", money(_div(f["spend"], f["clicks"])))
                        st.caption(f"{f['campaigns']} campaigns · {int(f['impressions']):,} "
                                   f"impressions · {int(f['clicks']):,} clicks · read live")
                    st.caption(f"`{a['table']}`  \n_On record: {a['verified']}_")

    # ---- Full estate table.
    st.markdown("#### Every feed in the warehouse")
    _s1, _s2 = st.columns([1, 1])
    st_filter = _s1.multiselect("Status", ["live", "paused", "superseded", "stale", "archive"],
                                default=["live"])
    pf_filter = _s2.multiselect("Platform", sorted({a["platform"] for a in AD_ACCOUNTS}),
                                default=sorted({a["platform"] for a in AD_ACCOUNTS}))
    rows = [a for a in AD_ACCOUNTS
            if (not st_filter or a["status"] in st_filter)
            and (not pf_filter or a["platform"] in pf_filter)]
    est = pd.DataFrame([{
        "Account": a["label"], "Platform": a["platform"], "Region": a["region"],
        "Account id": a["account_id"], "Status": a["status"], "Judged on": a["kpi"],
        "Currency": a["currency"], "Fresh to": a["fresh_to"], "Used for": a["used_for"],
        "Warehouse table": a["table"], "On record": a["verified"],
    } for a in rows])
    st.dataframe(est, use_container_width=True, hide_index=True)
    st.caption(
        f"{len(rows)} of {len(AD_ACCOUNTS)} feeds. Every column header sorts. 'On record' is the "
        "whole-feed lifetime figure in that account's OWN currency — India is INR and UK is GBP, "
        "so they must never be summed with the USD accounts."
    )

    # ---- Retail funnel: the only way the Target programme can be measured.
    st.markdown("#### Retail funnel — spend in MAPLEMONK, outcomes in MAPLEMONK1")
    st.caption(
        "The Target/Costco Meta account cannot attribute a sale, so judged on its own it can only "
        "ever look like cost. Target reports the outcome instead: Roundel matches ads to baskets, "
        "and TARGET_SALES carries the dollars actually rung up across Target stores. This is why "
        "both schemas are required."
    )
    try:
        rf = retail_funnel(since, until)
    except Exception as exc:  # noqa: BLE001
        st.warning(f"Retail funnel unavailable: {exc}")
        rf = pd.DataFrame()
    if rf.empty:
        st.info("No retail rows in the selected window.")
    else:
        rf = rf.rename(columns=str.upper)
        tot_meta = float(rf["META_SPEND"].sum())
        tot_rnd = float(rf["ROUNDEL_SPEND"].sum())
        tot_attr = float(rf["ATTR_SALES"].sum())
        tot_sell = float(rf["SELL_THROUGH"].sum())
        tot_units = int(rf["UNITS"].sum())
        total_spend = tot_meta + tot_rnd
        k1, k2, k3, k4 = st.columns(4)
        k1.metric("Retail ad spend", money(total_spend),
                  help=f"Meta {money(tot_meta)} + Roundel {money(tot_rnd)}")
        k2.metric("Roundel attributed sales", money(tot_attr),
                  help="Matched by Target to the basket — not a pixel conversion.")
        k3.metric("Target sell-through", money(tot_sell), help=f"{tot_units:,} units rung up in store")
        k4.metric("Sell-through per ad dollar",
                  f"{tot_sell / total_spend:.2f}x" if total_spend else "—",
                  help="Blended, NOT causal.")
        show = pd.DataFrame({
            "Month": pd.to_datetime(rf["PERIOD"]).dt.strftime("%B %Y"),
            "Meta retail spend": rf["META_SPEND"].map(money),
            "Roundel spend": rf["ROUNDEL_SPEND"].map(money),
            "Total spend": (rf["META_SPEND"] + rf["ROUNDEL_SPEND"]).map(money),
            "Roundel attr. sales": rf["ATTR_SALES"].map(money),
            "Roundel ROAS": [f"{a / b:.2f}x" if b else "—"
                             for a, b in zip(rf["ATTR_SALES"], rf["ROUNDEL_SPEND"])],
            "Target sell-through": rf["SELL_THROUGH"].map(money),
            "Units": rf["UNITS"].map(lambda v: f"{int(v):,}"),
            "Stores": rf["STORES"].map(lambda v: f"{int(v):,}" if pd.notna(v) else "—"),
            "Sell-through / $": [f"{s / t:.2f}x" if t else "—" for s, t in
                                 zip(rf["SELL_THROUGH"], rf["META_SPEND"] + rf["ROUNDEL_SPEND"])],
        })
        st.dataframe(show, use_container_width=True, hide_index=True)
        st.caption(
            "Sell-through per ad dollar is a BLENDED ratio of Target sell-through to total retail "
            "ad spend. It is deliberately not called a ROAS: nothing in the warehouse attributes a "
            "Target basket to a Meta impression, and sell-through includes baseline demand that "
            "would have happened without any advertising. "
            f"Sources: {META_RETAIL} · {TARGET_ROUNDEL} · {TARGET_SALES}"
        )
        chart_df = pd.DataFrame({
            "Month": pd.to_datetime(rf["PERIOD"]).dt.strftime("%b %Y"),
            "Retail ad spend": rf["META_SPEND"] + rf["ROUNDEL_SPEND"],
            "Target sell-through": rf["SELL_THROUGH"],
        }).melt("Month", var_name="Measure", value_name="USD")
        st.altair_chart(
            alt.Chart(chart_df).mark_bar().encode(
                x=alt.X("Month:N", sort=None, title=None),
                y=alt.Y("USD:Q", title="USD"),
                # Two GREENS, differing by shade not hue, so the palette stays
                # white-and-green while the series remain distinguishable.
                color=alt.Color("Measure:N", scale=alt.Scale(
                    domain=["Retail ad spend", "Target sell-through"],
                    range=["#7FA893", GREEN]), legend=alt.Legend(orient="top", title=None)),
                xOffset="Measure:N",
                tooltip=["Month", "Measure", alt.Tooltip("USD:Q", format="$,.0f")],
            ).properties(height=260), use_container_width=True)

    # ---- The measurement layer these figures come from.
    st.markdown("#### Retail measurement layer (MAPLEMONK1)")
    st.caption(
        "MAPLEMONK1 is not just Meta breakdown tables. It carries the whole retail-partner stack, "
        "which is where the Target programme is actually measured."
    )
    st.dataframe(pd.DataFrame([{
        "Feed": m["label"], "What it is": m["what"], "Fresh to": m["fresh_to"],
        "On record": m["verified"], "Table": m["table"],
    } for m in RETAIL_MEASUREMENT]), use_container_width=True, hide_index=True)
    st.warning(
        "**Data-shape trap in these feeds.** They are Airbyte CSV loads: money arrives as TEXT "
        "carrying a currency symbol and thousands separators (`'$125.95'`, `'2,907,903'`) so a "
        "direct numeric cast fails outright, and dates carry TWO shapes in one column "
        "(`DD-MM-YYYY` on older rows, `DD-MM-YYYY H:MI` on newer ones). Parsing only the bare date "
        "form silently drops the newest rows — it made Target sell-through look like it ended "
        "2026-07-13 when it runs to 2026-07-23, understating July by $28,446. Always use the "
        "`sf_cash` / `sf_qty` / `sf_day` helpers."
    )


def render_ads_analytics():
    st.title("Ads Analysis")
    st.caption(
        "Live from Snowflake via the active session — Meta / Google / TikTok, per "
        "campaign / ad set / ad, across ALL connected ad accounts (discovered live; "
        "Target / Costco are marketplaces, not accounts). Priority metrics lead. "
        "Read-only; nothing is fabricated."
    )
    # Analysis views are selected in the LHS menu (see ADS_VIEWS); each block
    # below renders when its view is active.

    if view == "Ad accounts & retail funnel":
        render_ad_accounts()

    if view == "Overview & priority metrics":
        if platform == "Meta":
            # EXACT portfolio totals in SQL over all rows in scope — no fetch cap.
            sums = sql_sums(META_SRC, meta_where())
            derived = compute_all(sums)
            if not sums:
                st.warning("No Meta rows for this account / window.")
            else:
                c1, c2, c3, c4 = st.columns(4)
                c1.metric("Amount spent", money(sums.get("spend")))
                c2.metric("Impressions", f"{sums.get('impressions', 0):,.0f}")
                c3.metric("Reach", f"{sums.get('reach', 0):,.0f}")
                c4.metric("Frequency", f"{derived.get('frequency'):.2f}" if derived.get("frequency") else "—")
                c5, c6, c7, c8 = st.columns(4)
                c5.metric("Link clicks", f"{sums.get('inline_link_clicks', 0):,.0f}")
                c6.metric("Link CTR", pctf(derived.get("link_ctr")))
                c7.metric("CPC", money(derived.get("cpc")))
                c8.metric("CPM", money(derived.get("cpm")))

                # PRIORITY METRICS — the FULL catalog, grouped under the same
                # category tabs as the web dashboard. A metric whose inputs are
                # not in the table reads 'unavailable', never a fabricated 0.
                st.subheader("Priority metrics — full catalog by category")
                st.caption(
                    "Live totals for the CURRENT filter scope, one tab per metric "
                    "category. 'unavailable — needs: X' means the source table does "
                    "not carry that input column yet (e.g. video quartiles, "
                    "purchases) — the metric activates the moment that feed lands; "
                    "nothing is estimated in the meantime."
                )

                def fmt_val(unit, v):
                    if v is None:
                        return "unavailable"
                    if unit in ("usd", "usd4"):
                        return money(v)
                    if unit == "pct":
                        return pctf(v)
                    if unit == "int":
                        return f"{v:,.0f}"
                    if unit == "sec":
                        return f"{v:,.1f}s"
                    return f"{v:,.3f}"

                cat_tabs = st.tabs([c[1] for c in CATEGORIES])
                for ct, (ckey, clabel, caspect) in zip(cat_tabs, CATEGORIES):
                    with ct:
                        st.caption(caspect)
                        rows_ = []
                        for m in METRICS:
                            if m[2] != ckey:
                                continue
                            val = derived.get(m[0])
                            if val is None:
                                missing = [f for f in m[5] if sums.get(f) is None]
                                shown = ("unavailable — needs: " + ", ".join(missing)) if missing else "unavailable"
                            else:
                                shown = fmt_val(m[3], val)
                            rows_.append({"Metric": m[1], "Tier": m[4],
                                          "Value": shown,
                                          "Formula": m[6], "Definition": m[7]})
                        st.dataframe(pd.DataFrame(rows_), use_container_width=True,
                                     hide_index=True, height=min(420, 44 + 36 * len(rows_)))

                all_campaigns_block("ov")

                st.subheader(f"Spend by {LEVEL_LABEL.get(level, 'Campaign').lower()}")
                df = meta_rows(account, level, since, until)
                if not df.empty:
                    top = df.head(15)
                    chart = (
                        alt.Chart(top).mark_bar(color=GREEN).encode(
                            x=alt.X("spend:Q", title="Spend (USD)"),
                            y=alt.Y("name:N", sort="-x", title=None),
                            tooltip=["name", alt.Tooltip("spend:Q", format="$,.0f"),
                                     alt.Tooltip("link_ctr:Q", format=".2f", title="Link CTR %")],
                        ).properties(height=28 * len(top))
                    )
                    st.altair_chart(chart, use_container_width=True)
        else:
            table = GOOGLE_ADS if platform == "Google" else TIKTOK[level if level in TIKTOK else "campaign"]
            st.info(
                f"{platform}: showing recent rows from `{table}`. Column-level metric "
                "mapping for this source is being finalised; Meta has the full computed "
                "priority set."
            )
            st.dataframe(generic_rows(table), use_container_width=True, height=460)

    if view == "Omnichannel Master View":
        # Dynamic typography: title follows Channel + Granularity + Date filters.
        st.subheader(f"{platform_label.replace(' Ads', '')} {LEVEL_LABEL.get(level, 'Campaign')} "
                     f"Performance Metrics: {since} – {until}")
        if platform == "Meta":
            _ks = sql_sums(META_SRC, meta_where())
            _kd = compute_all(_ks)
            # Two rows of 4 — seven metrics in one row overlap on normal widths.
            k1, k2, k3, k4 = st.columns(4)
            k1.metric("Spend", money(_ks.get("spend")))
            k2.metric("Impressions", f"{_ks.get('impressions', 0):,.0f}")
            k3.metric("Reach", f"{_ks.get('reach', 0):,.0f}")
            k4.metric("CPM", money(_kd.get("cpm")))
            k5, k6, k7, _k8 = st.columns(4)
            k5.metric("Clicks", f"{_ks.get('clicks', 0):,.0f}")
            k6.metric("Link CTR", pctf(_kd.get("link_ctr")))
            k7.metric("CPC", money(_kd.get("cpc")))
            st.divider()
        if platform == "Meta":
            gcols = ident_cols(level)
            w = meta_where()
            total = count_distinct(META_SRC, w, gcols)
            if not total:
                st.warning("No rows for this selection.")
            else:
                size, off = pager(total, "rows")
                df = sql_group_sums(META_SRC, w, gcols, limit=size, offset=off)
                for k in ("link_ctr", "ctr", "cpc", "cpm", "cost_per_reach", "frequency", "roas", "cost_per_purchase"):
                    fn = CATALOG_FN.get(k)
                    if fn:
                        df[k] = df.apply(lambda r, f=fn: f(r.to_dict()), axis=1)
                st.dataframe(spec_frame(df), use_container_width=True, height=520,
                             hide_index=True, column_config=spec_colcfg())
                _has_true_dates = any(c in df.columns for c in CREATED_CANDS + EDITED_CANDS)
                if not _has_true_dates:
                    st.caption(
                        "Created At / Edited On appear when the source table carries those "
                        "columns. Meta's insights table does not sync them, so they are "
                        "omitted here rather than invented - they light up the moment the "
                        "warehouse feed adds the campaign/ad metadata columns."
                    )
                opts_r = campaign_options(account, marketplace, since, until, LEVEL_COL.get(level, "campaign_name"))
                pick_r = st.selectbox(f"Open a {LEVEL_LABEL.get(level, 'Campaign').lower()} detail page",
                                      ["—"] + opts_r, key="rows_open")
                if pick_r != "—":
                    st.markdown("---")
                    st.markdown(f"### {LEVEL_LABEL.get(level, 'Campaign')} detail — {pick_r}")
                    render_campaign_detail(pick_r, "rows", LEVEL_COL.get(level, "campaign_name"))
        else:
            table = GOOGLE_ADS if platform == "Google" else tiktok_table(level)
            wg = generic_where(table)
            total = count_rows(table, wg)
            if not total:
                st.info(f"No readable rows in `{table}` for this account / date scope.")
            else:
                size, off = pager(total, "rows_g")
                _dc = table_date_col(table)
                _ob = f' order by "{_dc.upper()}" desc' if _dc else ""
                try:
                    st.dataframe(order_table(q(f"select * from {table} {wg}{_ob} limit {size} offset {off}")),
                                 use_container_width=True, height=520)
                except Exception as e:  # noqa: BLE001
                    st.info(f"Could not read {table}: {e}")

    if view == "Cohort Exploration":
        st.subheader(f"{platform_label.replace(' Ads', '')} Cohort Exploration: {since} – {until}")
        st.caption(
            "Cohorts by age, gender, region/state (plus a US census-region rollup of "
            "states), country, DMA, city, device and placement — whichever dimensions "
            "the delivery-breakdown tables REALLY carry (discovered live). Every "
            "cohort opens a detail page with all metrics, trend, campaigns and the "
            "exact Meta platform conditions to target it."
        )

        if platform == "Meta":
            bts = discover_breakdowns()
            if not bts:
                st.warning("No Meta breakdown tables discovered in the warehouse for this role.")
            else:
                # Dimension menu built from what actually exists.
                dim_options = []
                for b in bts:
                    if "age" in b["dims"] and "gender" in b["dims"]:
                        dim_options.append(("Age × Gender", b["table"], ["age", "gender"]))
                    for d in b["dims"]:
                        dim_options.append((d.replace("_", " ").title(), b["table"], [d]))
                geo = next((o for o in dim_options if len(o[2]) == 1 and o[2][0] in ("region", "state")), None)
                if geo:
                    dim_options.append(("Region (US census rollup of states)", geo[1], ["__census__", geo[2][0]]))
                seen, uniq, labels = set(), [], []
                for o in dim_options:
                    k = (o[0], o[1])
                    if k in seen:
                        continue
                    seen.add(k)
                    uniq.append(o)
                    labels.append(f"{o[0]}  —  {o[1].split('.')[-1]}")
                pick = st.selectbox("Cohort dimension (discovered live from the warehouse)", labels)
                label, btable, dims = uniq[labels.index(pick)]
                w = "where 1=1"
                if has_column(btable, "date_start"):
                    w += date_clause("date_start", since, until)
                if account and has_column(btable, "account_name"):
                    w += acct_clause("account_name", account)
                if marketplace and has_column(btable, "ad_name"):
                    w += mkt_clause(marketplace)
                census = dims[0] == "__census__"
                gcol = dims[-1] if census else None
                key_cols = ["census_region"] if census else dims
                try:
                    if census:
                        g = sql_group_sums(btable, w, [gcol])
                        g["census_region"] = g[gcol].map(
                            lambda s: US_CENSUS_REGION.get(str(s).strip().title(), "Unmapped"))
                        numc = [c for c in g.columns if pd.api.types.is_numeric_dtype(g[c])]
                        g = g.groupby("census_region", as_index=False)[numc].sum()
                    else:
                        g = sql_group_sums(btable, w, dims)
                    for k in ("link_ctr", "ctr", "cpc", "cpm", "frequency"):
                        fn = CATALOG_FN.get(k)
                        if fn:
                            g[k] = g.apply(lambda r, f=fn: f(r.to_dict()), axis=1)
                    if "spend" in g.columns:
                        g = g.sort_values("spend", ascending=False)
                    st.subheader(f"All cohorts by {label} — {len(g):,} cohorts, no cap")
                    st.dataframe(order_table(g, lead=tuple(key_cols) + IDENT_LEAD), use_container_width=True, height=420)
                    st.download_button("Download cohorts CSV", g.to_csv(index=False).encode(),
                                       "cohorts.csv", "text/csv", key="coh_dl")

                    # ── COHORT DETAIL PAGE ────────────────────────────────────
                    st.markdown("---")
                    st.subheader("Cohort detail — deep exploration")
                    if g.empty:
                        st.info("No cohort rows for this dimension in the current filter scope — "
                                "widen the window or clear the account/marketplace filters.")
                    else:
                        g["_label"] = g[key_cols].astype(str).agg(" · ".join, axis=1)
                        csel = st.selectbox("Open a cohort", g["_label"].tolist())
                        row = g[g["_label"] == csel].iloc[0]
                        selection = {key_cols[i]: row[key_cols[i]] for i in range(len(key_cols))}
                        cw = w
                        if census:
                            states = sorted([s for s, r_ in US_CENSUS_REGION.items() if r_ == row["census_region"]])
                            inlist = ",".join("'" + s.replace("'", "''") + "'" for s in states)
                            cw += f' and "{gcol.upper()}" in ({inlist})'
                            st.caption("Member states: " + ", ".join(states))
                        else:
                            for d in key_cols:
                                qval = str(row[d]).replace("'", "''")
                                cw += f" and \"{d.upper()}\" = '{qval}'"
                        sums = sql_sums(btable, cw)
                        derived = compute_all(sums)
                        k1, k2, k3, k4, k5 = st.columns(5)
                        k1.metric("Spend", money(sums.get("spend")))
                        k2.metric("Impressions", f"{sums.get('impressions', 0):,.0f}")
                        k3.metric("Clicks", f"{sums.get('clicks', 0):,.0f}")
                        k4.metric("Link CTR", pctf(derived.get("link_ctr")))
                        k5.metric("CPM", money(derived.get("cpm")))
                        st.markdown("**Every metric for this cohort (exact SQL totals + derived catalog)**")
                        st.dataframe(metric_sheet(sums, derived), use_container_width=True,
                                     hide_index=True, height=360)
                        if has_column(btable, "date_start") and "spend" in sums:
                            ts = daily_series(btable, cw, "spend")
                            if not ts.empty:
                                st.markdown("**Daily spend trend**")
                                st.altair_chart(
                                    alt.Chart(ts).mark_line(color=GREEN, point=True).encode(
                                        x=alt.X("date_start:T", title=None), y=alt.Y("spend:Q"),
                                        tooltip=["date_start", "spend"]).properties(height=220),
                                    use_container_width=True)
                        if has_column(btable, "campaign_name"):
                            st.markdown("**Campaigns inside this cohort**")
                            st.dataframe(sql_group_sums(btable, cw, "campaign_name"),
                                         use_container_width=True, height=280)
                            c_opts = campaign_options(account, marketplace, since, until)
                            c_pick = st.selectbox("Open a campaign detail page", ["—"] + c_opts, key="coh_open")
                            if c_pick != "—":
                                st.markdown(f"### Campaign detail — {c_pick}")
                                render_campaign_detail(c_pick, "coh")
                        st.subheader("Meta platform conditions for this cohort")
                        ui, spec, tnotes = meta_targeting_conditions(selection)
                        st.markdown("\n".join(f"- {u}" for u in ui) or "—")
                        st.code(json.dumps({"targeting": spec}, indent=2), language="json")
                        for n_ in tnotes:
                            st.caption("⚠ " + n_)
                        st.caption("Numeric geo keys are never invented — resolve any '<lookup …>' "
                                   "via Meta's Targeting Search API before creating the ad set.")
                except Exception as e:  # noqa: BLE001
                    st.warning(f"Cohort build failed on {btable}: {e}")
        elif platform == "TikTok":
            col1, col2 = st.columns(2)
            with col1:
                st.markdown("**Age / gender**")
                ag = generic_rows(TIKTOK["age_gender"])
                dim = next((c for c in ["age", "gender", "age_gender"] if c in ag.columns), None)
                if dim and "spend" in ag.columns:
                    cohort_chart(ag, dim, "Age / gender")
                else:
                    st.dataframe(ag, use_container_width=True, height=360)
            with col2:
                st.markdown("**Country**")
                ct = generic_rows(TIKTOK["country"])
                dim = next((c for c in ["country", "country_code", "country_id"] if c in ct.columns), None)
                if dim and "spend" in ct.columns:
                    cohort_chart(ct, dim, "Country")
                else:
                    st.dataframe(ct, use_container_width=True, height=360)
        else:
            st.info("Google cohort breakdowns depend on the segment tables available; Meta/TikTok carry the richest demographic/geo splits.")

    # ── SINGLE CAMPAIGN — full deep-dive on one campaign ─────────────────────
    if view == "Single entity deep-dive":
        if platform != "Meta":
            st.info("Single-campaign deep-dive runs on the Meta table; Google/TikTok show raw rows in 'Campaign / ad rows'.")
        else:
            etype = st.radio("Entity type", ["Campaign", "Ad Set", "Ad Level"], horizontal=True, key="single_etype")
            ecol = {"Campaign": "campaign_name", "Ad Set": "adset_name", "Ad Level": "ad_name"}[etype]
            opts = campaign_options(account, marketplace, since, until, ecol)
            if not opts:
                st.warning("No entities in scope — widen the window or clear filters.")
            else:
                camp = st.selectbox(f"{etype} (ordered by spend)", opts, key="single_pick")
                render_campaign_detail(camp, "single", ecol)
    # ── MULTI-CAMPAIGN COMPARE — every metric, side by side ──────────────────
    if view == "Comparison Engine":
        st.subheader(f"{platform_label.replace(' Ads', '')} Comparison Engine: {since} – {until}")
        if platform != "Meta":
            st.info("Multi-campaign comparison runs on the Meta table.")
        else:
            opts = campaign_options(account, marketplace, since, until)
            if len(opts) < 2:
                st.warning("Need at least two campaigns in scope to compare.")
            else:
                picks = st.multiselect("Campaigns to compare (2-10, ordered by spend)", opts,
                                       default=opts[: min(3, len(opts))], max_selections=10)
                if len(picks) < 2:
                    st.info("Pick at least two campaigns.")
                else:
                    df = meta_raw(account, marketplace, since, until, tuple(picks), 60000)
                    sheets = {}
                    for c_name in picks:
                        d = df[df["campaign_name"] == c_name] if "campaign_name" in df.columns else pd.DataFrame()
                        if d.empty:
                            continue
                        s = sql_sums(META_SRC, meta_where((c_name,)))
                        drv = compute_all(s)
                        sheets[c_name] = {**s, **{k: v for k, v in drv.items() if v is not None}}
                    if not sheets:
                        st.warning("No rows for the picked campaigns in this window.")
                    else:
                        comp = pd.DataFrame(sheets)
                        comp.index.name = "metric"
                        st.subheader("Side-by-side — every metric × campaign")
                        st.caption("Base sums + the full derived catalog per campaign. Ratio columns are recomputed on sums, never averaged.")
                        _avg = comp.mean(axis=1)
                        _delta = comp.sub(_avg, axis=0).div(_avg.replace(0, pd.NA), axis=0) * 100
                        def _shade(col):
                            out = []
                            for m in comp.index:
                                d = _delta.loc[m, col.name]
                                if pd.isna(d):
                                    out.append("")
                                elif d > 10:
                                    out.append("background-color: rgba(0,116,66,0.30)")
                                elif d < -10:
                                    out.append("background-color: rgba(171,20,20,0.28)")
                                else:
                                    out.append("")
                            return out
                        st.caption("Colour = % delta vs the row average across the selected campaigns: "
                                   "green > +10%, red < -10%. Interpret by metric direction (high CPC red-worthy is green here — the shading is neutral).")
                        try:
                            st.dataframe(comp.round(4).style.apply(_shade, axis=0), use_container_width=True, height=520)
                        except Exception:  # noqa: BLE001 — styler unsupported: plain table, never blank
                            st.dataframe(comp.round(4), use_container_width=True, height=520)
                        mkeys = [k for k in comp.index if comp.loc[k].notna().any()]
                        sel = st.selectbox("Chart metric", mkeys,
                                           index=mkeys.index("spend") if "spend" in mkeys else 0)
                        bar = comp.loc[sel].reset_index()
                        bar.columns = ["campaign", sel]
                        st.altair_chart(
                            alt.Chart(bar).mark_bar(color=GOLD).encode(
                                x=alt.X(f"{sel}:Q", title=sel),
                                y=alt.Y("campaign:N", sort="-x", title=None),
                                tooltip=["campaign", sel]).properties(height=max(140, 34 * len(bar))),
                            use_container_width=True)
                        num_daily = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c not in RATIO_COLS]
                        sel2 = st.selectbox("Daily overlay metric", num_daily,
                                            index=num_daily.index("spend") if "spend" in num_daily else 0)
                        g = daily_series(META_SRC, meta_where(tuple(picks)), sel2, by="campaign_name")
                        st.altair_chart(
                            alt.Chart(g).mark_line(point=True).encode(
                                x=alt.X("date_start:T", title=None), y=alt.Y(f"{sel2}:Q", title=sel2),
                                color=alt.Color("campaign_name:N", title=None),
                                tooltip=["date_start", "campaign_name", sel2]).properties(height=300),
                            use_container_width=True)

                        all_campaigns_block("mc")

    # ── AD EXPLORER — every field the table carries, upfront ─────────────────
    if view == "Ad explorer (all fields)":
        if platform != "Meta":
            table = GOOGLE_ADS if platform == "Google" else tiktok_table(level)
            st.info(f"{platform}: raw rows with whatever columns exist in `{table}`.")
            wg = generic_where(table)
            total_g = count_rows(table, wg)
            if total_g:
                size_g, off_g = pager(total_g, "expl_g")
                _dcg = table_date_col(table)
                _obg = f' order by "{_dcg.upper()}" desc' if _dcg else ""
                try:
                    st.dataframe(order_table(q(f"select * from {table} {wg}{_obg} limit {size_g} offset {off_g}")),
                                 use_container_width=True, height=520)
                except Exception as e:  # noqa: BLE001
                    st.info(f"Could not read {table}: {e}")
            else:
                st.info("No readable rows for this account / date scope.")
        else:
            cols = table_columns(META_SRC)
            groups = classify_columns(cols)
            _srcs = " + ".join(f"`{t}`" for t, _ in meta_source_tables())
            st.caption(f"Sources: {_srcs} — {len(cols)} columns available, all shown. "
                       "Field map derived live from the table schema; nothing hidden, nothing invented.")
            with st.expander("Field map — every column by analysis role", expanded=True):
                for gname, glist in [("Identity & configuration", groups["identity_config"]),
                                     ("Audience & targeting", groups["audience_targeting"]),
                                     ("Time", groups["time"]),
                                     ("Metrics", groups["metrics"]),
                                     ("Other", groups["other"])]:
                    st.markdown(f"**{gname} ({len(glist)})**: " + (", ".join(f"`{c}`" for c in glist) or "—"))
            total = count_rows(META_SRC, meta_where())
            if not total:
                st.warning("No rows in scope.")
            else:
                size, off = pager(total, "expl", default_size=1000)
                df = meta_raw(account, marketplace, since, until, None, size, off)
                st.dataframe(spec_frame(df), use_container_width=True, height=520,
                             hide_index=True, column_config=spec_colcfg())
                st.download_button("Download this page as CSV (all fields)",
                                   df.to_csv(index=False).encode(), "meta_ads_all_fields.csv", "text/csv")

                all_campaigns_block("ex")

    # ── SPEND TRACKER — the Ad_Spends workbook (May-Jul, Meta/TikTok), live ───
    if view == "Spend tracker":
        st.subheader("Monthly spend — channel × marketplace (live)")
        st.caption(
            "Replicates the Ad-Spends tracker: total spend per month split by "
            "marketplace (derived from ad names), computed in SQL over ALL rows "
            "in scope — always current, never keyed by hand."
        )
        try:
            g = q(f"select to_char(date_start, 'YYYY-MM') as month, {mkt_case()} as marketplace, "
                  f"sum(spend) as spend from {META_SRC} {meta_where()} group by 1, 2 order by 1")
        except Exception as e:  # noqa: BLE001
            g = pd.DataFrame()
            st.warning(f"Spend matrix unavailable: {e}")
        if not g.empty:
            piv = g.pivot_table(index="marketplace", columns="month", values="spend", aggfunc="sum")
            piv["TOTAL"] = piv.sum(axis=1)
            # Default sort: descending — biggest marketplace first, latest month first.
            piv = piv.sort_values("TOTAL", ascending=False)
            piv = piv[["TOTAL"] + sorted([c for c in piv.columns if c != "TOTAL"], reverse=True)]
            st.markdown("**Meta Ads (USD)**")
            st.dataframe(piv.round(2), use_container_width=True)
            st.altair_chart(
                alt.Chart(g).mark_bar().encode(
                    x=alt.X("month:N", title=None),
                    y=alt.Y("spend:Q", title="Spend (USD)"),
                    color=alt.Color("marketplace:N", title=None),
                    tooltip=["month", "marketplace", alt.Tooltip("spend:Q", format="$,.0f")],
                ).properties(height=280), use_container_width=True)
        st.markdown("**TikTok Ads**")
        tt = TIKTOK["ad"]
        tt_cols = [c for c, _ in table_columns(tt)]
        tt_date = next((c for c in ("stat_time_day", "date", "stat_date", "date_start") if c in tt_cols), None)
        tt_spend = next((c for c in ("spend", "cost", "total_cost") if c in tt_cols), None)
        if tt_date and tt_spend:
            try:
                tg = q(f'select to_char("{tt_date.upper()}", \'YYYY-MM\') as month, '
                       f'sum("{tt_spend.upper()}") as spend from {tt} group by 1 order by 1 desc')
                st.dataframe(tg, use_container_width=True, hide_index=True)
            except Exception as e:  # noqa: BLE001
                st.info(f"TikTok monthly spend unavailable: {e}")
        else:
            st.info(f"`{tt}` carries no recognised date/spend columns for a monthly roll-up — see Ad explorer for its raw fields.")

        st.subheader("Day-wise campaign matrix (Retail Ads Update, live)")
        st.caption("Dates as columns per campaign — the day-wise tracker, from the warehouse.")
        opts_s = campaign_options(account, marketplace, since, until)
        picks_s = st.multiselect("Campaigns", opts_s, default=opts_s[: min(3, len(opts_s))], key="spend_camps")
        metric_s = st.selectbox("Metric", ["spend", "impressions", "reach", "clicks", "inline_link_clicks"], key="spend_metric")
        if picks_s:
            try:
                dm = daily_series(META_SRC, meta_where(tuple(picks_s)), metric_s, by="campaign_name")
                if not dm.empty:
                    dm["date_start"] = dm["date_start"].astype(str)
                    mpiv = dm.pivot_table(index="campaign_name", columns="date_start", values=metric_s, aggfunc="sum")
                    # Default sort: descending — biggest campaign first, latest day first.
                    mpiv = mpiv.loc[mpiv.sum(axis=1).sort_values(ascending=False).index]
                    mpiv = mpiv[sorted(mpiv.columns, reverse=True)]
                    st.dataframe(mpiv.round(2), use_container_width=True, height=300)
                else:
                    st.info("No rows for those campaigns in the window.")
            except Exception as e:  # noqa: BLE001
                st.warning(f"Day-wise matrix unavailable: {e}")

    # ── UGC CREATOR ADS — the UGC Master workbook's PAID side, live ──────────
    if view == "UGC creator ads":
        st.subheader("UGC creator ads — paid performance per creator (live)")
        st.caption(
            "Replicates the UGC Master ad-performance sheets: every ad whose name "
            "carries 'UGC', with the creator parsed from the ad name, spend, "
            "impressions, clicks, CTR and CPC — straight from the warehouse."
        )
        wu = meta_where() + " and ad_name ilike '%ugc%'"
        du = sql_group_sums(META_SRC, wu, ident_cols("ad"))
        if du.empty:
            st.info("No ads carrying 'UGC' in the name for this scope — widen the window or clear filters.")
        else:
            du["creator"] = du["ad_name"].astype(str).str.split("-").str[-1].str.strip()
            for k in ("link_ctr", "ctr", "cpc", "cpm"):
                fn = CATALOG_FN.get(k)
                if fn:
                    du[k] = du.apply(lambda r, f=fn: f(r.to_dict()), axis=1)
            tot_spend = du["spend"].sum() if "spend" in du.columns else None
            tot_impr = du["impressions"].sum() if "impressions" in du.columns else 0
            tot_clicks = du["inline_link_clicks"].sum() if "inline_link_clicks" in du.columns else 0
            k1, k2, k3, k4, k5 = st.columns(5)
            k1.metric("UGC ads", f"{len(du):,}")
            k2.metric("Creators", f"{du['creator'].nunique():,}")
            k3.metric("Spend", money(tot_spend))
            k4.metric("Link clicks", f"{tot_clicks:,.0f}")
            k5.metric("Link CTR", pctf(tot_clicks / tot_impr * 100 if tot_impr else None))
            st.markdown("**Per creator (aggregated across their ads)**")
            numu = [c for c in du.columns if pd.api.types.is_numeric_dtype(du[c]) and c not in RATIO_COLS]
            pc = du.groupby("creator", as_index=False)[numu].sum()
            for k in ("link_ctr", "ctr", "cpc", "cpm"):
                fn = CATALOG_FN.get(k)
                if fn:
                    pc[k] = pc.apply(lambda r, f=fn: f(r.to_dict()), axis=1)
            if "spend" in pc.columns:
                pc = pc.sort_values("spend", ascending=False)
            st.dataframe(order_table(pc), use_container_width=True, height=360)
            st.markdown("**Per ad (every UGC ad as a row)**")
            st.dataframe(order_table(du.sort_values("spend", ascending=False) if "spend" in du.columns else du),
                         use_container_width=True, height=360)
            st.download_button("Download UGC ads CSV", du.to_csv(index=False).encode(),
                               "ugc_creator_ads.csv", "text/csv", key="ugc_dl")
        st.markdown("---")
        st.subheader("Organic side (views, likes, 6-sec %, content buckets, organic score)")
        st.caption(
            "Organic TikTok/Instagram metrics live in the UGC Master tracker, not in "
            "the ads warehouse. Load the tracker sheets as tables to analyse the full "
            "organic-to-paid loop here; until then this is a declared gap, not a zero."
        )
        table_explorer("ugc_org", ["ugc", "creator", "organic", "instagram", "tiktok_organic"],
                       "Load the UGC Master tracker (Master UGC Tracker / Metric Summary sheets) into the warehouse to light this up.")

        st.markdown("---")
        st.subheader("UGC scoring engine")
        st.caption(
            "TikTok Score = 6-sec%×40% + Shares×25% + (Likes+Comments)×20% + Views×15% · "
            "Instagram Score = Likes×35% + Views×40% + Comments×15% + ER×10%. Components are "
            "min-max normalised to 0-100 per platform before weighting — computed live over "
            "the loaded tracker table."
        )
        UGC_T = "VAHDAM_DB.TRACKERS.UGC_MASTER_TRACKER"
        if not table_columns(UGC_T):
            st.info("Scoring activates once the UGC Master tracker is loaded "
                    "(run trackers/load_trackers.sql, upload the CSVs to the stage).")
        else:
            try:
                ud = q(f"select * from {UGC_T}")
            except Exception as e:  # noqa: BLE001
                ud = pd.DataFrame()
                st.info(f"Tracker unreadable for this role: {e}")
            if not ud.empty:
                def _pick(*hints):
                    return next((c for c in ud.columns if any(h in c for h in hints)), None)
                plat_c = _pick("platform")
                comp_c = {"views": _pick("current_views", "views"), "likes": _pick("likes"),
                          "shares": _pick("shares"), "comments": _pick("comments"),
                          "six": _pick("6_sec", "six_sec", "sec_view", "hook"),
                          "er": _pick("er_", "engagement", "er")}
                stored_c = _pick("organic_score")
                for c in {v for v in comp_c.values() if v} | ({stored_c} if stored_c else set()):
                    ud[c] = pd.to_numeric(ud[c], errors="coerce")

                def _norm(s):
                    s = s.fillna(0.0)
                    rng = s.max() - s.min()
                    return (s - s.min()) / rng * 100 if rng else s * 0

                have = {k: v for k, v in comp_c.items() if v}
                rank_col = None
                if plat_c and {"views", "likes"}.issubset(have):
                    parts = []
                    for p, gdf in ud.groupby(ud[plat_c].astype(str).str.lower()):
                        g2 = gdf.copy()
                        nn = {k: _norm(g2[c]) for k, c in have.items()}
                        zero = pd.Series(0.0, index=g2.index)
                        if str(p).startswith("tiktok"):
                            score = (nn.get("six", zero) * .40 + nn.get("shares", zero) * .25
                                     + (nn.get("likes", zero) + nn.get("comments", zero)) / 2 * .20
                                     + nn.get("views", zero) * .15)
                        else:
                            score = (nn.get("likes", zero) * .35 + nn.get("views", zero) * .40
                                     + nn.get("comments", zero) * .15 + nn.get("er", zero) * .10)
                        g2["computed_score"] = score.round(1)
                        parts.append(g2)
                    ud = pd.concat(parts)
                    rank_col = "computed_score"
                    st.caption("Scores computed live from the tracker's component columns.")
                elif stored_c:
                    rank_col = stored_c
                    st.caption("Component columns incomplete — ranking by the tracker's STORED "
                               "organic score (no recomputation, nothing invented).")
                else:
                    st.info("Neither score components nor a stored organic-score column found in the tracker.")
                if rank_col:
                    show = ud.sort_values(rank_col, ascending=False)
                    st.dataframe(show.head(200), use_container_width=True, height=420)
                    st.download_button("Download scored UGC CSV", show.to_csv(index=False).encode(),
                                       "ugc_scored.csv", "text/csv", key="ugc_score_dl")

    # ── UGC COMMAND CENTER — native rebuild of the JB UGC tracker dashboard
    # (vahdam-june-usa-ugc-dashboard.netlify.app). The METHODOLOGY (weights,
    # log-normalisation, view-confidence multipliers, ad-rec thresholds, score
    # benchmarks) is mirrored exactly; every FIGURE is computed live from the
    # loaded tracker tables — a sheet that is not loaded shows a declared gap.
    if view == "UGC command center":
        st.subheader("UGC command center — JB UGC tracker, native")
        st.caption(
            "Organic scoring, ad recommendations and the hook bible from the UGC "
            "tracker, recomputed live over VAHDAM_DB.TRACKERS tables. Methodology "
            "mirrors the JB dashboard exactly; nothing is estimated."
        )
        TT_W = [("6-sec view %", "40%", "Strongest signal - hook worked, TikTok rewards this"),
                ("Shares", "25%", "Viral intent - highest organic endorsement"),
                ("Likes + Comments", "20%", "Active engagement, comments = real reaction"),
                ("Views", "15%", "Reach matters but views alone are not resonance")]
        IG_W = [("Views", "40%", "Reach = algorithm distributing"),
                ("Likes", "35%", "Primary IG engagement signal"),
                ("Comments", "15%", "Rarer but strong - real emotional response")]
        TT_CONF = [(0, 50, 0.45, "unreliable data"), (50, 200, 0.70, "caution applied"),
                   (200, 500, 0.85, "reasonable, minor discount"), (500, None, 1.00, "full confidence")]
        IG_CONF = [(0, 100, 0.50, "unreliable data"), (100, 500, 0.75, "caution applied"),
                   (500, None, 1.00, "full confidence")]
        BENCH = [("70-100", "Elite", "Top-tier organic. Strong hook, high retention, real engagement. First to boost."),
                 ("50-69", "High", "Very good creative with solid hold/engagement. Boost with confidence."),
                 ("30-49", "Good", "Meets Ad Recommended threshold. Worth testing with budget."),
                 ("20-29", "Consider", "Some signal. Test with small spend first."),
                 ("0-19", "Not ready", "Don't boost - fix the creative first.")]

        def _conf_mult(v, table):
            for lo, hi, m, _ in table:
                if v >= lo and (hi is None or v < hi):
                    return m
            return 1.0

        def _tier(s):
            return ("Elite" if s >= 70 else "High" if s >= 50 else "Good" if s >= 30
                    else "Consider" if s >= 20 else "Not ready")

        UGC_T = "VAHDAM_DB.TRACKERS.UGC_MASTER_TRACKER"
        jb = pd.DataFrame()
        if table_columns(UGC_T):
            try:
                jb = q(f"select * from {UGC_T}")
            except Exception as e:  # noqa: BLE001
                st.info(f"Tracker unreadable for this role: {e}")

        cmap, scored = {}, pd.DataFrame()
        if not jb.empty:
            def _pk(*hints):
                return next((c for c in jb.columns if any(h in c for h in hints)), None)
            cmap = {"platform": _pk("platform"), "creator": _pk("creator", "handle", "username", "account"),
                    "bucket": _pk("bucket", "category", "content_type"),
                    "views": _pk("current_views", "views"), "views0": _pk("original_views", "baseline"),
                    "likes": _pk("likes"), "comments": _pk("comments"), "shares": _pk("shares"),
                    "six": _pk("6_sec", "six_sec", "sec_view"), "er": _pk("er_", "engagement"),
                    "hook": _pk("hook_type", "hook"), "script": _pk("script", "caption", "hook_line"),
                    "spend": _pk("spend"), "impressions": _pk("impressions"), "clicks": _pk("clicks"),
                    "ctr": _pk("ctr"), "cpc": _pk("cpc"), "spark": _pk("spark"),
                    "status": _pk("activation", "activated", "status"), "logic": _pk("logic")}
            for k in ("views", "views0", "likes", "comments", "shares", "six", "er",
                      "spend", "impressions", "clicks", "ctr", "cpc"):
                if cmap.get(k):
                    jb[cmap[k]] = pd.to_numeric(jb[cmap[k]], errors="coerce")
            if cmap["platform"] and cmap["views"] and cmap["likes"]:
                def _ln(series):
                    x = series.fillna(0).clip(lower=0)
                    ln = (x + 1.0).map(math.log)
                    mx = ln.max()
                    return ln / mx if mx else ln * 0
                parts = []
                for pname, g0 in jb.groupby(jb[cmap["platform"]].astype(str).str.lower().str.strip()):
                    g2 = g0.copy()
                    def C(key):
                        c = cmap.get(key)
                        return g2[c].fillna(0) if c else pd.Series(0.0, index=g2.index)
                    vraw = C("views")
                    if str(pname).startswith("tiktok"):
                        base = (_ln(C("six")) * .40 + _ln(C("shares")) * .25
                                + _ln(C("likes") + C("comments")) * .20 + _ln(C("views")) * .15)
                        conf = vraw.map(lambda v: _conf_mult(v, TT_CONF))
                    else:
                        # IG weights per the JB spec sum to 90% - rescaled to a
                        # 0-100 ceiling; the rescale is stated, not hidden.
                        base = (_ln(C("views")) * .40 + _ln(C("likes")) * .35
                                + _ln(C("comments")) * .15) / 0.90
                        conf = vraw.map(lambda v: _conf_mult(v, IG_CONF))
                    g2["score"] = (base * 100 * conf).round(1)
                    g2["_six"] = C("six")
                    g2["_er"] = C("er")
                    g2["_lv"] = (C("likes") / vraw.replace(0, pd.NA) * 100).fillna(0)
                    g2["_plat"] = str(pname)
                    parts.append(g2)
                scored = pd.concat(parts)

                def _rec(r):
                    if r["_plat"].startswith("tiktok"):
                        if r["_six"] >= 25 or r["score"] >= 30:
                            return "Ad Recommended"
                        if r["score"] >= 20 or r["_six"] >= 18 or r["_er"] >= 8:
                            return "Consider"
                        return "No"
                    if r["score"] >= 20:
                        return "Ad Recommended"
                    if r["score"] >= 13 or r["_lv"] >= 5:
                        return "Consider"
                    return "No"
                scored["ad_rec"] = scored.apply(_rec, axis=1)
                scored["tier"] = scored["score"].map(_tier)

        (t_ov, t_logic, t_views, t_tt, t_ig, t_all, t_adperf, t_bible) = st.tabs(
            ["Overview", "Scoring & Logic", "View Summary", "TikTok Top 25",
             "Instagram Top 25", "All Creators", "Ad Performance", "Hook & Script Bible"])
        _GAP = ("Load the UGC tracker sheets into VAHDAM_DB.TRACKERS "
                "(trackers/load_trackers.sql + stage upload) to light this up - declared gap, nothing estimated.")

        with t_ov:
            if scored.empty:
                st.info(_GAP)
            else:
                plat = scored["_plat"].str.split().str[0]
                k1, k2, k3, k4 = st.columns(4)
                k1.metric("Videos tracked", f"{len(scored):,}")
                k2.metric("Platforms", ", ".join(f"{p} {n}" for p, n in plat.value_counts().items()))
                k3.metric("Ad Recommended", f"{(scored['ad_rec'] == 'Ad Recommended').sum():,}")
                k4.metric("Tracker ad spend",
                          money(scored[cmap["spend"]].sum()) if cmap.get("spend") else "in Ad Performance tab")
                if cmap.get("creator"):
                    st.markdown("**Top creator per platform (by organic score)**")
                    tops = scored.loc[scored.groupby("_plat")["score"].idxmax()]
                    st.dataframe(tops[[cmap["creator"], "_plat", "score", "tier", "ad_rec"]]
                                 .rename(columns={cmap["creator"]: "creator", "_plat": "platform"}),
                                 use_container_width=True, hide_index=True)
                st.markdown("**Score distribution by benchmark tier**")
                dist = scored.groupby(["tier", "_plat"]).size().reset_index(name="videos")
                st.altair_chart(
                    alt.Chart(dist).mark_bar().encode(
                        x=alt.X("videos:Q"), y=alt.Y("tier:N", sort=[b[1] for b in BENCH]),
                        color=alt.Color("_plat:N", title=None), tooltip=["tier", "_plat", "videos"],
                    ).properties(height=220), use_container_width=True)

        with t_logic:
            st.markdown("**TikTok organic score (0-100)** - log-normalised inputs, then weighted:")
            st.dataframe(pd.DataFrame(TT_W, columns=["Component", "Weight", "Why this weight"]),
                         use_container_width=True, hide_index=True)
            st.dataframe(pd.DataFrame([(f"{lo}-{hi - 1}" if hi else f"{lo}+", f"x {m:.2f}", why)
                                       for lo, hi, m, why in TT_CONF],
                                      columns=["Views", "Multiplier", "Meaning"]),
                         use_container_width=True, hide_index=True)
            st.markdown("**Instagram organic score (0-100)**")
            st.dataframe(pd.DataFrame(IG_W, columns=["Component", "Weight", "Why this weight"]),
                         use_container_width=True, hide_index=True)
            st.dataframe(pd.DataFrame([(f"{lo}-{hi - 1}" if hi else f"{lo}+", f"x {m:.2f}", why)
                                       for lo, hi, m, why in IG_CONF],
                                      columns=["Views", "Multiplier", "Meaning"]),
                         use_container_width=True, hide_index=True)
            st.markdown("**Ad recommendation thresholds**")
            st.dataframe(pd.DataFrame([
                ("TikTok", "Ad Recommended", "Score >= 30 OR 6-sec >= 25%", "Strong organic proof - safe to amplify"),
                ("TikTok", "Consider", "Score >= 20 OR 6-sec >= 18% OR ER >= 8%", "Some signal - test with small budget"),
                ("TikTok", "No", "Below all thresholds", "Insufficient organic data"),
                ("Instagram", "Ad Recommended", "Score >= 20", "Good IG organic performance"),
                ("Instagram", "Consider", "Score >= 13 OR Likes/Views >= 5%", "Emerging signal - worth a small test"),
                ("Instagram", "No", "Below all thresholds", "Not enough proof yet"),
            ], columns=["Platform", "Label", "Condition", "Meaning"]),
                use_container_width=True, hide_index=True)
            st.caption("6-sec auto-qualify: >= 25% 6-sec = Ad Recommended regardless of score - "
                       "hook beats TikTok's skip behaviour.")
            st.markdown("**Score benchmarks**")
            st.dataframe(pd.DataFrame(BENCH, columns=["Score", "Label", "What it means"]),
                         use_container_width=True, hide_index=True)

        with t_views:
            if scored.empty or not cmap.get("views"):
                st.info(_GAP)
            else:
                agg = scored.groupby("_plat").agg(
                    videos=(cmap["views"], "size"), total_views=(cmap["views"], "sum"),
                    avg_views=(cmap["views"], "mean"),
                    total_likes=(cmap["likes"], "sum") if cmap.get("likes") else (cmap["views"], "size"),
                ).reset_index().rename(columns={"_plat": "platform"})
                st.dataframe(agg.round(0), use_container_width=True, hide_index=True)
                if cmap.get("views0"):
                    b0, b1 = scored[cmap["views0"]].sum(), scored[cmap["views"]].sum()
                    st.caption(f"Baseline organic views {b0:,.0f} -> current {b1:,.0f} "
                               "(growth includes paid amplification).")

        def _top25(prefix, tab, cols_wanted):
            with tab:
                if scored.empty:
                    st.info(_GAP)
                    return
                sub = scored[scored["_plat"].str.startswith(prefix)]
                if sub.empty:
                    st.info(f"No {prefix} rows in the tracker.")
                    return
                keep = [c for c in cols_wanted if c and c in sub.columns]
                st.dataframe(sub.sort_values("score", ascending=False).head(25)[keep],
                             use_container_width=True, hide_index=True, height=560)

        _top25("tiktok", t_tt, [cmap.get("creator"), cmap.get("bucket"), "score", "tier",
                                cmap.get("six"), cmap.get("views"), cmap.get("likes"),
                                cmap.get("hook"), "ad_rec"])
        _top25("instagram", t_ig, [cmap.get("creator"), cmap.get("bucket"), "score", "tier",
                                   cmap.get("views"), cmap.get("likes"), cmap.get("comments"),
                                   cmap.get("hook"), "ad_rec"])

        with t_all:
            if scored.empty:
                st.info(_GAP)
            else:
                f1, f2 = st.columns(2)
                pf = f1.multiselect("Platform", sorted(scored["_plat"].unique()), key="ucc_pf")
                rf = f2.multiselect("Ad recommendation", ["Ad Recommended", "Consider", "No"], key="ucc_rf")
                sub = scored
                if pf:
                    sub = sub[sub["_plat"].isin(pf)]
                if rf:
                    sub = sub[sub["ad_rec"].isin(rf)]
                lead = [c for c in (cmap.get("creator"), "_plat", cmap.get("bucket"), "score",
                                    "tier", "ad_rec", cmap.get("status"), cmap.get("logic"),
                                    cmap.get("spend"), cmap.get("impressions"), cmap.get("ctr"),
                                    cmap.get("clicks"), cmap.get("cpc"), cmap.get("spark")) if c]
                rest = [c for c in sub.columns if c not in lead and not c.startswith("_")]
                st.dataframe(sub.sort_values("score", ascending=False)[lead + rest],
                             use_container_width=True, hide_index=True, height=520)
                st.download_button("Download all creators CSV", sub.to_csv(index=False).encode(),
                                   "ugc_all_creators.csv", "text/csv", key="ucc_dl")

        with t_adperf:
            st.caption("Paid results per platform - tracker ad-performance sheets when loaded, "
                       "plus the live warehouse roll-up of every ad named 'UGC'.")
            for label, tbl in (("TikTok", "VAHDAM_DB.TRACKERS.UGC_TIKTOK_AD_PERFORMANCE"),
                               ("Instagram", "VAHDAM_DB.TRACKERS.UGC_INSTAGRAM_AD_PERFORMANCE")):
                st.markdown(f"**{label} (tracker)**")
                if not table_columns(tbl):
                    st.info(f"{label} ad-performance sheet not loaded. " + _GAP)
                    continue
                try:
                    ap = q(f"select * from {tbl}")
                    st.dataframe(order_table(ap), use_container_width=True, height=300)
                except Exception as e:  # noqa: BLE001
                    st.info(f"{label} sheet unreadable: {e}")
            st.caption("Per the JB tracker's Meta note: with multiple ads in one ad set, Meta "
                       "forces spend allocation - judge winners on validated per-ad results, "
                       "not ad-set averages.")
            st.markdown("**Live warehouse UGC ads (Meta union, current filters)**")
            wu2 = meta_where() + " and ad_name ilike '%ugc%'"
            du2 = sql_group_sums(META_SRC, wu2, ident_cols("ad"))
            if du2.empty:
                st.info("No ads carrying 'UGC' in the name for this scope.")
            else:
                st.dataframe(spec_frame(du2), use_container_width=True, height=300,
                             hide_index=True, column_config=spec_colcfg())

        with t_bible:
            st.caption("Hooks and scripts extracted from the HIGHEST-SCORING videos per content "
                       "bucket - real lines from the tracker, never invented copy.")
            if scored.empty or not (cmap.get("hook") or cmap.get("script")):
                st.info("Needs the tracker's hook/script columns. " + _GAP)
            else:
                bucket_c = cmap.get("bucket")
                cols_b = [c for c in (bucket_c, cmap.get("creator"), "_plat", "score",
                                      cmap.get("hook"), cmap.get("script")) if c]
                top_b = (scored.sort_values("score", ascending=False)
                         .groupby(bucket_c).head(3) if bucket_c
                         else scored.sort_values("score", ascending=False).head(15))
                st.dataframe(top_b[cols_b], use_container_width=True, hide_index=True, height=520)


# ═════════════════════════════════════════════════════════════════════════════
# WAREHOUSE DISCOVERY — keyword search over INFORMATION_SCHEMA. Zero
# fabrication: panels are built ONLY from tables that actually exist in the
# warehouse; a source whose data is not loaded into Snowflake shows a declared
# gap, never an estimated number.
# ═════════════════════════════════════════════════════════════════════════════
SEARCH_DBS = ["VAHDAM_DB", "DATON"]


@st.cache_data(ttl=600, show_spinner=False)
def discover_tables(terms):
    """Search INFORMATION_SCHEMA across the known databases for tables whose
    name matches any keyword. Returns fqn/rows/columns — real tables only."""
    frames = []
    like = " or ".join([f"table_name ilike '%{t.strip().upper()}%'" for t in terms if t.strip()])
    if not like:
        return pd.DataFrame()
    for db in SEARCH_DBS:
        try:
            frames.append(q(
                f"select table_catalog || '.' || table_schema || '.' || table_name as fqn, "
                f"row_count, bytes from {db}.information_schema.tables "
                f"where table_type = 'BASE TABLE' and ({like}) "
                f"order by row_count desc nulls last limit 40"
            ))
        except Exception:  # noqa: BLE001 — db absent/no grant: skip, never invent
            continue
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def table_explorer(key, default_terms, gap_note):
    """Keyword search -> pick a real table -> preview + optional time-series
    chart when a date column and a numeric measure are present."""
    terms = st.text_input("Search warehouse tables (comma-separated keywords)",
                          ", ".join(default_terms), key=key + "_terms")
    found = discover_tables(terms.split(","))
    if found.empty:
        st.info("No warehouse table matches these keywords. " + gap_note)
        return
    st.dataframe(found, use_container_width=True, hide_index=True, height=200)
    pick = st.selectbox("Table to analyse", ["—"] + found["fqn"].tolist(), key=key + "_pick")
    if pick == "—":
        return
    try:
        _dc = table_date_col(pick)
        _ob = f' order by "{_dc.upper()}" desc' if _dc else ""
        df = q(f"select * from {pick}{_ob} limit 1000")
    except Exception as e:  # noqa: BLE001
        st.warning(f"Could not read {pick}: {e}")
        return
    if df.empty:
        st.info("Table is readable but returned no rows.")
        return
    st.caption(f"{pick} · showing up to 1,000 rows · read-only")
    st.dataframe(order_table(df).head(300), use_container_width=True, height=340)
    date_cols = [c for c in df.columns if any(k in c for k in ("date", "day", "month", "created", "time"))]
    num_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    if date_cols and num_cols:
        c1, c2 = st.columns(2)
        dcol = c1.selectbox("Date column", date_cols, key=key + "_d")
        mcol = c2.selectbox("Measure (sum)", num_cols, key=key + "_m")
        try:
            g = df.copy()
            g[dcol] = pd.to_datetime(g[dcol], errors="coerce")
            g = g.dropna(subset=[dcol]).groupby(pd.Grouper(key=dcol, freq="W"))[mcol].sum().reset_index()
            if not g.empty:
                st.altair_chart(
                    alt.Chart(g).mark_line(color=GREEN, point=True).encode(
                        x=alt.X(f"{dcol}:T", title=None),
                        y=alt.Y(f"{mcol}:Q", title=mcol),
                        tooltip=[dcol, mcol],
                    ).properties(height=260),
                    use_container_width=True,
                )
        except Exception:  # noqa: BLE001 — chart is best-effort; the table above is the data
            pass


# ── INSIGHTS ENGINE — deterministic, evidence-quoting insights computed live
# from the warehouse (never invented; every claim quotes the exact figures it
# was computed from). Honors the current top-bar filter scope.
def generated_insights():
    w = meta_where()
    tot = sql_sums(META_SRC, w)
    drv = compute_all(tot)
    out = []
    if not tot.get("spend"):
        return out
    camps = sql_group_sums(META_SRC, w, ["campaign_name"])
    for k in ("link_ctr", "cpc", "cpm", "frequency"):
        fn = CATALOG_FN.get(k)
        if fn and not camps.empty:
            camps[k] = camps.apply(lambda r, f=fn: f(r.to_dict()), axis=1)

    # 1) Spend concentration
    if not camps.empty and "spend" in camps.columns:
        top3 = camps.nlargest(3, "spend")
        share = top3["spend"].sum() / tot["spend"] * 100
        out.append({
            "Type": "Spend concentration",
            "Insight": f"Top 3 campaigns hold {share:.1f}% of the {money(tot['spend'])} "
                       f"spent in this window ({len(camps):,} campaigns in scope).",
            "Evidence": " · ".join(f"{r['campaign_name']}: {money(r['spend'])}"
                                   for _, r in top3.iterrows()),
        })

    # 2) Link-CTR outliers (only campaigns with spend >= $50, threshold stated)
    if not camps.empty and {"link_ctr", "spend"}.issubset(camps.columns):
        scored = camps[(camps["spend"] >= 50) & camps["link_ctr"].notna()]
        avg_ctr = drv.get("link_ctr")
        if len(scored) >= 2 and avg_ctr:
            best, worst = scored.loc[scored["link_ctr"].idxmax()], scored.loc[scored["link_ctr"].idxmin()]
            out.append({
                "Type": "Creative winner",
                "Insight": f"'{best['campaign_name']}' leads on link CTR at {best['link_ctr']:.2f}% "
                           f"vs the portfolio's {avg_ctr:.2f}% "
                           f"({(best['link_ctr'] / avg_ctr - 1) * 100:+.0f}% vs average).",
                "Evidence": f"Spend {money(best['spend'])} · {best.get('inline_link_clicks', 0):,.0f} link clicks "
                            f"on {best.get('impressions', 0):,.0f} impressions (min-spend gate $50).",
            })
            out.append({
                "Type": "Creative laggard",
                "Insight": f"'{worst['campaign_name']}' trails on link CTR at {worst['link_ctr']:.2f}% "
                           f"vs the portfolio's {avg_ctr:.2f}%.",
                "Evidence": f"Spend {money(worst['spend'])} · {worst.get('inline_link_clicks', 0):,.0f} link clicks "
                            f"on {worst.get('impressions', 0):,.0f} impressions (min-spend gate $50).",
            })

    # 3) CPC efficiency spread
    if not camps.empty and {"cpc", "spend"}.issubset(camps.columns):
        sc = camps[(camps["spend"] >= 50) & camps["cpc"].notna()]
        if len(sc) >= 2 and drv.get("cpc"):
            hi = sc.loc[sc["cpc"].idxmax()]
            if hi["cpc"] > drv["cpc"] * 1.25:
                out.append({
                    "Type": "Cost outlier",
                    "Insight": f"'{hi['campaign_name']}' pays {money(hi['cpc'])} per link click, "
                               f"{(hi['cpc'] / drv['cpc'] - 1) * 100:+.0f}% above the portfolio's {money(drv['cpc'])}.",
                    "Evidence": f"Spend {money(hi['spend'])} · {hi.get('inline_link_clicks', 0):,.0f} link clicks.",
                })

    # 4) Frequency fatigue
    if drv.get("frequency") and drv["frequency"] > 3:
        out.append({
            "Type": "Fatigue risk",
            "Insight": f"Portfolio frequency is {drv['frequency']:.2f} - each person saw the ads "
                       f"more than 3x in this window; watch for creative fatigue.",
            "Evidence": f"{tot.get('impressions', 0):,.0f} impressions over {tot.get('reach', 0):,.0f} reached.",
        })

    # 5) Week-over-week momentum (last 7 days vs the 7 before, inside the scope)
    try:
        wow = q(f"select case when \"DATE_START\" > dateadd(day, -7, '{until}') then 'recent' "
                f"else 'prior' end as half, sum(spend) as spend, sum(impressions) as impressions, "
                f"sum(inline_link_clicks) as clicks from {META_SRC} {w} "
                f"and \"DATE_START\" > dateadd(day, -14, '{until}') group by 1")
        if len(wow) == 2:
            r_ = wow.set_index("half")
            sp_r, sp_p = float(r_.loc["recent", "spend"] or 0), float(r_.loc["prior", "spend"] or 0)
            if sp_p > 0:
                ctr_r = (float(r_.loc['recent', 'clicks'] or 0) / float(r_.loc['recent', 'impressions'] or 1)) * 100
                ctr_p = (float(r_.loc['prior', 'clicks'] or 0) / float(r_.loc['prior', 'impressions'] or 1)) * 100
                out.append({
                    "Type": "Momentum (WoW)",
                    "Insight": f"Spend moved {(sp_r / sp_p - 1) * 100:+.1f}% week over week "
                               f"({money(sp_p)} -> {money(sp_r)}); link CTR {ctr_p:.2f}% -> {ctr_r:.2f}%.",
                    "Evidence": f"Last 7 days ending {until} vs the 7 days before, same filters.",
                })
    except Exception:  # noqa: BLE001 — momentum is optional, never blocks the tab
        pass

    # 6) UGC vs non-UGC
    try:
        ug = q(f"select case when ad_name ilike '%ugc%' then 'UGC' else 'Non-UGC' end as bucket, "
               f"sum(spend) as spend, sum(impressions) as impressions, "
               f"sum(inline_link_clicks) as clicks from {META_SRC} {w} group by 1")
        if len(ug) == 2:
            u = ug.set_index("bucket")
            cu = float(u.loc["UGC", "clicks"] or 0) / float(u.loc["UGC", "impressions"] or 1) * 100
            cn = float(u.loc["Non-UGC", "clicks"] or 0) / float(u.loc["Non-UGC", "impressions"] or 1) * 100
            out.append({
                "Type": "UGC vs non-UGC",
                "Insight": f"UGC creator ads run a {cu:.2f}% link CTR vs {cn:.2f}% for everything else "
                           f"({'UGC ahead' if cu > cn else 'UGC behind'}).",
                "Evidence": f"UGC spend {money(float(u.loc['UGC', 'spend'] or 0))} · "
                            f"non-UGC spend {money(float(u.loc['Non-UGC', 'spend'] or 0))}.",
            })
    except Exception:  # noqa: BLE001
        pass
    return out


# ── FEEDBACK STORE — the ONE write path in the app: a dedicated feedback
# table in the warehouse (never touches any platform or source table).
FEEDBACK_TABLE = "VAHDAM_DB.MAPLEMONK.DASHBOARD_FEEDBACK"


def ensure_feedback_table():
    session.sql(
        f"create table if not exists {FEEDBACK_TABLE} ("
        "created_at timestamp_ltz default current_timestamp(), "
        "submitted_by string default current_user(), "
        "section string, analysis_view string, category string, "
        "rating integer, feedback string)"
    ).collect()


def render_ads_intelligence():
    st.title("Ads Intelligence")
    st.caption(
        "Intelligence layer over the ads warehouse: discover every ad, creative "
        "and tracker table that REALLY exists (nothing assumed), the ONE metric "
        "catalog (shared with the web app), the live accuracy calculator, "
        "evidence-quoting generated insights, and the feedback log. Sources are "
        "read-only; only the feedback tab writes, to its own dedicated table."
    )
    (tab_tables, tab_creatives, tab_trackers, tab_catalog, tab_accuracy,
     tab_insights, tab_feedback) = st.tabs(
        ["Ad platform tables", "Creatives & assets", "Trackers (UGC / retail / sales)",
         "Metric catalog", "Accuracy calculator", "Insights generated", "Feedback"])
    with tab_tables:
        table_explorer(
            "ai_tables", ["meta", "google", "tiktok", "ads", "insights"],
            "No ad platform tables found — check the Daton/Maplemonk syncs and this role's grants.",
        )
    with tab_creatives:
        table_explorer(
            "ai_creatives", ["creative", "asset", "image", "thumbnail", "video"],
            "Load the creative registers (e.g. Meta ad creatives) into the warehouse to light this up.",
        )
    with tab_trackers:
        table_explorer(
            "ai_trackers", ["ugc", "tracker", "target_sales", "retail", "spend", "dpci"],
            "Load the tracker workbooks (UGC Master, Target Sales, Retail Ads, Ad Spends) "
            "via trackers/load_trackers.sql to light this up.",
        )
    with tab_catalog:
        st.subheader(f"Metric catalog — {len(METRICS)} metrics across {len(CATEGORIES)} categories")
        st.caption(
            "Defined once, computed identically on this app and the web app "
            "(mirror of api/_shared/ad-metrics-catalog.js). base = read straight "
            "from the platform; derived = computed by the formula shown."
        )
        cat = catalog_df()
        pick = st.multiselect("Filter by category", [c[1] for c in CATEGORIES],
                              default=[c[1] for c in CATEGORIES], key="ai_cat")
        st.dataframe(cat[cat["Category"].isin(pick)], use_container_width=True,
                     hide_index=True, height=560)
    with tab_accuracy:
        st.subheader("Accuracy calculator")
        st.caption(
            "Coverage = share of rows where every input for a metric is present. "
            "Agreement = how closely our derived value matches the platform's own "
            "reported value where one exists (drift check). Computed live over the "
            "Meta rows in the current top-bar filter scope."
        )
        df = meta_rows(account, level, since, until)
        if df.empty:
            st.warning("No rows to score. Widen the date range or clear the account filter.")
        else:
            acc = accuracy(df.to_dict("records"))
            counts = acc["Confidence"].value_counts()
            c1, c2, c3, c4, c5 = st.columns(5)
            c1.metric("Rows scored", f"{len(df):,}")
            c2.metric("High", int(counts.get("high", 0)))
            c3.metric("Medium", int(counts.get("medium", 0)))
            c4.metric("Low", int(counts.get("low", 0)))
            c5.metric("Unavailable", int(counts.get("unavailable", 0)))
            st.dataframe(acc, use_container_width=True, hide_index=True, height=520)
            st.caption(
                "Video metrics (hook/hold/through) read 'unavailable' until the Meta "
                "video-quartile child tables are flattened into the row — honest by design."
            )

    with tab_insights:
        st.subheader(f"Insights generated — {platform_label}, {since} – {until}")
        st.caption(
            "Computed live from the warehouse for the CURRENT top-bar filter scope. "
            "Every insight quotes the exact figures it was derived from — nothing "
            "is estimated or invented; an angle with insufficient data simply "
            "does not appear."
        )
        if platform != "Meta":
            st.info(f"Insights are computed on the Meta table today; {platform} joins "
                    "when its column-level metric mapping is finalised.")
        else:
            ins = generated_insights()
            if not ins:
                st.warning("No spend rows in this scope to generate insights from — "
                           "widen the window or clear filters.")
            else:
                for i in ins:
                    st.markdown(f"**{i['Type']}** — {i['Insight']}")
                    st.caption("Evidence: " + i["Evidence"])
                idf = pd.DataFrame(ins)
                st.dataframe(idf, use_container_width=True, hide_index=True, height=260)
                st.download_button("Download insights CSV", idf.to_csv(index=False).encode(),
                                   "insights_generated.csv", "text/csv", key="ins_dl")
                st.markdown("---")
                if st.button("Write a narrative summary (Snowflake Cortex AI)", key="ins_cortex"):
                    prompt = ("You are a performance-marketing analyst. Using ONLY the facts in this "
                              "JSON (do not add numbers that are not present), write a short, plain "
                              "narrative summary with clear next actions:\n" + json.dumps(ins))
                    _cx_err = None
                    for _m in ("llama3.1-70b", "mistral-large2", "snowflake-arctic"):
                        try:
                            r = session.sql("select snowflake.cortex.complete(?, ?) as t",
                                            params=[_m, prompt]).collect()
                            st.markdown(r[0]["T"])
                            st.caption(f"AI-written narrative (Snowflake Cortex · {_m}) over the "
                                       "computed figures above — verify claims against the evidence table.")
                            _cx_err = None
                            break
                        except Exception as e:  # noqa: BLE001 — model/priv not enabled: try next
                            _cx_err = e
                    if _cx_err is not None:
                        st.info(f"Snowflake Cortex is not available for this account/role: {_cx_err}")

    with tab_feedback:
        st.subheader("Feedback")
        st.caption(
            f"Logged to `{FEEDBACK_TABLE}` in the warehouse — the app's ONE write "
            "path; source and platform tables stay strictly read-only. Feedback is "
            "stamped with your Snowflake user and timestamp."
        )
        try:
            ensure_feedback_table()
            _fb_ready = True
        except Exception as e:  # noqa: BLE001
            _fb_ready = False
            st.warning(
                f"This role cannot create/write `{FEEDBACK_TABLE}`: {e}. "
                "Grant it once from an admin role: "
                f"GRANT CREATE TABLE ON SCHEMA VAHDAM_DB.MAPLEMONK TO ROLE <app role>; "
                f"then GRANT INSERT, SELECT ON TABLE {FEEDBACK_TABLE} TO ROLE <app role>;"
            )
        if _fb_ready:
            with st.form("fb_form", clear_on_submit=True):
                c1, c2 = st.columns([1.2, 0.8])
                fb_cat = c1.selectbox("Category", ["Data issue", "Metric definition", "Design / UX",
                                                   "Feature request", "Insight quality", "Other"])
                fb_rating = c2.slider("Rating", 1, 5, 4, help="1 = broken · 5 = great")
                fb_text = st.text_area("Feedback", placeholder="What is wrong, missing, or working well?")
                submitted = st.form_submit_button("Submit feedback")
            if submitted:
                if not fb_text.strip():
                    st.warning("Write a line of feedback before submitting.")
                else:
                    try:
                        session.sql(
                            f"insert into {FEEDBACK_TABLE} "
                            "(section, analysis_view, category, rating, feedback) "
                            "values (?, ?, ?, ?, ?)",
                            params=[section, view or "-", fb_cat, int(fb_rating), fb_text.strip()],
                        ).collect()
                        st.success("Feedback recorded.")
                    except Exception as e:  # noqa: BLE001
                        st.error(f"Could not record feedback: {e}")
            st.markdown("**All feedback (newest first)**")
            try:
                # Uncached read on purpose: a submission must show up immediately.
                fb = session.sql(f"select * from {FEEDBACK_TABLE} order by created_at desc").to_pandas()
                fb.columns = [c.lower() for c in fb.columns]
                if fb.empty:
                    st.info("No feedback logged yet — the first submission appears here.")
                else:
                    st.dataframe(fb, use_container_width=True, hide_index=True, height=360)
                    st.download_button("Download feedback CSV", fb.to_csv(index=False).encode(),
                                       "dashboard_feedback.csv", "text/csv", key="fb_dl")
            except Exception as e:  # noqa: BLE001
                st.info(f"Feedback log unreadable: {e}")


# ── Route ────────────────────────────────────────────────────────────────────
# Every section renders inside an error boundary: a failure surfaces as the
# real exception on the page, never as a tab that silently refuses to load.
def _run_section(fn):
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        st.error(f"This view hit an error: {e}")
        st.code(traceback.format_exc())
        st.caption("The error above is the live traceback — nothing is hidden. "
                    "Try 🔄 Refresh (clears caches) or narrow the filters; if it "
                    "persists, this is the exact message to report.")


if section == "Ads Analysis":
    _run_section(render_ads_analytics)
else:
    _run_section(render_ads_intelligence)

st.markdown("---")
st.caption("Source: Snowflake (Daton / Maplemonk) via get_active_session · read-only · Altair charts · one metric catalog shared with the web app.")
