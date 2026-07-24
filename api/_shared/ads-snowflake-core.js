'use strict';

/**
 * api/_shared/ads-snowflake-core.js — LIVE ads analysis from Snowflake (READ ONLY).
 *
 * Pulls Meta / Google / TikTok ad data straight from the warehouse via the
 * Snowflake SQL REST API v2, for the Costco and Target US ad accounts. Built for
 * the cohort/segmentation framework: it discovers the columns actually present in
 * each source table (INFORMATION_SCHEMA) so the dashboard can slice by any
 * available demographic/geo/behavioural dimension (age, gender, language,
 * country, region, device, placement, …) to build cohorts.
 *
 * Source tables (override each via env; DB.SCHEMA.TABLE or SCHEMA.TABLE — a
 * 2-part value is prefixed with SNOWFLAKE_DATABASE):
 *   TikTok : DATON.RAW.TIKTOK_ADS_USA        (SF_TIKTOK_ADS_TABLE)
 *   Meta   : MAPLEMONK.META_USA_ADS          (SF_META_ADS_TABLE)
 *            MAPLEMONK1.META_USA_ADS         (SF_META_ADS1_TABLE)
 *            MAPLEMONK1.META_USA_AD_CREATIVES (SF_META_CREATIVES_TABLE)
 *   Google : MAPLEMONK.GOOGLE_ADS_USA        (SF_GOOGLE_ADS_TABLE)
 *
 * READ ONLY: only SELECT / SHOW / INFORMATION_SCHEMA reads are ever issued — no
 * INSERT/UPDATE/MERGE/DELETE. Until SNOWFLAKE_* env vars are set, every op returns
 * a { connected:false, would_query } envelope with the exact SQL it would run —
 * never a fabricated number.
 *
 * Auth: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PAT (Programmatic Access
 * Token), SNOWFLAKE_WAREHOUSE, SNOWFLAKE_DATABASE, SNOWFLAKE_ROLE.
 */

function cfg() {
  return {
    account: (process.env.SNOWFLAKE_ACCOUNT || '').trim(),
    user: (process.env.SNOWFLAKE_USER || '').trim(),
    pat: (process.env.SNOWFLAKE_PAT || process.env.SNOWFLAKE_PAT_TOKEN || '').trim(),
    warehouse: (process.env.SNOWFLAKE_WAREHOUSE || '').trim(),
    database: (process.env.SNOWFLAKE_DATABASE || '').trim(),
    role: (process.env.SNOWFLAKE_ROLE || '').trim(),
  };
}
const { liveConnectorsEnabled } = require('./live-connectors.js');
// Live connectors are off by default (LIVE_CONNECTORS=on to enable). With the
// switch off, isConfigured() is false so every op returns the read-only
// would_query stub and no connection to Snowflake is ever opened.
function isConfigured() { const c = cfg(); return liveConnectorsEnabled() && !!(c.account && c.user && c.pat && c.warehouse); }

const PLATFORMS = ['meta', 'google', 'tiktok'];
const ACCOUNTS = ['target', 'costco']; // budgets: Target $1000/day, Costco $300/day (editable)

// Editable daily budget caps (USD). Overridable via env; a settings UI can also
// persist overrides later. Read-only here — no push to the ad platforms.
function budgets() {
  return {
    target: Number(process.env.ADS_BUDGET_TARGET_DAILY || 1000),
    costco: Number(process.env.ADS_BUDGET_COSTCO_DAILY || 300),
    currency: 'USD', basis: 'per day', editable: true,
    note: 'Daily budget caps for reference/alerting only. Read-only — the app never edits budgets on the ad platforms.',
  };
}

