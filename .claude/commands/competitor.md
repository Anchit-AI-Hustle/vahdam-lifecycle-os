---
description: Sync competitor email intel and produce a competitive brief for Vahdam's coffee/wellness rivals.
argument-hint: "[ask, e.g. 'what are rival brands sending for summer iced tea?']"
---

# Competitor intelligence

Handle: `$ARGUMENTS`.

## Pipeline
- **Captured competitor emails** live in a Google Sheet + Supabase, synced via `api/competitor.js` (`?action=list|html|poll|sync`, logic in `_shared/competitor-core.js`). The 34-brand seed list is the canonical set.
- To refresh, trigger the sync (`?action=sync`, `CRON_SECRET`-protected) or poll latest.
- For market/traffic context, use **SimilarWeb** (traffic, channel mix) and **Ahrefs** (keywords, backlinks) connectors.

## Output
Run **`marketing:competitive-brief`** as the structure:
1. What rivals are doing (offers, cadence, creative angles, subject lines).
2. Gaps + opportunities for Vahdam.
3. Concrete recommendations → feed into `/campaign-plan`.

Be honest about coverage (which brands actually have recent data vs. stale/empty).
