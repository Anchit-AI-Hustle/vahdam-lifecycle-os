const { test, expect } = require('@playwright/test');
const path = require('path');
const AE = require(path.join(__dirname, '..', 'api', '_shared', 'asset-engines.js'));

// "Ensure a unique and appropriate design is created in every asset, every
// time." Measured over a real 90-day x 2-market x 6-cohort calendar, it was
// neither.
//
// A SEED gives INDEPENDENCE, which is not variety. Every engine repeated its own
// design back-to-back at exactly the rate chance predicts (~25% on a 4-item
// list, 60-100 three-in-a-rows across the calendar). Two were far worse because
// they resolved intent to a SINGLE archetype and a cohort's objective does not
// change from one send to the next:
//
//   mailer        100.0% back-to-back identical, 1056 three-in-a-rows
//   landing_page   73.4% back-to-back identical,  714 three-in-a-rows
//
// A calendar does not want independence, it wants each send to differ from the
// cohort's LAST send. That needs the choice to know where the slot sits in the
// cohort's sequence, which is what rotate() does.
//
// These tests measure the real engines over a real calendar rather than reading
// the source, because the defect was entirely statistical: every individual
// choice looked perfectly reasonable.

const TYPES = ['mailer', 'ad_meta', 'ad_google', 'ad_tiktok', 'landing_page',
  'social_instagram', 'social_facebook', 'social_linkedin', 'social_x',
  'social_youtube', 'social_pinterest', 'video', 'playable', 'blog'];

const COHORTS = [
  { key: 'loyalists', name: 'Loyalists', objective: 'premium bundle expansion' },
  { key: 'at-risk', name: 'At risk', objective: 'winback lapsed buyers' },
  { key: 'new', name: 'New buyers', objective: 'welcome and activation' },
  { key: 'browsers', name: 'Browsers', objective: 'discovery sampler cross-sell' },
  { key: 'gifters', name: 'Gifters', objective: 'festive gifting curation' },
  { key: 'vip', name: 'VIP', objective: 'premium bundle expansion' },
];

