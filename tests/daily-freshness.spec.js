const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// THE DAILY LOOP HAD BEEN DEAD FOR THREE WEEKS AND EVERY SURFACE LOOKED HEALTHY.
//
// Production evidence at the time this was written (2026-08-13):
//   • no row in smart_calendar_entries had been written since 2026-07-24;
//   • the rolling "90-day" window had decayed to 58 days and was losing one more
//     day of horizon per day — it would have reached zero on 2026-10-09;
//   • not one of the 116 planned sends carried a prebuilt asset bundle;
//   • and the daily sync still answered ok:true with 720 "changes", because the
//     database rejected every insert (23505 on the UNIQUE (date, market) index
//     that migration 20260712090000 was supposed to drop and nobody applied) and
//     the response reported the changes it INTENDED, not the writes that landed.
//
// Each block below pins one link in that chain. They are deliberately about
// reporting, not just behaviour: the code failing is survivable, the code
// failing while claiming success is what cost three weeks.

const ROOT = path.join(__dirname, '..');
const sbplan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const dc = require(path.join(ROOT, 'api', '_shared', 'daily-calendar-core.js'));
const BRAIN = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'smart-brain.html'), 'utf8');
const OSB = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'os-backbone.js'), 'utf8');

function functionFileCount(dir = path.join(ROOT, 'api'), depth = 0) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_shared') continue;           // excluded by Vercel
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (depth < 6) n += functionFileCount(full, depth + 1); }
    else if (entry.name.endsWith('.js')) n += 1;
  }
  return n;
}

test.describe('the decayed window is detectable from the data alone', () => {
  test('a window short at the FAR end is reported, with what it means', () => {
    // This is the exact production shape: the plan starts today (so the front
    // looks perfectly current) and stops 58 days out instead of 90. Judging
    // freshness by the first date — which every existing surface did — calls
    // this healthy.
    const entries = [];
    for (let i = 0; i < 58; i++) entries.push({ date: dc.addDaysIso('2026-08-13', i) });
    const cov = sbplan.horizonCoverage(entries, '2026-08-13', 90);
    expect(cov.complete).toBe(false);
    expect(cov.covered_days).toBe(58);
    expect(cov.missing_days).toBe(32);
    expect(cov.last_planned_day).toBe('2026-10-09');
    expect(cov.note, 'the note must explain that a short tail means the sync is not persisting')
      .toMatch(/loses one day of horizon per day/i);
  });

  test('a complete window says so without a caveat', () => {
    const entries = [];
    for (let i = 0; i < 90; i++) entries.push({ date: dc.addDaysIso('2026-08-13', i) });
    const cov = sbplan.horizonCoverage(entries, '2026-08-13', 90);
    expect(cov.complete).toBe(true);
    expect(cov.missing_days).toBe(0);
  });

  test('the missing list is bounded so an empty window cannot return 90 dates every poll', () => {
    const cov = sbplan.horizonCoverage([], '2026-08-13', 90);
    expect(cov.missing_days).toBe(90);
    expect(cov.missing_sample.length).toBeLessThanOrEqual(5);
    expect(cov.last_planned_day).toBeNull();
  });
});

test.describe('a rejected write is named, not swallowed', () => {
  const REAL_409 = 'Supabase upsert smart_calendar_entries failed: 409 {"code":"23505","details":"Key (date, market)=(2026-08-13, US) already exists.","hint":null,"message":"duplicate key value violates unique constraint \\"smart_cal_date_market_idx\\""}';

  test('the exact production rejection points at the unapplied migration', () => {
    const c = sbplan.classifyWriteFailure(REAL_409);
    expect(c.kind).toBe('schema_out_of_date');
    expect(c.constraint).toBe('smart_cal_date_market_idx');
    // The blocker has to carry the remedy. Without the filename an operator sees
    // a Postgres error code and no way to act on it.
    expect(c.fix).toMatch(/20260712090000_multi_cohort_per_day\.sql/);
    expect(c.effect, 'it must say what the constraint costs the plan').toMatch(/cohort/i);
  });

  test('an unrelated failure is passed through rather than guessed at', () => {
    const c = sbplan.classifyWriteFailure('Supabase upsert x failed: 500 {"code":"XX000","message":"connection reset"}');
    expect(c.kind).toBe('write_failed');
    expect(c.detail).toMatch(/connection reset/);
    expect(c.fix).toBeNull();
  });
});

