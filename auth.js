/* eslint-env browser */
/**
 * auth.js — Lifecycle OS shared auth + cross-step navigation header.
 *
 * Drop this <script> into any page in the project. It:
 *   1. Bootstraps the Supabase client from window.__SUPABASE__ (set in HTML head)
 *      OR from the /api/public-config endpoint at runtime.
 *   2. Forces a one-time Google sign-in if no active session.
 *   3. Renders a shared top-bar with cross-step navigation so any stage
 *      can jump to any other stage. The bar lives at the very top of the
 *      document — pages can still render their own headers below.
 *   4. Provides window.LifecycleAuth.{client, session, signOut} for any
 *      page that needs to read the user or query Supabase.
 *
 * Sign-in happens once; session persists in localStorage (Supabase default).
 * Open external links in a new tab; same-app links stay in same tab.
 */
(function () {
  'use strict';

  if (window.__LifecycleAuthBooted) return;
  window.__LifecycleAuthBooted = true;

  // ─── PWA install: register the service worker once per page load ────────
  // This is what makes the address-bar install icon appear in Chrome / Edge
  // (and adds "Add to Home Screen" on iOS/Android) — alongside the manifest.
  //
  // Aggressive update path: every page load, ask the registration to update;
  // if a waiting SW exists, tell it to skipWaiting; once it takes control,
  // reload the page so the user instantly sees the new auth.js / shell.
  // Without this the user had to do a manual "hard reload" to see sidebar
  // changes — we now self-heal the cache on every navigation.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        // Trigger an update check on every page load.
        reg.update().catch(() => {});
        // If a new SW is already waiting (from a previous visit), activate now.
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
        // When a new SW takes over, reload once so the page uses the fresh shell.
        let didReload = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (didReload) return; didReload = true;
          // Defer slightly so any in-flight nav clicks finish.
          setTimeout(() => location.reload(), 50);
        });
        // Listen for "updatefound" → "installed" so we don't sit on a waiting SW.
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('skipWaiting');
            }
          });
        });
      } catch { /* SW registration failed — site still works */ }
    });
  }

  // ─── Brand mark (refreshed: tea leaf with steam + depth gradients) ──
  // Two layered ideas fuse: a symmetric tea-leaf silhouette (the brand)
  // and a subtle V (the monogram) read through the leaf's central vein.
  // Topped with a cream steam curl — fresh brew, lifecycle. Both tile
  // and leaf use linear gradients for depth so the mark reads as crafted
  // rather than flat at any size. Renders cleanly at 22px (mobile bar)
  // and 30px (desktop sidebar).
  const LOGO_SVG = `<svg class="lnav-mark" viewBox="0 0 32 32" aria-label="VAHDAM Lifecycle OS" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="lnav-tile" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#0a6038"/>
        <stop offset="100%" stop-color="#003920"/>
      </linearGradient>
      <linearGradient id="lnav-leaf" x1="0.2" y1="0.1" x2="0.8" y2="0.95">
        <stop offset="0%"   stop-color="#e0b56b"/>
        <stop offset="60%"  stop-color="#b48946"/>
        <stop offset="100%" stop-color="#7d5a25"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8" fill="url(#lnav-tile)"/>
    <!-- Steam curl above the leaf — a slow S-curve in cream -->
    <path d="M 16 5.2 C 17.3 4.3 14.7 3.5 16 2.5" stroke="#FBF5EA" stroke-width="0.85" opacity="0.65" fill="none" stroke-linecap="round"/>
    <!-- Tea-leaf silhouette — symmetric, organic, reads as both leaf and V -->
    <path d="M 16 26.5
             C 10.5 24.8, 7.5 19.5, 7.5 13.5
             C 7.5 11.2, 8.6 9.2, 10.8 8.2
             C 13 9.4, 14.9 12, 16 15.6
             C 17.1 12, 19 9.4, 21.2 8.2
             C 23.4 9.2, 24.5 11.2, 24.5 13.5
             C 24.5 19.5, 21.5 24.8, 16 26.5 Z"
          fill="url(#lnav-leaf)"/>
    <!-- Central vein (the implicit V monogram) -->
    <path d="M 16 9.5 L 16 25.5" stroke="#1a3a28" stroke-width="0.75" opacity="0.55" stroke-linecap="round"/>
    <!-- Two side veins — leaf detail -->
    <path d="M 16 14 Q 13 16 11 19" stroke="#1a3a28" stroke-width="0.55" opacity="0.4" stroke-linecap="round" fill="none"/>
    <path d="M 16 14 Q 19 16 21 19" stroke="#1a3a28" stroke-width="0.55" opacity="0.4" stroke-linecap="round" fill="none"/>
  </svg>`;

  // ─── Information architecture (left-hand sidebar) ───────────────────
  // Flat items render as top-level links; `children` render as an expandable
  // group. `open:true` marks a feature that never requires sign-in.
  // Stroke icons (inherit currentColor). Brand glyphs (Google/Meta/TikTok) live
  // in BRAND below and render in their own official colours.
  const ICONS = {
    home:       '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9h5v-5h4v5h5v-9"/>',
    analysis:   '<path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5"/><rect x="12" y="7" width="3" height="9"/><rect x="17" y="13" width="3" height="3"/>',
    competitor: '<path d="m21 21-4.3-4.3"/><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6"/>',
    mailer:     '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    calendar:   '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    ads:        '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15 8a4 4 0 0 1 0 8"/>',
    landing:    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
    kb:         '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M19 17H6a2 2 0 0 0-2 2"/>',
    discover:   '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/>',
    cohort:     '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9.5" r="2.3"/><path d="M16 14.4c2.6.4 4.5 2.6 4.5 5.6"/>',
    studio:     '<path d="M5 3v4M3 5h4M6 17v4M4 19h4"/><path d="m13 3 2.3 6.7L22 12l-6.7 2.3L13 21l-2.3-6.7L4 12l6.7-2.3z"/>',
    insights:   '<path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 4-6"/><circle cx="7" cy="14" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="13" cy="13" r="1.2"/><circle cx="17" cy="7" r="1.2"/>',
    vahdam:     '<path d="M12 21c-1-5-4-6.5-7-7 0-5 3.5-8 7-9 3.5 1 7 4 7 9-3 .5-6 2-7 7z"/><path d="M12 13c1.5-2 3.5-3 5.5-3.5"/>',
  };
  // Real, full-colour brand glyphs. Each is a complete <svg> with its own
  // viewBox + official brand colours, so Meta / Google / TikTok read as the
  // actual app icons rather than generic line-art.
  const BRAND = {
    google: '<svg viewBox="0 0 24 24" width="18" height="18" class="lnav-ic lnav-brandic"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"/></svg>',
    meta:   '<svg viewBox="0 0 24 24" width="18" height="18" class="lnav-ic lnav-brandic" fill="none" stroke="#0866FF" stroke-width="2.2" stroke-linecap="round"><path d="M2.2 13.6c.9-4.2 2.6-6.6 4.8-6.6 2.8 0 4.3 3.7 6.5 7.2 1.6 2.6 2.8 3.8 4.3 3.8 1.7 0 2.6-1.7 2.6-4.2 0-3.5-1.6-6.6-4-6.6-2.7 0-4.4 3.3-6.6 6.8-1.6 2.5-2.9 4.2-4.6 4.2-1.4 0-2.3-1-2.6-2.4"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" width="18" height="18" class="lnav-ic lnav-brandic"><path fill="#25F4EE" d="M15.3 5.6a4.3 4.3 0 0 1-1-2.6h-1.9v12.4a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.1V11a5.5 5.5 0 1 0 4.3 5.4V8.9a7.3 7.3 0 0 0 3.3 1.2V7.5a4.3 4.3 0 0 1-2.8-1.9z"/><path fill="#FE2C55" d="M17.1 6.4a4.3 4.3 0 0 1-1-2.6h-1.9v12.4a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.1v-2.1a5.5 5.5 0 1 0 4.3 5.4V9.7A7.3 7.3 0 0 0 20 10.9V8.3a4.3 4.3 0 0 1-2.9-1.9z"/><path fill="#FFF" d="M16.2 6a4.3 4.3 0 0 1-1-2.6h-1.9v12.4a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.1V11.4a5.5 5.5 0 1 0 4.3 5.4V9.3a7.3 7.3 0 0 0 3.3 1.2V7.9A4.3 4.3 0 0 1 16.2 6z"/></svg>',
  };
  // ─── Information architecture ───────────────────────────────────────
  // KNOWLEDGE BASE = the reference library: VAHDAM's own assets + competitors',
  // each across Mailers / Meta / Google / TikTok / Landing Pages. Competitor
  // Benchmarking also owns brand DISCOVERY (the old "Mailer Discovery" — now
  // folded in, since discovery is exactly what benchmarking is for).
  // CREATE = where VAHDAM produces its own assets (Mailers studio, Ads, Landing).
  const NAV = [
    { id: 'home',       label: 'Home',          href: '/',               icon: 'home',     match: ['/', '/index.html'] },
    { id: 'agent',      label: 'AI Agent',      href: '/agent',          icon: 'insights', match: ['/agent', '/agent.html'] },
    { id: 'analysis',   label: 'Data Analysis', href: '/dashboard.html', icon: 'analysis', match: ['/dashboard.html', '/analytics'] },
    { id: 'assets',     label: 'Created Assets',href: '/assets',         icon: 'analysis', match: ['/assets', '/assets.html'] },

    { section: 'Knowledge Base' },
    { group: 'VAHDAM', icon: 'vahdam', children: [
      { id: 'kbv-mailers', label: 'Mailers',       href: '/knowledge-base.html#mailers', icon: 'mailer' },
      { id: 'kbv-meta',    label: 'Meta Ads',      href: '/knowledge-base.html#meta',    icon: 'meta' },
      { id: 'kbv-google',  label: 'Google Ads',    href: '/knowledge-base.html#google',  icon: 'google' },
      { id: 'kbv-tiktok',  label: 'TikTok Ads',    href: '/knowledge-base.html#tiktok',  icon: 'tiktok' },
      { id: 'kbv-landing', label: 'Landing Pages', href: '/knowledge-base.html#landing', icon: 'landing' },
    ]},
    { group: 'Competitor Benchmarking', icon: 'competitor', children: [
      { id: 'comp-discover',label: 'Discover Brands',href: '/competitor-benchmarking.html#discover', icon: 'discover' },
      { id: 'comp-mailers', label: 'Mailers',        href: '/competitor-benchmarking.html#mailers',  icon: 'mailer' },
      { id: 'comp-meta',    label: 'Meta Ads',       href: '/competitor-benchmarking.html#meta',     icon: 'meta' },
      { id: 'comp-google',  label: 'Google Ads',     href: '/competitor-benchmarking.html#google',   icon: 'google' },
      { id: 'comp-tiktok',  label: 'TikTok Ads',     href: '/competitor-benchmarking.html#tiktok',   icon: 'tiktok' },
      { id: 'comp-landing', label: 'Landing Pages',  href: '/competitor-benchmarking.html#landing',  icon: 'landing' },
      { id: 'comp-insights',label: 'Insights',       href: '/competitor-benchmarking.html#insights', icon: 'insights' },
      { id: 'comp-intel',   label: 'Intel · Offers', href: '/intel', icon: 'insights', match: ['/intel', '/competitive-intelligence', '/competitive-intelligence.html'] },
    ]},

    { section: 'Create' },
    { group: 'Marketing Mailers', icon: 'mailer', children: [
      { id: 'calendar', label: 'Calendar',           href: '/calendar.html', icon: 'calendar', match: ['/calendar.html', '/plan'] },
      { id: 'cohorts',  label: 'Cohort Definitions', href: '/cohort-definitions.html', icon: 'cohort', match: ['/cohort-definitions.html', '/cohorts'] },
      // Mailer Studio is an OPEN feature — works standalone without sign-in.
      { id: 'studio',   label: 'Mailer Studio',      href: '/studio', open: true, icon: 'studio', match: ['/studio', '/vahdam_mailer_architect_v34.html', '/app', '/mailer'] },
    ]},
    { group: 'Ad Campaigns', icon: 'ads', children: [
      { id: 'ads-cal',     label: 'Calendar',   href: '/ad-campaigns.html#calendar', icon: 'calendar' },
      { id: 'ads-meta',    label: 'Meta Ads',   href: '/ad-campaigns.html#meta',     icon: 'meta' },
      { id: 'ads-google',  label: 'Google Ads', href: '/ad-campaigns.html#google',   icon: 'google' },
      { id: 'ads-tiktok',  label: 'TikTok Ads', href: '/ad-campaigns.html#tiktok',   icon: 'tiktok' },
    ]},
    { group: 'Landing Pages', icon: 'landing', children: [
      { id: 'lp-mailers', label: 'For Mailers',    href: '/landing-pages.html#mailers',  icon: 'mailer' },
      { id: 'lp-meta',    label: 'For Meta Ads',   href: '/landing-pages.html#meta',     icon: 'meta' },
      { id: 'lp-google',  label: 'For Google Ads', href: '/landing-pages.html#google',   icon: 'google' },
      { id: 'lp-tiktok',  label: 'For TikTok Ads', href: '/landing-pages.html#tiktok',   icon: 'tiktok' },
    ]},
  ];

  // Flatten to a list of leaf items for matching / open-page detection.
  function leafItems() {
    const out = [];
    NAV.forEach((n) => {
      if (n.section) return;            // section dividers have no leaf
      if (n.children) n.children.forEach((c) => out.push(c));
      else out.push(n);
    });
    return out;
  }
  // currentStepId: pick the best-matching NAV leaf for the current URL.
  // Priority order:
  //   1. EXACT match on full href (pathname + hash) — distinguishes sub-tabs
  //      like /ad-campaigns.html#calendar from /ad-campaigns.html#google.
  //   2. EXACT match on pathname against `match[]`.
  //   3. EXACT match on pathname against href's pathname part (fallback for
  //      sub-tabs whose container page is open with no hash yet).
  //   4. PREFIX match against `match[]` — but never against `/`.
  function currentStepId() {
    const p = location.pathname.toLowerCase();
    const h = (location.hash || '').toLowerCase();
    const fullHref = p + h;

    // 1. full href exact (preferred for hash sub-tabs)
    for (const s of leafItems()) {
      if (s.href && s.href.toLowerCase() === fullHref) return s.id;
    }
    // 2. match[] exact on pathname
    for (const s of leafItems()) {
      if ((s.match || []).some((m) => p === m)) return s.id;
    }
    // 3. href pathname exact + no hash on URL → first sub-tab of that page
    if (!h) {
      for (const s of leafItems()) {
        if (s.href) {
          const hp = s.href.split('#')[0].toLowerCase();
          if (hp === p) return s.id;
        }
      }
    }
    // 4. match[] prefix (never `/`)
    for (const s of leafItems()) {
      if ((s.match || []).some((m) => m !== '/' && p.startsWith(m + '/'))) return s.id;
    }
    return 'home';
  }
  // Pages that must never gate behind the login wall.
  //
  // Internal tool: we do NOT force a Google sign-in to use any feature. The
  // optional "Sign in" chip stays in the nav (so profiles/Supabase still work
  // when signed in), but no page is blocked by the login wall. This avoids
  // lockouts from external OAuth redirect-URL/domain mismatches. To re-enable
  // forced auth on specific pages later, return `!!(item && item.open)` based
  // on a per-item flag instead of `true`.
  function isOpenPage() {
    return true;
  }

  // ─── Left-hand sidebar (global cross-feature navigation) ────────────
  function injectTopbar(user) {
    if (document.getElementById('lifecycle-nav')) return;
    const cur = currentStepId();
    const svg = (k) => BRAND[k]
      ? BRAND[k]
      : `<svg class="lnav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ''}</svg>`;

    // Build the nav markup. Internal nav stays in the same tab so the back
    // button works naturally; external links elsewhere in the app keep their
    // own target="_blank" where they're declared.
    const linkRow = (item) => {
      const isCur = item.id === cur;
      return `<a class="lnav-link${isCur ? ' active' : ''}" href="${item.href}" data-id="${item.id}" title="${item.label}">
        ${svg(item.icon)}<span class="lnav-txt">${item.label}</span></a>`;
    };
    // Double-layer nav: Tier-1 = top-level features (flat items + group headers),
    // Tier-2 = each feature's sub-sections. Groups are EXPANDED by default so the
    // whole IA — every feature and its sub-sections — is visible at a glance on
    // every page. The caret still lets a user collapse a group.
    const navHtml = NAV.map((n) => {
      if (n.section) return `<div class="lnav-section">${n.section}</div>`;
      if (!n.children) return linkRow(n);
      const groupActive = n.children.some((c) => c.id === cur);
      return `<div class="lnav-group open${groupActive ? ' active-group' : ''}">
        <button class="lnav-ghead" type="button" title="${n.group}">${svg(n.icon)}<span class="lnav-txt">${n.group}</span><svg class="lnav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
        <div class="lnav-gbody">${n.children.map(linkRow).join('')}</div>
      </div>`;
    }).join('');

    const initials = user ? (user.user_metadata?.name || user.email || '?').trim().slice(0, 1).toUpperCase() : '';
    const avatar = user
      ? (user.user_metadata?.avatar_url
          ? `<span class="lnav-avatar"><img src="${user.user_metadata.avatar_url}" alt=""></span>`
          : `<span class="lnav-avatar">${initials}</span>`)
      : '';
    const userHtml = user
      ? `<div class="lnav-user">${avatar}<span class="lnav-uname">${user.user_metadata?.name || user.email}</span>
           <button class="lnav-signout" id="lnav-signout" title="Sign out">⎋</button></div>`
      : `<div class="lnav-user"><a class="lnav-signin" id="lnav-signin" href="/">Sign in</a></div>`;

    const wrap = document.createElement('div');
    wrap.id = 'lifecycle-nav';
    wrap.innerHTML = `
      <style>
        :root { --lsb-w: 248px; }
        @media (min-width: 961px) { body { margin-left: var(--lsb-w) !important; } }
        #lifecycle-nav { font-family: 'Inter', system-ui, sans-serif; }

        /* Mobile top bar — sits in flow (reserves height) so pages flow below. */
        #lifecycle-nav .lnav-mbar {
          display: none; align-items: center; gap: 12px;
          position: sticky; top: 0; z-index: 90; height: 50px; padding: 0 14px;
          background: rgba(7,14,11,0.97); backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(171,135,67,0.18);
        }
        #lifecycle-nav .lnav-burger {
          background: transparent; border: 1px solid rgba(171,135,67,0.25);
          color: #e8ede9; border-radius: 8px; width: 34px; height: 34px;
          font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        #lifecycle-nav .lnav-mbrand { display: flex; align-items: center; gap: 8px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: #AB8743;
          text-transform: uppercase; text-decoration: none; }
        #lifecycle-nav .lnav-mbrand .lnav-mark { width: 22px; height: 22px; flex-shrink: 0; }

        #lifecycle-nav .lnav-backdrop {
          position: fixed; inset: 0; z-index: 109; background: rgba(0,0,0,0.55);
          opacity: 0; pointer-events: none; transition: opacity .2s;
        }
        #lifecycle-nav.open .lnav-backdrop { opacity: 1; pointer-events: auto; }

        /* Sidebar */
        #lifecycle-nav .lnav-side {
          position: fixed; left: 0; top: 0; z-index: 110;
          width: var(--lsb-w); height: 100vh;
          display: flex; flex-direction: column;
          background: #0b1813; border-right: 1px solid rgba(171,135,67,0.18);
          padding: 16px 12px 12px;
        }
        #lifecycle-nav .lnav-brand {
          display: flex; align-items: center; gap: 10px; text-decoration: none;
          padding: 4px 8px 16px; color: #AB8743;
        }
        /* Brand mark — refreshed leaf + steam SVG with gradient depth.
           Hover uses filter brightness so it works with the gradients
           (overriding fill would lose the gradient). */
        #lifecycle-nav .lnav-mark { width: 30px; height: 30px; flex-shrink: 0; display: block; transition: filter .2s, transform .2s; }
        #lifecycle-nav .lnav-brand:hover .lnav-mark,
        #lifecycle-nav .lnav-mbrand:hover .lnav-mark { filter: brightness(1.15) saturate(1.05); transform: translateY(-1px); }
        #lifecycle-nav .lnav-brand .lnav-bt { display: flex; flex-direction: column; line-height: 1.15; }
        #lifecycle-nav .lnav-brand .lnav-bt b { font-family: 'Lora', serif; font-size: 14px; color: #FBF5EA; font-weight: 600; }
        #lifecycle-nav .lnav-brand .lnav-bt small { font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: #AB8743; }
        #lifecycle-nav .lnav-head { display: flex; align-items: center; gap: 6px; }
        #lifecycle-nav .lnav-head .lnav-brand { flex: 1; padding-right: 0; }
        #lifecycle-nav .lnav-collapse {
          flex-shrink: 0; width: 26px; height: 26px; margin-bottom: 16px;
          background: transparent; border: 1px solid rgba(171,135,67,0.22); border-radius: 7px;
          color: #9aaaa1; cursor: pointer; font-size: 14px; line-height: 1;
          display: flex; align-items: center; justify-content: center; transition: all .12s;
        }
        #lifecycle-nav .lnav-collapse:hover { border-color: #AB8743; color: #FBF5EA; }

        /* ── Collapsed (icon-only) rail — desktop only ── */
        @media (min-width: 961px) {
          html.lnav-collapsed #lifecycle-nav .lnav-side { padding-left: 8px; padding-right: 8px; }
          html.lnav-collapsed #lifecycle-nav .lnav-bt,
          html.lnav-collapsed #lifecycle-nav .lnav-txt,
          html.lnav-collapsed #lifecycle-nav .lnav-caret,
          html.lnav-collapsed #lifecycle-nav .lnav-uname { display: none; }
          html.lnav-collapsed #lifecycle-nav .lnav-head { flex-direction: column-reverse; gap: 10px; }
          html.lnav-collapsed #lifecycle-nav .lnav-brand { justify-content: center; padding: 0; }
          html.lnav-collapsed #lifecycle-nav .lnav-link,
          html.lnav-collapsed #lifecycle-nav .lnav-ghead { justify-content: center; padding: 9px 0; }
          html.lnav-collapsed #lifecycle-nav .lnav-gbody { padding-left: 0; margin-left: 0; border-left: none; }
          html.lnav-collapsed #lifecycle-nav .lnav-user { justify-content: center; }
        }

        #lifecycle-nav .lnav-scroll { flex: 1; overflow-y: auto; scrollbar-width: thin; margin: 0 -4px; padding: 0 4px; }
        #lifecycle-nav .lnav-scroll::-webkit-scrollbar { width: 6px; }
        #lifecycle-nav .lnav-scroll::-webkit-scrollbar-thumb { background: rgba(171,135,67,0.25); border-radius: 6px; }

        #lifecycle-nav .lnav-ic { width: 18px; height: 18px; flex-shrink: 0; }
        #lifecycle-nav .lnav-brandic { width: 18px; height: 18px; }
        /* Section divider label (KNOWLEDGE BASE / CREATE) */
        #lifecycle-nav .lnav-section {
          padding: 14px 11px 5px; margin-top: 4px;
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
          color: #6f8278;
        }
        html.lnav-collapsed #lifecycle-nav .lnav-section {
          text-align: center; padding: 10px 0 4px; font-size: 0;
        }
        html.lnav-collapsed #lifecycle-nav .lnav-section::before {
          content: ''; display: inline-block; width: 18px; height: 1px; background: rgba(171,135,67,0.3);
        }
        #lifecycle-nav .lnav-link {
          display: flex; align-items: center; gap: 11px;
          padding: 9px 11px; margin: 2px 0; border-radius: 9px;
          font-size: 13px; color: #9aaaa1; text-decoration: none;
          border: 1px solid transparent; transition: all .12s;
        }
        #lifecycle-nav .lnav-link:hover { color: #e8ede9; background: rgba(171,135,67,0.08); }
        #lifecycle-nav .lnav-link.active {
          color: #FBF5EA; background: rgba(171,135,67,0.16); border-color: rgba(171,135,67,0.35);
        }
        #lifecycle-nav .lnav-link.active .lnav-ic { color: #AB8743; }

        /* Groups */
        #lifecycle-nav .lnav-group { margin: 6px 0 2px; }
        #lifecycle-nav .lnav-ghead {
          width: 100%; display: flex; align-items: center; gap: 11px;
          padding: 9px 11px; border: none; background: transparent; cursor: pointer;
          font-family: inherit; font-size: 13px; color: #cdd8d2; text-align: left; border-radius: 9px;
        }
        #lifecycle-nav .lnav-ghead:hover { background: rgba(171,135,67,0.06); color: #e8ede9; }
        #lifecycle-nav .lnav-group.active-group > .lnav-ghead { color: #FBF5EA; }
        #lifecycle-nav .lnav-group.active-group > .lnav-ghead .lnav-ic { color: #AB8743; }
        #lifecycle-nav .lnav-ghead .lnav-txt { flex: 1; }
        #lifecycle-nav .lnav-caret { width: 15px; height: 15px; color: #5d6e64; transition: transform .18s; }
        #lifecycle-nav .lnav-group.open .lnav-caret { transform: rotate(180deg); }
        #lifecycle-nav .lnav-gbody { display: none; padding-left: 14px; margin-left: 8px; border-left: 1px solid rgba(171,135,67,0.14); }
        #lifecycle-nav .lnav-group.open .lnav-gbody { display: block; }
        #lifecycle-nav .lnav-gbody .lnav-link { font-size: 12.5px; padding: 7px 10px; }

        /* User footer */
        #lifecycle-nav .lnav-user {
          display: flex; align-items: center; gap: 9px; margin-top: 8px;
          padding: 10px 8px 4px; border-top: 1px solid rgba(171,135,67,0.14); font-size: 12px; color: #9aaaa1;
        }
        #lifecycle-nav .lnav-avatar { width: 28px; height: 28px; border-radius: 50%;
          background: linear-gradient(135deg,#AB8743,#004A2B); display: flex; align-items: center; justify-content: center;
          color: #FBF5EA; font-size: 12px; font-weight: 700; overflow: hidden; flex-shrink: 0; }
        #lifecycle-nav .lnav-avatar img { width: 100%; height: 100%; object-fit: cover; }
        #lifecycle-nav .lnav-uname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #lifecycle-nav .lnav-signout { background: transparent; border: 1px solid rgba(171,135,67,0.25);
          color: #9aaaa1; cursor: pointer; padding: 4px 8px; border-radius: 6px; font-size: 13px; flex-shrink: 0; }
        #lifecycle-nav .lnav-signout:hover { border-color: #AB8743; color: #FBF5EA; }
        #lifecycle-nav .lnav-signin { color: #AB8743; text-decoration: none; font-weight: 600; padding: 4px 8px; }

        @media (max-width: 960px) {
          #lifecycle-nav .lnav-mbar { display: flex; }
          #lifecycle-nav .lnav-side { transform: translateX(-100%); transition: transform .22s ease; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
          #lifecycle-nav.open .lnav-side { transform: translateX(0); }
        }
      </style>
      <div class="lnav-mbar">
        <button class="lnav-burger" id="lnav-burger" aria-label="Open navigation">☰</button>
        <a class="lnav-mbrand" href="/">${LOGO_SVG} <span style="margin-left:8px">VAHDAM · Lifecycle OS</span></a>
      </div>
      <div class="lnav-backdrop" id="lnav-backdrop"></div>
      <aside class="lnav-side">
        <div class="lnav-head">
          <a class="lnav-brand" href="/">
            ${LOGO_SVG}
            <span class="lnav-bt"><b>Lifecycle OS</b><small>VAHDAM</small></span>
          </a>
          <button class="lnav-collapse" id="lnav-collapse" type="button" title="Collapse sidebar" aria-label="Collapse sidebar">«</button>
        </div>
        <div class="lnav-scroll">${navHtml}</div>
        ${userHtml}
      </aside>
    `;
    document.body.insertBefore(wrap, document.body.firstChild);
    // Signal to embedded apps (e.g. Mailer Studio) that they're rendering
    // inside the Lifecycle OS shell, so they can hide their own duplicate
    // header / tabs / sign-out chrome.
    document.body.classList.add('lifecycle-os-mode');
    document.documentElement.classList.add('lifecycle-os-mode');

    // Publish --ltb-h (mobile top-bar height, else 0) so each page's own sticky
    // header offsets correctly beneath the bar on small screens.
    const publishHeight = () => {
      const mbar = wrap.querySelector('.lnav-mbar');
      const h = (mbar && getComputedStyle(mbar).display !== 'none')
        ? Math.ceil(mbar.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty('--ltb-h', h + 'px');
    };
    publishHeight();
    requestAnimationFrame(publishHeight);
    window.addEventListener('load', publishHeight);
    if (!window.__ltbResizeHooked) {
      window.__ltbResizeHooked = true;
      window.addEventListener('resize', publishHeight);
    }

    // Group expand/collapse
    wrap.querySelectorAll('.lnav-ghead').forEach((btn) => {
      btn.addEventListener('click', () => btn.parentElement.classList.toggle('open'));
    });

    // Re-apply active state when the URL hash changes (e.g. user clicks
    // sub-tabs on ad-campaigns.html that just flip the hash). No re-render
    // — just toggle the `active` classes so the sidebar mirrors the new
    // sub-tab without losing scroll position or open-group state.
    const refreshActive = () => {
      const cur = currentStepId();
      wrap.querySelectorAll('.lnav-link').forEach((a) => {
        a.classList.toggle('active', a.dataset.id === cur);
      });
      wrap.querySelectorAll('.lnav-group').forEach((g) => {
        const hit = !!g.querySelector('.lnav-link.active');
        g.classList.toggle('active-group', hit);
        if (hit) g.classList.add('open'); // auto-expand the group that owns the active link
      });
    };
    window.addEventListener('hashchange', refreshActive);
    // Also refresh on history navigation (back/forward across hash routes).
    window.addEventListener('popstate', refreshActive);

    // Mobile drawer open/close
    const setOpen = (o) => wrap.classList.toggle('open', o);
    wrap.querySelector('#lnav-burger')?.addEventListener('click', () => setOpen(true));
    wrap.querySelector('#lnav-backdrop')?.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    // Same-tab nav clicks close the drawer.
    wrap.querySelectorAll('.lnav-link').forEach((a) => {
      if (!a.target) a.addEventListener('click', () => setOpen(false));
    });

    // Sign-in / sign-out wiring
    const signinBtn = wrap.querySelector('#lnav-signin');
    if (signinBtn) signinBtn.onclick = (e) => {
      if (window.LifecycleAuth?.client) {
        e.preventDefault();
        window.LifecycleAuth.client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: location.origin + location.pathname },
        });
      }
    };
    const signoutBtn = wrap.querySelector('#lnav-signout');
    if (signoutBtn) signoutBtn.onclick = () => window.LifecycleAuth.signOut();

    // ── Collapse / expand the rail (icon-only), persisted across pages ──
    const COLLAPSE_KEY = 'lifecycle-nav-collapsed';
    const collapseBtn = wrap.querySelector('#lnav-collapse');
    const applyCollapsed = (c) => {
      document.documentElement.classList.toggle('lnav-collapsed', c);
      document.documentElement.style.setProperty('--lsb-w', c ? '64px' : '248px');
      if (collapseBtn) {
        collapseBtn.innerHTML = c ? '»' : '«';
        collapseBtn.title = c ? 'Expand sidebar' : 'Collapse sidebar';
      }
      publishHeight();
    };
    let collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch {}
    applyCollapsed(collapsed);
    if (collapseBtn) collapseBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
      applyCollapsed(collapsed);
    });
  }

  // ─── Login wall ─────────────────────────────────────────────────────
  function injectLoginWall(error) {
    if (document.getElementById('lifecycle-loginwall')) return;
    const wall = document.createElement('div');
    wall.id = 'lifecycle-loginwall';
    wall.innerHTML = `
      <style>
        #lifecycle-loginwall {
          position: fixed; inset: 0; z-index: 9999;
          background: #0a1410;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Inter', system-ui, sans-serif;
          padding: 20px;
        }
        #lifecycle-loginwall .llw-card {
          max-width: 460px; width: 100%;
          background: #0f1d18; border: 1px solid rgba(171,135,67,0.25);
          border-radius: 16px; padding: 40px 36px;
          text-align: center; box-shadow: 0 30px 80px rgba(0,0,0,0.7);
        }
        #lifecycle-loginwall .llw-dot {
          width: 44px; height: 44px; border-radius: 50%;
          background: linear-gradient(135deg, #AB8743, #004A2B);
          margin: 0 auto 18px;
        }
        #lifecycle-loginwall .llw-title {
          font-size: 12px; letter-spacing: 0.22em; color: #AB8743;
          text-transform: uppercase; font-weight: 700;
          margin-bottom: 10px;
        }
        #lifecycle-loginwall h1 {
          font-family: 'Lora','Inter',serif; font-size: 26px;
          color: #FBF5EA; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em;
        }
        #lifecycle-loginwall h1 em { color: #AB8743; font-style: italic; }
        #lifecycle-loginwall p {
          color: #9aaaa1; font-size: 13.5px; line-height: 1.6;
          margin: 0 0 24px;
        }
        #lifecycle-loginwall button {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 10px; padding: 13px 22px;
          background: #FBF5EA; color: #0a1410;
          border: none; border-radius: 9px;
          font-family: inherit; font-size: 14px; font-weight: 600;
          letter-spacing: 0.02em; cursor: pointer;
          width: 100%; transition: opacity .15s;
        }
        #lifecycle-loginwall button:hover  { opacity: 0.92; }
        #lifecycle-loginwall button:disabled { opacity: 0.5; cursor: not-allowed; }
        #lifecycle-loginwall .llw-foot {
          margin-top: 18px; font-size: 11px; color: #5d6e64;
          font-family: 'JetBrains Mono', monospace;
        }
        #lifecycle-loginwall .llw-err {
          color: #f87171; font-size: 12px; padding: 10px;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3);
          border-radius: 8px; margin-bottom: 18px;
        }
        #lifecycle-loginwall .llw-config {
          color: #fbbf24; font-size: 11px; padding: 12px;
          background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.25);
          border-radius: 8px; margin-top: 16px; text-align: left;
          font-family: 'JetBrains Mono', monospace; line-height: 1.6;
        }
      </style>
      <div class="llw-card">
        <div class="llw-dot"></div>
        <div class="llw-title">VAHDAM · Lifecycle OS</div>
        <h1>Sign in to <em>continue</em></h1>
        <p>Used by the retention growth team. Sign in once with your Google account — the session keeps you signed in across Dashboard, Calendar, and Mailer Studio.</p>
        ${error ? `<div class="llw-err">${error}</div>` : ''}
        <button id="llw-btn" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
            <path fill="#FBBC04" d="M5.84 14.1A6.6 6.6 0 0 1 5.47 12c0-.73.13-1.44.36-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.3 9.14 5.38 12 5.38z"/>
          </svg>
          Sign in with Google
        </button>
        <div class="llw-foot">One-time sign-in · Session persists</div>
        ${window.__SUPABASE__?.url ? '' : `
          <div class="llw-config">
            <b>⚠ Supabase not configured yet.</b><br>
            The login wall is rendered, but no Supabase project URL is set.
            Once provisioned, set <code>SUPABASE_URL</code> + <code>SUPABASE_ANON_KEY</code>
            on Vercel and redeploy. Until then, Google sign-in click will be a no-op.
          </div>
        `}
      </div>
    `;
    document.body.appendChild(wall);

    document.getElementById('llw-btn').onclick = async function () {
      const btn = this;
      btn.disabled = true;
      btn.textContent = 'Redirecting to Google…';
      try {
        if (!window.LifecycleAuth.client) {
          btn.textContent = 'Supabase not configured';
          setTimeout(() => { btn.disabled = false; btn.innerHTML = btn.dataset.original || 'Sign in with Google'; }, 1800);
          return;
        }
        const { error } = await window.LifecycleAuth.client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Sign in with Google';
        const err = document.createElement('div');
        err.className = 'llw-err';
        err.textContent = 'Sign-in failed: ' + (e.message || e);
        btn.parentElement.insertBefore(err, btn);
      }
    };
  }

  function removeLoginWall() {
    const w = document.getElementById('lifecycle-loginwall');
    if (w) w.remove();
  }

  // ─── Supabase bootstrap ─────────────────────────────────────────────
  async function loadSupabaseSDK() {
    if (window.supabase?.createClient) return window.supabase;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('failed to load supabase-js'));
      document.head.appendChild(s);
    });
  }

  async function getConfig() {
    if (window.__SUPABASE__?.url && window.__SUPABASE__?.anonKey) return window.__SUPABASE__;
    try {
      const res = await fetch('/api/public-config');
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.supabase?.url && data?.supabase?.anonKey) {
        window.__SUPABASE__ = data.supabase;
        return data.supabase;
      }
    } catch { /* offline mode */ }
    return null;
  }

  async function init() {
    window.LifecycleAuth = {
      client: null,
      session: null,
      user: null,
      signOut: async () => {
        if (window.LifecycleAuth.client) await window.LifecycleAuth.client.auth.signOut();
        window.LifecycleAuth.session = null;
        window.LifecycleAuth.user = null;
        location.reload();
      },
    };

    const config = await getConfig();
    if (!config) {
      // No Supabase configured. On localhost / file:// (dev preview) there is no
      // backend to sign in against, so inject the cross-step top-bar and let the
      // UI run — exactly as the team would see it post-login. Open pages (Mailer
      // Studio) also never gate. In production (a real host) the other steps
      // still require sign-in, so show the wall there.
      const isLocal = location.protocol === 'file:' ||
        /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
      if (isLocal) {
        injectTopbar({ email: 'local@preview', user_metadata: { name: 'Local preview' } });
        return;
      }
      if (isOpenPage()) { injectTopbar(null); return; }
      injectLoginWall();
      return;
    }

    const sdk = await loadSupabaseSDK();
    const client = sdk.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
    window.LifecycleAuth.client = client;

    // Handle the post-OAuth redirect — exchanges the code in the URL for a session.
    if (location.search.includes('code=') || location.hash.includes('access_token=')) {
      try { await client.auth.exchangeCodeForSession(location.href); } catch { /* ignore */ }
      history.replaceState({}, '', location.pathname);
    }

    const { data: { session } } = await client.auth.getSession();
    if (session?.user) {
      window.LifecycleAuth.session = session;
      window.LifecycleAuth.user = session.user;
      injectTopbar(session.user);
      // Keep the Studio frictionless: only prompt for profile on the gated steps.
      if (!isOpenPage()) await maybeShowProfileModal(client, session.user);
    } else if (isOpenPage()) {
      // Open feature (Mailer Studio) — no sign-in required; show nav as guest.
      injectTopbar(null);
    } else {
      injectLoginWall();
    }

    // Listen for sign-in / sign-out and react globally.
    client.auth.onAuthStateChange(async (_event, sess) => {
      window.LifecycleAuth.session = sess;
      window.LifecycleAuth.user = sess?.user || null;
      if (sess?.user) {
        removeLoginWall();
        const existing = document.getElementById('lifecycle-nav');
        if (existing) existing.remove();   // rebuild so the guest "Sign in" becomes the user chip
        injectTopbar(sess.user);
        if (!isOpenPage()) await maybeShowProfileModal(client, sess.user);
      } else {
        const tb = document.getElementById('lifecycle-nav');
        if (tb) tb.remove();
        if (isOpenPage()) injectTopbar(null);   // stay open — no wall on the Studio
        else injectLoginWall();
      }
    });
  }

  // ─── Profile modal — shown EXACTLY ONCE, after the user signs up ────────
  // Requirement: the profile popup appears only the first time a user signs
  // up + logs in. After that it must never auto-appear again — whether they
  // filled it or skipped it, on this device or any other.
  //
  // Source of truth is the server flag app_users.profile_prompted. It is set
  // true the moment the popup is shown for the first time. Subsequent logins,
  // even on a fresh device, read profile_prompted=true and skip the modal.
  // A local-storage flag (per user) is kept as a fast path so we do not even
  // round-trip to the DB on subsequent pages of the same session.
  function shownKey(user) { return 'lifecycle-profile-shown:' + (user?.id || 'anon'); }
  async function maybeShowProfileModal(client, user) {
    let alreadyLocal = false;
    try { alreadyLocal = localStorage.getItem(shownKey(user)) === '1'; } catch {}
    if (alreadyLocal) return;

    let row;
    try {
      const { data, error } = await client
        .from('app_users')
        .select('profile_completed, profile_prompted, name, mobile, region')
        .eq('id', user.id)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') {
        console.warn('[auth.js] app_users not readable:', error.message);
        return;
      }
      row = data;
    } catch (e) {
      console.warn('[auth.js] profile check failed:', e.message);
      return;
    }

    // Server says we have already prompted this user, OR profile is complete →
    // remember locally and never auto-show again.
    if (row?.profile_prompted || row?.profile_completed) {
      try { localStorage.setItem(shownKey(user), '1'); } catch {}
      return;
    }

    // Brand-new signup → show the popup ONCE, and mark prompted on both server
    // and device so it can never reappear on any future login.
    try { localStorage.setItem(shownKey(user), '1'); } catch {}
    client.from('app_users').update({ profile_prompted: true }).eq('id', user.id)
      .then(() => {}, () => {});
    showProfileModal(client, user, row);
  }

  function showProfileModal(client, user, currentRow) {
    if (document.getElementById('lifecycle-profile-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'lifecycle-profile-modal';
    modal.innerHTML = `
      <style>
        #lifecycle-profile-modal {
          position: fixed; inset: 0; z-index: 9000;
          background: rgba(0,0,0,0.72); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
          font-family: 'Inter', system-ui, sans-serif;
        }
        #lifecycle-profile-modal .lpm-card {
          max-width: 460px; width: 100%;
          background: #0f1d18; border: 1px solid rgba(171,135,67,0.25);
          border-radius: 14px; padding: 28px 26px; box-shadow: 0 30px 80px rgba(0,0,0,0.6);
        }
        #lifecycle-profile-modal .lpm-eyebrow { font-size: 11px; letter-spacing: 0.18em; color: #AB8743; text-transform: uppercase; font-weight: 700; margin-bottom: 6px; }
        #lifecycle-profile-modal h2 { font-family: 'Lora','Inter',serif; font-size: 22px; color: #FBF5EA; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
        #lifecycle-profile-modal h2 em { color: #AB8743; font-style: italic; }
        #lifecycle-profile-modal .lpm-sub { color: #9aaaa1; font-size: 13px; line-height: 1.55; margin: 0 0 18px; }
        #lifecycle-profile-modal label { display: block; font-size: 11px; color: #5d6e64; text-transform: uppercase; letter-spacing: 0.1em; margin: 12px 0 5px; font-weight: 600; }
        #lifecycle-profile-modal input, #lifecycle-profile-modal select {
          width: 100%; box-sizing: border-box;
          background: #0a1410; border: 1px solid rgba(171,135,67,0.2); border-radius: 8px;
          color: #e8ede9; padding: 10px 12px; font-size: 13px; font-family: inherit;
        }
        #lifecycle-profile-modal input:focus, #lifecycle-profile-modal select:focus { outline: none; border-color: #AB8743; }
        #lifecycle-profile-modal .lpm-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        #lifecycle-profile-modal .lpm-actions { display: flex; gap: 10px; margin-top: 22px; }
        #lifecycle-profile-modal button { font-family: inherit; font-size: 12.5px; padding: 11px 18px; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; letter-spacing: 0.02em; transition: opacity .15s; }
        #lifecycle-profile-modal .lpm-skip   { background: transparent; color: #9aaaa1; border: 1px solid rgba(171,135,67,0.25); }
        #lifecycle-profile-modal .lpm-skip:hover { color: #e8ede9; }
        #lifecycle-profile-modal .lpm-save   { background: #AB8743; color: #0a1410; flex: 1; }
        #lifecycle-profile-modal .lpm-save:hover { opacity: 0.92; }
        #lifecycle-profile-modal .lpm-foot { font-size: 11px; color: #5d6e64; margin-top: 14px; text-align: center; font-family: 'JetBrains Mono', monospace; }
        #lifecycle-profile-modal .lpm-err { color: #f87171; font-size: 12px; margin-top: 10px; padding: 8px; background: rgba(239,68,68,0.08); border-radius: 6px; }
      </style>
      <div class="lpm-card">
        <div class="lpm-eyebrow">Welcome to Lifecycle OS</div>
        <h2>Tell us a bit about <em>you</em></h2>
        <p class="lpm-sub">Helps us tailor the dashboard, calendar, and mailer suggestions to your region.
          <b>Skip anytime</b> — nothing here is required.</p>

        <label for="lpm-name">Name</label>
        <input id="lpm-name" type="text" placeholder="${(user.user_metadata?.name || '').replace(/"/g, '&quot;')}" value="${(currentRow?.name || user.user_metadata?.name || '').replace(/"/g, '&quot;')}" autocomplete="name">

        <div class="lpm-row">
          <div>
            <label for="lpm-mobile">Mobile</label>
            <input id="lpm-mobile" type="tel" placeholder="+91 98xxx-xxxxx" value="${(currentRow?.mobile || '').replace(/"/g, '&quot;')}" autocomplete="tel">
          </div>
          <div>
            <label for="lpm-region">Region</label>
            <select id="lpm-region">
              <option value="">—</option>
              <option value="IN">India</option>
              <option value="US">United States</option>
              <option value="UK">United Kingdom</option>
              <option value="EU">Europe</option>
              <option value="ME">Middle East</option>
              <option value="AU">Australia</option>
              <option value="CA">Canada</option>
              <option value="JP">Japan</option>
              <option value="SG">Singapore</option>
              <option value="Global">Other / Global</option>
            </select>
          </div>
        </div>

        <div id="lpm-err"></div>
        <div class="lpm-actions">
          <button class="lpm-skip" id="lpm-skip-btn" type="button">Skip for now</button>
          <button class="lpm-save" id="lpm-save-btn" type="button">Save profile</button>
        </div>
        <div class="lpm-foot">Stored only in your app_users row · visible only to you</div>
      </div>
    `;
    document.body.appendChild(modal);

    // Pre-fill region from previous row if any
    if (currentRow?.region) {
      modal.querySelector('#lpm-region').value = currentRow.region;
    }

    const close = () => modal.remove();

    modal.querySelector('#lpm-skip-btn').addEventListener('click', () => {
      // The "shown once" flag was already set in maybeShowProfileModal, so the
      // popup will not auto-appear again. Skipping just closes it; the user can
      // still fill their profile later if a profile entry point is added.
      try { localStorage.setItem(shownKey(user), '1'); } catch {}
      close();
    });

    modal.querySelector('#lpm-save-btn').addEventListener('click', async function () {
      const btn = this;
      btn.disabled = true; btn.textContent = 'Saving…';
      const name   = modal.querySelector('#lpm-name').value.trim()   || null;
      const mobile = modal.querySelector('#lpm-mobile').value.trim() || null;
      const region = modal.querySelector('#lpm-region').value        || null;
      try {
        const { error } = await client.from('app_users').update({
          name, mobile, region,
          profile_completed: true,
        }).eq('id', user.id);
        if (error) throw error;
        close();
      } catch (e) {
        const err = modal.querySelector('#lpm-err');
        err.className = 'lpm-err';
        err.textContent = 'Could not save: ' + (e.message || e);
        btn.disabled = false; btn.textContent = 'Save profile';
      }
    });
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // App-wide AI Agent — inject the shared voice assistant on every page that
  // loads auth.js. Guarded so it loads once; the Studio's own dock stands down
  // for it (see copilot.js). Loaded async so it never blocks the shell.
  try {
    if (!document.querySelector('script[data-vhd-agent]')) {
      var ag = document.createElement('script');
      ag.src = '/copilot.js?v=20260617';
      ag.defer = true; ag.setAttribute('data-vhd-agent', '1');
      (document.body || document.head || document.documentElement).appendChild(ag);
    }
  } catch (e) { /* never break the shell over the agent */ }
})();
