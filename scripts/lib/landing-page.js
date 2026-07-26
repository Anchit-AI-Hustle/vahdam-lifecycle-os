'use strict';

/**
 * landing-page.js — brand-compliant VAHDAM landing page (flagship design system).
 * Longer than a mailer: utility bar, hero, benefit grid, product card, trust
 * badges, brand-proof stats, testimonial, FAQ, closing CTA, footer.
 * Hosted image URLs only. Callers must pre-scrub copy (sanitizeBrand).
 */
const { PAL, shippingLine } = require('./flagship-mailer.js');
const HF = "'LAO MN','Cormorant Garamond',Georgia,serif";
const BF = "'Proxima Nova','Helvetica Neue',Arial,sans-serif";
const FONT =
  '@font-face{font-family:"LAO MN";src:url("https://cdn.nector.io/nector-static/fonts/LaoMN-01.ttf") format("truetype");}' +
  '@font-face{font-family:"Proxima Nova";src:url("https://cdn-widgetsrepository.yotpo.com/brandkit/custom-fonts/nULz3c4cbjU7NEqLKreeoyIyIP4L5pnrZ53k1952/proximanova-regular/proximanova-regular.woff2") format("woff2");}';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/**
 * opts: { title, subject, productName, tastingLine, price, ctaText, ctaUrl,
 *   heroImageUrl, logoUrl, headline, subline, bodyBlocks:[{heading,body}],
 *   faq:[{q,a}], testimonial:{quote,who} }
 */
// Region-correct store URLs (CLAUDE.md, VERIFIED) - used when no ctaUrl is
// given, so a generated page never ships an empty href.
const STORE = { US: 'https://www.vahdamteas.com', UK: 'https://uk.vahdamteas.com',
  IN: 'https://www.vahdamindia.com', EU: 'https://eu.vahdamteas.com',
  AU: 'https://au.vahdamteas.com', GLOBAL: 'https://www.vahdamteas.com' };

/**
 * Required-input gate. A landing page with no product name or no destination is
 * not a page, it is a broken asset - fail loudly at build time (zero fabrication:
 * we do not invent a product or a URL to paper over a missing input).
 */
function assertLandingInputs(o) {
  const missing = [];
  if (!o.productName) missing.push('productName');
  if (!o.ctaUrl && !o.market) missing.push('ctaUrl (or market, to derive the store URL)');
  if (missing.length) {
    throw new Error('landing-page: [DATA REQUIRED BEFORE LAUNCH: ' + missing.join(', ') + ']');
  }
}

function renderLandingPage(o = {}) {
  assertLandingInputs(o);
  const ctaUrl = o.ctaUrl || STORE[String(o.market || 'US').toUpperCase()] || STORE.US;
  const logo = o.logoUrl || 'https://www.vahdam.com/cdn/shop/files/logo-website_3.png?v=1754032931&width=310';
  const benefits = (o.bodyBlocks || []).map((b) => `
      <div style="flex:1 1 240px;background:#fff;border:1px solid ${PAL.gold}33;border-radius:12px;padding:22px 20px;">
        <div style="font-family:${HF};font-size:19px;color:${PAL.green};margin:0 0 8px;">${esc(b.heading)}</div>
        <div style="font-family:${BF};font-size:15px;line-height:1.65;color:${PAL.ink};">${esc(b.body)}</div>
      </div>`).join('');
  const faq = (o.faq && o.faq.length) ? `
    <section style="max-width:760px;margin:0 auto;padding:10px 22px 40px;">
      <h2 style="font-family:${HF};color:${PAL.green};font-size:26px;text-align:center;margin:0 0 18px;">Questions, answered</h2>
      ${o.faq.map((f) => `<div style="border-bottom:1px solid ${PAL.gold}33;padding:14px 0;">
        <div style="font-family:${BF};font-weight:700;color:${PAL.ink};font-size:15px;margin-bottom:5px;">${esc(f.q)}</div>
        <div style="font-family:${BF};color:#4a4235;font-size:14.5px;line-height:1.6;">${esc(f.a)}</div></div>`).join('')}
    </section>` : '';
  const testimonial = o.testimonial ? `
    <section style="background:${PAL.green};padding:40px 22px;text-align:center;">
      <div style="max-width:720px;margin:0 auto;font-family:${HF};font-size:24px;line-height:1.4;color:${PAL.cream};font-style:italic;">&ldquo;${esc(o.testimonial.quote)}&rdquo;</div>
      <div style="font-family:${BF};font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${PAL.gold};margin-top:14px;font-weight:700;">${esc(o.testimonial.who)}</div>
    </section>` : '';
  // VIDEO block: paid traffic converts better with motion above the fold, and
  // the ad set now ships a video creative - the LP should be able to show it.
  // Muted + inline + loop so it autoplays on mobile without a sound surprise.
  const video = o.videoUrl ? `
    <section style="background:${PAL.cream};padding:32px 22px 8px;">
      <div style="max-width:520px;margin:0 auto;border-radius:16px;overflow:hidden;border:1px solid ${PAL.gold}33;background:#000;">
        <video src="${esc(o.videoUrl)}"${o.videoPoster ? ` poster="${esc(o.videoPoster)}"` : ''} muted playsinline autoplay loop controls preload="metadata" style="display:block;width:100%;height:auto;"></video>
      </div>
      ${o.videoCaption ? `<div style="text-align:center;font-family:${BF};font-size:13px;color:#7a6e5a;margin-top:10px;">${esc(o.videoCaption)}</div>` : ''}
    </section>` : '';

  const heroImg = o.heroImageUrl ? `<img src="${esc(o.heroImageUrl)}" alt="${esc(o.productName)}" style="display:block;width:100%;max-width:420px;height:auto;margin:22px auto 0;border-radius:14px;">` : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title || o.productName)}</title>
