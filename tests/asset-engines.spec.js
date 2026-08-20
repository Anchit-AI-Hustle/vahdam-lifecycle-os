const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Locks the per-asset generation contract: every asset type is designed,
// structured and validated by the engine that OWNS it, rather than by one
// prompt and one template shared across five different design problems.
//
// The failures this pins are all silent ones. A Google headline 15 characters
// over the cap is not rejected by Google, it is truncated in the auction. An
// organic caption with text baked into the image is not an error, it just
// performs like an ad. A landing page that introduces a guarantee the ad never
// made is the single most expensive kind of message-match break, and nothing
// in the pipeline could see any of them.

const ROOT = path.join(__dirname, '..');
const shared = (f) => require(path.join(ROOT, 'api', '_shared', f));
const AE = shared('asset-engines.js');
const specs = shared('asset-specs.js');
const SM = shared('scenario-model.js');
const adsQa = shared('ads-qa.js');
const SB = shared('smart-brain-plan.js');

const ctx = (over = {}) => ({ id: 'slot-1', date: '2026-08-22', market: 'US', cohort: { name: 'VIP' }, objective: 'retention', ...over });

// ── Coverage: no asset type is left on the generic path ─────────────────────
test('every asset type the app produces has its own engine', () => {
  // The list is what the generators actually emit today: a mailer, three ad
  // platforms, a landing page, the organic social platforms, video, playable
  // and blog. A new asset type without an engine falls back to nothing, so it
  // must fail here rather than ship unvalidated.
  const required = ['mailer', 'landing_page', 'video', 'playable', 'blog',
    'ad_meta', 'ad_google', 'ad_tiktok',
    'social_instagram', 'social_facebook', 'social_linkedin', 'social_x', 'social_youtube', 'social_pinterest'];
  for (const id of required) expect(AE.ENGINES[id], `${id} has no engine`).toBeTruthy();
});

test('every engine owns all five parts, not a subset', () => {
  for (const [id, e] of Object.entries(AE.ENGINES)) {
    expect(typeof e.design, `${id}.design`).toBe('function');
    expect(typeof e.contract, `${id}.contract`).toBe('function');
    expect(typeof e.qa, `${id}.qa`).toBe('function');
    expect(e.params && typeof e.params.temperature, `${id}.params.temperature`).toBe('number');
    const d = e.design(ctx());
    expect(Array.isArray(d.order) && d.order.length, `${id} design must state a structure`).toBeTruthy();
    expect(String(d.why || '').length, `${id} design must say WHY this structure`).toBeGreaterThan(20);
  }
});

test('engine parameters are not all identical, because the tasks are not', () => {
  // A 15-headline RSA sweep is a constrained-length problem and a story-driven
  // email is not. If every engine ends up on one temperature, the per-asset
  // split has been undone by a later edit.
  const temps = new Set(Object.values(AE.ENGINES).map((e) => e.params.temperature));
  expect(temps.size).toBeGreaterThan(1);
  expect(AE.ENGINES.ad_google.params.temperature).toBeLessThan(AE.ENGINES.social_instagram.params.temperature);
});

// ── One source for every limit ──────────────────────────────────────────────
test('the ad engines read their caps from asset-specs, never a private copy', () => {
  // Mutating the spec at runtime is the only honest way to prove the value is
  // READ rather than re-typed: a hardcoded 30 would ignore this entirely.
  const orig = specs.ADS.google.copy.headlines.max;
  try {
    specs.ADS.google.copy.headlines.max = 12;
    const engine = AE.engineFor('ad', 'google');
    const verdict = engine.qa({ headlines: ['thirteen chars'], descriptions: ['ok'], image_brief: 'a scene' }, ctx());
    expect(verdict.ok, 'a 14-char headline must fail once the cap is 12').toBe(false);
    expect(JSON.stringify(verdict.issues)).toContain('12-char');
  } finally {
    specs.ADS.google.copy.headlines.max = orig;
  }
});

