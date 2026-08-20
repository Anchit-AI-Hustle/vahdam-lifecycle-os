const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// HARD rule, from the Campaign Orchestration Master Operating Contract:
// never a black / #171717 / dark-neutral SECTION background. Use green.
//
// It had drifted anyway. Four Mailer Studio section renderers shipped their
// section on #171717 - the announcement bar, the bold offer banner, the urgency
// strip and the countdown block - so a generated mailer opened with a black
// band across the top. Reported twice from the live studio.
//
// Ink is still perfectly legal as TEXT (it is one of the four brand colours).
// Only a BACKGROUND may not be dark neutral, which is why these tests match on
// `background:` rather than on the colour appearing at all.

const ROOT = path.join(__dirname, '..');

// Anything that renders a customer-facing surface.
const FILES = [
  'vahdam_mailer_architect_v34.html',
  'scripts/lib/flagship-mailer.js',
  'scripts/lib/landing-page.js',
  'scripts/lib/ad-creative.js',
  'api/_shared/smart-brain-plan.js',
  'api/_shared/calendar-trigger.js',
  'api/ai/pipeline/html.js',
].filter((f) => fs.existsSync(path.join(ROOT, f)));

// Dark neutrals: the banned literal, plus the drift shades CLAUDE.md names,
// plus anything near-black written as hex or rgb.
const DARK = /#(171717|1a1a1a|000000|000|0a0a0a|111|111111|121212|222|222222)\b/i;

function backgroundDecls(src) {
  // `background:` / `background-color:` up to the next ; " or '
  return [...src.matchAll(/background(?:-color)?\s*:\s*([^;"'`]{1,80})/gi)].map((m) => ({
    value: m[1],
    at: src.slice(0, m.index).split('\n').length,
    // A letterbox well BEHIND a video is the one place black is correct: the
    // media does not fill the frame and green bars round a video read as a
    // rendering fault. Exempt only when the source says so at the point of use,
    // so the exemption is auditable rather than an omission the guard tolerates.
    exempt: /letterbox-well/.test(src.slice(m.index, m.index + 160)),
  }));
}

for (const rel of FILES) {
  test(`${rel} paints no dark-neutral background`, () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const hits = backgroundDecls(src)
      .filter((d) => !d.exempt)
      .filter((d) => DARK.test(d.value) || /_ARCH_INK|PAL\.ink|\bink\b/.test(d.value))
      .map((d) => `  ${rel}:${d.at}  background: ${d.value.trim()}`);
    expect(hits, `dark-neutral section background(s):\n${hits.join('\n')}`).toEqual([]);
  });
}

test('the studio still uses ink for TEXT, so the guard is not just deleting the colour', () => {
  // Guards the guard: if ink vanished from the file entirely the tests above
  // would pass for the wrong reason.
  const src = fs.readFileSync(path.join(ROOT, 'vahdam_mailer_architect_v34.html'), 'utf8');
  expect(src).toMatch(/color:'\+_ARCH_INK/);
});

test('the four repaired sections are green', () => {
  const src = fs.readFileSync(path.join(ROOT, 'vahdam_mailer_architect_v34.html'), 'utf8');
  for (const fn of ['_sec_annBarUrgent', '_sec_offerBannerBold', '_sec_urgencyStrip', '_sec_countdownBlock']) {
    const i = src.indexOf('function ' + fn);
    expect(i, `${fn} is gone`).toBeGreaterThan(-1);
    const body = src.slice(i, i + 1400);
    expect(body, `${fn} lost its green section background`).toMatch(/background:'\+_ARCH_GREEN/);
  }
});

test('the countdown tiles are not green-on-green', () => {
  // The trap in this fix: the tiles were already green, so turning the section
  // green would have made them invisible rather than merely off-brand.
  const src = fs.readFileSync(path.join(ROOT, 'vahdam_mailer_architect_v34.html'), 'utf8');
  const i = src.indexOf('function _sec_countdownBlock');
  const body = src.slice(i, i + 1400);
  expect(body).toContain("background:'+_ARCH_CREAM");
  expect(body).toMatch(/color:'\+_ARCH_GREEN/);
});

// ── Contrast: a banned background must not be traded for an unreadable one ──
function lum(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const GREEN = '#004A2B', GOLD = '#AB8743', CREAM = '#FBF5EA', INK = '#171717';

test('small text on the green sections reaches AA', () => {
  // Gold on green is 3.12:1 - AA-large ONLY. These labels are 10 to 10.5px, so
  // gold would fail; they are cream, which is 9.61:1. This test is why the
  // swap did not just move the defect.
  expect(ratio(CREAM, GREEN)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(GOLD, GREEN)).toBeLessThan(4.5);
  const src = fs.readFileSync(path.join(ROOT, 'vahdam_mailer_architect_v34.html'), 'utf8');
  for (const fn of ['_sec_annBarUrgent', '_sec_urgencyStrip']) {
    const body = src.slice(src.indexOf('function ' + fn), src.indexOf('function ' + fn) + 800);
    expect(body, `${fn} still puts gold on green at small size`).not.toMatch(/color:'\+_ARCH_GOLD/);
  }
});

test('the offer button is readable on its gold fill', () => {
  // White on gold is 3.34:1 and did not reach AA at button size; ink is 5.36:1.
  expect(ratio(INK, GOLD)).toBeGreaterThanOrEqual(4.5);
  const src = fs.readFileSync(path.join(ROOT, 'vahdam_mailer_architect_v34.html'), 'utf8');
  const body = src.slice(src.indexOf('function _sec_offerBannerBold'), src.indexOf('function _sec_offerBannerBold') + 1400);
  expect(body, 'the gold button still uses white text').not.toMatch(/_ARCH_GOLD,'#ffffff'/);
});

test('the letterbox exemption is narrow and stays narrow', () => {
  // It may only ever apply to a well that actually contains a video. If this
  // count grows, someone is using the marker to smuggle a section background.
  const files = ['scripts/lib/landing-page.js', 'scripts/lib/ad-creative.js'];
  let total = 0;
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/letterbox-well/g)) {
      total++;
      const after = src.slice(m.index, m.index + 400);
      expect(after, `${rel}: letterbox marker with no video under it`).toMatch(/<video|<iframe[^>]*[Vv]ideo/);
    }
  }
  expect(total, 'the letterbox exemption spread beyond the two video wells').toBe(2);
});
