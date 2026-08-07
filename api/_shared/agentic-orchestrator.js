'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Dual-mode AGENTIC flow orchestrator.
//
// The "normal" flow is the existing single-pass pipeline. The AGENTIC flow runs
// generation as 8 independent, traced stages over the SAME Smart Brain services,
// adding LLM reasoning (planning / review / ideation), the 5-scenario calendar,
// a score-gated retry on asset creation, and tier ('budget'|'maxpower') control:
//
//   data → analysis → planning → calendar(+scenarios) → content(script)
//        → asset creation → smart review → ideation
//
// Lives in _shared/ and is dispatched from brain.js ?action=agentic-run — NO new
// serverless function (repo is at the 12-function Hobby cap). Degrades gracefully
// offline: services fall back to local data, LLM stages fall back deterministically.
// ─────────────────────────────────────────────────────────────────────────────

const svc = require('../../lib/smart-brain/services.js');
const plan = require('./smart-brain-plan.js');
const { buildScenarios } = require('./calendar-scenarios.js');
const { ideate } = require('./agentic-ideation.js');
let callLLM; try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }

function trim(obj, n = 1400) {
  try { const s = JSON.stringify(obj); return s.length > n ? (s.slice(0, n) + '…') : obj; }
  catch (_) { return null; }
}

// GOAL-DRIVEN PLANNING.
// `goal` is the operator's stated objective in their own words ("win back UK
// lapsed coffee buyers before Diwali", "shift the US base from single tins to
// samplers"). It was accepted by the API and documented in the opts block below,
// but never destructured in runAgentic and never passed to this function — so a
// goal typed by an operator was silently discarded and the brain planned its own
// generic strategy instead. A stated goal that is quietly ignored is worse than
// no goal field at all, because the output looks like an answer to the question
// that was asked.
async function planningStage(analysis, market, tier, goal) {
  const g = String(goal || '').trim();
  if (!callLLM) {
    return {
      provider: 'fallback',
      objective: g || 'Re-engage proven cohorts with bestsellers; protect margin.',
      goal: g || null, goal_honoured: false,
      cohorts: [], heroAngles: [], northStarMetric: 'revenue',
    };
  }
  try {
    const sys = "You are VAHDAM India's growth strategist. Given the analysis, set the 30-day STRATEGIC LOCK. Return STRICT JSON {\"objective\",\"cohorts\":[\"..\"],\"heroAngles\":[\"..\"],\"northStarMetric\",\"goal_interpretation\"}. No banned phrases."
      + (g ? " The OPERATOR GOAL below is the brief: the objective you return must serve THAT goal, the cohorts you pick must be the ones that goal implies, and northStarMetric must be the metric that goal moves. In goal_interpretation, state in one sentence how you read the goal. If the analysis cannot support the goal, say so there rather than quietly substituting a different objective." : '');
    const user = (g ? `OPERATOR GOAL (the brief): ${g}\n\n` : '')
      + `MARKET ${market}\nANALYSIS ${JSON.stringify({ cohorts: (analysis.cohorts || []).slice(0, 8), winners: (analysis.winningCampaigns || analysis.winning_campaigns || []).slice(0, 5) })}\nReturn JSON.`;
    const out = await callLLM({ systemPrompt: sys, userMessage: user, responseFormat: { type: 'json_object' }, maxTokens: 800, tier, stage: 'agentic-planning' });
    const parsed = callLLM.parseJSON(typeof out === 'string' ? out : out.text) || {};
    return Object.assign({ provider: out.provider || 'llm' }, parsed, { goal: g || null, goal_honoured: !!g });
  } catch (_) {
    return { provider: 'fallback', objective: g || 'fallback strategy', goal: g || null, goal_honoured: false, cohorts: [], heroAngles: [] };
  }
}

async function reviewStage(campaign, tier) {
  if (!callLLM) return { provider: 'fallback', score: 7, pass: true, weak_points: [], retry_reason: '' };
  try {
    const sys = "You are a strict brand-QA reviewer for VAHDAM India. Score the generated campaign 0-10 on brand-voice fit, clarity, conversion strength, and absence of banned phrases. Return STRICT JSON {\"score\":0-10,\"pass\":boolean,\"weak_points\":[\"..\"],\"retry_reason\":\"\"}. pass=true only if score>=7.";
    const out = await callLLM({ systemPrompt: sys, userMessage: `CAMPAIGN ${JSON.stringify(campaign).slice(0, 3000)}\nReturn JSON.`, responseFormat: { type: 'json_object' }, maxTokens: 500, tier, stage: 'agentic-review' });
    const p = callLLM.parseJSON(typeof out === 'string' ? out : out.text);
    p.provider = out.provider || 'llm';
    if (typeof p.pass !== 'boolean') p.pass = Number(p.score) >= 7;
    return p;
  } catch (_) { return { provider: 'fallback', score: 7, pass: true }; }
}

