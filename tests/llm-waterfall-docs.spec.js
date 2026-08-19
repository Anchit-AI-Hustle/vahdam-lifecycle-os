const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The LLM cascade was documented THREE different ways at once, and all three
// disagreed with the code:
//
//   CLAUDE.md         "6-provider ... OpenAI -> Anthropic -> Gemini -> ..."
//   DEVELOPMENT.md    "8-provider, tier-routed", Anthropic-first
//   llm.js's OWN header comment   eight rungs, omitting github/cloudflare/openrouter
//
// providerOrder() returns eleven, Anthropic-first. Nobody was lying; each line was
// written when it was true and then the code grew a rung. That is exactly the
// drift the repo already has a rule about for market URLs and platform limits, and
// prose drifts faster than constants because nothing executes it.
//
// So the prose is pinned to the code. These tests read providerOrder() and fail
// any doc that states a different count, a different lead provider, or an order
// that has fallen behind.

const ROOT = path.join(__dirname, '..');
const llm = require(path.join(ROOT, 'api', '_shared', 'llm.js'));
const LLM_SRC = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'llm.js'), 'utf8');

// providerOrder is internal, so read the arrays out of the source. Doing it this
// way (rather than exporting the function purely for a test) keeps the assertion
// honest: it measures the literal the runtime actually uses.
function orderFromSource(kind) {
  const m = LLM_SRC.match(/function providerOrder\(tier\) \{[\s\S]*?\n\}/);
  expect(m, 'providerOrder() not found: this test is measuring the wrong thing').toBeTruthy();
  const arrays = m[0].match(/\[[^\]]+\]/g) || [];
  expect(arrays.length, 'expected a fast array and a default array').toBe(2);
  const parse = (a) => a.replace(/[[\]'\s]/g, '').split(',').filter(Boolean);
  return kind === 'fast' ? parse(arrays[0]) : parse(arrays[1]);
}

const DEFAULT_ORDER = orderFromSource('default');
const FAST_ORDER = orderFromSource('fast');

// Every rung named in the order must actually be implemented, or the count is a
// claim about a provider that cannot answer.
test('every rung in the order has a real implementation', () => {
  for (const p of DEFAULT_ORDER) {
    expect(LLM_SRC, `${p} is in providerOrder() but modelsFor() has no case for it`)
      .toContain(`case '${p}':`);
  }
});

test('the cascade is Anthropic-first, and fast is the default order minus Grok', () => {
  expect(DEFAULT_ORDER[0]).toBe('anthropic');
  expect(FAST_ORDER).toEqual(DEFAULT_ORDER.filter((p) => p !== 'grok'));
});

// The number every doc has to agree with. Written as a derived value so this file
// never becomes a fourth hand-maintained copy of the same fact.
const N = DEFAULT_ORDER.length;
const WORDS = { 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' };

test("llm.js's own header comment lists the same rungs it routes to", () => {
  const header = LLM_SRC.slice(0, LLM_SRC.indexOf('const OPENAI_BASE'));
  for (const p of DEFAULT_ORDER) {
    expect(header, `header comment omits the ${p} rung`).toContain(p);
  }
});

// Living docs only. Dated session notes (docs/session-*.md) and the
// quality-upgrade blueprint are records of what was true on a given day;
// rewriting those would be falsifying history rather than fixing drift.
const DOCS = ['README.md', 'CLAUDE.md', 'DEVELOPMENT.md',
  'docs/PRD.md', 'docs/PROJECT_STATUS.md', 'docs/SMART_BRAIN.md', 'docs/google-agent-builder.md',
  'docs/competitive-intelligence-and-smart-brain.md', 'docs/feature-ratings-and-master-prompt.md'];

test('no living doc states a provider count that disagrees with the code', () => {
  // Matches "6-provider", "8-provider", "six-provider", "eleven-rung", etc.
  const claim = /\b(\d{1,2}|six|seven|eight|nine|ten|eleven|twelve)[- ](provider|rung)\b/gi;
  const correct = new Set([String(N), WORDS[N]]);
  for (const rel of DOCS) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(claim)) {
      // "4-provider image cascade" is a different cascade (api/ai/image.js) and is
      // not what this test measures, so only text-waterfall claims are checked.
      // "4-provider image cascade" is api/ai/image.js, a different cascade.
      if (/image|photo|visual|video/i.test(src.slice(Math.max(0, m.index - 90), m.index + 90))) continue;
      // A doc may QUOTE an old wrong count while explaining that it was wrong.
      // A quotation inside a correction is the opposite of drift, so it is
      // allowed only where the surrounding text says the value was incorrect.
      // The window is wider here than for the image check because a correction
      // names the wrong value first and explains it afterwards, so the marker
      // can sit a sentence away from the number it is correcting.
      if (/wrong|stale|incorrect|corrected|used to|no longer/i
        .test(src.slice(Math.max(0, m.index - 260), m.index + 260))) continue;
      expect(correct.has(String(m[1]).toLowerCase()),
        `${rel}: "${m[0]}" disagrees with providerOrder(), which has ${N} rungs`).toBe(true);
    }
  }
});

test('no living doc still claims the cascade leads with OpenAI', () => {
  // The specific wrong order that survived longest, because it reads plausibly.
  const wrong = /OpenAI\s*(->|→)\s*Anthropic/gi;
  for (const rel of DOCS) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(wrong)) {
      // Windowed, not line-scoped: markdown hard-wraps, so the sentence that
      // marks a quotation as the OLD wrong order routinely sits on the line
      // above the order itself. A line-scoped check failed on its own
      // correction note, which is the tell that the unit was wrong.
      const around = src.slice(Math.max(0, m.index - 260), m.index + 260);
      // reference-intel.js has its OWN vision cascade (Gemini -> OpenAI ->
      // Anthropic for images), which genuinely runs in that order and is not
      // the text waterfall this test measures.
      if (/vision|multimodal|reference-intel/i.test(around)) continue;
      // A quotation inside a correction is the opposite of drift.
      expect(/wrong|stale|incorrect|corrected|used to|no longer/i.test(around),
        `${rel} states OpenAI-first without marking it as the old incorrect order:\n  ${src.slice(m.index - 60, m.index + 90).replace(/\n/g, ' ')}`).toBe(true);
    }
  }
});

test('callLLM is still the single exported entry point', () => {
  expect(typeof llm, 'llm.js must export the caller itself').toBe('function');
  expect(typeof llm.parseJSON).toBe('function');
});
