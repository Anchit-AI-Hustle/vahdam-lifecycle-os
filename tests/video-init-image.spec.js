const { test, expect } = require('@playwright/test');
const http = require('http');
const path = require('path');

// Product video has one hard constraint: the packaging on screen must be the
// REAL packaging. Text-to-video cannot satisfy it — asked for "a tin of VAHDAM
// Turmeric Ashwagandha" a model renders a plausible tin with garbled letterforms,
// which is a fabricated product shot dressed up as a photograph. So the clip has
// to START from the real Shopify pack shot and let the model supply only motion.
//
// These tests cover the init-image path and, just as importantly, what happens
// when it FAILS: a silently-degraded text-to-video job looks identical to a real
// one from the outside, so the caller has to be told.

const VC = require(path.join(__dirname, '..', 'api', '_shared', 'video-core.js'));

let server;
let BASE = '';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // header is enough

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/pack.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(PNG);
    }
    if (req.url === '/huge.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(Buffer.alloc(7 * 1024 * 1024, 1));
    }
    if (req.url === '/notimage') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html>not a pack shot</html>');
    }
    res.writeHead(404); res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

// No provider keys in CI, so generateVideo returns the not-connected stub — which
// carries the exact request body it WOULD send. That is the cleanest place to
// assert the request shape without spending a paid video generation.
test.describe('image-to-video keeps the real product in frame', () => {
  test('a real pack shot is attached to the Veo instance', async () => {
    const r = await VC.generateVideo({ prompt: 'slow push-in, morning light', aspect: '9:16', image_url: `${BASE}/pack.jpg` });
    const inst = r.would_request.body.instances[0];
    expect(inst.image).toBeTruthy();
    expect(inst.image.mimeType).toBe('image/jpeg');
    expect(inst.image.bytesBase64Encoded).toBe(PNG.toString('base64'));
    // The prompt still rides along — the model supplies motion, not the product.
    expect(inst.prompt).toContain('push-in');
  });

  test('no image means a plain text-to-video instance, not a broken one', async () => {
    const r = await VC.generateVideo({ prompt: 'steam rising from a cup', aspect: '16:9' });
    const inst = r.would_request.body.instances[0];
    expect(inst.image).toBeUndefined();
    expect(inst.prompt).toBe('steam rising from a cup');
  });

  test('an unreachable pack shot degrades instead of throwing', async () => {
    const r = await VC.generateVideo({ prompt: 'a', image_url: `${BASE}/missing.jpg` });
    expect(r.would_request.body.instances[0].image).toBeUndefined();
  });

  test('a URL that is not an image is refused as an init frame', async () => {
    const r = await VC.generateVideo({ prompt: 'a', image_url: `${BASE}/notimage` });
    expect(r.would_request.body.instances[0].image).toBeUndefined();
  });

  test('an oversized init frame is refused rather than posted', async () => {
    const r = await VC.generateVideo({ prompt: 'a', image_url: `${BASE}/huge.jpg` });
    expect(r.would_request.body.instances[0].image).toBeUndefined();
  });

  test('non-http schemes are never fetched', async () => {
    const r = await VC.generateVideo({ prompt: 'a', image_url: 'file:///etc/passwd' });
    expect(r.would_request.body.instances[0].image).toBeUndefined();
  });
});

test.describe('cascade order reflects what actually works', () => {
  test('Veo leads — it is the only rung that survives September and does image-to-video', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'api', '_shared', 'video-core.js'), 'utf8');
    const rungs = src.slice(src.indexOf('let rungs = ['), src.indexOf('// Caller can reorder'));
    const order = [...rungs.matchAll(/name: '([a-z]+)'/g)].map((m) => m[1]);
    expect(order[0]).toBe('veo');
    // Sora is last: OpenAI removes the Videos API on 2026-09-24.
    expect(order[order.length - 1]).toBe('sora');
  });

  test('the sunset is documented where the ordering is decided', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'api', '_shared', 'video-core.js'), 'utf8');
    expect(src).toContain('2026-09-24');
  });
});
