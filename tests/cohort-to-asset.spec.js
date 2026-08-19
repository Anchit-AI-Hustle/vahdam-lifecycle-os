const { test, expect } = require('@playwright/test');
const path = require('path');

// The chain the brain is supposed to run:
//
//   analysis -> cohort on the slot -> strategy brief -> copy -> asset design
//
// Every link must actually carry the cohort, or a "winback" slot and a "new
// subscriber" slot produce the same asset with a different label on it. That
// failure is invisible in review: both look finished, both are on brand, and
// nothing in the output says the targeting was dropped two steps earlier.

const ROOT = path.join(__dirname, '..');
const AE = require(path.join(ROOT, 'api', '_shared', 'asset-engines.js'));
const CF = require(path.join(ROOT, 'api', '_shared', 'copy-frameworks.js'));
const SB = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

// Every assertion below RUNS the real function and reads what it produced.
// Grepping the source for `entry.cohort` proves only that the characters are
// present in the file; it cannot prove the cohort survives into the string the
// model is actually sent, which is the thing that matters.
const entry = (cohort, objective, over = {}) => ({
  id: `cal_2026-08-22_uk_${cohort}`, date: '2026-08-22', market: 'UK',
  cohort: { key: cohort, name: cohort, size: 12400 }, objective,
  heroProduct: { title: 'Turmeric Chai', category: 'chai', handle: 'turmeric-chai', price: 24 },
  rationale: 'lapsed 120+ days, previously bought chai', ...over,
});

// ── The slot identity includes the cohort ───────────────────────────────────
test('two cohorts on the same day are two distinct slots, not one', () => {
  // stableId is (date, market, cohort). If the cohort were dropped, the second
  // cohort's send would overwrite the first and the day would silently ship one
  // asset instead of two.
  const a = SB.stableId('2026-08-22', 'UK', 'Winback');
  const b = SB.stableId('2026-08-22', 'UK', 'New subscribers');
  expect(a).not.toBe(b);
  expect(a).toContain('winback');
});

// ── The cohort reaches every generation stage ───────────────────────────────
test('the strategy brief the model is sent names the cohort and its size', () => {
  const p = SB.strategyPrompt(entry('Winback lapsed buyers', 'winback lapsed buyers'));
  expect(p).toContain('Winback lapsed buyers');
  expect(p, 'the reach figure must reach the strategist').toContain('12400');
  expect(p).toContain('Turmeric Chai');
  // A different cohort must produce a different brief, not the same text.
  const q = SB.strategyPrompt(entry('New subscribers', 'activation for new subscribers'));
  expect(q).not.toBe(p);
  expect(q).toContain('New subscribers');
});

test('the copy prompt carries the cohort AND the per-asset contracts', () => {
  const p = SB.copyPrompt(entry('Winback lapsed buyers', 'winback lapsed buyers'));
  expect(p).toContain('Winback lapsed buyers');
  expect(p, 'the five assets are not given their own contracts').toContain('PER-ASSET CONTRACTS');
  // Each asset's own limits, in the prompt the copywriter model actually reads.
  expect(p, 'Google cap missing from the prompt').toMatch(/30 chars EACH/);
  expect(p, 'organic text-free rule missing').toMatch(/TEXT-FREE|text-free/);
  expect(p, 'landing archetype missing').toContain('Proof first');
});

test('changing only the cohort changes the copy prompt', () => {
  // Same date, market and product: if the two prompts came out identical the
  // cohort would be decorative.
  const a = SB.copyPrompt(entry('Winback lapsed buyers', 'winback lapsed buyers'));
  const b = SB.copyPrompt(entry('New subscribers', 'activation for new subscribers'));
  expect(a).not.toBe(b);
  expect(a).toContain('Proof first');       // trust is the blocker
  expect(b).toContain('Ritual how-to');     // how it fits a morning
});

test('the copy framework is chosen from the cohort, not at random', () => {
  const winback = CF.pickCopyFramework({ play_key: 'winback', cohort_key: 'winback', seed: 's1' });
  const same = CF.pickCopyFramework({ play_key: 'winback', cohort_key: 'winback', seed: 's1' });
  expect(winback.key, 'framework choice must be deterministic for a slot').toBe(same.key);
  expect(winback.key).toBeTruthy();
});

