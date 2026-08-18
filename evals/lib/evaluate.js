'use strict';

/**
 * evals/lib/evaluate.js — evaluation for the agent layer.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repo had ~600 tests and not one of them checked what the AGENTS do.
 * Everything was covered — page geometry, contrast, dead hosts, kill switches,
 * catalog provenance — except the 19 tools in brand-llm.js and which one a
 * given question should reach for. A wrong route is not a crash: ask "how big
 * is our customer base" and get list_cohorts instead of audience_base, and the
 * answer is a confident number off by an order of magnitude, rendered in the
 * same voice as a correct one.
 *
 * Adapted from Google's ADK marketing-agency sample, whose eval data is
 * `{query, expected_tool_use, reference}` scored by AgentEvaluator. That runs a
 * live model every time, which cannot be a CI gate here: it needs a key, it
 * costs money per run, and it is non-deterministic. So evaluation is split:
 *
 *   STRUCTURAL (always runs, no key, deterministic) — checks the routing SIGNAL
 *     itself. A prompt-routed agent picks tools using only their names and
 *     descriptions, so those are the thing under test: every tool a case names
 *     must exist, every mutating tool must be marked as such, and two tools a
 *     case deliberately distinguishes must actually be distinguishable in their
 *     descriptions. This catches the real regression — someone renames a tool,
 *     or edits a description until two tools read the same — without a model.
 *
 *   LIVE (opt-in) — runs the real chat loop and compares the observed tool
 *     trace to the expectation. Truthful about being sampled, not proof.
 */

/** Index a manifest ([{name, description, mutates}]) by tool name. */
function indexManifest(manifest) {
  const byName = new Map();
  for (const t of manifest || []) byName.set(t.name, t);
  return byName;
}

function caseToolNames(c) {
  return [].concat(c.expected_tool_use || [], c.forbidden_tool_use || []);
}

/**
 * structuralEval — no model, no network. Returns {ok, failures:[], checks}.
 */
function structuralEval(dataset, manifest) {
  const byName = indexManifest(manifest);
  const failures = [];
  let checks = 0;

  for (const c of dataset) {
    const where = `case "${c.id || c.query}"`;

    // A case without a stated reason is a case nobody can maintain: when it
    // fails later, the next person cannot tell intent from accident.
    checks++;
    if (!c.why || String(c.why).trim().length < 30) {
      failures.push(`${where}: no "why" — an expectation without a reason cannot be judged when it breaks`);
    }

    // Every tool the case names must exist. A renamed tool silently turns an
    // expectation into a tautology that can never fail.
    for (const name of caseToolNames(c)) {
      checks++;
      if (!byName.has(name)) {
        failures.push(`${where}: names tool "${name}", which is not in the manifest (renamed or removed?)`);
      }
    }

    // Anything listed as forbidden BECAUSE it writes must actually be flagged
    // as writing — that flag is what the system prompt uses to hold it back.
    for (const name of c.forbidden_tool_use || []) {
      const t = byName.get(name);
      if (!t) continue;
      if (/generate|run_agentic|assets_for_slot/.test(name)) {
        checks++;
        if (!t.mutates) {
          failures.push(`${where}: "${name}" is expected to be withheld from a question, but is not marked mutates:true, so the prompt has nothing to withhold it by`);
        }
      }
    }

    // The load-bearing one: if a case says "expect A, not B", A and B must be
    // TELLABLE APART from their descriptions alone, because that is all the
    // model gets. Identical or near-empty descriptions make the expectation
    // unmeetable however good the model is.
    for (const good of c.expected_tool_use || []) {
      for (const bad of c.forbidden_tool_use || []) {
        const a = byName.get(good); const b = byName.get(bad);
        if (!a || !b) continue;
        checks++;
        const da = String(a.description || '').trim();
        const db = String(b.description || '').trim();
        if (!da || !db) {
          failures.push(`${where}: "${!da ? good : bad}" has no description, so nothing distinguishes it from "${!da ? bad : good}"`);
        } else if (da === db) {
          failures.push(`${where}: "${good}" and "${bad}" have identical descriptions, so the routing choice between them is a coin flip`);
        }
      }
    }
  }

  // Manifest-wide: every tool needs a usable routing signal.
  for (const t of manifest || []) {
    checks++;
    if (!t.description || String(t.description).trim().length < 40) {
      failures.push(`tool "${t.name}": description is missing or too short to route on`);
    }
    if (t.mutates) {
      checks++;
      if (!/generat|creat|writ|run|push|build|produc/i.test(String(t.description || ''))) {
        failures.push(`tool "${t.name}": marked mutates:true but its description does not say it writes or generates, so a reader cannot tell it apart from a read`);
      }
    }
  }

  return { ok: failures.length === 0, failures, checks, cases: dataset.length, tools: (manifest || []).length };
}

/**
 * liveEval — runs the real loop. `chat` is injected so this stays testable and
 * so nothing here reaches the network unless a caller hands it a real client.
 */
async function liveEval(dataset, chat, { market = 'US' } = {}) {
  const results = [];
  for (const c of dataset) {
    let observed = [];
    let reply = '';
    let error = null;
    try {
      const r = await chat({ message: c.query, market });
      observed = (r.steps || []).map((s) => s.tool);
      reply = String(r.reply || '');
    } catch (e) { error = e.message; }

    const missed = (c.expected_tool_use || []).filter((t) => !observed.includes(t));
    const forbidden = (c.forbidden_tool_use || []).filter((t) => observed.includes(t));
    const unmentioned = (c.must_mention || []).filter((m) => !reply.toLowerCase().includes(String(m).toLowerCase()));
    results.push({
      id: c.id || c.query,
      pass: !error && !missed.length && !forbidden.length && !unmentioned.length,
      error, observed, missed, forbidden, unmentioned,
    });
  }
  const passed = results.filter((r) => r.pass).length;
  return { ok: passed === results.length, passed, total: results.length, results };
}

module.exports = { structuralEval, liveEval, indexManifest };
