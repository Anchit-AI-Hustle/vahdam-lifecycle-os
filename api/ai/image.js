// ════════════════════════════════════════════════════════════════════════════
// /api/ai/image — Vercel serverless function
// Server-side image generation with multi-provider cascade.
// Returns base64 data URL (browser embeds directly into <img src=...>).
//
// Provider cascade:
//   1. Gemini Imagen 4 (primary) → Imagen 4 Ultra → Imagen 4 Fast
//   2. OpenAI gpt-image-2 → gpt-image-1 (fallback)
//   3. Pollinations FLUX (free, unlimited, last resort)
//
// POST body:
//   { prompt: string, size?: '1024x1024'|'1536x1024'|'1024x1536',
//     quality?: 'low'|'medium'|'high'|'auto', mode?: 'design'|'',
//     tier?: 'budget'|'maxpower' }   // maxpower brings Gemini native/Imagen into the cascade first
//
// Env vars:
//   GEMINI_API_KEY         — Google AI / Gemini key (primary)
//   OPENAI_API_KEY         — OpenAI key (fallback)
//   OPENAI_API_KEY_2       — second OpenAI key (optional)
//   OPENAI_API_KEY_3       — third OpenAI key (optional)
// ════════════════════════════════════════════════════════════════════════════

const { brandPlaceholderDataUri } = require('../_shared/brand-placeholder.js');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENAI_BASE = 'https://api.openai.com/v1';

const IMAGE_PROMPT_PREAMBLE = `Photoreal product lifestyle photograph for VAHDAM India premium tea brand. Pure photography — NO text, NO logos, NO UI elements, NO email layout, NO mockup, NO watermarks, NO design frames. VAHDAM packaging tin where present: deep forest-green, warm cream, terracotta, or pink/magenta depending on SKU, with a gold botanical illustration only — the label carries NO lettering, NO brand name, NO readable words or numbers (never render garbled or fake text on the packaging; keep label typography out of frame, softly out of focus, or angled away). Gallery-print resolution, zero AI smear artifacts.

Scene:
`;

const DESIGN_PROMPT_PREAMBLE = `High-fidelity flat graphic design mockup of a complete marketing email for VAHDAM India premium tea brand. This is a DESIGN LAYOUT showing the full email as it would appear in an inbox — NOT a photograph. Polished marketing creative, magazine-quality email design. Deep forest-green (#004A2B) header, ivory/cream (#FBF5EA) body background, warm gold (#AB8743) CTA buttons and accents. Elegant serif typography for headlines, clean sans-serif for body text. Professional email marketing aesthetic.

Design:
`;

// Paid-social ad creative: a FINISHED ad, with the headline + offer text BAKED
// INTO the image (server-generated Smart Brain creatives have no client-side
// canvas step, so the text must be rendered here). Used when mode === 'ad'.
const AD_PROMPT_PREAMBLE = `Scroll-stopping paid social ad creative for VAHDAM India premium tea brand — a photoreal lifestyle scene WITH a clean marketing text overlay rendered as part of the image (a finished ad, NOT a bare photo). Render the supplied headline and offer line as crisp, correctly-spelled, perfectly-legible on-brand typography in a clear safe-zone band: elegant serif headline, clean sans-serif offer, on the VAHDAM palette — deep forest-green #004A2B, gold #AB8743, cream #FBF5EA. The emotional end-state (calm, steady energy, "feeling like myself again") leads; never an ingredient list. NO garbled or fake letterforms, NO logos, NO watermarks, NO inbox/UI chrome; product packaging shows a botanical illustration only with NO readable lettering. Gallery-print resolution.

Ad creative:
`;

