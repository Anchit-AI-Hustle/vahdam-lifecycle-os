const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// GOAL-DRIVEN ASSET CREATION.
//
// /api/brain?action=agentic-run accepted a `brief`, and the orchestrator's own
// doc block advertised it, but runAgentic never destructured it and
// planningStage never took it. An operator's stated goal was accepted by the API
// and silently discarded — the run then planned a generic strategy and returned
// it as though it were the answer to the question asked.
//
// That is the worst shape of bug in this codebase's history (INFO.ads, the CI
// script list, the aurora at z-index:-1): the feature LOOKS present, so nobody
// checks it, and the output is plausible enough to ship.
//
// These tests assert the goal survives every hop: API -> runAgentic ->
// planningStage prompt -> the entry the assets are built from -> the copy prompt
// the mailer/ad text is written from.

const ROOT = path.join(__dirname, '..');
const ORCH = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'agentic-orchestrator.js'), 'utf8');
const PLAN = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'), 'utf8');
const BRAIN = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'smart-brain.html'), 'utf8');

test('runAgentic actually reads the goal off its options', () => {
  // The exact omission that made the documented option a no-op.
  expect(ORCH).toMatch(/const goal = String\(opts\.goal \|\| opts\.brief \|\| opts\.theme \|\| ''\)/);
});

test('the goal is passed into the planning stage, not just stored', () => {
  expect(ORCH).toMatch(/planningStage\(analysis, market, tier, goal\)/);
  expect(ORCH).toMatch(/async function planningStage\(analysis, market, tier, goal\)/);
});

test('the planning prompt contains the operator goal when one is given', async () => {
  // Load the module with the LLM stubbed so the prompt can be captured. This is
  // the assertion that matters: wiring can look right and still never reach the
  // model.
  const llmPath = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
  const orchPath = require.resolve(path.join(ROOT, 'api', '_shared', 'agentic-orchestrator.js'));
  const captured = [];
  const realLlm = require.cache[llmPath];

  const stub = async (opts) => { captured.push(opts); return { provider: 'stub', text: '{"objective":"o","cohorts":[],"heroAngles":[],"northStarMetric":"revenue","goal_interpretation":"read"}' }; };
  stub.parseJSON = (t) => { try { return JSON.parse(t); } catch (_) { return {}; } };
  require.cache[llmPath] = { id: llmPath, filename: llmPath, loaded: true, exports: stub };
  delete require.cache[orchPath];

  try {
    // planningStage is not exported, so drive it through the only public door.
    // The data stage will fall back to local data; that is fine — we only need
    // the planning prompt.
    const orch = require(orchPath);
    await orch.runAgentic({ market: 'UK', goal: 'win back lapsed coffee buyers without discounting', tier: 'budget', withCreatives: false }).catch(() => {});
    const planning = captured.find((c) => c && c.stage === 'agentic-planning');
    expect(planning, 'the planning stage never called the LLM').toBeTruthy();
    const blob = `${planning.systemPrompt}\n${planning.userMessage}`;
    expect(blob, 'the goal never reached the model').toContain('win back lapsed coffee buyers without discounting');
    // And the system prompt must actually instruct the model to serve it,
    // otherwise the goal is just decoration in the context window.
    expect(planning.systemPrompt).toMatch(/OPERATOR GOAL/);
  } finally {
    if (realLlm) require.cache[llmPath] = realLlm; else delete require.cache[llmPath];
    delete require.cache[orchPath];
  }
});

test('the goal rides onto the entry the assets are built from', () => {
  // Without this the strategy honours the goal and every asset ignores it, which
  // reads as success until you open the mailer.
  expect(ORCH).toMatch(/topEntry\.goal = goal/);
});

test('the copy and strategy prompts carry the operator goal verbatim', () => {
  expect(PLAN).toMatch(/function goalLine\(entry\)/);
  expect(PLAN).toMatch(/OPERATOR GOAL \(this send must serve it\)/);
  // Both prompts, not just one: the strategy brief and the copy are written by
  // separate calls, and a goal in only one of them produces assets whose angle
  // and whose words disagree.
  const strategyPrompt = PLAN.slice(PLAN.indexOf('function strategyPrompt'), PLAN.indexOf('function strategyPrompt') + 1200);
  expect(strategyPrompt).toContain('goalLine(entry)');
  const copyIdx = PLAN.indexOf('Write campaign copy for this planned slot');
  expect(PLAN.slice(copyIdx - 200, copyIdx + 200)).toContain('goalLine(entry)');
});

test('the API accepts goal as well as the legacy brief/theme aliases', () => {
  expect(BRAIN).toMatch(/action=agentic-run|case 'agentic-run'/);
  expect(ORCH).toMatch(/opts\.goal \|\| opts\.brief \|\| opts\.theme/);
});

test('the run reports whether it was goal-driven', () => {
  // An operator must never have to infer from the copy whether their goal was
  // used. That inference is exactly what hid this bug.
  expect(ORCH).toMatch(/goal_driven: !!goal/);
  expect(ORCH).toMatch(/goal: goal \|\| null/);
});

test('the console has a goal input, sends it, and shows whether it was honoured', () => {
  expect(UI).toMatch(/id="agenticGoal"/);
  expect(UI).toMatch(/withCreatives: false, goal \}/);
  expect(UI).toMatch(/Goal-driven run/);
  expect(UI).toMatch(/No goal given/);
  // The input must be labelled for screen readers, not just placeholder-hinted:
  // a placeholder disappears on focus and is not an accessible name.
  expect(UI).toMatch(/<label for="agenticGoal"/);
});
