'use strict';

/**
 * api/_shared/brand-llm.js — "ChaiGPT" engine: the brand's own LLM.
 *
 * A Claude-style conversational brain that can actually OPERATE VAHDAM's growth
 * stack. It runs a provider-agnostic tool-calling loop: the model emits a strict
 * JSON action each turn ({action:'tool',...} or {action:'final',...}); we execute
 * the tool against the existing _shared cores, feed the result back, and loop.
 *
 * Because tool-calling is expressed as plain JSON (not a provider-specific
 * function-calling API), it works across the whole 6-provider waterfall in
 * llm.js — including the free tiers (Gemini / Groq / Cerebras) — with NO extra keys.
 *
 * Rename the product: change BRAND_LLM_NAME below (single source of truth).
 */

const BRAND_LLM_NAME = 'ChaiGPT';
const BRAND_LLM_TAGLINE = "VAHDAM's brand intelligence — steeped in your own data";

const core = require('./brain-core.js');
const analysis = require('./brain-analysis.js');
const competitor = require('./brain-competitor.js');
const calendar = require('./brain-calendar.js');
const generate = require('./brain-generate.js');
const kb = require('./brain-kb.js');
const agents = require('./brain-agent.js');
const agentic = require('./agentic-orchestrator.js');
const klaviyo = require('./klaviyo-core.js');

let callLLM = null;
try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }

