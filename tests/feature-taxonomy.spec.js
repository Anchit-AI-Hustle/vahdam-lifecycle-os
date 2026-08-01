const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The nav is where features are DISCOVERED, so a nav edit can delete a feature
// without touching a line of its code. Three have gone that way already:
// INFO.ads (the ad builder), INFO.officialdesigns (the 3D storefront) and
// INFO.analysis (Data Analysis) each became unreachable when a row was renamed
// or merged, leaving a working feature with no name and no description anywhere
// in the product. These tests make that failure loud.

const AUTH = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');

const gids = [...AUTH.matchAll(/gid: '([a-z0-9]+)'/g)].map((m) => m[1]);
const ids = [...AUTH.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((m) => m[1]);
const infoKeys = [...AUTH.matchAll(/^ {4}([a-z0-9]+): \{$/gm)].map((m) => m[1]);

test.describe('nav ↔ INFO integrity', () => {
  test('every group ? chip resolves to a real description', () => {
    // infoBtn() renders nothing when INFO[key] is missing, so a typo'd gid does
    // not error — it just silently removes the feature's explanation.
    const missing = gids.filter((g) => !infoKeys.includes(g));
    expect(missing, `gid(s) with no INFO entry: ${missing.join(', ')}`).toEqual([]);
  });

  test('no NEW feature description is left rendering nowhere', () => {
    // The other direction of the same invariant. An INFO entry reachable by no
    // gid and no row id is dead text — that is exactly how the ad builder and
    // the 3D storefront lost their descriptions while their code kept working.
    // These three are known leftovers from the deliberate consolidation of the
    // calendar features into `brain`; the point of the allowlist is that adding
    // a fourth has to be a conscious act, not a side effect of a rename.
    const KNOWN_DEAD = ['calendar', 'lifecycle', 'ukhub'];
    const reachable = new Set([...gids, ...ids]);
    const orphans = infoKeys.filter((k) => !reachable.has(k) && !KNOWN_DEAD.includes(k));
    expect(orphans, `INFO entries no nav item can reach: ${orphans.join(', ')}`).toEqual([]);
  });

  test('the two features the owner separated each have their own entry', () => {
    expect(gids).toContain('storefront3d');
    expect(gids).toContain('landing');
    expect(infoKeys).toContain('storefront3d');
    expect(infoKeys).toContain('landing');
  });
});

test.describe('3D Website & Storefront is the website revamp', () => {
  test('it is its own group, no longer sharing the landing-pages description', () => {
    expect(AUTH).toContain("{ group: '3D Website & Storefront', icon: 'vahdam', gid: 'storefront3d'");
    // The old shape: a 3D-titled group whose ? popup described landing pages.
    expect(AUTH).not.toContain("group: '3D Storefront & Websites'");
  });

  test('it carries the regional websites and the clones, and no landing pages', () => {
    const group = AUTH.slice(AUTH.indexOf("group: '3D Website & Storefront'"), AUTH.indexOf("group: 'Landing Pages'"));
    ['store3d-all', 'web-us', 'web-uk', 'web-global', 'web-india', 'web-clones'].forEach((id) => {
      expect(group).toContain(`id: '${id}'`);
    });
    expect(group).not.toContain("id: 'lp-");
  });

  test('its description frames it as the store, not as campaign pages', () => {
    const info = AUTH.slice(AUTH.indexOf('storefront3d: {'));
    expect(info.slice(0, 1400)).toContain('THE WEBSITE REVAMP');
  });
});

test.describe('Landing Pages is campaign destinations', () => {
  test('the builder has a nav entrance of its own', () => {
    // Before this it was reachable ONLY via deep #channel links, so the feature
    // that CREATES landing pages had no row anywhere in the rail.
    expect(AUTH).toContain("{ id: 'lp-build'");
    expect(AUTH).toMatch(/id: 'lp-build',\s*label: 'Landing Page Builder', href: '\/landing-pages'/);
  });

  test('it serves mailers and every ad channel', () => {
    const group = AUTH.slice(AUTH.indexOf("group: 'Landing Pages'"));
    ['lp-mailers', 'lp-meta', 'lp-google', 'lp-tiktok', 'lp-templates'].forEach((id) => {
      expect(group.slice(0, 3000)).toContain(`id: '${id}'`);
    });
  });

  test('it carries no 3D website items', () => {
    const group = AUTH.slice(AUTH.indexOf("group: 'Landing Pages'"), AUTH.indexOf("{ id: 'music'"));
    ['web-us', 'web-uk', 'web-global', 'web-india', 'store3d-all'].forEach((id) => {
      expect(group).not.toContain(`id: '${id}'`);
    });
  });

  test('its description says destination, and points away from the storefront', () => {
    const info = AUTH.slice(AUTH.indexOf('landing: {'));
    expect(info.slice(0, 1600)).toContain('CAMPAIGN DESTINATIONS');
  });
});
