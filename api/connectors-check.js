'use strict';

/**
 * /api/connectors-check
 *
 * Pre-flight diagnostics for the smart-brain generateAll pipeline: reports
 * which text LLM providers are usable BEFORE generation starts, so the UI can
 * warn exactly which providers are down and degrade gracefully instead of
 * letting the whole cascade 429.
 *
 * Presence-based by default (spends no tokens). Never returns key values —
 * only whether each provider is configured / recently quota-limited.
 */

const { checkTextProviders } = require('./_shared/connector-check.js');

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    // Honour a per-request Gemini key the same way llm.js does (optional).
    const userGeminiKey =
      (req.headers && (req.headers['x-gemini-key'] || req.headers['x-user-gemini-key'])) ||
      (req.query && req.query.geminiKey) || '';
    const report = checkTextProviders({ userGeminiKey });
    res.status(200).json({ ok: true, ...report });
  } catch (e) {
    // Fail safe: never let the diagnostic itself crash the caller.
    res.status(200).json({
      ok: false,
      error: 'connector-check failed',
      anyConfigured: false,
      anyUsable: false,
      providers: [],
      summary: 'Could not run connector diagnostics.',
    });
  }
};
