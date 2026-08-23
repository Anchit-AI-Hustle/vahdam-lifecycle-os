const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

// From the portfolio audit: "The enforcement table - claim -> test that holds
// it - is the single most sellable asset in the entire portfolio. Nothing else
// here has it, and almost no competitor does."
//
// It is only worth anything if the binding is real. A hand-written table of
// claims and test names is marketing that rots the first time a test is
// renamed - the same drift this repo has hit with the URL map, the provider
// count and the launch gate. So the table is GENERATED, the generator resolves
// every claim to a real test title, and these tests fail if either the binding
// or the checked-in file goes stale.

const ROOT = path.join(__dirname, '..');
const GEN = path.join(ROOT, 'scripts', 'build-enforcement-table.js');
const DOC = path.join(ROOT, 'docs', 'enforcement.md');

test('the generated table is checked in and current', () => {
  const r = spawnSync('node', [GEN, '--check'], { cwd: ROOT, encoding: 'utf8' });
  expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
  expect(r.stdout).toMatch(/all bound|current/);
});

test('every claim resolves to a test that actually exists', () => {
  // The load-bearing property. The generator exits non-zero on an unbacked
  // claim, so a green run here means every row was resolved against a real
  // test title in a real spec file.
  const src = fs.readFileSync(GEN, 'utf8');
  const specs = [...src.matchAll(/spec:\s*'([^']+)'/g)].map((m) => m[1]);
  expect(specs.length).toBeGreaterThan(10);
  for (const s of new Set(specs)) {
    expect(fs.existsSync(path.join(ROOT, 'tests', s)), `claim points at missing spec ${s}`).toBe(true);
  }
});

test('a claim naming a test that does not exist fails the build', () => {
  // Verified with teeth: without this, the table is just prose.
  const src = fs.readFileSync(GEN, 'utf8');
  const tmp = path.join(ROOT, 'node_modules', '.enforcement-teeth.js');
  fs.writeFileSync(tmp, src.replace(
    /test:\s*'every inline script block parses'/,
    "test: 'a test title that certainly does not exist anywhere'"));
  try {
    const r = spawnSync('node', [tmp, '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, 'the generator accepted an unbacked claim').not.toBe(0);
    expect(r.stderr).toMatch(/Unbacked claim/);
  } finally { fs.unlinkSync(tmp); }
});

test('the table covers the claims the project actually leads with', () => {
  const md = fs.readFileSync(DOC, 'utf8').toLowerCase();
  // Each of these is a HARD rule in the governing spec or a headline claim in
  // CLAUDE.md. A table that omits them is decorative.
  for (const topic of ['fabricat', 'black', 'wcag aa', 'kill switch', 'catalog', 'credential']) {
    expect(md, `the enforcement table says nothing about "${topic}"`).toContain(topic);
  }
});

test('it is generated, and says so, rather than hand-maintained', () => {
  const md = fs.readFileSync(DOC, 'utf8');
  expect(md).toMatch(/Generated, not hand-written/);
  expect(md).toMatch(/npm run build:enforcement/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts['build:enforcement']).toBeTruthy();
});

test('no store host in the table or robots.txt is a redirecting one', () => {
  // Caught by the audit: robots.txt named vahdamteas.com as the live store,
  // which market-urls itself classifies as a redirecting host.
  const mu = require(path.join(ROOT, 'api', '_shared', 'market-urls.js'));
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  for (const h of mu.REDIRECTING_HOSTS) {
    expect(robots, `robots.txt points at the redirecting host ${h}`).not.toContain(h);
  }
  expect(robots).toContain('www.vahdam.com');
});

test('a table cell escapes backslashes before pipes', () => {
  // CodeQL caught this: escaping `|` while leaving `\` alone means a title
  // ending in a backslash emits `\\|`, which renders as a literal backslash
  // and then breaks the cell. Backslash must be escaped FIRST, or the escape
  // character you add is eaten by one already there.
  const src = fs.readFileSync(GEN, 'utf8');
  const body = src.slice(src.indexOf('function mdCell'), src.indexOf('function render'));
  const mdCell = new Function(body + '; return mdCell;')();

  expect(mdCell('a|b')).toBe('a\\|b');
  expect(mdCell('back\\slash')).toBe('back\\\\slash');
  expect(mdCell('ends\\')).toBe('ends\\\\');
  // A newline would terminate the table row.
  expect(mdCell('x\ny')).toBe('x y');
  // Template-literal placeholders show their shape, not the raw expression.
  expect(mdCell('${rel} paints')).toBe('<each file> paints');
  expect(mdCell(null)).toBe('');
});

test('the emitted table has no row broken by an unescaped delimiter', () => {
  // Structural check on the real output: every data row must have exactly the
  // column count the header declares.
  const md = fs.readFileSync(DOC, 'utf8');
  const rows = md.split('\n').filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l));
  expect(rows.length).toBeGreaterThan(15);
  for (const r of rows) {
    const cells = r.replace(/\\\|/g, '\u0000').split('|').length;
    expect(cells, `row has the wrong column count: ${r.slice(0, 80)}`).toBe(4);
  }
});
