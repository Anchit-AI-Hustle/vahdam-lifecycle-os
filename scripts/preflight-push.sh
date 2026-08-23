#!/usr/bin/env bash
# preflight-push.sh — run everything that CAN be checked here, before pushing.
#
# Written after a session in which six pushes went red on CI. The instructive
# part: not one of them would have been caught by running the test suite, which
# was already being done every time. They failed for reasons a plain local run
# cannot see:
#
#   env-dependent spec   passed locally because the CLIs were installed here,
#                        failed on a bare CI runner   -> BARE PATH stage below
#   unused import        no linter existed             -> LINT stage below
#   regex / escaping x3  static analysis, not a test   -> LINT (no-useless-escape)
#   WebKit-only layout   WebKit cannot be installed in this sandbox: NOT
#                        coverable here, and this script says so rather than
#                        implying a green run means CI will pass
#
# Exit non-zero on the first real failure. Nothing here is advisory.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
# --fast skips the 8-minute browser suite, for iterating. It is NOT a substitute
# for the full run before a push, and the summary says so.
FAST=0; [ "${1:-}" = "--fast" ] && FAST=1
fail=0
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
bad()  { printf '   FAILED: %s\n' "$1"; fail=1; step_fail=1; }
begin(){ step_fail=0; step "$1"; }
fine(){ [ "$step_fail" = 0 ] && echo "   ok"; }

begin "1/5  Syntax — standalone JS (mirrors the CI step)"
for f in $(find api lib workers scripts -name '*.js' 2>/dev/null); do
  node --check "$f" >/dev/null 2>&1 || bad "node --check $f"
done
for f in *.js; do [ -f "$f" ] && { node --check "$f" >/dev/null 2>&1 || bad "node --check $f"; }; done
fine

begin "2/5  Lint — correctness rules only, warnings do not block"
if npx --no-install eslint --version >/dev/null 2>&1; then
  npx --no-install eslint . --max-warnings=-1 || bad "eslint reported an error"
  [ "$step_fail" = 0 ] && echo "   ok (warnings are visible above and non-blocking)"
else
  echo "   SKIPPED: eslint not installed (npm install)"
fi

begin "3/5  Inline JS in every page parses"
# Run the REAL spec rather than a copy of its logic. The first version of this
# script reimplemented the extractor here and immediately drifted - it did not
# handle type="module", so it reported 7 false failures the spec does not. That
# is the same defect this repo keeps recording (nine copies of the URL map, a
# second sign-in implementation): a local copy of shared logic goes stale the
# moment the original learns something.
npx playwright test tests/inline-js-parses.spec.js --project=desktop-1280 --reporter=line 2>&1 | tail -3
[ "${PIPESTATUS[0]}" -eq 0 ] || bad "an inline script does not parse"

begin "4/5  Env-dependent scripts under a BARE PATH (what CI actually has)"
BARE=$(mktemp -d)
for b in bash sh env cat grep sed tr printf git rm node; do
  src=$(command -v "$b" 2>/dev/null) && ln -sf "$src" "$BARE/$b"
done
for s in scripts/setup-clis.sh scripts/push-env.sh; do
  [ -f "$s" ] || continue
  if [ "$s" = "scripts/push-env.sh" ]; then
    printf 'A=1\n' > "$BARE/.env"; out=$(env PATH="$BARE" ENV_FILE="$BARE/.env" bash "$s" --check 2>&1); rc=$?
  else
    out=$(env PATH="$BARE" bash "$s" --check 2>&1); rc=$?
  fi
  [ "$rc" -eq 0 ] || bad "$s --check exits $rc with no CLIs on PATH (CI has none)"
done
fine
rm -rf "$BARE"

if [ "$FAST" = 1 ]; then
  printf '\n\033[1m== 5/5  Chromium test suite\033[0m\n   SKIPPED (--fast). Run without --fast before pushing.\n'
  printf '\n%s\n' "$([ "$fail" = 0 ] && echo 'FAST CHECKS PASSED — still run the full preflight before pushing.' || echo 'PREFLIGHT FAILED — fix the above.')"
  exit "$fail"
fi
begin "5/5  Chromium test suite"
if [ -z "${PW_CHROMIUM_PATH:-}" ] && [ -x /opt/pw-browsers/chromium-1194/chrome-linux/chrome ]; then
  export PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
  echo "   PW_CHROMIUM_PATH defaulted (a local run without it silently runs NO browser)"
fi
npx playwright test --project=desktop-1280 --reporter=line 2>&1 | tail -4
# tail hides the summary, so read the real status from the pipeline, not the tail
[ "${PIPESTATUS[0]}" -eq 0 ] || bad "playwright (desktop-1280)"

printf '\n'
if [ "$fail" = 0 ]; then
  cat <<'MSG'
PREFLIGHT PASSED — safe to push.
NOT covered here, so CI is still the authority on:
  · the three WebKit projects (WebKit cannot be installed in this sandbox)
  · CodeQL (static analysis runs on GitHub, not locally)
MSG
  exit 0
fi
echo "PREFLIGHT FAILED — fix the above before pushing."
exit 1
