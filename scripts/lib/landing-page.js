'use strict';

/**
 * landing-page.js — brand-compliant VAHDAM landing page (flagship design system).
 *
 * A campaign destination, not a brochure. Section order follows the proven
 * corpus in landing-pages/final/: utility bar, hero, video, problem/why-now,
 * benefit grid, mechanism (origin + craft), steeping ritual, certifications,
 * regional proof, testimonials, comparison, objections/guarantee, FAQ, closing
 * CTA, sticky mobile CTA, legal footer.
 *
 * ZERO-FABRICATION CONTRACT (docs/campaign-orchestration-master-spec.md):
 * every optional section renders ONLY when the caller supplies real data for it.
 * There is no filler and no default prose - an absent section is correct output,
 * invented copy is not. Ratings/reviews/addresses are REGIONAL and arrive from
 * the caller (or flagship-mailer's sourced per-region sets); a testimonial MUST
 * carry provenance or the build fails loudly. Hosted image URLs only.
 * Callers pre-scrub copy (sanitizeBrand).
 */
const {
  PAL, shippingLine, CERTIFICATIONS,
  brandProof, registeredAddress, legalEntity, dataRequired, marketKey,
} = require('./flagship-mailer.js');
const HF = "'LAO MN','Cormorant Garamond',Georgia,serif";
const BF = "'Proxima Nova','Helvetica Neue',Arial,sans-serif";
const FONT =
  '@font-face{font-family:"LAO MN";src:url("https://cdn.nector.io/nector-static/fonts/LaoMN-01.ttf") format("truetype");}' +
  '@font-face{font-family:"Proxima Nova";src:url("https://cdn-widgetsrepository.yotpo.com/brandkit/custom-fonts/nULz3c4cbjU7NEqLKreeoyIyIP4L5pnrZ53k1952/proximanova-regular/proximanova-regular.woff2") format("woff2");}';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
// JSON-LD is injected inside a <script> element, where HTML entity escaping does
// NOT apply - only a literal "</script" can break out. Escape the angle bracket
// at the unicode level so the payload stays valid JSON.
function jsonLd(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c'); }

// Region-correct store URLs (CLAUDE.md, VERIFIED) - used when no ctaUrl is
// given, so a generated page never ships an empty href.
const STORE = { US: 'https://www.vahdamteas.com', UK: 'https://uk.vahdamteas.com',
  IN: 'https://www.vahdamindia.com', EU: 'https://eu.vahdamteas.com',
  AU: 'https://au.vahdamteas.com', GLOBAL: 'https://www.vahdamteas.com' };

// Currency per region, for Product/Offer structured data. A price with the wrong
// currency code is worse than no structured data, so an unknown market emits none.
const CURRENCY = { US: 'USD', UK: 'GBP', IN: 'INR', EU: 'EUR', AU: 'AUD', GLOBAL: 'USD' };

/**
 * opts (all optional unless noted):
 *   REQUIRED: productName, and one of ctaUrl | market
 *   hero:      title, subject, tastingLine, price, ctaText, ctaUrl, heroImageUrl,
 *              logoUrl, headline, subline, eyebrow
 *   media:     videoUrl, videoPoster, videoCaption
 *   body:      bodyBlocks:[{heading,body}]
 *   long-form: problem:{heading,body}, mechanism:{heading,body,points:[]},
 *              steeping:{heading,steps:[]}, comparison:{heading,rows:[{label,us,them}],
 *              usLabel,themLabel}, objections:[{q,a}], guarantee:{heading,body}
 *   proof:     certifications:[], proof:[] (regional; defaults to the sourced set
 *              for this market, or nothing), testimonials:[{quote,who,source}]
 *              (`source` is MANDATORY - provenance for an approved review),
 *              testimonial:{...} (back-compat, single)
 *   faq:       faq:[{q,a}]
 *   meta:      canonicalUrl, ogImageUrl, metaDescription
 *   legal:     footerAddress, shippingNote
 *   extra:     collectionCta:{url,title}
 */

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
  // A review without provenance is an invented review. The spec bans inventing
  // reviewers outright, so this is a hard build failure and not a soft marker:
  // a caller reaching here has authored a quote rather than cited one.
  const quotes = (o.testimonials || []).concat(o.testimonial ? [o.testimonial] : []);
  quotes.forEach((t) => {
    if (t && t.quote && !t.source) {
      throw new Error(
        'landing-page: testimonial without `source` provenance is a fabricated review ' +
        '(spec: only approved review data, never invent reviewers). Quote: ' +
        JSON.stringify(String(t.quote).slice(0, 60)));
    }
  });
}

