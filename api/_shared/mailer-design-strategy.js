'use strict';

/**
 * Per-slot mailer DESIGN strategy — so every mailer gets its own independent,
 * relevant layout instead of one repeated template.
 *
 * Each slot is matched to an archetype drawn from how top D2C creators /
 * influencers actually structure high-performing email content:
 *
 *   founder-note        Founder / creator authenticity — a personal letter, no
 *                       hard sell. (post-purchase, nurture, thank-you)
 *   ugc-testimonial     A wall of real customer voices leads. (winback,
 *                       at-risk, non-engagers — proof rebuilds trust)
 *   ritual-tutorial     Day-in-the-life "how I actually use it" steps first.
 *                       (new subscriber, activation, first-purchase)
 *   editorial-lookbook  Aspirational, photo-led, minimal copy. (VIP,
 *                       single-estate, prestige)
 *   gift-guide          A curated gift-guide grid leads. (gifting, high-AOV)
 *   comparison-discovery Honest "why this vs that" + try-it framing.
 *                       (discovery, sampler, cross-sell)
 *   hero-spotlight      One hero product, big close-up. (affinity default)
 *
 * The archetype drives BOTH the section ORDER in the mailer (so the design is
 * genuinely different) and an influencerAngle line injected into the copy
 * prompt (so the words match the format). Deterministic: the same slot always
 * gets the same design, and a per-slot rotation seed keeps a run of similar
 * cohorts from all looking identical.
 */

// Ordered, most-specific-first. `order` lists the mailer body sections in the
// sequence this archetype renders them (header/footer are always fixed).
const ARCHETYPES = {
  'founder-note': {
    label: 'Founder note',
    hero: 'founder',
    influencerAngle: 'Write as a warm, first-person note from the VAHDAM founder to one person. No hard sell. Creator-authenticity voice: honest, specific, a small behind-the-origin detail. The story field should read like a personal letter and end with a signature line (name, role).',
    order: ['founderNote', 'productGrid', 'testimonials'],
  },
  'ugc-testimonial': {
    label: 'Customer-voice wall',
    hero: 'green',
    influencerAngle: 'Lead with social proof, the way a creator reposts real customer stories. Testimonials must read as genuine tiny stories from named people, not review blurbs. Copy earns back a lapsed reader by showing other real people came back.',
    order: ['heroGreen', 'testimonials', 'productGrid'],
  },
  'ritual-tutorial': {
    label: 'Day-in-the-life ritual',
    hero: 'editorial',
    influencerAngle: 'Frame it as a creator tutorial / day-in-the-life: "here is exactly how I make it part of my morning". The mechanism steps are the how-to. Approachable, first-time-friendly, zero jargon.',
    order: ['heroEditorial', 'steps', 'productGrid'],
  },
  'editorial-lookbook': {
    label: 'Editorial lookbook',
    hero: 'editorial',
    influencerAngle: 'Aspirational editorial voice, like a creator lookbook. Fewer words, more atmosphere. Sensory and restrained; let the origin and craft carry it. No discount-led urgency.',
    order: ['heroEditorial', 'bodyStory', 'productGrid'],
  },
  'gift-guide': {
    label: 'Curated gift guide',
    hero: 'green',
    influencerAngle: 'Frame as a curated gift-guide roundup, the way creators post "my picks for ___". Each product is a considered recommendation with a one-line reason it makes a great gift.',
    order: ['heroGreen', 'productGrid', 'testimonials'],
  },
  'comparison-discovery': {
    label: 'Honest comparison',
    hero: 'green',
    influencerAngle: 'Honest "here is why this is different, try it for yourself" discovery voice, like a creator doing a genuine comparison. Lower the risk of trying something new; make the first step tiny.',
    order: ['heroGreen', 'bodyStory', 'productGrid'],
  },
  'hero-spotlight': {
    label: 'Hero spotlight',
    hero: 'editorial',
    influencerAngle: 'Single-product hero spotlight, a big close-up the way a creator features one favourite. All attention on one blend: its origin, its taste, the moment it belongs to.',
    order: ['heroEditorial', 'productGrid', 'testimonials'],
  },
};

