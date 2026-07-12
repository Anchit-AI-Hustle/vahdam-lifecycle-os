'use strict';

/**
 * ad-creative.js — VAHDAM paid-social ad previews (Meta / Google / TikTok) for one
 * campaign slot, in the flagship palette. Produces (a) a self-contained HTML page
 * with three platform preview cards and the copy, and (b) a structured copy object
 * for the manifest. Hosted image URLs only; callers pre-scrub copy (sanitizeBrand).
 * No invented discount codes or fabricated claims.
 */
const { PAL } = require('./flagship-mailer.js');
const HF = "'LAO MN','Cormorant Garamond',Georgia,serif";
const BF = "'Proxima Nova','Helvetica Neue',Arial,sans-serif";
const FONT =
  '@font-face{font-family:"LAO MN";src:url("https://cdn.nector.io/nector-static/fonts/LaoMN-01.ttf") format("truetype");}' +
  '@font-face{font-family:"Proxima Nova";src:url("https://cdn-widgetsrepository.yotpo.com/brandkit/custom-fonts/nULz3c4cbjU7NEqLKreeoyIyIP4L5pnrZ53k1952/proximanova-regular/proximanova-regular.woff2") format("woff2");}';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function clamp(s, n) { s = String(s || ''); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; }

// Derive per-platform copy from the shared slot copy (adapted, not duplicated).
function adCopy(o) {
  const p = o.productName, price = o.price ? ` (${o.price})` : '';
  return {
    meta: {
      platform: 'Meta (Instagram/Facebook)', ratio: '1:1',
      primary_text: clamp(`${o.headline}. ${o.subline}`, 125),
      headline: clamp(p, 40),
      description: clamp(o.tastingLine || 'Single-estate, hand-picked at origin.', 30),
      cta: 'Shop Now',
    },
    google: {
      platform: 'Google (Responsive Search)', ratio: 'text',
      headlines: [clamp(p, 30), clamp(o.headline, 30), clamp('Single-Estate, Hand-Picked', 30)],
      descriptions: [clamp(`${o.subline}`, 90), clamp(`${o.tastingLine || ''}. Free US shipping over $59.`, 90)],
      cta: 'Shop',
    },
    tiktok: {
      platform: 'TikTok', ratio: '9:16',
      primary_text: clamp(`${o.headline} ${price}`, 100),
      hook: clamp(o.subline, 60),
      cta: 'Shop Now',
    },
  };
}

function card(inner) {
  return `<div style="background:#fff;border:1px solid ${PAL.gold}33;border-radius:14px;overflow:hidden;width:340px;max-width:100%;">${inner}</div>`;
}
function heroBlock(o, h) {
  return o.heroImageUrl
    ? `<img src="${esc(o.heroImageUrl)}" alt="${esc(o.productName)}" style="display:block;width:100%;height:${h}px;object-fit:cover;">`
    : `<div style="height:${h}px;background:${PAL.green};display:flex;align-items:center;justify-content:center;color:${PAL.cream};font-family:${HF};font-size:22px;text-align:center;padding:14px;">${esc(o.productName)}</div>`;
}

function renderAds(o = {}) {
  const c = adCopy(o);
  const meta = card(
    `<div style="padding:10px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #eee;"><div style="width:26px;height:26px;border-radius:50%;background:${PAL.green};"></div><b style="font-size:13px;">vahdam</b><span style="margin-left:auto;color:#999;">•••</span></div>` +
    heroBlock(o, 340) +
    `<div style="padding:12px;"><a href="${esc(o.ctaUrl)}" style="display:block;text-align:center;background:${PAL.green};color:${PAL.cream};text-decoration:none;font-weight:700;padding:10px;border-radius:6px;font-size:13px;">${esc(c.meta.cta)} →</a>` +
    `<div style="font-size:13px;line-height:1.5;margin-top:10px;color:${PAL.ink};"><b>vahdam</b> ${esc(c.meta.primary_text)}</div></div>`);
  const tiktok = card(
    `<div style="position:relative;">${heroBlock(o, 460)}` +
    `<div style="position:absolute;left:0;right:0;bottom:0;padding:16px 14px;background:linear-gradient(transparent,rgba(0,0,0,.6));color:#fff;">` +
    `<div style="font-family:${BF};font-size:14px;font-weight:700;">@vahdam</div>` +
    `<div style="font-size:13px;line-height:1.45;margin:6px 0 10px;">${esc(c.tiktok.primary_text)}</div>` +
    `<span style="display:inline-block;background:${PAL.gold};color:${PAL.ink};font-weight:700;font-size:12px;padding:8px 16px;border-radius:6px;">${esc(c.tiktok.cta)}</span></div></div>`);
  const google = card(
    `<div style="padding:16px;">` +
    `<div style="font-size:11px;color:#0a7d33;font-weight:700;">Ad · www.vahdamteas.com</div>` +
    `<div style="color:#1a0dab;font-size:18px;line-height:1.3;margin:6px 0;font-family:${BF};">${esc(c.google.headlines.join(' | '))}</div>` +
    `<div style="color:#4d5156;font-size:13px;line-height:1.5;">${esc(c.google.descriptions.join(' '))}</div></div>`);

  const copyBlock = `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:#fff;border:1px solid ${PAL.gold}33;border-radius:10px;padding:16px;color:${PAL.ink};overflow:auto;">${esc(JSON.stringify(c, null, 2))}</pre>`;

  return {
    copy: c,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ads · ${esc(o.productName)}</title>
<style>${FONT} body{margin:0;background:${PAL.cream};color:${PAL.ink};font-family:${BF};padding:22px;} h1,h2{font-family:${HF};color:${PAL.green};}</style></head><body>
  <h1 style="font-size:24px;margin:0 0 4px;">Paid-social ads · ${esc(o.productName)}</h1>
  <div style="color:#7a6e5a;font-size:13px;margin-bottom:20px;">${esc(o.headline)} · CTA to ${esc(o.ctaUrl)}. Preview only; no platform push. No discount codes fabricated.</div>
  <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;">
    <div><h2 style="font-size:15px;">Meta · 1:1</h2>${meta}</div>
    <div><h2 style="font-size:15px;">TikTok · 9:16</h2>${tiktok}</div>
    <div><h2 style="font-size:15px;">Google · RSA</h2>${google}</div>
  </div>
  <h2 style="font-size:15px;margin:26px 0 8px;">Copy (structured)</h2>
  ${copyBlock}
</body></html>`,
  };
}

module.exports = { renderAds };
