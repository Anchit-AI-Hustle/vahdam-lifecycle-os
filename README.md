# VAHDAM Lifecycle OS

A retention and lifecycle-marketing operating system for VAHDAM Teas: analyse the
data, plan the calendar, generate every asset the plan needs, and check the result
against the platform it ships on.

**Live:** https://vahdam-lifecycle-os.vercel.app · https://vahdam-lifecycle-os.anchit-tandon.com

> The older `vahdam-marketing-mailers-architect.vercel.app` is a **stale separate
> deployment**. Do not use it to judge current state; `main` deploys to the project
> above (health reports `build: "lifecycle-os"`).

---

## Read these first

| | |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | **The working memory.** Brand constants, the invariants, and a defect-by-defect record of what broke and why. If you change anything in this repo, this is the file that tells you which rules are load-bearing. |
| [`docs/campaign-orchestration-master-spec.md`](docs/campaign-orchestration-master-spec.md) | **The governing spec** for all calendar, cohort, mailer, ad, dashboard and creative work. Zero fabrication, closed source-of-truth, frequency caps, launch gate. |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Build narrative and a "where to make common changes" map. |
| [`docs/PRD.md`](docs/PRD.md) | Vision, every feature, roadmap. Deck at [`/prd-deck`](https://vahdam-lifecycle-os.vercel.app/prd-deck). |

---

## Quickstart

```bash
npm install
npm run test:install          # first time only: download the pinned Chromium
npm run build                 # builds the fallback catalog + website designs
npm test                      # Playwright: 50 spec files
```

There is **no dev server** — the `dev` script is a no-op stub. Pages are static
HTML, so open one directly, or run `vercel dev` when you need the serverless
functions.

### Running tests locally (read this or your green run means nothing)

`playwright.config.js` honours `PW_CHROMIUM_PATH`, and in this sandbox you **must**
set it:

```bash
export PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
npx playwright test --project=desktop-1280
npx playwright test --project=pixel-5     # mobile coverage, still Chromium
```

Without it the browser-driving specs die at launch, and depending on which specs
were selected the run can still print a clean `N passed` — a pass of the
file-reading specs only. The `iphone-se` / `iphone-12` / `ipad` projects resolve to
WebKit, which is not installed here; leave those to CI.

---

## Architecture in one page

### Front end: independent static pages sharing one auth/nav shell

Every page is a **standalone self-contained `.html` file** (inline CSS + JS, some
very large). They are not a component tree; they share state through
`localStorage` and one script:

- **`auth.js`** — boots Supabase from `/api/public-config`, forces Google sign-in,
  renders the shared LHS nav, registers the service worker, exposes
  `window.LifecycleAuth`.
- Shared front-end modules, each owning one cross-page concern:
  `chart-enhance.js` · `table-sort.js` · `funnel-drill.js` (the one attribution
  graph every analytics table drills through) · `ai-studio-bar.js` (Fill · Suggest ·
  New · Enhance · Clear on any creation surface) · `gate-notice.js` (turns a
  structured refusal into a reason and a fix).

Friendly URLs live in `vercel.json` `rewrites`. **When you add a page, add its
rewrite there** — `cleanUrls` is false, so a bare `.html` path is a real URL.

### Back end: 12 serverless functions, and that is the whole budget

The Vercel Hobby plan caps Serverless Functions at **12**, and the repo sits at
exactly 12. This dictates the structure:

- Files under **`api/_shared/`** are **not** counted as functions. Almost all logic
  lives there and is `require()`d by thin public endpoints.
- Multi-capability features are **single catch-all routers dispatched by
  `?action=`**, not one file per capability.

**Before adding any `api/*.js` file, check the count in `vercel.json` `functions`.**
Extend a router or move the logic into `_shared/`.

| Function | What it is |
|---|---|
| `api/brain.js` | The main router: `?action=catalog\|shopify\|klaviyo\|webengage-report\|connectors-health\|social-*\|agent-*\|tts\|snowflake-sync\|…` |
| `api/calendar.js` | 30/90-day plan generation, mailer triggers, all `smart-brain-*` actions, and `?action=lp&id=` which serves generated landing pages at `/lp/:id` |
| `api/ai/generate.js` | Text generation: briefs, concepts, full mailers, landing pages |
| `api/ai/image.js` | The image cascade (Gemini native → Imagen → OpenAI → Pollinations) |
| `api/ai/pipeline/{strategy,variant,images,html,score}.js` | The staged mailer pipeline |
| `api/competitor.js` | Competitor benchmarking router (Gmail IMAP → Google Sheet) |
| `api/kb.js` | Knowledge base router (Supabase-backed) |
| `api/public-config.js` | Public config + `/api/health`. Detailed health, `?pipeline=1` and `?probe=1` are **operator-only** |

### The route map

```
Research   /competitor  /kb  /growth-book
Analyse    /analytics (= /data-analysis)  /rfm  /ads-master  /connectors
Plan       /plan (V1 calendar)  /mailer-calendar (V2)  /email-calendar  /brain
Create     /studio (Mailer Studio)  /ads → /ads-master#crestudio (Creative Studio)
           /landing-pages  /lp/:id  /social  /assets  /3d  /templates
Assist     /chaigpt (also /chai, /ask)  /agent  /all-in-one
```

---

## The rules that are load-bearing

These are the ones that cost real money or real credibility when broken. Full
detail, with the incident that produced each, is in `CLAUDE.md`.

**Zero fabrication.** Never invent a price, URL, image, rating, review, claim,
segment size or performance figure. A missing fact becomes
`[DATA REQUIRED BEFORE LAUNCH: field, product, region]`. A deliverable carrying
placeholders is a success; one carrying invented specifics is a failure even when
every word reads beautifully.

**The catalog is live, and a gate proves it before any creative runs.**
`api/_shared/catalog-live.js` is *the* catalog resolver: Shopify Admin → the store's
public `/products.json` → the built artifact, labelled `live:false, stale:true`.
`catalog-gate.requireLiveCatalog()` is a hard stop that runs **first** — before the
brief, before a token of copy, before the first image call. Read the catalog through
the resolver, never `data/catalog/*.json` directly.

**Nothing fabricates when a connector is missing.** Every platform core returns
`{connected:false, would_request|would_query, blocker}` naming the exact call it
would have made, so callers render an honest empty state instead of a plausible
number. `LIVE_CONNECTORS` is the kill switch and **every outbound core must actually
call it** — `tests/kill-switch.spec.js` asserts each one both imports and invokes it.

**One source per fact.** Market URLs live in `api/_shared/market-urls.js` and nowhere
else; nine hand-written copies once existed and four were wrong. Sizes and copy
limits live in `asset-specs.js`. Banned phrases live in `scenario-model.js`. A
constant that lives in two places is enforced in one.

**Every asset is built by its own engine.** `api/_shared/asset-engines.js` gives each
asset type — mailer, `ad_{meta,google,tiktok}`, landing page, the six organic social
platforms, video, playable, blog — its own `design()` (which structure this slot
gets, and why), `contract()` (its own generation directive, injected into the prompt),
`params` (its own temperature) and `qa()` (its own deterministic validator). QA
reports with the measured value; it never silently repairs, because truncating a
headline mid-word ships a broken ad that reads as finished.

**A blocked build explains itself.** The gates answer HTTP 200 with
`{ok:false, blocked:true, message, blocker, data_required, remediation}`. Front ends
render it through `gate-notice.js`, so a block reads as a verdict with the fix, and
only a genuine transport failure may ask whether the API is reachable.

**A stale date must never present itself as today.** Freshness is derived at render
time, never re-asserted from a stored flag.

**`snowflake-streamlit-app` must never be merged into `main`.** It is a permanently
separate Streamlit-in-Snowflake distribution. Enforced by a required check.

---

## Live data sources

Seven platforms, one contract. `/api/connectors-health` probes them all with real
round-trips and returns an actionable `blocker` each.

| Platform | Core | Reached via |
|---|---|---|
| Shopify (read-only Admin, operator-only) | `shopify-core.js` | `/api/shopify?op=…` |
| Product catalog (live, gated) | `catalog-live.js` · `catalog-gate.js` | `/api/catalog?op=…` |
| Meta Ads | `ads-live-core.js` · `ad-insights-core.js` | `?action=ads-live` · `?action=ad-insights` |
| Google Ads · TikTok Ads | `ad-insights-core.js` | `?action=ad-insights&platform=…` |
| Klaviyo | `klaviyo-core.js` | `/api/klaviyo?op=…` |
| WebEngage | `webengage-core.js` | `/api/webengage` |
| Supabase | `supa.js` | (storage, auth, KB) |

---

## Generation stack

- **Text:** `api/_shared/llm.js` — an **eleven-rung, tier-routed** waterfall:
  Anthropic → OpenAI → Gemini → Grok/xAI → Groq → Cerebras → GitHub Models →
  Cloudflare Workers AI → OpenRouter → Ollama → Sakana. The last five are
  conditional and skip cleanly when their env config is absent, so a default
  deployment behaves as six rungs. Tiers are `premium` / `standard` / `fast`
  (`fast` skips Grok). Per-call provider override is supported. All callers go
  through it rather than calling a provider directly, and
  `tests/llm-waterfall-docs.spec.js` pins this description to `providerOrder()`.
- **Images:** `api/ai/image.js` — Gemini native → Gemini Imagen (paid plans only) →
  OpenAI → Pollinations (free).
- **Video:** `api/_shared/video-core.js` — Veo → Sora → Higgsfield → Runway. Renders
  **silent** unless passed an `audio:` direction, and Runway has no audio track at
  all, so results carry `audio_requested` / `audio_supported` / `audio_note`.
- **Agent layer:** `brand-llm.js` (ChaiGPT) runs a provider-agnostic tool-calling
  loop over the existing cores, so it works across the whole waterfall including the
  free tiers. Routing is evaluated by `evals/` — structural evals gate CI
  (`npm run evals`), live evals are advisory (`npm run evals:live`).

---

## Persistence

- **Supabase** (Postgres) — cross-device storage, auth, knowledge base, captured
  competitor emails. Migrations in `supabase/migrations/`;
  `supabase/COMBINED_RUN_THIS.sql` is the apply-all bundle.
- **localStorage** — analytics state handed between dashboard → calendar → studio.
- **Google Sheet** — the competitor-email database, reached with keyless Workload
  Identity Federation (see `docs/workload-identity-federation.md`).

---

## Mobile

The whole OS ships as **one mobile super app**: an installable PWA plus native
Android/iOS Capacitor shells (`android/`, `ios/`, `mobile/`). The shells render the
live deployment, so **every web deploy is automatically a mobile release**.

Builds are published by the **Mobile Builds** workflow to the fixed release tag
`mobile-latest`:

| Platform | Download |
|---|---|
| Android (APK) | [`vahdam-lifecycle-os.apk`](https://github.com/Anchit-AI-Hustle/vahdam-lifecycle-os/releases/download/mobile-latest/vahdam-lifecycle-os.apk) |
| iOS (unsigned IPA, sideload or sign for TestFlight) | [`vahdam-lifecycle-os-ios-unsigned.ipa`](https://github.com/Anchit-AI-Hustle/vahdam-lifecycle-os/releases/download/mobile-latest/vahdam-lifecycle-os-ios-unsigned.ipa) |

---

## Offline Python engines (run locally, not on Vercel)

- **`ingest/`** — `run_all.py` runs the Matrixify / Shopify Analytics / Klaviyo /
  WebEngage loaders into DuckDB, then `sync_to_supabase.py`.
- **`mailer_system/`** — a Python Claude-API campaign trigger engine; thresholds in
  `targets.json`, output to `outputs/`.
- **`marketing_automation/`** — React 19 + Vite + Express interactive campaign
  compiler (its own `package.json`).
- **`scripts/`** — JS build tools (`build-catalog.js`, `seed-*.js`, `build:july`) and
  Python patchers used during development.

---

## Brand constants

Source of truth: `Brand style guide.pdf`. Enforced in code by
`scenario-model.sanitizeBrand()` and the per-asset QA engines.

- **Palette, these four only:** `#004A2B` forest green · `#AB8743` gold ·
  `#171717` near-black · `#FBF5EA` cream
- **Type:** Lao MN (headings) · Proxima Nova (body). No other font in a mailer.
- **Banned:** wellness journey · transform · liquid gold · game-changer ·
  LIMITED TIME (caps) · hurry · don't miss out · last chance · while supplies last
- **No em or en dashes anywhere in output copy.** Commas, colons or plain hyphens.
- **Never a black or near-black section background.** Use forest green.

---

## Environment variables

Never hardcode; set them in Vercel. Full list and notes in `.env.example`.

| Group | Variables |
|---|---|
| Text models | `OPENAI_API_KEY` (+`_2`/`_3`), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY` |
| Storage | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| Commerce | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` (read-scoped), `SHOPIFY_API_VERSION`, `CATALOG_MAX_AGE_MINUTES`, `CATALOG_TTL_SECONDS`, `CATALOG_MISS_TTL_SECONDS`, `CATALOG_GATE` |
| Lifecycle | `KLAVIYO_API_KEY` (+ `KLAVIYO_PUBLIC_KEY`, `KLAVIYO_REVISION`), WebEngage |
| Safety | `LIVE_CONNECTORS` (kill switch), `CRON_SECRET`, `ANALYTICS_ADMIN_DOMAINS` |
| Sheets | `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB` |

---

## Common traps

1. **Unescaped quotes or a stray backtick** inside the giant inline-JS pages — one
   backtick in a CSS comment once killed the sidebar.
2. **`const` reassignment** — use `let` when it is reassigned later.
3. **CORS headers** — every serverless function needs
   `Access-Control-Allow-Origin`.
4. **Quota errors return HTTP 400, not 429/402.** OpenAI `billing_hard_limit_reached`
   and Anthropic "credit balance too low" both 400; detection must check status 400
   plus billing keywords.
5. **Function-count limit (12).** Adding an `api/*.js` file can break the deploy.
6. **Service worker caching** — `sw.js` must never cache `/api/*`.
7. **A merge can delete a feature's entrances while keeping its code.** When one page
   hosts two jobs, each job needs its own nav row, its own INFO entry and its own
   route.
8. **Every nav `gid`/`id` must resolve to an `INFO` key and vice versa** — a renamed
   key silently removes a feature's entire description.

---

## What is not done

- **Automatic sending.** The calendar and Smart Brain produce approved, ready assets;
  nothing fires an email. Platform push is Phase 2
  (`push_status: not_integrated_phase_2`).
- **The data feeds the governing spec requires before launch:** an approved review
  library, an approved claims library, an approved URL map, real eligible-segment
  sizes, and a valid `SUPABASE_SERVICE_ROLE_KEY`.
- **Collections in Mailer Studio Step 2** still come from `deriveTags` keyword
  buckets rather than real store collections, even though the resolver
  (`catalog-live.resolveCollections`) exists.
- **`knowledge-base.html` is not registered with the sync bar**, though
  `kb?action=top-emails` is a plain read and could be wired.
