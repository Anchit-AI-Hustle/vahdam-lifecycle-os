const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// SERVICE WORKERS ARE BLOCKED, AND THAT IS NOT A CONVENIENCE.
// auth.js registers sw.js on window 'load' - independent of init() - and its
// controllerchange handler calls location.reload() 50ms later as a deliberate
// PWA self-heal. Any spec that navigates and then reads page state is racing
// that reload: on a loaded machine it lands mid-assertion and the page is gone,
// which surfaces as "Execution context was destroyed, most likely because of a
// navigation". It passes when the file is run alone and fails in the full suite,
// which is what makes it look like a flake instead of a race.
// The SW is not under test here, so it is switched off.
test.use({ serviceWorkers: 'block' });

// motion.js + motion.css — the VAHDAM Motion System, loaded on EVERY page by
// auth.js. Because it runs everywhere and touches nothing by hand, a defect in
// it is a defect on all ~56 documents at once. Each block below pins one clause
// of the safety contract in its source comment, and three of them exist because
// the landing-page motion layer actually shipped those defects
// (tests/vahdam-motion.spec.js records them): everything animating at once,
// clip-path cutting copy mid-word, and motion pulling content out of flow.

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'motion.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'motion.css'), 'utf8');

const PAGE = `<!doctype html><html><head><style>
 body{margin:0;background:#FBF5EA;color:#171717;font-family:Arial}
 nav{position:fixed;top:0;left:0;width:180px;height:100%;background:#FBF5EA}
 .hero{min-height:340px;padding:60px;background:#FBF5EA}
 main{margin-left:190px}
 section{min-height:70vh;padding:40px}
 .card{background:#fff;padding:20px;margin:12px 0;width:400px;height:120px}
 .kpi{background:#fff;padding:16px;width:220px;height:90px}
 button.primary{padding:12px 20px;background:#004A2B;color:#FBF5EA;border:0}
 table{width:100%} td{padding:6px}
</style></head><body>
<nav><a href="#x">Nav link</a><div class="card">chrome card</div><h2>Nav heading</h2></nav>
<main class="site">
  <section class="hero"><h1>Steep the ritual, restore the balance</h1><p>Body copy.</p></section>
  <section id="s1">
    <h2>Best sellers this week</h2>
    <div class="card">Card one</div>
    <div class="card">Card two</div>
    <div class="kpi"><span class="num">12,480</span></div>
    <button class="primary">Explore the collection</button>
    <img src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='160'%3E%3Crect width='300' height='160' fill='%23004A2B'/%3E%3C/svg%3E" width="300" height="160" alt="pack">
    <table><tr><td>Campaign</td><td>4,120</td></tr></table>
  </section>
  <section id="s2"><h2>Origin stories</h2><div class="card">Card three</div></section>
</main></body></html>`;

async function boot(page, { reduced = false, motionOff = false } = {}) {
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://fx.test/motion.css*', (r) =>
    r.fulfill({ contentType: 'text/css', body: CSS }));
  await page.route('**/gsap*', (r) => r.abort());
  const body = motionOff ? PAGE.replace('<html>', '<html data-motion="off">') : PAGE;
  await page.route('https://fx.test/', (r) => r.fulfill({ contentType: 'text/html', body }));
  await page.goto('https://fx.test/');
  await page.addScriptTag({ content: JS });
  await page.waitForTimeout(600);
}

// ── Clause 1: content is never left hidden ──────────────────────────────────
test.describe('content can never get stuck invisible', () => {
  test('every tracked element ends up visible, even without scrolling to it', async ({ page }) => {
    await boot(page);
    // The hard safety timer is 3.5s. Nothing below the fold has been scrolled
    // to, so only that timer can save these — which is the point of it.
    await page.waitForTimeout(3400);
    const hidden = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.vh-rv, .vh-kin'))
        .filter((el) => !el.classList.contains('vh-in'))
        .map((el) => el.tagName + '.' + el.className));
    expect(hidden, 'these would be invisible to the user forever').toEqual([]);
  });

  test('the hiding rule is scoped to .vh-motion-ready, so a failed script leaves text readable', () => {
    // Every rule that sets opacity:0 must be gated on the class the script adds.
    // If the JS 404s, nothing may be hidden.
    const hidingRules = CSS.split('}').filter((r) => /opacity:\s*0\s*;/.test(r) && !/opacity:\s*0\s*!important/.test(r));
    expect(hidingRules.length).toBeGreaterThan(0);
    for (const r of hidingRules) {
      const sel = r.split('{')[0];
      const gated = /vh-motion-ready/.test(sel) || /@keyframes|from|to|%/.test(sel) || /\.vh-(sheen|tilt|spot)/.test(sel);
      expect(gated, `unGATED hiding rule would hide content with no JS:\n${sel}`).toBe(true);
    }
  });
});