const iso = (i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
function sequence(type, cohort, market, days = 90, step = 1) {
  const e = AE.engineFor(type);
  const out = [];
  for (let i = 0; i < days; i += step) {
    const date = iso(i);
    out.push(e.design({ id: `cal_${date}_${market}_${cohort.key}`, date, market, cohort, objective: cohort.objective }).archetype);
  }
  return out;
}
function repeatStats(type, step = 1) {
  let back = 0, total = 0, runs3 = 0;
  for (const market of ['US', 'UK']) {
    for (const c of COHORTS) {
      const s = sequence(type, c, market, 90, step);
      for (let i = 1; i < s.length; i++) { total++; if (s[i] === s[i - 1]) back++; }
      for (let i = 2; i < s.length; i++) if (s[i] === s[i - 1] && s[i - 1] === s[i - 2]) runs3++;
    }
  }
  return { rate: back / total, runs3, total };
}

test('every asset type has an engine with a real design algorithm', () => {
  for (const t of TYPES) {
    const e = AE.engineFor(t);
    expect(e, `${t} has no engine`).toBeTruthy();
    const d = e.design({ id: 'x', date: '2026-09-01', market: 'US', cohort: { key: 'k' }, objective: 'o' });
    expect(d.archetype, `${t} produced no archetype`).toBeTruthy();
    expect(d.why, `${t} cannot say why it chose that shape`).toBeTruthy();
  }
});

test('no asset type repeats its design three times in a row, anywhere', () => {
  // The number that made the calendar look like one template. It must be zero.
  const bad = [];
  for (const t of TYPES) {
    const { runs3 } = repeatStats(t);
    if (runs3 > 0) bad.push(`${t}: ${runs3}`);
  }
  expect(bad, `three-in-a-row design repeats:\n  ${bad.join('\n  ')}`).toEqual([]);
});

test('back-to-back repeats are well below what chance would give', () => {
  // Rotation must beat the seed, not merely differ from it. Chance for an
  // n-item list is 1/n; a rotation that walks a permutation should land far
  // under that, and the two engines that pinned one archetype were at 100%/73%.
  const rows = [];
  for (const t of TYPES) {
    const e = AE.engineFor(t);
    const n = new Set(sequence(t, COHORTS[0], 'US')).size;
    if (n < 2) continue;               // one real shape cannot rotate
    const { rate } = repeatStats(t);
    rows.push({ t, rate, chance: 1 / n });
    expect(rate, `${t} repeats back-to-back ${(rate * 100).toFixed(1)}%, chance is ${(100 / n).toFixed(1)}%`)
      .toBeLessThan(1 / n);
  }
  expect(rows.length, 'no engine offered more than one shape').toBeGreaterThan(10);
});

test('the two engines that pinned one archetype per cohort no longer do', () => {
  // The exact regression. Guarded by name because these were the severe ones.
  for (const t of ['mailer', 'landing_page']) {
    const { rate, runs3 } = repeatStats(t);
    expect(runs3, `${t} is back to repeating three sends in a row`).toBe(0);
    expect(rate, `${t} repeats ${(rate * 100).toFixed(1)}% back-to-back`).toBeLessThan(0.2);
  }
});

test('a send cadence that divides the list size does not alias onto one shape', () => {
  // The failure the per-cycle re-permutation exists to prevent: a weekly send
  // against a 7-item list hits the same permutation index forever, and the
  // rotation becomes invisible while still looking correct in the source.
  for (const step of [2, 3, 4, 5, 7, 14]) {
    for (const t of TYPES) {
      const full = new Set(sequence(t, COHORTS[0], 'US')).size;
      if (full < 2) continue;
      const seen = new Set(sequence(t, COHORTS[0], 'US', 90, step));
      expect(seen.size, `${t} collapsed to ${seen.size} shape(s) at a ${step}-day cadence (it has ${full})`)
        .toBeGreaterThan(1);
    }
  }
});

test('the design is DETERMINISTIC: a re-run cannot change an approved asset', () => {
  // Load-bearing, and in tension with everything above. A re-run that produced
  // a different design would mean the reviewer approved something that no
  // longer exists, so variety may never be bought with randomness.
  const slot = { id: 'cal_2026-09-14_US_loyalists', date: '2026-09-14', market: 'US', cohort: { key: 'loyalists', name: 'Loyalists' }, objective: 'premium bundle expansion' };
  for (const t of TYPES) {
    const e = AE.engineFor(t);
    const first = JSON.stringify(e.design(slot));
    for (let i = 0; i < 50; i++) {
      expect(JSON.stringify(e.design({ ...slot, cohort: { ...slot.cohort } })), `${t} is not deterministic`).toBe(first);
    }
  }
});

test('two slots for one cohort on one day are not designed identically', () => {
  // An A/B pair or two products share a date ordinal, so they need the slot
  // discriminator. Without it they collide silently.
  const base = { date: '2026-09-14', market: 'US', cohort: { key: 'loyalists' }, objective: 'premium bundle expansion' };
  for (const t of TYPES) {
    const e = AE.engineFor(t);
    const n = new Set(sequence(t, COHORTS[0], 'US')).size;
    if (n < 2) continue;
    const seen = new Set();
    for (let i = 0; i < 24; i++) seen.add(e.design({ ...base, id: 'slot-' + i }).archetype);
    expect(seen.size, `${t} designed all 24 same-day slots identically`).toBeGreaterThan(1);
  }
});

// ── Appropriate, not merely different ───────────────────────────────────────
test('rotation never leaves the set of shapes that suit the stated intent', () => {
  const LP = AE.ENGINES.landing_page;
  const cases = [
    ['gifting', 'diwali gifting push', 'gifting'],
    ['winback', 'winback lapsed buyers', 'winback'],
    ['new-subscribers', 'welcome new subscribers', 'activation'],
    ['browsers', 'discovery sampler', 'discovery'],
  ];
  for (const [key, objective, intent] of cases) {
    for (let i = 0; i < 30; i++) {
      const date = iso(i);
      const d = LP.design({ id: `cal_${date}_US_${key}`, date, market: 'US', cohort: { key }, objective });
      expect(d.intent, `${key} stopped matching its intent`).toBe(intent);
      expect(LP.intents[intent].suitable, `${key} rotated onto ${d.archetype}, which does not serve ${intent}`)
        .toContain(d.archetype);
    }
  }
});

test('the cold-traffic shape never reaches an audience that is not cold', () => {
  // presell-narrative spends the top of the page convincing the reader a
  // problem exists. A gift buyer has already decided to buy a present, and a
  // lapsed customer already knows us - for them it is not variety, it is the
  // wrong page.
  const LP = AE.ENGINES.landing_page;
  expect(LP.intents.gifting.suitable).not.toContain('presell-narrative');
  expect(LP.intents.winback.suitable).not.toContain('presell-narrative');
  for (const [key, objective] of [['gifting', 'diwali gifting push'], ['winback', 'winback lapsed buyers']]) {
    for (let i = 0; i < 30; i++) {
      const date = iso(i);
      const d = LP.design({ id: `cal_${date}_US_${key}`, date, market: 'US', cohort: { key }, objective });
      expect(d.archetype, `${key} was given the cold-traffic presell page`).not.toBe('presell-narrative');
    }
  }
});

test('the audience directive survives every rotation, and reaches the prompt', () => {
  // It used to live on ONE archetype's `fit` string, so rotating the shape
  // silently dropped the requirement that a gift buyer is not the drinker.
  const LP = AE.ENGINES.landing_page;
  const shapes = new Set();
  for (let i = 0; i < 30; i++) {
    const date = iso(i);
    const ctx = { id: `cal_${date}_US_gifting`, date, market: 'US', cohort: { key: 'gifting' }, objective: 'diwali gifting push' };
    const d = LP.design(ctx);
    shapes.add(d.archetype);
    expect(d.audience, `${date} lost the gift-buyer framing`).toMatch(/not the drinker/i);
    expect(LP.contract(ctx), `${date}: the directive never reached the prompt`).toMatch(/WHO IS READING/);
  }
  // And it genuinely did rotate, so the assertion above is not vacuous.
  expect(shapes.size, 'gifting never changed shape, so surviving rotation proves nothing').toBeGreaterThan(1);
});

test('the mailer keeps a shape that suits the cohort while rotating', () => {
  const MD = require(path.join(__dirname, '..', 'api', '_shared', 'mailer-design-strategy.js'));
  for (const [key, objective] of [['gifters', 'festive gifting curation'], ['at-risk', 'winback lapsed buyers']]) {
    const allowed = MD.archetypeSetFor({ cohort: { key }, objective });
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      const date = iso(i);
      const k = MD.archetypeKeyFor({ id: `cal_${date}_US_${key}`, date, market: 'US', cohort: { key }, objective });
      expect(allowed, `${key} rotated onto ${k}, outside its suitable set`).toContain(k);
      seen.add(k);
    }
    expect(seen.size, `${key} never varied`).toBeGreaterThan(1);
  }
});
