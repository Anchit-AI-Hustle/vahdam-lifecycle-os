# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# VAHDAM Lifecycle OS — Project Memory

## ⭐ Governing spec: Campaign Orchestration Master Operating Contract
`docs/campaign-orchestration-master-spec.md` is the standing operating contract for all campaign
calendar, cohort, mailer, ad, dashboard, and creative generation work. When building or generating
any of those, obey it. Load-bearing rules (full detail in the doc):
- **Zero fabrication** — never invent product facts, prices, URLs, images, ratings, reviews, claims,
  segment sizes, or performance. Missing data -> `[DATA REQUIRED BEFORE LAUNCH: field, product, region]`.
- **Closed source-of-truth** — only the repo + the exact official VAHDAM regional site for the exact
  product/region. No cross-region reuse of facts/assets/reviews/claims/URLs.
- **Design HARD rules** — never black/`#171717`/dark-neutral section backgrounds (use green); enforce
  WCAG-AA contrast (no dark-on-dark / light-on-light); equal-size aligned parallel cards; proofread all
  copy; source-map every fact.
- **Frequency** — promotional cap 2 (absolute 3) per rolling 7 days; do not assume all ~111k are
  contactable daily (preferred ~31.7k/day); reduce/delay/block when eligibility is short.
- **Reviews/ratings** — only approved review data; never round 4.9 to 5, never invent reviewers, never
  transfer across product/region.
- **Launch gate** — weighted >= 9.5/10, no critical dim < 9; otherwise
  `NOT LAUNCH READY — DATA/DESIGN/FACTUAL/TECHNICAL DEPENDENCY`.
- **Shared source of truth (spec §24b, design `docs/shared-source-of-truth.md`)** — the Email Calendar
  and every other feature (Content Calendar, Blog Agent, Creator Plan, Social Generator, Paid Media,
  Analytics, Publishing Queue) are synchronized VIEWS over ONE canonical data model; never separate
  duplicated campaign systems. One authoritative record per campaign/product/offer/price/inventory/
  claim/review/rating/image/asset/forecast, referenced by stable id. No independent feature copies of
  facts (a snapshot must reference the canonical row + show CURRENT/STALE). Canonical change → event
  propagation (recalc, revalidate, mark stale, regen, audit, status). Pre-launch sync gate blocks any
  launch from a stale snapshot. One record, many views — not many records that need reconciliation.
Known current gaps vs this spec (data feeds to wire before launch): approved review library, approved
claims library, approved URL map, real eligible-segment sizes, valid `SUPABASE_SERVICE_ROLE_KEY`.


A retention/lifecycle-marketing toolkit for VAHDAM Teas, deployed as a **single Vercel project** (no framework — `framework: null`, `outputDirectory: "."`). It started as the Mailer Studio (`vahdam_mailer_architect_v34.html`) and grew into a multi-page suite: data analysis → marketing calendar → mailer creation → competitor intelligence → knowledge base → ad/landing-page generation.

Live: https://vahdam-lifecycle-os.vercel.app/ (→ https://vahdam-lifecycle-os.anchit-tandon.com/) — this is the project that receives `main` deploys (health `build:"lifecycle-os"`). NOTE: the older `vahdam-marketing-mailers-architect.vercel.app` is a STALE separate deployment (`build:"audit-additions-v83"`, no Supabase) — do NOT use it to judge current state. · Canonical repo: `~/dev/anchit-hustle` (moved off iCloud, which was corrupting git — this iCloud copy may still be the working dir).

## Version taxonomy (V1 vs V2) — product-owner convention, 2026-07-03
- **V1 = the legacy base app**: everything that existed before 2026-07-03 (dashboard/analytics, /plan RFM calendar, Mailer Studio /studio, competitor, KB, ads, landing pages, ChaiGPT, smart-brain).
- **V2 = the Lifecycle OS additions of 2026-07-03**: the cohort mailer-calendar system (/mailer-calendar), the UK non-engagers campaign hub (/uk-non-engagers) + week-1 campaign, tier-routed LLM/image cascades + video-core, Social Media OS (/social), knowledge/retention/ library, and the LHS-nav IA rule.
- V1 features are upgraded by customising the base version, and only where needed. Where a feature exposes both generations in menus/hubs, label the earlier build **"Option 1"/"Draft 1"** and the current one **"Option 2"/"Draft 2"** (V2 = the second draft).

## Mailer type taxonomy
Mailers come in exactly two named types:
1. **Text** — pure typographic (the `pure` render style).
2. **Text + Graphics** — text plus BUILT graphic elements only: brand-palette colors, buttons, labels, badges, dividers, price/receipt tables (CSS/table constructs — never photos; photos are optional slots the user fills). Any combination of such elements qualifies. Maps to the `visual`/`editorial` render styles.

## SiS distribution branch — NEVER merge into main
The branch **`snowflake-streamlit-app`** is a permanently separate distribution of this repo:
the Streamlit-in-Snowflake version (runs natively in Snowflake via `get_active_session()`,
reads warehouse tables directly — no Vercel, no Supabase, no HTML pages). It intentionally
diverges from main and **must NEVER be merged into main** (nor main into it wholesale; port
changes by hand when needed). Enforced by the required check
`.github/workflows/protect-main-from-sis.yml`, which fails any PR from that branch into main.
Deploy that branch from Snowsight (Git-linked workspace or paste `streamlit_app.py`).

## Commands
```bash
npm run build          # scripts/build-catalog.js → data/catalog/products_{us,uk,global}.json (runs at deploy via vercel.json buildCommand)
npm test               # playwright test (tests/ dir; config playwright.config.js)
npm run test:ui        # playwright test --ui
npm run test:install   # playwright install (first-time browser download)
npm run deploy         # vercel --prod
npm run setup:clis     # install every CLI the stack uses (vercel/supabase/shopify/wrangler/claude/codex)
npm run push:env       # load keys from gitignored .env.local into Vercel (dry-run; --apply to write)
npx playwright test tests/<file>.spec.js   # run a single test file
```
There is no real `dev` server (the `dev` script is a no-op stub). For local serverless testing use `vercel dev`. CI (`.github/workflows/ci.yml`) only does an HTML smoke check + `npm run build` — there is no lint step.

### No CLI can fetch an API key, and the tooling says so (2026-08-19)
Asked to "use claude-cli to fetch the anthropic-api-key, similarly openai-cli for the openai one". Neither
is possible, and the reason is worth pinning so it is not re-attempted: what those CLIs hold is not an API
key. `claude auth` is `login|logout|status` with no key subcommand, and `claude auth status` here returns
`authMethod: "oauth_token"` — a Claude Code **session**, scoped to Claude Code, not an `x-api-key`
credential. `claude setup-token` mints a subscription token, still not an API key. There is **no openai
CLI at all** any more: the `openai` package (v3.x) ships no console script and `python -m openai` errors.
OpenAI's real CLI is `codex`, whose `login --with-api-key` **reads** a key from stdin — it consumes one,
it cannot issue one. Both providers show a key exactly once at creation in the web console, and that
one-time display IS the security property; a key retrievable on demand from a signed-in CLI is a key any
local process can exfiltrate. Same boundary `scripts/preflight-credentials.sh` already stated.
- `scripts/setup-clis.sh` installs what does exist (vercel, supabase, shopify, wrangler, claude, codex),
  is idempotent, has a `--check` mode, and names the REST-only platforms (Meta, Google Ads, TikTok,
  Klaviyo, WebEngage) so their absence reads as a fact rather than an oversight.
- `scripts/push-env.sh` is the supported way a key reaches production without passing through a chat
  transcript or a commit: paste into gitignored `.env.local`, dry-run, then `--apply`. It prints names and
  lengths only, and **refuses to run if `.env.local` is git-tracked** — in a PUBLIC repo that file is
  already leaked, and pushing it would only spread it.
- **A `while read` loop drops the final line of a file with no trailing newline**, which an editor may
  well produce: the last variable in `.env.local` would have been skipped in silence. Caught by the spec's
  own fixture (`join('\n')` writes no trailing newline), fixed with `done < <(cat "$f"; echo)`.
- `tests/cli-and-keys.spec.js` pins it, including a behavioural check that runs the script over sentinel
  values and asserts neither appears in its output, plus a repo-wide guard against any future script that
  echoes a credential. Full detail: `docs/cli-and-keys.md`.
- **A test written straight after installing something depends on it being installed.** Both script tests
  passed locally and failed on all six CI projects, because CI has none of these CLIs and `execFileSync`
  throws on a non-zero exit. Two real script defects were hiding behind that: `--check` is documented
  "report only" yet exited 1 when a CLI was absent, making it unusable on a CI runner or a fresh clone;
  and `push-env.sh` demanded the vercel CLI **before** the dry-run branch, though a dry run never calls
  vercel, so you could not preview an env file without it. Fixed in the scripts, not papered over in the
  tests. The spec now runs both scripts under a deliberately bare `PATH` (`barePath()`, symlinks to
  coreutils only) and asserts exit 0 plus a real `MISSING vercel` line, so the assertion cannot be vacuous
  and the environment dependency cannot return unnoticed. A counterweight test asserts `--apply` still
  refuses when vercel is absent, so moving the guard did not delete it.

## Architecture — the big picture

### Frontend: independent static HTML pages sharing one auth/nav shell
Each page is a **standalone, self-contained `.html` file** (inline CSS + JS, often huge — `vahdam_mailer_architect_v34.html` is ~7700 lines / 700KB+). They are NOT a component tree; they share state via **localStorage** and a common script:

