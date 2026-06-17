'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SMART BRAIN — Generation Engine.
//
// For an approved calendar slot, generate the COMPLETE asset set as one coherent
// funnel and persist a PLATFORM-READY campaign_specs row:
//   creative → landing page → mailer follow-up, plus retargeting + lookalike
//   audience logic (definitions only — NO live platform push; that's phase 2).
//
// The output `platform_payload` is normalized per channel so the future
// live-push adapters (Google/Meta/TikTok/Klaviyo/WebEngage) consume it without
// a refactor. Own-data winners (brain-analysis) condition the prompt; the
// competitor benchmark feed is consulted read-only for offer positioning.
//
// Every generated spec starts as needs_review — HITL is mandatory at launch.
// ─────────────────────────────────────────────────────────────────────────────

const supa = require('./supa');
const callLLM = require('./llm');
const analysis = require('./brain-analysis');
const calendar = require('./brain-calendar');

// VAHDAM brand constants (source of truth: CLAUDE.md / Brand style guide).
const BRAND = {
  palette: { green: '#004A2B', gold: '#AB8743', ink: '#171717', cream: '#FBF5EA' },
  headingFont: "'Lao MN','Cormorant Garamond',Georgia,serif",
  bodyFont: "'Proxima Nova','Helvetica Neue',Arial,sans-serif",
  bannedPhrases: ['wellness journey', 'transform', 'liquid gold', 'game-changer', 'limited time', 'hurry', 'last chance'],
  preferred: ['ritual', 'restore', 'balance', 'origin', 'single-estate', 'hand-picked', 'steep', 'heritage', 'crafted']
};

function storeBase(market) {
  return ({ US: 'www.vahdamteas.com', UK: 'uk.vahdamteas.com', IN: 'www.vahdamindia.com',
            EU: 'eu.vahdamteas.com', AU: 'au.vahdamteas.com' }[market] || 'www.vahdamteas.com');
}

// Confidence drives how much human verification is required (HITL load tapers
// as the system proves itself). Hard floor: never auto-final at launch.
async function currentConfidence({ channel, cohort_key }) {
  try {
    const recent = await supa.select('campaign_specs', {
      filters: { channel: `eq.${channel}`, status: 'eq.final' }, order: 'updated_at.desc', limit: 20
    });
    // More verified history on this channel → higher confidence (capped 0.85 so
    // human verification is never fully removed).
    return Math.min(0.85, 0.2 + recent.length * 0.03);
  } catch { return 0.2; }
}

// Build the LLM strategy + copy for the funnel in one structured call.
async function generateFunnelContent(slot, winners, benchmark) {
  const winHooks = winners.map(w => w.assets?.[0]?.hook).filter(Boolean).slice(0, 5);
  const sys = `You are VAHDAM's lifecycle creative director. Generate a coherent FUNNEL for one campaign slot. Honor the brand: palette ${Object.values(BRAND.palette).join(', ')}; voice warm, sensory, story-driven; NEVER use banned phrases (${BRAND.bannedPhrases.join(', ')}); prefer (${BRAND.preferred.join(', ')}). Return ONLY JSON with keys: hook, angle, mailer{subject,preheader,headline,body_sections[],cta}, ad{primary_text,headline,description,cta,creative_brief}, landing_page{hero,subhead,sections[],offer,cta}, followup_mailer{subject,body}, retargeting{audience_definition,message}, lookalike{seed_audience,expansion}.`;
  const user = `CHANNEL: ${slot.channel}\nASSET: ${slot.asset_kind}\nMARKET: ${slot.market}\nCOHORT: ${slot.cohort_key}\nTHEME: ${slot.theme}\nPROVEN WINNING HOOKS (own data): ${winHooks.join('; ') || 'n/a'}\nCOMPETITOR OFFER MIX (last 30d, context only): ${JSON.stringify(benchmark.offer_mix || {})}\nDesign the funnel: creative → landing page → mailer follow-up, plus retargeting and lookalike logic.`;
  const out = await callLLM({ systemPrompt: sys, userMessage: user, responseFormat: { type: 'json_object' },
    maxTokens: 2200, temperature: 0.7, stage: 'brain-generate' });
  let data; try { data = JSON.parse(out.text); } catch { data = { _raw: out.text }; }
  return { data, provider: out.provider };
}

