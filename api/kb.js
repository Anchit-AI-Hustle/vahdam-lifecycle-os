'use strict';

/**
 * /api/kb — single-function router for the Knowledge Base.
 *
 * Hobby plan caps Serverless Functions at 12. The five KB capabilities
 * (ingest, list, top-emails, brands, classify-emails) used to live as
 * separate files; this router consolidates them so we stay under the limit
 * without losing any functionality.
 *
 * Dispatch table — selected via ?action=<name>:
 *   action=ingest             POST   { url, tags?, added_by? }
 *                             → fetches page, LLM-summarizes, upserts into kb_knowledge
 *   action=list               GET    ?limit=200&status=summarized
 *                             → returns kb_knowledge rows
 *   action=top-emails         GET    ?limit=200&market=US&order=open|rev
 *                             POST   { ...row }              (single insert)
 *                             POST   { items: [...] }        (bulk, max 200)
 *   action=brands             GET    ?category=tea&region=US&active=true
 *                             POST   { name, category, region, ... }   (upsert)
 *                             PATCH  ?id=<id>   { ...patch }
 *                             DELETE ?id=<id>   (soft) | &hard=1 (truly drop)
 *   action=classify-emails    GET    ?summary=1 | ?limit=200
 *                             POST   { reclassify?: true }
 *                             → heuristic format classifier over captured competitor emails
 *
 * Each action's logic is inline below — no shared LLM helper imports past
 * the actual ingest path. This keeps the bundle small.
 */

const crypto = require('crypto');

// ── Shared: supabase config ────────────────────────────────────────────────
function supaEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
           || process.env.SUPABASE_SERVICE_KEY
           || process.env.SUPABASE_ANON_KEY
           || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_*_KEY missing');
  return { url: url.replace(/\/$/, ''), key };
}
function sbHeaders(env) {
  return { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' };
}
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// ── Shared: URL helpers (used by ingest + classify) ────────────────────────
function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    const TRACK = /^(utm_|fbclid$|gclid$|mc_|_hsenc$|_hsmi$|hsCtaTracking$|ref$|source$)/i;
    [...u.searchParams.keys()].forEach((k) => { if (TRACK.test(k)) u.searchParams.delete(k); });
    if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch { return raw; }
}
function urlHash(url) { return crypto.createHash('sha1').update(canonicalUrl(url)).digest('hex'); }

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = (req.query?.action || '').toLowerCase();
  let env;
  try { env = supaEnv(); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

  // ── 1. INGEST — fetch a URL, LLM-summarize, store ───────────────────────
  if (action === 'ingest') {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
    return ingest(req, res, env);
  }
  // ── 2. LIST — read kb_knowledge ─────────────────────────────────────────
  if (action === 'list') {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });
    return listKnowledge(req, res, env);
  }
  // ── 3. TOP-EMAILS ───────────────────────────────────────────────────────
  if (action === 'top-emails' || action === 'topemails') {
    return topEmails(req, res, env);
  }
  // ── 4. BRANDS ───────────────────────────────────────────────────────────
  if (action === 'brands') {
    return brands(req, res, env);
  }
  // ── 5. CLASSIFY-EMAILS ──────────────────────────────────────────────────
  if (action === 'classify-emails' || action === 'classify') {
    return classifyEmails(req, res, env);
  }

  // ── Smart-Brain KB: own historical campaign library (DB-linked) ──
  // The linked backend DB pushes (or a sync job pulls) past campaigns here so
  // the brain knows what hooks/graphics/angles/formats worked. Own-data ONLY —
  // never mixed with competitor ci_* rows.
  //   action=index-campaigns  POST { items:[{source_db_id,name,channel,...}] }
  //   action=kb-campaigns      GET  ?channel=&cleared=true&limit=
  if (action === 'index-campaigns') {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
    return indexCampaigns(req, res, env);
  }
  if (action === 'kb-campaigns') {
    return listKbCampaigns(req, res, env);
  }

  return res.status(400).json({ ok: false, error: 'Unknown action. Use ?action=ingest|list|top-emails|brands|classify-emails|index-campaigns|kb-campaigns' });
};

