#!/usr/bin/env node
'use strict';

/**
 * build-july-mailers.js — VAHDAM USA July automated mailer calendar.
 *
 * Runs the EXACT mailer-creation logic the automated mailer calendar uses
 * (api/_shared/lifecycle-mailer-build.js): every calendar slot produces the same
 * four variants, rendered by the SAME brand-compliant renderer
 * (calendar-trigger.js → helpers.renderTextVariant) and passed through the SAME
 * brand scrub + banned-phrase tripwire (scenario-model.js sanitizeBrand /
 * assertNoBanned):
 *
 *   text_a    Text          · framework A · style 'pure'
 *   text_b    Text          · framework B · style 'editorial'
 *   visual_a  Text + Visual · framework A · style 'visual' (real hero image)
 *   visual_b  Text + Visual · framework B · style 'visual' (real hero image)
 *
 * Copy is authored inline here (the live builder's single llm() copy call needs
 * provider keys that only exist on Vercel; offline we author brand-voice copy and
 * push it through the identical gates). Hero images come ONLY from the
 * origin-validated brand_assets snapshot (data/brand-assets/us.json) — never a
 * fabricated URL; a slot whose product is a placeholder renders image-free.
 *
 * Frameworks per slot are chosen with the repo's own CF.pickCopyFrameworkForCalendar
 * + a deterministic contrast pick, exactly like lifecycle-mailer-build.js.
 *
 * Outputs:
 *   mailers/usa-july/<date>_<segment>_<slug>_<variant>.html   (48 files: 12 slots x 4)
 *   data/calendar/usa-july-2026.json                          (manifest for the studio)
 *
 * Usage: node scripts/build-july-mailers.js
 */

const fs = require('fs');
const path = require('path');
const { helpers } = require('../api/_shared/calendar-trigger.js');
const SM = require('../api/_shared/scenario-model.js');
const CF = require('../api/_shared/copy-frameworks.js');
const { renderFlagship } = require('./lib/flagship-mailer.js');

// Real tasting notes (US catalog) → the flagship hero's italic tasting line.
const TASTING = {
  masala_chai_100ct: 'Spicy, Bold & Aromatic', masala_chai_12oz: 'Spicy, Bold & Aromatic',
  masala_chai_30ct: 'Spicy, Bold & Aromatic', turmeric_ginger_100ct: 'Spicy, Earthy & Warm',
  daily_assam_12oz: 'Bold, Malty & Strong', himalayan_green_12oz: 'Earthy, Smooth & Refreshing',
  english_breakfast_12oz: 'Rich, Malty & Robust', daily_darjeeling_2f_12oz: 'Crisp, Mellow & Toasty',
  assorted_sampler_10: '20 single-estate flavors in one box',
};

const ROOT = path.join(__dirname, '..');
const MARKET = 'US';
const STORE = 'https://www.vahdamteas.com';

// ── Products (real US catalog facts) keyed by sku_key ────────────────────────
const P = {
  masala_chai_100ct:        { name: "India's Original Masala Chai, 100 ct", price: '$22.49', handle: 'indias-original-masala-chai-tea-100-tea-bags' },
  masala_chai_12oz:         { name: "India's Original Masala Chai, 12 oz",  price: '$22.49', handle: 'indias-original-masala-chai-tea-loose-leaf-12oz' },
  masala_chai_30ct:         { name: "India's Original Masala Chai, 30 ct",  price: '$12.49', handle: 'indias-original-masala-chai-tea-30-tea-bags' },
  turmeric_ginger_100ct:    { name: 'Turmeric Ginger Herbal Tea, 100 ct',   price: '$17.49', handle: 'turmeric-ginger-herbal-tea-100-tea-bags' },
  daily_assam_12oz:         { name: 'Daily Assam Black Tea, 12 oz',         price: '$19.49', handle: 'daily-assam-black-tea-12oz' },
  himalayan_green_12oz:     { name: 'Himalayan Green Tea, 12 oz',           price: '$27.49', handle: 'himalayan-green-tea-loose-leaf-12oz' },
  english_breakfast_12oz:   { name: 'English Breakfast Black Tea, 12 oz',   price: '$17.99', handle: 'classic-english-breakfast-black-loose-leaf-tea-12oz' },
  daily_darjeeling_2f_12oz: { name: 'Castleton Darjeeling Second Flush',    price: '$20.99', handle: 'castleton-classic-darjeeling-second-flush-black-tea-dj-354' },
  assorted_sampler_10:      { name: 'Assorted Tea Bags Sampler, 20 Flavors', price: '$17.49', handle: 'assorted-tea-bags-sampler-2-x-20-variants' },
};

