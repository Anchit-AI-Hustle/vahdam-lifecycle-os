'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Shared LLM caller — 6-provider waterfall (Gemini + Groq + Cerebras free tier)
//
// CASCADE ORDER (first available key wins at each tier):
//   1. OpenAI    (OPENAI_API_KEY / _2 / _3)   — ChatGPT, highest quality
//   2. Anthropic (ANTHROPIC_API_KEY)           — Claude, strong fallback
//   3. Gemini    (GEMINI_API_KEY)              — free tier, multi-model
//   4. Grok/xAI  (XAI_API_KEY)               — OpenAI-compatible fallback
//   5. Groq      (GROQ_API_KEY)              — free 30 RPM, Llama/Mixtral
//   6. Cerebras  (CEREBRAS_API_KEY)           — free 30 RPM, ultra-fast
//
// Within each provider, quota exhaustion rotates keys/models before
// falling to the next provider. Rate-limits also fall through.
//
// Anti-repetition: GEN_SEED appended to every user message so identical
// prompts cannot be served from any response cache layer.
// ─────────────────────────────────────────────────────────────────────────────

const OPENAI_BASE    = 'https://api.openai.com/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta';
const GROK_BASE      = 'https://api.x.ai/v1';
const GROQ_BASE      = 'https://api.groq.com/openai/v1';
const CEREBRAS_BASE  = 'https://api.cerebras.ai/v1';

function genSeed() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xffff).toString(16);
}

/**
 * callLLM({ systemPrompt, userMessage, responseFormat, maxTokens, temperature, timeoutMs, stage, tier })
 *   tier: 'budget' (default — cheap/free cascade) | 'maxpower' (force premium models per provider).
 * Returns { text, provider, model, seed, quota_warning?, exhausted_keys? }
 * Throws on all providers failing.
 */
