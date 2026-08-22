const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// The spec has defined a 16-dimension weighted launch gate, a critical-dim
// floor and a blocking-condition list since the beginning, and NOTHING
// computed it. "Is this launch ready" was answered by reading the screen.
//
// The load-bearing rule, and the reason this file exists: AN UNMEASURED
// DIMENSION IS NOT A PASSING DIMENSION. The tempting default is 10 because
// nothing reported a problem, which makes the gate pass by ignorance - the
// same failure as a run that called itself `final` while its catalog gate had
// failed. These tests pin that a missing signal costs you the weight.

const ROOT = path.join(__dirname, '..');
const gate = require(path.join(ROOT, 'api', '_shared', 'launch-gate.js'));
const claims = require(path.join(ROOT, 'api', '_shared', 'claims-library.js'));
const renderQa = require(path.join(ROOT, 'api', '_shared', 'render-qa.js'));

const SHELL = (body) => `<table style="max-width:600px"><tr><td style="background:#004A2B">
  <p style="color:#FBF5EA;font-size:14px">${body}</p></td></tr>
  <tr><td><a href="https://www.vahdam.com/products/x" style="color:#171717;background:#AB8743;font-size:14px">Shop now</a></td></tr>
  </table><style>@media(max-width:600px){}</style>`;
const CLEAN = 'There is a moment when the right cup does more than warm your hands. Steep four minutes.';

const campaign = (body, extra = {}) => ({
  assets: { email: { subject: 'Steep into the season', html: SHELL(body) } },
  copywriter: { provider: 'anthropic' },
  asset_qa: { issues: [] }, ads_qa: { issues: [] },
  reach: { eligible: 31700, measured: true, frequency_cap: { sends_in_rolling_7d: 1, absolute_max: 3 } },
  forecast: { expected_revenue: 42000, basis: 'measured' },
  ...extra,
});
const ctx = { catalogGate: { ok: true, live: true, products: [{ confidence: 'exact' }] } };

// ── The rubric itself ───────────────────────────────────────────────────────
test('the weights match the spec, and the spec does not add up to 100', () => {
  const spec = fs.readFileSync(path.join(ROOT, 'docs', 'campaign-orchestration-master-spec.md'), 'utf8');
  expect(spec).toContain('Launch-readiness gate');
  expect(gate.DIMENSIONS.length).toBe(16);
  // The spec writes "(=100)". They sum to 99. Normalising by 100 would
  // understate every campaign by 1%, so the code uses the real total and says so.
  expect(gate.WEIGHT_TOTAL).toBe(99);
  expect(gate.PASS_MARK).toBe(9.5);
  expect(gate.CRITICAL_FLOOR).toBe(9);
});

test('an empty campaign scores near zero and blocks', () => {
  const r = gate.scoreCampaign({}, {});
  expect(r.ok).toBe(false);
  expect(r.weighted).toBeLessThan(2);
  expect(r.verdict).toMatch(/^NOT LAUNCH READY/);
  expect(r.unmeasured.length).toBeGreaterThan(10);
});

test('an unmeasured dimension costs its weight instead of defaulting to pass', () => {
  // The whole point. Scoring only over what was measured would let a campaign
  // with one measured dimension report 10/10.
  const r = gate.scoreCampaign({}, {});
  expect(r.of_measured).toBeGreaterThan(r.weighted);
  for (const d of r.dimensions.filter((x) => x.score == null)) {
    expect(d.evidence, `${d.key} is unmeasured but gives no reason`).toBeTruthy();
  }
});

test('a fully compliant campaign reaches the pass mark', () => {
  const r = gate.scoreCampaign(campaign(CLEAN), ctx);
  expect(r.weighted, JSON.stringify(r.unmeasured.concat(r.critical_below_floor))).toBeGreaterThanOrEqual(9.5);
  expect(r.ok).toBe(true);
  expect(r.verdict).toBe('LAUNCH READY');
  expect(r.blockers).toEqual([]);
});

test('a critical dimension below 9 blocks even when the total is high', () => {
  // Segment eligibility is critical. Modelled (not measured) scores 5.
  const r = gate.scoreCampaign(campaign(CLEAN, {
    reach: { eligible: 31700, measured: false, frequency_cap: { sends_in_rolling_7d: 1, absolute_max: 3 } },
  }), ctx);
  expect(r.ok).toBe(false);
  expect(r.critical_below_floor.map((x) => x.key)).toContain('segment_eligibility');
});

