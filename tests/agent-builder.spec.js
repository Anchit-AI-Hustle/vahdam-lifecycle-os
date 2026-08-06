const { test, expect } = require('@playwright/test');
const path = require('path');

// Google Vertex AI Agent Builder connects to an external API by importing an
// OpenAPI 3.0 spec — the spec IS the integration. Two things therefore have to
// hold, and both are security properties rather than cosmetics:
//
//   1. The spec is GENERATED from the live ChaiGPT tool registry. A hand-written
//      YAML would be a second source of truth that drifts the moment a tool
//      changes — the exact failure this repo keeps hitting (nav INFO keys, the
//      metric catalog, the CI script list).
//   2. Mutating tools are not merely absent from the spec, they are REFUSED at
//      execution time. A tool that is hidden but callable is not protected: an
//      external agent is steered by whoever is talking to it, and it must not be
//      able to generate campaigns or spend model quota.

const core = require(path.join(__dirname, '..', 'api', '_shared', 'agent-builder-core.js'));
const brandLlm = require(path.join(__dirname, '..', 'api', '_shared', 'brand-llm.js'));

// MUST await fn(): with a plain `return fn()` the finally block restores the env
// synchronously, before an async body has run a single assertion — so every
// async test here silently ran against the REAL env (no AGENT_BUILDER_API_KEY),
// got a 503 "not configured", and proved nothing about the gate it was written
// to prove.
async function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k];
    if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(); } finally {
    for (const k of Object.keys(prev)) { if (prev[k] == null) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}
const req = (key) => ({ headers: key ? { 'x-agent-key': key } : {} });

test('the spec is valid OpenAPI 3.0 with one operation per exposed tool', async () => {
  await withEnv({ AGENT_BUILDER_API_KEY: 'k', AGENT_BUILDER_ALLOW_WRITES: null }, () => {
    const spec = core.openApiSpec({ origin: 'https://example.test' });
    // 3.0 specifically: Agent Builder's parser is documented against 3.0.
    expect(spec.openapi).toMatch(/^3\.0/);
    expect(spec.servers[0].url).toBe('https://example.test');
    expect(spec.components.securitySchemes.AgentKey).toMatchObject({ type: 'apiKey', in: 'header' });

    const ops = Object.values(spec.paths).map((p) => p.post);
    expect(ops.length).toBeGreaterThan(10);
    for (const op of ops) {
      expect(op.operationId, 'Agent Builder keys operations by operationId').toBeTruthy();
      // The model chooses tools by reading this; an empty one makes the tool dead weight.
      expect(op.description && op.description.length, `${op.operationId} needs a description`).toBeGreaterThan(40);
      expect(op.security).toEqual([{ AgentKey: [] }]);
    }
  });
});

test('the spec is generated from the tool registry, so it cannot drift', async () => {
  await withEnv({ AGENT_BUILDER_API_KEY: 'k', AGENT_BUILDER_ALLOW_WRITES: null }, () => {
    const spec = core.openApiSpec({});
    const inSpec = Object.values(spec.paths).map((p) => p.post.operationId).sort();
    const readOnly = brandLlm.toolManifest().filter((t) => !t.mutates).map((t) => t.name).sort();
    expect(inSpec).toEqual(readOnly);
    // And the descriptions are the registry's own, not a paraphrase. Note the
    // field is `description` here: toolManifest() renames the registry's
    // internal `desc`, and reading the wrong one is what produced a spec full of
    // undefined descriptions.
    const first = brandLlm.toolManifest().find((t) => !t.mutates);
    const op = Object.values(spec.paths).find((p) => p.post.operationId === first.name).post;
    expect(op.description).toBe(first.description);
  });
});

test('write tools are absent from the spec AND refused when called directly', async () => {
  await withEnv({ AGENT_BUILDER_API_KEY: 'k', AGENT_BUILDER_ALLOW_WRITES: null }, async () => {
    const writes = brandLlm.toolManifest().filter((t) => t.mutates).map((t) => t.name);
    expect(writes.length, 'the registry should still contain mutating tools').toBeGreaterThan(0);

    const spec = core.openApiSpec({});
    const inSpec = Object.values(spec.paths).map((p) => p.post.operationId);
    for (const w of writes) expect(inSpec, `${w} must not be in the spec`).not.toContain(w);

    // Guessing the hidden name must not work either.
    for (const w of writes) {
      const out = await core.runTool(req('k'), w, {});
      expect(out.ok).toBe(false);
      expect(out.status).toBe(403);
      expect(out.error).toBe('tool_is_write_gated');
    }
  });
});

test('the bridge is CLOSED by default and rejects a wrong key', async () => {
  await withEnv({ AGENT_BUILDER_API_KEY: null }, async () => {
    const out = await core.runTool(req('anything'), 'audience_base', {});
    expect(out.ok).toBe(false);
    expect(out.status).toBe(503);
    expect(out.blocker).toContain('AGENT_BUILDER_API_KEY');
  });
  await withEnv({ AGENT_BUILDER_API_KEY: 'correct-key' }, async () => {
    for (const bad of ['', 'wrong', 'correct-ke', 'correct-key-longer']) {
      const out = await core.runTool(req(bad), 'audience_base', {});
      expect(out.ok, `key "${bad}" must be rejected`).toBe(false);
      expect(out.status).toBe(401);
    }
  });
});

test('a disconnected source surfaces as top-level ok:false + a blocker, never as a bare success', async () => {
  await withEnv({ AGENT_BUILDER_API_KEY: 'k', AGENT_BUILDER_ALLOW_WRITES: null, LIVE_CONNECTORS: null, META_ACCESS_TOKEN: null, META_AD_ACCOUNT_ID: null }, async () => {
    // Meta has no credentials here, so ad_insights returns a not-connected
    // payload. The cores signal that INSIDE result; the spec promises the agent
    // that top-level ok:false + blocker is the signal. If the two disagree, a
    // Google-hosted model reads ok:true over a payload with no figures in it —
    // the exact moment a model invents one.
    const out = await core.runTool(req('k'), 'ad_insights', { platform: 'meta', market: 'US' });
    expect(out.ok, 'an unconnected platform must not report success').toBe(false);
    expect(out.blocker, 'the blocker must name the missing configuration').toBeTruthy();
    expect(out.blocker).toMatch(/META_ACCESS_TOKEN/);
    expect(out.blocker).toMatch(/do NOT substitute an estimate/i);
    // The raw payload is still passed through so nothing is hidden from the caller.
    expect(out.result).toBeTruthy();
  });
});

test('a real read is NOT mislabelled as a blocker', async () => {
  await withEnv({ AGENT_BUILDER_API_KEY: 'k', AGENT_BUILDER_ALLOW_WRITES: null }, async () => {
    // The mirror image of the test above: over-eager blocker detection would
    // make every genuine answer look unavailable, which is just as wrong.
    const out = await core.runTool(req('k'), 'catalog_products', { query: 'ashwagandha', market: 'US' });
    expect(out.ok).toBe(true);
    expect(out.blocker).toBeUndefined();
    expect(out.result.products.length).toBeGreaterThan(0);
    // Catalog URLs are the one thing an agent must never edit, so they must
    // arrive already absolute and on a real VAHDAM host.
    for (const p of out.result.products) expect(p.url).toMatch(/^https:\/\/[a-z.]*vahdam[a-z.]*\//);
  });
});

test('an unknown tool name is refused and does not leak the write tools', async () => {
  await withEnv({ AGENT_BUILDER_API_KEY: 'k', AGENT_BUILDER_ALLOW_WRITES: null }, async () => {
    const out = await core.runTool(req('k'), 'definitely_not_a_tool', {});
    expect(out.status).toBe(404);
    const writes = brandLlm.toolManifest().filter((t) => t.mutates).map((t) => t.name);
    for (const w of writes) expect(out.available).not.toContain(w);
  });
});

test('the spec instructs the agent to relay blockers rather than invent figures', async () => {
  await withEnv({ AGENT_BUILDER_API_KEY: 'k' }, () => {
    const spec = core.openApiSpec({});
    const d = spec.info.description;
    // The grounding contract is the whole reason this is safe to expose: a
    // Google-hosted model must not paper over a disconnected source.
    expect(d).toMatch(/Nothing is estimated/i);
    expect(d).toMatch(/blocker/i);
    expect(d).toMatch(/Never carry a US number into a UK answer/i);
  });
});

test('status reports what is exposed and what is withheld', async () => {
  await withEnv({ AGENT_BUILDER_API_KEY: 'k', AGENT_BUILDER_ALLOW_WRITES: null }, () => {
    const s = core.status();
    expect(s.configured).toBe(true);
    expect(s.writes_allowed).toBe(false);
    expect(s.withheld_write_tools.length).toBeGreaterThan(0);
    for (const w of s.withheld_write_tools) expect(s.exposed_tools).not.toContain(w);
    // A tool with no description is dropped from the spec rather than exposed as
    // a blind operation. That drop must never be silent, so it fails here.
    expect(s.omitted_no_description, 'a registry tool lost its description and fell out of the Agent Builder integration').toEqual([]);
    expect(s.exposed_tools.length).toBe(brandLlm.toolManifest().filter((t) => !t.mutates).length);
  });
});
