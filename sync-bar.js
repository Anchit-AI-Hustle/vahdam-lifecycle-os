/* eslint-env browser */
/**
 * sync-bar.js — the shared "how fresh is this, and sync it now" control.
 *
 * WHY THIS EXISTS
 * Every data surface in this app fetched once on load and then sat there. A
 * dashboard that silently ages is worse than one that says it is stale: the
 * figures still look authoritative hours later, so someone acts on yesterday's
 * spend believing it is today's. Fifty of the fifty-six pages had no way to
 * refresh at all short of a browser reload.
 *
 * WHAT IT GUARANTEES
 *   1. EVERY page carries a sync control. A page that registers loaders gets a
 *      real in-place refresh; a page that registers nothing still gets a
 *      cache-bypassing reload, and says so rather than pretending.
 *   2. Freshness is MEASURED, never asserted. The age ticks up from the moment a
 *      fetch actually resolved. There is no stored "fresh as of" string that can
 *      keep claiming freshness after it stops being true — that exact bug shipped
 *      once already (see ads-snowflake-core's partial_day note in CLAUDE.md).
 *   3. A source that returned CACHED or SNAPSHOT data can never render as live.
 *      Loaders report what they actually got; the dot and label follow the worst
 *      source, not the best.
 *   4. Auto-refresh only runs when the tab is visible and the browser is online.
 *      Polling an operator-gated, quota-metered API into a hidden background tab
 *      spends money to update a screen nobody is looking at.
 *
 * HOW A PAGE OPTS IN
 *   LifecycleSync.register({
 *     surface: 'live-ads',                  // unique id
 *     label:   'Live ads',                  // shown in the source list
 *     interval: 60,                         // seconds; 0 = manual only
 *     load: async () => ({ source: 'live', at: Date.now() }),
 *   });
 * `load` may return nothing (treated as live), or {source:'live'|'cached'|
 * 'snapshot'|'unavailable', note}. Throwing marks that source failed — the bar
 * shows the error instead of silently keeping the old timestamp.
 */
