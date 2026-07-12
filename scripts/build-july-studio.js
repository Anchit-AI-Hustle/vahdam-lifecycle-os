#!/usr/bin/env node
'use strict';

/**
 * build-july-studio.js — assemble the VAHDAM USA July calendar + mailer studio
 * (vahdam-usa-july-calendar-mailer-studio.html, served at /july-studio).
 *
 * Reads the manifest (data/calendar/usa-july-2026.json) and every generated
 * mailer file (mailers/usa-july/*.html), then emits ONE self-contained studio
 * page that embeds each variant's exact HTML. Preview renders the embedded file
 * verbatim (iframe srcdoc) and Download hands back the byte-identical file, so
 * "preview = the exact downloadable file" holds even opened offline.
 *
 * Layout: Scenario tabs (A/B/C, C = executed model), a row-per-send calendar,
 * each row expands to the four variant tabs (Text A/B, Text+Visual A/B) with a
 * live preview, a download button, and the data-grounded reasoning.
 *
 * Usage: node scripts/build-july-studio.js  (run after build-july-mailers.js)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function main() {
  const manifestPath = path.join(ROOT, 'data', 'calendar', 'usa-july-2026.json');
  if (!fs.existsSync(manifestPath)) { console.error('Run scripts/build-july-mailers.js first.'); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Inline each variant's exact HTML keyed by file path.
  const htmlByFile = {};
  for (const slot of manifest.slots) {
    for (const v of slot.variants) {
      const abs = path.join(ROOT, v.file);
      htmlByFile[v.file] = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '<p>missing</p>';
    }
  }

  const DATA = JSON.stringify({ manifest, htmlByFile }).replace(/</g, '\\u003c');

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VAHDAM USA July · Calendar + Mailer Studio</title>
<style>
  :root{--green:#004A2B;--gold:#AB8743;--ink:#171717;--cream:#FBF5EA;--line:#e6dcc7;--muted:#7a6e5a;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--cream);color:var(--ink);font-family:'Proxima Nova','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;}
  a{color:var(--green);}
  header.top{background:var(--green);color:var(--cream);padding:26px 22px;}
  header.top .brand{font-family:'Lao MN','Cormorant Garamond',Georgia,serif;letter-spacing:.32em;font-size:22px;font-weight:700;}
  header.top .sub{color:var(--gold);letter-spacing:.24em;text-transform:uppercase;font-size:11px;margin-top:6px;}
  header.top h1{font-family:'Lao MN','Cormorant Garamond',Georgia,serif;font-weight:700;font-size:27px;margin:14px 0 4px;}
  header.top p{margin:0;color:#d8e3db;font-size:14px;max-width:760px;line-height:1.6;}
  .wrap{max-width:1120px;margin:0 auto;padding:22px;}
  .stats{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0;}
  .stat{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px 18px;min-width:150px;}
  .stat b{display:block;font-family:'Lao MN',Georgia,serif;font-size:26px;color:var(--green);}
  .stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;}
  .scenarios{display:flex;gap:8px;margin:8px 0 4px;flex-wrap:wrap;}
  .scenario{border:1px solid var(--line);background:#fff;border-radius:20px;padding:8px 16px;cursor:pointer;font-size:13px;color:var(--muted);}
  .scenario.active{background:var(--green);color:var(--cream);border-color:var(--green);}
  .scenario-note{background:#fff;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:6px;padding:12px 16px;font-size:13.5px;color:#4a4235;margin:6px 0 18px;line-height:1.6;}
  .row{background:#fff;border:1px solid var(--line);border-radius:10px;margin-bottom:12px;overflow:hidden;}
  .rhead{display:grid;grid-template-columns:88px 128px 1fr 120px 40px;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;}
  .rhead:hover{background:#fbf8f0;}
  .date{font-family:'Lao MN',Georgia,serif;color:var(--green);font-size:15px;}
  .date small{display:block;color:var(--muted);font-family:inherit;font-size:11px;letter-spacing:.06em;text-transform:uppercase;}
  .badge{display:inline-block;background:#eef3ef;color:var(--green);border:1px solid #cfe0d5;border-radius:14px;padding:3px 10px;font-size:11.5px;font-weight:600;white-space:nowrap;}
  .prod{font-size:14px;}
  .prod .play{display:block;color:var(--muted);font-size:12px;margin-top:3px;}
  .event{font-size:11.5px;color:#8a5a12;background:#faf1df;border:1px solid #ecd9b6;border-radius:12px;padding:3px 9px;display:inline-block;}
  .price{color:var(--green);font-weight:700;font-size:14px;text-align:right;}
  .chev{color:var(--gold);text-align:center;font-size:18px;transition:transform .15s;}
  .row.open .chev{transform:rotate(90deg);}
  .body{display:none;border-top:1px solid var(--line);padding:16px;background:#fbf8f0;}
  .row.open .body{display:block;}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
  @media(max-width:820px){.grid{grid-template-columns:1fr;}.rhead{grid-template-columns:70px 1fr 34px;}.rhead .event,.rhead .price{display:none;}}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}
  .tab{border:1px solid var(--line);background:#fff;border-radius:6px;padding:6px 11px;cursor:pointer;font-size:12px;color:var(--muted);}
  .tab.active{background:var(--ink);color:#fff;border-color:var(--ink);}
  .tab .ty{font-size:10px;display:block;color:inherit;opacity:.7;}
  .preview{background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden;}
  .pv-bar{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line);font-size:12px;gap:8px;}
  .pv-bar .subj{color:var(--ink);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .dl{background:var(--gold);color:var(--ink);border:none;border-radius:5px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap;}
  iframe{width:100%;height:520px;border:0;display:block;background:#fff;}
  .reason h4{margin:0 0 8px;font-family:'Lao MN',Georgia,serif;color:var(--green);font-size:16px;}
  .reason dl{margin:0;font-size:13px;line-height:1.55;}
  .reason dt{color:var(--gold);text-transform:uppercase;letter-spacing:.06em;font-size:10.5px;margin-top:9px;font-weight:700;}
  .reason dd{margin:2px 0 0;color:#3f382c;}
  .assetnote{font-size:11px;color:var(--muted);margin-top:10px;border-top:1px dashed var(--line);padding-top:8px;}
  footer{color:var(--muted);font-size:12px;padding:24px 22px;text-align:center;}
</style>
</head>
<body>
<header class="top">
  <div class="brand">VAHDAM</div>
  <div class="sub">Lifecycle OS · USA</div>
  <h1>July Calendar + Mailer Studio</h1>
  <p>Every send below is generated through the automated mailer-calendar pipeline: four variants per slot (Text A/B, Text + Visual A/B), rendered by the shared brand-compliant renderer and scrubbed against the brand banned-phrase list. Hero images are pulled only from origin-validated <code>brand_assets</code> — no fabricated URLs.</p>
</header>
<div class="wrap">
  <div class="stats" id="stats"></div>
  <div class="scenarios" id="scenarios"></div>
  <div class="scenario-note" id="scenarioNote"></div>
  <div id="rows"></div>
</div>
<footer>VAHDAM Lifecycle OS · US market (www.vahdamteas.com) · Scenario C executed model · assets origin-validated against the VAHDAM allowlist.</footer>

<script id="data" type="application/json">${DATA}</script>
<script>
(function(){
  var D = JSON.parse(document.getElementById('data').textContent);
  var M = D.manifest, H = D.htmlByFile;

  var SCEN = [
    {k:'A', label:'Scenario A · Conservative', note:'Conservative cadence: ~1 email/user/week, one mailer/day. Lower pressure, protects deliverability. Shown for comparison — not the executed plan.'},
    {k:'B', label:'Scenario B · Balanced', note:'Balanced cadence: ~2 emails/user/week. A middle path between reach and fatigue. Shown for comparison — not the executed plan.'},
    {k:'C', label:'Scenario C · Executed', note:'Executed model: 2-3 emails/user/week, multiple mailers/day allowed across cohorts. This July calendar (12 cohort sends, ' + M.slots.length + ' rows) is built to Scenario C.'}
  ];
  var active = 'C';

  var evCount = M.slots.filter(function(s){return s.event;}).length;
  var cohorts = {}; M.slots.forEach(function(s){cohorts[s.segment]=1;});
  document.getElementById('stats').innerHTML =
    stat(M.slots.length,'Cohort sends') + stat(M.slots.length*4,'Mailer variants') +
    stat(Object.keys(cohorts).length,'Cohorts') + stat(evCount,'Event tie-ins') +
    stat(M.slots.filter(function(s){return s.hero_asset && s.hero_asset.status==='verified';}).length,'Verified hero images');
  function stat(n,l){return '<div class="stat"><b>'+n+'</b><span>'+l+'</span></div>';}

  var sc = document.getElementById('scenarios');
  SCEN.forEach(function(s){
    var el=document.createElement('div'); el.className='scenario'+(s.k===active?' active':''); el.textContent=s.label;
    el.onclick=function(){active=s.k;render();}; sc.appendChild(el);
  });

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function download(file, subject){
    var blob=new Blob([H[file]||''],{type:'text/html'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=file.split('/').pop(); a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);},1500);
  }

  function render(){
    document.querySelectorAll('.scenario').forEach(function(el,i){el.classList.toggle('active',SCEN[i].k===active);});
    document.getElementById('scenarioNote').textContent = SCEN.filter(function(s){return s.k===active;})[0].note;
    var rows=document.getElementById('rows'); rows.innerHTML='';
    M.slots.forEach(function(slot,idx){ rows.appendChild(rowEl(slot,idx)); });
  }

  function rowEl(slot,idx){
    var row=document.createElement('div'); row.className='row';
    var d=new Date(slot.date+'T00:00:00');
    var dow=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];
    var head=document.createElement('div'); head.className='rhead';
    head.innerHTML =
      '<div class="date">'+slot.date.slice(8)+' Jul<small>'+dow+'</small></div>'+
      '<div><span class="badge">'+esc(slot.segment)+'</span></div>'+
      '<div class="prod">'+esc(slot.product)+'<span class="play">'+esc(slot.play)+(slot.event?' · <span class="event">'+esc(slot.event)+'</span>':'')+'</span></div>'+
      '<div class="price">'+esc(slot.price||'')+'</div>'+
      '<div class="chev">›</div>';
    head.onclick=function(){ row.classList.toggle('open'); if(row.classList.contains('open')&&!row.dataset.built){ buildBody(row,slot); row.dataset.built='1'; } };
    row.appendChild(head);
    var body=document.createElement('div'); body.className='body'; row.appendChild(body);
    return row;
  }

  function buildBody(row,slot){
    var body=row.querySelector('.body');
    var grid=document.createElement('div'); grid.className='grid';

    // Left: variant tabs + preview
    var left=document.createElement('div');
    var tabs=document.createElement('div'); tabs.className='tabs';
    var pv=document.createElement('div'); pv.className='preview';
    var bar=document.createElement('div'); bar.className='pv-bar';
    var subj=document.createElement('div'); subj.className='subj';
    var dl=document.createElement('a'); dl.className='dl'; dl.textContent='Download .html'; dl.href='javascript:void(0)';
    bar.appendChild(subj); bar.appendChild(dl);
    var frame=document.createElement('iframe'); frame.setAttribute('sandbox','allow-same-origin');
    pv.appendChild(bar); pv.appendChild(frame);

    function show(v){
      tabs.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('active',t.dataset.key===v.key);});
      frame.srcdoc = H[v.file]||'';
      subj.textContent = v.subject;
      dl.onclick=function(){ download(v.file, v.subject); };
    }
    slot.variants.forEach(function(v,i){
      var t=document.createElement('div'); t.className='tab'+(i===2?' active':''); t.dataset.key=v.key;
      t.innerHTML=esc(v.label.split(' · ')[1]||v.label)+'<span class="ty">'+esc(v.type)+(v.has_image?'':' · text-only')+'</span>';
      t.onclick=function(){show(v);}; tabs.appendChild(t);
    });
    left.appendChild(tabs); left.appendChild(pv);

    // Right: reasoning (the calendar's "why")
    var r=slot.reasoning||{};
    var right=document.createElement('div'); right.className='reason';
    right.innerHTML='<h4>Why this send</h4><dl>'+
      dd('Who (cohort)',r.who)+dd('What',r.what)+dd('How it works',r.how)+
      dd('Hypothesis',r.hypothesis)+dd('Expected impact',r.expected)+
      '</dl><div class="assetnote">Hero asset: '+(slot.hero_asset&&slot.hero_asset.status==='verified'?('verified · origin-validated<br>'+esc(slot.hero_asset.url||'')):'placeholder (rendered image-free — no fabricated URL)')+'<br>CTA → '+esc(slot.cta_url)+'</div>';
    function dd(k,v){return v?('<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>'):'';}

    grid.appendChild(left); grid.appendChild(right);
    body.appendChild(grid);
    show(slot.variants[2]); // default to Text + Visual A
  }

  render();
})();
</script>
</body>
</html>`;

  const out = path.join(ROOT, 'vahdam-usa-july-calendar-mailer-studio.html');
  fs.writeFileSync(out, page);
  const kb = Math.round(page.length / 1024);
  console.log(`✓ wrote vahdam-usa-july-calendar-mailer-studio.html (${kb} KB, ${manifest.slots.length} rows, embedded ${Object.keys(htmlByFile).length} mailers)`);
}

main();
