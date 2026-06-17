'use strict';

/**
 * brain-agent.js — Vahdam conversational agents (voice + chat + narration).
 *
 * Brand / collection / product / persona-level agents. Each agent gets a
 * knowledge pack assembled from: its catalog scope (smart_products), the
 * brand kit, optionally scraped OFFICIAL vahdamteas.com product pages
 * (syncKnowledge), and the marketing KB. Conversation runs through
 * _shared/llm.js with a careful sales-advisor system prompt (telecalling
 * substitute: educate → justify value → guide, never pressure).
 *
 * Voice I/O happens client-side (SpeechRecognition + speechSynthesis) in
 * agent.html / agent-widget.js. Server returns text + speakable text.
 */

const { db, getBrandKit, idFor, scrubBannedPhrases } = require('./brain-core.js');

let callLLM = null;
try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }

async function listAgents() {
  return db().select('smart_agents', { limit: 100, order: 'created_at.asc', filters: { active: 'eq.true' } });
}

async function getAgent(agentId) {
  const rows = await db().select('smart_agents', { filters: { id: `eq.${agentId}` }, limit: 1 });
  if (!rows[0]) throw new Error(`agent ${agentId} not found`);
  return rows[0];
}

async function upsertAgent(spec) {
  const id = spec.id || idFor('agent', { name: spec.name, level: spec.level });
  const row = {
    id, level: spec.level || 'collection', name: spec.name, market: spec.market || 'US',
    persona: spec.persona || {}, catalog_scope: spec.catalog_scope || {},
    greeting: spec.greeting || `Hi, I'm ${spec.name}. How can I help?`,
    voice: spec.voice || { rate: 1.0, pitch: 1.0, style: 'warm' },
    active: spec.active !== false, updated_at: new Date().toISOString(),
  };
  await db().upsert('smart_agents', [row], 'id');
  return row;
}

function scopedProducts(agent, products) {
  const scope = agent.catalog_scope || {};
  let out = products;
  if (Array.isArray(scope.categories) && scope.categories.length) {
    out = out.filter((p) => scope.categories.includes(p.category));
  }
  if (Array.isArray(scope.skus) && scope.skus.length) {
    out = out.filter((p) => scope.skus.includes(p.sku));
  }
  return out.length ? out : products;
}

/** Scrape official VAHDAM product pages (catalog URLs only — official site). */
async function syncKnowledge(agentId) {
  const agent = await getAgent(agentId);
  const products = scopedProducts(agent, await db().select('smart_products', { limit: 500, filters: { active: 'eq.true' } }));
  const targets = products.filter((p) => p.url && /vahdamteas\.com|vahdamindia\.com/.test(p.url)).slice(0, 12);
  const rows = [];
  for (const p of targets) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(p.url, { headers: { 'User-Agent': 'Mozilla/5.0 VahdamAgentKB/1.0' }, signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const html = await r.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
      rows.push({
        id: idFor('ak', { agent: agentId, url: p.url }),
        agent_id: agentId, source_url: p.url, title: p.title,
        content: text, facts: { sku: p.sku, price: p.price, category: p.category, tags: p.tags },
        fetched_at: new Date().toISOString(),
      });
    } catch (_) { /* skip unreachable */ }
  }
  // even if scraping fails (network rules), seed knowledge from catalog facts
  if (!rows.length) {
    for (const p of products.slice(0, 20)) {
      rows.push({
        id: idFor('ak', { agent: agentId, sku: p.sku }),
        agent_id: agentId, source_url: p.url || null, title: p.title,
        content: `${p.title}: ${p.category} from VAHDAM India. Price ${p.price}. Tags: ${(p.tags || []).join(', ')}.`,
        facts: { sku: p.sku, price: p.price, category: p.category, tags: p.tags },
        fetched_at: new Date().toISOString(),
      });
    }
  }
  if (rows.length) await db().upsert('smart_agent_knowledge', rows, 'id');
  return { agent: agentId, knowledge_items: rows.length, scraped: targets.length };
}

const WELLNESS_FACTS = `
Grounded product-education facts (use honestly, no medical claims):
- Ashwagandha: adaptogen; typical perceived effects (calmer stress response, better sleep quality) build over 2–4 WEEKS of consistent daily use, not instantly.
- Turmeric blends: curcumin absorbs better with black pepper (piperine); daily ritual over weeks, not a quick fix.
- Green/white teas: L-theanine + lower caffeine → smooth alertness without the crash.
- Value framing: a 100g tin ≈ 50 cups → roughly $0.40–0.60 per cup vs $5 cafe drinks; packed at origin within days of harvest (fresher than store tea that ages 6–24 months in warehouses).
- VAHDAM is carbon & plastic neutral, ships direct from India.`;