function tableRef(envKey, dflt) {
  const raw = (process.env[envKey] || dflt).trim();
  const parts = raw.split('.');
  if (parts.length >= 3) return raw.toUpperCase();           // db.schema.table given
  const db = (process.env.SNOWFLAKE_DATABASE || '').trim();  // schema.table -> prefix db
  return (db ? db + '.' + raw : raw).toUpperCase();
}
// Verified against the live warehouse (Saras/Daton + Maplemonk pipelines). Each
// is env-overridable. TikTok reports are per level; Meta/TikTok expose dedicated
// demographic/geo breakdown tables used for cohorts.
function sources() {
  return {
    tiktok: {
      account: tableRef('SF_TIKTOK_ADS_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY'),
      campaign: tableRef('SF_TIKTOK_CAMPAIGN_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY'),
      adgroup: tableRef('SF_TIKTOK_ADGROUP_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_ADGROUP_REPORT_DAILY'),
      ad: tableRef('SF_TIKTOK_AD_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_AD_REPORT_DAILY'),
      age_gender: tableRef('SF_TIKTOK_AGE_GENDER_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY_AGE_GENDER'),
      country: tableRef('SF_TIKTOK_COUNTRY_TABLE', 'DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY_COUNTRY'),
    },
    meta: {
      ads: tableRef('SF_META_ADS_TABLE', 'VAHDAM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS'),
      age_gender: tableRef('SF_META_AGE_GENDER_TABLE', 'VAHDAM_DB.MAPLEMONK1.META_USA_ADS_INSIGHTS_AGE_AND_GENDER'),
      device: tableRef('SF_META_DEVICE_TABLE', 'VAHDAM_DB.MAPLEMONK1.META_USA_ADS_INSIGHTS_PLATFORM_AND_DEVICE'),
      creatives: tableRef('SF_META_CREATIVES_TABLE', 'VAHDAM_DB.MAPLEMONK1.META_USA_AD_CREATIVES'),
    },
    google: { ads: tableRef('SF_GOOGLE_ADS_TABLE', 'VAHDAM_DB.MAPLEMONK.GOOGLE_ADS_USA') },
  };
}
function primaryTable(platform, level) {
  const s = sources();
  if (platform === 'meta') return s.meta.ads;
  if (platform === 'google') return s.google.ads;
  if (platform === 'tiktok') return s.tiktok[String(level || 'campaign').toLowerCase()] || s.tiktok.campaign;
  return null;
}
// Dedicated demographic/geo breakdown table for a (platform, dimension) — the
// real source of cohort splits (base insight tables carry targeting settings,
// not delivery breakdowns).
function cohortTable(platform, dimension) {
  const s = sources();
  if (platform === 'meta') {
    if (dimension === 'age' || dimension === 'gender') return s.meta.age_gender;
    if (dimension === 'device' || dimension === 'placement') return s.meta.device;
    return null;
  }
  if (platform === 'tiktok') {
    if (dimension === 'age' || dimension === 'gender') return s.tiktok.age_gender;
    if (dimension === 'country' || dimension === 'region') return s.tiktok.country;
    return null;
  }
  return null;
}
// Candidate column names for cohort dimensions + core measures (case-insensitive;
// resolved against the real column list from describe()).
const DIMENSION_CANDIDATES = {
  age: ['age', 'age_range', 'age_group', 'age_bucket'],
  gender: ['gender', 'sex'],
  language: ['language', 'locale', 'lang'],
  country: ['country', 'country_code', 'geo_country', 'country_id'],
  region: ['region', 'state', 'province', 'dma', 'geo_region'],
  city: ['city', 'geo_city'],
  device: ['device', 'device_platform', 'platform_device', 'impression_device'],
  placement: ['placement', 'publisher_platform', 'network', 'ad_network_type'],
};
const DATE_CANDIDATES = ['date_start', 'stat_time_day', 'date', 'day', 'stat_date', 'report_date', 'date_stop', 'segments_date', 'event_date'];
const ACCOUNT_CANDIDATES = ['account_name', 'account', 'advertiser_name', 'advertiser', 'customer_name', 'ad_account_name'];

