'use strict';

/**
 * api/_shared/ad-metrics-catalog.js — the SINGLE source of truth for paid-media
 * metric definitions, formulas, categories and accuracy.
 *
 * Every ads calculation and dashboard number MUST come from this catalog so a
 * metric is defined once and computed identically everywhere. Metrics are grouped
 * by aspect of analysis (delivery, cost, click engagement, video engagement,
 * conversion/value, landing page, experiment). Each entry carries:
 *   key, label, category, unit, tier ('base' = read directly from the platform,
 *   'derived' = computed here), inputs (the fields it needs), formula (human
 *   string) and compute(r) (the actual function over a normalised row `r`).
 *
 * Normalised row `r`: platform fields lower-cased. Meta video quartile / action
 * counts that live in separate warehouse tables are passed in pre-flattened
 * (e.g. r.video_3s, r.thruplays, r.video_p100) by the data layer; when absent the
 * metric returns null (never a fabricated value).
 *
 * READ ONLY: this module only DEFINES and COMPUTES from data fetched read-only
 * from Meta / Google / TikTok / PageDeck. It never writes to any platform.
 */

const CATEGORIES = [
  { key: 'delivery', label: 'Delivery & Reach', aspect: 'How widely and how often the ad was served.' },
  { key: 'cost', label: 'Cost & Efficiency', aspect: 'What each unit of delivery/result costs.' },
  { key: 'click', label: 'Click Engagement', aspect: 'Clicks and click-through behaviour.' },
  { key: 'video', label: 'Video Engagement', aspect: 'Hook, hold and completion of video creative.' },
  { key: 'conversion', label: 'Conversion & Value', aspect: 'Purchases, revenue and return.' },
  { key: 'landing', label: 'Landing Page', aspect: 'What happens after the click, on the page.' },
  { key: 'experiment', label: 'Experiment (A/B)', aspect: 'Variant lift, confidence and significance.' },
  { key: 'retail', label: 'Retail Media (Amazon / marketplace)', aspect: 'Marketplace ad efficiency: ACOS, TACOS, units and basket economics.' },
];

// Safe helpers — every ratio guards its denominator and returns null (not 0/NaN)
// when an input is missing, so "no data" never masquerades as a real figure.
const n = (x) => (x == null || x === '' || isNaN(Number(x)) ? null : Number(x));
const div = (a, b) => { a = n(a); b = n(b); return (a == null || !b) ? null : a / b; };
const pct = (a, b) => { const r = div(a, b); return r == null ? null : r * 100; };

