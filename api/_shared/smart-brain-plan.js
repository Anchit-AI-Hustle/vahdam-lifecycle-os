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
// Guaranteed-online fallback: a real catalog product photo (Shopify CDN) so a
// creative never ships an unrenderable data: URI when generation/upload fails.
const catalogImage = require('./catalog-image.js');
// Shared mailer renderer, the SAME one the Mailer Studio / Mailer Calendar use,
// so Smart Brain mailers come out as the same two named types (2 Text + 2 Text
// + Visual) at the same quality. Guarded: falls back to the local single mailer.
let renderTextVariant = null;
try { renderTextVariant = require('./calendar-trigger.js').helpers.renderTextVariant; } catch (_) { renderTextVariant = null; }
// Copywriting framework library — the SAME one the Mailer Calendar uses. Two
// diverging frameworks (A + B) drive two genuinely DIFFERENT copy directions per
// slot, so the four mailer variants, the A/B ads and the A/B landing pages read
// distinctly instead of being one copy in two skins. Unifies the variant styles
// across Smart Brain, Mailer Calendar and Plan Calendar.
const CF = require('./copy-frameworks.js');

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

function copyPrompt(entry, fw = null) {
  const hooks = (entry.competitorContext || []).flatMap((c) => (c.trendingHooks || []).map((h) => h.hook)).slice(0, 5);
  const fwLine = fw
    ? `\nCOPY FRAMEWORK: structure the copy with the ${fw.name} framework (${fw.full || fw.name}); the opening beat lands in the subject + hero_headline, the middle beats across intro_paragraph and body_paragraph in order, and the final beat on the cta. Do NOT name the framework in the copy, let the structure do the work.`
    : '';
  return `Write campaign copy for this planned slot. Context:
- Market: ${entry.market} | Cohort: ${entry.cohort?.name} | Objective: ${entry.objective}
- Hero product: ${entry.heroProduct?.title} (${entry.heroProduct?.category || 'tea'})
- ${entry.festival ? `Seasonal moment: ${entry.festival.name}` : 'No festival; evergreen angle.'}
- Rationale: ${entry.rationale || ''}
- Competitor hooks trending (for awareness only, do NOT copy): ${hooks.join(' | ') || 'n/a'}${fwLine}

Every asset must ship with a CREATIVE as well as copy. For each asset write an "image_brief": a vivid 1-2 sentence art-direction prompt for a photoreal product/lifestyle scene of the hero product. Channel rules (ALL creatives are TEXT-FREE photographs — never describe overlaid words, headlines, prices, logos or UI in the image_brief; diffusion models cannot spell and render garbled fake letterforms, and the real ad copy is rendered natively by the platform, not painted into the pixels):
- email / LP heroes: just scene, props, light, mood; aspirational hero.
- AD creatives (meta / google / tiktok): a scroll-stopping TEXT-FREE photograph that sells the HAPPINESS end-state for P01 (women 45+/busy mums: calmer mornings, steady energy, "feeling like myself again"), NOT ingredients; open on a 1-second scroll-stop. Compose for the placement: meta = square, google = clean landscape, tiktok = vertical native hand-held. State only the scene, subject, light and mood - no words in the frame.

Return JSON with exactly this shape:
{
 "email": { "subject": "", "subject_alt1": "", "subject_alt2": "", "preheader": "", "hero_headline": "", "intro_paragraph": "", "body_paragraph": "", "cta": "", "image_brief": "" },
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
    <p class="who">- ${esc(L.proof_author || 'A VAHDAM regular')}</p>
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

// Build the same mailer taxonomy as the Mailer Studio / Mailer Calendar: two
// named types, two variants each: 2 Text (colour + type + structural elements,
// no media) and 2 Text + Visual (with a hero image). Uses the shared
// renderTextVariant so look + quality match across features. Returns null if the
// shared renderer is unavailable (caller keeps the single local mailer).
function emailPlaceholder(label, w, h) {
  const t = String(label || 'Product image').replace(/[<&>]/g, ' ').slice(0, 42);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#FBF5EA"/><rect x="10" y="10" width="${w - 20}" height="${h - 20}" fill="none" stroke="#AB8743" stroke-width="2" stroke-dasharray="9 7"/><text x="50%" y="45%" text-anchor="middle" fill="#004A2B" font-family="Georgia,serif" font-size="21">${t}</text><text x="50%" y="59%" text-anchor="middle" fill="#AB8743" font-family="Arial,sans-serif" font-size="13">Drop your image URL here · ${w} x ${h}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
function variantMeta(copy) {
  const E = copy.email || {};
  return {
    subject_line: E.subject || '',
    subject_alts: [E.subject_alt1, E.subject_alt2].filter(Boolean),
    preview_text: E.preheader || '',
    hero_headline: E.hero_headline || E.subject || '',
    hero_subline: E.subheadline || E.preheader || '',
    cta_text: E.cta || 'Shop the edit',
  };
}
function renderVariant(entry, copy, style, img) {
  const E = copy.email || {};
  const heroProduct = (entry.heroProduct && entry.heroProduct.title) || entry.theme || '';
  return renderTextVariant({
    style, subject: E.subject, preheader: E.preheader,
    hero_headline: E.hero_headline || E.subject || heroProduct,
    hero_subline: E.subheadline || E.preheader || '',
    body_blocks: [
      E.intro_paragraph ? { heading: '', body: E.intro_paragraph } : null,
      E.body_paragraph ? { heading: '', body: E.body_paragraph } : null,
    ].filter(Boolean),
    cta_text: E.cta || 'Shop the edit', cta_url: '{{landing_page_url}}',
    market: entry.market, hero_product: heroProduct, hero_image_url: img || undefined,
  });
}
// Four variants in the SAME taxonomy as the Mailer Calendar: 2 Text + 2 Text +
// Visual, each labelled by its copy framework, with copyA driving the A-slots and
// copyB the B-slots so the two directions read genuinely differently.
function emailVariants(entry, copyA, copyB, fwA, fwB, creativeUrl) {
  if (!renderTextVariant) return null;
  const heroProduct = (entry.heroProduct && entry.heroProduct.title) || entry.theme || '';
  const heroImg = creativeUrl || catalogImage.imageFor(entry, entry.market) || emailPlaceholder(heroProduct, 536, 340);
  const nA = (fwA && fwA.name) || 'Concise';
  const nB = (fwB && fwB.name) || 'Editorial';
  return [
    { key: 'text_a',   type: 'Text',          label: `Text · ${nA}`,          framework: fwA && fwA.key, ...variantMeta(copyA), html: renderVariant(entry, copyA, 'pure') },
    { key: 'text_b',   type: 'Text',          label: `Text · ${nB}`,          framework: fwB && fwB.key, ...variantMeta(copyB), html: renderVariant(entry, copyB, 'editorial') },
    { key: 'visual_a', type: 'Text + Visual', label: `Text + Visual · ${nA}`, framework: fwA && fwA.key, ...variantMeta(copyA), html: renderVariant(entry, copyA, 'visual', heroImg) },
    { key: 'visual_b', type: 'Text + Visual', label: `Text + Visual · ${nB}`, framework: fwB && fwB.key, ...variantMeta(copyB), html: renderVariant(entry, copyB, 'visual', heroImg) },
  ];
}

function emailHtml(entry, copy, creativeUrl) {
  const E = copy.email;
  const img = creativeUrl || catalogImage.imageFor(entry, entry.market);
  const heroImg = img
    ? `<img src="${img}" alt="${String(E.hero_headline || entry.heroProduct?.title || 'VAHDAM').replace(/"/g, '')}" style="width:100%;display:block;max-height:440px;object-fit:cover"/>`
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

