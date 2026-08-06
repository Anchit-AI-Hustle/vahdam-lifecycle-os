'use strict';

/**
 * build-launch-mailers.js — two conversion mailers for the US store:
 *   1. Ashwagandha Coffee            -> mailers/launch/us-ashwagandha-coffee.html
 *   2. The 2026 Darjeeling/Assam
 *      second flush arrivals         -> mailers/launch/us-second-flush-2026.html
 *
 * EVERY fact here was read from the live US storefront on 2026-08-06 and is
 * recorded in FACTS below with the exact source. Nothing is carried over from
 * data/catalog/products_us.json, because that catalog was found to be wrong in
 * three separate ways:
 *   - price:  it lists Ashwagandha Coffee at 49.99 / 9.99; live is 44.99 / 99.99
 *   - handle: its second-flush handles 404 on the live store
 *   - vintage: it carries the 2025 flush; the live launches are the 2026 flush
 * A mailer built from it would have advertised a wrong price and linked to dead
 * product pages, so the live storefront is the only source used.
 *
 * Deliberately ABSENT, because nothing verifiable supports them:
 *   - any health or adaptogen benefit claim for ashwagandha (the live product
 *     description is empty, and a benefit claim on an ingestible is regulated)
 *   - tasting notes for the four pre-book teas (the live description for each is
 *     only the pre-booking notice; the 2025 catalog notes describe a DIFFERENT
 *     harvest, so reusing them would misdescribe the 2026 leaf)
 *   - any subscription discount (the selling plans expose a cadence, not a saving)
 *   - any discount code, and any second-flush collection URL (there is none:
 *     /collections/second-flush 404s, /collections/new-arrivals is real)
 */

const fs = require('fs');
const path = require('path');
const SM = require('../api/_shared/scenario-model.js');

const OUT = path.join(__dirname, '..', 'mailers', 'launch');
const STORE = 'https://www.vahdamteas.com';          // CLAUDE.md VERIFIED US store
const PAL = { green: '#004A2B', gold: '#AB8743', ink: '#171717', cream: '#FBF5EA' };
const HF = "'LAO MN',Georgia,'Times New Roman',serif";
const BF = "'Proxima Nova','Helvetica Neue',Arial,sans-serif";
const FONTS =
  '@font-face{font-family:"LAO MN";src:url("https://cdn.nector.io/nector-static/fonts/LaoMN-01.ttf") format("truetype");}' +
  '@font-face{font-family:"Proxima Nova";src:url("https://cdn-widgetsrepository.yotpo.com/brandkit/custom-fonts/nULz3c4cbjU7NEqLKreeoyIyIP4L5pnrZ53k1952/proximanova-regular/proximanova-regular.woff2") format("woff2");}';
const LOGO = 'https://www.vahdam.com/cdn/shop/files/logo-website_3.png?v=1754032931&width=310';

