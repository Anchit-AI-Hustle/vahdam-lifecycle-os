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
npx playwright test tests/<file>.spec.js   # run a single test file
```
There is no real `dev` server (the `dev` script is a no-op stub). For local serverless testing use `vercel dev`. CI (`.github/workflows/ci.yml`) only does an HTML smoke check + `npm run build` — there is no lint step.

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

### Smart Brain (persistent daily loop)
`lib/smart-brain/services.js` (6 services: KB, Analysis, Competitor, Calendar, Generation, Review) + `api/_shared/smart-brain-plan.js` (persistent rolling **90-day** plan in `smart_calendar_entries`, diff-updated daily, human approve/reject). Daily Vercel Cron (03:30 UTC) hits `/api/cron/smart-brain` (rewrite → `?action=smart-brain-cron`, `CRON_SECRET`-protected). Console UI: `smart-brain.html` at `/brain`. Approving a slot LLM-writes mailer + Meta/Google/TikTok ads + landing page (served at `/lp/:campaignId`) and mirrors them into `ads_generated`/`landing_pages_generated`. Platform push stays Phase 2 (`push_status: not_integrated_phase_2`).

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

## LHS navigation IA rule
The shared LHS menu (`auth.js`, element `#lifecycle-nav`; model exposed as `window.__LC_NAV` / `window.__LC_NAV_INFO`) follows a standing IA rule:
- **Every feature carries the SAME five "know about this feature" questions, in this exact order:** 1. What does it do? · 2. Who is it for? (cohort / cohort definition) · 3. How does it work? (modes/steps/logic) · 4. Input · 5. Step-by-Step Working. Because they are identical in shape for every feature, they do NOT live inline in the rail — a quiet `?` chip beside each feature/group label opens a popup that presents all five as headings with their content. The rail itself shows only the real feature links and their group sub-sections.
- **Sub-item 5 for content-producing features presents the multi-agent pipeline steps:** Ideology → Data analysis + review + hypothesis → Business & strategy decisions → Content → Design + layout + structure → Audio/Video (where applicable) → Coding → Final compilation + presentation — noting `Runs via: <endpoint>` wherever a live endpoint exists. (Social Media OS uses its own 7-agent variant: Ideology, Data & Hypothesis, Strategy, Content, Design, Audio/Video, Compilation — runs via `/api/brain?action=social-run-daily`.)
- **Menu items carry the V1/V2 taxonomy badge** (see "Version taxonomy" above); where both generations of a capability exist they are labelled **Draft 1 / Draft 2** (Plan V1 = Draft 1 vs Mailer Calendar V2 = Draft 2 of calendaring; Mailer Studio V1 = Draft 1 vs Mailer Calendar built mailers = Draft 2 of mailer creation).
- Content lives in `auth.js` (`NAV`, `SUBQ`, `INFO`). String rules there: double-quoted strings only (apostrophes fine; never a double quote or backtick inside), text positions only. The nav must render signed-out too and degrade gracefully when Supabase/config fetches fail.
- **Sanctioned rendering (2026-07-09):** the five common questions render in a **`?`-triggered popup/modal** (`#lnav-ipanel`), all five shown at once as headings (`.lnav-ipanel-q`) with their content, Step-by-Step Working as a numbered list with `Runs via:` lines; content is written via `textContent` (no HTML-escaping needed). The rail no longer carries an inline five-item accordion — it lists the real feature links and their group sub-sections (groups start collapsed except the active group). Sections follow the sequential marketer workflow: Research & Benchmark → Plan → Design & Create → Share & Track → Assistants; rows show only the quiet V1/V2 chip (Draft 1/2 lives in tooltips + the `?` popup). Superseded the 2026-07-04 inline-accordion rendering.
