import sys, traceback, json
sys.path.insert(0, '.')
import stub
from stub import ST, SQL_LOG, CALLS

VIEWS = ["Ad accounts & retail funnel","Platform parity — every metric","Omnichannel Master View",
         "Comparison Engine","Cohort Exploration","Overview & priority metrics",
         "Single entity deep-dive","Ad explorer (all fields)","Spend tracker",
         "UGC creators, scoring & paid performance"]
SECTIONS = ["Ad Campaigns Master","Ads Analysis","Ads Intelligence"]

results=[]
PLATFORMS = ["Meta Ads", "Google Ads", "TikTok Ads"]
TARGETS = [(t, None) for t in SECTIONS] + [(v, p) for v in VIEWS for p in PLATFORMS]
for target, plat in TARGETS:
    SQL_LOG.clear(); [CALLS.__setitem__(k,0) for k in list(CALLS)]
    if target in SECTIONS:
        ST.CHOICES = {"Section": target}
        # Ads Intelligence's discovery tabs are gated behind a "pick a table"
        # selectbox whose first option is the placeholder "—", so with the default
        # stub choice table_explorer returned immediately and those three tabs were
        # NEVER executed by this harness -- which is exactly how a ratio-summing
        # chart and a missing Airbyte-dedup warning survived in there. Pick a real
        # table so the body runs.
        ST.CHOICES["Table to analyse"] = "VAHDAM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS"
    else:
        ST.CHOICES = {"Section": "Ads Analysis", "Analysis view": target}
        if plat: ST.CHOICES["Channel"] = plat
    ST.VIEW = target
    for m in [k for k in list(sys.modules) if k=='app_under_test']: del sys.modules[m]
    try:
        import app_under_test  # noqa
        err=None
    except SystemExit:
        err=None
    except Exception as e:
        err=f"{type(e).__name__}: {e}"
        tb=traceback.format_exc().strip().split('\n')
        err += " || " + " <- ".join(l.strip() for l in tb[-4:-1])
    results.append({"target":target + (f"  [{plat}]" if plat else ""),"error":err,"sql":len(SQL_LOG),
                    "tables":CALLS.get("dataframe",0),"charts":CALLS.get("altair_chart",0),
                    "metrics":CALLS.get("metric",0)})
    with open(f"sql_{abs(hash(target))%10**6}.txt","w") as f: f.write("\n;;;\n".join(SQL_LOG))

ok=sum(1 for r in results if not r["error"])
print(f"{ok}/{len(results)} targets executed with NO Python error\n")
print(f"{'target':46s} {'sql':>4s} {'tbl':>4s} {'cht':>4s} {'met':>4s}  error")
for r in results:
    print(f"{r['target'][:44]:46s} {r['sql']:>4d} {r['tables']:>4d} {r['charts']:>4d} "
          f"{r['metrics']:>4d}  {r['error'] or '-'}")
json.dump(results, open("results.json","w"), indent=1)
