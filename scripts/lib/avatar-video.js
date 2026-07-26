// Audio-driven AVATAR video (talking-head / UGC-style) briefs for the open
// source LongCat-Video-Avatar-1.5 (Meituan, MIT license).
//
// WHY A BRIEF GENERATOR AND NOT AN API CALL
// LongCat is a self-hosted diffusion model run from its own repo (not
// diffusers, no hosted endpoint): it needs a GPU host and `torchrun`. This app
// runs on Vercel serverless, which has no GPU — so the honest integration is to
// generate a RUN-READY brief + exact command here, execute it on a GPU box (or
// a Modal/RunPod/Colab job), and feed the resulting MP4 back into the creative
// pipeline. api/_shared/video-core.js keeps owning the hosted cascade (Veo,
// Sora, Higgsfield, Runway); this module covers the one thing those do less
// well and this does natively: lip-synced spokesperson video from one still
// plus an audio track.
//
// MODEL FACTS (from the model card — do not embellish):
//   • modes: AT2V (audio+text), ATI2V (audio+text+reference image),
//     video continuation, multi-person / dual-audio
//   • "Longer, more descriptive prompts yield better consistency"
//   • length comes from segmentation (num_segments), not a duration flag
//   • --use_int8 loads the INT8 DiT (lower VRAM); --use_distill = fewer steps
//     (8-step serving), faster
//   • evaluated on Chinese and English only
//   • MIT licensed
//
// HARD GUARDRAILS (enforced by validateAvatarSpec):
//   • Likeness consent: the reference image must be a creator/model who has
//     signed off on synthetic-video use. Never generate a talking avatar of a
//     real person (customer, founder, celebrity, reviewer) without it.
//   • No fabricated endorsement: the script may only say what that person
//     actually agreed to say. No invented testimonials, no invented claims.
//   • Language: EN (or ZH) only. Hindi/Tamil/Telugu/Kannada/Malayalam are NOT
//     evaluated for this model — an Indic-language spokesperson ad needs a
//     different TTS/lip-sync path, flagged rather than silently attempted.
//   • Brand copy still passes the banned-phrase / no-em-dash scrub upstream.

'use strict';

const REPO = 'https://huggingface.co/meituan-longcat/LongCat-Video-Avatar-1.5';

// POSIX shell quoting for values interpolated into the generated command.
// Single quotes are literal in every POSIX shell, so nothing inside needs
// escaping except a single quote itself — which also means backslashes,
// double quotes, $, backticks and newlines are all safe. (Escaping only `"`
// inside a double-quoted string was incomplete: a backslash in the prompt
// would break or alter the command. CodeQL flagged exactly that.)
function shq(value) {
  return `'${String(value == null ? '' : value).replace(/'/g, "'\\''")}'`;
}
const SUPPORTED_LANGS = ['en', 'english', 'zh', 'chinese'];
// The model card describes examples at num_segments=5; segments are the length
// dial, so we derive a count from the target duration and state the assumption.
const SECONDS_PER_SEGMENT = 3;