test('a blocking condition blocks regardless of score', () => {
  const r = gate.scoreCampaign(campaign(CLEAN, {
    reach: { eligible: 31700, measured: true, frequency_cap: { sends_in_rolling_7d: 9, absolute_max: 3 } },
  }), ctx);
  expect(r.blockers).toContain('absolute_frequency_violation');
  expect(r.ok).toBe(false);
});

test('every blocker the gate can raise is one the spec lists', () => {
  const spec = fs.readFileSync(path.join(ROOT, 'docs', 'campaign-orchestration-master-spec.md'), 'utf8').toLowerCase();
  for (const b of gate.BLOCKERS) {
    const words = b.split('_').filter((w) => w.length > 3);
    expect(words.some((w) => spec.includes(w)), `blocker "${b}" appears nowhere in the spec`).toBe(true);
  }
});

test('a template-copy run cannot pass', () => {
  const r = gate.scoreCampaign(campaign(CLEAN, { copywriter: null }), ctx);
  expect(r.ok).toBe(false);
  expect(r.blockers).toContain('unproofread_copy');
});

// ── Claims library ──────────────────────────────────────────────────────────
test('the claims library ships empty, so a claim blocks until it is approved', () => {
  const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'approved', 'claims.json'), 'utf8'));
  expect(Array.isArray(lib.claims)).toBe(true);
  // Seeding it would be exactly the fabrication the spec forbids: approval is
  // a human act, not something a generator can grant.
  expect(lib.claims.length, 'someone seeded the approved-claims library').toBe(0);
});

test('claim detection catches real claims and leaves sensory copy alone', () => {
  expect(claims.extractClaims(CLEAN).length, 'sensory copy was flagged as a claim').toBe(0);
  for (const c of [
    'Rated 4.8/5 by 50,000+ customers.',
    'Clinically proven to boost immunity.',
    '30% more antioxidants than ordinary supermarket tea.',
    'USDA organic certified.',
  ]) expect(claims.extractClaims(c).length, `missed a real claim: ${c}`).toBe(1);
});

test('a campaign making an unapproved claim is blocked on a critical dimension', () => {
  const r = gate.scoreCampaign(campaign('Clinically proven to boost immunity.'), ctx);
  expect(r.ok).toBe(false);
  expect(r.blockers).toContain('unverified_claim');
  expect(r.critical_below_floor.map((x) => x.key)).toContain('claim_compliance');
});

test('claim extraction reports the sentence, not the whole payload', () => {
  // It stringified the campaign, which has no sentence boundaries, so one
  // claim made the ENTIRE JSON blob read as a single claim.
  const v = claims.verify(campaign('Rated 4.8/5 by 50,000+ customers.'), 'US');
  expect(v.items[0].text).toBe('Rated 4.8/5 by 50,000+ customers.');
  expect(v.items[0].text).not.toMatch(/[{}\\]/);
});

// ── Render QA ───────────────────────────────────────────────────────────────
test('render QA measures the OUTPUT, catching what a source guard cannot', () => {
  const bad = renderQa.inspect('<td style="background:#004A2B"><p style="color:#AB8743;font-size:10px">ENDS SOON</p></td>');
  expect(bad.contrast.failures).toBe(1);
  expect(bad.contrast.worst.ratio).toBeCloseTo(3.12, 2);
  // Size-aware: the identical colours pass at large size, per WCAG.
  const large = renderQa.inspect('<td style="background:#004A2B"><p style="color:#AB8743;font-size:28px">Steep</p></td>');
  expect(large.contrast.failures).toBe(0);
});

test('render QA still catches a black background in generated output', () => {
  const r = renderQa.inspect('<td style="background:#171717"><p style="color:#FBF5EA;font-size:14px">x</p></td>');
  expect(r.contrast.black_background).toBe(true);
});

test('render QA flags dead links, placeholders and missing alt text', () => {
  const r = renderQa.inspect('<a href="#">Learn More</a><img src="x"><p>PASTE_IMAGE_URL_HERE</p>');
  const joined = r.ui.issues.join(' ');
  expect(joined).toMatch(/no destination/);
  expect(joined).toMatch(/alt text/);
  expect(joined).toMatch(/placeholder/);
});

test('the gate is attached to every built campaign', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'), 'utf8');
  expect(src).toMatch(/campaign\.launch_gate\s*=/);
  expect(src).toContain('Launch Readiness Gate');
});
