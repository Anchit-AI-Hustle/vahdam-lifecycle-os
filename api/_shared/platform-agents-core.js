'use strict';

/**
 * platform-agents-core.js — one analyst agent PER PLATFORM.
 *
 * Each agent owns a single source end to end: it fetches that platform's own
 * raw data, collates it into computed metrics, analyses those metrics, and
 * returns insights plus action items scoped to that platform. Seven agents,
 * seven independent reads, one collation on top.
 *
 *   commerce   shopify
 *   paid       meta · google · tiktok
 *   lifecycle  klaviyo · webengage
 *   web        pagedeck
 *
 * ── Two rules that make the output trustworthy ──────────────────────────────
 *
 * 1. AN AGENT WITH NO DATA DOES NOT THINK. If its platform is not connected the
 *    agent skips the LLM entirely and returns the connection step as its single
 *    action item. It never speculates about what the numbers might look like,
 *    and it never spends model quota to say nothing. This is the difference
 *    between "no data" and a confident paragraph about imaginary performance.
 *
 * 2. EVERY CLAIM QUOTES A FIGURE THE AGENT ACTUALLY FETCHED. Agents run on the
 *    shared EVIDENCE_CONTRACT from feature-agent.js, and anything the collector
 *    flagged as a caveat is passed in explicitly as not-to-be-leaned-on.
 *
 * Each agent reports `raw` (what it fetched), `metrics` (what it computed),
 * `insights` and `action_items`, so the analysis can always be traced back to
 * the read that produced it.
 */

const callLLM = require('./llm.js');
const { parseJSON } = require('./llm.js');
const { EVIDENCE_CONTRACT } = require('./feature-agent.js');

const shopify = require('./shopify-core.js');
const adInsights = require('./ad-insights-core.js');
const klaviyo = require('./klaviyo-core.js');
const webengage = require('./webengage-core.js');
const pagedeck = require('./pagedeck-core.js');

const n = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
const round = (v, d = 2) => Math.round(n(v) * 10 ** d) / 10 ** d;
const rate = (a, b) => (n(b) ? round(n(a) / n(b), 4) : null);
const iso = () => new Date().toISOString();
const textOf = (o) => (typeof o === 'string' ? o : (o && (o.text || o.content || o.output)) || '');

// ── Collectors: one per platform, each returns the same envelope ────────────
// { connected, source, raw, metrics, caveats[], blocker }
function offline(blocker, extra) {
  return Object.assign({ connected: false, source: null, raw: null, metrics: {}, caveats: [], blocker }, extra || {});
}

async function collectShopify({ market, days }) {
  if (!shopify.isConnected(market)) return offline(shopify.status(market).blocker);
  const [sum, prods] = await Promise.all([
    shopify.summary({ market, days }).catch((e) => ({ ok: false, error: e.message })),
    shopify.products({ market }).catch((e) => ({ ok: false, error: e.message })),
  ]);
  if (!sum.ok) return offline(sum.blocker || sum.error || 'Shopify read failed');
  const catalogue = (prods.ok && prods.data && prods.data.products) || [];
  const caveats = [];
  if (sum.note) caveats.push(sum.note); // e.g. the 250-order page cap makes totals a floor
  return {
    connected: true, source: sum.source, blocker: null, caveats,
    raw: { orders_sampled: sum.orders, products_returned: catalogue.length },
    metrics: {
      window_days: sum.window_days, currency: sum.currency, orders: sum.orders, revenue: sum.revenue,
      aov: sum.aov, returning_order_rate_pct: sum.returning_rate_pct,
      active_products: catalogue.filter((p) => p.status === 'active').length,
      revenue_per_day: rate(sum.revenue, sum.window_days),
    },
  };
}

