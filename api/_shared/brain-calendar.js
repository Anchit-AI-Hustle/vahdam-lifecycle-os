'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SMART BRAIN — Calendar Intelligence.
//
//   • Auto-extract festivals / sales moments / seasonal peaks from past years
//     (calendar_events history in the linked DB, with a built-in fallback set).
//   • Generate a TENTATIVE 15-day rolling calendar: mailers + ads (Google/Meta/
//     TikTok) + landing pages for both.
//   • DAILY automated review: re-check each slot against the latest analysis
//     signals + (read-only) competitor-benchmark feed, then auto-update.
//   • MVT loop: fold experiment winners back into priorities.
//   • Feedback: apply captured human feedback to future generation.
//
// Own-data analysis is the primary driver. The competitor feed is consumed
// READ-ONLY (counts/offer-mix only) and never merged into own-data scoring.
// ─────────────────────────────────────────────────────────────────────────────

const supa = require('./supa');
const analysis = require('./brain-analysis');

const CHANNELS = ['email', 'google', 'meta', 'tiktok'];

// Fallback seasonal calendar (used only when the DB has no history yet).
const FALLBACK_MOMENTS = [
  { md: '01-01', theme: 'New Year Reset', weight: 0.8 },
  { md: '02-14', theme: 'Valentine Gifting', weight: 0.7 },
  { md: '03-08', theme: 'International Women\'s Day', weight: 0.5 },
  { md: '05-01', theme: 'Spring Refresh', weight: 0.6 },
  { md: '06-21', theme: 'Summer Iced Tea', weight: 0.7 },
  { md: '10-01', theme: 'Festive Pre-Diwali', weight: 0.9 },
  { md: '11-29', theme: 'Black Friday', weight: 1.0 },
  { md: '12-15', theme: 'Holiday Gifting', weight: 0.9 }
];

// Pull seasonal/festival moments. Prefer DB history; fall back to constants.
async function getMoments(rangeStart, rangeEnd) {
  let moments = [];
  try {
    const rows = await supa.select('calendar_events', { order: 'event_date.asc', limit: 500 });
    moments = rows.map(r => ({ md: (r.event_date || '').slice(5, 10), theme: r.name, weight: r.weight ?? 0.7 }));
  } catch { /* no history table */ }
  if (!moments.length) moments = FALLBACK_MOMENTS;
  // Keep moments whose month-day falls inside the window.
  const inWindow = (md) => {
    for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
      if (d.toISOString().slice(5, 10) === md) return new Date(d);
    }
    return null;
  };
  return moments.map(m => ({ ...m, date: inWindow(m.md) })).filter(m => m.date);
}

// Build the tentative 15-day rolling calendar. Idempotent for a given start:
// existing future tentative/auto slots are replaced; reviewed/approved/human
// slots are preserved.
async function generate({ startDate, days = 15, market = 'US' } = {}) {
  const start = startDate ? new Date(startDate) : new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + days);

  const signals = await analysis.dailyAnalysis();
  const cohorts = (signals.cohorts || []);
  const moments = await getMoments(new Date(start), new Date(end));
  const benchmark = await benchmarkFeed(); // read-only competitor signal

  // Clear stale auto/tentative slots in the window so re-gen is clean.
  const fromIso = start.toISOString().slice(0, 10);
  await supa.rest('calendar_slots', {
    method: 'DELETE',
    query: { slot_date: `gte.${fromIso}`, status: 'eq.tentative', source: 'eq.auto' }
  }).catch(() => {});

  const slots = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const moment = moments.find(m => m.date && m.date.toISOString().slice(0, 10) === iso);
    const cohort = cohorts[i % Math.max(cohorts.length, 1)] || { cohort_key: 'all-subscribers' };
    const theme = moment ? moment.theme : pickEvergreenTheme(signals, i);

    // One mailer per day; rotate paid channels; landing pages paired with each.
    const dayChannels = ['email', CHANNELS[1 + (i % 3)]];
    for (const channel of dayChannels) {
      const isAd = channel !== 'email';
      const priority = computePriority({ moment, channel, signals, benchmark });
      slots.push({
        slot_date: iso, channel, asset_kind: isAd ? 'ad' : 'mailer',
        cohort_key: cohort.cohort_key, market, theme,
        rationale: {
          driver: moment ? 'seasonal_moment' : 'evergreen',
          winning_hook: signals.winning_hooks?.[0]?.value || null,
          benchmark_offer_mix: benchmark.offer_mix || null
        },
        priority, status: 'tentative', source: 'auto'
      });
      // Paired landing page for every mailer + ad.
      slots.push({
        slot_date: iso, channel, asset_kind: 'landing_page',
        cohort_key: cohort.cohort_key, market, theme,
        rationale: { paired_with: isAd ? channel : 'mailer' },
        priority: priority - 0.05, status: 'tentative', source: 'auto'
      });
    }
  }
  const inserted = await supa.insert('calendar_slots', slots);
  return { start: fromIso, days, slots: inserted.length, signals_at: signals.generated_at };
}

function pickEvergreenTheme(signals, i) {
  const hooks = signals.winning_hooks || [];
  return hooks.length ? hooks[i % hooks.length].value : 'Origin & Ritual';
}

