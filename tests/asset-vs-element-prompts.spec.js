const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

// TWO KINDS OF PROMPT, AND THE UI GAVE YOU THE WRONG ONE
//
// An ELEMENT prompt returns one image that goes inside an asset. An ASSET
// prompt returns the finished asset. Mailer Studio's "Prompts" tab offered
// ChatGPT / Claude / Gemini cards whose buttons ALL copied an element prompt -
// the Gemini one copied the product-photograph brief. Pasted into Gemini it
// returned exactly what it asked for: one pack shot, and no mailer.
//
// Underneath that, the asset prompts themselves asked for the INGREDIENTS. The
// mailer contract asked for "3 subject lines, a hero headline, 2-3 paragraphs,
// a CTA"; the ad contract asked for "every text field, plus a creative brief
// per size". Both are copy documents, not assets. Only the landing page,
// playable and video contracts ever demanded a finished file.
//
// These tests pin both halves: the contracts demand the whole asset, and the UI
// tells you which kind of prompt you are copying.

const ROOT = path.join(__dirname, '..');
const mp = require(path.join(ROOT, 'api', '_shared', 'master-prompt.js'));
const generate = require(path.join(ROOT, 'api', 'ai', 'generate.js'));

const ASSET_TYPES = ['mailer', 'ad', 'social', 'landing_page', 'video', 'playable', 'blog'];
const build = (assetType, over = {}) => mp.buildMasterPrompt({ assetType, market: 'UK', platform: 'meta', brief: 'winback lapsed buyers', ...over });

// ── The contracts demand the finished thing ─────────────────────────────────
test('every asset prompt states that the deliverable is the whole asset', () => {
  for (const t of ASSET_TYPES) {
    const p = build(t);
    expect(p, `${t} does not carry the whole-asset rule`).toContain('DELIVER THE WHOLE ASSET');
    expect(p, `${t} does not rule out a brief`).toMatch(/brief[\s\S]{0,200}FAILED response|FAILED response/);
  }
});

test('the mailer contract asks for a sendable file, not a copy document', () => {
  const v2 = build('mailer');
  expect(v2).toMatch(/self-contained, ready-to-send HTML email file|ready-to-send HTML email/);
  expect(v2).toContain('SUBJECT_PRIMARY');           // the repo's metadata block
  expect(v2).toMatch(/600px/);                       // the real email column
  expect(v2).toMatch(/inline/i);                     // inline CSS, not a stylesheet
  // The old contract's giveaway phrasing must be gone.
  expect(v2, 'V2 still asks for a section-by-section plan').not.toMatch(/Section-by-section layout/);
  const v1 = build('mailer', { variant: 'V1' });
  expect(v1, 'V1 still says "pure copy"').not.toMatch(/pure copy/);
  expect(v1).toMatch(/PLAIN TEXT/);
});

test('the ad contract asks for the creative itself, not a description of it', () => {
  const p = build('ad', { platform: 'google' });
  expect(p).toMatch(/THE CREATIVE ITSELF/);
  expect(p).toMatch(/complete, self-contained\s+HTML document/);
  // It must say a paragraph describing the visual is not the deliverable.
  expect(p).toMatch(/describing the visual is NOT the creative/);
  // And still deliver the platform fields, which a real ad needs.
  expect(p).toMatch(/PLATFORM FIELDS/);
});

test('a blog request no longer returns an email contract', () => {
  const p = build('blog');
  expect(p).toContain('ASSET: Blog post');
  expect(p, 'blog fell through the else-chain to the mailer contract').not.toContain('Email mailer');
  expect(p).toMatch(/an outline, a heading list/);   // outlines explicitly refused
});

// ── The one honest way to express a photo slot ──────────────────────────────
test('asset prompts that contain photography use the paste-token protocol', () => {
  // A chat model cannot produce a photograph. Letting it emit <img src="hero.jpg">
  // would be a fabricated filename under the zero-fabrication rule.
  for (const t of ['mailer', 'ad', 'social', 'landing_page', 'blog']) {
    const p = build(t);
    expect(p, `${t} has no media-slot protocol`).toContain('MEDIA SLOTS');
    expect(p).toContain('PASTE_IMAGE_URL_HERE');
    expect(p).toMatch(/NEVER invent an image filename/);
  }
});

test('the playable does NOT use paste tokens, because it must inline everything', () => {
  // Reviewers test playables offline; a pasted URL would fail the unit. The two
  // rules genuinely conflict, and the inlining rule wins for this asset.
  const p = build('playable');
  expect(p).not.toContain('PASTE_IMAGE_URL_HERE');
  expect(p).toMatch(/data: ?URI/i);
});

test('the paste token matches the parser that fills it', () => {
  // The protocol is only useful if asset-agent.js can actually read what the
  // model emits, so the example in the prompt is checked against the real regex.
  const MF = require(path.join(ROOT, 'api', '_shared', 'mailer-format.js'));
  const p = build('mailer');
  const example = (p.match(/<!-- IMAGE GENERATION PROMPT[\s\S]*?-->/) || [])[0];
  expect(example, 'no example slot in the prompt').toBeTruthy();
  const re = new RegExp(MF.ASSET_PROMPT_RE.source, 'i');
  expect(re.test(example), `asset-agent.js cannot parse the shape the prompt teaches:\n${example}`).toBe(true);
  expect(p).toContain(MF.PLACEHOLDER.image);
});

