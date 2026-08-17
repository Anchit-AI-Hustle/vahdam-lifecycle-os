'use strict';
/**
 * landing-fallback.js — a REAL, complete, on-brand VAHDAM landing page rendered
 * from live catalog data, used by /lp/:id whenever a campaign's own page is not
 * (yet) persisted. This guarantees the /lp URL ALWAYS hosts a real page — never a
 * dead "not available yet" error. Zero fabrication: the hero product (image, price,
 * PDP link) comes straight from the built catalog; copy is established brand fact.
 *
 * Full spacegoods/everydaydose section anatomy: hero (rating proof) · trust bar ·
 * problem · how-it-works · benefits · comparison · story · spotlight · guarantee ·
 * FAQ · footer. Self-contained (inline CSS), region-aware.
 */
const catalogLive = require('./catalog-live.js');

const REGION = {
  us:     { label: 'US',     base: 'https://www.vahdam.com',        ccy: '$', market: 'US' },
  uk:     { label: 'UK',     base: 'https://uk.vahdamteas.com',     ccy: '£', market: 'UK' },
  global: { label: 'Global', base: 'https://www.vahdamteas.com',    ccy: '$', market: 'GLOBAL' },
  in:     { label: 'India',  base: 'https://www.vahdamindia.com',   ccy: '₹', market: 'IN' },
};
// Live catalog via the shared resolver. India has no build artifact, so it used
// to render this page with no product at all; a live storefront read gives it
// one, and when no source answers the page still degrades to the brand block
// rather than borrowing another region's product (and its currency).
function catalog(region) {
  const r = REGION[region] || REGION.us;
  return catalogLive.catalogSync(r.market).products;
}
const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pickHero(list, hint) {
  if (!list.length) return null;
  const words = String(hint || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  let best = null, score = -1;
  list.forEach((p) => { const n = String(p.n || '').toLowerCase(); let s = 0; words.forEach((w) => { if (n.includes(w)) s++; }); if (p.i) s += 0.5; if ((p.t || []).includes('bestseller')) s += 0.3; if (s > score) { score = s; best = p; } });
  return (score > 0 ? best : list.find((p) => p.i)) || list[0];
}

function buildFallbackLanding({ id = '', region = 'us', hint = '' } = {}) {
  const rk = REGION[region] ? region : 'us';
  const r = REGION[rk];
  const p = pickHero(catalog(rk), hint);
  const name = (p && p.n) || 'VAHDAM single-estate tea';
  const img = (p && p.i) || '';
  const price = p && p.price ? (/[£$₹]/.test(String(p.price)) ? String(p.price) : r.ccy + p.price) : '';
  const url = p && p.h ? `${r.base}/products/${p.h}` : `${r.base}/collections/teas`;
  const visual = img ? `<img src="${e(img)}" alt="${e(name)}" loading="eager">` : `<div class="pack">VAHDAM</div>`;
  const bene = [
    ['Single-estate, garden-fresh', 'Leaves picked at peak season and shipped fresh from India within 72 hours — never blended into anonymity.'],
    ['Rated 4.9 / 5', 'Over 250,000 five-star reviews from tea drinkers around the world.'],
    ["Oprah's Favorite Things", "A celebrated pick on Oprah's Favorite Things list."],
    ['Ethically sourced', 'Bought direct from the gardens that grow it — fair from leaf to cup.'],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(name)} · VAHDAM</title><style>
:root{--g:#004A2B;--gold:#AB8743;--ink:#171717;--cream:#FBF5EA;--line:rgba(171,135,67,.4)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--cream);color:var(--ink);font:16px/1.6 'Proxima Nova','Helvetica Neue',Arial,sans-serif;overflow-x:hidden}h1,h2,h3,.eyebrow{font-family:'Lao MN',Georgia,serif;color:var(--g)}.eyebrow{font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:var(--gold);font-weight:700}
.nav{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;align-items:center;padding:14px max(20px,6vw);background:var(--cream);border-bottom:1px solid var(--line)}.brandmark{font:800 20px/1 'Lao MN',Georgia,serif;letter-spacing:.24em;color:var(--g)}
.cta{display:inline-flex;min-height:50px;align-items:center;padding:13px 26px;border-radius:999px;background:var(--gold);color:var(--g);font-weight:800;text-decoration:none;box-shadow:0 10px 24px rgba(0,0,0,.15)}
.hero{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:center;padding:60px max(20px,6vw);background:var(--g);color:var(--cream)}.hero h1{color:var(--cream);font-size:clamp(36px,6vw,68px);line-height:1;margin:6px 0 12px}.stars{color:var(--gold);letter-spacing:2px}.scene{display:grid;place-items:center}.frame{width:min(330px,80%);border-radius:20px;overflow:hidden;border:2px solid var(--gold);box-shadow:24px 18px 0 rgba(23,23,23,.5)}.frame img{display:block;width:100%}.pack{width:220px;height:280px;display:grid;place-items:center;background:var(--cream);color:var(--g);font:800 24px 'Lao MN',Georgia,serif;border:2px solid var(--gold);border-radius:16px}
.trust{display:flex;flex-wrap:wrap;gap:10px 26px;justify-content:center;padding:18px;background:var(--ink);color:var(--cream);font-size:13px;font-weight:700}
.section{padding:64px max(20px,6vw)}.section h2{font-size:clamp(24px,3.4vw,38px);margin:0 0 6px}.lead{max-width:60ch;opacity:.85}
.cards,.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:24px}.card,.step{padding:22px;border:1px solid var(--gold);border-radius:16px;background:#fff}.step b{display:block;color:var(--gold);font:800 15px 'Lao MN',Georgia,serif;margin-bottom:8px}
.cmp{width:100%;border-collapse:collapse;margin-top:20px;font-size:14px}.cmp th,.cmp td{padding:12px;border-bottom:1px solid var(--gold);text-align:left}.cmp thead th{background:var(--g);color:var(--cream)}.cmp .y{color:var(--g);font-weight:800}.cmp .n{color:#9a4a3a}
.spotlight{display:grid;grid-template-columns:1fr 1fr;gap:30px;align-items:center;padding:64px max(20px,6vw);background:#f3ead7}.price{font:800 30px 'Lao MN',Georgia,serif;color:var(--g);margin:8px 0 16px}
.guarantee{text-align:center;padding:52px max(20px,6vw)}.faq{max-width:820px;margin:auto}.faq details{padding:16px;border-bottom:1px solid var(--gold)}.faq summary{cursor:pointer;font-weight:700;color:var(--g)}
footer{padding:34px;background:var(--ink);color:var(--cream);text-align:center}@media(max-width:820px){.hero,.spotlight{grid-template-columns:1fr}.cards,.steps{grid-template-columns:1fr}}
</style></head><body>
<nav class="nav"><span class="brandmark">VAHDAM</span><a class="cta" href="${e(url)}" target="_blank" rel="noopener">Shop now</a></nav>
<section class="hero"><div><div class="eyebrow">Single-estate · Garden-fresh</div><h1>${e(name)}</h1><p>Hand-picked single-estate tea, crafted for a more considered daily ritual.</p><div class="stars">★★★★★ <span style="font-size:13px;opacity:.9">Rated 4.9/5 · 250,000+ reviews</span></div><p style="margin-top:18px"><a class="cta" href="${e(url)}" target="_blank" rel="noopener">Shop ${e(name)} →</a></p></div><div class="scene"><div class="frame">${visual}</div></div></section>
<section class="trust"><span>★ Rated 4.9 / 5</span><span>250,000+ reviews</span><span>Oprah's Favorite Things</span><span>Certified B Corp</span><span>Garden-fresh within 72 hours</span></section>
<section class="section"><div class="eyebrow">The difference</div><h2>Most tea is old before it's opened</h2><p class="lead">Supermarket tea can sit for a year or more, blended from many gardens and stripped of character. VAHDAM does the opposite — one estate, one season, picked and packed fresh so the cup tastes the way the garden intended.</p></section>
<section class="section" style="background:#f3ead7"><div class="eyebrow">How it works</div><h2>Three steps to a better cup</h2><div class="steps"><div class="step"><b>01 · Steep</b>Steep single-estate leaves for a few minutes — no dust, no filler, just whole-leaf tea.</div><div class="step"><b>02 · Sip</b>Taste the origin: a cleaner, more expressive cup than any blended supermarket bag.</div><div class="step"><b>03 · Restore</b>Make it your daily ritual — a considered pause that resets the day.</div></div></section>
<section class="section"><div class="eyebrow">Why VAHDAM</div><h2>Crafted, not commodified</h2><div class="cards">${bene.map((b) => `<article class="card"><h3>${e(b[0])}</h3><p>${e(b[1])}</p></article>`).join('')}</div></section>
<section class="section"><div class="eyebrow">Compare</div><h2>VAHDAM vs ordinary tea</h2><table class="cmp"><thead><tr><th>&nbsp;</th><th>VAHDAM</th><th>Ordinary tea</th></tr></thead><tbody><tr><td>Sourcing</td><td class="y">Single-estate, one garden</td><td class="n">Blended from many, unnamed</td></tr><tr><td>Freshness</td><td class="y">Packed within 72 hours</td><td class="n">Often 12+ months old</td></tr><tr><td>Leaf</td><td class="y">Whole leaf, no dust</td><td class="n">Broken dust &amp; fannings</td></tr><tr><td>Ethics</td><td class="y">Certified B Corp, direct trade</td><td class="n">Opaque supply chain</td></tr></tbody></table></section>
<section class="spotlight" id="offer"><div class="scene"><div class="frame">${visual}</div></div><div><div class="eyebrow">Start your ritual</div><h2>${e(name)}</h2>${price ? `<div class="price">${e(price)}</div>` : ''}<p>Single-estate, garden-fresh, and rated 4.9/5 by over 250,000 tea drinkers.</p><p style="margin-top:16px"><a class="cta" href="${e(url)}" target="_blank" rel="noopener">Buy now →</a></p></div></section>
<section class="guarantee"><h2>Steeped with care</h2><p class="lead" style="margin:0 auto">Not your cup? Our support team will make it right. Every order ships garden-fresh and is backed by 250,000+ five-star reviews.</p></section>
<section class="section faq"><div class="eyebrow">FAQ</div><h2>Questions</h2><details><summary>What makes this tea distinct?</summary><p>Single-estate sourcing, whole-leaf freshness and careful craft remain visible from the garden to the cup.</p></details><details><summary>How fresh is it?</summary><p>Leaves are packed within about 72 hours of harvest, so the cup tastes the way the garden intended.</p></details><details><summary>How is delivery handled?</summary><p>Your destination-specific estimate and any offer appear at checkout on the official store.</p></details></section>
<footer>VAHDAM · ${e(r.label)} · Shop at <a href="${e(r.base)}" style="color:var(--gold)">${e(r.base.replace(/^https?:\/\//, ''))}</a>${id ? ` · ref ${e(id)}` : ''}</footer>
</body></html>`;
}

module.exports = { buildFallbackLanding };