// ── VERIFIED FACTS (live US storefront, 2026-08-06) ────────────────────────
const FACTS = {
  source: 'https://www.vahdamteas.com (301 -> www.vahdam.com) products.json + PDP, read 2026-08-06',
  shipping: 'FREE US shipping over $59',
  // US brand-level proof. Storefront-wide, NOT per product, and US-only.
  proof: ['Rated 4.9/5', '250,000+ reviews', '6 million customers', 'Oprah’s Favorite Things'],
  certifications: ['Climate Neutral', 'Non-GMO Verified', 'Plastic Neutral'],
  address: '440 N Barranca Ave #2812, Covina, CA 91723, United States',
  entity: 'VAHDAM&reg; USA · Vahdam Teas Global, Inc.',
  coffee: {
    title: 'Ashwagandha Coffee',
    handle: 'ashwagandha-coffee',
    variants: [
      { title: '40 Servings', price: '44.99' },
      { title: '120 Servings', price: '99.99' },
    ],
    plans: ['Ships every 30 days', 'Ships every 90 days'],   // exact selling-plan names
    // PDP text confirms "instant coffee" and "arabica". "Medium roast" appears
    // only on the pack artwork, not in the PDP copy, so it is left out.
    format: 'Instant, 100% arabica',
    // ── IMAGE SELECTION IS A COMPLIANCE DECISION HERE ──────────────────────
    // This product is a dietary supplement, and most of its PDP artwork carries
    // structure/function claims with a dagger footnote: a Supplement Facts panel
    // with dosages plus an FDA-registered-facility line (2_cups.png), "Calm in
    // Every Cup / Clinically Studied Adaptogens" (5_), "KSM-66 ... Relieves
    // Stress" (6_), "Lion's Mane: Focus, Memory & Clarity" (7_), and
    // "Anti-Inflammatory Benefits / Boosts Immunity" (4_).
    // The live US PDP carries NO DSHEA disclaimer ("not been evaluated by the
    // FDA...") and no footnote text for those daggers, so there is nothing
    // sourced to reproduce alongside them, and inventing regulatory text is not
    // an option. Keeping the copy claim-free while embedding a claims graphic
    // would have smuggled the claims in through the artwork, so every
    // claim-carrying asset is excluded.
    // What is used: the kit photograph, and the taste + preparation card, which
    // says "Smooth. Rich. Caramel Taste." with the scoop/water/serve steps and
    // makes no health claim at all.
    images: [
      'https://cdn.shopify.com/s/files/1/2675/9476/files/0_e00c6aa6-5531-4940-a035-29cc5a0605cb.png?v=1785507583',
      'https://cdn.shopify.com/s/files/1/2675/9476/files/3_9858ccc3-9a9c-48f2-b146-27a40531c297.png?v=1785507583',
    ],
  },
  // published_at 2026-08-02 / 2026-08-04 -> these are the recent launches.
  // Two assets per tea: `image` is the leaf-and-liquor plate, used once as the
  // hero, and `pack` is the retail pouch, used in every card and thumbnail. The
  // first build used the plate everywhere, so the hero and the first card were
  // the same photograph, and at 88px a cropped plate is unreadable. The pouch
  // also shows the estate, grade and picking date, which is what a buyer of a
  // single-estate lot is actually looking for.
  shippingNow: [
    {
      title: '2026 Okayti Classic Darjeeling Second Flush Black Tea',
      short: 'Okayti Classic Darjeeling',
      handle: '2026-okayti-classic-darjeeling-second-flush-black-tea',
      price: '21.99',
      // Live product description, verbatim source for this line.
      note: 'Mellow and smooth summer flush with a pleasant astringency and sweetness, plus fruity and woody notes from an estate once favoured by royalty.',
      image: 'https://cdn.shopify.com/s/files/1/2675/9476/files/Okayti_Premium_Darjeeling_Second_Flush_Black_Tea_leaf-liquor_206b643f-a6ea-4d24-ba59-86d727bf84e3.jpg?v=1752748573',
      pack: 'https://cdn.shopify.com/s/files/1/2675/9476/files/1_4fe737a1-2ea0-46e8-be00-3dbe3cbcd786.jpg?v=1785642821',
    },
    {
      title: '2026 Jungpana Muscatel Darjeeling Second Flush Black Tea DJ 116',
      short: 'Jungpana Muscatel Darjeeling',
      handle: '2026-jungpana-muscatel-darjeeling-second-flush-black-tea-dj-116',
      price: '22.99',
      note: 'A rare muscatel with fruity notes, picked at the peak of summer from the vintage Jungpana estate in Darjeeling.',
      image: 'https://cdn.shopify.com/s/files/1/2675/9476/files/Jungpana_2nd_flush-1.jpg?v=1752048803',
      pack: 'https://cdn.shopify.com/s/files/1/2675/9476/files/1_d34da4f4-aa7f-46e4-b671-752cd6eae27e.jpg?v=1785642634',
    },
  ],
  // Live description for each of these is ONLY the pre-booking notice, so they
  // carry a ship date and no tasting copy.
  preBook: [
    { short: 'Castleton Classic Darjeeling', handle: '2026-castleton-classic-darjeeling-second-flush-black-tea', pack: 'https://cdn.shopify.com/s/files/1/2675/9476/files/1_1ebf0171-4519-4975-8fd9-bb3909f1c77e.jpg?v=1785643196', price: '24.99',
      image: 'https://cdn.shopify.com/s/files/1/2675/9476/files/Copy_of_castleton-half_11zon_d5872785-939e-486e-9018-feca5a2c94ca.jpg?v=1753778672' },
    { short: 'Margaret’s Hope Premium DJ 350', handle: '2026-margarets-hope-premium-darjeeling-second-flush-black-tea-dj-350', pack: 'https://cdn.shopify.com/s/files/1/2675/9476/files/1_9d628636-3527-49e2-a36f-2986918a6bf0.jpg?v=1785643748', price: '23.99',
      image: 'https://cdn.shopify.com/s/files/1/2675/9476/files/Margaret_s_Hope_Classic_half_11zon.jpg?v=1751615873' },
    { short: 'Halmari Clonal Assam', handle: '2026-halmari-clonal-assam-second-flush-black-tea', pack: 'https://cdn.shopify.com/s/files/1/2675/9476/files/1_c69837e5-329c-4d01-8c2e-587f97397b5a.jpg?v=1785640704', price: '29.99',
      image: 'https://cdn.shopify.com/s/files/1/2675/9476/files/halmari_half.jpg?v=1751885531' },
    { short: 'Giddapahar Classic DJ 67', handle: '2026-giddapahar-classic-darjeeling-second-flush-black-tea-dj-67', pack: 'https://cdn.shopify.com/s/files/1/2675/9476/files/1_3c1b7d51-6159-487e-ae2d-03f0958e1ec3.jpg?v=1785642332', price: '32.99',
      image: 'https://cdn.shopify.com/s/files/1/2675/9476/files/giddapahar-half_11zon_76e7ebb7-51cb-4e58-bd6b-521cefb6a198.jpg?v=1751616311' },
  ],
  preBookShipDate: 'August 30, 2026',   // live: "Orders are expected to ship from August 30, 2026."
  collection: { title: 'New Arrivals', url: STORE + '/collections/new-arrivals' },  // verified 200
};

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const pdp = (h) => STORE + '/products/' + h;

