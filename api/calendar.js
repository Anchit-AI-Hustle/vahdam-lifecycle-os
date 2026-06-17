'use strict';

/**
 * /api/calendar — single-function router for calendar generation, mailer
 * triggering, AND the Smart-Brain loop (analysis / calendar intelligence /
 * generation / human-in-the-loop).
 *
 * Consolidated to keep us under Vercel Hobby's 12-function limit. Handlers live
 * in api/_shared/ (underscore prefix excludes them from Vercel's function
 * scan), so this file only dispatches.
 *
 * Legacy routes:
 *   ?action=generate          → POST: build a 30-day calendar (original)
 *   ?action=trigger-mailer    → POST: feed one calendar row into the pipeline
 *
 * Smart-Brain routes (all JSON; writes gated by CRON_SECRET when set):
 *   ANALYSIS
 *     ?action=analyze              → POST: run the daily data-analysis pass
 *     ?action=rescore-library      → POST: re-score own campaign library
 *     ?action=cohorts              → GET list / POST upsert a cohort
 *     ?action=top-performers       → GET threshold-cleared campaigns
 *   CALENDAR INTELLIGENCE
 *     ?action=brain-generate       → POST: build the 15-day rolling calendar
 *     ?action=daily-review         → POST: re-check + auto-update the calendar
 *     ?action=mvt-apply            → POST: fold MVT winners into priorities
 *     ?action=feedback             → POST: record human feedback on a slot
 *     ?action=calendar             → GET the current calendar (from/to)
 *   GENERATION + HITL
 *     ?action=gen-slot&id=         → POST: generate the campaign spec for a slot
 *     ?action=gen-approved         → POST: generate all approved slots
 *     ?action=verify&id=           → POST: human verify/finalize a spec
 *     ?action=recalibrate          → POST: log weekly human recalibration
 */

const generate = require('./_shared/calendar-generate.js');
const triggerMailer = require('./_shared/calendar-trigger.js');
const analysis = require('./_shared/brain-analysis.js');
const calendar = require('./_shared/brain-calendar.js');
const generation = require('./_shared/brain-generate.js');
const supa = require('./_shared/supa.js');

function authorized(req) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) return true; // unprotected in dev
  const auth = req.headers && req.headers.authorization;
  if (auth === `Bearer ${secret}`) return true;
  try { return new URL(req.url, 'http://x').searchParams.get('secret') === secret; } catch { return false; }
}

async function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body && req.method === 'POST') {
    body = await new Promise((resolve) => {
      let raw = ''; req.on('data', (c) => (raw += c));
      req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }
  return body || {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = (req.query?.action || '').toLowerCase();
  const q = req.query || {};

  // ── Legacy handlers (unchanged) ──
  if (action === 'generate') return generate(req, res);
  if (action === 'trigger-mailer' || action === 'triggermailer') return triggerMailer(req, res);

  try {
    // ── ANALYSIS ──
    if (action === 'analyze') {
      if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      return res.status(200).json({ ok: true, signals: await analysis.dailyAnalysis() });
    }
    if (action === 'rescore-library') {
      if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      return res.status(200).json({ ok: true, ...(await analysis.rescoreLibrary({})) });
    }
    if (action === 'cohorts') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        return res.status(200).json({ ok: true, cohort: await analysis.upsertCohort(body) });
      }
      return res.status(200).json({ ok: true, cohorts: await analysis.listCohorts() });
    }
    if (action === 'top-performers') {
      const rows = await analysis.topPerformers({
        channel: q.channel, cohort_key: q.cohort_key, limit: Number(q.limit || 25)
      });
      return res.status(200).json({ ok: true, count: rows.length, campaigns: rows });
    }

    // ── CALENDAR INTELLIGENCE ──
    if (action === 'brain-generate') {
      if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      const body = await readBody(req);
      return res.status(200).json({ ok: true, ...(await calendar.generate({
        startDate: body.startDate || q.start, days: Number(body.days || q.days || 15), market: body.market || q.market || 'US'
      })) });
    }
    if (action === 'daily-review') {
      if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      const review = await calendar.dailyReview();
      const mvt = await calendar.applyMvtWinners();
      return res.status(200).json({ ok: true, review, mvt });
    }
    if (action === 'mvt-apply') {
      if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      return res.status(200).json({ ok: true, ...(await calendar.applyMvtWinners()) });
    }
    if (action === 'feedback') {
      const body = await readBody(req);
      return res.status(200).json({ ok: true, feedback: await calendar.recordFeedback(body) });
    }
    if (action === 'calendar') {
      const rows = await calendar.getCalendar({ from: q.from, to: q.to });
      return res.status(200).json({ ok: true, count: rows.length, slots: rows });
    }

    // ── GENERATION + HUMAN-IN-THE-LOOP ──
    if (action === 'gen-slot') {
      if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      if (!q.id) return res.status(400).json({ ok: false, error: 'id required' });
      return res.status(200).json({ ok: true, ...(await generation.generateForSlot(q.id, { force: q.force === '1' })) });
    }
    if (action === 'gen-approved') {
      if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      return res.status(200).json({ ok: true, ...(await generation.generateApproved({ limit: Number(q.limit || 10) })) });
    }
    if (action === 'verify') {
      const body = await readBody(req);
      if (!q.id) return res.status(400).json({ ok: false, error: 'id required' });
      return res.status(200).json({ ok: true, spec: await generation.verifySpec(q.id, {
        user_email: body.user_email || q.user_email, approve: body.approve !== false
      }) });
    }
    if (action === 'recalibrate') {
      const body = await readBody(req);
      const [r] = await supa.insert('recalibration_log', [{
        kind: 'weekly_recalibration', actor: body.user_email || 'human',
        scope: body.scope || ['calendar', 'cohorts', 'filters', 'thresholds'],
        summary: body.summary || {}, slots_touched: body.slots_touched || 0,
        next_due_at: new Date(Date.now() + 7 * 86400000).toISOString()
      }]);
      return res.status(200).json({ ok: true, recalibration: r });
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(`[api/calendar] action=${action} failed:`, err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
