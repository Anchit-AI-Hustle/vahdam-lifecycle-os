const { test, expect } = require('@playwright/test');
const path = require('path');

// THE COPY PATH REFUSED A WEAK MATCH; THE IMAGE PATH SHIPPED IT.
//
// catalog-live.findProduct resolves a product through id -> handle -> sku ->
// exact title -> title-contains -> distinctive token. The last two rungs return
// confidence:'weak', usually with ambiguous:true, because more than one product
// matched. verifySelection() refuses those outright:
//
//     "match too weak to price (token:citrus, ambiguous)"
//
// catalog-image.match() called the SAME resolver and then did
// `return m.product || null`, dropping confidence and ambiguous on the floor.
// Measured against the US catalog:
//
//     findProduct('Earl Grey Citrus Black Tea')
//       -> Chamomile Mint Citrus Green Tea   (token:citrus, weak, ambiguous)
//
// so a mailer for Earl Grey rendered a chamomile green tea's photograph, and
// handleFor() built a PDP link to that other product — a customer clicking
// through for one tea would have landed on another. The module comment said the
// two paths "can never disagree about which product a slot meant". They shared a
// matcher, not a threshold.
//
// The point of this spec is the AGREEMENT, not any single product: whatever the
// copy path refuses to price, the image and link paths must also refuse.

const ROOT = path.join(__dirname, '..');
const catalog = require(path.join(ROOT, 'api/_shared/catalog-live.js'));
const image = require(path.join(ROOT, 'api/_shared/catalog-image.js'));

/** Names of the shape the planner actually emits — not catalog titles. */
const PLANNER_NAMES = [
  'Earl Grey Citrus Black Tea',
  'Turmeric Spiced Herbal Tea',
  'Original Masala Chai',
  'Chai Tea Sampler Gift Set',
  'Assorted Tea Gift Box',
  'Green Tea',
  'Chai',
];

test('the image and link paths refuse exactly what the copy path refuses', () => {
  const disagreements = [];
  for (const name of PLANNER_NAMES) {
    const detail = image.matchDetail({ title: name }, 'US');
    if (!detail.product) continue;               // nothing resolved: both agree
    const copyOk = catalog.verifySelection([{ title: name }], 'US').verified.length > 0;
    const img = image.imageFor({ title: name }, 'US');
    const handle = image.handleFor({ title: name }, 'US');
    if (!copyOk && (img || handle)) {
      disagreements.push(
        `"${name}" -> ${detail.product.n} (${detail.match_method}, ${detail.confidence})\n`
        + `      copy: REFUSED   image: ${img ? 'served' : 'refused'}   link: ${handle || 'refused'}`);
    }
  }
  expect(disagreements,
    'the copy path refused these but the image/link path served them:\n  ' + disagreements.join('\n  ')
  ).toEqual([]);
});

test('a weak, ambiguous match yields no image and no PDP link', () => {
  // The concrete case from the report, asserted on the RESOLVER's own verdict so
  // the test does not depend on this particular catalog row surviving forever.
  const q = { title: 'Earl Grey Citrus Black Tea' };
  const d = image.matchDetail(q, 'US');
  test.skip(!d.product || d.confidence !== 'weak',
    'this catalog no longer produces a weak match for the sample name');
  expect(image.imageFor(q, 'US'), 'a weak match still returned a photograph').toBeNull();
  expect(image.handleFor(q, 'US'), 'a weak match still built a PDP link').toBeNull();
  expect(image.imagesFor(q, 'US')).toEqual([]);
});

test('an exact match still resolves — the guard is not a blanket refusal', () => {
  // Guards the guard from the other side: if strict mode simply returned null
  // for everything, the spec above would pass while the feature was dead.
  const rows = image.load('US');
  expect(rows.length, 'no catalog rows loaded').toBeGreaterThan(10);
  const withImage = rows.find((r) => r.h && typeof r.i === 'string' && /^https?:\/\//.test(r.i));
  expect(withImage, 'no catalog row carries both a handle and an image').toBeTruthy();
  expect(image.handleFor(withImage.h, 'US')).toBe(withImage.h);
  expect(image.imageFor(withImage.h, 'US')).toBeTruthy();
  // An exact TITLE match is also strong enough to serve.
  expect(image.handleFor({ title: withImage.n }, 'US')).toBe(withImage.h);
});

test('strict:false is still available for non-customer-facing callers', () => {
  const q = { title: 'Earl Grey Citrus Black Tea' };
  const d = image.matchDetail(q, 'US');
  test.skip(!d.product || d.confidence !== 'weak', 'no weak match available in this catalog');
  expect(image.match(q, 'US', { strict: false })).toBeTruthy();
});