// Shopify's CDN resizes on the width param. The source assets are print-sized
// (the coffee hero is 994KB raw), which is far too heavy for an inbox, so every
// image is requested at roughly 2x its rendered width. Same host, same asset,
// no new source of truth.
function sized(url, w) { return url + (url.includes('?') ? '&' : '?') + 'width=' + w; }

// Brand gate. Copy goes through the repo's own scrubber so a banned phrase or an
// em dash cannot reach a shipped mailer.
function clean(s) {
  let out = String(s);
  if (typeof SM.sanitizeBrand === 'function') out = SM.sanitizeBrand(out);
  else if (typeof SM.scrubDashes === 'function') out = SM.scrubDashes(out);
  if (typeof SM.assertNoBanned === 'function') SM.assertNoBanned(out);
  return out;
}

// ── shared chrome ──────────────────────────────────────────────────────────
function head(subject, preheader) {
  return `<!DOCTYPE html><html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<title>${esc(subject)}</title>
<style>${FONTS}
:root{color-scheme:light;supported-color-schemes:light;}
body{margin:0;padding:0;background:${PAL.cream};-webkit-text-size-adjust:100%;}
img{-ms-interpolation-mode:bicubic;border:0;line-height:100%;display:block;}
a.cta{transition:transform .15s ease,box-shadow .18s ease;}
a.cta:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(0,74,43,.28);}
@media only screen and (max-width:620px){
  table[width="600"]{width:100%!important;}
  .col{display:block!important;width:100%!important;max-width:100%!important;}
  .p{padding-left:22px!important;padding-right:22px!important;}
  .h1{font-size:30px!important;line-height:1.12!important;}
  .gap{height:14px!important;}
}
</style></head><body style="margin:0;padding:0;background:${PAL.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAL.cream};"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${PAL.cream};">`;
}