// ── Tool registry ────────────────────────────────────────────────────────────
// Each tool reuses the SAME logic the /api/brain ?action= routes use, so the
// chat and the dashboards stay perfectly consistent. `mutates:true` flags tools
// that write/generate (the model is told to only call them on explicit request).
const TOOLS = {
  ask_analytics: {
    mutates: false,
    desc: 'Answer a natural-language analytics question (RFM, cohorts, revenue, product/channel performance) with EXACT figures from our own Supabase data. params: {question}',
    run: async (a) => agents.analyze({ message: a.question || a.message || '' }),
  },
  run_analysis: {
    mutates: false,
    desc: 'Run the daily analysis engine and return the summary + top angle/format/offer patterns. No params.',
    run: async () => {
      const out = await analysis.runDaily({ persist: false });
      return { summary: out.summary, patterns: { angle: (out.patterns?.angle || []).slice(0, 6), format: (out.patterns?.format || []).slice(0, 6), offer: (out.patterns?.offer || []).slice(0, 6) } };
    },
  },
  list_cohorts: {
    mutates: false,
    desc: 'List active customer cohorts (highest value first). No params.',
    run: async () => ({ cohorts: await core.db().select('smart_cohorts', { limit: 50, order: 'value_score.desc', filters: { active: 'eq.true' } }) }),
  },
  get_calendar: {
    mutates: false,
    desc: 'Get upcoming marketing calendar slots. params: {market?, from?(YYYY-MM-DD)}',
    run: async (a) => {
      const filters = { slot_date: `gte.${a.from || core.todayIso()}` };
      if (a.market) filters.market = `eq.${a.market}`;
      return { slots: await core.db().select('smart_calendar', { limit: 120, order: 'slot_date.asc', filters }) };
    },
  },
  get_competitor_benchmarks: {
    mutates: false,
    desc: 'Get competitor email benchmarks (cadence, offers, angles) by market. No params.',
    run: async () => ({ benchmarks: await competitor.benchmarks({ persist: false }) }),
  },
  search_knowledge_base: {
    mutates: false,
    desc: 'Search the campaign knowledge base for past winning emails/patterns. params: {query}',
    run: async (a) => {
      const lib = await kb.libraryIndex();
      const q = String(a.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      const hits = !q.length ? lib.slice(0, 12) : lib.filter((r) => {
        const hay = JSON.stringify(r).toLowerCase();
        return q.some((t) => hay.includes(t));
      }).slice(0, 12);
      return { matched: hits.length, of: lib.length, items: hits };
    },
  },
  list_campaigns: {
    mutates: false,
    desc: 'List generated campaigns (mailers/ads/landing pages). params: {status?}',
    run: async (a) => {
      const filters = {};
      if (a.status) filters.status = `eq.${a.status}`;
      return { campaigns: await core.db().select('smart_generated_campaigns', { limit: 100, order: 'created_at.desc', filters }) };
    },
  },
  generate_calendar: {
    mutates: true,
    desc: 'Generate/refresh the marketing calendar. params: {start_date?, days?, regenerate?}',
    run: async (a) => calendar.generate({ startDate: a.start_date, days: a.days, persist: true, regenerate: a.regenerate === true }),
  },
  generate_assets_for_slot: {
    mutates: true,
    desc: 'Generate the full creative bundle (mailer + ads + landing page) for a calendar slot. params: {slot_id}',
    run: async (a) => {
      if (!a.slot_id) return { ok: false, error: 'slot_id required — call get_calendar first to find one.' };
      return generate.generateForSlot(a.slot_id, { persist: true });
    },
  },
  run_agentic_campaign: {
    mutates: true,
    desc: 'Run the end-to-end agentic campaign flow (data→analysis→plan→content→assets→review). params: {brief, market?, days?, tier?(budget|maxpower), withCreatives?}',
    run: async (a) => agentic.runAgentic({ market: a.market || 'US', brief: a.brief || a.theme || '', tier: a.tier || 'budget', days: a.days ? parseInt(a.days, 10) : undefined, withCreatives: a.withCreatives === true, maxRetries: 1 }),
  },
  generate_mailer_assets: {
    mutates: true,
    desc: 'Fill a mailer\'s embedded IMAGE/VIDEO/GIF GENERATION PROMPT slots with real generated assets (images via gpt-image-2/nano-banana, video via Higgsfield+OpenMontage, gif derived from a clip). params: {html} (the mailer HTML) or {entry_id} (a lifecycle_calendar_entries row to build then fill). Returns filled html + per-slot asset report.',
    run: async (a) => {
      const assetAgent = require('./asset-agent.js');
      let html = a.html;
      let built = null;
      if (!html && a.entry_id) {
        const b = require('./lifecycle-mailer-build.js');
        built = await b.buildLifecycleMailer({ id: a.entry_id });
        html = built && built.mailer && (built.mailer.variants.find((v) => v.key === 'visual_a') || built.mailer).html;
      }
      if (!html) return { ok: false, error: 'pass {html} or an {entry_id} that builds a mailer' };
      const filled = await assetAgent.fillMailerAssets(html, { tier: a.tier || 'premium', market: a.market || 'UK', persist: a.persist !== false });
      return built ? { ...filled, entry_id: a.entry_id } : filled;
    },
  },
  klaviyo: {
    mutates: false, // individual write ops are gated inside klaviyo-core until a key exists
    desc: `Talk to Klaviyo (email/SMS lifecycle). params: {op, ...opParams}. Ops: ${Object.keys(klaviyo.OPS).join(', ')}. Examples — list audiences: {op:'get_lists'}; segments: {op:'get_segments'}; performance: {op:'campaign_report'}; subscribe: {op:'subscribe_profiles', list_id, emails:[]}. Returns a 'not_connected' stub describing the exact API call until KLAVIYO_API_KEY is set.`,
    run: async (a) => klaviyo.dispatch(a.op, a),
  },
};

function toolManifest() {
  return Object.entries(TOOLS).map(([name, t]) => ({ name, mutates: !!t.mutates, description: t.desc }));
}

function truncate(obj, max = 3500) {
  let s; try { s = typeof obj === 'string' ? obj : JSON.stringify(obj); } catch (_) { s = String(obj); }
  return s.length > max ? s.slice(0, max) + `…[truncated ${s.length - max} chars]` : s;
}

// Tolerant JSON extraction (models sometimes wrap JSON in prose or ``` fences).
function extractJson(text) {
  if (!text) return null;
  const s = String(text).trim();
  try { return JSON.parse(s); } catch (_) {}
  const fenced = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(fenced); } catch (_) {}
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (_) {} }
  return null;
}

