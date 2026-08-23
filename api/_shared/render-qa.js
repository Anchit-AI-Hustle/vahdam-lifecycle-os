'use strict';
/**
 * render-qa.js — measures a GENERATED asset, per campaign.
 *
 * Three launch-gate dimensions worth 17 of the 99 weight were unmeasurable
 * because every design check in this repo is build-time: the contrast suite,
 * the black-background guard and the table-readability specs all inspect
 * SOURCE in CI. None of them ever looks at the HTML a campaign actually
 * produced, so a generated mailer could carry a contrast failure or a black
 * band and the launch gate had nothing to read.
 *
 * This is deterministic static analysis of the emitted HTML - no browser, so
 * it can run inside a serverless invocation. It measures what is decidable
 * from the markup and stays silent about what is not, rather than guessing.
 */

const BRAND = { green: '#004A2B', gold: '#AB8743', ink: '#171717', cream: '#FBF5EA' };
const DARK_BG = /#(171717|000000|000|0a0a0a|111111|111|121212|1a1a1a|222222|222)\b/i;

function lum(hex) {
  const h = String(hex).replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Pull inline `style="..."` blocks with their colour + background + size. */
function styledNodes(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<([a-z][a-z0-9]*)\b[^>]*style="([^"]*)"[^>]*>/gi)) {
    const style = m[2];
    const grab = (prop) => {
      const r = new RegExp(prop + '\\s*:\\s*([^;]+)', 'i').exec(style);
      return r ? r[1].trim() : null;
    };
    const hex = (v) => { const r = v && /#[0-9a-f]{3,6}/i.exec(v); return r ? r[0] : null; };
    const px = (v) => { const r = v && /([\d.]+)px/.exec(v); return r ? parseFloat(r[1]) : null; };
    out.push({
      tag: m[1].toLowerCase(),
      color: hex(grab('color')),
      background: hex(grab('background(?:-color)?')),
      fontSize: px(grab('font-size')),
      bold: /font-weight\s*:\s*(bold|[6-9]00)/i.test(style),
      at: m.index,
      raw: m[0].slice(0, 120),
    });
  }
  return out;
}

/**
 * @returns {{contrast:{failures,pairs,black_background}, mobile:{ok,issues}, ui:{ok,issues}}}
 */
function inspect(html) {
  const nodes = styledNodes(html);
  const src = String(html || '');

  // ── Contrast: resolve each text node against its nearest declared bg ─────
  const pairs = [];
  let bg = '#ffffff';
  for (const n of nodes) {
    if (n.background) bg = n.background;
    if (!n.color) continue;
    const r = ratio(n.color, n.background || bg);
    if (r == null) continue;
    // WCAG: 3.0 for large text (>=24px, or >=18.66px bold), else 4.5.
    const large = (n.fontSize && n.fontSize >= 24) || (n.bold && n.fontSize && n.fontSize >= 18.66);
    const need = large ? 3 : 4.5;
    pairs.push({ fg: n.color, bg: n.background || bg, ratio: r, need, size: n.fontSize, ok: r >= need, snippet: n.raw });
  }
  const failures = pairs.filter((p) => !p.ok);

  // ── The HARD rule, measured on the OUTPUT rather than on the source ──────
  const blackBg = nodes.filter((n) => n.background && DARK_BG.test(n.background));

  // ── Mobile: an email that cannot reflow is broken on most opens ──────────
  const mobileIssues = [];
  const widths = [...src.matchAll(/width\s*[:=]\s*"?(\d{3,4})(px)?/gi)].map((m) => parseInt(m[1], 10));
  const tooWide = widths.filter((w) => w > 640);
  if (tooWide.length) mobileIssues.push(`${tooWide.length} element(s) wider than 640px (widest ${Math.max(...tooWide)}px)`);
  if (/<table/i.test(src) && !/max-width\s*:\s*\d+px/i.test(src)) mobileIssues.push('no max-width on the outer table, so it cannot shrink');
  if (!/@media[^{]*max-width/i.test(src) && /<table/i.test(src)) mobileIssues.push('no mobile media query');

  // ── UI/UX sanity: the failure modes the spec names as blocking ──────────
  const uiIssues = [];
  const placeholders = src.match(/PASTE_[A-Z_]+|TODO|LOREM IPSUM|\{\{[^}]+\}\}/gi) || [];
  if (placeholders.length) uiIssues.push(`${placeholders.length} unfilled placeholder(s): ${[...new Set(placeholders)].slice(0, 3).join(', ')}`);
  const emptyHref = (src.match(/href\s*=\s*"(#|)"/gi) || []).length;
  if (emptyHref) uiIssues.push(`${emptyHref} link(s) with no destination`);
  if (/text-overflow\s*:\s*ellipsis/i.test(src)) uiIssues.push('text-overflow:ellipsis can truncate copy');
  const imgs = [...src.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((t) => !/\balt\s*=\s*"[^"]+"/i.test(t));
  if (noAlt.length) uiIssues.push(`${noAlt.length} image(s) with no alt text`);

  return {
    contrast: {
      pairs: pairs.length,
      failures: failures.length,
      worst: failures.length ? failures.sort((a, b) => a.ratio - b.ratio)[0] : null,
      black_background: blackBg.length > 0,
      black_examples: blackBg.slice(0, 3).map((n) => n.raw),
      detail: failures.slice(0, 5),
    },
    mobile: { ok: mobileIssues.length === 0, issues: mobileIssues },
    ui: { ok: uiIssues.length === 0, issues: uiIssues },
  };
}

/** Roll every asset in a campaign into the shape launch-gate consumes. */
function inspectCampaign(c = {}) {
  const htmls = [];
  const a = c.assets || {};
  if (a.email && a.email.html) htmls.push(a.email.html);
  for (const lp of a.landing_pages || []) if (lp && lp.html) htmls.push(lp.html);
  for (const ad of a.ads || []) if (ad && ad.html) htmls.push(ad.html);
  if (!htmls.length) return null;                       // nothing to measure: stay silent
  const each = htmls.map(inspect);
  return {
    assets_measured: htmls.length,
    failures: each.reduce((n, r) => n + r.contrast.failures, 0),
    black_background: each.some((r) => r.contrast.black_background),
    mobile_issues: each.flatMap((r) => r.mobile.issues),
    ui_issues: each.flatMap((r) => r.ui.issues),
    detail: each,
  };
}

module.exports = { inspect, inspectCampaign, ratio, lum, BRAND };
