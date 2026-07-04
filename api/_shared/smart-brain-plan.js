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
const SM = require('./scenario-model.js');

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
  const cohortLtv = cohortLtvMap(ctx);
  for (const e of calendar.entries) {
    e.id = stableId(e.date, e.market);
    attachScenarioLayer(e, ctx, cohortLtv);
  }
  return calendar.entries;
}

// ── Scenario layer (medium active + best/conservative/emergency/instant pre-staged) ─
// The active rolling plan IS the medium scenario. The other four are pre-staged
// DORMANT inside the same row's payload — nested (not separate rows) because
// smart_calendar_entries has a UNIQUE (date,market) index. A human can promote a
// standby into the active fields via activateScenario() (the "break" switch).

function cohortLtvMap(ctx) {
  const m = {};
  for (const c of (ctx.analysis?.cohorts || [])) m[c.name] = c.avgLtv || 0;
  return m;
}
function toHero(product) {
  if (!product) return null;
  return { sku: product.sku || product.id, title: product.title, handle: product.handle, category: product.category };
}

// Build one dormant standby variant for a slot: re-derive ONLY the lever-varied
// operational fields (channels intersected with the scenario's channel mix, hero
// per its product strategy) + grounded projected metrics. NOT a second full plan.
function buildStandbyVariant(e, label, ctx, cohortLtv) {
  const L = SM.SCENARIO_LEVERS[label];
  const baseChannels = Array.isArray(e.channels) ? e.channels : [];
  let channels = baseChannels.filter((c) => L.channelMix.includes(c));
  if (!channels.length) channels = L.channelMix.filter((c) => c === 'email' || c === 'landing_page');

  let heroProduct = e.heroProduct;
  const scores = (ctx.analysis && ctx.analysis.productScores) || [];
  if (L.productStrategy === 'bestseller-only' && scores[0]) heroProduct = toHero(scores[0].product);
  else if (L.productStrategy === 'launch-push' && scores.length) heroProduct = toHero((scores.find((s) => !s.winningMentions) || scores[0]).product);

  const benchmark = SM.buildEngine2Benchmark(ctx.analysis, e.market, cohortLtv[e.cohort?.name] || 0);
  const projected_metrics = SM.projectMetrics([{ cohort: e.cohort, channels, date: e.date }], L, benchmark);
  return { active_scenario: label, status: 'dormant', channels, heroProduct, objective: e.objective, levers: L, projected_metrics };
}

function attachScenarioLayer(e, ctx, cohortLtv) {
  const benchmark = SM.buildEngine2Benchmark(ctx.analysis, e.market, cohortLtv[e.cohort?.name] || 0);
  e.active_scenario = e.active_scenario || 'medium';
  e.scenario_projections = {
    medium: SM.projectMetrics([{ cohort: e.cohort, channels: e.channels, date: e.date }], SM.SCENARIO_LEVERS.medium, benchmark),
  };
  e.standby = {};
  for (const label of ['best', 'conservative', 'emergency', 'instant']) {
    const variant = buildStandbyVariant(e, label, ctx, cohortLtv);
    e.standby[label] = variant;
    e.scenario_projections[label] = variant.projected_metrics;
  }
}

// Promote a scenario's operational fields onto the payload top level (mutates).
// Leaving medium snapshots the current medium fields so a switch-back is lossless;
// returning to medium restores from that snapshot.
function promoteScenario(payload, label) {
  if (label === 'medium') {
    const snap = payload.__medium_snapshot;
    if (snap) Object.assign(payload, { channels: snap.channels, heroProduct: snap.heroProduct, objective: snap.objective });
    payload.active_scenario = 'medium';
    delete payload.__medium_snapshot;
    return payload;
  }
  const v = payload.standby && payload.standby[label];
  if (!v) return payload;
  if (!payload.__medium_snapshot && (payload.active_scenario || 'medium') === 'medium') {
    payload.__medium_snapshot = { channels: payload.channels, heroProduct: payload.heroProduct, objective: payload.objective };
  }
  Object.assign(payload, { channels: v.channels, heroProduct: v.heroProduct, objective: v.objective });
  payload.active_scenario = label;
  return payload;
}

