# What this app claims, and the test that holds it

Every row is a claim the product makes and the test that enforces it. The
binding is verified by `scripts/build-enforcement-table.js`: a claim naming a
test that does not exist fails the build, so a claim cannot outlive its
enforcement.

Generated, not hand-written. Run `npm run build:enforcement` after adding a
claim or renaming a test.

## Zero fabrication

| Claim | Enforced by |
| --- | --- |
| A fact we cannot source is emitted as a DATA REQUIRED marker, never invented. | `tests/launch-gate.spec.js` — *an unmeasured dimension costs its weight instead of defaulting to pass* |
| A campaign that states a rating or review with no approved source is blocked. | `tests/launch-gate.spec.js` — *a campaign making an unapproved claim is blocked on a critical dimension* |
| The approved-claims library ships empty, so a claim blocks until a human approves it. | `tests/launch-gate.spec.js` — *the claims library ships empty, so a claim blocks until it is approved* |
| Creative cannot be generated against a stale catalog. | `tests/live-catalog.spec.js` — *CATALOG_GATE=off proceeds but stamps the output — it never fakes a pass* |

## Brand + design

| Claim | Enforced by |
| --- | --- |
| No section background is ever black or a dark neutral. | `tests/no-black-backgrounds.spec.js` — *<each file> paints no dark-neutral background* |
| Small text on a brand-green section reaches WCAG AA. | `tests/no-black-backgrounds.spec.js` — *small text on the green sections reaches AA* |
| Generated output is measured for contrast, not just the source. | `tests/launch-gate.spec.js` — *render QA measures the OUTPUT, catching what a source guard cannot* |
| Every asset type varies its design across a cohort sequence. | `tests/asset-design-variety.spec.js` — *no asset type repeats its design three times in a row, anywhere* |

## One source of truth

| Claim | Enforced by |
| --- | --- |
| Store URLs resolve through one module; no page keeps its own map. | `tests/market-urls.spec.js` — *no module keeps its own market -> store map* |
| No source names a store host that is not in the canonical map. | `tests/market-urls.spec.js` — *no source invents a vahdam host the canonical map does not have* |
| Sign-in has exactly one implementation. | `tests/homepage-signin.spec.js` — *sign-in has exactly one implementation, and it lives in auth.js* |
| No page keeps its own store map either; the guard reads the pages, not just the modules. | `tests/market-urls.spec.js` — *no page keeps its own market -> store map* |
| Every surface that hands a human a prompt reads it from the API, not a local copy. | `tests/asset-vs-element-prompts.spec.js` — *the assets library asks the API for the prompt, and holds no copy of one* |

## Assets are finished, not briefed

| Claim | Enforced by |
| --- | --- |
| Every asset prompt returns the complete deliverable; a brief is a failed response. | `tests/asset-vs-element-prompts.spec.js` — *every asset prompt states that the deliverable is the whole asset* |
| Copying an ad prompt returns the creative itself, not a description of one. | `tests/asset-vs-element-prompts.spec.js` — *an ad card copies a prompt that returns the creative, not a brief* |

## The daily loop actually runs

| Claim | Enforced by |
| --- | --- |
| The Smart Brain's rolling calendar has its own daily schedule, not a step at the end of another job. | `tests/smart-brain-cron.spec.js` — *a scheduled cron reaches the Smart Brain plan sync* |
| A daily run that runs out of time reports what it skipped instead of vanishing. | `tests/smart-brain-cron.spec.js` — *with no time budget the cron skips every step and says so* |
| A sync that cannot finish commits what it did and defers the rest to the next run. | `tests/smart-brain-cron.spec.js` — *a sync that runs out of budget defers rows instead of being killed* |
| Every send is planned from its own market catalog, never another region's. | `tests/smart-brain-market-products.spec.js` — *every slot is planned from its own market catalog* |

## Safety + privacy

| Claim | Enforced by |
| --- | --- |
| Outbound connectors honour a single kill switch. | `tests/kill-switch.spec.js` — *every outbound connector core imports the kill switch* |
| Operator-only routes reject a request with no valid session. | `tests/operator-allowlist.spec.js` — *a hash alone grants nothing: authorize still requires a real session* |
| No personal email address is committed to this public repository. | `tests/operator-allowlist.spec.js` — *no PERSONAL address appears anywhere in the tracked source* |
| No script prints a credential. | `tests/cli-and-keys.spec.js` — *push-env never echoes a secret value* |

## Build integrity

| Claim | Enforced by |
| --- | --- |
| Every inline script on every page parses. | `tests/inline-js-parses.spec.js` — *every inline script block parses* |
| CI keeps the screenshots and traces for a failing run. | `tests/ci-artifacts.spec.js` — *the failure artifacts themselves are uploaded* |
| Documented provider counts match what the code actually routes to. | `tests/llm-waterfall-docs.spec.js` — *no living doc states a provider count that disagrees with the code* |

_26 claims, each bound to a named test._
