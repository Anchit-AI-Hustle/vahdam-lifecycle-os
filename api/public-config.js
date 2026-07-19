'use strict';

/**
 * /api/public-config
 *
 * Returns the PUBLIC config the front-end needs: Supabase URL + anon key.
 * Never include service-role keys, OpenAI keys, etc. here.
 * Cached for 5 minutes at the CDN.
 */

const fs = require('fs');
const path = require('path');

function linkedDb() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'linked-db.json'), 'utf8'));
  } catch (_) { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  // CORS on every branch (the bootstrap config is fetched cross-origin from
  // preview deployments and the PWA shell).
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Real-time data-accuracy validator — /api/validate-data rewrites here as
  // ?action=validate-data (also ?validate=1). Runs the analytics validation
  // AGENT (deterministic checks + best-effort LLM assessment) against the
  // canonical report and returns one verdict per metric. Logic lives in the
  // cap-free _shared module so no new serverless function is added.
  const wantsValidate = req.query && (req.query.action === 'validate-data' || req.query.validate !== undefined);
  if (wantsValidate) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { validate } = require('./_shared/data-validation-core.js');
      const narrative = !(req.query.narrative === '0' || req.query.narrative === 'false');
      const result = await validate({ narrative });
      return res.status(200).json(result);
    } catch (e) {
      return res.status(200).json({ ok: false, error: 'validation_failed', message: String(e && e.message || e), checks: [] });
    }
  }

  // Pipeline health mode — /api/ai/pipeline/health rewrites here as ?pipeline=1
  // (the standalone function was retired to free a Hobby function slot for /api/brain).
  if (req.query && req.query.pipeline !== undefined) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const keys = {
      openai: !!process.env.OPENAI_API_KEY, openai2: !!process.env.OPENAI_API_KEY_2, openai3: !!process.env.OPENAI_API_KEY_3,
      anthropic: !!process.env.ANTHROPIC_API_KEY, gemini: !!process.env.GEMINI_API_KEY, grok: !!process.env.XAI_API_KEY,
      groq: !!process.env.GROQ_API_KEY, cerebras: !!process.env.CEREBRAS_API_KEY,
    };
    const tiers = [keys.openai && 'OpenAI', keys.anthropic && 'Anthropic/Claude', keys.gemini && 'Gemini', keys.grok && 'Grok/xAI', keys.groq && 'Groq', keys.cerebras && 'Cerebras'].filter(Boolean);
    const hasProvider = tiers.length > 0;
    return res.status(200).json({
      ok: hasProvider, stage: 'health',
      checks: {
        endpoint_reachable: true,
        openai_key_set: keys.openai, openai_key_2_set: keys.openai2, openai_key_3_set: keys.openai3,
        openai_keys_total: [keys.openai, keys.openai2, keys.openai3].filter(Boolean).length,
        anthropic_key_set: keys.anthropic, gemini_key_set: keys.gemini, grok_key_set: keys.grok,
        provider_tiers_active: tiers.length, at_least_one_provider: hasProvider,
        image_model: keys.openai ? (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2 (default)') : 'Pollinations FLUX (free — no OpenAI key)',
        text_model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini (default)',
        node_version: process.version, timestamp: new Date().toISOString(),
      },
      warnings: hasProvider ? [] : ['CRITICAL: No AI provider keys configured. Set at least GEMINI_API_KEY (free) or OPENAI_API_KEY in Vercel env.'],
      verdict: hasProvider ? 'Pipeline ready · ' + tiers.join(' → ') : 'BLOCKED: No LLM provider configured.',
    });
  }

  // Live provider probe — /api/health?probe=1 (also /api/public-config?probe=1).
  // For every provider that HAS a key, fires ONE tiny real request (pinned to that
  // provider via preferProvider so providers are tested in isolation) and reports
  // whether it actually answered — turning "key is present" into "key works right
  // now". This is the definitive answer to "why did copy fall back to template":
  // you see per provider whether it's ok / rate-limited (429) / bad key (401) /
  // wrong model (404) / not configured. No secrets leak (booleans + status only).
  if (req.query && (req.query.probe !== undefined)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const callLLM = require('./_shared/llm.js');
    const PROVIDERS = [
      { id: 'anthropic', label: 'Anthropic / Claude', env: 'ANTHROPIC_API_KEY', gen: 'https://console.anthropic.com/settings/keys' },
      { id: 'openai',    label: 'OpenAI',              env: 'OPENAI_API_KEY',    gen: 'https://platform.openai.com/api-keys' },
      { id: 'gemini',    label: 'Google Gemini',       env: 'GEMINI_API_KEY',    gen: 'https://aistudio.google.com/apikey' },
      { id: 'grok',      label: 'xAI / Grok',          env: 'XAI_API_KEY',       gen: 'https://console.x.ai' },
      { id: 'groq',      label: 'Groq (free)',         env: 'GROQ_API_KEY',      gen: 'https://console.groq.com/keys' },
      { id: 'cerebras',  label: 'Cerebras (free)',     env: 'CEREBRAS_API_KEY',  gen: 'https://cloud.cerebras.ai' },
      { id: 'openrouter', label: 'OpenRouter (gateway → Claude/GPT/…)', env: 'OPENROUTER_API_KEY', gen: 'https://openrouter.ai/credits' },
      { id: 'github',    label: 'GitHub Models (free GPT-4o/Llama)', env: 'GITHUB_MODELS_TOKEN', gen: 'https://github.com/settings/tokens' },
      { id: 'cloudflare', label: 'Cloudflare Workers AI (free daily)', env: 'CLOUDFLARE_API_TOKEN', gen: 'https://dash.cloudflare.com/profile/api-tokens' },
    ];
    const keyPresent = (id) => id === 'openai'
      ? !!(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2 || process.env.OPENAI_API_KEY_3)
      : id === 'openrouter'
        ? !!(process.env.OPENROUTER_API_KEY || process.env.OpenRouter_API_KEY)
        : id === 'github'
          ? !!(process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN)
          : id === 'cloudflare'
            ? !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
            : !!process.env[PROVIDERS.find((p) => p.id === id).env];
    // Hard per-provider cap so the whole probe stays well under the function
    // timeout even when a provider's model chain is slow. maxTokens is generous
    // enough that reasoning models (e.g. Groq gpt-oss) still emit real content.
    const withCap = (promise, ms) => Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('probe_cap'), { _providerErrors: [{ status: 0, err: 'probe time cap' }] })), ms)),
    ]);
    const results = await Promise.all(PROVIDERS.map(async (p) => {
      if (!keyPresent(p.id)) return { provider: p.id, label: p.label, configured: false, ok: false, verdict: 'not configured', generate_key_at: p.gen };
      try {
        const r = await withCap(callLLM({ systemPrompt: 'Reply with the single word: ok', userMessage: 'ping', maxTokens: 64, temperature: 0, timeoutMs: 4500, stage: 'probe', preferProvider: p.id }), 6500);
        return { provider: p.id, label: p.label, configured: true, ok: true, model: r.model, verdict: 'ok — answered' };
      } catch (e) {
        const det = (e && e._providerErrors && e._providerErrors[0]) || {};
        const status = det.status;
        const verdict = status === 429 || status === 402 ? 'rate-limited / quota exhausted (429)'
          : status === 401 || status === 403 ? 'bad or unauthorized key (401/403)'
          : status === 404 ? 'model not found for this account (404)'
          : status === 0 ? 'timeout / network'
          : 'failed (' + (status || '?') + ')';
        return { provider: p.id, label: p.label, configured: true, ok: false, status, verdict, detail: String(det.err || (e && e.message) || '').substring(0, 160) };
      }
    }));
    const working = results.filter((r) => r.ok);
    return res.status(200).json({
      ok: working.length > 0,
      probe: 'live',
      ts: new Date().toISOString(),
      env: process.env.VERCEL_ENV || 'unknown',
      working_providers: working.map((r) => r.provider),
      summary: working.length
        ? working.length + ' provider(s) answering: ' + working.map((r) => r.provider).join(', ')
        : 'NO provider answered — this is why copy fell back to the template. Fix the providers below (add a key or clear quota).',
      providers: results,
    });
  }

  // Health mode — /api/health rewrites here as ?health=1. Returns provider
  // status (no secrets) for uptime monitors + deploy verification. Always 200.
  if (req.query && (req.query.health !== undefined)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasSupabase = !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    return res.status(200).json({
      ok: true,
      build: 'lifecycle-os',
      ts: new Date().toISOString(),
      region: process.env.VERCEL_REGION || 'unknown',
      env: process.env.VERCEL_ENV || 'unknown',
      providers: {
        text: { active: hasOpenAI ? 'openai' : (hasGemini ? 'gemini' : 'none'), openai_configured: hasOpenAI, gemini_configured: hasGemini },
        image: { active: hasOpenAI ? 'openai' : 'pollinations', pollinations_available: true },
        storage: { supabase_configured: hasSupabase },
      },
    });
  }

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  // Linked-DB-first: data/linked-db.json is the provided linked database for
  // the whole suite (the old env-configured project was decommissioned).
  // Env vars still win when BOTH are set AND no linked-db file exists.
  const ldb = linkedDb();
  res.status(200).json({
    supabase: {
      url:      ldb.url || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      anonKey:  ldb.anonKey || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    },
    app: {
      name: 'VAHDAM Lifecycle OS',
      version: '1.0.0',
      regions: ['US', 'UK', 'Global', 'IN'],
    },
    // B1 real-only flag, exposed so CLIENT pages (e.g. /studio) can gate their
    // own fabricated reviews/ratings/prices the same way server renderers do.
    flags: {
      real_facts_only: String(process.env.REAL_FACTS_ONLY || '') === '1',
    },
  });
};
