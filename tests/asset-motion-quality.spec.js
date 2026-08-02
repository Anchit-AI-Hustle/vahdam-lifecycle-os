const { test, expect } = require('@playwright/test');
const path = require('path');

// Depth + motion across the four asset surfaces (motion-design.js), and the
// rules that keep them shippable:
//
//   1. A mailer's motion must be a PURE ENHANCEMENT. Email clients run no JS
//      and many strip animation, so the hidden "before" state of an entrance
//      animation must live inside the same gated @media block as its
//      keyframes — otherwise a client that keeps styles but strips animation
//      paints the mailer permanently invisible. The Chromium checks below
//      render with reduced-motion FORCED and assert every word is visible.
//   2. Scroll effects live on landing pages, never in email. The landing
//      runtime must be no-JS safe: content only hides when the script itself
//      has marked the document.
//   3. Depth may not drift the palette: lights and glows derive from brand
//      colours; shadows are neutral alpha, not section backgrounds.

const shared = (f) => require(path.join(__dirname, '..', 'api', '_shared', f));
const lib = (f) => require(path.join(__dirname, '..', 'scripts', 'lib', f));

const motion = shared('motion-design.js');
const brainGen = shared('brain-generate.js');
const { renderFlagship } = lib('flagship-mailer.js');
const { renderMotionAd } = lib('motion-ad.js');

const BRAND = {
  palette: { forest_green: '#004A2B', gold: '#AB8743', near_black: '#171717', cream: '#FBF5EA' },
  typography: {
    headings: { fallback: "'Lao MN','Cormorant Garamond',Georgia,serif" },
    body: { fallback: "'Proxima Nova','Helvetica Neue',Arial,sans-serif" },
  },
  store_urls: { US: 'https://www.vahdamteas.com' },
};
const SLOT = { market: 'US', theme: 'morning ritual', angle: 'origin-fresh' };
const PRODUCTS = [{ title: 'Turmeric Ashwagandha Herbal Tea', price: 24.99, type: 'Wellness Tea', category: 'Wellness Tea', handle: 'turmeric-ashwagandha' }];

function brainMailer() {
  const copy = brainGen.fallbackCopy(SLOT, PRODUCTS);
  return brainGen.mailerHtml(SLOT, copy, PRODUCTS, BRAND, 'https://example.com/agent');
}
function brainLanding() {
  const copy = brainGen.fallbackCopy(SLOT, PRODUCTS);
  return brainGen.landingHtml(SLOT, copy, PRODUCTS, BRAND, 'https://example.com/agent');
}
function flagship() {
  return renderFlagship({
    subject: 'S', preheader: 'P', eyebrow: 'SINGLE ESTATE', productName: 'Turmeric Ashwagandha',
    tastingLine: 'Golden, earthy, calm', ctaUrl: 'https://www.vahdamteas.com', ctaText: 'Steep the ritual',
    headline: 'The ritual, restored', subline: 'Hand-picked at origin', bodyBlocks: [{ heading: 'Origin', body: 'Packed within days of plucking.' }], market: 'US',
  });
}

// ── Rule 1: mailers — motion gated, fallback complete ───────────────────────
for (const [name, render] of [['flagship', flagship], ['brain-generated', brainMailer]]) {
  test(`${name} mailer: motion is gated and there is no script`, () => {
    const html = render();
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(motion.EMAIL_MOTION_GATE);
    // The hidden entrance state must not exist outside the gate. Strip the
    // gated block, then assert no animated-hide remains.
    const gateStart = html.indexOf(motion.EMAIL_MOTION_GATE);
    const gateEnd = html.indexOf('}', html.lastIndexOf('mxFloat'));
    const outside = html.slice(0, gateStart) + html.slice(gateEnd);
    expect(outside).not.toMatch(/\.mx-rise[^{]*\{[^}]*opacity:0/);
  });

  test(`${name} mailer: every word survives with animations stripped`, async ({ page }) => {
    // reducedMotion:'reduce' makes the gated media query false — exactly what a
    // motion-stripping client produces. If any copy is invisible here, the
    // fallback rule is broken.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setContent(render(), { waitUntil: 'domcontentloaded' }); // don't wait on CDN fonts/images
    const invisible = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('div,h1,h2,h3,p,a,span,td').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (!t || el.children.length) return;
        const cs = getComputedStyle(el);
        if (Number(cs.opacity) < 0.9 || cs.visibility === 'hidden') {
          // the preheader is hidden BY DESIGN (display:none preview text)
          if (cs.display !== 'none') bad.push(t.slice(0, 40));
        }
      });
      return bad;
    });
    expect(invisible, `copy invisible without animation: ${JSON.stringify(invisible)}`).toEqual([]);
  });

  test(`${name} mailer: depth present, palette untouched`, () => {
    const html = render();
    // Universal depth markers: every design carries the CTA shine face and
    // lifted cards. The radial hero light only exists on solid-colour hero
    // bands — a photo-led hero's depth is the photo itself plus the card lift,
    // so radial-gradient is asserted only where a solid band is guaranteed
    // (the flagship always renders one).
    if (name === 'flagship') expect(html).toContain('radial-gradient');
    expect(html).toContain('linear-gradient(105deg'); // CTA shine face
    expect(html).toContain('box-shadow');             // card/CTA lift
    // No off-palette drift hexes (the documented banned tints).
    for (const bad of ['#0f2a1c', '#d4873a', '#fdf6e8', '#1a3a28', '#1a1a1a', '#faf8f4']) {
      expect(html.toLowerCase()).not.toContain(bad);
    }
  });
}

