/* eslint-env browser */
/**
 * Vahdam Agent — embeddable widget (Shopify-ready).
 *
 * Drop ONE line into any Shopify theme (theme.liquid, product template, or a
 * collection template) to add a floating voice+chat concierge:
 *
 *   <script src="https://vahdam-marketing-mailers-architect.vercel.app/agent-widget.js"
 *           data-agent="agent_vahdam" defer></script>
 *
 * Per-collection / per-product agents: set data-agent to any agent id from
 * /api/brain?action=agents (e.g. agent_ashwagandha_coffee, agent_chai_collection),
 * or omit it and pass data-collection="Chai" to auto-route.
 * Voice replies use ElevenLabs when configured server-side, else browser TTS.
 */
(function () {
  'use strict';
  if (window.__VahdamAgentWidget) return;
  window.__VahdamAgentWidget = true;

  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var ORIGIN = (script.src && script.src.indexOf('http') === 0) ? script.src.split('/').slice(0, 3).join('/') : '';
  var API = ORIGIN + '/api/brain';
  var AGENT = script.getAttribute('data-agent') || '';
  var COLLECTION = script.getAttribute('data-collection') || '';
  var sessionId = null, history = [], agent = null, open = false;

  var css = '#vah-agent-fab{position:fixed;right:22px;bottom:22px;z-index:99990;width:62px;height:62px;border-radius:50%;background:#004A2B;color:#FBF5EA;border:2px solid #AB8743;box-shadow:0 12px 34px rgba(0,0,0,.3);cursor:pointer;font-size:26px;display:flex;align-items:center;justify-content:center;transition:transform .2s}' +
    '#vah-agent-fab:hover{transform:scale(1.07)}' +
    '#vah-agent-panel{position:fixed;right:22px;bottom:96px;z-index:99991;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 130px));background:#FBF5EA;border:1px solid #AB8743;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;font-family:"Proxima Nova","Helvetica Neue",Arial,sans-serif}' +
    '#vah-agent-panel.open{display:flex}' +
    '#vah-agent-head{background:#004A2B;color:#FBF5EA;padding:14px 16px;display:flex;align-items:center;gap:10px}' +
    '#vah-agent-head b{font-family:"Lao MN",Georgia,serif;font-size:15px;letter-spacing:.04em}' +
    '#vah-agent-head small{display:block;color:#AB8743;font-size:10.5px;letter-spacing:.08em}' +
    '#vah-agent-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}' +
    '.vah-m{max-width:82%;padding:10px 13px;border-radius:13px;font-size:13.5px;line-height:1.55;white-space:pre-wrap}' +
    '.vah-m.u{align-self:flex-end;background:#004A2B;color:#FBF5EA;border-bottom-right-radius:3px}' +
    '.vah-m.a{align-self:flex-start;background:#fff;border:1px solid rgba(171,135,67,.35);color:#171717;border-bottom-left-radius:3px}' +
    '.vah-m.a a{color:#004A2B;font-weight:600}' +
    '#vah-agent-input{display:flex;gap:8px;padding:10px;background:#fff;border-top:1px solid rgba(171,135,67,.3)}' +
    '#vah-agent-input input{flex:1;border:1px solid rgba(171,135,67,.4);border-radius:10px;padding:10px 12px;font-size:13.5px;outline:none;font-family:inherit}' +
    '#vah-agent-input button{border:none;border-radius:10px;padding:0 14px;font-weight:700;cursor:pointer;font-family:inherit}' +
    '#vah-mic{background:#FBF5EA;border:1px solid #AB8743!important;color:#004A2B}' +
    '#vah-mic.on{background:#c0392b;color:#fff}' +
    '#vah-send{background:#004A2B;color:#FBF5EA}';

  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var fab = document.createElement('button'); fab.id = 'vah-agent-fab'; fab.title = 'Talk to a Vahdam expert'; fab.innerHTML = '🎙';
  var panel = document.createElement('div'); panel.id = 'vah-agent-panel';
  panel.innerHTML = '<div id="vah-agent-head"><span style="font-size:20px">🍃</span><div><b id="vah-agent-name">Vahdam Expert</b><small>voice &amp; chat · honest answers</small></div></div>' +
    '<div id="vah-agent-msgs"></div>' +
    '<div id="vah-agent-input"><button id="vah-mic" title="Speak">🎙</button><input id="vah-q" placeholder="Ask about benefits, brewing, value…"><button id="vah-send">→</button></div>';
  document.body.appendChild(fab); document.body.appendChild(panel);

  var msgs = panel.querySelector('#vah-agent-msgs');
  function add(cls, text) {
    var d = document.createElement('div'); d.className = 'vah-m ' + cls;
    d.innerHTML = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https?:\/\/[^\s)]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">view product</a>'; });
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
  }

  function speak(text) {
    var clean = text.replace(/https?:\/\/\S+/g, 'the product page').replace(/[*_#`]/g, '');
    fetch(API + '?action=tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean }) })
      .then(function (r) { if (r.ok && (r.headers.get('content-type') || '').indexOf('audio') > -1) return r.blob(); throw 0; })
      .then(function (b) { new Audio(URL.createObjectURL(b)).play(); })
      .catch(function () {
        if ('speechSynthesis' in window) { var u = new SpeechSynthesisUtterance(clean); window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); }
      });
  }

  function ask(text) {
    if (!text) return;
    add('u', text); history.push({ role: 'user', content: text });
    fetch(API + '?action=agent-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agent ? agent.id : (AGENT || 'agent_vahdam'), session_id: sessionId, message: text, history: history.slice(-10), context: { page: location.href, shopify: true } }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { add('a', 'Sorry — try once more?'); return; }
      sessionId = j.session_id; history.push({ role: 'agent', content: j.reply });
      add('a', j.reply); speak(j.speak || j.reply);
    }).catch(function () { add('a', 'Connection hiccup — try again in a moment.'); });
  }

  var input = panel.querySelector('#vah-q');
  panel.querySelector('#vah-send').onclick = function () { var t = input.value.trim(); input.value = ''; ask(t); };
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var t = input.value.trim(); input.value = ''; ask(t); } });

  var micBtn = panel.querySelector('#vah-mic');
  micBtn.onclick = function () {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { add('a', 'Voice input needs Chrome/Edge — text works everywhere!'); return; }
    var rec = new SR(); rec.lang = 'en-IN'; micBtn.classList.add('on');
    rec.onresult = function (e) { ask(e.results[0][0].transcript); };
    rec.onend = function () { micBtn.classList.remove('on'); };
    rec.onerror = function () { micBtn.classList.remove('on'); };
    rec.start();
  };

  fab.onclick = function () {
    open = !open; panel.classList.toggle('open', open);
    if (open && !agent) {
      fetch(API + '?action=agents').then(function (r) { return r.json(); }).then(function (j) {
        var list = j.agents || [];
        agent = list.find(function (a) { return a.id === AGENT; }) ||
          (COLLECTION && list.find(function (a) { return (a.catalog_scope && (a.catalog_scope.categories || []).indexOf(COLLECTION) > -1); })) ||
          list[0] || { id: 'agent_vahdam', name: 'Vahdam', greeting: 'Namaste! Ask me anything about our teas.' };
        panel.querySelector('#vah-agent-name').textContent = agent.name;
        add('a', agent.greeting || 'Namaste! How can I help?');
      }).catch(function () { agent = { id: 'agent_vahdam', name: 'Vahdam' }; add('a', 'Namaste! Ask me anything about our teas.'); });
    }
  };
})();