// ── Clause 2: no clip-path on text (the "ooth. Rich." defect) ───────────────
test.describe('the mid-word clipping defect cannot come back', () => {
  // NOTE on the fixture image: it must be a VALID image at a real size. An invalid
// data URI renders as a ~46x18 alt-text box, which motion.js correctly rejects as
// an icon — and the test then fails claiming the wipe branch is unreachable when
// the code is right and the fixture is broken.
test('a wipe is only ever assigned to media, never to a text run', async ({ page }) => {
    await boot(page);
    const wiped = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-vh-rv="wipe"]')).map((el) => el.tagName));
    expect(wiped.length, 'the wipe branch should actually be reachable').toBeGreaterThan(0);
    for (const tag of wiped) {
      expect(['IMG', 'PICTURE', 'FIGURE', 'CANVAS', 'VIDEO']).toContain(tag);
    }
  });

  test('no heading or paragraph ever carries a clip-path', async ({ page }) => {
    await boot(page);
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1, h2, h3, p, span, li, td'))
        .filter((el) => {
          const c = getComputedStyle(el).clipPath;
          return c && c !== 'none';
        })
        .map((el) => el.tagName + ':' + el.textContent.slice(0, 20)));
    expect(clipped).toEqual([]);
  });
});

// ── Clause 3: nothing leaves flow ───────────────────────────────────────────
test('page content is never repositioned out of flow', async ({ page }) => {
  await boot(page);
  // Decorative layers ARE fixed on purpose; page content must not be.
  const escaped = await page.evaluate(() =>
    Array.from(document.querySelectorAll('main *'))
      .filter((el) => !el.classList.contains('vh-fx'))
      .filter((el) => {
        const p = getComputedStyle(el).position;
        return p === 'absolute' || p === 'fixed';
      })
      .map((el) => el.tagName + '.' + el.className));
  // .vh-tilt / .vh-spot are promoted to `relative` (needed for their ::after);
  // relative keeps the element in flow, absolute/fixed would not.
  expect(escaped).toEqual([]);
});

// ── Clause 5: chrome is untouched ───────────────────────────────────────────
test('navigation and fixed chrome get no motion at all', async ({ page }) => {
  await boot(page);
  const touched = await page.evaluate(() =>
    document.querySelectorAll('nav .vh-rv, nav .vh-kin, nav .vh-tilt, nav .vh-mag, nav .vh-spot').length);
  expect(touched, 'moving the navigation is how a user loses the way out of a page').toBe(0);
});

// ── Clause 6: word split, never character split ─────────────────────────────
test.describe('kinetic headings stay readable text', () => {
  test('splitting preserves textContent exactly', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => ({
      h1: document.querySelector('.hero h1').textContent,
      split: document.querySelectorAll('.vh-kin .vh-w').length,
    }));
    expect(r.split, 'the heading should actually be split').toBeGreaterThan(3);
    // Byte-identical: find-in-page, copy/paste and every test that reads this
    // heading must be unaffected by the decoration.
    expect(r.h1).toBe('Steep the ritual, restore the balance');
  });

  test('each span holds a whole word, so screen readers and selection still work', async ({ page }) => {
    await boot(page);
    const words = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.hero h1 .vh-w')).map((s) => s.textContent));
    expect(words).toEqual(['Steep', 'the', 'ritual,', 'restore', 'the', 'balance']);
  });

  test('a kinetic heading is not ALSO given a container reveal', async ({ page }) => {
    await boot(page);
    // Two treatments at once blurs the whole line while its words stagger in,
    // leaving the copy unreadable for most of the animation.
    const doubled = await page.evaluate(() =>
      document.querySelectorAll('.vh-kin.vh-rv').length);
    expect(doubled).toBe(0);
  });
});