function utility() {
  return `<tr><td style="background:${PAL.green};padding:12px 20px;text-align:center;font-family:${BF};font-size:12px;font-weight:700;letter-spacing:.08em;color:${PAL.cream};">From the hands that picked it to the cup you hold &nbsp;&middot;&nbsp; ${FACTS.shipping}</td></tr>
<tr><td style="padding:22px 20px 8px;text-align:center;"><a href="${STORE}" style="text-decoration:none;border:0;"><img src="${LOGO}" alt="VAHDAM" width="150" style="width:150px;height:auto;margin:0 auto;"></a></td></tr>`;
}

// MSO-safe solid button.
function button(label, href, bg, fg) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr><td align="center" bgcolor="${bg}" style="border-radius:8px;">
<a class="cta" href="${esc(href)}" style="display:inline-block;padding:16px 38px;font-family:${BF};font-size:15px;font-weight:700;letter-spacing:.04em;color:${fg};text-decoration:none;border-radius:8px;background:${bg};">${esc(label)}</a>
</td></tr></table>`;
}

function proofBars() {
  return `<tr><td style="padding:16px 22px 6px;text-align:center;font-family:${BF};font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${PAL.gold};">${FACTS.certifications.map(esc).join(' &nbsp;&middot;&nbsp; ')}</td></tr>
<tr><td style="padding:8px 22px 22px;text-align:center;font-family:${BF};font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:${PAL.ink};">${FACTS.proof.map(esc).join(' &nbsp;&middot;&nbsp; ')}</td></tr>`;
}

function footer() {
  return `<tr><td style="background:${PAL.green};padding:28px 30px;text-align:center;font-family:${BF};font-size:12px;line-height:1.8;color:${PAL.cream};">
