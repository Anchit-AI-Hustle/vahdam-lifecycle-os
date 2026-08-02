'use strict';

/**
 * api/_shared/video-core.js — Video generation cascade for VAHDAM (NEW capability).
 *
 * Cascade (blueprint docs/quality-upgrade-blueprint.md, July 2026):
 *   1. Veo 3.1   `veo-3.1-generate-preview`  — Gemini API predictLongRunning + poll
 *                (reuses GEMINI_API_KEY; paid tier)
 *   2. Sora 2    `sora-2`                    — OpenAI /v1/videos (OPENAI_API_KEY;
 *                note: API sunset 2026-09-24)
 *   3. Higgsfield Cloud REST                 — HIGGSFIELD_API_KEY (+ optional
 *                HIGGSFIELD_API_SECRET), ~$0.10/s, paid plans
 *   4. Runway    `gen4_turbo`                — RUNWAY_API_KEY, ~$0.05/s floor
 *
 * Async job model:
 *   generateVideo({ prompt, duration_s, aspect, tier })
 *     → { ok, provider, job_id, status, video_url? }        (job submitted)
 *   getVideoStatus({ provider, job_id })
 *     → { ok, provider, job_id, status, video_url? }        (poll until 'completed')
 *
 * Graceful degradation (Klaviyo pattern — see api/_shared/klaviyo-core.js):
 *   • a rung whose key is missing is SKIPPED;
 *   • when NO video key exists at all, returns
 *       { ok:false, connected:false, not_connected:true,
 *         would_request:{ provider, method, url, body }, hint }
 *     for the best rung, so chat/tool-calling work end-to-end key-free.
 *
 * Any synchronous wait is time-boxed to SYNC_WAIT_MS (20s) — after that the
 * caller gets { status:'processing' } and polls via getVideoStatus.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_BASE = 'https://api.openai.com/v1';
const HIGGSFIELD_BASE = 'https://cloud.higgsfield.ai/v1';
const OPENMONTAGE_BASE = (process.env.OPENMONTAGE_BASE || 'https://api.openmontage.ai/v1').replace(/\/+$/, '');
const RUNWAY_BASE = 'https://api.dev.runwayml.com/v1';
const RUNWAY_VERSION = '2024-11-06';

const VEO_MODEL = process.env.VEO_VIDEO_MODEL || 'veo-3.1-generate-preview';
const SORA_MODEL = process.env.SORA_VIDEO_MODEL || 'sora-2';
const RUNWAY_MODEL = process.env.RUNWAY_VIDEO_MODEL || 'gen4_turbo';

const SYNC_WAIT_MS = 20000;   // hard cap on synchronous waiting inside one call
const POLL_EVERY_MS = 5000;

function keys() {
  const clean = s => (s || '').replace(/[﻿​ ]/g, '').trim(); // strip BOM/zero-width (Vercel env)
  return {
    gemini: clean(process.env.GEMINI_API_KEY),
    openai: clean(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2 || process.env.OPENAI_API_KEY_3),
    higgsfield: clean(process.env.HIGGSFIELD_API_KEY),
    higgsfieldSecret: clean(process.env.HIGGSFIELD_API_SECRET),
    openmontage: clean(process.env.OPENMONTAGE_API_KEY),
    runway: clean(process.env.RUNWAY_API_KEY),
  };
}

function anyKey() {
  const k = keys();
  return !!(k.gemini || k.openai || k.higgsfield || k.openmontage || k.runway);
}

// Map generic aspect ratios per provider.
function normAspect(aspect) {
  const a = String(aspect || '16:9').trim();
  return (a === '9:16' || a === '1:1' || a === '16:9') ? a : '16:9';
}

async function _fetchJson(url, { method = 'GET', headers = {}, body = null, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await r.text().catch(() => '');
    let data; try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    return { ok: r.ok, status: r.status, data, errText: r.ok ? '' : text.substring(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, data: null, errText: e.name === 'AbortError' ? ('timeout after ' + timeoutMs + 'ms') : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Pull an init frame down as base64 for image-to-video. Bounded: an oversized or
// non-image URL returns null and the caller degrades to text-to-video rather than
// throwing mid-cascade.
const INIT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
async function _fetchImageB64(url, timeoutMs = 12000) {
  if (!/^https?:\/\//i.test(String(url || ''))) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) return null;
    const mime = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\//i.test(mime)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > INIT_IMAGE_MAX_BYTES) return null;
    return { b64: buf.toString('base64'), mime, bytes: buf.length, url };
  } catch (_) { return null; }
  finally { clearTimeout(t); }
}

// ── Rung request builders (also used for the { would_request } stub) ─────────

// `image` ({ b64, mime }) turns this into IMAGE-TO-VIDEO, which for VAHDAM is the
// only safe way to put a product on screen. Text-to-video invents the packaging —
// a model asked for "a tin of VAHDAM Turmeric Ashwagandha" renders a plausible tin
// with garbled letterforms, which is a fabricated product shot. Starting from the
// real Shopify pack shot means the packaging in the clip IS the packaging, and the
// model only supplies motion around it.
// ── Audio ────────────────────────────────────────────────────────────────────
// Native audio is a PER-PROVIDER capability, not a universal one. Veo 3.x
// generates a soundtrack but only when `generateAudio` is set — omit it and the
// clip comes back silent, which is exactly how VAHDAM's video ads shipped with
// no background music. Sora 2 scores natively with no flag. Runway `gen4_turbo`
// has NO audio track at all, so a cascade demotion to Runway is silent whatever
// we ask for; AUDIO_CAPABLE records that so the caller is told rather than left
// to assume music is present.
const AUDIO_CAPABLE = { veo: true, sora: true, higgsfield: true, openmontage: true, runway: false };

// The direction itself rides in the PROMPT for every provider. These models take
// scoring instructions as prose ("sparse warm strings, no percussion"), and there
// is no documented body field for it on Higgsfield/OpenMontage/Sora — inventing
// one would be silently dropped at best. Only Veo's `generateAudio` is a real,
// documented parameter, so that is the only one set structurally.
function withAudioDirection(prompt, audio) {
  const a = String(audio || '').trim();
  if (!a) return prompt;
  return prompt + ' AUDIO: ' + a.replace(/\s+/g, ' ');
}

function veoRequest({ prompt, aspect, image, audio }) {
  const instance = { prompt: withAudioDirection(prompt, audio) };
  if (image && image.b64) instance.image = { bytesBase64Encoded: image.b64, mimeType: image.mime || 'image/jpeg' };
  const parameters = { aspectRatio: normAspect(aspect) };
  // Explicit both ways: `true` asks Veo to score the clip, `false` keeps a
  // deliberately silent render silent instead of leaving it to a model default.
  parameters.generateAudio = !!audio;
  return {
    provider: 'veo',
    method: 'POST',
    url: GEMINI_BASE + '/models/' + VEO_MODEL + ':predictLongRunning',
    body: {
      instances: [instance],
      parameters,
    },
  };
}

function soraRequest({ prompt, duration_s, aspect, audio }) {
  const a = normAspect(aspect);
  const size = a === '9:16' ? '720x1280' : a === '1:1' ? '720x720' : '1280x720';
  return {
    provider: 'sora',
    method: 'POST',
    url: OPENAI_BASE + '/videos',
    body: { model: SORA_MODEL, prompt: withAudioDirection(prompt, audio), seconds: String(Math.min(Math.max(Math.round(duration_s || 8), 4), 12)), size },
  };
}

function higgsfieldRequest({ prompt, duration_s, aspect, audio }) {
  return {
    provider: 'higgsfield',
    method: 'POST',
    url: HIGGSFIELD_BASE + '/text2video',
    body: { prompt: withAudioDirection(prompt, audio), duration: Math.min(Math.max(Math.round(duration_s || 8), 3), 15), aspect_ratio: normAspect(aspect) },
  };
}

function openMontageRequest({ prompt, duration_s, aspect, audio }) {
  return {
    provider: 'openmontage',
    method: 'POST',
    url: OPENMONTAGE_BASE + '/text2video',
    body: { prompt: withAudioDirection(prompt, audio), duration_s: Math.min(Math.max(Math.round(duration_s || 8), 3), 30), aspect_ratio: normAspect(aspect) },
  };
}

// Runway gen4_turbo renders no audio track. The direction is still passed so the
// prompt is identical across rungs (and survives a future audio-capable model),
// but `audio_supported:false` on the result is what callers must trust.
function runwayRequest({ prompt, duration_s, aspect, image, audio }) {
  const a = normAspect(aspect);
  const ratio = a === '9:16' ? '720:1280' : a === '1:1' ? '960:960' : '1280:720';
  const body = { model: RUNWAY_MODEL, promptText: withAudioDirection(prompt, audio), ratio, duration: (duration_s || 8) <= 5 ? 5 : 10 };
  // This endpoint is image_to_video and REQUIRES promptImage; it accepts a data
  // URI as well as an https URL.
  if (image && image.b64) body.promptImage = `data:${image.mime || 'image/jpeg'};base64,${image.b64}`;
  else if (image && image.url) body.promptImage = image.url;
  return { provider: 'runway', method: 'POST', url: RUNWAY_BASE + '/image_to_video', body };
}

// ── Rung executors — each returns { ok, provider, job_id, status, video_url?, error? }
//    or null-ish { ok:false, error } to demote to the next rung. ──────────────

async function runVeo(opts) {
  const k = keys();
  const reqSpec = veoRequest(opts);
  const r = await _fetchJson(reqSpec.url + '?key=' + encodeURIComponent(k.gemini), {
    method: 'POST', body: reqSpec.body,
  });
  if (!r.ok) return { ok: false, provider: 'veo', error: 'HTTP ' + r.status + ': ' + r.errText };
  const opName = r.data && r.data.name;
  if (!opName) return { ok: false, provider: 'veo', error: 'no operation name in response' };
  // Time-boxed sync wait: poll a couple of times, then hand back the job id.
  const deadline = Date.now() + SYNC_WAIT_MS - POLL_EVERY_MS;
  while (Date.now() < deadline) {
    await _sleep(POLL_EVERY_MS);
    const st = await statusVeo(opName);
    if (st.status === 'completed' || st.status === 'failed') return st;
  }
  return { ok: true, provider: 'veo', job_id: opName, status: 'processing' };
}

async function statusVeo(jobId) {
  const k = keys();
  if (!k.gemini) return _notConnected({ provider: 'veo', method: 'GET', url: GEMINI_BASE + '/' + jobId, body: undefined });
  const r = await _fetchJson(GEMINI_BASE + '/' + jobId + '?key=' + encodeURIComponent(k.gemini));
  if (!r.ok) return { ok: false, provider: 'veo', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + r.errText };
  const d = r.data || {};
  if (d.error) return { ok: false, provider: 'veo', job_id: jobId, status: 'failed', error: (d.error.message || JSON.stringify(d.error)).substring(0, 300) };
  if (!d.done) return { ok: true, provider: 'veo', job_id: jobId, status: 'processing' };
  const resp = d.response || {};
  const gen = resp.generateVideoResponse || resp;
  const sample = (gen.generatedSamples && gen.generatedSamples[0]) || (gen.generatedVideos && gen.generatedVideos[0]) || null;
  const uri = sample && ((sample.video && sample.video.uri) || sample.uri || sample.videoUri) || null;
  return { ok: true, provider: 'veo', job_id: jobId, status: 'completed', video_url: uri, model: VEO_MODEL };
}

async function runSora(opts) {
  const k = keys();
  const reqSpec = soraRequest(opts);
  const r = await _fetchJson(reqSpec.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + k.openai },
    body: reqSpec.body,
  });
  if (!r.ok) return { ok: false, provider: 'sora', error: 'HTTP ' + r.status + ': ' + r.errText };
  const id = r.data && r.data.id;
  if (!id) return { ok: false, provider: 'sora', error: 'no job id in response' };
  const deadline = Date.now() + SYNC_WAIT_MS - POLL_EVERY_MS;
  while (Date.now() < deadline) {
    await _sleep(POLL_EVERY_MS);
    const st = await statusSora(id);
    if (st.status === 'completed' || st.status === 'failed') return st;
  }
  return { ok: true, provider: 'sora', job_id: id, status: 'processing' };
}

async function statusSora(jobId) {
  const k = keys();
  if (!k.openai) return _notConnected({ provider: 'sora', method: 'GET', url: OPENAI_BASE + '/videos/' + jobId, body: undefined });
  const r = await _fetchJson(OPENAI_BASE + '/videos/' + encodeURIComponent(jobId), { headers: { Authorization: 'Bearer ' + k.openai } });
  if (!r.ok) return { ok: false, provider: 'sora', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + r.errText };
  const d = r.data || {};
  const raw = String(d.status || '').toLowerCase();
  if (raw === 'completed' || raw === 'succeeded') {
    // Binary is fetched from the content endpoint (requires the same bearer key).
    return { ok: true, provider: 'sora', job_id: jobId, status: 'completed', video_url: OPENAI_BASE + '/videos/' + jobId + '/content', model: SORA_MODEL };
  }
  if (raw === 'failed' || raw === 'cancelled') {
    return { ok: false, provider: 'sora', job_id: jobId, status: 'failed', error: (d.error && d.error.message) || raw };
  }
  return { ok: true, provider: 'sora', job_id: jobId, status: 'processing' };
}

function _higgsfieldHeaders(k) {
  return {
    'hf-api-key': k.higgsfield,
    ...(k.higgsfieldSecret ? { 'hf-secret': k.higgsfieldSecret } : {}),
  };
}

async function runHiggsfield(opts) {
  const k = keys();
  const reqSpec = higgsfieldRequest(opts);
  const r = await _fetchJson(reqSpec.url, { method: 'POST', headers: _higgsfieldHeaders(k), body: reqSpec.body });
  if (!r.ok) return { ok: false, provider: 'higgsfield', error: 'HTTP ' + r.status + ': ' + r.errText };
  const id = r.data && (r.data.id || r.data.job_id || (r.data.job_set && r.data.job_set.id));
  if (!id) return { ok: false, provider: 'higgsfield', error: 'no job id in response' };
  return { ok: true, provider: 'higgsfield', job_id: String(id), status: 'processing' };
}

async function statusHiggsfield(jobId) {
  const k = keys();
  if (!k.higgsfield) return _notConnected({ provider: 'higgsfield', method: 'GET', url: HIGGSFIELD_BASE + '/jobs/' + jobId, body: undefined });
  const r = await _fetchJson(HIGGSFIELD_BASE + '/jobs/' + encodeURIComponent(jobId), { headers: _higgsfieldHeaders(k) });
  if (!r.ok) return { ok: false, provider: 'higgsfield', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + r.errText };
  const d = r.data || {};
  const raw = String(d.status || d.state || '').toLowerCase();
  const url = (d.result && (d.result.url || d.result.video_url)) || d.video_url || null;
  if (raw === 'completed' || raw === 'succeeded' || url) return { ok: true, provider: 'higgsfield', job_id: jobId, status: 'completed', video_url: url };
  if (raw === 'failed' || raw === 'error') return { ok: false, provider: 'higgsfield', job_id: jobId, status: 'failed', error: d.error || raw };
  return { ok: true, provider: 'higgsfield', job_id: jobId, status: 'processing' };
}

// OpenMontage — generic async REST (bearer auth). Endpoint shape is
// env-overridable via OPENMONTAGE_BASE; on any auth/endpoint mismatch the rung
// simply demotes to the next provider, so it is safe to enable incrementally.
async function runOpenMontage(opts) {
  const k = keys();
  const reqSpec = openMontageRequest(opts);
  const r = await _fetchJson(reqSpec.url, {
    method: 'POST', headers: { Authorization: 'Bearer ' + k.openmontage }, body: reqSpec.body,
  });
  if (!r.ok) return { ok: false, provider: 'openmontage', error: 'HTTP ' + r.status + ': ' + r.errText };
  const id = r.data && (r.data.id || r.data.job_id || r.data.task_id);
  const url = r.data && (r.data.video_url || (r.data.result && r.data.result.video_url));
  if (url) return { ok: true, provider: 'openmontage', job_id: String(id || ''), status: 'completed', video_url: url };
  if (!id) return { ok: false, provider: 'openmontage', error: 'no job id in response' };
  return { ok: true, provider: 'openmontage', job_id: String(id), status: 'processing' };
}

async function statusOpenMontage(jobId) {
  const k = keys();
  if (!k.openmontage) return _notConnected({ provider: 'openmontage', method: 'GET', url: OPENMONTAGE_BASE + '/jobs/' + jobId, body: undefined });
  const r = await _fetchJson(OPENMONTAGE_BASE + '/jobs/' + encodeURIComponent(jobId), { headers: { Authorization: 'Bearer ' + k.openmontage } });
  if (!r.ok) return { ok: false, provider: 'openmontage', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + r.errText };
  const d = r.data || {};
  const raw = String(d.status || d.state || '').toLowerCase();
  const url = (d.result && (d.result.url || d.result.video_url)) || d.video_url || null;
  if (raw === 'completed' || raw === 'succeeded' || url) return { ok: true, provider: 'openmontage', job_id: jobId, status: 'completed', video_url: url };
  if (raw === 'failed' || raw === 'error') return { ok: false, provider: 'openmontage', job_id: jobId, status: 'failed', error: d.error || raw };
  return { ok: true, provider: 'openmontage', job_id: jobId, status: 'processing' };
}

async function runRunway(opts) {
  const k = keys();
  const reqSpec = runwayRequest(opts);
  const r = await _fetchJson(reqSpec.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + k.runway, 'X-Runway-Version': RUNWAY_VERSION },
    body: reqSpec.body,
  });
  if (!r.ok) return { ok: false, provider: 'runway', error: 'HTTP ' + r.status + ': ' + r.errText };
  const id = r.data && r.data.id;
  if (!id) return { ok: false, provider: 'runway', error: 'no task id in response' };
  return { ok: true, provider: 'runway', job_id: String(id), status: 'processing' };
}

async function statusRunway(jobId) {
  const k = keys();
  if (!k.runway) return _notConnected({ provider: 'runway', method: 'GET', url: RUNWAY_BASE + '/tasks/' + jobId, body: undefined });
  const r = await _fetchJson(RUNWAY_BASE + '/tasks/' + encodeURIComponent(jobId), {
    headers: { Authorization: 'Bearer ' + k.runway, 'X-Runway-Version': RUNWAY_VERSION },
  });
  if (!r.ok) return { ok: false, provider: 'runway', job_id: jobId, status: 'unknown', error: 'HTTP ' + r.status + ': ' + r.errText };
  const d = r.data || {};
  const raw = String(d.status || '').toUpperCase();
  if (raw === 'SUCCEEDED') return { ok: true, provider: 'runway', job_id: jobId, status: 'completed', video_url: (Array.isArray(d.output) && d.output[0]) || null, model: RUNWAY_MODEL };
  if (raw === 'FAILED' || raw === 'CANCELLED') return { ok: false, provider: 'runway', job_id: jobId, status: 'failed', error: d.failure || d.failureCode || raw };
  return { ok: true, provider: 'runway', job_id: jobId, status: 'processing' };
}

function _notConnected(wouldRequest) {
  return {
    ok: false, connected: false, not_connected: true,
    would_request: wouldRequest,
    hint: 'Set GEMINI_API_KEY (Veo 3.1), OPENAI_API_KEY (Sora 2), HIGGSFIELD_API_KEY, OPENMONTAGE_API_KEY, or RUNWAY_API_KEY in Vercel env to execute this for real. The request shape above is what will be sent.',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * generateVideo({ prompt, duration_s?, aspect?, tier?, audio? })
 * Cascades Veo 3.1 → Sora 2 → Higgsfield → Runway; skips rungs without keys.
 * With NO keys at all, returns the Klaviyo-style { connected:false, would_request }
 * stub for the best rung (Veo 3.1).
 *
 * `audio` is the soundtrack direction in prose, e.g. 'Music: sparse, warm strings,
 * no percussion. Natural kettle and pour foley.' Omit it and the clip is silent by
 * design. The result carries `audio_requested` and `audio_supported` — the second
 * is false when the winning rung has no audio track (Runway), so a caller can say
 * the clip is silent instead of assuming the direction was honoured.
 */
