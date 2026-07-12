'use strict';

/**
 * api/_shared/klaviyo-core.js — Klaviyo integration for VAHDAM (ChaiGPT brain).
 *
 * Mirrors Klaviyo's public REST API (JSON:API, revision-pinned) so the brand
 * LLM can read/segment audiences, inspect campaigns/flows, pull reporting, and
 * push profiles/events — WITHOUT us hardcoding any keys here.
 *
 * Auth (set later in Vercel env — never hardcode):
 *   KLAVIYO_API_KEY        private key (server-side, "pk_..." / "Klaviyo-API-Key")
 *   KLAVIYO_PUBLIC_KEY     public company_id (client-side track/subscribe)
 *   KLAVIYO_REVISION       optional API revision pin (default below)
 *
 * Until a key is present, every op returns a structured { connected:false,
 * would_request } stub describing exactly the HTTP call it WOULD make — so the
 * chat UX and tool-calling work end-to-end and only need a key to go live.
 *
 * Docs: https://developers.klaviyo.com/en/reference/api_overview
 */

const API_BASE = 'https://a.klaviyo.com/api';
const DEFAULT_REVISION = '2024-10-15';
// Central read-only guard (project-wide rule for Shopify/Klaviyo/WebEngage).
const { assertReadOnly } = require('./read-only-egress.js');

function cfg() {
  return {
    key: (process.env.KLAVIYO_API_KEY || '').trim(),
    publicKey: (process.env.KLAVIYO_PUBLIC_KEY || '').trim(),
    revision: (process.env.KLAVIYO_REVISION || DEFAULT_REVISION).trim(),
  };
}

function isConnected() { return !!cfg().key; }

function qs(query) {
  const entries = Object.entries(query || {}).filter(([, v]) => v != null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/**
 * Low-level request. When no key is configured, returns a "would_request"
 * envelope instead of calling out — so callers behave identically online/offline.
 */
// READ-ONLY POSTURE (standing hard rule for Shopify / Klaviyo / WebEngage): the
// app only ever FETCHES; it never writes/updates/deletes. This function is
// STRUCTURALLY GET-only — it takes no `method` and no `body`, always issues GET,
// and there is no code path to send POST/PUT/PATCH/DELETE to Klaviyo. The
// central read-only-egress guard (assertReadOnly) is an additional backstop.
async function request({ path, query = {}, timeoutMs = 20000 }) {
  const c = cfg();
  const url = `${API_BASE}${path}${qs(query)}`;
  if (!c.key) {
    return {
      ok: false, connected: false, not_connected: true,
      would_request: { method: 'GET', url },
      hint: 'Set KLAVIYO_API_KEY in Vercel env to execute this for real. The request shape above is what will be sent.',
    };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Backstop: confirm GET to a guarded host is allowed before it leaves.
    assertReadOnly(url, 'GET');
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        Authorization: `Klaviyo-API-Key ${c.key}`,
        revision: c.revision,
        accept: 'application/vnd.api+json',
      },
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!res.ok) {
      return { ok: false, connected: true, status: res.status, error: data && data.errors ? data.errors : data, url };
    }
    return { ok: true, connected: true, status: res.status, data };
  } catch (e) {
    return { ok: false, connected: true, error: e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message, url };
  } finally {
    clearTimeout(t);
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────
const getProfiles = (p = {}) => request({ path: '/profiles/', query: { 'page[size]': p.limit || 20, filter: p.filter, sort: p.sort } });
const getProfile  = (p = {}) => request({ path: `/profiles/${encodeURIComponent(p.id)}/` });
const getLists    = (p = {}) => request({ path: '/lists/', query: { 'page[size]': p.limit || 50 } });
const getList     = (p = {}) => request({ path: `/lists/${encodeURIComponent(p.id)}/` });
// profile_count is the live segment size (the real cohort size) — requested via
// the additional-fields param so a single read yields name + size together.
const getSegments = (p = {}) => request({ path: '/segments/', query: { 'page[size]': p.limit || 50, 'additional-fields[segment]': 'profile_count' } });
const getMetrics  = (p = {}) => request({ path: '/metrics/', query: { 'page[size]': p.limit || 50 } });
const getEvents   = (p = {}) => request({ path: '/events/', query: { 'page[size]': p.limit || 20, filter: p.filter, sort: p.sort || '-datetime' } });
const getFlows    = (p = {}) => request({ path: '/flows/', query: { 'page[size]': p.limit || 50 } });
const getTemplates = (p = {}) => request({ path: '/templates/', query: { 'page[size]': p.limit || 50 } });
// Campaigns require a channel filter in current revisions.
const getCampaigns = (p = {}) => request({
  path: '/campaigns/',
  query: { filter: p.filter || `equals(messages.channel,'${p.channel || 'email'}')`, 'page[size]': p.limit || 25, sort: p.sort || '-created_at' },
});

// ── Reporting ────────────────────────────────────────────────────────────────
// Klaviyo's values-report endpoints are POST-only. Since READ IS GET ALWAYS in
// this project (no POST, even for reports), campaign reporting is intentionally
// NOT implemented here. Campaign performance is derived from GET reads + the
// data mirrored into Supabase, never a POST to Klaviyo.

// ── Writes ─────────────────────────────────────────────────────────────────
// INTENTIONALLY NONE. Standing hard rule: this project has READ-ONLY access to
// Klaviyo — no create / update / subscribe / track / delete. The former write
// functions (createProfile, subscribeProfiles, trackEvent) were removed so the
// code has no write capability at all. The central read-only-egress guard is
// the backstop; the read-only-scoped API key is the ultimate lock.

/** Op catalog — used by the tool manifest + the chat status report. */
const OPS = {
  status:             { fn: async () => ({ ok: true, connected: isConnected(), revision: cfg().revision, ready: isConnected() ? 'live' : 'scaffolded — set KLAVIYO_API_KEY to go live' }), desc: 'Connection status of the Klaviyo integration.' },
  get_profiles:       { fn: getProfiles, desc: 'List profiles (audience members). params: {limit, filter, sort}.' },
  get_profile:        { fn: getProfile, desc: 'Get one profile by id. params: {id}.' },
  get_lists:          { fn: getLists, desc: 'List all lists. params: {limit}.' },
  get_list:           { fn: getList, desc: 'Get one list by id. params: {id}.' },
  get_segments:       { fn: getSegments, desc: 'List dynamic segments. params: {limit}.' },
  get_metrics:        { fn: getMetrics, desc: 'List tracked metrics (Placed Order, Opened Email, …). params: {limit}.' },
  get_events:         { fn: getEvents, desc: 'List recent events. params: {limit, filter, sort}.' },
  get_campaigns:      { fn: getCampaigns, desc: 'List campaigns. params: {channel:email|sms, limit, filter}.' },
  get_flows:          { fn: getFlows, desc: 'List automation flows. params: {limit}.' },
  get_templates:      { fn: getTemplates, desc: 'List email templates. params: {limit}.' },
};

/** Dispatch an op by name with params. */
async function dispatch(op, params = {}) {
  const entry = OPS[String(op || '').toLowerCase()];
  if (!entry) return { ok: false, error: `Unknown Klaviyo op '${op}'`, available: Object.keys(OPS) };
  return entry.fn(params || {});
}

module.exports = {
  isConnected, dispatch, OPS, request,
  getProfiles, getProfile, getLists, getList, getSegments, getMetrics, getEvents,
  getCampaigns, getFlows, getTemplates,
};