${FACTS.entity}<br>${esc(FACTS.address)}<br><br>
You are receiving this because you shopped with VAHDAM&reg;.<br>
<span style="color:${PAL.gold};font-weight:700;">Unsubscribe &nbsp;&middot;&nbsp; Email preferences &nbsp;&middot;&nbsp; Privacy Policy &nbsp;&middot;&nbsp; Terms of Service</span>
</td></tr>`;
}

const tail = `</table></td></tr></table></body></html>`;

// ── MAILER 1: Ashwagandha Coffee ───────────────────────────────────────────
function ashwagandhaCoffee() {
  const c = FACTS.coffee;
  const v40 = c.variants[0], v120 = c.variants[1];
  const url = pdp(c.handle);
  const subject = clean('Ashwagandha Coffee, back on your counter');
  const preheader = clean('40 servings a pack. Order once, or set it to arrive on repeat.');

  // NOTE: no benefit claim anywhere below. The live product description is empty,
  // so the copy sells the ritual and the format, which are verifiable.
  const headline = clean('Coffee first. Ashwagandha already in it.');
  const subline = clean(c.format + ', ' + v40.title.toLowerCase() + ' to a pack. Make it the cup you reach for, then let it arrive without you thinking about it.');

  const plans = c.plans.map((p) => `<tr><td style="padding:3px 0;font-family:${BF};font-size:14px;color:${PAL.ink};"><span style="color:${PAL.gold};font-weight:700;">&#8226;</span> &nbsp;${esc(p)}</td></tr>`).join('');

  return head(subject, preheader) + utility() + `
<tr><td style="background:${PAL.green};padding:38px 30px 30px;text-align:center;">
  <div style="font-family:${BF};font-size:11px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:${PAL.gold};">Coffee, with ashwagandha</div>
  <h1 class="h1" style="font-family:${HF};font-size:38px;line-height:1.1;margin:14px 0 12px;color:${PAL.cream};font-weight:normal;">${esc(headline)}</h1>
  <div style="font-family:${BF};font-size:15.5px;line-height:1.65;color:${PAL.cream};max-width:430px;margin:0 auto 20px;">${esc(subline)}</div>
  <div style="margin:0 0 20px;"><span style="display:inline-block;border:1px solid ${PAL.gold};color:${PAL.gold};border-radius:999px;padding:9px 20px;font-family:${BF};font-weight:700;font-size:14px;">$${esc(v40.price)} &nbsp;&middot;&nbsp; ${esc(v40.title)}</span></div>
  ${button('Order now', url, PAL.gold, PAL.ink)}
</td></tr>
<tr><td style="padding:0;"><img src="${esc(sized(c.images[0], 600))}" alt="${esc(c.title)} pack" width="600" style="width:100%;max-width:600px;height:auto;"></td></tr>

<tr><td class="p" style="padding:34px 36px 10px;text-align:center;">
  <h2 style="font-family:${HF};font-size:25px;line-height:1.2;color:${PAL.green};margin:0 0 10px;font-weight:normal;">Two ways to keep it going</h2>
</td></tr>
<tr><td class="p" style="padding:0 30px 8px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td class="col" width="50%" valign="top" style="padding:0 8px 14px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid ${PAL.gold};border-radius:12px;"><tr><td style="padding:20px 18px;">
        <div style="font-family:${BF};font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${PAL.gold};">One time</div>
        <div style="font-family:${HF};font-size:22px;color:${PAL.green};margin:7px 0 4px;">$${esc(v40.price)}</div>
        <div style="font-family:${BF};font-size:13.5px;line-height:1.6;color:${PAL.ink};">${esc(v40.title)} in a pack. Try it, no commitment.</div>
      </td></tr></table>
    </td>
    <td class="col" width="50%" valign="top" style="padding:0 0 14px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAL.cream};border:2px solid ${PAL.green};border-radius:12px;"><tr><td style="padding:20px 18px;">
        <div style="font-family:${BF};font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${PAL.green};">On repeat</div>
        <div style="font-family:${HF};font-size:22px;color:${PAL.green};margin:7px 0 6px;">Subscribe</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">${plans}</table>
        <div style="font-family:${BF};font-size:12.5px;line-height:1.55;color:${PAL.ink};padding-top:7px;">Change the date or cancel whenever you like.</div>
      </td></tr></table>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:6px 30px 4px;text-align:center;font-family:${BF};font-size:13px;color:${PAL.ink};">Drinking it daily? The ${esc(v120.title.toLowerCase())} pack is $${esc(v120.price)}.</td></tr>
<tr><td style="padding:18px 30px 6px;">${button('Choose your plan', url, PAL.green, PAL.cream)}</td></tr>
<tr><td class="gap" style="height:22px;">&nbsp;</td></tr>
<tr><td style="padding:0;"><img src="${esc(sized(c.images[1], 600))}" alt="${esc(c.title)}: smooth, rich, caramel taste, and how to prepare it" width="600" style="width:100%;max-width:600px;height:auto;"></td></tr>
` + proofBars() + footer() + tail;
}