// Build the effective entry an approval/preview should generate — the active
// scenario's operational fields merged in, with all internal/projection keys
// stripped so revenue numbers can NEVER reach the asset builders.
function effectiveEntry(entry) {
  const label = entry.active_scenario;
  let merged = entry;
  if (label && label !== 'medium' && entry.standby && entry.standby[label]) {
    const v = entry.standby[label];
    merged = { ...entry, channels: v.channels, heroProduct: v.heroProduct, objective: v.objective };
  }
  return SM.stripInternal(merged);
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
    // tentative or rejected → refresh from latest data.
    // Preserve a human's scenario SELECTION across syncs: if the stored row was
    // switched off medium (e.g. emergency), re-promote the freshly recomputed
    // variant so the daily refresh updates the variant CONTENTS but keeps the
    // chosen scenario active (and so materialDiff compares like-for-like).
    const carried = (existing.payload && existing.payload.active_scenario) || 'medium';
    if (carried !== 'medium' && entry.standby && entry.standby[carried]) promoteScenario(entry, carried);
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

Every asset must ship with a CREATIVE as well as copy. For each asset write an "image_brief": a vivid 1-2 sentence art-direction prompt for a photoreal product/lifestyle scene of the hero product. Channel rules:
- email / LP heroes: NO text/logos/UI baked into the image (text lives in the page layout) — just scene, props, light, mood; aspirational hero.
- AD creatives (meta / google / tiktok): the headline + offer text MUST be BAKED INTO the creative (state the exact overlay wording, on-palette colour, and placement) — like a real paid ad. Sell the HAPPINESS end-state for P01 (women 45+/busy mums: calmer mornings, steady energy, "feeling like myself again"), NOT ingredients; open on a 1-second scroll-stop; meta = scroll-stopping square, google = clean landscape, tiktok = vertical native hand-held.

Return JSON with exactly this shape:
{
 "email": { "subject": "", "preheader": "", "hero_headline": "", "intro_paragraph": "", "body_paragraph": "", "cta": "", "image_brief": "" },
 "landing": { "hero_headline": "", "hero_sub": "", "why_title": "", "why_bullets": ["","",""], "proof_quote": "", "proof_author": "", "faq": [{"q":"","a":""},{"q":"","a":""}], "cta": "", "image_brief": "" },
 "ads": {
   "meta": { "primary_text": "", "headline": "", "description": "", "image_brief": "" },
   "google": { "headlines": ["","",""], "descriptions": ["",""], "image_brief": "" },
   "tiktok": { "script": "", "caption": "", "image_brief": "" }
 }
}`;
}

const FONT_HEAD = "'Lao MN','Cormorant Garamond',Georgia,serif";
const FONT_BODY = "'Proxima Nova','Helvetica Neue',Arial,sans-serif";

// HTML-escape so LLM copy can't break the markup / inject tags.
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// try.vahdam.*-style presell landing page. Self-contained (inline CSS, no external
// fonts/scripts) so it serves at /lp/:id AND exports as a deploy-ready file.
// creativeUrl (optional) is a generated hero image from the creative pipeline.
function lpHtml(entry, copy, campaignId, creativeUrl) {
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
${creativeUrl ? `<img src="${esc(creativeUrl)}" alt="${esc(L.hero_headline || entry.heroProduct?.title || 'VAHDAM')}" style="width:100%;display:block;max-height:520px;object-fit:cover"/>` : ''}
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

function emailHtml(entry, copy, creativeUrl) {
  const E = copy.email;
  const heroImg = creativeUrl
    ? `<img src="${creativeUrl}" alt="${String(E.hero_headline || entry.heroProduct?.title || 'VAHDAM').replace(/"/g, '')}" style="width:100%;display:block;max-height:440px;object-fit:cover"/>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${E.subject}</title></head>
<body style="margin:0;background:#FBF5EA;color:#171717;font-family:${FONT_BODY}">
<main style="max-width:680px;margin:auto;background:#ffffff">
  <section style="background:#004A2B;color:#FBF5EA;padding:44px 36px;text-align:center">
    <p style="color:#AB8743;letter-spacing:.18em;text-transform:uppercase;font-size:11px;margin:0 0 14px">VAHDAM India</p>
    <h1 style="font-family:${FONT_HEAD};font-size:32px;line-height:1.15;margin:0">${E.hero_headline}</h1>
  </section>
  ${heroImg}
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
    tier: 'premium',
  });
  const json = parseJSON(res.text);
  if (!json || !json.email || !json.landing || !json.ads) throw new Error('LLM copy JSON incomplete');
  return { copy: json, provider: res.provider, model: res.model };
}