test('ads-qa reads the same caps rather than keeping its own map', () => {
  // ads-qa builds its LIMITS table once at require time, so the mutation has
  // to happen before a FRESH require: re-requiring the cached module would
  // measure the table built from the real spec and prove nothing.
  const qaPath = require.resolve(path.join(ROOT, 'api', '_shared', 'ads-qa.js'));
  const orig = specs.ADS.meta.copy.headline;
  try {
    specs.ADS.meta.copy.headline = 5;
    delete require.cache[qaPath];
    const fresh = require(qaPath);
    const r = fresh.qaAd({ platform: 'meta', creative_type: 'static', creative_brief: 'x', aspect: '1:1', cta: 'Shop', headline: 'far too long' });
    expect(JSON.stringify(r.issues), 'a hardcoded 40 would ignore the spec entirely').toContain('>5');
  } finally {
    specs.ADS.meta.copy.headline = orig;
    delete require.cache[qaPath];
    require(qaPath);
  }
});

test('the banned-phrase list has one home and both QA passes use it', () => {
  expect(SM.BANNED_PHRASES_RX, 'scenario-model must export the canonical list').toBeTruthy();
  const phrase = 'last chance to steep';
  // Both the engine QA and the older ads QA must catch the same phrase.
  const viaEngine = AE.engineFor('ad', 'meta').qa({ primary_text: phrase, headline: 'Calm mornings', image_brief: 'a scene' }, ctx());
  const viaAdsQa = adsQa.qaAd({ platform: 'meta', creative_type: 'static', creative_brief: 'x', aspect: '1:1', cta: 'Shop', primary_text: phrase });
  expect(JSON.stringify(viaEngine.issues)).toMatch(/banned phrase/i);
  expect(JSON.stringify(viaAdsQa.issues)).toMatch(/banned phrase/i);
  // And the file must not have grown a fresh copy of the regex.
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'ads-qa.js'), 'utf8');
  expect(src, 'ads-qa re-declared the banned list').not.toMatch(/const BANNED\s*=\s*\//);
});

// ── Determinism ─────────────────────────────────────────────────────────────
test('the same slot always gets the same design', () => {
  // A re-run that silently changes an approved asset means the reviewer
  // approved something that no longer exists.
  for (const e of Object.values(AE.ENGINES)) {
    const a = e.design(ctx());
    const b = e.design(ctx());
    expect(JSON.stringify(a), `${e.id} is not deterministic`).toBe(JSON.stringify(b));
  }
});

test('different slots do not all land on the same archetype', () => {
  // Determinism without spread would make a 90-day calendar one template.
  const seen = new Set();
  // Vary the DATE: that is what a calendar varies, and since the rotation walks
  // a permutation by date ordinal it is the axis that must produce spread.
  for (let i = 0; i < 24; i++) {
    const date = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
    seen.add(AE.ENGINES.social_instagram.design(ctx({ id: 'cal_' + date, date })).archetype);
  }
  expect(seen.size).toBeGreaterThan(1);
  // Two slots on the SAME day for the same cohort (an A/B pair, or two
  // products) share a date ordinal, so they need the slot discriminator to
  // differ - without it they would be designed identically.
  const sameDay = new Set();
  for (let i = 0; i < 24; i++) sameDay.add(AE.ENGINES.social_instagram.design(ctx({ id: 'slot-' + i })).archetype);
  expect(sameDay.size, 'every slot on one day got the same design').toBeGreaterThan(1);
});

test('two engines on the same slot decide independently', () => {
  // Without a per-engine salt, every engine indexes its own list with the same
  // number, so the ad format and the social angle move in lockstep for no
  // reason. Across a spread of slots the two must not be perfectly correlated.
  const pairs = new Set();
  for (let i = 0; i < 24; i++) {
    const date = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
    const c = ctx({ id: 'cal_' + date, date });
    pairs.add(AE.ENGINES.ad_meta.design(c).archetype + '|' + AE.ENGINES.social_instagram.design(c).archetype);
  }
  // 4 ad formats x 4 social angles = 16 possible pairings. FNV-1a's low bits
  // are weak enough that the two indices came out separated by a CONSTANT
  // offset, giving exactly 4 pairings across every slot in the calendar. The
  // floor is set above that number deliberately: it is the exact value the
  // unmixed hash produced.
  expect(pairs.size).toBeGreaterThan(8);
});

// ── The contracts that go into the prompt ───────────────────────────────────
test('no contract contains the dashes it tells the model never to use', () => {
  for (const [id, e] of Object.entries(AE.ENGINES)) {
    expect(e.contract(ctx()), `${id} contract contains an en/em dash`).not.toMatch(/[–—]/);
  }
});