<style>${FONT}
  *{box-sizing:border-box;} body{margin:0;background:${PAL.cream};color:${PAL.ink};font-family:${BF};-webkit-font-smoothing:antialiased;}
  a{color:inherit;} img{max-width:100%;}
  .cta{display:inline-block;background:${PAL.green};color:${PAL.cream};font-family:${BF};font-weight:700;letter-spacing:.03em;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:16px;}
  .cta.gold{background:${PAL.gold};color:${PAL.ink};}
  .util{background:${PAL.green};color:${PAL.cream};text-align:center;font-size:12px;font-weight:700;letter-spacing:.08em;padding:11px 16px;}
  .badges{text-align:center;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${PAL.gold};padding:16px;}
  .stickycta{display:none;}
  @media (max-width:640px){
    .stickycta{display:block;position:fixed;left:0;right:0;bottom:0;z-index:9;
      box-shadow:0 -6px 20px rgba(23,23,23,.18);padding-bottom:env(safe-area-inset-bottom,0);}
    body{padding-bottom:64px;}
  }
  .stats{text-align:center;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${PAL.ink};padding:0 16px 22px;}
</style></head><body>
  <div class="util">From the hands that picked it to the cup you hold &nbsp;·&nbsp; ${o.shippingNote || shippingLine(o.market)}</div>
  <div style="text-align:center;padding:22px 0 4px;"><img src="${esc(logo)}" alt="VAHDAM" width="150" style="width:150px;height:auto;"></div>
  <section style="background:${PAL.green};color:${PAL.cream};padding:44px 22px;text-align:center;">
    <div style="font-family:${BF};font-size:11px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:${PAL.gold};">${esc(o.headline || 'Single-estate, hand-picked')}</div>
    <h1 style="font-family:${HF};font-size:44px;line-height:1.08;margin:14px 0 12px;color:${PAL.cream};">${esc(o.productName)}</h1>
    ${o.tastingLine ? `<div style="font-family:${BF};font-style:italic;font-size:18px;color:${PAL.cream};opacity:.92;margin:0 0 8px;">${esc(o.tastingLine)}</div>` : ''}
    ${o.subline ? `<div style="font-family:${BF};font-size:16px;line-height:1.6;max-width:620px;margin:0 auto 18px;color:${PAL.cream};">${esc(o.subline)}</div>` : ''}
    ${o.price ? `<div style="margin:0 0 18px;"><span style="display:inline-block;border:1px solid ${PAL.gold};color:${PAL.gold};border-radius:999px;padding:8px 18px;font-weight:700;">${esc(o.price)}</span></div>` : ''}
    <a class="cta gold" href="${esc(ctaUrl)}">${esc(o.ctaText || 'Shop now')}</a>
    ${heroImg}
  </section>
  ${video}
  ${benefits ? `<section style="max-width:920px;margin:0 auto;padding:36px 22px 10px;">
    <div style="display:flex;gap:16px;flex-wrap:wrap;">${benefits}</div>
  </section>` : ''}
  <div class="badges">Climate Neutral &nbsp;·&nbsp; Non-GMO Verified &nbsp;·&nbsp; Plastic Neutral</div>
  <div class="stats">Rated 4.9/5 · 250,000+ reviews &nbsp;·&nbsp; 6 million customers &nbsp;·&nbsp; Oprah&rsquo;s Favorite Things</div>
  ${testimonial}
  ${faq}
  <section style="text-align:center;padding:40px 22px;background:${PAL.cream};">
    <a class="cta" href="${esc(ctaUrl)}">${esc(o.ctaText || 'Shop now')}</a>
    ${o.collectionCta ? `<div style="margin-top:16px;"><a href="${esc(o.collectionCta.url)}" style="font-family:${BF};font-size:14px;font-weight:700;color:${PAL.green};text-decoration:underline;">Explore all ${esc(o.collectionCta.title)} →</a></div>` : ''}
  </section>
  <div class="stickycta"><a class="cta gold" href="${esc(ctaUrl)}" style="display:block;text-align:center;border-radius:0;padding:15px 20px;">${esc(o.ctaText || 'Shop now')}${o.price ? ` · ${esc(o.price)}` : ''}</a></div>
  <footer style="background:${PAL.green};color:${PAL.cream};text-align:center;font-size:12px;line-height:1.8;padding:26px 20px;">VAHDAM&reg; · Vahdam Teas Global Inc.<br>${o.footerAddress ? esc(o.footerAddress) : '[DATA REQUIRED BEFORE LAUNCH: registered mailing address, region ' + esc(String(o.market || 'US')) + ']'}<br><span style="color:${PAL.gold};font-weight:700;">Privacy Policy &nbsp;·&nbsp; Terms of Service &nbsp;·&nbsp; Shipping &amp; Returns</span></footer>
</body></html>`;
}

module.exports = { renderLandingPage };
