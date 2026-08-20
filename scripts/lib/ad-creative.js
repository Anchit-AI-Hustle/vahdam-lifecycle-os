'use strict';

/**
 * ad-creative.js — VAHDAM paid-social ad creatives (composed units, not
 * image+text side by side). Each platform renders as a real ad: the hero fills
 * the frame at the platform aspect ratio, a brand scrim keeps copy legible, and
 * the wordmark + headline + price + CTA are composed ON the creative.
 * Flagship palette, hosted image URLs only, no invented codes. Callers pre-scrub
 * copy (sanitizeBrand).
 */
const { PAL, shippingLine } = require('./flagship-mailer.js');
// Video creatives: renderMotionAd = a real animated 9:16 unit that plays with no
// API and no render farm; motionBrief = the same design as a generator brief so
// the shipped MP4 matches the preview. Every ad set therefore has a VIDEO
// creative, not just stills.
const { renderMotionAd, motionBrief } = require('./motion-ad.js');
// 3D depth for composed stills: key light, vignette, grain, gold hairline.
const { adDepthLayers } = require('../../api/_shared/motion-design.js');
// Plain-text (no-entity) shipping line for ad copy fields, region-correct.
function shipText(market) { return String(shippingLine(market)).replace(/&pound;/g, '£'); }
const HF = "'LAO MN','Cormorant Garamond',Georgia,serif";
const BF = "'Proxima Nova','Helvetica Neue',Arial,sans-serif";
const FONT =
  '@font-face{font-family:"LAO MN";src:url("https://cdn.nector.io/nector-static/fonts/LaoMN-01.ttf") format("truetype");}' +
  '@font-face{font-family:"Proxima Nova";src:url("https://cdn-widgetsrepository.yotpo.com/brandkit/custom-fonts/nULz3c4cbjU7NEqLKreeoyIyIP4L5pnrZ53k1952/proximanova-regular/proximanova-regular.woff2") format("woff2");}';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function clamp(s, n) { s = String(s || ''); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; }

// ── ANGLE MATRIX ───────────────────────────────────────────────────────────
// One creative per surface gives nothing to test, so each ad set now ships four
// angles across the awareness ladder. Angles RECOMBINE the caller's already
// scrubbed strings (headline / subline / tastingLine / price / event) and reuse
// the one established brand claim already in this file - they never author a new
// product claim, which is what keeps a variant matrix compatible with the
// zero-fabrication contract. An angle whose hook has no supplied source is
// dropped rather than padded.
const BRAND_CLAIM = 'Single-estate, hand-picked at origin.';
const ANGLES = [
  { key: 'ritual', label: 'Ritual', awareness: 'problem-aware',
    hook: (o) => o.headline, body: (o) => o.subline },
  { key: 'taste', label: 'Taste', awareness: 'product-aware',
    hook: (o) => o.tastingLine, body: (o) => o.headline },
  { key: 'benefit', label: 'Benefit', awareness: 'solution-aware',
    hook: (o) => o.subline, body: (o) => o.tastingLine },
  { key: 'occasion', label: 'Occasion', awareness: 'most-aware',
    hook: (o) => o.eyebrow || o.event || o.headline,
    body: (o) => [o.subline, o.price ? String(o.price) : ''].filter(Boolean).join(' · ') },
];

// Build the per-surface copy for one angle.
function angleCopy(o, a) {
  const hook = String(a.hook(o) || '').trim();
  const body = String(a.body(o) || '').trim();
  if (!hook) return null; // no supplied source for this angle - skip it
  const p = o.productName;
  return {
    angle: a.key, angle_label: a.label, awareness: a.awareness,
    meta: { platform: 'Meta (Instagram/Facebook) · 1:1', primary_text: clamp(body ? `${hook}. ${body}` : hook, 125), headline: clamp(p, 40), description: clamp(o.tastingLine || BRAND_CLAIM, 30), cta: 'Shop Now' },
    tiktok: { platform: 'TikTok / Reels · 9:16', primary_text: clamp(o.price ? `${hook} (${o.price})` : hook, 100), hook: clamp(body || hook, 60), cta: 'Shop Now' },
    google: { platform: 'Google · Responsive Search', headlines: [clamp(p, 30), clamp(hook, 30), clamp('Single-Estate, Hand-Picked', 30)], descriptions: [clamp(body || hook, 90), clamp(`${o.tastingLine || ''}. ${shipText(o.market)}.`.replace(/^\. /, ''), 90)], cta: 'Shop' },
    _creative: { hook, body },
  };
}

