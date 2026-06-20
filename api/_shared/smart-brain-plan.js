'use strict';

/**
 * Smart Brain persistent rolling plan.
 *
 * runDailySmartBrain() in lib/smart-brain/services.js is a pure function — it
 * regenerates a plan from scratch on every call. This module adds the missing
 * lifecycle around it:
 *
 *   syncDaily()    — the DAILY REVIEW loop. Re-runs analysis on the latest
 *                    data, then diff-updates the stored tentative plan in
 *                    smart_calendar_entries (kept rolling N days ahead) while
 *                    never touching human-approved/final entries.
 *   getPlan()      — current stored plan (or a stateless preview when no DB).
 *   approveEntry() — human sign-off: locks the entry, generates the full
 *                    campaign (mailer + Meta/Google/TikTok ads + landing page)
 *                    with LLM-written copy, persists to smart_generated_campaigns
 *                    and mirrors into ads_generated / landing_pages_generated so
 *                    the Ads + Landing Pages dashboards pick them up.
 *   rejectEntry()  — records feedback; the next daily sync regenerates the slot.
 *   landingPageHtml() — resolves stored LP HTML so /lp/:id can serve it.
 */

const {
  smartConfig, SmartBrainDbAdapter, KnowledgeBaseService, AnalysisService,
  CompetitorBenchmarkingService, CalendarIntelligenceService, GenerationService,
} = require('../../lib/smart-brain/services.js');
const callLLM = require('./llm.js');
const { parseJSON } = require('./llm.js');
const { buildMasterPrompt, regionFacts } = require('./master-prompt.js');

function todayIso() { return new Date().toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }
function daysAgoIso(n) { return new Date(Date.now() - n * 86400000).toISOString(); }
function stableId(date, market) { return `cal_${date}_${String(market).toLowerCase()}`; }

// How long telemetry/log rows are kept before the daily sync evicts them.
const RETENTION_DAYS = 30;
// Calendar statuses that a daily sync is allowed to overwrite. An entry that a
// human flipped to approved/final between our read and our write is NOT in this
// set, so the conditional UPDATE matches zero rows and the human decision wins.
const SYNC_WRITABLE_STATUSES = 'in.(tentative,rejected)';

// ── Analysis context (shared by sync + preview) ─────────────────────────────

async function buildContext(config, db) {
  const ownData = await db.ownData();
  const competitorData = await db.competitorData();
  const kb = new KnowledgeBaseService(config).build(ownData);
  const analysis = new AnalysisService(config).analyze(kb, ownData);
  const competitorBenchmarks = new CompetitorBenchmarkingService(config).benchmark(competitorData);
  return { ownData, kb, analysis, competitorBenchmarks };
}

function freshEntries(config, ctx, startDate, days) {
  const calendar = new CalendarIntelligenceService(config).generate({
    analysis: ctx.analysis,
    competitorBenchmarks: ctx.competitorBenchmarks,
    startDate,
    days,
    feedback: ctx.ownData.feedback,
  });
  // Re-key on date+market so the same slot keeps the same id across daily syncs.
  for (const e of calendar.entries) e.id = stableId(e.date, e.market);
  return calendar.entries;
}

// Fields whose change means the slot was materially re-planned (vs. cosmetic).
function materialDiff(oldPayload, fresh) {
  const diffs = [];
  if ((oldPayload.cohort?.name) !== (fresh.cohort?.name)) diffs.push(`cohort ${oldPayload.cohort?.name} → ${fresh.cohort?.name}`);
  if ((oldPayload.heroProduct?.sku) !== (fresh.heroProduct?.sku)) diffs.push(`hero product ${oldPayload.heroProduct?.title || oldPayload.heroProduct?.sku} → ${fresh.heroProduct?.title || fresh.heroProduct?.sku}`);
  if (oldPayload.objective !== fresh.objective) diffs.push(`objective ${oldPayload.objective} → ${fresh.objective}`);
  if (JSON.stringify(oldPayload.channels) !== JSON.stringify(fresh.channels)) diffs.push(`channels ${JSON.stringify(oldPayload.channels)} → ${JSON.stringify(fresh.channels)}`);
  if (Math.abs((oldPayload.confidence || 0) - (fresh.confidence || 0)) >= 0.05) diffs.push(`confidence ${oldPayload.confidence} → ${fresh.confidence}`);
  return diffs;
}