// ── MAILER 2: the 2026 second flush ────────────────────────────────────────
function secondFlush() {
  const subject = clean('The 2026 second flush has landed');
  const preheader = clean('Okayti and Jungpana are shipping now. Four more estates open to pre-book.');
  const hero = FACTS.shippingNow[0];

  const nowCards = FACTS.shippingNow.map((p) => `
    <td class="col" width="50%" valign="top" style="padding:0 8px 16px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid ${PAL.gold};border-radius:12px;overflow:hidden;">
        <tr><td style="padding:0;"><a href="${esc(pdp(p.handle))}" style="text-decoration:none;"><img src="${esc(sized(p.pack, 560))}" alt="${esc(p.short)} loose leaf pouch" width="276" style="width:100%;height:auto;"></a></td></tr>
        <tr><td style="padding:16px 16px 18px;">
          <div style="font-family:${BF};font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${PAL.green};">Shipping now</div>
          <div style="font-family:${HF};font-size:19px;line-height:1.25;color:${PAL.green};margin:7px 0 6px;">${esc(p.short)}</div>
          <div style="font-family:${BF};font-size:13px;line-height:1.6;color:${PAL.ink};">${esc(clean(p.note))}</div>
          <div style="padding:12px 0 12px;"><span style="display:inline-block;background:${PAL.gold};color:${PAL.ink};font-family:${BF};font-weight:700;font-size:13px;padding:6px 14px;border-radius:999px;">$${esc(p.price)}</span></div>
          ${button('Shop this estate', pdp(p.handle), PAL.green, PAL.cream)}
        </td></tr>
      </table>
    </td>`).join('');

  const preCards = FACTS.preBook.map((p, i) => `
    <td class="col" width="50%" valign="top" style="padding:0 ${i % 2 === 0 ? '8px' : '0'} 14px ${i % 2 === 0 ? '0' : '8px'};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAL.cream};border:1px solid ${PAL.gold};border-radius:12px;overflow:hidden;">
        <tr>
          <td width="88" valign="top" style="padding:0;"><a href="${esc(pdp(p.handle))}" style="text-decoration:none;"><img src="${esc(sized(p.pack, 200))}" alt="${esc(p.short)} pouch" width="88" style="width:88px;height:auto;"></a></td>
          <td valign="top" style="padding:12px 14px;">
            <div style="font-family:${HF};font-size:15.5px;line-height:1.3;color:${PAL.green};">${esc(p.short)}</div>
            <div style="font-family:${BF};font-size:12.5px;font-weight:700;color:${PAL.ink};padding:5px 0 3px;">$${esc(p.price)}</div>
            <a href="${esc(pdp(p.handle))}" style="font-family:${BF};font-size:12px;font-weight:700;color:${PAL.green};text-decoration:underline;">Pre-book</a>
          </td>
        </tr>
      </table>
    </td>${i % 2 === 1 ? '</tr><tr>' : ''}`).join('');

  return head(subject, preheader) + utility() + `
<tr><td style="background:${PAL.green};padding:36px 30px 28px;text-align:center;">
  <div style="font-family:${BF};font-size:11px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:${PAL.gold};">Just landed &nbsp;&middot;&nbsp; 2026 second flush</div>
  <h1 class="h1" style="font-family:${HF};font-size:38px;line-height:1.1;margin:14px 0 12px;color:${PAL.cream};font-weight:normal;">${esc(clean('Summer harvest, straight from the estate'))}</h1>
  <div style="font-family:${BF};font-size:15.5px;line-height:1.65;color:${PAL.cream};max-width:460px;margin:0 auto 20px;">${esc(clean('Six single-estate lots from this summer’s picking. Two are steeping in warehouses now, four are open to pre-book.'))}</div>
  ${button('Shop what ships today', pdp(hero.handle), PAL.gold, PAL.ink)}
</td></tr>
<tr><td style="padding:0;"><img src="${esc(sized(hero.image, 1000))}" alt="${esc(hero.short)} leaf and liquor" width="600" style="width:100%;max-width:600px;height:auto;"></td></tr>

<tr><td class="p" style="padding:32px 36px 6px;text-align:center;">
  <h2 style="font-family:${HF};font-size:25px;line-height:1.2;color:${PAL.green};margin:0 0 6px;font-weight:normal;">Steep it this week</h2>
  <div style="font-family:${BF};font-size:14px;line-height:1.6;color:${PAL.ink};">In stock and ready to ship.</div>
</td></tr>
<tr><td class="p" style="padding:18px 30px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${nowCards}</tr></table>
</td></tr>

<tr><td class="p" style="padding:20px 36px 6px;text-align:center;">
  <h2 style="font-family:${HF};font-size:25px;line-height:1.2;color:${PAL.green};margin:0 0 6px;font-weight:normal;">Reserve the rest of the flush</h2>
  <div style="font-family:${BF};font-size:14px;line-height:1.6;color:${PAL.ink};">Pre-book now. These ship from <span style="font-weight:700;">${esc(FACTS.preBookShipDate)}</span>.</div>
</td></tr>
<tr><td class="p" style="padding:16px 30px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${preCards}</tr></table>
</td></tr>

<tr><td class="p" style="padding:14px 30px 20px;">${button('See every new arrival', FACTS.collection.url, PAL.green, PAL.cream)}</td></tr>
` + proofBars() + footer() + tail;
}

