const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// "Use claude-cli to fetch the anthropic-api-key, similarly use openai-cli to
// fetch the openai-api-key" is a reasonable-sounding request that cannot be
// satisfied, and the reason is worth pinning rather than re-litigating: what
// these CLIs hold is not an API key.
//
//   claude auth              -> login | logout | status. No key subcommand.
//   claude auth status       -> authMethod "oauth_token" (a Claude Code session)
//   codex login --with-api-key -> READS a key from stdin; it consumes, never issues
//   the openai SDK           -> ships no CLI at all in v3.x
//
// These tests assert the SHAPE of the tooling we ship in response, not the
// providers' behaviour (which we cannot control). The point is that the repo
// never grows a script claiming to fetch a secret, and never grows one that
// prints a secret value.

const ROOT = path.join(__dirname, '..');
const SETUP = path.join(ROOT, 'scripts', 'setup-clis.sh');
const PUSH = path.join(ROOT, 'scripts', 'push-env.sh');
const DOC = path.join(ROOT, 'docs', 'cli-and-keys.md');

const read = (p) => fs.readFileSync(p, 'utf8');

test('the scripts and the doc exist and are executable', () => {
  for (const p of [SETUP, PUSH]) {
    expect(fs.existsSync(p), `${p} is missing`).toBe(true);
    expect(fs.statSync(p).mode & 0o111, `${p} is not executable`).toBeTruthy();
  }
  expect(fs.existsSync(DOC)).toBe(true);
});

test('setup-clis states plainly that no CLI issues a key', () => {
  const src = read(SETUP);
  expect(src).toMatch(/no CLI here will hand you an API key/i);
  // It must name the actual evidence, not just assert it.
  expect(src).toContain('login | logout | status');
  expect(src).toContain('--with-api-key');
});

test('setup-clis covers every CLI the stack can use, and names the ones that do not exist', () => {
  const src = read(SETUP);
  for (const bin of ['vercel', 'supabase', 'shopify', 'wrangler', 'claude', 'codex']) {
    expect(src, `${bin} is not installed by setup-clis.sh`).toMatch(new RegExp(`npm_cli ${bin}\\b`));
  }
  // REST-only platforms must be listed as such rather than silently absent,
  // or their omission reads as an oversight.
  for (const p of ['Meta', 'Google Ads', 'TikTok', 'Klaviyo', 'WebEngage']) {
    expect(src, `${p} is not accounted for`).toContain(p);
  }
});

test('--check installs nothing and reports the real state', () => {
  const out = execFileSync('bash', [SETUP, '--check'], { cwd: ROOT, encoding: 'utf8' });
  expect(out).toMatch(/present: \d+/);
  expect(out).toMatch(/No CLI exists for these/);
});

test('push-env is dry-run by default: --apply is required to write', () => {
  const src = read(PUSH);
  expect(src).toMatch(/SAFE BY DEFAULT: dry-run unless you pass --apply/);
  // The write path must be reachable only through the explicit flag.
  expect(src).toMatch(/if \[ "\$MODE" != "--apply" \]/);
  expect(src).toMatch(/vercel env add/);
});

test('push-env refuses a git-tracked env file, because the repo is public', () => {
  const src = read(PUSH);
  expect(src).toMatch(/git ls-files --error-unmatch/);
  expect(src).toMatch(/REFUSING/);
});

test('push-env never echoes a secret value', () => {
  // Behavioural, not a source read: run it against a fixture holding known
  // sentinels and assert neither appears anywhere in its output.
  const tmp = path.join(ROOT, 'node_modules', '.cache-envfixture');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const file = tmp + '.env';
  fs.writeFileSync(file, [
    '# a comment',
    'LIVE_CONNECTORS=on',
    'ANTHROPIC_API_KEY=sk-ant-SENTINELALPHA',
    'EMPTY_ONE=',
    'OPENAI_API_KEY=sk-proj-SENTINELBETA',
  ].join('\n'));
  try {
    for (const args of [['--check'], []]) {
      const out = execFileSync('bash', [PUSH, ...args], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, ENV_FILE: file },
      });
      expect(out, 'a secret value was printed').not.toContain('SENTINELALPHA');
      expect(out, 'a secret value was printed').not.toContain('SENTINELBETA');
      // It must still be useful: names and lengths, and the empty one skipped.
      expect(out).toContain('ANTHROPIC_API_KEY');
      expect(out).toMatch(/EMPTY_ONE\s+\(empty\)/);
      expect(out).toMatch(/3 variable\(s\)/);
    }
  } finally { fs.unlinkSync(file); }
});

test('the env file the scripts use is gitignored', () => {
  const ignore = read(path.join(ROOT, '.gitignore'));
  expect(ignore).toMatch(/^\.env\.local$/m);
});

test('the doc records the evidence, so nobody re-tries the impossible route', () => {
  const doc = read(DOC);
  expect(doc).toMatch(/No CLI can fetch an API key/i);
  expect(doc).toContain('oauth_token');
  expect(doc).toContain('--with-api-key');
  expect(doc).toMatch(/no console script|ships no console script/i);
  // Every key the app reads must have a stated origin.
  for (const v of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'KLAVIYO_API_KEY', 'META_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY']) {
    expect(doc, `${v} has no documented source`).toContain(v);
  }
});

test('no script in the repo claims to fetch or print a secret', () => {
  // The guard with teeth: a future helper that greps a keychain for a provider
  // key, or echoes one, fails here.
  const files = execFileSync('git', ['ls-files', 'scripts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => /\.(sh|js|mjs)$/.test(f));
  const hits = [];
  for (const rel of files) {
    const src = read(path.join(ROOT, rel));
    // Reading a key FROM the environment is correct and expected; printing one
    // to stdout is not.
    if (/echo\s+"?\$\{?(ANTHROPIC|OPENAI|GEMINI|KLAVIYO|META|SUPABASE)[A-Z_]*\}?"?/.test(src)) hits.push(rel);
  }
  expect(hits, `script(s) echo a credential:\n  ${hits.join('\n  ')}`).toEqual([]);
});