async function collectAdPlatform(platform, { market, since, until }) {
  if (!adInsights.isConnected(platform, market)) {
    const probe = await adInsights.insights({ platform, market, level: 'account' }).catch(() => null);
    return offline(`Set ${((probe && probe.need_env) || []).join(', ') || platform + ' credentials'} in Vercel env.`);
  }
  const [acct, camp] = await Promise.all([
    adInsights.insights({ platform, market, metricGroup: 'all', level: 'account', since, until }).catch((e) => ({ ok: false, error: e.message })),
    adInsights.insights({ platform, market, metricGroup: 'conversion', level: 'campaign', since, until }).catch((e) => ({ ok: false, error: e.message })),
  ]);
  if (!acct.ok) return offline(String(acct.error || 'ad platform read failed'));

  const rows = Array.isArray(camp.data) ? camp.data : [];
  const spendOf = (x) => n(x.spend || (x.metrics && x.metrics.costMicros / 1e6));
  const totalSpend = rows.reduce((a, x) => a + spendOf(x), 0);
  const caveats = [];
  if (!camp.ok) caveats.push(`Campaign-level read failed (${String(camp.error).slice(0, 80)}) — account totals only.`);
  if (!rows.length) caveats.push('No campaign rows in the window; account figures cannot be attributed to a campaign.');
  return {
    connected: true, source: acct.source, blocker: null, caveats,
    raw: { account_rows: (acct.data || []).length, campaign_rows: rows.length, window: acct.window },
    metrics: {
      platform, window: acct.window, campaigns: rows.length, total_spend: round(totalSpend),
      // Deliberately not derived further here: each platform names conversions
      // and revenue differently, and inventing a cross-platform ROAS from
      // mismatched fields is how a wrong number gets authority.
      account_payload_fields: Object.keys((acct.data && acct.data[0]) || {}),
    },
  };
}

async function collectKlaviyo({ hours }) {
  if (!klaviyo.isConnected()) return offline('Set KLAVIYO_API_KEY (+ LIVE_CONNECTORS=on) in Vercel env.');
  const [metrics, campaigns, segments] = await Promise.all([
    klaviyo.getMetrics().catch((e) => ({ ok: false, error: e.message })),
    klaviyo.getCampaigns({ limit: 50 }).catch((e) => ({ ok: false, error: e.message })),
    klaviyo.getSegments({ limit: 50 }).catch((e) => ({ ok: false, error: e.message })),
  ]);
  const list = (r) => (r && r.ok && r.data && Array.isArray(r.data.data) ? r.data.data : []);
  return {
    connected: true, source: 'Klaviyo REST (JSON:API)', blocker: null, caveats: [],
    raw: { metrics: list(metrics).length, campaigns: list(campaigns).length, segments: list(segments).length },
    metrics: { window_hours: hours, known_metrics: list(metrics).length, campaigns: list(campaigns).length, segments: list(segments).length },
  };
}

async function collectWebengage({ market, hours }) {
  const e = webengage.env();
  if (!e.key) return offline('Set SUPABASE_SERVICE_ROLE_KEY and run the WebEngage 12h sync.');
  const sum = await webengage.eventSummary({ hours, market }).catch((err) => ({ ok: false, error: err.message }));
  if (!sum || !sum.ok) return offline(`WebEngage events unavailable: ${String((sum && sum.error) || 'no rows').slice(0, 120)}`);
  const byEvent = Array.isArray(sum.by_event) ? sum.by_event : [];
  return {
    connected: true, source: 'WebEngage events mirrored in Supabase', blocker: null,
    caveats: ['WebEngage supplies engagement events, not attributed revenue.'],
    raw: { event_types: byEvent.length, total_events: n(sum.total_events) },
    metrics: { window_hours: hours, total_events: n(sum.total_events), top_events: byEvent.slice(0, 10) },
  };
}

