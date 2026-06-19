'use strict';

/**
 * /api/brain — Smart Brain router (single Vercel function, ?action= dispatch).
 *
 * Modules (logic in api/_shared/brain-*.js — excluded from the function count):
 *   KB              ?action=kb | kb-patterns
 *   ANALYSIS        ?action=analyze (POST) | cohorts | library | scores
 *   COMPETITOR      ?action=benchmarks  (isolated stream)
 *   CALENDAR        ?action=calendar | calendar-generate (POST) |
 *                   calendar-review (POST) | festivals | festivals-extract (POST) |
 *                   feedback (POST) | mvt (GET/POST)
 *   GENERATION      ?action=generate (POST {slot_id}) | assets | asset (?id=) | campaigns
 *   REVIEW (HITL)   ?action=review | decide (POST) | recalibrate (POST) | confidence
 *   AGENTS          ?action=agents | agent-upsert (POST) | agent-sync (POST) |
 *                   agent-chat (POST) | agent-sessions
 *   CONSOLE         ?action=console-chat (POST) — chat-style brain console
 *   OPS             ?action=status | config (GET/POST) | cron (daily loop)
 *
 * Daily cron: GET /api/brain?action=cron — guarded by CRON_SECRET when set
 * (Vercel sends Authorization: Bearer $CRON_SECRET) or vercel-cron UA.
 */

const core = require('./_shared/brain-core.js');
const kb = require('./_shared/brain-kb.js');
const analysis = require('./_shared/brain-analysis.js');
const competitor = require('./_shared/brain-competitor.js');
const calendar = require('./_shared/brain-calendar.js');
const generate = require('./_shared/brain-generate.js');
const review = require('./_shared/brain-review.js');
const agents = require('./_shared/brain-agent.js');

let callLLM = null;
try { callLLM = require('./_shared/llm.js'); } catch (_) { callLLM = null; }

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return req.body;
}

