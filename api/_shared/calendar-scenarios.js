'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// 5-scenario calendar planner. Given the analysis + a base calendar, produce
// best / medium / conservative / emergency / instant variants over the same
// horizon — each a full plan with assumptions + projected metrics.
//   • medium    = the realistic baseline; the DEFAULT that goes live.
//   • emergency = pre-staged dormant contingency (deliverability/budget/supply break).
//   • instant   = fast-revenue quick-win, deploy today.
// Tier-aware (maxpower → LLM-differentiated plans + projections); degrades to a
// deterministic heuristic when no LLM is configured.
// ─────────────────────────────────────────────────────────────────────────────

let callLLM; try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }

const SCENARIOS = [
  { key: 'best',         label: 'Best case',                      stance: 'aggressive growth — everything goes right; high cadence, premium creative, new-launch pushes, stretch targets' },
  { key: 'medium',       label: 'Medium / good',                  stance: 'realistic baseline; balanced cadence and a proven mix; THIS is the default that goes live' },
  { key: 'conservative', label: 'Not good (conservative)',        stance: 'soft-performance hedge; lower cadence, lean on bestsellers, trim spend, protect margin' },
  { key: 'emergency',    label: 'Worst case (emergency backup)',  stance: 'contingency for a break (deliverability crash / budget freeze / supply issue); retention-only, evergreen flows, ~zero new spend; pre-staged and dormant' },
  { key: 'instant',      label: 'Instant good result (quick-win)', stance: 'fast revenue now; short horizon, flash / bestseller / cart-abandon, proven high-converters, deploy today' },
];

const CADENCE = { best: 6, medium: 4, conservative: 2, emergency: 1, instant: 5 };
const REV_INDEX = { best: 160, medium: 100, conservative: 60, emergency: 25, instant: 120 };

function heuristicScenarios(baseCalendar) {
  const entries = baseCalendar.entries || [];
  return SCENARIOS.map((s) => ({
    key: s.key,
    label: s.label,
    assumptions: s.stance,
    cadencePerWeek: CADENCE[s.key],
    channelMix: s.key === 'emergency' ? 'owned email + SMS only'
      : s.key === 'instant' ? 'email + paid retargeting'
      : s.key === 'conservative' ? 'email + SMS' : 'email + SMS + paid social',
    spend: s.key === 'emergency' ? 'none' : s.key === 'conservative' ? 'reduced' : s.key === 'best' ? 'elevated' : 'normal',
    slots: entries.slice(0, s.key === 'emergency' ? 2 : s.key === 'conservative' ? 3 : 5)
      .map((e) => e.theme || e.objective || e.title || e.subject).filter(Boolean),
    projected: { revenueIndex: REV_INDEX[s.key], openRate: null, convRate: null },
  }));
}

async function buildScenarios({ analysis = {}, baseCalendar = {}, market = 'US', tier = 'budget' } = {}) {
  const base = {
    cohorts: (analysis.cohorts || []).map((c) => c.name || c.cohort).filter(Boolean).slice(0, 8),
    entries: (baseCalendar.entries || []).length,
    days: baseCalendar.days || 30,
  };
  if (callLLM) {
    try {
      const sys = "You are VAHDAM India's Head of Lifecycle. Produce 5 calendar SCENARIO plans over the same horizon, each driven by different assumptions. For EACH scenario return: cadencePerWeek, channelMix, spend posture, 2-4 example campaign slots, key assumptions, and projected metrics (revenueIndex vs medium=100, est openRate %, est convRate %). Keys MUST be exactly best, medium, conservative, emergency, instant. Return STRICT JSON {\"scenarios\":[{\"key\",\"label\",\"cadencePerWeek\",\"channelMix\",\"spend\",\"assumptions\",\"slots\":[\"..\"],\"projected\":{\"revenueIndex\",\"openRate\",\"convRate\"}}]}. No banned phrases.";
      const user = `MARKET: ${market}\nBASE PLAN: ${JSON.stringify(base)}\nSCENARIO DEFINITIONS: ${JSON.stringify(SCENARIOS.map((s) => ({ key: s.key, label: s.label, stance: s.stance })))}\n\nReturn the JSON now.`;
      const out = await callLLM({ systemPrompt: sys, userMessage: user, responseFormat: { type: 'json_object' }, maxTokens: 1800, tier, stage: 'calendar-scenarios' });
      const parsed = callLLM.parseJSON(typeof out === 'string' ? out : out.text);
      if (parsed && Array.isArray(parsed.scenarios) && parsed.scenarios.length >= 4) {
        return { ok: true, provider: out.provider || 'llm', default: 'medium', scenarios: parsed.scenarios };
      }
    } catch (_) { /* fall through to heuristic */ }
  }
  return { ok: true, provider: 'fallback', default: 'medium', scenarios: heuristicScenarios(baseCalendar) };
}

module.exports = { buildScenarios, SCENARIOS };
