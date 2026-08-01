// Mailer layout: the product grid has to follow the product COUNT, and a
// Text + Visual mailer has to carry more than pack shots.
//
// The bug this pins: a grid sized for three products rendered one product as a
// 33%-wide thumbnail inside a full-width cream box - a small pack shot marooned
// in dead space, which reads as a catalogue row rather than something that sells.
const { test, expect } = require('@playwright/test');
const path = require('path');

const render = require(path.resolve(__dirname, '..', 'api', '_shared', 'calendar-trigger.js')).helpers.renderTextVariant;

const BASE = {
  subject: 'A first flush worth slowing down for',
  preheader: 'Picked in April.',
  hero_headline: 'A first flush worth slowing down for',
  hero_subline: 'Picked in April, shipped within days of the pluck.',
  body_blocks: [{ heading: 'The pick', body: 'Margarets Hope, DJ76, second-week April.' }],
  cta_text: 'Shop the first flush',
  market: 'US',
  hero_product: 'Darjeeling First Flush Black Tea',
};
// Deliberately long first title: it wraps to two lines, which is exactly what
// used to make one card taller than the others.
const PRODUCTS = [
  { title: 'Margarets Hope Premium Darjeeling First Flush Black Tea', handle: 'a-long-one', price: '29.99' },
  { title: 'Assam Gold', handle: 'assam-gold', price: '24' },
  { title: 'Earl Grey Citrus', handle: 'earl-grey-citrus', price: '19' },
];

const visual = (n, extra = {}) => render({ ...BASE, style: 'visual', products: PRODUCTS.slice(0, n), ...extra });

test.describe('the product grid follows the product count', () => {
  test('one product becomes a feature card, not a thumbnail in a wide empty box', () => {
    const h = visual(1);
    expect(h).toContain('Shop this');           // the horizontal feature card
    expect(h).not.toContain('width:32%');       // never a 3-up cell holding one item
    expect(h).not.toContain('width:49%');
  });

  test('two products split in half, three split in thirds', () => {
    expect((visual(2).match(/width="49%"/g) || [])).toHaveLength(2);
    expect((visual(3).match(/width="32%"/g) || [])).toHaveLength(3);
  });

  test('no products means no grid at all, not an empty frame', () => {
    const h = visual(0);
    expect(h).not.toContain('width:32%');
    expect(h).not.toContain('Shop this');
  });
});

test.describe('parallel cards are equal size and aligned', () => {
  // Cells in a table row are equal height by construction. The card chrome
  // therefore has to live on the <td>; on an inner <div> it collapses to the
  // content and a wrapped title leaves one card taller than its neighbour.
  test('card chrome sits on the cell, so a wrapped title cannot desync heights', () => {
    const h = visual(3);
    const cells = h.match(/<td[^>]*width="32%"[^>]*>/g) || [];
    expect(cells).toHaveLength(3);
    for (const td of cells) {
      expect(td).toContain('background:#FBF5EA');
      expect(td).toContain('border-radius:10px');
    }
  });

  test('the gutter is a spacer cell, not padding inside the card border', () => {
    const h = visual(3);
    expect((h.match(/<td width="14"/g) || [])).toHaveLength(2); // 3 cards, 2 gutters
  });
});

test.describe('a Text + Visual mailer carries more than pack shots', () => {
  test('an editorial lifestyle frame is emitted as a generation slot', () => {
    const h = visual(1, { lifestyle_prompt: 'editorial lifestyle frame, warm morning light' });
    expect(h).toContain('IMAGE GENERATION PROMPT (lifestyle');
    expect(h).toContain('editorial lifestyle frame');
  });

  test('a hosted lifestyle photo is used directly when one exists', () => {
    const h = visual(1, { lifestyle_image_url: 'https://www.vahdam.com/cdn/shop/files/x.jpg', lifestyle_caption: 'Morning, unhurried' });
    expect(h).toContain('https://www.vahdam.com/cdn/shop/files/x.jpg');
    expect(h).toContain('Morning, unhurried');
    expect(h).not.toContain('IMAGE GENERATION PROMPT (lifestyle');
  });

  test('nothing is invented: no prompt and no URL means no band', () => {
    const h = visual(1);
    expect(h).not.toContain('IMAGE GENERATION PROMPT (lifestyle');
  });

  test('the pure Text variant stays image-free even if a lifestyle prompt is passed', () => {
    // Mailer taxonomy: "Text" is typographic only. A lifestyle frame must not
    // leak into it just because the caller had one to offer.
    const h = render({ ...BASE, style: 'pure', products: PRODUCTS.slice(0, 1), lifestyle_prompt: 'a frame' });
    expect(h).not.toMatch(/<img/i);
    expect(h).not.toContain('IMAGE GENERATION PROMPT');
  });
});