// r is a normalised row. Fields (lower_snake): spend, impressions, reach, frequency,
// clicks, inline_link_clicks, unique_clicks, outbound_clicks, video_3s, thruplays,
// video_p25, video_p50, video_p75, video_p95, video_p100, video_15s,
// purchases, purchase_value, add_to_cart, checkouts, landing_page_views,
// (PageDeck) sessions, bounces, time_on_page, lp_conversions.
const METRICS = [
  // ── Delivery & Reach ──
  { key: 'impressions', label: 'Impressions', category: 'delivery', unit: 'int', tier: 'base', inputs: ['impressions'], formula: 'impressions (as served)', compute: (r) => n(r.impressions), def: 'Times the ad was shown.' },
  { key: 'reach', label: 'Reach', category: 'delivery', unit: 'int', tier: 'base', inputs: ['reach'], formula: 'reach (unique people)', compute: (r) => n(r.reach), def: 'Unique people who saw the ad.' },
  { key: 'frequency', label: 'Frequency', category: 'delivery', unit: 'ratio', tier: 'derived', inputs: ['impressions', 'reach'], formula: 'impressions / reach', compute: (r) => div(r.impressions, r.reach), def: 'Average times each person saw the ad. Watch for fatigue above ~2-3.' },

  // ── Cost & Efficiency ──
  { key: 'spend', label: 'Amount spent', category: 'cost', unit: 'usd', tier: 'base', inputs: ['spend'], formula: 'spend', compute: (r) => n(r.spend), def: 'Total amount spent.' },
  { key: 'cpm', label: 'CPM (cost / 1,000 impressions)', category: 'cost', unit: 'usd', tier: 'derived', inputs: ['spend', 'impressions'], formula: 'spend / impressions × 1000', compute: (r) => { const d = div(r.spend, r.impressions); return d == null ? null : d * 1000; }, def: 'Cost to reach a thousand impressions.' },
  { key: 'cpc', label: 'CPC (cost / link click)', category: 'cost', unit: 'usd', tier: 'derived', inputs: ['spend', 'inline_link_clicks'], formula: 'spend / link clicks', compute: (r) => div(r.spend, r.inline_link_clicks), def: 'Cost per link click.' },
  { key: 'cpp', label: 'Cost per 1,000 reached (CPP)', category: 'cost', unit: 'usd', tier: 'derived', inputs: ['spend', 'reach'], formula: 'spend / reach × 1000', compute: (r) => { const d = div(r.spend, r.reach); return d == null ? null : d * 1000; }, def: 'Cost to reach a thousand unique people.' },
  { key: 'cost_per_reach', label: 'Cost per reach', category: 'cost', unit: 'usd4', tier: 'derived', inputs: ['spend', 'reach'], formula: 'spend / reach', compute: (r) => div(r.spend, r.reach), def: 'Cost per unique person reached.' },
  { key: 'cost_per_3s', label: 'Cost per 3-sec video play', category: 'cost', unit: 'usd', tier: 'derived', inputs: ['spend', 'video_3s'], formula: 'spend / 3-sec plays', compute: (r) => div(r.spend, r.video_3s), def: 'Cost per 3-second (hook) view.' },
  { key: 'cost_per_thruplay', label: 'Cost per ThruPlay', category: 'cost', unit: 'usd', tier: 'derived', inputs: ['spend', 'thruplays'], formula: 'spend / thruplays', compute: (r) => div(r.spend, r.thruplays), def: 'Cost per ThruPlay (15s or complete).' },
  { key: 'cost_per_purchase', label: 'Cost per purchase (CPA)', category: 'cost', unit: 'usd', tier: 'derived', inputs: ['spend', 'purchases'], formula: 'spend / purchases', compute: (r) => div(r.spend, r.purchases), def: 'Acquisition cost per purchase.' },
  { key: 'cost_per_result', label: 'Cost per Result', category: 'cost', unit: 'usd', tier: 'derived', inputs: ['spend', 'results'], formula: 'spend / results', compute: (r) => div(r.spend, r.results), def: 'Cost per objective result.' },
  { key: 'cost_per_unique_outbound_click', label: 'Cost per unique outbound click', category: 'cost', unit: 'usd', tier: 'derived', inputs: ['spend', 'unique_outbound_clicks'], formula: 'spend / unique outbound clicks', compute: (r) => div(r.spend, r.unique_outbound_clicks), def: 'Cost per unique outbound clicker.' },
  { key: 'cost_per_lpv', label: 'Cost per landing-page view', category: 'cost', unit: 'usd', tier: 'derived', inputs: ['spend', 'landing_page_views'], formula: 'spend / landing-page views', compute: (r) => div(r.spend, r.landing_page_views), def: 'Cost per fully-loaded landing-page view.' },

  // ── Click Engagement ──
  { key: 'clicks', label: 'Clicks (all)', category: 'click', unit: 'int', tier: 'base', inputs: ['clicks'], formula: 'clicks', compute: (r) => n(r.clicks), def: 'All clicks (incl. non-link).' },
  { key: 'link_clicks', label: 'Link clicks', category: 'click', unit: 'int', tier: 'base', inputs: ['inline_link_clicks'], formula: 'inline_link_clicks', compute: (r) => n(r.inline_link_clicks), def: 'Clicks on the ad link.' },
  { key: 'ctr', label: 'CTR (all clicks)', category: 'click', unit: 'pct', tier: 'derived', inputs: ['clicks', 'impressions'], formula: 'clicks / impressions × 100', compute: (r) => pct(r.clicks, r.impressions), def: 'Click-through rate on all clicks.' },
  { key: 'link_ctr', label: 'Link CTR', category: 'click', unit: 'pct', tier: 'derived', inputs: ['inline_link_clicks', 'impressions'], formula: 'link clicks / impressions × 100', compute: (r) => pct(r.inline_link_clicks, r.impressions), def: 'Click-through rate on link clicks (the honest CTR).' },
  { key: 'outbound_ctr', label: 'Outbound CTR', category: 'click', unit: 'pct', tier: 'derived', inputs: ['outbound_clicks', 'impressions'], formula: 'outbound clicks / impressions × 100', compute: (r) => pct(r.outbound_clicks, r.impressions), def: 'Clicks that left the platform, per impression.' },
  { key: 'unique_ctr', label: 'Unique link CTR', category: 'click', unit: 'pct', tier: 'derived', inputs: ['inline_link_clicks', 'reach'], formula: 'link clicks / reach × 100', compute: (r) => pct(r.inline_link_clicks, r.reach), def: 'Link clicks per unique person reached.' },
  { key: 'unique_outbound_clicks', label: 'Unique outbound clicks', category: 'click', unit: 'int', tier: 'base', inputs: ['unique_outbound_clicks'], formula: 'unique_outbound_clicks', compute: (r) => n(r.unique_outbound_clicks), def: 'Unique people who clicked out.' },

  // ── Video Engagement (the hook → hold → through funnel) ──
  { key: 'video_3s', label: '3-second video plays', category: 'video', unit: 'int', tier: 'base', inputs: ['video_3s'], formula: '3-sec plays', compute: (r) => n(r.video_3s), def: 'Plays of at least 3 seconds (the hook).' },
  { key: 'thruplays', label: 'ThruPlays', category: 'video', unit: 'int', tier: 'base', inputs: ['thruplays'], formula: 'thruplays', compute: (r) => n(r.thruplays), def: 'Plays to completion or 15s.' },
  { key: 'video_p25', label: 'Video plays 25%', category: 'video', unit: 'int', tier: 'base', inputs: ['video_p25'], formula: 'p25 watched', compute: (r) => n(r.video_p25), def: 'Reached 25% of the video.' },
  { key: 'video_p50', label: 'Video plays 50%', category: 'video', unit: 'int', tier: 'base', inputs: ['video_p50'], formula: 'p50 watched', compute: (r) => n(r.video_p50), def: 'Reached 50%.' },
  { key: 'video_p75', label: 'Video plays 75%', category: 'video', unit: 'int', tier: 'base', inputs: ['video_p75'], formula: 'p75 watched', compute: (r) => n(r.video_p75), def: 'Reached 75%.' },
  { key: 'video_p100', label: 'Video plays 100%', category: 'video', unit: 'int', tier: 'base', inputs: ['video_p100'], formula: 'p100 watched', compute: (r) => n(r.video_p100), def: 'Watched to the end.' },
  { key: 'hook_rate', label: 'Hook Rate', category: 'video', unit: 'pct', tier: 'derived', inputs: ['video_3s', 'impressions'], formula: '3-sec plays / impressions × 100', compute: (r) => pct(r.video_3s, r.impressions), def: 'Share of impressions that stopped to watch 3s. Creative-hook strength.' },
  // hold_rate is thruplays / 3-SEC PLAYS, not thruplays / impressions. It answers
  // "of the people the hook stopped, how many held?", which is the only reading
  // that pairs with hook_rate (3-sec plays / impressions) to decompose retention.
  // Divided by impressions it is a different metric entirely -- that one is
  // thruplay_rate, added below, so the old meaning is preserved under its correct
  // name. This key previously meant thruplays/impressions here while meaning
  // thruplays/video_3s in the Snowflake app, so the same label reported different
  // numbers on the two dashboards.
  { key: 'hold_rate', label: 'Hold Rate', category: 'video', unit: 'pct', tier: 'derived', inputs: ['thruplays', 'video_3s'], formula: 'thruplays / 3-sec plays × 100', compute: (r) => pct(r.thruplays, r.video_3s), def: 'Of those hooked (3-sec), how many held to ThruPlay. Mid-video retention.' },
  { key: 'thruplay_rate', label: 'ThruPlay Rate', category: 'video', unit: 'pct', tier: 'derived', inputs: ['thruplays', 'impressions'], formula: 'thruplays / impressions × 100', compute: (r) => pct(r.thruplays, r.impressions), def: 'Share of impressions that reached ThruPlay (15s/complete).' },
  { key: 'through_rate', label: 'Through Rate (completion)', category: 'video', unit: 'pct', tier: 'derived', inputs: ['video_p100', 'impressions'], formula: '100% plays / impressions × 100', compute: (r) => pct(r.video_p100, r.impressions), def: 'Share of impressions that watched to the end.' },
  // 'hook_to_hold' removed: it was thruplays / video_3s, i.e. exactly the corrected
  // hold_rate above. Two keys for one formula is how the two surfaces drifted apart.
  { key: 'completion_of_starts', label: 'Completion of starts', category: 'video', unit: 'pct', tier: 'derived', inputs: ['video_p100', 'video_3s'], formula: '100% plays / 3-sec plays × 100', compute: (r) => pct(r.video_p100, r.video_3s), def: 'Of viewers who started, how many finished.' },

  // ── Conversion & Value ──
  { key: 'purchases', label: 'Purchases', category: 'conversion', unit: 'int', tier: 'base', inputs: ['purchases'], formula: 'purchases', compute: (r) => n(r.purchases), def: 'Attributed purchases.' },
  { key: 'purchase_value', label: 'Purchase value', category: 'conversion', unit: 'usd', tier: 'base', inputs: ['purchase_value'], formula: 'conversion value', compute: (r) => n(r.purchase_value), def: 'Attributed revenue.' },
  { key: 'roas', label: 'ROAS', category: 'conversion', unit: 'ratio', tier: 'derived', inputs: ['purchase_value', 'spend'], formula: 'purchase value / spend', compute: (r) => div(r.purchase_value, r.spend), def: 'Return on ad spend.' },
  { key: 'cvr', label: 'Conversion rate (CVR)', category: 'conversion', unit: 'pct', tier: 'derived', inputs: ['purchases', 'inline_link_clicks'], formula: 'purchases / link clicks × 100', compute: (r) => pct(r.purchases, r.inline_link_clicks), def: 'Purchases per link click.' },
  { key: 'aov', label: 'AOV (attributed)', category: 'conversion', unit: 'usd', tier: 'derived', inputs: ['purchase_value', 'purchases'], formula: 'purchase value / purchases', compute: (r) => div(r.purchase_value, r.purchases), def: 'Average order value of attributed purchases.' },
  { key: 'results', label: 'Results', category: 'conversion', unit: 'int', tier: 'base', inputs: ['results'], formula: 'results (per objective)', compute: (r) => n(r.results), def: 'Result events as configured by the campaign objective.' },
  { key: 'add_to_cart', label: 'Adds to Cart', category: 'conversion', unit: 'int', tier: 'base', inputs: ['add_to_cart'], formula: 'add_to_cart', compute: (r) => n(r.add_to_cart), def: 'Attributed add-to-cart events.' },
  { key: 'cart_abandonment', label: 'Cart Abandonment Rate', category: 'conversion', unit: 'pct', tier: 'derived', inputs: ['purchases', 'add_to_cart'], formula: '(1 - purchases / adds to cart) × 100', compute: (r) => { const p = pct(r.purchases, r.add_to_cart); return p === null ? null : 100 - p; }, def: 'Share of carts that never purchased.' },
  // MER and nCAC are the two the owner reads first and the two this catalog was
  // missing. Both need a feed the ad platforms cannot supply on their own: MER is
  // deliberately attribution-proof, so it wants REALIZED revenue, and nCAC needs a
  // new-vs-returning split. Defined here so they are computed identically once the
  // feed lands, and reported 'unavailable' by accuracy() until then -- never guessed.
  { key: 'mer', label: 'MER (Marketing Efficiency Ratio)', category: 'conversion', unit: 'ratio', tier: 'derived', inputs: ['total_revenue', 'spend'], formula: 'total revenue / total ad spend', compute: (r) => div(r.total_revenue, r.spend), def: 'Blended, attribution-proof media efficiency. Needs realized revenue joined in.' },
  { key: 'ncac', label: 'nCAC (New-Customer CAC)', category: 'conversion', unit: 'usd', tier: 'derived', inputs: ['spend', 'net_new_customers'], formula: 'spend / net new customers', compute: (r) => div(r.spend, r.net_new_customers), def: 'Acquisition cost counting NEW customers only. Needs a new-customer feed.' },

  // ── Landing Page ──
  { key: 'landing_page_views', label: 'Landing-page views', category: 'landing', unit: 'int', tier: 'base', inputs: ['landing_page_views'], formula: 'landing_page_view actions', compute: (r) => n(r.landing_page_views), def: 'Fully-loaded landing-page views after the click.' },
  { key: 'lpv_rate', label: 'LP-view rate (load quality)', category: 'landing', unit: 'pct', tier: 'derived', inputs: ['landing_page_views', 'inline_link_clicks'], formula: 'landing-page views / link clicks × 100', compute: (r) => pct(r.landing_page_views, r.inline_link_clicks), def: 'Share of clicks that actually loaded the page. Low = slow page / drop-off.' },
  { key: 'click_to_lpv_dropoff', label: 'Click→LPV drop-off', category: 'landing', unit: 'pct', tier: 'derived', inputs: ['landing_page_views', 'inline_link_clicks'], formula: '100 − LP-view rate', compute: (r) => { const p = pct(r.landing_page_views, r.inline_link_clicks); return p == null ? null : 100 - p; }, def: 'Clicks lost before the page loaded.' },
  { key: 'lp_bounce_rate', label: 'LP bounce rate', category: 'landing', unit: 'pct', tier: 'derived', inputs: ['bounces', 'sessions'], formula: 'bounces / sessions × 100  (PageDeck)', compute: (r) => pct(r.bounces, r.sessions), def: 'Single-page sessions on the landing page (PageDeck/analytics).' },
  { key: 'lp_conversion_rate', label: 'LP conversion rate', category: 'landing', unit: 'pct', tier: 'derived', inputs: ['lp_conversions', 'sessions'], formula: 'LP conversions / sessions × 100  (PageDeck)', compute: (r) => pct(r.lp_conversions, r.sessions), def: 'Conversions per landing-page session.' },
  { key: 'ga4_sessions', label: 'GA4 Sessions', category: 'landing', unit: 'int', tier: 'base', inputs: ['ga4_sessions'], formula: 'ga4 sessions', compute: (r) => n(r.ga4_sessions), def: 'Sessions landed (GA4).' },
  { key: 'click_to_session_yield', label: 'Click-to-Session Yield', category: 'landing', unit: 'pct', tier: 'derived', inputs: ['ga4_sessions', 'outbound_clicks'], formula: 'GA4 sessions / outbound clicks × 100', compute: (r) => pct(r.ga4_sessions, r.outbound_clicks), def: 'Share of outbound clicks that became real sessions.' },
  { key: 'avg_time_on_page', label: 'Avg time on page', category: 'landing', unit: 'sec', tier: 'base', inputs: ['time_on_page'], formula: 'avg session duration (PageDeck)', compute: (r) => n(r.time_on_page), def: 'Average time on the landing page.' },

  // ── Experiment (A/B — PageDeck) ──
  { key: 'variant_lift', label: 'Variant lift', category: 'experiment', unit: 'pct', tier: 'derived', inputs: ['variant_rate', 'control_rate'], formula: '(variant − control) / control × 100', compute: (r) => { const v = n(r.variant_rate), c = n(r.control_rate); return (v == null || !c) ? null : (v - c) / c * 100; }, def: 'Relative lift of the variant over control.' },
  { key: 'confidence', label: 'Confidence', category: 'experiment', unit: 'pct', tier: 'base', inputs: ['confidence'], formula: 'statistical confidence (PageDeck)', compute: (r) => n(r.confidence), def: 'Probability the lift is real (>=95% to call).' },
  // ── Retail Media (Amazon Ads / marketplace) ────────────────────────────────
  // Base metrics as the Sponsored Products / Brands / Display report streams
  // deliver them. `cost` is Amazon's spend column; `attributed_*` are the
  // attribution windows Amazon reports against the click. Inputs use the REAL
  // report column names, so a metric whose column is absent renders
  // "unavailable — needs: X" instead of a fabricated figure.
  { key: 'rm_impressions', label: 'Impressions (retail)', category: 'retail', unit: 'int', tier: 'base', inputs: ['impressions'], formula: 'impressions (marketplace report)', compute: (r) => n(r.impressions), def: 'Times the marketplace ad was shown.' },
  { key: 'rm_clicks', label: 'Clicks (retail)', category: 'retail', unit: 'int', tier: 'base', inputs: ['clicks'], formula: 'clicks (marketplace report)', compute: (r) => n(r.clicks), def: 'Clicks on the marketplace ad.' },
  { key: 'rm_cost', label: 'Ad cost (retail spend)', category: 'retail', unit: 'usd', tier: 'base', inputs: ['cost'], formula: 'cost', compute: (r) => n(r.cost), def: 'Marketplace ad spend (Amazon reports this as cost, not spend).' },
  { key: 'rm_sales', label: 'Attributed sales', category: 'retail', unit: 'usd', tier: 'base', inputs: ['attributed_sales'], formula: 'attributed sales', compute: (r) => n(r.attributed_sales), def: 'Revenue attributed to the ad inside the attribution window.' },
  { key: 'rm_orders', label: 'Attributed orders', category: 'retail', unit: 'int', tier: 'base', inputs: ['attributed_orders'], formula: 'attributed orders', compute: (r) => n(r.attributed_orders), def: 'Orders attributed to the ad.' },
  { key: 'rm_units', label: 'Attributed units', category: 'retail', unit: 'int', tier: 'base', inputs: ['attributed_units'], formula: 'attributed units', compute: (r) => n(r.attributed_units), def: 'Units sold, attributed to the ad.' },
  { key: 'rm_ctr', label: 'CTR (retail)', category: 'retail', unit: 'pct', tier: 'derived', inputs: ['clicks', 'impressions'], formula: 'clicks / impressions x 100', compute: (r) => pct(r.clicks, r.impressions), def: 'Click-through rate on the marketplace placement.' },
  { key: 'rm_cpc', label: 'CPC (retail)', category: 'retail', unit: 'usd', tier: 'derived', inputs: ['cost', 'clicks'], formula: 'cost / clicks', compute: (r) => div(r.cost, r.clicks), def: 'Cost per marketplace click.' },
  { key: 'rm_cpm', label: 'CPM (retail)', category: 'retail', unit: 'usd', tier: 'derived', inputs: ['cost', 'impressions'], formula: 'cost / impressions x 1000', compute: (r) => { const d = div(r.cost, r.impressions); return d == null ? null : d * 1000; }, def: 'Cost per thousand marketplace impressions.' },
  { key: 'acos', label: 'ACOS (advertising cost of sales)', category: 'retail', unit: 'pct', tier: 'derived', inputs: ['cost', 'attributed_sales'], formula: 'ad cost / attributed sales x 100', compute: (r) => pct(r.cost, r.attributed_sales), def: 'The defining retail-media efficiency metric: share of attributed revenue consumed by ad spend. LOWER is better - the inverse of ROAS.' },
  { key: 'rm_roas', label: 'ROAS (retail)', category: 'retail', unit: 'ratio', tier: 'derived', inputs: ['attributed_sales', 'cost'], formula: 'attributed sales / ad cost', compute: (r) => div(r.attributed_sales, r.cost), def: 'Attributed revenue per unit of marketplace ad spend (the inverse of ACOS).' },
  { key: 'tacos', label: 'TACOS (total advertising cost of sales)', category: 'retail', unit: 'pct', tier: 'derived', inputs: ['cost', 'total_revenue'], formula: 'ad cost / TOTAL revenue x 100', compute: (r) => pct(r.cost, r.total_revenue), def: 'Ad cost against TOTAL (organic + paid) marketplace revenue - the health metric ACOS cannot show. Needs total revenue joined in.' },
  { key: 'rm_cvr', label: 'Conversion rate (retail)', category: 'retail', unit: 'pct', tier: 'derived', inputs: ['attributed_orders', 'clicks'], formula: 'attributed orders / clicks x 100', compute: (r) => pct(r.attributed_orders, r.clicks), def: 'Orders per marketplace click - the listing closing rate.' },
  { key: 'rm_cpa', label: 'Cost per order (retail)', category: 'retail', unit: 'usd', tier: 'derived', inputs: ['cost', 'attributed_orders'], formula: 'ad cost / attributed orders', compute: (r) => div(r.cost, r.attributed_orders), def: 'Acquisition cost per attributed marketplace order.' },
  { key: 'rm_aov', label: 'AOV (retail, attributed)', category: 'retail', unit: 'usd', tier: 'derived', inputs: ['attributed_sales', 'attributed_orders'], formula: 'attributed sales / attributed orders', compute: (r) => div(r.attributed_sales, r.attributed_orders), def: 'Average value of an attributed marketplace order.' },
  { key: 'rm_units_per_order', label: 'Units per order', category: 'retail', unit: 'ratio', tier: 'derived', inputs: ['attributed_units', 'attributed_orders'], formula: 'attributed units / attributed orders', compute: (r) => div(r.attributed_units, r.attributed_orders), def: 'Basket depth: how many units an attributed order carries. Above 1 means bundling is working.' },
  { key: 'rm_asp', label: 'Average selling price', category: 'retail', unit: 'usd', tier: 'derived', inputs: ['attributed_sales', 'attributed_units'], formula: 'attributed sales / attributed units', compute: (r) => div(r.attributed_sales, r.attributed_units), def: 'Revenue per unit sold - catches discount-driven volume.' },
  { key: 'rm_cost_per_unit', label: 'Ad cost per unit sold', category: 'retail', unit: 'usd', tier: 'derived', inputs: ['cost', 'attributed_units'], formula: 'ad cost / attributed units', compute: (r) => div(r.cost, r.attributed_units), def: 'What advertising adds to the cost of each unit moved.' },
  { key: 'breakeven_acos', label: 'Break-even ACOS', category: 'retail', unit: 'pct', tier: 'derived', inputs: ['gross_margin_pct'], formula: 'gross margin % (ACOS above this loses money)', compute: (r) => n(r.gross_margin_pct), def: 'The ACOS ceiling before a sale stops being profitable. Needs the product gross margin - never assumed.' },
  { key: 'acos_headroom', label: 'ACOS headroom vs break-even', category: 'retail', unit: 'pct', tier: 'derived', inputs: ['cost', 'attributed_sales', 'gross_margin_pct'], formula: 'break-even ACOS - actual ACOS', compute: (r) => { const a = pct(r.cost, r.attributed_sales), b = n(r.gross_margin_pct); return (a == null || b == null) ? null : b - a; }, def: 'Positive = room to bid up; negative = the campaign is buying unprofitable sales.' },
];

const BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]));

// Compute every metric for a normalised row; returns {key: value|null}.
function computeAll(r) {
  const out = {};
  for (const m of METRICS) { try { out[m.key] = m.compute(r || {}); } catch (_) { out[m.key] = null; } }
  return out;
}

// The catalog, grouped by category, for UIs and docs.
function catalog() {
  return {
    ok: true,
    categories: CATEGORIES.map((c) => ({
      ...c,
      metrics: METRICS.filter((m) => m.category === c.key).map((m) => ({
        key: m.key, label: m.label, unit: m.unit, tier: m.tier, formula: m.formula, inputs: m.inputs, definition: m.def,
      })),
    })),
    total_metrics: METRICS.length,
    note: 'Single source of truth. base = read directly from the platform; derived = computed by the formula shown. Every dashboard/analysis number uses these definitions.',
  };
}

/**
 * ACCURACY CALCULATOR. For a set of normalised rows, reports per metric:
 *   coverage  — % of rows where every input is present (non-null; non-zero denom)
 *   agreement — where the platform ALSO reports the metric directly (e.g. ctr,
 *               cpc, cpm, frequency), how closely our derived value matches it
 *               (100% = identical); flags drift so we trust the right source
 *   confidence — overall label: high / medium / low / unavailable
 * Never invents data: a metric with 0 coverage is 'unavailable', not 0.
 */
