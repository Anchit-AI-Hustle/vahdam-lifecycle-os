const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Recreating ONE day of the calendar. The bug this locks is not a crash, it is a
// button that appears to work and changes nothing: the previous build offered
// "Regenerate" only on rejected slots, and even there it only stripped the
// __prebuilt marker from the CLIENT's copy of the entry — while the server also
// reads that marker off the database row via reuseCampaignId() and hands the
// identical bundle straight back. So the assertions below are about the force
// flag surviving every hop, and about every slot status having the control.

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'smart-brain.html'), 'utf8');
const PLAN = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'), 'utf8');
const ROUTER = fs.readFileSync(path.join(ROOT, 'api', 'calendar.js'), 'utf8');

test.describe('recreate a particular day', () => {
  test('every row carries a Recreate control, not just rejected ones', () => {
    expect(HTML).toContain('id="rebtn-${i}"');
    expect(HTML).toContain('onclick="recreateEntry(${i})"');
    // The control sits in the Actions cell beside View/Download, so it is present
    // whatever the slot's status — the old one lived inside the `rejected` branch.
    const actionsCell = HTML.slice(HTML.indexOf('id="viewbtn-${i}"'), HTML.indexOf('id="dlbtn-${i}"'));
    expect(actionsCell).toContain('recreateEntry');
  });

  test('the client sends force, not just a locally-stripped marker', () => {
    expect(HTML).toContain('force: !!forceRegen');
  });

  test('the router forwards force to previewEntry', () => {
    // Not [^}]* — the same call passes `config: body.config || {}`, whose braces
    // would end the match before it ever reaches force.
    expect(ROUTER).toMatch(/previewEntry\([\s\S]{0,240}?force:\s*!!body\.force/);
  });

  test('force defeats BOTH reuse paths — the approved short-circuit and the row marker', () => {
    // Approved/final slots normally return the saved campaign; force must skip it.
    expect(PLAN).toMatch(/if \(!force && db\.connected && row && \(row\.status === 'approved'/);
    // reuseCampaignId is what reads the marker off the DB row.
    expect(PLAN).toMatch(/const reuseId = force \? null : reuseCampaignId\(entry, row\)/);
  });

  test('recreating an approved day keeps its campaign id so live /lp links survive', () => {
    const forceBlock = PLAN.slice(PLAN.indexOf('if (force && db.connected && row'), PLAN.indexOf('if (!force && db.connected && row'));
    // republishOrphan is the existing contract that persists under row.generated_campaign_id.
    expect(forceBlock).toContain('republishOrphan');
    expect(forceBlock).toContain('recreated: true');
  });

  test('a recreate drops the stale prebuilt marker as it stamps the new one', () => {
    // Otherwise the very next View reuses the bundle we were asked to replace.
    expect(PLAN).toContain('if (force) delete payload[PREBUILD_MARKER]');
    expect(PLAN).toMatch(/\(force \|\| !isPrebuilt\(fresh\)\)/);
  });

  test('an approved day asks before replacing what ships', () => {
    expect(HTML).toMatch(/const live = e\.status === 'approved' \|\| e\.status === 'final'/);
    expect(HTML).toMatch(/if\(live && !confirm\(/);
  });

  test('a recreate builds the full asset set, not the copy-only skeleton', () => {
    // force selects the whole options object, not just withCreatives: a recreate
    // also gets scene backplates and real video, while a passive View stays cheap.
    const site = PLAN.slice(PLAN.indexOf('campaign = await buildCampaign(effectiveEntry(entry), config, force'));
    expect(site.slice(0, 260)).toMatch(/withCreatives: true, scenes: true, sceneTier: 'standard', withVideo: true/);
    expect(site.slice(0, 260)).toContain('{ id, withCreatives: false }');
  });
});

test.describe('landing pages start from what the ad promised', () => {
  test('the calendar prompt ties the page hero to the ads, not to the brand', () => {
    // The page is generated in the same JSON as the ads, so without this rule it
    // reads as a sibling of them and can open on a generic origin line instead of
    // the promise the click was made on.
    expect(PLAN).toContain('MESSAGE MATCH IS THE JOB OF THE LANDING PAGE');
    expect(PLAN).toMatch(/it is their destination/);
    expect(PLAN).toMatch(/never on a generic brand or origin line/);
  });

  test('and it may not introduce facts the ads never stated', () => {
    const rule = PLAN.slice(PLAN.indexOf('MESSAGE MATCH IS THE JOB OF THE LANDING PAGE'));
    expect(rule.slice(0, 1200)).toMatch(/Introduce no price, discount, rating, review count, guarantee or claim/);
  });

  test('the Creative Studio path already enforces the same rule', () => {
    const gen = fs.readFileSync(path.join(ROOT, 'api', 'ai', 'generate.js'), 'utf8');
    expect(gen).toContain('MESSAGE MATCH IS THE JOB');
  });
});
