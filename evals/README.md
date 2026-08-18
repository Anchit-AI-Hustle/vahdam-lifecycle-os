# Agent evaluation

The app had ~600 tests and none of them checked what the **agents** do. Pages,
contrast, dead hosts, kill switches and catalog provenance were all covered; the
19 tools in `api/_shared/brand-llm.js` were not, and neither was the question of
which tool a given request should reach for.

That gap matters because a misroute does not look like a failure. Ask *"how big
is our customer base?"* and get `list_cohorts` (a modelled RFM sample) instead of
`audience_base` (the real Shopify total), and the answer is a confident number
off by an order of magnitude, delivered in exactly the same voice as a correct
one. Nothing throws. Nothing turns red.

Borrowed from Google's ADK `marketing-agency` sample, whose eval data is
`{query, expected_tool_use, reference}` scored by `AgentEvaluator`.

## Two halves, deliberately

| | Structural | Live |
|---|---|---|
| Needs a provider key | no | yes |
| Deterministic | yes | no (sampled) |
| Costs quota | no | yes |
| Gates CI | **yes** | no |

**Structural** evaluates the *routing signal* — the tool names and descriptions,
which is all a prompt-routed agent gets to choose from. It asserts every tool a
case names still exists, every generating tool is flagged `mutates:true` (the
system prompt's "only on explicit user request" warning is generated from that
flag), and any two tools a case deliberately distinguishes are actually
distinguishable in their descriptions. That catches the regressions that really
happen: a tool renamed, a description edited until two tools read alike.

**Live** runs the real loop and compares the observed tool trace to the
expectation. It is a signal to investigate, not a merge gate — the model is
sampled and the provider waterfall rotates.

## Running

```bash
npm run evals         # structural — no key needed
npm run evals:live    # also runs the real model
```

CI runs the structural half via `tests/agent-evals.spec.js`.

## Adding a case

`evals/data/tool-routing.test.json`:

```json
{
  "id": "audience-size",
  "query": "how big is our customer base in the UK",
  "expected_tool_use": ["audience_base"],
  "forbidden_tool_use": ["list_cohorts"],
  "must_mention": ["customers"],
  "why": "list_cohorts returns a modelled RFM sample; quoting it as the audience SIZE overstates the base."
}
```

`why` is required and enforced. An expectation with no stated reason cannot be
judged when it fails later — the next person cannot tell intent from accident.

## What this does not cover

Output *quality* — whether a brief is good, whether copy is on-brand. Brand
constants and the zero-fabrication rules are enforced elsewhere
(`scenario-model.js` scrubbing, `catalog-gate.js`, `brief-gate.js`). This
evaluates routing and input discipline only.
