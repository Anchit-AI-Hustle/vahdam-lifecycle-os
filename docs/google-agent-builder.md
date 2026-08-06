# Google AI Agent Builder integration

Connects **Google Vertex AI Agent Builder** to the VAHDAM growth stack, so an agent
built in Google Cloud can read our real Shopify sales, audience, paid-ads, lifecycle,
cohort, calendar, competitor and catalog data.

## How the integration actually works

Agent Builder connects to an external API through a tool of type **OPENAPI**: you paste
an OpenAPI 3.0 spec, it derives one callable operation per path, and the agent's model
chooses operations **by reading their `description`**. So the spec *is* the integration —
there is no SDK to install and nothing runs on Google's side.

Three endpoints:

| URL | Purpose |
|---|---|
| `GET /api/agent-builder/openapi.json` | The spec you paste into Agent Builder. Public (it contains no data and no key). |
| `GET /api/agent-builder/status` | What is exposed, what is withheld, whether the bridge is configured. |
| `POST /api/agent-builder/run/{tool}` | Executes one tool. Key-gated. |

All three are rewrites onto the existing `/api/brain` router (`?action=agent-openapi` /
`agent-status` / `agent-run`) — no new Serverless Function, because the Hobby plan caps
us at 12 and we are at 12.

## The spec is GENERATED, never hand-written

`api/_shared/agent-builder-core.js` builds the spec from `brandLlm.toolManifest()` —
the same registry ChaiGPT's tool-calling loop uses. Each operation's description is the
registry's own LLM-facing description, passed through verbatim.

A hand-written YAML would be a second source of truth that drifts the moment a tool
changes. That is the failure this repo keeps hitting (nav `INFO` keys, the metric
catalog, the CI script list), and it would be worse here: a drifted description does not
break, it just makes Google's model call the wrong tool and answer confidently from it.

**One registry, two consumers.** Add a tool to `brand-llm.js` and it appears in the spec
on the next fetch, described correctly, with no second edit.

## Safety properties

These are enforced in code and locked by `tests/agent-builder.spec.js`.

**1. Closed by default.** With `AGENT_BUILDER_API_KEY` unset every call returns `503`.
An unauthenticated business-data endpoint is worse than no integration, so the failure
mode is "off", not "open".

**2. Read-only.** The registry contains four mutating tools (`generate_calendar`,
`generate_assets_for_slot`, `run_agentic_campaign`, `generate_mailer_assets`). They are
omitted from the spec **and refused at execution with 403** — a tool that is hidden but
callable is not protected, and an external agent is steered by whoever is talking to it.
Writes need a deliberate, separate `AGENT_BUILDER_ALLOW_WRITES=on`.

**3. Constant-time key comparison**, length-checked first (`timingSafeEqual` throws on a
length mismatch, and that throw would itself leak the length).

**4. A disconnected source cannot masquerade as an answer.** Our cores report
"not connected" *inside* the payload (`connected:false` + `would_request` + `need_env`).
The bridge **hoists** that to top-level `ok:false` + a `blocker` sentence naming the exact
missing env var and the exact call that was blocked. Without hoisting, an unconnected Meta
account returns `ok:true` over a payload containing no figures — precisely the moment a
model invents one. The spec's `info.description` carries the matching grounding contract:
relay the blocker, never substitute an estimate, an average, or a figure from another
market.

**5. A tool with no description is dropped, loudly.** It would otherwise be a blind
operation the model calls at random. Dropped tools are named in
`status().omitted_no_description`, and the test asserts that list is empty — so a
description that goes missing fails CI instead of silently shrinking the integration.

## Setup

### 1. Set the key (Vercel)

```bash
openssl rand -hex 32          # generate
vercel env add AGENT_BUILDER_API_KEY production
```

Optional:
- `AGENT_BUILDER_PUBLIC_ORIGIN` — absolute origin for the spec's `servers[]` entry.
  Defaults to the request's own host, so this is only needed behind a proxy.
- `AGENT_BUILDER_ALLOW_WRITES=on` — also expose the four generating tools. Leave unset.

Verify:

```bash
curl -s https://vahdam-lifecycle-os.vercel.app/api/agent-builder/status | jq
# → configured: true, writes_allowed: false, 15 exposed_tools, omitted_no_description: []
```

### 2. Create the agent (Google Cloud console)

1. **Vertex AI → Agent Builder → Create app → Agent**.
2. Add a **Tool** → type **OpenAPI**.
3. Paste the contents of `https://vahdam-lifecycle-os.vercel.app/api/agent-builder/openapi.json`.
4. **Authentication** → API key → in **Header**, name `x-agent-key`, value = the key above.
5. Save. Agent Builder lists 15 operations, one per read tool.

### 3. Give the agent its grounding instructions

Paste into the agent's **Goal / Instructions**. This matters as much as the tools: the
whole value of the integration is that it answers from real data, and a model that
smooths over a blocker destroys that in one sentence.

```
You answer questions about VAHDAM Teas using ONLY the tools provided.

- Every number must come from a tool call. Never estimate, never average, never
  reuse a figure from another market or platform.
- If a response has ok:false and a blocker, relay the blocker verbatim and stop.
  Do not answer the question from memory or from a different tool.
- Product names, prices and URLs are valid ONLY as catalog_products returned them.
  Never edit a handle or a domain.
- Always state the market a figure is for. A US number is not a UK answer.
- For "top product", revenue, orders, AOV, trend or projection, call market_performance.
  For "how many customers / audience size", call audience_base — not list_cohorts,
  whose counts are a modelled RFM sample.
```

### 4. Test

In the Agent Builder preview panel:

- *"What are our top selling products in the US?"* → calls `market_performance`.
- *"How many customers do we have in the UK?"* → calls `audience_base`.
- *"What did we spend on Meta ads last week?"* → with Meta unconfigured, must reply that
  the source is not connected and name `META_ACCESS_TOKEN` / `META_AD_ACCOUNT_ID`. If it
  instead produces a spend figure, the grounding instructions above are not in place.

## Exposed tools (15)

`catalog_products` · `market_performance` · `audience_base` · `ask_analytics` ·
`webengage_performance` · `ad_insights` · `run_analysis` · `validate_data_accuracy` ·
`analyst_insights` · `list_cohorts` · `get_calendar` · `get_competitor_benchmarks` ·
`search_knowledge_base` · `list_campaigns` · `klaviyo`

Withheld (mutating): `generate_calendar` · `generate_assets_for_slot` ·
`run_agentic_campaign` · `generate_mailer_assets`

## Relationship to ChaiGPT

Same tools, same cores, same market defaulting — so a question answered in Agent Builder
and the same question answered in ChaiGPT cannot return different numbers. The difference
is only who drives the loop: ChaiGPT runs its own tool-calling loop across our 6-provider
waterfall (`api/_shared/brand-llm.js`); Agent Builder runs Google's loop against the same
registry. ChaiGPT keeps the write tools; the external bridge does not.

## Files

- `api/_shared/agent-builder-core.js` — spec generation, auth, write gate, blocker hoisting
- `api/brain.js` — `agent-openapi` / `agent-status` / `agent-run` cases
- `vercel.json` — the three rewrites
- `tests/agent-builder.spec.js` — 9 tests covering every property above