// ── Snowflake SQL REST API v2 (read-only) ─────────────────────────────────────
function sqlApiUrl(c) {
  const host = /snowflakecomputing\.com$/i.test(c.account) ? c.account : `${c.account}.snowflakecomputing.com`;
  return `https://${host}/api/v2/statements`;
}
const WRITE_RE = /\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|call|copy)\b/i;
async function runStatement(sql, timeoutMs = 45000) {
  if (WRITE_RE.test(sql)) throw new Error('READ-ONLY: only SELECT/SHOW/DESCRIBE statements are permitted against Snowflake.');
  const c = cfg();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(sqlApiUrl(c), {
      method: 'POST', signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${c.pat}`,
        'Content-Type': 'application/json', Accept: 'application/json',
        'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
      },
      body: JSON.stringify({ statement: sql, warehouse: c.warehouse, database: c.database || undefined, role: c.role || undefined, timeout: 60 }),
    });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    if (!res.ok) { const e = new Error(`snowflake ${res.status}: ${(json && (json.message || json.code)) || text || res.statusText}`); e.status = res.status; throw e; }
    const cols = ((json && json.resultSetMetaData && json.resultSetMetaData.rowType) || []).map((r) => String(r.name || '').toLowerCase());
    const rows = ((json && json.data) || []).map((row) => { const o = {}; cols.forEach((n, i) => { o[n] = row[i]; }); return o; });
    return { columns: cols, rows };
  } finally { clearTimeout(timer); }
}

function notConnected(sql, extra) {
  const gated = !liveConnectorsEnabled();
  return Object.assign({ ok: false, connected: false, not_connected: true, live_connectors_disabled: gated, would_query: sql,
    hint: gated
      ? 'Live connectors are disabled (LIVE_CONNECTORS is off). The app is running on cached/snapshot data and will not query Snowflake. Set LIVE_CONNECTORS=on (plus the SNOWFLAKE_* env vars) to run this read-only query for real. The SQL above is exactly what would be sent.'
      : 'Set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PAT, SNOWFLAKE_WAREHOUSE (+ SNOWFLAKE_DATABASE/ROLE) in Vercel env to run this read-only query for real. The SQL above is exactly what will be sent.' }, extra || {});
}

function splitTable(fqn) {
  const p = fqn.split('.');
  return p.length >= 3 ? { db: p[0], schema: p[1], table: p.slice(2).join('_') } : { db: cfg().database, schema: p[0], table: p[1] };
}

// Introspect the columns of any table (defaults to the platform's primary table
// for the given level). Auto-detects date / account / cohort-dimension columns.
async function describe({ platform = 'meta', level, table: tblOverride } = {}) {
  const t = tblOverride || primaryTable(platform, level);
  if (!t) return { ok: false, error: `Unknown platform '${platform}'.` };
  const { db, schema, table } = splitTable(t);
  const sql = `select column_name, data_type from ${db}.information_schema.columns where table_schema = '${schema}' and table_name = '${table}' order by ordinal_position`;
  if (!isConfigured()) return notConnected(sql, { platform, table: t });
  const r = await runStatement(sql);
  const cols = r.rows.map((x) => ({ name: String(x.column_name || '').toLowerCase(), type: x.data_type }));
  const names = cols.map((c) => c.name);
  const found = (cands) => cands.find((c) => names.includes(c)) || null;
  const dimensions = Object.fromEntries(Object.entries(DIMENSION_CANDIDATES).map(([k, v]) => [k, found(v)]));
  return {
    ok: true, connected: true, platform, table: t, source: 'snowflake',
    columns: cols,
    detected: { date: found(DATE_CANDIDATES), account: found(ACCOUNT_CANDIDATES), dimensions },
  };
}

function accountFilter(col, account) {
  if (!account || !col) return '';
  return ` and lower(${col}) like '%${String(account).toLowerCase().replace(/'/g, '')}%'`;
}
function dateFilter(col, since, until) {
  if (!col || !since || !until) return '';
  return ` and ${col} between '${since}' and '${until}'`;
}

// Recent rows (all available metrics) for a platform, optionally scoped to an
// account (target|costco) and date range. "SELECT *" so every metric the table
// carries is returned — nothing is dropped or invented.
async function metrics({ platform = 'meta', account, since, until, level, limit = 500 } = {}) {
  const t = primaryTable(platform, level);
  if (!t) return { ok: false, error: `Unknown platform '${platform}'.` };
  const acctCol = ACCOUNT_CANDIDATES[0], dateCol = DATE_CANDIDATES[0];
  const where = `where 1=1${accountFilter(acctCol, account)}${dateFilter(dateCol, since, until)}`;
  const sql = `select * from ${t} ${where} order by ${dateCol} desc limit ${Math.min(+limit || 500, 5000)}`;
  if (!isConfigured()) return notConnected(sql, { platform, account: account || null, level: level || null, table: t });
  const r = await runStatement(sql);
  return { ok: true, connected: true, platform, level: level || null, account: account || null, table: t, source: 'snowflake', columns: r.columns, rows: r.rows };
}

// Aggregate a measure by a cohort dimension (age/gender/country/…) — the raw
// material for building demographic / geo / behavioural cohorts. Resolves the
// real column names from describe() first so it adapts to each table.
async function cohort({ platform = 'meta', dimension = 'country', measure = 'spend', account, since, until, level } = {}) {
  // Prefer the dedicated demographic/geo breakdown table for this dimension;
  // fall back to the primary table (e.g. device/placement columns present there).
  const t = cohortTable(platform, dimension) || primaryTable(platform, level);
  if (!t) return { ok: false, error: `Unknown platform '${platform}'.` };
  const buildSql = (dimCol, dateCol, acctCol, measureCol) => {
    const where = `where 1=1${accountFilter(acctCol, account)}${dateFilter(dateCol, since, until)}`;
    return `select ${dimCol} as cohort, sum(${measureCol}) as value, count(*) as rows
            from ${t} ${where} group by ${dimCol} order by value desc nulls last limit 200`;
  };
  if (!isConfigured()) {
    const guessDim = (DIMENSION_CANDIDATES[dimension] || [dimension])[0];
    return notConnected(buildSql(guessDim, DATE_CANDIDATES[0], ACCOUNT_CANDIDATES[0], measure), { platform, dimension, measure, account: account || null, table: t });
  }
  const d = await describe({ platform, table: t });
  const dimCol = d.detected && d.detected.dimensions && d.detected.dimensions[dimension];
  if (!dimCol) return { ok: false, connected: true, platform, dimension, table: t, error: `Dimension '${dimension}' is not a column in ${t}. Available dimensions: ${Object.entries((d.detected || {}).dimensions || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none detected'}.` };
  const measureCol = (d.columns || []).map((c) => c.name).includes(String(measure).toLowerCase()) ? measure : 'spend';
  const sql = buildSql(dimCol, d.detected.date, d.detected.account, measureCol);
  const r = await runStatement(sql);
  return { ok: true, connected: true, platform, dimension, dimension_column: dimCol, measure: measureCol, account: account || null, table: t, source: 'snowflake', rows: r.rows };
}

