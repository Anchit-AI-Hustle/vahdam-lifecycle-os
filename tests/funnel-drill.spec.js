const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Clickable table rows that drill to the next attribution step.
//
// The rule these tests exist to protect is not "rows are clickable" — it is that
// a drill may only NARROW the next step where a join key genuinely exists in the
// data. Silently filtering the platform cut by a Shopify sales channel would
// invent an attribution and put a confident, wrong number in front of the
// business. So every non-joinable edge must carry its own written reason, and no
// edge may claim a join the payload cannot support.

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'funnel-drill.js'), 'utf8');
const EXT = fs.readFileSync(path.join(ROOT, 'data-analysis-extensions.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'data-analysis.html'), 'utf8');
const MASTER = fs.readFileSync(path.join(ROOT, 'ad-campaigns-master.html'), 'utf8');

// The module is a browser IIFE that hangs itself off `window`. Evaluate it
// against a minimal stub so the graph can be asserted in Node, without a browser
// and without duplicating the graph here — a copy would drift.
function loadGraph() {
  const win = {};
  const doc = {
    getElementById: () => null,
    createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, style: {}, classList: { add() {} } }),
    documentElement: { appendChild() {} },
    head: { appendChild() {} },
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', SRC)(win, doc);
  return win.FunnelDrill;
}
const FD = loadGraph();

test.describe('the funnel graph', () => {
  test('every stage resolves, and every `next` points at a real stage', () => {
    const keys = Object.keys(FD.STAGES);
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) {
      const s = FD.STAGES[k];
      expect(s.key, `${k} must carry its own key`).toBe(k);
      expect(typeof s.label).toBe('string');
      expect(typeof s.id, `${k} must be able to identify its rows`).toBe('function');
      if (s.next) expect(FD.STAGES[s.next], `${k}.next -> ${s.next} must exist`).toBeTruthy();
    }
  });

  test('a stage with no successor states WHY, in its own words', () => {
    const terminals = Object.values(FD.STAGES).filter((s) => !s.next);
    expect(terminals.length).toBeGreaterThan(0);
    for (const s of terminals) {
      expect(s.why, `${s.key} is terminal and must say why`).toBeTruthy();
      expect(s.why.length, `${s.key}'s reason must be a real explanation`).toBeGreaterThan(60);
      expect(s.why.toLowerCase()).not.toBe('no data');
    }
  });

  test('a stage whose join returns null states WHY it cannot be narrowed', () => {
    for (const s of Object.values(FD.STAGES)) {
      if (!s.next || !s.join) continue;
      // A join function that can return null for a well-formed row is an
      // unjoinable edge, and unjoinable edges must be explained.
      if (s.join({}) === null) {
        expect(s.why, `${s.key} -> ${s.next} is unjoinable and must say why`).toBeTruthy();
        expect(s.why.length).toBeGreaterThan(60);
      }
    }
  });

  test('the paid-media chain is joinable end to end, on the fields the payload carries', () => {
    // These are the edges revenue-analysis-core actually supports: ad rows carry
    // platform, campaign and adset, so each of these drills narrows exactly.
    const p1 = FD.plan('platform', { platform: 'meta' });
    expect(p1.kind).toBe('drill');
    expect(p1.to.key).toBe('campaign');
    expect(p1.joinable).toBe(true);
    expect(p1.filter).toEqual({ field: 'platform', value: 'meta', match: 'equals', from: 'platform' });

    const p2 = FD.plan('campaign', { campaign: 'Conversion_BCAP_Coffee', platform: 'meta' });
    expect(p2.to.key).toBe('adset');
    expect(p2.filter.field).toBe('campaign');

    const p3 = FD.plan('adset', { adset: 'Prospecting_25_44', campaign: 'Conversion_BCAP_Coffee' });
    expect(p3.to.key).toBe('ad');
    expect(p3.filter.field).toBe('adset');
  });

  test('a sales channel does NOT silently filter the ad platforms', () => {
    // Nothing ties "Online Store" to Meta. The drill must still happen — the
    // reader asked to go down a level — but it must arrive unnarrowed and say so.
    const p = FD.plan('channel', { channel: 'Online Store', sales: 1002257.53 });
    expect(p.kind).toBe('drill');
    expect(p.to.key).toBe('platform');
    expect(p.joinable).toBe(false);
    expect(p.filter, 'an unjoinable drill must carry NO filter').toBeNull();
    expect(p.note).toMatch(/sales channel/i);
  });

  test('a blank key is not a filter', () => {
    // Filtering campaigns on an empty campaign name would show the rows that
    // happen to be blank too, which reads as "this platform ran one campaign".
    const p = FD.plan('campaign', { campaign: '', platform: 'meta' });
    expect(p.joinable).toBe(false);
    expect(p.filter).toBeNull();
  });

  test('month drills to the weeks that start in it, and says so', () => {
    const p = FD.plan('month', { month: '2025-07-01' });
    expect(p.to.key).toBe('week');
    expect(p.filter).toMatchObject({ field: 'week', value: '2025-07', match: 'month' });
    expect(p.note).toMatch(/start/i);
    // The real weekly rows from the export: keyed by week-start date.
    expect(FD.matches({ week: '2025-07-07' }, [p.filter])).toBe(true);
    expect(FD.matches({ week: '2025-08-04' }, [p.filter])).toBe(false);
  });

  test('an acquisition month opens the retention cohort quarter that contains it', () => {
    const p = FD.plan('acquisition', { month: '2024-11-01', new_customers: 400 });
    expect(p.to.key).toBe('cohort_retention');
    // Retention cohorts in the export are quarter starts (2024-10-01).
    expect(p.filter.value).toBe('2024-10-01');
    expect(FD.matches({ cohort: '2024-10-01' }, [p.filter])).toBe(true);
    expect(FD.matches({ cohort: '2025-01-01' }, [p.filter])).toBe(false);
  });

  test('a region drill re-scopes the market instead of filtering rows', () => {
    // The export is per-market. Filtering rows by region would leave the KPI
    // header on one market and the table on another.
    const p = FD.plan('region', { region: 'UK', total_sales: 1 });
    expect(p.market).toBe('UK');
    expect(p.filter).toBeNull();
  });

  test('an unmapped table gets the record view, not a broken click', () => {
    const p = FD.plan('not-a-stage', { a: 1 });
    expect(p.kind).toBe('detail');
    expect(p.reason).toBeTruthy();
  });

  test('matches() is case-insensitive on equality and never passes a mismatch', () => {
    const f = [{ field: 'platform', value: 'Meta', match: 'equals' }];
    expect(FD.matches({ platform: 'meta' }, f)).toBe(true);
    expect(FD.matches({ platform: 'google' }, f)).toBe(false);
    expect(FD.matches({}, f), 'a row missing the field must not pass').toBe(false);
    expect(FD.matches({ platform: 'meta' }, []), 'no filters means no narrowing').toBe(true);
  });
});

