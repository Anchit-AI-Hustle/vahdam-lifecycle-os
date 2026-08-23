const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// CLAUDE.md's "Common Bugs to Watch" opens with this one:
//
//   1. Unescaped quotes / apostrophes inside single-quoted JS strings - these
//      pages are giant inline-JS files; a stray backtick in a CSS comment once
//      broke a template literal and killed the sidebar.
//
// The most-cited bug class in the project had no automated check. CI runs
// `node --check` over api/lib/workers/scripts and the root *.js glob - and
// stops there. The pages themselves carry ~4.2MB of inline JavaScript across
// 239 files, and a syntax error in any of it kills that page while CI stays
// green, because a broken <script> is a runtime failure, not a build one.
//
// The CI step's own comment records learning exactly this lesson once already
// ("a list that must be updated by hand is a list that gets forgotten"), for
// root scripts. This extends it to where the code actually lives.

const ROOT = path.join(__dirname, '..');

// Only executable JavaScript. A <script type="application/ld+json"> is data and
// a text/template block is markup; neither is parsed as JS by the browser, so
// neither should be parsed as JS here.
const JS_TYPE = /^(|text\/javascript|application\/javascript|module)$/i;

function inlineBlocks(html) {
  const out = [];
  // An HTML end tag may carry whitespace AND attribute-like junk before the
  // bracket - `</script >`, `</script\t\n foo="bar">` all close the element,
  // the parser just ignores the junk. A close pattern that misses any of those
  // makes the extractor swallow the rest of the document as script body: a
  // false failure produced by the guard itself.
  //
  // CodeQL flagged this twice, and was right both times. The first fix allowed
  // whitespace only, which is patching the example rather than the rule. The
  // rule is: everything from `</script` up to the next `>` is the close tag.
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;                       // external file
    const t = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [, ''])[1];
    if (!JS_TYPE.test(t)) continue;
    out.push({ code: m[2], module: /module/i.test(t), at: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

const pages = execSync("git ls-files '*.html'", { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

test('the repo really does carry inline JS worth checking', () => {
  // Guards the premise: if this returns nothing, every assertion below is vacuous.
  expect(pages.length).toBeGreaterThan(50);
  const total = pages.reduce((n, p) => n + inlineBlocks(fs.readFileSync(path.join(ROOT, p), 'utf8')).length, 0);
  expect(total, 'no inline script blocks found - the extractor is broken').toBeGreaterThan(100);
});

test('every inline script block parses', () => {
  const broken = [];
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const b of inlineBlocks(html)) {
      try {
        if (b.module) {
          // import/export are illegal in a Function body; check as a module.
          new (require('vm').SourceTextModule || Object)(b.code); // eslint-disable-line
        } else {
          new Function(b.code); // eslint-disable-line no-new-func
        }
      } catch (e) {
        if (b.module && /SourceTextModule|not a constructor/.test(String(e && e.message))) continue;
        broken.push(`${rel}:~${b.at}  ${String((e && e.message) || e).slice(0, 120)}`);
      }
    }
  }
  expect(broken, `inline script(s) with a syntax error - the page is dead in the browser:\n  ${broken.join('\n  ')}`).toEqual([]);
});

test('the CI syntax step still covers the standalone scripts', () => {
  // This spec extends that coverage; it must not be read as replacing it.
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  expect(ci).toMatch(/node --check/);
  expect(ci, 'the root-script glob was replaced by a hand-kept list again').toMatch(/for f in \*\.js/);
});

test('the extractor handles every legal close-tag form', () => {
  // All of these close the element per the HTML spec; the parser ignores the
  // junk after the tag name. CodeQL supplied the second and third examples
  // after the first fix only allowed whitespace - patching the example rather
  // than the rule.
  for (const close of ['</script>', '</script >', '</script\t\n bar>', '</script foo="bar">']) {
    const html = `<script>var a = 1;${close}\n<p>after</p>\n<script>var b = 2;</script>`;
    const blocks = inlineBlocks(html);
    expect(blocks.length, `close tag ${JSON.stringify(close)} broke extraction`).toBe(2);
    expect(blocks[0].code).toContain('var a');
    expect(blocks[1].code).toContain('var b');
    for (const b of blocks) expect(() => new Function(b.code)).not.toThrow();
    // The prose between them must not have been swallowed into a block.
    expect(blocks.some((b) => b.code.includes('<p>after')),
      `content after ${JSON.stringify(close)} was swallowed`).toBe(false);
  }
});
