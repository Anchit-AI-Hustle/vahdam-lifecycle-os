"""meta_rows() sits behind a branch the sweep does not reach, so drive it directly
and assert the five platform-reported ratio columns are impression-weighted. These
five are what SOURCED_EQUIVALENT compares the catalog's derived value against, so a
naive avg() here silently corrupts the accuracy calculator's own agreement score."""
import sys, re
sys.path.insert(0, '.')
import stub
from stub import SQL_LOG
import app_under_test as app

SQL_LOG.clear()
df = app.meta_rows(None, "Campaign", "2026-06-01", "2026-07-26")
sql = [s for s in SQL_LOG if "nulls last limit 500" in s and "inline_link_click_ctr" in s]
if not sql:
    print("FAIL - meta_rows emitted no recognisable query"); sys.exit(1)
s = re.sub(r"\s+", " ", sql[0])
print("emitted:\n  " + s[:430] + "\n")
bad = []
for col in ("frequency", "ctr", "cpc", "cpm", "inline_link_click_ctr"):
    if re.search(rf"\bavg\(\s*{col}\s*\)", s, re.I):
        bad.append(f"{col}: still a naive avg()")
    elif f"sum({col} * impressions)" not in s:
        bad.append(f"{col}: not impression-weighted")
print("returned columns:", ", ".join(df.columns) if hasattr(df, "columns") else "(none)")
if bad:
    print("\nFAILURES:"); [print("  -", b) for b in bad]; sys.exit(1)
print("\nPASS - all five sourced ratio columns are impression-weighted")
