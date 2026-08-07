/* motion.js — VAHDAM Motion System v2. Loaded on every page by auth.js.
 *
 * WHAT IT DOES
 * Scroll reveals (native scroll-driven where supported), kinetic word-by-word
 * headings, pointer-reactive card tilt with a specular highlight, magnetic CTAs,
 * cursor spotlight panels, sheen sweeps, counting numbers, a scroll progress
 * beam, an aurora atmosphere on hero surfaces, film grain, and cross-document
 * view transitions. Styling lives in motion.css, injected below.
 *
 * WHY IT IS AUTOMATIC RATHER THAN PER-PAGE
 * There are ~56 independent HTML documents here. Anything that has to be added
 * to each of them by hand is a thing that will be true today and false for the
 * next page someone adds. This module reads the DOM and decides, so a new page
 * gets the whole system by existing.
 *
 * ═══ THE SAFETY CONTRACT — every clause exists because of a real failure ═══
 *
 * 1. CONTENT IS NEVER LEFT HIDDEN. Hiding only ever happens when JS is running
 *    AND reduced motion is off. A 3.5s hard timer reveals everything tracked,
 *    so an element an observer missed cannot stay invisible.
 * 2. NO CLIP-PATH ON TEXT. The landing-page motion layer shipped a clip reveal
 *    that cut copy mid-word ("ooth. Rich."). Wipes here are media-only.
 * 3. NOTHING LEAVES FLOW. Only transform/opacity/filter animate. This module
 *    never writes position, top, left, width or height on page content.
 * 4. GRANULAR TARGETS ONLY. Never a big <section> wrapper — its block-level
 *    opacity would hide its own children before they reveal.
 * 5. CHROME IS UNTOUCHED. Nav, the LHS rail, headers, overlays, the sync bar
 *    and anything fixed/sticky are excluded. Moving the navigation is how a
 *    user loses the ability to leave the page.
 * 6. WORD SPLIT, NEVER CHARACTER SPLIT. A character split breaks text
 *    selection, find-in-page and screen-reader pronunciation. Splitting is also
 *    skipped entirely for any heading holding non-text nodes.
 * 7. DECORATIVE LAYERS CANNOT BE CLICKED. Every injected layer is
 *    pointer-events:none + aria-hidden.
 * 8. GRACEFUL EVERYWHERE. No hard dependency on any library; GSAP is fetched
 *    only if a page actually uses [data-parallax] and reveals still work if it
 *    404s. Coarse pointers get no hover effect at all.
 */
