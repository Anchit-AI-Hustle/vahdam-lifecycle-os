const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { startServer, blockExternal } = require('./lib/page-harness.js');

// REVENUE AND ROAS WERE PRINTED ON TOP OF EACH OTHER.
//
// From a screenshot of the live dashboard: "$45,233.43" and "2.52x" overlapping
// in the same pixels, and the Frequency and Conversions headers clipped
// mid-word ("Frequenc", "Conversi").
//
// The cause was NOT in ad-campaigns-master.html. theme.css carried
//
//     table { table-layout: fixed; width: 100%; border-collapse: collapse; }
//
// as a "lowest-specificity default ... any per-page rule still wins". It does
// not win. theme.css is injected by auth.js and therefore loads AFTER every
// page's inline <style>, so a page's own bare `table { … }` ties on specificity
// (0,0,1 both) and LOSES on source order. Ten pages style tables that way.
//
// Under table-layout:fixed the 20-column ads table divided its 986px container
// into 20 identical 49.3px columns regardless of content. Numeric cells are
// white-space:nowrap, so they did not wrap — they overflowed their boxes and
// painted over the neighbour. 81 cells were spilling.
//
// WHY EVERY EARLIER FIXTURE MISSED IT, TWICE:
//   * tests/table-readability.spec.js builds numeric cells as `<td class="num">`
//     and passes — but it injects only the page's CSS, never theme.css, so the
//     rule that actually decides the layout was absent from the fixture.
//   * The first version of THIS file made the mirror-image error: it loaded the
//     page's CSS but built cells as `<td style='text-align:right'>`, while the
//     page's real table() helper emits `<td class='num'>`. It passed with every
//     CSS change reverted, which is how a fixture reports green on a broken page.
//
// So this spec does not use a fixture at all. It drives the REAL page, with the
// REAL stylesheet chain, and stubs only the network. A fixture cannot reproduce
// a defect that lives in the interaction between two stylesheets.

const ROOT = path.join(__dirname, '..');

let server, BASE;
test.beforeAll(async () => { const s = await startServer(); server = s.server; BASE = s.base; });
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

// The screenshot is a laptop at roughly this width. The defect needs a
// CONSTRAINED container: at 2400px the columns fit and nothing overlaps, which
// is how a too-wide viewport reports a clean run on a broken table.
//
// Service workers are blocked because auth.js registers one that reloads the
// page shortly after load, which can wipe the DOM mid-assertion.
//
// reducedMotion matters for a reason worth stating, because the first version
// of this file failed in CI on three projects without it. motion.css reveals
// each panel with `vh-rv-rise`, and #p-liveintel carries .vh-rv, so for a few
// frames after the tab opens the panel holds
//     matrix(0.999963, 0.00855201, -0.00855201, 0.999963, 0, 31.8)
// which is a ~0.49 degree ROTATION. getBoundingClientRect() on a rotated
// element returns its AXIS-ALIGNED bounding box, and the AABB of a rotated cell
// is wider than the cell — so adjacent cells' boxes necessarily overlap, by
// 0.80px, uniformly, on every boundary in the table. Nothing was painting over
// anything; the geometry was simply being read mid-animation.
//
// A tolerance bump would have been the wrong fix: the rotation is largest early
// in the animation, so the artifact is unbounded, not 0.8px. Measuring layout
// through a transform is meaningless at any tolerance. prefers-reduced-motion
// is an accessibility mode the app already implements properly — motion.css
// sets `transform: none !important` on .vh-rv — so asking for it removes the
// transform entirely and also stops the infinite grain/atmos loops.
test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });

/** Rows shaped like the screenshot: long campaign tokens, 18-digit ids, big money. */
function liveRows() {
  return Array.from({ length: 6 }, (_, i) => ({
    platform: 'meta', level: 'ad', account_id: '1234567890',
    entity: `TOF_ASC_GIF_ThatCoffee_1820_CopyTest_AllPlacements_${i}`,
    entity_id: '12021098765432109' + i,
    campaign: `Conversion_BCAP_Coffee_NewBuyers_LookalikeAudience_2025_Q3_Broad_v${i}`,
    ad_group: `AdSet_Broad_25-54_AllPlacements_Advantage_${i}`,
    status: 'ACTIVE',
    spend: 17938.78 + i, impressions: 1186435 + i, reach: 392015 + i, frequency: 3.03,
    clicks: 21194 + i, ctr: 0.0179, cpc: 0.85, cpm: 15.12,
    conversions: 1368, conversion_rate: 0.0645, cpa: 13.11,
    revenue: 1245233.43 + i * 1000, roas: 2.52,
  }));
}

