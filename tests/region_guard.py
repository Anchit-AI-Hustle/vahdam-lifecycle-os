"""Every region must render without an exception, and must read only ITS OWN
market's tables. A region control that silently falls back to the US feeds would
report US spend under a UK heading, which no amount of care downstream can undo."""
import sys, re
sys.path.insert(0, '.')
import stub
from stub import ST, SQL_LOG

# Table fragments that identify each market. A region's SQL must not contain
# another market's fragment.
MARKERS = {
    "US":     ["META_USA_ADS_INSIGHTS", "US_GOOGLE_ADS_CONSOLIDATED", "USA_TEA_ADS", "TIKTOK_USA"],
    "UK":     ["META_UK_ADS_INSIGHTS", "GOOGLE_ADS_UK", "TIKTOK_UK"],
    "India":  ["META_INDIA_ADS_INSIGHTS", "INDIA_GOOGLE_ADS_CONSOLIDATED"],
    "Global": ["GLOBAL_GOOGLE_ADS_CONSOLIDATED"],
}
FOREIGN = {r: [m for other, ms in MARKERS.items() if other != r for m in ms] for r in MARKERS}
# US markers are substrings of nothing else; UK/INDIA appear inside their own names only.

bad = []
print(f"{'region':8}{'sql':>6}{'own-market tables':>20}   leaks")
print("-" * 62)
for reg in MARKERS:
    SQL_LOG.clear()
    ST.CHOICES = {"Region": reg, "Section": "Ads Analysis",
                  "Analysis view": "Ad accounts & retail funnel"}
    ST.VIEW = "Ad accounts & retail funnel"
    sys.modules.pop("app_under_test", None)
    try:
        import app_under_test  # noqa: F401
    except SystemExit:
        pass
    except Exception as e:  # noqa: BLE001
        bad.append(f"{reg}: raised {type(e).__name__}: {e}")
        print(f"{reg:8}{'-':>6}{'-':>20}   RAISED {type(e).__name__}")
        continue
    blob = " ".join(SQL_LOG).upper()
    own = sum(1 for m in MARKERS[reg] if m.upper() in blob)
    # A leak = another market's identifying table appearing in this region's SQL.
    leaks = sorted({m for m in FOREIGN[reg] if m.upper() in blob
                    and not any(m.upper() in o.upper() and o != m for o in MARKERS[reg])})
    if leaks:
        bad.append(f"{reg}: reads other markets -> {', '.join(leaks)}")
    print(f"{reg:8}{len(SQL_LOG):>6}{own:>20}   {', '.join(leaks) or 'none'}")

print()
if bad:
    print("FAILURES:")
    for b in bad:
        print("  -", b)
    sys.exit(1)
print("PASS - all four regions render, each reading only its own market's tables")
