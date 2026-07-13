'use strict';
/**
 * api/_shared/market-analytics.js — server reader for the REAL Shopify-export
 * market analytics (the exact numbers the /analytics dashboard shows).
 *
 * Reads the build-generated JSON (data/analytics/market-data.json). A required
 * JSON is bundled reliably by Vercel; a runtime fs read of data/market/*.csv is
 * NOT trace-included, so we go through the JSON. Regenerate with
 * `node scripts/build-market-analytics.js` whenever the CSVs change.
 *
 * Powers ChaiGPT's `market_performance` tool so it answers product / revenue /
 * top-seller / performance questions from real data (previously it hit empty
 * Supabase order tables and returned $0). Zero fabrication: every figure is a
 * straight export total; the current-month number is a clearly-labelled
 * run-rate projection, never presented as an actual.
 */

let DATA = null;
function data() {
  if (DATA) return DATA;
  try { DATA = require('../../data/analytics/market-data.json'); }
  catch (_) { DATA = { currency: {}, markets: {} }; }
  return DATA;
}

// Only US + UK exports exist; everything else has no order-level export yet.
function normMarket(m) { return String(m || 'US').toUpperCase().startsWith('UK') ? 'UK' : 'US'; }
function cur(market) { const d = data(); return (d.currency && d.currency[normMarket(market)]) || (normMarket(market) === 'UK' ? 'GBP' : 'USD'); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function monthLabel(m) { return String(m || '').slice(0, 7); }         // 2026-07-01 -> 2026-07
function pctChange(a, b) { return b ? Math.round(((a - b) / b) * 1000) / 10 : null; }

// Run-rate projection for the current calendar month — ONLY when the latest
// export month IS the current month (otherwise null; we never project a stale
// month). Basis is stated so it reads as an estimate, not a fact.
function projectCurrentMonth(monthly) {
  if (!monthly || !monthly.length) return null;
  const last = monthly[monthly.length - 1];
  const lbl = monthLabel(last.month);
  const now = new Date();
  if (lbl !== now.toISOString().slice(0, 7)) return null;
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = Math.max(1, now.getUTCDate());
  const f = dim / elapsed;
  return {
    month: lbl, mtd_sales: round2(last.sales), mtd_orders: last.orders,
    days_elapsed: elapsed, days_in_month: dim,
    projected_sales: round2(last.sales * f), projected_orders: Math.round(last.orders * f),
    basis: `month-to-date ${round2(last.sales)} ÷ ${elapsed} elapsed days × ${dim} days in month`,
  };
}

/** Rich real performance snapshot for a market — the payload ChaiGPT reasons over. */
function performance(market) {
  const mk = normMarket(market);
  const m = (data().markets || {})[mk];
  if (!m) return { ok: false, market: mk, error: `No market analytics for ${mk} — only US and UK order exports exist.` };
  const monthly = m.monthly || [];
  const topRev = (m.top_products || []).slice(0, 10);
  const topQty = (m.top_by_qty || m.top_products || []).slice().sort((a, b) => (b.quantity || 0) - (a.quantity || 0)).slice(0, 10);
  const mom = monthly.length >= 2 ? (() => {
    const a = monthly[monthly.length - 1], b = monthly[monthly.length - 2];
    return { latest: monthLabel(a.month), latest_sales: round2(a.sales), prev: monthLabel(b.month), prev_sales: round2(b.sales), change_pct: pctChange(a.sales, b.sales), note: 'latest month is partial — compare with the run-rate projection, not the raw month total' };
  })() : null;
  return {
    ok: true, market: mk, currency: cur(mk),
    window_note: `Real Shopify export${monthly.length ? ` covering ${monthLabel(monthly[0].month)} → ${monthLabel(monthly[monthly.length - 1].month)}` : ''}. The latest month is partial (in progress).`,
    summary: m.summary || null,
    top_products_by_revenue: topRev,
    top_products_by_units: topQty,
    monthly_trend: monthly.map((r) => ({ month: monthLabel(r.month), sales: round2(r.sales), orders: r.orders, aov: round2(r.aov) })),
    month_on_month: mom,
    current_month_projection: projectCurrentMonth(monthly),
    product_types: (m.product_types || []).slice(0, 12),
    channels: m.channels || [],
    discount_split: m.discount || [],
    returning_customer_rate: m.summary ? round2((m.summary.returning_rate || 0) * 100) : null,
  };
}

// Market-level month-on-month dips (real). Product-level dips are NOT possible
// from these exports (top_products is a trailing TOTAL, not a monthly series);
// that needs a per-product monthly feed, flagged rather than fabricated.
function marketDips(market, dropPct = 0.15) {
  const p = performance(market);
  if (!p.ok || !p.month_on_month || p.month_on_month.change_pct == null) return [];
  const c = p.month_on_month.change_pct;
  if (c <= -dropPct * 100) return [{ market: p.market, metric: 'Revenue (month-on-month)', change_pct: c, latest: p.month_on_month.latest, note: 'latest month is partial; confirm against run-rate' }];
  return [];
}

module.exports = { performance, marketDips, data, normMarket, cur };