/** Open Live Ads Intelligence with a stubbed operator read and wait for the table. */
async function openLiveIntel(page) {
  await blockExternal(page);
  await page.route('**/api/public-config**', (r) => {
    if (!/view=ads/.test(r.request().url())) {
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true, rows: liveRows(), market: 'US', level: 'ad', freshness: 'test stub',
        window: { since: '2020-01-01', until: '2026-08-19' },
        generated_at: '2026-08-19T00:00:00Z', kpis: [], platforms: [],
      }),
    });
  });
  await page.goto(`${BASE}/ad-campaigns-master.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-p="liveintel"]').first().click();
  await page.locator('#li-tbl table tbody td').first().waitFor({ timeout: 15000 });
  // reducedMotion above should already have removed every transform. Assert it
  // rather than trust it: a future reveal that reduced-motion does not cover
  // would otherwise corrupt every measurement in this file silently, and the
  // symptom (a uniform sub-pixel overlap on every boundary) reads like a real
  // layout bug. An identity matrix is fine — it is a transform that moves
  // nothing, which is what an animation settles to when it keeps its fill.
  await page.waitForFunction(() => {
    const t = document.querySelector('#li-tbl table');
    if (!t) return false;
    for (let e = t; e && e !== document.documentElement; e = e.parentElement) {
      const tf = getComputedStyle(e).transform;
      if (tf !== 'none' && tf !== 'matrix(1, 0, 0, 1, 0, 0)') return false;
    }
    return true;
  }, null, { timeout: 15000 });
}

test.describe('the ads master table separates its columns', () => {
  test.beforeEach(async ({ page }) => { await openLiveIntel(page); });

  test('no two cells in a row overlap', async ({ page }) => {
    // The reported defect: Revenue's text printed over ROAS's.
    const overlaps = await page.evaluate(() => {
      const out = [];
      for (const tr of document.querySelectorAll('#li-tbl table tr')) {
        const cells = [...tr.children];
        for (let i = 1; i < cells.length; i++) {
          const a = cells[i - 1].getBoundingClientRect(), b = cells[i].getBoundingClientRect();
          if (a.right > b.left + 0.5) {
            out.push(`"${(cells[i - 1].textContent || '').trim().slice(0, 20)}" over "${(cells[i].textContent || '').trim().slice(0, 20)}"`);
          }
        }
      }
      return out;
    });
    expect(overlaps, `cells are painting over each other:\n  ${overlaps.join('\n  ')}`).toEqual([]);
  });

  test('no cell content overflows its own box', async ({ page }) => {
    // This is the assertion that actually caught it: 81 spilling cells before
    // the fix, 0 after. nowrap content in a column narrower than its text is
    // what escapes the box and lands on the neighbour.
    const spills = await page.evaluate(() => {
      const out = [];
      for (const c of document.querySelectorAll('#li-tbl table td, #li-tbl table th')) {
        if (c.scrollWidth > c.clientWidth + 1) {
          out.push(`${(c.textContent || '').trim().slice(0, 24)} — needs ${c.scrollWidth}px, has ${c.clientWidth}px`);
        }
      }
      return out;
    });
    expect(spills, `content is wider than its cell:\n  ${spills.join('\n  ')}`).toEqual([]);
  });

  test('columns are sized to their contents, not divided equally', async ({ page }) => {
    // table-layout:fixed hands every column an identical share of the container.
    // That is the single fact that produced every symptom above, and it is
    // invisible in a screenshot, so assert it directly.
    const m = await page.evaluate(() => {
      const tbl = document.querySelector('#li-tbl table');
      const widths = [...tbl.querySelectorAll('tbody tr')][0]
        ? [...[...tbl.querySelectorAll('tbody tr')][0].children].map((c) => Math.round(c.getBoundingClientRect().width))
        : [];
      return { layout: getComputedStyle(tbl).tableLayout, widths, distinct: new Set(widths).size };
    });
    expect(m.layout, 'table-layout:fixed ignores content width and crushes wide tables').toBe('auto');
    expect(m.distinct, `every column came out the same width (${m.widths.join(', ')}), which means the layout ignored the content`)
      .toBeGreaterThan(3);
  });

  test('the table scrolls rather than crushing its columns', async ({ page }) => {
    // The cure is that the table takes its natural width and .tbl-wrap scrolls.
    // If it ever stops exceeding the wrapper, the columns are competing again.
    const m = await page.evaluate(() => {
      const tbl = document.querySelector('#li-tbl table');
      const wrap = tbl.closest('.tbl-wrap');
      return { wrapW: wrap.clientWidth, tableW: tbl.scrollWidth, overflowX: getComputedStyle(wrap).overflowX };
    });
    expect(m.overflowX).toBe('auto');
    expect(m.tableW, 'the table was squeezed to the container instead of keeping its natural width')
      .toBeGreaterThan(m.wrapW);
  });

  test('every column carries a visible vertical rule', async ({ page }) => {
    // What the reader actually asked for: columns marked AS columns. Whitespace
    // alone disappears when the table is tight, which is when it is needed.
    const missing = await page.evaluate(() => {
      const out = [];
      // The rule is dropped on the last cell OF EACH ROW, not just the last cell
      // in the table — an earlier version of this check skipped only the latter
      // and flagged every row's final cell as missing its rule.
      for (const c of document.querySelectorAll('#li-tbl table tbody td')) {
        if (c === c.parentElement.lastElementChild) continue;
        const s = getComputedStyle(c);
        if ((parseFloat(s.borderRightWidth) || 0) < 1 || /rgba\(0, 0, 0, 0\)|transparent/.test(s.borderRightColor)) {
          out.push((c.textContent || '').trim().slice(0, 20));
        }
      }
      return out;
    });
    expect(missing, `these cells have no right-hand rule:\n  ${missing.join(', ')}`).toEqual([]);
  });

  test('the sticky header keeps its column rules', async ({ page }) => {
    // border-collapse drops borders on a sticky th as it detaches, so the header
    // loses its separators exactly while it is doing its job. An inset shadow
    // paints regardless — assert the shadow, not the border.
    const shadow = await page.evaluate(() => getComputedStyle(document.querySelector('#li-tbl table thead th')).boxShadow);
    expect(shadow, 'the header has no inset column rule').not.toBe('none');
    expect(shadow).toMatch(/inset/);
  });

  test('numeric columns keep the alignment the page asked for', async ({ page }) => {
    // theme.css centred them via `table:has(th) td`. :has() takes its argument's
    // specificity, so that scored (0,0,3) and beat the page's own
    // `th, td { text-align: right }` at (0,0,1) — money centred in a financial
    // table, against an explicit instruction on the page.
    const aligns = await page.evaluate(() =>
      [...document.querySelectorAll('#li-tbl table tbody tr')][0]
        ? [...[...document.querySelectorAll('#li-tbl table tbody tr')][0].children]
            .filter((c) => c.classList.contains('num'))
            .map((c) => getComputedStyle(c).textAlign)
        : []);
    expect(aligns.length, 'no numeric cells found — the fixture no longer matches the page').toBeGreaterThan(5);
    expect([...new Set(aligns)]).toEqual(['right']);
  });
});

// ── The durable invariant ───────────────────────────────────────────────────
// The page-level fix above is only safe while theme.css stays a real default.
// It loads last, so any bare-element rule in it silently outranks every page.
// Deliberately NOT a list of element names. An allowlist of "dangerous" tags
// only catches the tags someone already thought of — `section { display:grid }`
// added tomorrow would sail through. The real rule is structural: a selector
// carrying no class, id or attribute has element-level specificity, and from a
// stylesheet that loads last that is a page override rather than a default.
// `html`, `body` and `:root` are single elements no page lays out against, and
// `*` here only ever carries a pseudo-element (scrollbar parts, ::before/::after
// box-sizing), which cannot collide with a page's own layout rules.
const ALLOWED_BARE = new Set(['html', 'body', ':root', '*', ':focus-visible']);

/** The element part of a selector: everything before its pseudo-element, if any. */
function elementPart(sel) {
  return sel.split('::')[0].trim();
}

function bareSelectors(css) {
  // Strip comments first: the theme.css block deliberately QUOTES the old
  // broken rule while explaining it, and a quotation inside a correction is
  // not drift. Strip at-rule preludes too (@media, @supports) — they are not
  // selectors, and the rules nested inside them are checked on their own lines.
  //
  // @keyframes bodies are removed BEFORE the scan. Their steps — `from`, `to`,
  // `0%`, `70%` — sit on their own line followed by `{`, so a line-oriented
  // parser reads them as bare element selectors and reports five offenders for
  // one animation. A keyframe step is not a selector and reaches no element, so
  // flagging it is a false positive, and the fix an author would reach for
  // (wrapping `from` in :where()) is not even valid CSS. Found when the
  // futuristic layer added the first @keyframes this file had ever seen.
  const code = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(-\w+-)?keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ' ');
  const out = [];
  for (const line of code.split('\n')) {
    if (!line.includes('{')) continue;
    const sel = line.split('{')[0].trim();
    if (!sel || sel.startsWith('@') || sel.startsWith('}')) continue;
    if (sel.includes(':where(')) continue;                       // already zero-specificity
    if (/[.#[]/.test(sel)) continue;                             // carries a class, id or attribute
    // Every comma-separated part must be an allowed bare selector, otherwise
    // the rule reaches real elements at element-level specificity.
    // A bare pseudo-element on the document itself (::selection) has an empty
    // element part and reaches nothing a page positions.
    if (sel.split(',').map(elementPart).every((s) => s === '' || ALLOWED_BARE.has(s))) continue;
    out.push(sel);
  }
  return out;
}

test('theme.css states its bare-element defaults at zero specificity', () => {
  const offenders = bareSelectors(fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8'));
  expect(offenders,
    'theme.css loads AFTER every page inline <style>, so a bare element rule here does not lose the\n' +
    'specificity tie — it wins on source order and overrides the page. That is how a documented\n' +
    '"lowest-specificity default" silently overrode ten pages\' own table CSS. Wrap it in :where() so\n' +
    'it is the default it claims to be. Offending selectors:\n  ' + offenders.join('\n  ')).toEqual([]);
});

test('the zero-specificity guard actually catches an offender (guards the guard)', () => {
  // An empty result is the pass condition, and an over-narrow matcher produces
  // one for the wrong reason. Feed it selectors it has never been told about.
  const planted = bareSelectors([
    'section { display: grid; }',                 // a tag not on any allowlist
    'table { table-layout: fixed; }',             // the original defect
    'ul > li + li { margin-top: 4px; }',          // combinators
    'table::before { content: ""; }',             // a pseudo-element on a real tag still reaches pages
    ':where(table) { width: 100%; }',             // correctly written — must NOT be flagged
    '.vh-card { padding: 8px; }',                 // opt-in component — must NOT be flagged
    'body { font-smoothing: antialiased; }',      // allowed bare — must NOT be flagged
    '*::-webkit-scrollbar-thumb:hover { background: red; }', // pseudo on * — must NOT be flagged
    '::selection { background: gold; }',          // document pseudo — must NOT be flagged
    '/* table { table-layout: fixed; } */',       // quoted inside a comment — must NOT be flagged
    '@keyframes spin {\n  from { transform: none; }\n  to { transform: rotate(1turn); }\n}', // steps are not selectors
    '@keyframes pulse {\n  0% { opacity: 0; }\n  70% { opacity: 1; }\n  100% { opacity: 0; }\n}',
  ].join('\n'));
  expect(planted).toEqual(['section', 'table', 'ul > li + li', 'table::before']);
});

test('theme.css does not force table-layout on every page', () => {
  const code = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(code, 'a global table-layout:fixed divides any container equally and crushes wide data tables')
    .not.toMatch(/table-layout\s*:\s*fixed/);
});