function validateAvatarSpec(spec) {
  const s = spec || {};
  const errors = [];
  if (!s.script || !String(s.script).trim()) errors.push('script is required (what the avatar says)');
  if (!s.audio && !s.tts_note) {
    errors.push('audio is required: either an audio file path (audio) or a note on how it will be produced (tts_note) - LongCat is audio-driven, it does not synthesize speech');
  }
  if (s.consent !== true) {
    errors.push('consent must be explicitly true: the reference likeness must be a creator/model who agreed to synthetic-video use. Never generate a talking avatar of a real person without it');
  }
  const lang = String(s.language || 'en').toLowerCase();
  if (!SUPPORTED_LANGS.includes(lang)) {
    errors.push(`language "${s.language}" is outside this model's evaluated set (English, Chinese). Use a different lip-sync/TTS path for Indic languages rather than shipping unevaluated output`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Build a run-ready LongCat avatar brief.
 *
 * spec: {
 *   product, script, audio, tts_note, reference_image, consent (must be true),
 *   language, seconds, aspect ('9:16'|'1:1'|'16:9'), wardrobe, setting,
 *   camera, second_speaker, gpus, low_vram, fast
 * }
 * Returns { ok, mode, prompt, command, params, guardrails, errors }
 */
function avatarBrief(spec) {
  const s = spec || {};
  const v = validateAvatarSpec(s);
  if (!v.ok) return { ok: false, errors: v.errors, model: REPO };

  const seconds = Math.max(3, Math.min(30, Number(s.seconds) || 12));
  const segments = Math.max(1, Math.round(seconds / SECONDS_PER_SEGMENT));
  const aspect = s.aspect || '9:16';
  const hasRef = !!s.reference_image;
  const mode = s.second_speaker ? 'ATI2V (multi-person, dual audio)'
    : hasRef ? 'ATI2V (audio + text + reference image)'
      : 'AT2V (audio + text)';

  // Descriptive prompt: the model card is explicit that longer, richer prompts
  // hold identity better across segments, so describe subject, wardrobe,
  // setting, light, camera and motion - and forbid on-frame text/logos, which
  // diffusion models render as garbled letterforms.
  const prompt = [
    `A ${s.subject || 'warm, natural spokesperson'} speaking directly to camera about ${s.product || 'a premium loose-leaf tea'}.`,
    s.wardrobe ? `Wardrobe: ${s.wardrobe}.` : 'Wardrobe: simple, uncluttered, muted natural tones.',
    s.setting ? `Setting: ${s.setting}.` : 'Setting: a calm kitchen or sunlit table with a brewed cup in soft focus.',
    'Lighting: soft directional daylight, gentle falloff, filmic grade, no harsh specular highlights.',
    s.camera ? `Camera: ${s.camera}.` : `Camera: locked-off medium close-up, ${aspect} framing, shallow depth of field.`,
    'Delivery: relaxed, unhurried, natural micro-expressions and blinks; lips accurately synced to the supplied audio; head and shoulders stay stable across the whole take with consistent identity, hair and wardrobe.',
    'Do NOT render any on-screen text, captions, logos, watermarks or UI. Packaging, if visible, shows artwork only with no readable lettering.',
  ].join(' ');

  const args = [
    'torchrun', `--nproc_per_node=${Math.max(1, Number(s.gpus) || 2)}`, 'run_inference.py',
    `--prompt ${shq(prompt)}`,
    `--audio ${shq(s.audio || '<path to the voice track>')}`,
    hasRef ? `--image ${shq(s.reference_image)}` : null,
    s.second_speaker && s.second_speaker.audio ? `--audio2 ${shq(s.second_speaker.audio)}` : null,
    `--num_segments ${segments}`,
    s.low_vram === false ? null : '--use_int8',
    s.fast === false ? null : '--use_distill',
  ].filter(Boolean);

  return {
    ok: true,
    model: REPO,
    license: 'MIT',
    mode,
    prompt,
    command: args.join(' \\\n  '),
    params: {
      num_segments: segments,
      seconds_target: seconds,
      seconds_per_segment_assumed: SECONDS_PER_SEGMENT,
      aspect,
      language: String(s.language || 'en').toLowerCase(),
      int8: s.low_vram !== false,
      distill: s.fast !== false,
      gpus: Math.max(1, Number(s.gpus) || 2),
    },
    audio: s.audio || null,
    tts_note: s.audio ? null : (s.tts_note || null),
    script: String(s.script).trim(),
    guardrails: [
      'Likeness is consented (spec.consent === true) - keep the signed release with the asset.',
      'The script says only what the person agreed to say: no invented testimonial, rating or claim.',
      'Evaluated languages are English and Chinese only; anything else needs a different lip-sync path.',
      'No on-frame text/logos from the model - add captions and brand marks in the edit, where they render cleanly.',
      'Runs on a GPU host (torchrun), never inside the Vercel functions.',
    ],
    next_steps: [
      'Run the command on a GPU host (or a Modal/RunPod job) with the LongCat repo + weights.',
      'Bring the MP4 back and finish it in the motion pipeline: captions and CTA card via scripts/lib/motion-ad.js.',
      'Hosted alternatives for non-avatar shots stay in api/_shared/video-core.js (Veo, Sora, Higgsfield, Runway).',
    ],
  };
}

module.exports = { avatarBrief, validateAvatarSpec, REPO, SUPPORTED_LANGS };
