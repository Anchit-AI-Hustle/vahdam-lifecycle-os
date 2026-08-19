'use strict';
/**
 * gate-notice.js — turn a structured refusal into a message an operator can act on.
 *
 * THE BUG THIS FIXES
 * ------------------
 * The gates (catalog-gate, brief-gate) answer HTTP 200 with a full explanation:
 *   { ok:false, blocked:true, message, blocker, data_required, remediation }
 * Every front end read only `j.error`, which those payloads do not carry, and
 * fell back to either the HTTP status or a bare string:
 *
 *   social-media.html  ->  "Pipeline call failed: HTTP 200 - is the API deployed/reachable?"
 *   smart-brain.html   ->  "Generation failed"
 *
 * Both are worse than useless. The first states the status of a SUCCESSFUL
 * response as the reason for failure and sends the operator to check a
 * deployment that is fine. The second discards the reason entirely. Meanwhile
 * the payload said, in plain words, "Live catalog unavailable for US - set
 * LIVE_CONNECTORS=on", which is the one thing that would have fixed it.
 *
 * This is the same defect the Klaviyo health probe had (see CLAUDE.md): a
 * message that sends someone to fix the thing that is not broken. A gate that
 * blocks silently is indistinguishable from a gate that is malfunctioning.
 *
 * ONE module rather than a copy per page, for the reason market-urls.js exists:
 * the copies drift, and the one that drifts is the one nobody re-reads.
 */
(function (root) {
  function explain(j, r) {
    // A structured block is a VERDICT, not a crash: the API worked and declined.
    if (j && j.blocked) {
      var parts = [j.message || j.blocker || 'Generation was blocked.'];
      if (j.data_required) parts.push(j.data_required);
      if (j.remediation && j.remediation.length) parts.push('To fix: ' + [].concat(j.remediation).join(' '));
      return { text: parts.join(' '), blocked: true, code: j.code || null };
    }
    if (j && j.error) return { text: String(j.error), blocked: false, code: null };
    // Only a real transport failure may ask whether the API is reachable.
    if (r && !r.ok) return { text: 'HTTP ' + r.status + ' - is the API deployed/reachable?', blocked: false, code: null };
    // ok:false with no reason is itself the finding — report it verbatim rather
    // than inventing a status code that implies something it does not mean.
    return { text: 'The API returned ok:false with no reason given. Payload: ' + JSON.stringify(j).slice(0, 240), blocked: false, code: null };
  }

  /** Prefix + explanation, so a caller can render one string. */
  function message(prefix, j, r) {
    var e = explain(j, r);
    return { text: (e.blocked ? prefix.replace(/failed/i, 'blocked') : prefix) + ': ' + e.text, blocked: e.blocked, code: e.code };
  }

  root.GateNotice = { explain: explain, message: message };
}(typeof window !== 'undefined' ? window : globalThis));
