'use strict';

/**
 * brain-generate.js — Generation Engine (Module 5).
 *
 * For an approved calendar slot, generates the COMPLETE asset set:
 *   email slots        → HTML mailer (brand-compliant) + paired landing page
 *   google slots       → RSA campaign object (15 headlines / 4 descriptions / keywords)
 *   meta slots         → primary text / headline / description + creative brief + audience
 *   tiktok slots       → hook-script + creative brief + audience
 *   landing_* slots    → conversion-optimized landing page HTML
 * plus, for every campaign: funnel spec (creative → landing → mailer follow-up),
 * retargeting + lookalike audience definitions — platform-ready schema,
 * NO live push (phase 2 plugs into the same campaign_object).
 *
 * LLM-assisted copy via _shared/llm.js with a deterministic brand-compliant
 * fallback, so generation always succeeds.
 */

const { db, getConfig, getBrandKit, scrubBannedPhrases, idFor, todayIso, round } = require('./brain-core.js');
const analysis = require('./brain-analysis.js');

let callLLM = null;
try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }

async function llmJson(system, user, maxTokens = 1800) {
  if (!callLLM) return null;
  try {
    const out = await callLLM({ systemPrompt: system, userMessage: user, responseFormat: { type: 'json_object' }, maxTokens, temperature: 0.7, timeoutMs: 40000, stage: 'brain-generate' });
    const text = typeof out === 'string' ? out : (out.text || '');
    return JSON.parse(text.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, '$1'));
  } catch (_) { return null; }
}

// ── copy generation (LLM with deterministic fallback) ───────────────────────
async function generateCopy(slot, products, brand, library) {
  const ref = (library || []).slice(0, 3).map((c) => `"${c.hook}" (angle ${c.angle}, rev ${c.kpis ? c.kpis.revenue : 'n/a'})`).join('; ');
  const productLines = products.map((p) => `${p.title} — $${p.price} (${p.category})`).join('\n');
  const sys = `You are the lifecycle copy chief for VAHDAM India, a premium single-estate tea & wellness brand.
Voice: ${brand.voice}. Use this lexicon where natural: ${(brand.preferred_lexicon || []).join(', ')}.
NEVER use: ${(brand.banned_phrases || []).join(', ')}.
Return STRICT JSON only.`;
  const user = `Create campaign copy for:
Channel: ${slot.channel} · Market: ${slot.market} · Cohort: ${slot.cohort_id || 'general'}
Theme: ${slot.theme} · Angle: ${slot.angle} · Festival: ${slot.festival || 'none'}
Reference hooks that worked before: ${ref || 'n/a'}
Featured products:\n${productLines}

JSON shape:
{"subject":"","preheader":"","headline":"","subheadline":"","body_intro":"2-3 sentence sensory opening","story":"4-5 sentence narrative for the angle","cta_primary":"","cta_secondary":"","testimonial":{"quote":"tiny personal story, 2 sentences","name":"first name + city"},"google":{"headlines":["12 short headlines ≤30 chars"],"descriptions":["4 descriptions ≤90 chars"]},"meta":{"primary_text":"","headline":"","description":""},"tiktok":{"hook_line":"","script":"15s spoken script, conversational"},"landing":{"hero_headline":"","hero_sub":"","benefit_bullets":["3-4 bullets"],"faq":[{"q":"","a":""},{"q":"","a":""}]}}`;
  let copy = await llmJson(sys, user, 2200);
  if (!copy || !copy.headline) copy = fallbackCopy(slot, products);
  // brand-compliance scrub on every string
  const walk = (o) => {
    if (typeof o === 'string') return scrubBannedPhrases(o, brand);
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)]));
    return o;
  };
  return walk(copy);
}

