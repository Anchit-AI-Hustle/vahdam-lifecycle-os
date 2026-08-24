const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// THE SMART BRAIN STOPPED, AND NOTHING SAID SO
//
// /brain served a 160-slot rolling calendar in which nothing had been touched
// since 2026-08-14: the horizon had stopped extending (80 days ahead, not 90),
// no slot had been re-reviewed against fresh data, and not one slot carried a
// __prebuilt marker. The plan was not broken - it was never being re-run.
//
// The only thing that refreshes it was `/api/brain?action=cron`, whose function
// has maxDuration 120 in vercel.json. That handler ran nine heavy steps in
// series - including up to five full LLM campaign generations - and reached the
// Smart Brain plan sync NINTH. Vercel killed the invocation at the cap
// ("Vercel Runtime Timeout Error: Task timed out after 120 seconds", logged as
// 504 GET /api/brain at 18:31, exactly the cron's schedule), so the plan sync
// never ran, and core.logRun() - the last line - never recorded the run either.
// A cron that dies mid-chain is indistinguishable from one that is not
// scheduled, and both look like a quiet day.
//
// These tests pin the three things that make that failure impossible to repeat:
// the plan has its OWN schedule; inside the shared cron it runs before the
// expensive step; and a run that runs out of time says so.

const ROOT = path.join(__dirname, '..');
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const BRAIN = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');

// The cron case block, isolated, so ordering assertions cannot accidentally
// match an identically named step somewhere else in a 1000-line router.
const CRON_BLOCK = (() => {
  const start = BRAIN.indexOf("case 'cron': {");
  expect(start, 'the cron action has disappeared from api/brain.js').toBeGreaterThan(-1);
  const end = BRAIN.indexOf("case 'os-connectors'", start);
  return BRAIN.slice(start, end > start ? end : undefined);
})();

// ── The rolling plan has its own schedule ───────────────────────────────────
test('a scheduled cron reaches the Smart Brain plan sync', () => {
  const crons = VERCEL.crons || [];
  const rewrites = VERCEL.rewrites || [];
  // Resolve each cron path the way the platform does: literal path, or through
  // a rewrite. The documented design (CLAUDE.md) was /api/cron/smart-brain ->
  // ?action=smart-brain-cron, and neither the cron nor the rewrite existed.
  const resolved = crons.map((c) => {
    const [pathname] = String(c.path).split('?');
    const rw = rewrites.find((r) => r.source === pathname);
    return { schedule: c.schedule, target: rw ? rw.destination : c.path };
  });
  const sb = resolved.filter((r) => /action=smart-brain-cron/.test(r.target));
  expect(sb.length, `no cron reaches ?action=smart-brain-cron. Scheduled: ${JSON.stringify(resolved)}`).toBeGreaterThan(0);
  // Daily, not weekly: the window is re-planned every day by design.
  for (const r of sb) expect(String(r.schedule), 'the plan sync must run daily').toMatch(/^\S+ \S+ \* \* \*$/);
});