(function () {
  'use strict';
  if (window.__vhMotionBooted) return;
  window.__vhMotionBooted = true;

  var root = document.documentElement;
  // Skip the frozen diff snapshot (self-themed, pinned reference).
  if (/(^|\/)diff-version(\/|\.html|$)/.test(location.pathname)) return;
  // Explicit page opt-out.
  if (root.getAttribute('data-motion') === 'off') return;

  var CSS_HREF = '/motion.css?v=20260806';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;

  // The stylesheet loads even under reduced motion: it carries the @media
  // (prefers-reduced-motion) block that force-clears any motion class already in
  // the markup, and the view-transition opt-out. Withholding it would leave a
  // page authored with .vh-rv permanently faded.
  (function injectCSS() {
    try {
      if (document.querySelector('link[data-vh-motion-css]')) return;
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = CSS_HREF;
      l.setAttribute('data-vh-motion-css', '1');
      (document.head || root).appendChild(l);
    } catch (_) {}
  })();

  if (reduce) { root.classList.add('vh-reduce'); return; }

  var fine = !window.matchMedia || matchMedia('(hover:hover) and (pointer:fine)').matches;
  var nativeTimeline = false;
  try { nativeTimeline = CSS.supports('animation-timeline', 'view()'); } catch (_) {}

  var MAX_TRACK = 190;   // cap reveal work on very large pages
  var MAX_TILT = 60;     // cap listener count on card-heavy dashboards
  var io = null, tracked = [], booted = false;
  var tiltCount = 0;

  // ── Shared exclusion rule ────────────────────────────────────────────────
  // Chrome, fixed/sticky furniture and anything explicitly opted out. Checked
  // before every enhancement, not just reveals.
  var CHROME = '#lifecycle-nav, nav, header, .topbar, .lnav, .vh-syncbar, [data-no-motion]';
  function excluded(el) {
    if (!el || el.__vhSeen) return true;
    if (el.closest(CHROME)) return true;
    var cs;
    try { cs = getComputedStyle(el); } catch (_) { return true; }
    if (cs.position === 'fixed' || cs.position === 'sticky') return true;
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    return false;
  }

  // ── 0. Humanised timing ──────────────────────────────────────────────────
  // Perfectly uniform motion is the tell that separates a template from a
  // designed page: when every card rises exactly 22px over exactly 780ms on
  // exactly the same curve, the eye reads "generated" even if it cannot say why.
  // Real hands never place two things identically. So every element gets its own
  // duration, distance, easing and a sub-degree arrival angle.
  //
  // The variance is SEEDED, never random. Math.random() would re-roll on every
  // MutationObserver re-scan, so an element could re-animate with different
  // numbers mid-page, and no test could ever pin the behaviour. Hashing
  // something stable about the element gives the same variation every time while
  // still looking hand-placed.
  function seedOf(el, i) {
    var s = (el.tagName || '') + '|' + (el.className || '') + '|' +
            ((el.textContent || '').slice(0, 24)) + '|' + i;
    var h = 2166136261;
    for (var k = 0; k < s.length; k++) {
      h ^= s.charCodeAt(k);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }
  // Deterministic 0..1 from a seed and a channel, so duration and distance vary
  // independently rather than moving together (which would just look scaled).
  function rnd(seed, channel) {
    var x = (seed ^ (channel * 2654435761)) >>> 0;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return (x >>> 8) / 16777216;
  }

  // A few hand-authored curves instead of one. Each has a different personality:
  // settle is soft, glide is even, ease is gentle, lift has the faintest
  // overshoot. Picking per element is what stops the page moving in lockstep.
  var EASES = [
    'cubic-bezier(.16,1,.3,1)',
    'cubic-bezier(.22,.9,.24,1)',
    'cubic-bezier(.19,1,.22,1)',
    'cubic-bezier(.34,1.12,.44,1)'
  ];

  // Mass: a big block should feel heavier than a chip. Larger elements travel
  // further and take longer, which is the single cue that most reads as physical
  // rather than scripted.
  // `rect` is passed in, never measured here. Measuring inside the write loop
  // would interleave a layout read with a style write for every element — up to
  // ~190 forced synchronous layouts on a dashboard, which is exactly the jank
  // that makes people turn animation off. Callers read all geometry first, then
  // write. (See scanReveals.)
  function humanise(el, i, rect) {
    var seed = seedOf(el, i);
    var r = rect || { width: 300, height: 120 };
    var area = Math.min(1, ((r.width * r.height) || 30000) / 260000); // 0..1
    var dur = 640 + area * 340 + rnd(seed, 1) * 220;      // 640-1200ms
    var dy = 14 + area * 12 + rnd(seed, 2) * 9;            // 14-35px
    var rot = (rnd(seed, 3) - 0.5) * 1.1;                  // +/- 0.55deg
    el.style.setProperty('--vh-dur', Math.round(dur) + 'ms');
    el.style.setProperty('--vh-dy', dy.toFixed(1) + 'px');
    el.style.setProperty('--vh-rot', rot.toFixed(2) + 'deg');
    el.style.setProperty('--vh-ease', EASES[seed % EASES.length]);
    return seed;
  }

  // ── 1. Reveals ───────────────────────────────────────────────────────────
  // NOT SCOPED TO <main>. Measured against the real pages: NONE of the ~56
  // documents in this app uses a <main> element, so every `main h1` / `main img`
  // selector matched exactly zero nodes and kinetic headings plus the media wipe
  // were dead everywhere. A synthetic test fixture that used <main> hid this
  // completely — the selectors looked right and covered nothing.
  // Dropping the scope is safe because excluded() already rejects anything
  // inside nav/header/rail/sync-bar and anything fixed or sticky, which is what
  // the `main` prefix was standing in for.
  var REVEAL_SEL = [
    '.card', '[class*="card"]', '.tile', '[class*="tile"]', '.panel',
    '.kpi', '.sig', '.w', '.pcard', '.coltile', '.metric', '.stat',
    'h1', 'h2', '.sec-h', '.sec-eyebrow', '.sec-sub',
    // Media, so the clip wipe is actually reachable. Size-gated below: a 16px
    // favicon or an inline icon wiping in reads as a glitch, not a reveal.
    'img', 'figure', 'picture', 'video'
  ].join(',');
  var MEDIA_TAGS = { IMG: 1, PICTURE: 1, FIGURE: 1, VIDEO: 1, CANVAS: 1 };

  // Rule 2 lives here: a wipe is only ever chosen for an element that is media,
  // and a heading always gets a motion that cannot cut a glyph.
  function revealKind(el) {
    var tag = el.tagName;
    if (tag === 'IMG' || tag === 'PICTURE' || tag === 'FIGURE' || tag === 'CANVAS' || tag === 'VIDEO') return 'wipe';
    if (tag === 'H1' || tag === 'H2') return 'blur';
    if (/\b(kpi|metric|stat|sig)\b/.test(el.className || '')) return 'scale';
    return 'rise';
  }

  function markAndObserve(el, idxInParent, rect) {
    el.__vhSeen = true;
    el.classList.add('vh-rv');
    el.setAttribute('data-vh-rv', revealKind(el));
    var seed = humanise(el, idxInParent || 0, rect);
    // The stagger drifts too. A metronome-exact 62ms cadence is audible to the
    // eye the same way a quantised drum track is to the ear; a few ms of give
    // per item is what makes a row of cards read as dealt rather than printed.
    var base = (idxInParent || 0) * (54 + rnd(seed, 4) * 26);
    el.style.setProperty('--vh-delay', Math.round(Math.min(base, 400)) + 'ms');
    tracked.push(el);
    if (io) io.observe(el); else el.classList.add('vh-in');
  }

  // theme.css still defines the v1 `.vh-reveal` base, and it hides the element
  // as soon as this module adds `.vh-motion-ready`. Nothing else drives it now,
  // so a page that hand-authors that class would be hidden forever. Adopt any
  // such element into the same observer rather than leaving a live class with no
  // engine behind it.
  function adoptLegacyReveals() {
    var legacy = document.querySelectorAll('.vh-reveal:not(.vh-in)');
    for (var i = 0; i < legacy.length && tracked.length < MAX_TRACK; i++) {
      var el = legacy[i];
      if (el.__vhSeen) continue;
      el.__vhSeen = true;
      tracked.push(el);
      if (io) io.observe(el); else el.classList.add('vh-in');
    }
  }

  // TWO PASSES, DELIBERATELY. Pass 1 only READS (selection, computed style,
  // geometry); pass 2 only WRITES (classes, custom properties). Interleaving
  // them forces the browser to re-run layout for every single element, and on a
  // card-heavy dashboard that is a visible hitch on load — the thing that makes
  // a motion system feel like a cost rather than a polish.
  function scanReveals() {
    adoptLegacyReveals();
    if (tracked.length >= MAX_TRACK) return;
    var nodes = document.querySelectorAll(REVEAL_SEL);
    var perParent = new Map();
    var batch = [];
    for (var i = 0; i < nodes.length && batch.length + tracked.length < MAX_TRACK; i++) {
      var el = nodes[i];
      if (excluded(el)) continue;
      // A kinetic heading already has its own motion. Giving it a container
      // reveal too would blur the whole line while its words are still
      // staggering in — two treatments fighting, and the copy unreadable for
      // most of the animation. Kinetic wins; this is why scanKinetic runs first.
      if (el.classList.contains('vh-kin')) continue;
      // Rule 4: a revealed ancestor already animates this subtree.
      if (el.parentElement && el.parentElement.closest('.vh-rv')) continue;
      var p = el.parentNode;
      var n = perParent.get(p) || 0; perParent.set(p, n + 1);
      var rect;
      try { rect = el.getBoundingClientRect(); } catch (_) { rect = null; }
      // Icons and spacer images are not media reveals.
      if (MEDIA_TAGS[el.tagName] && rect && (rect.width < 80 || rect.height < 60)) continue;
      batch.push([el, n, rect]);
    }
    for (var j = 0; j < batch.length; j++) {
      markAndObserve(batch[j][0], batch[j][1], batch[j][2]);
    }
  }

  // ── 2. Kinetic headings ──────────────────────────────────────────────────
  // Rule 6. Split only headings whose content is a SINGLE text node: a heading
  // containing a link, badge or icon would lose those nodes to a naive rewrite,
  // and a partially-split heading reads worse than an unsplit one.
  function kineticize(h) {
    if (h.__vhKin) return;
    if (h.childNodes.length !== 1 || h.firstChild.nodeType !== 3) return;
    var text = h.firstChild.nodeValue;
    if (!text || text.length > 140) return;         // long paragraphs are not headlines
    var words = text.split(/(\s+)/);                 // keep the separators
    if (words.filter(function (w) { return w.trim(); }).length > 18) return;
    h.__vhKin = true;

    var frag = document.createDocumentFragment();
    var hseed = seedOf(h, 0);
    var wi = 0, clock = 0;
    for (var i = 0; i < words.length; i++) {
      if (!words[i]) continue;
      if (!words[i].trim()) {
        // Whitespace stays a bare text node so selection, copy/paste and
        // textContent are byte-identical to before the split.
        frag.appendChild(document.createTextNode(words[i]));
        continue;
      }
      var word = words[i];
      var s = document.createElement('span');
      s.className = 'vh-w';

      // Cadence, not a metronome. A headline is read aloud in the mind, so the
      // words arrive the way they would be spoken: long words take a beat
      // longer, and a comma or full stop draws breath before the next word.
      // A fixed 48ms interval instead makes the line tick like a departures
      // board, which is the single most robotic thing kinetic type can do.
      s.style.setProperty('--vh-wd', Math.round(clock) + 'ms');
      s.style.setProperty('--vh-dur', Math.round(560 + word.length * 14 + rnd(hseed, wi + 20) * 130) + 'ms');
      s.style.setProperty('--vh-rot', ((rnd(hseed, wi + 60) - 0.5) * 2.2).toFixed(2) + 'deg');

      clock += 42 + word.length * 7 + rnd(hseed, wi + 100) * 26;
      if (/[,;:]$/.test(word)) clock += 90;      // a short breath
      if (/[.!?]$/.test(word)) clock += 150;     // a longer one
      if (clock > 900) clock = 900;              // never make the reader wait

      s.appendChild(document.createTextNode(word));
      frag.appendChild(s);
      wi++;
    }
    h.textContent = '';
    h.appendChild(frag);
    h.classList.add('vh-kin');
    if (io) io.observe(h); else h.classList.add('vh-in');
    tracked.push(h);
  }

  function scanKinetic() {
    var hs = document.querySelectorAll('h1, h2, .sec-h, h1.vh-h, .hero h1, .hero h2');
    for (var i = 0; i < hs.length && i < 24; i++) {
      if (hs[i].closest(CHROME)) continue;
      kineticize(hs[i]);
    }
  }

  // ── 3. Pointer depth: tilt, magnet, spotlight ────────────────────────────
  function pct(e, el) {
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
      w: r.width, h: r.height
    };
  }

  // A shared easing loop for pointer-driven effects. Writing the cursor position
  // straight to the element makes it track like a machine tool — perfectly rigid,
  // zero latency, subtly unpleasant. Everything with mass lags slightly and
  // settles. One rAF loop drives every active element rather than one per card,
  // so a dashboard of forty cards costs a single frame callback.
  var eased = [], rafId = 0;
  function easeLoop() {
    rafId = 0;
    var live = false;
    for (var i = 0; i < eased.length; i++) {
      var e = eased[i];
      if (!e.on && Math.abs(e.cx - e.tx) < 0.0015 && Math.abs(e.cy - e.ty) < 0.0015) continue;
      // Critically-damped-ish approach: fast enough to feel responsive, slow
      // enough to have weight. 0.16 is roughly a 100ms settle at 60fps.
      e.cx += (e.tx - e.cx) * 0.16;
      e.cy += (e.ty - e.cy) * 0.16;
      e.apply(e.cx, e.cy);
      live = true;
    }
    if (live) rafId = requestAnimationFrame(easeLoop);
  }
  function easedTrack(apply) {
    var rec = { tx: 0, ty: 0, cx: 0, cy: 0, on: false, apply: apply };
    eased.push(rec);
    return {
      to: function (x, y) { rec.tx = x; rec.ty = y; rec.on = true; if (!rafId) rafId = requestAnimationFrame(easeLoop); },
      off: function () { rec.tx = 0; rec.ty = 0; rec.on = false; if (!rafId) rafId = requestAnimationFrame(easeLoop); }
    };
  }

  function attachTilt(el) {
    if (el.__vhTilt || tiltCount >= MAX_TILT) return;
    // The specular ::after is absolutely positioned against this element, so the
    // element must establish a containing block. A static card would let the
    // sheen escape to the nearest positioned ancestor and paint over a sibling.
    var cs;
    try { cs = getComputedStyle(el); } catch (_) { return; }
    if (cs.position === 'static') el.style.position = 'relative';
    el.__vhTilt = true; tiltCount++;
    el.classList.add('vh-tilt');
    // Each card is a slightly different amount of stiff, so a grid of them does
    // not respond as one rigid sheet.
    var lean = 0.85 + rnd(seedOf(el, tiltCount), 7) * 0.4;
    var track = easedTrack(function (x, y) {
      el.style.setProperty('--vh-tx', (x * lean).toFixed(3));
      el.style.setProperty('--vh-ty', (y * lean).toFixed(3));
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var p = pct(e, el); if (!p) return;
      el.classList.add('vh-tilting');
      track.to(p.x - 0.5, p.y - 0.5);
      // The specular highlight is light, not mass: it tracks the cursor exactly.
      el.style.setProperty('--vh-px', (p.x * 100).toFixed(1) + '%');
      el.style.setProperty('--vh-py', (p.y * 100).toFixed(1) + '%');
    }, { passive: true });
    var reset = function () {
      el.classList.remove('vh-tilting');
      track.off();
    };
    el.addEventListener('pointerleave', reset, { passive: true });
    // A card can be scrolled out from under a stationary cursor without ever
    // firing pointerleave, which would strand it tilted. Blur covers that.
    el.addEventListener('pointercancel', reset, { passive: true });
  }

  function attachMagnet(el) {
    if (el.__vhMag) return;
    el.__vhMag = true;
    el.classList.add('vh-mag', 'vh-sheen');
    var box = { w: 120, h: 40 };
    var track = easedTrack(function (x, y) {
      // Capped: enough to feel alive, small enough that the cursor never leaves
      // the element it is pulling, which would cause a flutter loop.
      el.style.setProperty('--vh-mx', (x * Math.min(box.w * 0.18, 14)).toFixed(1) + 'px');
      el.style.setProperty('--vh-my', (y * Math.min(box.h * 0.28, 10)).toFixed(1) + 'px');
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var p = pct(e, el); if (!p) return;
      el.classList.add('vh-magging');
      box.w = p.w; box.h = p.h;
      track.to(p.x - 0.5, p.y - 0.5);
    }, { passive: true });
    var off = function () {
      el.classList.remove('vh-magging');
      track.off();
    };
    el.addEventListener('pointerleave', off, { passive: true });
    el.addEventListener('pointercancel', off, { passive: true });
    el.addEventListener('blur', off, { passive: true });
  }

  function attachSpotlight(el) {
    if (el.__vhSpot) return;
    el.__vhSpot = true;
    el.classList.add('vh-spot');
    el.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var p = pct(e, el); if (!p) return;
      el.classList.add('vh-spotting');
      el.style.setProperty('--vh-px', (p.x * 100).toFixed(1) + '%');
      el.style.setProperty('--vh-py', (p.y * 100).toFixed(1) + '%');
    }, { passive: true });
    el.addEventListener('pointerleave', function () { el.classList.remove('vh-spotting'); }, { passive: true });
  }

  function scanPointer() {
    if (!fine) return; // no hover on touch; a stuck tilt is worse than no tilt
    var cards = document.querySelectorAll('.card, [class*="card"], .tile, .kpi, .metric, .stat, .pcard, .coltile, .panel');
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.closest(CHROME) || c.hasAttribute('data-no-tilt')) continue;
      var r = c.getBoundingClientRect();
      // Tilting something the size of the viewport reads as the page lurching.
      // Measured on the real ads dashboard: its cards and panels are wider than
      // the 900px the synthetic fixture implied, so NOTHING on the busiest page
      // in the app was getting tilt. Full-bleed elements are still excluded —
      // tilting something the size of the viewport reads as the page lurching.
      if (r.width < 90 || r.width > 1100 || r.height < 60) continue;
      attachTilt(c);
    }
    var btns = document.querySelectorAll('button.primary, .btn-primary, .vh-btn-primary, [data-magnetic], .cta, a.btn, button.cta');
    for (var j = 0; j < btns.length && j < 40; j++) {
      if (btns[j].closest(CHROME)) continue;
      attachMagnet(btns[j]);
    }
    var panels = document.querySelectorAll('.panel, .surface, section > .wrap, .hero');
    for (var k = 0; k < panels.length && k < 20; k++) {
      if (panels[k].closest(CHROME)) continue;
      attachSpotlight(panels[k]);
    }
  }

  // ── 4. Counting numbers ──────────────────────────────────────────────────
  // Only numbers this module can parse AND reproduce exactly. The final frame
  // writes back the ORIGINAL string, never a re-formatted one — a KPI that
  // counts up to "1,234" and settles on "1234" has corrupted the figure it was
  // decorating.
  var NUMERIC = /^\s*([^\d\-+]*)([\-+]?[\d,]*\.?\d+)([^\d]*)\s*$/;
  function countUp(el) {
    if (el.__vhCount) return;
    var raw = (el.textContent || '').trim();
    var m = raw.match(NUMERIC);
    if (!m) return;
    var target = parseFloat(m[2].replace(/,/g, ''));
    if (!isFinite(target) || Math.abs(target) < 3 || Math.abs(target) > 1e12) return;
    el.__vhCount = true;
    el.classList.add('vh-count');
    var decimals = (m[2].split('.')[1] || '').length;
    var grouped = m[2].indexOf(',') >= 0;
    var pre = m[1], post = m[3];
    var t0 = null, DUR = 1100;
    function frame(t) {
      if (t0 === null) t0 = t;
      var k = Math.min((t - t0) / DUR, 1);
      var eased = 1 - Math.pow(1 - k, 3);
      if (k >= 1) { el.textContent = raw; return; }   // exact original, always
      var v = target * eased;
      var s = decimals ? v.toFixed(decimals) : String(Math.round(v));
      if (grouped) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      el.textContent = pre + s + post;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ── 4b. Scroll-scrubbed video ────────────────────────────────────────────
  // Opt-in: <video data-scrub muted playsinline preload="auto" src="...">.
  // Scroll position drives the video's currentTime, so scrolling down plays the
  // clip forward and scrolling back up plays it in reverse. This is the mechanic
  // behind reveal sequences where the page appears to physically operate an
  // object (a cloth lifting off a building, a camera descending underwater).
  //
  // It is opt-in, not automatic, for a reason no other effect here has: it needs
  // a clip SHOT for it — one continuous, linear, locked-off move with no cuts.
  // Scrubbing an ordinary marketing video just makes it stutter.
  function attachScrubVideo(v) {
    if (v.__vhScrub) return;
    v.__vhScrub = true;
    // Autoplay policy: a muted, inline video is the only kind allowed to be
    // manipulated without a user gesture, and we never call play() anyway.
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.pause();

    var host = v.closest('[data-scrub-host]') || v.parentElement || v;
    var dur = 0, pending = -1, raf = 0, seeking = false;

    function onMeta() { dur = v.duration || 0; }
    if (v.readyState >= 1) onMeta();
    v.addEventListener('loadedmetadata', onMeta, { passive: true });
    // A video that never loads must not leave a blank section behind it.
    v.addEventListener('error', function () { v.__vhScrub = 'failed'; }, { passive: true });

    function seek() {
      raf = 0;
      if (!dur || pending < 0 || seeking) return;
      var t = Math.max(0, Math.min(dur - 0.02, pending));
      // Skip sub-frame seeks: at 30fps anything under ~33ms is invisible and
      // each seek is real decode work. Without this the decoder is asked to jump
      // on every scroll event and the playhead visibly lags the scroll.
      if (Math.abs(t - v.currentTime) < 0.033) return;
      seeking = true;
      try { v.currentTime = t; } catch (_) {}
    }
    v.addEventListener('seeked', function () { seeking = false; if (pending >= 0 && !raf) raf = requestAnimationFrame(seek); }, { passive: true });

    function onScroll() {
      var r = host.getBoundingClientRect();
      // Progress across the host's full travel through the viewport: 0 when its
      // top hits the bottom of the screen, 1 when its bottom leaves the top.
      var span = r.height + window.innerHeight;
      var p = span > 0 ? (window.innerHeight - r.top) / span : 0;
      p = Math.max(0, Math.min(1, p));
      pending = p * (dur || 0);
      if (!raf) raf = requestAnimationFrame(seek);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  }

  function scanScrubVideos() {
    var vids = document.querySelectorAll('video[data-scrub]');
    for (var i = 0; i < vids.length && i < 8; i++) attachScrubVideo(vids[i]);
  }

  // ── 5. Atmosphere, beam, grain ───────────────────────────────────────────
  function fxLayer(cls) {
    var d = document.createElement('div');
    d.className = 'vh-fx ' + cls;
    d.setAttribute('aria-hidden', 'true');
    return d;
  }

  function addAtmosphere() {
    // A hero surface only. Never a table, list or dashboard grid — an animated
    // wash behind numbers is noise, and the master spec's contrast rule is not
    // negotiable for data.
    var host = document.querySelector('.hero, [class*="hero"], main > section:first-of-type, .site > section:first-of-type');
    if (!host || host.closest(CHROME) || host.classList.contains('vh-atmos')) return;
    var r = host.getBoundingClientRect();
    if (r.height < 160) return;
    var cs;
    try { cs = getComputedStyle(host); } catch (_) { return; }
    // The aurora IS the host's background-image (see motion.css). So a host that
    // already has one — a hero photo, a gradient band — must be left alone
    // rather than have its artwork silently replaced by a wash.
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return;
    host.classList.add('vh-atmos');
  }

  function addBeam() {
    if (document.querySelector('.vh-beam')) return;
    var beam = fxLayer('vh-beam');
    document.body.appendChild(beam);
    // Browsers without scroll() timelines get the same beam from one rAF-free
    // passive scroll handler. Writing a transform is cheap; measuring is not, so
    // the scroll height is cached and refreshed on resize only.
    var supports = false;
    try { supports = CSS.supports('animation-timeline', 'scroll()'); } catch (_) {}
    if (supports) return;
    var max = 1;
    var measure = function () {
      max = Math.max(1, (document.documentElement.scrollHeight - window.innerHeight));
    };
    measure();
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('scroll', function () {
      var p = Math.min(1, Math.max(0, window.scrollY / max));
      beam.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }, { passive: true });
  }

  function addGrain() {
    if (document.querySelector('.vh-grain')) return;
    var g = fxLayer('vh-grain');
    // Inline SVG turbulence as a data URI: no network request, no external host,
    // and it cannot be blocked by a CSP that forbids remote images.
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>" +
      "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3' stitchTiles='stitch'/>" +
      "<feColorMatrix type='saturate' values='0'/></filter>" +
      "<rect width='180' height='180' filter='url(%23n)' opacity='.55'/></svg>";
    g.style.setProperty('--vh-grain-src', "url(\"data:image/svg+xml;utf8," + svg + "\")");
    document.body.appendChild(g);
  }

  // ── 6. Optional GSAP parallax (unchanged contract: opt-in, zero dependency) ─
  function loadGSAPIfNeeded() {
    if (!document.querySelector('[data-parallax]')) return;
    if (window.gsap && window.ScrollTrigger) return enhanceParallax();
    var base = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/';
    inject(base + 'gsap.min.js', function () {
      inject(base + 'ScrollTrigger.min.js', enhanceParallax, noop);
    }, noop);
  }
  function inject(src, ok, fail) {
    var s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = ok || noop; s.onerror = fail || noop; document.head.appendChild(s);
  }
  function noop() {}
  function enhanceParallax() {
    if (!window.gsap || !window.ScrollTrigger) return;
    try { gsap.registerPlugin(ScrollTrigger); } catch (_) { return; }
    document.querySelectorAll('[data-parallax]').forEach(function (el) {
      if (el.__vhParallax) return; el.__vhParallax = true;
      var depth = parseFloat(el.getAttribute('data-parallax')) || 0.2;
      try {
        gsap.to(el, { yPercent: -depth * 100, ease: 'none',
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
      } catch (_) {}
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function scanAll() {
    // ORDER MATTERS: kinetic first so scanReveals can see the .vh-kin mark and
    // skip those headings instead of double-animating them.
    scanKinetic();
    scanReveals();
    scanPointer();
    scanScrubVideos();
    loadGSAPIfNeeded();
  }

  function boot() {
    if (booted) return; booted = true;
    root.classList.add('vh-motion-ready');
    if (nativeTimeline) root.classList.add('vh-native');

    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (ents) {
        ents.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('vh-in');
          // A KPI counts as it arrives, not on load, so the motion is seen.
          if (/\b(kpi|metric|stat|sig|big|value|num)\b/i.test(e.target.className || '')) {
            var n = e.target.querySelector('.num, .value, .big, .kpi-value');
            countUp(n || e.target);
          }
          io.unobserve(e.target);
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    }

    scanAll();
    addAtmosphere();
    addBeam();
    addGrain();

    // Re-scan for late/dynamically-injected content (debounced, time-boxed).
    // ATTRIBUTES ARE WATCHED TOO, not just childList. Measured on the real ads
    // dashboard: it holds 15 tab panels and shows one, so every hidden panel is
    // display:none and correctly skipped — but switching tabs only toggles a
    // class, which a childList-only observer never sees. The other 14 tabs got
    // no motion for the life of the page. Re-scanning is cheap because
    // excluded() short-circuits on __vhSeen, so a no-op scan touches nothing.
    var t = null;
    var rescan = function () {
      if (t) return;
      t = setTimeout(function () { t = null; scanAll(); }, 250);
    };
    var mo = new MutationObserver(rescan);
    try {
      mo.observe(document.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'style', 'hidden'],
      });
    } catch (_) {}
    setTimeout(function () { try { mo.disconnect(); } catch (_) {} }, 15000);

    // The observer is time-boxed, but tab switching happens for as long as the
    // page is open. A delegated click re-scan covers that indefinitely and costs
    // nothing until someone actually clicks.
    document.addEventListener('click', function () { setTimeout(rescan, 60); }, { passive: true, capture: true });

    // RULE 1, HARD SAFETY: never leave tracked content hidden.
    setTimeout(function () {
      tracked.forEach(function (el) { el.classList.add('vh-in'); });
    }, 3500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