test.describe('a batch rejection no longer costs the whole window', () => {
  // PostgREST batch inserts are all-or-nothing: one bad row aborted 90 days of
  // plan. The fallback stores what it can and reports what it could not.
  function fakeDb(rejectIds) {
    const stored = [];
    return {
      stored,
      calls: { batch: 0, single: 0 },
      async upsert(table, rows) {
        if (rows.length > 1) {
          this.calls.batch += 1;
          if (rows.some((r) => rejectIds.has(r.id))) {
            return { ok: false, warning: 'Supabase upsert t failed: 409 {"code":"23505","details":"Key (date, market)=(x, US) already exists.","message":"duplicate key value violates unique constraint \\"smart_cal_date_market_idx\\""}' };
          }
          stored.push(...rows);
          return { ok: true, rows };
        }
        this.calls.single += 1;
        if (rejectIds.has(rows[0].id)) {
          return { ok: false, warning: 'Supabase upsert t failed: 409 {"code":"23505","details":"Key (date, market)=(x, US) already exists.","message":"duplicate key value violates unique constraint \\"smart_cal_date_market_idx\\""}' };
        }
        stored.push(rows[0]);
        return { ok: true, rows };
      },
    };
  }

  test('the rows that CAN be stored are stored', async () => {
    const db = fakeDb(new Set(['b']));
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const out = await sbplan.insertRowsResilient(db, 'smart_calendar_entries', rows);
    // Before the fallback this was 0 — every good row lost to one bad one.
    expect(out.inserted).toBe(3);
    expect(out.rejected).toBe(1);
    expect(out.degraded).toBe(true);
    expect(db.stored.map((r) => r.id)).toEqual(['a', 'c', 'd']);
  });

  test('identical rejections collapse into one blocker with a count', async () => {
    const db = fakeDb(new Set(['b', 'c']));
    const out = await sbplan.insertRowsResilient(db, 'smart_calendar_entries', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(out.blockers.length).toBe(1);
    expect(out.blockers[0].rows_rejected).toBe(2);
    expect(out.blockers[0].constraint).toBe('smart_cal_date_market_idx');
  });

  test('a clean batch does not fan out into single writes', async () => {
    const db = fakeDb(new Set());
    const out = await sbplan.insertRowsResilient(db, 't', [{ id: 'a' }, { id: 'b' }]);
    expect(out.inserted).toBe(2);
    expect(out.degraded).toBe(false);
    expect(db.calls.single, 'the fallback must not fire when the batch succeeded').toBe(0);
  });
});

test.describe('success is derived, never asserted', () => {
  test('syncDaily computes persistence.ok instead of hardcoding it', () => {
    const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'), 'utf8');
    // The literal that caused this: `persistence = { ok: true, ...results }`.
    expect(src).not.toMatch(/persistence\s*=\s*\{\s*ok:\s*true\s*,\s*\.\.\.results/);
    expect(src).toMatch(/ok:\s*results\.blockers\.length === 0 && landed >= intended/);
  });

  test('the cron records the run as failed when a step failed', () => {
    expect(BRAIN).not.toMatch(/logRun\('cron', summary, true\)/);
    // The verdict is DERIVED. It now also counts steps the run had no time
    // budget left for: this cron was being killed at the 120s function cap with
    // its central step never reached, so "ran out of time" has to be a failure
    // too, not an unrecorded silence.
    expect(BRAIN).toMatch(/const ok = failed\.length === 0 && skipped\.length === 0;/);
    expect(BRAIN).toMatch(/logRun\('cron', summary, ok\)/);
  });

  test('the cron step reports rows WRITTEN, not changes intended', () => {
    // `synced: true` beside a count of "changes" is what made a dead loop look
    // busy. The step now carries what landed and what the database refused.
    expect(BRAIN).not.toMatch(/steps\.smart_brain_plan = \{ synced: true/);
    expect(BRAIN).toMatch(/written:\s*\(p\.inserted \|\| 0\) \+ \(p\.updated \|\| 0\)/);
    expect(BRAIN).toMatch(/rejected:\s*p\.rejected/);
  });

  test('the daily job no longer stamps every run success', () => {
    expect(OSB).not.toMatch(/update\('cron_runs', \{ status: 'success'/);
    expect(OSB).toMatch(/const runStatus = steps_failed \? 'error' : 'success'/);
  });

  test('a skipped connector is logged skipped, not ok', () => {
    // "5/12 steps ok" counted connectors that pulled nothing as working.
    expect(OSB).not.toMatch(/logStep\(`sync:\$\{c\.id\}`, r\.status === 'error' \? 'error' : 'ok'/);
    expect(OSB).toMatch(/r\.status === 'skipped' \? 'skipped' : 'ok'/);
  });

  test('the Klaviyo sync names the blocker that is actually holding it back', () => {
    // It reported "KLAVIYO_API_KEY not set" while the key was set and only the
    // global kill switch was off, sending the operator to fix the wrong thing.
    const KS = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'klaviyo-sync.js'), 'utf8');
    expect(KS).toMatch(/kl\.hasKey\(\)/);
    expect(KS).toMatch(/LIVE_CONNECTORS=on/);
  });
});

test.describe('freshness distinguishes never-run from stale from current', () => {
  const NOW = Date.parse('2026-08-13T09:00:00Z');

  test('no timestamp is "never run", not a stale healthy thing', () => {
    const f = dc.freshnessOf(null, { today: '2026-08-13', nowMs: NOW });
    expect(f.state).toBe('never_run');
    expect(f.age_hours, 'an absent age must be null, never 0').toBeNull();
    expect(f.current).toBe(false);
  });

  test('a run inside its schedule is current, and a missed one is stale', () => {
    expect(dc.freshnessOf('2026-08-12T18:30:00Z', { today: '2026-08-13', nowMs: NOW }).state).toBe('current');
    // The real production value: last write 2026-07-24, checked 2026-08-13.
    const dead = dc.freshnessOf('2026-07-24T10:00:00Z', { today: '2026-08-13', nowMs: NOW });
    expect(dead.state).toBe('stale');
    expect(dead.age_hours).toBeGreaterThan(400);
    expect(dead.ran_today).toBe(false);
  });

  test('ran_today is computed against today, not stored', () => {
    expect(dc.freshnessOf('2026-08-13T02:00:00Z', { today: '2026-08-13', nowMs: NOW }).ran_today).toBe(true);
    expect(dc.freshnessOf('2026-08-12T23:59:00Z', { today: '2026-08-13', nowMs: NOW }).ran_today).toBe(false);
  });

  test('age 0 and age unknown are different answers', () => {
    expect(dc.ageOf(new Date(NOW).toISOString(), NOW)).toBe(0);
    expect(dc.ageOf(null, NOW)).toBeNull();
    expect(dc.ageOf('not a date', NOW)).toBeNull();
  });
});

test.describe('an asset counts only when its artefact exists', () => {
  test('a channel the plan names but the campaign never built is NOT built', () => {
    // The slot plans five channels; the campaign carries an email and one ad.
    const built = dc.builtChannels({
      assets: {
        email: { subject: 'A quieter morning', html: '<p>x</p>' },
        ads: [{ platform: 'meta', headline: 'h', primary_text: 'p' }],
        landing_pages: [],
      },
    });
    expect(built.email).toBe(true);
    expect(built.meta).toBe(true);
    expect(built.google, 'a planned channel with no ad must not read as built').toBe(false);
    expect(built.tiktok).toBe(false);
    expect(built.landing_page).toBe(false);
  });

  test('an empty ad shell does not count as an ad', () => {
    const built = dc.builtChannels({ assets: { ads: [{ platform: 'google' }] } });
    expect(built.google).toBe(false);
  });

  test('a landing page counts when it has html or a url', () => {
    expect(dc.builtChannels({ assets: { landing_pages: [{ html: '<h1>x</h1>' }] } }).landing_page).toBe(true);
    expect(dc.builtChannels({ assets: { landing_pages: [{}] } }).landing_page).toBe(false);
  });
});

test.describe('the day-level calendar', () => {
  // Stub the adapter so the JOIN and the bucketing are exercised, not the network.
  function stubDb({ slots = [], campaigns = [], orders = [], orderProbe = [], cronRuns = [], runs = [] }) {
    const services = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const proto = services.SmartBrainDbAdapter.prototype;
    const saved = { select: proto.select, connected: Object.getOwnPropertyDescriptor(proto, 'connected') };
    Object.defineProperty(proto, 'connected', { get() { return true; }, configurable: true });
    proto.select = async function select(table, params = {}) {
      if (table === 'smart_calendar_entries') return slots;
      if (table === 'smart_generated_campaigns') return campaigns;
      // The unfiltered limit-1 read is the shape probe; the filtered read is the
      // window. They must stay distinguishable or the stub hides the very
      // distinction the code makes.
      if (table === 'smart_orders') return (params.limit === 1 && !params.filters) ? orderProbe : orders;
      if (table === 'cron_runs') return cronRuns;
      if (table === 'smart_brain_runs') return runs;
      return [];
    };
    return () => { proto.select = saved.select; Object.defineProperty(proto, 'connected', saved.connected); };
  }

  const TODAY = dc.todayIso();
  const YESTERDAY = dc.addDaysIso(TODAY, -1);
  const TOMORROW = dc.addDaysIso(TODAY, 1);

  const SLOTS = [
    { id: 's1', date: YESTERDAY, market: 'US', status: 'archived', updated_at: `${YESTERDAY}T10:00:00Z`,
      payload: { cohort: { name: 'At-Risk' }, objective: 'reactivation', channels: ['email', 'meta'] } },
    { id: 's2', date: TODAY, market: 'US', status: 'approved', updated_at: `${TODAY}T08:00:00Z`, generated_campaign_id: 'c2',
      payload: { cohort: { name: 'Champions' }, objective: 'bundle expansion', channels: ['email', 'meta', 'google'] } },
    { id: 's3', date: TOMORROW, market: 'UK', status: 'tentative', updated_at: `${TODAY}T08:00:00Z`,
      payload: { cohort: { name: 'Nurture' }, objective: 'education', channels: ['email', 'landing_page'] } },
  ];
  // A realistic probe row: the presence of a bucketable date column is what
  // makes an empty day a measured zero rather than an unknown.
  const ORDER_SHAPE = { id: 1, created_at: `${YESTERDAY}T12:00:00Z`, total: '0', market: 'US' };
  const CAMPAIGNS = [{
    id: 'c2', status: 'approved', updated_at: `${TODAY}T08:05:00Z`,
    payload: {
      campaign_id: 'c2', calendar_entry_id: 's2',
      assets: { email: { subject: 's', html: '<p>x</p>' }, ads: [{ platform: 'meta', headline: 'h' }], landing_pages: [] },
    },
  }];

  test('past, today and future are bucketed and history is not hidden', async () => {
    // getPlan filters `status: neq.archived`, which is why no surface in the app
    // could show a past send even though the rows were sitting in the table.
    const restore = stubDb({ slots: SLOTS, campaigns: CAMPAIGNS, orderProbe: [ORDER_SHAPE] });
    try {
      const out = await dc.dayCalendar({ from: dc.addDaysIso(TODAY, -3), to: dc.addDaysIso(TODAY, 3) });
      const y = out.days.find((d) => d.date === YESTERDAY);
      const t = out.days.find((d) => d.date === TODAY);
      const m = out.days.find((d) => d.date === TOMORROW);
      expect(y.bucket).toBe('past');
      expect(t.bucket).toBe('today');
      expect(m.bucket).toBe('future');
      expect(y.slots.length, 'an archived past send must still be visible as history').toBe(1);
      expect(y.slots[0].cohort).toBe('At-Risk');
    } finally { restore(); }
  });

  test('a future day has no measurements at all, rather than zeros', async () => {
    const restore = stubDb({ slots: SLOTS, campaigns: CAMPAIGNS, orderProbe: [ORDER_SHAPE] });
    try {
      const out = await dc.dayCalendar({ from: TODAY, to: dc.addDaysIso(TODAY, 3) });
      const m = out.days.find((d) => d.date === TOMORROW);
      expect(m.measured, 'tomorrow cannot have sold anything, and 0 would say it sold nothing').toBeNull();
    } finally { restore(); }
  });

  test('an empty order store yields unknown, not a measured zero', async () => {
    // Same standard as the Mailer Intelligence fix: "$0 revenue" is the claim
    // that nothing sold; an unsynced table cannot make that claim.
    const restore = stubDb({ slots: SLOTS, campaigns: CAMPAIGNS, orders: [], orderProbe: [] });
    try {
      const out = await dc.dayCalendar({ from: dc.addDaysIso(TODAY, -3), to: TODAY });
      const y = out.days.find((d) => d.date === YESTERDAY);
      expect(y.measured.orders).toBeNull();
      expect(y.measured.revenue).toBeNull();
      expect(y.blockers.join(' ')).toMatch(/unknown rather than zero/i);
    } finally { restore(); }
  });

  test('a reporting store with no rows on a day IS a measured zero', async () => {
    const restore = stubDb({ slots: SLOTS, campaigns: CAMPAIGNS, orders: [], orderProbe: [ORDER_SHAPE] });
    try {
      const out = await dc.dayCalendar({ from: dc.addDaysIso(TODAY, -3), to: TODAY });
      const y = out.days.find((d) => d.date === YESTERDAY);
      expect(y.measured.orders).toBe(0);
      expect(y.measured.basis).toMatch(/smart_orders/);
    } finally { restore(); }
  });

  test('the real smart_orders shape is read, and the filter uses the column that exists', async () => {
    // Caught against production on first contact: this shipped filtering on
    // created_at, and smart_orders actually stores ordered_at. The query 400'd,
    // the adapter degraded it to [], and every past day would have printed a
    // measured $0 from a question that was never asked.
    const seen = [];
    const services = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const proto = services.SmartBrainDbAdapter.prototype;
    const saved = { select: proto.select, connected: Object.getOwnPropertyDescriptor(proto, 'connected') };
    Object.defineProperty(proto, 'connected', { get() { return true; }, configurable: true });
    proto.select = async function select(table, params = {}) {
      if (table !== 'smart_orders') return [];
      if (params.limit === 1 && !params.filters) return [{ id: 1, user_id: 'u', market: 'US', ordered_at: `${YESTERDAY}T09:00:00Z`, total: '58.00' }];
      seen.push(Object.keys(params.filters || {}));
      return [
        { id: 1, market: 'US', ordered_at: `${YESTERDAY}T09:00:00Z`, total: '58.00' },
        { id: 2, market: 'US', ordered_at: `${YESTERDAY}T18:00:00Z`, total: '42.50' },
      ];
    };
    try {
      const out = await dc.dayCalendar({ from: dc.addDaysIso(TODAY, -3), to: TODAY });
      expect(seen[0], 'the window query must filter on the detected column').toEqual(['ordered_at']);
      const y = out.days.find((d) => d.date === YESTERDAY);
      expect(y.measured.orders).toBe(2);
      expect(y.measured.revenue).toBeCloseTo(100.5, 2);
    } finally { proto.select = saved.select; Object.defineProperty(proto, 'connected', saved.connected); }
  });

  test('a store whose date column cannot be read reports unknown, not zeros', async () => {
    // The filtered order query 400s if the date column is absent, and the
    // adapter degrades a failed read to []. Without checking the column, every
    // day would print a measured zero sourced from a query that never ran.
    const restore = stubDb({
      slots: SLOTS, campaigns: CAMPAIGNS, orders: [],
      orderProbe: [{ id: 1, order_placed_on: '2026-08-12', total: '40' }],   // no ordered_at / created_at / processed_at
    });
    try {
      const out = await dc.dayCalendar({ from: dc.addDaysIso(TODAY, -3), to: TODAY });
      const y = out.days.find((d) => d.date === YESTERDAY);
      expect(y.measured.orders).toBeNull();
      expect(y.blockers.join(' ')).toMatch(/date columns this view can bucket by/i);
      expect(y.blockers.join(' ')).toMatch(/ordered_at/);
      // And it names what it DID see, so the fix is obvious.
      expect(y.blockers.join(' ')).toMatch(/order_placed_on/);
    } finally { restore(); }
  });

  test('a slot reports the channels it planned but never built', async () => {
    const restore = stubDb({ slots: SLOTS, campaigns: CAMPAIGNS, orderProbe: [ORDER_SHAPE] });
    try {
      const out = await dc.dayCalendar({ from: TODAY, to: TODAY });
      const s = out.days[0].slots[0];
      expect(s.campaign_id).toBe('c2');
      expect(s.assets_missing).toEqual(['google']);
      expect(s.assets_ready, 'a send missing a planned channel is not ready').toBe(false);
    } finally { restore(); }
  });

  test('a slot with no campaign is missing everything it planned', async () => {
    const restore = stubDb({ slots: SLOTS, campaigns: CAMPAIGNS, orderProbe: [ORDER_SHAPE] });
    try {
      const out = await dc.dayCalendar({ from: TOMORROW, to: TOMORROW });
      const s = out.days[0].slots[0];
      expect(s.campaign_id).toBeNull();
      expect(s.assets).toBeNull();
      expect(s.assets_missing).toEqual(['email', 'landing_page']);
    } finally { restore(); }
  });

  test('the production failure surfaces as blockers with the command that fixes it', async () => {
    // Exactly the state found in production: three weeks since the last write,
    // a short window, and not one prebuilt asset.
    const restore = stubDb({ slots: SLOTS, campaigns: [], orderProbe: [ORDER_SHAPE] });
    try {
      const out = await dc.dayCalendar({ from: dc.addDaysIso(TODAY, -3) });
      const kinds = out.blockers.map((b) => b.subsystem);
      expect(kinds).toContain('plan_sync');
      expect(kinds).toContain('asset_prebuild');
      const prebuild = out.blockers.find((b) => b.subsystem === 'asset_prebuild');
      // With no recorded prebuild run, the blocker must say the queue never
      // reached the build stage — not invent a cause it has not observed.
      expect(prebuild.detail).toMatch(/no recorded run/i);
      expect(prebuild.fix).toMatch(/CRON_SECRET/);
      expect(out.freshness.coverage.complete).toBe(false);
    } finally { restore(); }
  });

  test('when the queue HAS run, the blocker quotes its real error instead of guessing', async () => {
    // Zero built assets has at least three different causes with three different
    // fixes. The queue now leaves a run row so the surface reports the observed
    // one rather than the most plausible one.
    const restore = stubDb({
      slots: SLOTS, campaigns: [], orderProbe: [ORDER_SHAPE],
      runs: [{ id: 'r1', created_at: `${TODAY}T04:00:00Z`, payload: { kind: 'prebuild', built: 0, failed: 1, remaining: 115, errors: [{ id: 's3', error: 'image cascade exhausted: all providers returned 429' }] } }],
    });
    try {
      const out = await dc.dayCalendar({ from: TODAY });
      const prebuild = out.blockers.find((b) => b.subsystem === 'asset_prebuild');
      expect(prebuild.detail).toMatch(/all providers returned 429/);
      expect(prebuild.detail, 'it must explain why the queue then went quiet').toMatch(/stops the chain/i);
      expect(out.freshness.assets.last_prebuild.failed).toBe(1);
    } finally { restore(); }
  });

  test('no Supabase is a stated blocker, never an empty calendar that looks quiet', async () => {
    const services = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const proto = services.SmartBrainDbAdapter.prototype;
    const saved = Object.getOwnPropertyDescriptor(proto, 'connected');
    Object.defineProperty(proto, 'connected', { get() { return false; }, configurable: true });
    try {
      const out = await dc.dayCalendar({});
      expect(out.connected).toBe(false);
      expect(out.days).toEqual([]);
      expect(out.blocker).toMatch(/SUPABASE/);
    } finally { Object.defineProperty(proto, 'connected', saved); }
  });
});

test.describe('the surfaces are wired', () => {
  test('the route exists and no Serverless Function was added', () => {
    expect(BRAIN).toContain("case 'daily-calendar'");
    expect(fs.existsSync(path.join(ROOT, 'api', 'daily-calendar.js'))).toBe(false);
    expect(functionFileCount()).toBeLessThanOrEqual(12);
  });

  test('the console renders the status panel, and still READS the day endpoint', () => {
    // The day-card GRID is gone: /brain shows one calendar and it is the send
    // table (product owner's call). The day-level READ stays, because the
    // freshness cells above the table are computed from it - so #calbody and
    // #dayslots are deliberately absent while the fetch and #freshcells remain.
    for (const id of ['opsstatus', 'daycal', 'freshcells', 'opsblockers', 'plantable']) {
      expect(PAGE, `#${id} is missing from the console`).toContain(`id="${id}"`);
    }
    for (const id of ['calbody', 'dayslots']) {
      expect(PAGE, `#${id} is back - that is the second calendar returning`).not.toContain(`id="${id}"`);
    }
    expect(PAGE).toMatch(/loadDayCalendar\(true\)/);
    expect(PAGE).toContain('action=daily-calendar');
    expect(PAGE, 'the freshness card must still be rendered from that read').toMatch(/renderFreshness\(d\)/);
  });

  test('the migration that unblocks the writes ships in the apply-all bundle', () => {
    // It existed as a migration file since 2026-07-12 and was never applied,
    // which is what killed the loop. The bundle is what operators actually run.
    const combined = fs.readFileSync(path.join(ROOT, 'supabase', 'COMBINED_RUN_THIS.sql'), 'utf8');
    expect(combined).toMatch(/DROP INDEX IF EXISTS public\.smart_cal_date_market_idx/);
    expect(combined).toMatch(/CREATE INDEX IF NOT EXISTS smart_cal_date_market_idx/);
  });
});