// ── Humanised timing: nothing moves in lockstep, and it is reproducible ─────
test.describe('motion reads as hand-placed, not generated', () => {
  test('elements do not share one duration, distance, curve or delay', async ({ page }) => {
    await boot(page);
    const v = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.vh-rv')).map((el) => ({
        dur: el.style.getPropertyValue('--vh-dur'),
        dy: el.style.getPropertyValue('--vh-dy'),
        ease: el.style.getPropertyValue('--vh-ease'),
        rot: el.style.getPropertyValue('--vh-rot'),
      })));
    expect(v.length).toBeGreaterThan(3);
    // Uniformity is the tell. If every card shares a value, the page reads as
    // generated even when the individual animation is fine.
    expect(new Set(v.map((x) => x.dur)).size, 'every element had the same duration').toBeGreaterThan(1);
    expect(new Set(v.map((x) => x.dy)).size, 'every element travelled the same distance').toBeGreaterThan(1);
    expect(new Set(v.map((x) => x.rot)).size, 'every element arrived at the same angle').toBeGreaterThan(1);
    // Angles stay sub-degree: a visible tilt on a data card reads as broken CSS.
    for (const x of v) expect(Math.abs(parseFloat(x.rot))).toBeLessThan(1.2);
  });

  test('the variance is seeded, so a re-scan cannot re-roll it', async ({ page }) => {
    // Math.random() would give different numbers on every MutationObserver
    // re-scan, so an element could re-animate with new values mid-page and no
    // test could ever pin the behaviour.
    await boot(page);
    const first = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.vh-rv')).map((el) => el.style.getPropertyValue('--vh-dur')));
    await page.reload();
    await page.addScriptTag({ content: JS });
    await page.waitForTimeout(600);
    const second = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.vh-rv')).map((el) => el.style.getPropertyValue('--vh-dur')));
    expect(second).toEqual(first);
  });

  test('a heading arrives with speech rhythm, pausing at punctuation', async ({ page }) => {
    await boot(page);
    const d = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.hero h1 .vh-w'))
        .map((s) => ({ w: s.textContent, at: parseFloat(s.style.getPropertyValue('--vh-wd')) })));
    // "Steep the ritual, restore the balance" — the gap after "ritual," must be
    // larger than the gaps around it, the way it would be read aloud.
    const gap = (i) => d[i + 1].at - d[i].at;
    const commaIdx = d.findIndex((x) => x.w.endsWith(','));
    expect(commaIdx).toBeGreaterThan(-1);
    expect(gap(commaIdx), 'no breath taken at the comma').toBeGreaterThan(gap(commaIdx - 1));
    // And the whole line still lands fast enough not to be a wait.
    expect(d[d.length - 1].at).toBeLessThanOrEqual(900);
  });

  test('the tilt is eased in JS, so CSS must not also transition transform', () => {
    // Two easings stacked on one property produces a rubbery double-settle.
    const tiltRule = CSS.slice(CSS.indexOf('.vh-tilt {'), CSS.indexOf('.vh-tilt.vh-tilting'));
    expect(tiltRule).not.toMatch(/transition:[^;]*transform/);
  });
});

// ── Clause 7: decorative layers cannot be clicked ───────────────────────────
test.describe('decorative layers are inert', () => {
  test('every injected layer is pointer-events:none and aria-hidden', async ({ page }) => {
    await boot(page);
    const layers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.vh-fx')).map((el) => ({
        cls: el.className,
        pe: getComputedStyle(el).pointerEvents,
        aria: el.getAttribute('aria-hidden'),
      })));
    expect(layers.length).toBeGreaterThan(0);
    for (const l of layers) {
      expect(l.pe, `${l.cls} would swallow clicks`).toBe('none');
      expect(l.aria, `${l.cls} would be announced to screen readers`).toBe('true');
    }
  });

  test('a button under the grain and beam is still clickable', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.__clicked = false;
      document.querySelector('button.primary')
        .addEventListener('click', () => { window.__clicked = true; });
    });
    await page.locator('button.primary').click();
    expect(await page.evaluate(() => window.__clicked)).toBe(true);
  });
});

// ── Numbers must survive their own decoration ───────────────────────────────
test('a counting number settles on the EXACT original string', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.getElementById('s1').scrollIntoView());
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('.kpi .num').textContent), { timeout: 6000 }).toBe('12,480');
});