function applyCopy(campaign, entry, copy, creatives = {}) {
  const brief = (k) => ({ brief: (k && copy.ads?.[k]?.image_brief) || '', image: null, provider: null });
  if (campaign.assets.email) {
    campaign.assets.email.subject = copy.email.subject || campaign.assets.email.subject;
    campaign.assets.email.preheader = copy.email.preheader || campaign.assets.email.preheader;
    campaign.assets.email.creative = creatives.email || { brief: copy.email.image_brief || '', image: null, provider: null };
    campaign.assets.email.html = emailHtml(entry, copy, campaign.assets.email.creative.image);
    campaign.assets.email.text = `${copy.email.subject}\n${copy.email.preheader}\n\n${copy.email.intro_paragraph}\n\n${copy.email.body_paragraph}\n\n${copy.email.cta}: {{landing_page_url}}`;
  }
  if (campaign.assets.landing_pages?.length) {
    const lp = campaign.assets.landing_pages[0];
    lp.title = copy.landing.hero_headline || lp.title;
    lp.creative = creatives.landing || { brief: copy.landing.image_brief || '', image: null, provider: null };
    lp.html = lpHtml(entry, copy, campaign.campaign_id, lp.creative.image);
    lp.path = `/lp/${campaign.campaign_id}`;
  }
  for (const ad of campaign.assets.ads || []) {
    if (ad.platform === 'meta' && copy.ads.meta) Object.assign(ad, { primary_text: copy.ads.meta.primary_text || ad.primary_text, headline: copy.ads.meta.headline || ad.headline, description: copy.ads.meta.description || ad.description });
    if (ad.platform === 'google' && copy.ads.google) Object.assign(ad, { headlines: copy.ads.google.headlines?.filter(Boolean) || ad.headlines, descriptions: copy.ads.google.descriptions?.filter(Boolean) || ad.descriptions });
    if (ad.platform === 'tiktok' && copy.ads.tiktok) Object.assign(ad, { script: copy.ads.tiktok.script || ad.script, caption: copy.ads.tiktok.caption || ad.caption });
    ad.creative = creatives[ad.platform] || brief(ad.platform);
    ad.creative_brief = ad.creative.brief || ad.creative_brief || '';
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

// ── Creative image generation (reuses the /api/ai/image.js provider cascade) ─

// Invoke the existing image handler in-process via a mock res object, so we get
// the full Gemini → OpenAI → free-Pollinations cascade without an HTTP hop.
async function generateCreativeImage(prompt, { size = '1024x1024', mode = '' } = {}) {
  if (!prompt || !String(prompt).trim()) return null;
  let handler;
  try { handler = require('../ai/image.js'); } catch (_) { return null; }
  return await new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const res = {
      setHeader() {}, status() { return res; }, end() { done(null); return res; },
      json(obj) { done(obj && obj.image_data_url ? { image: obj.image_data_url, provider: obj.provider, model: obj.model } : null); return res; },
    };
    const req = { method: 'POST', body: { prompt: String(prompt).slice(0, 1800), size, quality: 'high', mode } };
    Promise.resolve().then(() => handler(req, res)).catch(() => done(null));
    setTimeout(() => done(null), 60000);
  });
}

// Upload a base64 data-URL creative to the public Supabase Storage bucket and
// return its hosted URL (so we persist a small URL, not a multi-MB data-URL).
// Returns null if it's not a data-URL or storage isn't configured — callers then
// keep the inline data-URL, so creatives still work with no storage set up.
async function uploadCreative(dataUrl, name) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  let supa;
  try { supa = require('./supa.js'); } catch (_) { return null; }
  try {
    const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg';
    const safe = String(name || 'creative').replace(/[^a-z0-9-]/gi, '_').slice(0, 60);
    const path = `${safe}-${Date.now().toString(36)}.${ext}`;
    const { public_url } = await supa.uploadObject('smart-brain-creatives', path, Buffer.from(m[2], 'base64'), m[1]);
    return public_url || null;
  } catch (_) { return null; }
}