// ── The cohort changes the ASSET, not just its label ────────────────────────
test('a trust-blocked cohort and a first-purchase cohort get different pages', () => {
  // This is the property that matters. Same day, same market, same product:
  // only the cohort and its objective differ, and the page shape must follow.
  const winback = AE.ENGINES.landing_page.design(entry('winback', 'winback lapsed buyers'));
  const activation = AE.ENGINES.landing_page.design(entry('new', 'activation for new subscribers'));
  expect(winback.archetype).toBe('proof-first');
  expect(activation.archetype).toBe('ritual-howto');
  expect(winback.order).not.toEqual(activation.order);
  // And each must be able to say why it chose that shape.
  expect(winback.why).toMatch(/intent/);
  expect(activation.fit).toMatch(/new and activation/);
});

test('the gifting cohort gets the gifting page, where the reader is not the drinker', () => {
  const gift = AE.ENGINES.landing_page.design(entry('gifting', 'diwali gifting push'));
  expect(gift.archetype).toBe('gift-curation');
  expect(gift.fit).toMatch(/not the drinker/);
});

test('the per-asset contracts differ once the cohort differs', () => {
  const a = AE.contractsFor(['landing_page'], entry('winback', 'winback lapsed buyers'))[0].contract;
  const b = AE.contractsFor(['landing_page'], entry('new', 'activation for new subscribers'))[0].contract;
  expect(a).not.toBe(b);
  expect(a).toContain('Proof first');
  expect(b).toContain('Ritual how-to');
});

test('an unrecognised cohort still gets a real design, chosen by seed', () => {
  // No stated intent to key on is not a reason to emit nothing, or to fall back
  // to one default shape for every unlabelled slot.
  const d = AE.ENGINES.landing_page.design(entry('segment-7', 'general retention'));
  expect(d.archetype).toBeTruthy();
  expect(d.why).toMatch(/seed/);
  const shapes = new Set();
  for (let i = 0; i < 20; i++) shapes.add(AE.ENGINES.landing_page.design(entry('seg' + i, 'general retention')).archetype);
  expect(shapes.size, 'every unlabelled cohort landed on the same shape').toBeGreaterThan(1);
});

// ── The asset is QA'd against the cohort it was built for ───────────────────
test('qaCampaign really checks a campaign built for a cohort', () => {
  // Run the roll-up rather than grepping for its call site.
  const campaign = {
    assets: {
      email: { subject: 'Steady mornings', preheader: 'One estate, one cup', hero_headline: 'H', intro_paragraph: 'p', cta: 'Shop' },
      landing_pages: [{ hero_headline: 'Steady mornings', hero_sub: 'From one estate', cta: 'Shop' }],
      ads: [{ platform: 'meta', primary_text: 'Steady mornings', headline: 'Steady', image_brief: 'a scene' }],
    },
  };
  const e = entry('Winback lapsed buyers', 'winback lapsed buyers');
  const r = AE.qaCampaign(campaign, { ...e, source_copy: 'Steady mornings' });
  expect(r.checked).toBe(3);
  expect(r.ok, JSON.stringify(r.results.filter((x) => !x.ok))).toBe(true);
  // And it must actually fail a campaign that breaks the cohort's page rule.
  const bad = JSON.parse(JSON.stringify(campaign));
  bad.assets.landing_pages[0].cta = 'Claim your money-back guarantee';
  const r2 = AE.qaCampaign(bad, { ...e, source_copy: 'Steady mornings' });
  expect(r2.ok).toBe(false);
  expect(JSON.stringify(r2.results)).toMatch(/message-match break/);
});

// ── The intent matcher is token-anchored ────────────────────────────────────
test('a renewal or newsletter cohort is not mistaken for a new customer', () => {
  // Unanchored, `new` matched "renewal" and "newsletter", so a renewal reminder
  // was designed as a first-purchase how-to page. Same class as the market-URL
  // suffix match: a substring is not a token.
  for (const [cohort, objective] of [
    ['renewal-reminders', 'subscription renewal'],
    ['newsletter', 'weekly newsletter'],
  ]) {
    const d = AE.ENGINES.landing_page.design(entry(cohort, objective));
    expect(d.archetype, `${cohort} was read as a new-customer slot`).not.toBe('ritual-howto');
    expect(d.why, `${cohort} should fall through to the seed`).toMatch(/seed/);
  }
  // A genuine new-subscriber slot still matches.
  expect(AE.ENGINES.landing_page.design(entry('new-subscribers', 'welcome new subscribers')).archetype).toBe('ritual-howto');
});