async function chat({ agentId, sessionId, message, context = {}, history = [] }) {
  const agent = await getAgent(agentId);
  const brand = await getBrandKit();
  const [products, knowledge] = await Promise.all([
    db().select('smart_products', { limit: 500, filters: { active: 'eq.true' } }),
    db().select('smart_agent_knowledge', { limit: 30, filters: { agent_id: `eq.${agentId}` } }),
  ]);
  const scoped = scopedProducts(agent, products).slice(0, 24);
  const catalogLines = scoped.map((p) => `- ${p.title} | ${p.category} | $${p.price} | ${(p.tags || []).join(',')} | ${p.url || ''}`).join('\n');
  const kbLines = knowledge.slice(0, 10).map((k) => `• ${k.title}: ${String(k.content || '').slice(0, 400)}`).join('\n');
  const persona = agent.persona || {};

  const system = `You are "${agent.name}", VAHDAM India's ${persona.role || 'tea & wellness expert'} — a voice-first conversational advisor embedded on the store. You are the brand's telecalling substitute: customers talk to you the way they would to a knowledgeable human caller.

TONE: ${persona.tone || 'warm, knowledgeable, never pushy'}. Brand voice: ${brand.voice}. Prefer words like ${(brand.preferred_lexicon || []).join(', ')}. NEVER use: ${(brand.banned_phrases || []).join(', ')}.

GOALS: ${(persona.goals || ['educate', 'guide', 'justify value honestly']).join('; ')}.

OBJECTION HANDLING: ${JSON.stringify(persona.objection_handling || {})}.
${WELLNESS_FACTS}

CATALOG YOU CAN RECOMMEND (only these; include the link when recommending):
${catalogLines}

KNOWLEDGE (official VAHDAM sources):
${kbLines || '(catalog facts only)'}

RULES:
- Keep replies SHORT and spoken-friendly: 2–5 sentences, then one helpful follow-up question. This is a conversation, not an essay.
- Be honest about durations and effects; set expectations (2–4 weeks for adaptogens). No medical claims, no cure language.
- When price concern appears: per-cup math + origin-freshness + certifications, then let the customer decide. Zero pressure.
- If asked something outside VAHDAM products/tea/wellness, gently steer back.
- Reply in the user's language if they switch (incl. Hindi/Hinglish).`;

  const convo = history.slice(-10).map((m) => `${m.role === 'user' ? 'Customer' : agent.name}: ${m.content}`).join('\n');
  const userMessage = `${convo ? convo + '\n' : ''}Customer: ${message}\n${agent.name}:`;

  let reply = '';
  let provider = 'fallback';
  if (callLLM) {
    try {
      const out = await callLLM({ systemPrompt: system, userMessage, maxTokens: 420, temperature: 0.7, timeoutMs: 30000, stage: 'agent-chat' });
      reply = (typeof out === 'string' ? out : out.text || '').trim();
      provider = typeof out === 'object' ? out.provider : 'llm';
    } catch (_) { reply = ''; }
  }
  if (!reply) {
    const p = scoped[0];
    reply = `Happy to help! ${p ? `A good place to start is ${p.title} (${'$' + p.price}) — ${p.category.toLowerCase()} our customers steep daily.` : ''} With our wellness blends, the honest answer on results is 2–4 weeks of a daily cup. Per cup it works out to roughly forty cents — origin-fresh, packed in India within days of harvest. What does your daily routine look like, so I can point you to the right blend?`;
  }
  reply = scrubBannedPhrases(reply, brand);

  // persist transcript
  const sid = sessionId || idFor('sess', { agent: agentId, t: Date.now() });
  try {
    if (!sessionId) await db().upsert('smart_agent_sessions', [{ id: sid, agent_id: agentId, visitor_id: context.visitor || null, context }], 'id');
    await db().insert('smart_agent_messages', [
      { session_id: sid, role: 'user', content: message, meta: context },
      { session_id: sid, role: 'agent', content: reply, meta: { provider } },
    ]);
  } catch (_) { /* transcripts are best-effort */ }

  return { ok: true, session_id: sid, agent: { id: agent.id, name: agent.name, voice: agent.voice }, reply, speak: reply.replace(/https?:\/\/\S+/g, 'the product page').replace(/[*_#`]/g, ''), provider };
}

module.exports = { listAgents, getAgent, upsertAgent, syncKnowledge, chat, scopedProducts };
