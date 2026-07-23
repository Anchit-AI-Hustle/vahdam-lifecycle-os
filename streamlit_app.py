"""
VAHDAM Lifecycle OS — Data Analysis + Ads Analytics (Streamlit in Snowflake).

Runs NATIVELY inside Snowflake. Authentication and warehouse come from the
logged-in Snowflake session via get_active_session() — no external keys, no PAT,
no Supabase. Every figure is read directly (read-only) from the warehouse tables
the Daton / Maplemonk pipelines already load. Charts use Altair (not Plotly).

Two sections, matching the web app's two dashboards so the SAME analysis renders
on both surfaces (parity comes from ONE source of truth — these Snowflake tables +
the ONE metric catalog below, mirrored field-for-field from the web app's
api/_shared/ad-metrics-catalog.js so a metric is defined once and computed
identically everywhere):

  • Data Analysis  — source/connector status, portfolio KPIs, budget pacing vs
    the Target $1,000/day & Costco $300/day caps, the full metric catalog
    (definition + formula per metric) and a live accuracy calculator.
  • Ads Analytics  — Meta / Google / TikTok, per campaign and per ad, plus
    demographic / geo / device cohorts for the Costco + Target US accounts.

Deploy: snowflake/streamlit/deploy.sql (CREATE STREAMLIT ...). Snowflake mints
the app URL when the Streamlit object is created in the account.
"""

import json
import math
import re

import altair as alt
import pandas as pd
import streamlit as st
from snowflake.snowpark.context import get_active_session

# ── Session (always) ─────────────────────────────────────────────────────────
session = get_active_session()

st.set_page_config(page_title="VAHDAM Analytics", layout="wide")

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
GOOGLE_ADS = "VAHDAM_DB.MAPLEMONK.GOOGLE_ADS_USA"

# Daily budget caps (USD). Reference/alerting only — nothing is ever written back.
BUDGETS = {"target": 1000, "costco": 300}


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
@st.cache_data(ttl=600, show_spinner=False)
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
        r = q(f"select {sel} from {META_ADS}")
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
        df = q(f"select distinct account_name from {META_ADS} "
               f"where account_name is not null order by 1")
        return [str(x) for x in df.iloc[:, 0].dropna().tolist()]
    except Exception:  # noqa: BLE001 — no grant/rows: empty list, never invented
        return []


@st.cache_data(ttl=3600, show_spinner=False)
def has_column(table: str, col: str) -> bool:
    """True when the table really has the column (guards optional filters)."""
    try:
        db, schema, name = table.split(".", 2)
        r = q(f"select column_name from {db}.information_schema.columns "
              f"where table_schema = '{schema}' and table_name = '{name}'")
        return col.lower() in [str(c).lower() for c in r.iloc[:, 0].tolist()]
    except Exception:  # noqa: BLE001
        return False


def date_clause(col: str, since, until) -> str:
    if not since or not until:
        return ""
    return f" and {col} between '{since}' and '{until}'"


