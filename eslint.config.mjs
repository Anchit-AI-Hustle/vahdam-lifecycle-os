// Minimal, targeted lint config.
//
// Scope is deliberate: the standalone JS that CI already syntax-checks, plus
// the specs. The 4.2MB of inline JS in the pages is covered by
// tests/inline-js-parses.spec.js instead - linting it would mean extracting it
// first, and a thousand style warnings nobody reads is worse than no linter.
//
// Rules are chosen from defects that ACTUALLY reached CI in this repo rather
// than from a style preference:
//   no-unused-vars     - an unused import shipped and was caught by a bot
//   no-useless-escape  - three CodeQL alerts here were regex/escaping slips
//   no-undef           - a typo'd global is a runtime death in a serverless fn
//   no-cond-assign / no-constant-condition / no-dupe-keys / no-unreachable
//                      - the classic silent-wrong-behaviour set
// Style is left entirely alone; this is a correctness net, not a formatter.

const NODE_GLOBALS = {
  require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly',
  __dirname: 'readonly', __filename: 'readonly', console: 'readonly', Buffer: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  fetch: 'readonly', AbortController: 'readonly', crypto: 'readonly', structuredClone: 'readonly',
  globalThis: 'readonly',
};
const BROWSER_GLOBALS = {
  parent: 'readonly', history: 'readonly', matchMedia: 'readonly', CSS: 'readonly',
  Audio: 'readonly', SpeechSynthesisUtterance: 'readonly', speechSynthesis: 'readonly',
  caches: 'readonly', performance: 'readonly', DOMParser: 'readonly', XMLHttpRequest: 'readonly',
  // Libraries loaded by <script> tag on the pages that use them.
  gsap: 'readonly', ScrollTrigger: 'readonly', ApexCharts: 'readonly', Chart: 'readonly',
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', alert: 'readonly', getComputedStyle: 'readonly',
  Element: 'readonly', HTMLElement: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
  requestAnimationFrame: 'readonly', IntersectionObserver: 'readonly', MutationObserver: 'readonly',
  Image: 'readonly', Blob: 'readonly', FileReader: 'readonly', FormData: 'readonly', Headers: 'readonly',
};

// A service worker has its own global scope, and workers/*.js run browser code
// inside page.evaluate() callbacks - so both need browser/SW globals declared
// or no-undef reports the environment rather than a defect.
const SW_GLOBALS = {
  self: 'readonly', caches: 'readonly', clients: 'readonly', skipWaiting: 'readonly',
  registration: 'readonly', ServiceWorkerGlobalScope: 'readonly', Response: 'readonly',
  Request: 'readonly', addEventListener: 'readonly',
};

const CORRECTNESS = {
  // WARN, not error, and deliberately so. There are ~47 pre-existing instances
  // across ~30 files - all dead code or harmless escapes, none a defect. Making
  // them blocking today would turn CI red on work nobody has touched, which is
  // the opposite of a useful gate. They stay visible and get cleaned in passing.
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-useless-escape': 'warn',

  // ERROR from here down. Every one of these is at zero today, so the gate is a
  // ratchet: it cannot go red on existing code, only on something newly broken.
  // no-undef is the one that earned its place - it found a ReferenceError on
  // the default path of /api/calendar?action=lifecycle-build-mailer that ~800
  // tests never exercised.
  'no-undef': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-unreachable': 'error',
  'no-cond-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-self-compare': 'error',
  'no-const-assign': 'error',
  'valid-typeof': 'error',
};

export default [
  {
    // Do NOT let --fix strip existing eslint-disable comments. It did exactly
    // that on first run: six files lost deliberate suppressions and gained
    // trailing whitespace. Those comments are intent written by whoever
    // anticipated a linter, and deleting them silently re-arms the rule later.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  { ignores: ['node_modules/**', 'test-results/**', 'tests/report/**', 'vendor/**',
              'marketing_automation/**', 'integrations/**/vendor/**', 'data/**', '*.min.js'] },
  {
    files: ['api/**/*.js', 'lib/**/*.js', 'workers/**/*.js', 'scripts/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: NODE_GLOBALS },
    rules: CORRECTNESS,
  },
  {
    files: ['*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS } },
    rules: CORRECTNESS,
  },
  {
    files: ['sw.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script',
      globals: { ...BROWSER_GLOBALS, ...SW_GLOBALS, fetch: 'readonly', console: 'readonly', URL: 'readonly' } },
    rules: CORRECTNESS,
  },
  {
    // Node scripts that ALSO ship browser code into page.evaluate().
    files: ['workers/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs',
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS } },
    rules: CORRECTNESS,
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS } },
    rules: CORRECTNESS,
  },
];