function fallbackCopy(slot, products) {
  const p = products[0] || { title: 'Original Masala Chai', price: 19.99, category: 'Chai' };
  const theme = slot.theme || 'Morning Ritual';
  const fest = slot.festival;
  return {
    subject: fest ? `${fest}: a gift they will steep all season` : `There is a moment the right cup restores`,
    preheader: `${p.title}, hand-picked at origin — crafted for your ${String(theme).toLowerCase()}`,
    headline: fest ? `Crafted for ${fest}` : `The ${theme}, restored`,
    subheadline: `Single-estate teas, shipped garden-fresh from India`,
    body_intro: `There is a moment when the right cup of tea does more than warm your hands. It slows the morning down, just enough to taste it.`,
    story: `Every ${p.category.toLowerCase()} we ship begins at a single estate, hand-picked and packed at origin within days of plucking. No warehouses, no years on a shelf — just the harvest, sealed at its peak. That freshness is why the first steep tastes the way the gardens smell at dawn. It is a small ritual with an outsized return: balance, restored daily.`,
    cta_primary: `Steep the ritual`,
    cta_secondary: `Explore the collection`,
    testimonial: { quote: `I started with one tin in January. My kitchen now has a shelf my family calls the apothecary.`, name: `Sarah, Austin` },
    google: {
      headlines: ['Single-Estate Indian Teas', 'Garden-Fresh, Origin Packed', `${p.category} From India`, 'Hand-Picked At Origin', 'Steep A Better Morning', 'Heritage Teas, Crafted', 'From Estate To Cup', 'The Daily Ritual Upgrade', 'Award-Winning Teas', 'Fresh Harvest Teas', 'Balance In Every Steep', 'Origin-Direct Teas'],
      descriptions: ['Hand-picked, single-estate teas shipped garden-fresh from India. Crafted for your daily ritual.', 'From estate to cup in days, not years. Taste the difference origin-fresh makes.', 'Premium teas and wellness blends, packed at source. Free shipping over $35.', 'A ritual worth keeping: heritage teas, hand-picked and crafted at origin.'],
    },
    meta: { primary_text: `From a single estate in India to your morning — hand-picked, packed at origin, shipped garden-fresh. ${p.title} is where most people begin.`, headline: `The ritual, restored`, description: `Origin-fresh teas, crafted for balance` },
    tiktok: { hook_line: `This tea was on a bush in Assam eleven days ago.`, script: `This tea was on a bush in Assam eleven days ago. Most tea sits in warehouses for years — this one is packed at the estate the week it is picked. You brew it, and it tastes like the garden smells at dawn. That is the whole difference. Steep one cup and you will taste it.` },
    landing: {
      hero_headline: fest ? `Crafted for ${fest}` : `The daily ritual, restored`,
      hero_sub: `Single-estate teas and wellness blends, hand-picked and shipped garden-fresh from India.`,
      benefit_bullets: ['Packed at origin within days of harvest', 'Single-estate, hand-picked leaves', 'Blended for balance — never flavour-sprayed', 'Carbon & plastic neutral brand'],
      faq: [
        { q: 'How fresh is it really?', a: 'We pack at origin within days of plucking and ship direct — months fresher than store-shelf tea.' },
        { q: 'How long does a tin last?', a: 'A 100g tin steeps roughly 50 cups — about seven weeks of a daily ritual.' },
      ],
    },
  };
}

