const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Where real assets are allowed to be spent, and where they are not.
//
// Two rules are being defended. The PRODUCT rule: a model may render the world
// around the pack shot but never the pack shot, because a drawn VAHDAM tin is a
// fabricated product photograph with garbled letterforms on it. And the SPEND
// rule: video is metered per second against a ~140-send calendar, so it fires
// only where the owner committed to the send (approve) or asked for it outright
// (recreate) — never on a passive View, never across the background queue.

const SRC = fs.readFileSync(path.join(__dirname, '..', 'api', '_shared', 'smart-brain-plan.js'), 'utf8');

const callSite = (marker) => {
  const i = SRC.indexOf(marker);
  expect(i, `call site not found: ${marker}`).toBeGreaterThan(-1);
  return SRC.slice(i, i + 260);
};

test.describe('the product stays real', () => {
  test('the scene prompt bans the product and all text by name', () => {
    // Merely omitting the product from a brief still gets one rendered, so the
    // ban is explicit and enumerates the nouns.
    ['product', 'packaging', 'tin', 'pouch', 'label', 'logo', 'letterform'].forEach((noun) => {
      expect(SRC.slice(SRC.indexOf('SCENE_ONLY_RULE ='), SRC.indexOf('SCENE_ONLY_RULE =') + 900)).toContain(noun);
    });
  });

  test('the real catalog photo is still assigned, untouched by scene generation', () => {
    // out[key].image remains the catalog URL; the backplate lands on .scene.
    expect(SRC).toContain("out[key] = { brief: b, image, provider: image ? 'catalog' : null }");
    expect(SRC).toContain('out[key].scene =');
  });

  test('video starts FROM the real photo, not from a description of it', () => {
    const kick = SRC.slice(SRC.indexOf('async function kickAdVideos'), SRC.indexOf('// ── Funnel build'));
    expect(kick).toContain('const initUrl = c.image || null;');
    expect(kick).toContain('image_url: initUrl');
    // And the motion prompt forbids restyling what was photographed.
    expect(kick).toMatch(/do not restyle, relabel or redraw it/);
  });

  test('a scene that fails to generate ships the real photo alone', () => {
    expect(SRC).toContain('a missing backplate ships the real photo alone');
  });
});

test.describe('spend follows commitment', () => {
  test('a passive View spends nothing — no scenes, no video', () => {
    const site = callSite('campaign = await buildCampaign(effectiveEntry(entry), config, force');
    expect(site).toContain("{ id, withCreatives: false }");
  });

  test('a recreate gets the full set including video', () => {
    const site = callSite('campaign = await buildCampaign(effectiveEntry(entry), config, force');
    expect(site).toMatch(/withCreatives: true, scenes: true, sceneTier: 'standard', withVideo: true/);
  });

  test('approving spends on video, because approving is the commitment to ship', () => {
    const site = callSite('if (!campaign) campaign = await buildCampaign');
    expect(site).toContain('withVideo: true');
  });

  test('the background queue builds scenes but NEVER video', () => {
    // ~140 sends x 4 platforms of paid video would re-bill on every re-plan.
    const site = callSite('const campaign = await buildCampaign(effectiveEntry(entry), config, { id: row.id');
    expect(site).toContain('scenes: true');
    expect(site).not.toContain('withVideo: true');
  });
});

test.describe('image tier is chosen by who is waiting', () => {
  test('interactive builds lead with the fast generator', () => {
    // gpt-image-2 averages ~112s, longer than the request survives; Gemini ~28s.
    expect(callSite('campaign = await buildCampaign(effectiveEntry(entry), config, force')).toContain("sceneTier: 'standard'");
    expect(callSite('if (!campaign) campaign = await buildCampaign')).toContain("sceneTier: 'standard'");
  });

  test('the background queue leads with the better generator', () => {
    expect(callSite('const campaign = await buildCampaign(effectiveEntry(entry), config, { id: row.id')).toContain("sceneTier: 'premium'");
  });

  test('the tier actually reaches the image cascade', () => {
    // image.js reads body.tier — passing it anywhere else would silently no-op.
    expect(SRC).toMatch(/body: \{ prompt: String\(prompt\)\.slice\(0, 1800\), size, quality: 'high', mode, tier \}/);
  });
});

test.describe('video is submitted, not awaited', () => {
  test('processing jobs are recorded for later polling', () => {
    const kick = SRC.slice(SRC.indexOf('async function kickAdVideos'), SRC.indexOf('// ── Funnel build'));
    expect(kick).toContain("ad.video = { status: 'processing'");
    expect(kick).toContain('jobs.push({ platform, provider: r.provider, job_id: r.job_id })');
    expect(kick).toContain('campaign.video_jobs = jobs');
  });

  test('a missing key is reported rather than silently dropping the ad', () => {
    const kick = SRC.slice(SRC.indexOf('async function kickAdVideos'), SRC.indexOf('// ── Funnel build'));
    expect(kick).toContain("status: 'not_connected'");
  });

  test('each platform gets its native aspect', () => {
    expect(SRC).toMatch(/VIDEO_ASPECT = \{ meta: '1:1', google: '16:9', tiktok: '9:16' \}/);
  });
});