function adCopy(o) {
  const variants = ANGLES.map((a) => angleCopy(o, a)).filter(Boolean);
  // De-duplicate: when a caller supplies only a headline, several angles collapse
  // onto the same hook. Shipping the same creative twice under two angle names
  // would misreport the test matrix, so identical hooks are folded.
  // Keyed on the HOOK alone, because the hook is what makes an angle an angle:
  // it is the line composed large on the creative, so two angles sharing a hook
  // ship as visibly the same ad however their body copy differs. An angle whose
  // only source has already been used is not a second angle.
  const seen = new Set();
  const unique = variants.filter((v) => {
    if (seen.has(v._creative.hook)) return false;
    seen.add(v._creative.hook); return true;
  });
  const primary = unique[0] || null;
  if (!primary) {
    throw new Error('ad-creative: [DATA REQUIRED BEFORE LAUNCH: ad hook (headline, subline or tastingLine), product ' + (o.productName || '?') + ']');
  }
  // Back-compat: the primary angle stays at the top level (the manifest and any
  // existing reader see the shape they always saw); the matrix is additive.
  return { meta: primary.meta, tiktok: primary.tiktok, google: primary.google, variants: unique };
}

// A composed creative: hero fills the frame; a bottom scrim carries the copy.
// `ar` is the CSS aspect-ratio; `w` the render width.
function composed(o, { w, ar, wordmarkTop, headline, sub, showPrice, ctaLabel, handle }) {
  const bg = o.heroImageUrl
    ? `background-image:linear-gradient(to bottom,rgba(0,74,43,0) 38%,rgba(0,74,43,.55) 66%,rgba(23,23,23,.86) 100%),url('${esc(o.heroImageUrl)}');background-size:cover;background-position:center;`
    : `background:${PAL.green};`;
  const price = (showPrice && o.price) ? `<span style="display:inline-block;background:${PAL.gold};color:${PAL.ink};font-family:${BF};font-weight:700;font-size:13px;padding:5px 12px;border-radius:999px;margin-right:8px;">${esc(o.price)}</span>` : '';
  return `<div style="width:${w}px;max-width:100%;aspect-ratio:${ar};${bg}border-radius:14px;overflow:hidden;position:relative;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 6px 20px rgba(23,23,23,.14);">${o.heroImageUrl ? adDepthLayers(PAL.gold) : ''}
    <div style="padding:16px 18px;display:flex;align-items:center;gap:8px;">
      <span style="font-family:${HF};letter-spacing:.28em;font-weight:700;color:${PAL.cream};font-size:15px;text-shadow:0 1px 6px rgba(0,0,0,.4);">VAHDAM</span>
      ${wordmarkTop ? `<span style="font-family:${BF};font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:${PAL.gold};text-shadow:0 1px 4px rgba(0,0,0,.5);">${esc(wordmarkTop)}</span>` : ''}
    </div>
    <div style="padding:0 18px 18px;">
      <div style="font-family:${HF};color:${PAL.cream};font-size:24px;line-height:1.12;margin-bottom:8px;text-shadow:0 1px 8px rgba(0,0,0,.5);">${esc(headline)}</div>
      ${sub ? `<div style="font-family:${BF};color:${PAL.cream};font-size:13px;line-height:1.45;opacity:.94;margin-bottom:12px;text-shadow:0 1px 6px rgba(0,0,0,.5);">${esc(sub)}</div>` : ''}
      <div style="display:flex;align-items:center;">${price}<span style="display:inline-block;background:${PAL.cream};color:${PAL.green};font-family:${BF};font-weight:700;font-size:13px;letter-spacing:.03em;padding:10px 20px;border-radius:8px;">${esc(ctaLabel)}</span></div>
      ${handle ? `<div style="font-family:${BF};font-size:11px;color:${PAL.cream};opacity:.8;margin-top:10px;">${esc(handle)}</div>` : ''}
    </div>
  </div>`;
}

