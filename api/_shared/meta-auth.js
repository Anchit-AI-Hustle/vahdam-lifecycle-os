'use strict';

/**
 * meta-auth.js — how this repo authenticates to the Meta Graph API, in one place.
 *
 * WHAT META ACTUALLY NEEDS, AND WHAT IT DOES NOT
 * ----------------------------------------------
 * An App ID and App Secret are NOT credentials for reading ad performance. The
 * app access token you can mint from them (`{app-id}|{app-secret}`) is rejected
 * by the Marketing API: Insights requires a USER or SYSTEM USER token carrying
 * `ads_read`. Handing the app secret to a reporting call therefore buys nothing
 * and leaks a long-lived secret into a request log.
 *
 * So the reporting credentials stay exactly as they were:
 *   META_ACCESS_TOKEN     a System User token with ads_read (does not expire)
 *   META_AD_ACCOUNT_ID    act_<id>, comma-separated for several accounts
 *
 * WHERE THE APP SECRET LEGITIMATELY BELONGS
 * -----------------------------------------
 * `appsecret_proof`: an HMAC-SHA256 of the access token, keyed by the app
 * secret, sent alongside every server-side call. Meta uses it to prove the call
 * came from the app that owns the token, so a token stolen on its own cannot be
 * replayed from somewhere else. It is optional, and it is the correct hardening
 * for a server that holds a long-lived System User token.
 *
 * It is OPT-IN here, and silently absent when `META_APP_SECRET` is unset: a
 * proof computed from the wrong secret makes every request fail with an opaque
 * OAuth error, which is a worse outcome than not sending one. Turning it on is
 * a deliberate act of setting the env var.
 *
 * NOTHING IN THIS FILE HOLDS A VALUE. Every secret is read from the environment
 * at call time. This repository is public.
 */

const crypto = require('crypto');

const str = (v) => String(v == null ? '' : v).trim();

/** Per-market override, falling back to the global key: META_APP_SECRET_UK etc. */
function envFor(base, market) {
  const mk = str(market).toUpperCase() || 'US';
  return str(process.env[`${base}_${mk}`] || process.env[base]);
}

/**
 * appsecret_proof for a token, or '' when no app secret is configured.
 * Returning '' rather than throwing keeps the hardening opt-in: a deployment
 * that has never set META_APP_SECRET behaves exactly as it did before.
 */
function appsecretProof(accessToken, market) {
  const secret = envFor('META_APP_SECRET', market);
  const token = str(accessToken);
  if (!secret || !token) return '';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * The auth params for a Graph call: the token, plus the proof when configured.
 * Callers spread this into their query rather than assembling it themselves, so
 * a new Meta caller cannot forget the proof.
 */
function authParams(accessToken, market) {
  const token = str(accessToken);
  if (!token) return {};
  const proof = appsecretProof(token, market);
  return proof ? { access_token: token, appsecret_proof: proof } : { access_token: token };
}

/** True when the proof is configured for this market (for health reporting). */
function proofEnabled(market) { return !!envFor('META_APP_SECRET', market); }

/**
 * Redact both secrets from any string before it is logged, returned in a
 * would_request stub, or shown in the UI. The proof is a derived value, but it
 * is still bound to the token and there is no reason to publish it.
 */
function redact(s) {
  return String(s == null ? '' : s)
    .replace(/access_token=[^&\s]*/gi, 'access_token=REDACTED')
    .replace(/appsecret_proof=[^&\s]*/gi, 'appsecret_proof=REDACTED');
}

/**
 * What an operator has to do to make Meta live, in the order they must do it.
 * Kept next to the code that needs it so the instructions cannot drift from the
 * env names actually read.
 */
const SETUP_STEPS = Object.freeze([
  'Business Settings > Users > System Users > Add, and give the system user access to the ad account (View Performance is enough for reporting).',
  'Generate a token for that system user against your app, with the ads_read scope. A system user token does not expire.',
  'Set META_ACCESS_TOKEN to that token and META_AD_ACCOUNT_ID to the account id (digits only, comma-separated for several).',
  'Optional hardening: set META_APP_SECRET to the app secret so every call carries appsecret_proof.',
  'Set LIVE_CONNECTORS=on, or every connector stays switched off by design.',
]);

module.exports = { appsecretProof, authParams, proofEnabled, redact, SETUP_STEPS };