function systemPrompt(market) {
  return `You are ${BRAND_LLM_NAME} — ${BRAND_LLM_TAGLINE}. You are the in-house AI operator for VAHDAM Teas (premium Indian heritage tea, B-Corp, single-estate, garden-fresh within 72 hours). You don't just chat — you OPERATE the brand's growth stack by calling tools, then explain the results like a sharp, warm growth lead.

CURRENT MARKET: ${market || 'US'} (store URLs: US www.vahdamteas.com · UK uk.vahdamteas.com · IN www.vahdamindia.com).

YOU CAN CALL THESE TOOLS:
${toolManifest().map((t) => `- ${t.name}${t.mutates ? ' [writes/generates — only on explicit user request]' : ''}: ${t.description}`).join('\n')}

HOW TO RESPOND — every message you send MUST be a single JSON object, nothing else:
• One tool:        {"action":"tool","tool":"<name>","args":{...},"thought":"why, one line"}
• Several tools:   {"action":"tool","tools":[{"tool":"<name>","args":{...}},{"tool":"<name>","args":{...}}],"thought":"why, one line"}
  ← up to 3 INDEPENDENT lookups run IN PARALLEL. Always batch lookups that don't depend on each other
  (e.g. ask_analytics + get_competitor_benchmarks + get_calendar) — it is much faster than one at a time.
• Final answer:    {"action":"final","reply":"<your answer in clean markdown>"}

EVIDENCE CONTRACT — non-negotiable for EVERY suggestion or recommendation you make:
1. DATA ANALYSIS: quote the EXACT figures behind it (counts, %, revenue, AOV, dates, slot ids) and name the tool they came from. Call tools first — never estimate what a tool can tell you.
2. TARGET METRIC: name the single metric the recommendation should improve (repeat-purchase rate, winback conversion, open→click rate, AOV, revenue per recipient, list growth…) with expected direction and a rough magnitude.
3. COMPLETE HYPOTHESIS: state it in full — "Because [observed data], doing [specific action] for [specific segment] should move [metric] by [expected range], because [mechanism]."
4. COMPETITIVE BENCHMARK: call get_competitor_benchmarks and QUOTE the relevant numbers (send cadence, offer depth, dominant angles) alongside ours. If it returns empty, write "no competitor benchmark captured yet" — never skip this silently.

FINAL-ANSWER FORMAT:
- Recommendation / strategy / "what should we do" questions → a DETAILED, structured markdown reply: the answer in 1–2 lines, then "**What the data shows**" (bulleted exact numbers with tool sources), "**Hypothesis**", "**Expected metric impact**", "**Competitor benchmark**" (quoted figures), "**Next actions**" (numbered, each doable inside this app with slot ids/dates where relevant).
- Simple factual lookups → a direct, concise answer with the exact figures. No sections, no padding.
- Markdown tables are welcome for comparisons (ours vs competitors, cohort vs cohort).

RULES:
- Prefer real data over guessing: if a question is about our numbers, audience, calendar, competitors, or Klaviyo, CALL TOOLS before answering — batched in parallel when independent, chained (e.g. get_calendar → generate_assets_for_slot) when dependent.
- Never invent figures. If a tool returns 'not_connected' or empty, say so plainly and state what's needed (e.g. "set KLAVIYO_API_KEY").
- Only call [writes/generates] tools when the user clearly asks to create/generate/run something.
- Brand voice: warm, sensory, story-driven. Use ritual, restore, origin, single-estate, steep, heritage. NEVER use: wellness journey, transform, liquid gold, game-changer, LIMITED TIME, hurry, don't miss out, last chance.`;
}

function renderTranscript(history, message, working) {
  const lines = ['CONVERSATION:'];
  (history || []).slice(-12).forEach((m) => {
    const role = (m.role === 'user' || m.role === 'human') ? 'User' : 'Assistant';
    lines.push(`${role}: ${truncate(m.content || m.text || '', 800)}`);
  });
  lines.push(`User: ${message}`);
  if (working.length) {
    lines.push('\nTOOL RESULTS THIS TURN (use these to answer — do not re-call the same tool with the same args):');
    working.forEach((w, i) => lines.push(`[${i + 1}] ${w.tool}(${truncate(w.args, 300)}) →\n${truncate(w.result)}`));
  }
  lines.push('\nReply now with a single JSON action object.');
  return lines.join('\n');
}

/**
 * The conversational tool-calling loop.
 * @returns {ok, reply, steps:[{tool,args,summary}], provider, brand}
 */
