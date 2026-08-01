/* ai-studio-bar.js — the shared AI control bar for every builder in the OS.
 *
 * Upgrades any `.ai-bar[data-surface]` into the full creation control:
 *
 *   inputs   prompt · reference page/ad URL · reference images · reference videos
 *   actions  ✨ Fill · 💡 Suggest · 🔀 New · ⬆ Enhance · ✕ Clear
 *   default  "Also build the landing page" — on, for every ad surface
 *
 * Loaded by ad-campaigns-master.html (Creative Studio) and landing-pages.html.
 * It lives here rather than inside either page because both are enormous
 * single-file apps, and a second copy of this logic would drift from the first
 * within a release.
 *
 * A host page registers how to reach its own form fields; everything else —
 * request shape, media handling, suggestion chips, error reporting — is owned
 * here.
 *
 *   AIStudioBar.register('meta', {
 *     resolve: (key) => document.getElementById(MAP[key]),
 *     keys:    ['name','obj','budget','primary','headline'],
 *     market:  () => document.getElementById('m-market').value,
 *     landing: { channel: 'meta' },        // presence => auto-landing-page toggle
 *     onApply: (fields, meta) => {},       // after fields are written
 *   });
 *
 * Zero fabrication: a reference the server could not read comes back as a
 * warning and is shown verbatim. The bar never claims an attachment was used.
 */