function computePriority({ moment, channel, signals, benchmark }) {
  let p = 0.5;
  if (moment) p += moment.weight * 0.4;
  if (channel === 'email') p += 0.1; // owned channel, cheapest
  if ((signals.library?.cleared || 0) > 0) p += 0.05;
  // Competitors crowding an offer type slightly raises urgency to respond.
  if (benchmark.active_offers > 10) p += 0.05;
  return Math.round(Math.min(1, p) * 100) / 100;
}

// READ-ONLY competitor benchmark feed. Returns aggregate signals ONLY — never
// row-level competitor data merged into own scoring.
async function benchmarkFeed() {
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const offers = await supa.select('ci_offers', { filters: { last_seen: `gte.${since}` }, select: 'offer_type', limit: 1000 });
    const mix = {};
    for (const o of offers) mix[o.offer_type] = (mix[o.offer_type] || 0) + 1;
    return { active_offers: offers.length, offer_mix: mix };
  } catch { return { active_offers: 0, offer_mix: {} }; }
}

// DAILY automated review: re-score priorities against fresh signals; bump or
// demote tentative slots; log the review. Approved/verified slots untouched.
async function dailyReview() {
  const today = new Date().toISOString().slice(0, 10);
  const slots = await supa.select('calendar_slots', {
    filters: { slot_date: `gte.${today}`, status: 'in.(tentative,reviewed)' },
    order: 'slot_date.asc', limit: 500
  });
  const signals = await analysis.dailyAnalysis();
  const benchmark = await benchmarkFeed();
  let touched = 0;
  for (const s of slots) {
    const moment = null; // already encoded in theme; re-weight on signals only
    const priority = computePriority({ moment, channel: s.channel, signals, benchmark });
    if (Math.abs((s.priority || 0) - priority) >= 0.01) {
      await supa.update('calendar_slots',
        { priority, status: 'reviewed', last_reviewed_at: new Date().toISOString(),
          revision: (s.revision || 1) + 1 },
        { id: `eq.${s.id}` });
      touched++;
    }
  }
  await applyFeedback(); // fold any pending human feedback into the plan
  try {
    await supa.insert('recalibration_log', [{
      kind: 'daily_review', actor: 'system', scope: ['calendar'],
      summary: { reviewed: slots.length, benchmark }, slots_touched: touched,
      next_due_at: new Date(Date.now() + 86400000).toISOString()
    }]);
  } catch {}
  return { reviewed: slots.length, touched };
}

// Apply un-applied human feedback to the calendar (reject → cancel slot; edit →
// patch; approve → lock status). Feedback also informs FUTURE generation by
// staying queryable in calendar_feedback.
async function applyFeedback() {
  const pending = await supa.select('calendar_feedback', { filters: { applied: 'eq.false' }, limit: 200 });
  for (const fb of pending) {
    if (!fb.slot_id) { await supa.update('calendar_feedback', { applied: true }, { id: `eq.${fb.id}` }); continue; }
    if (fb.verdict === 'reject') await supa.update('calendar_slots', { status: 'rejected' }, { id: `eq.${fb.slot_id}` });
    else if (fb.verdict === 'approve') await supa.update('calendar_slots', { status: 'approved', source: 'human' }, { id: `eq.${fb.slot_id}` });
    else if (fb.verdict === 'edit' && fb.patch) await supa.update('calendar_slots', { ...fb.patch, source: 'human' }, { id: `eq.${fb.slot_id}` });
    await supa.update('calendar_feedback', { applied: true }, { id: `eq.${fb.id}` });
  }
  return { applied: pending.length };
}

async function recordFeedback(fb) {
  const [r] = await supa.insert('calendar_feedback', [{
    slot_id: fb.slot_id || null, user_email: fb.user_email || null,
    verdict: fb.verdict, rating: fb.rating ?? null, notes: fb.notes || null, patch: fb.patch || {}
  }]);
  return r;
}

// MVT loop: conclude experiments with a winner and let their winning factor
// levels raise priority of matching future slots.
async function applyMvtWinners() {
  const concluded = await supa.select('mvt_experiments', { filters: { status: 'eq.concluded' }, limit: 100 });
  let boosted = 0;
  for (const exp of concluded) {
    if (!exp.winner) continue;
    const today = new Date().toISOString().slice(0, 10);
    const slots = await supa.select('calendar_slots', {
      filters: { slot_date: `gte.${today}`, channel: `eq.${exp.channel}`, cohort_key: `eq.${exp.cohort_key}` }, limit: 200
    });
    for (const s of slots) {
      await supa.update('calendar_slots',
        { priority: Math.min(1, (s.priority || 0.5) + 0.08),
          rationale: { ...(s.rationale || {}), mvt_winner: exp.winner } },
        { id: `eq.${s.id}` });
      boosted++;
    }
  }
  return { experiments: concluded.length, slots_boosted: boosted };
}

async function getCalendar({ from, to } = {}) {
  // PostgREST can't express two filters on one column via the simple helper, so
  // we lower-bound in the query and upper-bound (to) in memory.
  let rows = await supa.select('calendar_slots', {
    filters: from ? { slot_date: `gte.${from}` } : {},
    order: 'slot_date.asc', limit: 1000
  });
  if (to) rows = rows.filter(r => r.slot_date <= to);
  return rows;
}

module.exports = {
  CHANNELS, getMoments, generate, dailyReview, applyFeedback, recordFeedback,
  applyMvtWinners, benchmarkFeed, getCalendar
};
