// PLAYABLE ADS — interactive, self-contained HTML5 ad units for Meta, TikTok,
// Google/AppLovin (MRAID) and Unity, plus the video variant of the same unit.
//
// A playable is NOT a video with a button. Platform requirements that actually
// get creatives rejected, and which this generator enforces:
//   • ONE self-contained .html file. Every asset inlined (data: URI). NO
//     external requests — reviewers test with the network cut, and a remote
//     font/image/video means rejection.
//   • Size budget: Meta 2MB, TikTok 2MB, Google 5MB (we validate against the
//     tightest target chosen).
//   • Interaction has to start fast (first tap possible within ~2s) and the unit
//     must be playable in portrait AND landscape.
//   • The CTA must call the HOST's own click API, not window.open:
//       Meta      FbPlayableAd.onCTAClick()
//       TikTok    window.openAppStore() / playableSDK.openAppStore()
//       MRAID     mraid.open(url)  (Google, AppLovin, ironSource)
//       Unity     window.mraid ? mraid.open : parent.postMessage
//     We emit a dispatcher that calls whichever exists, so one file works
//     across networks, with a plain-link fallback for self-hosted preview.
//   • No autoplaying sound (muted by default; sound only after a tap).
//
// Two builders:
//   renderPlayable(spec)      → the interactive unit (tap-to-build a cup, then
//                               the offer + CTA). Works with zero images.
//   renderPlayableVideo(spec) → same shell but the stage is an inlined muted
//                               autoplay video with an interactive end card.
//
// Brand: only #004A2B / #AB8743 / #171717 / #FBF5EA; Lao MN + Proxima Nova
// stacks; caller passes copy already scrubbed of banned phrases and em dashes.

'use strict';

const PALETTE = { green: '#004A2B', gold: '#AB8743', ink: '#171717', cream: '#FBF5EA' };
const SIZE_LIMIT_MB = { meta: 2, tiktok: 2, google: 5, applovin: 5, unity: 5 };

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// JSON-in-<script> safety: prevent an early </script> or HTML-comment sequence
// inside injected copy from terminating the block.
const js = (v) => JSON.stringify(v == null ? null : v)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function assertInlineOnly(spec, out) {
  // Any http(s) asset breaks the offline-review rule; fail loudly at build time
  // rather than shipping a creative that gets rejected.
  const remote = [];
  const check = (v, where) => {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) remote.push(`${where}: ${v}`);
  };
  check(spec.video, 'video');
  check(spec.poster, 'poster');
  (spec.ingredients || []).forEach((i, n) => check(i && i.image, `ingredients[${n}].image`));
  if (remote.length) {
    throw new Error('playable-ad: assets must be inlined as data: URIs (no external requests are '
      + 'allowed in a playable; reviewers test offline). Remote: ' + remote.join(' | '));
  }
  const mb = Buffer.byteLength(out, 'utf8') / (1024 * 1024);
  const cap = SIZE_LIMIT_MB[String(spec.network || 'meta').toLowerCase()] || 2;
  return { mb: Math.round(mb * 100) / 100, cap, within: mb <= cap };
}

// One CTA dispatcher for every network + a preview fallback.
const CTA_JS = `
function vahdamCTA(url){
  try{
    if (window.FbPlayableAd && FbPlayableAd.onCTAClick) return FbPlayableAd.onCTAClick();
    if (typeof window.openAppStore === 'function') return window.openAppStore();
    if (window.playableSDK && playableSDK.openAppStore) return playableSDK.openAppStore();
    if (window.mraid && mraid.open) return mraid.open(url);
    if (window.dapi && dapi.openStoreUrl) return dapi.openStoreUrl();
    if (window.parent !== window) window.parent.postMessage({type:'playable_cta', url:url}, '*');
    if (url) window.open(url, '_blank');
  }catch(e){ try{ if(url) window.open(url,'_blank'); }catch(_){} }
}
function vahdamReady(){
  try{
    if (window.mraid && mraid.getState && mraid.getState() === 'loading'){
      mraid.addEventListener('ready', function(){});
    }
  }catch(e){}
}`;

