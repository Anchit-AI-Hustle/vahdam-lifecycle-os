const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The ad tables were literally unreadable: campaign and entity identifiers are
// long unbroken tokens (TOF_ASC_WeightLoss_Menopause_Coffee_..., and 18-digit
// entity ids) that overflowed their column and painted over the next one, so
// Spend and Impressions rendered as "$17,938.7870,485".
//
// The CSS looked like it handled it - `td{max-width:520px}` - but a max-width
// on a <td> is IGNORED under auto table layout. It only takes effect on a block
// INSIDE the cell. data-analysis-extensions.js had already learned this and
// fixed it with a `.cw` inner block; ad-campaigns-master.html has its own
// table() and never got the fix, and the `.cw` class its callers were already
// emitting had no CSS in this page at all.
//
// Geometry is the only honest test here: a source check cannot prove two cells
// do not overlap on screen.

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'ad-campaigns-master.html'), 'utf8');

test('the ignored max-width on the td is gone', () => {
  expect(SRC, 'td still carries a max-width, which auto table layout ignores')
    .not.toMatch(/td\{white-space:normal;max-width:520px\}/);
});

test('the bounding block and the numeric rule both exist', () => {
  expect(SRC).toMatch(/\.cw\{max-width:\d+px;overflow-wrap:anywhere/);
  expect(SRC).toMatch(/td\.num,th\.num\{white-space:nowrap/);
  // The classes the callers were already writing must now resolve to CSS.
  expect(SRC).toMatch(/\.cw\.wide/);
  expect(SRC).toMatch(/\.cw\.id/);
});

test('a cell that already carries its own .cw is not wrapped again', () => {
  // Nesting a 320px block inside a 240px one overflows exactly as before.
  expect(SRC).toMatch(/var already = \/class=/);
});

// ── Geometry: render the real table markup and measure it ───────────────────
test.describe('no cell paints over its neighbour', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'layout test, one engine');

  // Pull the page's own <style> so the test measures the REAL CSS, not a copy.
  function pageCss() {
    const blocks = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
    return blocks.map((b) => b.replace(/<\/?style[^>]*>/gi, '')).join('\n');
  }

  // The worst real row from the snapshot: long campaign token, 18-digit id.
  const ROW = {
    platform: 'META', level: 'ad', entity: 'TOF_ASC_WeightLoss_Menopause_Coffee_WeightGain_12062025',
    entity_id: '120240649869720711',
    campaign: 'TOF_ASC_Ashwagandha_Coffee_WeightLoss_Creatives_Set3_12062025',
    ad_group: 'Ashwagandha_Coffee_WeightLoss_CreativesSet3_12062025',
    spend: '$17,938.78', impressions: '870,485', reach: '392,015',
  };

  async function build(page) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${pageCss()}</style></head><body>
      <table data-sortable><thead><tr>
        <th>Platform</th><th>Level</th><th class="wide">Entity</th><th class="id">Entity ID</th>
        <th class="wide">Campaign</th><th class="wide">Ad group / set</th>
        <th class="num">Spend</th><th class="num">Impressions</th><th class="num">Reach</th>
      </tr></thead><tbody><tr>
        <td><div class="cw">${ROW.platform}</div></td>
        <td><div class="cw">${ROW.level}</div></td>
        <td class="wide"><div class="cw wide">${ROW.entity}</div></td>
        <td class="id"><div class="cw id">${ROW.entity_id}</div></td>
        <td class="wide"><div class="cw wide">${ROW.campaign}</div></td>
        <td class="wide"><div class="cw wide">${ROW.ad_group}</div></td>
        <td class="num">${ROW.spend}</td>
        <td class="num">${ROW.impressions}</td>
        <td class="num">${ROW.reach}</td>
      </tr></tbody></table></body></html>`;
    await page.setContent(html);
    return page.locator('tbody tr td');
  }

  test('no two cells in a row overlap horizontally', async ({ page }) => {
    const cells = await build(page);
    const boxes = [];
    const n = await cells.count();
    for (let i = 0; i < n; i++) boxes.push(await cells.nth(i).boundingBox());
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1], cur = boxes[i];
      // Allow a sub-pixel rounding tolerance, nothing more.
      expect(prev.x + prev.width, `cell ${i - 1} overlaps cell ${i}`).toBeLessThanOrEqual(cur.x + 0.5);
    }
  });

  test('the bounding block is actually bounded', async ({ page }) => {
    // The assertion with real teeth, measured both ways: under the OLD css the
    // .cw div rendered 910px wide because nothing constrained it (the table
    // simply grew). Capping it is what stops 20 columns colliding once the
    // table CANNOT grow, which is the real page's situation.
    await build(page);
    const widths = await page.evaluate(() => Array.from(document.querySelectorAll('tbody .cw'))
      .map((el) => Math.round(el.getBoundingClientRect().width)));
    for (const w of widths) expect(w, `an unbounded .cw at ${w}px`).toBeLessThanOrEqual(321);
  });

  test('twenty columns in a real-width table still do not collide', async ({ page }) => {
    // A three-column table can always grow to fit. The defect only appears at
    // the real column count inside a real container, so reproduce that.
    const NUM = ['Spend', 'Impressions', 'Reach', 'Frequency', 'Clicks', 'CTR', 'CPC', 'CPM', 'Conversions', 'CVR', 'CPA', 'Revenue', 'ROAS'];
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${pageCss()}
      .wrapper{width:1180px;overflow:hidden}</style></head><body><div class="wrapper">
      <table><thead><tr>
        <th>Platform</th><th>Level</th><th class="wide">Entity</th><th class="id">Entity ID</th>
        <th class="wide">Campaign</th><th class="wide">Ad group / set</th><th>Status</th>
        ${NUM.map((n) => `<th class="num">${n}</th>`).join('')}
      </tr></thead><tbody><tr>
        <td><div class="cw">META</div></td><td><div class="cw">ad</div></td>
        <td class="wide"><div class="cw wide">${ROW.entity}</div></td>
        <td class="id"><div class="cw id">${ROW.entity_id}</div></td>
        <td class="wide"><div class="cw wide">${ROW.campaign}</div></td>
        <td class="wide"><div class="cw wide">${ROW.ad_group}</div></td>
        <td><div class="cw">ACTIVE</div></td>
        ${NUM.map((_, i) => `<td class="num">${i === 0 ? '$17,938.78' : '870,485'}</td>`).join('')}
      </tr></tbody></table></div></body></html>`;
    await page.setContent(html);
    const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('tbody td'))
      .map((td) => { const r = td.getBoundingClientRect(); return { x: r.x, w: r.width, t: td.textContent.trim().slice(0, 24) }; }));
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i - 1].x + boxes[i - 1].w,
        `"${boxes[i - 1].t}" overlaps "${boxes[i].t}"`).toBeLessThanOrEqual(boxes[i].x + 0.5);
    }
    // And nothing may be squeezed to nothing, which is the other way a table
    // "stops overlapping" while still being unreadable.
    for (const b of boxes) expect(b.w, `"${b.t}" collapsed to ${b.w}px`).toBeGreaterThan(8);
  });

  test('the long identifier actually wraps rather than running on', async ({ page }) => {
    await build(page);
    const h = await page.evaluate(() => {
      const el = document.querySelectorAll('tbody td')[4].querySelector('.cw'); // Campaign
      return { height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width, line: parseFloat(getComputedStyle(el).lineHeight) || 16 };
    });
    expect(h.width, 'the bounding block is not bounded').toBeLessThanOrEqual(321);
    expect(h.height, 'a 60-char token on one line means it did not wrap').toBeGreaterThan(h.line * 1.5);
  });

  test('numbers stay on one line so the column keeps its alignment', async ({ page }) => {
    await build(page);
    const nums = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('tbody td.num').forEach((td) => {
        const cs = getComputedStyle(td);
        out.push({ text: td.textContent.trim(), ws: cs.whiteSpace, align: cs.textAlign, h: td.getBoundingClientRect().height });
      });
      return out;
    });
    expect(nums.length).toBe(3);
    for (const n of nums) {
      expect(n.ws, `${n.text} may wrap`).toBe('nowrap');
      expect(n.align, `${n.text} is not right aligned`).toBe('right');
    }
    // All three numeric cells must be the same height: a wrapped number would
    // make one taller and break the row's baseline.
    expect(new Set(nums.map((n) => Math.round(n.h))).size).toBe(1);
  });
});