const SOURCED_EQUIVALENT = { // derived key -> platform-reported field to cross-check
  ctr: 'ctr', cpc: 'cpc', cpm: 'cpm', frequency: 'frequency', link_ctr: 'inline_link_click_ctr',
};
function accuracy(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const per = {};
  for (const m of METRICS) {
    let covered = 0, agreeSum = 0, agreeN = 0;
    for (const r of list) {
      const inputsOk = m.inputs.every((f) => n(r[f]) != null);
      if (inputsOk) covered += 1;
      const src = SOURCED_EQUIVALENT[m.key];
      if (src && n(r[src]) != null) {
        const derived = m.compute(r);
        const sourced = n(r[src]);
        if (derived != null && sourced) { agreeN += 1; agreeSum += Math.max(0, 1 - Math.abs(derived - sourced) / Math.abs(sourced)); }
      }
    }
    const coverage = list.length ? covered / list.length : 0;
    const agreement = agreeN ? agreeSum / agreeN : null;
    let confidence = 'unavailable';
    if (coverage >= 0.9 && (agreement == null || agreement >= 0.98)) confidence = 'high';
    else if (coverage >= 0.6) confidence = 'medium';
    else if (coverage > 0) confidence = 'low';
    per[m.key] = {
      coverage: Math.round(coverage * 1000) / 10,
      cross_checked: agreeN > 0,
      agreement_pct: agreement == null ? null : Math.round(agreement * 1000) / 10,
      confidence,
    };
  }
  const scored = Object.values(per);
  const avgCov = scored.length ? scored.reduce((s, x) => s + x.coverage, 0) / scored.length : 0;
  return {
    ok: true, rows: list.length,
    overall_coverage_pct: Math.round(avgCov * 10) / 10,
    high: scored.filter((x) => x.confidence === 'high').length,
    medium: scored.filter((x) => x.confidence === 'medium').length,
    low: scored.filter((x) => x.confidence === 'low').length,
    unavailable: scored.filter((x) => x.confidence === 'unavailable').length,
    per_metric: per,
    note: 'coverage = share of rows with all inputs present; agreement = match vs the platform-reported value where one exists (drift check). No metric is fabricated when inputs are missing.',
  };
}

module.exports = {
  CATEGORIES, METRICS, BY_KEY, catalog, computeAll, accuracy,
};
