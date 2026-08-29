// Ads QA Critic — a deterministic verification pass over generated ad creatives.
// (Queued from the agentic rollout: a critic that reviews the paid-social output.)
// Rule-based, so it ALWAYS runs, even when LLM/image providers are rate-limited.
//
// Contract per ad:
//  - exactly ONE creative type: static OR video (never text-only, never a hybrid);
//  - type-complete: static has an image brief + overlay; video has a >=3-scene
//    storyboard with the hook at 0-2s + a script (so nothing renders as a text block);
//  - one CTA; on-brand (no banned phrases, no en/em dashes);
//  - NO fabricated offer/claim (no invented % off, codes, guarantees) — flagged as
//    needing the approved offer/claims data, per the zero-fabrication spec;
//  - within platform char limits.
// Returns per-ad verdicts + a summary, and stamps each ad with `__qa` so the studio
// can badge it. buildCampaign attaches the summary + an "Ads QA Critic" trace step.

// The brand rules and the platform limits are NOT redefined here. This file had
// its own copy of both, and asset-engines.js was about to make a third: a limit
// that lives in two places is enforced in one, which is the same drift that
// produced nine hand-written market-URL maps with four of them wrong.
//   banned phrases -> scenario-model.js (where the brand scrubber already is)
//   char limits    -> asset-specs.js (the single source for every size and cap)
const { BANNED_PHRASES_RX: BANNED } = require('./scenario-model.js');
const specs = require('./asset-specs.js');
const DASH = /[–—]/; // en / em dash - brand forbids both
// Signals of an offer/claim we cannot invent (there is no approved offer/claims lib).
const OFFER = /\b\d{1,3}\s?%\s?off\b|\bcode[:\s]|\bpromo\b|\bcoupon\b|\bBOGO\b|\bmoney[\s-]?back\b|\bguarantee\b|\blowest price\b/i;
// Derived from asset-specs, keeping this file's field names. Meta and Google
// nest their caps differently there (google's live under headlines/descriptions
// because Google takes a SWEEP of each), which is why this is a mapping rather
// than a passthrough. youtube/pinterest are display placements with no ad copy
// block in asset-specs, so their headline cap stays local and is marked as such.
const A = specs.ADS;
const LIMITS = {
  meta:      { headline: A.meta.copy.headline, primary_text: A.meta.copy.primaryText },
  google:    { headline: A.google.copy.headlines.max, description: A.google.copy.descriptions.max },
  tiktok:    { caption: A.tiktok.copy.caption },
  youtube:   { headline: 40 },   // local: no youtube ad-copy block in asset-specs
  pinterest: { headline: 40 },   // local: no pinterest ad-copy block in asset-specs
};

function textParts(ad) {
  const p = [ad.headline, ad.primary_text, ad.caption, ad.hook, ad.script, ad.creative_brief, ad.description];
  (ad.headlines || []).forEach((h) => p.push(h));
  (ad.descriptions || []).forEach((d) => p.push(d));
  (ad.storyboard || []).forEach((s) => p.push(s && (s.scene || s.shot)));
  if (ad.overlay) p.push(ad.overlay.headline, ad.overlay.cta, ad.overlay.proof);
  return p.filter(Boolean).map(String);
}