const SHELL_CSS = `
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{width:100%;height:100%;overflow:hidden;background:${PALETTE.ink};
  font-family:'Proxima Nova','Helvetica Neue',Arial,sans-serif;user-select:none}
#stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;text-align:center;padding:6% 7%;
  background:radial-gradient(130% 100% at 50% 15%,#0a5c38 0%,${PALETTE.green} 72%)}
h1{font-family:'Lao MN','Cormorant Garamond',Georgia,serif;color:${PALETTE.cream};
  font-size:clamp(20px,7vmin,42px);line-height:1.14;text-shadow:0 2px 18px rgba(23,23,23,.4)}
p.sub{color:${PALETTE.cream};opacity:.92;font-size:clamp(12px,3.4vmin,18px);margin-top:8px}
.cup{position:relative;width:min(46vmin,240px);height:min(46vmin,240px);margin:4vmin auto;
  border-radius:50%;background:rgba(251,245,234,.10);border:2px solid rgba(171,135,67,.55);
  display:flex;align-items:center;justify-content:center;overflow:hidden}
.brew{position:absolute;left:0;bottom:0;width:100%;height:0%;
  background:linear-gradient(180deg,#c98a3c,#6b3f16);transition:height .5s ease}
.cup .lbl{position:relative;z-index:2;color:${PALETTE.cream};font-size:clamp(11px,3vmin,15px);
  opacity:.9;padding:0 10%}
.picks{display:flex;gap:2.5vmin;flex-wrap:wrap;justify-content:center;margin-top:2vmin}
.pick{cursor:pointer;border:1.5px solid rgba(171,135,67,.55);border-radius:14px;
  padding:2.4vmin 3.2vmin;color:${PALETTE.cream};font-size:clamp(11px,3vmin,15px);
  background:rgba(251,245,234,.07);transition:transform .12s,background .2s,border-color .2s}
.pick:active{transform:scale(.96)}
.pick.on{background:${PALETTE.gold};color:${PALETTE.ink};font-weight:700;border-color:${PALETTE.gold}}
.cta{display:inline-block;margin-top:4vmin;background:${PALETTE.gold};color:${PALETTE.ink};
  font-weight:800;padding:3.4vmin 8vmin;border-radius:999px;border:0;cursor:pointer;
  font-size:clamp(13px,3.8vmin,20px);font-family:inherit;animation:pulse 2.4s infinite}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
.offer{color:${PALETTE.gold};font-size:clamp(12px,3.4vmin,18px);letter-spacing:.03em;margin-top:2vmin}
.hint{position:absolute;bottom:3.5%;left:0;right:0;color:${PALETTE.cream};opacity:.6;
  font-size:clamp(10px,2.6vmin,13px)}
.hide{display:none!important}
video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(23,23,23,.35) 0%,
  rgba(0,74,43,0) 45%,rgba(0,74,43,.72) 100%)}
@media (orientation:landscape){ .cup{width:min(34vmin,190px);height:min(34vmin,190px)} }
@media (prefers-reduced-motion:reduce){ .cta{animation:none} }`;

/**
 * Interactive playable: pick ingredients, watch the cup fill, get the offer.
 * spec: { product, headline, sub, ingredients:[{label,emoji}], offer, cta,
 *         url, network:'meta'|'tiktok'|'google'|'applovin'|'unity', hint }
 */