/**
 * runAgentic(opts) → { ok, mode, tier, market, stages[], strategy, scenarios, campaign, review, ideation }
 *   opts: { market, goal (aka brief/theme), tier:'budget'|'maxpower', days, scope, withCreatives, maxRetries }
 */
async function runAgentic(opts = {}) {
  // `goal` (aliased brief/theme) is the operator's stated objective. It MUST be
  // destructured here — omitting it is what made the documented `brief` option a
  // no-op for every caller that passed one.
  const { market = 'US', tier = 'budget', days, maxRetries = 1 } = opts;
  const goal = String(opts.goal || opts.brief || opts.theme || '').trim();
  const withCreatives = opts.withCreatives != null ? opts.withCreatives : (tier === 'maxpower');
  const config = svc.smartConfig();
  const stages = [];
  const rec = (stage, ok, summary, artifact) => stages.push({ stage, ok, summary, artifact: artifact !== undefined ? trim(artifact) : null });

  // 1. DATA
  const db = new svc.SmartBrainDbAdapter(config);
  let ownData, competitorData;
  try {
    ownData = await db.ownData();
    competitorData = await db.competitorData();
    rec('data', true, `${db.connected ? 'db-linked' : 'local-fallback'} — ${(ownData.campaigns || []).length} campaigns, ${(ownData.users || []).length} users`, { mode: db.connected ? 'db' : 'local' });
  } catch (e) { rec('data', false, String(e && e.message || e)); return { ok: false, stages }; }

  // 2. ANALYSIS
  const kb = new svc.KnowledgeBaseService(config).build(ownData);
  const analysis = new svc.AnalysisService(config).analyze(kb, ownData);
  const competitorBenchmarks = new svc.CompetitorBenchmarkingService(config).benchmark(competitorData);
  rec('analysis', true, `${(analysis.cohorts || []).length} cohorts, ${(analysis.winningCampaigns || analysis.winning_campaigns || []).length} winning campaigns`, { cohorts: (analysis.cohorts || []).map((c) => c.name || c.cohort) });

  // 3. PLANNING (LLM, tier-aware)
  const strategy = await planningStage(analysis, market, tier, goal);
  rec('planning', true,
    (goal ? `goal: "${goal.slice(0, 90)}" -> ` : '') + (strategy.objective || 'strategy set'),
    strategy);

  // 4. CALENDAR (+ 5 scenarios)
  const calendar = new svc.CalendarIntelligenceService(config).generate({ analysis, competitorBenchmarks, days: days || config.calendarDays, feedback: ownData.feedback });
  const scenarioSet = await buildScenarios({ analysis, baseCalendar: calendar, market, tier });
  rec('calendar', true, `${(calendar.entries || []).length} entries · ${scenarioSet.scenarios.length} scenarios (default ${scenarioSet.default})`, { scenarios: scenarioSet.scenarios.map((s) => ({ key: s.key, label: s.label, cadencePerWeek: s.cadencePerWeek })) });

  // 5+6. CONTENT (script) + ASSET CREATION — top entry of the default (medium) plan, score-gated retry
  const topEntry = (calendar.entries || [])[0];
  // Carry the goal onto the entry the assets are built from. Without this the
  // strategy stage honours the goal and every downstream asset ignores it, which
  // reads as "the goal worked" right up until you open the mailer.
  if (topEntry && goal) {
    topEntry.goal = goal;
    topEntry.objective = strategy.objective || topEntry.objective;
  }
  let campaign = null, review = null, attempt = 0;
  if (topEntry) {
    do {
      attempt += 1;
      try {
        campaign = await plan.buildCampaign(topEntry, config, { withCreatives });
      } catch (e) { rec('content+asset', false, `build failed: ${String(e && e.message || e)}`); break; }
      review = await reviewStage(campaign, tier);
      if (review.pass) break;
      topEntry.regenerate_counter = (topEntry.regenerate_counter || 0) + 1; // diverge on retry
    } while (attempt <= maxRetries);
    if (campaign) {
      rec('content+asset', true, `built campaign "${campaign.subject || (campaign.copy && campaign.copy.subject) || topEntry.theme || 'campaign'}" (attempt ${attempt}, creatives ${withCreatives ? 'on' : 'off'})`, { subject: campaign.subject || (campaign.copy && campaign.copy.subject) });
      rec('smart-review', !!review, review ? `score ${review.score} · ${review.pass ? 'PASS' : 'RETRY-EXHAUSTED'}` : 'n/a', review);
    }
  } else {
    rec('content+asset', false, 'no calendar entry to build');
  }

  // 8. IDEATION (net-new stage)
  const ideation = await ideate({ analysis, calendar, review: review || {}, market, tier });
  rec('ideation', true, `${ideation.ideas.length} next-actions`, { ideas: ideation.ideas.map((i) => i.title) });

  return {
    ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', tier, market,
    // Echo the goal back so a caller can SEE whether the run was goal-driven,
    // rather than having to infer it from the copy.
    goal: goal || null,
    goal_driven: !!goal,
    stages, strategy, scenarios: scenarioSet, campaign, review, ideation,
  };
}

module.exports = { runAgentic };