function cronAuthorized(req) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret) {
    const auth = req.headers.authorization || '';
    return auth === `Bearer ${secret}` || (req.query && req.query.secret === secret);
  }
  return /vercel-cron/i.test(req.headers['user-agent'] || '') || true; // no secret configured → open (internal tool)
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = String((req.query || {}).action || '').toLowerCase();
  const b = body(req);

  try {
    switch (action) {
      // ── OPS ──────────────────────────────────────────────────────────────
      case 'status': {
        const d = core.db();
        let dbOk = false, counts = {};
        try {
          const [c, s, g, q] = await Promise.all([
            d.select('smart_campaigns', { select: 'id', limit: 1 }),
            d.select('smart_calendar', { select: 'id,status', limit: 1000 }),
            d.select('smart_generated_campaigns', { select: 'id,status', limit: 1000 }),
            d.select('smart_review_queue', { select: 'id,state', limit: 500, filters: { state: 'eq.pending' } }),
          ]);
          dbOk = true;
          counts = {
            calendar_slots: s.length,
            slots_final: s.filter((x) => x.status === 'final').length,
            generated_campaigns: g.length,
            pending_review: q.length,
          };
        } catch (e) { counts = { error: e.message }; }
        const recal = await review.recalibrationStatus().catch(() => null);
        return res.json({
          ok: true, service: 'vahdam-smart-brain', db_linked: dbOk,
          llm_available: !!callLLM, live_platform_push: false,
          modules: ['knowledge_base', 'analysis', 'competitor_benchmarking', 'calendar_intelligence', 'generation', 'human_review', 'agents'],
          counts, weekly_recalibration: recal,
        });
      }
      case 'config': {
        if (req.method === 'POST') {
          for (const [k, v] of Object.entries(b.config || {})) await core.setConfig(k, v);
          return res.json({ ok: true, updated: Object.keys(b.config || {}) });
        }
        return res.json({ ok: true, config: await core.getConfig() });
      }

      // ── KB ───────────────────────────────────────────────────────────────
      case 'kb': {
        const lib = await kb.libraryIndex();
        return res.json({ ok: true, campaigns: lib.length, library: lib.slice(0, parseInt(req.query.limit || '100', 10)) });
      }
      case 'kb-patterns': {
        const lib = await kb.libraryIndex();
        return res.json({ ok: true, patterns: kb.patterns(lib) });
      }

      // ── ANALYSIS ─────────────────────────────────────────────────────────
      case 'analyze': {
        const out = await analysis.runDaily({ persist: req.method === 'POST' });
        await core.logRun('manual', out.summary, true);
        return res.json({ ok: true, ...out });
      }
      case 'cohorts': {
        const rows = await core.db().select('smart_cohorts', { limit: 200, order: 'value_score.desc', filters: { active: 'eq.true' } });
        return res.json({ ok: true, cohorts: rows });
      }
      case 'library': {
        const out = await analysis.filteredLibrary({ channel: req.query.channel, market: req.query.market, cohortId: req.query.cohort });
        return res.json({ ok: true, ...out });
      }
      case 'scores': {
        const rows = await core.db().select('smart_library_scores', { limit: 1000, order: 'score.desc' });
        return res.json({ ok: true, scores: rows });
      }

      // ── COMPETITOR (isolated) ────────────────────────────────────────────
      case 'benchmarks': {
        const out = await competitor.benchmarks({ persist: req.method === 'POST' });
        return res.json({ ok: true, benchmarks: out });
      }

      // ── CALENDAR ─────────────────────────────────────────────────────────
      case 'calendar': {
        const filters = { slot_date: `gte.${req.query.from || core.todayIso()}` };
        if (req.query.market) filters.market = `eq.${req.query.market}`;
        const rows = await core.db().select('smart_calendar', { limit: 1500, order: 'slot_date.asc', filters });
        return res.json({ ok: true, slots: rows });
      }
      case 'calendar-generate': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await calendar.generate({ startDate: b.start_date, days: b.days, persist: true, regenerate: b.regenerate === true });
        await core.logRun('manual', { calendar_generate: { created: out.created } }, true);
        return res.json(out);
      }
      case 'calendar-review': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await calendar.dailyReview({ persist: true });
        return res.json(out);
      }
      case 'festivals': {
        const rows = await core.db().select('smart_festivals', { limit: 500, order: 'mmdd.asc' });
        return res.json({ ok: true, festivals: rows });
      }
      case 'festivals-extract': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await calendar.extractFestivals({ persist: true });
        return res.json({ ok: true, detected: out.length, festivals: out });
      }
      case 'feedback': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const row = {
          target_type: b.target_type || 'calendar_slot', target_id: b.target_id,
          verdict: b.verdict || 'comment', notes: b.notes || '', reviewer: b.reviewer || null,
        };
        await core.db().insert('smart_feedback', [row]);
        return res.json({ ok: true, feedback: row, applied_at: 'next daily review' });
      }
      case 'mvt': {
        if (req.method === 'POST') {
          await core.db().insert('smart_mvt_results', [{
            slot_id: b.slot_id || null, campaign_id: b.campaign_id || null,
            variant: b.variant || 'A', dimension: b.dimension || 'hook',
            metrics: b.metrics || {}, winner: b.winner === true, learned: b.learned || {},
          }]);
          const applied = await calendar.applyMvt({ persist: true });
          return res.json({ ok: true, recorded: true, weights: applied });
        }
        const rows = await core.db().select('smart_mvt_results', { limit: 200, order: 'created_at.desc' });
        return res.json({ ok: true, results: rows });
      }

      // ── GENERATION ───────────────────────────────────────────────────────
      case 'generate': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!b.slot_id) return res.status(400).json({ ok: false, error: 'slot_id required' });
        const out = await generate.generateForSlot(b.slot_id, { persist: true });
        return res.json(out);
      }
      case 'assets': {
        const filters = {};
        if (req.query.slot) filters.slot_id = `eq.${req.query.slot}`;
        const rows = await core.db().select('smart_generated_assets', { select: 'id,slot_id,type,name,meta,created_at,generated_campaign_id', limit: 500, order: 'created_at.desc', filters });
        return res.json({ ok: true, assets: rows });
      }
      case 'asset': {
        const rows = await core.db().select('smart_generated_assets', { filters: { id: `eq.${req.query.id}` }, limit: 1 });
        if (!rows[0]) return res.status(404).json({ ok: false, error: 'asset not found' });
        if (req.query.raw === '1' && /html/.test(rows[0].type)) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.status(200).send(rows[0].content || '');
        }
        return res.json({ ok: true, asset: rows[0] });
      }
      case 'campaigns': {
        const filters = {};
        if (req.query.status) filters.status = `eq.${req.query.status}`;
        const rows = await core.db().select('smart_generated_campaigns', { limit: 500, order: 'created_at.desc', filters });
        return res.json({ ok: true, campaigns: rows });
      }

      // ── REVIEW (HITL) ────────────────────────────────────────────────────
      case 'review': {
        const out = await review.queue({ state: req.query.state || 'pending' });
        return res.json({ ok: true, ...out });
      }
      case 'decide': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await review.decide({ queueId: b.queue_id, itemId: b.item_id, decision: b.decision, reviewer: b.reviewer, notes: b.notes });
        return res.json(out);
      }
      case 'recalibrate': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await review.recalibrate({ reviewer: b.reviewer, decisions: b.decisions || [], configPatches: b.config || {} });
        await core.logRun('weekly', { recalibration: out }, true);
        return res.json(out);
      }
      case 'confidence': {
        const rows = await core.db().select('smart_confidence', { limit: 20 });
        return res.json({ ok: true, confidence: rows, recalibration: await review.recalibrationStatus() });
      }

      // ── AGENTS ───────────────────────────────────────────────────────────
      case 'agents': {
        return res.json({ ok: true, agents: await agents.listAgents() });
      }
      case 'agent-upsert': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const a = await agents.upsertAgent(b);
        return res.json({ ok: true, agent: a });
      }
      case 'agent-sync': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await agents.syncKnowledge(b.agent_id || 'agent_vahdam');
        return res.json({ ok: true, ...out });
      }
      case 'agent-chat': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!b.message) return res.status(400).json({ ok: false, error: 'message required' });
        const out = await agents.chat({ agentId: b.agent_id || 'agent_vahdam', sessionId: b.session_id, message: b.message, context: b.context || {}, history: b.history || [] });
        return res.json(out);
      }
      case 'agent-sessions': {
        const filters = {};
        if (req.query.agent) filters.agent_id = `eq.${req.query.agent}`;
        const rows = await core.db().select('smart_agent_sessions', { limit: 200, order: 'started_at.desc', filters });
        return res.json({ ok: true, sessions: rows });
      }

      // ── TTS (ElevenLabs proxy — premium voice for the agents; clients fall
      //    back to browser speechSynthesis when not configured) ─────────────
      case 'tts': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) return res.status(501).json({ ok: false, error: 'ELEVENLABS_API_KEY not configured — client should use browser speechSynthesis fallback' });
        const voiceId = b.voice_id || process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': apiKey },
          body: JSON.stringify({ text: String(b.text || '').slice(0, 2400), model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
        });
        if (!r.ok) return res.status(502).json({ ok: false, error: `ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}` });
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.status(200).send(buf);
      }

      // ── CONSOLE (chat-style brain interface) ─────────────────────────────
      case 'console-chat': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!callLLM) return res.json({ ok: true, reply: 'LLM provider not configured — set GEMINI_API_KEY (free) or another provider in Vercel env. All brain data endpoints still work.' });
        // Assemble live brain context
        const [status, daily, recal] = await Promise.all([
          core.db().select('smart_calendar', { select: 'slot_date,market,channel,theme,angle,status', limit: 60, order: 'slot_date.asc', filters: { slot_date: `gte.${core.todayIso()}` } }).catch(() => []),
          analysis.runDaily({ persist: false }).catch(() => null),
          review.recalibrationStatus().catch(() => null),
        ]);
        const sys = `You are the VAHDAM Smart Brain console — the conversational interface to a lifecycle-marketing automation system (like ChatGPT, but grounded in THIS system's live data). Answer the operator's question using the context below. Be specific with numbers. If asked to act, tell them exactly which button/endpoint does it (e.g. "Generate assets" on a slot → POST /api/brain?action=generate). Keep replies tight.

LIVE CONTEXT
Daily analysis: ${daily ? JSON.stringify(daily.summary) : 'unavailable'}
Top angle patterns: ${daily ? JSON.stringify((daily.patterns.angle || []).slice(0, 4)) : '[]'}
Next 60 calendar slots: ${JSON.stringify(status)}
Weekly recalibration: ${JSON.stringify(recal)}`;
        let reply = '';
        try {
          const out = await callLLM({ systemPrompt: sys, userMessage: String(b.message || ''), maxTokens: 700, temperature: 0.4, timeoutMs: 35000, stage: 'console' });
          reply = (typeof out === 'string' ? out : out.text || '').trim();
        } catch (e) { reply = `Provider error: ${e.message}. Data endpoints remain available.`; }
        return res.json({ ok: true, reply });
      }

      // ── CRON: the daily automated loop ───────────────────────────────────
      case 'cron': {
        if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
        const started = Date.now();
        const steps = {};
        try { steps.festivals = { detected: (await calendar.extractFestivals({ persist: true })).length }; } catch (e) { steps.festivals = { error: e.message }; }
        try { const r = await calendar.dailyReview({ persist: true }); steps.daily_review = { changes: r.review.changes.length, pass_rate: r.daily_summary.pass_rate }; } catch (e) { steps.daily_review = { error: e.message }; }
        try { steps.benchmarks = { ok: true, markets: Object.keys(await competitor.benchmarks({ persist: true })).filter((k) => k !== '_advisory') }; } catch (e) { steps.benchmarks = { error: e.message }; }
        try { steps.auto_approve = await review.autoApproveSweep(); } catch (e) { steps.auto_approve = { error: e.message }; }
        // auto-generate assets for approved slots within 3 days
        try {
          const soon = core.addDays(core.todayIso(), 3);
          const slots = await core.db().select('smart_calendar', { limit: 20, filters: { status: 'eq.approved', slot_date: `lte.${soon}` } });
          let generated = 0;
          for (const s of slots.slice(0, 5)) { // cap per run for serverless time budget
            try { await generate.generateForSlot(s.id, { persist: true }); generated++; } catch (_) {}
          }
          steps.generation = { approved_due: slots.length, generated };
        } catch (e) { steps.generation = { error: e.message }; }
        const recal = await review.recalibrationStatus().catch(() => null);
        steps.weekly_recalibration_gate = recal;
        const summary = { steps, ms: Date.now() - started };
        await core.logRun('cron', summary, true);
        return res.json({ ok: true, ...summary });
      }

      default:
        return res.status(400).json({ ok: false, error: 'Unknown action', actions: ['status', 'config', 'kb', 'kb-patterns', 'analyze', 'cohorts', 'library', 'scores', 'benchmarks', 'calendar', 'calendar-generate', 'calendar-review', 'festivals', 'festivals-extract', 'feedback', 'mvt', 'generate', 'assets', 'asset', 'campaigns', 'review', 'decide', 'recalibrate', 'confidence', 'agents', 'agent-upsert', 'agent-sync', 'agent-chat', 'agent-sessions', 'console-chat', 'cron'] });
    }
  } catch (err) {
    console.error('[api/brain]', action, err);
    return res.status(500).json({ ok: false, action, error: err.message });
  }
};