// ── The endpoint that serves it ─────────────────────────────────────────────
function invoke(query, body) {
  return new Promise((resolve) => {
    const res = {
      _status: 200, _headers: {},
      setHeader(k, v) { this._headers[k] = v; },
      status(c) { this._status = c; return this; },
      json(o) { resolve({ status: this._status, body: o, headers: this._headers }); },
      end() { resolve({ status: this._status, body: null, headers: this._headers }); },
    };
    generate({ method: body ? 'POST' : 'GET', query, body, headers: {} }, res);
  });
}

test('the master-prompt route returns a labelled asset prompt', async () => {
  for (const t of ['mailer', 'ad', 'landing_page']) {
    const r = await invoke({ action: 'master-prompt', assetType: t, market: 'UK' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.kind, 'the response must name which KIND of prompt it is').toBe('asset');
    expect(r.body.produces).toMatch(/complete finished asset/);
    expect(r.body.prompt).toContain('DELIVER THE WHOLE ASSET');
    expect(r.body.chars).toBeGreaterThan(2000);
  }
});

test('the route works with no provider key, because assembling text spends nothing', async () => {
  // It runs before the provider-key check on purpose: a deployment with no keys
  // is exactly when a human needs the prompt to paste somewhere else.
  const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY'];
  const saved = {};
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    const r = await invoke({ action: 'master-prompt', assetType: 'mailer' });
    expect(r.status, 'must not 500 on server_misconfigured').toBe(200);
    expect(r.body.ok).toBe(true);
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

test('the route carries CORS, like every other function here', async () => {
  const r = await invoke({ action: 'master-prompt', assetType: 'mailer' });
  expect(r.headers['Access-Control-Allow-Origin']).toBe('*');
});

// ── The UI names which kind you are copying ─────────────────────────────────
const STUDIO = fs.readFileSync(path.join(ROOT, 'vahdam_mailer_architect_v34.html'), 'utf8');

test('the asset prompt has a real entrance, not dead code', () => {
  // copyMasterPrompt() was defined and called from nowhere, so the prompt that
  // builds the whole mailer was unreachable from the UI. Same defect class as
  // the vanished Creative Studio entrances recorded in CLAUDE.md.
  expect(STUDIO).toMatch(/function copyAssetPrompt\(/);
  const calls = (STUDIO.match(/copyAssetPrompt\(/g) || []).length;
  expect(calls, 'copyAssetPrompt is defined but never wired to a control').toBeGreaterThan(1);
  expect(STUDIO).toMatch(/Asset prompt &mdash; returns the COMPLETE mailer/);
});

test('every element card says it returns an element, not the mailer', () => {
  // The three toasts a user sees after clicking must each disambiguate.
  for (const phrase of [
    'ELEMENT prompt copied (an image, not the mailer)',
    'ELEMENT prompt copied (a mockup, not the mailer)',
    'ELEMENT prompt copied (one photograph, not the mailer)',
  ]) expect(STUDIO, `missing disambiguating toast: ${phrase}`).toContain(phrase);
  // And no card may still describe itself as "the full campaign prompt".
  expect(STUDIO).not.toMatch(/Layout prompt copied/);
});

test('the studio reads the prompt from the API, not from a second local copy', () => {
  expect(STUDIO).toContain("'/api/ai/generate?action=master-prompt'");
});

// ── The page still parses, and the button actually copies ───────────────────
test.describe('the studio page works', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'behaviour test, one engine');
  test.use({ serviceWorkers: 'block' });   // the PWA self-heal reload races clicks

  let server; let origin;
  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/api/ai/generate') {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          const q = Object.fromEntries(u.searchParams);
          let b = {}; try { b = JSON.parse(raw || '{}'); } catch (_) { b = {}; }
          invoke({ ...q, ...b }, b).then((r) => {
            res.writeHead(r.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(r.body));
          });
        });
        return;
      }
      const f = path.join(ROOT, u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname));
      if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        const ext = path.extname(f);
        res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/plain' });
        return res.end(fs.readFileSync(f));
      }
      res.writeHead(404); res.end('nope');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    origin = 'http://127.0.0.1:' + server.address().port;
  });
  test.afterAll(async () => { await new Promise((r) => server.close(r)); });

  test('the edited Prompts tab renders and the asset button is reachable', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => {
      // Blocking the service worker (above) makes the context sandboxed, and
      // auth.js's `'serviceWorker' in navigator` probe then throws a
      // SecurityError. That is this test's own setting, not a page defect, so
      // it is filtered by exact cause rather than by dropping the assertion -
      // the assertion is what proves the edited markup still parses and runs.
      const m = String(e);
      if (/Service worker is disabled because the context is sandboxed/.test(m)) return;
      errors.push(m);
    });
    await page.goto(origin + '/vahdam_mailer_architect_v34.html');
    await page.waitForFunction(() => document.readyState === 'complete');
    // The block exists in the DOM (display:none until the tab is opened).
    expect(await page.locator('#p4-chatgpt').count()).toBe(1);
    expect(await page.locator('#assetPromptState').count()).toBe(1);
    const btn = page.locator('#p4-chatgpt button', { hasText: 'Copy asset prompt' });
    expect(await btn.count()).toBe(1);
    expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
  });

  test('copying the asset prompt fetches the complete-asset prompt', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(origin + '/vahdam_mailer_architect_v34.html');
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(() => window.copyAssetPrompt('mailer'));
    await expect.poll(() => page.locator('#assetPromptState').textContent()).toMatch(/returns the complete mailer/);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('DELIVER THE WHOLE ASSET');
    expect(copied).toContain('ready-to-send HTML email');
    // The thing the user actually hit: it must NOT be a photograph brief.
    expect(copied).not.toMatch(/^Premium, photorealistic PRODUCT PHOTOGRAPH/);
  });
});
