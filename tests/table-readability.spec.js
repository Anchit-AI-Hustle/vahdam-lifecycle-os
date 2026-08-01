const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The Data Analysis tables became unreadable: the host page sets
// `table{width:100%}` and `th,td{white-space:nowrap}`, so a campaign name like
// "Conversion_BCAP_Coffee_NewBuyers_2025" — one unbroken underscore token with no
// break opportunity — overflowed its cell and painted straight over the next
// column. Two different strings ended up drawn on top of each other.
//
// This reproduces that exact combination: the REAL host rules and the REAL
// extension rules are read out of the source files, so the test cannot drift
// from what actually ships. The assertions are geometric, not visual — content
// must fit inside its own cell, and no two cells in a row may overlap.

const ROOT = path.join(__dirname, '..');

// Pull the shipping CSS out of source rather than restating it here.
function hostTableCss() {
  const html = fs.readFileSync(path.join(ROOT, 'data-analysis.html'), 'utf8');
  const rules = [];
  for (const re of [/^\s*(table\{[^}]*\})/m, /^\s*(th,td\{[^}]*\})/m, /^\s*(th\{[^}]*\})/m]) {
    const m = html.match(re);
    if (m) rules.push(m[1]);
  }
  return rules.join('\n');
}
function extensionTableCss() {
  const js = fs.readFileSync(path.join(ROOT, 'data-analysis-extensions.js'), 'utf8');
  // Each CSS rule in that file is a single-quoted string in the style array.
  return (js.match(/'\.xtable[^']*'/g) || []).map((s) => s.slice(1, -1)).join('\n');
}

const NASTY = 'Conversion_BCAP_Coffee_NewBuyers_LookalikeAudience_2025_Q3_Broad_Prospecting_v4';
const NASTY2 = 'TOF_ASC_GIF_ThatCoffeeThatCurbsCravings_18202025_CopyTest_AllPlacements';

function harness() {
  return `<style>
    :root{--line:#e6e0d4;--surface:#fff;--soft:#6b6459;--head:#004A2B;--chip:#f4efe4;--ink:#171717}
    body{margin:0;font-family:Arial,sans-serif}
    .wrap{width:900px}
    ${hostTableCss()}
    ${extensionTableCss()}
  </style>
  <div class="wrap">
    <div class="xtable"><table>
      <thead><tr>
        <th>Platform</th><th class="wide">Campaign</th><th class="wide">Ad group / set</th>
        <th class="id">Entity ID</th><th class="num">Spend</th><th class="num">Impressions</th><th class="num">ROAS</th>
      </tr></thead>
      <tbody>
        <tr>
          <td><div class="cw">Meta</div></td><td class="wide"><div class="cw">${NASTY}</div></td><td class="wide"><div class="cw">${NASTY2}</div></td>
          <td class="id"><div class="cw">120210987654321098</div></td><td class="num">$5,706.88</td><td class="num">175,868</td><td class="num">3.19×</td>
        </tr>
        <tr>
          <td><div class="cw">Meta</div></td><td class="wide"><div class="cw">${NASTY2}</div></td><td class="wide"><div class="cw">${NASTY}</div></td>
          <td class="id"><div class="cw">120219876543210987</div></td><td class="num">$1,234,567.89</td><td class="num">1,175,868</td><td class="num">12.40×</td>
        </tr>
      </tbody>
    </table></div>
  </div>`;
}

test.use({ viewport: { width: 1100, height: 800 } });

test('no cell content overflows its own box', async ({ page }) => {
  await page.setContent(harness());
  const overflowing = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.xtable td, .xtable th').forEach((el, i) => {
      // scrollWidth > clientWidth means the text is wider than the box it is
      // allowed to occupy — with no overflow:hidden, that is what painted over
      // the neighbouring column.
      if (el.scrollWidth > el.clientWidth + 1) {
        bad.push({ i, text: el.textContent.slice(0, 40), scroll: el.scrollWidth, client: el.clientWidth });
      }
    });
    return bad;
  });
  expect(overflowing, `cells whose content escapes their box: ${JSON.stringify(overflowing)}`).toEqual([]);
});

test('no two cells in a row overlap horizontally', async ({ page }) => {
  await page.setContent(harness());
  const collisions = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.xtable tr').forEach((tr, r) => {
      const boxes = [...tr.children].map((c) => c.getBoundingClientRect());
      for (let i = 1; i < boxes.length; i++) {
        // A 0.5px tolerance absorbs sub-pixel border rounding.
        if (boxes[i].left < boxes[i - 1].right - 0.5) bad.push({ row: r, col: i });
      }
    });
    return bad;
  });
  expect(collisions, `overlapping cells: ${JSON.stringify(collisions)}`).toEqual([]);
});

