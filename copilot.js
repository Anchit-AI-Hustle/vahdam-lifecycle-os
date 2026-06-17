/* ──────────────────────────────────────────────────────────────────────────
 * copilot.js — VAHDAM AI Agent (app-wide voice assistant)
 *
 * A single, self-contained conversational agent injected on EVERY page by
 * auth.js. Presented as a prominent full-screen popup with:
 *   • chat grounded in the VAHDAM knowledge base (product catalog + brand kit)
 *   • autoplay text-to-speech (speaks replies aloud) with a speech-rate control
 *     and pronunciation fixes
 *   • optional voice input (mic) where the browser supports it
 *
 * Talks to /api/ai/generate (mode:'chat'). No dependency on per-page state, so
 * it works identically on landing-pages, calendar, dashboard, KB, etc.
 *
 * The Mailer Studio keeps its own state-aware dock; this agent stands down
 * there (window.Copilot already defined) to avoid two assistants on one page.
 * ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  if (window.__vahdamAgentBooted) return;
  // Studio has its own native, state-aware copilot dock — don't double up.
  if (window.Copilot && /\/studio|vahdam_mailer_architect/i.test(location.pathname)) return;
  window.__vahdamAgentBooted = true;

  var BRAND = { green: '#004A2B', gold: '#AB8743', ink: '#171717', cream: '#FBF5EA' };

  // ── styles ────────────────────────────────────────────────────────────────
  var css = `
  .vhd-agent-fab{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:62px;height:62px;border-radius:50%;
    border:none;cursor:pointer;background:linear-gradient(135deg,${BRAND.green},#0a6b40);color:${BRAND.cream};
    box-shadow:0 8px 26px rgba(0,74,43,.45);font-size:26px;display:flex;align-items:center;justify-content:center;
    transition:transform .2s, box-shadow .2s;animation:vhdPulse 2.4s infinite}
  .vhd-agent-fab:hover{transform:scale(1.08)}
  @keyframes vhdPulse{0%{box-shadow:0 8px 26px rgba(0,74,43,.45),0 0 0 0 rgba(171,135,67,.55)}
    70%{box-shadow:0 8px 26px rgba(0,74,43,.45),0 0 0 16px rgba(171,135,67,0)}
    100%{box-shadow:0 8px 26px rgba(0,74,43,.45),0 0 0 0 rgba(171,135,67,0)}}
  .vhd-agent-overlay{position:fixed;inset:0;z-index:2147483600;background:rgba(11,20,16,.55);
    backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:18px}
  .vhd-agent-overlay.open{display:flex;animation:vhdFade .2s ease both}
  @keyframes vhdFade{from{opacity:0}to{opacity:1}}
  .vhd-agent-modal{width:min(960px,100%);height:min(88vh,860px);background:${BRAND.cream};border-radius:20px;
    display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5);
    font-family:'Proxima Nova','Helvetica Neue',Arial,sans-serif;animation:vhdRise .25s ease both}
  @keyframes vhdRise{from{transform:translateY(18px) scale(.98);opacity:0}to{transform:none;opacity:1}}
  .vhd-agent-hd{display:flex;align-items:center;gap:11px;padding:16px 20px;color:${BRAND.cream};
    background:linear-gradient(90deg,${BRAND.green},#0a6b40)}
  .vhd-agent-hd .live{width:9px;height:9px;border-radius:50%;background:#4ade80;animation:vhdLive 1.8s infinite}
  @keyframes vhdLive{0%,100%{opacity:1}50%{opacity:.3}}
  .vhd-agent-hd h3{margin:0;font-size:17px;font-weight:700;font-family:'Lao MN','Cormorant Garamond',Georgia,serif;letter-spacing:.2px}
  .vhd-agent-hd .sub{font-size:11px;opacity:.85;margin-top:1px}
  .vhd-agent-hd .sp{margin-left:auto;display:flex;align-items:center;gap:8px}
  .vhd-agent-hd button{background:rgba(255,255,255,.14);border:none;color:${BRAND.cream};cursor:pointer;
    border-radius:8px;padding:7px 10px;font-size:13px;display:inline-flex;align-items:center;gap:6px}
  .vhd-agent-hd button:hover{background:rgba(255,255,255,.26)}
  .vhd-agent-hd button.on{background:${BRAND.gold};color:${BRAND.ink}}
  .vhd-agent-msgs{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:13px;background:#fff}
  .vhd-msg{max-width:80%;padding:12px 16px;border-radius:16px;font-size:14.5px;line-height:1.6;white-space:pre-wrap;
    word-wrap:break-word;animation:vhdFade .2s ease both}
  .vhd-msg.user{align-self:flex-end;background:${BRAND.green};color:${BRAND.cream};border-bottom-right-radius:5px}
  .vhd-msg.bot{align-self:flex-start;background:${BRAND.cream};border:1px solid #e7e1d4;color:${BRAND.ink};border-bottom-left-radius:5px}
  .vhd-msg.typing{display:inline-flex;gap:5px;align-items:center}
  .vhd-msg.typing span{width:7px;height:7px;border-radius:50%;background:#b9b3a4;animation:vhdBar .9s infinite}
  .vhd-msg.typing span:nth-child(2){animation-delay:.15s}.vhd-msg.typing span:nth-child(3){animation-delay:.3s}
  @keyframes vhdBar{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(-5px);opacity:1}}
  .vhd-agent-quick{display:flex;gap:7px;flex-wrap:wrap;padding:0 20px 8px;background:#fff}
  .vhd-agent-quick button{font-size:12px;padding:6px 12px;border-radius:999px;border:1px solid #ddd6c6;
    background:transparent;color:#6b6b60;cursor:pointer}
  .vhd-agent-quick button:hover{border-color:${BRAND.green};color:${BRAND.green}}
  .vhd-agent-bar{display:flex;align-items:center;gap:10px;padding:14px 18px;border-top:1px solid #e7e1d4;background:${BRAND.cream}}
  .vhd-agent-bar input{flex:1;border:1px solid #ddd6c6;border-radius:12px;padding:12px 15px;font:inherit;font-size:14.5px;background:#fff}
  .vhd-agent-bar input:focus{outline:none;border-color:${BRAND.green};box-shadow:0 0 0 3px rgba(0,74,43,.1)}
  .vhd-agent-bar button{border:none;cursor:pointer;border-radius:50%;width:46px;height:46px;flex-shrink:0;
    display:inline-flex;align-items:center;justify-content:center;font-size:17px}
  .vhd-agent-bar .send{background:${BRAND.green};color:${BRAND.cream}}
  .vhd-agent-bar .send:hover{transform:scale(1.07)}
  .vhd-agent-bar .mic{background:#fff;border:1px solid #ddd6c6;color:${BRAND.green}}
  .vhd-agent-bar .mic.rec{background:#e23b3b;color:#fff;border-color:#e23b3b;animation:vhdLive 1s infinite}
  .vhd-agent-rate{display:flex;align-items:center;gap:6px;font-size:11px;color:${BRAND.cream};opacity:.9}
  .vhd-agent-rate input{width:74px}
  @media(max-width:600px){.vhd-agent-modal{height:100%;border-radius:0}.vhd-agent-overlay{padding:0}
    .vhd-msg{max-width:90%}.vhd-agent-hd h3{font-size:15px}.vhd-agent-rate{display:none}}
  `;

  // ── KB grounding: load the public catalog once, build a compact summary ─────
  var KB = { ready: false, summary: '' };
  function regionGuess() {
    var h = (location.hostname || '').toLowerCase();
    if (h.indexOf('uk') === 0 || h.indexOf('.uk') > -1) return 'uk';
    return 'us';
  }
  function loadKB() {
    if (KB.ready) return Promise.resolve(KB);
    var region = regionGuess();
    return fetch('/data/catalog/products_' + region + '.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        var arr = Array.isArray(list) ? list : (list.products || []);
        var cats = {};
        arr.forEach(function (p) {
          var c = p.type || p.collection || (Array.isArray(p.t) ? p.t[0] : p.t) || 'tea';
          cats[c] = (cats[c] || 0) + 1;
        });
        var top = arr.slice(0, 40).map(function (p) { return p.n || p.title || p.name; }).filter(Boolean);
        KB.summary = 'PRODUCT CATALOG (' + region.toUpperCase() + ', ' + arr.length + ' products). '
          + 'Categories: ' + Object.keys(cats).slice(0, 12).join(', ') + '. '
          + 'Sample products: ' + top.slice(0, 30).join('; ') + '.';
        KB.ready = true;
        return KB;
      })
      .catch(function () { KB.ready = true; return KB; });
  }
  function pageName() {
    var p = location.pathname.replace(/\.html$/, '').replace(/^\//, '') || 'home';
    return p;
  }

  // ── text-to-speech ──────────────────────────────────────────────────────
  var synth = window.speechSynthesis, voice = null, autoSpeak = true, rate = 1;
  function pickVoice() {
    if (!synth) return;
    var vs = synth.getVoices() || [];
    voice = vs.find(function (v) { return /en[-_](US|GB)/i.test(v.lang) && /natural|google|samantha|daniel/i.test(v.name); })
      || vs.find(function (v) { return /en[-_](GB|US)/i.test(v.lang); })
      || vs.find(function (v) { return /^en/i.test(v.lang); }) || vs[0] || null;
  }
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
  // Pronunciation fixes so the agent reads brand/marketing terms correctly.
  function speakable(text) {
    return String(text || '')
      .replace(/[*_#`>]/g, '')                       // strip markdown
      .replace(/\bVAHDAM\b/gi, 'Vahdam')
      .replace(/\bCTA\b/g, 'call to action')
      .replace(/\bCRO\b/g, 'C.R.O.')
      .replace(/\bAOV\b/g, 'average order value')
      .replace(/\bRFM\b/g, 'R.F.M.')
      .replace(/\bDTC\b/g, 'D.T.C.')
      .replace(/\bVIP\b/g, 'V.I.P.')
      .replace(/\bUK\b/g, 'U.K.').replace(/\bUS\b/g, 'U.S.').replace(/\bEU\b/g, 'E.U.')
      .replace(/%/g, ' percent').replace(/&/g, ' and ')
      .replace(/\s+/g, ' ').trim();
  }
  function speak(text) {
    if (!synth || !autoSpeak) return;
    try { synth.cancel(); } catch (e) {}
    var u = new SpeechSynthesisUtterance(speakable(text).slice(0, 4000));
    if (voice) u.voice = voice;
    u.rate = rate; u.pitch = 1; u.lang = (voice && voice.lang) || 'en-US';
    try { synth.speak(u); } catch (e) {}
  }
  function stopSpeak() { try { if (synth) synth.cancel(); } catch (e) {} }

  // ── DOM ─────────────────────────────────────────────────────────────────
  var history = [], greeted = false, dom = {};
  var QUICK = ['What can you do here?', 'Ideas for my next campaign', 'Best-selling products to feature', 'Write a subject line for a tea launch'];

  function build() {
    var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

    var fab = document.createElement('button');
    fab.className = 'vhd-agent-fab'; fab.title = 'VAHDAM AI Agent'; fab.setAttribute('aria-label', 'Open VAHDAM AI Agent');
    fab.innerHTML = '&#9685;'; fab.onclick = open;
    document.body.appendChild(fab); dom.fab = fab;

    var ov = document.createElement('div'); ov.className = 'vhd-agent-overlay';
    ov.innerHTML =
      '<div class="vhd-agent-modal" role="dialog" aria-label="VAHDAM AI Agent">'
      + '<div class="vhd-agent-hd"><span class="live"></span>'
      + '<div><h3>VAHDAM AI Agent</h3><div class="sub">Knowledge-base grounded · voice enabled</div></div>'
      + '<div class="sp">'
      + '<div class="vhd-agent-rate" title="Speech rate">🗣<input type="range" min="0.7" max="1.3" step="0.05" value="1" id="vhdRate"></div>'
      + '<button id="vhdSpeakToggle" class="on" title="Autoplay voice">🔊 Voice</button>'
      + '<button id="vhdClose" title="Close">✕</button>'
      + '</div></div>'
      + '<div class="vhd-agent-msgs" id="vhdMsgs"></div>'
      + '<div class="vhd-agent-quick" id="vhdQuick"></div>'
      + '<div class="vhd-agent-bar">'
      + '<button class="mic" id="vhdMic" title="Speak">🎤</button>'
      + '<input id="vhdInput" type="text" autocomplete="off" placeholder="Ask the VAHDAM agent anything…">'
      + '<button class="send" id="vhdSend" aria-label="Send">&#10148;</button>'
      + '</div></div>';
    document.body.appendChild(ov); dom.ov = ov;
    dom.msgs = ov.querySelector('#vhdMsgs');
    dom.quick = ov.querySelector('#vhdQuick');
    dom.input = ov.querySelector('#vhdInput');

    ov.querySelector('#vhdClose').onclick = close;
    ov.querySelector('#vhdSend').onclick = send;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    dom.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
    ov.querySelector('#vhdRate').addEventListener('input', function (e) { rate = parseFloat(e.target.value) || 1; });
    var st = ov.querySelector('#vhdSpeakToggle');
    st.onclick = function () { autoSpeak = !autoSpeak; st.classList.toggle('on', autoSpeak); st.innerHTML = autoSpeak ? '🔊 Voice' : '🔇 Muted'; if (!autoSpeak) stopSpeak(); };
    setupMic(ov.querySelector('#vhdMic'));
  }

  function addMsg(role, text) {
    var d = document.createElement('div'); d.className = 'vhd-msg ' + (role === 'user' ? 'user' : 'bot');
    d.textContent = text; dom.msgs.appendChild(d); dom.msgs.scrollTop = dom.msgs.scrollHeight; return d;
  }
  function typing() {
    var d = document.createElement('div'); d.className = 'vhd-msg bot typing';
    d.innerHTML = '<span></span><span></span><span></span>'; dom.msgs.appendChild(d); dom.msgs.scrollTop = dom.msgs.scrollHeight; return d;
  }
  function greet() {
    if (greeted) return; greeted = true;
    addMsg('bot', "Hi! I'm your VAHDAM AI Agent. I know the product catalog and brand playbook — ask me for campaign ideas, subject lines, copy, product picks, or anything about this tool. I'll speak my answers aloud too.");
    QUICK.forEach(function (t) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = t;
      b.onclick = function () { dom.input.value = t; send(); };
      dom.quick.appendChild(b);
    });
  }

  function open() {
    if (!dom.ov) build();
    greet(); dom.ov.classList.add('open');
    setTimeout(function () { dom.input && dom.input.focus(); dom.msgs && (dom.msgs.scrollTop = dom.msgs.scrollHeight); }, 60);
    loadKB();
  }
  function close() { if (dom.ov) dom.ov.classList.remove('open'); stopSpeak(); try { sessionStorage.setItem('vhdAgentDismissed', '1'); } catch (e) {} }

  async function send() {
    var msg = (dom.input.value || '').trim(); if (!msg) return;
    dom.input.value = ''; addMsg('user', msg); history.push({ role: 'user', content: msg });
    var t = typing();
    try {
      await loadKB();
      var headers = (typeof window._getApiHeaders === 'function') ? window._getApiHeaders() : { 'Content-Type': 'application/json' };
      var res = await fetch('/api/ai/generate', {
        method: 'POST', cache: 'no-store', headers: headers,
        body: JSON.stringify({
          mode: 'chat', message: msg, history: history.slice(-8),
          chat_context: { page: pageName(), kb: KB.summary, app: 'VAHDAM Lifecycle OS' }
        })
      });
      var data = await res.json().catch(function () { return {}; });
      if (t && t.remove) t.remove();
      var reply = ((data && data.text) || '').trim() || "Sorry — I couldn't reach the model just now. Please try again.";
      addMsg('bot', reply); history.push({ role: 'assistant', content: reply });
      speak(reply);
    } catch (e) {
      if (t && t.remove) t.remove(); addMsg('bot', 'Network hiccup — please try again.');
    }
  }

  // ── voice input (mic) where supported ─────────────────────────────────────
  function setupMic(btn) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { btn.style.display = 'none'; return; }
    var rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
    var recording = false;
    rec.onresult = function (e) {
      var txt = e.results[0][0].transcript; dom.input.value = txt;
      btn.classList.remove('rec'); recording = false; send();
    };
    rec.onerror = function () { btn.classList.remove('rec'); recording = false; };
    rec.onend = function () { btn.classList.remove('rec'); recording = false; };
    btn.onclick = function () {
      if (recording) { try { rec.stop(); } catch (e) {} return; }
      stopSpeak(); try { rec.start(); recording = true; btn.classList.add('rec'); } catch (e) {}
    };
  }

  // ── boot: inject + auto-open once per session (prominent) ──────────────────
  function boot() {
    build();
    var dismissed = false; try { dismissed = sessionStorage.getItem('vhdAgentDismissed') === '1'; } catch (e) {}
    if (!dismissed) setTimeout(open, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.VahdamAgent = { open: open, close: close, send: send };
})();
