"""
VAHDAM Lifecycle OS — Ads Analysis (Streamlit in Snowflake).

Runs NATIVELY inside Snowflake: authentication and warehouse come from the
logged-in Snowflake session via get_active_session() — no external keys, no PAT,
no Supabase. All figures are read directly (read-only) from the warehouse tables
the Daton / Maplemonk pipelines already load. Charts use Altair (not Plotly).

Covers Meta / Google / TikTok for the Costco + Target US accounts: portfolio
priority metrics, per-campaign and per-ad performance, and demographic / geo /
device cohorts — the same analysis the web dashboard shows, sourced from
Snowflake instead of Supabase.

Deploy: see snowflake/streamlit/deploy.sql (CREATE STREAMLIT ...). The app URL is
minted by Snowflake when the Streamlit object is created in your account.
"""

import altair as alt
import pandas as pd
import streamlit as st
from snowflake.snowpark.context import get_active_session

# ── Session (always) ─────────────────────────────────────────────────────────
session = get_active_session()

st.set_page_config(page_title="VAHDAM Ads Analysis", layout="wide")

# Brand palette
GREEN, GOLD, INK, CREAM = "#004A2B", "#AB8743", "#171717", "#FBF5EA"

# ── Source tables (verified live) ────────────────────────────────────────────
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

BUDGETS = {"target": 1000, "costco": 300}  # daily caps (USD), reference only


@st.cache_data(ttl=600, show_spinner=False)
def q(sql: str) -> pd.DataFrame:
    """Run a read-only query and return a DataFrame (lower-cased columns)."""
    df = session.sql(sql).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    return df


def acct_clause(col: str, account: str) -> str:
    if not account:
        return ""
    a = account.lower().replace("'", "")
    return f" and lower({col}) like '%{a}%'"


def date_clause(col: str, since, until) -> str:
    if not since or not until:
        return ""
    return f" and {col} between '{since}' and '{until}'"


def money(v):
    return "—" if v is None or pd.isna(v) else f"${v:,.0f}"


def pctf(v):
    return "—" if v is None or pd.isna(v) else f"{v:.2f}%"


# ── Sidebar filters ──────────────────────────────────────────────────────────
st.sidebar.title("VAHDAM · Ads Analysis")
platform = st.sidebar.selectbox("Platform", ["Meta", "Google", "TikTok"])
account = st.sidebar.selectbox("Account", ["All", "target", "costco"])
account = "" if account == "All" else account
level = st.sidebar.selectbox("Level", ["campaign", "ad"])
today = pd.Timestamp.utcnow().normalize()
since = st.sidebar.date_input("Since", (today - pd.Timedelta(days=30)).date())
until = st.sidebar.date_input("Until", today.date())
st.sidebar.markdown("---")
st.sidebar.caption(
    f"Daily budget caps (reference): Target ${BUDGETS['target']:,} · "
    f"Costco ${BUDGETS['costco']:,}. Read-only — never written back."
)

st.title("Ads Analysis")
st.caption(
    "Live from Snowflake via the active session — Meta / Google / TikTok, per "
    "campaign and per ad, for the Costco + Target US accounts. Priority metrics "
    "lead. Read-only; nothing is fabricated."
)

tab_overview, tab_rows, tab_cohorts = st.tabs(
    ["Overview & priority metrics", "Campaign / ad rows", "Cohorts & segmentation"]
)


# ── Meta metric aggregation (columns verified: spend, impressions, reach,
#    frequency, clicks, inline_link_clicks, inline_link_click_ctr, cpc, cpm,
#    account_name, campaign_name, ad_name, date_start) ─────────────────────────
def meta_rows():
    name_col = "ad_name" if level == "ad" else "campaign_name"
    where = "where 1=1" + acct_clause("account_name", account) + date_clause("date_start", since, until)
    sql = f"""
        select {name_col} as name,
               sum(spend) as spend, sum(impressions) as impressions, sum(reach) as reach,
               sum(clicks) as clicks, sum(inline_link_clicks) as link_clicks,
               avg(frequency) as frequency
        from {META_ADS} {where}
        group by {name_col} order by spend desc nulls last limit 500
    """
    df = q(sql)
    if df.empty:
        return df
    df["cpm"] = df["spend"] / df["impressions"].replace(0, pd.NA) * 1000
    df["cpc"] = df["spend"] / df["link_clicks"].replace(0, pd.NA)
    df["cost_per_reach"] = df["spend"] / df["reach"].replace(0, pd.NA)
    df["link_ctr"] = df["link_clicks"] / df["impressions"].replace(0, pd.NA) * 100
    df["ctr"] = df["clicks"] / df["impressions"].replace(0, pd.NA) * 100
    return df


