/* =========================================================================
   VAHDAM — Scroll Motion Module
   Ashwagandha Coffee+ (US) landing page

   REPLACES the current global-selector motion layer. Remove the old script
   before including this one, or the two will fight over the same nodes.

   DESIGN RULES ENFORCED BY THIS FILE
   1. Opt-in only. Nothing animates unless it carries a data-vm attribute.
      There is no `section`, no `*`, no descendant-of-body selector anywhere.
   2. No clip-path. No mask-image. Ever. Those were clipping the copy.
   3. Transforms only — transforms do not affect layout, so sections cannot
      overlap. No position:absolute, no flow removal.
   4. Initial hidden state is written by JS, not CSS. If JS fails, the page
      renders fully readable at full opacity.
   5. prefers-reduced-motion: reduce  ->  everything reveals instantly.
   6. Zero colour and zero typography declarations. Brand lock untouched.

   MARKUP CONTRACT
     <section data-vm="hero">            scale + parallax
     <div     data-vm="spiral">          spiral/radial bundling  << INGREDIENTS ONLY
     <ol      data-vm="stagger">         sequential vertical stagger (brewing steps)
     <section data-vm="fade">            opacity only, no transform property emitted
     <section data-vm="fade-up">         opacity + 12px rise
     <ul      data-vm="reviews">         fade-up stagger

   Container types (spiral / stagger / reviews) animate their children.
   By default that is every element child; override with data-vm-item on the
   specific nodes you want to move.

   SECTION MAP FOR THIS PAGE
     Hero / bundle .................. data-vm="hero"
     What's inside (ingredients) .... data-vm="spiral"     <-- the ONLY spiral
     Brewing steps .................. data-vm="stagger"
     2 Cups Daily ................... data-vm="fade-up"
     Supplement Facts ............... data-vm="fade-up"
     Reviews ........................ data-vm="reviews"

   DIAGNOSTIC
     VahdamMotion.audit()   logs any element still carrying clip-path,
                            mask-image or a clipping overflow on text.
   ========================================================================= */