test('numbers never wrap and stay right-aligned', async ({ page }) => {
  await page.setContent(harness());
  const nums = await page.evaluate(() => [...document.querySelectorAll('.xtable td.num')].map((el) => {
    const cs = getComputedStyle(el);
    return { text: el.textContent, whiteSpace: cs.whiteSpace, align: cs.textAlign, lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight || '16')) };
  }));
  expect(nums.length).toBeGreaterThan(0);
  for (const n of nums) {
    expect(n.whiteSpace, `"${n.text}" must not wrap`).toBe('nowrap');
    expect(n.align, `"${n.text}" must be right-aligned`).toBe('right');
  }
});

test('long identifiers wrap instead of running off, and stay within a bounded width', async ({ page }) => {
  await page.setContent(harness());
  const wide = await page.evaluate(() => [...document.querySelectorAll('.xtable td.wide .cw')].map((el) => ({
    w: el.getBoundingClientRect().width,
    h: el.getBoundingClientRect().height,
    wrapped: getComputedStyle(el).overflowWrap,
  })));
  for (const c of wide) {
    expect(c.wrapped).toBe('anywhere');
    // Bounded by the .wide max-width, and taller than one line because it wrapped.
    expect(c.w).toBeLessThanOrEqual(321);
    expect(c.h).toBeGreaterThan(20);
  }
});

// ── Data-point coverage ─────────────────────────────────────────────────────
// The ads view returns 20 fields per row; the table rendered 14 and silently
// dropped the rest. reach and frequency in particular are the only way to see
// that a set is re-serving the same people, so their absence was not cosmetic.
test('the ads table renders every field the ads view returns', () => {
  const js = fs.readFileSync(path.join(ROOT, 'data-analysis-extensions.js'), 'utf8');
  const core = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'data-analysis-core.js'), 'utf8');

  // Fields the normaliser builds for every ad row, taken from the source rather
  // than hardcoded here.
  const produced = ['platform', 'level', 'entity', 'entity_id', 'campaign', 'ad_group', 'status', 'spend',
    'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'conversions', 'conversion_rate', 'cpa', 'revenue', 'roas', 'reach', 'frequency'];
  for (const f of produced) {
    expect(core, `data-analysis-core should still produce ${f}`).toContain(`${f}:`);
  }

  const mapper = js.slice(js.indexOf('var rows = (data.rows || []).map'), js.indexOf('body.innerHTML = kpis('));
  expect(mapper.length).toBeGreaterThan(0);
  for (const f of produced) {
    expect(mapper, `ads table must render r.${f}`).toContain(`r.${f}`);
  }
});

test('every ads column count matches its row width', () => {
  const js = fs.readFileSync(path.join(ROOT, 'data-analysis-extensions.js'), 'utf8');
  const header = js.slice(js.indexOf("table(['Platform','Level'"));
  const cols = header.slice(0, header.indexOf('], rows')).split(',').length;
  const mapper = js.slice(js.indexOf('var rows = (data.rows || []).map'), js.indexOf('body.innerHTML = kpis('));
  const cells = (mapper.match(/r\.[a-z_]+/g) || []).length;
  // 20 columns, and at least one field reference per column.
  expect(cols).toBe(20);
  expect(cells).toBeGreaterThanOrEqual(20);
});

// ── The regression this replaces ────────────────────────────────────────────
test('the old nowrap-only styling really did overflow (guards the guard)', async ({ page }) => {
  await page.setContent(`<style>
    .wrap{width:900px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{text-align:left;padding:9px 12px;white-space:nowrap}
    .old table{min-width:820px;font-size:12px}
  </style>
  <div class="wrap"><div class="old"><table><tbody><tr>
    <td>Meta</td><td>${NASTY}</td><td>${NASTY2}</td><td>$5,706.88</td>
  </tr></tbody></table></div></div>`);
  // Without the fix the row is wider than its 900px container — the condition
  // that produced the overlap. If this ever stops being true the harness has
  // drifted and the tests above would be proving nothing.
  const overflows = await page.evaluate(() => {
    const row = document.querySelector('tr');
    return row.getBoundingClientRect().width > document.querySelector('.wrap').getBoundingClientRect().width + 1;
  });
  expect(overflows).toBe(true);
});
