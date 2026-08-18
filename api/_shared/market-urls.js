'use strict';

/**
 * market-urls — the ONE market → storefront map.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * There were nine copies of this map (api/ai/pipeline/html.js twice,
 * _shared/jarvis.js, _shared/review-recovery.js, _shared/brain-core.js,
 * _shared/calendar-trigger.js, scripts/lib/landing-page.js,
 * scripts/seed-smart-products.js, plus three front-end pages). They had drifted
 * apart, and — worse — most of them pointed at hosts that DO NOT RESOLVE.
 *
 * Every one of those copies carried a comment saying "VERIFIED, per CLAUDE.md".
 * The claim of verification is precisely what stopped anyone re-checking, and
 * CLAUDE.md's own "Market-Specific Store URLs (VERIFIED)" table was wrong on
 * four of six entries. A brand-contract document supplied later repeated the
 * same four wrong URLs, which is how an error like this propagates: it gets
 * copied into the thing you would check it against.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ACTUALLY MEASURED (2026-08-13, HTTP HEAD/GET following redirects)
 *
 *   https://www.vahdam.com            200  canonical US store
 *   https://www.vahdamteas.com        200  → redirects to https://www.vahdam.com/
 *   https://www.vahdam.co.uk          200  canonical UK store
 *   https://vahdam.co.uk              200  → redirects to https://www.vahdam.co.uk/
 *   https://www.vahdam.global         200  canonical global store
 *   https://www.vahdamindia.com       200  → redirects to https://www.vahdam.com/
 *
 *   https://uk.vahdamteas.com         DEAD (no connection)
 *   https://eu.vahdamteas.com         DEAD
 *   https://au.vahdamteas.com         DEAD
 *   https://eu.vahdam.com             DEAD
 *   https://au.vahdam.com             DEAD
 *
 * The dead set is coherent rather than coincidental: the brand moved from
 * vahdamteas.com to vahdam.com / .co.uk / .global, kept the apex as a redirect,
 * and dropped the regional subdomains. The repo's own brand-asset allowlist in
 * brand-assets-core.js already used vahdam.com / vahdam.co.uk / vahdam.global —
 * it was right, while the "verified" table it sat next to was not.
 *
 * Measured from this environment, whose proxy demonstrably reaches vahdam.com,
 * vahdam.co.uk, vahdam.global and vahdamindia.com — so the failures are specific
 * to those five hosts, not a blanket block. Re-run scripts/check-market-urls.js
 * to confirm from anywhere else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT MATTERED
 *
 * These maps are not documentation. They are what the mailer pipeline, the ad
 * generator, the landing-page builder and the review-recovery mailer put in
 * every href. A UK, EU or AU send did not go to a slower page — it went nowhere.
 *
 * Prefer the canonical host over the redirecting one everywhere: a redirect hop
 * costs latency on the click that matters most and gives one more place for
 * tracking parameters to be dropped.
 */

// Canonical, reachable storefront per market. No trailing slash.
const STORE_BASE = Object.freeze({
  US: 'https://www.vahdam.com',
  UK: 'https://www.vahdam.co.uk',
  // India resolves to the US store today. Kept as its own key so a future
  // dedicated IN storefront is a one-line change here rather than a hunt.
  IN: 'https://www.vahdam.com',
  // No dedicated EU or AU storefront exists. Both are served by the global
  // store; pointing them at a market subdomain that does not exist is what this
  // module was written to stop.
  EU: 'https://www.vahdam.global',
  AU: 'https://www.vahdam.global',
  ME: 'https://www.vahdam.global',
  GLOBAL: 'https://www.vahdam.global',
});

// Hosts that must never appear in generated output again. Kept explicit so the
// guard test can name the offender instead of reporting "unexpected URL".
const DEAD_HOSTS = Object.freeze([
  'uk.vahdamteas.com',
  'eu.vahdamteas.com',
  'au.vahdamteas.com',
  'eu.vahdam.com',
  'au.vahdam.com',
]);

// Reachable, but every request costs a redirect hop before the customer lands.
const REDIRECTING_HOSTS = Object.freeze([
  'www.vahdamteas.com',
  'vahdamteas.com',
  'www.vahdamindia.com',
  'vahdam.co.uk',
]);

function norm(market) {
  const m = String(market || 'US').trim().toUpperCase();
  if (m === 'INDIA') return 'IN';
  if (m === 'ROW' || m === 'REST' || m === 'WORLD') return 'GLOBAL';
  return m;
}

/** Canonical storefront base for a market. Unknown markets fall back to global. */
function storeBase(market) {
  return STORE_BASE[norm(market)] || STORE_BASE.GLOBAL;
}

/** Bare host, for the places that want `www.vahdam.co.uk` rather than a URL. */
function storeHost(market) {
  return storeBase(market).replace(/^https?:\/\//, '');
}

/** Product detail page. `handle` is the catalog JSON `h` field. */
function productUrl(market, handle) {
  return handle ? `${storeBase(market)}/products/${String(handle).replace(/^\/+/, '')}` : storeBase(market);
}

/** Collection page. `slug` is the collection handle. */
function collectionUrl(market, slug) {
  return slug ? `${storeBase(market)}/collections/${String(slug).replace(/^\/+/, '')}` : `${storeBase(market)}/collections/all`;
}

/** Currency per market, so a price is never shown in the wrong symbol. */
const CURRENCY = Object.freeze({
  US: { code: 'USD', symbol: '$' },
  UK: { code: 'GBP', symbol: '£' },
  IN: { code: 'INR', symbol: '₹' },
  EU: { code: 'EUR', symbol: '€' },
  AU: { code: 'AUD', symbol: 'A$' },
  ME: { code: 'USD', symbol: '$' },
  GLOBAL: { code: 'USD', symbol: '$' },
});
function currency(market) { return CURRENCY[norm(market)] || CURRENCY.GLOBAL; }

module.exports = {
  STORE_BASE, DEAD_HOSTS, REDIRECTING_HOSTS, CURRENCY,
  storeBase, storeHost, productUrl, collectionUrl, currency, norm,
};