// ═══════════════════════════════════════════════════════════════════════════
// SMART-BRAIN KB — own historical campaign library
// ═══════════════════════════════════════════════════════════════════════════
async function indexCampaigns(req, res, env) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const items = Array.isArray(body?.items) ? body.items : (body ? [body] : []);
  if (!items.length) return res.status(400).json({ ok: false, error: 'items[] required' });
  const rows = items.map((c) => ({
    source_db_id: c.source_db_id || c.id || null,
    name: c.name || null, channel: c.channel || null, campaign_type: c.campaign_type || null,
    market: c.market || null, launched_at: c.launched_at || null,
    product_focus: c.product_focus || null, cohort_key: c.cohort_key || null,
    assets: c.assets || [], metrics: c.metrics || {},
    performance_score: c.performance_score ?? null, tags: c.tags || null,
    indexed_at: new Date().toISOString()
  }));
  const headers = sbHeaders(env);
  const r = await fetch(`${env.url}/rest/v1/kb_campaigns?on_conflict=source_db_id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(rows)
  });
  const text = await r.text();
  if (!r.ok) return res.status(r.status).json({ ok: false, error: text });
  let data; try { data = JSON.parse(text); } catch { data = []; }
  return res.status(200).json({ ok: true, indexed: data.length });
}

async function listKbCampaigns(req, res, env) {
  const q = req.query || {};
  const params = new URLSearchParams({ select: '*', order: 'performance_score.desc', limit: String(q.limit || 100) });
  if (q.channel) params.set('channel', `eq.${q.channel}`);
  if (q.cleared === 'true') params.set('cleared_threshold', 'eq.true');
  const r = await fetch(`${env.url}/rest/v1/kb_campaigns?${params}`, { headers: sbHeaders(env) });
  const text = await r.text();
  if (!r.ok) return res.status(r.status).json({ ok: false, error: text });
  return res.status(200).json({ ok: true, campaigns: JSON.parse(text) });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. INGEST
// ═══════════════════════════════════════════════════════════════════════════
async function ingest(req, res, env) {
  // Lazy-require the LLM helper — only needed in this path.
  const { callLLM } = require('./_shared/llm.js');

  function stripHtml(html) {
    if (!html) return '';
    let s = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ');
    s = s.replace(/<\/?[a-z][^>]*>/gi, ' ');
    s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return s.replace(/\s+/g, ' ').trim().slice(0, 50000);
  }
  function extractTitle(html) {
    const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html || '');
    if (m) return m[1].trim().slice(0, 240);
    const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html || '');
    return og ? og[1].trim().slice(0, 240) : null;
  }
  function extractAuthor(html) {
    const m = /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i.exec(html || '');
    if (m) return m[1].trim().slice(0, 120);
    const og = /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i.exec(html || '');
    return og ? og[1].trim().slice(0, 120) : null;
  }
  function guessSourceType(url) {
    const u = url.toLowerCase();
    if (/twitter\.com|x\.com/.test(u)) return 'tweet';
    if (/youtube\.com|vimeo\.com/.test(u)) return 'video';
    if (/medium\.com|substack\.com|\.blog|wordpress|ghost\.io/.test(u)) return 'blog';
    return 'web';
  }
  async function fetchPage(url, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 VahdamKBBot/1.0 (+contact: knowledge@vahdam.com)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      return { status: r.status, html: await r.text(), finalUrl: r.url || url };
    } finally { clearTimeout(t); }
  }

  const SYSTEM_PROMPT = `You are the knowledge curator for VAHDAM India — a premium D2C tea brand. You receive raw extracted text from a web page and distill it into a useful reference for the marketing team.

Return STRICT JSON ONLY:
{"summary":"<60-120 words>","key_points":["<5 takeaways>"],"tags":["<2-5 short tags>"]}

Rules:
- Be specific. Reference numbers, brand names, frameworks if mentioned.
- Skip headers, ads, navigation.
- If the text is empty/garbage, return {"summary":"<could not extract content>","key_points":[],"tags":["error"]}.
- Output the JSON object only, starting with { and ending with }.`;

  async function summarize(textBody, urlForContext) {
    if (!textBody || textBody.length < 60) {
      return { summary: 'Could not extract meaningful content from this URL.', key_points: [], tags: ['error'] };
    }
    const userMsg = `URL: ${urlForContext}\n\nExtracted text:\n"""\n${textBody.slice(0, 30000)}\n"""`;
    try {
      const raw = await callLLM({ system: SYSTEM_PROMPT, user: userMsg, maxTokens: 700, temperature: 0.3, jsonMode: true });
      const json = JSON.parse(raw.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, '$1'));
      return {
        summary: String(json.summary || '').slice(0, 2000),
        key_points: Array.isArray(json.key_points) ? json.key_points.slice(0, 8).map(String) : [],
        tags: Array.isArray(json.tags) ? json.tags.slice(0, 6).map((t) => String(t).toLowerCase()) : [],
      };
    } catch (err) { return { summary: `Summary failed: ${err.message}`, key_points: [], tags: ['error'] }; }
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const url = String(body.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Provide a valid http(s) url' });
  const added_by = String(body.added_by || 'anonymous').slice(0, 120);
  const source_type = (body.source_type && String(body.source_type)) || guessSourceType(url);
  const userTags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).toLowerCase()) : null;
  const canonical = canonicalUrl(url);
  const hash = urlHash(canonical);
  const headers = sbHeaders(env);

  // Upsert initial 'queued' row
  let row;
  try {
    const r = await fetch(`${env.url}/rest/v1/kb_knowledge?on_conflict=url_hash`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify({ url: canonical, url_hash: hash, source_type, tags: userTags, status: 'queued', added_by }),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0,300)}`);
    const data = await r.json(); row = Array.isArray(data) ? data[0] : data;
  } catch (err) { return res.status(500).json({ ok: false, stage: 'db', error: err.message }); }
  const rowId = row && row.id;
  if (!rowId) return res.status(500).json({ ok: false, error: 'failed to create kb_knowledge row' });

  // Fetch page
  let pageHtml = '';
  try {
    const fetched = await fetchPage(canonical);
    pageHtml = fetched.html;
    if (fetched.status < 200 || fetched.status >= 400) throw new Error(`HTTP ${fetched.status}`);
  } catch (err) {
    await fetch(`${env.url}/rest/v1/kb_knowledge?id=eq.${rowId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'failed', processed_at: new Date().toISOString(), summary: `Fetch failed: ${err.message}` }),
    });
    return res.status(502).json({ ok: false, stage: 'fetch', error: err.message, id: rowId });
  }

  const title = extractTitle(pageHtml);
  const author = extractAuthor(pageHtml);
  const rawText = stripHtml(pageHtml);

  await fetch(`${env.url}/rest/v1/kb_knowledge?id=eq.${rowId}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ title, author, raw_text: rawText, status: 'fetched' }),
  }).catch(() => {});

  const out = await summarize(rawText, canonical);
  const mergedTags = [...new Set([...(userTags || []), ...(out.tags || [])])].slice(0, 8);
  try {
    await fetch(`${env.url}/rest/v1/kb_knowledge?id=eq.${rowId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ summary: out.summary, key_points: out.key_points, tags: mergedTags, status: 'summarized', processed_at: new Date().toISOString() }),
    });
    return res.status(200).json({ ok: true, id: rowId, title, author, summary: out.summary, key_points: out.key_points, tags: mergedTags, status: 'summarized', url: canonical });
  } catch (err) { return res.status(500).json({ ok: false, stage: 'final-save', error: err.message, id: rowId }); }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. LIST KB_KNOWLEDGE
// ═══════════════════════════════════════════════════════════════════════════
async function listKnowledge(req, res, env) {
  const limit = Math.min(parseInt(req.query?.limit || '200', 10) || 200, 500);
  const status = req.query?.status ? `&status=eq.${encodeURIComponent(req.query.status)}` : '';
  const url = `${env.url}/rest/v1/kb_knowledge?select=id,url,source_type,title,author,summary,key_points,tags,status,added_by,added_at,processed_at&order=added_at.desc&limit=${limit}${status}`;
  try {
    const r = await fetch(url, { headers: sbHeaders(env) });
    if (!r.ok) return res.status(r.status).json({ ok: false, items: [], error: (await r.text()).slice(0, 300) });
    const items = await r.json();
    return res.status(200).json({ ok: true, items, count: items.length });
  } catch (err) { return res.status(500).json({ ok: false, items: [], error: err.message }); }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. TOP EMAILS
// ═══════════════════════════════════════════════════════════════════════════
async function topEmails(req, res, env) {
  const ALLOWED = ['sent_at','subject','preheader','body_text','body_html','market','segment','campaign_type','open_rate','click_rate','conversion_rate','revenue','send_count','notes','tags','added_by'];
  const pick = (o, ks) => ks.reduce((r, k) => (o[k] !== undefined && o[k] !== null && o[k] !== '' ? (r[k] = o[k], r) : r), {});
  const clampRate = (v) => { if (v == null) return undefined; const n = Number(v); if (!isFinite(n)) return undefined; return n > 1.0001 ? Math.min(n/100, 1) : Math.max(0, Math.min(n, 1)); };
  const normalize = (row) => {
    const r = pick(row, ALLOWED);
    if (!r.subject || !r.body_text) return null;
    if (r.open_rate !== undefined) r.open_rate = clampRate(r.open_rate);
    if (r.click_rate !== undefined) r.click_rate = clampRate(r.click_rate);
    if (r.conversion_rate !== undefined) r.conversion_rate = clampRate(r.conversion_rate);
    if (r.revenue !== undefined) r.revenue = Number(r.revenue) || null;
    if (r.send_count !== undefined) r.send_count = parseInt(r.send_count, 10) || null;
    if (r.tags && !Array.isArray(r.tags)) r.tags = String(r.tags).split(',').map((t)=>t.trim().toLowerCase()).filter(Boolean);
    return r;
  };

  if (req.method === 'GET') {
    const limit = Math.min(parseInt(req.query?.limit || '200', 10) || 200, 500);
    const market = req.query?.market;
    const orderBy = req.query?.order === 'open' ? 'open_rate.desc' : (req.query?.order === 'rev' ? 'revenue.desc' : 'added_at.desc');
    const filter = market ? `&market=eq.${encodeURIComponent(market)}` : '';
    const url = `${env.url}/rest/v1/kb_top_emails?select=*&order=${orderBy}&limit=${limit}${filter}`;
    const r = await fetch(url, { headers: sbHeaders(env) });
    if (!r.ok) return res.status(r.status).json({ ok: false, items: [], error: (await r.text()).slice(0, 300) });
    const items = await r.json();
    return res.status(200).json({ ok: true, items, count: items.length });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'GET/POST only' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const rawRows = (req.query?.bulk === '1' || Array.isArray(body.items)) ? (body.items || []) : [body];
  if (!rawRows.length) return res.status(400).json({ ok: false, error: 'Provide one row or { items: [...] }' });
  if (rawRows.length > 200) return res.status(400).json({ ok: false, error: 'Bulk limit is 200 rows per request' });
  const rows = rawRows.map(normalize).filter(Boolean);
  if (!rows.length) return res.status(400).json({ ok: false, error: 'No valid rows — each needs subject + body_text' });
  const r = await fetch(`${env.url}/rest/v1/kb_top_emails`, {
    method: 'POST',
    headers: { ...sbHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) return res.status(r.status).json({ ok: false, inserted: 0, error: (await r.text()).slice(0, 300) });
  const inserted = await r.json();
  return res.status(200).json({ ok: true, inserted: inserted.length, rejected: rawRows.length - rows.length });
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. BRANDS
// ═══════════════════════════════════════════════════════════════════════════
async function brands(req, res, env) {
  const ALLOWED = ['name','website','category','region','priority','subscribe_url','email_alias','is_active','notes','added_by'];
  const pick = (o, ks) => ks.reduce((r, k) => (o[k] !== undefined ? (r[k] = o[k], r) : r), {});
  const headers = sbHeaders(env);

  if (req.method === 'GET') {
    const q = req.query || {};
    const f = [];
    if (q.category) f.push(`category=eq.${encodeURIComponent(q.category)}`);
    if (q.region) f.push(`region=eq.${encodeURIComponent(q.region)}`);
    if (q.active !== undefined && q.active !== 'all') f.push(`is_active=eq.${q.active === 'false' ? 'false' : 'true'}`);
    const filterStr = f.length ? `&${f.join('&')}` : '';
    const url = `${env.url}/rest/v1/competitor_brands?select=*&order=category.asc,region.asc,priority.asc,name.asc&limit=500${filterStr}`;
    const r = await fetch(url, { headers });
    if (!r.ok) return res.status(r.status).json({ ok: false, items: [], error: (await r.text()).slice(0, 300) });
    const items = await r.json();
    return res.status(200).json({ ok: true, items, count: items.length });
  }
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    const row = pick(body, ALLOWED);
    if (!row.name || !row.category || !row.region) return res.status(400).json({ ok: false, error: 'name, category, region required' });
    const r = await fetch(`${env.url}/rest/v1/competitor_brands?on_conflict=name,region`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: (await r.text()).slice(0, 300) });
    const data = await r.json();
    return res.status(200).json({ ok: true, brand: Array.isArray(data) ? data[0] : data });
  }
  if (req.method === 'PATCH') {
    const id = req.query?.id; if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    const patch = pick(body, ALLOWED);
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'no fields to update' });
    const r = await fetch(`${env.url}/rest/v1/competitor_brands?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: (await r.text()).slice(0, 300) });
    const data = await r.json();
    return res.status(200).json({ ok: true, brand: Array.isArray(data) ? data[0] : data });
  }
  if (req.method === 'DELETE') {
    const id = req.query?.id; if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const hard = req.query?.hard === '1';
    const r = hard
      ? await fetch(`${env.url}/rest/v1/competitor_brands?id=eq.${id}`, { method: 'DELETE', headers })
      : await fetch(`${env.url}/rest/v1/competitor_brands?id=eq.${id}`, { method: 'PATCH', headers, body: JSON.stringify({ is_active: false }) });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: (await r.text()).slice(0, 300) });
    return res.status(200).json({ ok: true, deleted: hard ? 'hard' : 'soft' });
  }
  return res.status(405).json({ ok: false, error: 'GET/POST/PATCH/DELETE only' });
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. CLASSIFY-EMAILS — heuristic format bifurcation
// ═══════════════════════════════════════════════════════════════════════════
async function classifyEmails(req, res, env) {
  const headers = sbHeaders(env);
  function classify({ html, bodyText }) {
    const text = (bodyText || '').trim();
    const wordCount = text ? text.split(/\s+/).length : 0;
    const imageCount = ((html || '').match(/<img\b[^>]*>/gi) || []).length;
    let format;
    if (wordCount >= 120 && imageCount <= 2) format = 'text';
    else if (imageCount >= 6 || (imageCount >= 3 && wordCount < 80)) format = 'image_heavy';
    else if (wordCount >= 40 && imageCount >= 1 && imageCount <= 5) format = 'html';
    else format = 'mixed';
    return { format, word_count: wordCount, image_count: imageCount };
  }
  const dedupeKey = (e) => `${(e.senderEmail || '').toLowerCase()}|${(e.subject || '').trim()}|${e.receivedAt || ''}`;

  if (req.method === 'GET') {
    if (req.query?.summary === '1') {
      const r = await fetch(`${env.url}/rest/v1/competitor_emails_classified?select=format,brand&limit=2000`, { headers });
      const items = r.ok ? await r.json() : [];
      const counts = items.reduce((a, it) => (a[it.format] = (a[it.format] || 0) + 1, a), {});
      const byBrand = items.reduce((a, it) => {
        if (!it.brand) return a;
        a[it.brand] = a[it.brand] || { text:0, html:0, image_heavy:0, mixed:0 };
        a[it.brand][it.format] = (a[it.brand][it.format] || 0) + 1;
        return a;
      }, {});
      return res.status(200).json({ ok: true, total: items.length, counts, byBrand });
    }
    const limit = Math.min(parseInt(req.query?.limit || '200', 10) || 200, 500);
    const fmt = req.query?.format ? `&format=eq.${encodeURIComponent(req.query.format)}` : '';
    const r = await fetch(`${env.url}/rest/v1/competitor_emails_classified?select=*&order=classified_at.desc&limit=${limit}${fmt}`, { headers });
    const items = r.ok ? await r.json() : [];
    return res.status(200).json({ ok: true, items });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'GET/POST only' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const reclassify = !!body.reclassify;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;

  let emails;
  try {
    const r = await fetch(`${origin}/api/competitor?action=list`);
    if (!r.ok) throw new Error(`/api/competitor?action=list returned ${r.status}`);
    emails = (await r.json()).emails || [];
  } catch (err) { return res.status(502).json({ ok: false, error: 'fetch emails failed: ' + err.message }); }

  let existing = new Set();
  if (!reclassify) {
    const r = await fetch(`${env.url}/rest/v1/competitor_emails_classified?select=email_key&limit=2000`, { headers });
    if (r.ok) existing = new Set((await r.json()).map((x) => x.email_key));
  }

  const toUpsert = [];
  const counts = { text:0, html:0, image_heavy:0, mixed:0 };
  let scanned = 0, skipped = 0;
  for (const e of emails) {
    scanned++;
    const key = dedupeKey(e);
    if (!reclassify && existing.has(key)) { skipped++; continue; }
    let html = '';
    try {
      const r = await fetch(`${origin}/api/competitor?action=html&id=${encodeURIComponent(e.id)}`);
      if (r.ok) html = ((await r.json().catch(() => ({}))).html) || '';
    } catch {}
    const c = classify({ html, bodyText: e.bodyText });
    counts[c.format] = (counts[c.format] || 0) + 1;
    toUpsert.push({
      email_key: key, brand: e.brand || null, format: c.format,
      word_count: c.word_count, image_count: c.image_count,
      has_promo: !!(e.promoCodes && e.promoCodes !== 'None'),
      promo_codes: e.promoCodes && e.promoCodes !== 'None' ? e.promoCodes : null,
      classifier: 'heuristic',
    });
  }
  if (!toUpsert.length) return res.status(200).json({ ok: true, scanned, skipped, inserted: 0, counts });
  const r = await fetch(`${env.url}/rest/v1/competitor_emails_classified?on_conflict=email_key`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify(toUpsert),
  });
  if (!r.ok) return res.status(r.status).json({ ok: false, error: (await r.text()).slice(0, 300), scanned, inserted: 0 });
  return res.status(200).json({ ok: true, scanned, skipped, inserted: toUpsert.length, counts });
}
