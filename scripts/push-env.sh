#!/usr/bin/env bash
# push-env.sh — load API keys from a gitignored .env.local into Vercel.
#
# This is the supported path for getting a credential into production without
# it ever passing through a chat transcript, a commit, or this PUBLIC repo.
# It never prints a secret value: only the variable name and its length.
#
# It cannot fetch keys either (see scripts/setup-clis.sh). You paste them into
# .env.local once, from the consoles listed in docs/cli-and-keys.md, and this
# pushes them.
#
# SAFE BY DEFAULT: dry-run unless you pass --apply.
#
# Usage:
#   bash scripts/push-env.sh --check              # what is in .env.local
#   bash scripts/push-env.sh                      # dry run: what WOULD be set
#   bash scripts/push-env.sh --apply              # set them in production
#   ENV_FILE=.env.prod.local bash scripts/push-env.sh --apply
#   TARGET=preview bash scripts/push-env.sh --apply

set -uo pipefail
ENV_FILE="${ENV_FILE:-.env.local}"
TARGET="${TARGET:-production}"
MODE="${1:-dry}"

if [ ! -f "$ENV_FILE" ]; then
  cat <<MSG
No $ENV_FILE found.

Create it (it is gitignored) and put your keys in it, one per line:

  LIVE_CONNECTORS=on
  ANTHROPIC_API_KEY=sk-ant-...
  OPENAI_API_KEY=sk-...
  META_ACCESS_TOKEN=...
  META_AD_ACCOUNT_ID=...
  KLAVIYO_API_KEY=pk_...

Where each one comes from: docs/cli-and-keys.md
MSG
  exit 1
fi

# Refuse to touch a file git is tracking. A secret in a tracked file is already
# a leak in a public repo, and pushing it would only spread it further.
if git ls-files --error-unmatch "$ENV_FILE" >/dev/null 2>&1; then
  echo "REFUSING: $ENV_FILE is tracked by git. This repository is PUBLIC."
  echo "Run: git rm --cached $ENV_FILE   and rotate every key in it."
  exit 2
fi

names=()
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  [ "${line#*=}" = "$line" ] && continue          # no '=' on the line
  k="${line%%=*}"; v="${line#*=}"
  k="$(printf '%s' "$k" | tr -d '[:space:]')"
  [ -z "$k" ] && continue
  [ -z "$v" ] && { printf '  skip     %-28s (empty)\n' "$k"; continue; }
  printf '  ready    %-28s (len %s)\n' "$k" "${#v}"
  names+=("$k")
done < <(cat "$ENV_FILE"; echo)

echo
echo "${#names[@]} variable(s) in $ENV_FILE, target: $TARGET"

if [ "$MODE" = "--check" ]; then exit 0; fi

if [ "$MODE" != "--apply" ]; then
  echo
  echo "DRY RUN. Each of the above would be pushed with:"
  echo "  vercel env add <NAME> $TARGET   (value piped from $ENV_FILE, never echoed)"
  echo "Re-run with --apply to actually set them."
  exit 0
fi

# Only the write path needs the CLI. A dry run never calls vercel, so demanding
# it there would stop you previewing an env file on a machine without it.
if ! command -v vercel >/dev/null 2>&1; then
  echo "vercel CLI not found. Run: bash scripts/setup-clis.sh"
  exit 1
fi

echo
for k in "${names[@]}"; do
  v="$(grep -m1 "^${k}=" "$ENV_FILE")"; v="${v#*=}"
  printf '  push     %-28s ' "$k"
  # Remove first so a re-run updates rather than erroring on an existing key.
  vercel env rm "$k" "$TARGET" --yes >/dev/null 2>&1
  if printf '%s' "$v" | vercel env add "$k" "$TARGET" >/dev/null 2>&1; then
    echo "set"
  else
    echo "FAILED (is 'vercel login' done and the project linked?)"
  fi
done

echo
echo "Done. Redeploy for them to take effect:  vercel --prod"
echo "Then verify:  curl -s https://vahdam-lifecycle-os.anchit-tandon.com/api/connectors-health | jq"