- **`auth.js`** — dropped into every page via `<script>`. It (1) boots a Supabase client from `window.__SUPABASE__` or `/api/public-config`, (2) forces one-time Google sign-in, (3) renders the shared top-bar / cross-step navigation, (4) registers the service worker (`sw.js`) for PWA install + aggressive cache self-healing, (5) exposes `window.LifecycleAuth.{client, session, signOut}`.
- Pages: `index.html` (home), `dashboard.html` (RFM/cohort analytics), `calendar.html` (30-day plan), `vahdam_mailer_architect_v34.html` (Mailer Studio — the main app, served at `/studio`), `competitor-benchmarking.html`, `knowledge-base.html`, `ad-campaigns-master.html` (the SINGLE ad dashboard — see below), `landing-pages.html`, `cohort-definitions.html`.
- Friendly URLs are wired in `vercel.json` `rewrites` (e.g. `/studio`, `/analytics`, `/plan`, `/competitor`, `/kb`, `/ads`). When adding a page, add its rewrite there.
- Shared front-end helpers: `chart-enhance.js`, `table-sort.js`.
- **One ad dashboard only (owner's instruction, 2026-07-26).** `ad-campaigns-master.html` (`/ads-master`) is the
  SOLE page for ad analysis, 13 tabs. `ads-dashboard.html`, `ad-campaigns.html` and `ads-masterclass.html` were
  each MERGED into it and then deleted — SOP compliance + spend pacing + metric catalog onto its SOP/Ops tabs, the
  canvas creative compositor as the **Creative Studio** tab, the paid-ads lesson as the **Playbook** tab, and the
  live `op=hierarchy` warehouse drill-down onto Campaigns & Ads. Do NOT recreate any of them. `/ads`,
  `/ads-dashboard`, `/ad-performance`, `/ads-masterclass` rewrite to the master, and the three retired `.html`
  paths 308-redirect to `/ads-master` (needed because `cleanUrls` is false, so those were real URLs).
  When porting a page into another here, remember the two traps this merge hit: prefix the ported CSS with the
  host panel id (rewriting its `:root`/`html`/`body` rules), and check for a ported top-level router that assumes
  it owns `location.hash` or sweeps `.tab`/`.panel` globally — scope it to its own panel.
  **Third trap, hit later (2026-08-01): a merge can delete the FEATURE'S ENTRANCES while keeping its code.**
  Creating ads survived the merge as the Creative Studio tab but became unreachable — the only nav row was named
  "…Master Dashboard", nothing deep-linked `#crestudio`, `INFO.adsmaster` listed "Eleven tabs" without it, and
  `INFO.ads` (the one real description of the builder) was orphaned because no nav item had id `ads`. One page can
  host two jobs; when it does, each job needs its OWN nav row, its own INFO entry, and its own route. Now:
  `/ads`, `/ad-creation`, `/creative-studio` 307 → `/ads-master#crestudio` (a rewrite cannot carry a hash, so these
  must be redirects), nav row `ads` "Ad Creation (Creative Studio)" sits beside `adsmaster`, and
  `tests/ad-creation.spec.js` locks the entrances so a future consolidation fails CI instead of vanishing again.

### Asset creation: five ops, any input, and the page always comes with it
- **`ai-studio-bar.js`** (shared front-end, alongside `chart-enhance.js`/`table-sort.js`) upgrades every
  `.ai-bar[data-surface]` into the full creation control: **Fill · Suggest · New · Enhance · Clear**, plus
  reference inputs for a page/ad URL, images and videos (URL or upload). A host page only registers how to reach
  its own fields (`AIStudioBar.register(surface, {keys, resolve, market, landing, onApply, onClear})`); the module
  owns request shape, media handling, suggestion chips and error reporting. Used by the Creative Studio ad forms
  (`google`/`meta`/`tiktok`) and `landing-pages.html` (`lp-*`), so the two cannot drift.
  Uploads cap at **3MB** (Vercel's 4.5MB request-body limit, +33% for base64); bigger files go in as a URL and the
  server fetches them.
- **`api/_shared/reference-intel.js`** turns any reference into prose the text-only waterfall can read: bounded
  page fetch (title/meta/headings/CTAs, not just a text dump) and a vision pass for media — Gemini (images **and**
  video, incl. YouTube URLs directly) → OpenAI → Anthropic (images only). Teaching all eleven `llm.js` rungs a
  multimodal message shape would have been far riskier; describe once, pass prose down. **A reference that cannot
  be read is reported as unread** (`reference_warnings`, shown in the bar) and the prompt explicitly says not to
  imagine it — an invented "the ad shows a 40% off badge" would otherwise be laundered into live copy as fact.
- **`?mode=autofill` now takes `op` (`fill|suggest|new|enhance`), `current` (the form's values), and `media[]`.**
  Temperature is per-op (enhance 0.5 stays faithful, new 1.0 actually diverges); `suggest` returns
  `{suggestions:{field:[3 options]}}` and never writes to the form. `clear` is client-side only.
- **Every asset generates its landing page by default** (product-owner rule, 2026-08-01). Saving a campaign in
  Creative Studio builds its page from `landing_page_brief` — derived server-side from *that ad's own* copy, so the
  page cannot promise what the ad did not say — and stores it in `store.landing` with Preview/Copy/Download on the
  campaign card; the per-surface toggle is checked by default. Mailer Studio does the same at Step 5
  (`#step5LandingPanel`, signature-guarded so market/variant switches don't re-spend a generation). In
  `lib/smart-brain/services.js` the page is no longer gated on `landing_page` being in the slot's channel mix —
  ads were built unconditionally, so a slot could ship an ad set whose clicks had nowhere on-brand to land.

### Backend: Vercel serverless functions under `api/`
**Hard constraint — Hobby plan caps Serverless Functions at 12.** The app sits at that limit, which dictates the structure:
- **Files under `api/_shared/` are NOT counted as functions** (underscore-prefixed paths are excluded). Heavy logic lives there and is `require()`d by the thin public endpoints.
- Multi-capability features are **single catch-all routers dispatched by `?action=`** rather than one file per capability:
  - `api/competitor.js` → `?action=list|html|poll|sync` (logic in `_shared/competitor-core.js`)
  - `api/kb.js` → `?action=ingest|list|top-emails|brands|classify-emails`
- Before adding a new `api/*.js` file, check the count in `vercel.json` `functions` — prefer extending an existing router.

| Endpoint | Purpose |
|---|---|
| `api/ai/generate.js` | Text generation: create_brief, concepts, mailer_full, suggested_prompts |
| `api/ai/image.js` | Image generation cascade (see below) |
| `api/ai/pipeline/*.js` | Multi-stage mailer pipeline: strategy → variant → images → html → score (+ health) |
| `api/calendar.js` | `?action=generate` (30-day plan) + `?action=trigger-mailer` + `?action=smart-brain-*` (plan/sync-daily/cron/approve/reject/run-daily/feedback…) + `?action=lp&id=` (serves generated landing pages at `/lp/:id`). Logic in `_shared/calendar-generate.js`, `_shared/calendar-trigger.js`, `_shared/smart-brain-plan.js`, `lib/smart-brain/services.js` |
| `api/competitor.js` | Competitor Benchmarking router (Gmail IMAP → Google Sheet) |
| `api/kb.js` | Knowledge Base router (Supabase-backed) |
| `api/brain.js` `?action=catalog` | The LIVE product catalog (`/api/catalog?op=products\|status\|refresh\|verify`). Logic in `_shared/catalog-live.js`; the pre-creative gate in `_shared/catalog-gate.js` |
| `api/public-config.js` | Public config (Supabase URL + anon key) + `?health=1` health check; `/api/health` rewrites here. **Operator-only modes:** `?pipeline=1`, `?probe=1`, and the DETAILED `?health=1` payload require `Authorization: Bearer <operator Supabase token or CRON_SECRET>` (allowed domains via `ANALYTICS_ADMIN_DOMAINS`, default `vahdam.com`) and drop wildcard CORS. Anonymous `?health=1` returns liveness only (`ok/build/ts`) — never provider, key, model, region or env state. `?probe=1` also spends provider quota, so it must never be anonymous. |

### The catalog is LIVE, and a gate proves it before any creative runs (2026-08-17)
`api/_shared/catalog-live.js` is **THE** catalog — one resolver for every surface, fetched from the
connected store rather than built. Order per market: **Shopify Admin** `products.json` (paged, needs a
token) → **the store's public `/products.json`** (no credential, works today) → `data/catalog/products_
<region>.json`, returned `live:false, stale:true, stale_days`. It was a build artifact parsed from three
CSV exports, and **six modules each opened those files with their own private loader** (jarvis, brand-llm,
calendar-export, calendar-trigger, landing-fallback, catalog-image) — so every price, rename, sell-out and
new product since the last export was asserted to customers as current fact. All six now go through the
resolver; `tests/live-catalog.spec.js` fails the build if a seventh private loader appears.
- **Prime-then-read.** Template renderers call `catalogImage.imageFor(...)` **synchronously** and cannot
  await, so `catalog-gate.js` awaits `primeCatalog()` before generation starts and the sync readers hit
  that snapshot. The gate is both the check and the load. `catalogImage.sourceFor(market)` reports which
  source answered.
- **`catalog-gate.requireLiveCatalog()` is a HARD STOP, and it runs first** — before the strategy brief,
  before a token of copy, before the first image call. It checks LIVE → FRESH (`CATALOG_MAX_AGE_MINUTES`)
  → POPULATED → **SELECTED** (every named product resolves to a live row, unambiguously, active/published/
  priced/in stock). A blocked build returns `NOT LAUNCH READY - DATA DEPENDENCY` + `[DATA REQUIRED BEFORE
  LAUNCH: …]`, never half a campaign. Wired into `smart-brain-plan.buildCampaign`, `social-core.runDaily`
  and `api/ai/generate.js`; every `buildCampaign` caller propagates `campaign.blocked` instead of
  persisting empty assets.
- **Selection correctness is part of the gate.** `findProduct` matches id → handle → SKU → exact title →
  contains → rarest distinctive token, and records `match_method` + `confidence`. **A weak (token) match is
  a block, not a substitution** — it is how one product's price ends up under another's name. On a pass the
  gate returns the LIVE rows and callers build from those: `api/ai/generate.js` **replaces the browser's
  `selected_products`** with them, because the client sends whatever catalog it happened to load.
- **`CATALOG_GATE=off` never fakes a pass:** output carries `gate_bypassed` + the DATA REQUIRED line, and
  `/api/connectors-health` reports the bypass as a live defect even when the catalog is live.
- Route: `/api/catalog?op=products|status|refresh|verify&market=` (on the brain router — no new function).
  Health gains a `catalog` platform and a top-level `creative_blocked` flag.
- **Read-only is not public (2026-08-17, from the PR security review).** An Admin-token-backed route left
  open is both a disclosure and a free quota-drain vector. So: **`/api/shopify` is operator-only** (it
  returns orders *with their customer objects*, the customer list, inventory levels and draft/archived
  products; nothing in the front end calls it). `/api/catalog` stays anonymous because the pages need it,
  but it **projects out Admin-only fields** — per-variant inventory, internal SKUs, the whole variant list
  — unless the caller is an operator, and **a forced refresh (`op=refresh` / `fresh=1`) needs an operator**
  since it walks the Admin API on demand. In the core, `status` is an allowlist defaulting to `active`
  (never a pass-through, or `?status=draft` dumps unpublished products) and `maxPages` is clamped to 12.
  Dispatchers pass **named params, never the caller's whole query object**. Locked by
  `tests/live-catalog.spec.js`.
- **Gating one route is not gating the capability (2026-08-17, second review round).** The catalog probe in
  `connectors-health` passed `fresh:true`, and `/api/connectors-health` is unauthenticated — so the forced
  Admin walk was still reachable, straight past the operator gate on `?op=refresh`. When you gate an
  expensive capability, grep for its OTHER callers. Now `probeCatalog(mk, {fresh})` defaults to the
  TTL-cached resolve (still a REAL attempt on a cold cache, so it is not env-var prediction) and only an
  authenticated operator gets `?fresh=1`. Two amplifiers closed with it: **the market is the cache key and
  is caller-controlled**, so an unknown market now costs zero outbound calls (varying `?market=` otherwise
  mints a cold read per value); and **failures are negatively cached** (`CATALOG_MISS_TTL_SECONDS`, 60s) —
  success-only caching meant a broken store was re-walked on every single request, a retry storm firing
  exactly when the catalog is already down. The health row reports `read: cached | cached-failure |
  fetched | forced-fresh | not-attempted` so a replayed failure never reads as a fresh attempt.
- Front ends read `/api/catalog` first and fall back to the artifact **labelled**: Mailer Studio (its
  frozen inline `CAT` array — 170 products, no prices, **no handles**, so `pdpUrl()` had been *guessing*
  PDP slugs — is now a last-resort fallback behind `hydrateCatalog()`, with the source shown at Step 2),
  Creative Studio, and `copilot.js`. `window.CAT` is now actually set: `const` at script top level does not
  attach to `window`, so the three `window.CAT &&` guards had been dead code.
- Fixed in passing: `calendar-trigger.lookupHandle` mapped US to `products_usa.json`, a file the build has
  never written, so **every US SKU lookup returned null** and fell through to a slugified guess.
- Not verifiable from the dev sandbox: outbound egress to `vahdamteas.com` is blocked by proxy policy here,
  so the storefront path is proven against a stubbed Shopify payload in tests, not a live round-trip.

### Operator identity: domains, plus named owner accounts as hashes (2026-08-19)
The operator gate (`data-analysis-core.authorize`) was **domain-only** — `ANALYTICS_ADMIN_DOMAINS`,
default `vahdam.com` — so the owner's own non-vahdam sign-ins were treated as anonymous: no detailed
health, no `?pipeline=1` / `?probe=1`, no `/api/shopify`, no forced catalog refresh. Two of the three
accounts the owner actually signs in with are personal ones.
- `isOperatorEmail(email)` is now the single check: domain match -> built-in owner hash -> the
  `ANALYTICS_ADMIN_EMAILS` env allowlist (plaintext, comma-separated, no deploy needed). `authorize()`
  calls it; nothing else re-derives the rule.
- **The named accounts are stored as SHA-256, not plaintext, because THIS REPOSITORY IS PUBLIC.** The
  check only ever needs equality, so publishing the addresses would buy nothing and cost the owner a
  scrapeable inbox. This is a privacy decision, NOT a security one: a hash grants nothing on its own,
  and an operator still needs a valid Supabase session for that account (`tests/operator-allowlist.spec.js`
  asserts a request with no bearer token is still 401).
- The domain match stays anchored at `@`, so `attacker@evilvahdam.com` is refused; the spec covers that
  and the suffix attack on the address itself.
- Found in passing and redacted: `Raw Prompts/vahdam_lifecycle_os_master_prompts.md` carried a personal
  address in plaintext. The work address is left where it legitimately documents a default
  (`.env.example` `ALERT_EMAIL`). A repo-wide guard now fails the build if a **personal** address is
  committed anywhere outside `tests/`. Note the git HISTORY still contains it, and rewriting history is
  out of scope: treat that address as already public and rely on the guard from here.

### Prose drifts faster than constants, because nothing executes it (2026-08-19)
The LLM cascade was documented three different ways at once, and all three disagreed with the code.
`CLAUDE.md` said "6-provider, OpenAI -> Anthropic -> ...". `DEVELOPMENT.md` said "8-provider,
Anthropic-first" and even carried a "known doc drift" section correcting the README with its own wrong
number. `llm.js`'s OWN header comment listed eight rungs and omitted github/cloudflare/openrouter.
`providerOrder()` returns **eleven**, Anthropic-first: anthropic -> openai -> gemini -> grok -> groq ->
cerebras -> github -> cloudflare -> openrouter -> ollama -> sakana (the last five skip cleanly when
their env config is absent, so a default deployment behaves as six rungs; `fast` skips grok). Nobody
lied - each line was true when written, and then the code grew a rung.
- This is the market-URL failure in a different medium. The fix is the same: **pin the prose to the
  code**. `tests/llm-waterfall-docs.spec.js` reads `providerOrder()` out of the source and fails any
  living doc stating a different count, any doc still claiming OpenAI-first, and `llm.js`'s own header
  if it omits a rung it routes to. It also asserts every named rung has a real `modelsFor()` case, so
  the count can never be inflated by a provider that cannot answer.
- Two allowances, both narrow: the `4-provider image cascade` is `api/ai/image.js` and is skipped, and
  a doc may QUOTE an old wrong value while explaining that it was wrong (a quotation inside a
  correction is the opposite of drift). `reference-intel.js`'s vision cascade genuinely runs
  Gemini -> OpenAI -> Anthropic and is not the text waterfall.
- **README.md was rewritten** in the same pass. It still described a three-stage app with a 30-day
  calendar and documented two endpoints (`/api/calendar/generate`, `/api/calendar/trigger-mailer`) that
  no longer exist in any form - the routers replaced them. Treat the README as the front door and
  CLAUDE.md as the working memory; when they disagree, the code wins and both get fixed.

### Data Analysis is ONE rail entry, in funnel order (2026-08-19)
Analysis was spread across three separate rail entries: the Data Analysis group, a standalone
**Cohorts** group, and the **Ad Campaigns Master** sitting on its own. Answering "how did that campaign
do" meant already knowing which of the three held the answer.
- One group now, children ordered the way a customer moves: Control Room (whole funnel) -> 1 Ads &
  paid media -> 2 Acquisition -> 3 Landing pages -> 4 Sales & business review -> 5 Cohorts & lifecycle
  -> 6 Retention -> 7 Mailer intelligence -> 8 RFM -> 9 Cohort coverage -> 10 Actions & outcomes ->
  Alert settings. The labels carry the step numbers so the sequence is visible, not inferred.
- **Ad analysis still has exactly ONE entrance** (the 2026-08-06 rule); it has simply moved inside this
  group. The ad BUILDER (`id:'ads'`, Creative Studio) stays in Design & Create - it is a create
  feature, and the spec asserts it was not pulled in.
- Dissolving the Cohorts group would have orphaned `INFO.cohorts` and failed `feature-taxonomy`, so the
  group became a ROW with `id:'cohorts'` carrying the old group's `match` list. That is the invariant
  working as intended: it caught the description going dark before the merge shipped.
- `tests/nav-analysis-funnel.spec.js` pins the ORDER, not the labels, so renaming a row is free and
  moving one is not.

### Two review-bot findings, and a rebase that broke a spec semantically (2026-08-24)
PR #398 merged with only its FIRST commit; the follow-up work landed after the merge, so it became a
fresh change on the same branch rebased onto the new main. Three things worth keeping from that:
- **Dead defensive code is worse than none.** A review bot flagged `btn ? btn.textContent : ''` and
  two `if (btn)` guards in `assets.html`: the only call site is the grid's own delegated click
  handler, so `btn` is the clicked element and cannot be absent. A guard for an impossible case
  implies the case is possible. Same for `!!(persistence && persistence.truncated)` in
  `smart-brain-plan.js`, where `persistence` is assigned unconditionally.
- **A clean textual rebase can still break a spec semantically.** main had meanwhile replaced the
  `/brain` Rolling calendar TABLE with a day-card list (`.callist .cday`, fed by
  `?action=daily-calendar`), and `#plantable` was at that point asserted absent (it is asserted
  PRESENT again now - the day view is the part that is gone). My appended freshness tests
  merged without a conflict and then failed on a selector that no longer exists, referencing a `PLAN`
  fixture the rewritten file no longer defines. **eslint's `no-undef` caught the second half in
  seconds** - which is the lint ratchet paying for itself on exactly the class of failure it was
  added for.
- The freshness tests now stub BOTH endpoints the page reads (the grid from `?action=daily-calendar`,
  the plan and its timestamps from `?action=smart-brain-plan`), because stubbing only the grid leaves
  the plan empty and the tile then correctly reads "never" - a green-looking test measuring nothing.

### A log line's FIRST argument is a format string (2026-08-24)
CodeQL raised four HIGH "externally-controlled format string" alerts on `api/_shared/llm.js` - one per
provider branch - on a PR that does not touch that file (main is green, so treat the attribution as
CodeQL's diff logic, not as a claim about the diff). The shape:
`console.error('[llm][' + stage + '] OpenAI ' + r.status, err.substring(0, 200))`.
- With **two or more arguments Node treats the first as a format string**, and `stage` is
  caller-supplied. A `%s` anywhere in it silently swallows `err` - the one thing the line exists to
  print - so this is a real logging defect as well as an alert. Single-argument `console.log(built)`
  is not a sink, which is exactly why only the four calls that pass an error body were flagged.
- Fixed by putting the literal first and the values after
  (`console.error('[llm][%s] OpenAI %s %s', stage, r.status, err...)`).
- `tests/llm-waterfall-docs.spec.js` guards the class, and **strips comments before scanning**: the
  comment above the fixed call quotes the broken shape on purpose, and a guard that trips on an
  explanation of the bug it prevents only teaches people to delete the explanation. Verified with
  teeth - restoring one call turns it red.

### A single-pass tag strip is never the right sanitizer (2026-08-19)
CodeQL flagged two regexes added in the same pass: `.replace(/<[^>]*>/g,'')` to build a `title=`, and
`.replace(/<\/?style[^>]*>/gi,'')` to pull CSS out of a page. Both are the pattern that leaves
`<<script>script>` behind. Neither was exploitable (the title was `esc()`d, the other reads our own
file), and both were also unnecessary, which is the real lesson: the title is only wanted for cells
with no markup at all, so the cell is skipped when it carries any; and a regex with a capture group can
hand back the CSS body directly instead of stripping the tags off the whole match. When a sanitizer
looks necessary, check first whether the input can just be excluded.

### A shipped fix can be invisible: the no-cache header missed every real URL (2026-08-19)
The table-overlap fix was on `main`, deployed, and verified in situ (0 overlaps, the table scrolling in
its `.tbl-wrap`) - and the page still looked broken in the browser. The tell was a screenshot showing
the NEW numbered sidebar next to the OLD table CSS: two different ages of the same deploy on one
screen.
- `vercel.json` scoped its revalidate header to `/(.*)\.html`, which only matches a path ENDING in
  `.html`. **Nothing navigates that way.** The nav links to `/ads-master`, `/brain`, `/studio`,
  `/analytics`; those are rewrites, and the path carries no extension, so the rule matched NONE of the
  pages anyone actually opens. `auth.js` came back fresh as a separate request (new sidebar) while the
  page HTML on the friendly URL was served from cache (old CSS).
- The shared front-end modules had **no** rule at all either - only `/sw.js` did - and they are
  unhashed and loaded by every page, so one stale `auth.js` or `gate-notice.js` hides a fix everywhere
  at once.
- Now: an extensionless-page rule `/((?!api/|data/|_next/|.*\.).*)` and a `/(.*)\.(js|mjs|css)` rule,
  both `max-age=0, must-revalidate`. Later rules still win per key, so `/sw.js`, `/api/*` and the
  cacheable built catalog keep their own policies.
- `tests/friendly-url-cache.spec.js` derives the route list FROM the rewrites, so a page added tomorrow
  is covered the day it ships, and asserts the API and catalog policies were not swept up.
- **Debugging note:** before blaming the code, check whether the browser has it. Four separate
  reproductions of the overlap (bare table, 20 columns, squeezed container, in situ on the real page)
  all came back clean, which is what finally pointed at delivery rather than layout.

### A filter must be a MASTER filter, or every number on the page is ambiguous (2026-08-19)
Scoping the KPI tiles alone left `/ads-master` Live Now WORSE than before: the tiles read
`SPEND ON 25 JUL - TARGET / COSTCO  $114.48` while the Daily spend chart directly under them still drew
both accounts at ~$2,988 a day, and nothing on screen said which panel meant what. Half a filter forces
the reader to work out, panel by panel, whether what they are looking at respects the control.
- ACCOUNT is now the master filter for the tab: tiles, the daily chart (`scopeDaily()` maps each row
  through `daily[].accounts`) and the ad list all follow it.
- **A day with no per-account breakdown is DROPPED from a filtered chart, not drawn at its blended
  height** - a blended bar inside a filtered chart is a wrong number, not a missing one - and the
  subtitle counts what was hidden and why.
- `#live-scope` states the current scope once for the whole tab, names which panels follow it, and
  names the one that deliberately does not: "Today by account" IS the account comparison, so it always
  lists every account. A panel that cannot be scoped must say so rather than look unfiltered.

### A filter that re-renders is not a filter that filters (2026-08-19)
The ACCOUNT chips on `/ads-master` Live Now (Both / Target-Costco / DTC) called `renderLive()` on click,
so the page visibly redrew, but `LVACCT` was read in `renderLiveAds` and NOWHERE else. The five KPI
tiles recomputed the same blended totals every time: selecting **Target / Costco** showed `$136.27`,
which is DTC's `$21.79` plus retail's `$114.48`. One account's heading over both accounts' money, and
it looks answered, which is why it survived.
- `liveScope(res, connected)` now returns the totals for the ACTIVE selection from the per-account
  breakdown every source already carries (`res.accounts[]` by `source_id` live; `today.by_account` and
  `daily[].accounts` in the snapshot). Real figures, never a share-out of the total.
- **A selected account with no row reports nothing**, not the blended fallback: that silent fallback IS
  the bug. Same for the previous-day tile, which is scoped only on days that carry the breakdown.
- Every scoped tile appends the account name to its heading, so a filtered figure cannot be read as the
  whole estate. `tests/ads-account-filter.spec.js` drives the real chips and asserts the tile VALUE
  changes, having first asserted the premise (the two accounts sum to the blended total).

### `max-width` on a `<td>` is ignored, and this page had to learn it twice (2026-08-19)
`ad-campaigns-master.html` has its OWN `table()`, so it never got the fix `data-analysis-extensions.js`
already carries. Long campaign tokens and 18-digit entity ids overflowed and painted over the next
column: Spend and Impressions rendered as `$17,938.7870,485`. The CSS looked deliberate
(`td{white-space:normal;max-width:520px}`) and did nothing, because **auto table layout ignores a
max-width on the cell** - it must sit on a block inside it.
- Same idiom as the other page: `.cw` inner block, `{r:1}` numeric stays `nowrap`/right/tabular,
  `{w:1}` wide, `{id:1}` machine id. Callers were ALREADY emitting `<div class='cw wide'>` and that
  class had no CSS in this page at all, so a cell that carries its own `.cw` is not wrapped again
  (nesting a 320px block in a 240px one overflows exactly as before).
- **Testing note: a three-column fixture proves nothing.** Under the old CSS the `.cw` measured 910px
  wide and yet nothing "overflowed", because the table simply grew. The defect needs the real column
  count inside a constrained container, so the spec renders 20 columns at 1180px and asserts no two
  cells overlap and none collapses below 8px.

### Element prompts and asset prompts are different things (2026-08-19)
Pasting "the prompt" from Mailer Studio into Gemini returned one product photograph. That was correct
behaviour: all three platform cards on the Step-4 Prompts tab copied an **element** prompt (the Gemini
button copied the product-photograph brief), and the prompt that returns a COMPLETE mailer had **no
entrance in the UI at all** - `copyMasterPrompt()` was defined and called from nowhere. Same
vanished-entrance trap as `INFO.ads` and the Creative Studio.
- **The asset contracts also asked for the ingredients.** `mailerContract` asked for "3 subject lines,
  a hero headline, 2-3 paragraphs, a CTA"; `adContract` asked for "every text field, plus a creative
  brief per size". Both are copy documents. Only landing page, playable and video ever demanded a
  finished file. Every contract now carries `DELIVER_THE_WHOLE_ASSET` (a brief, outline, plan or list
  of elements is a FAILED response) and names the finished artifact: a sendable 600px inline-CSS HTML
  email, one HTML document per produced ad size composed at that pixel size, a publishable article.
- **`MEDIA_SLOT_PROTOCOL` is the one honest placeholder.** A chat model cannot produce a photograph,
  and letting it emit `<img src="hero.jpg">` is a fabricated filename. Every media slot uses the
  repo's existing convention (`<!-- IMAGE GENERATION PROMPT (...) -->` + `PASTE_IMAGE_URL_HERE`,
  parsed by `asset-agent.js`), so the file is finished the moment URLs are pasted in. The playable is
  the deliberate exception: it must inline every asset as a `data:` URI, so a paste token would fail
  the unit. `tests/asset-vs-element-prompts.spec.js` checks the example in the prompt against
  `mailer-format.ASSET_PROMPT_RE`, so the prompt cannot teach a shape the parser rejects.
- **`blog` had no contract** and fell through the else-chain to `mailerContract()`.
- Each mailer variant is pasted ALONE, so V2 saying "the same block as V1" was an instruction to a
  model that never saw V1. The shell is now a shared const injected into both.
- Served from ONE place: `/api/ai/generate?action=master-prompt` (GET, no quota, runs BEFORE the
  provider-key check - a deployment with no keys is exactly when someone needs a prompt to paste
  elsewhere). The Prompts tab now shows **Asset prompt** first and labels every element card, toast
  included, so no button can hand you the wrong kind again.

### Fixing ONE page's prompt left the same defect in two others (2026-08-24)
The element-vs-asset fix above was applied to Mailer Studio, and the two OTHER surfaces that hand a
human a prompt kept their own hand-written builders - so "copy the prompt" still returned the wrong
KIND of thing in the Assets library and the Creative Studio.
- **`assets.html` `buildPrompt(item)`** was a fourth copy of the contract. Its ad branch asked for
  three headline options, primary text, an image-generation prompt for one lifestyle still, and a
  cohort note: a copy document plus an ELEMENT prompt. Pasted into ChatGPT it returns exactly that,
  and no ad. Its mailer branch did ask for a full HTML email, but built around a bare "image
  placeholder" with no paste token, which invites a fabricated filename.
- **`ad-campaigns-master.html` `clientMasterPrompt(ch)`** was the fallback whenever autofill had not
  run - i.e. the normal case for someone who fills the form and clicks the button. It asked for
  "every text field, plus a precise creative brief per size", which the real contract now names as a
  FAILED response in as many words.
- Both now POST to **`/api/ai/generate?action=master-prompt`** and there is no local fallback: a
  prompt that returns the wrong kind of output is worse than an honest failure, because it looks like
  it worked. Buttons and toasts say **asset prompt** and name what comes back.
- **Both drifted copies also carried their own region -> store-host map**, two of whose hosts only
  redirect - and `tests/market-urls.spec.js` could not see either one, for two independent reasons:
  the guard reads `api/`, `lib/` and `scripts/` (the pages hold ~4.2MB of inline JS and were never
  scanned), and it anchors on `https://` while both maps stored a bare host (`store:
  'www.vahdam...'`). A new guard scans the top-level pages and matches a scheme-less host. It found
  **six more pages** doing it (`knowledge-base`, `landing-page-agent`, `landing-pages`, `playbook`,
  `research`, `vahdam_mailer_architect_v34`), so it ships as a **ratchet**: a recorded baseline count
  per file, failing on a new page or a grown map, and failing too if a baselined page is fixed and
  not removed from the list. Routing those six through the API is real work and is NOT done.
- Lesson, again: fixing the instance is not fixing the class. The 2026-08-19 entry fixed one page's
  buttons; the defect was "every surface builds its own prompt", and two surfaces still did.

### The Smart Brain stopped, and the only thing that would have said so said nothing (2026-08-24)
`/brain` served a 160-slot rolling calendar in which **nothing had been touched since 2026-08-14**:
the horizon had stopped extending (80 days ahead, not 90), no slot had been re-reviewed against the
day's data, and not one slot carried a `__prebuilt` marker. The plan was not corrupt - it was never
being re-run.
- **The scheduled cron dies at the function cap.** `api/brain.js` has `maxDuration: 120`, and
  `?action=cron` ran nine heavy steps in series - including up to FIVE full LLM campaign builds -
  reaching the Smart Brain plan sync NINTH. Vercel's runtime log for the 18:30 schedule is
  `504 GET /api/brain ... Task timed out after 120 seconds`. Everything after the kill point never
  ran, and `core.logRun()` is the LAST line, so no run record was written either. **A cron that dies
  mid-chain is indistinguishable from one that was never scheduled**, and both look like a quiet day.
- **`/api/cron/smart-brain` did not exist.** This file has claimed since the feature shipped that a
  03:30 UTC cron hits it (rewrite -> `?action=smart-brain-cron`). There was no such cron and no such
  rewrite: `vercel.json` had two crons, brain and social. The action was there the whole time,
  unreachable - the same vanished-entrance defect as `INFO.ads` and the Creative Studio, in the
  scheduler instead of the nav. Both now exist, so the calendar's own loop no longer depends on the
  heavy brain run finishing.
- **`smart-brain-sync-daily` itself 504s at 120s**, measured against production (`POST
  ?action=smart-brain-sync-daily` -> HTTP 504 after 2m01s), not inferred. Two causes, both fixed, both
  now measured against the real database:
  - the update phase was `for (const u of updates) await db.update(...)` - ONE sequential PostgREST
    round-trip per row. Measured from this sandbox: **389ms per serial round-trip**, so ~70s for 180
    rows and ~11s for the same 180 at width 8. Updates now run at bounded concurrency
    (`SMART_BRAIN_SYNC_CONCURRENCY`, default 8). Each row still gets its OWN conditional write,
    because the optimistic lock on `status` is what stops a sync clobbering an approval that landed
    since the read: only the WAITING is shared.
  - **the window is ~720 slots, not 180** - 90 days x 2 markets x 2 cohorts, measured on the preview
    deployment (`changes: 720`). At 389ms serial that is over four minutes of writes on its own. So
    `insertRowsResilient` is CHUNKED too (`SMART_BRAIN_INSERT_CHUNK`, default 25): a slot payload is
    ~12KB, so the old single batch would have posted **~7MB in one request** after an outage, and if
    PostgREST refused it for any reason - size, one duplicate key - the fallback re-tried all 720 rows
    ONE AT A TIME. Chunks bound the happy path and the fallback; the per-row fallback stays sequential
    WITHIN a chunk so a partially-rejected chunk writes predictably. Both phases watch the clock, so
    an insert-heavy first sync cannot burn the whole budget before a single update is attempted.
  - the stored window was read TWICE per sync - once raw, once through `getPlan()` at the end - and
    it is **1.89MB / 160 rows / 1.8s** on the live table. Cron callers now pass `includePlan:false`
    and skip the second read; coverage (the alarm for a window that stopped extending) is still
    measured, from a `select=date,market,status` read of a few KB.
  - Measured on the branch's own preview deployment (Vercel -> Supabase, `persist:false`, so
    read-only): `context_ms 1761`, `plan_build_ms 384`, `plan_read_ms 1370`, `total_ms 3515`. Every
    phase except the writes costs 3.5s; the writes were the whole timeout. It "used to work" because
    the window was shorter - nothing changed except how many rows there were to write.
- **A run that cannot finish now commits what it did and says what it deferred.** `syncDaily` takes a
  wall-clock budget (`SMART_BRAIN_SYNC_BUDGET_MS`, 95s): rows past it are `deferred`, the sync reports
  `truncated`, `persistence.ok` is false, and the next run re-derives the same diff and writes them.
  The daily cron gained the same shape (`BRAIN_CRON_BUDGET_MS`, per-step `needMs`, `skipped_steps`,
  `timed_out`) and the plan sync moved AHEAD of asset generation: order by cost, not by habit.
- **Phase timings are returned on every sync** (`context_ms`, `plan_build_ms`, `stored_read_ms`,
  `insert_ms`, `update_ms`, `plan_read_ms`, `total_ms`). The timeout was undiagnosable precisely
  because a killed invocation reports nothing, so the evidence goes in the response - the same
  reasoning as printing the row geometry on a failed layout assertion.
- **The app's OWN instrumentation had it right the whole time**, which is the uncomfortable part:
  `/api/brain?action=daily-calendar` reported `plan_persistence: {age_hours: 246, state: 'stale'}`,
  `plan_run: never_run`, `coverage: 80/90 days` with the note "a rolling window that is short at the
  far end means the daily sync is not persisting: it loses one day of horizon per day", and
  `daily_job: {summary: '4/12 steps ok, 8 skipped'}` timestamped 18:31 - the cron that then died. The
  freshness card on `/brain` renders that. What was blank was the **"Last sync" tile** beside it:
  written in ONE place, inside `runSync()`, so on a plain page load it read `-` forever. Two
  indicators of the same fact, one honest and one mute. The tile now DERIVES the age from the rows'
  own `updated_at` at render time (never a stored "fresh" flag re-asserted as a live claim), goes red
  past ~36h and names the loop to check. **Watch the name collision it walked into**: the new helper
  was also called `renderFreshness`, the file already declared one ~350 lines down for that card, and
  function declarations hoist - so the later one silently won and the new call site invoked the wrong
  function with the wrong arguments. It is `renderPlanAge` now.
- A partial sync also reports `persistence.summary` in the UI instead of a bare "Sync failed", which
  sent the operator hunting a broken deployment instead of a slow one.
- **Still true after this and not fixable in code:** production has `LIVE_CONNECTORS` off, so
  `/api/connectors-health` reports `creative_blocked: true` and the live-catalog gate refuses every
  generation (falling back to a build artifact dated 2018-10-20). The plan will roll again; the
  prebuild queue will keep building nothing until that env var and a live store read are in place.
- Unverifiable from the dev sandbox: the sync cannot be run locally (no Supabase credentials here),
  so the concurrency and budget work is proven by test and by reasoning about the measured 504, not
  by a green production run.

### The migration nobody applied, and 632 rejections that named their own fix (2026-08-25)
`/brain` showed `Error: 0 of 632 planned writes landed; 632 rejected by the database` as a raw JS stack
trace in the Details panel. The sync itself was healthy - the timeout work below made it finish in 19s -
and every single write was refused.
- **Measured, not guessed:** `select indexdef from pg_indexes` on the live database returned
  `CREATE UNIQUE INDEX smart_cal_date_market_idx ON smart_calendar_entries (date, market)`. The planner
  writes 3-4 cohort sends per (date, market), so every insert was a 23505 duplicate-key violation.
  `supabase/migrations/20260712090000_multi_cohort_per_day.sql` drops that index and was authored on
  2026-07-12; it had **never been applied**. `smart-brain-plan.js`'s own header comment had said so all
  along - the code was right, the database was six weeks behind it.
- Applied verbatim (index relaxed to non-unique, 40 old-format `tentative` rows cleared so days do not
  double up, all 120 approved/final rows preserved). The next sync: **650 inserted + 16 updated = 666 of
  666, 0 rejected, coverage 90/90 days complete**, 19.3s.
- **The lesson is about deployment, not SQL.** A migration in `supabase/migrations/` is not applied by
  anything in this repo - no CI step, no deploy hook, no test. It is a file that someone has to run. The
  app therefore has to survive its own schema being older than its code, which is why the row-by-row
  retry and the classified blocker exist; what was missing was any way to notice. `select indexdef` is
  now the first thing to check when writes are refused wholesale.

### A gate block is ONE fact, not 367 failures (2026-08-25)
With the calendar syncing again, `Generate all` reported `✓ 0 generated, ✗ 367 failed`. Every build was
refused by the live-catalog gate, which returns HTTP 200 with the reason and the remedy:
`CATALOG_NOT_LIVE`, `NOT LAUNCH READY - DATA DEPENDENCY`, "Live connectors are disabled - set
LIVE_CONNECTORS=on", plus a four-step `remediation[]`. The bulk loop caught the Error, kept only its
message, and printed a count - so the one sentence that fixes it was thrown away 367 times.
- `generateEntry` now attaches the whole verdict to the thrown Error (`err.__gate`), and `generateAll`
  reports it ONCE: status chip, blocker, the DATA REQUIRED line, and the remediation as a list.
- It also **stops after the second identical block**. Every build shares one catalog and one set of
  connectors: continuing spends minutes re-proving the same fact and buries it under a bigger number.
- Same defect class as the 2026-08-19 gate-notice work, in the bulk path rather than the single one.

### ONE calendar on /brain, and it is the send table (2026-08-25, product owner)
The flip-flop below ended with both views rendering. The product owner's call is the TABLE only, so the
day-card list is gone: `#callegend`, `#calbody`, `#dayslots` and about 300 lines of renderer
(`renderDayGrid`, `chnChips`, `selectDay`, `viewSlotAssets`, `planIndexForSlot`, `slotReviewCtl`,
`slotAct`, `slotApprove/Reject/Reset/Download`, `closeDay`, `setDayWindow`) are deleted.
- **Deleted, not left unreachable.** Every one of those functions wrote into `#calbody` or `#dayslots`,
  so with the nodes gone a stray call is a TypeError, not a no-op. Checked first that nothing outside
  the block referenced any of them (0 external refs) and that the SHARED verdict primitives
  (`approveSend`/`rejectSend`/`resetSend`, which the table's row controls call) live elsewhere and are
  untouched.
- **The filters and bulk actions moved onto the table's card** rather than being deleted with the view
  they happened to sit on: `#downloadAll`, `#mktfilter`, `#durfilter`, `#catfilter`, `#generateAll`,
  `#approveAll` all act on `PLAN + slotVisible`, which never depended on the day grid's DOM.
- **The day-level READ stays**, because the freshness card is computed from it (`renderFreshness(d)`).
  `loadDayCalendar` no longer draws a grid, and its error path now writes to `#freshcells` only -
  `$('calbody').innerHTML` on a removed node would have thrown.
- The Window chips (`setDayWindow`) went too: their only job was sizing the day grid's history.
- Verified against the LIVE plan (790 entries served to the local build): table on the calendar card,
  415 rows, all four row actions, `.cw` caps live, 0 overlapping and 0 collapsed cells, freshness card
  still populated, no page errors. The spec now asserts the day view's ABSENCE, which is what stops a
  third flip-flop reintroducing a second calendar of the same 90 days.

### A button that does nothing is worse than no button (2026-08-25)
"View Full Tear-downs" on `/landing-pages` had no `onclick`, no `id`, no `data-*` and no delegated
handler. Clicking it did literally nothing.
- Scanned all **818 buttons** across the top-level pages: it was the ONLY genuinely unwired one. The
  presell/landing deliverables' carousel arrows are wired by class, and `lifecycle-calendar`'s "UK"
  chip is deliberately `disabled` with a title explaining the program is UK-only.
- **A first pass reported six**, because the regex required `data-x=` while this page delegates on
  VALUELESS attributes (`data-ai-fill`, `data-pm-download`). Matching the attribute NAME cleared five
  working buttons. A guard that cries wolf on working code is how guards get deleted.
- The card's four named brands are illustrative sample copy (its sibling card already said so about its
  own patterns), so there was no tear-down dataset to open. It is now a link to the REAL competitor
  intelligence surface, labelled with what that surface actually does, and the brand list carries the
  same "illustrative" qualifier its neighbour had.

### Restoring the send table, and the flip-flop that took it away twice (2026-08-25)
`/brain` has swapped between a send-level TABLE and a day-card LIST twice, each side deleting the other
and each commit message arguing the merge was overdue. The last swap left `renderPlan()` emitting all
nine columns - cohort size, the analysis that chose the send, confidence, the verdict controls and four
per-send actions - into `<table hidden aria-hidden="true" style="display:none">`. Fully working UI,
rendered for nobody.
- Restored at the product owner's instruction, and at THAT point both views rendered: the day card
  answered "what is happening on this day", the table answered "what is this send, and do I approve
  it", and the spec asserted BOTH existed rather than asserting the other one did not. **SUPERSEDED
  the same day** - see "ONE calendar on /brain, and it is the send table" above, where the product
  owner cut the day view and the spec now asserts its ABSENCE. Left here in the past tense because
  the reasoning below it (the `.cw` block, the contrast regression) is still live; the "both views"
  arrangement is not.
- The restore also had to bring back the `.cw` inner block: the hidden version had reverted to
  `max-width` on the `<td>`, which auto table layout IGNORES - the defect this repo has now shipped
  three times. And the Why column had drifted to `#a9b8ad`, about 2:1 on a light card; it is `#556059`
  again, with the contrast test restored alongside the truncation and overlap tests.

### A gate that cannot see the field you filled in (2026-08-25)
Mailer Studio blocked `mailer_full` with "Supply: Target audience / cohort" for a request that supplied
both. `brief-gate.assess()` reads `target_audience || audience || cohort.name || cohort.key`, but:
- `api/ai/generate.js` forwarded only `body.target_audience`, so a caller sending `audience` was told to
  supply an audience it had already supplied;
- a **string** `cohort` ('Lapsed 90d' - the shape used almost everywhere in this app) was invisible,
  because only `.name`/`.key` were read.
Both fixed. A gate that blocks correctly specified work is worse than no gate: it teaches the operator
that the gate is noise, which is exactly when it stops being read.

### A UK send planned around a US product, because two market names are the same length (2026-08-24)
Found while reading the frozen plan above. Of the 80 UK slots in the live 90-day window, **64 carried a
hero whose SKU was `VAH-US-*`**, and the US slots carried UK products in the same proportion. One line:
```js
const product = products[(epoch + k + market.length) % products.length].product;
```
The pool was every row in `smart_products` regardless of market, and the stride meant to separate the
markets was `market.length` - **2 for `US` and 2 for `UK`** - so the two markets got byte-identical
picks and either could be handed the other's catalog.
- It breaks the closed source-of-truth rule (no cross-region reuse of facts), and it also breaks
  GENERATION: the live-catalog gate resolves a named product against the REGIONAL store and blocks the
  build when it cannot find it, so a UK slot pointed at a US-only SKU is a slot that can never produce
  assets. 113 of 160 slots currently have no campaign at all.
- `smart_products` has a `market` column, so the pool is filtered on it, widening to market-agnostic
  rows (a row that claims no market is not another region's product) and only then, with nothing else
  to plan from, to everything - and a slot planned off that last resort carries
  `product_data_dependency: [DATA REQUIRED BEFORE LAUNCH: product catalog for <market> ...]` rather
  than presenting another region's product as this region's. The stride is now a real per-market hash.
- Determinism is preserved and is load-bearing (a re-run that changes an approved slot means the
  reviewer approved something that no longer exists); `tests/smart-brain-market-products.spec.js`
  asserts it alongside the market rule, and 2 of its 6 tests go red against the old line.
- The lesson is the same one as `market.length`: a "vary it by X" expression that happens to be
  constant across the real values of X is invisible in review and looks deliberate in the source.

### A degraded run must not call itself final (2026-08-19)
`/brain` showed `final - Final generated version, the best version of each asset, ready to view and
download` on the same screen as `Copy by template` and a failed `Live Catalog Gate` chip. The run had
not generated anything: no LLM answered, so copy fell back to templates, and the gate did not pass.
- The banner was unconditional. It now reads `incomplete - Saved, but NOT fully generated: ...` and
  names what degraded, and a clean run keeps its confident header (a warning that always fires is
  noise).
- **The explanation was suppressed by an off-by-falsy bug.** The label is
  `esc(cw.provider || 'template')`, so a MISSING `copywriter` renders the bare word "template", while
  the block explaining the fallback tested `/template/.test(String(cw.provider||''))` - false for an
  empty provider. A live fallback writes `provider:'template-fallback'` and WAS caught; a stored
  campaign that never carried the field was not. Both paths now reach the same warning.
- Every failed pipeline step prints its own `reason`/`blocker` + remediation inline. A warning triangle
  on a chip labelled "Live Catalog Gate" is not something an operator can act on.

### The homepage says what it solves, not what it contains (2026-08-19)
The hero was a capability list ("See your data. Watch competitors. Plan the month.") and the purpose
paragraph enumerated features. Neither said why the tool exists. `index.html` now leads with the
problem and carries a **What it solves** section: four problems the code actually addresses, each named
with the mechanism that addresses it (live catalog + gate, zero fabrication, per-asset engines, one
record many views), and no invented figure.

### Every asset is built by its own engine, not by one prompt with five slots (2026-08-19)
A mailer, a Google RSA, a TikTok cover, a presell landing page and an Instagram post are five
different design problems. They were generated as five slots of ONE JSON object, from ONE prompt at
ONE temperature, each rendered by ONE fixed template, so nothing in the pipeline knew that a Google
headline dies at 30 characters, that an organic caption may not carry baked-in text, that a landing
page's whole job is to repeat the ad's promise in the ad's own words, or that a video ad must move
inside 0.8s. The per-asset contracts in `master-prompt.js` existed but were attached to the OUTPUT as
a paste-anywhere `master_prompt`; the model that wrote the shipped copy never saw them. The mailer was
the one exception (`mailer-design-strategy.js` picks a real archetype per slot) - the right shape, for
one asset out of nine.
- **`api/_shared/asset-engines.js`** - one engine per asset type (mailer, ad x3, landing page, social
  x6, video, playable, blog). Each owns five things: `spec` (read from `asset-specs.js`), `design()`
  (the layout algorithm - which structure THIS slot gets and why), `contract()` (its own generation
  directive, injected into the copy prompt), `params` (its own temperature/tokens - an RSA sweep and a
  story-driven email are not the same generation problem), and `qa()` (its own deterministic
  validator). `qaCampaign()` rolls every asset up; `smart-brain-plan.buildCampaign` attaches it as
  `campaign.asset_qa` + an "Asset Engines QA" trace step, advisory like `ads_qa`.
- **QA reports, it never silently repairs.** A headline three chars over the Google cap is a copy
  problem; truncating it mid-word ships a broken ad that reads as finished. Issues carry the measured
  value and the limit. `ok` is false only on a CRITICAL - a warning is information, not a block.
- **Landing pages now have archetypes** (presell-narrative / proof-first / ritual-howto / comparison /
  gift-curation), chosen from the slot's stated intent and falling back to the seed. `lpHtml` renders
  in the archetype's section ORDER instead of always hero->why->product->proof->faq, and **a section
  whose copy the model did not supply is OMITTED, never padded** (a missing section is reviewable, a
  fabricated one is not). The page records its archetype in an HTML comment.
- **The design choice is deterministic and seeded, never random** - a re-run that changes an approved
  asset means the reviewer approved something that no longer exists. **The seed's finalizer is
  load-bearing:** FNV-1a's low bits are weak, so `h mod 4` with two different salts came out separated
  by a CONSTANT offset - every ad format was paired with the same social angle on every slot, 4 of 16
  possible combinations, lockstep dressed up as variety. A murmur3 `fmix32` avalanche fixes it, and
  `tests/asset-engines.spec.js` pins the pair count above the number the unmixed hash produced.
- **One source for every limit.** Caps come from `asset-specs.js` and the banned-phrase list from
  `scenario-model.js` (`BANNED_PHRASES_RX`, now exported). `ads-qa.js` had grown its own `LIMITS` map
  and the banned regex lived in three files. The spec test mutates `asset-specs` and re-requires, so a
  re-typed constant fails rather than passing on a coincidence.

### CI threw away the evidence for every failure it reported (2026-08-21)
Every failing run logged `##[warning]No files were found with the provided path: tests/report/. No
artifacts will be uploaded.` and nobody read it. The workflow ran `npx playwright test
--reporter=list`, and **a `--reporter` flag REPLACES the whole reporter array from
`playwright.config.js`** - so the `html` reporter never ran, `tests/report/` was never created, and the
upload step pointed at an empty path. Worse, the screenshot, video and trace for each failure land in
`test-results/`, which was **never uploaded at all**.
- So CI would say WHICH test failed and discard everything explaining WHY. That is what made
  `brain-calendar-card` unfixable for days: it reproduces only on the WebKit projects, WebKit cannot be
  installed in this sandbox (`playwright install webkit` -> the download host is not in the proxy
  allowlist), and the one artifact that would have shown the actual assertion was thrown away.
- Fixed: no `--reporter` override (the config already lists `list` first, so console output is
  unchanged) and the upload collects **both** `tests/report/` and `test-results/`, with
  `if-no-files-found: warn`. `tests/ci-artifacts.spec.js` pins it, including that no future workflow
  edit reintroduces a `--reporter` flag.
- **The general lesson: a warning in a CI log is not noise.** This one had been printing on every red
  run and described the exact reason the failures could not be diagnosed.

### Six red pushes, none of which a local test run could have caught (2026-08-23)
Asked to make every push and deploy land clean. The tests were already being run before every push, so
the useful question was why that was not enough. Classifying the session's six CI failures:
env-dependent spec (passed here because the CLIs were installed, failed on a bare runner), three CodeQL
regex findings (static analysis, not a test), an unused import (no linter existed), and a WebKit-only
timeout. Only the last is genuinely uncoverable locally.
- **A linter, configured as a RATCHET.** `eslint.config.mjs`, scoped to the standalone JS that CI
  already syntax-checks plus the specs. Correctness rules (`no-undef`, `no-const-assign`, `no-dupe-keys`,
  ...) are **error and all at zero**, so the gate can only go red on newly broken code; the ~47
  pre-existing unused-vars/useless-escape are **warnings**. Making those blocking would turn CI red on
  untouched work, which is not a gate, it is a chore.
- **It found a live 500 within minutes.** `api/calendar.js` declared `const q` inside the
  `lifecycle-list` branch and read it from `lifecycle-build-mailer`, a different block. `||`
  short-circuits, so `q && q.force` only evaluated when `body.force` was falsy - **the default call** -
  giving `ReferenceError: q is not defined`. ~800 tests never touched that path.
- **`scripts/preflight-push.sh`** runs what CI runs: syntax, lint, the real inline-JS spec, the shell
  scripts under a deliberately **bare PATH**, then the Chromium suite. It names what it cannot cover
  (WebKit, CodeQL) instead of implying a green local run means green CI. `--fast` skips the 8-minute
  suite for iterating and says it is not a substitute.
- **The preflight's first version reimplemented the inline-JS extractor** and immediately drifted - no
  `type="module"` handling, 7 false failures. It now invokes the spec. Same defect as nine copies of the
  URL map; a local copy of shared logic goes stale the moment the original learns something.
- **`eslint --fix` is not safe to run unreviewed.** It stripped deliberate `eslint-disable` comments from
  six files and left trailing whitespace. Those comments are intent, and deleting them silently re-arms
  the rule later. `linterOptions.reportUnusedDisableDirectives: 'off'` now prevents it, and a test
  asserts the suppressions are still there.
- **The WebKit timeout was under-budgeting, not flake.** `cta-and-filters` walks 20 controls with a 5s
  click cap: a ~106s worst case inside the 60s default timeout. It could not fit, and only passed
  because clicks usually land fast. Click cap 2s, file budget 120s, and a test asserts
  `budget > computed worst case` **and** that the control cap was not lowered - fixing a timeout by
  cutting coverage is the tempting wrong answer.

### The check written to prevent red pushes was blinded by local state (2026-08-23)
The very push that added the preflight above went red on CI in **14 seconds, on both jobs at once**,
before a single test ran: `npm ci` refused `package-lock.json`. eslint had been added to
`package.json` without regenerating the lock, so CI got `Missing: callsites@3.1.0 from lock file` and
stopped.
- **The preflight passed, and that is the lesson.** `node_modules` is already populated in the dev
  sandbox, so `npx eslint` ran perfectly off a package the lockfile had never heard of. A local check
  that reads the ENVIRONMENT rather than the COMMITTED ARTIFACT will confirm whatever the machine
  happens to hold. Same shape as the bare-PATH trap one section up, and I walked into it again in the
  same session.
- Stage 5 now runs **`npm ci --dry-run`** first: it reproduces CI's validation exactly, touches no
  `node_modules`, costs a second, and cannot be fooled by local state. Vercel installs from the same
  lockfile, so this is one check for both platforms. Verified with teeth - adding an un-locked
  dependency turns it red with `run: npm install --package-lock-only` in the message.
- **A green CI is not a green DEPLOY**, and the same stage now covers the rest of that gap.
  `npm run build` IS the `buildCommand` in `vercel.json`. `tests/vercel-deploy.spec.js` checks the
  deploy manifest itself: **a rewrite whose destination file was deleted 404s a nav link while the
  deploy still reports success** - this repo has form, since `ads-dashboard.html`, `ad-campaigns.html`
  and `ads-masterclass.html` were each merged away and deleted. All 125 rewrites resolve today, so it
  is a regression guard rather than a live bug.
- **The function count is 12/12 - at the Hobby cap, not comfortably under it.** A 13th file under
  `api/` fails the deploy outright. The spec asserts CI keeps its fast shell guard too, so that case
  still fails in seconds instead of at the end of a 90-minute suite.
- The redirect check strips the **fragment** as well as the query. My first version reported four
  false positives because `/ads -> /ads-master#crestudio` is how Creative Studio keeps its own
  entrance, and a rewrite cannot carry a hash - which is exactly why those four are redirects. The
  config was right and the check was wrong.
- **A check that depends on remembering to run it is not a check** - the push that ADDED the preflight
  went red because I pushed without running it. `.githooks/pre-push` now runs `--fast` on every push
  (~19s: lockfile, lint, syntax, inline JS, bare PATH, deploy manifest - everything except the
  8-minute browser suite, which would just get bypassed). Activated by a `prepare` script, which
  **also runs during `npm ci` on Vercel**, so it ends in `|| true`: a non-zero `prepare` fails the
  install and therefore the deployment. `git push --no-verify` is the documented escape hatch, so a
  broken hook can never wedge someone out of pushing.

### A claim with a test beside it is a warranty; without one it is marketing (2026-08-21)
From a portfolio audit of the sibling products: "the enforcement table - claim -> test that holds it -
is the single most sellable asset in the entire portfolio. Nothing else here has it." This repo makes
strong claims (zero fabrication, no black backgrounds, one URL source, a live-catalog gate) and nothing
connected any of them to the ~800 tests that enforce them.
- `docs/enforcement.md` is GENERATED by `scripts/build-enforcement-table.js` (`npm run build:enforcement`).
  Each claim names a spec file AND a substring of a real test title; the generator resolves both and
  **exits non-zero rather than emitting an unbacked claim**. A renamed or deleted test breaks the build
  instead of quietly leaving a claim unenforced.
- It caught two of its own bindings immediately - `asset-design-variety` and `kill-switch` had no test
  matching the phrase I guessed - which is the mechanism working before the file ever shipped.
- Hand-writing the table would have reproduced the exact drift this file keeps recording (nine copies of
  the URL map, three documented provider counts, a launch gate nobody computed). `tests/enforcement-
  table.spec.js` re-runs the generator in `--check` mode, and proves the teeth by mutating a claim to
  name a nonexistent test and asserting the generator refuses.
- Found in the same pass: `robots.txt` named `vahdamteas.com` as "the live customer store", a host
  `market-urls` classifies as REDIRECTING. Fixed, and the spec now asserts no redirecting host appears
  there.
- **Scope note:** both audit documents assess `Anchit-AI-Hustle/lifecycle-os`, a DIFFERENT multi-tenant
  product at `lifecycle-os.anchit-tandon.com`. Three of its five flags (credit packs with no price, a
  PWA manifest contradicting the homepage, two front doors) do not exist in this repo and were not
  "fixed" here. Only the two findings that reproduce against this codebase were acted on.

### The most-cited bug in this file had no automated check (2026-08-21)
"Common Bugs to Watch" opens with unescaped quotes in the giant inline-JS pages - "a stray backtick in a
CSS comment once broke a template literal and killed the sidebar". Nothing checked for it. CI runs
`node --check` over `api lib workers scripts` and the root `*.js` glob and stops there, while the pages
carry **~4.2MB of inline JavaScript across 239 files in 311 script blocks**. A syntax error in any of it
kills that page and CI stays green, because a broken `<script>` is a runtime failure and never a build
one.
- The CI step's own comment records learning this lesson once already, for root scripts: "a list that
  must be updated by hand is a list that gets forgotten." The same reasoning applies to WHERE the code
  is, not just which files are named - and the pages are where most of this app's JavaScript lives.
- `tests/inline-js-parses.spec.js` parses every inline block. It skips `src=` scripts and any non-JS
  `type` (`application/ld+json` is data, `text/template` is markup - the browser does not parse either
  as JS, so neither should the guard), and it asserts the CI step still covers the standalone scripts so
  this is read as extending that coverage rather than replacing it.
- All 311 blocks parse today, so this is a regression guard rather than a latent bug. Verified with
  teeth: injecting one curly apostrophe into `index.html` turns it red with the file and line.

### The market-URL map came back three times, and the guard could not see it (2026-08-21)
`market-urls.js` was made the single source after nine hand-maintained copies were found. **Three came
back**, and the existing spec could not catch them: it tests that a known DEAD host has not reappeared,
which says nothing about a fresh map of live-LOOKING hosts.
- `api/ai/generate.js` (`LP_STORE`), `api/_shared/brand-llm.js` (`STORE_BASE`, whose comment asserted a
  `vahdam.in` the canonical map does not have) and `api/_shared/landing-page-core.js` (`STORE`).
- **The worst was silent and regional:** `landing-page-core` mapped Global, EU, AU and ME all to
  `vahdam.com`, so every Global landing page linked to the US storefront - wrong store, wrong currency,
  wrong catalog - while looking perfectly reasonable in source.
- All three also used the APEX domain. `market-urls` already classifies `vahdam.co.uk` and
  `www.vahdamteas.com` as `REDIRECTING_HOSTS`, and the new guard found two more places relying on them:
  `brain-generate.js` used `https://www.vahdamteas.com` as the DEFAULT store in five generators, and
  `social-core.js` used apex `vahdam.co.uk` in five places including the prompt that tells the model
  which URLs it may emit.
- Two new tests in `tests/market-urls.spec.js`: no module may hold its own region→vahdam-host object
  (two or more keys), and no source may name a vahdam host absent from `STORE_BASE`. The app's own
  `*.vercel.app` origin and `try.vahdam.*` are exempt for a stated reason rather than by omission.
  Verified with teeth - restoring one map turns two tests red.
- **The lesson is about the guard, not the map.** A test written against the symptom you just fixed (a
  specific dead host) does not cover the defect class (a local copy of a shared map). Guard the shape,
  not the instance.

### Black was still being painted as a section background, in seven places (2026-08-21)
The spec's HARD design rule - never a black / `#171717` / dark-neutral SECTION background, use green -
was being violated by the shipping product. A generated mailer opened with a black band across the top,
reported twice from the live studio, and the black offer banner sat mid-email under "ENDS SOON".
- Four Mailer Studio section renderers painted their section on `_ARCH_INK`: `_sec_annBarUrgent`,
  `_sec_offerBannerBold`, `_sec_urgencyStrip`, `_sec_countdownBlock`. All four are green now.
- **A naive swap trades a banned background for an unreadable one.** Gold on green measures **3.12:1**
  - AA-large ONLY - and every one of those labels is 10-10.5px, so the gold had to become cream
  (9.61:1) at the same time. The button's white-on-gold was already only 3.34:1 and became ink on gold
  (5.36:1). Compute the ratio before choosing the replacement colour, not after.
- **The countdown tiles were ALREADY green**, so greening their section would have made them vanish
  into it rather than merely look off-brand. They are cream with green text now. When you change a
  container's colour, check what was relying on contrasting against the old one.
- The guard found three more the report never mentioned: a generated LANDING PAGE `footer` on
  `var(--ink)` in `smart-brain-plan.js` (customer-facing, fixed) and two dark navbars in the studio's
  own preview chrome (fixed - the operator looks at those too).
- **Two `#000` wells are CORRECT and stay:** the backdrop behind a `<video>` in `landing-page.js` and
  behind the video-ad iframe in `ad-creative.js`. Media does not fill its frame, and green letterbox
  bars round a video read as a rendering fault. They carry a `letterbox-well` marker at the point of
  use so the exemption is auditable; `tests/no-black-backgrounds.spec.js` asserts the marker only ever
  sits on a well that actually contains a video, and that exactly two exist - otherwise the marker
  becomes an escape hatch for smuggling a section background back in.
- Ink remains legal as TEXT (it is one of the four brand colours). The guard matches on `background:`
  only, and a separate test asserts ink is still used for text somewhere, so the suite cannot pass by
  the colour having been deleted entirely.

### getBoundingClientRect on a ROTATED ancestor is not the element's box (2026-08-21)
`main` sat red from `brain-calendar-card.spec.js` from #386 onward, so every PR opened against it
inherited a red CI. **I misdiagnosed this twice, and the second time is the instructive one.**
- The test is named "a long product name is not truncated", so I assumed the truncation assertion was
  failing and fixed the CSS. I never read the assertion. The failure was the line BELOW it - the
  row-stacking check - reporting a ~4.5px vertical OVERLAP between consecutive rows
  (`expected >= 1393.4288, received 1389.9346`).
- **The real cause: `motion.css` reveals panels with a small ROTATION, and
  `getBoundingClientRect()` on a rotated element returns its AXIS-ALIGNED bounding box.** The AABB of
  a rotated box is larger than the box, and the error grows with distance from the transform origin -
  so far down a long list, stacked rows' boxes overlap and it reads exactly like "a row is beside
  another instead of below it". Nothing was painting over anything. `reducedMotion:'reduce'` is
  necessary but NOT sufficient: it only forces `transform:none` on `.vh-rv` and `.vh-kin .vh-w`.
  **Wait for the ancestor transform to settle before measuring geometry** - the guard exists in
  `ads-master-columns.spec.js` and now in `brain-calendar-card.spec.js`.
- **Tells that should have redirected me sooner:** the numbers were byte-identical across three
  different viewports (so not a width story) and byte-identical before and after a CSS change that
  alters row height (so not a layout story). On Chromium the rows are uniform 38px in a flex column
  with `gap:4px`, where `row[i].top - row[i-1].bottom` is ALWAYS +4 - a negative value is structurally
  impossible for uniform siblings, which should have said "the measurement is wrong", not "the layout
  is wrong".
- **A green fix inside a DRAFT pull request is invisible.** #387 contained the correct diagnosis and
  fix, fully green and mergeable, while `main` stayed red for days and every new PR inherited it.
  Nothing surfaces a draft: the merge API refuses with `405 Pull Request is still a draft`, and the PR
  listing reported `mergeable: true, mergeable_state: clean` because neither field mentions draft
  state. When CI is red on `main`, check the open PRs for a fix before writing one.
- The truncation defect was REAL and is fixed in the same pass (`white-space:normal;
  overflow-wrap:anywhere` - wrapped text cannot exceed its box on any engine, and `anywhere` covers a
  single unbroken token). It simply was never the reason CI was red. Two added tests fail on Chromium
  against the old CSS, so that defect is now reproducible on the engine you have.
- **`tail` on a Playwright run hides the summary line**; grep for `^  [0-9]+ (passed|failed)`. A local
  `--project=iphone-se` run was read as a Chromium reproduction when it was 236
  `browserType.launch: Executable doesn't exist` errors. WebKit cannot be installed here at all
  (`playwright install webkit` -> the download host is not in the proxy allowlist), and the CI artifact
  that would have shown the assertion is served from `productionresultssa5.blob.core.windows.net`,
  which the proxy also denies. **When you cannot fetch the artifact, put the evidence in the log**: the
  assertion now prints a full row-geometry table on failure.

### A seed gives INDEPENDENCE, which is not variety (2026-08-21)
"Ensure a unique and appropriate design in every asset every time." Measured over a real 90-day x
2-market x 6-cohort calendar (1080 slots), it was neither. Every engine repeated its own design
back-to-back at exactly the rate chance predicts (~25% on a 4-item list, 60-100 three-in-a-rows), and
two were far worse because they resolved intent to a SINGLE archetype - a cohort's objective does not
change from one send to the next, so **the mailer repeated 100% of the time** (Loyalists got
editorial-lookbook forever, 1056 three-in-a-rows) and **the landing page 73%**. Every individual
choice looked perfectly reasonable; the defect was purely statistical, which is why only measurement
found it.
- A calendar does not want independence, it wants each send to differ from that cohort's LAST send.
  `rotate()` walks a seeded permutation by the slot's **date ordinal**, so consecutive sends cannot
  collide. Result: every asset type now under chance, **zero three-in-a-rows anywhere**.
- **Determinism is preserved and is load-bearing** - a re-run that changed an approved asset would
  mean the reviewer approved something that no longer exists. Variety is never bought with randomness.
- **Per-cycle re-permutation is not optional.** A cadence that divides the list size (a weekly send
  against a 7-item list) lands on the same permutation index forever; the rotation is then invisible
  while still looking correct in the source. Re-permuting each cycle breaks the aliasing, and the spec
  drives cadences 2/3/4/5/7/14 to prove no cadence collapses to one shape.
- **A slot discriminator is needed too**: two slots for the same cohort+market on the same DAY (an A/B
  pair, two products) share an ordinal and would be designed identically. It has to be stable ALONG
  the sequence or every date gets its own permutation and the walk dies, so it is the slot id minus
  its date (`cal_2026-09-01_US_loyalists` -> `cal__US_loyalists`).
- **Unique is not the only requirement; appropriate is the other, and over-rotating broke it.** The
  first fix rotated a gifting page onto `presell-narrative` - a shape whose whole job is convincing
  COLD traffic a problem exists, when a gift buyer has already decided to buy a present. The existing
  test caught it. Intent therefore now drives **two different things**: `audience` is a COPY DIRECTIVE
  that applies to every page for that intent whatever shape it takes (a gift buyer is not the drinker,
  true of a picks list and a comparison alike), and `suitable` is the set of section ORDERS that
  genuinely serve it. Rotation happens only inside `suitable`, so variety never costs message match.
  Attaching that requirement to one archetype's `fit` string is what let rotation silently drop it.
- Where an intent genuinely has one right shape, repeating is CORRECT, not a bug. The playable was the
  one asset with no variety at all; it now has two shapes because the renderer genuinely builds two
  (`renderPlayable`, `renderPlayableVideo`). A third would have had to be invented, so there are two.
- `tests/asset-design-variety.spec.js` measures the real engines over the real calendar rather than
  reading source, since the defect was statistical. Verified with teeth: reverting to the seed turns 3
  of its 11 red.

### A gate that blocks silently is indistinguishable from one that is broken (2026-08-19)
The gates answer **HTTP 200** with `{ok:false, blocked:true, message, blocker, data_required,
remediation}` — deliberately, because the API worked and declined. Every front end read only
`j.error`, which that payload does not carry, so `/social` rendered **"Pipeline call failed: HTTP 200 -
is the API deployed/reachable?"** (the status of a SUCCESSFUL response given as the reason it failed,
sending the operator to check a healthy deployment) and `/brain` rendered a bare **"Generation
failed"**. The payload itself said "Live catalog unavailable for UK - set `LIVE_CONNECTORS=on`", which
is the one sentence that fixes it. Same defect class as the Klaviyo health probe above: a message that
sends someone to fix the thing that is not broken.
- **`gate-notice.js`** (shared front-end, alongside `chart-enhance.js` / `funnel-drill.js` /
  `ai-studio-bar.js`) is the single explainer: `GateNotice.explain(json, response)` /
  `.message(prefix, json, response)`. A block renders as a **verdict** (reason + `data_required` + "To
  fix: …", styled as info, not as a crash); only a genuine transport failure (`!r.ok`, or a thrown
  fetch) may ask about reachability; `ok:false` with no reason is reported verbatim rather than
  disguised as a status code. One module, not a copy per page, for the reason `market-urls.js` exists.
- Wired into `social-media.html` (run / load / approve) and `smart-brain.html` (7 call sites), each with
  an inline fallback for a cache miss on the module. `tests/gate-notice.spec.js` pins it and drives the
  real page against a stub that returns the captured blocked payload **with HTTP 200 on purpose**.
- **Testing trap:** `auth.js` registers `sw.js` on `load`, `sw.js` calls `clients.claim()`, and the
  `controllerchange` handler reloads the page 50ms later (PWA self-heal). On a loaded machine that
  reload lands AFTER a test's click and wipes the banner it is reading — the spec passed alone and
  failed in the suite. Browser tests that click and then assert on page state need
  `test.use({ serviceWorkers: 'block' })` unless the SW is what is under test.

### Live data sources — six platforms, one contract (2026-08-01)
Every platform has a core, every core is wired, and **none fabricates**. With no credential each
returns `{connected:false, would_request|would_query, blocker}` naming the exact call it would have
made — callers render an honest empty state instead of a plausible number.

| Platform | Core | Reached via |
|---|---|---|
| Shopify (live, read-only Admin) | `_shared/shopify-core.js` | `/api/shopify?op=shop\|orders\|products\|products-paged\|customers\|inventory\|summary\|attribution` |
| Product catalog (live, gated) | `_shared/catalog-live.js` · `_shared/catalog-gate.js` | `/api/catalog?op=products\|status\|refresh\|verify` |
| Meta Ads | `_shared/ads-live-core.js` (dashboard) · `_shared/ad-insights-core.js` (reporting) | `?action=ads-live` · `?action=ad-insights` |
| Google Ads · TikTok Ads | `_shared/ad-insights-core.js` | `?action=ad-insights&platform=google\|tiktok` |
| Klaviyo · WebEngage | `_shared/klaviyo-core.js` · `_shared/webengage-core.js` | `?action=klaviyo` · `/api/webengage` |

- **Direct API is PRIMARY for US; Snowflake is a fallback mirror, not a dependency.** `ads-live-core`
  asks Meta for the FULL metric set (conversions, revenue, purchase ROAS, reach, frequency, CPM, CPC,
  CTR), not just delivery — that widening is what removes the need to query the warehouse for anything
  commercial. Responses carry `metrics_complete`/`complete_metrics`. The warehouse has **no conversion or
  revenue columns**, so on that path ROAS and cost-per-conversion are `null`, never `0` (zero would read
  as "we sold nothing" rather than "this source cannot know").
- Meta reports purchases under several `action_type`s (`omni_purchase`, `purchase`,
  `offsite_conversion.fb_pixel_purchase`) — take the **first present, never the sum**, or one purchase is
  counted three times.
- **`/api/connectors-health` probes all seven** (the four above + Supabase) with real round-trips and an
  actionable `blocker` each, grouped `paid_media`/`lifecycle`/`commerce`. It previously covered only four
  and was blind to the entire paid-media stack.
- **Shopify is read-only three ways over:** only GET reaches Shopify hosts (`read-only-egress.js`), no
  mutating op exists in the core, and the token should be read-scoped. Gated on `LIVE_CONNECTORS` like
  every other outbound connector. `ad-insights-core.js` now honours it too (Meta/Google/TikTok each
  return `switchedOff(...)` when it is off) — an earlier note here said it did not; that is no longer true.
- **The kill switch only works if every core actually calls it (2026-08-06).** `klaviyo-core.request()`
  gated on `KLAVIYO_API_KEY` alone, so with a key set and `LIVE_CONNECTORS` off it called Klaviyo for real
  while `isConnected()` — and therefore `/api/connectors-health` and every caller that asks before acting —
  reported it not connected. Two failures at once: the safety control was silently ineffective, and the
  health endpoint told the operator to set a key that was already set and working, sending them to fix the
  one thing that was not broken. Now: `request()` honours the switch, `hasKey()` is exported so a probe can
  tell "no key" from "switch off", and `probeKlaviyo()` ATTEMPTS THE READ rather than predicting it from env
  vars. `tests/kill-switch.spec.js` asserts every outbound core both imports **and calls**
  `liveConnectorsEnabled()`.

### Two rendering/date invariants that erode silently (2026-08-01)
- **A stale date must never present itself as today.** `ads-snowflake-core`'s `fresh_to` is a
  VERIFICATION RECORD (what the table held when someone last checked), and the registry's
  `partial_day: true` beside it meant "that day is today, still accruing" — true on the day of
  verification, a lie every day after. The dashboard was rendering `Data fresh to 2026-07-25
  (includes the current partial day)` a week later; both dates being Saturdays made it read as
  plausible. `describeAccount()` now DERIVES `partial_day` (`fresh_to === today` in `ADS_REPORT_TZ`)
  and exposes `today`, `stale_days`, `freshness`, `freshness_note`, keeping the original observation
  as `verified_partial_day`. Never re-assert a stored freshness flag as a live claim.
- **Table columns declare their kind.** `data-analysis-extensions.js` `table()` takes `N()` numeric /
  `W()` wide identifier / `ID()` machine id / plain string. The host page sets `table{width:100%}` +
  `th,td{white-space:nowrap}`, so long unbroken campaign tokens used to overflow and paint over the
  next column — the tables were literally unreadable. Text now wraps inside a `.cw` inner block
  (**`max-width` on a `<td>` is ignored by auto table layout** — it must live on a block inside the
  cell), numbers stay `nowrap`/right/tabular. Locked by `tests/table-readability.spec.js`, which reads
  the real CSS out of both source files and asserts geometrically that no cell overflows and no two
  cells in a row overlap.
- **Render every field the view returns.** The ads table showed 14 of the 20 fields
  `data-analysis-core` produces, dropping `level`, `entity_id`, `cpm`, `conversion_rate`, `reach` and
  `frequency` — reach/frequency being the only way to see a set re-serving the same people. Pinned by
  a coverage test. Do NOT invent derived columns to fill gaps: `opens/events` is not an open rate
  (`events` is the total event count, not deliveries), so it is left out rather than shown wrong.

### Clickable rows — one funnel graph, and a drill may never invent a join (2026-08-16)
`funnel-drill.js` (shared front-end, alongside `chart-enhance.js` / `table-sort.js` / `ai-studio-bar.js`)
holds the ONE attribution graph every analytics table drills through:
`region → channel → platform → campaign → ad set → ad → landing page → product`, with the lifecycle side
(`segment → mailer → landing page`) and the time cuts (`month → week`, `acquisition month → cohort
quarter`) joining it. A table declares its stage; every row then becomes a click target that opens the
next step, carrying the row it was clicked from.
- **The load-bearing rule: a drill narrows the next step ONLY where a join key genuinely exists.** Ad rows
  carry `platform`/`campaign`/`adset`, so those three edges filter exactly. Nothing ties a Shopify sales
  channel to an ad platform, or an ad to a landing page (the ad cut carries no destination URL), so those
  drills navigate **unnarrowed** and say so — in the graph edge's own words, before the click (it is the
  row's `title` and the button's `aria-label`) and again as a banner after. Silently filtering there would
  invent an attribution and put a confident wrong number in front of the business. Every `join(){return
  null}` edge and every terminal stage carries a required `why`; `tests/funnel-drill.spec.js` fails the
  build if one is missing or shorter than a real explanation.
- A **blank key is not a filter** (filtering campaigns on `''` would show the rows that are also blank and
  read as "this platform ran one campaign"). A drill step whose field the target cut does not carry is
  **dropped and named** in the breadcrumb ("Carried but not applied"), never applied to empty the table. A
  filter that matches nothing **replaces** the table rather than sitting above `table()`'s "no
  source-backed rows" empty state, which would be false — the source has rows, the filter has none.
- A stage with no downstream attribution step (product, cohort retention, day of week, the live order
  feed, connector runs) is **not** given a fake successor to satisfy "every row clicks". Its rows open the
  full record plus the reason the chain stops there.
- Region drills **re-scope the market toggle** instead of filtering rows — filtering would leave the KPI
  header on one market and the table under it on another.
- Mechanics: `table()` renders a string, so records are parked in a registry keyed by `data-fd-id` and
  handed to `FunnelDrill.attach()` by `wire()` after the HTML lands (records are sliced to the render
  `limit` so row *n* is record *n*). Rows are split on **whether they contain a `<td>`**, not on
  `tBodies[0]` — `data-analysis.html`'s own `table()` emits a bare `<table><tr><th>`, so the parser files
  the header row inside the implicit tbody and index-walking would hand record 0 to the header and shift
  every drill by one. The whole `<tr>` is a mouse target but the action is also a real `<button>` with an
  `aria-label` (a `<tr>` cannot be focused meaningfully by AT), and the appended column gets a
  `scope="col"` header so it is not a phantom. Anything already interactive in the row keeps its own
  behaviour — that is what stops the ads-master hierarchy anchors being swallowed.
- Wired into: `data-analysis.html` (native widget detail tables), `data-analysis-extensions.js` (Revenue
  Analysis with a breadcrumb trail, plus Mailer / Landing / Agents / Actions), and
  `ad-campaigns-master.html` (whole-row targets on campaign → ad set → ad). `tests/funnel-drill-live.spec.js`
  drives the real page over a throwaway static server (absolute asset paths mean `file://` cannot serve it)
  and asserts the chain actually filters, because a source-only test cannot prove a row clicks.

### `/analytics` is a document, not a frame around one (2026-08-13)
`/analytics` and `/data-analysis` rewrite to **`data-analysis.html` itself**. They used to rewrite to
`data-analysis-contrast.html`, a 5KB shell that iframed the real page, injected ~50 `!important` rules
across the document boundary, re-added them from a `MutationObserver`, and side-loaded
`data-analysis-extensions.js` into the frame's body. That shape caused three defects that were invisible
on the page itself:
- **auth.js ran inside the frame, so the nav did too.** Nav links are deliberately plain `href`s
  ("internal nav stays in the same tab so the back button works") and inside a frame that means the same
  FRAME: clicking Mailer Studio loaded `/studio` into the iframe while the address bar still said
  `/analytics`, and the wrapper's `load` handler then injected the analytics palette **and** the
  extensions script into whatever page had just arrived.
- **The iframe `src` was a bare `/data-analysis.html`**, so `?mkt=` never reached the page that reads it
  (`/analytics?mkt=UK` rendered US). `?tab=` survived only because the extensions read it off `parent`.
- **`/data-analysis.html` opened directly had no extensions**, so the path the nav lists as the same
  feature rendered 4 tabs of 10.
Now: the palette lives in `data-analysis.html` as `#vahdam-high-contrast-override` (still `!important`,
to beat the base palette without rewriting 50 rules for no visible gain), the page loads its own
extensions, `/data-analysis-contrast.html` 308-redirects to `/data-analysis` (needed because
`cleanUrls` is false), and the wrapper is deleted. The extensions needed **zero** changes: their three
`parent.` uses resolve to `window` when nothing is framed. Locked by `tests/analytics-surface.spec.js`.
**Do not reintroduce a wrapper to restyle a page — edit the page.**

### Sync registration: one surface per page, and refresh means re-READ (2026-08-13)
- **One surface per page, registered once.** `data-analysis-extensions.js` used to register
  `data-analysis:<tab>` *at the moment a tab opened*, so surfaces accumulated across a session and a
  sync re-opened every visited tab in turn, landing on whichever registered last. It now registers a
  single `data-analysis` surface at boot whose `load` refreshes whatever `state.tab` currently is.
- **The default view is a surface too.** Only EXTENSION tabs registered, so the four native tabs — the
  default view of the surface the owner names first — reported `page reload` and never refreshed in
  place. `window.__daNative.refresh()` in `data-analysis.html` is the native loader.
- **A committed file is never `live`.** `data/analytics/live-shopify.json` is a snapshot a human pulled
  through the Shopify MCP (`pulled_at`, no generator writes it — only `market-analytics.js` reads it).
  Re-reading it quickly is not reading the store, so it reports `source:'snapshot'`, and its age is
  DERIVED at render time (`liveFreshness()`) instead of printing a fixed date beside the word "live" —
  the same defect as the `ads-snowflake-core` `partial_day` case above.
- **Refresh must never re-generate.** `/daily-email-calendar` is registered because
  `calendar?action=smart-brain-plan` is a plain read. `/plan` and `/lifecycle-calendar` are deliberately
  NOT registered: they call `calendar?action=generate` / `lifecycle-generate`, and putting a generator on
  a timer would spend model quota and rewrite the plan on a schedule nobody asked for. `landing-pages.html`
  is out for the same reason (`/api/ai`).
- **A STALE asset is not a stale READ.** `assets.html` (`assets:generated`) reports `live` even when the
  strip says campaigns need regeneration: the read is current, the *assets* are not. Calling that
  `snapshot` would merge two different facts.
- **Reload-only is sometimes the correct answer.** `dashboard.html`, `competitor-benchmarking.html` and
  `cohort-definitions.html` issue no `/api/` calls at all — they are static/localStorage surfaces, so the
  bar's "registers no live data source" fallback is honest, not a gap. Do not invent a loader for them.
  Genuinely still open: `knowledge-base.html` (`kb?action=top-emails` is a read and could be wired).
- Registered today: `ad-campaigns-master` (4), `smart-brain`, `all-in-one`, `social-media`,
  `data-analysis`, `calendar:plan`, `assets:generated`. `tests/sync-everywhere.spec.js` pins the list.

### Local Playwright runs can pass without running anything (2026-08-13)
`playwright.config.js` honours `PW_CHROMIUM_PATH`, and in this sandbox you **must** set it:
```bash
export PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
```
The package pins a Chromium build the sandbox does not ship (it has `chromium-1194`, the package wants
another), and without the override the browser-driving specs die at `browserType.launch: Executable
doesn't exist`. Depending on which specs are selected the run can still print a clean
`N passed` — a pass of the file-reading specs only. This bit during the work above: a
"96 passed" baseline had run **no** browser at all. CI is unaffected (`npx playwright install
--with-deps` installs the pinned build and leaves the var unset). Treat a local green as meaningless
unless the var is set.
Second half of the same trap: only **Chromium** projects can run here. `iphone-se`, `iphone-12` and
`ipad` resolve to `defaultBrowserType: 'webkit'`, and no WebKit is installed, so every browser-driving
spec on those projects dies at launch (`Running as root without --no-sandbox`) — pre-existing specs
included, so a failure there is the sandbox, not the diff. Verify locally with
`--project=desktop-1280` and `--project=pixel-5` (393px, Chromium) to cover mobile; leave the WebKit
projects to CI.

### Competitive benchmarking — the own/competitor boundary is load-bearing
`_shared/competitive-benchmark-core.js` (`/api/competitor?action=benchmark|benchmark-set`) benchmarks us
against a competitor using the same platform stack, on top of the existing Gmail→Sheet email intel.
**Our Meta/Google/TikTok/Klaviyo/WebEngage credentials report on OUR OWN accounts and can never return a
competitor's spend, CTR, CPM, ROAS or open rate.** So the module keeps two sides that never merge:
- `comparable` — observable on both sides **by the same method** (catalog size + price band, read from
  `/products.json` for them *and* for us). Emitted only when both sides actually read.
- `own_only` — ours exists, no competitor value can, so `competitor: null` + a reason. Never estimated.
Competitor side needs **no credentials and works today**: public `/products.json`, Meta Ad Library
(`APIFY_TOKEN` upgrades a deep link to structured creatives), Google/TikTok transparency deep links
(neither exposes a public reporting API). Locked by `tests/live-data-sources.spec.js` — a benchmark that
quietly passed our own CPM off as "category CPM" would be fabrication in the most damaging place.

### Shared LLM caller — `api/_shared/llm.js`
**Eleven-rung, tier-routed** waterfall, de-duplicated, and **Anthropic-first** (not OpenAI-first): **Anthropic** -> **OpenAI** (`OPENAI_API_KEY`/`_2`/`_3`, rotated on quota before demoting) -> **Gemini** -> **Grok/xAI** -> **Groq** -> **Cerebras** -> **GitHub Models** -> **Cloudflare Workers AI** -> **OpenRouter** -> **Ollama** -> **Sakana**. The last five are conditional and skip cleanly when their env config is absent, so a default deployment behaves as six rungs. Tiers `premium|standard|fast`; `fast` skips Grok. All callers should go through this rather than calling providers directly. Per-call provider override is supported.
**This line was wrong on both count and order** (it said "6-provider, OpenAI -> Anthropic -> ...") while `DEVELOPMENT.md` said "8-provider, Anthropic-first" and `llm.js`'s own header comment listed eight and omitted github/cloudflare/openrouter. Three documented waterfalls, none matching `providerOrder()`, which is the only real source. `tests/llm-waterfall-docs.spec.js` now pins every prose claim to it.

### Auth to Google Sheets — Workload Identity Federation (keyless)
Competitor data lives in a Google Sheet. Auth has **two modes** (see `docs/workload-identity-federation.md` and `_shared/competitor-core.js`):
- **Mode A (preferred, keyless):** WIF — Vercel mints a per-request OIDC token (`VERCEL_OIDC_TOKEN`, enable "OIDC Tokens" in Vercel project settings), Google STS swaps it, code impersonates the SA. Set `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT_EMAIL`.
- **Mode B (legacy):** JSON key in `GOOGLE_SERVICE_ACCOUNT_*` env vars. Code prefers Mode A when `GCP_*` present; falls back to JWT when `VERCEL_OIDC_TOKEN` absent.

### Overriding a public method is not overriding the code path (2026-08-27)
Mode A never worked. `buildWifAuth()` built an `OAuth2Client` and then assigned over its
`getAccessToken`, `getRequestHeaders` and `request` to inject the impersonated token. All three
assignments succeed, the object looks correct in a debugger, and the token exchange itself was fine -
but `OAuth2Client.requestAsync()` calls the **private** `getRequestMetadataAsync()`, never the public
`getRequestHeaders()`, so every WIF-mode Sheets call threw *"No access, refresh token, API key or
refresh handler callback is set"* before a request left the process. The overridden `request()` made
it worse by delegating to the original, straight back into the same throw.
- Measured dead on google-auth-library **9.15.1, 10.5.0 and 11.0.2** (googleapis 128 / 144 / 174 /
  176) - it never worked as written, and no dependency bump caused it. The fix is `auth.refreshHandler`,
  which is the third thing that error message names, and which lets the library own the caching and
  the eager refresh (the hand-rolled `cachedToken`/`cachedExpiry` pair went with it).
- **Why nobody noticed for so long: `competitor-core.js` is the repo's ONLY consumer of `googleapis`
  and had ZERO test coverage.** `node --check` parses it; nothing exercised it. A dependency this
  large with one consumer and no test can only report a break through a production sync failing days
  after the bump merged. `tests/competitor-sheets-auth.spec.js` now drives a **real** googleapis
  request from the real auth client at a local server and reads the `Authorization` header off the
  wire - the previous client could not have passed it, because it sent no request at all.
- Mode B was and is fine: the JWT client constructs, unescapes the `\n`-encoded PEM, signs, and
  googleapis carries its token onto the wire. The spec injects the granted credential for the last
  step, since a signed assertion cannot be redeemed offline.
- Related and worth keeping straight: **browser Google sign-in does not touch `googleapis` at all.**
  `auth.js` goes through `supabase.createClient` -> `signInWithOAuth({provider:'google'})`; the only
  `googleapis` string in front-end code is `fonts.googleapis.com`. A sign-in outage is a Supabase
  reachability question (check that the project's URL resolves), never a `googleapis` version question.

### Smart Brain (persistent daily loop)
`lib/smart-brain/services.js` (6 services: KB, Analysis, Competitor, Calendar, Generation, Review) + `api/_shared/smart-brain-plan.js` (persistent rolling **90-day** plan in `smart_calendar_entries`, diff-updated daily, human approve/reject). Daily Vercel Cron (03:30 UTC) hits `/api/cron/smart-brain` (rewrite → `?action=smart-brain-cron`, `CRON_SECRET`-protected). That cron and that rewrite were BOTH missing from `vercel.json` until 2026-08-24 while this line claimed otherwise — see "The Smart Brain stopped" above; the plan is also refreshed by the 18:30 UTC `/api/brain?action=cron` run as a second chance. Console UI: `smart-brain.html` at `/brain`. Approving a slot LLM-writes mailer + Meta/Google/TikTok ads + landing page (served at `/lp/:campaignId`) and mirrors them into `ads_generated`/`landing_pages_generated`. Platform push stays Phase 2 (`push_status: not_integrated_phase_2`).

**90-day horizon + asset prebuild (2026-07-09).** The rolling window is 90 days (`calendarDays: 90` in `services.js`, `calendar.days: 90` in `brain-core.js`, V1 `calendar-generate.js` cap raised to 90). Every slot in the window is not just planned but has its **full asset bundle prebuilt** — LLM copy + generated images for mailer + ads + landing page. Because ~180 slots (90d × US/UK) cannot build in one serverless invocation, `prebuildAssets()` is a **convergent background queue**: `?action=smart-brain-prebuild` (CRON_SECRET-protected) builds one small batch (via `buildCampaign(..., {withCreatives:true})`), persists it to `smart_generated_campaigns` as a `prebuilt` draft (NOT mirrored to the ads/LP dashboards until approval), marks the slot with a `payload.__prebuilt` marker, then re-fires itself until `remaining` hits 0, then idles. It self-chains via a fire-and-forget `fetch` to `VERCEL_URL` (3s handoff; the child keeps running after the client aborts). Kicked automatically after `smart-brain-sync-daily`, off the existing `/api/brain?action=cron` daily run (no 3rd Hobby-limited cron added), and re-runnable by hand. `previewEntry`/`approveEntry` REUSE the prebuilt campaign (instant view, no regeneration; what the reviewer saw is what ships). A material re-plan of a slot on daily sync drops the marker → the queue rebuilds the now-stale assets. Idempotent + resumable; a total-failure batch stops the chain instead of hot-looping.

### ChaiGPT — the brand LLM (conversational tool-calling over the whole stack)
`api/_shared/brand-llm.js` is the brand's own "Claude-for-Vahdam": a provider-agnostic **tool-calling loop** that lets the LLM actually OPERATE the growth stack instead of just chatting. The model emits a strict JSON action each turn (`{action:'tool',...}` — single tool or a `tools:[…]` batch of up to 3 run in parallel — / `{action:'final',...}`); the server executes against the existing `_shared` cores and feeds results back, looping (default 5 steps). Speed: the loop pins the first provider that answers (per-call `preferProvider` in `llm.js`) so later steps skip dead keys, dedupes repeated tool+args calls, 20s per-provider timeout. Quality: the system prompt enforces an **evidence contract** — every recommendation quotes exact tool-sourced figures, names the target metric + expected impact, states a complete hypothesis, and quotes competitor benchmarks. Because tool-calls are plain JSON (not a provider-specific function-calling API), it works across the **entire eleven-rung waterfall in `llm.js`**, including the free tiers — no extra keys. Tools registered: `ask_analytics`, `run_analysis`, `list_cohorts`, `get_calendar`, `get_competitor_benchmarks`, `search_knowledge_base`, `list_campaigns`, `generate_calendar`*, `generate_assets_for_slot`*, `run_agentic_campaign`*, `klaviyo` (*=writes/generates, only on explicit ask). Each reuses the SAME logic the `/api/brain ?action=` routes use. Endpoints: `?action=brand-chat` (the loop), `?action=brand-tools` (manifest + klaviyo status). UI: `chaigpt.html` at `/chaigpt` (also `/chai`, `/ask`) — Claude-style chat that shows the tool trace. Rename the product via the single `BRAND_LLM_NAME` constant in `brand-llm.js`.

### Klaviyo integration (scaffolded — no keys yet)
`api/_shared/klaviyo-core.js` mirrors Klaviyo's public JSON:API REST endpoints (profiles, lists, segments, metrics, events, campaigns, flows, templates, subscribe, track-event, campaign reporting). Auth via `KLAVIYO_API_KEY` (+ optional `KLAVIYO_PUBLIC_KEY`, `KLAVIYO_REVISION`). **Until a key is set**, every op returns a structured `{connected:false, would_request:{method,url,body}}` stub so the chat + tool-calling work end-to-end and only need a key to go live. Exposed at `?action=klaviyo` (`/api/klaviyo`, `op=` + params) and as the `klaviyo` ChaiGPT tool.

### Persistence
- **Supabase** (Postgres) — cross-device storage, auth, KB, captured competitor emails. Migrations in `supabase/migrations/` (timestamped). `supabase/COMBINED_RUN_THIS.sql` is the apply-all bundle; seeds in `supabase/seed/`. Front-end gets URL+anon key from `/api/public-config` (service-role keys NEVER exposed there).
- **localStorage** — analytics state passed between dashboard → calendar → studio.
- **Google Sheet** — the competitor-email "database" (columns A–K defined in `competitor-core.js`).

### Offline Python data engines (run locally, not on Vercel)
- `ingest/` — `run_all.py` runs `ingest_{matrixify,shopify_analytics,klaviyo,webengage}.py` into DuckDB (`VAHDAM_DuckDB_DDL.sql`), then `sync_to_supabase.py`.
- `mailer_system/` — Python Claude-API campaign trigger engine (thresholds in `targets.json`, outputs to `outputs/`).
- `marketing_automation/` — React 19 + Vite + Express (`server.ts`) interactive campaign compiler (its own `package.json`).
- `scripts/` — mix of JS build tools (`build-catalog.js`, `seed-festivals*.js`) and Python `_*.py` HTML/codegen patchers used during development.

## Approved-assets service + USA July calendar (2026-07-11)
- **`brand_assets` table** (`supabase/migrations/20260711120000_brand_assets.sql`) is the origin-validated asset store: `sku_key, asset_type, url, alt, w/h, source_pdp, origin_validated, status(verified|placeholder), region`. Logic in `api/_shared/brand-assets-core.js` (not a function file): PREFIX-match allowlist (`vahdam.com`, `vahdam.co.uk`, `vahdam.global`, `try.vahdam.*`), rewrites a Shopify store-CDN URL to the brand host (`www.vahdam.com/cdn/shop/files/…`, byte-identical asset) so it validates, and NEVER fabricates a URL — an unverifiable slot is stored `status='placeholder'`. Seed with `npm run seed:assets` (`scripts/seed-brand-assets.js`): resolves the US SKU→handle map from the built catalog, writes `data/brand-assets/us.json` + `supabase/seed/brand_assets_us.sql`, and upserts live when Supabase env is present.
- **USA July calendar + mailers** (`npm run build:july`): `scripts/build-july-mailers.js` keeps the automated-calendar 4-variant STRUCTURE (2 Text + 2 Text+Visual, framework A/B) and the same `sanitizeBrand`/`assertNoBanned` gates (`scenario-model.js`), but renders each variant in the **flagship design system** (`scripts/lib/flagship-mailer.js`: web fonts, green utility bar, colorway hero band — forest/midnight/daylight, price pill, MSO-safe CTA, trust badges, "Rated 4.9/5 · 250,000+ reviews · Oprah's Favorite Things" proof bar, non-clickable footer). Hosted image URLs only (never base64). 12 cohort sends × 4 = 48 files in `mailers/usa-july/`; hero images come ONLY from verified `brand_assets` rows (image-free otherwise, never a fake URL). The same pass also renders, per send, a paid-social **ad set** (Meta/Google/TikTok, `scripts/lib/ad-creative.js` → `ads/usa-july/`) and a flagship **landing page** (`scripts/lib/landing-page.js` → `landing-pages/usa-july/`), all from the same scrubbed copy + verified assets (no invented discount codes). `scripts/build-july-studio.js` assembles `vahdam-usa-july-calendar-mailer-studio.html` (served at `/july-studio` · `/usa-july`): Card/List toggle, scenario tabs (C = executed model, 2-3 emails/user/week), per-send **Mailers / Ads / Landing** tabs whose preview = the exact embedded downloadable file (Blob URL, no `srcdoc`), plus the data-grounded reasoning per row. Manifest: `data/calendar/usa-july-2026.json`. Event hooks wired into reasoning: WC Final Jul 19 @ MetLife, National Ice Cream Day Jul 19, Parents' Day Jul 26, Int'l Day of Friendship Jul 30, National Wellness Month (Aug) ramp.
- **Selected-collection coverage rule:** `SELECTED_COLLECTIONS` in `build-july-mailers.js` (default: chai-teas, samplers, gifts, best-sellers) MUST each be represented by ≥1 send — the build **hard-fails** if any is uncovered, so a selected collection is never silently dropped. Each slot carries `collections` + a `collection_cta`; the collection is wired into asset generation (landing-page "Explore all {collection}" CTA) and surfaced in the studio (chips + a "Collections covered" stat). `manifest.selected_collections` lists each with its covering send dates.

## Agent memory (TencentDB-Agent-Memory bridge, 2026-07-19)
`integrations/tencentdb-memory/` gives Claude persistent long-term memory (TencentDB-Agent-Memory's
local L0->L3 pyramid: conversation -> atoms -> scenarios -> persona). That project has NO native
MCP/Claude connector — only a "Hermes" REST gateway (`:8420`) — so `mcp-server.mjs` is a **zero-dependency
MCP bridge** mapping the gateway (`/recall /capture /search/* /session/end /health`) onto MCP tools
(`memory_recall`, `memory_capture`, `memory_search`, `memory_search_conversations`, `memory_session_end`,
`memory_health`). Wired into this repo's Claude Code sessions via root `.mcp.json`. Start the gateway with
`integrations/tencentdb-memory/setup.sh` (clones the upstream gateway into gitignored `vendor/`, needs an
LLM key for distillation only), verify with `npm run smoke`. Full setup (repo + CLI + Desktop) in that
folder's README. Habit: `memory_recall` at task start, `memory_capture` after meaningful turns.

## Agent evaluation + the brief gate (2026-08-18, from Google's ADK marketing-agency sample)
Studied `python/agents/marketing-agency` in `google/adk-samples`. Two things it does that this repo
did not, both now here; the rest of that sample (Vertex/ADK/GCP scaffolding, domain-name picking,
website generation) does not fit a Node/Vercel app that already has deeper versions of its creative
agents, and was deliberately not copied.
- **`evals/` — the agent layer had NO evaluation.** ~600 tests covered pages, contrast, dead hosts,
  kill switches and catalog provenance; nothing covered the 19 tools in `brand-llm.js` or which one a
  question should route to. A misroute never throws: ask "how big is our customer base" and get
  `list_cohorts` (a modelled RFM sample) instead of `audience_base` (the real Shopify total) and the
  answer is off by an order of magnitude in the same confident voice. ADK's eval shape
  (`{query, expected_tool_use, reference}` + `AgentEvaluator`) needs a live model every run, which
  cannot gate CI, so evaluation is split: **structural** (no key, deterministic, GATES CI via
  `tests/agent-evals.spec.js`) checks the routing SIGNAL — tool names and descriptions, all a
  prompt-routed agent gets — that every named tool exists, every generator is `mutates:true` (the
  prompt's "only on explicit user request" warning is generated from that flag), and two tools a case
  distinguishes are actually distinguishable; **live** (`npm run evals:live`) runs the real loop and
  is advisory. The spec guards the guard: it collides two descriptions and deletes a tool, and
  asserts the evaluator then fails.
- **`api/_shared/brief-gate.js` — a creative aimed by an invented strategy.** `generate.js` used to
  tell the model, with no brief: *"(none provided - derive a strong, specific campaign concept)"* —
  an instruction to invent the objective, audience and angle and then present them in the same voice
  as the parts a human chose. Fabricating WHO a send is for is costlier than fabricating a price,
  because the whole send is aimed by it. ADK's strategy sub-agent refuses outright ("You MUST NOT
  proceed... list each missing essential"); binary refusal is wrong here, so the gate splits by what
  the output DOES: **customer-facing** modes (`mailer_full`, `concepts`, `landing_page`) BLOCK with
  `NOT LAUNCH READY - BRIEF DEPENDENCY` + the exact list; **ideation** (`create_brief`) PROCEEDS but
  every gap becomes a declared assumption — a deterministic `assumptions[]` on the response plus a
  prompt block telling the model to label them inline. The list is computed from which inputs were
  absent, NOT asked of the model: a model asked to list its own assumptions omits the ones it did not
  notice making. Runs BEFORE the catalog gate (cheaper, and more fundamental — a creative aimed at
  nobody is wrong even when every product fact in it is live).

## Product Catalogs
**Read the catalog through `api/_shared/catalog-live.js` — never `data/catalog/*.json` directly** (see "The
catalog is LIVE" above). The CSV build still runs at deploy and its output is the labelled non-live
fallback: US 173 · UK 101 · Global 102 active products, from `products_export_{usa,uk,global}.csv` via
`scripts/build-catalog.js` → `data/catalog/products_{region}.json` (served with CORS + cache headers per
`vercel.json`). Those counts are the artifact's, not necessarily the store's — the live read is what says
how many products the store actually has today.

## Market-Specific Store URLs — ONE source: `api/_shared/market-urls.js`
US → www.vahdam.com | UK → www.vahdam.co.uk | Global/EU/AU/ME → www.vahdam.global | IN → www.vahdam.com (no separate IN storefront today)
**Never hand-write this map again.** The table that used to sit here was headed
"(VERIFIED)" and was wrong on four of six entries: `uk.vahdamteas.com`,
`eu.vahdamteas.com` and `au.vahdamteas.com` do not resolve, and
`www.vahdamteas.com` / `www.vahdamindia.com` only redirect to `www.vahdam.com`.
Nine hand-maintained copies of the map existed across the mailer pipeline, ad
generator, landing-page builder, review-recovery mailer, competitive benchmark and
playbook generator — most captioned "VERIFIED, per CLAUDE.md" — so every UK/EU/AU
asset the repo generated linked to a host that does not exist. The word "verified"
is what stopped anyone re-checking. Re-measure any time with
`node scripts/check-market-urls.js`; `tests/market-urls.spec.js` fails if a dead
host reappears in source. Full history: `docs/prompt-library/README.md`.
- PDP: `{base}/products/{handle}` (handle = catalog JSON `h` field) · Collection: `{base}/collections/{slug}` (via `heroMap` in `collectionUrl()`)

## Prompt library — the brand contract for generated assets (`docs/prompt-library/`)
Five production prompts (landing pages · mailers · ad creatives · visual assets ·
music), each with a paste-verbatim brand block and a generic placeholder variant.
They are the depth standard for anything generated: evidence rule, contrast rule,
banned/preferred words, per-asset structure and an explicit output contract.
Read `docs/prompt-library/README.md` first — it records where the supplied brand
blocks disagree with measured reality (the market URLs) and which two rules are
stricter than the codebase currently enforces (`Learn More`/`Click Here` as CTAs,
and `href="#"`, both still present in already-generated deliverables under
`landing-pages/ashwagandha-matrix/`).

## Brand Constants (source of truth: `Brand style guide.pdf`)
- **Palette (ONLY these four)**: `#004A2B` forest green · `#AB8743` gold · `#171717` near-black · `#FBF5EA` cream
- **Typography (STRICT — style guide forbids any other font for emailers)**:
  - Headings: **Lao MN** Regular & Bold — fallback `'Lao MN','Cormorant Garamond',Georgia,serif`
  - Body: **Proxima Nova** — fallback `'Proxima Nova','Helvetica Neue',Arial,sans-serif`
- ⚠️ Do NOT introduce off-palette tints (`#0f2a1c`, `#d4873a`, `#fdf6e8`, `#1a3a28`, `#1a1a1a`, `#faf8f4`) or Cormorant/DM Sans as the *primary* family — these were drift, now removed.
- **BANNED phrases**: wellness journey, transform, liquid gold, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last
- **No em/en dashes anywhere in output copy** - use commas, colons, or plain hyphens. (Enforced by `scrubDashes()`/`sanitizeBrand()` in `api/_shared/scenario-model.js`.)
- **PREFERRED**: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted
- **Copy voice**: warm, sensory, emotionally resonant, story-driven ("There is a moment when the right cup of tea does more than warm your hands"). Testimonials read as tiny personal stories, not reviews.

## Mailer Studio specifics (`vahdam_mailer_architect_v34.html`)
- 5-step wizard: Brief → Products → Generation → Review & Refine → Final HTML.
- Produces **4 variants**: A (Image · Hero close-up), B (Image · Lifestyle wide), T1 (Text · Editorial), T2 (Text · Founder note). Structural divergence forced via `_alternateArchetypeForVariantB()`.
- 11 layout archetypes: hero-led-editorial, product-grid-conversion, storytelling-narrative, single-product-spotlight, gift-bundle-showcase, ritual-journey, comparison-discovery, founder-note, editorial-trend-roundup, limited-drop-countdown, subscription-anchor.
- Output mailers are compact (~1200–1500px, two scrolls).
- **Image cascade** (`api/ai/image.js`): Gemini native (`generateContent` + `responseModalities:['IMAGE','TEXT']`) → Gemini Imagen (paid only) → OpenAI (gpt-image-2 → gpt-image-1) → Pollinations (flux-pro → flux-realism → flux, free, "NO text" instruction). `buildDesignPromptFromCatalog()` injects real catalog data; region-aware currency symbols.

## Environment Variables (Vercel only — never hardcode)
Text: `OPENAI_API_KEY`(+`_2`/`_3`), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`. Storage: `SUPABASE_URL`, `SUPABASE_ANON_KEY`. Lifecycle (Klaviyo): `KLAVIYO_API_KEY` (+ optional `KLAVIYO_PUBLIC_KEY`, `KLAVIYO_REVISION`) — integration is scaffolded and returns request stubs until set. Voice: `ELEVENLABS_API_KEY`. Google Sheets: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB` (or legacy `GOOGLE_SERVICE_ACCOUNT_*`). Cron: `CRON_SECRET` (protects `?action=sync`). Auto-set by Vercel: `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_OIDC_TOKEN`. Full docs in `.env.example`. Each sibling app has its own restricted per-project Gemini key minted from its own GCP project (see "API Keys 2026-05-30" note below).

## Common Bugs to Watch
1. **Unescaped quotes / apostrophes** inside single-quoted JS strings — these pages are giant inline-JS files; a stray backtick in a CSS comment once broke a template literal and killed the sidebar.
2. **`const` reassignment** — use `let` when reassigned later.
3. **Gemini model duplication** — env var can duplicate a hardcoded fallback; always de-duplicate.
4. **CORS headers** — every serverless function needs `Access-Control-Allow-Origin`.
5. **Font stack in JS** — never use quoted font names inside JS template strings.
6. **Quota errors return HTTP 400, not 429/402** — OpenAI `billing_hard_limit_reached` and Anthropic "credit balance too low" both 400; quota detection must check status 400 + billing keywords.
7. **PowerShell BOM corruption** — piping keys via PowerShell `echo` adds UTF-8 BOM; use `cmd /c "type file | vercel env add"`.
8. **Gemini Imagen predict API** — paid plans only (free tier → 400).
9. **Function-count limit (12 on Hobby)** — adding an `api/*.js` file can break deploy; extend a `?action=` router or move logic to `_shared/`.
10. **Service worker caching** — `sw.js` must never cache `/api/*` responses; `.html` and `sw.js` are served `must-revalidate`.

## Domain + OAuth migration (`scripts/migrate-domains.*` + `scripts/migrate-oauth.*`)
Each sibling project moves to `<slug>.anchit-tandon.com`. `migrate-domains` adds the Vercel domain + GoDaddy CNAME, then hands the same scope to `migrate-oauth` so Google sign-in survives the move (skip with `--no-oauth`). Sign-in is **Supabase-mediated** (`signInWithOAuth({provider:'google', redirectTo: origin+pathname})`), so the change that actually matters is the **Supabase Auth redirect allowlist** (Site URL + Redirect URLs) — auto-applied via the Supabase Management API (`SUPABASE_ACCESS_TOKEN` + per-project `<SLUG>_SUPABASE_PROJECT_REF`). The Google OAuth client's redirect URI is the fixed `https://<ref>.supabase.co/auth/v1/callback` and does NOT change on a domain move; the only web-client tweak (a new JavaScript origin) is **Console-only** — there is no gcloud command or public API to edit a Web-application OAuth client, so the tooling emits an exact plan + Console deep-link rather than faking a mutation. Dry-run by default; `--apply` to write. Full detail in `docs/oauth-redirect-migration.md`.

## API Keys (2026-05-30) — per-project Gemini via gcloud
Each app has its OWN restricted Gemini key minted from its own GCP project, pushed to Vercel (Production+Development): vahdam-lifecycle-os ← GCP vahdam-lifecycle-os (others: personal-ai-os, the-third-eye, music-gen-ai, hey-yaara, ai-tele-suite, th-life-engine, marketing-mailers-html-architect). Other providers left as-is.

## Marketing skills pack + reels-grade creative standard (2026-07-24)
Ten job-complete marketing skills in `.claude/commands/` (mega-prompt discipline: clear,
highly specific, template-driven, evidence-quoting; skill = a real job run end-to-end):
`/campaign-audit` `/lp-audit` `/ab-test` `/competitor-teardown` `/utm` `/email-sequence`
`/content-repurposer` `/icp-builder` `/ad-copy-matrix` `/creative-brief`. All enforce the
Brand Constants + zero fabrication.
**Playable ads (2026-07-26)**: `scripts/lib/playable-ad.js` — `renderPlayable` (interactive
tap-to-build unit) + `renderPlayableVideo` (inlined muted autoplay video + interactive end card) +
`playableSpecSheet`. Enforces the rules that actually cause rejections: ONE self-contained HTML with
every asset a `data:` URI (throws on any http asset — reviewers test offline), per-network size caps
(Meta/TikTok 2MB, Google/AppLovin/Unity 5MB), host CTA APIs (`FbPlayableAd.onCTAClick`,
`openAppStore`, `mraid.open`, `dapi`) not `window.open`, portrait+landscape, muted by default.
Verified in Chromium: zero page errors, zero external requests, interaction → end card → Meta CTA
API fired, no landscape overflow.

**Avatar video (2026-07-26)**: `scripts/lib/avatar-video.js` (`avatarBrief`) targets open-source
**LongCat-Video-Avatar-1.5** (Meituan, MIT) for lip-synced spokesperson/UGC ads — audio-driven
AT2V/ATI2V, multi-person dual audio, length via `num_segments`, `--use_int8` (VRAM) / `--use_distill`
(8-step). It emits a run-ready `torchrun` command + descriptive prompt rather than an API call,
because the model is self-hosted and needs a GPU (Vercel functions have none); the hosted cascade
in `api/_shared/video-core.js` (Veo → Sora → Higgsfield → Runway) still owns non-avatar video.
Hard refusals built in: no `consent: true` on the likeness, no supplied audio, or a language outside
the model's evaluated set (EN/ZH only — Indic languages need a different lip-sync path).

**Video audio is opt-in per call, and per-provider (2026-08-02).** `generateVideo` renders **silent**
unless passed `audio:` (a prose soundtrack direction). Video ads shipped with no background music for
two independent reasons, both now fixed and locked by `tests/video-audio.spec.js`: (1) Veo needs
`parameters.generateAudio` — omit it and the clip comes back silent, so it is now set explicitly
`true`/`false` rather than left to a model default; (2) `social-core.js` asked its LLM for an `audio`
field, returned it in the storyboard the UI renders, and **never passed it to the renderer** — the
brief said music, the response said music, the file had none. Callers that produce ads must pass a
direction (`AD_AUDIO_RULE` in `smart-brain-plan.js`); the mailer asset agent deliberately does not,
because email clients do not play it. The direction rides in the **prompt** for every provider — only
Veo's `generateAudio` is a documented body field, and inventing one for Higgsfield/OpenMontage/Sora
would be silently dropped. **Runway `gen4_turbo` has no audio track at all**, so a cascade demotion to
Runway is silent whatever was asked: results carry `audio_requested`/`audio_supported`/`audio_note`
and ad cards carry `has_audio`, so "music requested" is never rendered as "music present". GIF output
cannot carry audio by format.

**Reels-grade creative standard**: stills built to animate via `api/ai/image.js`
`mode:'reels'` (cinematic 9:16, depth layers for parallax, negative space for type, no baked
text); real motion via Higgsfield image-to-video; instant no-API preview + generator handoff
via `scripts/lib/motion-ad.js` (`renderMotionAd` = self-contained animated HTML creative,
`motionBrief` = shot-by-shot brief so the shipped MP4 matches). Quality bar in
`.claude/commands/ad-creative.md`: hook moves in 0.8s, word-staggered kinetic type, one
filmic grade, real SKU packaging only, <15s, safe-areas.
**Evaluated and documented, not wired up:** `meituan-longcat/LongCat-Video-Avatar-1.5`
(MIT weights, image+audio→lip-synced talking head, 480p/720p) is the open-source route for
creator-style spokesperson video. It needs 2 local GPUs and has no hosted API, so neither
Vercel nor Snowflake can run it — Higgsfield remains the engine. Full trade-off table in
`.claude/commands/ad-creative.md`.

## Growth OS — integrated team (slash commands + connectors + skills)
This repo ships project slash commands in `.claude/commands/` that operate the brand as a full growth team for a coffee + wellness D2C brand. Start anything with **`/growth-team`** (the router) or jump to a vertical:

| Vertical | Command | Connectors + Skills it routes to |
|---|---|---|
| Strategy/planning | `/campaign-plan` | `marketing:campaign-plan` + Shopify + Klaviyo + competitor KB |
| Email/SMS lifecycle | `/email-flow` | **Klaviyo** connector + `marketing:email-sequence` |
| Mailers (HTML) | `/mailer` | `anthropic-skills:vahdam-d2c-mailer` + Mailer Studio contract |
| Ad creatives (img/video/gif) | `/ad-creative` | `higgsfield-product-photoshoot` / `higgsfield-generate` / `higgsfield-soul-id` |
| Landing pages (HTML) | `/landing-page` | brand asset code engine + `/lp/:id` contract |
| Design (static/social) | `/design` | **Canva**, **Figma**, Adobe Express skills |
| Commerce data | `/shopify` | Public storefront scrape (US/UK/Global) — `/products.json` etc. **No Admin connector** |
| Analytics/reporting | `/analytics` | Supabase + `marketing:performance-report` + Amplitude/Supermetrics |
| Competitor intel | `/competitor` | competitor router + `marketing:competitive-brief` + SimilarWeb/Ahrefs |
| SEO/AEO | `/seo` | `marketing:seo-audit` + Ahrefs |
| Database | `/db` | `supabase` + `supabase-postgres-best-practices` + `supabase/migrations/` |
| Ship | `/ship` | `vercel-plugin:deploy` / `:env` |

**Every command enforces the Brand Constants above** (4-color palette, Lao MN/Proxima Nova, banned phrases, P01 "sell happiness").

### Connecting the connectors (hosted OAuth MCP — connect once per account)
These are not in `.mcp.json` (hosted OAuth servers, account-scoped). Connect via each server's `authenticate` → `complete_authentication` tool, or in the Claude **Connectors** UI:
- **Shopify** — ⚠️ Admin connector NOT authorized; use public storefront scraping via `/shopify` (US/UK/Global) instead. **Klaviyo** — `mcp__plugin_marketing_klaviyo__authenticate`. **Canva** — `mcp__plugin_marketing_canva__authenticate`. **Figma** — `mcp__plugin_marketing_figma__authenticate`. **Ahrefs / SimilarWeb / Supermetrics / Amplitude** — `mcp__plugin_marketing_<name>__authenticate`. **Higgsfield** — connected (generation MCP). Commands degrade gracefully and tell you what to connect if a tool is missing.

## Two features that are NOT one (product owner, 2026-08-01)
- **3D Website & Storefront** (`gid: storefront3d`, `/3d`, `/3d/{us,uk,global,in}`, `/website-designs`) is a
  **website revamp** — the Vahdam store itself, rebuilt in WebGL per region, plus the official website clones.
- **Landing Pages** (`gid: landing`, `/landing-pages`, `/landing-page-templates`, `/lp/*`) is **campaign
  destinations** — pages built for mailers, ads and every other marketing channel.
They were one nav group titled "3D Storefront & Websites" carrying `gid:'landing'`, so the `?` popup described
landing pages under a 3D heading, `INFO.officialdesigns` rendered nowhere (orphaned exactly like `INFO.ads` had
been), and the landing-page **builder** had no nav entrance at all. Keep them as two groups with two INFO entries.
**Invariant worth re-checking after any nav edit:** every `gid`/`id` must resolve to an `INFO` key and vice versa —
a renamed key silently removes a feature's entire description (this is how both `INFO.ads` and
`INFO.officialdesigns` disappeared; the Data Analysis group had the same defect, `gid:'dataanalysis'` vs
`INFO.analysis`). `tests/feature-taxonomy.spec.js` enforces it.
**Landing-page brief = message match.** A page is the destination of an ad or mailer, so it opens on the promise
that click was made on, in the ad's own language, and introduces no price, discount, rating, review count,
guarantee or claim the ad did not state. Enforced in `api/ai/generate.js` (`buildLandingBriefFromAd`) and in the
calendar copy prompt in `api/_shared/smart-brain-plan.js`. The proven page corpus to build from lives in
`landing-pages/final/` (cortisol presell v1/v2/v3, agent-best, all-in-one agent), `landing-pages/usa-july/` and
`landing-pages/ashwagandha-matrix/`, with per-slot generation prompts in `landing-pages/final/lp-cortisol-asset-prompts.md`.

### A guard that reads only the FIRST match certifies the wrong loop (2026-08-27)
With the paused-project and service-worker fixes in, main was down to ONE red test:
`cta-and-filters.spec.js:198 mailer-discovery.html CTAs fire`, failing on `[ipad]` and flaky on
`[iphone-se]` - both WebKit - with `Test timeout of 120000ms exceeded`.
- **The file budgets itself explicitly, and the arithmetic was written against the wrong loop.** The
  comment at the top computes `20 controls x (2s click cap + 180ms settle + ~300ms of evaluates)
  ~= 50s`. That is true of the FILTERS loop, which caps clicks at 2s. The CTA loop capped them at
  **4s**, so the dominant term was double what the budget was justified against.
- **The guard meant to prevent exactly this was vacuous**, and in the most ordinary way: it used
  `.exec()` per pattern, which returns only the FIRST match. That file has TWO control-walking loops,
  so it read the filters loop's 2s cap and never saw the CTA loop's 4s; and `settle` came from
  `ready()`'s `waitForTimeout(700)`, not from either loop. It certified a 75s worst case for a test
  that was really overrunning 120s. Now it takes `Math.max` over EVERY occurrence, so a second loop
  cannot hide behind the first.
- **Widening the scan alone was not enough, and that is the more useful half.** With the 4s cap
  visible the guard computed 115s against a 120s budget and still PASSED - a 5s margin on a test that
  was demonstrably timing out. The per-control allowance was 300ms, which is optimistic to the point
  of being useless: each iteration does `textContent` + `getAttribute` + `isVisible` (three locator
  round-trips) before the click, then the click polls for actionability, on an emulated mobile WebKit
  project sharing a runner. At 1000ms the guard fails the 4s cap (129s > 120s), which is what having
  teeth means. **A check whose margin is thinner than its own measurement error is not a check.**
- The cap is 2s in both loops now. Nothing is lost: the click result is discarded (`noWaitAfter` +
  `.catch`), the element was visibility-checked on the previous line, and what the test asserts is the
  page errors a click produces - not that the click resolved. Coverage is untouched (the `limit >= 20`
  floor still holds), so this is not a timeout "fixed" by walking fewer controls.
- **Unverifiable here, and worth stating:** WebKit cannot be installed in this sandbox, so the timing
  itself is proven by the arithmetic and by CI, not by a local WebKit run. Chromium: 72 pass.

### The sw.js self-heal reload is a navigation, and 15 specs were racing it (2026-08-27)
Fixing the paused-project failures above cleared 12 of main's 13 red tests and left ONE:
`ad-preview.spec.js:233` failing 3/3 attempts with `page.evaluate: Execution context was destroyed,
most likely because of a navigation`, on `smart-brain.html`.
- **The navigation is ours, and it is deliberate.** `auth.js` registers `sw.js` on `window` `load` -
  independent of `init()` - and its `controllerchange` handler calls `location.reload()` after 50ms as
  a PWA self-heal. Any spec that navigates and then reads page state is racing that reload. It passes
  when the file runs ALONE and fails in the loaded full suite, which is exactly why it reads as a flake
  rather than a race. This file already recorded the trap on 2026-08-19; what was missing was applying
  it to the specs that need it.
- **15 specs drove real pages without `serviceWorkers: 'block'`**, and the three that misbehaved in
  that run (`ad-preview` failed, `ads-revenue-panel` and `cta-and-filters` went flaky) were all in
  that set. 14 now block it.
- **`cta-and-filters` is the ONE deliberate exemption, and it earned it the hard way.** Blocking there
  turned 5 of its tests red: Playwright's blocking creates a sandboxed context in which READING
  `navigator.serviceWorker` throws `SecurityError`, and that spec asserts "every page loads without
  throwing". The throw is not ours - the stack lands in an injected `<anonymous>:3:15` script, all
  three of our reads sit inside a `try/catch`, and `index.html` throws nothing under the same setting -
  so the guard would have injected the very error the spec exists to detect. Reverted there; 72 pass
  again. **A guard that manufactures the failure it is meant to prevent is the wrong guard for that
  test**, and its flake was a 120s timeout anyway, a different cause.
- Lesson worth keeping: when a fix clears most of a red suite, read the REMAINDER rather than
  declaring victory - and check the full summary, since Playwright prints `failed` ABOVE `flaky`, so a
  short log tail can show `0 failed` when one test did fail.

### A paused Supabase project keeps its URL, so every "is it configured" check passed (2026-08-27)
`/ads-master` rendered the sign-in wall, the button was enabled, and clicking it left the app for
`https://<ref>.supabase.co/auth/v1/authorize?provider=google&redirect_to=...` which answered
**DNS_PROBE_FINISHED_NXDOMAIN**. The user ended up on a Chrome error page with no banner, no cause and
no way back.
- **Measured, not guessed:** `list_projects` returns the project `vahdam-lifecycle-os`
  (`gubbckgjujwqodghcavv`) with status **INACTIVE** - all eight of the account's projects are. Supabase
  pauses inactive free-tier projects and **de-provisions the API hostname**, while the project and the
  URL both stay correct. Production reported `supabase live:true` on 2026-08-25 and `fetch failed` on
  2026-08-27, so it paused in between. Restoring it is a dashboard action; nothing in this repo can.
- **Why it was silent is the part worth keeping.** The wall's warning was
  `${window.__SUPABASE__?.url ? '' : ...}` - it fired only when the URL was **MISSING**, which is the
  one case that was not happening. A present-but-dead URL passed it, `getConfig()`, the anon-key check
  and the client construction. Same shape as the gate payloads read for `j.error`: the app had the
  fact and rendered nothing.
- **`signInWithOAuth` is a full-page NAVIGATION**, so after it fires there is nothing left in this app
  to report anything. Reachability is therefore checked BEFORE it, in `signIn()`, and a failure throws
  `err.authBackend` instead of navigating. `tests/homepage-signin.spec.js` asserts the probe's index is
  lower than the call's, **after stripping comments** - the comment explaining the guard names
  `signInWithOAuth`, so the raw scan found the explanation first. Third time this repo has tripped a
  guard on its own explanation.
- **`mode:'no-cors'` is load-bearing.** An opaque response still proves the network reached the host; a
  cors-mode probe rejects on a CORS header and would report a healthy backend as down. Bounded by an
  `AbortController` (6s) so a hanging host cannot hang the click.
- **The notice is a verdict, not a crash.** A probe cannot tell a paused project from a deleted one, so
  it names the paused case as *most likely*, links the dashboard for the ref **derived from the
  configured URL** (never a constant), and gives the deleted/replaced remedy (`SUPABASE_URL` +
  `SUPABASE_ANON_KEY` on Vercel) too. `navigator.onLine === false` reports being offline instead - do
  not send someone to restore a database when their wifi is off. The offline verdict is not cached,
  because connectivity returns without a reload.
- **ONE explainer**, `window.LifecycleAuth.signInBlockedHtml`. The homepage CTA delegates to `signIn()`
  (the 2026-08-21 consolidation), so it now receives the thrown verdict - and it had been **swallowing
  the error and silently resetting the button**, which would have relocated the dead-button defect
  rather than fixing it. A second copy of the words would drift exactly as the market-URL map did.
- **Found in passing, same family:** `init()` was invoked with **no catch**. It is async, so any
  rejection - most realistically the supabase-js CDN being blocked by an ad blocker, a corporate proxy
  or a CDN outage - became an unhandled rejection and the page rendered **NOTHING**: no wall, no top
  bar, no reason. A blank page is the least actionable failure there is. It now renders the wall with
  an `sdk` verdict naming `cdn.jsdelivr.net`.
- **The same defect was in the SERVER, and it had turned main red on four consecutive merges.**
  `SmartBrainDbAdapter` routes every failure through an `if (!r.ok)` branch, and `select()`'s own
  comment promises that path handles "missing table, wrong project, key mismatch, transient error" by
  returning no rows "instead of throwing and blanking the whole calendar". But a **network-level
  failure makes `fetch()` itself reject**, so it sailed past all five branches: every read became
  `getaddrinfo ENOTFOUND` and `syncDaily` THREW, so the daily cron died on an unhandled error instead
  of reporting a database it could not reach. `select()` is called ten times under one `Promise.all`
  in `ownData()` and only two of the ten carried a `.catch`. Fixed with `req()`, a fetch that never
  throws and returns a synthetic `{ok:false, status:0, unreachable:true}` so an unreachable host lands
  in the graceful branch the comments already described. **`status:0` is deliberate** - reporting 404
  or 500 would send the operator hunting a missing table instead of a hostname that stopped resolving.
  `tests/smart-brain-cron.spec.js` drives a real adapter at a `.invalid` host (RFC 2606, cannot resolve,
  so no network and no flake), asserts reads return `[]` and all four writes report a warning, and
  fails if any CRUD method calls `fetch` directly again. 6 of its tests go red against the old code.
- **CI red on `main` was NOT caused by the diff that surfaced it.** #404 was green on 2026-08-25;
  #405, #406, #407 and #408 all failed after the project paused on the 26th, on the same two specs
  (`smart-brain-cron`, `goal-driven-assets`) - both of which make REAL calls to the configured Supabase
  project. Check the base branch before believing a failure belongs to your PR; and note the specs
  reproduce locally in this sandbox for the same reason (no egress to that host), which is what made
  the root cause findable.
- **Testing note:** Playwright checks routes in **REVERSE registration order**, so the CDN stub must be
  registered AFTER `blockExternal` or its `**/*` shadows it and the SDK is aborted - which reproduces
  the *other* defect and makes the test look like the fix failed. And `/ads-master` is a `vercel.json`
  rewrite, not a file, so a throwaway static server must be pointed at
  `ad-campaigns-master.html`. Verified with teeth: removing the guard turns the browser test red.

### Sign-in has ONE implementation, and a redirect must point at a real route (2026-08-21)
The homepage's main "Sign in with Google" CTA hand-rolled its own `signInWithOAuth` with
`redirectTo: location.origin + '/dashboard'`. **`/dashboard` is not a route** - `dashboard.html` is
served at `/rfm`, and `cleanUrls` is false, so an extensionless `/dashboard` matches no rewrite.
Google completed the sign-in and dropped the user on a 404. It failed a second, independent way too:
`rememberReturnTo`'s own comment already records that Supabase bounces to the Site URL when the exact
path is not in the redirect allow-list, and a path nobody uses is not in it.
- **The footer button on the SAME page worked**, which is the whole tell: there were two
  implementations of one thing and only the copy drifted. `auth.js` used `origin + pathname` in both
  of its call sites; the homepage did not.
- Fixed by consolidation, not by correcting the copy: `auth.js` now owns `signIn()` and exposes it as
  `window.LifecycleAuth.signIn`. Both auth.js call sites and the homepage CTA route through it, so
  exactly one `signInWithOAuth(` call exists in the app. Same reasoning as `gate-notice.js` and
  `market-urls.js`: one module, never a copy per page.
- `redirectTo` uses **`origin + pathname`, never a hand-picked path** - the user is standing on that
  path, so it exists, and it is what the allow-list is built from.
- `tests/homepage-signin.spec.js` pins it: one implementation repo-wide, the CTA delegates, a general
  guard that any hard-coded `redirectTo` path resolves to a real route in `vercel.json`, a premise
  check that `/dashboard` is still not a route, and a behavioural click test. Verified with teeth - 4
  of the 7 fail when the old CTA is restored.

## LHS navigation IA rule
The shared LHS menu (`auth.js`, element `#lifecycle-nav`; model exposed as `window.__LC_NAV` / `window.__LC_NAV_INFO`) follows a standing IA rule:
- **Every feature carries the SAME five "know about this feature" questions, in this exact order:** 1. What does it do? · 2. Who is it for? (cohort / cohort definition) · 3. How does it work? (modes/steps/logic) · 4. Input · 5. Step-by-Step Working. Because they are identical in shape for every feature, they do NOT live inline in the rail — a quiet `?` chip beside each feature/group label opens a popup that presents all five as headings with their content. The rail itself shows only the real feature links and their group sub-sections.
- **Sub-item 5 for content-producing features presents the multi-agent pipeline steps:** Ideology → Data analysis + review + hypothesis → Business & strategy decisions → Content → Design + layout + structure → Audio/Video (where applicable) → Coding → Final compilation + presentation — noting `Runs via: <endpoint>` wherever a live endpoint exists. (Social Media OS uses its own 7-agent variant: Ideology, Data & Hypothesis, Strategy, Content, Design, Audio/Video, Compilation — runs via `/api/brain?action=social-run-daily`.)
- **Menu items carry the V1/V2 taxonomy badge** (see "Version taxonomy" above); where both generations of a capability exist they are labelled **Draft 1 / Draft 2** (Plan V1 = Draft 1 vs Mailer Calendar V2 = Draft 2 of calendaring; Mailer Studio V1 = Draft 1 vs Mailer Calendar built mailers = Draft 2 of mailer creation).
- Content lives in `auth.js` (`NAV`, `SUBQ`, `INFO`). String rules there: double-quoted strings only (apostrophes fine; never a double quote or backtick inside), text positions only. The nav must render signed-out too and degrade gracefully when Supabase/config fetches fail.
- **Sanctioned rendering (2026-07-09):** the five common questions render in a **`?`-triggered popup/modal** (`#lnav-ipanel`), all five shown at once as headings (`.lnav-ipanel-q`) with their content, Step-by-Step Working as a numbered list with `Runs via:` lines; content is written via `textContent` (no HTML-escaping needed). The rail no longer carries an inline five-item accordion — it lists the real feature links and their group sub-sections (groups start collapsed except the active group). Sections follow the sequential marketer workflow: Research & Benchmark → Plan → Design & Create → Share & Track → Assistants; rows show only the quiet V1/V2 chip (Draft 1/2 lives in tooltips + the `?` popup). Superseded the 2026-07-04 inline-accordion rendering.
