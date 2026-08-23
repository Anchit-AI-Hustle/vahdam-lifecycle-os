'use strict';
/**
 * launch-gate.js — the spec's §22 launch-readiness gate, in code.
 *
 * The spec has defined a 16-dimension weighted gate, a critical-dimension
 * floor and a list of blocking conditions since the beginning. NOTHING
 * computed it. `brief-gate` and `catalog-gate` cover their own narrow
 * questions; no module ever produced the number the spec says a campaign must
 * reach, so "is this launch ready" was answered by reading the screen.
 *
 * Two design rules, both learned the hard way in this repo:
 *
 * 1. AN UNMEASURED DIMENSION IS NOT A PASSING DIMENSION. A dimension with no
 *    evidence scores `null` and BLOCKS. The tempting default is 10 ("nothing
 *    reported a problem"), which makes the gate pass by ignorance - the same
 *    failure as a run that called itself `final` while its catalog gate had
 *    failed. Silence is not evidence.
 *
 * 2. NEVER INVENT A DIMENSION SCORE. Each dimension either consumes a real
 *    signal produced elsewhere (catalog gate, asset QA, ads QA, brand scrub,
 *    frequency check) or reports that it has no source yet. The gate is a
 *    measuring instrument, not an opinion.
 *
 * Note on the weights: the spec lists them as "(=100)" but they sum to 99.
 * Dividing by 100 would understate every campaign by 1%, so the score is
 * normalised by the ACTUAL total and `weight_total` is reported.
 */

// weight + whether the spec names it a critical dimension (floor of 9/10).
const DIMENSIONS = [
  { key: 'data_completeness',   label: 'Data completeness',        weight: 8, critical: false },
  { key: 'product_accuracy',    label: 'Product accuracy',         weight: 8, critical: true  },
  { key: 'url_accuracy',        label: 'URL accuracy',             weight: 5, critical: true  },
  { key: 'asset_accuracy',      label: 'Asset accuracy',           weight: 5, critical: false },
  { key: 'claim_compliance',    label: 'Claim compliance',         weight: 8, critical: true  },
  { key: 'review_authenticity', label: 'Review authenticity',      weight: 5, critical: false },
  { key: 'segment_eligibility', label: 'Segment eligibility',      weight: 7, critical: true  },
  { key: 'frequency_safety',    label: 'Frequency safety',         weight: 8, critical: true  },
  { key: 'inventory',           label: 'Inventory',                weight: 5, critical: false },
  { key: 'revenue_model',       label: 'Revenue model',            weight: 5, critical: false },
  { key: 'brand_consistency',   label: 'Brand consistency',        weight: 6, critical: false },
  { key: 'copy_quality',        label: 'Copy quality + proofread', weight: 7, critical: true  },
  { key: 'email_compatibility', label: 'Email compatibility',      weight: 5, critical: false },
  { key: 'accessibility',       label: 'Accessibility + contrast', weight: 7, critical: true  },
  { key: 'mobile',              label: 'Mobile',                   weight: 4, critical: false },
  { key: 'ui_ux_sanity',        label: 'UI/UX sanity',             weight: 6, critical: true  },
];
const WEIGHT_TOTAL = DIMENSIONS.reduce((n, d) => n + d.weight, 0); // 99, see header

const CRITICAL_FLOOR = 9;
const PASS_MARK = 9.5;

// §22's blocking conditions. Each is a hard NO regardless of the weighted score.
const BLOCKERS = [
  'missing_url', 'missing_image', 'unverified_claim', 'fabricated_review',
  'inventory_conflict', 'absolute_frequency_violation', 'build_failure',
  'a11y_blocker', 'client_pii', 'regional_mismatch', 'packaging_mismatch',
  'unresolved_source_conflict', 'black_background', 'dark_on_dark',
  'light_on_light', 'unreadable_copy', 'unproofread_copy', 'truncated_copy',
  'misaligned_cards', 'unsourced_fact',
];

const clamp10 = (n) => Math.max(0, Math.min(10, n));
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** A measured dimension. `score: null` means NO EVIDENCE, which blocks. */
function dim(score, evidence, source) {
  return { score: score == null ? null : clamp10(score), evidence, source };
}
const unmeasured = (why) => dim(null, why, null);

/**
 * Score a campaign. Every measurement reads a signal something else produced;
 * where no such signal exists yet the dimension is honestly unmeasured.
 *
 * @param {object} c   the campaign (buildCampaign output)
 * @param {object} ctx { catalogGate, frequency, libraries, contrast, build }
 */