test('each contract states the limits of ITS OWN platform', () => {
  expect(AE.ENGINES.ad_google.contract(ctx())).toContain(String(specs.ADS.google.copy.headlines.max));
  expect(AE.ENGINES.ad_meta.contract(ctx())).toContain(String(specs.ADS.meta.copy.primaryText));
  expect(AE.ENGINES.ad_tiktok.contract(ctx())).toContain(String(specs.ADS.tiktok.copy.caption));
  expect(AE.ENGINES.social_x.contract(ctx())).toContain(String(specs.SOCIAL.x.copy.post));
  // And the organic rule that separates it from paid.
  expect(AE.ENGINES.social_instagram.contract(ctx())).toMatch(/TEXT-FREE/);
});

test('the copy prompt actually carries the per-asset contracts', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'), 'utf8');
  expect(src, 'copyPrompt does not assemble the engines').toMatch(/AE\.contractsFor\(/);
  expect(src).toMatch(/PER-ASSET CONTRACTS/);
});

// ── QA catches the real failures ────────────────────────────────────────────
test('an over-length Google headline is a critical, with the measured value', () => {
  const v = AE.qaAsset('ad', { headlines: ['A headline far past the thirty character cap'], descriptions: ['fine'], image_brief: 'a scene' }, ctx(), 'google');
  expect(v.ok).toBe(false);
  const issue = v.issues.find((i) => i.limit === specs.ADS.google.copy.headlines.max);
  expect(issue, 'must report the limit it measured against').toBeTruthy();
  expect(issue.measured).toBeGreaterThan(issue.limit);
});

test('duplicate RSA headlines are reported, because Google recombines them', () => {
  const v = AE.qaAsset('ad', { headlines: ['Calm mornings', 'Calm mornings'], descriptions: ['fine'], image_brief: 'a scene' }, ctx(), 'google');
  expect(JSON.stringify(v.issues)).toMatch(/duplicate headline/);
});

test('an ad with no creative brief is critical: it would render as text only', () => {
  const v = AE.qaAsset('ad', { primary_text: 'Calm mornings', headline: 'Start steady' }, ctx(), 'meta');
  expect(v.ok).toBe(false);
  expect(JSON.stringify(v.issues)).toMatch(/render as text only/);
});

test('an invented offer is critical and names the missing data', () => {
  const v = AE.qaAsset('ad', { primary_text: 'Take 20% off today', headline: 'Calm mornings', image_brief: 'a scene' }, ctx(), 'meta');
  expect(v.ok).toBe(false);
  const issue = v.issues.find((i) => i.data_required);
  expect(issue.data_required).toContain('DATA REQUIRED BEFORE LAUNCH');
});

test('an organic caption is measured WITH its hashtags, not without', () => {
  const cap = specs.SOCIAL.x.copy.post;                 // 280
  const caption = 'x'.repeat(cap - 10);                 // under on its own
  const v = AE.qaAsset('social', { caption, hashtags: ['#singleestate', '#morningritual'] }, ctx(), 'x');
  expect(v.ok, 'caption plus hashtags exceeds the cap and must fail').toBe(false);
  expect(JSON.stringify(v.issues)).toMatch(/caption plus hashtags/);
});

test('an organic creative that asks for baked-in text is critical', () => {
  const v = AE.qaAsset('social', { caption: 'A quiet morning at the estate', image_brief: 'the pack with the headline text overlaid in gold' }, ctx(), 'instagram');
  expect(v.ok).toBe(false);
  expect(JSON.stringify(v.issues)).toMatch(/text-free/);
});

test('a landing page may not introduce an offer its own ad never made', () => {
  const bad = AE.qaAsset('landing_page', { hero_headline: 'Calmer mornings', hero_sub: 'From one estate', cta: 'Claim your money-back guarantee' }, ctx({ source_copy: 'Calmer mornings, from one estate' }));
  expect(bad.ok).toBe(false);
  expect(JSON.stringify(bad.issues)).toMatch(/message-match break/);
  // The same page is fine when the originating creative did state it.
  const ok = AE.qaAsset('landing_page', { hero_headline: 'Calmer mornings', hero_sub: 'From one estate', cta: 'Claim your money-back guarantee' }, ctx({ source_copy: 'Calmer mornings with our money-back guarantee' }));
  expect(ok.ok).toBe(true);
});

