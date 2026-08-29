// The mailer variant mix is 1 Text + 3 Text+Visual (product owner, 2026-08-30,
// changed from 2+2). The list is built independently in THREE places, which is
// exactly why this test exists: the shape has to be identical in all of them, or
// which mailers you get depends on which code path produced them.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILDERS = [
  'api/_shared/smart-brain-plan.js',
  'api/_shared/lifecycle-mailer-build.js',
  'api/_shared/brain-generate.js',
];

// Reads the variant literal list out of a builder: `key: 'x', type: 'Y'` pairs.
function variantsIn(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return [...src.matchAll(/key:\s*'((?:text|visual)_[a-z])',\s*type:\s*'(Text \+ Visual|Text)'/g)]
    .map((m) => ({ key: m[1], type: m[2] }));
}

test('the declared contract is 1 Text + 3 Text+Visual', () => {
  const { MAILER_VARIANTS } = require(path.join(ROOT, 'api/_shared/asset-specs.js'));
  expect(MAILER_VARIANTS.filter((v) => v.type === 'Text')).toHaveLength(1);
  expect(MAILER_VARIANTS.filter((v) => v.type === 'Text + Visual')).toHaveLength(3);
});

for (const file of BUILDERS) {
  test(`${file.split('/').pop()} builds 1 Text + 3 Text+Visual`, () => {
    const vs = variantsIn(file);
    // Premise check: if the regex stops matching, the counts below would both be
    // 0 and the assertion would pass vacuously.
    expect(vs.length, `no variant literals found in ${file} - the parser drifted`).toBe(4);
    expect(vs.filter((v) => v.type === 'Text').map((v) => v.key)).toEqual(['text_a']);
    expect(vs.filter((v) => v.type === 'Text + Visual').map((v) => v.key))
      .toEqual(['visual_a', 'visual_b', 'visual_c']);
  });
}

test('no builder still emits the retired second text variant', () => {
  for (const file of BUILDERS) {
    expect(fs.readFileSync(path.join(ROOT, file), 'utf8'), `${file} still emits text_b`)
      .not.toMatch(/key:\s*'text_b'/);
  }
});

test('the three visual variants are three different treatments, not one repeated', () => {
  // Variety on paper is not variety. Two photo-led (differing by copy framework)
  // plus one built-graphics editorial with no photograph.
  for (const file of BUILDERS) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const block = src.slice(src.indexOf("key: 'visual_a'"), src.indexOf("key: 'visual_c'") + 400);
    expect(block, `${file}: visual_c should render the editorial treatment`).toMatch(/'editorial'/);
  }
});

test('the primary mailer is chosen by key, never by list position', () => {
  // Was `variants[2]`, correct only while the order was [text, text, visual_a,
  // visual_b]. Under 1+3 that index is visual_b, so a positional read silently
  // promotes the wrong variant into the top-level fields.
  const src = fs.readFileSync(path.join(ROOT, 'api/_shared/lifecycle-mailer-build.js'), 'utf8');
  expect(src).not.toMatch(/const primary = variants\[\d\]/);
  expect(src).toMatch(/variants\.find\(\(v\) => v\.key === 'visual_a'\)/);
});