// ── HTML builders (brand palette + typography enforced) ─────────────────────
function mailerHtml(slot, copy, products, brand, agentUrl) {
  const P = brand.palette;
  const heads = brand.typography.headings.fallback;
  const body = brand.typography.body.fallback;
  const store = (brand.store_urls || {})[slot.market] || 'https://www.vahdamteas.com';
  const prods = products.slice(0, 3).map((p) => `
    <td align="center" style="padding:10px;width:33%">
      <a href="${p.url || store}" style="text-decoration:none">
        <div style="background:${P.cream};border:1px solid ${P.gold}33;border-radius:10px;padding:18px 10px">
          <div style="font-family:${heads};font-size:15px;color:${P.near_black};line-height:1.35">${p.title}</div>
          <div style="font-family:${body};font-size:13px;color:${P.gold};margin-top:8px;font-weight:600">${slot.market === 'UK' ? '£' : '$'}${p.price}</div>
        </div>
      </a>
    </td>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${copy.subject}</title></head>
<body style="margin:0;padding:0;background:${P.cream}">
<div style="display:none;max-height:0;overflow:hidden">${copy.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${P.cream}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%">
  <tr><td align="center" style="padding:18px 0">
    <div style="font-family:${heads};font-size:22px;letter-spacing:0.28em;color:${P.forest_green};font-weight:700">VAHDAM</div>
    <div style="font-family:${body};font-size:10px;letter-spacing:0.22em;color:${P.gold};text-transform:uppercase;margin-top:4px">India · Est. at origin</div>
  </td></tr>
  <tr><td style="background:${P.forest_green};border-radius:14px;padding:46px 36px" align="center">
    <div style="font-family:${body};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${P.gold};margin-bottom:14px">${slot.festival || slot.theme || 'The Collection'}</div>
    <div style="font-family:${heads};font-size:34px;line-height:1.2;color:${P.cream};font-weight:700">${copy.headline}</div>
    <div style="font-family:${body};font-size:15px;line-height:1.6;color:${P.cream}CC;margin-top:14px">${copy.subheadline}</div>
    <a href="${store}" style="display:inline-block;margin-top:26px;background:${P.gold};color:${P.near_black};font-family:${body};font-size:14px;font-weight:700;padding:14px 34px;border-radius:8px;text-decoration:none">${copy.cta_primary}</a>
  </td></tr>
  <tr><td style="padding:34px 26px 10px">
    <div style="font-family:${body};font-size:15px;line-height:1.75;color:${P.near_black}">${copy.body_intro}</div>
    <div style="font-family:${body};font-size:15px;line-height:1.75;color:${P.near_black};margin-top:14px">${copy.story}</div>
  </td></tr>
  <tr><td style="padding:14px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${prods}</tr></table></td></tr>
  <tr><td style="padding:8px 26px 6px" align="center">
    <div style="background:${P.cream};border-left:3px solid ${P.gold};padding:18px 20px;text-align:left">
      <div style="font-family:${heads};font-size:15px;font-style:italic;color:${P.near_black};line-height:1.6">“${copy.testimonial.quote}”</div>
      <div style="font-family:${body};font-size:12px;color:${P.gold};margin-top:8px">— ${copy.testimonial.name}</div>
    </div>
  </td></tr>
  <tr><td align="center" style="padding:24px 26px 8px">
    <div style="border:1px solid ${P.gold}55;border-radius:12px;padding:20px 22px;background:#ffffff">
      <div style="font-family:${heads};font-size:17px;color:${P.forest_green}">Not sure where to begin?</div>
      <div style="font-family:${body};font-size:13px;color:${P.near_black}AA;line-height:1.6;margin-top:6px">Talk to our tea expert — ask about benefits, brewing, and which blend fits your ritual. It answers, out loud, like a call.</div>
      <a href="${agentUrl}" style="display:inline-block;margin-top:12px;background:${P.forest_green};color:${P.cream};font-family:${body};font-size:13px;font-weight:700;padding:11px 26px;border-radius:8px;text-decoration:none">Talk to the Vahdam expert →</a>
    </div>
  </td></tr>
  <tr><td align="center" style="padding:26px 20px 36px">
    <a href="${store}" style="font-family:${body};font-size:13px;color:${P.forest_green};text-decoration:underline">${copy.cta_secondary}</a>
    <div style="font-family:${body};font-size:11px;color:${P.near_black}77;margin-top:16px;line-height:1.6">VAHDAM India · Crafted at origin · Carbon &amp; plastic neutral<br>You receive this because you joined the ritual. <a href="#" style="color:${P.gold}">Preferences</a> · <a href="#" style="color:${P.gold}">Unsubscribe</a></div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function landingHtml(slot, copy, products, brand, agentUrl) {
  const P = brand.palette;
  const heads = brand.typography.headings.fallback;
  const body = brand.typography.body.fallback;
  const store = (brand.store_urls || {})[slot.market] || 'https://www.vahdamteas.com';
  const L = copy.landing || {};
  const bullets = (L.benefit_bullets || []).map((b) => `<li style="margin:10px 0;padding-left:28px;position:relative"><span style="position:absolute;left:0;color:${P.gold}">✦</span>${b}</li>`).join('');
  const faq = (L.faq || []).map((f) => `<details style="border-bottom:1px solid ${P.gold}33;padding:14px 0"><summary style="font-family:${heads};font-size:17px;color:${P.near_black};cursor:pointer">${f.q}</summary><p style="font-family:${body};color:${P.near_black}BB;line-height:1.7">${f.a}</p></details>`).join('');
  const prods = products.slice(0, 3).map((p, i) => `
    <a href="${p.url || store}" class="card" style="animation-delay:${i * 90}ms;text-decoration:none;background:#fff;border:1px solid ${P.gold}33;border-radius:14px;padding:26px 20px;display:block">
      <div style="font-family:${heads};font-size:18px;color:${P.near_black};line-height:1.35">${p.title}</div>
      <div style="font-family:${body};font-size:13px;color:${P.near_black}88;margin-top:6px">${p.category}</div>
      <div style="font-family:${body};font-size:15px;color:${P.gold};font-weight:700;margin-top:12px">${slot.market === 'UK' ? '£' : '$'}${p.price}</div>
    </a>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${L.hero_headline || copy.headline} — VAHDAM</title>
<style>
  body{margin:0;background:${P.cream};color:${P.near_black};font-family:${body}}
  .wrap{max-width:1040px;margin:0 auto;padding:0 22px}
  .fade{opacity:0;transform:translateY(18px);animation:up .7s ease forwards}
  .card{opacity:0;transform:translateY(18px) scale(.98);animation:up .6s ease forwards}
  @keyframes up{to{opacity:1;transform:none}}
  .cta{display:inline-block;background:${P.gold};color:${P.near_black};font-weight:700;font-size:15px;padding:16px 38px;border-radius:9px;text-decoration:none;transition:transform .2s, box-shadow .2s}
  .cta:hover{transform:translateY(-2px);box-shadow:0 14px 34px ${P.forest_green}44}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
</style></head>
<body>
<header style="background:${P.forest_green};padding:14px 0"><div class="wrap" style="display:flex;justify-content:space-between;align-items:center">
  <div style="font-family:${heads};letter-spacing:.3em;color:${P.cream};font-weight:700">VAHDAM</div>
  <a href="${agentUrl}" style="color:${P.gold};font-size:13px;text-decoration:none">🎙 Talk to our tea expert</a>
</div></header>
<section style="background:${P.forest_green};padding:84px 0 96px;text-align:center">
  <div class="wrap">
    <div class="fade" style="font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:${P.gold}">${slot.festival || slot.theme || ''}</div>
    <h1 class="fade" style="animation-delay:.1s;font-family:${heads};font-size:clamp(34px,5vw,56px);color:${P.cream};line-height:1.15;margin:18px auto;max-width:760px">${L.hero_headline || copy.headline}</h1>
    <p class="fade" style="animation-delay:.2s;color:${P.cream}CC;font-size:17px;max-width:560px;margin:0 auto 34px;line-height:1.65">${L.hero_sub || copy.subheadline}</p>
    <a class="cta fade" style="animation-delay:.3s" href="${store}">${copy.cta_primary}</a>
  </div>
</section>
<section style="padding:72px 0"><div class="wrap" style="display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center">
  <div>
    <h2 style="font-family:${heads};font-size:30px;color:${P.forest_green}">${copy.headline}</h2>
    <p style="line-height:1.8;color:${P.near_black}CC">${copy.story}</p>
    <ul style="list-style:none;padding:0;font-size:15px">${bullets}</ul>
  </div>
  <div style="background:#fff;border:1px solid ${P.gold}33;border-radius:16px;padding:30px">
    <div style="font-family:${heads};font-style:italic;font-size:19px;line-height:1.6">“${copy.testimonial.quote}”</div>
    <div style="color:${P.gold};margin-top:12px;font-size:13px;font-weight:600">— ${copy.testimonial.name}</div>
    <hr style="border:none;border-top:1px solid ${P.gold}22;margin:22px 0">
    <div style="font-size:13.5px;color:${P.near_black}AA;line-height:1.6">Prefer to ask? Our voice expert explains benefits, steep times, and value — conversationally.</div>
    <a href="${agentUrl}" style="display:inline-block;margin-top:12px;color:${P.forest_green};font-weight:700;text-decoration:none">🎙 Start a conversation →</a>
  </div>
</div></section>
<section style="padding:10px 0 64px"><div class="wrap">
  <h3 style="font-family:${heads};font-size:24px;color:${P.forest_green};text-align:center;margin-bottom:28px">Steeped most by this cohort</h3>
  <div class="grid">${prods}</div>
</div></section>
<section style="padding:0 0 80px"><div class="wrap" style="max-width:720px">
  <h3 style="font-family:${heads};font-size:24px;color:${P.forest_green}">Questions, answered</h3>${faq}
  <div style="text-align:center;margin-top:44px"><a class="cta" href="${store}">${copy.cta_secondary}</a></div>
</div></section>
<footer style="background:${P.near_black};color:${P.cream}99;text-align:center;padding:30px;font-size:12px">VAHDAM India · Single-estate · Carbon &amp; plastic neutral</footer>
</body></html>`;
}

// ── Platform-ready campaign objects (phase-2 push plugs in here) ────────────
function audienceSpec(slot, cohort) {
  const base = cohort ? { cohort_id: cohort.id, name: cohort.name, definition: cohort.definition, size: cohort.size } : { name: 'All engaged customers' };
  return {
    primary: base,
    retargeting: {
      name: `RT · ${slot.theme || slot.channel} · ${slot.market}`,
      rule: 'engaged with this campaign (open/click/video_view ≥ 50%) OR visited landing page, last 14d, excluding purchasers 7d',
      window_days: 14,
    },
    expansion: {
      lookalike: { source: base.name, ratio: slot.market === 'US' ? '1-3%' : '1-5%', note: 'similar-audience seed = cohort members with ≥2 orders' },
      interest_stack: ['premium tea', 'ayurveda', 'wellness rituals', 'specialty grocery'],
    },
    exclusions: ['purchasers_last_7d', 'unsubscribed', 'refunded_last_90d'],
  };
}

function campaignObjects(slot, copy, cohort, products, brand) {
  const aud = audienceSpec(slot, cohort);
  const store = (brand.store_urls || {})[slot.market] || 'https://www.vahdamteas.com';
  const utm = `utm_source={platform}&utm_medium={medium}&utm_campaign=${encodeURIComponent(slot.id)}`;
  const objs = [];
  if (slot.channel === 'email' || slot.channel === 'landing_email') {
    objs.push({
      platform: 'klaviyo',
      campaign_object: {
        type: 'campaign', name: `${slot.theme} · ${slot.market} · ${slot.slot_date}`,
        audience: aud, send_time_local: '09:30',
        message: { subject: copy.subject, preheader: copy.preheader, from_name: 'VAHDAM India', from_email: 'hello@vahdam.com', template_ref: `asset:mailer_html:${slot.id}` },
        ab_test: { dimension: 'subject', variants: [copy.subject, `${copy.headline} — inside`], split: 0.5, metric: 'open_rate' },
        followup: { trigger: 'no_open_48h', action: 'resend_new_subject' },
        utm,
      },
    });
  }
  if (slot.channel === 'google') {
    objs.push({
      platform: 'google_ads',
      campaign_object: {
        campaign: { name: `G·${slot.market}·${slot.slot_date}·${slot.theme}`, type: 'SEARCH', bidding: 'MAXIMIZE_CONVERSION_VALUE', budget_daily_usd: 80, geo: slot.market === 'UK' ? ['GB'] : ['US'] },
        ad_group: { name: slot.angle || 'core', keywords: (copy.google.headlines || []).slice(0, 6).map((h) => ({ text: h.toLowerCase(), match: 'PHRASE' })) },
        responsive_search_ad: { headlines: copy.google.headlines, descriptions: copy.google.descriptions, final_url: `${store}?${utm.replace('{platform}', 'google').replace('{medium}', 'cpc')}` },
        audience: aud,
      },
    });
  }
  if (slot.channel === 'meta') {
    objs.push({
      platform: 'meta_ads',
      campaign_object: {
        campaign: { name: `M·${slot.market}·${slot.slot_date}·${slot.theme}`, objective: 'OUTCOME_SALES', budget_daily_usd: 70 },
        ad_set: { optimization: 'OFFSITE_CONVERSIONS', audience: aud, placements: ['feed', 'stories', 'reels'] },
        creative: { primary_text: copy.meta.primary_text, headline: copy.meta.headline, description: copy.meta.description, cta: 'SHOP_NOW', link: `${store}?${utm.replace('{platform}', 'meta').replace('{medium}', 'paid_social')}`, brief: `Hero close-up of ${products[0] ? products[0].title : 'tea'} on ${brand.palette.cream} linen, steam visible, gold accent props. NO text overlay.` },
        ab_test: { dimension: 'creative_format', variants: ['static_hero', 'carousel_3p'], metric: 'roas' },
      },
    });
  }
  if (slot.channel === 'tiktok') {
    objs.push({
      platform: 'tiktok_ads',
      campaign_object: {
        campaign: { name: `T·${slot.market}·${slot.slot_date}·${slot.theme}`, objective: 'WEB_CONVERSIONS', budget_daily_usd: 50 },
        ad_group: { audience: aud, placements: ['tiktok'], optimization: 'CONVERSION' },
        creative: { hook_line: copy.tiktok.hook_line, script: copy.tiktok.script, format: 'ugc_voiceover_15s', link: `${store}?${utm.replace('{platform}', 'tiktok').replace('{medium}', 'paid_social')}`, brief: 'Creator-style kitchen shot, natural light, brew pour at 0:03, on-screen captions, end-card in forest green with gold CTA.' },
      },
    });
  }
  if (slot.channel === 'landing_email' || slot.channel === 'landing_ads') {
    objs.push({
      platform: 'landing',
      campaign_object: { type: 'landing_page', name: `LP·${slot.market}·${slot.slot_date}`, html_ref: `asset:landing_html:${slot.id}`, paired_channel: (slot.source || {}).paired_channel || null, cro: { above_fold_cta: true, social_proof: true, faq_schema: true, voice_agent_entry: true } },
    });
  }
  return objs;
}

function funnelSpec(slot, cohort, copy) {
  return {
    id: idFor('fun', { slot: slot.id }),
    cohort_id: cohort ? cohort.id : null,
    slot_id: slot.id,
    name: `Funnel · ${slot.theme || slot.channel} · ${slot.market} · ${slot.slot_date}`,
    stages: [
      { step: 1, stage: 'creative', channel: slot.channel.startsWith('landing') ? ((slot.source || {}).paired_channel || 'email') : slot.channel, asset: 'ad_copy/mailer', goal: 'attention', kpi: slot.channel === 'email' ? 'open_rate' : 'ctr' },
      { step: 2, stage: 'landing', channel: 'landing', asset: 'landing_html', goal: 'conversion', kpi: 'cvr', cro: ['hero CTA above fold', 'voice-agent assist entry', 'testimonial proof', 'FAQ objections'] },
      { step: 3, stage: 'mailer_followup', channel: 'email', asset: 'mailer_html', goal: 'recover + repeat', kpi: 'rpr', trigger: 'visited LP, no purchase 48h → follow-up mailer; purchased → post-purchase ritual series' },
    ],
    retargeting: audienceSpec(slot, cohort).retargeting,
    audiences: audienceSpec(slot, cohort),
    created_at: new Date().toISOString(),
  };
}

// ── main entry ───────────────────────────────────────────────────────────────
async function generateForSlot(slotId, { persist = true } = {}) {
  const d = db();
  const [slotRows, brand] = await Promise.all([
    d.select('smart_calendar', { filters: { id: `eq.${slotId}` }, limit: 1 }),
    getBrandKit(),
  ]);
  const slot = slotRows[0];
  if (!slot) throw new Error(`slot ${slotId} not found`);

  const [cohortRows, lib] = await Promise.all([
    slot.cohort_id ? d.select('smart_cohorts', { filters: { id: `eq.${slot.cohort_id}` }, limit: 1 }) : Promise.resolve([]),
    analysis.filteredLibrary({ channel: slot.channel.startsWith('landing') ? 'email' : slot.channel, market: slot.market }),
  ]);
  const cohort = cohortRows[0] || null;

  // product selection: match cohort categories then top sellers
  const products = await d.select('smart_products', { filters: { market: `eq.${slot.market}`, active: 'eq.true' }, limit: 200 });
  const wantTags = cohort ? JSON.stringify(cohort.definition).toLowerCase() : '';
  const picked = products
    .map((p) => ({ p, rel: (p.tags || []).reduce((s, t) => s + (wantTags.includes(t) ? 1 : 0), 0) + ((slot.festival && (p.tags || []).includes('gift')) ? 2 : 0) }))
    .sort((a, b) => b.rel - a.rel || (b.p.tags || []).includes('bestseller') - (a.p.tags || []).includes('bestseller'))
    .slice(0, 3).map((x) => x.p);

  const copy = await generateCopy(slot, picked, brand, lib.items);
  const agentUrl = `/agent?ctx=${encodeURIComponent(slot.market)}&from=${encodeURIComponent(slot.id)}`;

  const funnel = funnelSpec(slot, cohort, copy);
  const objects = campaignObjects(slot, copy, cohort, picked, brand);

  const assets = [];
  const push = (type, name, content, meta = {}) => assets.push({ id: idFor('ast', { slot: slot.id, type, name }), slot_id: slot.id, type, name, content, meta, created_at: new Date().toISOString() });

  if (slot.channel === 'email') {
    push('mailer_html', `Mailer · ${slot.theme} · ${slot.market}`, mailerHtml(slot, copy, picked, brand, agentUrl), { subject: copy.subject, preheader: copy.preheader, variants: ['A: image hero', 'B: text editorial (same copy, no hero block)'] });
  }
  if (slot.channel.startsWith('landing')) {
    push('landing_html', `Landing · ${slot.theme} · ${slot.market}`, landingHtml(slot, copy, picked, brand, agentUrl), { paired: (slot.source || {}).paired_channel || null });
  }
  if (['google', 'meta', 'tiktok'].includes(slot.channel)) {
    push('ad_copy', `${slot.channel} copy · ${slot.market}`, JSON.stringify(slot.channel === 'google' ? copy.google : slot.channel === 'meta' ? copy.meta : copy.tiktok, null, 2), { angle: slot.angle });
    const brief = objects.find((o) => o.platform.includes(slot.channel === 'google' ? 'google' : slot.channel));
    if (brief) push('ad_creative_brief', `${slot.channel} creative brief`, JSON.stringify(((brief.campaign_object || {}).creative || (brief.campaign_object || {}).responsive_search_ad) || {}, null, 2));
  }
  push('audience_spec', `Audiences · ${slot.market}`, JSON.stringify(audienceSpec(slot, cohort), null, 2));
  push('funnel_spec', funnel.name, JSON.stringify(funnel, null, 2));

  const genCampaigns = objects.map((o) => ({
    id: idFor('gen', { slot: slot.id, platform: o.platform }),
    slot_id: slot.id, funnel_id: funnel.id, platform: o.platform,
    campaign_object: o.campaign_object, status: 'pending_review', confidence: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }));

  if (persist) {
    await d.upsert('smart_funnels', [funnel], 'id');
    const saved = await d.upsert('smart_generated_campaigns', genCampaigns, 'id');
    const withFk = assets.map((a) => ({ ...a, generated_campaign_id: (saved[0] || {}).id || null }));
    await d.upsert('smart_generated_assets', withFk, 'id');
    await d.update('smart_calendar', { id: `eq.${slot.id}` }, { status: 'generated', updated_at: new Date().toISOString() });
    // every campaign enters the human review queue (launch state: ALWAYS)
    await d.insert('smart_review_queue', genCampaigns.map((g) => ({ item_type: 'generated_campaign', item_id: g.id, state: 'pending' })));
  }
  return { ok: true, slot_id: slot.id, funnel, campaigns: genCampaigns, assets: assets.map((a) => ({ id: a.id, type: a.type, name: a.name, bytes: (a.content || '').length })), copy };
}

module.exports = { generateForSlot, mailerHtml, landingHtml, campaignObjects, audienceSpec, fallbackCopy };