// ── Brand + contrast ────────────────────────────────────────────────────────
test.describe('brand constants and WCAG-AA survive the atmosphere', () => {
  test('motion.css uses only the four brand colours', () => {
    const hexes = CSS.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    const allowed = new Set(['#004A2B', '#AB8743', '#171717', '#FBF5EA']);
    for (const h of hexes) expect(allowed, `off-palette colour ${h}`).toContain(h.toUpperCase());
  });

  test('no dark-neutral section background is painted (master spec HARD rule)', () => {
    expect(CSS).not.toMatch(/background(-color)?\s*:\s*#171717/i);
    expect(CSS).not.toMatch(/background\s*:\s*(#000|black)/i);
  });

  test('body text over the aurora + grain still clears AA', async ({ page }) => {
    await boot(page);
    await page.waitForTimeout(900); // let the aurora settle into its drift
    const shot = await page.screenshot({ clip: { x: 200, y: 40, width: 700, height: 300 } });
    const { rgbAt, contrast } = sampler(shot);
    // Flat hero background, well away from any glyph. Text is #171717 by page CSS.
    const bg = rgbAt(600, 260);
    const ratio = contrast(bg, [0x17, 0x17, 0x17]);
    expect(ratio, `hero background ${bg} vs #171717 body text dropped below AA`).toBeGreaterThanOrEqual(4.5);
  });
});

// ── The off switches, each independently sufficient ─────────────────────────
test.describe('every off switch fully restores a static, readable page', () => {
  test('prefers-reduced-motion: nothing is hidden and nothing animates', async ({ page }) => {
    await boot(page, { reduced: true });
    const r = await page.evaluate(() => ({
      reduce: document.documentElement.classList.contains('vh-reduce'),
      ready: document.documentElement.classList.contains('vh-motion-ready'),
      grain: !!document.querySelector('.vh-grain'),
      beam: !!document.querySelector('.vh-beam'),
      hiddenText: Array.from(document.querySelectorAll('main h1, main h2, main p, .card'))
        .filter((el) => parseFloat(getComputedStyle(el).opacity) < 1).length,
    }));
    expect(r.reduce).toBe(true);
    expect(r.ready, 'the reveal machinery must never even arm').toBe(false);
    // Infinite ambient loops are the ones that trigger vestibular symptoms.
    expect(r.grain).toBe(false);
    expect(r.beam).toBe(false);
    expect(r.hiddenText).toBe(0);
  });

  test('data-motion="off" leaves the page completely untouched', async ({ page }) => {
    await boot(page, { motionOff: true });
    const r = await page.evaluate(() => ({
      ready: document.documentElement.classList.contains('vh-motion-ready'),
      any: document.querySelectorAll('.vh-rv, .vh-kin, .vh-fx, .vh-tilt').length,
      hidden: Array.from(document.querySelectorAll('main *'))
        .filter((el) => parseFloat(getComputedStyle(el).opacity) < 1).length,
    }));
    expect(r.ready).toBe(false);
    expect(r.any).toBe(0);
    expect(r.hidden).toBe(0);
  });

  test('the stylesheet still loads under reduced motion', async ({ page }) => {
    // It carries the @media block that force-clears any motion class already in
    // the markup. Withholding it would leave an authored .vh-rv faded forever.
    await boot(page, { reduced: true });
    expect(await page.evaluate(() =>
      !!document.querySelector('link[data-vh-motion-css]'))).toBe(true);
  });
});

// ── Minimal PNG sampler (no dependency) ─────────────────────────────────────
// Screenshots come back as PNG; Playwright has no pixel API, so decode the one
// thing needed: an RGBA value at (x, y). Chromium writes a single non-interlaced
// 8-bit RGBA IDAT, so this stays small.
function sampler(buf) {
  const zlib = require('zlib');
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('unexpected PNG bit depth ' + bitDepth);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error('unexpected PNG colour type ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  // Undo the per-scanline PNG filters.
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= channels && y > 0) ? out[(y - 1) * stride + x - channels] : 0;
      let v = src[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += Math.floor((a + b) / 2);
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  const rgbAt = (x, y) => {
    const i = y * stride + x * channels;
    return [out[i], out[i + 1], out[i + 2]];
  };
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  return { rgbAt, contrast };
}

// ── The selectors must match the markup this app actually ships ─────────────
test.describe('coverage is measured against real markup, not a friendly fixture', () => {
  test('no selector is scoped to <main>, because no page in this app has one', () => {
    // Measured on the real production HTML of six pages: NONE uses a <main>
    // element. Every `main h1` / `main img` selector therefore matched exactly
    // zero nodes, so kinetic headings and the media wipe were dead app-wide —
    // while the synthetic fixture above, which DOES use <main>, reported them
    // working. That gap between fixture and reality is the bug this pins.
    const selectorBlocks = [
      JS.slice(JS.indexOf('var REVEAL_SEL'), JS.indexOf('var MEDIA_TAGS')),
      JS.slice(JS.indexOf('function scanKinetic'), JS.indexOf('function scanKinetic') + 400),
    ].join('\n');
    expect(selectorBlocks, 'a main-scoped selector matches nothing in this app').not.toMatch(/['"`]\s*main\s+/);
  });

  test('real page markup gets reveals, and nothing is left hidden', async ({ page }) => {
    // A stripped-down copy of the shape real pages use: no <main>, panels rather
    // than cards, headings outside any landmark.
    const REAL_SHAPE = `<!doctype html><html><head><style>
      body{margin:0;background:#FBF5EA;color:#171717}
      .wrap{padding:24px}.panel{background:#fff;padding:18px;margin:14px 0;height:140px}
      .tab{display:none}.tab.on{display:block}
    </style></head><body>
      <div id="lifecycle-nav"><a href="#a">Rail</a></div>
      <div class="wrap">
        <h1>Ad campaigns master dashboard</h1>
        <div class="panel">Visible panel</div>
        <div class="tab on"><h2>Spend pacing</h2><div class="panel">Open tab panel</div></div>
        <div class="tab"><h2>Creative studio</h2><div class="panel">Hidden tab panel</div></div>
      </div></body></html>`;
    await page.route('https://fx.test/motion.css*', (r) => r.fulfill({ contentType: 'text/css', body: CSS }));
    await page.route('https://fx.test/', (r) => r.fulfill({ contentType: 'text/html', body: REAL_SHAPE }));
    await page.goto('https://fx.test/');
    await page.addScriptTag({ content: JS });
    await page.waitForTimeout(700);

    const r = await page.evaluate(() => ({
      rv: document.querySelectorAll('.vh-rv').length,
      kin: document.querySelectorAll('.vh-kin').length,
      railTouched: document.querySelectorAll('#lifecycle-nav .vh-rv, #lifecycle-nav .vh-kin').length,
    }));
    expect(r.rv, 'a page with no <main> got no reveals').toBeGreaterThan(1);
    expect(r.kin, 'headings outside a landmark got no kinetic treatment').toBeGreaterThan(0);
    expect(r.railTouched, 'the LHS rail must stay untouched even unscoped').toBe(0);

    // Reveal the hidden tab the way the real dashboards do — a class toggle,
    // which a childList-only MutationObserver never sees.
    //
    // Note what is NOT asserted here: that the reveal COUNT goes up. An element
    // inside a display:none ANCESTOR still reports its own `display: block`, so
    // hidden tab panels are already tracked at boot. The count is therefore the
    // wrong probe. What matters, and what actually broke, is that a panel which
    // was never on screen when its observer fired ends up VISIBLE once its tab
    // opens rather than stranded at opacity 0.
    await page.evaluate(() => {
      document.querySelector('.tab.on').classList.remove('on');
      document.querySelectorAll('.tab')[1].classList.add('on');
    });
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => {
      const shown = document.querySelectorAll('.tab')[1];
      const inside = Array.from(shown.querySelectorAll('.vh-rv, .vh-kin'));
      return {
        tracked: inside.length,
        invisible: inside.filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.01).length,
        anyStuckOnPage: Array.from(document.querySelectorAll('.vh-rv, .vh-kin'))
          .filter((el) => el.offsetParent !== null && parseFloat(getComputedStyle(el).opacity) < 0.01).length,
      };
    });
    expect(after.tracked, 'the newly opened tab has no tracked content at all').toBeGreaterThan(0);
    expect(after.invisible, 'a newly opened tab left its own content invisible').toBe(0);
    expect(after.anyStuckOnPage, 'switching tabs stranded content at opacity 0').toBe(0);
  });
});
