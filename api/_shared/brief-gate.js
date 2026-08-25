'use strict';

/**
 * brief-gate.js — the essential-input check for strategy and copy generation.
 *
 * WHY
 * ---
 * catalog-gate.js stops a creative being built on product FACTS we cannot
 * verify. This is the same idea one level up: it stops a creative being built
 * on a STRATEGY nobody supplied.
 *
 * `api/ai/generate.js` used to tell the model, when no brief was given:
 *   "(none provided — derive a strong, specific campaign concept from the
 *    campaign type and market above)"
 * — that is an instruction to invent the objective, the audience and the angle,
 * and then present them in the same voice as the parts a human actually chose.
 * The output reads identically whether the audience came from the operator's
 * segment analysis or from the model's imagination, which is exactly the
 * failure mode the zero-fabrication contract exists to prevent. Fabricating
 * "who this is for" is more expensive than fabricating a price, because the
 * whole send is aimed by it.
 *
 * Borrowed from Google's ADK marketing-agency sample
 * (python/agents/marketing-agency), whose strategy sub-agent refuses outright:
 * "If Essential Information is Missing: You MUST NOT proceed... you MUST
 * formulate a response listing each specific piece of essential information
 * that is missing." That rule is right, but binary refusal is wrong here, so
 * this gate splits by what the output DOES:
 *
 *   • CUSTOMER-FACING modes (mailer_full, concepts) — copy that ships. A missing
 *     essential BLOCKS, in the same shape and vocabulary as the catalog gate,
 *     listing exactly what to supply.
 *   • IDEATION modes (create_brief) — an internal step the operator reviews in
 *     Studio Step 1 before anything ships. It PROCEEDS, but every gap becomes a
 *     declared assumption: the caller gets a deterministic `assumptions[]`, and
 *     the prompt is instructed to label them inline. An assumption the operator
 *     can see and correct is useful; an invisible one is a lie with a delay.
 *
 * The assumption list is computed HERE, from which inputs were actually absent,
 * rather than asked of the model — a model asked to list its own assumptions
 * omits the ones it does not notice making.
 */

// What each mode genuinely needs. Keyed to this app's pipeline rather than a
// generic agency checklist: a Vahdam send is aimed by objective + audience and
// is about a product or an offer.
const ESSENTIALS = {
  objective: {
    label: 'Primary goal',
    hint: 'What this send is for (for example: win back lapsed buyers, push the sampler, drive first repeat).',
    assumption: 'No goal was supplied, so the brief optimises for generic engagement rather than a stated business outcome.',
  },
  audience: {
    label: 'Target audience / cohort',
    hint: 'Who receives this (a cohort key, a segment description, or an RFM tier).',
    assumption: 'No audience was supplied, so the brief speaks to a general buyer rather than a named cohort.',
  },
  subject: {
    label: 'Product focus or offer',
    hint: 'Either selected products, or a brief describing the offer/theme.',
    assumption: 'No product focus or brief was supplied, so the concept was derived from the campaign type alone.',
  },
};

// Modes whose output is customer-facing copy. These block; the rest declare.
const BLOCKING_MODES = new Set(['mailer_full', 'concepts', 'landing_page']);
const GATED_MODES = new Set(['create_brief', 'mailer_full', 'concepts', 'landing_page']);

const text = (v) => String(v == null ? '' : v).trim();

/**
 * Which essentials are present, judged on substance rather than presence of a
 * key: a whitespace string or a one-word "brief" is not an objective.
 */
function assess(input = {}) {
  const brief = text(input.campaign_brief || input.brief || input.prompt);
  // A cohort arrives as a STRING almost everywhere in this app ('Lapsed 90d',
  // entry.cohort_label) and as an object only in the Smart Brain plan payload.
  // Reading `.name`/`.key` alone made a string cohort invisible, so naming the
  // cohort did not satisfy the audience essential and the send was blocked for
  // missing the thing it had just been given.
  const cohortName = typeof input.cohort === 'string'
    ? input.cohort
    : (input.cohort && (input.cohort.name || input.cohort.key)) || '';
  const audience = text(input.target_audience || input.audience || cohortName);
  const objective = text(input.objective || input.goal || input.theme || input.type);
  const products = Array.isArray(input.selected_products) ? input.selected_products : [];

  const present = {
    // A goal can be stated outright or carried by the campaign type (Sale,
    // Winback, Launch): those are objectives in this app's vocabulary.
    objective: objective.length >= 3,
    audience: audience.length >= 3,
    // A product focus is satisfied by an actual selection OR by a brief with
    // enough substance to describe one. 12 characters is deliberately low: the
    // point is to catch empty and one-word input, not to grade prose.
    subject: products.length > 0 || brief.length >= 12,
  };
  const missing = Object.keys(ESSENTIALS).filter((k) => !present[k]);
  return { present, missing, brief, audience, objective, products };
}