def money(v):
    return "—" if v is None or (isinstance(v, float) and pd.isna(v)) else f"${v:,.0f}"


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
        from {META_ADS} {where}
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
    schemas vary, so pull recent rows rather than assume a date/account column."""
    try:
        return q(f"select * from {table} limit 500")
    except Exception as e:  # noqa: BLE001
        st.info(f"Could not read {table}: {e}")
        return pd.DataFrame()


# ── Sidebar: section + shared filters ────────────────────────────────────────
st.sidebar.title("VAHDAM · Lifecycle OS on Snowflake")
section = st.sidebar.radio(
    "Section",
    ["Data Analysis", "Ads Analytics", "Mailer Intelligence"],
)
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
    table = META_ADS if channel == "Meta" else (GOOGLE_ADS if channel == "Google" else TIKTOK["campaign"])
    col = next((c for c in ACCOUNT_COL_CANDIDATES if has_column(table, c)), None)
    if not col:
        return None, []
    try:
        df = q(f'select distinct "{col.upper()}" as v from {table} '
               f'where "{col.upper()}" is not null order by 1 limit 200')
        return col, [str(x) for x in df["v"].dropna().tolist()]
    except Exception:  # noqa: BLE001
        return col, []


platform_label = st.sidebar.selectbox("Channel", ["Meta Ads", "Google Ads", "TikTok Ads"])
platform = platform_label.replace(" Ads", "")
acct_col, _acct_opts = channel_accounts(platform)
# Multi-select: empty selection = All. Cascade: options come from THIS channel's
# own table, so picking Meta Ads only ever offers Meta ad accounts.
account = st.sidebar.multiselect(f"Accounts ({platform_label} ad accounts)", _acct_opts)
marketplace = st.sidebar.multiselect("Marketplaces (from ad names)",
                                     detected_marketplaces() + ["D2C / Other"])


@st.cache_data(ttl=300, show_spinner=False)
def distinct_values(col):
    """Distinct values of an optional filter column (objective / status)."""
    try:
        d = q(f'select distinct "{col.upper()}" as v from {META_ADS} '
              f'where "{col.upper()}" is not null order by 1 limit 100')
        return [str(x) for x in d["v"].dropna().tolist()]
    except Exception:  # noqa: BLE001
        return []


OBJ_COL = next((c for c in ("objective", "campaign_objective")
                if platform == "Meta" and has_column(META_ADS, c)), None)
STATUS_COL = next((c for c in ("ad_delivery", "effective_status", "configured_status",
                               "delivery_status", "status")
                   if platform == "Meta" and has_column(META_ADS, c)), None)
objective_sel = st.sidebar.multiselect("Objective", distinct_values(OBJ_COL)) if OBJ_COL else []
status_sel = st.sidebar.multiselect("Campaign status", distinct_values(STATUS_COL)) if STATUS_COL else []

# Controls vary by analysis type: granularity applies to Ads Analytics
# (campaign / ad set / ad analysis); the portfolio-style sections are not ad-level.
if section == "Ads Analytics":
    level = st.sidebar.selectbox("Granularity", ["campaign", "adset", "ad"])
else:
    level = "campaign"
LEVEL_COL = {"campaign": "campaign_name", "adset": "adset_name", "ad": "ad_name"}

# Date range: presets + custom.
today = pd.Timestamp.utcnow().normalize()
_preset = st.sidebar.selectbox("Date range",
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
    since = st.sidebar.date_input("Since", (today - pd.Timedelta(days=30)).date())
    until = st.sidebar.date_input("Until", today.date())
else:
    since, until = (today - pd.Timedelta(days=30)).date(), today.date()
window_days = max(1, (pd.Timestamp(until) - pd.Timestamp(since)).days + 1)
st.sidebar.markdown("---")
# Every view queries the warehouse LIVE at render time — new campaigns/ads
# appear automatically. Option lists cache for 5 minutes; this clears them now.
if st.sidebar.button("🔄 Refresh live data now"):
    st.cache_data.clear()
    st.rerun()
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


# ═════════════════════════════════════════════════════════════════════════════
# DATA ANALYSIS
# ═════════════════════════════════════════════════════════════════════════════
def render_data_analysis():
    st.title("Data Analysis")
    st.caption(
        "Portfolio view across the Costco + Target US ad accounts, sourced live "
        "from Snowflake via the active session. The metric catalog and accuracy "
        "calculator are the SAME definitions the web app uses. Read-only; nothing "
        "is fabricated — a metric with no inputs reads 'unavailable', not zero."
    )

    tab_status, tab_kpis, tab_catalog, tab_accuracy, tab_retail = st.tabs(
        ["Sources & budget", "Portfolio KPIs", "Metric catalog", "Accuracy calculator",
         "Retail sales tracker"]
    )

    # Sources / connector status + budget pacing
    with tab_status:
        st.subheader("Sources (read-only)")
        src = pd.DataFrame([
            {"Platform": "Meta", "Table": META_ADS, "Cohorts": "age/gender, platform/device"},
            {"Platform": "Meta (age x gender)", "Table": META_AGE_GENDER, "Cohorts": "age, gender"},
            {"Platform": "Meta (device)", "Table": META_DEVICE, "Cohorts": "device, placement"},
            {"Platform": "TikTok (campaign)", "Table": TIKTOK["campaign"], "Cohorts": "age/gender, country"},
            {"Platform": "TikTok (ad)", "Table": TIKTOK["ad"], "Cohorts": "—"},
            {"Platform": "Google", "Table": GOOGLE_ADS, "Cohorts": "segment tables"},
        ])
        st.dataframe(src, use_container_width=True, hide_index=True)
        st.caption("Authentication via get_active_session() — no PAT, no keys stored. The session role governs table access.")

        st.subheader("Budget pacing vs daily caps")
        try:
            # Caps belong to the MARKETPLACE (Target $1,000/day · Costco $300/day),
            # which lives in the ad names — group by the derived marketplace, with
            # the real account filter applied on top when one is selected.
            pace = q(f"""
                select {mkt_case()} as marketplace, sum(spend) as spend, count(distinct date_start) as days
                from {META_ADS}
                where 1=1{acct_clause('account_name', account)}{date_clause('date_start', since, until)}
                group by 1 order by spend desc nulls last
            """)
        except Exception as e:  # noqa: BLE001
            pace = pd.DataFrame()
            st.info(f"Budget pacing unavailable: {e}")
        if not pace.empty:
            rows = []
            for _, r in pace.iterrows():
                mkt = str(r["marketplace"] or "")
                cap = BUDGETS.get(mkt.lower())
                days = r["days"] or window_days
                avg_daily = (r["spend"] / days) if days else None
                rows.append({
                    "Marketplace (from ad names)": mkt or "(unnamed)",
                    "Spend (window)": money(r["spend"]),
                    "Avg daily spend": money(avg_daily),
                    "Daily cap": money(cap) if cap else "— (no cap set)",
                    "Pacing": (pctf(avg_daily / cap * 100) if (cap and avg_daily is not None) else "—"),
                })
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
            st.caption("Pacing = avg daily spend as a % of the marketplace's daily cap. Caps are for reference/alerting only.")
        else:
            st.warning("No Meta spend rows in this window to pace against.")

    # Portfolio KPIs (Meta, whole window)
    with tab_kpis:
        df = meta_rows(account, level, since, until)
        if df.empty:
            st.warning("No Meta rows for this account / window.")
        else:
            spend, impr, reach = df["spend"].sum(), df["impressions"].sum(), df["reach"].sum()
            link_clicks = df["inline_link_clicks"].sum()
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Amount spent", money(spend))
            c2.metric("Impressions", f"{impr:,.0f}")
            c3.metric("Reach", f"{reach:,.0f}")
            c4.metric("Frequency", f"{(impr/reach):.2f}" if reach else "—")
            c5, c6, c7, c8 = st.columns(4)
            c5.metric("Link clicks", f"{link_clicks:,.0f}")
            c6.metric("Link CTR", pctf(link_clicks / impr * 100 if impr else None))
            c7.metric("CPC", money(spend / link_clicks if link_clicks else None))
            c8.metric("CPM", money(spend / impr * 1000 if impr else None))
            st.subheader("Spend share by " + ("ad" if level == "ad" else "campaign"))
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

    # Metric catalog (definitions + formulas) — the single source of truth
    with tab_catalog:
        st.subheader(f"Metric catalog — {len(METRICS)} metrics across {len(CATEGORIES)} categories")
        st.caption(
            "Defined once, computed identically on this app and the web app "
            "(mirror of api/_shared/ad-metrics-catalog.js). base = read straight "
            "from the platform; derived = computed by the formula shown."
        )
        cat = catalog_df()
        pick = st.multiselect("Filter by category", [c[1] for c in CATEGORIES], default=[c[1] for c in CATEGORIES])
        st.dataframe(cat[cat["Category"].isin(pick)], use_container_width=True, hide_index=True, height=560)

    # Accuracy calculator — coverage + agreement over the live Meta rows
    with tab_accuracy:
        st.subheader("Accuracy calculator")
        st.caption(
            "Coverage = share of rows where every input for a metric is present. "
            "Agreement = how closely our derived value matches the platform's own "
            "reported value where one exists (drift check). Computed live over the "
            "Meta rows in the current filter."
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

    # Retail sales tracker (Target) — week/day-wise DPCI sales & velocity, P&L,
    # CAC by channel. That data lives in the Target_Sales_Tracker workbook, not
    # (yet) in the warehouse — discover the loaded tables; declared gap otherwise.
    with tab_retail:
        st.subheader("Retail sales tracker (Target)")
        st.caption(
            "The analyses from the Target sales tracker: week-wise and day-wise "
            "sales per DPCI/SKU (units, dollars, velocity, store count), MTD/FY "
            "P&L (online vs offline, Roundel/Instacart/Ibotta spends) and CAC per "
            "channel. Load the tracker sheets into the warehouse as tables and "
            "they render here; until then this is a declared gap - nothing is "
            "estimated. Read-only."
        )
        table_explorer("retail", ["dpci", "target_sales", "velocity", "retail", "roundel", "instacart", "ibotta"],
                       "Load Target_Sales_Tracker sheets (Week-wise, Day-wise, P&L, CAC) into the warehouse to light this up.")


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
    """All (column, type) pairs the table really has, in ordinal order."""
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
    return q(f"select * from {META_ADS} {where} order by date_start desc "
             f"limit {int(limit)} offset {int(offset)}")


@st.cache_data(ttl=600, show_spinner=False)
def campaign_options(account, marketplace, since, until, col="campaign_name"):
    where = ("where 1=1" + acct_clause("account_name", account)
             + mkt_clause(marketplace) + date_clause("date_start", since, until))
    try:
        df = q(f"select {col}, sum(spend) as spend from {META_ADS} {where} "
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
    ob = " order by spend desc nulls last" if "spend" in nums else ""
    lim = f" limit {int(limit)} offset {int(offset)}" if limit else ""
    return q(f"select {gsel}, {sel} from {table} {where} group by {gpos}{ob}{lim}")


@st.cache_data(ttl=600, show_spinner=False)
def daily_series(table, where, metric, by=None):
    byc = f', "{by.upper()}" as {by}' if by else ""
    byg = ", 2" if by else ""
    return q(f'select "DATE_START" as date_start{byc}, sum("{metric.upper()}") as {metric} '
             f"from {table} {where} group by 1{byg} order by 1")


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
    df = q(f"select * from {META_ADS} {ew} order by date_start desc limit 2000")
    if df.empty:
        st.warning("No rows for this campaign in the window.")
    else:
        groups = classify_columns(table_columns(META_ADS))
        sums = sql_sums(META_ADS, ew)
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
        mm = st.selectbox("Measure", mcols, index=mcols.index("spend") if "spend" in mcols else 0,
                      key=key_prefix + "_measure")
        g = daily_series(META_ADS, ew, mm)
        st.altair_chart(
            alt.Chart(g).mark_line(color=GREEN, point=True).encode(
                x=alt.X("date_start:T", title=None), y=alt.Y(f"{mm}:Q", title=mm),
                tooltip=["date_start", mm]).properties(height=260),
            use_container_width=True)

        st.subheader("Per-ad breakdown (all metric fields + derived)")
        if "ad_name" in df.columns:
            per_ad = sql_group_sums(META_ADS, ew, ["ad_name"])
            for k in ("link_ctr", "ctr", "cpc", "cpm", "cost_per_reach", "frequency"):
                fn = CATALOG_FN.get(k)
                if fn:
                    per_ad[k] = per_ad.apply(lambda r, f=fn: f(r.to_dict()), axis=1)
            if "spend" in per_ad.columns:
                per_ad = per_ad.sort_values("spend", ascending=False)
            st.dataframe(per_ad, use_container_width=True, height=420)
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
                    dv = q(f"select * from {META_DEVICE} {dvw} limit 2000")
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
    st.subheader("All campaigns — one row per campaign")
    w = meta_where()
    try:
        total = int(q(f'select count(distinct "CAMPAIGN_NAME") as n from {META_ADS} {w}').iloc[0]["n"])
    except Exception:  # noqa: BLE001
        total = 0
    if not total:
        st.info("No campaigns in scope.")
        return
    size, off = pager(total, key + "_cr")
    df = sql_group_sums(META_ADS, w, ["campaign_name"], limit=size, offset=off)
    for k in ("link_ctr", "ctr", "cpc", "cpm", "cost_per_reach", "frequency"):
        fn = CATALOG_FN.get(k)
        if fn:
            df[k] = df.apply(lambda r, f=fn: f(r.to_dict()), axis=1)
    st.dataframe(df, use_container_width=True, height=420)
    opts = campaign_options(account, marketplace, since, until)
    pick = st.selectbox("Open a campaign detail page", ["—"] + opts, key=key + "_open")
    if pick != "—":
        st.markdown("---")
        st.markdown(f"### Campaign detail — {pick}")
        render_campaign_detail(pick, key)


# ═════════════════════════════════════════════════════════════════════════════
# ADS ANALYTICS
# ═════════════════════════════════════════════════════════════════════════════
def render_ads_analytics():
    st.title("Ads Analytics")
    st.caption(
        "Live from Snowflake via the active session — Meta / Google / TikTok, per "
        "campaign and per ad, for the Costco + Target US accounts. Priority metrics "
        "lead. Read-only; nothing is fabricated."
    )
    (tab_overview, tab_single, tab_multi, tab_explorer, tab_rows,
     tab_cohorts, tab_spend, tab_ugc) = st.tabs(
        ["Overview & priority metrics", "Single campaign", "Multi-campaign compare",
         "Ad explorer (all fields)", "Campaign / ad rows", "Cohorts & segmentation",
         "Spend tracker", "UGC creator ads"]
    )

    with tab_overview:
        if platform == "Meta":
            # EXACT portfolio totals in SQL over all rows in scope — no fetch cap.
            sums = sql_sums(META_ADS, meta_where())
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
                            rows_.append({"Metric": m[1], "Tier": m[4],
                                          "Value": fmt_val(m[3], derived.get(m[0])),
                                          "Formula": m[6], "Definition": m[7]})
                        st.dataframe(pd.DataFrame(rows_), use_container_width=True,
                                     hide_index=True, height=min(420, 44 + 36 * len(rows_)))

                all_campaigns_block("ov")

                st.subheader("Spend by " + ("ad" if level == "ad" else "campaign"))
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

    with tab_rows:
        st.subheader(f"{platform} — per {level}")
        if platform == "Meta":
            name_col = LEVEL_COL.get(level, "campaign_name")
            w = meta_where()
            total = 0
            try:
                total = int(q(f'select count(distinct "{name_col.upper()}") as n from {META_ADS} {w}').iloc[0]["n"])
            except Exception:  # noqa: BLE001
                pass
            if not total:
                st.warning("No rows for this selection.")
            else:
                size, off = pager(total, "rows")
                df = sql_group_sums(META_ADS, w, [name_col], limit=size, offset=off)
                for k in ("link_ctr", "ctr", "cpc", "cpm", "cost_per_reach", "frequency"):
                    fn = CATALOG_FN.get(k)
                    if fn:
                        df[k] = df.apply(lambda r, f=fn: f(r.to_dict()), axis=1)
                st.dataframe(df, use_container_width=True, height=520)
                opts_r = campaign_options(account, marketplace, since, until)
                pick_r = st.selectbox("Open a campaign detail page", ["—"] + opts_r, key="rows_open")
                if pick_r != "—":
                    st.markdown("---")
                    st.markdown(f"### Campaign detail — {pick_r}")
                    render_campaign_detail(pick_r, "rows")
        else:
            table = GOOGLE_ADS if platform == "Google" else TIKTOK[level if level in TIKTOK else "campaign"]
            wg = ""
            if account and acct_col and has_column(table, acct_col):
                qv = account.replace("'", "''")
                wg = f" where \"{acct_col.upper()}\" = '{qv}'"
            total = count_rows(table, wg)
            if not total:
                st.info(f"No readable rows in `{table}` for this account scope.")
            else:
                size, off = pager(total, "rows_g")
                try:
                    st.dataframe(q(f"select * from {table}{wg} limit {size} offset {off}"),
                                 use_container_width=True, height=520)
                except Exception as e:  # noqa: BLE001
                    st.info(f"Could not read {table}: {e}")

    with tab_cohorts:
        st.subheader("Cohorts — every factor the warehouse carries")
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
                    st.dataframe(g, use_container_width=True, height=420)
                    st.download_button("Download cohorts CSV", g.to_csv(index=False).encode(),
                                       "cohorts.csv", "text/csv", key="coh_dl")

                    # ── COHORT DETAIL PAGE ────────────────────────────────────
                    st.markdown("---")
                    st.subheader("Cohort detail — deep exploration")
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
    with tab_single:
        if platform != "Meta":
            st.info("Single-campaign deep-dive runs on the Meta table; Google/TikTok show raw rows in 'Campaign / ad rows'.")
        else:
            etype = st.radio("Entity type", ["Campaign", "Ad set", "Ad"], horizontal=True, key="single_etype")
            ecol = {"Campaign": "campaign_name", "Ad set": "adset_name", "Ad": "ad_name"}[etype]
            opts = campaign_options(account, marketplace, since, until, ecol)
            if not opts:
                st.warning("No entities in scope — widen the window or clear filters.")
            else:
                camp = st.selectbox(f"{etype} (ordered by spend)", opts, key="single_pick")
                render_campaign_detail(camp, "single", ecol)
    # ── MULTI-CAMPAIGN COMPARE — every metric, side by side ──────────────────
    with tab_multi:
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
                        s = sql_sums(META_ADS, meta_where((c_name,)))
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
                        g = daily_series(META_ADS, meta_where(tuple(picks)), sel2, by="campaign_name")
                        st.altair_chart(
                            alt.Chart(g).mark_line(point=True).encode(
                                x=alt.X("date_start:T", title=None), y=alt.Y(f"{sel2}:Q", title=sel2),
                                color=alt.Color("campaign_name:N", title=None),
                                tooltip=["date_start", "campaign_name", sel2]).properties(height=300),
                            use_container_width=True)

                        all_campaigns_block("mc")

    # ── AD EXPLORER — every field the table carries, upfront ─────────────────
    with tab_explorer:
        if platform != "Meta":
            table = GOOGLE_ADS if platform == "Google" else TIKTOK[level if level in TIKTOK else "campaign"]
            st.info(f"{platform}: raw rows with whatever columns exist in `{table}`.")
            wg = ""
            if account and acct_col and has_column(table, acct_col):
                qv = account.replace("'", "''")
                wg = f" where \"{acct_col.upper()}\" = '{qv}'"
            total_g = count_rows(table, wg)
            if total_g:
                size_g, off_g = pager(total_g, "expl_g")
                try:
                    st.dataframe(q(f"select * from {table}{wg} limit {size_g} offset {off_g}"),
                                 use_container_width=True, height=520)
                except Exception as e:  # noqa: BLE001
                    st.info(f"Could not read {table}: {e}")
            else:
                st.info("No readable rows for this account scope.")
        else:
            cols = table_columns(META_ADS)
            groups = classify_columns(cols)
            st.caption(f"`{META_ADS}` — {len(cols)} columns available, all shown. "
                       "Field map derived live from the table schema; nothing hidden, nothing invented.")
            with st.expander("Field map — every column by analysis role", expanded=True):
                for gname, glist in [("Identity & configuration", groups["identity_config"]),
                                     ("Audience & targeting", groups["audience_targeting"]),
                                     ("Time", groups["time"]),
                                     ("Metrics", groups["metrics"]),
                                     ("Other", groups["other"])]:
                    st.markdown(f"**{gname} ({len(glist)})**: " + (", ".join(f"`{c}`" for c in glist) or "—"))
            total = count_rows(META_ADS, meta_where())
            if not total:
                st.warning("No rows in scope.")
            else:
                size, off = pager(total, "expl", default_size=1000)
                df = meta_raw(account, marketplace, since, until, None, size, off)
                st.dataframe(df, use_container_width=True, height=520)
                st.download_button("Download this page as CSV (all fields)",
                                   df.to_csv(index=False).encode(), "meta_ads_all_fields.csv", "text/csv")

                all_campaigns_block("ex")

    # ── SPEND TRACKER — the Ad_Spends workbook (May-Jul, Meta/TikTok), live ───
    with tab_spend:
        st.subheader("Monthly spend — channel × marketplace (live)")
        st.caption(
            "Replicates the Ad-Spends tracker: total spend per month split by "
            "marketplace (derived from ad names), computed in SQL over ALL rows "
            "in scope — always current, never keyed by hand."
        )
        try:
            g = q(f"select to_char(date_start, 'YYYY-MM') as month, {mkt_case()} as marketplace, "
                  f"sum(spend) as spend from {META_ADS} {meta_where()} group by 1, 2 order by 1")
        except Exception as e:  # noqa: BLE001
            g = pd.DataFrame()
            st.warning(f"Spend matrix unavailable: {e}")
        if not g.empty:
            piv = g.pivot_table(index="marketplace", columns="month", values="spend", aggfunc="sum")
            piv["TOTAL"] = piv.sum(axis=1)
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
                       f'sum("{tt_spend.upper()}") as spend from {tt} group by 1 order by 1')
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
                dm = daily_series(META_ADS, meta_where(tuple(picks_s)), metric_s, by="campaign_name")
                if not dm.empty:
                    dm["date_start"] = dm["date_start"].astype(str)
                    mpiv = dm.pivot_table(index="campaign_name", columns="date_start", values=metric_s, aggfunc="sum")
                    st.dataframe(mpiv.round(2), use_container_width=True, height=300)
                else:
                    st.info("No rows for those campaigns in the window.")
            except Exception as e:  # noqa: BLE001
                st.warning(f"Day-wise matrix unavailable: {e}")

    # ── UGC CREATOR ADS — the UGC Master workbook's PAID side, live ──────────
    with tab_ugc:
        st.subheader("UGC creator ads — paid performance per creator (live)")
        st.caption(
            "Replicates the UGC Master ad-performance sheets: every ad whose name "
            "carries 'UGC', with the creator parsed from the ad name, spend, "
            "impressions, clicks, CTR and CPC — straight from the warehouse."
        )
        wu = meta_where() + " and ad_name ilike '%ugc%'"
        du = sql_group_sums(META_ADS, wu, ["ad_name"])
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
            st.dataframe(pc, use_container_width=True, height=360)
            st.markdown("**Per ad (every UGC ad as a row)**")
            st.dataframe(du.sort_values("spend", ascending=False) if "spend" in du.columns else du,
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


# ═════════════════════════════════════════════════════════════════════════════
# BUSINESS REVIEW (T1–T7) + ROLES & PERMISSIONS (T8) — Snowflake-table driven.
# Zero fabrication: panels are built ONLY from tables that actually exist in the
# warehouse. discover_tables() searches INFORMATION_SCHEMA by keyword; a task
# whose source data is not loaded into Snowflake shows a declared gap, never an
# estimated number. (The web app's review package sourced T1–T7 largely from
# live Shopify exports — those series only appear here once loaded into the
# warehouse.)
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
        df = q(f"select * from {pick} limit 1000")
    except Exception as e:  # noqa: BLE001
        st.warning(f"Could not read {pick}: {e}")
        return
    if df.empty:
        st.info("Table is readable but returned no rows.")
        return
    st.caption(f"{pick} · showing up to 1,000 rows · read-only")
    st.dataframe(df.head(300), use_container_width=True, height=340)
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


def render_mailer_intelligence():
    st.title("Mailer Intelligence")
    st.caption(
        "Email/SMS lifecycle reporting (Klaviyo / WebEngage) straight from the "
        "warehouse. Discovers the real mailer tables (campaigns, flows, events, "
        "engagement) and renders whatever is actually loaded - a source that is "
        "not synced into Snowflake shows a declared gap, never an estimate. "
        "Read-only."
    )
    tab_campaigns, tab_events = st.tabs(["Campaigns & flows", "Events & engagement"])
    with tab_campaigns:
        table_explorer(
            "ml_campaigns", ["klaviyo", "campaign", "flow", "mailer", "email"],
            "Load the Klaviyo campaign/flow exports into the warehouse to light this up.",
        )
    with tab_events:
        table_explorer(
            "ml_events", ["event", "webengage", "open", "click", "engagement"],
            "Load the Klaviyo/WebEngage event exports (opens, clicks, conversions) to light this up.",
        )


# ── Route ────────────────────────────────────────────────────────────────────
if section == "Data Analysis":
    render_data_analysis()
elif section == "Ads Analytics":
    render_ads_analytics()
else:
    render_mailer_intelligence()

st.markdown("---")
st.caption("Source: Snowflake (Daton / Maplemonk) via get_active_session · read-only · Altair charts · one metric catalog shared with the web app.")
