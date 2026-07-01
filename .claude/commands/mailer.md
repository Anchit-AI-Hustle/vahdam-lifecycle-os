---
description: Generate a brand-compliant Vahdam HTML mailer (lifecycle email) end-to-end.
argument-hint: "[brief, e.g. 'welcome series email 2 for green tea subscribers, US']"
---

# Mailer generation

Produce a Vahdam HTML email for: `$ARGUMENTS`.

## Method
1. Invoke the **`anthropic-skills:vahdam-d2c-mailer`** skill as the primary engine. It encodes the Mailer Studio contract.
2. If product specifics are needed, pull real catalog data from `data/catalog/products_{us,uk,global}.json` (built by `scripts/build-catalog.js`) — use real handles for PDP links `{storeBase}/products/{handle}`.
3. Follow the Mailer Studio structure (`vahdam_mailer_architect_v34.html`): compact ~1200–1500px, one of the 11 layout archetypes, brand-locked.

## Hard constraints
- **@font-face / palette / logo / footer** per the brand asset code engine (strict HTML/CSS contract). Headings Lao MN, body Proxima Nova. Only the 4 brand colors.
- **No banned phrases.** Voice: warm, sensory, story-driven. Testimonials as tiny personal stories.
- Carry a **portable master prompt** in the asset (master-prompt contract) and append a **Change Log** after edits.
- P01: lead with happiness/benefit, not specs.

## Output
Self-contained HTML file. Offer to (a) preview, (b) push into Klaviyo as a template via `/email-flow`, (c) register it in the calendar.
