/**
 * funnel-drill.js — one funnel graph, one row-click behaviour, every analytics table.
 *
 * WHY THIS EXISTS
 * The analytics tables were terminal: a row named a channel, a campaign, an ad set
 * or a landing page and there was nowhere to go from it, so answering "and what did
 * that campaign's ad sets do?" meant hunting for another tab and re-filtering by
 * hand. This module makes every row of every analytics table clickable and sends
 * the reader to the NEXT attribution step, carrying the row it was clicked from.
 *
 * THE ONE RULE THAT SHAPES ALL OF IT
 * A drill may only narrow the next step when a join key genuinely exists in the
 * data. Region → channel joins (the market scopes the export). Campaign → ad set
 * joins (ad rows carry `campaign`). A Shopify sales channel does NOT join to an ad
 * platform — nothing in the connected sources ties "Online Store" to Meta — so that
 * drill navigates and says plainly that it could not be narrowed. Silently filtering
 * there would invent an attribution, which is the one thing this project must never
 * do. Every non-joinable edge carries its own reason string; none of them is
 * "no data".
 *
 * A stage with no downstream attribution step (product, cohort retention, the live
 * order feed, the mix cuts) is NOT given a fake successor. Its rows are still
 * clickable and open the row's full record instead, so "every row responds" holds
 * without inventing a funnel edge to satisfy it.
 *
 * Consumers: data-analysis.html (native widget tables), data-analysis-extensions.js
 * (Revenue Analysis + the Live Intelligence tabs), ad-campaigns-master.html.
 */
