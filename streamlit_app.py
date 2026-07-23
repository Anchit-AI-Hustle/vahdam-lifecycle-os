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
    ("hold_rate", "Hold Rate", "video", "pct", "derived", ["thruplays", "impressions"], "thruplays / impressions x 100", "Share of impressions held to ThruPlay (15s/complete). Retention strength.", lambda r: _pct(r.get("thruplays"), r.get("impressions"))),
    ("through_rate", "Through Rate (completion)", "video", "pct", "derived", ["video_p100", "impressions"], "100% plays / impressions x 100", "Share of impressions that watched to the end.", lambda r: _pct(r.get("video_p100"), r.get("impressions"))),
    ("hook_to_hold", "Hook -> Hold retention", "video", "pct", "derived", ["thruplays", "video_3s"], "thruplays / 3-sec plays x 100", "Of those hooked, how many held. Isolates mid-video drop-off.", lambda r: _pct(r.get("thruplays"), r.get("video_3s"))),
    ("completion_of_starts", "Completion of starts", "video", "pct", "derived", ["video_p100", "video_3s"], "100% plays / 3-sec plays x 100", "Of viewers who started, how many finished.", lambda r: _pct(r.get("video_p100"), r.get("video_3s"))),
    # Conversion & Value
    ("purchases", "Purchases", "conversion", "int", "base", ["purchases"], "purchases", "Attributed purchases.", lambda r: _n(r.get("purchases"))),
    ("purchase_value", "Purchase value", "conversion", "usd", "base", ["purchase_value"], "conversion value", "Attributed revenue.", lambda r: _n(r.get("purchase_value"))),
    ("roas", "ROAS", "conversion", "ratio", "derived", ["purchase_value", "spend"], "purchase value / spend", "Return on ad spend.", lambda r: _div(r.get("purchase_value"), r.get("spend"))),
    ("cvr", "Conversion rate (CVR)", "conversion", "pct", "derived", ["purchases", "inline_link_clicks"], "purchases / link clicks x 100", "Purchases per link click.", lambda r: _pct(r.get("purchases"), r.get("inline_link_clicks"))),
    ("aov", "AOV (attributed)", "conversion", "usd", "derived", ["purchase_value", "purchases"], "purchase value / purchases", "Average order value of attributed purchases.", lambda r: _div(r.get("purchase_value"), r.get("purchases"))),
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


def acct_clause(col: str, account: str) -> str:
    """Filter by the REAL Meta ad-account name (exact, case-insensitive).
    Target/Costco are NOT accounts — they live in the ad names (see Marketplace)."""
    if not account:
        return ""
    a = account.lower().replace("'", "''")
    return f" and lower({col}) = '{a}'"


# Marketplace (Target / Costco) is carried in the AD NAMES, not the account
# field — derive/filter it from ad_name so it acts as its own dimension.
def mkt_clause(marketplace: str, col: str = "ad_name") -> str:
    if not marketplace:
        return ""
    m = marketplace.lower().replace("'", "''")
    return f" and {col} ilike '%{m}%'"


MKT_CASE = ("case when ad_name ilike '%target%' then 'Target' "
            "when ad_name ilike '%costco%' then 'Costco' "
            "else 'Other / D2C' end")