function status() {
  return {
    ok: true, configured: isConfigured(), source: 'snowflake',
    platforms: PLATFORMS, accounts: ACCOUNTS, budgets: budgets(),
    tables: sources(),
    live_connectors_disabled: !liveConnectorsEnabled(),
    note: isConfigured()
      ? 'Snowflake connected — live ad data from the configured tables (read-only).'
      : (!liveConnectorsEnabled()
        ? 'Live connectors are disabled (LIVE_CONNECTORS is off) — running on cached/snapshot ad data. No connection to Snowflake is made. Set LIVE_CONNECTORS=on plus SNOWFLAKE_* env vars to pull live data. No figures are fabricated.'
        : 'Snowflake not configured. Set SNOWFLAKE_* env vars to pull live ad data; every op returns the exact read-only SQL it will run until then. No figures are fabricated.'),
  };
}

// Live connection test — runs a trivial read (SELECT 1) so the UI can verify the
// warehouse is actually REACHABLE with the configured credentials, not merely
// that env vars are present. Reports which env vars are missing when unconfigured,
// and the exact upstream error (e.g. 401 = bad/expired PAT) when a request fails,
// so the connection can be diagnosed without guesswork. Read-only.
async function ping() {
  const c = cfg();
  const present = { account: !!c.account, user: !!c.user, pat: !!c.pat, warehouse: !!c.warehouse, database: !!c.database, role: !!c.role };
  const missing = ['account', 'user', 'pat', 'warehouse'].filter((k) => !present[k]).map((k) => `SNOWFLAKE_${k.toUpperCase()}`);
  if (!liveConnectorsEnabled()) {
    return { ok: false, connected: false, configured: false, reachable: false, live_connectors_disabled: true, present,
      hint: 'Live connectors are disabled (LIVE_CONNECTORS is off). The app runs on cached/snapshot data and will not reach Snowflake. Set LIVE_CONNECTORS=on (plus the SNOWFLAKE_* env vars) to test a live connection.' };
  }
  if (!isConfigured()) {
    return { ok: false, connected: false, configured: false, reachable: false, present, missing,
      hint: `Set ${missing.join(', ')} in Vercel (a read-only PAT for SNOWFLAKE_PAT). The account is the org-account identifier, e.g. UXDEIHW-MO06981.` };
  }
  const started = Date.now();
  try {
    const r = await runStatement('select 1 as ok', 20000);
    const ok = Array.isArray(r.rows) && r.rows.length > 0;
    return { ok, connected: true, configured: true, reachable: ok, present,
      latency_ms: Date.now() - started, account_host: sqlApiUrl(c).replace(/^https:\/\//, '').replace(/\/api.*/, ''),
      warehouse: c.warehouse, database: c.database || null, role: c.role || null,
      note: 'Live SELECT 1 succeeded — the warehouse is reachable read-only with the configured credentials.' };
  } catch (e) {
    return { ok: false, connected: true, configured: true, reachable: false, present,
      latency_ms: Date.now() - started, status: e.status || null, error: e.message || String(e),
      hint: e.status === 401 || e.status === 403
        ? 'Credentials rejected: check SNOWFLAKE_PAT (a valid, non-expired Programmatic Access Token) and SNOWFLAKE_USER, and that the PAT/role can use the warehouse.'
        : 'Configured but the request failed. Verify SNOWFLAKE_ACCOUNT (org-account id, e.g. UXDEIHW-MO06981), SNOWFLAKE_WAREHOUSE and network access.' };
  }
}

module.exports = {
  status, ping, describe, metrics, cohort, budgets, runStatement,
  isConfigured, PLATFORMS, ACCOUNTS, DIMENSION_CANDIDATES, sources,
};