// ── Retention / eviction (runs once per daily sync) ─────────────────────────
// Without this, smart_brain_runs (one row per sync), smart_feedback, and
// archived calendar rows grow unbounded over long enterprise cycles.
async function pruneOldRecords(config, db) {
  const cutoff = daysAgoIso(RETENTION_DAYS);
  const out = {};
  const runs = await db.delete(config.tableNames.runs, { created_at: `lt.${cutoff}` }).catch(() => null);
  out.runs = runs?.ok ? (runs.rows || []).length : 0;
  const fb = await db.delete(config.tableNames.feedback, { created_at: `lt.${cutoff}` }).catch(() => null);
  out.feedback = fb?.ok ? (fb.rows || []).length : 0;
  const cal = await db.delete(config.tableNames.calendarEntries, { status: 'eq.archived', updated_at: `lt.${cutoff}` }).catch(() => null);
  out.archived_calendar = cal?.ok ? (cal.rows || []).length : 0;
  return out;
}

// ── Daily sync (the smart-brain daily review loop) ──────────────────────────

async function syncDaily({ config: cfg = {}, days, persist = true } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const horizon = days || config.calendarDays;
  const start = todayIso();
  const ctx = await buildContext(config, db);
  const fresh = freshEntries(config, ctx, start, horizon);

  const changes = [];
  let stored = [];
  if (db.connected && persist) {
    stored = (await db.select(config.tableNames.calendarEntries, {
      filters: { date: `gte.${start}` }, order: 'date.asc', limit: 1000,
    }).catch(() => [])) || [];
  }
  const storedById = new Map(stored.map((r) => [r.id, r]));

  // New slots are inserted (never overwriting an existing row); refreshes to
  // tentative/rejected slots are applied as CONDITIONAL updates so a human
  // approval landing mid-sync is never clobbered (see optimistic-lock note below).
  const inserts = [];
  const updates = [];
  for (const entry of fresh) {
    const existing = storedById.get(entry.id);
    if (!existing) {
      inserts.push({
        id: entry.id, date: entry.date, market: entry.market, status: 'tentative',
        confidence: entry.confidence, payload: entry,
        change_log: [{ at: nowIso(), kind: 'created', detail: 'New slot added to rolling window.' }],
        updated_at: nowIso(),
      });
      changes.push({ id: entry.id, kind: 'created', detail: `${entry.date} ${entry.market}: new tentative slot (${entry.objective}).` });
      continue;
    }
    if (existing.status === 'approved' || existing.status === 'final') {
      changes.push({ id: entry.id, kind: 'kept_locked', detail: `${entry.date} ${entry.market}: human-approved, left untouched.` });
      continue;
    }
    // tentative or rejected → refresh from latest data
    const diffs = materialDiff(existing.payload || {}, entry);
    const wasRejected = existing.status === 'rejected';
    if (diffs.length || wasRejected) {
      const log = Array.isArray(existing.change_log) ? existing.change_log.slice(-30) : [];
      log.push({ at: nowIso(), kind: wasRejected ? 'regenerated_after_rejection' : 'updated', detail: diffs.join('; ') || 'Regenerated after human rejection.' });
      updates.push({
        id: entry.id,
        patch: {
          date: entry.date, market: entry.market, status: 'tentative',
          confidence: entry.confidence, payload: entry, change_log: log, updated_at: nowIso(),
        },
      });
      changes.push({ id: entry.id, kind: wasRejected ? 'regenerated' : 'updated', detail: `${entry.date} ${entry.market}: ${diffs.join('; ') || 'regenerated after rejection'}.` });
    }
  }

  let persistence = { skipped: true, reason: db.connected ? 'persist=false' : 'Supabase env not configured' };
  if (db.connected && persist) {
    const results = { inserted: 0, updated: 0, skipped_locked: 0, warnings: [] };
    if (inserts.length) {
      // ignore-duplicates: if a concurrent sync already created the row, leave it untouched.
      const ins = await db.upsert(config.tableNames.calendarEntries, inserts, 'id', { resolution: 'ignore-duplicates' });
      if (ins.ok) results.inserted = (ins.rows || []).length; else results.warnings.push(ins.warning);
    }
    for (const u of updates) {
      // OPTIMISTIC LOCK: the status filter means a row a human approved between our
      // read and this write no longer matches → update affects 0 rows, decision preserved.
      const upd = await db.update(
        config.tableNames.calendarEntries,
        { id: `eq.${u.id}`, status: SYNC_WRITABLE_STATUSES },
        u.patch,
      );
      if (upd.ok) {
        if ((upd.rows || []).length) results.updated += 1;
        else results.skipped_locked += 1; // human approved/finalized mid-sync
      } else { results.warnings.push(upd.warning); }
    }
    persistence = { ok: true, ...results };
    // Roll past slots out of the active window.
    await db.update(config.tableNames.calendarEntries, { date: `lt.${start}`, status: SYNC_WRITABLE_STATUSES }, { status: 'archived', updated_at: nowIso() }).catch(() => {});
    await db.insert(config.tableNames.runs, [{
      id: `run_${Date.now().toString(36)}`,
      payload: { kind: 'daily-sync', start, horizon, changes, insights: ctx.analysis.dailyInsights },
      created_at: nowIso(),
    }]).catch(() => {});
    persistence.pruned = await pruneOldRecords(config, db);
  }

  const plan = await getPlan({ config: cfg, _ctxFallback: { config, db, ctx, fresh } });
  return {
    ok: true,
    mode: db.connected ? 'db-linked' : 'local-fallback',
    synced_at: nowIso(),
    horizon_days: horizon,
    changes,
    insights: ctx.analysis.dailyInsights,
    cohorts: ctx.analysis.cohorts,
    competitorBenchmarks: { byChannel: ctx.competitorBenchmarks.byChannel, trendingHooks: ctx.competitorBenchmarks.trendingHooks.slice(0, 8) },
    plan: plan.entries,
    persistence,
  };
}