@st.cache_data(ttl=3600, show_spinner=False)
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
    name_col = "ad_name" if level == "ad" else "campaign_name"
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
    ["Data Analysis", "Ads Analytics", "Mailer Intelligence",
     "Business Review (T1-T7)", "Roles & Permissions (T8)"],
)
st.sidebar.markdown("---")
platform = st.sidebar.selectbox("Platform", ["Meta", "Google", "TikTok"])
# Account = the REAL Meta ad accounts read live from account_name. Target/Costco
# are NOT accounts — they are part of the ad names, exposed as Marketplace below.
account = st.sidebar.selectbox("Account (Meta ad account)", ["All"] + meta_accounts())
account = "" if account == "All" else account
marketplace = st.sidebar.selectbox("Marketplace (from ad names)", ["All", "Target", "Costco"])
marketplace = "" if marketplace == "All" else marketplace
level = st.sidebar.selectbox("Level", ["campaign", "ad"])
today = pd.Timestamp.utcnow().normalize()
since = st.sidebar.date_input("Since", (today - pd.Timedelta(days=30)).date())
until = st.sidebar.date_input("Until", today.date())
window_days = max(1, (pd.Timestamp(until) - pd.Timestamp(since)).days + 1)
st.sidebar.markdown("---")
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

    tab_status, tab_kpis, tab_catalog, tab_accuracy = st.tabs(
        ["Sources & budget", "Portfolio KPIs", "Metric catalog", "Accuracy calculator"]
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
                select {MKT_CASE} as marketplace, sum(spend) as spend, count(distinct date_start) as days
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
def meta_raw(account, marketplace, since, until, campaigns=None, limit=20000):
    """Raw ad-level daily rows with EVERY column (select *), scoped by the
    sidebar filters and optionally to specific campaigns."""
    where = ("where 1=1" + acct_clause("account_name", account)
             + mkt_clause(marketplace) + date_clause("date_start", since, until))
    if campaigns:
        inlist = ",".join("'" + str(c).replace("'", "''") + "'" for c in campaigns)
        where += f" and campaign_name in ({inlist})"
    return q(f"select * from {META_ADS} {where} order by date_start desc limit {int(limit)}")


@st.cache_data(ttl=600, show_spinner=False)
def campaign_options(account, marketplace, since, until):
    where = ("where 1=1" + acct_clause("account_name", account)
             + mkt_clause(marketplace) + date_clause("date_start", since, until))
    try:
        df = q(f"select campaign_name, sum(spend) as spend from {META_ADS} {where} "
               f"group by 1 order by spend desc nulls last limit 500")
        return [str(x) for x in df["campaign_name"].dropna().tolist()]
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
    (tab_overview, tab_single, tab_multi, tab_explorer, tab_rows, tab_cohorts) = st.tabs(
        ["Overview & priority metrics", "Single campaign", "Multi-campaign compare",
         "Ad explorer (all fields)", "Campaign / ad rows", "Cohorts & segmentation"]
    )

    with tab_overview:
        if platform == "Meta":
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
                st.subheader("Spend by " + ("ad" if level == "ad" else "campaign"))
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
            df = meta_rows(account, level, since, until)
            if df.empty:
                st.warning("No rows for this selection.")
            else:
                cols = ["name", "spend", "impressions", "reach", "frequency",
                        "inline_link_clicks", "link_ctr", "ctr", "cpc", "cpm", "cost_per_reach"]
                st.dataframe(df[cols], use_container_width=True, height=520)
        else:
            table = GOOGLE_ADS if platform == "Google" else TIKTOK[level if level in TIKTOK else "campaign"]
            st.dataframe(generic_rows(table), use_container_width=True, height=520)

    with tab_cohorts:
        st.subheader("Demographic, geo & device cohorts")
        st.caption(
            "Built from the platform's own delivery-breakdown tables (Meta age/gender "
            "& platform/device; TikTok age/gender & country). Use these as experiment "
            "audiences across Meta / Google / TikTok."
        )

        def cohort_chart(df, dim_col, title):
            if df.empty or dim_col not in df.columns:
                st.info(f"No data for {title}.")
                return
            g = df.groupby(dim_col, as_index=False)["spend"].sum().sort_values("spend", ascending=False).head(25)
            ch = (
                alt.Chart(g).mark_bar(color=GOLD).encode(
                    x=alt.X("spend:Q", title="Spend (USD)"),
                    y=alt.Y(f"{dim_col}:N", sort="-x", title=title),
                    tooltip=[dim_col, alt.Tooltip("spend:Q", format="$,.0f")],
                ).properties(height=max(140, 26 * len(g)))
            )
            st.altair_chart(ch, use_container_width=True)

        if platform == "Meta":
            # Per-table WHERE: apply account/marketplace only when the breakdown
            # table actually carries the column (age/gender & device tables vary).
            def bwhere(table):
                w = "where 1=1" + date_clause("date_start", since, until)
                if account and has_column(table, "account_name"):
                    w += acct_clause("account_name", account)
                if marketplace and has_column(table, "ad_name"):
                    w += mkt_clause(marketplace)
                return w
            col1, col2 = st.columns(2)
            with col1:
                st.markdown("**Age x gender**")
                ag = q(f"select age, gender, sum(spend) as spend from {META_AGE_GENDER} {bwhere(META_AGE_GENDER)} group by age, gender")
                if not ag.empty:
                    ag["cohort"] = ag["age"].astype(str) + " · " + ag["gender"].astype(str)
                    cohort_chart(ag, "cohort", "Age x gender")
            with col2:
                st.markdown("**Platform / device**")
                dv = q(f"select * from {META_DEVICE} {bwhere(META_DEVICE)} limit 5000")
                dim = next((c for c in ["impression_device", "device_platform", "platform_position", "publisher_platform"] if c in dv.columns), None)
                if dim:
                    cohort_chart(dv, dim, "Device / placement")
                else:
                    st.info("Device/placement dimension column not detected.")
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
            opts = campaign_options(account, marketplace, since, until)
            if not opts:
                st.warning("No campaigns in scope — widen the window or clear filters.")
            else:
                camp = st.selectbox("Campaign (ordered by spend)", opts)
                df = meta_raw(account, marketplace, since, until, (camp,))
                if df.empty:
                    st.warning("No rows for this campaign in the window.")
                else:
                    groups = classify_columns(table_columns(META_ADS))
                    sums, derived = aggregate_all(df)
                    c1, c2, c3, c4, c5 = st.columns(5)
                    c1.metric("Spend", money(sums.get("spend")))
                    c2.metric("Impressions", f"{sums.get('impressions', 0):,.0f}")
                    c3.metric("Link clicks", f"{sums.get('inline_link_clicks', 0):,.0f}")
                    c4.metric("Link CTR", pctf(derived.get("link_ctr")))
                    c5.metric("CPC", money(derived.get("cpc")))
                    n_ads = df["ad_name"].nunique() if "ad_name" in df.columns else 0
                    n_sets = df["adset_name"].nunique() if "adset_name" in df.columns else 0
                    st.caption(f"{n_ads} ads · {n_sets} ad sets · {len(df):,} daily rows. "
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
                    mm = st.selectbox("Measure", mcols, index=mcols.index("spend") if "spend" in mcols else 0)
                    g = df.groupby("date_start", as_index=False)[mm].sum()
                    st.altair_chart(
                        alt.Chart(g).mark_line(color=GREEN, point=True).encode(
                            x=alt.X("date_start:T", title=None), y=alt.Y(f"{mm}:Q", title=mm),
                            tooltip=["date_start", mm]).properties(height=260),
                        use_container_width=True)

                    st.subheader("Per-ad breakdown (all metric fields + derived)")
                    if "ad_name" in df.columns:
                        per_ad = df.groupby("ad_name", as_index=False)[mcols].sum()
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
                        if has_column(META_AGE_GENDER, "campaign_name"):
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
                        if has_column(META_DEVICE, "campaign_name"):
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
                        except Exception as e:  # noqa: BLE001
                            st.info(f"Creatives unavailable: {e}")
                    else:
                        st.info("No shared ad_name key between insights and creatives — browse creatives via Ad explorer.")

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
                        s, drv = aggregate_all(d)
                        sheets[c_name] = {**s, **{k: v for k, v in drv.items() if v is not None}}
                    if not sheets:
                        st.warning("No rows for the picked campaigns in this window.")
                    else:
                        comp = pd.DataFrame(sheets)
                        comp.index.name = "metric"
                        st.subheader("Side-by-side — every metric × campaign")
                        st.caption("Base sums + the full derived catalog per campaign. Ratio columns are recomputed on sums, never averaged.")
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
                        g = df.groupby(["date_start", "campaign_name"], as_index=False)[sel2].sum()
                        st.altair_chart(
                            alt.Chart(g).mark_line(point=True).encode(
                                x=alt.X("date_start:T", title=None), y=alt.Y(f"{sel2}:Q", title=sel2),
                                color=alt.Color("campaign_name:N", title=None),
                                tooltip=["date_start", "campaign_name", sel2]).properties(height=300),
                            use_container_width=True)

    # ── AD EXPLORER — every field the table carries, upfront ─────────────────
    with tab_explorer:
        if platform != "Meta":
            table = GOOGLE_ADS if platform == "Google" else TIKTOK[level if level in TIKTOK else "campaign"]
            st.info(f"{platform}: raw rows with whatever columns exist in `{table}`.")
            st.dataframe(generic_rows(table), use_container_width=True, height=520)
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
            df = meta_raw(account, marketplace, since, until, None, 20000)
            if df.empty:
                st.warning("No rows in scope.")
            else:
                st.dataframe(df, use_container_width=True, height=520)
                st.download_button("Download CSV (all fields, current scope)",
                                   df.to_csv(index=False).encode(), "meta_ads_all_fields.csv", "text/csv")


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


REVIEW_TASKS = [
    ("T1 · Sales & Business Performance", ["order", "sales", "shopify"],
     "Shopify sales series (annual/monthly/weekly/daily) load from the warehouse when synced."),
    ("T2 · Customers & Cohorts", ["customer", "buyer"],
     "Customer/RFM cohort exports appear once the customer tables are loaded."),
    ("T3 · Catalog & Price Parity", ["item", "product", "catalog", "amazon"],
     "Amazon fact/catalog tables live in VAHDAM_DB.MAPLEMONK; D2C catalog needs a Shopify sync."),
    ("T4 · Fulfilment & Delivery", ["fulfil", "shipment", "delivery", "dispatch"],
     "Order-to-delivery covers only carriers that report a delivered timestamp."),
    ("T5 · Support & CX", ["ticket", "support", "helpdesk"],
     "Helpdesk exports (tickets, first-response) must be loaded to appear."),
    ("T6 · Category & Product Revenue", ["category", "revenue", "product"],
     "Category revenue follows the same net-sales basis as T1."),
    ("T7 · Coffee & Subscriptions", ["subscription", "coffee", "loop"],
     "Subscription programme data comes from the Loop/Shopify Subscriptions export."),
]


def render_business_review():
    st.title("Business Review (T1-T7)")
    st.caption(
        "The 8-task D2C review, rebuilt as live views over warehouse tables via the "
        "active session. Each task searches the warehouse for its real source tables; "
        "a task whose data is not in Snowflake shows a declared gap - nothing is "
        "estimated or invented. Read-only."
    )
    tabs = st.tabs([t[0] for t in REVIEW_TASKS])
    for tab, (label, terms, gap) in zip(tabs, REVIEW_TASKS):
        with tab:
            st.subheader(label)
            st.caption(gap)
            table_explorer(label.split(" ")[0].lower(), terms, gap)


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


def render_roles_permissions():
    st.title("Roles & Permissions (T8)")
    st.caption(
        "Platform access audit: staff/collaborator access map, app inventory and "
        "connector scopes (the review's Task 8), plus THIS account's live grants. "
        "Read-only."
    )
    tab_data, tab_session = st.tabs(["Access & app registers", "This session's grants"])
    with tab_data:
        st.caption(
            "Searches the warehouse for the loaded access-audit tables "
            "(user access map, app inventory). Load the registers to light this up."
        )
        table_explorer("t8", ["user", "access", "app", "permission", "audit"],
                       "Load 30_app_inventory / 31_user_access_map into the warehouse to power this tab.")
    with tab_session:
        st.caption("Live from Snowflake for the CURRENT session role - proof of what this app can touch.")
        for label, sql in [
            ("Current context", "select current_user() as user, current_role() as role, "
                                "current_warehouse() as warehouse, current_database() as database"),
            ("Grants to current role", "show grants to role identifier(current_role())"),
        ]:
            st.markdown(f"**{label}**")
            try:
                st.dataframe(q(sql), use_container_width=True, height=240)
            except Exception as e:  # noqa: BLE001
                st.info(f"Not available for this role: {e}")


# ── Route ────────────────────────────────────────────────────────────────────
if section == "Data Analysis":
    render_data_analysis()
elif section == "Ads Analytics":
    render_ads_analytics()
elif section == "Mailer Intelligence":
    render_mailer_intelligence()
elif section.startswith("Business Review"):
    render_business_review()
else:
    render_roles_permissions()

st.markdown("---")
st.caption("Source: Snowflake (Daton / Maplemonk) via get_active_session · read-only · Altair charts · one metric catalog shared with the web app.")
