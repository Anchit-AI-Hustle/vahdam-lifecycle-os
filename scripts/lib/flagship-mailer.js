'use strict';

/**
 * flagship-mailer.js — the VAHDAM "flagship" email design system, templatised
 * from the reference (vh- design: web fonts, green utility bar, colorway hero
 * band, price pill, MSO-safe CTA, trust badges, brand-proof stats bar,
 * non-clickable footer). Hosted image URLs only — never base64.
 *
 * Three colorways match the reference: forest | midnight | daylight.
 * renderFlagship() lays out already-brand-scrubbed strings; callers must still
 * run copy through scenario-model.sanitizeBrand / assertNoBanned first.
 */

const PAL = { green: '#004A2B', gold: '#AB8743', ink: '#171717', cream: '#FBF5EA' };

// Market-aware shipping line. The old renderer hardcoded a US-only "$59" string
// onto every region's mailer/ad; this keeps the country + currency correct.
// Thresholds are the placeholder defaults used across the app — once the B1
// approved-facts library carries a verified per-region threshold, callers pass
// it in via opts.shippingNote and this is bypassed. Never region-agnostic.
function shippingLine(market) {
  const m = String(market || 'US').toUpperCase();
  if (m.startsWith('UK')) return 'FREE UK delivery over &pound;35';
  if (/GLOBAL|EU|AU|ME|IN|ROW|REST/.test(m)) return 'FREE shipping over $59';
  return 'FREE US shipping over $59';
}

// Web fonts + MSO + hover/fade, exactly as the reference flagship template.
const HEADFONTS =
  '@font-face{font-family:"LAO MN";src:url("https://cdn.nector.io/nector-static/fonts/LaoMN-01.ttf") format("truetype");}' +
  '@font-face{font-family:"Proxima Nova";src:url("https://cdn-widgetsrepository.yotpo.com/brandkit/custom-fonts/nULz3c4cbjU7NEqLKreeoyIyIP4L5pnrZ53k1952/proximanova-regular/proximanova-regular.woff2") format("woff2");}';
const HF = "'LAO MN',Georgia,'Times New Roman',serif";
const BF = "'Proxima Nova','Helvetica Neue',Arial,sans-serif";

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Colorway → hero band background/text + CTA colors (all within the 4-color palette).
function colorway(name) {
  switch (name) {
    case 'midnight':
      return { heroBg: PAL.ink, heroText: PAL.cream, eyebrow: PAL.gold, ctaBg: PAL.gold, ctaText: PAL.ink, pill: PAL.gold };
    case 'daylight':
      return { heroBg: PAL.cream, heroText: PAL.ink, eyebrow: PAL.gold, ctaBg: PAL.green, ctaText: PAL.cream, pill: PAL.green, headline: PAL.green };
    case 'forest':
    default:
      return { heroBg: PAL.green, heroText: PAL.cream, eyebrow: PAL.gold, ctaBg: PAL.cream, ctaText: PAL.green, pill: PAL.gold };
  }
}

function band(bg, inner) {
  return `<table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;margin:0 auto;background:${bg};"><tr><td class="p" style="padding:0;font-family:${BF};color:${PAL.ink};">${inner}</td></tr></table>`;
}

function ctaButton(url, label, cw) {
  return `<div style="margin:6px 0 4px;">` +
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(url)}" style="height:50px;v-text-anchor:middle;width:250px;" arcsize="14%" strokecolor="${cw.ctaBg}" fillcolor="${cw.ctaBg}"><w:anchorlock/><center style="color:${cw.ctaText};font-family:${BF};font-size:15px;font-weight:bold;letter-spacing:.03em;">${esc(label)}</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!-- -->` +
    `<a class="cta" href="${esc(url)}" style="display:inline-block;background:${cw.ctaBg};color:${cw.ctaText};font-family:${BF};font-size:15px;font-weight:700;letter-spacing:.03em;text-decoration:none;padding:15px 34px;border-radius:8px;">${esc(label)}</a>` +
    `<!--<![endif]--></div>`;
}

/**
 * opts: {
 *   colorway, withImage, subject, preheader, eyebrow, productName, tastingLine,
 *   price, ctaText, ctaUrl, heroImageUrl, bodyBlocks:[{heading,body}], logoUrl,
 *   headline, subline, market, shippingNote
 * }
 * market drives the region-correct shipping line (US/UK/global); shippingNote
 * overrides it outright once a verified per-region threshold is available.
 */