(function (window, document) {
  'use strict';

  var EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

  var PRESET = {
    hero:      { duration: 900, stagger: 0,   scaleFrom: 1.06, parallax: 0.10 },
    spiral:    { duration: 900, stagger: 70,  radius: 150, spin: -38, scaleFrom: 0.86 },
    stagger:   { duration: 620, stagger: 100, shift: 28 },
    reviews:   { duration: 560, stagger: 90,  shift: 20 },
    'fade-up': { duration: 520, stagger: 0,   shift: 12 },
    fade:      { duration: 520, stagger: 0,   shift: 0 }
  };

  var CONTAINER_TYPES = ['spiral', 'stagger', 'reviews'];

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------------
     Stylesheet. One <style> block, no classes added to any element.
     Only opacity and transform are touched.
     --------------------------------------------------------------------- */
  function injectStyles() {
    if (document.getElementById('vahdam-motion-styles')) return;

    var css = [
      /* Transform-driven types. translate3d stays in flow. */
      '[data-vm-move]{',
      '  opacity:var(--vm-o,1);',
      '  transform:translate3d(var(--vm-x,0px),var(--vm-y,0px),0) rotate(var(--vm-r,0deg)) scale(var(--vm-s,1));',
      '  transition:opacity var(--vm-dur,600ms) ' + EASE + ' var(--vm-delay,0ms),',
      '             transform var(--vm-dur,600ms) ' + EASE + ' var(--vm-delay,0ms);',
      '}',
      /* Opacity-only type. No transform property is emitted at all, so no
         stacking context is created and Supplement Facts keeps its layout. */
      '[data-vm-fade]{',
      '  opacity:var(--vm-o,1);',
      '  transition:opacity var(--vm-dur,520ms) ' + EASE + ' var(--vm-delay,0ms);',
      '}',
      /* Hard guarantee against the previous defect. */
      '[data-vm],[data-vm] *{clip-path:none !important;-webkit-mask-image:none !important;mask-image:none !important;}',
      '@media (prefers-reduced-motion: reduce){',
      '  [data-vm-move],[data-vm-fade]{transition:none !important;}',
      '}'
    ].join('\n');

    var style = document.createElement('style');
    style.id = 'vahdam-motion-styles';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  /* --------------------------------------------------------------------- */
  function itemsOf(container) {
    var explicit = container.querySelectorAll('[data-vm-item]');
    if (explicit.length) return Array.prototype.slice.call(explicit);
    return Array.prototype.slice.call(container.children);
  }

  function setVars(el, vars) {
    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) {
        el.style.setProperty(k, vars[k]);
      }
    }
  }

  /* Hidden state. Written by JS so no-JS renders fully visible. */
  function hide(el, type, index, total) {
    var p = PRESET[type] || PRESET['fade-up'];

    if (type === 'fade') {
      el.setAttribute('data-vm-fade', '');
      setVars(el, { '--vm-o': '0', '--vm-dur': p.duration + 'ms' });
      return;
    }

    el.setAttribute('data-vm-move', '');

    var vars = {
      '--vm-o': '0',
      '--vm-dur': p.duration + 'ms',
      '--vm-delay': (p.stagger * index) + 'ms'
    };

    if (type === 'spiral') {
      /* Golden-angle distribution reads as a bundle drawing itself in,
         rather than a mechanical clock face. */
      var theta = index * 2.39996323;
      var ring = p.radius * (0.55 + 0.45 * (total > 1 ? index / (total - 1) : 0));
      vars['--vm-x'] = Math.cos(theta) * ring + 'px';
      vars['--vm-y'] = Math.sin(theta) * ring + 'px';
      vars['--vm-r'] = p.spin + 'deg';
      vars['--vm-s'] = String(p.scaleFrom);
    } else if (type === 'hero') {
      vars['--vm-s'] = String(p.scaleFrom);
      vars['--vm-y'] = '0px';
    } else {
      vars['--vm-y'] = p.shift + 'px';
    }

    setVars(el, vars);
  }

  function reveal(el) {
    setVars(el, {
      '--vm-o': '1',
      '--vm-x': '0px',
      '--vm-y': '0px',
      '--vm-r': '0deg',
      '--vm-s': '1'
    });
    el.setAttribute('data-vm-state', 'in');
  }

  /* --------------------------------------------------------------------- */
  function initParallax(hero) {
    var strength = PRESET.hero.parallax;
    var ticking = false;

    function frame() {
      var rect = hero.getBoundingClientRect();
      var progress = -rect.top * strength;
      hero.style.setProperty('--vm-y', progress.toFixed(2) + 'px');
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(frame);
    }, { passive: true });
  }

  /* --------------------------------------------------------------------- */
  function init() {
    injectStyles();

    var roots = document.querySelectorAll('[data-vm]');
    if (!roots.length) return;

    var targets = [];

    Array.prototype.forEach.call(roots, function (root) {
      var type = root.getAttribute('data-vm');
      if (!PRESET[type]) {
        console.warn('[VahdamMotion] unknown data-vm value:', type, root);
        return;
      }

      if (CONTAINER_TYPES.indexOf(type) !== -1) {
        var kids = itemsOf(root);
        kids.forEach(function (kid, i) {
          hide(kid, type, i, kids.length);
        });
        targets.push({ root: root, nodes: kids });
      } else {
        hide(root, type, 0, 1);
        targets.push({ root: root, nodes: [root] });
      }
    });

    if (reduceMotion || !('IntersectionObserver' in window)) {
      targets.forEach(function (t) { t.nodes.forEach(reveal); });
      return;
    }

    var pending = targets.length;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var match = targets.filter(function (t) { return t.root === entry.target; })[0];
        if (match && !match.done) { match.done = true; pending--; match.nodes.forEach(reveal); }
        io.unobserve(entry.target);
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });

    targets.forEach(function (t) { io.observe(t.root); });

    /* Fail-safe: a short element at the very end of the page can sit entirely
       inside the -8% bottom margin when the page is scrolled to its maximum,
       so its observer can never fire and the user cannot scroll further to
       make it fire. At max scroll, reveal whatever is still pending — content
       must never be permanently invisible. */
    function onScrollEnd() {
      if (!pending) { window.removeEventListener('scroll', onScrollEnd); return; }
      var doc = document.documentElement;
      var atBottom = window.innerHeight + window.pageYOffset >= doc.scrollHeight - 2;
      if (!atBottom) return;
      targets.forEach(function (t) {
        if (t.done) return;
        var rect = t.root.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          t.done = true; pending--; io.unobserve(t.root); t.nodes.forEach(reveal);
        }
      });
      if (!pending) window.removeEventListener('scroll', onScrollEnd);
    }
    window.addEventListener('scroll', onScrollEnd, { passive: true });

    var hero = document.querySelector('[data-vm="hero"]');
    if (hero) initParallax(hero);
  }

  /* ---------------------------------------------------------------------
     audit() — run in the console to find leftovers from the old motion layer.
     --------------------------------------------------------------------- */
  function audit() {
    var offenders = [];
    Array.prototype.forEach.call(document.querySelectorAll('body *'), function (el) {
      var cs = window.getComputedStyle(el);
      var hasText = el.textContent && el.textContent.trim().length > 0;
      var clipped = (cs.clipPath && cs.clipPath !== 'none') ||
                    (cs.maskImage && cs.maskImage !== 'none') ||
                    (cs.webkitMaskImage && cs.webkitMaskImage !== 'none');
      if (hasText && clipped) {
        offenders.push({ el: el, clipPath: cs.clipPath, maskImage: cs.maskImage });
      }
    });

    if (!offenders.length) {
      console.log('[VahdamMotion] audit clean — no clip-path or mask on text nodes.');
    } else {
      console.warn('[VahdamMotion] ' + offenders.length + ' text node(s) still clipped:');
      console.table(offenders);
    }
    return offenders;
  }

  window.VahdamMotion = { init: init, audit: audit, PRESET: PRESET };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window, document);