(function () {
  'use strict';
  if (window.__VahdamSyncBar) return;
  window.__VahdamSyncBar = true;

  // The frozen 3-Jul snapshot must not grow new chrome.
  if (/\/diff-version(\/|$)/.test(location.pathname)) return;
  // Generated landing pages and mailers are campaign deliverables, not dashboards.
  if (/^\/lp\//.test(location.pathname)) return;

  var SURFACES = [];              // registered loaders
  var lastOk = null;              // ms epoch of the last fully successful sync
  var busy = false;
  var autoOn = true;
  var tickTimer = null, autoTimer = null;
  var lastReport = [];            // [{label, source, note, error}]

  // ── Freshness vocabulary ──────────────────────────────────────────────────
  // 'live' is the only value that may be shown as live. Anything else is named.
  var RANK = { live: 0, cached: 1, snapshot: 2, unavailable: 3, error: 4 };
  function worst(reports) {
    var w = 'live';
    for (var i = 0; i < reports.length; i++) {
      var s = reports[i].error ? 'error' : (reports[i].source || 'live');
      if (RANK[s] == null) s = 'live';
      if (RANK[s] > RANK[w]) w = s;
    }
    return w;
  }
  function ageText(ms) {
    if (ms == null) return 'not synced yet';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 5) return 'synced just now';
    if (s < 60) return 'synced ' + s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return 'synced ' + m + 'm ago';
    var h = Math.floor(m / 60);
    return 'synced ' + h + 'h ' + (m % 60) + 'm ago';
  }
  // Age at which measured data stops being "close to live" and the dot warns.
  function staleAfter() {
    var mins = SURFACES.reduce(function (a, s) { return Math.max(a, s.interval || 0); }, 0);
    return Math.max(120, (mins || 60) * 3) * 1000;
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Chrome ────────────────────────────────────────────────────────────────
  // Fixed bottom-right pill: the LHS rail owns the left edge and page layouts
  // vary far too much across 56 files to inject anything into the flow.
  // Colours are on-palette and contrast-checked: cream text on forest green is
  // 9.61:1, and the amber/red states keep their own text at AA.
  function styles() {
    if (document.getElementById('vh-sync-css')) return;
    var css = [
      '#vh-sync{position:fixed;right:14px;bottom:14px;z-index:120;font-family:Inter,system-ui,sans-serif;',
      '  display:flex;align-items:center;gap:9px;padding:7px 10px 7px 11px;border-radius:999px;',
      '  background:#004A2B;color:#FBF5EA;border:1px solid rgba(171,135,67,0.55);',
      '  box-shadow:0 4px 18px rgba(0,0,0,0.22);font-size:12px;line-height:1;max-width:calc(100vw - 28px)}',
      '#vh-sync.busy{opacity:0.92}',
      '#vh-sync .vh-dotbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;',
'  margin:-6px -4px -6px -6px;padding:0;background:none;border:none;border-radius:50%;cursor:pointer;flex-shrink:0}',
'#vh-sync .vh-dotbtn:hover{background:rgba(251,245,234,0.14)}',
'#vh-sync .vh-dotbtn:focus-visible{outline:2px solid #AB8743;outline-offset:1px}',
'#vh-sync .vh-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#5FD08A;pointer-events:none}',
      '#vh-sync.warn .vh-dot{background:#E9B949}',
      '#vh-sync.bad .vh-dot{background:#F08A7A}',
      '#vh-sync .vh-age{white-space:nowrap;font-variant-numeric:tabular-nums}',
      '#vh-sync .vh-src{white-space:nowrap;opacity:0.82;font-size:11px}',
      '#vh-sync button{font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;color:#FBF5EA;',
      '  background:rgba(251,245,234,0.12);border:1px solid rgba(251,245,234,0.34);border-radius:999px;padding:4px 10px}',
      '#vh-sync button:hover{background:rgba(251,245,234,0.22)}',
      '#vh-sync button:disabled{cursor:progress;opacity:0.65}',
      '#vh-sync button:focus-visible{outline:2px solid #AB8743;outline-offset:1px}',
      '#vh-sync .vh-auto{display:flex;align-items:center;gap:5px;font-size:11px;opacity:0.9;white-space:nowrap}',
      '#vh-sync .vh-auto input{accent-color:#AB8743;margin:0;cursor:pointer}',
      '#vh-sync-panel{position:fixed;right:14px;bottom:58px;z-index:121;width:min(340px,calc(100vw - 28px));',
      '  background:#FBF5EA;color:#2F3A34;border:1px solid rgba(171,135,67,0.5);border-radius:12px;',
      '  box-shadow:0 12px 34px rgba(0,0,0,0.24);padding:12px 13px;font-family:Inter,system-ui,sans-serif;font-size:12.5px}',
      '#vh-sync-panel h4{margin:0 0 8px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#004A2B}',
      '#vh-sync-panel .vh-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid rgba(171,135,67,0.22)}',
      '#vh-sync-panel .vh-row:first-of-type{border-top:none}',
      '#vh-sync-panel .vh-nm{font-weight:600;color:#2F3A34}',
      '#vh-sync-panel .vh-st{white-space:nowrap;font-size:11px;font-weight:700}',
      '#vh-sync-panel .vh-st.live{color:#0a7d33}',
      '#vh-sync-panel .vh-st.cached,#vh-sync-panel .vh-st.snapshot{color:#8a5a00}',
      '#vh-sync-panel .vh-st.unavailable,#vh-sync-panel .vh-st.error{color:#a3251a}',
      '#vh-sync-panel .vh-note{color:#3A453E;font-size:11.5px;margin:2px 0 0;line-height:1.45}',
      '@media print{#vh-sync,#vh-sync-panel{display:none}}',
      '@media (max-width:520px){#vh-sync .vh-src,#vh-sync .vh-auto{display:none}}',
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'vh-sync-css';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  var el = {};
  function mount() {
    if (document.getElementById('vh-sync')) return;
    styles();
    var bar = document.createElement('div');
    bar.id = 'vh-sync';
    bar.innerHTML =
      '<button type="button" class="vh-dotbtn" data-vh="panel" aria-label="Show data sources and sync settings">' +
      '<span class="vh-dot" aria-hidden="true"></span></button>' +
      '<span class="vh-age" role="status" aria-live="polite">not synced yet</span>' +
      '<span class="vh-src"></span>' +
      '<button type="button" data-vh="sync">Sync now</button>' +
      '<label class="vh-auto"><input type="checkbox" data-vh="auto" checked> auto</label>';
    document.body.appendChild(bar);
    el.bar = bar;
    el.dot = bar.querySelector('.vh-dot');
    el.age = bar.querySelector('.vh-age');
    el.src = bar.querySelector('.vh-src');
    el.btn = bar.querySelector('[data-vh="sync"]');
    el.auto = bar.querySelector('[data-vh="auto"]');

    el.btn.addEventListener('click', function () { syncAll('manual'); });
    el.auto.addEventListener('change', function () {
      autoOn = el.auto.checked;
      scheduleAuto();
    });
    // The source list explains WHY the dot is not green.
    el.src.style.cursor = 'pointer';
    el.src.setAttribute('title', 'Show what each source returned');
    el.src.addEventListener('click', togglePanel);
    bar.querySelector('[data-vh="panel"]').addEventListener('click', togglePanel);

    render();
    startTick();
  }

  function togglePanel() {
    var p = document.getElementById('vh-sync-panel');
    if (p) { p.remove(); return; }
    p = document.createElement('div');
    p.id = 'vh-sync-panel';
    var rows = lastReport.length
      ? lastReport.map(function (r) {
        var state = r.error ? 'error' : (r.source || 'live');
        return '<div class="vh-row"><span class="vh-nm">' + esc(r.label) + '</span>' +
          '<span class="vh-st ' + esc(state) + '">' + esc(state) + '</span></div>' +
          (r.error ? '<p class="vh-note">' + esc(r.error) + '</p>'
            : (r.note ? '<p class="vh-note">' + esc(r.note) + '</p>' : ''));
      }).join('')
      : '<p class="vh-note">' + (SURFACES.length
        ? 'Nothing synced yet on this page. Press Sync now.'
        : 'This page registers no live data source, so Sync now reloads it with the browser and service-worker caches bypassed.') + '</p>';
    p.innerHTML = '<h4>Data sources</h4>' + rows +
      (SURFACES.length
        ? '<div class="vh-row" style="margin-top:8px"><label class="vh-nm" style="display:flex;align-items:center;gap:7px;cursor:pointer">' +
          '<input type="checkbox" data-vh="auto2"' + (autoOn ? ' checked' : '') + '> Auto-refresh</label>' +
          '<span class="vh-st">' + esc(autoInterval() + 's') + '</span></div>'
        : '');
    document.body.appendChild(p);
    var a2 = p.querySelector('[data-vh="auto2"]');
    if (a2) a2.addEventListener('change', function () {
      autoOn = a2.checked;
      if (el.auto) el.auto.checked = autoOn;
      scheduleAuto();
    });
    setTimeout(function () {
      document.addEventListener('click', function once(e) {
        if (p.contains(e.target) || (el.bar && el.bar.contains(e.target))) {
          document.addEventListener('click', once, { once: true }); return;
        }
        p.remove();
      }, { once: true });
    }, 0);
  }

  function render() {
    if (!el.bar) return;
    var state = worst(lastReport);
    var aged = lastOk != null && (Date.now() - lastOk) > staleAfter();
    el.bar.classList.toggle('warn', state === 'cached' || state === 'snapshot' || aged);
    el.bar.classList.toggle('bad', state === 'unavailable' || state === 'error');
    el.bar.classList.toggle('busy', busy);
    el.age.textContent = busy ? 'syncing…' : ageText(lastOk);
    if (!SURFACES.length) {
      el.src.textContent = 'page reload';
    } else if (!lastReport.length) {
      el.src.textContent = SURFACES.length + (SURFACES.length === 1 ? ' source' : ' sources');
    } else {
      var live = lastReport.filter(function (r) { return !r.error && (r.source || 'live') === 'live'; }).length;
      el.src.textContent = live + '/' + lastReport.length + ' live';
    }
    var p = document.getElementById('vh-sync-panel');
    if (p) { p.remove(); togglePanel(); }
  }

  function startTick() {
    if (tickTimer) return;
    // One second is enough for a human-readable age and costs nothing.
    tickTimer = setInterval(function () { if (!busy) render(); }, 1000);
  }

  // ── Sync ──────────────────────────────────────────────────────────────────
  async function syncAll(reason) {
    if (busy) return;
    // A page that registered nothing still needs a working control. Say what it
    // does (reload) rather than faking an in-place refresh.
    if (!SURFACES.length) {
      try { await bustCaches(); } catch (_) {}
      var u = new URL(location.href);
      u.searchParams.set('_sync', String(Date.now()));
      location.replace(u.toString());
      return;
    }
    busy = true;
    if (el.btn) el.btn.disabled = true;
    render();
    var reports = await Promise.all(SURFACES.map(async function (s) {
      try {
        var out = await s.load();
        var src = (out && out.source) || 'live';
        return { label: s.label, source: src, note: out && out.note };
      } catch (e) {
        return { label: s.label, source: 'error', error: (e && e.message) || String(e) };
      }
    }));
    lastReport = reports;
    // Only stamp a fresh timestamp when something actually came back. Stamping
    // on failure would make a broken page look freshly synced.
    if (reports.some(function (r) { return !r.error; })) lastOk = Date.now();
    busy = false;
    if (el.btn) el.btn.disabled = false;
    render();
    try {
      document.dispatchEvent(new CustomEvent('lifecycle-synced', { detail: { reason: reason, reports: reports } }));
    } catch (_) {}
    return reports;
  }

  // Drop the service-worker caches for this origin so a reload really re-fetches.
  async function bustCaches() {
    if (!('caches' in window)) return;
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return caches.delete(k); }));
  }

  // The shortest registered interval is what actually governs the cadence.
  function autoInterval() {
    var secs = SURFACES.reduce(function (a, s) { return s.interval ? Math.min(a, s.interval) : a; }, Infinity);
    return isFinite(secs) ? Math.max(20, secs) : 0;
  }
  function scheduleAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (!autoOn || !SURFACES.length) return;
    var secs = autoInterval();
    if (!secs) return;                // every surface is manual-only
    autoTimer = setInterval(function () {
      // Visible + online only: a hidden tab polling a metered API spends quota
      // to refresh a screen nobody is looking at.
      if (document.visibilityState !== 'visible') return;
      if (navigator.onLine === false) return;
      syncAll('auto');
    }, secs * 1000);
  }

  // Coming back to the tab is the moment the numbers are most likely stale — but
  // ONLY catch up if we have synced at least once before.
  //
  // The first version also fired when lastOk was null, which meant it fired on
  // INITIAL page load (a page becoming visible counts). That made every
  // registered page fetch twice on open — once from its own startup code, once
  // from here — doubling calls against metered connectors, and the two runs
  // interleaved: social-media.html's load() clears its error banner on entry, so
  // the second run wiped the banner the first had just set. The page's own
  // startup owns the first fetch; this handler only ever refreshes a stale one.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!SURFACES.length || !autoOn) return;
    if (lastOk == null) return;
    if ((Date.now() - lastOk) > staleAfter()) syncAll('refocus');
  });

  function register(opts) {
    if (!opts || typeof opts.load !== 'function') return;
    var surface = String(opts.surface || ('s' + (SURFACES.length + 1)));
    // Re-registering the same surface replaces it, so a page that re-inits does
    // not accumulate duplicate loaders all hitting the same endpoint.
    SURFACES = SURFACES.filter(function (s) { return s.surface !== surface; });
    SURFACES.push({
      surface: surface,
      label: String(opts.label || surface),
      interval: opts.interval == null ? 60 : Number(opts.interval) || 0,
      load: opts.load,
    });
    mount();
    render();
    scheduleAuto();
  }

  window.LifecycleSync = {
    register: register,
    sync: function () { return syncAll('api'); },
    get lastSyncedAt() { return lastOk; },
    get sources() { return SURFACES.map(function (s) { return s.surface; }); },
    get report() { return lastReport.slice(); },
  };

  // ── Registration queue (load order must not matter) ───────────────────────
  // auth.js is itself `defer`, and it is what injects this module — so a page's
  // INLINE script always runs before window.LifecycleSync exists. Any page-side
  // `if (window.LifecycleSync) register(...)` guard is therefore dead code that
  // fails silently, which is exactly how three pages ended up with only the
  // reload fallback while appearing to be wired.
  //
  // So pages push onto an array instead, dataLayer-style:
  //     (window.__lcSync = window.__lcSync || []).push({surface, label, load});
  // Anything queued before this module loads is drained here, and `push` is then
  // replaced so later pushes register immediately. No guard, no ordering rule.
  var queued = window.__lcSync;
  window.__lcSync = { push: function () { for (var i = 0; i < arguments.length; i++) register(arguments[i]); return 0; } };
  if (Array.isArray(queued)) queued.forEach(function (o) { try { register(o); } catch (_) {} });

  // Also announce readiness, for anything that would rather listen than queue.
  try { document.dispatchEvent(new CustomEvent('lifecycle-sync-ready')); } catch (_) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
