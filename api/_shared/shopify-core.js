'use strict';

/**
 * shopify-core.js — LIVE, READ-ONLY Shopify Admin reads.
 *
 * Until now the only Admin API call anywhere in the project was the
 * `shop.json` liveness probe in connectors-health: the health page could say
 * "Shopify is live" while nothing in the app could actually read an order. The
 * store's real numbers came from CSV exports (market-analytics) and public
 * storefront scraping, both of which are real but neither of which is live.
 * This module is the missing live path.
 *
 * READ-ONLY by construction, three ways over:
 *   1. every request goes through guardedFetch, which throws on any verb other
 *      than GET/HEAD aimed at a Shopify host (read-only-egress.js),
 *   2. no mutating endpoint is implemented here at all, and
 *   3. the credential itself should be a read-scoped Admin token
 *      (read_orders, read_products, read_customers, read_inventory).
 *
 * Gated on the LIVE_CONNECTORS kill switch like every other outbound connector,
 * so the documented "default is OFF, never opens a live external connection"
 * contract holds for Shopify too.
 *
 * Never fabricates. With no credential (or the switch off) every op returns a
 * structured { connected:false, would_request } envelope naming the exact HTTP
 * request that would have run, so callers can render an honest empty state.
 *
 * Env (append _US / _UK / _IN for a market-specific store):
 *   SHOPIFY_STORE_DOMAIN   e.g. vahdam.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN    read-scoped Admin API access token
 *   SHOPIFY_API_VERSION    optional, defaults below
 */

const { guardedFetch } = require('./read-only-egress.js');
const { liveConnectorsEnabled } = require('./live-connectors.js');

const API_VERSION = String(process.env.SHOPIFY_API_VERSION || '2026-04').trim();
const PAGE_MAX = 250; // Shopify's hard per-page ceiling

