"""Run streamlit_app.py with a stubbed Streamlit + a recording Snowflake session.
Executes every module-level path and the selected view, catching real Python errors
and capturing every SQL statement the app builds."""
import sys, types, re, traceback
import pandas as pd

SQL_LOG = []

# Real column sets, read from the warehouse 2026-07-26. The point of the harness is to
# test the app's COLUMN RESOLUTION, so a stub that claims every table has account_name
# would hide exactly the bugs we are hunting.
SCHEMAS = {
 "tiktok": [("accountid","TEXT"),("accountname","TEXT"),("campaign_name","TEXT"),
   ("ad_name","TEXT"),("adgroup_name","TEXT"),("stat_time_day","DATE"),("spend","NUMBER"),
   ("impressions","NUMBER"),("clicks","NUMBER"),("reach","NUMBER"),("ctr","NUMBER"),
   ("cpc","NUMBER"),("cpm","NUMBER"),("frequency","NUMBER"),("conversion","NUMBER"),
   ("conversion_rate","NUMBER"),("cost_per_conversion","NUMBER"),("video_watched_2s","NUMBER"),
   ("video_watched_6s","NUMBER"),("video_views_p25","NUMBER"),("video_views_p100","NUMBER"),
   ("likes","NUMBER"),("shares","NUMBER"),("comments","NUMBER"),("currency","TEXT")],
 "google_consolidated": [("ad_group_name","TEXT"),("ad_group_ad_id","NUMBER"),
   ("campaign_name","TEXT"),("campaign_id","NUMBER"),("segments_date","DATE"),
   ("ad_group_ad_ad_type","TEXT"),("ad_group_ad_ad_strength","TEXT"),
   ("segments_ad_network_type","TEXT"),("segments_day_of_week","TEXT"),("year","NUMBER"),
   ("month","NUMBER"),("channel","TEXT"),("account","TEXT"),("clicks","NUMBER"),
   ("outbound_clicks","TEXT"),("spend","NUMBER"),("impressions","NUMBER"),
   ("conversions","FLOAT"),("conversion_value","FLOAT")],
 "gads_report": [("campaign.name","TEXT"),("ad_group.name","TEXT"),("segments.date","DATE"),
   ("customer.descriptive_name","TEXT"),("customer.id","TEXT"),("metrics.cost_micros","NUMBER"),
   ("metrics.impressions","NUMBER"),("metrics.clicks","NUMBER"),("metrics.ctr","FLOAT"),
   ("metrics.conversions","FLOAT"),("metrics.conversions_value","FLOAT")],
 "meta": [("campaign_name","TEXT"),("adset_name","TEXT"),("ad_name","TEXT"),("ad_id","TEXT"),
   ("account_name","TEXT"),("date_start","DATE"),("date_stop","DATE"),("created_time","DATE"),
   ("updated_time","DATE"),("spend","FLOAT"),("impressions","NUMBER"),("clicks","NUMBER"),
   ("reach","NUMBER"),("inline_link_clicks","NUMBER"),("unique_clicks","NUMBER"),
   ("inline_post_engagement","NUMBER"),("ctr","FLOAT"),("cpc","FLOAT"),("cpm","FLOAT"),
   ("cpp","FLOAT"),("frequency","FLOAT"),("unique_ctr","FLOAT"),("objective","TEXT"),
   ("quality_ranking","TEXT"),("engagement_rate_ranking","TEXT"),
   ("conversion_rate_ranking","TEXT"),("actions","VARIANT"),("action_values","VARIANT"),
   ("purchase_roas","VARIANT"),("cost_per_inline_link_click","FLOAT"),
   ("estimated_ad_recallers","FLOAT"),("auction_bid","FLOAT"),
   ("video_p25_watched_actions","VARIANT"),("video_p100_watched_actions","VARIANT"),
   ("video_thruplay_watched_actions","VARIANT"),
   ("video_continuous_2_sec_watched_actions","VARIANT"),
   ("_airbyte_emitted_at","TIMESTAMP_TZ")],
 "meta_ag": None,   # meta + age/gender, filled below
 "roundel": [("event date","TEXT"),("campaign name","TEXT"),("account name","TEXT"),
   ("impressions","TEXT"),("clicks","TEXT"),("ctr","TEXT"),("roas","TEXT"),
   ("actualized vendor spend","TEXT"),("attributed total sales","TEXT"),
   ("attributed total units","TEXT")],
 "jb": [("campaign name","TEXT"),("platform","TEXT"),("creator name","TEXT"),
   ("creator username","TEXT"),("see post","TEXT"),("video id","TEXT"),
   ("posted date","TEXT"),("job price (usd)","FLOAT"),("video views","TEXT"),
   ("likes","TEXT"),("comments","FLOAT")],
}
SCHEMAS["meta_ag"] = SCHEMAS["meta"] + [("age","TEXT"),("gender","TEXT")]