test.describe('the wiring', () => {
  test('every table on the Live Intelligence tabs declares a funnel stage', () => {
    // A table without a stage renders rows that do not respond, which is the
    // exact defect this work removed. Count the table() calls that pass rows and
    // require each to name a stage.
    const calls = EXT.match(/\btable\(\[[^\n]*?\{[^}]*limit:[^}]*\}\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(10);
    for (const c of calls) {
      expect(c, `this table has no funnel stage: ${c.slice(0, 90)}`).toMatch(/stage:\s*'/);
      expect(c, `this table has no records to click through: ${c.slice(0, 90)}`).toMatch(/records:/);
    }
  });

  test('every stage named by a caller exists in the graph', () => {
    const named = new Set();
    for (const src of [EXT, PAGE]) {
      for (const m of src.matchAll(/stage:\s*'([a-z_]+)'/g)) named.add(m[1]);
    }
    expect(named.size).toBeGreaterThan(8);
    for (const s of named) expect(FD.STAGES[s], `${s} is used but not defined`).toBeTruthy();
  });

  test('the revenue cut renderer wires its rows and re-wires after every render', () => {
    // renderCut() emits the table; show() must call wire() or the registry entry
    // is created and never consumed, leaving rows inert.
    expect(EXT).toMatch(/function wire\(root\)/);
    expect(EXT).toMatch(/wire\(host\)/);
    expect(EXT).toMatch(/wire\(body\)/);
  });

  test('a drill step that the target cut cannot honour is dropped, not applied', () => {
    // Carrying a `week` filter into the platform cut would match nothing and
    // render an empty table that reads as "this platform sold nothing".
    expect(EXT).toMatch(/function applicableFilters/);
    expect(EXT).toMatch(/hasOwnProperty\.call\(sample, f\.field\)/);
    expect(EXT).toMatch(/Carried but not applied/);
  });

  test('an empty filtered result is reported as a real absence, not as loading', () => {
    expect(EXT).toMatch(/Nothing matches this drill/);
  });

  test('the host page loads the module and hands its rows to the same graph', () => {
    expect(PAGE).toMatch(/<script src="\/funnel-drill\.js"><\/script>/);
    expect(PAGE).toMatch(/function wireDetailDrill/);
    expect(PAGE).toMatch(/window\.__lcFunnelToRevenue/);
    expect(EXT).toMatch(/window\.__lcFunnelToRevenue = drillToRevenue/);
  });

  test('the ads hierarchy makes the whole row a target without eating the anchor', () => {
    expect(MASTER).toMatch(/tr\.__drillRow/);
    expect(MASTER).toMatch(/e\.target\.closest\("a,button,input,select,textarea,label"\)/);
    expect(MASTER).toMatch(/click any row to open its ad sets/);
  });

  test('the row action is reachable without a mouse', () => {
    // The whole <tr> is a mouse target, but a <tr> cannot be focused meaningfully
    // by assistive tech, so the action also exists as a real button with a label.
    expect(SRC).toMatch(/createElement\('button'\)/);
    expect(SRC).toMatch(/go\.setAttribute\('aria-label'/);
    expect(SRC).toMatch(/th\.setAttribute\('scope', 'col'\)/);
  });

  test('the drill chrome uses brand colours only', () => {
    const css = (SRC.match(/#[0-9A-Fa-f]{6}/g) || []).map((c) => c.toUpperCase());
    const allowed = new Set(['#004A2B', '#AB8743', '#171717', '#FBF5EA', '#FFFFFF', '#E7F0EB', '#31483B', '#8A682F', '#D8CCB6']);
    for (const c of css) expect(allowed.has(c), `${c} is off-palette`).toBe(true);
    // The style guide forbids dark-neutral section fills outright.
    expect(SRC).not.toMatch(/background:\s*#(1a1a1a|111|000)/i);
  });
});