function normMarket(m) {
  const s = String(m || 'US').trim().toUpperCase();
  if (['US', 'USA', 'UNITED STATES'].includes(s)) return 'US';
  if (['UK', 'GB', 'UNITED KINGDOM', 'BRITAIN'].includes(s)) return 'UK';
  if (['IN', 'IND', 'INDIA'].includes(s)) return 'IN';
  return s;
}
function envFor(base, market) {
  const mk = normMarket(market);
  return String(process.env[`${base}_${mk}`] || process.env[base] || '').trim();
}
function cfg(market) {
  return {
    domain: envFor('SHOPIFY_STORE_DOMAIN', market).replace(/^https?:\/\//, '').replace(/\/$/, ''),
    token: envFor('SHOPIFY_ADMIN_TOKEN', market),
    version: API_VERSION,
  };
}
function isConnected(market) {
  const c = cfg(market);
  return liveConnectorsEnabled() && !!(c.domain && c.token);
}

function qs(obj) {
  return Object.entries(obj || {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
function urlFor(market, path, query) {
  const c = cfg(market);
  const host = c.domain || '{SHOPIFY_STORE_DOMAIN}';
  const q = qs(query);
  return `https://${host}/admin/api/${c.version}/${path}${q ? `?${q}` : ''}`;
}

// The blocker is reported per-reason so the UI can tell "no credential" apart
// from "credential present but the kill switch is off" — they need different fixes.
function blockerFor(market) {
  const c = cfg(market);
  if (!liveConnectorsEnabled()) return 'Live connectors are disabled — set LIVE_CONNECTORS=on to allow outbound reads.';
  const missing = [];
  if (!c.domain) missing.push('SHOPIFY_STORE_DOMAIN');
  if (!c.token) missing.push('SHOPIFY_ADMIN_TOKEN');
  return missing.length
    ? `Set ${missing.join(' + ')} in Vercel env (append _${normMarket(market)} for a market-specific store). The token must be read-scoped: read_orders, read_products, read_customers, read_inventory.`
    : null;
}
function notConnected(market, op, path, query) {
  return {
    ok: false, connected: false, not_connected: true,
    platform: 'shopify', market: normMarket(market), op,
    would_request: { method: 'GET', url: urlFor(market, path, query), headers: { 'X-Shopify-Access-Token': 'REDACTED' } },
    blocker: blockerFor(market),
    hint: 'No store figure is fabricated. The app falls back to the CSV market exports and public storefront data, both of which are labelled as not-live.',
  };
}

async function read(market, op, path, query = {}, timeoutMs = 20000) {
  if (!isConnected(market)) return notConnected(market, op, path, query);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const url = urlFor(market, path, query);
  try {
    const res = await guardedFetch(url, {
      signal: ctrl.signal, cache: 'no-store',
      headers: { 'X-Shopify-Access-Token': cfg(market).token, Accept: 'application/json' },
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text.slice(0, 400) }; }
    if (!res.ok) {
      return {
        ok: false, connected: true, platform: 'shopify', market: normMarket(market), op,
        status: res.status,
        error: (json && (json.errors || json.error)) || `shopify ${res.status}`,
        // A 401/403 here almost always means the token lacks the read scope for
        // this resource rather than being wholly invalid — say so, since the fix differs.
        hint: (res.status === 401 || res.status === 403)
          ? 'Token rejected for this resource. Check the read scope it was granted (read_orders / read_products / read_customers / read_inventory).'
          : null,
      };
    }
    return {
      ok: true, connected: true, platform: 'shopify', market: normMarket(market), op,
      source: `shopify_admin_${cfg(market).version}`, fetched_at: new Date().toISOString(),
      data: json,
    };
  } catch (e) {
    // A read-only violation must surface as itself, not as a generic fetch failure.
    if (e && e.read_only_blocked) throw e;
    return { ok: false, connected: true, platform: 'shopify', market: normMarket(market), op, error: e.message };
  } finally { clearTimeout(timer); }
}

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
const round = (v, n = 2) => Math.round(num(v) * 10 ** n) / 10 ** n;
const clamp = (v, d, max = PAGE_MAX) => Math.min(Math.max(parseInt(v, 10) || d, 1), max);
function isoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString(); }

// ── Ops ─────────────────────────────────────────────────────────────────────
async function shop({ market } = {}) { return read(market, 'shop', 'shop.json'); }

async function orders({ market, days = 30, limit = PAGE_MAX, status = 'any' } = {}) {
  return read(market, 'orders', 'orders.json', {
    status, limit: clamp(limit, PAGE_MAX), created_at_min: isoDaysAgo(clamp(days, 30, 365)),
    fields: 'id,name,created_at,total_price,currency,financial_status,fulfillment_status,customer,line_items,discount_codes',
  });
}
async function products({ market, limit = PAGE_MAX } = {}) {
  return read(market, 'products', 'products.json', {
    limit: clamp(limit, PAGE_MAX), fields: 'id,title,handle,status,product_type,tags,variants,created_at,updated_at',
  });
}
async function customers({ market, limit = PAGE_MAX } = {}) {
  return read(market, 'customers', 'customers.json', {
    limit: clamp(limit, PAGE_MAX), fields: 'id,created_at,orders_count,total_spent,state,tags,last_order_id',
  });
}
async function inventory({ market, limit = PAGE_MAX } = {}) {
  const locs = await read(market, 'locations', 'locations.json', { fields: 'id,name,active' });
  if (!locs.ok) return locs;
  const ids = ((locs.data && locs.data.locations) || []).filter((l) => l.active !== false).map((l) => l.id);
  if (!ids.length) return { ok: true, connected: true, platform: 'shopify', market: normMarket(market), op: 'inventory', data: { inventory_levels: [] }, note: 'No active locations returned.' };
  return read(market, 'inventory', 'inventory_levels.json', { location_ids: ids.join(','), limit: clamp(limit, PAGE_MAX) });
}

/**
 * summary() — the rollup the dashboards actually want: real revenue, order
 * count, AOV and returning-customer share over a window, computed from live
 * orders rather than from an export. Derived only from figures Shopify
 * returned; nothing is modelled or estimated.
 */
async function summary({ market, days = 30 } = {}) {
  const o = await orders({ market, days });
  if (!o.ok) return Object.assign({}, o, { op: 'summary' });
  const rows = (o.data && o.data.orders) || [];
  const revenue = rows.reduce((s, r) => s + num(r.total_price), 0);
  // orders_count > 1 marks a repeat buyer at the time the order was placed.
  const returning = rows.filter((r) => r.customer && num(r.customer.orders_count) > 1).length;
  const currency = (rows.find((r) => r.currency) || {}).currency || null;
  return {
    ok: true, connected: true, platform: 'shopify', market: normMarket(market), op: 'summary',
    source: o.source, fetched_at: o.fetched_at, window_days: clamp(days, 30, 365), currency,
    orders: rows.length, revenue: round(revenue),
    aov: rows.length ? round(revenue / rows.length) : null,
    returning_orders: returning,
    returning_rate_pct: rows.length ? round(returning / rows.length * 100, 1) : null,
    note: rows.length === PAGE_MAX
      ? `Exactly ${PAGE_MAX} orders returned — this is one page, so the window is truncated and these totals are a floor, not the full period.`
      : null,
  };
}

function status(market) {
  const c = cfg(market);
  return {
    ok: true, platform: 'shopify', market: normMarket(market),
    connected: isConnected(market),
    domain_set: !!c.domain, token_set: !!c.token,
    live_connectors: liveConnectorsEnabled(), api_version: c.version,
    blocker: blockerFor(market),
    read_only: true,
    note: 'Read-only: only GET is permitted to Shopify hosts (read-only-egress.js). No mutation endpoint is implemented.',
  };
}

const OPS = {
  status: async (p) => status(p.market),
  shop, orders, products, customers, inventory, summary,
};

async function dispatch(op, params = {}) {
  const fn = OPS[String(op || 'summary').toLowerCase()];
  if (!fn) return { ok: false, error: `Unknown Shopify op '${op}'`, available: Object.keys(OPS) };
  return fn(params || {});
}

module.exports = {
  dispatch, OPS, status, isConnected, cfg, normMarket,
  shop, orders, products, customers, inventory, summary,
};
