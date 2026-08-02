const { test, expect } = require('@playwright/test');
const path = require('path');

// The master prompt is the asset the OPERATOR pastes into a blank ChatGPT /
// Claude / Gemini session. It is the only thing standing between "paste this
// somewhere else" and off-brand, fabricated output, because in that session the
// model has no repo, no catalog and no brand guide.
//
// These tests lock the contract for every asset type. The one that matters most
// is `never re-introduces "assume and proceed"` — see below.

const mp = require(path.join(__dirname, '..', 'api', '_shared', 'master-prompt.js'));
const { buildMasterPrompt } = mp;

const ASSETS = [
  { label: 'mailer/V1', o: { assetType: 'mailer', variant: 'V1' } },
  { label: 'mailer/V2', o: { assetType: 'mailer', variant: 'V2' } },
  { label: 'ad/meta', o: { assetType: 'ad', platform: 'meta' } },
  { label: 'ad/google', o: { assetType: 'ad', platform: 'google' } },
  { label: 'ad/tiktok', o: { assetType: 'ad', platform: 'tiktok' } },
  { label: 'landing_page', o: { assetType: 'landing_page' } },
  { label: 'social/instagram', o: { assetType: 'social', platform: 'instagram' } },
  { label: 'social/linkedin', o: { assetType: 'social', platform: 'linkedin' } },
  { label: 'social/pinterest', o: { assetType: 'social', platform: 'pinterest' } },
  { label: 'playable', o: { assetType: 'playable' } },
  { label: 'video', o: { assetType: 'video' } },
];

const build = (o) => buildMasterPrompt({ market: 'US', brief: 'Reactivate 90-day lapsed buyers', cohort: 'lapsed-90d', ...o });

test.describe('every asset type carries the full quality contract', () => {
  for (const { label, o } of ASSETS) {
    test(`${label} carries brand, anti-fabrication, bar, anti-patterns, audit and envelope`, () => {
      const p = build(o);
      expect(p, 'brand constraints').toContain('PALETTE (use ONLY these four)');
      expect(p, 'zero-fabrication protocol').toContain('ZERO FABRICATION');
      expect(p, 'the placeholder token').toContain('[DATA REQUIRED BEFORE LAUNCH:');
      expect(p, 'operational quality bar').toContain('THE BAR');
      expect(p, 'named failure modes').toContain('DO NOT PRODUCE');
      expect(p, 'self-audit gate').toContain('BEFORE YOU OUTPUT');
      expect(p, 'critical dims named').toContain('NOT LAUNCH READY');
      expect(p, 'response shape').toContain('RESPONSE FORMAT');
      expect(p, 'source map required').toContain('SOURCE MAP');
    });
  }
});

test('never re-introduces "assume and proceed" — the fabrication invitation', () => {
  // The prompt used to close with: "If you must assume a detail, choose the most
  // on-brand option and proceed - do not ask questions." Pasted into a blank
  // session the model has NO product facts, so that sentence instructed it to
  // invent every price, URL, rating and claim. It is the single most dangerous
  // line the prompt could carry, and it directly contradicted the brand's
  // top-priority zero-fabrication rule sitting a few lines above it.
  for (const { label, o } of ASSETS) {
    const p = build(o);
    expect(p, `${label} must not invite assumption`).not.toMatch(/choose the most on-brand option and proceed/i);
    expect(p, `${label} must not invite assumption`).not.toMatch(/if you must assume/i);
  }
});

test('the prompt obeys its own no-dash rule', () => {
  // A prompt that bans em-dashes while using 41 of them teaches the violation:
  // demonstrated style beats stated rules. The ONLY permitted occurrence is the
  // rule itself, which has to name the character to ban it.
  for (const { label, o } of ASSETS) {
    const p = build(o);
    const em = (p.match(/—/g) || []).length;
    const en = (p.match(/–/g) || []).length;
    expect(em, `${label}: em-dashes beyond the naming rule`).toBeLessThanOrEqual(1);
    expect(en, `${label}: en-dashes beyond the naming rule`).toBeLessThanOrEqual(1);
    const ruleLine = p.split('\n').find((l) => l.includes('em-dashes'));
    expect(ruleLine, `${label}: the ban must still name the characters`).toContain('—');
  }
});

test('supplied product facts flow through; absent ones do not get invented', () => {
  const withProduct = buildMasterPrompt({
    assetType: 'ad', platform: 'meta', market: 'UK',
    products: [{ title: 'Turmeric Ashwagandha', price: '19.99', handle: 'turmeric-ashwagandha-herbal-tea' }],
  });
  expect(withProduct).toContain('Turmeric Ashwagandha');
  expect(withProduct).toContain('£19.99');
  expect(withProduct).toContain('uk.vahdamteas.com');

  // With no products the prompt must forbid inventing one, not quietly proceed.
  const without = buildMasterPrompt({ assetType: 'ad', platform: 'meta' });
  expect(without).toMatch(/Do NOT invent a specific product name, price, or handle/i);
});

test('ad prompts demand a designed composition, not a photo with text on it', () => {
  const p = build({ assetType: 'ad', platform: 'meta' });
  expect(p).toContain('ONE DESIGNED FRAME');
  expect(p, 'attention hierarchy').toContain('Pattern interrupt');
  expect(p, 'per-format layouts not crops').toMatch(/never design once and crop/i);
  expect(p, 'art direction').toContain('ART DIRECTION');
  expect(p, 'lens direction').toMatch(/focal length and depth of field/i);
  expect(p, 'reject criteria').toMatch(/REJECT AND REDO/);
});

test('video prompts demand real motion, not a slideshow', () => {
  const p = build({ assetType: 'video' });
  expect(p).toContain('REELS-GRADE BAR');
  expect(p, 'hook timing').toContain('0.8s');
  expect(p, 'parallax depth').toMatch(/separated layers/i);
  expect(p, 'must work muted').toMatch(/work muted/i);
  expect(p, 'real packaging only').toMatch(/actual SKU only/i);
});

test('landing pages are held to message match with their originating creative', () => {
  const p = build({ assetType: 'landing_page' });
  expect(p).toContain('MESSAGE MATCH');
  expect(p).toMatch(/introduce no\s+price, discount, rating, review count, guarantee or claim/i);
});

test('the shared blocks are exported so other prompt sites cannot drift lower', () => {
  for (const k of ['BRAND_BLOCK', 'FABRICATION_PROTOCOL', 'EXCELLENCE_BAR', 'ANTI_PATTERNS', 'CRAFT_BLOCK', 'SELF_AUDIT', 'OUTPUT_ENVELOPE']) {
    expect(typeof mp[k], `${k} must be exported`).toBe('string');
    expect(mp[k].length, `${k} must not be empty`).toBeGreaterThan(80);
  }
  // The pre-existing API other modules import must survive.
  expect(typeof mp.buildMasterPrompt).toBe('function');
  expect(typeof mp.regionFacts).toBe('function');
  expect(mp.regionFacts('UK').store).toBe('uk.vahdamteas.com');
});

test('prompts stay a practical size to paste', () => {
  for (const { label, o } of ASSETS) {
    const tokens = Math.ceil(build(o).length / 4);
    expect(tokens, `${label} is too large to paste comfortably`).toBeLessThan(6000);
    expect(tokens, `${label} is suspiciously thin`).toBeGreaterThan(1200);
  }
});
