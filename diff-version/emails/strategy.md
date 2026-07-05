# VAHDAM UK — Lifecycle Email Strategy, Week 1 (Thu 3 – Wed 9 July 2026)

Two cohorts, three sends each, all at **09:00 UK**. Objective for both: **open → click → purchase**, with subscription as the priority conversion for Coffee (and Supplements once priced/linked). All emails are Klaviyo paste-ready HTML in `emails/`, brand-audited (4-colour palette, Lao MN/Proxima Nova, banned-phrase-free, no founder voice, no medical claims, exact pricing only).

## The week at a glance

| # | Send | Cohort | Email (file) | Play | Product focus | Offer mechanic |
|---|---|---|---|---|---|---|
| 1 | **Thu 3 Jul** | A — Non-Buyers/Non-Engagers | `2026-07-03_cohortA_story-intro-coffee.html` | Brand-story re-introduction | Ashwagandha Coffee (soft) | 7 gifts with every order, gentle CTA |
| 2 | **Thu 3 Jul** | B — T&B Buyers/Non-Engagers | `2026-07-03_cohortB_winback-wimbledon.html` | Warm win-back + Wimbledon week | 4 real T&B favourites | Honest was/now prices, zero pressure |
| 3 | **Sun 6 Jul** | A | `2026-07-06_cohortA_gifts-unboxing-subscription.html` | Unboxing education + value math | Coffee Pack of 1 | Sub £29.99 vs one-time £49.99; £105+/yr sub gifts |
| 4 | **Sun 6 Jul** | B | `2026-07-06_cohortB_coffee-launch-tea-lovers.html` | Cross-grade launch news | Coffee for tea-lovers | £29.99 sub leads; 7 gifts; £105/yr hook |
| 5 | **Wed 9 Jul** | A | `2026-07-09_cohortA_pack-of-3-offer.html` | Offer-forward B2G1 | Coffee Pack of 3 | £59.99 sub = 2 × £29.99, third pack free; closes Sunday |
| 6 | **Wed 9 Jul** | B | `2026-07-09_cohortB_supplements-launch.html` | New-launch, first-to-know | Turmeric Curcumin 1800 MG + Green Burner | Subscription-rhythm framing; sampler PS £12.99 |

## Subject lines (primary + alternates + preheader)

**1 · Cohort A · Thu 3 Jul — story intro**
- Primary: *Before the day asks anything of you*
- Alt 1: *There is an hour the day hasn't claimed yet*
- Alt 2: *Shall we begin again, over coffee?*
- Preheader: A quiet introduction to VAHDAM — and a coffee blended with ashwagandha, made for the slowest sip of the day.

**2 · Cohort B · Thu 3 Jul — win-back**
- Primary: *The kettle never mentions how long it's been*
- Alt 1: *Grass courts, strawberries, and your usual cup*
- Alt 2: *Your favourites, right where you left them*
- Preheader: It's afternoon-tea week in England. No occasion needed — though the iced green tea is rather good.

**3 · Cohort A · Sun 6 Jul — unboxing**
- Primary: *Seven gifts arrive with your first bag of coffee*
- Alt 1: *We opened the box for you. Here is everything inside.*
- Alt 2: *A frother, a wooden scoop, and a sixty-second ritual*
- Preheader: An electric frother, a recipe booklet, plantable paper, five teas and more — with every Ashwagandha Coffee order. And a better way to begin, at £29.99.

**4 · Cohort B · Sun 6 Jul — coffee launch**
- Primary: *We've made our first coffee*
- Alt 1: *From the people behind your chai — a coffee*
- Alt 2: *Some news from your tea shelf*
- Preheader: Rich, rounded, steadied with ashwagandha — £29.99 a pack on subscription, with seven gifts in every order.

**5 · Cohort A · Wed 9 Jul — B2G1 offer**
- Primary: *Buy two packs. The third is on us.*
- Alt 1: *Your third pack of Ashwagandha Coffee, free*
- Alt 2: *Two packs paid. Three packs poured.*
- Preheader: Pack of 3 on subscription is £59.99 — the price of two. Seven gifts with your order. This week's welcome offer closes Sunday.

**6 · Cohort B · Wed 9 Jul — supplements launch**
- Primary: *We've made something new — you're hearing it first*
- Alt 1: *After tea: our first supplements have arrived*
- Alt 2: *The roots we've always worked with, in a new form*
- Preheader: Turmeric Curcumin 1800 MG and Green Burner, just launched — our tea drinkers hear it before anyone else.

## Why this sequence

**Cohort A (never bought, not opening):** Day 0 earns attention with story, not an offer — non-engagers have seen (and ignored) offers. Day 3 converts attention into a concrete decision with the unboxing (tangible gifts beat abstract discounts for first purchase) and makes subscription the visibly better choice. Day 6 closes the week with the strongest honest offer (free third pack) and a soft deadline. Escalation: story → proof → offer.

**Cohort B (bought tea, gone quiet):** Day 0 reactivates on familiar ground — their teas, honest prices, a seasonal reason to return this specific week (Wimbledon) with zero pressure. Day 3 delivers genuine news ("your tea house made a coffee") that rewards re-opening, bridged through products they already know (chai, Turmeric Ashwagandha tisane). Day 6 gives a second news beat (supplements, first-to-know positioning) plus an easy tea re-entry in the PS. Familiarity → news → news + easy path back.

**Subscription-first everywhere it's allowed:** Coffee emails lead with £29.99-sub pricing and the £105/yr gift hook; T&B is strictly one-time (no subscription language anywhere near it); supplements use subscription-rhythm framing without pricing (none provided).

## ⚠️ Verify before sending (2 minutes in Klaviyo)

1. **Three product URLs are best-guess** (storefront unreachable from the build environment) — confirm these resolve, or fix the hrefs:
   - `https://vahdam.co.uk/products/ashwagandha-coffee` (emails 1, 3, 4, 5)
   - `https://vahdam.co.uk/products/turmeric-curcumin` (email 6)
   - `https://vahdam.co.uk/products/green-burner` (email 6)
   - All T&B links use real handles from your store export — no check needed.
2. **Send a test to yourself** — confirm the 5 product images load (they're the exact URLs from your store export, so they should) and fonts fall back gracefully where Lao MN/Proxima Nova aren't installed.
3. **"Closes Sunday"** in email 5 refers to Sun 13 July — adjust if you want a different window.
4. Footer uses Klaviyo tags `{{ organization.full_address }}` and `{% unsubscribe %}` — these populate automatically in Klaviyo.

## Sending today (Thu 3 Jul)

Emails **1** and **2** are today's sends — paste each HTML into a Klaviyo campaign, pick the primary subject (alternates are for A/B testing if list size allows), target your two cohort lists, send at 09:00 UK or ASAP.