const DEFAULT_KEY = 'hero-spotlight';

// Deterministic hash so the same slot always resolves to the same design.
function stableIndex(str, n) {
  if (n <= 1) return 0;
  let h = 0; const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

// Which archetypes SUIT a slot's intent, best fit first.
//
// This used to return a single key per intent, and that was the whole bug: a
// cohort's objective does not change from one send to the next, so every mailer
// to Loyalists resolved to editorial-lookbook and every winback to
// ugc-testimonial - forever. Measured over a 90-day x 2-market x 6-cohort
// calendar, the mailer repeated its design back-to-back 100% of the time, with
// 1056 three-in-a-rows. Only the `affinity` branch ever rotated.
//
// Every member of a set is defensible for that intent (a lapsed reader can be
// earned back by customer voice, by an honest comparison that lowers the risk of
// re-trying, or by a personal founder note), so rotating inside the set buys
// variety without making the design inappropriate. The caller rotates; this
// function only says what is allowed.
function archetypeSetFor(slot = {}) {
  const s = [slot.theme, slot.angle, slot.objective, slot.festival, slot.cohort_name,
    slot.cohort && (slot.cohort.name || slot.cohort.key), slot.cohort_id]
    .filter(Boolean).join(' ').toLowerCase();

  if (/gift|gifting|high.?aov/.test(s)) return ['gift-guide', 'editorial-lookbook', 'hero-spotlight'];
  if (/winback|win.?back|lapsed|at.?risk|non.?engager|dormant|churn/.test(s)) return ['ugc-testimonial', 'comparison-discovery', 'founder-note'];
  if (/new sub|first.?purchase|activation|non.?buyer|welcome|onboard/.test(s)) return ['ritual-tutorial', 'comparison-discovery', 'founder-note'];
  if (/vip|champion|single.?estate|prestige|connoisseur|premium/.test(s)) return ['editorial-lookbook', 'hero-spotlight', 'founder-note'];
  if (/post.?purchase|nurture|thank|loyal|repeat|subscribe|replenish/.test(s)) return ['founder-note', 'ritual-tutorial', 'editorial-lookbook'];
  if (/browse|discovery|sampler|variety|undecided|cross.?sell|cross.?category/.test(s)) return ['comparison-discovery', 'ritual-tutorial', 'hero-spotlight'];
  if (/affinity|black|green|chai|wellness|herbal|iced|summer/.test(s)) return ['hero-spotlight', 'ritual-tutorial', 'editorial-lookbook'];
  return [DEFAULT_KEY, 'editorial-lookbook', 'ritual-tutorial'];
}

// The single key for a slot: its suitable set, rotated by where the slot sits in
// its cohort's sequence. Rotation lives in asset-engines so there is one
// rotation algorithm for every asset type, not a private copy here.
function archetypeKeyFor(slot = {}) {
  const set = archetypeSetFor(slot).filter((k) => ARCHETYPES[k]);
  if (!set.length) return DEFAULT_KEY;
  try {
    const picked = require('./asset-engines.js').rotate(set, slot, 'mailer-archetype');
    if (picked && ARCHETYPES[picked]) return picked;
  } catch (_) { /* fall through to the stable, non-rotating choice */ }
  return set[stableIndex(slot.id || slot.date || '', set.length)];
}

function strategyFor(slot = {}) {
  const key = archetypeKeyFor(slot);
  const a = ARCHETYPES[key] || ARCHETYPES[DEFAULT_KEY];
  return { key, ...a };
}

module.exports = { strategyFor, archetypeKeyFor, archetypeSetFor, ARCHETYPES, DEFAULT_KEY };
