'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SMART BRAIN — Data Analysis Engine (OWN data only).
//
// Continuous, in-sync analysis of the linked backend DB's performance data.
//   • Performance scoring + threshold filtering of the own campaign library
//     (kb_campaigns) → surfaces only what cleared the bar to inspire new work.
//   • Personalized cohort building from user-level data.
//   • A daily-analysis pass that feeds calendar + generation downstream.
//
// STRICT ISOLATION: this module never imports or reads any ci_* competitor
// table. Benchmarking signals enter the calendar via a separate, read-only feed.
// "Config-driven, not hardcoded": thresholds live in analysis_config (DB) with
// safe defaults here.
// ─────────────────────────────────────────────────────────────────────────────

const supa = require('./supa');

const DEFAULT_THRESHOLDS = {
  email:  { open_rate: 0.18, ctr: 0.02, revenue_per_send: 0.15 },
  google: { roas: 2.5, ctr: 0.03 },
  meta:   { roas: 2.0, ctr: 0.012 },
  tiktok: { roas: 1.8, ctr: 0.008 },
  landing:{ conversion_rate: 0.025 }
};

async function loadThresholds() {
  // analysis_config is optional; fall back to defaults so the engine always runs.
  try {
    const rows = await supa.select('analysis_config', { filters: { key: 'eq.performance_thresholds' }, limit: 1 });
    if (rows[0]?.value) return { ...DEFAULT_THRESHOLDS, ...rows[0].value };
  } catch { /* table may not exist yet */ }
  return DEFAULT_THRESHOLDS;
}

// Normalize a campaign's raw metrics into a 0-100 composite score and decide if
// it cleared the channel threshold. Weighting favors efficiency (ROAS/RPS) then
// engagement (CTR/open).
function scoreCampaign(channel, metrics, thresholds) {
  const t = thresholds[channel] || {};
  const m = metrics || {};
  let hits = 0, checks = 0, ratioSum = 0;
  for (const [k, bar] of Object.entries(t)) {
    if (m[k] == null) continue;
    checks++;
    const ratio = bar ? m[k] / bar : 1;
    ratioSum += Math.min(ratio, 3);
    if (m[k] >= bar) hits++;
  }
  if (!checks) return { score: null, cleared: false };
  const score = Math.round(Math.min(100, (ratioSum / checks) * 40 + (hits / checks) * 30 + 30));
  return { score, cleared: hits >= Math.ceil(checks / 2) };
}

// Re-score the entire own campaign library against current thresholds.
async function rescoreLibrary({ limit = 1000 } = {}) {
  const thresholds = await loadThresholds();
  const campaigns = await supa.select('kb_campaigns', { order: 'launched_at.desc', limit });
  let cleared = 0;
  for (const c of campaigns) {
    const { score, cleared: ok } = scoreCampaign(c.channel, c.metrics, thresholds);
    if (score == null) continue;
    if (ok) cleared++;
    await supa.update('kb_campaigns',
      { performance_score: score, cleared_threshold: ok },
      { id: `eq.${c.id}` });
  }
  return { scored: campaigns.length, cleared, thresholds };
}

// Performance-filtered library read — the "what worked before" feed for the
// generation engine. Optionally constrained to a channel / cohort.
async function topPerformers({ channel, cohort_key, limit = 25 } = {}) {
  const filters = { cleared_threshold: 'eq.true' };
  if (channel)    filters.channel = `eq.${channel}`;
  if (cohort_key) filters.cohort_key = `eq.${cohort_key}`;
  return supa.select('kb_campaigns', { filters, order: 'performance_score.desc', limit });
}

// Build / refresh personalized cohorts. In production the membership query runs
// against the linked DB's user-level table; here we persist the cohort
// DEFINITION + the latest computed size handed in by the sync job.
async function upsertCohort(def) {
  const cohort_key = def.cohort_key || def.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const row = {
    cohort_key, name: def.name, market: def.market || null,
    definition: def.definition || {}, size: def.size ?? null, rfm: def.rfm || null,
    lifecycle_stage: def.lifecycle_stage || null, computed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const [r] = await supa.insert('cohorts', [row], { upsertOn: 'cohort_key' });
  return r;
}

async function listCohorts() {
  return supa.select('cohorts', { order: 'size.desc', limit: 200 });
}

// The daily analysis pass: re-score the library, refresh derived signals, and
// log a snapshot. Returns the signal bundle the calendar consumes.
async function dailyAnalysis() {
  const rescored = await rescoreLibrary({});
  const cohorts = await listCohorts();
  const top = await topPerformers({ limit: 50 });

  // Derive simple "winning patterns" the calendar/generation can lean on:
  // most common winning hooks/angles/formats among cleared campaigns.
  const tally = (arr, key) => {
    const m = {};
    for (const c of arr) for (const a of (c.assets || [])) { const v = a[key]; if (v) m[v] = (m[v] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => ({ value: k, count: n }));
  };
  const signals = {
    generated_at: new Date().toISOString(),
    library: { cleared: rescored.cleared, scored: rescored.scored },
    winning_hooks:   tally(top, 'hook'),
    winning_angles:  tally(top, 'angle'),
    winning_formats: tally(top, 'format'),
    cohorts: cohorts.map(c => ({ cohort_key: c.cohort_key, size: c.size, lifecycle_stage: c.lifecycle_stage }))
  };
  try {
    await supa.insert('recalibration_log', [{
      kind: 'daily_review', actor: 'system', scope: ['thresholds', 'cohorts'],
      summary: signals, slots_touched: 0,
      next_due_at: new Date(Date.now() + 86400000).toISOString()
    }]);
  } catch {}
  return signals;
}

module.exports = {
  DEFAULT_THRESHOLDS, loadThresholds, scoreCampaign, rescoreLibrary,
  topPerformers, upsertCohort, listCohorts, dailyAnalysis
};