test('that cron lands on an existing function, and adds no new one', () => {
  const rewrites = VERCEL.rewrites || [];
  const rw = rewrites.find((r) => r.source === '/api/cron/smart-brain');
  expect(rw, 'the /api/cron/smart-brain rewrite is missing').toBeTruthy();
  const file = String(rw.destination).split('?')[0].replace(/^\//, '') + '.js';
  expect(fs.existsSync(path.join(ROOT, file)), `${file} does not exist, so the cron would 404`).toBe(true);
  // It must reuse a ?action= router rather than a new api/*.js file: every
  // non-_shared file under api/ counts against the Serverless Function cap.
  expect(rw.destination).toContain('?action=');
});

test('the calendar router still serves that action', () => {
  const cal = fs.readFileSync(path.join(ROOT, 'api', 'calendar.js'), 'utf8');
  expect(cal).toContain("smartAction === 'cron'");
  expect(cal, 'the cron action must actually sync the plan').toMatch(/plan\.syncDaily\(\{ persist: true, includePlan: false \}\)/);
  // A cron that discards the plan must not pay to read it back (~2MB), but it
  // must still report coverage - that number is the alarm for a window that
  // stopped extending.
  expect(cal).toMatch(/coverage: result\.coverage/);
  expect(cal, 'the cron response must carry the sync verdict, not a constant').toMatch(/ok: result\.ok !== false/);
});

// ── Inside the shared cron: cheap core loop before expensive generation ─────
test('the plan sync runs before per-slot asset generation', () => {
  const plan = CRON_BLOCK.indexOf("'smart_brain_plan'");
  const gen = CRON_BLOCK.indexOf("'generation'");
  expect(plan, 'the smart_brain_plan step is gone from the daily cron').toBeGreaterThan(-1);
  expect(gen, 'the generation step is gone from the daily cron').toBeGreaterThan(-1);
  expect(plan, 'asset generation runs before the plan sync again - that is the starvation this fixed').toBeLessThan(gen);
});

test('every step in the daily cron is gated on the remaining budget', () => {
  // The old shape was `try { steps.x = await ... } catch`, which cannot know
  // whether there is time to finish. Each step now goes through step(name, needMs, fn).
  for (const name of ['os_daily', 'smart_brain_plan', 'festivals', 'daily_review', 'benchmarks', 'auto_approve', 'generation', 'snowflake_sync']) {
    expect(CRON_BLOCK, `${name} is not deadline-gated`).toMatch(new RegExp(`step\\('${name}',\\s*\\d+`));
  }
  // And the generation loop re-checks between slots, because ONE build can
  // outlast the whole remaining budget on its own.
  const loop = CRON_BLOCK.slice(CRON_BLOCK.indexOf("step('generation'"));
  expect(loop, 'the generation loop does not re-check the clock between slots').toMatch(/msLeft\(\) < \d+/);
});

test('a truncated run reports what it skipped', () => {
  expect(CRON_BLOCK).toMatch(/skipped_steps/);
  expect(CRON_BLOCK).toMatch(/timed_out/);
  // ok must account for skips: a run that ran out of time is not a success.
  expect(CRON_BLOCK).toMatch(/failed\.length === 0 && skipped\.length === 0/);
});

// ── With teeth: drive the deadline ──────────────────────────────────────────
test('with no time budget the cron skips every step and says so', async () => {
  // A 1ms budget starves the first step, so nothing here touches the database,
  // an LLM or the network. What it proves is that the guard is load-bearing:
  // remove it and these steps run (and this test hangs on real I/O instead of
  // returning a report).
  const saved = { secret: process.env.CRON_SECRET, budget: process.env.BRAIN_CRON_BUDGET_MS };
  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.BRAIN_CRON_BUDGET_MS = '1';
  try {
    const handler = require(path.join(ROOT, 'api', 'brain.js'));
    const out = await new Promise((resolve) => {
      const res = {
        _status: 200,
        setHeader() {}, status(c) { this._status = c; return this; },
        json(o) { resolve({ status: this._status, body: o }); },
        end() { resolve({ status: this._status, body: null }); },
      };
      handler({
        method: 'GET',
        query: { action: 'cron' },
        body: null,
        headers: { authorization: 'Bearer test-cron-secret' },
      }, res);
    });
    expect(out.status).toBe(200);
    expect(out.body.timed_out, 'a run with no budget must report timed_out').toBe(true);
    expect(out.body.ok, 'a run that skipped its work is not ok').toBe(false);
    expect(out.body.skipped_steps).toContain('smart_brain_plan');
    expect(out.body.skipped_steps).toContain('generation');
    expect(out.body.steps.smart_brain_plan.skipped).toBe('no time budget left');
  } finally {
    if (saved.secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved.secret;
    if (saved.budget === undefined) delete process.env.BRAIN_CRON_BUDGET_MS; else process.env.BRAIN_CRON_BUDGET_MS = saved.budget;
  }
});

test('an unauthenticated cron call is still refused', () => {
  // The budget work must not have loosened the guard on a loop that spends
  // model quota. (Production fails closed when CRON_SECRET is unset.)
  expect(BRAIN).toMatch(/function cronAuthorized/);
  expect(CRON_BLOCK).toMatch(/if \(!cronAuthorized\(req\)\) return res\.status\(401\)/);
});

// ── The sync itself could not fit in the function it runs in ────────────────
// Measured against production: POST ?action=smart-brain-sync-daily returned
// HTTP 504 after 2m01s. Measured against the live database: one PATCH per row
// costs ~389ms serially (~70s for a 180-slot window), the stored window is
// 1.89MB, and the sync read it twice. So the daily loop's own endpoint could not
// complete inside api/calendar.js's 120s cap, and a killed invocation writes no
// rows and leaves no record.
const PLAN_SRC = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'), 'utf8');
const sbplan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

test('the update phase is not one round-trip at a time any more', () => {
  expect(PLAN_SRC, 'the serial update loop is back').not.toMatch(/for \(const u of updates\) \{[\s\S]{0,200}await db\.update/);
  expect(PLAN_SRC).toMatch(/mapWithConcurrency\(attempted,\s*WIDTH/);
});

test('every row still gets its OWN conditional write', () => {
  // The optimistic lock is the whole reason this cannot become one bulk upsert:
  // the status filter is what makes a sync skip a row a human approved between
  // the read and the write. Sharing the WAIT is fine; sharing the write is not.
  const phase = PLAN_SRC.slice(PLAN_SRC.indexOf('const attempted = []'), PLAN_SRC.indexOf("mark('update_ms'"));
  expect(phase).toMatch(/id: `eq\.\$\{u\.id\}`, status: SYNC_WRITABLE_STATUSES/);
  expect(phase).toMatch(/skipped_locked \+= 1/);
});

test('a sync that runs out of budget defers rows instead of being killed', () => {
  expect(PLAN_SRC).toMatch(/SMART_BRAIN_SYNC_BUDGET_MS/);
  // Deferrals come from BOTH phases: a first sync after an outage is mostly
  // inserts (~720 slots on a 90-day window), so an insert phase that ignored the
  // clock could burn the whole budget before a single update was attempted.
  expect(PLAN_SRC).toMatch(/results\.deferred = deferred\.length \+ \(results\.deferred_inserts \|\| 0\)/);
  expect(PLAN_SRC).toMatch(/results\.truncated = results\.deferred > 0/);
  expect(PLAN_SRC, 'the insert phase does not watch the clock').toMatch(/insertRowsResilient\(db, config\.tableNames\.calendarEntries, inserts, \{ msLeft \}\)/);
  // And the insert itself is chunked, so neither the batch nor its per-row
  // fallback is unbounded in size.
  expect(PLAN_SRC).toMatch(/SMART_BRAIN_INSERT_CHUNK/);
  // And a truncated sync is not reported as ok.
  expect(PLAN_SRC).toMatch(/landed >= intended && !results\.truncated/);
  // The summary has to say what happens next, or "deferred" reads as "lost".
  expect(PLAN_SRC).toMatch(/the next sync re-derives and writes them/);
});

test('bounded concurrency runs everything, and never exceeds its width', async () => {
  let inFlight = 0; let peak = 0;
  const seen = [];
  const items = Array.from({ length: 25 }, (_, i) => i);
  await sbplan.mapWithConcurrency(items, 8, async (n) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    seen.push(n);
    inFlight -= 1;
  });
  expect(seen.sort((a, b) => a - b), 'an item was dropped or run twice').toEqual(items);
  expect(peak, `ran ${peak} at once with a width of 8`).toBeLessThanOrEqual(8);
  expect(peak, 'nothing ran in parallel at all').toBeGreaterThan(1);
});

test('a sync reports where its time went', async () => {
  // persist:false keeps this off the write path; the phases are still timed, so
  // the next slow run in production is diagnosable from its own response.
  const out = await sbplan.syncDaily({ persist: false, days: 14, includePlan: false });
  expect(out.timings, 'a sync with no timings is a sync nobody can diagnose').toBeTruthy();
  for (const k of ['context_ms', 'plan_build_ms', 'total_ms', 'budget_ms']) {
    expect(typeof out.timings[k], `timings.${k} is missing`).toBe('number');
  }
  // Coverage survives includePlan:false — it is the alarm, not a nicety.
  expect(out.coverage).toBeTruthy();
  expect(typeof out.coverage.covered_days).toBe('number');
  expect(out.truncated).toBe(false);
});

test('a huge first sync is chunked, and its fallback cannot run away', async () => {
  // 720 rows is the real shape of a 90-day x 2-market x 2-cohort window after an
  // outage. One request of that size is ~7MB, and if PostgREST refuses it for
  // ANY reason the old code re-tried all 720 rows one at a time at ~389ms each:
  // four minutes inside a 120s function. Chunks bound both paths.
  const calls = { batch: 0, single: 0, sizes: [] };
  const db = {
    async upsert(table, rows) {
      if (rows.length > 1) { calls.batch += 1; calls.sizes.push(rows.length); return { ok: true, rows }; }
      calls.single += 1; return { ok: true, rows };
    },
  };
  const rows = Array.from({ length: 720 }, (_, i) => ({ id: 'r' + i }));
  const out = await sbplan.insertRowsResilient(db, 't', rows);
  expect(out.inserted).toBe(720);
  expect(out.degraded).toBe(false);
  expect(calls.single, 'a clean run must not fan out into single writes').toBe(0);
  expect(calls.batch, 'the whole window went in one request again').toBeGreaterThan(1);
  expect(Math.max(...calls.sizes), 'a chunk is larger than the configured cap').toBeLessThanOrEqual(200);
});

test('a rejected chunk costs only that chunk', async () => {
  // The row that cannot be written must not take the other 719 with it, and the
  // rows that CAN be written must still land.
  const bad = 'r300';
  const stored = [];
  const db = {
    async upsert(table, rows) {
      if (rows.length > 1) {
        if (rows.some((r) => r.id === bad)) {
          return { ok: false, warning: 'Supabase upsert t failed: 409 {"code":"23505","details":"Key (date, market)=(x, US) already exists.","message":"duplicate key value violates unique constraint \\"smart_cal_date_market_idx\\""}' };
        }
        stored.push(...rows); return { ok: true, rows };
      }
      if (rows[0].id === bad) {
        return { ok: false, warning: 'Supabase upsert t failed: 409 {"code":"23505","details":"Key (date, market)=(x, US) already exists.","message":"duplicate key value violates unique constraint \\"smart_cal_date_market_idx\\""}' };
      }
      stored.push(rows[0]); return { ok: true, rows };
    },
  };
  const rows = Array.from({ length: 720 }, (_, i) => ({ id: 'r' + i }));
  const out = await sbplan.insertRowsResilient(db, 't', rows);
  expect(out.rejected).toBe(1);
  expect(out.inserted).toBe(719);
  expect(out.degraded, 'a fallback ran, so the run is degraded').toBe(true);
  expect(stored.length).toBe(719);
});

test('an insert phase with no budget defers instead of writing forever', async () => {
  const db = { async upsert(table, rows) { return { ok: true, rows }; } };
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: 'r' + i }));
  const out = await sbplan.insertRowsResilient(db, 't', rows, { msLeft: () => -1 });
  expect(out.inserted).toBe(0);
  expect(out.deferred).toBe(100);
});
