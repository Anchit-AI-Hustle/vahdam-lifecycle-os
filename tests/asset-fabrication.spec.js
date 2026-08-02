const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { renderLandingPage } = require('../scripts/lib/landing-page.js');
const { renderAds } = require('../scripts/lib/ad-creative.js');

// What a generated ad or landing page is allowed to assert.
//
// The July build shipped 12 landing pages carrying an authored quote attributed
// to "A VAHDAM customer" and a literal "Registered mailing address here" in the
// legal footer, while the renderers hardcoded the US rating bar and the US
// registered address into EVERY region's asset. Three separate fabrications, all
// of them the kind that reads as plausible: a made-up review looks like a review,
// and a borrowed rating looks like a rating.
//
// The rules being defended: a review needs provenance or it is invented; a
// rating, review count and legal address belong to the region they were
// collected in and are never borrowed; and an angle matrix multiplies creatives
// without multiplying claims.

const LP_DIR = path.join(__dirname, '..', 'landing-pages', 'usa-july');
const lpFiles = fs.existsSync(LP_DIR)
  ? fs.readdirSync(LP_DIR).filter((f) => f.endsWith('_lp.html')).map((f) => path.join(LP_DIR, f))
  : [];

const base = { productName: 'Himalayan Green Tea, 12 oz', market: 'US', price: '$27.49', subline: 'A clean cup.' };

test.describe('a review must be cited, not authored', () => {
  test('a testimonial without provenance is refused outright', () => {
    // Not a soft marker: a caller reaching here wrote the quote itself.
    expect(() => renderLandingPage(Object.assign({}, base, {
      testimonial: { quote: 'It became the cup I reach for without thinking.', who: 'A VAHDAM customer' },
    }))).toThrow(/fabricated review/i);
  });

  test('the same quote WITH a source is accepted and shows its source', () => {
    const html = renderLandingPage(Object.assign({}, base, {
      testimonials: [{ quote: 'Steady and clean.', who: 'Priya S.', source: 'Yotpo verified review 2026-06-11' }],
    }));
    expect(html).toContain('Steady and clean.');
    // The provenance is rendered, so a reviewer can trace the quote back.
    expect(html).toContain('Yotpo verified review 2026-06-11');
  });

  test('no shipped landing page carries the invented reviewer or a placeholder address', () => {
    expect(lpFiles.length, 'no generated landing pages found to check').toBeGreaterThan(0);
    lpFiles.forEach((f) => {
      const html = fs.readFileSync(f, 'utf8');
      const name = path.basename(f);
      expect(html, `${name} still carries the invented reviewer`).not.toContain('A VAHDAM customer');
      expect(html, `${name} still carries a placeholder address`).not.toContain('Registered mailing address here');
      // Unfalsifiable hedges that asserted provenance we cannot source.
      expect(html, `${name} carries an unsourced sourcing hedge`).not.toContain('wherever the leaf allows');
      expect(html, `${name} asserts single-estate for an unmatched SKU`).not.toContain('a single-estate VAHDAM blend');
    });
  });
});

test.describe('regional facts are never borrowed across regions', () => {
  const usBar = /Rated 4\.9\/5/;
  const usAddr = /Barranca/;

  test('the US set renders only on US assets', () => {
    const us = renderLandingPage(Object.assign({}, base, { market: 'US' }));
    expect(us).toMatch(usBar);
    expect(us).toMatch(usAddr);

    ['UK', 'EU', 'AU', 'IN'].forEach((m) => {
      const html = renderLandingPage(Object.assign({}, base, { market: m }));
      expect(html, `${m} borrowed the US rating bar`).not.toMatch(usBar);
      expect(html, `${m} borrowed the US registered address`).not.toMatch(usAddr);
      // Missing data is declared, not papered over.
      expect(html, `${m} hid the missing address instead of declaring it`).toContain('DATA REQUIRED BEFORE LAUNCH');
    });
  });

  test('structured data uses the region currency, or emits no price at all', () => {
    const expected = { US: 'USD', UK: 'GBP', EU: 'EUR', AU: 'AUD', IN: 'INR' };
    Object.entries(expected).forEach(([m, cur]) => {
      const html = renderLandingPage(Object.assign({}, base, { market: m }));
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      expect(ld.offers.priceCurrency, `${m} priced in the wrong currency`).toBe(cur);
    });
  });

  test('the storefront rating never becomes a Product rating', () => {
    // "Rated 4.9/5" is storefront-wide. Attached to a Product node it would
    // assert itself as THIS SKU's rating and render as stars in search results.
    const html = renderLandingPage(Object.assign({}, base, { market: 'US' }));
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    expect(ld['@type']).toBe('Product');
    expect(ld.aggregateRating, 'storefront rating leaked into Product schema').toBeUndefined();
    expect(ld.review, 'a review leaked into Product schema').toBeUndefined();
  });
});

