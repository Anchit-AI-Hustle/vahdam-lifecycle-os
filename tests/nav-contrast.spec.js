const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The LHS nav went unreadable twice over: gold text on the cream rail (2.99:1)
// and, worst of all, a near-black burger button on the near-black mobile bar
// (#171717 on rgba(7,14,11,0.97) = 1.09:1). That burger is the control that OPENS
// the menu, so an invisible burger presents as "the LHS menu is not showing" —
// the feature looks deleted when only its contrast is wrong.
//
// This reads the REAL colours out of auth.js and asserts the ratio, because the
// palette makes one mistake very easy to repeat: #AB8743 gold is 2.99:1 on the
// cream rail and can therefore NEVER carry text there, only borders and fills.

const ROOT = path.join(__dirname, '..');
const RAIL = '#f4f2ec';       // .lnav-side background
const MOBILE_BAR = '#070e0b'; // .lnav-mbar background, opaque enough to treat as flat
const GREEN = '#004A2B';      // .lnav-link.active fill

function lum(hex) {
  const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(fg, bg) {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function flatten(rgba, base) {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  const bb = base.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
  return '#' + [0, 1, 2].map((i) =>
    Math.round(Number(m[i + 1]) * alpha + bb[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}
function navCss() {
  const src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  const a = src.indexOf('#lifecycle-nav { font-family');
  const b = src.indexOf('</style>', a);
  expect(a, 'the nav style block must still be findable in auth.js').toBeGreaterThan(-1);
  return src.slice(a, b);
}
// Text that sits on the green active fill rather than the cream rail.
const ON_GREEN = /lnav-avatar|lnav-link\.active(?!.*ghead)/;
function backdropFor(sel) {
  if (/mbar|burger|mbrand/.test(sel)) return MOBILE_BAR;
  if (ON_GREEN.test(sel)) return GREEN;
  return RAIL;
}

test('every coloured nav rule clears WCAG AA against the surface it sits on', () => {
  const css = navCss();
  const low = [];
  for (const m of css.matchAll(/([#.][a-z0-9-][^{]*)\{([^}]*)\}/gi)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    const decl = m[2].match(/(?:^|[;\s])color:\s*([^;]+)/);
    if (!decl) continue;
    let fg = decl[1].trim();
    const bg = backdropFor(sel);
    if (/^rgba?\(/.test(fg)) fg = flatten(fg, bg);
    if (!/^#[0-9a-f]{6}$/i.test(fg || '')) continue;
    const r = ratio(fg, bg);
    // Icons are non-text UI components: WCAG asks 3:1, not 4.5:1. The active
    // row's gold icon on green is 3.12:1 and is deliberately an accent.
    const floor = /lnav-ic\b/.test(sel) ? 3 : 4.5;
    if (r < floor) low.push(`${sel} -> ${fg} on ${bg} = ${r.toFixed(2)}:1 (needs ${floor})`);
  }
  expect(low, `nav rules below AA:\n${low.join('\n')}`).toEqual([]);
});

test('the mobile burger is bright on the dark bar, never dark-on-dark', () => {
  const css = navCss();
  const rule = css.match(/\.lnav-burger\s*\{([^}]*)\}/);
  expect(rule, '.lnav-burger rule must exist').toBeTruthy();
  const color = rule[1].match(/(?:^|[;\s])color:\s*([^;]+)/)[1].trim();
  const r = ratio(color, MOBILE_BAR);
  expect(r, `burger ${color} on ${MOBILE_BAR} is ${r.toFixed(2)}:1 — it must stay clearly visible, it is the only way to open the menu`).toBeGreaterThanOrEqual(4.5);
});

test('gold never carries text on the cream rail', () => {
  const css = navCss();
  // Guard the specific mistake, not just the aggregate: #AB8743 is 2.99:1 here.
  const offenders = [];
  for (const m of css.matchAll(/([#.][a-z0-9-][^{]*)\{([^}]*)\}/gi)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (backdropFor(sel) !== RAIL) continue;
    if (/lnav-ic\b/.test(sel)) continue; // icons: 3:1 applies
    const decl = m[2].match(/(?:^|[;\s])color:\s*(#AB8743|#ab8743)\s*;/);
    if (decl) offenders.push(sel);
  }
  expect(offenders, `these use gold as text on the cream rail (2.99:1): ${offenders.join(', ')}`).toEqual([]);
});