function renderFlagship(opts) {
  const o = opts || {};
  const cw = colorway(o.colorway || 'forest');
  const logo = o.logoUrl || 'https://www.vahdam.com/cdn/shop/files/logo-website_3.png?v=1754032931&width=310';

  // Hero band: product name (LAO MN) + tasting line + optional image + price pill + CTA.
  const heroHeadColor = cw.headline || cw.heroText;
  const img = (o.withImage && o.heroImageUrl)
    ? `<img src="${esc(o.heroImageUrl)}" width="190" alt="${esc(o.productName)}" style="display:inline-block;width:190px;height:auto;border:0;border-radius:10px;margin:0 0 18px;">`
    : '';
  const pricePill = o.price
    ? `<div style="margin:0 0 20px;"><span style="display:inline-block;font-family:${BF};font-size:14px;font-weight:700;letter-spacing:.04em;color:${cw.pill};border:1px solid ${cw.pill};border-radius:999px;padding:8px 18px;">${esc(o.price)}</span></div>`
    : '';
  const hero =
    `<div style="padding:44px 36px;text-align:center;">` +
    `<div style="font-family:${BF};font-size:11px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:${cw.eyebrow};margin:0 0 12px;">${esc(o.eyebrow)}</div>` +
    `<div style="font-family:${HF};font-size:44px;line-height:1.06;color:${heroHeadColor};margin:0 0 16px;">${esc(o.productName)}</div>` +
    (o.tastingLine ? `<div style="font-family:${BF};font-size:17px;line-height:1.6;font-style:italic;color:${cw.heroText};margin:0 0 22px;">${esc(o.tastingLine)}</div>` : '') +
    img + pricePill + ctaButton(o.ctaUrl, o.ctaText || 'Shop now', cw) +
    `</div>`;

  // Editorial story section (cream): the campaign headline + subline + body blocks.
  const blocks = (o.bodyBlocks || []).map((b) =>
    `<tr><td class="p" style="padding:0 36px 16px;font-family:${BF};">` +
    (b.heading ? `<div style="font-family:${HF};font-size:20px;color:${PAL.green};margin:0 0 5px;">${esc(b.heading)}</div>` : '') +
    `<div style="font-family:${BF};font-size:15px;line-height:1.7;color:${PAL.ink};">${esc(b.body)}</div></td></tr>`).join('');
  const editorial =
    `<table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;margin:0 auto;background:${PAL.cream};">` +
    (o.headline ? `<tr><td class="p" style="padding:30px 36px 6px;text-align:center;font-family:${HF};font-size:26px;line-height:1.2;color:${PAL.green};">${esc(o.headline)}</td></tr>` : '') +
    (o.subline ? `<tr><td class="p" style="padding:0 36px 18px;text-align:center;font-family:${BF};font-size:15px;line-height:1.6;color:${PAL.ink};">${esc(o.subline)}</td></tr>` : '') +
    blocks + `</table>`;

  const shipNote = o.shippingNote || shippingLine(o.market);
  const utility = band(PAL.green,
    `<div style="padding:12px 20px;text-align:center;font-family:${BF};font-size:12px;font-weight:700;letter-spacing:.08em;color:${PAL.cream};">From the hands that picked it to the cup you hold &nbsp;·&nbsp; ${shipNote}</div>`);
  const logoRow = band(PAL.cream,
    `<div style="padding:22px 20px 10px;text-align:center;"><a href="https://www.vahdamteas.com" style="text-decoration:none;border:0;"><img src="${esc(logo)}" alt="VAHDAM" width="152" style="display:inline-block;width:152px;height:auto;border:0;"></a></div>`);
  const badges = band(PAL.cream,
    `<div style="padding:14px 22px 6px;text-align:center;font-family:${BF};font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${PAL.gold};">Climate Neutral &nbsp;·&nbsp; Non-GMO Verified &nbsp;·&nbsp; Plastic Neutral</div>`);
  const stats = band(PAL.cream,
    `<div style="padding:10px 22px 20px;text-align:center;font-family:${BF};font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:${PAL.ink};">Rated 4.9/5 · 250,000+ reviews &nbsp;·&nbsp; 6 million customers &nbsp;·&nbsp; Oprah&rsquo;s Favorite Things</div>`);
  const footer = band(PAL.green,
    `<div style="padding:28px 30px;text-align:center;font-family:${BF};font-size:12px;line-height:1.8;color:${PAL.cream};">VAHDAM&reg; USA · Vahdam Teas Global, Inc.<br>440 N Barranca Ave #2812, Covina, CA 91723, United States<br><br>You are receiving this because you shopped with VAHDAM&reg;.<br><span style="color:${PAL.gold};font-weight:700;">Unsubscribe &nbsp;·&nbsp; Email preferences &nbsp;·&nbsp; Privacy Policy &nbsp;·&nbsp; Terms of Service</span></div>`);

  return `<!DOCTYPE html><html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]--><title>${esc(o.subject)}</title><style>${HEADFONTS}body{margin:0;padding:0;background:${PAL.cream};-webkit-text-size-adjust:100%;}img{-ms-interpolation-mode:bicubic;border:0;line-height:100%;}a.cta{transition:transform .15s ease,box-shadow .18s ease;}a.cta:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(0,74,43,.28);}@media (prefers-reduced-motion:no-preference){.fade{animation:vf .7s ease both;}}@keyframes vf{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}@media only screen and (max-width:620px){table[width="600"]{width:100%!important;}.col{display:block!important;width:100%!important;}.p{padding-left:22px!important;padding-right:22px!important;}}</style></head><body style="margin:0;padding:0;background:${PAL.cream};"><div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(o.preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAL.cream};"><tr><td>${utility}${logoRow}<div class="fade">${band(cw.heroBg, hero)}${editorial}${badges}${stats}</div>${footer}</td></tr></table></body></html>`;
}

module.exports = { renderFlagship, colorway, shippingLine, PAL };
