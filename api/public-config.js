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

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

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
  });
};