module.exports = async function callLLM(opts) {
  const {
    systemPrompt  = '',
    userMessage   = '',
    responseFormat = null,   // { type: 'json_object' } or null
    maxTokens     = 2000,
    temperature   = 0.7,
    timeoutMs     = 30000,
    stage         = 'llm',
    userGeminiKey = '',
    preferProvider = '',     // per-call provider preference — same values as APP_AI_PROVIDER; lets callers pin the provider that already worked this turn
    tier          = (process.env.APP_AI_TIER || 'budget')  // 'budget' = low-cost/free cascade | 'maxpower' = highest quality
  } = opts;

  // Tier dial: 'budget' keeps the existing cheap/free cascade (default — behavior unchanged);
  // 'maxpower' forces each provider's premium model (Opus, GPT-4o-class, Gemini Pro, …). Per-request, overridable via *_MAX env vars.
  const _tierNorm  = String(tier || 'budget').toLowerCase().trim();
  const isMaxPower = _tierNorm === 'maxpower' || _tierNorm === 'max-power' || _tierNorm === 'max' || _tierNorm === 'output' || _tierNorm === 'quality';

  // Provider preference: per-call preferProvider wins over the APP_AI_PROVIDER env.
  // Values: 'gemini', 'openai', 'anthropic', 'grok', 'groq', 'cerebras', 'gemini+', or empty (default cascade)
  const preferredProvider = (preferProvider || process.env.APP_AI_PROVIDER || '').toLowerCase().trim();

  const openaiKeys = [
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_API_KEY_2,
    process.env.OPENAI_API_KEY_3
  ].filter(Boolean);

  // Strip BOM (U+FEFF), zero-width spaces, and whitespace — Vercel env can inject invisible chars
  const _clean = s => (s || '').replace(/[﻿​ ]/g, '').trim();
  const anthropicKey = _clean(process.env.ANTHROPIC_API_KEY);
  const geminiKey    = _clean(userGeminiKey) || _clean(process.env.GEMINI_API_KEY);
  const grokKey      = _clean(process.env.XAI_API_KEY);
  const groqKey      = _clean(process.env.GROQ_API_KEY);
  const cerebrasKey  = _clean(process.env.CEREBRAS_API_KEY);
  // Debug: log key presence (not values) for cascade diagnostics
  console.log('[llm] Keys present: groq=' + !!groqKey + ' cerebras=' + !!cerebrasKey + ' gemini=' + !!geminiKey + ' tier=' + (isMaxPower ? 'maxpower' : 'budget'));

  if (!openaiKeys.length && !anthropicKey && !geminiKey && !grokKey && !groqKey && !cerebrasKey) {
    throw new Error('No AI provider configured. Set at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, XAI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY');
  }

  // When a preferred provider is set, skip others to avoid wasting time on failed providers
  // Special: 'gemini+' means Gemini first, then Groq+Cerebras as backup (skip OpenAI/Anthropic/Grok)
  // 'gemini+' = use Gemini + Groq + Cerebras only (skip paid providers with dead credits)
  const isGeminiPlus = preferredProvider === 'gemini+';
  const skipOpenai    = isGeminiPlus ? true  : (preferredProvider && preferredProvider !== 'openai');
  const skipAnthropic = isGeminiPlus ? true  : (preferredProvider && preferredProvider !== 'anthropic');
  const skipGemini    = isGeminiPlus ? false : (preferredProvider && preferredProvider !== 'gemini');
  const skipGrok      = isGeminiPlus ? true  : (preferredProvider && preferredProvider !== 'grok');
  const skipGroq      = isGeminiPlus ? false : (preferredProvider && preferredProvider !== 'groq');
  const skipCerebras  = isGeminiPlus ? false : (preferredProvider && preferredProvider !== 'cerebras');

  const seed             = genSeed();
  const seededUserMessage = userMessage + '\n\n<!-- gen_seed:' + seed + ' -->';

  // ── Provider helpers ────────────────────────────────────────────────────────

  async function _openai(model, key) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    console.log('[llm][' + stage + '] openai model=' + model + ' key=...' + key.slice(-4) + ' seed=' + seed);
    try {
      const r = await fetch(OPENAI_BASE + '/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: seededUserMessage }],
          max_tokens: maxTokens, temperature,
          ...(responseFormat ? { response_format: responseFormat } : {})
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.error('[llm][' + stage + '] OpenAI ' + r.status, err.substring(0, 200));
        const isQuota = (r.status === 429 || r.status === 402 || r.status === 400) &&
          (err.includes('insufficient_quota') || err.includes('quota') || err.includes('billing') || err.includes('billing_hard_limit') || err.includes('billing_limit') || err.includes('credit'));
        return { ok: false, status: r.status, err, quotaExhausted: isQuota };
      }
      const data = await r.json();
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      console.log('[llm][' + stage + '] openai ok len=' + text.length);
      return { ok: true, text, provider: 'openai', model };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, err: e.message || String(e) };
    }
  }

  async function _anthropic(model) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    console.log('[llm][' + stage + '] anthropic model=' + model + ' seed=' + seed);
    // Claude has no native JSON mode — inject instruction into system prompt
    const claudeSystem = responseFormat
      ? systemPrompt + '\n\nCRITICAL: Return ONLY valid JSON. First character must be { and last must be }. No markdown fences, no commentary, no text before or after.'
      : systemPrompt;
    try {
      const r = await fetch(ANTHROPIC_BASE + '/messages', {
        method: 'POST', cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        // Newer Claude models (Opus 4.7/4.8, Fable, …) REJECT `temperature` with a 400 — only send it on legacy claude-3* models.
        body: JSON.stringify(Object.assign({
          model,
          max_tokens: maxTokens,
          system: claudeSystem,
          messages: [{ role: 'user', content: seededUserMessage }]
        }, /^claude-3/.test(model) ? { temperature } : {})),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.error('[llm][' + stage + '] Anthropic ' + r.status, err.substring(0, 200));
        return { ok: false, status: r.status, err };
      }
      const data = await r.json();
      const text = (data.content && data.content[0] && data.content[0].text) || '';
      console.log('[llm][' + stage + '] anthropic ok model=' + model + ' len=' + text.length);
      return { ok: true, text, provider: 'anthropic', model };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, err: e.message || String(e) };
    }
  }

  async function _gemini(model) {
    const ctrl = new AbortController();
    // Gemini free tier can be slower — give 30% more time than other providers
    const t = setTimeout(() => ctrl.abort(), Math.round(timeoutMs * 1.3));
    const combined = systemPrompt + '\n\n---\nUSER REQUEST:\n' + seededUserMessage;
    console.log('[llm][' + stage + '] gemini model=' + model + ' seed=' + seed);
    try {
      const r = await fetch(
        GEMINI_BASE + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(geminiKey),
        {
          method: 'POST', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: combined }] }],
            generationConfig: {
              temperature, maxOutputTokens: maxTokens,
              ...(responseFormat ? { responseMimeType: 'application/json' } : {}),
              // thinkingConfig only for 2.5 thinking models — causes 400 on 2.0-flash/lite
              ...(responseFormat && model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {})
            }
          }),
          signal: ctrl.signal
        }
      );
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.error('[llm][' + stage + '] Gemini ' + r.status + ' model=' + model, err.substring(0, 200));
        return { ok: false, status: r.status, err };
      }
      const data = await r.json();
      const text = (
        data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text
      ) || '';
      console.log('[llm][' + stage + '] gemini ok model=' + model + ' len=' + text.length);
      return { ok: true, text, provider: 'gemini', model };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, err: e.message || String(e) };
    }
  }

  async function _grok(model) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    console.log('[llm][' + stage + '] grok model=' + model + ' seed=' + seed);
    try {
      const r = await fetch(GROK_BASE + '/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + grokKey },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: seededUserMessage }],
          max_tokens: maxTokens, temperature,
          ...(responseFormat ? { response_format: responseFormat } : {})
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.error('[llm][' + stage + '] Grok ' + r.status, err.substring(0, 200));
        return { ok: false, status: r.status, err };
      }
      const data = await r.json();
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      console.log('[llm][' + stage + '] grok ok model=' + model + ' len=' + text.length);
      return { ok: true, text, provider: 'grok', model };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, err: e.message || String(e) };
    }
  }

  // ── Groq (OpenAI-compatible, free 30 RPM, Llama/Mixtral) ─────────────────────
  async function _groq(model) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    console.log('[llm][' + stage + '] groq model=' + model + ' seed=' + seed);
    try {
      const r = await fetch(GROQ_BASE + '/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: seededUserMessage }],
          max_tokens: maxTokens, temperature,
          ...(responseFormat ? { response_format: responseFormat } : {})
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.error('[llm][' + stage + '] Groq ' + r.status, err.substring(0, 200));
        return { ok: false, status: r.status, err };
      }
      const data = await r.json();
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      console.log('[llm][' + stage + '] groq ok model=' + model + ' len=' + text.length);
      return { ok: true, text, provider: 'groq', model };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, err: e.message || String(e) };
    }
  }

  // ── Cerebras (OpenAI-compatible, free 30 RPM, ultra-fast) ──────────────────
  async function _cerebras(model) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    console.log('[llm][' + stage + '] cerebras model=' + model + ' seed=' + seed);
    try {
      const r = await fetch(CEREBRAS_BASE + '/chat/completions', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cerebrasKey },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: seededUserMessage }],
          max_tokens: Math.min(maxTokens, 8192), // Cerebras free tier caps at 8K output
          temperature
          // Cerebras doesn't support response_format yet
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.error('[llm][' + stage + '] Cerebras ' + r.status, err.substring(0, 200));
        return { ok: false, status: r.status, err };
      }
      const data = await r.json();
      const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      console.log('[llm][' + stage + '] cerebras ok model=' + model + ' len=' + text.length);
      return { ok: true, text, provider: 'cerebras', model };
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, err: e.message || String(e) };
    }
  }

  // ── Helper: is this a retryable error (rate limit / model issue) ────────────
  function isRetryable(status) {
    // 403 = forbidden/no-credits (Grok), 402 = payment required — both should cascade
    return status === 429 || status === 503 || status === 404 || status === 400 || status === 529 || status === 403 || status === 402;
  }

  // ── 4-provider cascade ──────────────────────────────────────────────────────
  let result = null;
  let openaiKeysExhausted = 0;
  const _providerErrors = []; // Track each provider's failure for diagnostics

  // === 1. OpenAI (ChatGPT) ===
  if (openaiKeys.length > 0 && !skipOpenai) {
    const model = isMaxPower
      ? (process.env.OPENAI_TEXT_MODEL_MAX || 'gpt-4o')
      : (process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini');
    for (let ki = 0; ki < openaiKeys.length; ki++) {
      result = await _openai(model, openaiKeys[ki]);
      if (result.ok) break;
      if (result.quotaExhausted) {
        openaiKeysExhausted++;
        console.warn('[llm][' + stage + '] OpenAI key #' + (ki + 1) + ' quota exhausted — rotating');
        continue;
      }
      // Rate limit or other error → fall to next provider
      console.warn('[llm][' + stage + '] OpenAI ' + result.status + ' — falling through to Claude');
      break;
    }
    if (result.ok) {
      return { text: result.text, provider: result.provider, model: result.model, seed,
               quota_warning: openaiKeysExhausted > 0, exhausted_keys: openaiKeysExhausted };
    }
    _providerErrors.push({ provider: 'openai', status: result.status, err: String(result.err || '').substring(0, 120) });
  }

  // === 2. Anthropic (Claude) ===
  if (anthropicKey && (!result || !result.ok) && !skipAnthropic) {
    console.warn('[llm][' + stage + '] Trying Anthropic (Claude)');
    const claudeModels = isMaxPower
      ? [ process.env.ANTHROPIC_TEXT_MODEL_MAX || 'claude-opus-4-8', 'claude-sonnet-4-6' ]
      : [ process.env.ANTHROPIC_TEXT_MODEL || 'claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022' ];
    for (const model of claudeModels) {
      result = await _anthropic(model);
      if (result.ok) break;
      if (isRetryable(result.status)) {
        console.warn('[llm][' + stage + '] Anthropic ' + result.status + ' on ' + model + ' — trying next Claude model');
        continue;
      }
      break; // auth or server error
    }
    if (result.ok) {
      return { text: result.text, provider: result.provider, model: result.model, seed,
               quota_warning: openaiKeysExhausted > 0, exhausted_keys: openaiKeysExhausted };
    }
    _providerErrors.push({ provider: 'anthropic', status: result.status, err: String(result.err || '').substring(0, 120) });
  }

  // === 3. Gemini (with rate-limit retry) ===
  //    De-duplicate: env var might equal a hardcoded fallback
  if (geminiKey && (!result || !result.ok) && !skipGemini) {
    console.warn('[llm][' + stage + '] Trying Gemini');
    const _gmRaw = isMaxPower
      ? [ process.env.GEMINI_TEXT_MODEL_MAX || 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash' ]
      : [
          process.env.GEMINI_TEXT_MODEL || 'gemini-2.0-flash',
          'gemini-2.5-flash',
          'gemini-2.0-flash',
          'gemini-2.0-flash-lite'
        ];
    const _gmSeen = new Set();
    const geminiModels = _gmRaw.filter(m => { if (_gmSeen.has(m)) return false; _gmSeen.add(m); return true; });
    for (const model of geminiModels) {
      result = await _gemini(model);
      if (result.ok) break;
      // Rate-limit retry: wait 4s and retry same model once before moving on
      if (result.status === 429) {
        console.warn('[llm][' + stage + '] Gemini 429 on ' + model + ' — waiting 4s and retrying');
        await new Promise(r => setTimeout(r, 4000));
        result = await _gemini(model);
        if (result.ok) break;
      }
      if (isRetryable(result.status)) {
        console.warn('[llm][' + stage + '] Gemini ' + result.status + ' on ' + model + ' — trying next');
        continue;
      }
      break;
    }
    if (result.ok) {
      return { text: result.text, provider: result.provider, model: result.model, seed,
               quota_warning: openaiKeysExhausted > 0, exhausted_keys: openaiKeysExhausted };
    }
    _providerErrors.push({ provider: 'gemini', status: result.status, err: String(result.err || '').substring(0, 120) });
  }

  // === 4. Grok (xAI) ===
  if (grokKey && (!result || !result.ok) && !skipGrok) {
    console.warn('[llm][' + stage + '] Trying Grok (xAI)');
    const grokModels = isMaxPower
      ? [ process.env.GROK_TEXT_MODEL_MAX || 'grok-3', 'grok-3-mini' ]
      : [ process.env.GROK_TEXT_MODEL || 'grok-3-mini-fast', 'grok-3-mini' ];
    for (const model of grokModels) {
      result = await _grok(model);
      if (result.ok) break;
      if (isRetryable(result.status)) {
        console.warn('[llm][' + stage + '] Grok ' + result.status + ' on ' + model + ' — trying next');
        continue;
      }
      break;
    }
    if (result.ok) {
      return { text: result.text, provider: result.provider, model: result.model, seed,
               quota_warning: openaiKeysExhausted > 0, exhausted_keys: openaiKeysExhausted };
    }
  }

  // === 5. Groq (free tier — Llama 3.3 70B, 30 RPM) ===
  if (groqKey && (!result || !result.ok) && !skipGroq) {
    console.warn('[llm][' + stage + '] Trying Groq (free tier)');
    const groqModels = [
      process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768'
    ];
    for (const model of groqModels) {
      result = await _groq(model);
      if (result.ok) break;
      if (isRetryable(result.status)) {
        console.warn('[llm][' + stage + '] Groq ' + result.status + ' on ' + model + ' — trying next');
        continue;
      }
      break;
    }
    if (result.ok) {
      return { text: result.text, provider: result.provider, model: result.model, seed,
               quota_warning: openaiKeysExhausted > 0, exhausted_keys: openaiKeysExhausted };
    }
    _providerErrors.push({ provider: 'groq', status: result.status, err: String(result.err || '').substring(0, 120) });
  }

  // === 6. Cerebras (free tier — Llama 3.1 70B, 30 RPM, ultra-fast) ===
  if (cerebrasKey && (!result || !result.ok) && !skipCerebras) {
    console.warn('[llm][' + stage + '] Trying Cerebras (free tier)');
    const cerebrasModels = [
      process.env.CEREBRAS_TEXT_MODEL || 'llama-3.3-70b',
      'llama-3.1-8b'
    ];
    for (const model of cerebrasModels) {
      result = await _cerebras(model);
      if (result.ok) break;
      if (isRetryable(result.status)) {
        console.warn('[llm][' + stage + '] Cerebras ' + result.status + ' on ' + model + ' — trying next');
        continue;
      }
      break;
    }
    if (result.ok) {
      return { text: result.text, provider: result.provider, model: result.model, seed,
               quota_warning: openaiKeysExhausted > 0, exhausted_keys: openaiKeysExhausted };
    }
    _providerErrors.push({ provider: 'cerebras', status: result.status, err: String(result.err || '').substring(0, 120) });
  }

  // === All providers exhausted — build detailed diagnostic ===
  if (result && !result.ok) {
    _providerErrors.push({ provider: result.provider || 'grok', status: result.status, err: String(result.err || '').substring(0, 120) });
  }
  const _failLog = _providerErrors.map(function(e) { return e.provider + ':' + e.status; }).join(' → ');
  const _fullLog = _providerErrors.map(function(e) { return e.provider + '(' + e.status + '): ' + e.err; }).join(' | ');
  console.error('[llm][' + stage + '] ALL PROVIDERS FAILED: ' + _fullLog);
  const errMsg = (result && result.err) ? String(result.err).substring(0, 250) : 'All providers exhausted';
  const status = result && result.status;
  const err = new Error(
    'All providers failed [' + stage + '] cascade=' + _failLog + ' | last=' + errMsg
  );
  err._providerErrors = _providerErrors;
  throw err;
};

/**
 * parseJSON(text) — multi-strategy JSON extractor.
 * Handles: clean JSON, markdown fences, prose prefix/suffix, nested fences.
 */
module.exports.parseJSON = function parseJSON(text) {
  if (!text || typeof text !== 'string') throw new SyntaxError('Empty or non-string LLM response');
  try { return JSON.parse(text); } catch (_) {}
  const stripped = text.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/m, '').trim();
  try { return JSON.parse(stripped); } catch (_) {}
  const bs = text.indexOf('{'), be = text.lastIndexOf('}');
  if (bs !== -1 && be > bs) { try { return JSON.parse(text.slice(bs, be + 1)); } catch (_) {} }
  const ss = stripped.indexOf('{'), se = stripped.lastIndexOf('}');
  if (ss !== -1 && se > ss) { try { return JSON.parse(stripped.slice(ss, se + 1)); } catch (_) {} }
  throw new SyntaxError('Could not parse JSON from LLM response. First 200 chars: ' + text.substring(0, 200));
};

/**
 * corsHeaders(res) — apply standard CORS to a Vercel response.
 */
module.exports.corsHeaders = function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-gemini-key');
};
