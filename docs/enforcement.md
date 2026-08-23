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

_18 claims, each bound to a named test._