(function () {
  'use strict';
  if (window.FunnelDrill) return;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function trunc(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function ym(v) { var m = /^(\d{4})-(\d{2})/.exec(String(v || '')); return m ? m[1] + '-' + m[2] : null; }
  function quarterStart(v) {
    var m = /^(\d{4})-(\d{2})/.exec(String(v || ''));
    if (!m) return null;
    var q = Math.floor((Number(m[2]) - 1) / 3) * 3 + 1;
    return m[1] + '-' + (q < 10 ? '0' + q : String(q)) + '-01';
  }

  // ── The funnel graph ──────────────────────────────────────────────────────
  // `next`      the stage a row of this stage drills into (null = no downstream
  //             attribution step exists; the row opens its own record instead).
  // `id(row)`   the value that identifies the row.
  // `join(row)` how the next stage is narrowed, or null when nothing in the data
  //             ties the two together. `why` is required on every null.
  var STAGES = {
    region: {
      key: 'region', label: 'Region', noun: 'region', next: 'channel',
      id: function (r) { return r.region; },
      join: function (r) {
        return { match: 'market', value: String(r.region || '').toUpperCase(),
          note: 'The export is scoped by market, so this drill re-scopes the whole analysis to ' + String(r.region || '').toUpperCase() + '.' };
      },
    },
    channel: {
      key: 'channel', label: 'Sales channel', noun: 'channel', next: 'platform',
      id: function (r) { return r.channel; },
      join: function () { return null; },
      why: 'Nothing in the connected sources ties a Shopify sales channel to an ad platform — orders carry no platform stamp and ad rows carry no sales channel. The platform rows are therefore shown unnarrowed. The link-by-link ledger is where that join is actually made, once both sides are connected.',
    },
    // The ad ACCOUNT. Deliberately not spliced into platform -> campaign: the
    // analytics ads cut carries no account column, so making it a mandatory link
    // would either break that chain or invent a narrowing the rows cannot support.
    // It is an additional entry point, used by the surfaces that DO carry an
    // account (the ads dashboard's account cards, whose ids come from the same
    // registry as the account chips), and it narrows exactly there.
    account: {
      key: 'account', label: 'Ad account', noun: 'ad account', next: 'campaign',
      id: function (r) { return r.account_name || r.account_id || r.account; },
      join: function (r) {
        var v = r.account_id || r.account || r.account_name;
        return { field: 'account', value: v, match: 'equals',
          note: 'Ad rows carry their account id, and op=hierarchy applies it in SQL, so campaigns narrow exactly.' };
      },
    },
    platform: {
      key: 'platform', label: 'Ad platform', noun: 'platform', next: 'campaign',
      id: function (r) { return r.platform; },
      join: function (r) { return { field: 'platform', value: r.platform, match: 'equals', note: 'Ad rows carry their platform, so campaigns narrow exactly.' }; },
    },
    campaign: {
      key: 'campaign', label: 'Campaign', noun: 'campaign', next: 'adset',
      id: function (r) { return r.campaign || r.entity; },
      join: function (r) { return { field: 'campaign', value: r.campaign || r.entity, match: 'equals', note: 'Ad-set rows carry their parent campaign name, so this narrows exactly.' }; },
    },
    adset: {
      key: 'adset', label: 'Ad set / ad group', noun: 'ad set', next: 'ad',
      id: function (r) { return r.adset || r.entity; },
      join: function (r) { return { field: 'adset', value: r.adset || r.entity, match: 'equals', note: 'Ad rows carry their parent ad set, so this narrows exactly.' }; },
    },
    ad: {
      key: 'ad', label: 'Ad / creative', noun: 'ad', next: 'landing_page',
      id: function (r) { return r.entity || r.ad; },
      join: function () { return null; },
      why: 'The ad rows in this cut carry no destination URL, so no ad can be tied to a landing page here. That join is the link-by-link ledger\'s job (Ads Master → Journey), which reads each order\'s own landing_site UTMs against each ad\'s destination.',
      also: { label: 'Open the link-by-link ledger', href: '/ads-master#journey' },
    },
    mailer: {
      key: 'mailer', label: 'Mailer / campaign send', noun: 'mailer', next: 'landing_page',
      id: function (r) { return r.mailer || r.campaign; },
      join: function () { return null; },
      why: 'Mailer rows come from the send platform and landing-page rows from PageDeck; neither carries the other\'s identifier. Tying a send to the page it drove needs the UTM ledger, not a name match.',
      also: { label: 'Open the link-by-link ledger', href: '/ads-master#journey' },
    },
    landing_page: {
      key: 'landing_page', label: 'Landing page', noun: 'landing page', next: 'product',
      id: function (r) { return r.page || r.name; },
      join: function () { return null; },
      why: 'Landing-page analytics report visits and conversions, not the line items in those orders. Nothing in the connected sources says which product a given page sold, so the product rows are shown unnarrowed rather than matched on name.',
    },
    product: {
      key: 'product', label: 'Product', noun: 'product', next: null,
      id: function (r) { return r.product || r.title; },
      why: 'The order line is the last attributable step the connected sources reach. Going further (which creative sold this SKU) needs order-level UTM capture, which is not in this export.',
    },
    product_type: {
      key: 'product_type', label: 'Product type', noun: 'category', next: 'product',
      id: function (r) { return r.product_type || r.type; },
      join: function () { return null; },
      why: 'The product cut carries titles and revenue but no product-type column, so a category cannot narrow it without re-deriving the mapping here — which would be a second, drifting source of truth.',
    },
    month: {
      key: 'month', label: 'Month', noun: 'month', next: 'week',
      id: function (r) { return r.month; },
      join: function (r) { return { field: 'week', value: ym(r.month), match: 'month', note: 'Weeks are keyed by their start date, so this shows the weeks STARTING in ' + esc(r.month) + '. A week straddling the month boundary belongs to the month it starts in.' }; },
    },
    aov_trend: {
      key: 'aov_trend', label: 'AOV month', noun: 'month', next: 'week',
      id: function (r) { return r.month; },
      join: function (r) { return { field: 'week', value: ym(r.month), match: 'month', note: 'Weeks are keyed by their start date, so this shows the weeks starting in ' + esc(r.month) + '.' }; },
    },
    week: {
      key: 'week', label: 'Week', noun: 'week', next: null,
      id: function (r) { return r.week; },
      why: 'The day-of-week cut is aggregated across the whole export, not per week, so a week cannot narrow it. Per-week day splits would have to be recomputed upstream in scripts/build-market-analytics.js.',
    },
    day_of_week: {
      key: 'day_of_week', label: 'Day of week', noun: 'day', next: null,
      id: function (r) { return r.day != null ? r.day : r.dow; },
      why: 'A weekday is a send-timing signal, not a funnel stage: no downstream cut is scoped by it.',
    },
    returning_rate: {
      key: 'returning_rate', label: 'Returning rate month', noun: 'month', next: 'acquisition',
      id: function (r) { return r.month; },
      join: function (r) { return { field: 'month', value: r.month, match: 'equals', note: 'Both series are keyed by month start, so this narrows exactly.' }; },
    },
    discount: {
      key: 'discount', label: 'Discount usage', noun: 'order type', next: null,
      id: function (r) { return r.discounted; },
      why: 'Discount usage is a property of the order, not a stage above it. The product and channel cuts carry no discount flag, so nothing downstream can be scoped by it.',
    },
    new_vs_returning: {
      key: 'new_vs_returning', label: 'New vs returning', noun: 'month', next: 'acquisition',
      id: function (r) { return r.month; },
      join: function (r) { return { field: 'month', value: r.month, match: 'equals', note: 'Both cuts are keyed by month start, so this narrows exactly.' }; },
    },
    acquisition: {
      key: 'acquisition', label: 'Acquisition cohort', noun: 'acquisition month', next: 'cohort_retention',
      id: function (r) { return r.month; },
      join: function (r) { return { field: 'cohort', value: quarterStart(r.month), match: 'equals', note: 'Retention cohorts are quarterly, so this opens the quarter that contains ' + esc(r.month) + '.' }; },
    },
    cohort_retention: {
      key: 'cohort_retention', label: 'Cohort retention', noun: 'cohort', next: null,
      id: function (r) { return r.cohort; },
      why: 'Retention is the outcome the funnel is measured against, so nothing sits below it. What a cohort was sent next is a lifecycle-plan question, not a revenue cut.',
    },
    live_orders: {
      key: 'live_orders', label: 'Live order feed', noun: 'window', next: null,
      id: function (r) { return r.window_days; },
      why: 'This row is the reconciliation total for the whole window, not a dimension. It exists to be compared against the export cuts above, not drilled into.',
    },
    country: {
      key: 'country', label: 'Shipping country', noun: 'country', next: null,
      id: function (r) { return r.country; },
      why: 'Shipping country is a property of the order. The export carries no per-country channel, campaign or product split, so nothing downstream can be scoped by it.',
    },

    // ── Lifecycle and operational stages ────────────────────────────────────
    // These sit beside the money path rather than on it. They are in the graph
    // so their rows behave like every other row, with a real reason attached.
    segment: {
      key: 'segment', label: 'Audience segment', noun: 'segment', next: 'mailer',
      id: function (r) { return r.name || r.id; },
      join: function () { return null; },
      why: 'Segment rows carry a profile count, not the sends they received: nothing in the mirrored Klaviyo data names which campaigns targeted a given segment. Matching on name would be a guess.',
    },
    event: {
      key: 'event', label: 'Event type', noun: 'event', next: 'mailer',
      id: function (r) { return r.event; },
      join: function () { return null; },
      why: 'The event mix is one total per event type across the window and carries no campaign identifier, so it cannot narrow the campaign ledger.',
    },
    experiment: {
      key: 'experiment', label: 'Experiment', noun: 'experiment', next: 'landing_page',
      id: function (r) { return r.name; },
      join: function () { return null; },
      why: 'Experiment names and page names are separate fields from the same export with no shared key, so an experiment cannot be tied to a page here without matching on strings.',
    },
    competitor_page: {
      key: 'competitor_page', label: 'Competitor page', noun: 'page', next: null,
      id: function (r) { return r.page || r.brand; },
      why: 'Our credentials report on our own accounts. Nothing downstream of a competitor page is observable to us, and estimating it would be fabrication in the most damaging place.',
    },
    action_outcome: {
      key: 'action_outcome', label: 'Action', noun: 'action', next: null,
      id: function (r) { return r.action_id || r.id || r.action_type; },
      why: 'An action outcome measures a funnel step; it is not a step in it. Its channel column names where it ran, so open that channel\'s own cut for the money side.',
    },
    connector_run: {
      key: 'connector_run', label: 'Connector run', noun: 'run', next: null,
      id: function (r) { return r.connector_id; },
      why: 'A sync run is plumbing, not attribution. It says whether a source could be read, which is upstream of every cut rather than downstream of any.',
    },
    activity: {
      key: 'activity', label: 'System activity', noun: 'event', next: null,
      id: function (r) { return r.action || r.entity_type; },
      why: 'An audit record is a log line about the system, not a revenue dimension.',
    },
  };

  // Stages that are reached from outside the revenue cuts.
  var ALIASES = { ad_creative: 'ad', adgroup: 'adset', page: 'landing_page', channels: 'channel', products: 'product' };

  function stage(key) {
    if (!key) return null;
    return STAGES[key] || STAGES[ALIASES[key]] || null;
  }
  function next(key) { var s = stage(key); return s && s.next ? stage(s.next) : null; }

  /**
   * What clicking this row should do. Never throws on an unknown stage — an
   * unmapped table gets the record view rather than a broken click.
   */
  function plan(stageKey, row) {
    var from = stage(stageKey);
    var value = from && from.id ? from.id(row || {}) : null;
    if (!from) return { kind: 'detail', from: null, value: null, reason: 'This table is not mapped to a funnel stage, so the row opens its full record.' };
    var to = from.next ? stage(from.next) : null;
    if (!to) return { kind: 'detail', from: from, to: null, value: value, reason: from.why || 'No downstream attribution step exists for this dimension.' };
    var join = from.join ? from.join(row || {}) : null;
    // A join that resolves to nothing is not a join. This catches a row whose
    // key column is blank, which would otherwise filter the next stage down to
    // the rows that happen to be blank too.
    if (join && join.match !== 'market' && (join.value == null || join.value === '')) join = null;
    return {
      kind: 'drill', from: from, to: to, value: value,
      filter: join && join.match !== 'market' ? { field: join.field, value: join.value, match: join.match, from: from.key } : null,
      market: join && join.match === 'market' ? join.value : null,
      joinable: !!join,
      note: join ? join.note : (from.why || 'No join key ties these two stages in the connected sources, so the next step is shown unnarrowed.'),
      also: from.also || null,
      // The label is read BEFORE the click (it is the row's title and the
      // button's aria-label), so an unnarrowed drill has to admit it there —
      // finding out afterwards that the table is unfiltered is how a reader ends
      // up quoting a whole-account number as one channel's.
      label: join
        ? to.label + ' for ' + from.noun + ' ' + trunc(value, 46)
        : to.label + ' — all rows, not narrowed (no join key)',
    };
  }

  /** Does a record survive the accumulated filter chain? */
  function matches(record, filters) {
    if (!filters || !filters.length) return true;
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i];
      if (!f || !f.field) continue;
      var v = record ? record[f.field] : null;
      if (f.match === 'month') { if (ym(v) !== f.value) return false; continue; }
      if (String(v == null ? '' : v).toLowerCase() !== String(f.value == null ? '' : f.value).toLowerCase()) return false;
    }
    return true;
  }

  // ── Presentation ──────────────────────────────────────────────────────────
  // Brand palette only: forest #004A2B, gold #AB8743, ink #171717, cream #FBF5EA.
  // No dark-neutral fills, and every foreground pair here clears WCAG-AA.
  function injectCss() {
    if (document.getElementById('funnel-drill-css')) return;
    var s = document.createElement('style');
    s.id = 'funnel-drill-css';
    s.textContent = [
      'tr.fd-row{cursor:pointer}',
      'tr.fd-row:hover>td{background:#E7F0EB!important}',
      'tr.fd-row:focus-within>td{background:#E7F0EB!important}',
      'tr.fd-row.fd-end{cursor:zoom-in}',
      '.fd-go{border:1px solid #AB8743;background:#FBF5EA;color:#004A2B;border-radius:999px;min-width:26px;height:22px;padding:0 7px;font:800 12px/1 Inter,Arial,sans-serif;cursor:pointer;vertical-align:middle}',
      '.fd-go:hover{background:#004A2B;color:#FBF5EA}',
      '.fd-go:focus-visible{outline:3px solid #AB8743;outline-offset:2px}',
      'td.fd-cell{white-space:nowrap;text-align:right;width:1%}',
      '.fd-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 10px;font-size:12px}',
      '.fd-crumb{display:inline-flex;align-items:center;gap:6px;border:1px solid #AB8743;background:#FBF5EA;color:#004A2B;border-radius:999px;padding:4px 10px;font-weight:700}',
      '.fd-crumb button{border:0;background:transparent;color:#8A682F;font:800 13px/1 Inter,Arial,sans-serif;cursor:pointer;padding:0 0 0 2px}',
      '.fd-crumb button:hover{color:#004A2B}',
      '.fd-crumb.fd-open{background:#004A2B;color:#FBF5EA;border-color:#004A2B}',
      '.fd-sep{color:#8A682F;font-weight:800}',
      '.fd-unjoined{border:1px solid #AB8743;border-left:4px solid #AB8743;background:#FBF5EA;color:#31483B;border-radius:9px;padding:10px 12px;font-size:12.5px;line-height:1.5;margin:10px 0}',
      '.fd-unjoined b{color:#004A2B}',
      '.fd-unjoined a{color:#004A2B}',
      '.fd-modal{position:fixed;inset:0;background:rgba(0,74,43,.42);display:grid;place-items:center;z-index:99999;padding:18px}',
      '.fd-sheet{background:#FFFFFF;border:1px solid #AB8743;border-radius:14px;max-width:620px;width:100%;max-height:82vh;overflow:auto;padding:18px 20px 20px;box-shadow:0 18px 44px rgba(0,74,43,.28)}',
      '.fd-sheet h3{font-family:"Lao MN",Georgia,serif;color:#004A2B;margin:0 0 4px;font-size:19px}',
      '.fd-sheet p{color:#31483B;font-size:12.5px;line-height:1.55;margin:0 0 12px}',
      '.fd-sheet table{width:100%;border-collapse:collapse;font-size:12.5px}',
      '.fd-sheet th,.fd-sheet td{text-align:left;padding:7px 8px;border-bottom:1px solid #D8CCB6;color:#171717;vertical-align:top;overflow-wrap:anywhere}',
      '.fd-sheet th{width:42%;color:#004A2B;font-weight:700;background:#FBF5EA}',
      '.fd-close{border:1px solid #AB8743;background:#004A2B;color:#FBF5EA;border-radius:8px;padding:8px 14px;font:700 12px Inter,Arial,sans-serif;cursor:pointer;margin-top:14px}',
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function labelFor(p) {
    if (p.kind === 'detail') return 'Open the full record for ' + trunc(p.value, 40) + ' (end of the attribution chain)';
    return 'Drill to ' + p.label;
  }

  /**
   * Make every body row of the tables inside `root` clickable.
   *
   * records  the raw objects the rows were rendered from, in render order. The
   *          object is pinned to the <tr> itself, not to its index, so a later
   *          sort (table-sort.js reorders the DOM) cannot mis-address a row.
   * onDrill  (plan, record) => void. Omit and drills fall back to a record view,
   *          which is what a table on a page with nowhere to drill to should do.
   */
  function attach(root, opts) {
    if (!root) return 0;
    opts = opts || {};
    injectCss();
    var records = opts.records || [];
    var wired = 0;
    var tables = root.matches && root.matches('table') ? [root] : root.querySelectorAll('table');
    [].forEach.call(tables, function (tbl) {
      // Not every table here has a <thead>: the host page's own table() emits a
      // bare <table><tr><th>…, so the parser puts the HEADER ROW inside the
      // implicit <tbody>. Walking tBodies[0].rows would hand record 0 to the
      // header and shift every row by one — every drill would open the wrong
      // record. Rows are therefore split on what they contain, not on where the
      // parser filed them.
      var all = tbl.rows ? [].slice.call(tbl.rows) : [];
      var rows = all.filter(function (r) { return r.querySelector('td'); });
      var header = all.filter(function (r) { return !r.querySelector('td') && r.querySelector('th'); })[0] || null;
      rows.forEach(function (tr, i) {
        if (tr.__fdWired) return;
        var rec = records[i];
        if (!rec) return;                       // an empty-state row has no record
        if (tr.cells.length === 1 && tr.cells[0].colSpan > 1) return;
        var p = plan(opts.stage, rec);
        tr.__fdWired = true;
        tr.__fdRecord = rec;
        tr.classList.add('fd-row');
        if (p.kind === 'detail') tr.classList.add('fd-end');
        tr.setAttribute('data-fd-stage', opts.stage || '');
        tr.title = labelFor(p);
        var go = document.createElement('button');
        go.type = 'button';
        go.className = 'fd-go';
        go.textContent = p.kind === 'detail' ? '⋯' : '→';
        go.setAttribute('aria-label', labelFor(p));
        var cell = tr.insertCell(-1);
        cell.className = 'fd-cell';
        cell.appendChild(go);
        function fire(ev) {
          ev.preventDefault();
          ev.stopPropagation();
          if (p.kind === 'drill' && typeof opts.onDrill === 'function') opts.onDrill(p, rec);
          else showRecord(rec, p, opts);
        }
        go.addEventListener('click', fire);
        tr.addEventListener('click', function (ev) {
          // Anything already interactive keeps its own behaviour: the ads tables
          // put a real anchor in the first cell, and swallowing that click would
          // replace a working drill with a different one.
          if (ev.target.closest && ev.target.closest('a,button,input,select,textarea,label')) return;
          fire(ev);
        });
        wired++;
      });
      // The appended action cell needs a header or the column count no longer
      // matches and screen readers announce a phantom column.
      if (wired && header && !header.__fdWired) {
        header.__fdWired = true;
        var th = document.createElement('th');
        th.className = 'fd-cell';
        th.setAttribute('scope', 'col');
        th.innerHTML = '<span style="font-size:9px;letter-spacing:.08em">NEXT</span>';
        header.appendChild(th);
      }
    });
    return wired;
  }

  /** The end-of-chain view: every field the row carries, and why it stops here. */
  function showRecord(rec, p, opts) {
    injectCss();
    var rows = Object.keys(rec || {}).map(function (k) {
      var v = rec[k];
      var shown = (v == null || v === '') ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      return '<tr><th scope="row">' + esc(k.replace(/_/g, ' ')) + '</th><td>' + esc(shown) + '</td></tr>';
    }).join('');
    var title = (p && p.from ? p.from.label : 'Row') + (p && p.value ? ' — ' + trunc(p.value, 60) : '');
    var reason = (p && (p.reason || p.note)) || '';
    var wrap = document.createElement('div');
    wrap.className = 'fd-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', title);
    wrap.innerHTML = '<div class="fd-sheet"><h3>' + esc(title) + '</h3>' +
      (reason ? '<p><b>No next step in the funnel.</b> ' + esc(reason) + '</p>' : '') +
      '<table><tbody>' + rows + '</tbody></table>' +
      ((opts && opts.detailFooter) ? '<p style="margin-top:12px">' + opts.detailFooter + '</p>' : '') +
      '<button type="button" class="fd-close">Close</button></div>';
    function close() { wrap.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    wrap.querySelector('.fd-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('.fd-close').focus();
  }

  /**
   * The trail back up. Each crumb pops the chain to that depth, so a drill is
   * never a one-way trip and the reader can always see what the table in front
   * of them is filtered by.
   */
  function crumbs(chain, onPop) {
    injectCss();
    var el = document.createElement('div');
    el.className = 'fd-crumbs';
    // data-fd-pop is the DEPTH the chain is truncated to when that crumb is
    // clicked: the root crumb is depth 0, crumb i keeps steps 0..i.
    var parts = ['<span class="fd-crumb' + (chain.length ? '' : ' fd-open') + '" data-fd-pop="0" role="button" tabindex="0">All revenue</span>'];
    chain.forEach(function (step, i) {
      var last = i === chain.length - 1;
      parts.push('<span class="fd-sep">→</span>');
      parts.push('<span class="fd-crumb' + (last ? ' fd-open' : '') + '" data-fd-pop="' + (i + 1) + '" role="button" tabindex="0">' +
        esc(step.label) + '<button type="button" aria-label="Remove this drill step and everything after it" data-fd-pop="' + i + '">✕</button></span>');
    });
    el.innerHTML = parts.join('');
    function popFrom(target) {
      var hit = target.closest && target.closest('[data-fd-pop]');
      if (hit) onPop(Number(hit.getAttribute('data-fd-pop')));
    }
    el.addEventListener('click', function (e) { popFrom(e.target); });
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); popFrom(e.target);
    });
    return el;
  }

  /** The banner shown when a drill could not be narrowed. Never says "no data". */
  function unjoinedNotice(p) {
    if (!p || p.joinable) return '';
    return '<div class="fd-unjoined"><b>Not narrowed.</b> ' + esc(p.note || '') +
      (p.also ? ' <a href="' + esc(p.also.href) + '">' + esc(p.also.label) + '</a>.' : '') + '</div>';
  }

  window.FunnelDrill = {
    STAGES: STAGES,
    stage: stage,
    next: next,
    plan: plan,
    matches: matches,
    attach: attach,
    crumbs: crumbs,
    unjoinedNotice: unjoinedNotice,
    showRecord: showRecord,
    injectCss: injectCss,
    _helpers: { ym: ym, quarterStart: quarterStart },
  };
})();