async function writeCopyWithLLM(entry, fw = null) {
  const sysLine = fw ? (() => { try { return '\n' + CF.copyFrameworkSystemLine(fw); } catch (_) { return ''; } })() : '';
  const res = await callLLM({
    systemPrompt: BRAND_SYSTEM + sysLine,
    userMessage: copyPrompt(entry, fw),
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

// Deep brand scrub of an LLM copy object: every string through sanitizeBrand
// (banned phrases → preferred lexicon, em/en dashes → hyphens). Safe no-op if
// sanitizeBrand is unavailable.
function scrubCopyDeep(o) {
  const clean = (s) => { try { return SM.sanitizeBrand(String(s)); } catch (_) { return s; } };
  const walk = (v) => {
    if (typeof v === 'string') return clean(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(o || {});
}

function applyCopy(campaign, entry, copyA, copyB, fwA, fwB, creatives = {}) {
  const briefFor = (copy, k) => ({ brief: (k && copy.ads?.[k]?.image_brief) || '', image: null, provider: null });
  if (campaign.assets.email) {
    campaign.assets.email.subject = copyA.email.subject || campaign.assets.email.subject;
    campaign.assets.email.preheader = copyA.email.preheader || campaign.assets.email.preheader;
    campaign.assets.email.creative = creatives.email || { brief: copyA.email.image_brief || '', image: null, provider: null };
    const heroImg = campaign.assets.email.creative.image;
    // Four framework variants: copyA drives the A-slots, copyB the B-slots.
    const emailVars = emailVariants(entry, copyA, copyB, fwA, fwB, heroImg);
    campaign.assets.email.variants = emailVars || null;
    // Primary html = the Hero Text + Visual (A) variant (shared renderer) so the
    // preview matches the Studio; falls back to the local mailer if variants off.
    campaign.assets.email.html = (emailVars && emailVars.find((v) => v.key === 'visual_a').html)
      || emailHtml(entry, copyA, heroImg);
    campaign.assets.email.text = `${copyA.email.subject}\n${copyA.email.preheader}\n\n${copyA.email.intro_paragraph}\n\n${copyA.email.body_paragraph}\n\n${copyA.email.cta}: {{landing_page_url}}`;
  }
  (campaign.assets.landing_pages || []).forEach((lp) => {
    const isB = lp.variant === 'B';
    // A and B are BOTH real LLM copy, written under different frameworks, so the
    // pair genuinely differs (no more mechanical "The ritual behind …"). A leads
    // with the generated hero image, B with the real catalog product photo.
    const copy = isB ? copyB : copyA;
    const img = isB
      ? (catalogImage.imageFor(entry, entry.market) || (creatives.landing && creatives.landing.image) || null)
      : ((creatives.landing && creatives.landing.image) || catalogImage.imageFor(entry, entry.market) || null);
    lp.title = (copy.landing && copy.landing.hero_headline) || lp.title;
    lp.creative = { brief: (copy.landing && copy.landing.image_brief) || '', image: img, provider: isB ? 'catalog' : ((creatives.landing && creatives.landing.provider) || 'catalog') };
    lp.html = lpHtml(entry, copy, campaign.campaign_id, img);
    lp.path = isB ? `/lp/${campaign.campaign_id}?v=b` : `/lp/${campaign.campaign_id}`;
  });
  for (const ad of campaign.assets.ads || []) {
    const isB = ad.variant === 'B';
    // BOTH variants take real LLM copy now: A from copyA, B from copyB (the two
    // framework directions). No static template strings repeated across slots.
    const copy = isB ? copyB : copyA;
    if (ad.platform === 'meta' && copy.ads.meta) Object.assign(ad, { primary_text: copy.ads.meta.primary_text || ad.primary_text, headline: copy.ads.meta.headline || ad.headline, description: copy.ads.meta.description || ad.description });
    if (ad.platform === 'google' && copy.ads.google) Object.assign(ad, { headlines: copy.ads.google.headlines?.filter(Boolean) || ad.headlines, descriptions: copy.ads.google.descriptions?.filter(Boolean) || ad.descriptions });
    if (ad.platform === 'tiktok' && copy.ads.tiktok) Object.assign(ad, { script: copy.ads.tiktok.script || ad.script, caption: copy.ads.tiktok.caption || ad.caption });
    // A = the generated creative; B = the real catalog product photo (hosted) so
    // the pair is visually distinct without doubling image-generation cost.
    if (isB) {
      const catImg = catalogImage.imageFor(entry, entry.market);
      ad.creative = catImg ? { brief: ad.creative_brief || '', image: catImg, provider: 'catalog' } : (creatives[ad.platform] || briefFor(copy, ad.platform));
    } else {
      ad.creative = creatives[ad.platform] || briefFor(copy, ad.platform);
    }
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
  // ALL channels get TEXT-FREE photographs (mode:''). Diffusion models cannot
  // spell, so baking a headline/offer into the pixels (the old mode:'ad') always
  // produced garbled, fake-language letterforms. Real ad copy lives in the ad's
  // primary-text/headline fields (which Meta/Google/TikTok render as native
  // platform text), never in the image itself — which is also what those
  // platforms recommend. Email/LP copy lives in the HTML layout as before.
  const specs = [
    ['email',   copy.email?.image_brief,       '1536x1024', ''],
    ['landing', copy.landing?.image_brief,     '1536x1024', ''],
    ['meta',    copy.ads?.meta?.image_brief,   '1024x1024', ''],
    ['google',  copy.ads?.google?.image_brief, '1536x1024', ''],
    ['tiktok',  copy.ads?.tiktok?.image_brief, '1024x1536', ''],
  ];
  const out = {};
  await Promise.all(specs.map(async ([key, rawBrief, size, mode]) => {
    const b = (rawBrief && String(rawBrief).trim()) || `VAHDAM ${entry.heroProduct?.title || 'tea'} hero creative — warm, premium, photoreal.`;
    const gen = await generateCreativeImage(b + hero, { size, mode }).catch(() => null);
    let image = gen?.image || null;
    // HOST-ALL-ASSETS: never let a data: URI reach a persisted/emailed asset
    // (email clients strip them). Upload the generated image to Supabase Storage
    // and use the hosted URL; if that fails (or nothing was generated), fall back
    // to the real catalog product photo (Shopify CDN, always online). Drop the
    // image only if even that is unavailable.
    if (image && /^data:/i.test(image)) {
      const hosted = await uploadCreative(image, `${entry.id || 'slot'}-${key}`).catch(() => null);
      image = hosted || catalogImage.imageFor(entry, entry.market) || null;
    } else if (!image) {
      image = catalogImage.imageFor(entry, entry.market) || null;
    }
    out[key] = { brief: b, image, provider: gen?.provider || (image ? 'catalog-fallback' : null) };
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
    // Two diverging copy frameworks → two genuinely different directions, written
    // in parallel (same wall-clock as one call). A = the objective's preferred
    // framework; B = a deterministically-chosen different one. Partial-failure
    // tolerant: if one call fails we ship both slots from the one that succeeded.
    const fwA = CF.pickCopyFramework({ play_key: entry.objective || '', cohort_key: (entry.cohort && (entry.cohort.key || entry.cohort.name)) || '', seed: entry.id || entry.date || '' });
    const otherKeys = Object.keys(CF.COPY_FRAMEWORKS).filter((k) => k !== fwA.key);
    const fwB = CF.frameworkByKey(otherKeys[CF.stableIndex(`${entry.id || entry.date || ''}|b`, otherKeys.length)]) || fwA;
    const [pA, pB] = await Promise.allSettled([writeCopyWithLLM(entry, fwA), writeCopyWithLLM(entry, fwB)]);
    if (pA.status !== 'fulfilled' && pB.status !== 'fulfilled') {
      throw new Error('copy generation failed for both directions: ' + String((pA.reason && pA.reason.message) || pA.reason));
    }
    const rawA = pA.status === 'fulfilled' ? pA.value : pB.value;
    const rawB = pB.status === 'fulfilled' ? pB.value : pA.value;
    const provider = rawA.provider || rawB.provider;
    const model = rawA.model || rawB.model;
    // Brand scrub EVERY generated string (no banned phrases, no em/en dashes)
    // before it is baked into the mailer, landing page and ad rows. Persisted +
    // customer-served output must not rely on the prompt alone.
    const copyA = scrubCopyDeep(rawA.copy);
    const copyB = scrubCopyDeep(rawB.copy);
    const creatives = withCreatives ? await generateCreatives(copyA, entry) : {};
    applyCopy(campaign, entry, copyA, copyB, fwA, fwB, creatives);
    const imgProviders = [...new Set(Object.values(creatives).map((c) => c && c.provider).filter(Boolean))];
    copyMeta = { provider, model, frameworks: [fwA.key, fwB.key], creatives: imgProviders.length ? imgProviders.join(',') : 'briefs-only' };
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
  const { entry, row } = await resolveEntry({ id, inlineEntry, config, db });
  if (!entry) throw new Error(`Calendar entry ${id || ''} not found — run a daily sync first or pass the entry inline.`);

  // Approved/final slots always return the FINAL saved campaign — the reviewer
  // sees exactly what ships, never a fresh regeneration.
  if (db.connected && row && (row.status === 'approved' || row.status === 'final') && row.generated_campaign_id) {
    const fin = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${row.generated_campaign_id}` }, limit: 1 }).catch(() => []);
    const c = fin && fin[0] && fin[0].payload;
    if (c) {
      return {
        ok: true, preview: false, persisted: true, campaign: c,
        copywriter: c.copywriter,
        email_html: c.assets?.email?.html || null,
        email_variants: c.assets?.email?.variants || null,
        landing_html: c.assets?.landing_pages?.[0]?.html || null,
        ads: c.assets?.ads || [],
      };
    }
  }

  // Preview EXACTLY what approving produces. If the prebuild queue already built
  // this slot, show that persisted bundle (instant, and identical to what ships);
  // otherwise generate on demand. Internal/projection keys stripped so numbers
  // can't reach the asset builders.
  let campaign = null;
  const prebuiltId = entry && entry[PREBUILD_MARKER] && entry[PREBUILD_MARKER].campaign_id;
  if (db.connected && prebuiltId) {
    const pc = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${prebuiltId}` }, limit: 1 }).catch(() => []);
    if (pc && pc[0] && pc[0].payload) campaign = pc[0].payload;
  }
  // Fallback (slot not prebuilt yet): build copy + layout WITHOUT images. Preview
  // must be fast — generating 5 images inline here overran the function limit and
  // returned a non-JSON platform timeout page ("Preview failed: ... not valid
  // JSON"). Images appear in preview once the prebuild queue has built the slot.
  if (!campaign) campaign = await buildCampaign(effectiveEntry(entry), config, { id, withCreatives: false });
  campaign.status = 'preview';
  return {
    ok: true,
    preview: true,
    campaign,
    copywriter: campaign.copywriter,
    email_html: campaign.assets.email?.html || null,
    email_variants: campaign.assets.email?.variants || null,
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

  // Reuse the FULL prebuilt campaign (LLM copy + images) when the prebuild queue
  // already built this slot — approval then just locks + publishes, no wait, no
  // regeneration (so what the reviewer saw in preview is exactly what ships).
  let campaign = null;
  const prebuiltId = entry && entry[PREBUILD_MARKER] && entry[PREBUILD_MARKER].campaign_id;
  if (db.connected && prebuiltId) {
    const pc = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${prebuiltId}` }, limit: 1 }).catch(() => []);
    if (pc && pc[0] && pc[0].payload) campaign = pc[0].payload;
  }
  // buildCampaign generates copy + creatives and attaches master prompts. Use
  // the ACTIVE scenario (medium unless a human switched the slot), internal keys
  // stripped so projected revenue/spend can never reach the asset builders.
  if (!campaign) campaign = await buildCampaign(effectiveEntry(entry), config, { id });
  const copyMeta = campaign.copywriter || { provider: 'prebuilt', model: null };
  campaign.status = 'ready_for_human_final_check';
  campaign.calendar_entry_id = entry.id || id;

  const persisted = { campaign: null, ads: null, landing: null, calendar: null };
  if (db.connected) {
    // Publish: store the campaign at review status + mirror ads/LP into the dashboards.
    const p = await persistCampaignAssets(db, config, campaign, { status: campaign.status, origin: 'smart-brain', reviewer, mirror: true });
    persisted.campaign = p.campaign; persisted.ads = p.ads; persisted.landing = p.landing;
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

async function landingPageHtml(id, cfg = {}, variant = null) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return null;
  const camp = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
  const lps = camp?.[0]?.payload?.assets?.landing_pages || [];
  // ?v=b serves the story-led B variant; default serves A (the first LP).
  const want = /^b$/i.test(String(variant || '')) ? (lps.find((l) => l.variant === 'B') || lps[1]) : (lps.find((l) => l.variant === 'A') || lps[0]);
  const html = want?.html;
  if (html) return html;
  // fall back to landing_pages_generated (numeric id or campaign_id in payload)
  const filters = /^\d+$/.test(String(id)) ? { id: `eq.${id}` } : { 'payload->>campaign_id': `eq.${id}` };
  const lp = await db.select(config.tableNames.landingPagesGenerated, { filters, limit: 1 }).catch(() => []);
  return lp?.[0]?.payload?.html || null;
}

// ── Convergent asset prebuild queue ─────────────────────────────────────────
// Contract (product owner, 2026-07-09): every slot in the 90-day rolling window
// must not merely EXIST but arrive with its FULL asset bundle already built —
// LLM-written copy AND generated images for the mailer + Meta/Google/TikTok ads
// + landing page — so a reviewer only ever approves, never waits on generation.
//
// A single serverless invocation cannot build ~180 slots (each is ~30-60s of LLM
// copy + 5 parallel image generations), so prebuildAssets() processes a small
// batch per call and the caller (the smart-brain cron / prebuild route) re-fires
// it until `remaining` hits 0, then it idles. Fully idempotent + resumable: a
// slot counts as built once its payload carries a __prebuilt marker pointing at
// a persisted campaign. Daily sync only rewrites a slot's payload (dropping the
// marker) when it MATERIALLY re-plans that slot, which correctly forces a rebuild
// of the now-stale assets. Human-approved/final slots are skipped (they own a
// real campaign already).
const PREBUILD_MARKER = '__prebuilt';

function isPrebuilt(row) {
  const p = row && row.payload && row.payload[PREBUILD_MARKER];
  return !!(p && p.campaign_id);
}
function creativeCount(campaign) {
  let n = 0;
  const a = campaign && campaign.assets;
  if (!a) return 0;
  if (a.email && a.email.creative && a.email.creative.image) n += 1;
  for (const lp of a.landing_pages || []) if (lp && (lp.creative?.image || lp.hero_image)) n += 1;
  for (const ad of a.ads || []) if (ad && (ad.creative?.image || ad.image)) n += 1;
  return n;
}

// Persist a generated campaign + (optionally) mirror its ads/LP into the Ads and
// Landing Pages dashboards. Shared by approveEntry (mirror=true — publish) and
// prebuildAssets (mirror=false — a draft that only lands in smart_generated_campaigns,
// so unapproved drafts never flood the dashboards; /lp/:id still resolves it via
// landingPageHtml, which reads smart_generated_campaigns first).
async function persistCampaignAssets(db, config, campaign, { status, origin, reviewer = null, mirror = true } = {}) {
  const out = { campaign: null, ads: null, landing: null };
  out.campaign = await db.upsert(config.tableNames.generatedCampaigns, [{ id: campaign.campaign_id, payload: campaign, status, updated_at: nowIso() }], 'id');
  if (!mirror) return out;
  const adRows = (campaign.assets.ads || []).map((ad) => ({
    channel: ad.platform, name: campaign.name, market: campaign.market, objective: campaign.objective,
    audience: campaign.audience?.name, copy: ad, creative_prompt: ad.creative_brief || ad.script || '', origin,
    user_email: reviewer || null,
  }));
  if (adRows.length) out.ads = await db.insert(config.tableNames.adsGenerated, adRows);
  const lp = campaign.assets.landing_pages?.[0];
  if (lp) out.landing = await db.insert(config.tableNames.landingPagesGenerated, [{
    paired_with: campaign.assets.email ? 'mailer' : (campaign.assets.ads?.[0]?.platform || 'meta'),
    name: lp.title || campaign.name, market: campaign.market,
    hero: lp.title || '', payload: { campaign_id: campaign.campaign_id, path: lp.path, html: lp.html, sections: lp.sections, master_prompt: lp.master_prompt },
    origin, user_email: reviewer || null,
  }]);
  return out;
}

async function prebuildAssets({ config: cfg = {}, batchSize = 1, sinceDate = null } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return { ok: true, skipped: true, reason: 'Supabase env not configured — nothing to prebuild.', built: [], failed: [], batch: 0, remaining: 0 };
  const start = sinceDate || todayIso();
  // Candidates: future, still writable (tentative/rejected — approved/final own a
  // real campaign), nearest-date first so imminent slots build first.
  const rows = (await db.select(config.tableNames.calendarEntries, {
    filters: { date: `gte.${start}`, status: SYNC_WRITABLE_STATUSES },
    order: 'date.asc', limit: 1000,
  }).catch(() => [])) || [];
  const pending = rows.filter((r) => !isPrebuilt(r));
  const batch = pending.slice(0, Math.max(1, batchSize));
  const built = [];
  const failed = [];
  for (const row of batch) {
    try {
      const entry = { ...(row.payload || {}), id: row.id };
      // FULL build: LLM copy + generated images (withCreatives:true) for the
      // mailer + ads + landing page — the same output an approval produces.
      const campaign = await buildCampaign(effectiveEntry(entry), config, { id: row.id, withCreatives: true });
      campaign.status = 'prebuilt';
      campaign.calendar_entry_id = row.id;
      await persistCampaignAssets(db, config, campaign, { status: 'prebuilt', origin: 'smart-brain-prebuild', mirror: false });
      // Mark the slot built — merge the marker into the LATEST payload and guard
      // on writable status so a human approval landing mid-build is never clobbered.
      const fresh = (await db.select(config.tableNames.calendarEntries, { filters: { id: `eq.${row.id}` }, limit: 1 }).catch(() => []))?.[0];
      if (fresh && (fresh.status === 'tentative' || fresh.status === 'rejected')) {
        const payload = { ...(fresh.payload || {}) };
        payload[PREBUILD_MARKER] = { campaign_id: campaign.campaign_id, at: nowIso(), images: creativeCount(campaign), copy: campaign.copywriter?.provider || null };
        const log = Array.isArray(fresh.change_log) ? fresh.change_log.slice(-30) : [];
        log.push({ at: nowIso(), kind: 'prebuilt', detail: `Assets prebuilt (mailer + ads + landing page; copy ${campaign.copywriter?.provider || 'template'}, ${creativeCount(campaign)} images); campaign ${campaign.campaign_id}.` });
        await db.update(config.tableNames.calendarEntries, { id: `eq.${row.id}`, status: SYNC_WRITABLE_STATUSES }, { payload, change_log: log, updated_at: nowIso() });
      }
      built.push({ id: row.id, date: row.date, market: row.market, campaign_id: campaign.campaign_id, images: creativeCount(campaign) });
    } catch (e) {
      failed.push({ id: row.id, error: e.message });
    }
  }
  return { ok: true, mode: 'db-linked', built, failed, batch: batch.length, remaining: Math.max(0, pending.length - built.length) };
}

// ── Safe DB diagnostic ──────────────────────────────────────────────────────
// Reports which Supabase PROJECT + key role the calendar adapter resolves and
// the HTTP status when reading key tables. No secret values are returned — only
// booleans, the project ref (already public via /api/public-config), the key's
// role claim (anon/service_role), and HTTP status codes. Pinpoints whether the
// 401s are a URL/key project mismatch vs. a missing table.
async function dbCheck({ config: cfg = {} } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  let urlHost = '';
  try { urlHost = new URL(db.url).host; } catch (_) { urlHost = db.url ? 'set' : ''; }
  const urlRef = urlHost.split('.')[0] || '';
  let keyRole = db.key ? 'opaque' : 'none', keyRef = '';
  try { const p = JSON.parse(Buffer.from(String(db.key).split('.')[1] || '', 'base64').toString('utf8')); keyRole = p.role || keyRole; keyRef = p.ref || ''; } catch (_) {}
  const tables = ['smart_calendar_entries', 'smart_generated_campaigns', 'smart_users', 'smart_orders'];
  const probes = {};
  await Promise.all(tables.map(async (t) => {
    try {
      const r = await fetch(`${db.url}/rest/v1/${t}?select=id&limit=1`, { headers: db.headers() });
      probes[t] = { status: r.status, ok: r.ok };
    } catch (e) { probes[t] = { status: 0, error: String((e && e.message) || e).slice(0, 80) }; }
  }));
  return {
    ok: true,
    calendar_adapter: {
      url_project_ref: urlRef,
      key_role: keyRole,
      key_project_ref: keyRef,
      url_key_same_project: keyRef ? (urlRef === keyRef) : null,
      probes,
    },
    env_present: {
      SMART_BRAIN_SUPABASE_URL: !!process.env.SMART_BRAIN_SUPABASE_URL,
      SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY,
      SMART_BRAIN_SUPABASE_KEY: !!process.env.SMART_BRAIN_SUPABASE_KEY,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    },
  };
}

module.exports = {
  syncDaily, getPlan, previewEntry, approveEntry, rejectEntry, activateScenario, landingPageHtml, buildCampaign,
  prebuildAssets, dbCheck,
  // exported for unit testing (pure scenario helpers)
  attachScenarioLayer, promoteScenario, effectiveEntry, buildStandbyVariant,
};