// One creative per asset, generated in parallel. Each → {brief, image, provider};
// the image is a hosted Supabase URL when storage is configured, else an inline
// data-URL; falls back to brief-only (image:null) if generation fails.
async function generateCreatives(copy, entry) {
  const hero = entry.heroProduct?.title ? ` Hero product: VAHDAM ${entry.heroProduct.title}.` : '';
  // email/LP heroes are text-free photos (copy lives in the page layout);
  // ad channels render the headline+offer baked into the image (mode:'ad'),
  // since this server path has no client-side canvas overlay step.
  const specs = [
    ['email',  copy.email?.image_brief,       '1536x1024', ''],
    ['landing', copy.landing?.image_brief,    '1536x1024', ''],
    ['meta',   copy.ads?.meta?.image_brief,   '1024x1024', 'ad'],
    ['google', copy.ads?.google?.image_brief, '1536x1024', 'ad'],
    ['tiktok', copy.ads?.tiktok?.image_brief, '1024x1536', 'ad'],
  ];
  const out = {};
  await Promise.all(specs.map(async ([key, rawBrief, size, mode]) => {
    const b = (rawBrief && String(rawBrief).trim()) || `VAHDAM ${entry.heroProduct?.title || 'tea'} hero creative — warm, premium, photoreal.`;
    const gen = await generateCreativeImage(b + hero, { size, mode }).catch(() => null);
    let image = gen?.image || null;
    if (image) image = (await uploadCreative(image, `${entry.id || 'slot'}-${key}`).catch(() => null)) || image;
    out[key] = { brief: b, image, provider: gen?.provider || null };
  }));
  return out;
}

// ── Funnel build (shared by preview + approve) ──────────────────────────────

// Build the full funnel for a slot — template skeleton (GenerationService) plus
// LLM-written copy applied to the email + landing page + ads. Pure: it does NOT
// touch the DB or change any slot's status. Both previewEntry() and approveEntry()
// call this so a reviewer sees EXACTLY what approving will produce.
async function buildCampaign(entry, config, { id = null, withCreatives = true } = {}) {
  const campaign = new GenerationService(config).generate(entry);
  let copyMeta = { provider: 'template-fallback', model: null, creatives: 'none' };
  try {
    const { copy, provider, model } = await writeCopyWithLLM(entry);
    const creatives = withCreatives ? await generateCreatives(copy, entry) : {};
    applyCopy(campaign, entry, copy, creatives);
    const imgProviders = [...new Set(Object.values(creatives).map((c) => c && c.provider).filter(Boolean))];
    copyMeta = { provider, model, creatives: imgProviders.length ? imgProviders.join(',') : 'briefs-only' };
  } catch (e) {
    console.warn('[smart-brain] LLM copy failed, using template assets:', e.message);
  }
  campaign.copywriter = copyMeta;
  campaign.calendar_entry_id = entry.id || id || null;
  attachMasterPrompts(campaign, entry);
  return campaign;
}