test('an unverifiable message match is a warning, not a silent pass', () => {
  const v = AE.qaAsset('landing_page', { hero_headline: 'Calmer mornings', hero_sub: 'From one estate', cta: 'Shop the ritual' }, ctx());
  expect(v.ok, 'nothing here is a hard failure').toBe(true);
  expect(JSON.stringify(v.issues)).toMatch(/message match could not be verified/);
});

test('a preheader that repeats the subject is reported', () => {
  const v = AE.qaAsset('mailer', { subject: 'Calmer mornings', preheader: 'Calmer mornings', hero_headline: 'H', intro_paragraph: 'p', cta: 'Shop' }, ctx());
  expect(JSON.stringify(v.issues)).toMatch(/duplicates the subject/);
});

test('a video brief with no shots is critical, and a silent one is flagged', () => {
  const none = AE.qaAsset('video', {}, ctx());
  expect(none.ok).toBe(false);
  expect(JSON.stringify(none.issues)).toMatch(/slideshow of stills/);
  const silent = AE.qaAsset('video', { storyboard: [{ duration_s: 2 }, { duration_s: 3 }, { duration_s: 3 }] }, ctx());
  expect(JSON.stringify(silent.issues)).toMatch(/renders silent/);
  // The case CLAUDE.md records: music was asked for and the provider has none.
  const runway = AE.qaAsset('video', { storyboard: [{ duration_s: 2, audio: 'warm strings' }], audio: 'warm strings', audio_requested: true, audio_supported: false }, ctx());
  expect(runway.ok).toBe(false);
  expect(JSON.stringify(runway.issues)).toMatch(/no audio track/);
});

test('a playable that reaches the network is critical: reviewers test offline', () => {
  const v = AE.qaAsset('playable', { html: '<img src="https://cdn.example/x.png"><button onclick="FbPlayableAd.onCTAClick()">Go</button>' }, ctx());
  expect(v.ok).toBe(false);
  expect(JSON.stringify(v.issues)).toMatch(/inline every asset as a data: URI/);
  const inert = AE.qaAsset('playable', { html: '<img src="data:image/png;base64,AA"><button onclick="window.open(\'/x\')">Go</button>' }, ctx());
  expect(JSON.stringify(inert.issues)).toMatch(/window\.open/);
});

test('a clean asset passes with no critical issues', () => {
  const v = AE.qaAsset('ad', { primary_text: 'Some mornings start steady. This is one of them.', headline: 'Steady mornings', description: 'Single-estate', image_brief: 'low side light, 85mm, real pack' }, ctx(), 'meta');
  expect(v.ok, JSON.stringify(v.issues)).toBe(true);
  expect(v.critical).toBe(0);
});

test('an unknown asset type is reported, never quietly skipped', () => {
  const v = AE.qaAsset('carrier-pigeon', {}, ctx());
  expect(v.ok).toBe(false);
  expect(v.summary).toMatch(/no engine for asset type/);
});

// ── Campaign roll-up ────────────────────────────────────────────────────────
test('qaCampaign checks every asset and rolls up honestly', () => {
  const campaign = {
    assets: {
      email: { subject: 'Steady mornings', preheader: 'One estate, one cup', hero_headline: 'H', intro_paragraph: 'p', cta: 'Shop' },
      landing_pages: [{ hero_headline: 'Steady mornings', hero_sub: 'From one estate', cta: 'Shop' }],
      ads: [
        { platform: 'meta', primary_text: 'Steady mornings', headline: 'Steady', image_brief: 'a scene' },
        { platform: 'google', headlines: ['Steady mornings'], descriptions: ['Single-estate tea'], image_brief: 'a scene' },
      ],
    },
  };
  const r = AE.qaCampaign(campaign, ctx({ source_copy: 'Steady mornings' }));
  expect(r.checked).toBe(4);
  expect(r.ok, JSON.stringify(r.results.filter((x) => !x.ok))).toBe(true);
  expect(r.results.map((x) => x.asset)).toEqual(['email', 'landing_page', 'ad:meta', 'ad:google']);
});