function loadAssets() {
  const p = path.join(ROOT, 'data', 'brand-assets', 'us.json');
  if (!fs.existsSync(p)) { console.error('Run scripts/seed-brand-assets.js first.'); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  const map = {};
  for (const r of rows) if (r.asset_type === 'product' || r.asset_type === 'logo') map[r.sku_key] = r;
  return map;
}

// Hero image URL from brand_assets ONLY (verified rows). null → image-free render.
function heroFor(assets, sku) {
  const a = assets[sku];
  if (!a || a.status !== 'verified' || !/^https?:\/\//.test(a.url)) return null;
  return a.url + (a.url.includes('?') ? '&' : '?') + 'width=800';
}

function ctaUrl({ sku, collection }) {
  if (collection) return `${STORE}/collections/${collection}`;
  const prod = P[sku];
  return prod ? `${STORE}/products/${prod.handle}` : STORE;
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── The July 2026 calendar (Scenario C: 2-3 emails/user/week, US market) ─────
// Each slot = one cohort send with a verified event tie-in and two authored copy
// directions (A = primary framework voice, B = a genuinely different angle).
const CALENDAR = [
  {
    date: '2026-07-02', segment: 'Champions', sku: 'masala_chai_100ct', collection: null,
    play: 'Reward, do not discount', event: null, product_type: 'tb',
    copyA: {
      subject: "The chai you keep coming back to", preview: "A quiet thank-you, from the cupping table to your cup.",
      headline: "For the ones who steep with us daily", subline: "Your everyday chai, hand-picked at origin and shipped garden-fresh.",
      blocks: [
        { heading: 'Where it begins', body: "India's Original Masala Chai starts on the same estates our founders walked, whole spices ground fresh, never dusted from a bag." },
        { heading: 'Made for your ritual', body: "One hundred cups of the blend you already reach for, so the morning pot never runs dry." },
      ], cta: 'Restock your chai',
    },
    copyB: {
      subject: "Your morning blend, restocked", preview: "The 100 count, so the pot is never empty.",
      headline: "The ritual, kept whole", subline: "Single-estate spice, ground fresh, steeped the way you like it.",
      blocks: [
        { heading: 'The everyday size', body: "One hundred pyramid bags of India's Original Masala Chai, crafted for the cup you return to without thinking." },
        { heading: 'Why it matters', body: "Heritage sourcing and honest spice, traced back to the hillside it grew on." },
      ], cta: 'Shop the 100 count',
    },
    reasoning: { who: 'Champions (top RFM: recent, frequent, high value).', what: 'Loyalty reward on the hero everyday SKU, no discount.', how: 'Reward-not-discount play; premium editorial voice; single CTA to the bestseller they already buy.', hypothesis: 'Recognition + effortless restock lifts repeat rate more than a markdown that trains discount-waiting.', expected: 'Higher repeat-purchase rate and AOV vs a discounted control.' },
  },
  {
    date: '2026-07-05', segment: 'Loyal', sku: 'daily_darjeeling_2f_12oz', collection: null,
    play: 'Editorial origin story', event: null, product_type: 'tb',
    copyA: {
      subject: "A second flush worth slowing down for", preview: "Castleton, muscatel, and the season that makes it.",
      headline: "The Darjeeling of high summer", subline: "Second-flush leaf from the Castleton estate, picked at its muscatel peak.",
      blocks: [
        { heading: 'The season in a cup', body: "Second flush is Darjeeling's high-summer harvest, when the leaf carries that unmistakable muscatel note, part stone-fruit, part honey." },
        { heading: 'Single-estate, traceable', body: "Grown, plucked and rolled on one hillside, so every cup tastes of exactly where it came from." },
      ], cta: 'Steep the estate',
    },
    copyB: {
      subject: "Muscatel, from one hillside", preview: "The Castleton second flush is here.",
      headline: "One estate, one summer, one cup", subline: "Hand-picked Castleton leaf at its muscatel best.",
      blocks: [
        { heading: 'Why second flush', body: "It is the harvest connoisseurs wait all year for, richer, rounder, quietly sweet." },
        { heading: 'Brewed at origin', body: "Fifty cups of traceable, single-estate Darjeeling to return to all season." },
      ], cta: 'Discover Castleton',
    },
    reasoning: { who: 'Loyal (frequent buyers, story-receptive).', what: 'Depth-first editorial on a premium single-estate.', how: 'Editorial tone over promo; origin narrative; PDP CTA.', hypothesis: 'Loyalists trade up on provenance storytelling, not price.', expected: 'Category expansion into premium loose-leaf; higher AOV.' },
  },
  {
    date: '2026-07-08', segment: 'New', sku: 'assorted_sampler_10', collection: 'samplers',
    play: 'Guide the second sip', event: null, product_type: 'tb',
    copyA: {
      subject: "Not sure what to steep next?", preview: "Twenty flavors, one easy way to find yours.",
      headline: "Find your everyday cup", subline: "Twenty single-estate flavors in one sampler, so the next favorite finds you.",
      blocks: [
        { heading: 'Start here', body: "Forty pyramid bags across twenty blends, black, green, chai and herbal, so you can taste your way to the one you reach for daily." },
        { heading: 'How to brew', body: "Fresh water off the boil for black and chai, a minute cooler for green, and steep three to five minutes. That is the whole ritual." },
      ], cta: 'Try the sampler',
    },
    copyB: {
      subject: "Twenty teas, one sampler", preview: "The easiest way to find your blend.",
      headline: "Taste your way in", subline: "One box, twenty single-estate flavors to explore.",
      blocks: [
        { heading: 'The explorer set', body: "Black, green, chai and herbal, forty pyramid bags to help a new favorite surface." },
        { heading: 'Then go deeper', body: "Loved one? Its full-size tin is a click away." },
      ], cta: 'Shop samplers',
    },
    reasoning: { who: 'New (first-order, low familiarity).', what: 'Second-sip education via the sampler.', how: 'Teach brewing + suggest breadth; collection CTA to samplers.', hypothesis: 'Guided discovery raises second-order rate for new buyers.', expected: 'Higher new-to-repeat conversion within 30 days.' },
  },
  {
    date: '2026-07-11', segment: 'Promising', sku: 'himalayan_green_12oz', collection: null,
    play: 'Show the next step', event: null, product_type: 'tb',
    copyA: {
      subject: "The green tea that tastes like the hills", preview: "High-altitude leaf, clean and bright.",
      headline: "A brighter afternoon cup", subline: "High-grown Himalayan green, light-bodied and clean, for the mid-day reset.",
      blocks: [
        { heading: 'Grown high, picked young', body: "Our Himalayan Green comes from high-altitude gardens where cool air slows the leaf and keeps it delicate." },
        { heading: 'Your next ritual', body: "Loose-leaf, one hundred and seventy cups, an easy step from the bag into a fuller pour." },
      ], cta: 'Steep green',
    },
    copyB: {
      subject: "Bright, clean, high-grown green", preview: "From the Himalayan gardens to your afternoon.",
      headline: "The afternoon reset", subline: "Delicate high-altitude green, loose-leaf and generous.",
      blocks: [
        { heading: 'Why high-altitude', body: "Cool mountain air makes for a lighter, cleaner cup with none of the bitterness." },
        { heading: 'Made to return to', body: "One hundred and seventy cups of it, so the ritual has room to grow." },
      ], cta: 'Shop green tea',
    },
    reasoning: { who: 'Promising (building frequency, one category).', what: 'Continuity into a second category (green).', how: 'Show the next step in the ritual; PDP CTA.', hypothesis: 'Cross-category nudges deepen habit and frequency.', expected: 'More multi-category buyers; higher 60-day frequency.' },
  },
  {
    date: '2026-07-14', segment: 'Need-Attention', sku: 'turmeric_ginger_100ct', collection: null,
    play: 'Soft re-engagement', event: 'National Wellness Month (Aug) ramp', product_type: 'tb',
    copyA: {
      subject: "A warmer, steadier cup for August", preview: "Turmeric and ginger, ahead of Wellness Month.",
      headline: "Steady the day, one cup at a time", subline: "Turmeric and ginger, a warming, caffeine-free ritual as Wellness Month nears.",
      blocks: [
        { heading: 'A gentler ritual', body: "Golden turmeric and bright ginger make a warming, caffeine-free cup for the slower end of the day." },
        { heading: 'Ahead of August', body: "As National Wellness Month approaches, it is a calm, uncomplicated way to look after the everyday." },
      ], cta: 'Warm up your ritual',
    },
    copyB: {
      subject: "Golden, warming, caffeine-free", preview: "Turmeric ginger, for a calmer evening.",
      headline: "The quiet evening cup", subline: "Turmeric and ginger, warming and caffeine-free.",
      blocks: [
        { heading: 'Balance, brewed', body: "A hundred bags of golden turmeric and ginger for an unhurried, warming ritual." },
        { heading: 'Into Wellness Month', body: "A simple, steady habit to carry you into August." },
      ], cta: 'Shop turmeric ginger',
    },
    reasoning: { who: 'Need-Attention (cooling engagement, no discount yet).', what: 'Soft re-engagement on a comforting herbal, tied to Aug Wellness Month.', how: 'Warm, no-pressure voice; no aggressive offer; PDP CTA.', hypothesis: 'A gentle seasonal reason to return re-warms lapsing engagers without training discounts.', expected: 'Recovered open/click and re-engagement before deeper lapse.' },
  },
  {
    date: '2026-07-16', segment: 'Loyal', sku: 'english_breakfast_12oz', collection: null,
    play: 'Match-day ritual', event: 'FIFA World Cup Final, Jul 19 @ MetLife (3pm ET)', product_type: 'tb',
    copyA: {
      subject: "A proper cup for the big final", preview: "English Breakfast, brewed for Sunday's match.",
      headline: "Brew for the final whistle", subline: "A brisk, full-bodied English Breakfast for Sunday's World Cup Final.",
      blocks: [
        { heading: 'Made for the moment', body: "When the final kicks off at MetLife this Sunday afternoon, a strong, malty English Breakfast is the cup that fits the couch and the crowd." },
        { heading: 'Brisk and full-bodied', body: "Loose-leaf, one hundred and seventy cups, enough for a full room of extra time." },
      ], cta: 'Brew for the match',
    },
    copyB: {
      subject: "Sunday's final, one strong pot", preview: "English Breakfast for the World Cup Final.",
      headline: "The match-day pot", subline: "Brisk, malty, and ready before kickoff.",
      blocks: [
        { heading: 'Kickoff at MetLife', body: "A full-bodied classic to see you through Sunday afternoon's final." },
        { heading: 'Enough for the room', body: "One hundred and seventy cups of loose-leaf English Breakfast." },
      ], cta: 'Shop English Breakfast',
    },
    reasoning: { who: 'Loyal (high-engagement, event-responsive).', what: 'Timely tie-in to the Jul 19 World Cup Final at MetLife.', how: 'Cultural-moment weave, kept light; PDP CTA.', hypothesis: 'A relevant real-world moment lifts open + click for engaged cohorts.', expected: 'Above-baseline engagement on the match-day send.' },
  },
  {
    date: '2026-07-18', segment: 'Champions', sku: 'masala_chai_12oz', collection: null,
    play: 'Event tie-in', event: 'National Ice Cream Day, Jul 19', product_type: 'tb',
    copyA: {
      subject: "Chai, over ice, with a scoop", preview: "An iced-chai affogato for Ice Cream Day.",
      headline: "Turn your chai into dessert", subline: "Brew it strong, pour it over ice cream, this Sunday is Ice Cream Day.",
      blocks: [
        { heading: 'The two-minute affogato', body: "Steep India's Original Masala Chai double-strength, cool it, then pour over a scoop of vanilla. Spice meets cream, the easiest dessert you will make all July." },
        { heading: 'Loose-leaf, your way', body: "Twelve ounces of loose chai, one hundred and seventy cups, hot pot or iced pour, whichever the day calls for." },
      ], cta: 'Make iced chai',
    },
    copyB: {
      subject: "An iced-chai treat for Sunday", preview: "Masala chai + a scoop = Ice Cream Day, done.",
      headline: "Chai, iced and indulgent", subline: "Strong-brewed masala chai over a cold scoop.",
      blocks: [
        { heading: 'Spice over cream', body: "Double-strength chai poured over vanilla, a two-minute affogato for National Ice Cream Day." },
        { heading: 'The loose-leaf tin', body: "Twelve ounces of India's Original, for pots hot and iced." },
      ], cta: 'Shop loose chai',
    },
    reasoning: { who: 'Champions (playful, high-affinity).', what: 'Recipe-led tie-in to Jul 19 National Ice Cream Day.', how: 'Usage-occasion content (iced-chai affogato); PDP CTA to loose-leaf.', hypothesis: 'Novel summer usage occasions drive incremental purchase from best customers.', expected: 'Incremental loose-leaf units + strong click on the recipe.' },
  },
  {
    date: '2026-07-19', segment: 'New', sku: 'assorted_sampler_10', collection: 'samplers',
    play: 'Iced-tea how-to', event: 'National Ice Cream Day, Jul 19', product_type: 'tb',
    copyA: {
      subject: "Your first pitcher of iced tea", preview: "Twenty flavors to brew cold this week.",
      headline: "Cold-brew your way in", subline: "Twenty single-estate flavors, an easy start to summer iced tea.",
      blocks: [
        { heading: 'The no-fuss method', body: "Drop four pyramid bags into a pitcher of cold water, refrigerate overnight, and pour over ice. No bitterness, no boiling." },
        { heading: 'Twenty to try', body: "Green, black and herbal in one sampler, so your first pitcher is also a tasting." },
      ], cta: 'Start cold-brewing',
    },
    copyB: {
      subject: "Iced tea, twenty ways", preview: "One sampler, a summer of cold brew.",
      headline: "A pitcher for the heat", subline: "Cold-brew any of twenty flavors overnight.",
      blocks: [
        { heading: 'Overnight and easy', body: "Four bags, cold water, a night in the fridge, iced tea without the work." },
        { heading: 'Find the one', body: "Twenty single-estate blends to pour over ice all summer." },
      ], cta: 'Shop samplers',
    },
    reasoning: { who: 'New (summer entry point).', what: 'Iced-tea/cold-brew education tied to the Jul 19 summer moment.', how: 'How-to content lowers the trial barrier; samplers collection CTA.', hypothesis: 'Seasonal usage education raises trial and second order for new buyers.', expected: 'Higher sampler attach + repeat within 30 days.' },
  },
  {
    date: '2026-07-22', segment: 'About-to-Sleep', sku: 'daily_assam_12oz', collection: 'best-sellers',
    play: 'Gentle 3-pick winback', event: null, product_type: 'tb',
    copyA: {
      subject: "Still your kind of cup?", preview: "Three easy ways back to a good brew.",
      headline: "A good cup is still waiting", subline: "Daily Assam and two more bestsellers, in case the pot went quiet.",
      blocks: [
        { heading: 'Where you left off', body: "Daily Assam is the brisk, dependable black tea that started many mornings, still hand-picked, still garden-fresh." },
        { heading: 'Or pick from the shelf', body: "If you fancy a change, our bestsellers are a short, easy list to choose from." },
      ], cta: 'See the bestsellers',
    },
    copyB: {
      subject: "The pot's been quiet lately", preview: "A brisk Assam, whenever you're ready.",
      headline: "Come back to a brisk cup", subline: "Daily Assam, dependable and garden-fresh.",
      blocks: [
        { heading: 'An easy return', body: "The everyday black tea that just works, no fuss, no pressure." },
        { heading: 'Three to choose from', body: "A short bestseller list if you would rather try something new." },
      ], cta: 'Shop bestsellers',
    },
    reasoning: { who: 'About-to-Sleep (declining recency).', what: 'Gentle winback with a curated 3-pick, question subject.', how: 'Soft reminder, no aggressive discount; bestsellers collection CTA.', hypothesis: 'A low-pressure, question-led nudge re-activates more than a hard offer at this stage.', expected: 'Reactivation lift without margin erosion.' },
  },
  {
    date: '2026-07-25', segment: 'Promising', sku: 'masala_chai_30ct', collection: 'gifts',
    play: 'Gift for parents', event: "Parents' Day, Jul 26", product_type: 'tb',
    copyA: {
      subject: "A small, warm thank-you", preview: "For Parents' Day, the chai they'll actually use.",
      headline: "Say it with their morning cup", subline: "India's Original Masala Chai, a warm and useful Parents' Day gift.",
      blocks: [
        { heading: 'The gift that gets used', body: "Thirty bags of the chai they will reach for every morning, hand-picked spice, no clutter, all ritual." },
        { heading: 'Or make it a set', body: "Pair it from our gift collection for something that arrives ready to give." },
      ], cta: 'Shop gifts',
    },
    copyB: {
      subject: "For the parents who steep", preview: "A Parents' Day cup worth gifting.",
      headline: "A warm cup, wrapped up", subline: "The everyday chai, made giftable for Sunday.",
      blocks: [
        { heading: 'Simple and warm', body: "Thirty bags of India's Original Masala Chai, the kind of gift that becomes a daily habit." },
        { heading: 'Ready to give', body: "Build it into a set from our gifts collection." },
      ], cta: 'See gift sets',
    },
    reasoning: { who: 'Promising (gifting occasion widens basket).', what: "Parents' Day (Jul 26) gift angle on an accessible SKU.", how: 'Occasion-led; gifts collection CTA; low price barrier (30 ct).', hypothesis: 'A concrete gifting occasion lifts conversion for mid-tier engagers.', expected: 'Higher order rate + gift-set attach around Jul 26.' },
  },
  {
    date: '2026-07-29', segment: 'At-Risk', sku: 'turmeric_ginger_100ct', collection: null,
    play: 'Share a cup + one fair offer', event: 'International Day of Friendship, Jul 30', product_type: 'tb',
    copyA: {
      subject: "Share a cup this week", preview: "For Friendship Day, a warm, easy gesture.",
      headline: "A cup is a small kindness", subline: "Turmeric ginger, the warming, caffeine-free cup worth sharing.",
      blocks: [
        { heading: 'Brew one for two', body: "International Day of Friendship lands July 30. A pot of warming turmeric ginger is the simplest way to slow down with someone." },
        { heading: 'Warming, caffeine-free', body: "One hundred bags of golden turmeric and bright ginger, easy to keep on hand." },
      ], cta: 'Steep and share',
    },
    copyB: {
      subject: "One warm pot, shared", preview: "Turmeric ginger for Friendship Day.",
      headline: "Slow down, together", subline: "A caffeine-free cup made for company.",
      blocks: [
        { heading: 'A quiet gesture', body: "Warming turmeric ginger, brewed for two, for July 30's Day of Friendship." },
        { heading: 'Keep it on hand', body: "A hundred bags, so there is always a pot to share." },
      ], cta: 'Shop turmeric ginger',
    },
    reasoning: { who: 'At-Risk (one personal note, one fair offer, single CTA).', what: 'Friendship Day (Jul 30) share-a-cup angle on a comforting herbal.', how: 'Warm single-CTA note; emotional reason to return over discount.', hypothesis: 'A human, shareable reason re-engages at-risk customers more durably than price.', expected: 'Reactivation on an emotional hook; protected margin.' },
  },
  {
    date: '2026-07-31', segment: 'Loyal', sku: 'himalayan_green_12oz', collection: null,
    play: 'Restore ritual', event: 'National Wellness Month (Aug) ramp', product_type: 'tb',
    copyA: {
      subject: "Begin August a little slower", preview: "A clean green cup to start the month.",
      headline: "A calmer start to the month", subline: "High-grown Himalayan green, the clean cup to open Wellness Month.",
      blocks: [
        { heading: 'A month of small rituals', body: "As August and National Wellness Month begin, a bright, high-altitude green is a simple daily reset worth keeping." },
        { heading: 'High-grown, clean', body: "Loose-leaf Himalayan green, one hundred and seventy cups, delicate and unhurried." },
      ], cta: 'Steep to restore',
    },
    copyB: {
      subject: "A clean cup for August", preview: "Himalayan green, to open Wellness Month.",
      headline: "Restore, one cup at a time", subline: "Bright, high-altitude green for the new month.",
      blocks: [
        { heading: 'Ease in', body: "A light, clean green to start August's small daily rituals." },
        { heading: 'Generous and gentle', body: "One hundred and seventy loose-leaf cups to carry through the month." },
      ], cta: 'Shop green tea',
    },
    reasoning: { who: 'Loyal (habit-reinforcement into a new season).', what: 'Wellness Month (Aug) ramp on a clean daily green.', how: 'Ritual-continuity voice; PDP CTA; softest wellness register only.', hypothesis: 'Framing a new-month reset sustains loyal frequency into August.', expected: 'Sustained repeat rate through the Aug ramp.' },
  },
];

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Sanitize a full copy object through the shared brand scrub, then tripwire.
function clean(copy, where) {
  const c = {
    subject: SM.sanitizeBrand(copy.subject),
    preview: SM.sanitizeBrand(copy.preview),
    headline: SM.sanitizeBrand(copy.headline),
    subline: SM.sanitizeBrand(copy.subline),
    cta: SM.sanitizeBrand(copy.cta),
    blocks: (copy.blocks || []).map((b) => ({ heading: SM.sanitizeBrand(b.heading), body: SM.sanitizeBrand(b.body) })),
  };
  const flat = [c.subject, c.preview, c.headline, c.subline, c.cta].concat(c.blocks.map((b) => `${b.heading} ${b.body}`)).join(' ');
  SM.assertNoBanned(flat, where);
  return c;
}

// Build the four variants for a slot — the automated-calendar 4-variant STRUCTURE
// (2 Text + 2 Text+Visual, framework A/B) rendered in the flagship design system.
// Copy still passes through the shared sanitizeBrand/assertNoBanned gates.
function buildVariants(slot, assets) {
  const seed = `${slot.date}_${slot.segment}`;
  const fwA = CF.pickCopyFrameworkForCalendar({ content_type: 'lifecycle', segment: slot.segment, seed });
  const others = Object.keys(CF.COPY_FRAMEWORKS).filter((k) => k !== fwA.key);
  const fwB = CF.frameworkByKey(others[CF.stableIndex(`${seed}|b`, others.length)]) || fwA;

  const SA = clean(slot.copyA, `${seed}:a`);
  const SB = clean(slot.copyB, `${seed}:b`);
  const url = ctaUrl(slot);
  const hero = heroFor(assets, slot.sku);
  const prod = P[slot.sku] || { name: slot.sku };
  const logoUrl = (assets.logo && assets.logo.status === 'verified') ? assets.logo.url + '&width=310' : undefined;
  const tasting = SM.sanitizeBrand(TASTING[slot.sku] || '');

  // colorway per variant (matches the reference's Forest/Midnight/Daylight system);
  // withImage true only for the Text + Visual pair (and only if a verified hero exists).
  const flagship = (S, { colorway, withImage }) => renderFlagship({
    colorway, withImage: withImage && !!hero, market: MARKET,
    subject: S.subject, preheader: S.preview,
    eyebrow: slot.play, productName: prod.name, tastingLine: tasting, price: prod.price,
    ctaText: S.cta, ctaUrl: url, heroImageUrl: hero, logoUrl,
    headline: S.headline, subline: S.subline, bodyBlocks: S.blocks,
  });

  return [
    { key: 'text_a',   type: 'Text',          label: `Text · ${fwA.name}`,          framework: fwA.key, copy: SA, image: null, html: flagship(SA, { colorway: 'forest',   withImage: false }) },
    { key: 'text_b',   type: 'Text',          label: `Text · ${fwB.name}`,          framework: fwB.key, copy: SB, image: null, html: flagship(SB, { colorway: 'midnight', withImage: false }) },
    { key: 'visual_a', type: 'Text + Visual', label: `Text + Visual · ${fwA.name}`, framework: fwA.key, copy: SA, image: hero, html: flagship(SA, { colorway: 'forest',   withImage: true }) },
    { key: 'visual_b', type: 'Text + Visual', label: `Text + Visual · ${fwB.name}`, framework: fwB.key, copy: SB, image: hero, html: flagship(SB, { colorway: 'daylight', withImage: true }) },
  ];
}

function main() {
  const assets = loadAssets();
  const outDir = path.join(ROOT, 'mailers', 'usa-july');
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = { market: MARKET, month: '2026-07', scenario: 'C', generated_from: 'brand_assets (origin-validated)', store: STORE, slots: [] };
  let fileCount = 0;

  for (const slot of CALENDAR) {
    const variants = buildVariants(slot, assets);
    const prod = P[slot.sku] || { name: slot.sku, price: null, handle: null };
    const baseSlug = `${slot.date}_${slugify(slot.segment)}_${slugify(prod.name).slice(0, 40)}`;
    const files = {};
    for (const v of variants) {
      const fname = `${baseSlug}_${v.key}.html`;
      fs.writeFileSync(path.join(outDir, fname), v.html);
      files[v.key] = `mailers/usa-july/${fname}`;
      fileCount++;
    }
    manifest.slots.push({
      date: slot.date, segment: slot.segment, play: slot.play, event: slot.event,
      sku_key: slot.sku, product: prod.name, price: prod.price, cta_url: ctaUrl(slot),
      hero_asset: assets[slot.sku] ? { url: (assets[slot.sku].url || null), status: assets[slot.sku].status, origin_validated: assets[slot.sku].origin_validated } : { status: 'placeholder', origin_validated: false },
      reasoning: slot.reasoning,
      variants: variants.map((v) => ({ key: v.key, type: v.type, label: v.label, framework: v.framework, subject: v.copy.subject, preview: v.copy.preview, file: files[v.key], has_image: !!v.image })),
    });
  }

  const calDir = path.join(ROOT, 'data', 'calendar');
  fs.mkdirSync(calDir, { recursive: true });
  fs.writeFileSync(path.join(calDir, 'usa-july-2026.json'), JSON.stringify(manifest, null, 2));

  const withImg = manifest.slots.filter((s) => s.hero_asset.status === 'verified').length;
  console.log(`✓ ${CALENDAR.length} slots · ${fileCount} mailer files (4 variants each) → mailers/usa-july/`);
  console.log(`  ${withImg}/${CALENDAR.length} slots use a verified hero image; the rest render image-free (no fabricated URLs).`);
  console.log('✓ wrote data/calendar/usa-july-2026.json');
}

main();