// Resolve a slot's entry payload — from the inline entry the UI already holds,
// or by id from the stored calendar. Used by preview + approve.
async function resolveEntry({ id, inlineEntry, config, db }) {
  if (inlineEntry) return { entry: inlineEntry, row: null };
  if (db.connected && id) {
    const rows = await db.select(config.tableNames.calendarEntries, { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
    const row = rows && rows[0];
    if (row) return { entry: row.payload, row };
  }
  return { entry: null, row: null };
}

// ── Preview (generate-on-demand, NO persistence, NO status change) ───────────

async function previewEntry({ id, reviewer = null, config: cfg = {}, entry: inlineEntry = null } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const { entry } = await resolveEntry({ id, inlineEntry, config, db });
  if (!entry) throw new Error(`Calendar entry ${id || ''} not found — run a daily sync first or pass the entry inline.`);

  // Preview EXACTLY what approving produces: the active scenario's operational
  // fields, internal/projection keys stripped (so numbers can't reach assets).
  const campaign = await buildCampaign(effectiveEntry(entry), config, { id });
  campaign.status = 'preview';
  return {
    ok: true,
    preview: true,
    campaign,
    copywriter: campaign.copywriter,
    email_html: campaign.assets.email?.html || null,
    landing_html: campaign.assets.landing_pages?.[0]?.html || null,
    ads: campaign.assets.ads || [],
  };
}

// ── Approve / reject ────────────────────────────────────────────────────────

async function approveEntry({ id, reviewer = null, config: cfg = {}, entry: inlineEntry = null } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const { entry, row } = await resolveEntry({ id, inlineEntry, config, db });
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

  // buildCampaign generates copy + creatives and attaches master prompts. Use
  // the ACTIVE scenario (medium unless a human switched the slot), internal keys
  // stripped so projected revenue/spend can never reach the asset builders.
  const campaign = await buildCampaign(effectiveEntry(entry), config, { id });
  const copyMeta = campaign.copywriter;
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

// ── Scenario switch ("break" button + revert) ───────────────────────────────
// Promotes a pre-staged standby scenario (emergency / instant / best /
// conservative) into the active fields of affected slots — or reverts to medium.
// scope: 'all' (every active future slot — the big red button), {date,market}, or
// {ids:[...]}. Switching a slot that already generated assets resets it to
// tentative + clears the prior campaign so the new scenario re-earns human
// sign-off and fresh assets. activateScenario({scenario:'medium'}) reverts.
async function activateScenario({ scenario, reviewer = null, scope = 'all', config: cfg = {} } = {}) {
  if (!SM.SCENARIO_LABELS.includes(scenario)) throw new Error(`Unknown scenario "${scenario}". Use one of ${SM.SCENARIO_LABELS.join(', ')}.`);
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return { ok: true, skipped: true, reason: 'Supabase env not configured — nothing persisted to switch.', scenario };

  let rows;
  if (scope && Array.isArray(scope.ids) && scope.ids.length) {
    rows = await db.select(config.tableNames.calendarEntries, { filters: { id: `in.(${scope.ids.join(',')})` }, limit: 1000 }).catch(() => []);
  } else if (scope && scope.date && scope.market) {
    rows = await db.select(config.tableNames.calendarEntries, { filters: { date: `eq.${scope.date}`, market: `eq.${scope.market}` }, limit: 100 }).catch(() => []);
  } else {
    rows = await db.select(config.tableNames.calendarEntries, { filters: { date: `gte.${todayIso()}`, status: 'neq.archived' }, order: 'date.asc', limit: 1000 }).catch(() => []);
  }

  const switched = [];
  const skipped = [];
  for (const row of rows || []) {
    const payload = row.payload || {};
    const prev = payload.active_scenario || 'medium';
    if (prev === scenario) { skipped.push({ id: row.id, reason: 'already-active' }); continue; }
    if (scenario !== 'medium' && !(payload.standby && payload.standby[scenario])) { skipped.push({ id: row.id, reason: 'no-standby-variant (older row — run a daily sync first)' }); continue; }

    promoteScenario(payload, scenario);
    const log = Array.isArray(row.change_log) ? row.change_log.slice(-30) : [];
    log.push({ at: nowIso(), kind: 'scenario_switched', detail: `${prev} → ${scenario} by ${reviewer || 'operator'} (scope ${scope && scope !== 'all' ? JSON.stringify(scope) : 'all'})` });
    const patch = { payload, change_log: log, updated_at: nowIso() };

    // Switching invalidates any already-generated assets — require fresh sign-off.
    const hadAssets = row.generated_campaign_id || row.status === 'approved' || row.status === 'final';
    if (hadAssets) Object.assign(patch, { status: 'tentative', generated_campaign_id: null, approved_by: null, approved_at: null });
    // The switch is itself a deliberate human action, so it may flip approved rows;
    // restrict only to non-archived to avoid resurrecting past slots.
    const upd = await db.update(config.tableNames.calendarEntries, { id: `eq.${row.id}`, status: 'neq.archived' }, patch);
    if (upd.ok && (upd.rows || []).length) switched.push(row.id);
    else skipped.push({ id: row.id, reason: upd.ok ? 'conditional-update-missed' : upd.warning });
  }
  return {
    ok: true, scenario, scope: scope || 'all',
    switched_count: switched.length, switched, skipped,
    note: 'Slots with generated assets were reset to tentative — re-approve to regenerate under the new scenario. Revert with scenario="medium".',
  };
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

module.exports = {
  syncDaily, getPlan, previewEntry, approveEntry, rejectEntry, activateScenario, landingPageHtml, buildCampaign,
  // exported for unit testing (pure scenario helpers)
  attachScenarioLayer, promoteScenario, effectiveEntry, buildStandbyVariant,
};
