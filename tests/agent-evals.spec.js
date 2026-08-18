const { test, expect } = require('@playwright/test');
const path = require('path');

// The agent layer had no evaluation at all. ~600 tests covered pages, contrast,
// dead hosts, kill switches and catalog provenance; nothing covered the 19 tools
// in brand-llm.js or which one a question should reach for. A misroute is not a
// crash — ask "how big is our customer base" and get the modelled RFM sample
// instead of the real Shopify total, and the reply is a confident number off by
// an order of magnitude, in exactly the same voice as a correct one.
//
// These run WITHOUT a provider key: they evaluate the routing SIGNAL (tool names
// and descriptions), which is all a prompt-routed agent actually gets. The live
// eval against a real model is opt-in — see scripts/run-evals.js.

const ROOT = path.join(__dirname, '..');
const { structuralEval } = require(path.join(ROOT, 'evals', 'lib', 'evaluate.js'));
const dataset = require(path.join(ROOT, 'evals', 'data', 'tool-routing.test.json'));
const { toolManifest, TOOLS } = require(path.join(ROOT, 'api', '_shared', 'brand-llm.js'));

test.describe('agent evaluation — the routing signal is intact', () => {
  test('every eval case is answerable from the manifest alone', () => {
    const r = structuralEval(dataset, toolManifest());
    expect(r.failures, `agent routing regressions:\n  ${r.failures.join('\n  ')}`).toEqual([]);
    // Guard the guard: if the dataset or manifest empties out, the run above
    // passes vacuously. Assert it actually did work.
    expect(r.cases).toBeGreaterThan(5);
    expect(r.tools).toBeGreaterThan(10);
    expect(r.checks).toBeGreaterThan(30);
  });

  test('the evaluator fails when routing really breaks (guards the guard)', () => {
    const base = toolManifest();
    // Two tools this dataset deliberately distinguishes must stay
    // distinguishable. Prove the check bites rather than trusting it.
    const collided = JSON.parse(JSON.stringify(base));
    const a = collided.find((t) => t.name === 'audience_base');
    const b = collided.find((t) => t.name === 'list_cohorts');
    expect(a && b, 'fixture tools missing').toBeTruthy();
    b.description = a.description;
    expect(structuralEval(dataset, collided).failures.length).toBeGreaterThan(0);

    const renamed = JSON.parse(JSON.stringify(base)).filter((t) => t.name !== 'market_performance');
    expect(structuralEval(dataset, renamed).failures.length).toBeGreaterThan(0);
  });

  test('every generating tool is flagged, so the prompt can withhold it', () => {
    // The system prompt marks mutating tools "[writes/generates — only on
    // explicit user request]". That warning is generated FROM this flag, so an
    // unflagged generator is one the model may fire on an idle question —
    // spending image and LLM quota and writing to the plan.
    const generators = Object.keys(TOOLS).filter((n) => /^(generate_|run_agentic)/.test(n));
    expect(generators.length, 'no generating tools found — has the registry moved?').toBeGreaterThan(2);
    for (const name of generators) {
      expect(TOOLS[name].mutates, `${name} generates but is not marked mutates:true`).toBe(true);
    }
  });

  test('read tools are not marked as writes, or the warning stops meaning anything', () => {
    const reads = ['catalog_products', 'market_performance', 'audience_base', 'ad_insights', 'get_calendar'];
    for (const name of reads) {
      expect(TOOLS[name], `${name} missing from the registry`).toBeTruthy();
      expect(TOOLS[name].mutates, `${name} is a read but is marked mutates:true`).toBeFalsy();
    }
  });
});

test.describe('brief gate — a creative is not aimed by an invented strategy', () => {
  const brief = require(path.join(ROOT, 'api', '_shared', 'brief-gate.js'));

  test('customer-facing copy blocks on missing essentials, and says which', () => {
    const r = brief.requireBrief({ mode: 'mailer_full', market: 'US' });
    expect(r.blocked).toBe(true);
    expect(r.status).toMatch(/NOT LAUNCH READY/);
    expect(r.missing.sort()).toEqual(['audience', 'objective', 'subject']);
    // It must name what to supply, not just refuse.
    expect(r.needed.map((n) => n.label).join(' ')).toMatch(/goal/i);
    expect(r.data_required).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
  });

  test('ideation proceeds but declares every gap instead of hiding it', () => {
    const r = brief.requireBrief({ mode: 'create_brief', market: 'US', theme: 'Winback' });
    expect(r.blocked).toBe(false);
    // Goal is carried by the campaign type; audience and subject are not.
    expect(r.missing.sort()).toEqual(['audience', 'subject']);
    expect(r.assumptions.length).toBe(2);
    const block = brief.assumptionPromptBlock(r);
    expect(block).toMatch(/DECLARED ASSUMPTIONS/);
    expect(block).toMatch(/Do NOT present an inferred audience/);
  });

  test('a complete brief passes clean, with nothing assumed', () => {
    const r = brief.requireBrief({
      mode: 'mailer_full', market: 'UK', theme: 'Winback',
      target_audience: 'lapsed 90-day buyers', selected_products: [{ h: 'turmeric-ginger' }],
    });
    expect(r.blocked).toBe(false);
    expect(r.missing).toEqual([]);
    expect(brief.assumptionPromptBlock(r)).toBe('');
    expect(brief.stamp(r).brief_complete).toBe(true);
  });

  test('whitespace and one-word input do not count as a strategy', () => {
    const r = brief.requireBrief({ mode: 'mailer_full', market: 'US', campaign_brief: '   ', target_audience: ' ', theme: '  ' });
    expect(r.blocked).toBe(true);
    expect(r.missing.length).toBe(3);
  });
});