// ── Read current plan ───────────────────────────────────────────────────────

async function getPlan({ config: cfg = {}, _ctxFallback = null } = {}) {
  const config = _ctxFallback?.config || smartConfig(cfg);
  const db = _ctxFallback?.db || new SmartBrainDbAdapter(config);
  if (db.connected) {
    const rows = (await db.select(config.tableNames.calendarEntries, {
      filters: { date: `gte.${todayIso()}`, status: 'neq.archived' }, order: 'date.asc,market.asc', limit: 1000,
    }).catch(() => [])) || [];
    if (rows.length) {
      return {
        ok: true, mode: 'db-linked', stored: true,
        entries: rows.map((r) => ({ ...(r.payload || {}), id: r.id, status: r.status, confidence: r.confidence, change_log: r.change_log, generated_campaign_id: r.generated_campaign_id, approved_by: r.approved_by, approved_at: r.approved_at, updated_at: r.updated_at })),
      };
    }
  }
  // Stateless preview: no DB (or empty table) — generate on the fly.
  const ctx = _ctxFallback?.ctx || await buildContext(config, db);
  const entries = _ctxFallback?.fresh || freshEntries(config, ctx, todayIso(), config.calendarDays);
  return { ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', stored: false, entries: entries.map((e) => ({ ...e, status: 'tentative' })) };
}

// ── LLM copywriting on approval ─────────────────────────────────────────────

const BRAND_SYSTEM = `You are the senior lifecycle copywriter for VAHDAM India (premium Indian teas & wellness, vahdamteas.com).
Voice: warm, sensory, emotionally resonant, story-driven. Prefer: ritual, restore, balance, origin, single-estate, hand-picked, steep, heritage, crafted.
NEVER use: "wellness journey", "transform", "liquid gold", "game-changer", "LIMITED TIME" in caps, "hurry", "don't miss out", "last chance", "while supplies last".
Return STRICT JSON only, no markdown fences.`;

function copyPrompt(entry) {
  const hooks = (entry.competitorContext || []).flatMap((c) => (c.trendingHooks || []).map((h) => h.hook)).slice(0, 5);
  return `Write campaign copy for this planned slot. Context:
- Market: ${entry.market} | Cohort: ${entry.cohort?.name} | Objective: ${entry.objective}
- Hero product: ${entry.heroProduct?.title} (${entry.heroProduct?.category || 'tea'})
- ${entry.festival ? `Seasonal moment: ${entry.festival.name}` : 'No festival; evergreen angle.'}
- Rationale: ${entry.rationale || ''}
- Competitor hooks trending (for awareness only, do NOT copy): ${hooks.join(' | ') || 'n/a'}

Return JSON with exactly this shape:
{
 "email": { "subject": "", "preheader": "", "hero_headline": "", "intro_paragraph": "", "body_paragraph": "", "cta": "" },
 "landing": { "hero_headline": "", "hero_sub": "", "why_title": "", "why_bullets": ["","",""], "proof_quote": "", "proof_author": "", "faq": [{"q":"","a":""},{"q":"","a":""}], "cta": "" },
 "ads": {
   "meta": { "primary_text": "", "headline": "", "description": "" },
   "google": { "headlines": ["","",""], "descriptions": ["",""] },
   "tiktok": { "script": "", "caption": "" }
 }
}`;
}

const FONT_HEAD = "'Lao MN','Cormorant Garamond',Georgia,serif";
const FONT_BODY = "'Proxima Nova','Helvetica Neue',Arial,sans-serif";

// HTML-escape so LLM copy can't break the markup / inject tags.
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// try.vahdam.*-style presell landing page. Self-contained (inline CSS, no external
// fonts/scripts) so it serves at /lp/:id AND exports as a deploy-ready file.
function lpHtml(entry, copy, campaignId) {
  const L = copy.landing || {};
  const facts = regionFacts(entry.market);
  const handle = entry.heroProduct?.handle || '';
  const shopUrl = `https://${facts.store}${handle ? `/products/${handle}` : ''}`;
  const cta = esc(L.cta || 'Shop the ritual');
  const cur = facts.currency;
  const price = entry.heroProduct?.price;
  const priceLabel = price != null ? `${cur}${price}` : '';
  const faq = (L.faq || []).map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  const bullets = (L.why_bullets || []).map((b) => `<li><span class="tick">✓</span>${esc(b)}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(L.hero_headline || entry.heroProduct?.title || 'VAHDAM')}</title>
<style>
:root{--moss:#004A2B;--moss-deep:#021c12;--moss-near:#00150a;--cream:#FBF5EA;--cream-warm:#f3ebd6;--gold:#AB8743;--ink:#171717;--ink-dim:#4a4a4a;--head:${FONT_HEAD};--body:${FONT_BODY}}
*{box-sizing:border-box}
body{margin:0;background:var(--cream);color:var(--ink);font-family:var(--body);line-height:1.6;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}
.bar{background:var(--moss-deep);color:var(--cream);text-align:center;font-size:13px;letter-spacing:.04em;padding:10px 16px}
.wrap{max-width:920px;margin:0 auto;padding:0 22px}
h1,h2,h3{font-family:var(--head);line-height:1.12;margin:0 0 14px}
.hero{background:var(--moss);color:var(--cream);text-align:center;padding:64px 22px 72px}
.hero .eyebrow{color:var(--gold);letter-spacing:.2em;text-transform:uppercase;font-size:12px;margin:0 0 18px}
.hero h1{font-size:40px;max-width:720px;margin:0 auto 16px}
.hero p{max-width:560px;margin:0 auto 28px;color:rgba(251,245,234,.82)}
.btn{display:inline-block;background:var(--gold);color:var(--ink);font-weight:700;text-decoration:none;padding:16px 34px;border-radius:6px;border:0;cursor:pointer;font-size:16px}
.btn-dark{background:var(--moss);color:var(--cream)}
.trust{display:flex;flex-wrap:wrap;justify-content:center;gap:18px 30px;background:var(--cream-warm);padding:18px 22px;font-size:13px;color:var(--ink-dim);text-align:center}
.sec{padding:54px 0}
.sec h2{font-size:30px}
.why li{list-style:none;margin:12px 0;padding-left:6px}
.tick{color:var(--moss);font-weight:800;margin-right:10px}
.why ul{padding:0;margin:0}
.reveal{background:#fff;border:1px solid #e7ddc6;border-radius:14px;padding:30px;display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between}
.reveal .price{font-family:var(--head);font-size:30px;color:var(--moss)}
.proof{background:var(--moss-near);color:var(--cream);text-align:center}
.proof blockquote{font-family:var(--head);font-size:26px;max-width:680px;margin:0 auto;line-height:1.35}
.proof .who{color:var(--gold);font-weight:700;margin-top:16px}
.faq{border-top:1px solid rgba(171,135,67,.3);padding:14px 0}
.faq summary{font-weight:700;cursor:pointer;font-size:17px}
.faq p{color:var(--ink-dim);margin:10px 0 0}
.guarantee{background:var(--cream-warm);text-align:center;border-radius:14px;padding:34px;margin:30px 0}
.sticky{position:sticky;bottom:0;background:#fff;border-top:1px solid #e7ddc6;display:flex;gap:14px;align-items:center;justify-content:space-between;padding:12px 22px;box-shadow:0 -6px 24px rgba(0,0,0,.08)}
.sticky .info{font-size:14px}.sticky .info b{display:block;font-family:var(--head);font-size:16px}
footer{background:var(--ink);color:rgba(251,245,234,.6);text-align:center;padding:26px;font-size:12px}
@media(max-width:640px){.hero h1{font-size:30px}.sec h2{font-size:24px}.sticky .info .sub{display:none}}
</style></head>
<body>
<div class="bar">VAHDAM India · ${esc(entry.market)} · Single-estate, hand-picked, shipped fresh</div>
<section class="hero">
  <p class="eyebrow">${esc(entry.cohort?.name ? entry.cohort.name + ' edit' : 'A daily ritual')}</p>
  <h1>${esc(L.hero_headline || entry.heroProduct?.title || 'Your ritual, restored')}</h1>
  <p>${esc(L.hero_sub || entry.rationale || '')}</p>
  <a class="btn" href="${esc(shopUrl)}">${cta}</a>
</section>
<div class="trust"><span>★★★★★ Loved by tea drinkers</span><span>Single-estate origin</span><span>Hand-picked &amp; fresh</span><span>Ships in days</span></div>
<div class="wrap">
  <section class="sec why">
    <h2>${esc(L.why_title || 'Why this edit')}</h2>
    <ul>${bullets || '<li><span class="tick">✓</span>Crafted around your daily ritual.</li>'}</ul>
  </section>
  <section class="sec">
    <div class="reveal">
      <div>
        <h3 style="margin:0 0 6px">${esc(entry.heroProduct?.title || 'The edit')}</h3>
        <p style="margin:0;color:var(--ink-dim)">${esc(entry.heroProduct?.category || 'Single-estate tea')}</p>
      </div>
      <div style="text-align:right">
        ${priceLabel ? `<div class="price">${esc(priceLabel)}</div>` : ''}
        <a class="btn btn-dark" href="${esc(shopUrl)}">${cta}</a>
      </div>
    </div>
  </section>
</div>
<section class="sec proof">
  <div class="wrap">
    <blockquote>“${esc(L.proof_quote || 'There is a moment when the right cup does more than warm your hands.')}”</blockquote>
    <p class="who">— ${esc(L.proof_author || 'A VAHDAM regular')}</p>
  </div>
</section>
<div class="wrap">
  ${faq ? `<section class="sec"><h2>Questions, answered</h2>${faq}</section>` : ''}
  <div class="guarantee">
    <h3>Steep with confidence</h3>
    <p style="margin:0;color:var(--ink-dim)">If your first cup isn't a quiet highlight of the day, our team will make it right.</p>
  </div>
</div>
<div class="sticky">
  <div class="info"><b>${esc(entry.heroProduct?.title || 'VAHDAM edit')}</b><span class="sub">${esc(priceLabel)} · ships fresh from origin</span></div>
  <a class="btn" href="${esc(shopUrl)}">${cta}</a>
</div>
<footer>© VAHDAM India · ${esc(entry.market)} · ${esc(campaignId)}</footer>
</body></html>`;
}

function emailHtml(entry, copy) {
  const E = copy.email;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${E.subject}</title></head>
<body style="margin:0;background:#FBF5EA;color:#171717;font-family:${FONT_BODY}">
<main style="max-width:680px;margin:auto;background:#ffffff">
  <section style="background:#004A2B;color:#FBF5EA;padding:44px 36px;text-align:center">
    <p style="color:#AB8743;letter-spacing:.18em;text-transform:uppercase;font-size:11px;margin:0 0 14px">VAHDAM India</p>
    <h1 style="font-family:${FONT_HEAD};font-size:32px;line-height:1.15;margin:0">${E.hero_headline}</h1>
  </section>
  <section style="padding:36px">
    <p style="line-height:1.7">${E.intro_paragraph}</p>
    <p style="line-height:1.7">${E.body_paragraph}</p>
    <p style="text-align:center;margin:32px 0 8px"><a href="{{landing_page_url}}" style="background:#AB8743;color:#171717;padding:15px 28px;text-decoration:none;border-radius:4px;font-weight:700;display:inline-block">${E.cta || 'Shop the edit'}</a></p>
  </section>
  <footer style="background:#171717;color:#FBF5EA99;text-align:center;padding:22px;font-size:11px">You're receiving this as a VAHDAM ${entry.cohort?.name || 'customer'} in ${entry.market}.</footer>
</main>
</body></html>`;
}

async function writeCopyWithLLM(entry) {
  const res = await callLLM({
    systemPrompt: BRAND_SYSTEM,
    userMessage: copyPrompt(entry),
    responseFormat: { type: 'json_object' },
    maxTokens: 1800,
    temperature: 0.75,
    timeoutMs: 40000,
    stage: 'smart-brain-copy',
  });
  const json = parseJSON(res.text);
  if (!json || !json.email || !json.landing || !json.ads) throw new Error('LLM copy JSON incomplete');
  return { copy: json, provider: res.provider, model: res.model };
}

function applyCopy(campaign, entry, copy) {
  if (campaign.assets.email) {
    campaign.assets.email.subject = copy.email.subject || campaign.assets.email.subject;
    campaign.assets.email.preheader = copy.email.preheader || campaign.assets.email.preheader;
    campaign.assets.email.html = emailHtml(entry, copy);
    campaign.assets.email.text = `${copy.email.subject}\n${copy.email.preheader}\n\n${copy.email.intro_paragraph}\n\n${copy.email.body_paragraph}\n\n${copy.email.cta}: {{landing_page_url}}`;
  }
  if (campaign.assets.landing_pages?.length) {
    const lp = campaign.assets.landing_pages[0];
    lp.title = copy.landing.hero_headline || lp.title;
    lp.html = lpHtml(entry, copy, campaign.campaign_id);
    lp.path = `/lp/${campaign.campaign_id}`;
  }
  for (const ad of campaign.assets.ads || []) {
    if (ad.platform === 'meta' && copy.ads.meta) Object.assign(ad, { primary_text: copy.ads.meta.primary_text || ad.primary_text, headline: copy.ads.meta.headline || ad.headline, description: copy.ads.meta.description || ad.description });
    if (ad.platform === 'google' && copy.ads.google) Object.assign(ad, { headlines: copy.ads.google.headlines?.filter(Boolean) || ad.headlines, descriptions: copy.ads.google.descriptions?.filter(Boolean) || ad.descriptions });
    if (ad.platform === 'tiktok' && copy.ads.tiktok) Object.assign(ad, { script: copy.ads.tiktok.script || ad.script, caption: copy.ads.tiktok.caption || ad.caption });
  }
  return campaign;
}

// ── Master prompts (portable, copy-anywhere) ────────────────────────────────
// Attach a self-contained master_prompt to every generated asset so a human can
// reproduce/upgrade it in a blank ChatGPT/Claude/Gemini session.
function attachMasterPrompts(campaign, entry) {
  const market = entry.market;
  const cohort = entry.cohort?.name || '';
  const brief = entry.rationale || entry.objective || '';
  const products = entry.heroProduct ? [entry.heroProduct] : [];
  const base = { market, cohort, brief, products };
  if (campaign.assets.email) {
    // Both mailer variants the operator requires, per region.
    campaign.assets.email.master_prompt_v1 = buildMasterPrompt({ ...base, assetType: 'mailer', variant: 'V1' });
    campaign.assets.email.master_prompt_v2 = buildMasterPrompt({ ...base, assetType: 'mailer', variant: 'V2' });
    campaign.assets.email.master_prompt = campaign.assets.email.master_prompt_v2;
  }
  for (const lp of campaign.assets.landing_pages || []) {
    lp.master_prompt = buildMasterPrompt({ ...base, assetType: 'landing_page' });
  }
  for (const ad of campaign.assets.ads || []) {
    ad.master_prompt = buildMasterPrompt({ ...base, assetType: 'ad', platform: ad.platform });
  }
  return campaign;
}

// ── Approve / reject ────────────────────────────────────────────────────────

async function approveEntry({ id, reviewer = null, config: cfg = {}, entry: inlineEntry = null } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  let row = null;
  let entry = inlineEntry;
  if (db.connected && id) {
    const rows = await db.select(config.tableNames.calendarEntries, { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
    row = rows && rows[0];
    if (row) entry = row.payload;
  }
  if (!entry) throw new Error(`Calendar entry ${id || ''} not found — run a daily sync first or pass the entry inline.`);

  // IDEMPOTENCY: a slot already approved with a generated campaign must NOT be
  // regenerated — that would orphan the prior campaign + its ads/LP rows. Return
  // the existing campaign instead.
  if (db.connected && row && (row.status === 'approved' || row.status === 'final') && row.generated_campaign_id) {
    const prior = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${row.generated_campaign_id}` }, limit: 1 }).catch(() => []);
    const existing = prior && prior[0] && prior[0].payload;
    if (existing) {
      return {
        ok: true, idempotent: true,
        campaign: existing,
        landing_page_url: existing.assets?.landing_pages?.[0] ? `/lp/${existing.campaign_id}` : null,
        persisted: { note: 'already approved — returned existing campaign (no regeneration)' },
      };
    }
  }

  const campaign = new GenerationService(config).generate(entry);
  let copyMeta = { provider: 'template-fallback', model: null };
  try {
    const { copy, provider, model } = await writeCopyWithLLM(entry);
    applyCopy(campaign, entry, copy);
    copyMeta = { provider, model };
  } catch (e) {
    console.warn('[smart-brain] LLM copy failed, using template assets:', e.message);
  }
  campaign.copywriter = copyMeta;
  attachMasterPrompts(campaign, entry);
  campaign.status = 'ready_for_human_final_check';
  campaign.calendar_entry_id = entry.id || id;

  const persisted = { campaign: null, ads: null, landing: null, calendar: null };
  if (db.connected) {
    persisted.campaign = await db.upsert(config.tableNames.generatedCampaigns, [{ id: campaign.campaign_id, payload: campaign, status: campaign.status, updated_at: nowIso() }], 'id');
    const adRows = (campaign.assets.ads || []).map((ad) => ({
      channel: ad.platform, name: campaign.name, market: campaign.market, objective: campaign.objective,
      audience: campaign.audience?.name, copy: ad, creative_prompt: ad.creative_brief || ad.script || '', origin: 'smart-brain',
      user_email: reviewer || null,
    }));
    if (adRows.length) persisted.ads = await db.insert(config.tableNames.adsGenerated, adRows);
    const lp = campaign.assets.landing_pages?.[0];
    if (lp) persisted.landing = await db.insert(config.tableNames.landingPagesGenerated, [{
      paired_with: campaign.assets.email ? 'mailer' : (campaign.assets.ads?.[0]?.platform || 'meta'),
      name: lp.title || campaign.name, market: campaign.market,
      hero: lp.title || '', payload: { campaign_id: campaign.campaign_id, path: lp.path, html: lp.html, sections: lp.sections, master_prompt: lp.master_prompt },
      origin: 'smart-brain', user_email: reviewer || null,
    }]);
    if (row) {
      const log = Array.isArray(row.change_log) ? row.change_log.slice(-30) : [];
      log.push({ at: nowIso(), kind: 'approved', detail: `Approved by ${reviewer || 'unknown'}; campaign ${campaign.campaign_id} generated (copy: ${copyMeta.provider}).` });
      persisted.calendar = await db.update(config.tableNames.calendarEntries, { id: `eq.${row.id}` }, {
        status: 'approved', generated_campaign_id: campaign.campaign_id, approved_by: reviewer, approved_at: nowIso(), change_log: log, updated_at: nowIso(),
      });
    }
  }
  return { ok: true, campaign, landing_page_url: campaign.assets.landing_pages?.[0] ? `/lp/${campaign.campaign_id}` : null, persisted };
}

