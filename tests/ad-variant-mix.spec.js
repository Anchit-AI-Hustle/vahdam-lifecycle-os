// Ads ship 1 Text + 3 Text+Visual per platform (product owner, 2026-08-30),
// matching the mailer contract.
//
// "Text" is the TYPOGRAPHIC creative - brand colour, type, built elements, no
// photograph. It is NOT an ad with no creative: no such placement exists on
// Meta, TikTok, YouTube or Pinterest, and emitting one would produce an ad unit
// the platform cannot run.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { qaAd, qaAds } = require(path.join(__dirname, '..', 'api/_shared/ads-qa.js'));

const SERVICES = fs.readFileSync(path.join(__dirname, '..', 'lib/smart-brain/services.js'), 'utf8');

test('every platform gets one text creative and three text+visual', () => {
  // The builder is not exported, so assert on the push that composes the set.
  expect(SERVICES).toMatch(/const visual = p\.video_first \? \[v, s, l\] : \[s, l, v\];/);
  expect(SERVICES).toMatch(/out\.push\(t, \.\.\.visual\);/);
  for (const fn of ['textAd', 'staticAd', 'lifestyleAd', 'videoAd']) {
    expect(SERVICES, `${fn} is missing`).toMatch(new RegExp(`const ${fn} = \\(`));
  }
});

test('the text creative briefs no photograph', () => {
  const block = SERVICES.slice(SERVICES.indexOf('const textAd = ('), SERVICES.indexOf('const lifestyleAd = ('));
  expect(block).toMatch(/TYPOGRAPHIC/);
  expect(block, 'a text ad must not brief a photograph').toMatch(/no photograph/i);
  expect(block).not.toMatch(/packshot of/);
});

test('the three visual treatments are distinct, not the packshot three times', () => {
  const stat = SERVICES.slice(SERVICES.indexOf('const staticAd = ('), SERVICES.indexOf('const textAd = ('));
  const life = SERVICES.slice(SERVICES.indexOf('const lifestyleAd = ('), SERVICES.indexOf('const videoAd = ('));
  expect(stat).toMatch(/hero packshot/i);
  expect(life).toMatch(/lifestyle scene/i);
  expect(life).not.toMatch(/hero packshot of/i);
});

// Behavioural: the QA critic must accept the new type, or every run goes red.
test('QA accepts a well-formed text ad instead of failing it as invalid', () => {
  const ad = {
    platform: 'meta', creative_type: 'text', aspect: '1:1', headline: 'H',
    primary_text: 'P', cta: 'Shop Now',
    creative_brief: 'TYPOGRAPHIC 1:1: no photograph. Headline on forest field.',
    overlay: { headline: 'H', cta: 'Shop Now' },
  };
  const r = qaAd(ad);
  expect(r.issues.filter((i) => i.sev === 'critical')).toEqual([]);
});

test('a text ad carrying video fields is still a critical', () => {
  // The type was widened, not the rules loosened.
  const bad = {
    platform: 'meta', creative_type: 'text', aspect: '1:1', headline: 'H',
    creative_brief: 'TYPOGRAPHIC, no photograph', overlay: { headline: 'H' },
    script: '0-2s hook',
  };
  expect(qaAd(bad).issues.some((i) => i.sev === 'critical' && /video fields/.test(i.msg))).toBe(true);
});

test('an unknown creative type is still rejected', () => {
  const r = qaAd({ platform: 'meta', creative_type: 'carousel', aspect: '1:1' });
  expect(r.issues.some((i) => i.sev === 'critical' && /invalid ad type/.test(i.msg))).toBe(true);
});

test('coverage reports a platform missing its text variant', () => {
  const mk = (t) => ({
    platform: 'meta', creative_type: t, aspect: '1:1', headline: 'H',
    creative_brief: 'b', overlay: { headline: 'H' },
    ...(t === 'video' ? { storyboard: [{ t: '0-2s', scene: 'a' }, { t: '3s', scene: 'b' }, { t: '8s', scene: 'c' }], script: 's' } : {}),
  });
  const missing = qaAds([mk('static'), mk('video')]).missing;
  expect(missing).toContain('meta:no-text');
});