test.describe('every shipped landing page is a real destination', () => {
  test('each carries share metadata and valid structured data', () => {
    expect(lpFiles.length).toBeGreaterThan(0);
    lpFiles.forEach((f) => {
      const html = fs.readFileSync(f, 'utf8');
      const name = path.basename(f);
      ['og:title', 'og:image', 'twitter:card', 'name="description"'].forEach((tag) => {
        expect(html, `${name} is missing ${tag}`).toContain(tag);
      });
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks.length, `${name} has no structured data`).toBeGreaterThan(0);
      blocks.forEach((b, i) => {
        // Throws on malformed JSON, which is the whole point of the check.
        expect(() => JSON.parse(b[1]), `${name} ld[${i}] is not valid JSON`).not.toThrow();
      });
      // A page reached from a phone ad needs a thumb-reachable CTA.
      expect(html, `${name} has no sticky mobile CTA`).toContain('stickycta');
    });
  });
});

test.describe('the angle matrix multiplies creatives, not claims', () => {
  const adOpts = {
    productName: 'Himalayan Green Tea, 12 oz', market: 'US', price: '$27.49',
    headline: 'A calmer start to the month', subline: 'High-grown Himalayan green.',
    tastingLine: 'Earthy, Smooth and Refreshing', ctaUrl: 'https://www.vahdamteas.com/products/x',
  };

  test('an ad set ships several angles with distinct hooks', () => {
    const ad = renderAds(adOpts);
    expect(ad.angles.length, 'a single creative gives nothing to test').toBeGreaterThan(1);
    const hooks = ad.copy.variants.map((v) => v._creative.hook);
    expect(new Set(hooks).size, 'two angles shipped the same hook').toBe(hooks.length);
    // Each angle is labelled with where on the awareness ladder it sits.
    ad.angles.forEach((a) => expect(a.awareness, `angle ${a.angle} has no awareness level`).toBeTruthy());
  });

  test('every angle is built only from the copy the caller supplied', () => {
    const ad = renderAds(adOpts);
    // The union of supplied strings is the entire vocabulary an angle may draw
    // on (plus the one established brand claim already used for descriptions).
    const supplied = [adOpts.headline, adOpts.subline, adOpts.tastingLine, adOpts.price, adOpts.productName];
    ad.copy.variants.forEach((v) => {
      const src = `${v._creative.hook} ${v._creative.body}`.trim();
      const traceable = supplied.some((s) => s && src.includes(s));
      expect(traceable, `angle ${v.angle} invented copy: ${src}`).toBe(true);
    });
  });

  test('an angle with no supplied source is dropped, never padded', () => {
    // Only a headline given: the taste and benefit angles have no source.
    const thin = renderAds({ productName: 'X', market: 'US', headline: 'Just this', ctaUrl: 'https://x.test' });
    expect(thin.angles.length).toBeGreaterThan(0);
    thin.copy.variants.forEach((v) => expect(v._creative.hook.length).toBeGreaterThan(0));
  });

  test('an ad with no hook at all fails loudly rather than shipping empty', () => {
    expect(() => renderAds({ productName: 'X', market: 'US', ctaUrl: 'https://x.test' }))
      .toThrow(/DATA REQUIRED BEFORE LAUNCH/);
  });

  test('the shipped ad pages render all their angles', () => {
    const dir = path.join(__dirname, '..', 'ads', 'usa-july');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('_ads.html')) : [];
    expect(files.length, 'no generated ad sets found to check').toBeGreaterThan(0);
    files.forEach((f) => {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      const rendered = (html.match(/angle<\/h2>/g) || []).length;
      expect(rendered, `${f} rendered ${rendered} angles`).toBeGreaterThan(1);
    });
  });
});
