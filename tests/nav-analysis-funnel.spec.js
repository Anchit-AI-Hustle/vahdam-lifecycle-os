const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Analysis used to be spread across three separate rail entries: the Data
// Analysis group, a standalone Cohorts group, and the Ad Campaigns Master
// sitting on its own. Answering "how did that campaign do" meant already
// knowing which of the three held the answer.
//
// It is one group now, and the children run top of funnel to bottom in the
// order a customer actually moves through it:
//
//   see the spend -> click -> land -> buy -> stay -> come back -> what we did
//
// The ordering is the feature, so it is pinned. A later edit that appends a row
// to the end, or drops one back into its own group, has to fail here rather
// than quietly restoring the scatter.

const ROOT = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');

// Read the real group out of the nav rather than re-describing it here.
function analysisGroup() {
  const start = AUTH.indexOf("{ group: 'Data Analysis'");
  expect(start, 'the Data Analysis group is gone').toBeGreaterThan(-1);
  const end = AUTH.indexOf(']},', start);
  return AUTH.slice(start, end);
}
const GROUP = analysisGroup();
const rowIds = [...GROUP.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((m) => m[1]);

test('analysis is one group, not three', () => {
  // The two that were absorbed must no longer exist as their own rail entries.
  expect(AUTH, 'Cohorts is a separate group again').not.toMatch(/group: 'Cohorts'/);
  const adsMasterRows = [...AUTH.matchAll(/\{ id: 'adsmaster'/g)].length;
  expect(adsMasterRows, 'ad analysis has more than one entrance').toBe(1);
  expect(rowIds, 'the ads dashboard is not inside Data Analysis').toContain('adsmaster');
  expect(rowIds, 'cohorts is not inside Data Analysis').toContain('cohorts');
});

test('the children run in funnel order', () => {
  // Each entry is (id, the funnel stage it represents). The assertion is on the
  // ORDER, so renaming a label is free and moving a row is not.
  const FUNNEL = [
    'adsmaster',   // 1 reach and spend
    'da-acq',      // 2 the click
    'da-landing',  // 3 where it landed
    'da-review',   // 4 the purchase
    'cohorts',     // 5 who they became
    'da-ret',      // 6 whether they stayed
    'da-mailer',   // 7 what we sent them
    'da-rfm',      // 8 what they are worth
    'da-actions',  // 10 what we did about it
  ];
  const positions = FUNNEL.map((id) => ({ id, at: rowIds.indexOf(id) }));
  for (const p of positions) expect(p.at, `${p.id} is missing from the group`).toBeGreaterThan(-1);
  for (let i = 1; i < positions.length; i++) {
    expect(positions[i].at,
      `${positions[i].id} comes before ${positions[i - 1].id}, which is backwards in the funnel`)
      .toBeGreaterThan(positions[i - 1].at);
  }
});

test('the whole-funnel view leads, and settings trail', () => {
  expect(rowIds[0], 'the Control Room should be the first thing in the group').toBe('da-control');
  expect(rowIds[rowIds.length - 1], 'Alert settings should be last').toBe('da-alerts');
});

test('the labels number the funnel, so the order is visible and not just implied', () => {
  // A reader should not have to infer the sequence from row position alone.
  for (const n of ['1 · ', '2 · ', '3 · ', '4 · ', '5 · ', '6 · ', '7 · ', '8 · ']) {
    expect(GROUP, `no step labelled "${n}"`).toContain(n);
  }
});

test('the group still matches every route it absorbed', () => {
  // Moving a row into the group is only complete if landing on that page still
  // highlights it. /cohorts had its own group carrying that match before.
  for (const route of ['/cohorts', '/data-analysis', '/rfm', '/d2c-review']) {
    expect(GROUP, `the group no longer matches ${route}`).toContain(`'${route}'`);
  }
  // And the absorbed rows keep their own match lists, so deep links still land.
  expect(GROUP).toContain("'/ads-master'");
  expect(GROUP).toContain("'/cohort-definitions.html'");
});

test('Ad Creation stays a create feature, not an analysis one', () => {
  // The one entrance rule cuts both ways: the Creative Studio builder must not
  // get pulled into the analysis group just because it shares a page.
  expect(GROUP, 'the ad BUILDER was moved into Data Analysis').not.toMatch(/\{ id: 'ads'/);
  expect(AUTH).toMatch(/id: 'ads',\s*label: 'Ad Creation \(Creative Studio\)'/);
});

test('every row in the group has a destination', () => {
  const rows = [...GROUP.matchAll(/\{ id: '([a-z0-9-]+)'[^}]*\}/g)].map((m) => m[0]);
  for (const r of rows) {
    expect(r, `a row with no href: ${r.slice(0, 60)}`).toMatch(/href: '/);
  }
  expect(rows.length, 'the group lost rows in the merge').toBeGreaterThanOrEqual(11);
});