(function () {
  'use strict';

  if (window.AIStudioBar) return;

  // Vercel caps a serverless request body at 4.5MB, and base64 inflates a file
  // by a third. So uploads stop at 3MB and anything bigger has to come in as a
  // URL, which the server fetches itself with no body limit in the way.
  var UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
  var MAX_MEDIA = 4;

  var registry = {};          // surface -> config
  var barState = new WeakMap(); // bar element -> { media: [], brief: '', warnings: [] }

  // ── helpers ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function mb(n) { return (n / 1048576).toFixed(1) + 'MB'; }

  /** Providers wrap JSON in { text } or in ```json fences; unwrap all of it. */
  function safeJson(t) {
    if (t && typeof t === 'object') return t;
    var s = String(t == null ? '' : t);
    try { return JSON.parse(s); } catch (e) { /* keep trying */ }
    var stripped = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(stripped); } catch (e) { /* keep trying */ }
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a !== -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* give up */ } }
    return null;
  }

  /** Write a value into an input, textarea or select (selects match fuzzily). */
  function setField(el, value) {
    if (!el || value === undefined || value === null) return false;
    var v = String(value);
    if (el.tagName === 'SELECT') {
      var opts = Array.prototype.slice.call(el.options);
      var hit = opts.filter(function (o) { return o.value === v || o.textContent.trim() === v; })[0];
      if (!hit) {
        hit = opts.filter(function (o) {
          return o.textContent.trim().toLowerCase().indexOf(v.toLowerCase()) !== -1;
        })[0];
      }
      if (!hit) return false;
      el.value = hit.value;
    } else {
      el.value = v;
    }
    // Let any host-page listener (autosave, preview, validation) see the write.
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function readField(el) {
    if (!el) return '';
    return String(el.value == null ? '' : el.value).trim();
  }

  // ── styles (injected once) ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ai-studio-bar-style')) return;
    var s = document.createElement('style');
    s.id = 'ai-studio-bar-style';
    s.textContent = [
      '.aisb-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}',
      '.aisb-ops{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px}',
      '.aisb-op{appearance:none;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;',
      '  border-radius:8px;padding:7px 12px;border:1px solid rgba(0,74,43,0.25);background:#ffffff;color:#004A2B;line-height:1.2}',
      '.aisb-op:hover:not(:disabled){background:#004A2B;color:#FBF5EA;border-color:#004A2B}',
      '.aisb-op:disabled{opacity:.5;cursor:not-allowed}',
      '.aisb-op.aisb-primary{background:#004A2B;color:#FBF5EA;border-color:#004A2B}',
      '.aisb-op.aisb-primary:hover:not(:disabled){background:#00623a}',
      '.aisb-op.aisb-danger{border-color:rgba(23,23,23,0.2);color:#171717}',
      '.aisb-op.aisb-danger:hover:not(:disabled){background:#171717;color:#FBF5EA;border-color:#171717}',
      '.aisb-media{margin-top:9px;border-top:1px dashed rgba(171,135,67,0.35);padding-top:9px}',
      '.aisb-mlabel{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#7a5f28;font-weight:600;margin-bottom:6px}',
      '.aisb-minput{flex:1 1 200px;min-width:150px;background:#ffffff;border:1px solid rgba(171,135,67,0.28);',
      '  border-radius:8px;color:#171717;padding:7px 10px;font-size:12.5px;font-family:inherit}',
      '.aisb-file{font-size:11.5px;font-family:inherit;color:#4a4a4a;max-width:190px}',
      '.aisb-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
      '.aisb-chip{display:inline-flex;align-items:center;gap:6px;background:rgba(0,74,43,0.08);border:1px solid rgba(0,74,43,0.22);',
      '  border-radius:999px;padding:4px 10px;font-size:11.5px;color:#004A2B;max-width:100%}',
      '.aisb-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px}',
      '.aisb-chip button{appearance:none;border:0;background:transparent;cursor:pointer;color:#004A2B;font-size:14px;line-height:1;padding:0}',
      '.aisb-lp{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#171717;margin-top:10px;',
      '  background:rgba(0,74,43,0.06);border:1px solid rgba(0,74,43,0.18);border-radius:8px;padding:8px 11px}',
      '.aisb-lp input{width:15px;height:15px;accent-color:#004A2B;cursor:pointer;margin:0}',
      '.aisb-lp label{cursor:pointer;margin:0;font-size:12.5px;text-transform:none;letter-spacing:0;color:#171717;font-weight:500}',
      '.aisb-warn{margin-top:8px;background:rgba(171,135,67,0.12);border:1px solid rgba(171,135,67,0.4);border-radius:8px;',
      '  padding:8px 11px;font-size:12px;color:#6b4f16}',
      '.aisb-warn b{display:block;margin-bottom:3px}',
      '.aisb-sugg{margin-top:10px;border-top:1px dashed rgba(171,135,67,0.35);padding-top:9px}',
      '.aisb-sugg-f{margin-bottom:9px}',
      '.aisb-sugg-k{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#7a5f28;font-weight:600;margin-bottom:5px}',
      '.aisb-sugg-o{display:block;width:100%;text-align:left;appearance:none;cursor:pointer;font-family:inherit;font-size:12.5px;',
      '  background:#ffffff;border:1px solid rgba(0,74,43,0.2);border-radius:8px;padding:7px 10px;margin-bottom:5px;color:#171717;line-height:1.35}',
      '.aisb-sugg-o:hover{border-color:#004A2B;background:rgba(0,74,43,0.05)}',
      '.aisb-busy{opacity:.65}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── media attachments ──────────────────────────────────────────────────
  function stateOf(bar) {
    var st = barState.get(bar);
    if (!st) { st = { media: [], brief: '', warnings: [] }; barState.set(bar, st); }
    return st;
  }

  function renderChips(bar) {
    var st = stateOf(bar);
    var host = bar.querySelector('[data-aisb-chips]');
    if (!host) return;
    host.innerHTML = st.media.map(function (m, i) {
      var icon = m.kind === 'video' ? '🎬' : '🖼';
      return '<span class="aisb-chip">' + icon + ' <span title="' + esc(m.label) + '">' + esc(m.label) + '</span>'
        + '<button type="button" data-aisb-rm="' + i + '" aria-label="Remove">×</button></span>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('[data-aisb-rm]'), function (b) {
      b.addEventListener('click', function () {
        st.media.splice(Number(b.getAttribute('data-aisb-rm')), 1);
        renderChips(bar);
      });
    });
  }

  function addMedia(bar, item) {
    var st = stateOf(bar);
    if (st.media.length >= MAX_MEDIA) {
      setStatus(bar, 'Up to ' + MAX_MEDIA + ' references at a time — remove one first.');
      return false;
    }
    st.media.push(item);
    renderChips(bar);
    return true;
  }

  function attachFile(bar, file, kind) {
    if (!file) return;
    if (file.size > UPLOAD_MAX_BYTES) {
      setStatus(bar, 'That ' + kind + ' is ' + mb(file.size) + '. Uploads stop at ' + mb(UPLOAD_MAX_BYTES)
        + ' — paste its URL instead and the server will fetch it (bigger files are fine that way).');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      addMedia(bar, { kind: kind, data_uri: String(reader.result), label: file.name || (kind + ' upload') });
      setStatus(bar, '');
    };
    reader.onerror = function () { setStatus(bar, 'Could not read that file.'); };
    reader.readAsDataURL(file);
  }

  function setStatus(bar, msg) {
    var el = bar.querySelector('[data-ai-status]');
    if (el) el.textContent = msg || '';
  }

  function renderWarnings(bar, warnings) {
    var host = bar.querySelector('[data-aisb-warn]');
    if (!host) return;
    if (!warnings || !warnings.length) { host.innerHTML = ''; host.style.display = 'none'; return; }
    host.style.display = 'block';
    host.innerHTML = '<div class="aisb-warn"><b>Some references were not used:</b>'
      + warnings.map(function (w) { return '<div>· ' + esc(w) + '</div>'; }).join('')
      + '<div style="margin-top:4px">Everything else was generated from the prompt and the references that did read.</div></div>';
  }

  // ── the bar UI ─────────────────────────────────────────────────────────
  function upgrade(bar) {
    if (bar.getAttribute('data-aisb-ready') === '1') return;
    var surface = bar.dataset.surface;
    if (!surface) return;
    bar.setAttribute('data-aisb-ready', '1');

    var cfg = registry[surface] || {};
    var wantsLanding = !!cfg.landing;

    // The host pages ship a "✨ Autofill from prompt" button. This module owns
    // every op now, so that button becomes the Fill op and the rest join it.
    var legacyFill = bar.querySelector('[data-ai-fill]');
    var statusEl = bar.querySelector('[data-ai-status]');

    var block = document.createElement('div');
    block.innerHTML = [
      '<div class="aisb-media">',
      '  <span class="aisb-mlabel">Work from a reference (optional) — an ad, an image, a video, a page</span>',
      '  <div class="aisb-row">',
      '    <input class="aisb-minput" data-aisb-img-url type="url" placeholder="Image URL — an existing ad creative, a product shot">',
      '    <input class="aisb-file" data-aisb-img-file type="file" accept="image/*">',
      '  </div>',
      '  <div class="aisb-row">',
      '    <input class="aisb-minput" data-aisb-vid-url type="url" placeholder="Video URL — an ad, a reel, a YouTube link">',
      '    <input class="aisb-file" data-aisb-vid-file type="file" accept="video/*">',
      '  </div>',
      '  <div class="aisb-chips" data-aisb-chips></div>',
      '</div>',
      wantsLanding
        ? '<div class="aisb-lp"><input type="checkbox" id="aisb-lp-' + esc(surface) + '" data-aisb-lp checked>'
          + '<label for="aisb-lp-' + esc(surface) + '">Also build the matching landing page when this campaign is saved</label></div>'
        : '',
      '<div class="aisb-ops" data-aisb-ops></div>',
      '<div data-aisb-warn style="display:none"></div>',
      '<div data-aisb-sugg></div>',
    ].join('');
    while (block.firstChild) bar.appendChild(block.firstChild);

    // Media URL inputs commit on Enter or on blur, so an operator who types a
    // URL and goes straight for Fill does not lose it.
    function wireUrl(sel, kind) {
      var input = bar.querySelector(sel);
      if (!input) return;
      var commit = function () {
        var v = (input.value || '').trim();
        if (!v) return;
        if (!/^https?:\/\//i.test(v)) { setStatus(bar, 'Reference URLs must start with http:// or https://'); return; }
        if (addMedia(bar, { kind: kind, url: v, label: v.replace(/^https?:\/\//, '').slice(0, 60) })) {
          input.value = '';
          setStatus(bar, '');
        }
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    }
    wireUrl('[data-aisb-img-url]', 'image');
    wireUrl('[data-aisb-vid-url]', 'video');

    var imgFile = bar.querySelector('[data-aisb-img-file]');
    if (imgFile) imgFile.addEventListener('change', function () { attachFile(bar, imgFile.files[0], 'image'); imgFile.value = ''; });
    var vidFile = bar.querySelector('[data-aisb-vid-file]');
    if (vidFile) vidFile.addEventListener('change', function () { attachFile(bar, vidFile.files[0], 'video'); vidFile.value = ''; });

    // Ops. Fill reuses the page's existing button if there is one, so its
    // styling stays consistent with the rest of that page.
    var ops = bar.querySelector('[data-aisb-ops]');
    var OPS = [
      { op: 'fill',    label: '✨ Fill',    title: 'Fill every empty field from the prompt and references', cls: 'aisb-primary' },
      { op: 'suggest', label: '💡 Suggest', title: 'Show three alternative options per copy field, without changing the form' },
      { op: 'new',     label: '🔀 New',     title: 'Write a completely different creative direction' },
      { op: 'enhance', label: '⬆ Enhance',  title: 'Sharpen what is already in the form, keeping its intent' },
      { op: 'clear',   label: '✕ Clear',    title: 'Empty every field on this form', cls: 'aisb-danger' },
    ];
    OPS.forEach(function (o) {
      var btn;
      if (o.op === 'fill' && legacyFill) {
        btn = legacyFill;
        btn.textContent = o.label;
        btn.classList.add('aisb-op', 'aisb-primary');
        if (btn.parentNode) btn.parentNode.removeChild(btn);
      } else {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'aisb-op' + (o.cls ? ' ' + o.cls : '');
        btn.textContent = o.label;
      }
      btn.title = o.title;
      btn.setAttribute('data-aisb-op', o.op);
      ops.appendChild(btn);
      btn.addEventListener('click', function () { runOp(bar, surface, o.op, btn); });
    });
    // The status line belongs after the buttons now that they moved.
    if (statusEl) ops.appendChild(statusEl);
  }

  // ── running an op ──────────────────────────────────────────────────────
  function fieldEls(cfg) {
    var out = {};
    (cfg.keys || []).forEach(function (k) {
      var el = null;
      try { el = cfg.resolve ? cfg.resolve(k) : null; } catch (e) { el = null; }
      if (el) out[k] = el;
    });
    return out;
  }

  function currentValues(cfg) {
    var els = fieldEls(cfg), out = {};
    Object.keys(els).forEach(function (k) {
      var v = readField(els[k]);
      if (v) out[k] = v;
    });
    return out;
  }

  function clearForm(bar, surface) {
    var cfg = registry[surface] || {};
    var els = fieldEls(cfg);
    Object.keys(els).forEach(function (k) {
      var el = els[k];
      // Selects are settings, not copy — resetting them to a blank value would
      // leave the form invalid, so they go back to their first option instead.
      if (el.tagName === 'SELECT') { el.selectedIndex = 0; }
      else { el.value = ''; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    var st = stateOf(bar);
    st.media = [];
    st.brief = '';
    st.warnings = [];
    renderChips(bar);
    renderWarnings(bar, []);
    var sugg = bar.querySelector('[data-aisb-sugg]');
    if (sugg) sugg.innerHTML = '';
    var promptEl = bar.querySelector('[data-ai-prompt]');
    if (promptEl) promptEl.value = '';
    var refEl = bar.querySelector('[data-ai-ref]');
    if (refEl) refEl.value = '';
    setStatus(bar, 'Cleared.');
    if (typeof cfg.onClear === 'function') { try { cfg.onClear(); } catch (e) { /* host problem, not ours */ } }
    bar.dispatchEvent(new CustomEvent('ai-studio:cleared', { bubbles: true, detail: { surface: surface } }));
  }

  function renderSuggestions(bar, surface, suggestions) {
    var cfg = registry[surface] || {};
    var host = bar.querySelector('[data-aisb-sugg]');
    if (!host) return;
    var keys = Object.keys(suggestions || {}).filter(function (k) {
      return Array.isArray(suggestions[k]) && suggestions[k].length;
    });
    if (!keys.length) { host.innerHTML = ''; setStatus(bar, 'No suggestions came back. Try a more specific prompt.'); return; }

    host.innerHTML = '<div class="aisb-sugg">'
      + '<div class="aisb-mlabel">Suggestions — click one to drop it into the field</div>'
      + keys.map(function (k) {
        return '<div class="aisb-sugg-f"><div class="aisb-sugg-k">' + esc(k) + '</div>'
          + suggestions[k].map(function (opt, i) {
            return '<button type="button" class="aisb-sugg-o" data-aisb-k="' + esc(k) + '" data-aisb-i="' + i + '">' + esc(opt) + '</button>';
          }).join('')
          + '</div>';
      }).join('')
      + '</div>';

    Array.prototype.forEach.call(host.querySelectorAll('.aisb-sugg-o'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-aisb-k');
        var v = suggestions[k][Number(b.getAttribute('data-aisb-i'))];
        var el = null;
        try { el = cfg.resolve ? cfg.resolve(k) : null; } catch (e) { el = null; }
        if (!el) { setStatus(bar, 'No field named "' + k + '" on this form.'); return; }
        setField(el, v);
        setStatus(bar, 'Applied to ' + k + '.');
      });
    });
    setStatus(bar, keys.length + ' field' + (keys.length === 1 ? '' : 's') + ' with options — the form was not changed.');
  }

  async function runOp(bar, surface, op, btn) {
    if (op === 'clear') { clearForm(bar, surface); return; }

    var cfg = registry[surface];
    if (!cfg) { setStatus(bar, 'This form has not registered its fields yet — reload the page.'); return; }

    var st = stateOf(bar);
    var promptEl = bar.querySelector('[data-ai-prompt]');
    var refEl = bar.querySelector('[data-ai-ref]');
    var prompt = readField(promptEl);
    var reference_url = readField(refEl);
    var current = currentValues(cfg);

    // Fill from nothing is the one op that genuinely needs a prompt.
    if (op === 'fill' && !prompt && !reference_url && !st.media.length) {
      setStatus(bar, 'Describe what you want, or attach a reference first.');
      return;
    }
    if ((op === 'enhance' || op === 'suggest') && !Object.keys(current).length && !prompt) {
      setStatus(bar, op === 'enhance'
        ? 'Nothing to enhance yet — fill the form first, or use Fill.'
        : 'Nothing to suggest from yet — type a prompt or fill a field.');
      return;
    }

    var market = 'US';
    try { if (typeof cfg.market === 'function') market = cfg.market() || 'US'; } catch (e) { /* default */ }

    var allBtns = bar.querySelectorAll('[data-aisb-op]');
    var orig = btn.textContent;
    Array.prototype.forEach.call(allBtns, function (b) { b.disabled = true; });
    bar.classList.add('aisb-busy');
    btn.textContent = 'Working… (5-30s)';
    setStatus(bar, st.media.length ? 'Reading your ' + st.media.length + ' reference(s)…' : '');
    renderWarnings(bar, []);

    try {
      var r = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'autofill', op: op, surface: surface,
          prompt: prompt, reference_url: reference_url, media: st.media,
          current: current, market: market, region: market,
        }),
      });
      var d = null;
      try { d = await r.json(); } catch (e) { d = null; }
      if (!r.ok || !d || d.ok === false) {
        setStatus(bar, 'Failed: ' + ((d && (d.error || d.detail)) || r.statusText || 'unknown error'));
        return;
      }

      st.warnings = d.reference_warnings || [];
      renderWarnings(bar, st.warnings);
      if (d.landing_page_brief) st.brief = d.landing_page_brief;

      if (op === 'suggest') {
        renderSuggestions(bar, surface, d.suggestions || {});
        bar.dispatchEvent(new CustomEvent('ai-studio:suggested', {
          bubbles: true, detail: { surface: surface, response: d },
        }));
        return;
      }

      var fields = safeJson(d.text != null ? d.text : d) || {};
      var els = fieldEls(cfg);
      var filled = 0;
      Object.keys(els).forEach(function (k) {
        if (fields[k] !== undefined && setField(els[k], fields[k])) filled++;
      });

      var verb = op === 'new' ? 'Wrote a new direction —' : (op === 'enhance' ? 'Enhanced' : 'Filled');
      setStatus(bar, filled
        ? verb + ' ' + filled + ' field' + (filled === 1 ? '' : 's') + '. Review, then save.'
        : 'No matching fields came back. Try a more specific prompt.');

      if (typeof cfg.onApply === 'function') {
        try { cfg.onApply(fields, { op: op, surface: surface, response: d }); } catch (e) { /* host problem */ }
      }
      bar.dispatchEvent(new CustomEvent('ai-studio:applied', {
        bubbles: true, detail: { surface: surface, op: op, fields: fields, response: d },
      }));
    } catch (err) {
      setStatus(bar, 'Error: ' + ((err && err.message) || String(err)));
    } finally {
      Array.prototype.forEach.call(allBtns, function (b) { b.disabled = false; });
      bar.classList.remove('aisb-busy');
      btn.textContent = orig;
    }
  }

  // ── landing pages: every asset ships with the page it points at ────────
  function barFor(surface) {
    return document.querySelector('.ai-bar[data-surface="' + surface + '"]');
  }

  /**
   * Is auto-landing-page on for this surface? Default yes — the toggle only
   * exists on surfaces that registered a `landing` config, and it starts
   * checked, so "save a campaign" means "save a campaign and its page".
   */
  function landingEnabled(surface) {
    var bar = barFor(surface);
    if (!bar) return !!(registry[surface] && registry[surface].landing);
    var box = bar.querySelector('[data-aisb-lp]');
    return box ? !!box.checked : !!(registry[surface] && registry[surface].landing);
  }

  /** The landing-page brief the server derived from the last generation. */
  function lastBrief(surface) {
    var bar = barFor(surface);
    if (!bar) return '';
    return stateOf(bar).brief || '';
  }

  /**
   * Generate the landing page for an asset. Returns { ok, html } or
   * { ok:false, error }. Callers decide what to do with the HTML — the
   * Creative Studio stores it against the campaign record.
   */
  async function generateLandingPage(opts) {
    var o = opts || {};
    var brief = String(o.brief || '').trim();
    if (!brief) return { ok: false, error: 'no brief to build the page from' };
    try {
      var r = await fetch('/api/ai/generate?action=landing-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: brief,
          market: o.market || 'US',
          region: o.market || 'US',
          channel: o.channel || 'landing',
          motion_profile: o.motion_profile || 'immersive-balanced',
        }),
      });
      var d = null;
      try { d = await r.json(); } catch (e) { d = null; }
      if (!r.ok || !d || !d.html) {
        return { ok: false, error: (d && (d.detail || d.error)) || r.statusText || 'generation failed' };
      }
      return { ok: true, html: d.html };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }

  // ── public API ─────────────────────────────────────────────────────────
  function register(surface, cfg) {
    registry[surface] = cfg || {};
    injectStyles();
    var bar = barFor(surface);
    if (bar) upgrade(bar);
  }

  function upgradeAll() {
    injectStyles();
    Array.prototype.forEach.call(document.querySelectorAll('.ai-bar[data-surface]'), upgrade);
  }

  window.AIStudioBar = {
    register: register,
    upgradeAll: upgrade ? upgradeAll : null,
    landingEnabled: landingEnabled,
    lastBrief: lastBrief,
    generateLandingPage: generateLandingPage,
    setField: setField,
    safeJson: safeJson,
    UPLOAD_MAX_BYTES: UPLOAD_MAX_BYTES,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', upgradeAll);
  } else {
    upgradeAll();
  }
})();
