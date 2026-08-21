const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// AN ACCOUNT CARD THAT SAYS "19 CAMPAIGNS" AND DOES NOTHING WHEN CLICKED.
//
// "Today by account" printed each ad account with its ad and campaign counts —
// an explicit invitation to click through — as a plain <div class='acard'>. There
// was no click target, and the shared attribution graph in funnel-drill.js had no
// `account` stage at all (region → channel → platform → campaign → adset → ad).
//
// Worse, the capability was already there twice over:
//   * ads-snowflake-core.hierarchy() has ALWAYS accepted an `account` param and
//     applied it in the SQL WHERE via accountFilter(); the UI never sent it, so
//     every drill showed EVERY account's campaigns under whichever account you
//     had just clicked — a wrong number under a right heading.
//   * the campaign → ad set → ad tree already existed, with a breadcrumb.
//
// Same "the feature kept its code and lost its entrance" shape as the Creative
// Studio nav row and the day-panel asset viewer.

const ROOT = path.join(__dirname, '..');
const MASTER = fs.readFileSync(path.join(ROOT, 'ad-campaigns-master.html'), 'utf8');
const CORE = fs.readFileSync(path.join(ROOT, 'api/_shared/ads-snowflake-core.js'), 'utf8');
const DRILL = fs.readFileSync(path.join(ROOT, 'funnel-drill.js'), 'utf8');

test('the account card is a real control, not a div that looks clickable', () => {
  // It must be a <button> (keyboard-reachable, announced) carrying the account id.
  expect(MASTER, 'the account card is still a plain div').toMatch(/<button[^>]*class='acard/);
  expect(MASTER).toContain('data-drill-acct=');
  // And it must say where it goes, for a mouse and for a screen reader.
  expect(MASTER).toMatch(/aria-label='Open .*campaigns/);
  expect(MASTER).toContain('View campaigns');
});

test('clicking an account scopes the tree instead of resetting it', () => {
  // TREE must carry the account, or the tree reopens showing every account.
  expect(DRILL).toBeTruthy();
  expect(MASTER).toMatch(/var TREE=\{account:null/);
  const fn = MASTER.slice(MASTER.indexOf('function drillIntoAccount'), MASTER.indexOf('function drillIntoAccount') + 700);
  expect(fn, 'drillIntoAccount does not set the account scope').toMatch(/TREE=\{account:id/);
  expect(fn, 'the drill does not open the tree tab').toContain('data-p="campaigns"');
  expect(fn, 'the drill does not reload the tree').toContain('loadTree()');
});

test('the account scope is actually sent to the query', () => {
  // The whole defect: the param existed server-side and was never sent.
  expect(MASTER, 'the hierarchy query still omits the account scope')
    .toMatch(/TREE\.account\?"&account="\+encodeURIComponent\(TREE\.account\)/);
});

test('the core applies the account scope in SQL and echoes it back', () => {
  // Applied: otherwise the UI narrows and the data does not.
  expect(CORE).toMatch(/accountFilter\(acctCol, account\)/);
  // Echoed: so a caller can VERIFY the scope landed rather than assume it.
  const h = CORE.slice(CORE.indexOf('async function hierarchy'), CORE.indexOf('async function hierarchy') + 2600);
  expect(h, 'hierarchy() does not echo the account it scoped to').toMatch(/account:\s*account \|\| null/);
});

test('the breadcrumb can get back out of an account', () => {
  // A scope you cannot leave is a trap.
  expect(MASTER).toContain('"All accounts"');
  expect(MASTER, 'the breadcrumb drops the account when descending')
    .toMatch(/parts\.push\(\[TREE\.campaign,\{account:A/);
});

test('the shared graph has an account stage that narrows exactly', () => {
  // funnel-drill.js is the one attribution graph; an ad account was missing from
  // it entirely even though the whole ads dashboard is organised by account.
  const m = DRILL.match(/account:\s*\{[\s\S]{0,900}?\n    \},/);
  expect(m, 'funnel-drill.js has no account stage').toBeTruthy();
  const stage = m[0];
  expect(stage).toContain("next: 'campaign'");
  // It must NARROW (a real join), not navigate unnarrowed.
  expect(stage, 'the account stage does not return a join').toMatch(/match:\s*'equals'/);
  expect(stage).toMatch(/field:\s*'account'/);
});

test('account is NOT spliced into platform -> campaign', () => {
  // The analytics ads cut carries no account column. Making account a mandatory
  // link would either break that chain or invent a narrowing the rows cannot
  // support, so it is an additional entry point instead.
  expect(DRILL).toMatch(/platform:\s*\{[\s\S]{0,200}next:\s*'campaign'/);
});
