const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Three scheduled workflows called a CRON_SECRET-protected endpoint and did
// `exit 1` when the secret was unset. The secret was never added, so they
// failed on every tick forever: alerts every 2h (30 of 30 runs red over three
// days), data-analysis every hour, daily-sync once a day. Roughly 37 red runs
// and 37 "All jobs have failed" emails per day, all from one setup gap.
//
// The cost is not the noise itself, it is what the noise does to the signal:
// an alarm that is always on cannot report anything. So a missing SETUP secret
// is now a clean skip with an actionable notice, while a configured-but-broken
// endpoint still fails hard.

const ROOT = path.join(__dirname, '..');
const WORKFLOWS = [
  { file: 'alerts.yml', unset: { CRON_SECRET: '' }, set: { CRON_SECRET: 's' } },
  { file: 'daily-sync.yml', unset: { CRON_SECRET: '' }, set: { CRON_SECRET: 's' } },
  { file: 'data-analysis-hourly.yml', unset: { CRON_SECRET: '', APP_BASE_URL: '' }, set: { CRON_SECRET: 's', APP_BASE_URL: 'https://x.dev' } },
];

// Minimal YAML reach-in: pull a step's `run:` block without adding a dependency.
function preflightScript(file) {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8');
  const lines = text.split('\n');
  const idIdx = lines.findIndex((l) => /^\s*id:\s*pre\s*$/.test(l));
  expect(idIdx, `${file} must have a preflight step with id: pre`).toBeGreaterThan(-1);
  const runIdx = lines.findIndex((l, i) => i > idIdx && /^\s*run:\s*\|/.test(l));
  expect(runIdx, `${file} preflight must have a run block`).toBeGreaterThan(-1);
  const indent = lines[runIdx].match(/^\s*/)[0].length + 2;
  const out = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { out.push(''); continue; }
    if (l.match(/^\s*/)[0].length < indent) break;
    out.push(l.slice(indent));
  }
  return out.join('\n');
}

function runPreflight(script, env) {
  const dir = fs.mkdtempSync('/tmp/wf-');
  const outFile = path.join(dir, 'out');
  const sumFile = path.join(dir, 'sum');
  fs.writeFileSync(outFile, '');
  fs.writeFileSync(sumFile, '');
  let code = 0, stdout = '';
  try {
    stdout = execFileSync('bash', ['-c', script], {
      env: { ...process.env, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: sumFile, ...env },
      encoding: 'utf8',
    });
  } catch (e) { code = e.status; stdout = String(e.stdout || ''); }
  return { code, stdout, out: fs.readFileSync(outFile, 'utf8').trim(), summary: fs.readFileSync(sumFile, 'utf8') };
}

for (const wf of WORKFLOWS) {
  test.describe(wf.file, () => {
    test('an unset setup secret is a clean skip, never a red failure', () => {
      const r = runPreflight(preflightScript(wf.file), wf.unset);
      expect(r.code, 'a setup gap must not fail the run').toBe(0);
      expect(r.out).toBe('configured=false');
      expect(r.stdout, 'must surface a GitHub notice').toContain('::notice');
      expect(r.summary, 'must tell the operator exactly what to set').toContain('CRON_SECRET');
      expect(r.summary.toLowerCase()).toContain('not configured');
    });

    test('a present secret proceeds to the real work', () => {
      const r = runPreflight(preflightScript(wf.file), wf.set);
      expect(r.code).toBe(0);
      expect(r.out).toBe('configured=true');
      expect(r.stdout, 'no noise when configured').not.toContain('::notice');
    });

    test('every working step is gated on the preflight', () => {
      const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', wf.file), 'utf8');
      const stepNames = [...text.matchAll(/^\s{6}- name: (.+)$/gm)].map((m) => m[1]);
      const working = stepNames.filter((n) => !/^Preflight/.test(n));
      expect(working.length, 'there must be real work to gate').toBeGreaterThan(0);
      const gates = (text.match(/steps\.pre\.outputs\.configured == 'true'/g) || []).length;
      expect(gates, `all ${working.length} working steps must be gated`).toBe(working.length);
    });

    test('no working step re-introduces exit 1 on a missing secret', () => {
      // The exact regression: `if [ -z "$CRON_SECRET" ]; then ...; exit 1; fi`
      // inside a scheduled step. Only the preflight may inspect the secret, and
      // it may never exit non-zero for absence.
      const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', wf.file), 'utf8');
      const afterPre = text.slice(text.indexOf('id: pre'));
      const body = afterPre.slice(afterPre.indexOf('- name:', afterPre.indexOf('run:')));
      expect(body, 'working steps must not re-check the secret and bail').not.toMatch(/-z\s+"?\$\{?CRON_SECRET/);
      expect(body).not.toMatch(/repo secret is not set[^\n]*\n[^\n]*exit 1/);
    });

    test('outbound calls are bounded and retried, so a blip is not an alarm', () => {
      const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', wf.file), 'utf8');
      const curls = text.split('\n').filter((l) => l.includes('curl '));
      expect(curls.length).toBeGreaterThan(0);
      for (const c of curls) {
        const stanza = text.slice(text.indexOf(c), text.indexOf(c) + 400);
        expect(stanza, `curl must time out: ${c.trim().slice(0, 60)}`).toContain('--max-time');
        expect(stanza, `curl must retry: ${c.trim().slice(0, 60)}`).toContain('--retry');
        // Still fails loudly on a real HTTP error.
        expect(stanza).toContain('--fail-with-body');
      }
    });
  });
}