test('mailer motion never claims scroll effects — email cannot run them', () => {
  const css = motion.emailMotionCss();
  expect(css).not.toMatch(/scroll|IntersectionObserver|addEventListener/i);
});

// ── Rule 2: landing pages — real scroll effects, safely ─────────────────────
test('landing page carries scroll reveals, parallax and 3D tilt', () => {
  const html = brainLanding();
  expect(html).toContain('IntersectionObserver');
  expect(html).toContain('data-plx');
  expect(html).toContain('tilt3d');
  expect(html).toContain('perspective(900px)');
});

test('landing reveals are no-JS safe: hiding requires the runtime marker', () => {
  const html = brainLanding();
  // .sx only hides under html.sx-on, and .sx-on is added by the script itself.
  expect(html).toContain('html.sx-on .sx{opacity:0');
  expect(html).toMatch(/documentElement\.classList\.add\('sx-on'\)/);
  // Every rule that hides .sx must be scoped under html.sx-on. Collect all
  // `.sx{...opacity:0` rule heads and assert each is the sx-on descendant form.
  const hides = html.match(/[^{}]*\.sx\{[^}]*opacity:0[^}]*\}/g) || [];
  expect(hides.length).toBeGreaterThan(0);
  for (const rule of hides) expect(rule).toContain('html.sx-on');
});

test('landing cards are visible with JavaScript disabled', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.setContent(brainLanding());
  const hidden = await page.evaluate(() => {
    return [...document.querySelectorAll('.sx')].filter((el) => Number(getComputedStyle(el).opacity) < 0.9).length;
  });
  await ctx.close();
  expect(hidden, 'scroll-revealed elements must be visible without JS').toBe(0);
});

test('landing respects prefers-reduced-motion for parallax and tilt', () => {
  const html = brainLanding();
  expect(html).toContain('@media (prefers-reduced-motion: reduce)');
  expect(html).toMatch(/prefers-reduced-motion: reduce.*matches/s);
});

// ── Rule 3: static ads — 3D depth stack ─────────────────────────────────────
test('a composed static ad carries the full depth stack', () => {
  // Render a real ad set and assert the depth layers landed in the OUTPUT —
  // stronger than checking the module could produce them.
  const { renderAds } = lib('ad-creative.js');
  const set = renderAds({ productName: 'Turmeric Ashwagandha', headline: 'The ritual, restored', subline: 'Hand-picked at origin', heroImageUrl: 'https://www.vahdam.com/cdn/shop/files/x.jpg', price: '$24.99', market: 'US' });
  const html = JSON.stringify(set);
  expect(html).toContain('radial-gradient(90% 70% at 28% 8%');  // key light
  expect(html).toContain('rgba(0,0,0,.32) 100%');               // vignette
  expect(html).toContain('feTurbulence');                       // film grain
  expect(html).toContain('pointer-events:none');                // layers never block the CTA
  // The layer factory itself: four layers, gold hairline derived from brand gold.
  const layers = motion.adDepthLayers('#AB8743');
  expect(layers).toContain('border:1px solid #AB874359');
  expect((layers.match(/pointer-events:none/g) || []).length).toBe(4);
});

// ── Rule 3b: video unit — true 3D ───────────────────────────────────────────
test('the animated video unit is a perspective scene with Z-separated layers', () => {
  const html = renderMotionAd({ product: 'Turmeric Ashwagandha', cta: 'Shop now', scenes: [{ headline: 'The ritual, restored', seconds: 4 }] });
  expect(html).toContain('perspective:1000px');
  expect(html).toContain('preserve-3d');
  expect(html).toContain('translateZ(-46px)');
  expect(html).toContain('translateZ(34px)');
  // Depth must not touch the animated layers: .ken and .kin keyframes own
  // their transforms, and a class transform there would be clobbered.
  expect(html).not.toMatch(/\.ken\s*\{[^}]*translateZ/);
  expect(html).not.toMatch(/\.kin\s*\{[^}]*translateZ/);
});
