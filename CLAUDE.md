# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# VAHDAM Lifecycle OS — Project Memory

A retention/lifecycle-marketing toolkit for VAHDAM Teas, deployed as a **single Vercel project** (no framework — `framework: null`, `outputDirectory: "."`). It started as the Mailer Studio (`vahdam_mailer_architect_v34.html`) and grew into a multi-page suite: data analysis → marketing calendar → mailer creation → competitor intelligence → knowledge base → ad/landing-page generation.

Live: https://vahdam-marketing-mailers-architect.vercel.app/ · Canonical repo: `~/dev/anchit-hustle` (moved off iCloud, which was corrupting git — this iCloud copy may still be the working dir).

## Version taxonomy (V1 vs V2) — product-owner convention, 2026-07-03
- **V1 = the legacy base app**: everything that existed before 2026-07-03 (dashboard/analytics, /plan RFM calendar, Mailer Studio /studio, competitor, KB, ads, landing pages, ChaiGPT, smart-brain).
- **V2 = the Lifecycle OS additions of 2026-07-03**: the cohort mailer-calendar system (/mailer-calendar), the UK non-engagers campaign hub (/uk-non-engagers) + week-1 campaign, tier-routed LLM/image cascades + video-core, Social Media OS (/social), knowledge/retention/ library, and the LHS-nav IA rule.
- V1 features are upgraded by customising the base version, and only where needed. Where a feature exposes both generations in menus/hubs, label the earlier build **"Option 1"/"Draft 1"** and the current one **"Option 2"/"Draft 2"** (V2 = the second draft).

## Mailer type taxonomy
Mailers come in exactly two named types:
1. **Text** — pure typographic (the `pure` render style).
2. **Text + Graphics** — text plus BUILT graphic elements only: brand-palette colors, buttons, labels, badges, dividers, price/receipt tables (CSS/table constructs — never photos; photos are optional slots the user fills). Any combination of such elements qualifies. Maps to the `visual`/`editorial` render styles.

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
- Pages: `index.html` (home), `dashboard.html` (RFM/cohort analytics), `calendar.html` (30-day plan), `vahdam_mailer_architect_v34.html` (Mailer Studio — the main app, served at `/studio`), `competitor-benchmarking.html`, `knowledge-base.html`, `ad-campaigns.html`, `landing-pages.html`, `cohort-definitions.html`.
- Friendly URLs are wired in `vercel.json` `rewrites` (e.g. `/studio`, `/analytics`, `/plan`, `/competitor`, `/kb`, `/ads`). When adding a page, add its rewrite there.
- Shared front-end helpers: `chart-enhance.js`, `table-sort.js`.

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
| `api/public-config.js` | Public config (Supabase URL + anon key) + `?health=1` health check; `/api/health` rewrites here |

### Shared LLM caller — `api/_shared/llm.js`
6-provider text waterfall, de-duplicated: **OpenAI** (`OPENAI_API_KEY`/`_2`/`_3`) → **Anthropic** (claude-3-5-haiku) → **Gemini** (free tier) → **Grok/xAI** → **Groq** (free) → **Cerebras** (free). All callers should go through this rather than calling providers directly. Per-call provider override is supported (`'gemini'|'openai'|'anthropic'|'grok'`).

### Auth to Google Sheets — Workload Identity Federation (keyless)
Competitor data lives in a Google Sheet. Auth has **two modes** (see `docs/workload-identity-federation.md` and `_shared/competitor-core.js`):
- **Mode A (preferred, keyless):** WIF — Vercel mints a per-request OIDC token (`VERCEL_OIDC_TOKEN`, enable "OIDC Tokens" in Vercel project settings), Google STS swaps it, code impersonates the SA. Set `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT_EMAIL`.
- **Mode B (legacy):** JSON key in `GOOGLE_SERVICE_ACCOUNT_*` env vars. Code prefers Mode A when `GCP_*` present; falls back to JWT when `VERCEL_OIDC_TOKEN` absent.

### Smart Brain (persistent daily loop)
`lib/smart-brain/services.js` (6 services: KB, Analysis, Competitor, Calendar, Generation, Review) + `api/_shared/smart-brain-plan.js` (persistent rolling 15-day plan in `smart_calendar_entries`, diff-updated daily, human approve/reject). Daily Vercel Cron (03:30 UTC) hits `/api/cron/smart-brain` (rewrite → `?action=smart-brain-cron`, `CRON_SECRET`-protected). Console UI: `smart-brain.html` at `/brain`. Approving a slot LLM-writes mailer + Meta/Google/TikTok ads + landing page (served at `/lp/:campaignId`) and mirrors them into `ads_generated`/`landing_pages_generated`. Platform push stays Phase 2 (`push_status: not_integrated_phase_2`).

