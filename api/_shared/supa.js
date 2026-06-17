'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Tiny Supabase PostgREST client (no SDK — keeps the serverless bundle small).
// Shared by the Competitive-Intelligence collectors and the Smart-Brain engines.
// Service-role key preferred (writes); falls back to anon. NOT a function file
// (under api/_shared/ → excluded from the Hobby 12-function cap).
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

function env() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
           || process.env.SUPABASE_SERVICE_KEY
           || process.env.SUPABASE_ANON_KEY
           || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_*_KEY missing');
  return { url: url.replace(/\/$/, ''), key };
}

function headers(extra) {
  const { key } = env();
  return Object.assign({
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  }, extra || {});
}

function sha1(s) { return crypto.createHash('sha1').update(String(s == null ? '' : s)).digest('hex'); }

// Stable hash over an object (key-sorted) — used for content-hash dedup.
function hashObj(obj) {
  const norm = JSON.stringify(obj, Object.keys(obj || {}).sort());
  return sha1(norm);
}

async function rest(path, { method = 'GET', body, prefer, query } = {}) {
  const { url } = env();
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const res = await fetch(`${url}/rest/v1/${path}${qs}`, {
    method,
    headers: headers(prefer ? { Prefer: prefer } : null),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const msg = (json && json.message) || text || res.statusText;
    const err = new Error(`supabase ${method} ${path} → ${res.status}: ${msg}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}

// SELECT with PostgREST filters. opts: { select, order, limit, ...eqFilters }
async function select(table, opts = {}) {
  const query = {};
  if (opts.select) query.select = opts.select;
  if (opts.order)  query.order  = opts.order;
  if (opts.limit)  query.limit  = String(opts.limit);
  for (const [k, v] of Object.entries(opts.filters || {})) query[k] = v; // e.g. {brand_id:'eq.3'}
  return rest(table, { query });
}

async function insert(table, rows, { upsertOn } = {}) {
  const prefer = upsertOn
    ? `return=representation,resolution=merge-duplicates`
    : 'return=representation';
  const query = upsertOn ? { on_conflict: upsertOn } : undefined;
  return rest(table, { method: 'POST', body: rows, prefer, query });
}

async function update(table, patch, filters) {
  return rest(table, { method: 'PATCH', body: patch, prefer: 'return=representation', query: filters });
}

module.exports = { env, headers, rest, select, insert, update, sha1, hashObj };
