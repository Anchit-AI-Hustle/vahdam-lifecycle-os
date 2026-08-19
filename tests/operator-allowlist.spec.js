const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The operator gate was domain-only (ANALYTICS_ADMIN_DOMAINS, default
// vahdam.com), so the owner's own non-vahdam sign-ins were treated as
// anonymous: no detailed health, no forced catalog refresh, no /api/shopify.
// Named owner accounts are now recognised alongside the domain.
//
// They are stored as SHA-256 because THIS REPOSITORY IS PUBLIC and the check
// only ever needs equality. That is a privacy decision, not a security one:
// an operator still needs a valid Supabase session for the account, and these
// tests assert the hash is never the thing that grants access on its own.

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'api', '_shared', 'data-analysis-core.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'data-analysis-core.js'), 'utf8');

const OWNERS = ['anchit.tandon@gmail.com', 'anchit.tandon@vahdam.com', 'anchit.tandon2803@gmail.com'];

test('each named owner account is recognised as an operator', () => {
  for (const e of OWNERS) expect(core.isOperatorEmail(e), e).toBe(true);
});

test('recognition survives the casing and padding a provider may return', () => {
  expect(core.isOperatorEmail('ANCHIT.TANDON@GMAIL.COM')).toBe(true);
  expect(core.isOperatorEmail('  anchit.tandon2803@gmail.com  ')).toBe(true);
});

test('the vahdam.com domain still works, and is still the default', () => {
  expect(core.isOperatorEmail('someone.else@vahdam.com')).toBe(true);
  expect(SRC).toContain("ANALYTICS_ADMIN_DOMAINS || 'vahdam.com'");
});

test('nobody else gets in, including near-misses on the allowlisted addresses', () => {
  for (const e of [
    'stranger@gmail.com',
    'anchit.tandon@gmail.com.evil.com',   // suffix attack on the address
    'x@notvahdam.com',                    // suffix attack on the domain
    'anchit.tandon@gmail.co',
    'anchit tandon@gmail.com',
    '',
    null,
    undefined,
  ]) expect(core.isOperatorEmail(e), String(e)).toBe(false);
});

test('a domain match is anchored at @, so a lookalike domain is refused', () => {
  // 'evilvahdam.com' ends with 'vahdam.com' as a plain string; only the '@'
  // anchor stops it being read as the real domain.
  expect(core.isOperatorEmail('attacker@evilvahdam.com')).toBe(false);
});

test('ANALYTICS_ADMIN_EMAILS adds an operator without a deploy', () => {
  const prev = process.env.ANALYTICS_ADMIN_EMAILS;
  try {
    expect(core.isOperatorEmail('contractor@example.com')).toBe(false);
    process.env.ANALYTICS_ADMIN_EMAILS = 'contractor@example.com, second@example.com';
    expect(core.isOperatorEmail('contractor@example.com')).toBe(true);
    expect(core.isOperatorEmail('CONTRACTOR@example.com')).toBe(true);
    expect(core.isOperatorEmail('third@example.com')).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.ANALYTICS_ADMIN_EMAILS; else process.env.ANALYTICS_ADMIN_EMAILS = prev;
  }
});

test('the allowlist itself publishes no address', () => {
  // The whole point of hashing: this module is the file the feature added, and
  // it must carry hashes only.
  const src = SRC.toLowerCase();
  for (const e of OWNERS) expect(src.includes(e), `data-analysis-core.js contains ${e}`).toBe(false);
});

test('no PERSONAL address appears anywhere in the tracked source', () => {
  // Scoped to the two personal addresses on purpose. The work address is a
  // legitimate documented default elsewhere (`.env.example` ships
  // ALERT_EMAIL=anchit.tandon@vahdam.com as the alert recipient, and has since
  // long before this allowlist existed) - removing that would delete useful
  // configuration to satisfy a rule aimed at a different risk. What must never
  // be scrapeable from a public repo is a personal inbox.
  const personal = OWNERS.filter((e) => e.endsWith('@gmail.com'));
  const out = require('child_process').execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  const tracked = out.toString('utf8').split('\0').filter(Boolean)
    .filter((f) => !f.startsWith('tests/'))          // this spec needs the addresses
    .filter((f) => /\.(js|mjs|json|md|html|css|yml|yaml|sql|py|sh|txt|example)$/i.test(f) || f === '.env.example');
  const hits = [];
  for (const rel of tracked) {
    let src;
    try { src = fs.readFileSync(path.join(ROOT, rel), 'utf8').toLowerCase(); } catch (_) { continue; }
    for (const e of personal) if (src.includes(e)) hits.push(`${rel}: ${e}`);
  }
  expect(hits, `personal address(es) committed in plaintext:\n  ${hits.join('\n  ')}`).toEqual([]);
});

test('the stored hashes are the real ones, so the list cannot rot unnoticed', () => {
  for (const e of OWNERS) {
    expect(SRC, `hash for ${e} is missing from the allowlist`)
      .toContain(crypto.createHash('sha256').update(e).digest('hex'));
  }
});

test('a hash alone grants nothing: authorize still requires a real session', async () => {
  // isOperatorEmail answers "is this address an operator", not "is this caller
  // authenticated". The gate must still reject a request with no bearer token
  // even though the owner addresses are allowlisted.
  const r = await core.authorize({ headers: {} });
  expect(r.ok).toBe(false);
  expect(r.status).toBe(401);
  expect(r.error).toBe('operator_session_required');
});