async function chat({ message, history = [], market = 'US', maxSteps = 5 } = {}) {
  const brand = { name: BRAND_LLM_NAME, tagline: BRAND_LLM_TAGLINE };
  if (!message || !String(message).trim()) return { ok: false, error: 'message required', brand };
  if (!callLLM) {
    return { ok: true, brand, reply: `${BRAND_LLM_NAME} needs an LLM provider. Set GEMINI_API_KEY (free) or another provider in Vercel env. All data tools still work via the dashboards.`, steps: [] };
  }

  const sys = systemPrompt(market);
  const working = [];
  const steps = [];
  let provider = null;

  for (let step = 0; step < maxSteps; step++) {
    const force = step === maxSteps - 1;
    const userMessage = renderTranscript(history, message, working) +
      (force ? '\n\nYou have gathered enough. Respond with {"action":"final",...} now — do not call more tools.' : '');
    // maxTokens is a cap, not a target: tool actions stay tiny, but detailed
    // evidence-backed finals get room. 20s timeout per provider keeps a hung
    // provider from stalling the turn — the cascade moves on instead.
    const llmOpts = { systemPrompt: sys, userMessage, responseFormat: { type: 'json_object' }, maxTokens: 2200, temperature: 0.4, timeoutMs: 20000, stage: 'chaigpt', tier: 'premium' };
    let out;
    try {
      // Sticky provider: once a provider answers, later steps of this turn go
      // straight to it instead of re-walking dead keys / rate-limit sleeps in
      // the full cascade. If it dies mid-turn, fall back to the cascade once.
      if (provider) {
        try { out = await callLLM({ ...llmOpts, preferProvider: provider }); }
        catch (_) { provider = null; out = await callLLM(llmOpts); }
      } else {
        out = await callLLM(llmOpts);
      }
    } catch (e) {
      return { ok: true, brand, provider, steps, reply: `I hit a provider error: ${e.message}. The data tools and dashboards are still available.` };
    }
    provider = (out && out.provider) || provider;
    const text = (typeof out === 'string' ? out : (out.text || '')).trim();
    const parsed = extractJson(text);

    // No parseable action → treat the text as the final answer (graceful).
    if (!parsed || !parsed.action) return { ok: true, brand, provider, steps, reply: text || 'I could not form a response — please rephrase.' };

    if (parsed.action === 'final') return { ok: true, brand, provider, steps, reply: String(parsed.reply || '').trim() || 'Done.' };

    if (parsed.action === 'tool' || parsed.action === 'tools') {
      // Accept a single tool or a batch — batched lookups execute in parallel.
      const requested = (Array.isArray(parsed.tools) && parsed.tools.length)
        ? parsed.tools
        : [{ tool: parsed.tool, args: parsed.args }];
      // Dedupe BEFORE dispatch (both within the batch and against earlier
      // steps this turn) — checking inside the parallel callbacks would race,
      // since results only land in `working` after each tool's await.
      const seen = new Set(working.map((w) => w.tool + JSON.stringify(w.args || {})));
      const batch = requested.slice(0, 3)
        .map((r) => ({ name: r.tool || r.name, args: r.args || {} }))
        .filter((r) => {
          if (!r.name) return false;
          const key = r.name + JSON.stringify(r.args);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      await Promise.all(batch.map(async ({ name, args }) => {
        const tool = TOOLS[name];
        if (!tool) { working.push({ tool: name, args, result: { ok: false, error: `Unknown tool '${name}'. Available: ${Object.keys(TOOLS).join(', ')}` } }); return; }
        let result;
        try { result = await tool.run(args); } catch (e) { result = { ok: false, error: e.message }; }
        working.push({ tool: name, args, result });
        steps.push({ tool: name, args, summary: truncate(result, 600) });
      }));
      continue;
    }

    // Unknown action shape → return whatever text we have.
    return { ok: true, brand, provider, steps, reply: text };
  }

  // Exhausted steps without a final — synthesize from gathered results.
  return { ok: true, brand, provider, steps, reply: 'I gathered the data above but ran out of reasoning steps before composing a summary. Ask me to "summarize what you found" and I will.' };
}

module.exports = { chat, toolManifest, TOOLS, BRAND_LLM_NAME, BRAND_LLM_TAGLINE };