### ChaiGPT — the brand LLM (conversational tool-calling over the whole stack)
`api/_shared/brand-llm.js` is the brand's own "Claude-for-Vahdam": a provider-agnostic **tool-calling loop** that lets the LLM actually OPERATE the growth stack instead of just chatting. The model emits a strict JSON action each turn (`{action:'tool',...}` — single tool or a `tools:[…]` batch of up to 3 run in parallel — / `{action:'final',...}`); the server executes against the existing `_shared` cores and feeds results back, looping (default 5 steps). Speed: the loop pins the first provider that answers (per-call `preferProvider` in `llm.js`) so later steps skip dead keys, dedupes repeated tool+args calls, 20s per-provider timeout. Quality: the system prompt enforces an **evidence contract** — every recommendation quotes exact tool-sourced figures, names the target metric + expected impact, states a complete hypothesis, and quotes competitor benchmarks. Because tool-calls are plain JSON (not a provider-specific function-calling API), it works across the **entire 6-provider waterfall in `llm.js`**, including the free tiers — no extra keys. Tools registered: `ask_analytics`, `run_analysis`, `list_cohorts`, `get_calendar`, `get_competitor_benchmarks`, `search_knowledge_base`, `list_campaigns`, `generate_calendar`*, `generate_assets_for_slot`*, `run_agentic_campaign`*, `klaviyo` (*=writes/generates, only on explicit ask). Each reuses the SAME logic the `/api/brain ?action=` routes use. Endpoints: `?action=brand-chat` (the loop), `?action=brand-tools` (manifest + klaviyo status). UI: `chaigpt.html` at `/chaigpt` (also `/chai`, `/ask`) — Claude-style chat that shows the tool trace. Rename the product via the single `BRAND_LLM_NAME` constant in `brand-llm.js`.

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

## Product Catalogs
US: 173 · UK: 101 · Global: 102 active products. Built at deploy from `products_export_{usa,uk,global}.csv` via `scripts/build-catalog.js` → `data/catalog/products_{region}.json` (served with CORS + cache headers per `vercel.json`).

## Market-Specific Store URLs (VERIFIED)
US → www.vahdamteas.com | UK → uk.vahdamteas.com | IN → www.vahdamindia.com | EU → eu.vahdamteas.com | AU → au.vahdamteas.com | Global/ME → www.vahdamteas.com
- PDP: `{base}/products/{handle}` (handle = catalog JSON `h` field) · Collection: `{base}/collections/{slug}` (via `heroMap` in `collectionUrl()`)

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

## LHS navigation IA rule
The shared LHS menu (`auth.js`, element `#lifecycle-nav`; model exposed as `window.__LC_NAV` / `window.__LC_NAV_INFO`) follows a standing IA rule:
- **Every feature item expands into the SAME five sub-items, in this exact order:** 1. What does it do? · 2. Who is it for? (cohort / cohort definition) · 3. How does it work? (modes/steps/logic) · 4. Input · 5. Step-by-Step Working.
- **Sub-item 5 for content-producing features presents the multi-agent pipeline steps:** Ideology → Data analysis + review + hypothesis → Business & strategy decisions → Content → Design + layout + structure → Audio/Video (where applicable) → Coding → Final compilation + presentation — noting `Runs via: <endpoint>` wherever a live endpoint exists. (Social Media OS uses its own 7-agent variant: Ideology, Data & Hypothesis, Strategy, Content, Design, Audio/Video, Compilation — runs via `/api/brain?action=social-run-daily`.)
- **Menu items carry the V1/V2 taxonomy badge** (see "Version taxonomy" above); where both generations of a capability exist they are labelled **Draft 1 / Draft 2** (Plan V1 = Draft 1 vs Mailer Calendar V2 = Draft 2 of calendaring; Mailer Studio V1 = Draft 1 vs Mailer Calendar built mailers = Draft 2 of mailer creation).
- Content lives in `auth.js` (`NAV`, `SUBQ`, `INFO`). String rules there: double-quoted strings only (apostrophes fine; never a double quote or backtick inside), text positions only. The nav must render signed-out too and degrade gracefully when Supabase/config fetches fail.
- **Sanctioned rendering (2026-07-04):** the five sub-items render as a true accordion — collapsed by default, max ONE list open at a time, the current page's item auto-expanded (order/presence unchanged); group page-links likewise start collapsed except the active group; sections follow the sequential marketer workflow: Research & Benchmark → Plan → Design & Create → Share & Track → Assistants; rows show only the quiet V1/V2 chip (Draft 1/2 lives in tooltips + info panels).
