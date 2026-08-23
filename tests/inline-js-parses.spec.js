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
  // `</script >` with whitespace before the bracket is valid HTML, and a
  // close pattern that misses it makes the extractor swallow the rest of the
  // document as script content - a false failure from the guard itself.
  // Flagged by CodeQL on the first version of this file, and it was right.
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
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

test('the extractor handles a whitespace-padded close tag', () => {
  // `</script >` is valid HTML. The first version of this spec used
  // /<\/script>/ and would have treated everything after such a tag as
  // script body, failing on a page that is perfectly fine.
  const html = '<script>var a = 1;</script >\n<p>after</p>\n<script>var b = 2;</script>';
  const blocks = inlineBlocks(html);
  expect(blocks.length, 'a padded close tag broke block extraction').toBe(2);
  expect(blocks[0].code).toContain('var a');
  expect(blocks[1].code).toContain('var b');
  for (const b of blocks) expect(() => new Function(b.code)).not.toThrow();
  // And the prose between them was not swallowed into a block.
  expect(blocks.some((b) => b.code.includes('<p>after'))).toBe(false);
});
