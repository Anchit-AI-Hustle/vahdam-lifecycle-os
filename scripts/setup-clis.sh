#!/usr/bin/env bash
# setup-clis.sh — install every command-line tool this project can actually use.
#
# WHAT THIS SCRIPT CANNOT DO, and why it is worth saying out loud:
# no CLI here will hand you an API key. That is not a gap in the tooling, it is
# how the providers are built. Both AI CLIs CONSUME a credential you already
# hold and neither can emit one:
#
#   claude auth            -> login | logout | status.   No key subcommand.
#   codex login --with-api-key  -> READS a key from stdin.
#
# Anthropic and OpenAI issue API keys from their web consoles only, and show the
# value exactly once at creation. Same rule the repo already follows in
# scripts/preflight-credentials.sh ("cannot mint or fetch secrets"). To load
# keys, put them in a gitignored .env.local and run scripts/push-env.sh.
#
# Usage:
#   bash scripts/setup-clis.sh            # install everything that is missing
#   bash scripts/setup-clis.sh --check    # report only, install nothing
#
# Idempotent: an already-present CLI is left alone.

set -uo pipefail
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

ok=0; missing=0; installed=0

have() { command -v "$1" >/dev/null 2>&1; }

# name | install command | what it is for in this repo
npm_cli() {
  local bin="$1" pkg="$2" purpose="$3"
  if have "$bin"; then printf '  ok       %-10s %s\n' "$bin" "$purpose"; ok=$((ok+1)); return; fi
  if [ "$CHECK_ONLY" = 1 ]; then printf '  MISSING  %-10s %s\n' "$bin" "$purpose"; missing=$((missing+1)); return; fi
  printf '  install  %-10s ...' "$bin"
  if npm install -g "$pkg" >/dev/null 2>&1 && have "$bin"; then
    printf ' done\n'; installed=$((installed+1))
  else
    printf ' FAILED (network policy or registry). Install by hand: npm i -g %s\n' "$pkg"; missing=$((missing+1))
  fi
}

echo "Deploy + data CLIs"
npm_cli vercel   vercel          "deploy, and the ONLY supported way to set production env vars"
npm_cli supabase supabase        "migrations in supabase/migrations, local Postgres"
npm_cli shopify  @shopify/cli    "theme + storefront work (catalog reads go through /api/catalog)"
npm_cli wrangler wrangler        "Cloudflare Workers AI rung of the llm.js waterfall"

echo
echo "AI CLIs (they consume credentials, they never issue them)"
npm_cli claude   @anthropic-ai/claude-code  "Claude Code"
npm_cli codex    @openai/codex              "OpenAI Codex"

echo
echo "Already covered without a global install"
printf '  ok       %-10s %s\n' "npx" "playwright (npm test), the repo build scripts"
printf '  note     %-10s %s\n' "gh" "not installed: this repo uses the GitHub MCP tools instead"

echo
echo "No CLI exists for these — they are REST-only, keys come from their console:"
echo "  Meta Ads · Google Ads · TikTok Ads · Klaviyo · WebEngage"

echo
echo "present: $ok   installed: $installed   missing: $missing"
echo "Next: bash scripts/setup-clis.sh --check   then   bash scripts/push-env.sh --check"

# --check is documented as "report only". A report that fails the shell is a
# surprise, and it makes the script unusable anywhere the CLIs are legitimately
# absent (a CI runner, a fresh clone). Only the INSTALL path reports failure,
# because there a missing CLI means an install actually did not work.
if [ "$CHECK_ONLY" = 1 ]; then exit 0; fi
[ "$missing" -gt 0 ] && exit 1
exit 0