function renderPlayable(spec) {
  const s = spec || {};
  const picks = (s.ingredients || [
    { label: 'Ashwagandha' }, { label: 'Turmeric' }, { label: 'Ginger' }, { label: 'Cardamom' },
  ]).slice(0, 6);
  const need = Math.min(2, picks.length);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${esc(s.product || 'VAHDAM')} — playable</title>
<style>${SHELL_CSS}</style></head>
<body>
<div id="stage">
  <div id="play">
    <h1>${esc(s.headline || 'Build your evening cup')}</h1>
    <p class="sub">${esc(s.sub || `Tap ${need} things you want more of.`)}</p>
    <div class="cup"><div class="brew" id="brew"></div><div class="lbl" id="cuplbl">your cup</div></div>
    <div class="picks" id="picks">
      ${picks.map((p, i) => `<div class="pick" data-i="${i}">${esc(p.label)}</div>`).join('')}
    </div>
    <div class="hint" id="hint">Tap to choose</div>
  </div>
  <div id="end" class="hide">
    <h1>${esc(s.endHeadline || 'Your cup is ready')}</h1>
    <p class="sub" id="endsub"></p>
    ${s.offer ? `<div class="offer">${esc(s.offer)}</div>` : ''}
    <button class="cta" id="cta">${esc(s.cta || 'Shop the blend')}</button>
    <div class="hint">Free shipping thresholds and terms apply.</div>
  </div>
</div>
<script>
${CTA_JS}
var URL_ = ${js(s.url || '')}, NEED = ${need}, chosen = [];
var LABELS = ${js(picks.map((p) => p.label))};
vahdamReady();
document.getElementById('picks').addEventListener('click', function(e){
  var el = e.target.closest('.pick'); if(!el) return;
  var i = +el.getAttribute('data-i');
  var at = chosen.indexOf(i);
  if(at >= 0){ chosen.splice(at,1); el.classList.remove('on'); }
  else { if(chosen.length >= NEED) return; chosen.push(i); el.classList.add('on'); }
  var pct = Math.round(chosen.length / NEED * 100);
  document.getElementById('brew').style.height = pct + '%';
  document.getElementById('cuplbl').textContent = chosen.length ? chosen.map(function(k){return LABELS[k];}).join(' + ') : 'your cup';
  document.getElementById('hint').textContent = chosen.length >= NEED ? 'Steeping...' : 'Tap to choose';
  if(chosen.length >= NEED){
    setTimeout(function(){
      document.getElementById('play').classList.add('hide');
      var end = document.getElementById('end'); end.classList.remove('hide');
      document.getElementById('endsub').textContent = chosen.map(function(k){return LABELS[k];}).join(' + ');
    }, 900);
  }
});
document.getElementById('cta').addEventListener('click', function(){ vahdamCTA(URL_); });
document.getElementById('stage').addEventListener('click', function(e){
  if(e.target.id === 'stage' && !document.getElementById('end').classList.contains('hide')) vahdamCTA(URL_);
});
</script>
</body></html>`;
  const size = assertInlineOnly(s, html);
  return { html, size, network: s.network || 'meta', kind: 'interactive' };
}

/**
 * Video playable: inlined muted autoplay video + interactive end card.
 * spec adds: video (data: URI), poster (data: URI), endHeadline
 */
function renderPlayableVideo(spec) {
  const s = spec || {};
  if (!s.video) throw new Error('playable-ad: renderPlayableVideo needs `video` as a data: URI (inline only)');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${esc(s.product || 'VAHDAM')} — playable video</title>
<style>${SHELL_CSS}</style></head>
<body>
<div id="stage">
  <video id="v" muted playsinline autoplay ${s.poster ? `poster="${esc(s.poster)}"` : ''} src="${esc(s.video)}"></video>
  <div class="veil"></div>
  <div id="end" class="hide" style="position:relative;z-index:3">
    <h1>${esc(s.endHeadline || s.headline || 'Steep something better')}</h1>
    ${s.offer ? `<div class="offer">${esc(s.offer)}</div>` : ''}
    <button class="cta" id="cta">${esc(s.cta || 'Shop now')}</button>
  </div>
  <div class="hint" id="skip" style="z-index:3">Tap anywhere to shop</div>
</div>
<script>
${CTA_JS}
var URL_ = ${js(s.url || '')};
vahdamReady();
var v = document.getElementById('v');
function showEnd(){
  document.getElementById('end').classList.remove('hide');
  document.getElementById('skip').classList.add('hide');
}
v.addEventListener('ended', showEnd);
// End card also appears near the end in case 'ended' never fires (some webviews).
v.addEventListener('timeupdate', function(){
  if(v.duration && v.currentTime >= v.duration - 0.35) showEnd();
});
setTimeout(showEnd, Math.max(4000, (${Number(s.seconds) || 12}) * 1000));
document.getElementById('cta').addEventListener('click', function(e){ e.stopPropagation(); vahdamCTA(URL_); });
document.getElementById('stage').addEventListener('click', function(){ vahdamCTA(URL_); });
// Muted autoplay is required; unmute only on an explicit tap.
v.play().catch(function(){ document.getElementById('skip').textContent = 'Tap to play'; });
</script>
</body></html>`;
  const size = assertInlineOnly(s, html);
  return { html, size, network: s.network || 'meta', kind: 'video' };
}

/** Spec sheet for whoever ships the unit (what each network checks). */
function playableSpecSheet() {
  return {
    file: 'ONE self-contained .html, every asset a data: URI, zero external requests',
    size_caps_mb: SIZE_LIMIT_MB,
    orientation: 'must work portrait and landscape',
    interaction: 'first tap possible within ~2s; no forced wait',
    audio: 'muted by default; sound only after a user tap',
    cta_api: {
      meta: 'FbPlayableAd.onCTAClick()',
      tiktok: 'window.openAppStore() / playableSDK.openAppStore()',
      mraid: 'mraid.open(url) — Google, AppLovin, ironSource',
      unity: 'dapi.openStoreUrl() / postMessage fallback',
    },
    brand: 'palette #004A2B / #AB8743 / #171717 / #FBF5EA; Lao MN + Proxima Nova; no banned phrases',
    honesty: 'no fake discount codes, no invented ratings, no countdown that resets - only real offers',
  };
}

module.exports = { renderPlayable, renderPlayableVideo, playableSpecSheet, PALETTE, SIZE_LIMIT_MB };
