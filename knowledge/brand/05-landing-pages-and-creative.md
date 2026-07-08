# VAHDAM — Landing Pages & Creative System

How VAHDAM landing pages are generated, served, and kept on-brand, plus the creative rules every image and page must follow.

## The landing-page system

The OS generates brand-compliant HTML landing pages and serves them from a single serverless route. Pages are produced by the ad/landing-page generators, the Smart Brain approval flow (which LLM-writes a mailer + Meta/Google/TikTok ads + a landing page per approved slot), and the `/landing-page` command.

### Ashwagandha presell matrix

The repo contains a set of **Ashwagandha Coffee presell landing pages** organised as a motivation matrix, targeting the distinct reasons a Wellness Optimiser reaches for the product:

- **Ambition** — the productivity/drive angle.
- **Anxiety** — the calm/stress-relief angle.
- **Productivity** — the sustained-focus angle.
- **Cortisol presell** — dedicated pages built around the cortisol/stress-hormone narrative.

Each presell page leads with the felt problem and the daily cup as the answer, staying inside the brand's restraint (functional benefit, never a miracle claim; no banned phrases).

### Agent landing pages

- **`/lp/agent`** — the agent-generated landing page surface.
- **`/lp/best`** — the best-performing / canonical variant surface.

## The `/lp/:id` serving contract

Generated landing pages are served at **`/lp/:id`**, routed through `api/calendar.js` (`?action=lp&id=`). When the Smart Brain approves a calendar slot, it mirrors the generated assets into `ads_generated` and `landing_pages_generated`, and the landing page becomes reachable at `/lp/:campaignId`.

Any tool that produces a landing page must therefore:
1. Emit a self-contained HTML document (inline CSS/JS, no external framework dependency).
2. Register/mirror it so it resolves under `/lp/:id`.
3. Pass a stable id (campaign id) so the URL is durable.

Platform push to ad networks remains **Phase 2** (`push_status: not_integrated_phase_2`); generation and serving are live today.

## Creative rules (pages and imagery)

Non-negotiable, identical to the brand foundation:

- **Palette:** only forest green `#004A2B`, gold `#AB8743`, near-black `#171717`, cream `#FBF5EA`. No off-palette tints.
- **Typography:** Headings Lao MN (fallback Cormorant Garamond, Georgia, serif); Body Proxima Nova (fallback Helvetica Neue, Arial, sans-serif). No other font as the primary family.
- **No on-image text.** Image-generation prompts must instruct "NO text" — copy is laid over images with real type, never baked into the generated pixels. (The image cascade — Gemini native to Gemini Imagen to OpenAI to Pollinations — carries this instruction.)
- **Single-estate provenance imagery.** Show origin: gardens, hand-picked leaf, the roast, the steep, the ritual moment. Prefer warm, sensory, story-led visuals over stocky product-on-white unless the layout calls for a clean hero.
- **Copy discipline.** Banned phrases and em/en dashes are forbidden on pages exactly as in mailers; use the preferred lexicon (ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted).
- **Offer framing follows the playbook** — subscription-first for coffee/supplements, one-time for teas, discounts only for the Curious Switcher / discount-responsive cohort (see `04-offers-and-mechanics.md`).

## Related surfaces

- **Mailer Studio** (`/studio`) produces the email counterparts under the same brand contract; landing pages should visually rhyme with the mailer that drives to them.
- Layout archetypes and 4-variant generation live in the Mailer Studio; landing pages reuse the same palette, type, and voice so a campaign feels like one piece across email, ad, and page.
