const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The ad metric catalog is meant to be ONE definition used by both surfaces:
// api/_shared/ad-metrics-catalog.js here, and streamlit_app.py's METRICS on the
// snowflake-streamlit-app branch. The Ops tab of /ads-master prints that promise
// verbatim ("defined once and computed identically on both surfaces").
//
// It had silently stopped being true. The two catalogs shared 41 of 52 keys, and
// worse, hold_rate meant thruplays/impressions on the web while meaning
// thruplays/video_3s in Snowflake -- the same label reporting different numbers on
// the two dashboards, which no key-presence check would have caught.
//
// So this locks FORMULAS and INPUTS, not just keys. The two branches cannot import
// from each other, so the lockfile is the contract they both answer to: changing a
// metric means updating data/ads/metric-catalog.lock.json in the same commit, on
// both branches. A drift on either side then fails CI instead of quietly producing
// two different numbers under one name.
const catalog = require(path.join(__dirname, '..', 'api', '_shared', 'ad-metrics-catalog.js'));
const LOCK = path.join(__dirname, '..', 'data', 'ads', 'metric-catalog.lock.json');

const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
const byKey = new Map(lock.metrics.map((m) => [m.key, m]));

test('catalog matches the lockfile exactly — no metric added, removed or renamed', () => {
  const live = catalog.METRICS.map((m) => m.key).sort();
  const locked = lock.metrics.map((m) => m.key).sort();
  expect(live, 'add/remove a metric => update data/ads/metric-catalog.lock.json in the same commit, on BOTH branches').toEqual(locked);
  expect(catalog.METRICS.length).toBe(lock.count);
});

test('every formula, input list, category, unit and tier is unchanged', () => {
  for (const m of catalog.METRICS) {
    const want = byKey.get(m.key);
    expect(want, `${m.key} is missing from the lockfile`).toBeTruthy();
    // Formula text is the human-readable contract the dashboards print, so a
    // reworded formula is a real change and must be acknowledged in the lock.
    expect(m.formula, `${m.key}: formula changed`).toBe(want.formula);
    expect(m.inputs, `${m.key}: inputs changed`).toEqual(want.inputs);
    expect(m.category, `${m.key}: category changed`).toBe(want.category);
    expect(m.unit, `${m.key}: unit changed`).toBe(want.unit);
    expect(m.tier, `${m.key}: tier changed`).toBe(want.tier);
  }
});

test('the video retention family decomposes correctly', () => {
  // The specific confusion that started this: hook_rate and hold_rate must chain
  // (impressions -> 3-sec plays -> thruplays), and thruplay_rate is the separate
  // impressions-based reading. If hold_rate is ever divided by impressions again,
  // it stops being a retention rate and silently duplicates thruplay_rate.
  const f = (k) => catalog.BY_KEY[k];
  expect(f('hook_rate').inputs).toEqual(['video_3s', 'impressions']);
  expect(f('hold_rate').inputs).toEqual(['thruplays', 'video_3s']);
  expect(f('thruplay_rate').inputs).toEqual(['thruplays', 'impressions']);
  expect(f('completion_of_starts').inputs).toEqual(['video_p100', 'video_3s']);
  expect(f('through_rate').inputs).toEqual(['video_p100', 'impressions']);
  // No two metrics may share a formula — that duplication is what let hold_rate
  // and the old hook_to_hold drift apart in the first place.
  const seen = new Map();
  for (const m of catalog.METRICS) {
    const sig = `${m.inputs.join('/')}::${m.formula}`;
    expect(seen.has(sig), `${m.key} duplicates ${seen.get(sig)}`).toBe(false);
    seen.set(sig, m.key);
  }
});

test('derived metrics return null on missing inputs rather than a fabricated 0', () => {
  // Zero-fabrication: an absent feed must read "unavailable", never look like a
  // real result. mer and ncac are the live case — both are defined but neither has
  // its feed wired yet.
  for (const m of catalog.METRICS.filter((x) => x.tier === 'derived')) {
    expect(m.compute({}), `${m.key} invented a value from an empty row`).toBeNull();
  }
  expect(catalog.BY_KEY.mer.compute({ spend: 100 })).toBeNull();
  expect(catalog.BY_KEY.ncac.compute({ spend: 100 })).toBeNull();
  expect(catalog.BY_KEY.mer.compute({ spend: 100, total_revenue: 250 })).toBeCloseTo(2.5, 6);
});

test('accuracy() reports unavailable for a metric whose inputs are absent', () => {
  const scored = catalog.accuracy([{ spend: 10, impressions: 1000, clicks: 20 }]);
  expect(scored.ok).toBe(true);
  expect(scored.rows).toBe(1);
  // Every metric must be scored, so a new one cannot be added without appearing here.
  expect(Object.keys(scored.per_metric).sort()).toEqual(catalog.METRICS.map((m) => m.key).sort());
  // The two metrics whose feeds are not wired must say so, not claim coverage.
  for (const k of ['mer', 'ncac']) {
    expect(scored.per_metric[k].confidence, `${k} has no feed, so it must read unavailable`).toBe('unavailable');
    expect(scored.per_metric[k].coverage).toBe(0);
  }
  // And the ones whose inputs ARE present must be scored as present.
  expect(scored.per_metric.impressions.confidence).toBe('high');
  expect(scored.per_metric.spend.confidence).toBe('high');
});