def generic_rows(table):
    """Google / TikTok: return recent rows with whatever columns exist.
    Defensive: Daton/Maplemonk schemas vary, so pull recent rows and let the
    table view show available columns rather than assume a date/account column."""
    sql = f"select * from {table} limit 500"
    try:
        return q(sql)
    except Exception as e:  # noqa: BLE001
        st.info(f"Could not read {table}: {e}")
        return pd.DataFrame()


# ── OVERVIEW ─────────────────────────────────────────────────────────────────
with tab_overview:
    if platform == "Meta":
        df = meta_rows()
        if df.empty:
            st.warning("No Meta rows for this account / window.")
        else:
            spend = df["spend"].sum()
            impr = df["impressions"].sum()
            reach = df["reach"].sum()
            link_clicks = df["link_clicks"].sum()
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
                alt.Chart(top)
                .mark_bar(color=GREEN)
                .encode(
                    x=alt.X("spend:Q", title="Spend (USD)"),
                    y=alt.Y("name:N", sort="-x", title=None),
                    tooltip=["name", alt.Tooltip("spend:Q", format="$,.0f"),
                             alt.Tooltip("link_ctr:Q", format=".2f", title="Link CTR %")],
                )
                .properties(height=28 * len(top))
            )
            st.altair_chart(chart, use_container_width=True)
    else:
        table = GOOGLE_ADS if platform == "Google" else TIKTOK[level if level in TIKTOK else "campaign"]
        st.info(
            f"{platform}: showing recent rows from `{table}`. Column-level metric "
            "mapping for this source is being finalised; Meta has the full "
            "computed priority set."
        )
        df = generic_rows(table)
        st.dataframe(df, use_container_width=True, height=460)


# ── CAMPAIGN / AD ROWS ───────────────────────────────────────────────────────
with tab_rows:
    st.subheader(f"{platform} — per {level}")
    if platform == "Meta":
        df = meta_rows()
        if df.empty:
            st.warning("No rows for this selection.")
        else:
            cols = ["name", "spend", "impressions", "reach", "frequency",
                    "link_clicks", "link_ctr", "ctr", "cpc", "cpm", "cost_per_reach"]
            st.dataframe(df[cols], use_container_width=True, height=520)
    else:
        table = GOOGLE_ADS if platform == "Google" else TIKTOK[level if level in TIKTOK else "campaign"]
        st.dataframe(generic_rows(table), use_container_width=True, height=520)


# ── COHORTS & SEGMENTATION ───────────────────────────────────────────────────
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
            alt.Chart(g)
            .mark_bar(color=GOLD)
            .encode(
                x=alt.X("spend:Q", title="Spend (USD)"),
                y=alt.Y(f"{dim_col}:N", sort="-x", title=title),
                tooltip=[dim_col, alt.Tooltip("spend:Q", format="$,.0f")],
            )
            .properties(height=max(140, 26 * len(g)))
        )
        st.altair_chart(ch, use_container_width=True)

    if platform == "Meta":
        where = "where 1=1" + acct_clause("account_name", account) + date_clause("date_start", since, until)
        col1, col2 = st.columns(2)
        with col1:
            st.markdown("**Age × gender**")
            ag = q(f"select age, gender, sum(spend) as spend from {META_AGE_GENDER} {where} group by age, gender")
            if not ag.empty:
                ag["cohort"] = ag["age"].astype(str) + " · " + ag["gender"].astype(str)
                cohort_chart(ag, "cohort", "Age × gender")
        with col2:
            st.markdown("**Platform / device**")
            dv = q(f"select * from {META_DEVICE} {where} limit 5000")
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

st.markdown("---")
st.caption("Source: Snowflake (Daton / Maplemonk) via get_active_session · read-only · Altair charts.")