// Normalize the funnel into a platform-ready payload (phase-2 adapters read this).
function toPlatformPayload(slot, content) {
  const base = `https://${storeBase(slot.market)}`;
  const common = { market: slot.market, cohort_key: slot.cohort_key, theme: slot.theme,
    landing_url: `${base}/pages/lp-${slot.cohort_key}-${slot.slot_date}` };
  const c = content || {};
  return {
    email: slot.channel === 'email' ? {
      provider_targets: ['klaviyo', 'webengage'], // adapters, NOT called now
      subject: c.mailer?.subject, preheader: c.mailer?.preheader,
      audience: { cohort_key: slot.cohort_key }, ...common
    } : undefined,
    google: slot.channel === 'google' ? {
      provider_targets: ['google_ads'], campaign_type: 'PERFORMANCE_MAX',
      headlines: [c.ad?.headline].filter(Boolean), descriptions: [c.ad?.description].filter(Boolean),
      final_url: common.landing_url, ...common
    } : undefined,
    meta: slot.channel === 'meta' ? {
      provider_targets: ['meta_marketing_api'], objective: 'OUTCOME_SALES',
      primary_text: c.ad?.primary_text, headline: c.ad?.headline,
      creative_brief: c.ad?.creative_brief, link: common.landing_url, ...common
    } : undefined,
    tiktok: slot.channel === 'tiktok' ? {
      provider_targets: ['tiktok_business_api'], objective: 'CONVERSIONS',
      ad_text: c.ad?.primary_text, creative_brief: c.ad?.creative_brief, landing: common.landing_url, ...common
    } : undefined,
    retargeting: c.retargeting || null,
    lookalike: c.lookalike || null
  };
}

// Generate (or regenerate) the spec for one slot.
async function generateForSlot(slotId, { force = false } = {}) {
  const rows = await supa.select('calendar_slots', { filters: { id: `eq.${slotId}` }, limit: 1 });
  const slot = rows[0];
  if (!slot) throw new Error(`slot ${slotId} not found`);
  if (!force && slot.generation_ref) {
    const ex = await supa.select('campaign_specs', { filters: { id: `eq.${slot.generation_ref}` }, limit: 1 });
    if (ex[0]) return { spec: ex[0], reused: true };
  }

  const [winners, benchmark] = await Promise.all([
    analysis.topPerformers({ channel: slot.channel, cohort_key: slot.cohort_key, limit: 10 }),
    calendar.benchmarkFeed()
  ]);
  const { data, provider } = await generateFunnelContent(slot, winners, benchmark);
  const confidence = await currentConfidence(slot);
  const platform_payload = toPlatformPayload(slot, data);

  const spec = {
    slot_id: slot.id, cohort_key: slot.cohort_key, channel: slot.channel, market: slot.market,
    funnel: { hook: data.hook, angle: data.angle, creative: data.ad || data.mailer,
              landing_page: data.landing_page, mailer_followup: data.followup_mailer,
              retargeting: data.retargeting, lookalike: data.lookalike },
    assets: { mailer: data.mailer, ad: data.ad, landing_page: data.landing_page, followup: data.followup_mailer },
    audience: { cohort_key: slot.cohort_key, retargeting: data.retargeting, lookalike: data.lookalike },
    platform_payload,
    verification: { required: true, verified_by: null, verified_at: null, confidence },
    status: 'needs_review', confidence
  };
  const [created] = await supa.insert('campaign_specs', [spec]);
  await supa.update('calendar_slots', { status: 'generated', generation_ref: created.id }, { id: `eq.${slot.id}` });
  return { spec: created, provider, winners_used: winners.length };
}

// Batch-generate every approved-but-ungenerated slot.
async function generateApproved({ limit = 10 } = {}) {
  const slots = await supa.select('calendar_slots', {
    filters: { status: 'eq.approved' }, order: 'priority.desc', limit
  });
  const out = [];
  for (const s of slots) { try { out.push(await generateForSlot(s.id)); } catch (e) { out.push({ slot_id: s.id, error: e.message }); } }
  return { generated: out.length, results: out };
}

// HITL: a human marks a spec verified/final. Confidence floor keeps weekly
// recalibration mandatory regardless.
async function verifySpec(specId, { user_email, approve = true } = {}) {
  const patch = approve
    ? { status: 'verified', verification: { required: true, verified_by: user_email, verified_at: new Date().toISOString() } }
    : { status: 'draft' };
  const [r] = await supa.update('campaign_specs', patch, { id: `eq.${specId}` });
  if (approve && r) await supa.update('campaign_specs', { status: 'final' }, { id: `eq.${specId}` });
  return r;
}

module.exports = { BRAND, generateForSlot, generateApproved, verifySpec, toPlatformPayload };