function dataRequiredLine(missing, market) {
  return `[DATA REQUIRED BEFORE LAUNCH: campaign brief essentials (${missing.join(', ')}), ${market}]`;
}

/**
 * requireBrief({ mode, market, ...input })
 *
 * @returns proceed  { ok:true, blocked:false, missing:[], assumptions:[{field,label,note}],
 *                     assumption_note: string|null, essentials:{...} }
 *          blocked  { ok:false, blocked:true, code:'BRIEF_INCOMPLETE', missing:[...],
 *                     needed:[{field,label,hint}], data_required, status, message }
 */
function requireBrief({ mode = 'create_brief', market = 'US', ...input } = {}) {
  const a = assess(input);
  const base = {
    mode,
    market,
    missing: a.missing,
    essentials: a.present,
    checked_at: new Date().toISOString(),
  };

  if (!GATED_MODES.has(mode) || !a.missing.length) {
    return Object.assign(base, { ok: true, blocked: false, assumptions: [], assumption_note: null });
  }

  if (BLOCKING_MODES.has(mode)) {
    return Object.assign(base, {
      ok: false,
      blocked: true,
      code: 'BRIEF_INCOMPLETE',
      status: 'NOT LAUNCH READY - BRIEF DEPENDENCY',
      needed: a.missing.map((k) => ({ field: k, label: ESSENTIALS[k].label, hint: ESSENTIALS[k].hint })),
      data_required: dataRequiredLine(a.missing, market),
      message: `${mode} produces customer-facing copy, so it will not run on an invented strategy. Supply: ${a.missing.map((k) => ESSENTIALS[k].label).join('; ')}.`,
    });
  }

  // Ideation: proceed, but every gap is declared rather than silently filled.
  const assumptions = a.missing.map((k) => ({ field: k, label: ESSENTIALS[k].label, note: ESSENTIALS[k].assumption }));
  return Object.assign(base, {
    ok: true,
    blocked: false,
    assumptions,
    assumption_note: assumptions.map((x) => x.note).join(' '),
  });
}

/** The block, shaped for an HTTP caller — same contract as catalogGate.blockedResponse. */
function blockedResponse(gate) {
  return {
    ok: false,
    blocked: true,
    reason: 'brief_incomplete',
    code: gate.code,
    status: gate.status,
    message: gate.message,
    missing: gate.missing,
    needed: gate.needed,
    data_required: gate.data_required,
  };
}

/**
 * The prompt fragment that makes the model declare, inline, what it had to
 * assume. Paired with the deterministic list above: this makes the assumption
 * visible in the artifact, the list makes it visible to the caller.
 */
function assumptionPromptBlock(gate) {
  if (!gate || !gate.assumptions || !gate.assumptions.length) return '';
  return [
    '',
    'DECLARED ASSUMPTIONS - the operator did not supply these, so you are inferring them:',
    ...gate.assumptions.map((a) => `- ${a.label}: ${a.note}`),
    'State each inferred element as an assumption in the brief itself (for example "assuming a lapsed-buyer audience"), so a reviewer can correct it. Do NOT present an inferred audience, goal or product focus as though it were given to you or researched.',
  ].join('\n');
}

/** Provenance to stamp on the response, so the caller can show what was inferred. */
function stamp(gate) {
  if (!gate) return null;
  return {
    brief_complete: !gate.missing.length,
    brief_missing: gate.missing,
    brief_assumptions: (gate.assumptions || []).map((a) => a.field),
    brief_checked_at: gate.checked_at,
  };
}

module.exports = { requireBrief, blockedResponse, assumptionPromptBlock, stamp, ESSENTIALS, BLOCKING_MODES, GATED_MODES, assess };
