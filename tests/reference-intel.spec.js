const { test, expect } = require('@playwright/test');
const http = require('http');
const path = require('path');

// api/_shared/reference-intel.js is what lets "build me an ad from THIS image"
// work against a text-only provider waterfall: it describes the media once and
// passes prose down the cascade.
//
// The rule it exists to enforce is the one worth locking: a reference we cannot
// read is REPORTED as unread. The failure mode this guards against is not a
// crash, it is a confident invented description -- "the ad shows a 40% off
// badge" -- being laundered into live campaign copy as observed fact. So the
// assertions below are mostly about what the module refuses to say.
//
// No provider keys are set in CI, so every vision rung is absent by design and
// the module must degrade honestly rather than fabricate.

const RI = require(path.join(__dirname, '..', 'api', '_shared', 'reference-intel.js'));

const PORT = 8913;
const BASE = `http://127.0.0.1:${PORT}`;
let server;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<!doctype html><html><head>
        <title>Rival Cold Brew</title>
        <meta name="description" content="Smooth cold brew, shipped fresh.">
        <meta property="og:image" content="https://example.com/hero.jpg">
        </head><body>
        <h1>Wake up slower</h1><h2>Single origin, roasted weekly</h2>
        <a class="btn">Shop the roast</a><button class="cta">Start a subscription</button>
        <p>Body copy about the beans and the farm.</p>
        <script>var tracking = "should not survive";</script>
        </body></html>`);
    }
    if (req.url === '/not-an-image') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><body>this is a web page, not a creative</body></html>');
    }
    if (req.url === '/huge.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(60 * 1024 * 1024) });
      return res.end(Buffer.alloc(1024));
    }
    if (req.url === '/small.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(Buffer.alloc(2048, 7));
    }
    res.writeHead(404);
    res.end('nope');
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
});

test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

test.describe('reference-intel', () => {
  test('a reference page is reduced to structure, not just a text dump', async () => {
    const p = await RI.fetchPageBrief(`${BASE}/page`);
    expect(p.ok).toBe(true);
    expect(p.title).toBe('Rival Cold Brew');
    expect(p.description).toBe('Smooth cold brew, shipped fresh.');
    expect(p.headings).toEqual(['Wake up slower', 'Single origin, roasted weekly']);
    expect(p.ctas).toEqual(expect.arrayContaining(['Shop the roast', 'Start a subscription']));
    // Scripts must not leak into the brief as if they were copy.
    expect(p.text).not.toContain('should not survive');
  });

  test('a dead reference URL is reported, not silently ignored', async () => {
    const p = await RI.fetchPageBrief(`${BASE}/missing`);
    expect(p.ok).toBe(false);
    expect(p.reason).toContain('404');
  });

  test('only http(s) references are accepted', async () => {
    expect(RI.isHttpUrl('https://example.com/a.jpg')).toBe(true);
    expect(RI.isHttpUrl('http://example.com/a.jpg')).toBe(true);
    expect(RI.isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(RI.isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(RI.isHttpUrl('data:image/png;base64,AAAA')).toBe(false);
    const d = await RI.describeMedia({ kind: 'image', url: 'file:///etc/passwd' });
    expect(d.ok).toBe(false);
    expect(d.reason).toContain('http');
  });

  test('an oversized video is refused up front by its declared length', async () => {
    const d = await RI.describeMedia({ kind: 'video', url: `${BASE}/huge.mp4` });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/60\.0MB|limit/);
  });

  test('a URL that returns a web page is not treated as a creative', async () => {
    const d = await RI.describeMedia({ kind: 'image', url: `${BASE}/not-an-image` });
    expect(d.ok).toBe(false);
    expect(d.reason).toContain('web page');
  });

  test('with no vision provider configured, media is declared unreadable and never described', async () => {
    const before = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY_2;
    delete process.env.OPENAI_API_KEY_3;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const d = await RI.describeMedia({ kind: 'image', url: `${BASE}/small.jpg` });
      expect(d.ok).toBe(false);
      expect(d.description).toBeUndefined();
      expect(d.reason).toContain('vision provider');
    } finally {
      Object.entries(before).forEach(([k, v]) => { if (v !== undefined) process.env[k] = v; });
    }
  });

  test('an unreadable attachment becomes an explicit instruction not to imagine it', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const brief = await RI.buildReferenceBrief({
      reference_url: `${BASE}/page`,
      media: [{ kind: 'video', url: `${BASE}/huge.mp4`, label: 'clip.mp4' }],
    });
    expect(brief.any).toBe(true);                       // the page did read
    expect(brief.warnings.length).toBe(1);              // the video did not
    expect(brief.warnings[0]).toContain('clip.mp4');
    expect(brief.text).toContain('COULD NOT BE READ');
    expect(brief.text).toContain('do not invent what it might have shown');
    // And the readable half still carries its structure through.
    expect(brief.text).toContain('Wake up slower');
  });

  test('no references means no reference section at all', async () => {
    const brief = await RI.buildReferenceBrief({});
    expect(brief.text).toBe('');
    expect(brief.any).toBe(false);
    expect(brief.warnings).toEqual([]);
  });

  test('data URIs are parsed and size-checked without a network call', async () => {
    const parsed = RI.parseDataUri('data:image/png;base64,' + Buffer.alloc(300, 1).toString('base64'));
    expect(parsed.mime).toBe('image/png');
    expect(parsed.bytes).toBe(300);
    const oversized = 'data:image/png;base64,' + Buffer.alloc(RI.MAX_IMAGE_BYTES + 1024, 1).toString('base64');
    const d = await RI.describeMedia({ kind: 'image', data_uri: oversized, label: 'big.png' });
    expect(d.ok).toBe(false);
    expect(d.reason).toContain('limit');
  });
});