// ── build + gate ───────────────────────────────────────────────────────────
const BANNED = ['wellness journey', 'transform', 'liquid gold', 'game-changer', 'LIMITED TIME', 'hurry', "don't miss out", 'last chance', 'while supplies last'];
const ALLOWED_HEX = new Set([PAL.green, PAL.gold, PAL.ink, PAL.cream, '#FFFFFF', '#fff', '#FFF'].map((s) => s.toLowerCase()));

// The visible copy only: no <style> block, no tag attributes, entities resolved.
// Auditing raw HTML instead produces false positives that would push you to
// loosen the gate - the CSS hover rule contains "transform", the bullet entity
// &#8226; and the street number #2812 both look like colors.
function visibleText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '.').replace(/&#8226;/g, '.')
    .replace(/&amp;/g, '&').replace(/&reg;/g, '(R)').replace(/&[a-z]+;|&#\d+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function audit(name, html) {
  const errs = [];
  const copy = visibleText(html);
  // Palette: exactly 3 or 6 hex digits, so a 4-digit street number or entity
  // code cannot be mistaken for a color.
  const hexes = [...new Set((html.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g) || []).map((h) => h.toLowerCase()))];
  hexes.filter((h) => !ALLOWED_HEX.has(h)).forEach((h) => errs.push('off-palette color ' + h));
  // Banned phrases and dashes are copy rules, so they run on the copy.
  BANNED.forEach((b) => { if (new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(copy)) errs.push('banned phrase in copy: ' + b); });
  if (/[–—]/.test(copy)) errs.push('en/em dash in copy');
  // Every image needs alt text and must be a hosted URL (never base64).
  const imgs = html.match(/<img [^>]*>/g) || [];
  imgs.forEach((t) => {
    if (!/alt="/.test(t)) errs.push('img with no alt: ' + t.slice(0, 60));
    if (/src="data:/.test(t)) errs.push('base64 image (must be hosted)');
    if (!/src="https:\/\//.test(t)) errs.push('non-https image');
  });
  if (!/supported-color-schemes/.test(html)) errs.push('no dark-mode declaration');
  if (!/Unsubscribe/.test(html)) errs.push('no unsubscribe');
  if (!new RegExp(FACTS.address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(html)) errs.push('no registered address');
  if (/DATA REQUIRED/.test(html)) errs.push('unresolved DATA REQUIRED marker');
  // Prices present must be ones we verified live.
  const verified = new Set(['44.99', '99.99', '21.99', '22.99', '24.99', '23.99', '29.99', '32.99', '59']);
  (html.match(/\$(\d+\.\d{2})/g) || []).map((s) => s.slice(1)).forEach((p) => {
    if (!verified.has(p)) errs.push('unverified price $' + p);
  });
  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  if (Buffer.byteLength(html) > 102400) errs.push('over Gmail 102KB clip threshold (' + kb + 'KB)');
  console.log((errs.length ? '  ✗ ' : '  ✓ ') + name + '  ' + kb + 'KB  imgs=' + imgs.length);
  errs.forEach((e) => console.log('      ' + e));
  return errs.length === 0;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = [
    ['us-ashwagandha-coffee.html', ashwagandhaCoffee()],
    ['us-second-flush-2026.html', secondFlush()],
  ];
  let ok = true;
  files.forEach(([f, html]) => {
    fs.writeFileSync(path.join(OUT, f), html);
    if (!audit(f, html)) ok = false;
  });
  console.log(ok ? '\n✓ both mailers pass the brand + factual audit' : '\n✗ audit failed');
  if (!ok) process.exit(1);
}
main();