// Map our standard sizes to Gemini aspect ratios.
// Includes the ad-creative sizes (Google 1.91:1 + 1:1, Meta/IG/TikTok 1:1 + 9:16).
const GEMINI_ASPECT_MAP = {
  '1024x1024': '1:1',
  '1024x1536': '3:4',    // portrait (closest to 2:3)
  '1536x1024': '4:3',    // landscape
  '1080x1080': '1:1',    // Meta/IG feed
  '1080x1920': '9:16',   // story / reel / TikTok vertical
  '1200x1200': '1:1',    // Google square
  '1200x628': '16:9'     // Google landscape (closest aspect)
};

// OpenAI gpt-image only accepts a fixed set of sizes — map every requested
// (incl. ad-creative) size to the nearest supported one. The text overlay is
// composited on the client canvas afterwards, so exact pixels here are not
// critical; aspect orientation is what matters.
const OPENAI_SIZE_MAP = {
  '1024x1024': '1024x1024',
  '1024x1536': '1024x1536',
  '1536x1024': '1536x1024',
  '1080x1080': '1024x1024',  // square
  '1200x1200': '1024x1024',  // square
  '1080x1920': '1024x1536',  // vertical
  '1200x628': '1536x1024'    // landscape
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { return res.status(400).json({ error: 'invalid_json_body' }); }
  }
  body = body || {};
  const userPrompt = (body.prompt || '').toString().trim();
  if (!userPrompt) return res.status(400).json({ error: 'missing_prompt' });
  const size = body.size || '1024x1536';
  const quality = body.quality || 'high';
  const validSizes = ['1024x1024', '1536x1024', '1024x1536', '1080x1080', '1080x1920', '1200x1200', '1200x628'];
  const validQualities = ['low', 'medium', 'high', 'auto'];
  if (validSizes.indexOf(size) < 0) return res.status(400).json({ error: 'invalid_size', allowed: validSizes });
  if (validQualities.indexOf(quality) < 0) return res.status(400).json({ error: 'invalid_quality', allowed: validQualities });

  const mode = (body.mode || '').toString().trim();
  // Tier dial: 'maxpower' brings the highest-quality image provider (Gemini native → Imagen)
  // into the cascade first; 'budget' (default) keeps current behavior (Gemini OFF unless IMAGE_ENABLE_GEMINI=1).
  const _tier = (body.tier || process.env.APP_AI_TIER || 'budget').toString().toLowerCase().trim();
  const isMaxPower = _tier === 'maxpower' || _tier === 'max-power' || _tier === 'max' || _tier === 'output' || _tier === 'quality';
  const preamble = (mode === 'design') ? DESIGN_PROMPT_PREAMBLE
    : (mode === 'ad') ? AD_PROMPT_PREAMBLE
    : IMAGE_PROMPT_PREAMBLE;
  // Always close with an explicit create instruction so the model treats the
  // text as a generation command, not a description. (Reserve room for it.)
  const finalPrompt = (preamble + userPrompt).substring(0, 3950) + '\n\nNow generate this image exactly as specified above.';

  // ═══════════════════════════════════════════════════════════════════════════
  // PROVIDER 1: Gemini Image Generation (primary)
  // Two approaches:
  //   A) Native generateContent models (gemini-2.5-flash-image, gemini-3-pro-image-preview, etc.)
  //   B) Imagen predict models (imagen-4.0-generate-001, etc.) — requires paid plan
  // ═══════════════════════════════════════════════════════════════════════════
  const geminiKey = process.env.GEMINI_API_KEY;
  // Gemini image models (gemini-2.5-flash-image, Imagen) require a billing-enabled
  // key. They're OFF by default so OpenAI gpt-image is the effective primary;
  // set IMAGE_ENABLE_GEMINI=1 — OR pass tier:'maxpower' — to bring Gemini into the cascade (tried first).
  if (geminiKey && (isMaxPower || process.env.IMAGE_ENABLE_GEMINI === '1')) {

    // ── A) Native Gemini image generation via generateContent ──
    const nativeModels = [
      'gemini-2.5-flash-image',
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview'
    ];

    for (let mi = 0; mi < nativeModels.length; mi++) {
      const model = nativeModels[mi];
      const endpoint = GEMINI_BASE + '/' + model + ':generateContent?key=' + geminiKey;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);

      console.log('[image] Trying Gemini native model=' + model);

      try {
        const fetchRes = await fetch(endpoint, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Generate an image based on this description:\n\n' + finalPrompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!fetchRes.ok) {
          const errText = await fetchRes.text().catch(() => '');
          console.warn('[image] Gemini ' + model + ' → HTTP ' + fetchRes.status, errText.substring(0, 300));
          continue;
        }

        const data = await fetchRes.json();
        const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        if (!parts) { console.warn('[image] Gemini ' + model + ' — no parts in response'); continue; }

        // Find the image part in the response
        const imgPart = parts.find(p => p.inlineData && p.inlineData.data);
        if (!imgPart) { console.warn('[image] Gemini ' + model + ' — no image part returned'); continue; }

        const mimeType = imgPart.inlineData.mimeType || 'image/png';
        const dataUrl = 'data:' + mimeType + ';base64,' + imgPart.inlineData.data;

        console.log('[image] Success · Gemini native ' + model);
        return res.status(200).json({
          ok: true,
          provider: 'gemini',
          model: model,
          size, quality,
          image_data_url: dataUrl
        });

      } catch (e) {
        clearTimeout(timeout);
        console.error('[image] Gemini ' + model + ' exception:', String(e.message || e).substring(0, 200));
        continue;
      }
    }

    // ── B) Imagen predict API (paid plans only) ──
    const imagenModels = [
      'imagen-4.0-generate-001',
      'imagen-4.0-fast-generate-001'
    ];
    const aspectRatio = GEMINI_ASPECT_MAP[size] || '3:4';

    for (let mi = 0; mi < imagenModels.length; mi++) {
      const model = imagenModels[mi];
      const endpoint = GEMINI_BASE + '/' + model + ':predict';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);

      console.log('[image] Trying Gemini Imagen model=' + model + ' aspect=' + aspectRatio);

      try {
        const fetchRes = await fetch(endpoint, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
          body: JSON.stringify({
            instances: [{ prompt: finalPrompt }],
            parameters: { sampleCount: 1, aspectRatio: aspectRatio, personGeneration: 'allow_adult' }
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!fetchRes.ok) {
          const errText = await fetchRes.text().catch(() => '');
          console.warn('[image] Gemini Imagen ' + model + ' → HTTP ' + fetchRes.status, errText.substring(0, 300));
          continue;
        }

        const data = await fetchRes.json();
        const prediction = data.predictions && data.predictions[0];
        if (!prediction || !prediction.bytesBase64Encoded) { continue; }

        const mimeType = prediction.mimeType || 'image/png';
        const dataUrl = 'data:' + mimeType + ';base64,' + prediction.bytesBase64Encoded;

        console.log('[image] Success · Gemini Imagen ' + model);
        return res.status(200).json({
          ok: true, provider: 'gemini', model: model, size, quality,
          image_data_url: dataUrl
        });

      } catch (e) {
        clearTimeout(timeout);
        console.error('[image] Gemini Imagen ' + model + ' exception:', String(e.message || e).substring(0, 200));
        continue;
      }
    }

    console.warn('[image] All Gemini models failed — falling back to OpenAI');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROVIDER 2: OpenAI (fallback)
  // ═══════════════════════════════════════════════════════════════════════════
  const openaiKeys = [
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_API_KEY_2,
    process.env.OPENAI_API_KEY_3
  ].filter(Boolean);

  // gpt-image-1 is the real OpenAI image model (requires a verified org + credits).
  // OPENAI_IMAGE_MODEL can override. The bogus 'gpt-image-2' default was removed —
  // it always 404'd and wasted an attempt.
  const imageModels = [...new Set([
    process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    'gpt-image-1'
  ])];

  if (openaiKeys.length > 0) {
    let allQuotaExhausted = false;

    for (let mi = 0; mi < imageModels.length; mi++) {
      const imageModel = imageModels[mi];
      let modelUnavailable = false;
      let exhaustedCount = 0;

      for (let ki = 0; ki < openaiKeys.length; ki++) {
        const key = openaiKeys[ki];
        const keySuffix = '...' + key.slice(-4);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);

        console.log('[image] Trying OpenAI model=' + imageModel + ' key #' + (ki + 1) + ' (' + keySuffix + ') size=' + size);

        try {
          const fetchRes = await fetch(OPENAI_BASE + '/images/generations', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({ model: imageModel, prompt: finalPrompt, n: 1, size: (OPENAI_SIZE_MAP[size] || '1024x1024'), quality, output_format: 'png' }),
            signal: controller.signal
          });
          clearTimeout(timeout);

          if (!fetchRes.ok) {
            const errText = await fetchRes.text().catch(() => '');
            console.warn('[image] OpenAI ' + imageModel + ' key #' + (ki + 1) + ' → HTTP ' + fetchRes.status, errText.substring(0, 200));

            const isQuota = (fetchRes.status === 429 || fetchRes.status === 402 || fetchRes.status === 400) &&
              (errText.includes('insufficient_quota') || errText.includes('quota') || errText.includes('billing') || errText.includes('credit') || errText.includes('billing_hard_limit') || errText.includes('billing_limit'));
            if (isQuota && ki < openaiKeys.length - 1) {
              exhaustedCount++;
              continue;
            }
            if (isQuota) {
              exhaustedCount++;
              allQuotaExhausted = (exhaustedCount === openaiKeys.length);
              break;
            }

            const isModelError = fetchRes.status === 404 ||
              errText.includes('model_not_found') || errText.includes('does not exist') || errText.includes('not supported') ||
              (fetchRes.status === 400 && errText.includes(imageModel));
            if (isModelError) { modelUnavailable = true; break; }
            if (mi < imageModels.length - 1) { modelUnavailable = true; break; }
            // Last model, last key — fall through to Pollinations
            break;
          }

          const data = await fetchRes.json();
          const imgEntry = data.data && data.data[0];
          if (!imgEntry) { break; }

          let dataUrl = '';
          if (imgEntry.b64_json) {
            dataUrl = 'data:image/png;base64,' + imgEntry.b64_json;
          } else if (imgEntry.url) {
            try {
              const imgFetch = await fetch(imgEntry.url);
              const buf = await imgFetch.arrayBuffer();
              dataUrl = 'data:image/png;base64,' + Buffer.from(buf).toString('base64');
            } catch (e) { break; }
          } else { break; }

          console.log('[image] Success · OpenAI ' + imageModel + ' key #' + (ki + 1) + ' size=' + size);
          return res.status(200).json({
            ok: true, provider: 'openai', model: imageModel, size, quality,
            image_data_url: dataUrl, key_index: ki + 1
          });

        } catch (e) {
          clearTimeout(timeout);
          console.error('[image] OpenAI ' + imageModel + ' key #' + (ki + 1) + ' exception:', String(e.message || e).substring(0, 200));
          if (mi < imageModels.length - 1) { modelUnavailable = true; break; }
          break;
        }
      }
      if (!modelUnavailable && !allQuotaExhausted) {
        if (mi === imageModels.length - 1) break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROVIDER 3: Pollinations (free, no auth — multiple model cascade)
  // Models tried in quality order:
  //   flux-pro (best quality) → flux-realism (photorealistic) → flux (standard)
  // ═══════════════════════════════════════════════════════════════════════════
  const hadKeys = !!(geminiKey || openaiKeys.length > 0);
  if (hadKeys) {
    console.warn('[image] All paid providers failed — using Pollinations free fallback');
  }

  const sizeMap = {
    '1024x1024': { w: 1024, h: 1024 },
    '1024x1536': { w: 1024, h: 1536 },
    '1536x1024': { w: 1536, h: 1024 },
    '1080x1080': { w: 1080, h: 1080 },
    '1080x1920': { w: 1080, h: 1920 },
    '1200x1200': { w: 1200, h: 1200 },
    '1200x628':  { w: 1200, h: 628 }
  };
  const dim = sizeMap[size] || sizeMap['1024x1536'];
  const seed = Math.floor(Math.random() * 1000000);

  // Try multiple Pollinations models in quality order
  const pollinationsModels = ['flux-pro', 'flux-realism', 'flux'];

  for (let pi = 0; pi < pollinationsModels.length; pi++) {
    const pollinationsModel = pollinationsModels[pi];
    const pollUrl = 'https://image.pollinations.ai/prompt/' +
      encodeURIComponent(finalPrompt.substring(0, 1500)) +
      '?width=' + dim.w + '&height=' + dim.h +
      '&seed=' + seed + '&nologo=true&model=' + pollinationsModel + '&enhance=true&quality=hd';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    console.log('[image] Trying Pollinations model=' + pollinationsModel + ' size=' + dim.w + 'x' + dim.h);

    try {
      const imgFetch = await fetch(pollUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!imgFetch.ok) {
        console.warn('[image] Pollinations ' + pollinationsModel + ' → HTTP ' + imgFetch.status);
        continue; // Try next model
      }

      const buf = await imgFetch.arrayBuffer();
      // Validate we got actual image data (not an error page)
      if (buf.byteLength < 5000) {
        console.warn('[image] Pollinations ' + pollinationsModel + ' — response too small (' + buf.byteLength + ' bytes), skipping');
        continue;
      }

      const contentType = imgFetch.headers.get('content-type') || 'image/jpeg';
      const dataUrl = 'data:' + contentType + ';base64,' + Buffer.from(buf).toString('base64');

      console.log('[image] Success · Pollinations ' + pollinationsModel + ' (' + Math.round(buf.byteLength / 1024) + ' KB)');
      return res.status(200).json({
        ok: true, provider: 'pollinations', model: pollinationsModel, size, quality,
        image_data_url: dataUrl,
        quota_warning: hadKeys,
        quota_note: hadKeys
          ? 'All paid image providers exhausted. Using Pollinations ' + pollinationsModel + ' (free). Check Gemini/OpenAI API credits.'
          : null
      });
    } catch (e) {
      clearTimeout(timeout);
      console.error('[image] Pollinations ' + pollinationsModel + ' exception:', String(e.message || e).substring(0, 200));
      continue; // Try next model
    }
  }

  // All providers failed. Pollinations is now paywalled (HTTP 402) so it no
  // longer works as a free fallback — a working OpenAI (gpt-image-1) key with
  // a verified org + credits is the supported path.
  const noKeys = !(openaiKeys && openaiKeys.length);
  // Every provider failed. Do NOT 502 — a non-200 leaves the caller with a
  // broken/empty <img>. Instead return 200 with an on-brand placeholder data
  // URI so the mailer / ad / landing page always renders an intentional brand
  // panel (never a broken tile). `placeholder:true` lets callers flag it.
  console.warn('[image] All providers failed — returning on-brand placeholder');
  return res.status(200).json({
    ok: true, provider: 'placeholder', placeholder: true, size, quality,
    image_data_url: brandPlaceholderDataUri(size),
    quota_warning: hadKeys,
    detail: noKeys
      ? 'No OpenAI image key configured. Add OPENAI_API_KEY (verified org + image credits) in Vercel. Showing brand placeholder.'
      : 'OpenAI gpt-image-1 failed — usually the org is not verified for image generation or has no image credits. Verify at platform.openai.com → Settings → Organization, then add credits. Showing brand placeholder. (Pollinations free fallback is now paywalled.)'
  });
};
