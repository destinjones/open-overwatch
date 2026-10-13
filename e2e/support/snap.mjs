// Picture checks, stored small: a screenshot is shrunk to a thumbnail (160 px wide by default, 5-25 kB as PNG) and
// compared with a reference in e2e/snapshots/ within tolerances. The shrink averages away what differs between machines
// (font hinting, anti-aliasing, a pixel of rounding) and keeps what a regression changes: layout, colour, what is drawn
// where. Software WebGL (SwiftShader, the config's default) draws the same pictures run after run.
//
// References: <name>.<platform>.png when there is one (win32, linux, darwin), else <name>.png, so a platform whose
// fonts render too differently can get its own set without touching the others.
//   OO_E2E_UPDATE=1 npx playwright test visual          rewrites <name>.png (look at them before committing)
//   OO_E2E_UPDATE=platform npx playwright test visual   writes <name>.<this platform>.png
// Every mismatch also leaves the actual thumbnail in e2e/.results/snapshots-actual/, named like its reference, so a CI
// run's artifact can be dropped into e2e/snapshots/ after a look. A missing reference is written on a local run (the
// test passes with a note) and is a failure on CI.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect } from '@playwright/test';
import { compare, decodePng, downscale, encodePng, upscale } from './png.mjs';

const DIR = fileURLToPath(new URL('../snapshots/', import.meta.url));
const ACTUAL = fileURLToPath(new URL('../.results/snapshots-actual/', import.meta.url));
const png = img => encodePng(img.width, img.height, img.data);

/** The reference file for `name` on this platform: [path to read, path to write]. */
function refFiles(name) {
  const own = path.join(DIR, `${name}.${process.platform}.png`), shared = path.join(DIR, `${name}.png`);
  const write = process.env.OO_E2E_UPDATE === 'platform' ? own : shared;
  return [existsSync(own) ? own : shared, write];
}

/**
 * Check the page (or `clip`) against the reference `name`. Options: width (thumbnail width, px; the height keeps the
 * aspect), maxMean (average channel difference, 0-255), maxBad (share of thumbnail pixels off by more than `tol`),
 * hide (selectors made invisible first: clocks, live text), mask (selectors painted over by Playwright).
 */
export async function expectLooksLike(page, testInfo, name, { width = 160, maxMean = 5, maxBad = 0.02, tol = 48, hide = [], mask = [], clip, fullPage = false } = {}) {
  if (hide.length) await page.addStyleTag({ content: `${hide.join(',')}{visibility:hidden!important}` });
  const shot = await page.screenshot({ clip, fullPage, animations: 'disabled', caret: 'hide', scale: 'css', mask: mask.map(s => page.locator(s)), maskColor: '#ff00ff' });
  const full = decodePng(shot), thumb = downscale(full, width, Math.max(1, Math.round(width * full.height / full.width)));
  const [file, target] = refFiles(name);
  await testInfo.attach(`${name}-actual.png`, { body: png(thumb), contentType: 'image/png' });
  const keep = () => { mkdirSync(ACTUAL, { recursive: true }); writeFileSync(path.join(ACTUAL, path.basename(file)), png(thumb)); };
  if (process.env.OO_E2E_UPDATE || (!existsSync(file) && !process.env.CI)) {
    mkdirSync(DIR, { recursive: true }); writeFileSync(target, png(thumb));
    testInfo.annotations.push({ type: 'snapshot', description: `wrote e2e/snapshots/${path.basename(target)} (${thumb.width}x${thumb.height})` });
    return;
  }
  if (!existsSync(file)) { keep(); throw new Error(`no reference e2e/snapshots/${name}.png: make one with OO_E2E_UPDATE=1 (or take e2e/.results/snapshots-actual/ from this run)`); }
  const ref = decodePng(readFileSync(file));
  if (thumb.width !== ref.width || thumb.height !== ref.height) keep();
  expect(`${thumb.width}x${thumb.height}`, `${name}: thumbnail size (the page's aspect changed?)`).toBe(`${ref.width}x${ref.height}`);
  const r = compare(thumb, ref, tol);
  console.log(`[snapshot] ${path.basename(file)}: mean ${r.mean.toFixed(2)} (max ${maxMean}), off ${(r.bad * 100).toFixed(2)}% (max ${(maxBad * 100).toFixed(1)}%)`);
  if (r.mean > maxMean || r.bad > maxBad) {
    keep();
    await testInfo.attach(`${name}-expected.png`, { body: png(upscale(ref, 4)), contentType: 'image/png' });
    await testInfo.attach(`${name}-diff.png`, { body: png(upscale(r.diff, 4)), contentType: 'image/png' });
  }
  expect.soft(+r.mean.toFixed(2), `${name}: mean difference (0-255) vs ${path.basename(file)}`).toBeLessThanOrEqual(maxMean);
  expect.soft(+r.bad.toFixed(4), `${name}: share of pixels off by more than ${tol}`).toBeLessThanOrEqual(maxBad);
}