function renderLandingPage(o = {}) {
  assertLandingInputs(o);
  const mkt = marketKey(o.market);
  const ctaUrl = o.ctaUrl || STORE[mkt] || STORE.US;
  const logo = o.logoUrl || 'https://www.vahdam.com/cdn/shop/files/logo-website_3.png?v=1754032931&width=310';
  const ctaText = o.ctaText || 'Shop now';
  const sectionMax = 'max-width:920px;margin:0 auto;';

  // Reusable section heading, so every long-form block matches the hero's type.
  const h2 = (t) => `<h2 style="font-family:${HF};color:${PAL.green};font-size:28px;line-height:1.2;text-align:center;margin:0 0 16px;">${esc(t)}</h2>`;

  const benefits = (o.bodyBlocks || []).map((b) => `
      <div style="flex:1 1 240px;background:#fff;border:1px solid ${PAL.gold}33;border-radius:12px;padding:22px 20px;">
        <div style="font-family:${HF};font-size:19px;color:${PAL.green};margin:0 0 8px;">${esc(b.heading)}</div>
        <div style="font-family:${BF};font-size:15px;line-height:1.65;color:${PAL.ink};">${esc(b.body)}</div>
      </div>`).join('');

  // ── PROBLEM / WHY NOW ────────────────────────────────────────────────────
  // The proven corpus opens the body by naming the reader's situation before it
  // sells. Renders only from supplied copy.
  const problem = o.problem ? `
    <section style="${sectionMax}padding:38px 22px 6px;">
      ${o.problem.heading ? h2(o.problem.heading) : ''}
      <div style="font-family:${BF};font-size:16.5px;line-height:1.75;color:${PAL.ink};max-width:660px;margin:0 auto;text-align:center;">${esc(o.problem.body)}</div>
    </section>` : '';

  // ── MECHANISM: why this leaf, how it is made ─────────────────────────────
  const mechPoints = (o.mechanism && o.mechanism.points || []).map((p) => `
        <li style="font-family:${BF};font-size:15.5px;line-height:1.7;color:${PAL.ink};margin:0 0 9px;">${esc(p)}</li>`).join('');
  const mechanism = o.mechanism ? `
    <section style="background:#fff;border-top:1px solid ${PAL.gold}22;border-bottom:1px solid ${PAL.gold}22;">
      <div style="${sectionMax}padding:38px 22px;">
        ${o.mechanism.heading ? h2(o.mechanism.heading) : ''}
        ${o.mechanism.body ? `<div style="font-family:${BF};font-size:16px;line-height:1.75;color:${PAL.ink};max-width:660px;margin:0 auto 16px;text-align:center;">${esc(o.mechanism.body)}</div>` : ''}
        ${mechPoints ? `<ul style="max-width:620px;margin:0 auto;padding:0 0 0 20px;">${mechPoints}</ul>` : ''}
      </div>
    </section>` : '';

  // ── STEEPING RITUAL ──────────────────────────────────────────────────────
  // Numbered, equal-weight steps (spec: equal-size aligned parallel cards).
  const steepSteps = (o.steeping && o.steeping.steps || []).map((s, i) => `
        <div style="flex:1 1 200px;background:${PAL.cream};border:1px solid ${PAL.gold}33;border-radius:12px;padding:20px 18px;">
          <div style="font-family:${HF};font-size:26px;color:${PAL.gold};line-height:1;margin:0 0 8px;">${i + 1}</div>
          <div style="font-family:${BF};font-size:15px;line-height:1.65;color:${PAL.ink};">${esc(s)}</div>
        </div>`).join('');
  const steeping = steepSteps ? `
    <section style="${sectionMax}padding:38px 22px 10px;">
      ${h2(o.steeping.heading || 'How to steep it')}
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:stretch;">${steepSteps}</div>
    </section>` : '';

  // ── COMPARISON ───────────────────────────────────────────────────────────
  // Two honest columns. `them` is a generic category descriptor supplied by the
  // caller, never a named competitor claim we cannot source.
  const cmpRows = (o.comparison && o.comparison.rows || []).map((r) => `
        <tr>
          <td style="padding:12px 14px;font-family:${BF};font-size:14.5px;color:${PAL.ink};border-bottom:1px solid ${PAL.gold}22;">${esc(r.label)}</td>
          <td style="padding:12px 14px;font-family:${BF};font-size:14.5px;font-weight:700;color:${PAL.green};border-bottom:1px solid ${PAL.gold}22;text-align:center;">${esc(r.us)}</td>
          <td style="padding:12px 14px;font-family:${BF};font-size:14.5px;color:#6b6154;border-bottom:1px solid ${PAL.gold}22;text-align:center;">${esc(r.them)}</td>
        </tr>`).join('');
  const comparison = cmpRows ? `
    <section style="${sectionMax}padding:34px 22px 10px;">
      ${h2(o.comparison.heading || 'How it compares')}
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid ${PAL.gold}33;border-radius:12px;">
          <tr>
            <th style="padding:12px 14px;text-align:left;font-family:${BF};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b6154;border-bottom:1px solid ${PAL.gold}33;"></th>
            <th style="padding:12px 14px;font-family:${BF};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${PAL.green};border-bottom:1px solid ${PAL.gold}33;">${esc(o.comparison.usLabel || 'VAHDAM')}</th>
            <th style="padding:12px 14px;font-family:${BF};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b6154;border-bottom:1px solid ${PAL.gold}33;">${esc(o.comparison.themLabel || 'Supermarket tea')}</th>
          </tr>
          ${cmpRows}
        </table>
      </div>
    </section>` : '';

  // ── OBJECTIONS + GUARANTEE ───────────────────────────────────────────────
  const objections = (o.objections || []).map((x) => `
        <div style="flex:1 1 260px;background:#fff;border:1px solid ${PAL.gold}33;border-radius:12px;padding:20px 18px;">
          <div style="font-family:${BF};font-weight:700;font-size:15px;color:${PAL.green};margin:0 0 6px;">${esc(x.q)}</div>
          <div style="font-family:${BF};font-size:14.5px;line-height:1.65;color:${PAL.ink};">${esc(x.a)}</div>
        </div>`).join('');
  const objectionBlock = objections ? `
    <section style="${sectionMax}padding:34px 22px 10px;">
      ${h2('Still deciding?')}
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:stretch;">${objections}</div>
    </section>` : '';
  const guarantee = o.guarantee ? `
    <section style="${sectionMax}padding:20px 22px 30px;">
      <div style="border:1px solid ${PAL.gold};border-radius:14px;padding:24px 22px;text-align:center;background:#fff;">
        <div style="font-family:${HF};font-size:21px;color:${PAL.green};margin:0 0 8px;">${esc(o.guarantee.heading || 'Our promise')}</div>
        <div style="font-family:${BF};font-size:15.5px;line-height:1.7;color:${PAL.ink};max-width:560px;margin:0 auto;">${esc(o.guarantee.body)}</div>
      </div>
    </section>` : '';

  const faq = (o.faq && o.faq.length) ? `
    <section style="max-width:760px;margin:0 auto;padding:10px 22px 40px;">
      <h2 style="font-family:${HF};color:${PAL.green};font-size:26px;text-align:center;margin:0 0 18px;">Questions, answered</h2>
      ${o.faq.map((f) => `<div style="border-bottom:1px solid ${PAL.gold}33;padding:14px 0;">
        <div style="font-family:${BF};font-weight:700;color:${PAL.ink};font-size:15px;margin-bottom:5px;">${esc(f.q)}</div>
        <div style="font-family:${BF};color:#4a4235;font-size:14.5px;line-height:1.6;">${esc(f.a)}</div></div>`).join('')}
    </section>` : '';

  // ── TESTIMONIALS ─────────────────────────────────────────────────────────
  // Provenance already enforced in assertLandingInputs. `source` is rendered so
  // a reviewer can trace the quote back to the approved review it came from.
  const quotes = (o.testimonials || []).concat(o.testimonial ? [o.testimonial] : []);
  const testimonial = quotes.length ? `
    <section style="background:${PAL.green};padding:40px 22px;">
      <div style="${sectionMax}display:flex;gap:18px;flex-wrap:wrap;align-items:stretch;justify-content:center;">
        ${quotes.map((t) => `<figure style="flex:1 1 300px;margin:0;text-align:center;">
          <blockquote style="margin:0;font-family:${HF};font-size:${quotes.length > 1 ? '20px' : '24px'};line-height:1.4;color:${PAL.cream};font-style:italic;">&ldquo;${esc(t.quote)}&rdquo;</blockquote>
          <figcaption style="font-family:${BF};font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${PAL.gold};margin-top:14px;font-weight:700;">${esc(t.who)}</figcaption>
          <div style="font-family:${BF};font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${PAL.cream};opacity:.6;margin-top:5px;">${esc(t.source)}</div>
        </figure>`).join('')}
      </div>
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

  // Certifications are company-level; regional proof comes from the sourced set
  // for THIS market (or nothing - never another region's rating).
  const certList = o.certifications || CERTIFICATIONS;
  const certBar = (certList && certList.length)
    ? `<div class="badges">${certList.map(esc).join(' &nbsp;·&nbsp; ')}</div>` : '';
  const proofList = o.proof || brandProof(o.market);
  const proofBar = (proofList && proofList.length)
    ? `<div class="stats">${proofList.map(esc).join(' &nbsp;·&nbsp; ')}</div>` : '';

  // ── HEAD META + STRUCTURED DATA ──────────────────────────────────────────
  // A campaign destination gets shared and crawled. Description/OG image come
  // from real supplied copy and the verified hero asset - nothing invented.
  const pageTitle = o.title || o.productName;
  const desc = o.metaDescription || o.subline || o.tastingLine || '';
  const ogImg = o.ogImageUrl || o.heroImageUrl || '';
  const head = [
    desc ? `<meta name="description" content="${esc(desc)}">` : '',
    o.canonicalUrl ? `<link rel="canonical" href="${esc(o.canonicalUrl)}">` : '',
    `<meta property="og:type" content="product">`,
    `<meta property="og:title" content="${esc(pageTitle)}">`,
    desc ? `<meta property="og:description" content="${esc(desc)}">` : '',
    ogImg ? `<meta property="og:image" content="${esc(ogImg)}">` : '',
    o.canonicalUrl ? `<meta property="og:url" content="${esc(o.canonicalUrl)}">` : '',
    `<meta name="twitter:card" content="${ogImg ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(pageTitle)}">`,
    desc ? `<meta name="twitter:description" content="${esc(desc)}">` : '',
    ogImg ? `<meta name="twitter:image" content="${esc(ogImg)}">` : '',
  ].filter(Boolean).join('');

  // Product schema. Price only when it parses AND the market has a known
  // currency code - a bare number with the wrong currency is worse than none.
  // aggregateRating is deliberately NEVER emitted from the brand proof bar: that
  // is a storefront-wide rating, and attaching it to a Product would assert it as
  // this SKU's rating (spec: never transfer a rating across products).
  const priceNum = o.price ? String(o.price).replace(/[^0-9.]/g, '') : '';
  const cur = CURRENCY[mkt];
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: o.productName, brand: { '@type': 'Brand', name: 'VAHDAM' } };
  if (desc) ld.description = desc;
  if (ogImg) ld.image = ogImg;
  if (priceNum && cur) ld.offers = { '@type': 'Offer', price: priceNum, priceCurrency: cur, url: ctaUrl, availability: 'https://schema.org/InStock' };
  const faqLd = (o.faq && o.faq.length) ? {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: o.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  } : null;
  const schema = `<script type="application/ld+json">${jsonLd(ld)}</script>` +
    (faqLd ? `<script type="application/ld+json">${jsonLd(faqLd)}</script>` : '');

  const addr = o.footerAddress || registeredAddress(o.market) || dataRequired('registered mailing address', o.market);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(pageTitle)}</title>${head}
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
    h1{font-size:32px!important;}
  }
  .stats{text-align:center;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${PAL.ink};padding:0 16px 22px;}
</style>${schema}</head><body>
  <div class="util">From the hands that picked it to the cup you hold &nbsp;·&nbsp; ${o.shippingNote || shippingLine(o.market)}</div>
  <div style="text-align:center;padding:22px 0 4px;"><img src="${esc(logo)}" alt="VAHDAM" width="150" style="width:150px;height:auto;"></div>
  <section style="background:${PAL.green};color:${PAL.cream};padding:44px 22px;text-align:center;">
    <div style="font-family:${BF};font-size:11px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:${PAL.gold};">${esc(o.eyebrow || o.headline || 'Single-estate, hand-picked')}</div>
    <h1 style="font-family:${HF};font-size:44px;line-height:1.08;margin:14px 0 12px;color:${PAL.cream};">${esc(o.productName)}</h1>
    ${o.tastingLine ? `<div style="font-family:${BF};font-style:italic;font-size:18px;color:${PAL.cream};opacity:.92;margin:0 0 8px;">${esc(o.tastingLine)}</div>` : ''}
    ${o.subline ? `<div style="font-family:${BF};font-size:16px;line-height:1.6;max-width:620px;margin:0 auto 18px;color:${PAL.cream};">${esc(o.subline)}</div>` : ''}
    ${o.price ? `<div style="margin:0 0 18px;"><span style="display:inline-block;border:1px solid ${PAL.gold};color:${PAL.gold};border-radius:999px;padding:8px 18px;font-weight:700;">${esc(o.price)}</span></div>` : ''}
    <a class="cta gold" href="${esc(ctaUrl)}">${esc(ctaText)}</a>
    ${heroImg}
  </section>
  ${video}
  ${problem}
  ${benefits ? `<section style="${sectionMax}padding:36px 22px 10px;">
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:stretch;">${benefits}</div>
  </section>` : ''}
  ${mechanism}
  ${steeping}
  ${certBar}
  ${proofBar}
  ${testimonial}
  ${comparison}
  ${objectionBlock}
  ${guarantee}
  ${faq}
  <section style="text-align:center;padding:40px 22px;background:${PAL.cream};">
    <a class="cta" href="${esc(ctaUrl)}">${esc(ctaText)}</a>
    ${o.collectionCta ? `<div style="margin-top:16px;"><a href="${esc(o.collectionCta.url)}" style="font-family:${BF};font-size:14px;font-weight:700;color:${PAL.green};text-decoration:underline;">Explore all ${esc(o.collectionCta.title)} &rarr;</a></div>` : ''}
  </section>
  <div class="stickycta"><a class="cta gold" href="${esc(ctaUrl)}" style="display:block;text-align:center;border-radius:0;padding:15px 20px;">${esc(ctaText)}${o.price ? ` · ${esc(o.price)}` : ''}</a></div>
  <footer style="background:${PAL.green};color:${PAL.cream};text-align:center;font-size:12px;line-height:1.8;padding:26px 20px;">${legalEntity(o.market)}<br>${esc(addr)}<br><span style="color:${PAL.gold};font-weight:700;">Privacy Policy &nbsp;·&nbsp; Terms of Service &nbsp;·&nbsp; Shipping &amp; Returns</span></footer>
</body></html>`;
}

module.exports = { renderLandingPage };