def _schema_for(sql: str):
    low = sql.lower()
    if "tiktok" in low: return SCHEMAS["tiktok"]
    if "us_google_ads_consolidated" in low: return SCHEMAS["google_consolidated"]
    if "gads" in low and "report" in low: return SCHEMAS["gads_report"]
    if "target_ads_day" in low or "target_sales" in low: return SCHEMAS["roundel"]
    if "jb_usa" in low: return SCHEMAS["jb"]
    if "age_and_gender" in low or "platform_and_device" in low: return SCHEMAS["meta_ag"]
    if "_actions" in low or "_action_values" in low:
        return [("action_type","TEXT"),("value","TEXT"),("1d_click","TEXT"),("7d_click","TEXT"),
                ("28d_click","TEXT"),("1d_view","TEXT"),("7d_view","TEXT"),("28d_view","TEXT"),
                ("action_target_id","TEXT"),("action_destination","TEXT"),
                ("_airbyte_emitted_at","TIMESTAMP_TZ")]
    return SCHEMAS["meta"]


# ── fake snowflake session ───────────────────────────────────────────────────
def _synth(sql: str) -> pd.DataFrame:
    """Return a frame shaped like what the query asks for, so downstream code runs."""
    low = sql.lower()
    # information_schema.columns -> column_name/data_type
    if "information_schema.columns" in low:
        if "listagg" in low:
            return pd.DataFrame({"sel": ['sum("SPEND") as spend']})
        sch = _schema_for(sql)
        return pd.DataFrame({"column_name":[c for c,_ in sch],
                             "data_type":[t for _,t in sch],
                             "ordinal_position": list(range(1, len(sch)+1))})
    if "information_schema.tables" in low:
        # discover_tables() asks for "... as fqn, row_count, bytes". Returning only
        # table_schema/table_name made found["fqn"] a KeyError, so every caller of
        # table_explorer died or bailed and the Ads Intelligence discovery tabs went
        # unexercised. Answer the shape the query actually requests.
        if " as fqn" in low:
            # Mirror the columns discover_tables actually selects, including
            # table_schema/table_name (it filters on them) and a couple of rows it
            # must FILTER OUT: an _AIRBYTE_RAW_ scratch table and another market's
            # feed. A stub that only returns clean rows cannot exercise either filter.
            return pd.DataFrame({
                "fqn": ["VAHDAM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS",
                        "VAHDAM_DB.MAPLEMONK.USA_TEA_ADS_ADS_INSIGHTS",
                        "VAHDAM_DB.MAPLEMONK._AIRBYTE_RAW_META_USA_ADS_INSIGHTS",
                        "VAHDAM_DB.MAPLEMONK.AMAZONADS_UK_MARKETING"],
                "table_schema": ["MAPLEMONK"] * 4,
                "table_name": ["META_USA_ADS_INSIGHTS", "USA_TEA_ADS_ADS_INSIGHTS",
                               "_AIRBYTE_RAW_META_USA_ADS_INSIGHTS", "AMAZONADS_UK_MARKETING"],
                "row_count": [129951, 6736, 502052, 7491600],
                "bytes": [284000000, 61000000, 900000000, 178554880]})
        return pd.DataFrame({"table_schema": ["MAPLEMONK","MAPLEMONK"],
                             "table_name": ["META_USA_ADS_INSIGHTS","USA_TEA_ADS_ADS_INSIGHTS"]})
    if "query_history" in low:
        return pd.DataFrame({"sec":[1.0]})
    # derive aliases from "as <alias>"
    aliases = re.findall(r'\bas\s+"?([A-Za-z_][A-Za-z0-9_]*)"?', sql, re.I)
    aliases = [a for a in aliases if a.lower() not in ("select","from","where")]
    if not aliases:
        aliases = ["c0"]
    row = {}
    for a in aliases:
        al = a.lower()
        if any(k in al for k in ("name","type","status","platform","account","creator","handle",
                                 "post","url","tier","rule","campaign","adset","ad","label",
                                 "objective","age","gender","bucket","candidates","id")):
            row[a] = "x"
        elif al in ("d", "dt", "wk") or any(k in al for k in ("day","date","created","edited","served","d0","d1","mx","period")):
            row[a] = pd.Timestamp("2026-07-01")
        else:
            row[a] = 1.0
    return pd.DataFrame([row, dict(row)])