function renderAds(o = {}) {
  const c = adCopy(o);
  // Render EVERY angle, not just the primary: the matrix only buys a test if the
  // creatives actually exist side by side for the reviewer to pick between.
  const googleUnit = (v) => `<div style="width:340px;max-width:100%;background:#fff;border:1px solid ${PAL.gold}33;border-radius:12px;padding:16px;">
    <div style="font-size:11px;color:#0a7d33;font-weight:700;">Ad · www.vahdamteas.com</div>
    <div style="color:#1a0dab;font-size:18px;line-height:1.3;margin:6px 0;font-family:${BF};">${esc(v.google.headlines.join(' | '))}</div>
    <div style="color:#4d5156;font-size:13px;line-height:1.5;">${esc(v.google.descriptions.join(' '))}</div></div>`;

  const angleSections = c.variants.map((v) => `
  <section style="border-top:1px solid ${PAL.gold}44;margin-top:26px;padding-top:18px;">
    <h2 style="font-size:17px;margin:0 0 2px;">${esc(v.angle_label)} angle</h2>
    <div style="color:#7a6e5a;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px;">Awareness: ${esc(v.awareness)} &nbsp;·&nbsp; variant key: ${esc(v.angle)}</div>
    <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start;">
      <div><h3 style="font-size:13px;font-family:${BF};color:#7a6e5a;font-weight:700;">Meta · 1:1</h3>${composed(o, { w: 340, ar: '1 / 1', wordmarkTop: 'Sponsored', headline: v._creative.hook, sub: v._creative.body, showPrice: true, ctaLabel: v.meta.cta })}</div>
      <div><h3 style="font-size:13px;font-family:${BF};color:#7a6e5a;font-weight:700;">TikTok / Reels · 9:16</h3>${composed(o, { w: 250, ar: '9 / 16', wordmarkTop: null, headline: v._creative.hook, sub: null, showPrice: true, ctaLabel: v.tiktok.cta, handle: '@vahdam' })}</div>
      <div><h3 style="font-size:13px;font-family:${BF};color:#7a6e5a;font-weight:700;">Google · RSA</h3>${googleUnit(v)}</div>
    </div>
  </section>`).join('');

  // ── VIDEO CREATIVE ─────────────────────────────────────────────────────
  // Scenes come from the same scrubbed copy + verified hero image the statics
  // use, so the video says exactly what the statics say (no new claims).
  const vScenes = [
    { image: o.heroImageUrl || '', headline: o.headline || o.productName, sub: o.tastingLine || '', seconds: 2.6 },
    { image: o.secondImageUrl || o.heroImageUrl || '', headline: o.subline || 'Single-estate, hand-picked', sub: o.price ? String(o.price) : '', seconds: 2.6 },
  ];
  const vSpec = {
    product: o.productName,
    scenes: vScenes,
    cta: c.tiktok.cta || 'Shop now',
    ctaHeadline: o.headline || o.productName,
    offer: o.price || null,
    footnote: shipText(o.market),
  };
  const videoHtml = renderMotionAd(vSpec);
  const videoBrief = motionBrief(vSpec);
  // Inline the animated unit via srcdoc so the preview page shows the real
  // creative playing, not a description of it.
  const videoPreview = `<div style="width:250px;aspect-ratio:9/16;border-radius:12px;overflow:hidden;border:1px solid ${PAL.gold}33;background:#000;/* letterbox-well: black is correct BEHIND video, not a section background */">
    <iframe title="Video ad preview" srcdoc="${esc(videoHtml)}" style="width:250px;height:444px;border:0;display:block;" sandbox="allow-scripts"></iframe></div>`;

  const copyBlock = `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:#fff;border:1px solid ${PAL.gold}33;border-radius:10px;padding:16px;color:${PAL.ink};overflow:auto;">${esc(JSON.stringify(c, null, 2))}</pre>`;

  return {
    copy: c,
    video: { html: videoHtml, brief: videoBrief, aspect: '9:16' },
    angles: c.variants.map((v) => ({ angle: v.angle, label: v.angle_label, awareness: v.awareness })),
    formats: ['meta_1x1_static', 'tiktok_9x16_static', 'google_rsa_text', 'video_9x16_animated'],
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ads · ${esc(o.productName)}</title>
<style>${FONT} body{margin:0;background:${PAL.cream};color:${PAL.ink};font-family:${BF};padding:22px;} h1,h2{font-family:${HF};color:${PAL.green};}</style></head><body>
  <h1 style="font-size:24px;margin:0 0 4px;">Paid-social ads · ${esc(o.productName)}</h1>
  <div style="color:#7a6e5a;font-size:13px;margin-bottom:20px;">Composed creatives (copy on the image). CTA to ${esc(o.ctaUrl)}. Preview only; no platform push. No discount codes fabricated.<br>${c.variants.length} angle${c.variants.length === 1 ? '' : 's'} across the awareness ladder: ${esc(c.variants.map((v) => `${v.angle_label} (${v.awareness})`).join(' · '))}. Every angle recombines the same approved copy, so no angle introduces a claim the others do not make.</div>
  <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start;">
    <div><h2 style="font-size:15px;">Video · 9:16 (plays here)</h2>${videoPreview}</div>
  </div>
  ${angleSections}
  <h2 style="font-size:15px;margin:26px 0 8px;">Video shot list (for the MP4 render)</h2>
  <pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:#fff;border:1px solid ${PAL.gold}33;border-radius:10px;padding:16px;color:${PAL.ink};overflow:auto;">${esc(JSON.stringify(videoBrief, null, 2))}</pre>
  <h2 style="font-size:15px;margin:26px 0 8px;">Copy (structured)</h2>
  ${copyBlock}
</body></html>`,
  };
}

module.exports = { renderAds };
