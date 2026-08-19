# CLIs, and where API keys actually come from

## No CLI can fetch an API key. This is by design, not a missing feature.

It is a reasonable thing to expect — you are signed into both tools, so surely
one of them can print the key. Neither can, and the reason is the same on both
sides: what the CLI holds is not an API key.

| Attempt | What actually happens |
|---|---|
| `claude auth` | Subcommands are `login`, `logout`, `status`. There is no key subcommand. |
| `claude auth status` | Returns `{"authMethod": "oauth_token", "apiProvider": "firstParty"}` — a Claude Code **OAuth session**, not an API key. It is scoped to Claude Code and is not an `x-api-key` credential for the Anthropic API. |
| `claude setup-token` | Mints a long-lived token for **Claude Code with a subscription**. Still not an API key, and not valid for arbitrary API calls. |
| `openai` (Python SDK CLI) | **No longer exists.** The `openai` package (v3.x) ships no console script and no `openai.__main__`; `python -m openai` errors. |
| `codex login --with-api-key` | The flag **reads** a key from stdin (`printenv OPENAI_API_KEY \| codex login --with-api-key`). It consumes a key you already hold. |

Both providers issue API keys from their web console only, and show the value
exactly once at creation. That one-time display is the security property — a
key retrievable on demand from a signed-in CLI would be a key any process on
your machine could exfiltrate.

This is the same boundary `scripts/preflight-credentials.sh` has always stated:
it *detects* what is missing and says where to get it; it cannot mint or fetch.

## Install the CLIs

```bash
bash scripts/setup-clis.sh          # install what is missing (idempotent)
bash scripts/setup-clis.sh --check  # report only
```

Installs `vercel`, `supabase`, `shopify`, `wrangler`, `claude`, `codex`.
Meta, Google Ads, TikTok, Klaviyo and WebEngage have **no CLI at all** — they
are REST-only, and their keys come from their consoles.

## Get the keys

Open a console, create the key, paste it straight into `.env.local`
(gitignored). Never into a chat window, never into a tracked file — **this
repository is public**.

| Variable | Console |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API keys → Create key |
| `OPENAI_API_KEY` | platform.openai.com/api-keys → Create new secret key |
| `GEMINI_API_KEY` | aistudio.google.com/apikey (this project has its own restricted GCP key) |
| `XAI_API_KEY` | console.x.ai → API keys |
| `GROQ_API_KEY` | console.groq.com/keys |
| `CEREBRAS_API_KEY` | cloud.cerebras.ai → API keys |
| `KLAVIYO_API_KEY` | Klaviyo → Settings → API keys → Create private key (read scopes) |
| `META_ACCESS_TOKEN` | Business Settings → System users → Generate token (`ads_read`, `read_insights`) |
| `META_AD_ACCOUNT_ID` | Ads Manager, **without** the `act_` prefix |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` (server-only) |
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens |

Per-platform detail for the ad and lifecycle connectors:
[`live-connectors-setup.md`](./live-connectors-setup.md).

## Load them into production

```bash
bash scripts/push-env.sh --check   # what is in .env.local (names + lengths only)
bash scripts/push-env.sh           # dry run: what WOULD be set
bash scripts/push-env.sh --apply   # set them in Vercel production
vercel --prod                      # redeploy so they take effect
```

`push-env.sh` never prints a secret value, and **refuses to run if `.env.local`
is tracked by git** — a secret in a tracked file in a public repo is already
leaked, and pushing it would only spread it.

Verify afterwards:

```bash
curl -s https://vahdam-lifecycle-os.anchit-tandon.com/api/connectors-health | jq
```

## The two that unblock the most

`LIVE_CONNECTORS=on` clears the Live Catalog Gate (the public storefront path
needs no Shopify credential, only the switch). One LLM key stops copy falling
back to templates. Together they are the difference between `/brain` saying
"Saved, but NOT fully generated" and actually shipping assets.