async function rejectEntry({ id, reviewer = null, notes = '', config: cfg = {} } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return { ok: true, skipped: true, reason: 'Supabase env not configured — nothing stored to reject.' };
  const rows = await db.select(config.tableNames.calendarEntries, { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
  const row = rows && rows[0];
  if (!row) throw new Error(`Calendar entry ${id} not found.`);
  const log = Array.isArray(row.change_log) ? row.change_log.slice(-30) : [];
  log.push({ at: nowIso(), kind: 'rejected', detail: `${reviewer || 'Reviewer'}: ${notes || 'rejected — will be re-planned on next daily sync.'}` });
  // Clear any prior approval state so the regenerated slot does not point at a
  // now-orphaned campaign (init-mismatch fix).
  await db.update(config.tableNames.calendarEntries, { id: `eq.${id}` }, {
    status: 'rejected', change_log: log, updated_at: nowIso(),
    generated_campaign_id: null, approved_by: null, approved_at: null,
  });
  await db.insert(config.tableNames.feedback, [{ target_type: 'calendar_entry', target_id: id, verdict: 'rejected', notes, reviewer, created_at: nowIso() }]).catch(() => {});
  return { ok: true, id, status: 'rejected', will_regenerate_on_next_sync: true };
}

// ── Landing-page resolver for /lp/:id ───────────────────────────────────────

async function landingPageHtml(id, cfg = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return null;
  const camp = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
  const html = camp?.[0]?.payload?.assets?.landing_pages?.[0]?.html;
  if (html) return html;
  // fall back to landing_pages_generated (numeric id or campaign_id in payload)
  const filters = /^\d+$/.test(String(id)) ? { id: `eq.${id}` } : { 'payload->>campaign_id': `eq.${id}` };
  const lp = await db.select(config.tableNames.landingPagesGenerated, { filters, limit: 1 }).catch(() => []);
  return lp?.[0]?.payload?.html || null;
}

module.exports = { syncDaily, getPlan, approveEntry, rejectEntry, landingPageHtml };
