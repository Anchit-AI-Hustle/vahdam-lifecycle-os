"""Regression guard for the bug that once printed CTR 3,891 against a true 4.71.

Two independent assertions, because the original defect had two halves:

  1. table_explorer must aggregate in SQL. The original grouped a 1,000-row fetch
     in pandas, so a "weekly trend" on a 412k-row table was really the last few
     days. Zero date_trunc SQL while the explorer renders => that design is back.
  2. No ratio column may ever be summed. Ratios must be impression-weighted (or
     explicitly averaged when the table has no impressions column).
"""
import sys, re
sys.path.insert(0, '.')
import stub
from stub import ST, SQL_LOG

TABLE = "VAHDAM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS"
RATIOS = ["ctr", "cpc", "cpm", "frequency", "inline_link_click_ctr"]
LABELS = ["{r}  (impression-weighted avg)", "{r}  (plain avg)", "{r}"]

trend_sql, bad, checked = [], [], set()
for r in RATIOS:
    for tpl in LABELS:
        SQL_LOG.clear()
        ST.CHOICES = {"Section": "Ads Intelligence", "Table to analyse": TABLE,
                      "Measure": tpl.format(r=r),      # current picker
                      "Measure (sum)": r}              # pre-fix picker
        ST.VIEW = "Ads Intelligence"
        sys.modules.pop("app_under_test", None)
        try:
            import app_under_test  # noqa: F401
        except SystemExit:
            pass
        except Exception as e:  # noqa: BLE001
            bad.append(f"{r}: raised {type(e).__name__}: {e}")
            continue
        weekly = [s for s in SQL_LOG if "date_trunc('week'" in s]
        trend_sql += weekly
        for s in weekly:
            if f'"{r.upper()}"' not in s.upper():
                continue                              # this attempt selected another column
            checked.add(r)
            if re.search(rf'sum\(\s*"{r.upper()}"\s*\)', s, re.I):
                bad.append(f"{r}: SUMMED -> {s[:140]}")
            elif not re.search(r'IMPRESSIONS|avg\(', s, re.I):
                bad.append(f"{r}: neither weighted nor averaged -> {s[:140]}")

print(f"[1] SQL-side aggregation: {len(set(trend_sql))} distinct weekly-trend statements emitted")
if not trend_sql:
    print("    FAIL - the explorer drew its trend without any SQL aggregation, so it is\n"
          "           grouping a fetched sample client-side again.")
    sys.exit(1)
print(f"[2] ratio columns verified: {', '.join(sorted(checked)) or 'NONE'}")
for s in sorted({s for s in trend_sql if re.search(r'"(CTR|CPC|CPM|FREQUENCY)"', s)})[:3]:
    print("    ", s[:150])
if not checked:
    print("    FAIL - no ratio column reached the aggregation, so rule 2 is untested.")
    sys.exit(1)
if bad:
    print("\nFAILURES:")
    for b in bad:
        print("  -", b)
    sys.exit(1)
print("\nPASS - aggregation happens in SQL, and every ratio column is weighted, never summed")
