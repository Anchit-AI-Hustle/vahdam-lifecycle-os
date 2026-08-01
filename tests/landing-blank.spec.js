const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The blank landing page. A page generated from an ad opened as an empty cream
// iframe with working Download and Copy buttons handing out the same broken file.
//
// Cause: landing_page asks for ONE complete single-file HTML document with all
// CSS inline, and capped at 7000 tokens the model often stopped mid-document.
// The cut lands in the <style> block (it is long and sits in the head), so the
// browser treats the whole rest of the file as unterminated CSS and renders
// NOTHING — while the client's `/<!doctype|<\/html>|<body/i` test happily passed
// it, because a truncated page still starts with <!doctype.

const ROOT = path.join(__dirname, '..');
const LP = fs.readFileSync(path.join(ROOT, 'landing-pages.html'), 'utf8');
const GEN = fs.readFileSync(path.join(ROOT, 'api', 'ai', 'generate.js'), 'utf8');

const TRUNCATED = '<!doctype html><html><head><meta charset="utf-8"><style>' + 'a{color:red}'.repeat(40) + '.btn{col';
const COMPLETE = '<!doctype html><html><head><style>body{margin:0}</style></head><body><h1>Calm your cortisol</h1><p>'
  + 'Real persuasive body copy that a visitor can actually read. '.repeat(3) + '</p></body></html>';

// Long enough in total to clear the size floor, but its <body> holds only an
// empty structural element. Checking for a content element alone would pass it.
const EMPTY_SHELL = '<!doctype html><html><head><style>' + 'a{color:red}'.repeat(20)
  + '</style></head><body><div></div></body></html>';

test.describe('a truncated page is never rendered as if it were fine', () => {
  test('the client requires a COMPLETE document, not one that looks like HTML', async ({ page }) => {
    await page.setContent('<div></div>');
    const src = LP.slice(LP.indexOf('function isCompleteHTMLDoc'), LP.indexOf('async function generateLandingHTML'));
    const r = await page.evaluate(({ src, truncated, complete, shell }) => {
      const f = new Function(src + '; return isCompleteHTMLDoc;')();
      return {
        truncated: f(truncated), complete: f(complete), empty: f(''),
        bodyless: f('<!doctype html><html><body></body></html>'),
        emptyShell: f(shell),
      };
    }, { src, truncated: TRUNCATED, complete: COMPLETE, shell: EMPTY_SHELL });
    expect(r.truncated).toBe(false);   // the actual bug
    expect(r.complete).toBe(true);
    expect(r.empty).toBe(false);
    expect(r.bodyless).toBe(false);    // closes cleanly but has nothing to show
    expect(r.emptyShell).toBe(false);  // has a <div>, still nothing to read
  });

  test('the old permissive check would have accepted it — proving the fix matters', () => {
    expect(/<!doctype|<\/html>|<body/i.test(TRUNCATED)).toBe(true);
    expect(LP).not.toContain('if (/<!doctype|<\\/html>|<body/i.test(html)) { f._ai = true; return html; }');
  });

  test('a rejected page falls back to the template instead of rendering blank', () => {
    const fn = LP.slice(LP.indexOf('async function generateLandingHTML'), LP.indexOf('let _lpModal'));
    expect(fn).toContain('if (isCompleteHTMLDoc(html))');
    expect(fn).toContain('return buildLandingHTML(f)');
  });
});

test.describe('the server stops producing them', () => {
  test('landing_page gets room for a whole document', () => {
    // 7000 was the cap that produced the truncation.
    expect(GEN).toContain("mode === 'landing_page' ? 16000");
  });

  test('and its gate rejects a body with nothing to read', () => {
    // Behavioural, not a string match: run the real function. A <div> alone
    // satisfies the content-element test, so only the size floor catches this.
    const start = GEN.indexOf('function isCompleteHtmlDocument');
    expect(start, 'gate not found').toBeGreaterThan(-1);
    const src = GEN.slice(start, GEN.indexOf('\n}\n', start) + 2);
    const f = new Function(src + '; return isCompleteHtmlDocument;')();
    expect(f(EMPTY_SHELL)).toBe(false);
    expect(f(COMPLETE)).toBe(true);
    expect(f('<!doctype html><html><body></body></html>')).toBe(false);
  });

  test('and reports truncation rather than returning a page that looks fine', () => {
    expect(GEN).toContain('function isCompleteHtmlDocument');
    // Anchor on the response block, not on the prompt branch further up which
    // shares the same `mode === 'landing_page'` text.
    const at = GEN.indexOf('const lpHtml = brandScrub(text);');
    expect(at, 'landing_page response block not found').toBeGreaterThan(-1);
    const ret = GEN.slice(at, at + 900);
    expect(ret).toContain('complete');
    expect(ret).toContain('truncated: !complete');
  });
});