async function collectPagedeck({ market }) {
  const d = await pagedeck.analytics({ market }).catch((e) => ({ ok: false, error: e.message }));
  const pages = (d && Array.isArray(d.pages)) ? d.pages : [];
  if (!pages.length) return offline((d && d.connector && d.connector.note) || 'PageDeck not connected and the pagedeck_pages mirror is empty.');
  const k = d.kpis || {};
  return {
    connected: true, source: (d.connector && d.connector.sources || []).join(' · ') || 'PageDeck', blocker: null, caveats: [],
    raw: { pages: pages.length, experiments: (d.experiments || []).length },
    metrics: { pages: pages.length, visitors: n(k.visitors), conversions: n(k.conversions), conversion_rate: k.conversion_rate, revenue: k.revenue, aov: k.aov, live_experiments: k.live_experiments, srm_flags: k.srm_flags },
  };
}

const AGENTS = [
  { id: 'shopify', label: 'Shopify', group: 'commerce', brief: 'store revenue, AOV, repeat purchase and catalogue health', collect: collectShopify },
  { id: 'meta', label: 'Meta Ads', group: 'paid_media', brief: 'paid social delivery, efficiency and purchase outcome', collect: (o) => collectAdPlatform('meta', o) },
  { id: 'google', label: 'Google Ads', group: 'paid_media', brief: 'search and shopping spend efficiency and conversion value', collect: (o) => collectAdPlatform('google', o) },
  { id: 'tiktok', label: 'TikTok Ads', group: 'paid_media', brief: 'short-form paid delivery, view-through and payment completion', collect: (o) => collectAdPlatform('tiktok', o) },
  { id: 'klaviyo', label: 'Klaviyo', group: 'lifecycle', brief: 'email/SMS list health, campaign engagement and attributed revenue', collect: collectKlaviyo },
  { id: 'webengage', label: 'WebEngage', group: 'lifecycle', brief: 'notification and journey engagement', collect: collectWebengage },
  { id: 'pagedeck', label: 'Landing Pages (PageDeck)', group: 'web', brief: 'landing-page conversion and experiment quality', collect: collectPagedeck },
];

// ── The analysis step ───────────────────────────────────────────────────────
const SCHEMA =
  '{"insights":[{"observation":"","evidence":"quoted figure(s) from METRICS","hypothesis":"if X then Y because Z",' +
  '"target_metric":"","expected_impact":"","confidence":"low|med|high"}],' +
  '"action_items":[{"action":"","why":"","target_metric":"","effort":"low|med|high","priority":"P0|P1|P2","owner":""}],' +
  '"summary":"2-3 sentences"}';

async function analyse(agent, collected, { question, tier, timeoutMs }) {
  const sys =
    `You are the ${agent.label} analyst for VAHDAM (premium D2C tea and wellness). You own ONE platform: ` +
    `${agent.brief}. You read ALREADY-FETCHED metrics from that platform and produce decisions, not restated numbers. ` +
    EVIDENCE_CONTRACT + '\n' +
    'Stay inside your platform: do not speculate about other channels, and do not compare against benchmarks you were not given. ' +
    'If a caveat says a figure is partial or not revenue, DO NOT build a recommendation on it — flag it instead. ' +
    'Every action item must be something a marketer can execute this week on this platform. Output STRICT JSON only:\n' + SCHEMA;
  const user =
    `PLATFORM: ${agent.label}\nSOURCE: ${collected.source}\n` +
    (question ? `QUESTION: ${question}\n` : '') +
    'METRICS (JSON):\n' + JSON.stringify(collected.metrics).slice(0, 12000) + '\n' +
    (collected.caveats.length ? '\nDATA CAVEATS (do not lean on these):\n' + JSON.stringify(collected.caveats).slice(0, 2000) : '') +
    '\n\nReturn the JSON now.';
  const out = await callLLM({
    systemPrompt: sys, userMessage: user, responseFormat: { type: 'json_object' },
    maxTokens: 1200, temperature: 0.3, timeoutMs, stage: `platform-agent-${agent.id}`, tier, preferProvider: 'gemini+',
  });
  const parsed = parseJSON(textOf(out));
  return {
    insights: Array.isArray(parsed && parsed.insights) ? parsed.insights.slice(0, 6) : [],
    action_items: Array.isArray(parsed && parsed.action_items) ? parsed.action_items.slice(0, 6) : [],
    summary: (parsed && parsed.summary) || null,
    grounded: !!(parsed && parsed.insights),
  };
}

