// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// a11y_check.mjs — the accessibility check of every page's HTML (src/core/a11ycheck.js), with a readable report.
//   node brand/tools/a11y_check.mjs [page.html …]      exit code 1 if any page has errors
// CI runs the same check through test/a11y.test.mjs; this is the version for people.
import { readFileSync } from 'node:fs';
import { checkHtml } from '../../src/core/a11ycheck.js';

export const PAGES = ['index.html', 'globe.html', 'open-overwatch.html', 'solar.html', 'tonight.html', 'about.html', 'guide.html', 'offline.html', '404.html', 'india/index.html'];
export const ZOOM_OK = new Set(['globe.html', 'open-overwatch.html', 'solar.html']);   // they handle pinch themselves

const root = new URL('../../', import.meta.url);
const pages = process.argv.slice(2).length ? process.argv.slice(2) : PAGES;
let bad = 0;
for (const p of pages) {
  const { errors, warnings } = checkHtml(readFileSync(new URL(p, root), 'utf8'), { zoomOk: ZOOM_OK.has(p) });
  console.log(`${errors.length ? '✗' : '✓'} ${p}: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
  for (const e of errors) console.log(`    error   ${p}:${e.line}  [${e.rule}] ${e.what}`);
  for (const w of warnings) console.log(`    warning ${p}:${w.line}  [${w.rule}] ${w.what}`);
  bad += errors.length;
}
process.exit(bad ? 1 : 0);
