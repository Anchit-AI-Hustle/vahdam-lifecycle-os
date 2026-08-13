# Founder OS: The Agent Stack (external reference)

**Source:** https://founderos-agent-stack.vercel.app/
**Author:** Bennett (`@bennettx.ai`) · Founder OS (`thefounderos.com`)
**Captured:** 2026-08-13 (full page, 17,716 bytes)
**Status:** third-party reference. Read-only knowledge, NOT a VAHDAM fact source.

## What this is, and what it is not

This is a snapshot of one practitioner's opinionated architecture for running a
multi-agent "company" locally: six layers, the tool chosen at each layer, and the
cheaper or simpler swap for each. It is useful as a menu of options when deciding
how to host or orchestrate agents.

Three limits to respect when reading it:

1. **It is opinion, not benchmark.** No measurements, no methodology, no sample.
   The cost figures are the author's own bill, not a market rate.
2. **It is not a VAHDAM source of truth.** Nothing here may be quoted as a
   product fact, price, claim, or performance figure in any campaign, mailer, ad,
   landing page, or dashboard. The zero-fabrication and closed-source-of-truth
   rules in `docs/campaign-orchestration-master-spec.md` still bind: only the repo
   and the exact official VAHDAM regional site count for those.
3. **It is a living page.** The source can change under this snapshot. Refresh
   before relying on a detail (see "Refreshing" below).

### The URL is not an MCP server

The link was shared as `?mcp_token=<jwt-like>&fbclid=<facebook click id>`, which
reads like an MCP credential. It is not one:

- `POST /` returns **405**; `/mcp`, `/sse`, `/api/mcp`, `/mcp/sse`, `/message`,
  `/messages` all return **404**. No JSON-RPC endpoint exists.
- The page HTML contains **zero** occurrences of `mcp_token`, `jsonrpc`, `sse`, or
  any endpoint hint.
- Fetched with the token and without it, the response is **byte-identical**
  (same 17,716 bytes, same sha256). The token gates nothing.
- Decoded, the token payload is a share/tracking record, not an auth grant:
  `{pid: 2770302, sid: 2079251524, ax: "10decd…", ts: 2026-08-13T10:08:16Z,
  exp: 2026-09-10T10:08:16Z}` (28-day lifetime, issued at share time).

So this content cannot be wired in as a connector. It is captured here as a
document instead, which is what makes it usable in every project.

## The six layers

| # | Layer | Author's pick | Why it is there | Alternatives given |
|---|---|---|---|---|
| 01 | Orchestrator | **Claude Code, headless** (`claude -p`, spawned into tmux, commits like a senior engineer) | OAuth on a subscription plan, so no API key and no per-token meter: "the subscription is the payroll" | OpenClaw (open-source harness) · Codex CLI · Aider (lightweight, git-native) · Hermes as orchestrator too |
| 02 | Back office | **Paperclip** (`npx paperclipai onboard`) | Org hierarchy, tickets, heartbeats, budgets. Agents wake on a heartbeat, pull work, report back; the cockpit reads its board over the API | Linear + webhooks · GitHub Issues + Actions on cron · Trello · a SQLite queue ("honestly enough to start") |
| 03 | Model lanes | **GLM-5.2 + Codex** (heavy: GLM-5.2 · code: GLM-5.1 · light: a flash model · second lane: Codex on the ChatGPT plan) | Worker lanes, not the orchestrator's. Two subscriptions plus one flat key over an unpredictable per-token meter | Ollama (local Qwen/Llama, free) · OpenRouter (one key, every model) · Groq (speed) · Claude subscription ("simplest of all") |
| 04 | Worker pool | **Hermes** (Nous Research agent engine; `hermes gateway`) | Lives on the board as one employee with its own chat, cron, and MCP. Gateway binds to loopback behind Tailscale, so the pool runs its own model lanes with no port open to the world | tmux panes ("crude and it works") · Docker Compose (one sandbox per worker) · Temporal (real durability) |
| 05 | The hands | **MCP servers** (attio, stripe, notion, canva, trakyo, manychat, fathom, tmux, ollama) | Plugs real software into every layer: CRM, payments, docs, content, DMs, call transcripts, the terminal. One config file and every agent inherits the tools | n8n (self-hosted, visual) · Zapier/Make (fastest to wire) · plain API calls in your own tool file |
| 06 | The metal | **Railway, or a Mac mini** (`tailscale up`) | Mac mini for sovereignty: Docker sandboxes every worker, OS answers only on the tailnet. Railway for zero ops: two services, a volume, auto-deploy on push. Either way Tailscale is the only front door | Hetzner (~EUR 5/mo) · Fly.io · DigitalOcean · "the laptop you own, start here, seriously" |

## Reported cost

The author's own numbers, quoted as given:

| Layer | What they run | Rough cost |
|---|---|---|
| Orchestrator | Claude subscription, OAuth not API | flat monthly |
| Model lanes | GLM via Ollama Cloud + Codex on ChatGPT | two flat plans |
| Back office | Paperclip, self-hosted | free |
| Worker pool | Hermes, self-hosted | free |
| Tools | MCP servers, self-hosted | free |
| Metal | Railway, or a Mac mini you already own | ~$15/mo, or $0 |

Claimed headline: no per-token meter anywhere in the stack, which the author calls
the entire point of the subscription lanes. Two subscriptions carry most of the
cost; the infrastructure is the cheap part.

## Starting notes worth keeping

- **Fork and run locally before changing anything.** The repo seeds itself with
  data, so it is alive on first boot.
- **Pin Node 22.** Not 18, not 24. Node 18 fails on a modern regex; Node 24 has no
  prebuilt SQLite binary. The author flags this as the detail that costs people an
  evening.
- **Deploy, then wire exactly one tool.** Put it behind an access token, then
  connect a single real thing (inbox or payments). "One honest connection beats
  ten fake ones."
- **The seed file becomes the company**: departments, agents, funnel, in one file.

## Links on the page

| Link | Target |
|---|---|
| The repo ("open the repo on GitHub") | `https://github.com/Bennettxai/FounderOS-DEMO` |
| Live demo / product | `https://www.thefounderos.com/os` |
| Founder OS home | `https://www.thefounderos.com/` |
| Author | `https://www.instagram.com/bennettx.ai/` |
| Also linked | `https://agencyaccelerant.ai/` |

The page also carries newsletter, "Cohort 2" waitlist, and 1-on-1 build CTAs. The
GitHub link could not be verified from this environment (the egress proxy returned
403 for github.com), so treat the repo URL as recorded-from-the-page, not confirmed
live.

## Refreshing

```bash
curl -sS https://founderos-agent-stack.vercel.app/ -o /tmp/agent-stack.html
# diff against the captured facts above; the token is not needed
```

If the page has changed materially, update this file and bump **Captured**.
