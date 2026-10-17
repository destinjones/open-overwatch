// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// ESLint for bugs only: undefined names (with each folder's real globals), unused variables (a warning), duplicate keys,
// unreachable code, constant conditions, self-assignment and switch fall-through. No style rules: the code's layout is
// its own. Run with `npm run lint` (a dev dependency; it never runs on the site or ships in the zip or the .mcpb).
import globals from 'globals';

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-self-assign': 'error',
  'no-fallthrough': 'error',
  eqeqeq: 'off',
};
const esm = { ecmaVersion: 'latest', sourceType: 'module' };
// what the pages put on window before the modules run: Leaflet (L) and satellite.js from their CDN scripts, the map's
// version (src/map/version.js, a classic script) and its flyTo (src/map/detail.js); for the tests' page.evaluate callbacks, the views' console handles
const MAP = { L: 'readonly', satellite: 'readonly', OW_VERSION: 'readonly', flyTo: 'readonly' };
const PAGE = { ...MAP, Cesium: 'readonly', OW: 'readonly', OO3D: 'readonly', OOSS: 'readonly', OOApp: 'readonly' };

export default [
  { ignores: ['node_modules/', 'src/vendor/', 'e2e/.cache/', 'e2e/.results/', 'e2e/.report/', 'brand/tools/_*/', 'relay/.wrangler/', 'dist/', '_site/'] },
  { linterOptions: { reportUnusedDisableDirectives: 'warn' } },
  // the website's modules: a browser page (and its workers, below); src/core also runs in Node for the tests
  { files: ['src/**/*.js'], languageOptions: { ...esm, globals: { ...globals.browser } }, rules },
  { files: ['src/map/**/*.js'], languageOptions: { globals: MAP } },
  { files: ['src/globe/**/*.js'], languageOptions: { globals: { satellite: 'readonly' } } },
  { files: ['src/map/version.js'], languageOptions: { sourceType: 'script' }, rules: { 'no-unused-vars': ['warn', { vars: 'local' }] } },
  { files: ['src/**/*.worker.js'], languageOptions: { ...esm, globals: { ...globals.worker } }, rules },
  // the service worker: a classic script
  { files: ['sw.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.serviceworker } }, rules },
  // Cloudflare Workers: the relay and the MCP server's Worker entry
  { files: ['relay/**/*.js', 'mcp/worker.mjs'], languageOptions: { ...esm, globals: { ...globals.serviceworker } }, rules },
  // Node: the MCP server, the local helper, the tests and the brand tools (the browser tools' page.evaluate callbacks
  // run in the page, so those files see the browser's names too)
  { files: ['mcp/**/*.mjs'], ignores: ['mcp/worker.mjs'], languageOptions: { ...esm, globals: { ...globals.node } }, rules },
  { files: ['serve.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } }, rules },
  { files: ['test/**/*.mjs', 'e2e/**/*.mjs', 'brand/tools/*.mjs', 'playwright.config.mjs'], languageOptions: { ...esm, globals: { ...globals.node, ...globals.browser, ...PAGE } }, rules },
];
