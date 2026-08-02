const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Video ads shipped silent, and the failure was invisible for a reason worth
// pinning: the Social Media OS agent literally named "Audio/Video" asked the LLM
// for an `audio` field, got back "Music: sparse, warm, no percussion", returned it
// in the storyboard the UI renders — and never passed it to the renderer. The brief
// said music, the response said music, the file had none.
//
// Two independent causes, so two independent guards:
//   1. the direction must REACH the provider request, and
//   2. Veo must be told to score the clip (`generateAudio`), because omitting it
//      returns a silent render.
// Plus the honesty rule: Runway gen4_turbo has no audio track at all, so a cascade
// demotion there is silent whatever was asked, and the caller must be told.

const VC = require(path.join(__dirname, '..', 'api', '_shared', 'video-core.js'));
const SHARED = path.join(__dirname, '..', 'api', '_shared');
const read = (f) => fs.readFileSync(path.join(SHARED, f), 'utf8');

const AUDIO = 'Music: sparse, warm strings, no percussion.';

// No provider keys in CI, so generateVideo returns the not-connected stub carrying
// the exact body it WOULD send — assert the request shape without paying for a render.
const bodyFor = async (provider, opts = {}) => {
  const r = await VC.generateVideo({ prompt: 'slow push-in on the cup', aspect: '9:16', preferProviders: [provider], ...opts });
  return r.would_request.body;
};

test.describe('an audio direction reaches the renderer', () => {
  test('Veo is told to generate audio, and gets the direction in the prompt', async () => {
    const body = await bodyFor('veo', { audio: AUDIO });
    expect(body.parameters.generateAudio).toBe(true);
    expect(body.instances[0].prompt).toContain('sparse, warm strings');
  });

  test('no direction means an explicitly silent render, not a model default', async () => {
    const body = await bodyFor('veo');
    // Explicit false rather than absent: a default we do not control is how the
    // original silence got in.
    expect(body.parameters.generateAudio).toBe(false);
    expect(body.instances[0].prompt).not.toContain('AUDIO:');
  });

  // Every rung, so adding a provider without threading audio fails here rather
  // than shipping a silent ad.
  for (const provider of ['sora', 'higgsfield', 'openmontage', 'runway']) {
    test(`${provider} carries the audio direction in its prompt`, async () => {
      const body = await bodyFor(provider, { audio: AUDIO });
      const prompt = body.prompt || body.promptText;
      expect(prompt, `${provider} dropped the audio direction`).toContain('sparse, warm strings');
    });
  }

  test('whitespace-only audio is treated as no audio', async () => {
    const body = await bodyFor('veo', { audio: '   ' });
    expect(body.parameters.generateAudio).toBe(false);
    expect(body.instances[0].prompt).not.toContain('AUDIO:');
  });
});

test.describe('a silent provider is reported, never implied to have music', () => {
  test('Runway is recorded as having no audio track', () => {
    const src = read('video-core.js');
    const table = src.slice(src.indexOf('const AUDIO_CAPABLE'), src.indexOf('\n', src.indexOf('const AUDIO_CAPABLE')));
    expect(table).toMatch(/runway:\s*false/);
    // And the audio-capable rungs are not accidentally flipped off.
    expect(table).toMatch(/veo:\s*true/);
    expect(table).toMatch(/sora:\s*true/);
  });

  test('the result exposes audio_supported so callers can say "silent"', () => {
    const src = read('video-core.js');
    expect(src).toContain('audio_supported');
    expect(src).toContain('audio_requested');
    // The flag must come from the rung that WON, not from the request.
    expect(src).toContain('AUDIO_CAPABLE[rung.name]');
  });
});

test.describe('the callers that produce ads actually ask for music', () => {
  test('the Social Media OS passes its own storyboard audio to the renderer', () => {
    const src = read('social-core.js');
    // The regression: board.audio existed, was returned, and was never sent.
    expect(src).toMatch(/generateVideo\(\{[^)]*audio:\s*board\.audio/);
  });

  test('ad video requests a soundtrack', () => {
    const src = read('smart-brain-plan.js');
    expect(src).toContain('AD_AUDIO_RULE');
    expect(src).toMatch(/generateVideo\(\{[\s\S]{0,300}?audio:\s*AD_AUDIO_RULE/);
  });

  test('the ad soundtrack is original and cleared, never a trending track', () => {
    const src = read('smart-brain-plan.js');
    const rule = src.slice(src.indexOf('const AD_AUDIO_RULE'), src.indexOf('\n', src.indexOf('const AD_AUDIO_RULE')));
    // A paid ad cannot use a recognisable track — rights, not taste.
    expect(rule).toMatch(/original/i);
    expect(rule).toMatch(/trending/i);
  });

  test('the ad card reports whether the clip really has audio', () => {
    const src = read('smart-brain-plan.js');
    expect(src).toContain('has_audio');
  });
});