async function generateVideo({ prompt, duration_s = 8, aspect = '16:9', tier = 'standard', preferProviders = null, image_url = null, audio = null } = {}) {
  const p = String(prompt || '').trim();
  if (!p) return { ok: false, error: 'prompt required' };
  const audioDirection = String(audio || '').trim() || null;
  // Fetch the init frame ONCE here rather than per rung, so a cascade demotion
  // does not re-download it. A failed fetch is not fatal: the clip degrades to
  // text-to-video, and the caller is told via `image_used` so it can decline to
  // ship a product video whose packaging was not sourced from a real photo.
  let image = null;
  if (image_url) image = await _fetchImageB64(image_url);
  const opts = { prompt: p, duration_s, aspect, image, audio: audioDirection };
  const k = keys();

  if (!anyKey()) {
    // Best rung's exact request shape — honour the caller's first preference.
    const first = (preferProviders && preferProviders[0]) || 'veo';
    const shape = { higgsfield: higgsfieldRequest, openmontage: openMontageRequest, sora: soraRequest, runway: runwayRequest, veo: veoRequest }[first] || veoRequest;
    return _notConnected(shape(opts));
  }

  // Sora sits LAST despite being the strongest OpenAI rung: OpenAI notified
  // deprecation of the Videos API on 2026-03-24 and removes it on 2026-09-24, so
  // it is a rung with a published expiry date. Ahead of that it also cannot do
  // the image-to-video pass the product photography rule requires. Veo 3.1 is the
  // primary for both reasons. Leaving Sora in place means an existing key still
  // works until the endpoint goes, and the cascade demotes past it when it does.
  let rungs = [
    { name: 'veo', hasKey: !!k.gemini, run: runVeo },
    { name: 'higgsfield', hasKey: !!k.higgsfield, run: runHiggsfield },
    { name: 'runway', hasKey: !!k.runway, run: runRunway },
    { name: 'openmontage', hasKey: !!k.openmontage, run: runOpenMontage },
    { name: 'sora', hasKey: !!k.openai, run: runSora },
  ];

  // Caller can reorder the cascade (e.g. the mailer asset agent pins
  // Higgsfield + OpenMontage first per the lifecycle-OS video policy).
  if (Array.isArray(preferProviders) && preferProviders.length) {
    const rank = (n) => { const i = preferProviders.indexOf(n); return i === -1 ? 99 : i; };
    rungs = rungs.slice().sort((a, b) => rank(a.name) - rank(b.name));
  }

  const attempts = [];
  for (const rung of rungs) {
    if (!rung.hasKey) { attempts.push({ provider: rung.name, skipped: 'no key' }); continue; }
    console.log('[video] Trying ' + rung.name + ' (tier=' + tier + ')');
    try {
      const out = await rung.run(opts);
      // image_used tells the caller whether the real pack shot actually made it
      // into the clip. Without it a silently-degraded text-to-video job would be
      // indistinguishable from a real one, and its invented packaging would ship.
      if (out && out.ok) {
        // audio_supported is a property of the rung that actually WON, not of the
        // request — a demotion to Runway silently drops the soundtrack, and saying
        // so here is what stops "music requested" being read as "music present".
        const audioSupported = AUDIO_CAPABLE[rung.name] !== false;
        if (audioDirection && !audioSupported) {
          console.warn('[video] ' + rung.name + ' has no audio track — clip will be SILENT despite an audio direction');
        }
        return {
          ...out, tier, attempts,
          image_used: !!(image && image.b64), init_image_url: image ? image.url : null,
          audio_requested: !!audioDirection,
          audio_supported: audioSupported,
          audio_note: audioDirection && !audioSupported
            ? rung.name + ' renders no audio track; this clip is silent. Re-run pinned to an audio-capable provider (veo, sora, higgsfield, openmontage) for a soundtrack.'
            : null,
        };
      }
      attempts.push({ provider: rung.name, error: (out && out.error) || 'unknown failure' });
      console.warn('[video] ' + rung.name + ' failed: ' + ((out && out.error) || 'unknown') + ' — demoting');
    } catch (e) {
      attempts.push({ provider: rung.name, error: String(e.message || e).substring(0, 200) });
      console.warn('[video] ' + rung.name + ' exception — demoting: ' + String(e.message || e).substring(0, 200));
    }
  }
  return { ok: false, error: 'All video providers failed', attempts, tier };
}

/**
 * getVideoStatus({ provider, job_id }) — poll a job started by generateVideo.
 * status: 'processing' | 'completed' | 'failed' | 'unknown'.
 */
async function getVideoStatus({ provider, job_id } = {}) {
  const prov = String(provider || '').toLowerCase().trim();
  const id = String(job_id || '').trim();
  if (!id) return { ok: false, error: 'job_id required' };
  switch (prov) {
    case 'veo': case 'gemini': return statusVeo(id);
    case 'sora': case 'openai': return statusSora(id);
    case 'higgsfield': return statusHiggsfield(id);
    case 'openmontage': return statusOpenMontage(id);
    case 'runway': return statusRunway(id);
    default:
      return { ok: false, error: "Unknown video provider '" + provider + "'", available: ['veo', 'sora', 'higgsfield', 'openmontage', 'runway'] };
  }
}

function isConnected() { return anyKey(); }

module.exports = { generateVideo, getVideoStatus, isConnected };