// ── The renderer actually follows the engine ────────────────────────────────
// A source-only test cannot prove a template obeyed the design algorithm, so
// this renders real pages and reads the order out of the output.
test('the landing page renders in the order its archetype chose', () => {
  const copy = { landing: { hero_headline: 'H', hero_sub: 'S', why_title: 'Why this edit', why_bullets: ['a'], proof_quote: 'A real line', proof_author: 'Anna', faq: [{ q: 'Q', a: 'A' }], cta: 'Shop' } };
  const page = (objective) => SB.lpHtml({ id: 'x' + objective, date: '2026-08-22', market: 'US', cohort: { name: 'c' }, objective, heroProduct: { title: 'T', handle: 't', price: 9 } }, copy, 'c1', null);

  // The archetype rotates within the intent's suitable set, so assert the page
  // obeys WHICHEVER shape was chosen rather than pinning one key - pinning is
  // what made every winback page identical for 90 days straight.
  const LP = AE.ENGINES.landing_page;
  for (const objective of ['winback lapsed buyers', 'activation for new subscribers']) {
    const slot = { id: 'x' + objective, date: '2026-08-22', market: 'US', cohort: { name: 'c' }, objective };
    const d = LP.design(slot);
    const html = page(objective);
    expect(html, 'the page does not record the archetype it rendered').toContain(d.archetype);
    // proof vs why must appear in the order this archetype declares.
    const iProof = d.order.indexOf('proof');
    const iWhy = d.order.indexOf('why');
    if (iProof >= 0 && iWhy >= 0) {
      const rendered = [html.indexOf('A real line'), html.indexOf('Why this edit')];
      expect(rendered[0] > -1 && rendered[1] > -1, 'both sections should render').toBe(true);
      expect(rendered[0] < rendered[1], `${d.archetype} declares ${d.order.join(' -> ')} but rendered them the other way`)
        .toBe(iProof < iWhy);
    }
  }
});

test('a section with no copy is omitted, never padded with invented content', () => {
  const copy = { landing: { hero_headline: 'H', hero_sub: 'S', why_bullets: ['a'], cta: 'Shop' } };  // no steps supplied
  const html = SB.lpHtml({ id: 'g1', date: '2026-08-22', market: 'US', cohort: { name: 'c' }, objective: 'activation for new subscribers', heroProduct: { title: 'T', handle: 't' } }, copy, 'c1', null);
  expect(html).toContain('ritual-howto');            // the archetype asked for steps
  expect(html).not.toContain('step by step');        // and none were invented to fill it
});

test('the rendered page records which archetype produced it', () => {
  const copy = { landing: { hero_headline: 'H', hero_sub: 'S', why_bullets: ['a'], cta: 'Shop' } };
  const html = SB.lpHtml({ id: 'r1', date: '2026-08-22', market: 'US', cohort: { name: 'c' }, objective: 'retention', heroProduct: { title: 'T', handle: 't' } }, copy, 'c1', null);
  expect(html).toMatch(/<!-- Landing archetype: [a-z-]+ \(.+\)\. Section order: .+ -->/);
});

// ── The store host in a generated asset ─────────────────────────────────────
// master-prompt.js kept its own region map, and two of the six entries pointed
// at hosts that market-urls.js itself lists as merely REDIRECTING
// (www.vahdamindia.com for IN, www.vahdamteas.com for Global). Every landing
// page CTA and every pasted master prompt for those markets sent the reader to
// a bounce. This is the tenth hand-kept copy of that map; the guard is that it
// is read, not re-typed.
test('the master prompt takes its store host from market-urls, not a private map', () => {
  const mp = shared('master-prompt.js');
  const urls = shared('market-urls.js');
  for (const market of ['US', 'UK', 'IN', 'EU', 'AU', 'Global']) {
    expect(mp.regionFacts(market).store, `${market} store host`).toBe(urls.storeHost(market));
  }
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'master-prompt.js'), 'utf8');
  for (const dead of ['vahdamindia.com', 'vahdamteas.com']) {
    expect(src, `master-prompt names the redirecting host ${dead}`).not.toMatch(new RegExp("store:\\s*'[^']*" + dead.replace('.', '\\.')));
  }
});