class FakeSession:
    def sql(self, q):
        SQL_LOG.append(q)
        outer = self
        class R:
            def to_pandas(self_inner):
                return _synth(q)
        return R()

snow = types.ModuleType("snowflake"); snow.__path__=[]
sp = types.ModuleType("snowflake.snowpark"); sp.__path__=[]
ctx = types.ModuleType("snowflake.snowpark.context")
ctx.get_active_session = lambda: FakeSession()
sys.modules["snowflake"]=snow; sys.modules["snowflake.snowpark"]=sp
sys.modules["snowflake.snowpark.context"]=ctx

# ── fake streamlit ───────────────────────────────────────────────────────────
CALLS = {"dataframe":0,"metric":0,"markdown":0,"altair_chart":0,"warning":0,"info":0}
class Ctx:
    def __enter__(self): return self
    def __exit__(self,*a): return False
class Col(Ctx):
    def __getattr__(self, n): return getattr(ST, n)
class FakeST(types.ModuleType):
    VIEW = None
    CHOICES = {}
    def __getattr__(self, name):
        # any unknown attribute becomes a no-op callable
        def _f(*a, **k):
            CALLS[name] = CALLS.get(name,0)+1
            return None
        return _f
    # widgets return defaults
    def radio(self, label, options, **k):
        o=list(options)
        want=self.CHOICES.get(label)
        if want is not None and want in o: return want
        if self.VIEW and self.VIEW in o: return self.VIEW
        return o[0] if o else None
    def selectbox(self, label, options, index=0, **k):
        o=list(options)
        want=self.CHOICES.get(label)
        if want is not None:
            if want in o: return want
            # Options are often DECORATED with the bare value plus context, e.g.
            # "db.schema.TABLE   (129,951 rows)" or "ctr  (impression-weighted avg)".
            # Match on the value the test asked for rather than requiring the test to
            # know the decoration, which otherwise silently falls through to o[0] —
            # the placeholder — and skips the whole branch under test.
            for x in o:
                if isinstance(x, str) and (x.startswith(want) or x.split("  (")[0] == want):
                    return x
        return o[index] if o else None
    def multiselect(self, label, options, default=None, **k):
        return list(default) if default is not None else []
    def checkbox(self, *a, **k): return False
    def text_input(self, label, value="", **k): return value
    def date_input(self, label, value=None, **k): return value
    def button(self, *a, **k): return False
    def download_button(self, *a, **k): return False
    def slider(self, label, mn, mx, value=None, **k): return value if value is not None else mn
    def number_input(self, label, value=0, **k): return value
    def columns(self, spec, **k):
        n = spec if isinstance(spec,int) else len(spec)
        return [Col() for _ in range(max(1,n))]
    def tabs(self, labels): return [Ctx() for _ in labels]
    def container(self, **k): return Ctx()
    def expander(self, *a, **k): return Ctx()
    def form(self, *a, **k): return Ctx()
    def spinner(self, *a, **k): return Ctx()
    def dataframe(self, df=None, **k):
        CALLS["dataframe"]+=1
        if df is not None and hasattr(df,"to_dict"): df.to_dict()   # force materialise
    def metric(self, *a, **k): CALLS["metric"]+=1
    def markdown(self, *a, **k): CALLS["markdown"]+=1
    def altair_chart(self, ch=None, **k):
        CALLS["altair_chart"]+=1
        if ch is not None and hasattr(ch,"to_dict"): ch.to_dict()   # force spec build
    def warning(self, *a, **k): CALLS["warning"]+=1
    def info(self, *a, **k): CALLS["info"]+=1
    def set_page_config(self, **k): pass
    def cache_data(self, *a, **k):
        def deco(fn): return fn
        if a and callable(a[0]): return a[0]
        return deco
    def get_option(self, name): return "light"
    def rerun(self): raise SystemExit("rerun")
    @property
    def sidebar(self): return self
    # A real, persistent dict. The first version returned a fresh {} on every access, so
    # anything the app stored vanished immediately and every session_state branch silently
    # took its default path - the harness reported "no error" while never executing the
    # code under test. Same failure mode as the fake column list: a stub that lies
    # manufactures confidence.
    _SS = {}
    @property
    def session_state(self): return FakeST._SS
ST = FakeST("streamlit")
ST.cache_resource = ST.cache_data
sys.modules["streamlit"]=ST
