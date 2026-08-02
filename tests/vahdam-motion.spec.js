const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// landing-pages/vahdam-motion.js — the attribute-driven motion layer for cloned
// landing pages (Ashwagandha Coffee+ US and successors). It exists because the
// previous global-selector layer produced three defects on that page: every
// section animating at once, clip-path masks cutting copy mid-word ("ooth.
// Rich."), and position-based motion pulling sections out of flow so they
// stacked. Each rule below is one of those defects, pinned so it cannot return.

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'landing-pages', 'vahdam-motion.js'), 'utf8');

// Tall fixture: hero above the fold, the rest pushed below it so the
// IntersectionObserver genuinely has to fire on scroll.
const FIXTURE = `<!doctype html><html><head><style>
  body{margin:0}
  section{min-height:60vh;padding:20px}
  .plain{clip-path:none}
  .legacy-clip{clip-path:inset(0 40% 0 0)}
</style></head><body>
  <section data-vm="hero" id="hero"><h1>Smooth. Rich. Calming.</h1></section>
  <section class="plain" id="untouched"><p>No data-vm here.</p></section>
  <div data-vm="spiral" id="spiral">
    <div class="legacy-clip">Ashwagandha</div><div>L-Theanine</div><div>Arabica</div>
  </div>
  <ol data-vm="stagger" id="steps"><li>Heat</li><li>Stir</li><li>Sip</li></ol>
  <section data-vm="fade" id="facts"><table><tr><td>Supplement Facts</td></tr></table></section>
  <section data-vm="fade-up" id="daily"><p>2 Cups Daily</p></section>
  <ul data-vm="reviews" id="reviews"><li>“Calmer mornings.”</li><li>“No crash.”</li></ul>
</body></html>`;

async function boot(page, { reducedMotion } = {}) {
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setContent(FIXTURE);
  await page.addScriptTag({ content: SRC });
}

test.describe('opt-in only — nothing moves without data-vm', () => {
  test('an element without the attribute is never touched', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const el = document.getElementById('untouched');
      return {
        move: el.hasAttribute('data-vm-move'),
        fade: el.hasAttribute('data-vm-fade'),
        opacity: getComputedStyle(el).opacity,
      };
    });
    expect(r.move).toBe(false);
    expect(r.fade).toBe(false);
    expect(r.opacity).toBe('1');
  });

  test('the source contains no global animation selectors', () => {
    // The stylesheet may only target the attributes the module itself sets.
    const css = SRC.slice(SRC.indexOf('function injectStyles'), SRC.indexOf('function itemsOf'));
    expect(css).not.toMatch(/'\s*section\s*[{,]/);
    expect(css).not.toMatch(/'\s*\*\s*\{/);
    expect(css).not.toMatch(/'\s*body\b/);
  });
});

test.describe('the clipping defect cannot come back', () => {
  test('clip-path and mask are nullified inside every animated subtree', async ({ page }) => {
    await boot(page);
    const clip = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#spiral .legacy-clip')).clipPath);
    expect(clip).toBe('none'); // fixture sets inset(0 40% 0 0); the module must win
  });
});

test.describe('flow is never broken — transforms and opacity only', () => {
  test('fade type emits no transform property at all', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const el = document.getElementById('facts');
      return { transform: getComputedStyle(el).transform, inline: el.style.transform };
    });
    expect(r.transform).toBe('none');
    expect(r.inline).toBe('');
  });

  test('no animated element leaves document flow', async ({ page }) => {
    await boot(page);
    const positions = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-vm], [data-vm] *'))
        .map((el) => getComputedStyle(el).position)
        .filter((p) => p === 'absolute' || p === 'fixed'));
    expect(positions).toEqual([]);
  });
});

test.describe('reveal behaviour', () => {
  test('below-fold content is hidden by JS, then reveals on scroll', async ({ page }) => {
    await boot(page);
    const marked = await page.evaluate(() =>
      document.querySelector('#reviews li').hasAttribute('data-vm-move'));
    expect(marked).toBe(true);
    // Injected after first paint, the hide itself transitions 1 -> 0 here
    // (on a real page the deferred script hides before paint), so poll for
    // the settled hidden state rather than sampling instantly.
    await expect
      .poll(() => page.evaluate(() =>
        getComputedStyle(document.querySelector('#reviews li')).opacity), { timeout: 8000 })
      .toBe('0');

    await page.evaluate(() => document.getElementById('reviews').scrollIntoView());
    await expect
      .poll(() => page.evaluate(() =>
        getComputedStyle(document.querySelector('#reviews li')).opacity), { timeout: 8000 })
      .toBe('1');
    const state = await page.evaluate(() =>
      document.querySelector('#reviews li').getAttribute('data-vm-state'));
    expect(state).toBe('in');
  });

  test('prefers-reduced-motion reveals everything instantly', async ({ page }) => {
    await boot(page, { reducedMotion: true });
    const opacities = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-vm-move], [data-vm-fade]'))
        .map((el) => getComputedStyle(el).opacity));
    expect(opacities.length).toBeGreaterThan(0);
    for (const o of opacities) expect(o).toBe('1');
  });

  test('hidden state is written by JS, not CSS — no-JS renders readable', () => {
    // The injected stylesheet must never contain a hiding rule; hiding happens
    // only via inline --vm-o:0, which cannot exist if the script never ran.
    const css = SRC.slice(SRC.indexOf('var css'), SRC.indexOf('var style'));
    expect(css).toContain('--vm-o,1'); // visible default
    expect(css).not.toMatch(/opacity\s*:\s*0/);
  });
});
