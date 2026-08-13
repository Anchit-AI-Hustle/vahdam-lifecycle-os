const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// `sandbox="allow-scripts allow-same-origin"` ON A SAME-ORIGIN DOCUMENT IS NOT A
// SANDBOX. A srcdoc / about:blank frame inherits the PARENT's origin, so those
// two permissions together let the framed document reach parent.document, read
// localStorage — where this app keeps the Supabase auth session — and remove its
// own sandbox attribute. The attribute is present, looks defensive, and does
// nothing.
//
// landing-page-agent.html had exactly that, filled via `frame.srcdoc = html`
// with HTML written by an LLM. Not attacker-controlled today, but the only
// markup on that page nobody in this repo authored.
//
// The distinction that matters is the SOURCE of the frame:
//   • cross-origin src (Looker Studio) — allow-same-origin keeps GOOGLE's
//     origin, not ours, and is required for their app to work. Fine.
//   • srcdoc / about:blank / same-origin src — allow-same-origin means OUR
//     origin. Combined with allow-scripts the sandbox is void.
//
// So this checks the pair only where it can actually escape.

const ROOT = path.join(__dirname, '..');
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));

// Hosts we knowingly embed cross-origin. A frame pointed at one of these is
// never same-origin with us, whatever the sandbox says.
const CROSS_ORIGIN = /lookerstudio\.google\.com|datastudio\.google\.com|youtube\.com|youtube-nocookie\.com|player\.vimeo\.com/;

function iframeTags(html) {
  return html.match(/<iframe\b[^>]*>/gi) || [];
}
/**
 * Does this page assign a cross-origin URL to `<id>.src`? The variable holding
 * the element is resolved first (`var f = document.getElementById("x")`), then
 * every `f.src = ...` is read. Any assignment that is NOT a recognised
 * cross-origin host counts as unproven and the frame is reported.
 */
/**
 * Is this right-hand side definitely a cross-origin URL? A literal is read
 * directly; a bare identifier is resolved one level to its own declaration,
 * because the real code writes `f.src = LOOKER_EMBED_URL`. Anything that cannot
 * be resolved to a known cross-origin host is treated as unproven — this must
 * fail closed, since a false "safe" here hides a live sandbox escape.
 */
function isCrossOriginExpr(html, expr) {
  const e = String(expr).trim();
  if (CROSS_ORIGIN.test(e)) return true;
  const ident = /^([A-Za-z_$][\w$]*)\s*$/.exec(e);
  if (!ident) return false;
  const decl = new RegExp(`(?:const|let|var)\\s+${ident[1]}\\s*=\\s*([^;\\n]+)`).exec(html);
  return !!decl && CROSS_ORIGIN.test(decl[1]);
}

function assignsCrossOrigin(html, id) {
  const varRe = new RegExp(`(?:var|let|const)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:document\\.getElementById\\(|\\$\\()["']${id}["']`, 'g');
  const vars = new Set();
  let m; while ((m = varRe.exec(html))) vars.add(m[1]);
  if (!vars.size) return false;
  let sawAssignment = false;
  for (const v of vars) {
    const srcRe = new RegExp(`\\b${v}\\.src\\s*=\\s*([^;\\n]+)`, 'g');
    let a; while ((a = srcRe.exec(html))) {
      sawAssignment = true;
      if (!isCrossOriginExpr(html, a[1])) return false;   // one unproven assignment is enough
    }
  }
  return sawAssignment;
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag);
  return m ? m[1] : null;
}

test.describe('an iframe sandbox actually sandboxes', () => {
  test('no same-origin-capable frame combines allow-scripts with allow-same-origin', () => {
    const offenders = [];
    for (const p of pages) {
      const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
      for (const tag of iframeTags(html)) {
        const sandbox = attr(tag, 'sandbox');
        if (sandbox == null) continue;
        const tokens = sandbox.split(/\s+/).filter(Boolean);
        if (!(tokens.includes('allow-scripts') && tokens.includes('allow-same-origin'))) continue;
        const frameId = attr(tag, 'id');
        const src = attr(tag, 'src') || '';
        // A literal cross-origin src is safe. So is one assigned from JS, but
        // only if we FOLLOW the assignment — the Looker embeds carry no src
        // attribute at all and get `f.src = "https://lookerstudio.google.com/..."`
        // at runtime. Judging those on the markup alone would report two safe
        // frames and bury the one real finding among them.
        if (CROSS_ORIGIN.test(src)) continue;
        if (!src && frameId && assignsCrossOrigin(html, frameId)) continue;
        const label = frameId || attr(tag, 'class') || tag.slice(0, 60);
        offenders.push(`${p}: <iframe ${label}> sandbox="${sandbox}" src="${src || '(none/srcdoc)'}"`);
      }
    }
    expect(offenders, `these sandboxes are decorative — the frame can reach the parent origin:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  test('the generated-landing-page preview keeps scripts and loses same-origin', () => {
    // Both halves matter. Removing allow-scripts too would "fix" the finding by
    // breaking the feature: the generated page's parallax, scroll progress and
    // reveal animations are the thing being previewed.
    const html = fs.readFileSync(path.join(ROOT, 'landing-page-agent.html'), 'utf8');
    const tag = iframeTags(html).find((t) => attr(t, 'id') === 'frame');
    expect(tag, 'the preview frame is gone').toBeTruthy();
    const tokens = (attr(tag, 'sandbox') || '').split(/\s+/).filter(Boolean);
    expect(tokens).toContain('allow-scripts');
    expect(tokens).not.toContain('allow-same-origin');
  });

  test('stored third-party HTML stays fully sandboxed', () => {
    // Captured competitor emails and KB documents render with sandbox="" — no
    // permissions at all. That is the strictest setting and must not be relaxed
    // to quiet the "Blocked script execution" console warning it produces.
    for (const [page, id] of [['knowledge-base.html', 'kbm-frame'], ['competitor-benchmarking.html', null]]) {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      const tags = iframeTags(html).filter((t) => (id ? attr(t, 'id') === id : true));
      expect(tags.length, `${page} has no iframe to check`).toBeGreaterThan(0);
      for (const t of tags) {
        expect(attr(t, 'sandbox'), `${page} frame must stay sandbox=""`).toBe('');
      }
    }
  });
});