function qaAd(ad) {
  const issues = [];
  const crit = (msg) => issues.push({ sev: 'critical', msg });
  const warn = (msg) => issues.push({ sev: 'warn', msg });
  const type = ad.creative_type;

  // 1) exactly one valid type
  // `text` is the TYPOGRAPHIC creative (brand colour + type + built elements, no
  // photograph), not an ad with no creative. It was added with the 1 Text + 3
  // Text+Visual contract; without it here every text variant scored a critical
  // and the Ads QA pill went red on every run - the same deterministic-red trap
  // the TikTok `script` field caused before.
  if (type !== 'static' && type !== 'video' && type !== 'text') crit(`invalid ad type "${type || 'none'}" (must be static, video or text)`);
  if ((type === 'static' || type === 'text') && (ad.storyboard || ad.script)) crit(`${type} ad carries video fields`);
  if (type === 'text') {
    // The brief still has to exist - it specifies the typographic layout. What it
    // must NOT do is brief a photograph, since that is the whole distinction.
    if (!ad.creative_brief) crit('text ad has no creative brief (nothing specifies the typographic layout)');
    if (!(ad.overlay && (ad.overlay.headline || ad.headline))) warn('text ad missing headline');
    if (!ad.aspect) warn('text ad missing aspect ratio');
  }
  // 2) type-complete (never text-only)
  if (type === 'static') {
    if (!ad.creative_brief) crit('static ad has no image brief (would render text-only)');
    if (!(ad.overlay && (ad.overlay.headline || ad.headline))) warn('static ad missing overlay headline');
    if (!ad.aspect) warn('static ad missing aspect ratio');
  }
  if (type === 'video') {
    const sb = ad.storyboard || [];
    if (sb.length < 3) crit(`video storyboard too thin (${sb.length} scenes; need >=3)`);
    if (!sb[0] || !/^0/.test(String(sb[0].t || ''))) warn('video hook not at 0-2s (weak first 1.5s)');
    if (!ad.script) warn('video ad missing script');
  }
  // 3) one CTA
  if (!ad.cta) warn('no CTA');
  // 4) brand safety + no fabrication
  textParts(ad).forEach((t) => {
    if (BANNED.test(t)) crit(`banned phrase near "${t.slice(0, 36)}"`);
    if (DASH.test(t)) warn(`en/em dash near "${t.slice(0, 36)}"`);
    if (OFFER.test(t)) crit(`unverifiable offer/claim near "${t.slice(0, 36)}" (needs approved data)`);
  });
  // 5) platform char limits
  const lim = LIMITS[ad.platform] || {};
  if (lim.headline && ad.headline && String(ad.headline).length > lim.headline) warn(`headline ${String(ad.headline).length}>${lim.headline} for ${ad.platform}`);
  if (lim.primary_text && ad.primary_text && String(ad.primary_text).length > lim.primary_text) warn(`primary_text over ${lim.primary_text}`);
  (ad.headlines || []).forEach((h) => { if (lim.headline && String(h).length > lim.headline) warn(`google headline over ${lim.headline}`); });
  (ad.descriptions || []).forEach((d) => { if (lim.description && String(d).length > lim.description) warn(`google description over ${lim.description}`); });

  const critical = issues.filter((i) => i.sev === 'critical').length;
  const warns = issues.filter((i) => i.sev === 'warn').length;
  const score = Math.max(0, 10 - critical * 3 - warns);
  const verdict = { ok: critical === 0, score, critical, warns, issues };
  try { ad.__qa = { ok: verdict.ok, score, issues: issues.map((i) => `${i.sev === 'critical' ? '✗' : '⚠'} ${i.msg}`) }; } catch (_) { /* frozen ad */ }
  return { id: ad.id, platform: ad.platform, type: type || null, ...verdict };
}

function qaAds(ads) {
  const results = (ads || []).map(qaAd);
  const critical = results.reduce((n, r) => n + r.critical, 0);
  const passed = results.every((r) => r.ok);
  const avg_score = results.length ? Math.round((results.reduce((s, r) => s + r.score, 0) / results.length) * 10) / 10 : 0;
  // Coverage: each channel should carry the full 1 Text + 3 Text+Visual set -
  // the typographic control, plus static and video treatments.
  const byPlat = {};
  (ads || []).forEach((a) => { (byPlat[a.platform] = byPlat[a.platform] || {})[a.creative_type] = true; });
  const coverage = Object.keys(byPlat).map((p) => ({
    platform: p, static: !!byPlat[p].static, video: !!byPlat[p].video, text: !!byPlat[p].text,
  }));
  const missing = coverage.flatMap((c) => [
    !c.text ? `${c.platform}:no-text` : null,
    !c.static ? `${c.platform}:no-static` : null,
    !c.video ? `${c.platform}:no-video` : null,
  ].filter(Boolean));
  return { passed, critical, avg_score, count: results.length, coverage, missing, results };
}

module.exports = { qaAd, qaAds };
