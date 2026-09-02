#!/usr/bin/env bash
# Copy compliance: banned phrases, em/en dashes, emoji.
# Scans DELIVERABLES only. Run from the campaign root.
set -uo pipefail
FILES=$(ls build/ads.js build/reels.js email/*.html reels/*.md creator/*.md 2>/dev/null)
fail=0
echo "== banned phrases =="
while IFS= read -r p; do
  n=$(grep -rioF "$p" $FILES 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" -eq 0 ]; then printf "  OK    %s\n" "$p"
  # `transform` collides with the CSS property text-transform. Count only the
  # hits that are NOT that property, so the check stays meaningful instead of
  # being switched off wholesale.
  elif [ "$p" = "transform" ]; then
    real=$(grep -rioE "(^|[^-])transform" $FILES 2>/dev/null | grep -vi "text-transform" | wc -l | tr -d ' ')
    if [ "$real" -eq 0 ]; then printf "  OK    %s (%s CSS text-transform hits ignored)\n" "$p" "$n"
    else printf "  FAIL  %s (%s in copy)\n" "$p" "$real"; fail=1; fi
  else printf "  FAIL  %s (%s)\n" "$p" "$n"; fail=1; fi
done <<'EOF'
wellness journey
transform
liquid gold
game-changer
LIMITED TIME
hurry
don't miss out
last chance
while supplies last
EOF

echo "== em/en dashes =="
n=$(grep -roP '[\x{2013}\x{2014}]' $FILES 2>/dev/null | wc -l | tr -d ' ')
[ "$n" -eq 0 ] && echo "  OK    0 found" || { echo "  FAIL  $n found"; fail=1; }

echo "== emoji =="
n=$(grep -roP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' $FILES 2>/dev/null | wc -l | tr -d ' ')
[ "$n" -eq 0 ] && echo "  OK    0 found" || { echo "  FAIL  $n found"; fail=1; }

echo; [ "$fail" -eq 0 ] && echo "copy checks: PASS" || echo "copy checks: FAIL"
exit $fail