/** Run one platform's agent: fetch → collate → analyse → insights + actions. */
async function runAgent(id, opts = {}) {
  const agent = AGENTS.find((a) => a.id === String(id).toLowerCase());
  if (!agent) return { ok: false, error: `Unknown platform agent '${id}'`, available: AGENTS.map((a) => a.id) };
  const { market = 'US', days = 30, hours = 720, since, until, question = '', tier = 'standard', timeoutMs = 25000 } = opts;

  const started = Date.now();
  let collected;
  try { collected = await agent.collect({ market, days, hours, since, until }); }
  catch (e) { collected = offline(`Collector failed: ${String(e && e.message || e).slice(0, 140)}`); }

  const base = {
    ok: true, agent: agent.id, label: agent.label, group: agent.group, market, generated_at: iso(),
    connected: collected.connected, source: collected.source, blocker: collected.blocker,
    raw: collected.raw, metrics: collected.metrics, caveats: collected.caveats,
  };

  // Rule 1: no data, no thinking. The only honest action item is the one that
  // would produce data — and it is emitted as a real, prioritised action rather
  // than an error string, because connecting the source IS the next step.
  if (!collected.connected) {
    return Object.assign(base, {
      analysed: false,
      summary: `${agent.label} is not connected, so no ${agent.brief} can be reported. No analysis was attempted and no figures are estimated.`,
      insights: [],
      action_items: [{
        action: `Connect ${agent.label}`, why: collected.blocker,
        target_metric: 'data availability', effort: 'low', priority: 'P0', owner: 'ops',
      }],
      took_ms: Date.now() - started,
    });
  }

  let analysis = { insights: [], action_items: [], summary: null, grounded: false };
  try { analysis = await analyse(agent, collected, { question, tier, timeoutMs }); }
  catch (e) {
    return Object.assign(base, {
      analysed: false, insights: [], action_items: [],
      summary: `${agent.label} data was fetched but the analysis step failed (${String(e && e.message || e).slice(0, 120)}). The metrics above are real; no interpretation is offered.`,
      took_ms: Date.now() - started,
    });
  }
  return Object.assign(base, { analysed: analysis.grounded }, analysis, { took_ms: Date.now() - started });
}

/**
 * Run every platform agent in parallel and collate. The collation is
 * arithmetic over what the agents actually returned — it does not re-analyse,
 * and it never merges figures across platforms that measure different things.
 */
async function runAll(opts = {}) {
  const only = opts.platforms
    ? String(opts.platforms).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : AGENTS.map((a) => a.id);
  const agents = await Promise.all(only.map((id) => runAgent(id, opts).catch((e) => ({ ok: false, agent: id, error: e.message }))));

  const connected = agents.filter((a) => a.connected);
  const actions = agents.flatMap((a) => (a.action_items || []).map((x) => Object.assign({ platform: a.label, platform_id: a.agent }, x)));
  const order = { P0: 0, P1: 1, P2: 2 };
  return {
    ok: true, generated_at: iso(), market: opts.market || 'US',
    coverage: {
      total: agents.length, connected: connected.length, blocked: agents.length - connected.length,
      analysed: agents.filter((a) => a.analysed).length,
      by_group: ['commerce', 'paid_media', 'lifecycle', 'web'].map((g) => {
        const inGroup = agents.filter((a) => AGENTS.find((x) => x.id === a.agent && x.group === g));
        return { group: g, total: inGroup.length, connected: inGroup.filter((a) => a.connected).length };
      }),
    },
    agents,
    // One ranked queue across every platform, so the operator has a single list
    // to work rather than seven.
    action_queue: actions.sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3)),
    note: 'Each platform is read and analysed independently by its own agent. An unconnected platform is never analysed — its only action item is the connection step. No figure is combined across platforms that measure different things.',
  };
}

module.exports = { runAgent, runAll, AGENTS };
