const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// MAILER IMAGERY MUST BE GENERATED AS MAILER IMAGERY.
//
// Three separate paths were generating images for emails using a mode built for
// a different medium, and each produced a specific visible wrongness:
//
//   1. smart-brain-plan.js hardcoded mode:'reels' for EVERY surface, so an email
//      hero came from a preamble opening "Cinematic 9:16 hero frame ... the
//      opening shot of a high-end social video" — while being rendered at
//      1536x1024 landscape. The prompt fought its own size.
//   2. asset-agent.js filled every image slot INSIDE a mailer with mode:'design',
//      whose preamble describes "a complete marketing email as it would appear in
//      an inbox". Every filled slot rendered a picture of an email, inside an
//      email.
//   3. calendar-trigger.js passed no mode at all and fell through to the generic
//      product-photo preamble — closest to right, but carrying none of the
//      email-specific rules.
//
// The mode is invisible in the output until someone looks at a generated image,
// which is why this went unnoticed. These tests read the real handler.

const ROOT = path.join(__dirname, '..');
const IMAGE = fs.readFileSync(path.join(ROOT, 'api', 'ai', 'image.js'), 'utf8');
const PLAN = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'), 'utf8');
const AGENT = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'asset-agent.js'), 'utf8');
const TRIGGER = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'calendar-trigger.js'), 'utf8');

// Distinctive opening phrase of each preamble, so a mode can be identified from
// the prompt that actually reaches a provider.
const MARK = {
  mailer: 'premium tea EMAIL',
  ad: 'Scroll-stopping paid social ad',
  reels: 'Cinematic 9:16 hero frame',
  design: 'flat graphic design mockup',
  ambient: 'Photoreal ambient lifestyle backdrop',
  default: 'Photoreal product lifestyle photograph',
};

// Drive the REAL handler and capture the prompt as it leaves for a provider.
// Asserting on the source alone would prove the constant exists, not that the
// mode selects it.
async function promptFor(mode) {
  const handlerPath = require.resolve(path.join(ROOT, 'api', 'ai', 'image.js'));
  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  let seen = null;
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const blob = decodeURIComponent(String(url)) + ' ' + (opts && opts.body ? String(opts.body) : '');
    if (!seen) seen = blob;
    throw new Error('blocked in test');
  };
  const res = { setHeader() {}, status() { return res; }, end() { return res; }, json() { return res; } };
  try {
    await handler({ method: 'POST', body: { prompt: 'A cup of chai on a kitchen counter.', size: '1536x1024', mode } }, res).catch(() => {});
  } finally { global.fetch = realFetch; }
  return seen || '';
}

test('the mailer mode exists and is selected by mode:"mailer"', async () => {
  const p = await promptFor('mailer');
  expect(p, 'no prompt ever reached a provider').toBeTruthy();
  expect(p).toContain(MARK.mailer);
});

test('every mode selects its OWN preamble and no other', async () => {
  for (const mode of ['mailer', 'ad', 'reels', 'design', 'ambient']) {
    const p = await promptFor(mode);
    expect(p, `${mode} produced no prompt`).toBeTruthy();
    expect(p, `${mode} did not use its own preamble`).toContain(MARK[mode]);
    for (const other of Object.keys(MARK)) {
      if (other === mode || other === 'default') continue;
      expect(p, `${mode} leaked the ${other} preamble`).not.toContain(MARK[other]);
    }
  }
});

test('the mailer preamble forbids exactly what breaks an email', async () => {
  const p = await promptFor('mailer');
  // Copy is live HTML beside the image: baked text duplicates the headline,
  // cannot be translated or read aloud, and breaks on dark-mode inversion.
  expect(p).toMatch(/No text, no words/i);
  // It goes INSIDE an email, so it must not depict one.
  expect(p).toMatch(/No email layout, no inbox chrome/i);
  expect(p).toMatch(/NOT a design mockup/i);
  // Most opens are mobile; a frame that needs a big canvas is the wrong frame.
  expect(p).toMatch(/320px wide on a phone/i);
  // And it is not a video still.
  expect(p).toMatch(/NOT a vertical video still/i);
});

test('the Brain picks a mode per surface — reels only where it is really a video', () => {
  // The hardcoded mode:'reels' that started this.
  expect(PLAN, 'mode is hardcoded again').not.toMatch(/mode:\s*'reels'\s*,\s*tier:/);
  expect(PLAN).toMatch(/const SCENE_MODE = \{/);
  const map = PLAN.slice(PLAN.indexOf('const SCENE_MODE = {'), PLAN.indexOf('};', PLAN.indexOf('const SCENE_MODE = {')));
  expect(map).toMatch(/email:\s*'mailer'/);
  expect(map).toMatch(/landing:\s*'ambient'/);
  expect(map).toMatch(/tiktok:\s*'reels'/);
  // An email must never be framed as a vertical video again.
  expect(map).not.toMatch(/email:\s*'reels'/);
  expect(map).not.toMatch(/email:\s*'ad'/);
  expect(PLAN).toMatch(/mode: SCENE_MODE\[key\] \|\| 'ambient'/);
});

test('mailer slot images are not generated as email mockups', () => {
  // 'design' renders a whole email as seen in an inbox. Inside a mailer slot
  // that is an email within an email.
  const call = AGENT.slice(AGENT.indexOf('creative.generateCreativeImage('), AGENT.indexOf('creative.generateCreativeImage(') + 220);
  expect(call).toMatch(/mode: 'mailer'/);
  expect(call).not.toMatch(/mode: 'design'/);
});

test('the V2 mailer hero states its mode rather than relying on the default', () => {
  const call = TRIGGER.slice(TRIGGER.indexOf('generateCreativeImage(variants.V2.hero_image_brief'),
    TRIGGER.indexOf('generateCreativeImage(variants.V2.hero_image_brief') + 160);
  expect(call).toMatch(/mode: 'mailer'/);
});

test("Mailer Studio's full-layout mockup button legitimately keeps mode:'design'", () => {
  // Not everything called 'design' was wrong. That button generates a mockup OF
  // the whole email on purpose, which is exactly what the design preamble is
  // for — so the fix must not have swept it up.
  const studio = fs.readFileSync(path.join(ROOT, 'vahdam_mailer_architect_v34.html'), 'utf8');
  const fn = studio.slice(studio.indexOf('async function generateServerImage'), studio.indexOf('async function generateServerImage') + 900);
  expect(fn).toMatch(/mode:'design'/);
});