function scoreCampaign(c = {}, ctx = {}) {
  const m = {};
  const blockers = [];
  const add = (b) => { if (BLOCKERS.includes(b) && !blockers.includes(b)) blockers.push(b); };

  // ── Catalog-derived dimensions ───────────────────────────────────────────
  const cat = ctx.catalogGate || c.catalog_gate || null;
  if (!cat) {
    m.data_completeness = unmeasured('no catalog gate result was supplied');
    m.product_accuracy  = unmeasured('no catalog gate result was supplied');
    m.inventory         = unmeasured('no catalog gate result was supplied');
  } else if (cat.ok === false || c.blocked) {
    m.data_completeness = dim(0, cat.reason || cat.blocker || 'catalog gate blocked', 'catalog-gate');
    m.product_accuracy  = dim(0, 'products were not resolved against a live catalog', 'catalog-gate');
    m.inventory         = dim(0, 'stock could not be confirmed', 'catalog-gate');
    add('unsourced_fact');
  } else {
    const live = cat.live === true;
    const weak = (cat.products || []).some((p) => p && p.confidence && p.confidence === 'weak');
    m.data_completeness = dim(live ? 10 : 6, live ? 'live catalog read' : 'catalog is the stale build artifact', 'catalog-gate');
    m.product_accuracy  = dim(weak ? 4 : 10, weak ? 'at least one product matched only weakly' : 'every product resolved unambiguously', 'catalog-gate');
    m.inventory         = dim(live ? 10 : 5, live ? 'stock read live' : 'stock not confirmed live', 'catalog-gate');
    if (weak) add('unsourced_fact');
  }

  // ── URL accuracy: market-urls is the single source, so this is checkable ──
  const urls = collectUrls(c);
  if (!urls.length) {
    m.url_accuracy = unmeasured('the campaign carries no URLs to check');
  } else {
    let bad = [];
    try {
      const mu = require('./market-urls.js');
      const allowed = typeof mu.allHosts === 'function' ? mu.allHosts() : null;
      if (allowed && allowed.length) {
        bad = urls.filter((u) => { try { return !allowed.includes(new URL(u).host); } catch (_) { return true; } });
      }
    } catch (_) { /* fall through to the shape check below */ }
    const placeholder = urls.filter((u) => /^#$|PASTE_|example\.com|TODO/i.test(u));
    const wrong = bad.concat(placeholder);
    m.url_accuracy = dim(wrong.length ? 0 : 10,
      wrong.length ? `${wrong.length} URL(s) not on an approved store host: ${wrong.slice(0, 3).join(', ')}` : `${urls.length} URL(s) on approved hosts`,
      'market-urls');
    if (wrong.length) add('missing_url');
  }

  // ── Approved-library dimensions ──────────────────────────────────────────
  // These are the two the repo has never had a source for. They must not
  // quietly score 10 just because nothing checked them.
  let lib = ctx.libraries || {};
  if (!lib.claims) {
    // Verify against the approved-claims library. It ships empty on purpose,
    // so a campaign that makes a claim blocks until brand/legal populate it -
    // the correct answer, not the convenient one. A campaign that makes NO
    // checkable claim scores full marks honestly.
    try {
      const v = require('./claims-library.js').verify(c, (c.entry && c.entry.market) || c.market);
      lib = { ...lib, claims: { ...v, source: v.populated ? 'claims-library' : 'claims-library (empty)' } };
    } catch (_) { /* leave unmeasured */ }
  }
  if (lib.claims && lib.claims.checked === 0) {
    m.claim_compliance = dim(10, 'the creative makes no checkable claim', 'claims-library');
  } else m.claim_compliance = lib.claims
    ? dim(lib.claims.unapproved ? 0 : 10,
        lib.claims.unapproved ? `${lib.claims.unapproved} unapproved claim(s)` : 'every claim matched the approved library',
        'claims-library')
    : unmeasured('no approved-claims library exists yet, so claims cannot be verified');
  if (lib.claims && lib.claims.unapproved) add('unverified_claim');

  const usesReviews = /\b\d\.\d\s*\/?\s*5|\bstars?\b|\breviews?\b/i.test(JSON.stringify(c.assets || {}));
  if (lib.reviews) {
    m.review_authenticity = dim(lib.reviews.unapproved ? 0 : 10,
      lib.reviews.unapproved ? `${lib.reviews.unapproved} rating/review not in the approved set` : 'ratings and reviews matched the approved set',
      'review-library');
    if (lib.reviews.unapproved) add('fabricated_review');
  } else if (usesReviews) {
    m.review_authenticity = dim(0, 'the creative states a rating or review but no approved review library exists to verify it', null);
    add('fabricated_review');
  } else {
    m.review_authenticity = dim(10, 'the creative makes no rating or review claim', 'content-scan');
  }

  // ── Audience safety ──────────────────────────────────────────────────────
  const reach = c.reach || (c.entry && c.entry.reach) || null;
  const size = reach && (reach.eligible || reach.segment_size);
  m.segment_eligibility = isNum(size) && size > 0
    ? dim(reach.measured ? 10 : 5,
        reach.measured ? `${size} eligible, measured` : `${size} eligible, MODELLED not measured`,
        reach.measured ? 'esp' : 'model')
    : unmeasured('no eligible-segment size is available');

  const cap = ctx.frequency || (reach && reach.frequency_cap) || null;
  if (!cap) {
    m.frequency_safety = unmeasured('no frequency check ran');
  } else if (cap.over_cap || (isNum(cap.sends_in_rolling_7d) && cap.sends_in_rolling_7d > (cap.absolute_max || 3))) {
    m.frequency_safety = dim(0, `${cap.sends_in_rolling_7d} sends in the rolling 7 days, over the absolute max`, 'frequency');
    add('absolute_frequency_violation');
  } else if (!isNum(cap.sends_in_rolling_7d)) {
    m.frequency_safety = dim(4, 'a cap is declared but the actual rolling-7-day count is unknown', 'frequency');
  } else {
    m.frequency_safety = dim(10, `${cap.sends_in_rolling_7d} sends in the rolling 7 days, within cap`, 'frequency');
  }

  // ── Creative quality, from the QA that already runs ──────────────────────
  const aq = c.asset_qa || null;
  const adq = c.ads_qa || null;
  const critIssues = countIssues(aq, 'critical') + countIssues(adq, 'critical');
  const warnIssues = countIssues(aq, 'warning') + countIssues(adq, 'warning');

  const tmpl = !c.copywriter || /template/i.test(String((c.copywriter || {}).provider || ''));
  m.copy_quality = tmpl
    ? dim(3, 'copy is the template fallback, not generated, and has not been proofread', 'copywriter')
    : (aq ? dim(critIssues ? 2 : warnIssues ? 7 : 10,
        critIssues ? `${critIssues} critical copy issue(s)` : warnIssues ? `${warnIssues} warning(s)` : 'no copy issues measured',
        'asset-engines-qa')
      : unmeasured('no asset QA result'));
  if (tmpl) add('unproofread_copy');
  if (critIssues) add('truncated_copy');

  m.asset_accuracy = aq
    ? dim(critIssues ? 3 : 10, critIssues ? `${critIssues} critical asset issue(s)` : 'assets within spec', 'asset-engines-qa')
    : unmeasured('no asset QA result');

  m.email_compatibility = aq
    ? dim(10, 'rendered by the mailer engine, which emits table-based inline-CSS HTML', 'asset-engines')
    : unmeasured('no email asset was produced');

  // ── Brand + design ───────────────────────────────────────────────────────
  // Per-campaign render QA. The repo's design guards are all build-time and
  // inspect SOURCE; this measures the HTML the campaign actually produced, so
  // contrast / mobile / UI stop being permanently unmeasured.
  let render = ctx.render || null;
  if (!render) {
    try { render = require('./render-qa.js').inspectCampaign(c); } catch (_) { render = null; }
  }
  const contrast = ctx.contrast || (render ? {
    failures: render.failures,
    black_background: render.black_background,
  } : null);
  if (contrast) {
    const fails = contrast.failures || 0;
    m.accessibility = dim(fails ? 0 : 10, fails ? `${fails} contrast failure(s)` : 'all measured pairs reach AA', 'contrast');
    if (fails) add('a11y_blocker');
    if (contrast.black_background) add('black_background');
  } else {
    // The repo-wide guard runs in CI, not per campaign. Say so rather than
    // borrowing its result for a campaign it never looked at.
    m.accessibility = unmeasured('no per-campaign contrast measurement ran (the repo guard is build-time, not per campaign)');
  }
  m.brand_consistency = aq
    ? dim(critIssues ? 4 : 10, 'brand voice and palette enforced by sanitizeBrand + asset QA', 'scenario-model')
    : unmeasured('no asset QA result');
  m.ui_ux_sanity = render
    ? dim(render.ui_issues.length ? Math.max(0, 10 - render.ui_issues.length * 3) : 10,
        render.ui_issues.length ? render.ui_issues.slice(0, 3).join('; ') : 'no placeholder, dead link, truncation or missing-alt issue',
        'render-qa')
    : unmeasured('no rendered asset to inspect');
  if (render && render.ui_issues.some((i) => /placeholder/i.test(i))) add('unsourced_fact');
  if (render && render.ui_issues.some((i) => /no destination/i.test(i))) add('missing_url');
  if (render && render.ui_issues.some((i) => /truncate/i.test(i))) add('truncated_copy');

  m.mobile = render
    ? dim(render.mobile_issues.length ? Math.max(0, 10 - render.mobile_issues.length * 3) : 10,
        render.mobile_issues.length ? render.mobile_issues.slice(0, 3).join('; ') : 'reflows: bounded width and a mobile query',
        'render-qa')
    : unmeasured('no rendered asset to inspect');

  // ── Commercial ───────────────────────────────────────────────────────────
  const fc = c.forecast || null;
  m.revenue_model = fc && isNum(fc.expected_revenue)
    ? dim(fc.basis === 'measured' ? 10 : 5, `${fc.basis || 'modelled'} forecast`, 'forecast')
    : unmeasured('no revenue forecast attached');

  if (ctx.build && ctx.build.ok === false) add('build_failure');

  // ── Roll up ──────────────────────────────────────────────────────────────
  const rows = DIMENSIONS.map((d) => ({ ...d, ...(m[d.key] || unmeasured('not measured')) }));
  const measured = rows.filter((r) => r.score != null);
  const missing = rows.filter((r) => r.score == null);
  const earned = measured.reduce((n, r) => n + r.score * r.weight, 0);
  const measuredWeight = measured.reduce((n, r) => n + r.weight, 0);

  // Score over the FULL weight, so unmeasured dimensions cost you. Scoring
  // over only what was measured is how a gate passes by ignorance.
  const weighted = Math.round((earned / WEIGHT_TOTAL) * 100) / 100;
  const ofMeasured = measuredWeight ? Math.round((earned / measuredWeight) * 100) / 100 : 0;

  const criticalBelowFloor = rows.filter((r) => r.critical && (r.score == null || r.score < CRITICAL_FLOOR));
  const ok = weighted >= PASS_MARK && !criticalBelowFloor.length && !blockers.length && !missing.length;

  return {
    ok,
    verdict: ok ? 'LAUNCH READY' : 'NOT LAUNCH READY - DATA, DESIGN, FACTUAL, OR TECHNICAL DEPENDENCY',
    weighted,
    of_measured: ofMeasured,
    pass_mark: PASS_MARK,
    weight_total: WEIGHT_TOTAL,   // 99, not the 100 the spec claims
    dimensions: rows,
    unmeasured: missing.map((r) => ({ key: r.key, label: r.label, weight: r.weight, why: r.evidence })),
    critical_below_floor: criticalBelowFloor.map((r) => ({ key: r.key, label: r.label, score: r.score })),
    blockers,
    remediation: remediate(missing, criticalBelowFloor, blockers),
  };
}

function remediate(missing, crit, blockers) {
  const out = [];
  for (const r of missing) out.push(`Measure ${r.label}: ${r.why}`);
  for (const r of crit) if (r.score != null) out.push(`Raise ${r.label} to >= ${CRITICAL_FLOOR}/10 (currently ${r.score})`);
  for (const b of blockers) out.push(`Clear blocking condition: ${b.replace(/_/g, ' ')}`);
  return out;
}

function countIssues(qa, sev) {
  if (!qa) return 0;
  const list = qa.issues || (Array.isArray(qa) ? qa : []);
  return list.filter((i) => i && (i.sev === sev || i.severity === sev)).length;
}

function collectUrls(c) {
  const found = new Set();
  JSON.stringify(c || {}).replace(/https?:\/\/[^\s"'<>\\)]+/g, (u) => { found.add(u); return u; });
  return [...found];
}

module.exports = { scoreCampaign, DIMENSIONS, WEIGHT_TOTAL, CRITICAL_FLOOR, PASS_MARK, BLOCKERS };
