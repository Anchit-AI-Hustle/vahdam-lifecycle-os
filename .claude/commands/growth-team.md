---
description: Vahdam Growth OS — the full growth team. Routes any growth request to the right vertical (planning, creative, lifecycle, commerce, analytics, data). Run with no args for the map.
argument-hint: "[what you want, e.g. 'plan a Q3 ashwagandha winback campaign']"
---

# Vahdam Growth OS — full-stack growth team

You are operating the **Vahdam Lifecycle/Growth OS** for a coffee + wellness D2C brand. This command is the router. Read the request in `$ARGUMENTS`, decide which vertical(s) it belongs to, and either dispatch to the matching command/skill or do the work directly using the wiring below.

## The team (verticals → command → tools)

| Vertical | Command | Connectors / Skills |
|---|---|---|
| **Strategy & planning** | `/campaign-plan` | `marketing:campaign-plan`, Shopify + Klaviyo data, competitor KB |
| **Email/SMS lifecycle** | `/email-flow` | Klaviyo connector, `marketing:email-sequence` |
| **Mailers (HTML email)** | `/mailer` | `anthropic-skills:vahdam-d2c-mailer`, Mailer Studio contract |
| **Ad creatives (image/video/gif)** | `/ad-creative` | `higgsfield-*` skills, Marketing Studio |
| **Landing pages (HTML)** | `/landing-page` | brand asset code engine, `/lp/:id` contract |
| **Design (static/social)** | `/design` | Canva, Figma, Adobe Express skills |
| **Commerce data** | `/shopify` | Shopify MCP (products/orders/customers/analytics) |
| **Analytics & reporting** | `/analytics` | Supabase, `marketing:performance-report`, Amplitude/Supermetrics |
| **Competitor intel** | `/competitor` | competitor router, `marketing:competitive-brief`, SimilarWeb/Ahrefs |
| **SEO / AEO** | `/seo` | `marketing:seo-audit`, Ahrefs |
| **Database (query + architecture)** | `/db` | Supabase skill, `supabase/migrations/` |
| **Ship** | `/ship` | `vercel-plugin:deploy` |

## How to dispatch
1. If the request maps cleanly to one command above, invoke that command/skill.
2. If it spans verticals (e.g. "plan + create + schedule a winback"), run them in order: plan → create assets (mailer/ad/LP) → wire data → report. Keep the user in the loop between phases.
3. Always enforce the **Brand Constants** below on any generated copy or asset.

## Brand constants (NON-NEGOTIABLE on every asset)
- **Palette (only these 4):** `#004A2B` forest green · `#AB8743` gold · `#171717` near-black · `#FBF5EA` cream
- **Type:** Headings = Lao MN (`'Lao MN','Cormorant Garamond',Georgia,serif`); Body = Proxima Nova (`'Proxima Nova','Helvetica Neue',Arial,sans-serif`)
- **BANNED phrases:** wellness journey, transform, liquid gold, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last
- **PREFERRED:** ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted
- **Store URLs:** US `www.vahdamteas.com` · UK `uk.vahdamteas.com` · IN `www.vahdamindia.com` · EU `eu.vahdamteas.com` · AU `au.vahdamteas.com`
- **Active mandate:** Aman's P01 — *sell happiness, not features*. Lead with emotional/sensory benefit; bake approved copy into creatives (see `api/_shared/master-prompt.js`).

If `$ARGUMENTS` is empty, print this team map and ask which vertical to start with.
