---
name: agent-stack
description: Reference library on self-hosting and orchestrating multi-agent systems - orchestrator harnesses (Claude Code headless, OpenClaw, Codex CLI, Aider), agent back offices and task boards (Paperclip, Linear, SQLite queues), model lanes and routing (GLM, Ollama, OpenRouter, Groq), worker pools (Hermes, tmux, Docker Compose, Temporal), MCP tool layers, and hosting choices (Railway, Hetzner, Fly.io, Mac mini, Tailscale). Use when choosing or comparing tooling for any of those layers, when asked what to run an agent fleet on, when weighing subscription-plan vs per-token API cost, or when the Founder OS / "Agent Stack" writeup comes up.
---

# Agent stack reference

A captured, attributed reference on how one practitioner runs a multi-agent
"company" locally: six layers, the tool picked at each, and the cheaper swap for
each. Use it as a menu of options when a tooling decision spans orchestration,
task boards, model routing, worker isolation, tool plumbing, or hosting.

## How to use it

Read `reference/founderos-agent-stack.md`. It carries the six-layer table with
alternatives per layer, the author's reported costs, the setup gotchas (notably:
pin Node 22, not 18 or 24), and every outbound link on the page.

## Rules when citing it

1. **Attribute it.** Source is https://founderos-agent-stack.vercel.app/ by
   `@bennettx.ai` / Founder OS, captured 2026-08-13. Say so when quoting.
2. **It is opinion, not benchmark.** No methodology, no measurements, no sample.
   The costs are the author's own bill. Never present them as market rates or as
   a recommendation validated by data.
3. **Never treat it as a product or brand fact source.** Nothing in it may become
   a price, claim, rating, review, performance figure, or product detail in any
   campaign, mailer, ad, landing page, or dashboard. Where a project defines its
   own closed source-of-truth (for example VAHDAM Lifecycle OS and
   `docs/campaign-orchestration-master-spec.md`), that rule wins outright.
4. **Check staleness.** The source is a living page. If a detail is load-bearing,
   refresh it first:
   ```bash
   curl -sS https://founderos-agent-stack.vercel.app/ -o /tmp/agent-stack.html
   ```
   Then update `reference/founderos-agent-stack.md` and bump its **Captured** date.

## Note on the shared link

The URL was circulated with an `?mcp_token=...` query parameter, which looks like
an MCP credential but is not one. There is no MCP server at that host: `POST /`
returns 405, every conventional MCP path 404s, and the page is byte-identical with
and without the token. It is a share/tracking token with a 28-day expiry. Do not
try to add it as a connector; this skill is the working substitute.

## Making it available everywhere

This folder is self-contained, so it ports by copying.

**Claude Code, every project** (user scope):
```bash
mkdir -p ~/.claude/skills
cp -R .claude/skills/agent-stack ~/.claude/skills/
```
Verify with `/skills` (or `ListSkills`) in a fresh session in any other project.

**Claude apps and claude.ai:** upload the same folder under
Settings -> Capabilities -> Skills, or drop
`reference/founderos-agent-stack.md` into a Project's knowledge if you only want
it in one Project.

Keeping the copy in this repo means the source of truth is version-controlled; the
`~/.claude` copy is a distribution of it, so re-copy after refreshing the capture.
