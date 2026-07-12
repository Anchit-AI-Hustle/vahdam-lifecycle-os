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
// READ-ONLY POSTURE (standing rule for Shopify / Klaviyo / WebEngage): the app
// only ever FETCHES information and must put no write load on these platforms.
// Any non-GET call is blocked here before it leaves the process — it is never
// sent — so create/subscribe/track can exist in the manifest but can never
// mutate the account. Set KLAVIYO_ALLOW_WRITES=1 to intentionally opt back in.
const READ_ONLY = process.env.KLAVIYO_ALLOW_WRITES !== '1';

async function request({ method = 'GET', path, query = {}, body = null, timeoutMs = 20000 }) {
  const c = cfg();
  const url = `${API_BASE}${path}${qs(query)}`;
  if (READ_ONLY && String(method).toUpperCase() !== 'GET') {
    return {
      ok: false, connected: !!c.key, read_only_blocked: true,
      would_request: { method, url, body: body || undefined },
      note: 'Read-only mode: this write was blocked and NOT sent to Klaviyo (zero write load). Set KLAVIYO_ALLOW_WRITES=1 to enable writes.',
    };
  }
  if (!c.key) {
    return {
      ok: false, connected: false, not_connected: true,
      would_request: { method, url, body: body || undefined },
      hint: 'Set KLAVIYO_API_KEY in Vercel env to execute this for real. The request shape above is what will be sent.',
    };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Klaviyo-API-Key ${c.key}`,
        revision: c.revision,
        accept: 'application/vnd.api+json',
        ...(body ? { 'content-type': 'application/vnd.api+json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
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
const campaignReport = (p = {}) => request({
  method: 'POST', path: '/campaign-values-reports/',
  body: {
    data: {
      type: 'campaign-values-report',
      attributes: {
        timeframe: p.timeframe ? { key: p.timeframe } : { key: 'last_30_days' },
        statistics: p.statistics || ['open_rate', 'click_rate', 'conversion_rate', 'recipients', 'revenue_per_recipient'],
        conversion_metric_id: p.conversion_metric_id || undefined,
        filter: p.filter || undefined,
      },
    },
  },
});

// ── Writes ─────────────────────────────────────────────────────────────────
const createProfile = (p = {}) => request({
  method: 'POST', path: '/profiles/',
  body: { data: { type: 'profile', attributes: { email: p.email, phone_number: p.phone_number, first_name: p.first_name, last_name: p.last_name, properties: p.properties || {} } } },
});
// Subscribe profiles to a list (double/single opt-in handled by list settings).
const subscribeProfiles = (p = {}) => request({
  method: 'POST', path: '/profile-subscription-bulk-create-jobs/',
  body: {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: { data: (p.emails || []).map((email) => ({ type: 'profile', attributes: { email, subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } } } })) },
      },
      relationships: p.list_id ? { list: { data: { type: 'list', id: p.list_id } } } : undefined,
    },
  },
});
const trackEvent = (p = {}) => request({
  method: 'POST', path: '/events/',
  body: {
    data: {
      type: 'event',
      attributes: {
        properties: p.properties || {},
        metric: { data: { type: 'metric', attributes: { name: p.metric || 'Custom Event' } } },
        profile: { data: { type: 'profile', attributes: { email: p.email } } },
        value: p.value,
      },
    },
  },
});

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
  campaign_report:    { fn: campaignReport, desc: 'Campaign performance report. params: {timeframe, statistics[], conversion_metric_id}.' },
  create_profile:     { fn: createProfile, desc: 'Create/identify a profile. params: {email, phone_number, first_name, last_name, properties}.' },
  subscribe_profiles: { fn: subscribeProfiles, desc: 'Subscribe emails to a list. params: {list_id, emails[]}.' },
  track_event:        { fn: trackEvent, desc: 'Track a custom event for a profile. params: {metric, email, properties, value}.' },
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
  getCampaigns, getFlows, getTemplates, campaignReport, createProfile, subscribeProfiles, trackEvent,
};
