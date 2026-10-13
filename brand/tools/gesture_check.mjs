// gesture_check.mjs — the touch side of src/app on a phone profile: the first-run hint card on the globe and the 2D
// map (shows once, "Got it" closes it, a reload does not bring it back), and the long press (the globe's "This spot"
// card, the map's spot popup). Screenshots in brand/perf/gestures/.
//   node brand/tools/gesture_check.mjs [chromium|webkit] [base=http://localhost:8787/]
// chromium = the installed Edge with a Pixel profile and real touch events over CDP; webkit = Playwright's WebKit
// with an iPhone 15 profile (no CDP there: the long press is sent as touch pointer events).
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR || path.join(os.homedir(), 'open-overwatch-work', 'pw'), 'package.json'));
const pw = require('playwright');
const ENGINE = process.argv[2] || 'chromium', BASE = process.argv[3] || 'http://localhost:8787/';
const OUT = new URL(`../perf/gestures/${ENGINE}/`, import.meta.url);
await mkdir(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// android: the emulator's Chrome over adb (docs/TESTING.md: adb reverse tcp:<port> tcp:<port>, adb forward tcp:9333
// localabstract:chrome_devtools_remote); a real phone screen, real touch through CDP
const browser = ENGINE === 'webkit' ? await pw.webkit.launch() : ENGINE === 'android' ? await pw.chromium.connectOverCDP('http://127.0.0.1:9333')
  : await pw.chromium.launch({ channel: 'msedge', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const ctx = ENGINE === 'android' ? browser.contexts()[0] : await browser.newContext({ ...(ENGINE === 'webkit' ? pw.devices['iPhone 15'] : pw.devices['Pixel 7']), permissions: ENGINE === 'webkit' ? [] : ['clipboard-read', 'clipboard-write'] });
for (const host of ['celestrak.org', 'opensky-network.org', 'adsb.lol', 'adsb.fi', 'airplanes.live', 'earthquake.usgs.gov', 'wheretheiss.at', 'api.open-meteo.com', 'gdeltproject.org'])
  await ctx.route(new RegExp(`https?://([^/]*\\.)?${host.replace(/\./g, '\\.')}/`), r => r.abort());
const page = await ctx.newPage();
const cdp = ENGINE === 'webkit' ? null : await ctx.newCDPSession(page);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message).split('\n')[0]));

const results = [];
let n = 0;
async function check(name, fn) {
  let ok = false, note = '';
  try { const r = await fn(); ok = r !== false && !(r && r.ok === false); note = (r && r.note) || ''; } catch (e) { note = 'FAILED: ' + e.message.split('\n')[0]; }
  const file = `${String(++n).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)}.png`;
  await page.screenshot({ path: fileURLToPath(new URL(file, OUT)) }).catch(() => {});
  results.push({ name, ok, note });
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(52)} ${note}`);
}

/** Hold one finger still at (x, y) for ms. */
async function longPress(sel, x, y, ms = 900) {
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
    await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await page.evaluate(async ([sel, x, y, ms]) => {
    const el = document.querySelector(sel), o = { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    await new Promise(r => setTimeout(r, ms));
    el.dispatchEvent(new PointerEvent('pointerup', o));
  }, [sel, x, y, ms]);
}
/** A tap: real touch over CDP where there is one (Playwright won't tap an attached phone's page), else Playwright's. */
async function tapAt(x, y) {
  if (!cdp) return page.touchscreen.tap(x, y);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 2, radiusX: 8, radiusY: 8, force: 1 }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(sel) {
  const r = await page.evaluate(sel => { const q = document.querySelector(sel)?.getBoundingClientRect(); return q && [q.left + q.width / 2, q.top + q.height / 2]; }, sel);
  if (!r) throw new Error('nothing to tap: ' + sel);
  return tapAt(r[0], r[1]);
}
const hintsShown = () => page.waitForSelector('#ooHints.in', { timeout: 60e3 }).then(() => true, () => false);
let vp = page.viewportSize();   // an attached phone's page reports Playwright's default here: its own size is read once a page is open

await page.goto(BASE + 'index.html');
await page.evaluate(() => { localStorage.removeItem('oo-hints'); });
if (ENGINE === 'android') vp = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));

await check('globe: the hint card shows on a first visit', async () => {
  await page.goto(BASE + 'globe.html');
  await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 120e3 });
  const shown = await hintsShown();
  const text = shown ? await page.textContent('#ooHints') : '';
  const focus = await page.evaluate(() => document.activeElement && document.activeElement.className);
  return { ok: shown && /Pinch/.test(text) && /Long-press/.test(text) && focus === 'oo-hints-ok', note: `${(text.match(/<li>|Drag|Pinch|Two fingers|Long-press|Double-tap/g) || []).length} lines, focus on ${focus}` };
});
await check('globe: Got it closes it, and it is remembered', async () => {
  await tap('.oo-hints-ok'); await sleep(600);
  const gone = await page.evaluate(() => !document.querySelector('#ooHints'));
  const stored = await page.evaluate(() => localStorage.getItem('oo-hints'));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#boot'), null, { timeout: 120e3 }); await sleep(4000);
  const again = await page.evaluate(() => !!document.querySelector('#ooHints'));
  return { ok: gone && /"globe":1/.test(stored) && !again, note: `stored ${stored}, after a reload: ${again ? 'shown again' : 'not shown'}` };
});
await check('globe: a long press opens "This spot"', async () => {
  await page.evaluate(() => OO3D.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(2.35, 48.85, 1.5e6) }));
  await sleep(1500);
  await longPress('#globe', vp.width / 2, vp.height / 2);
  await sleep(2500);
  const r = await page.evaluate(() => ({ k: document.querySelector('#card.show .k')?.textContent, h: document.querySelector('#card.show h2')?.textContent, where: document.querySelector('#spotWhere')?.textContent, said: document.querySelector('#ooAnnounce')?.textContent }));
  return { ok: r.k === 'This spot' && /° N/.test(r.h || ''), note: `${r.h} · ${r.where} · said "${r.said}"` };
});
await check('globe: Pin it puts a pin in the drawing', async () => {
  await tap('#spotPin'); await sleep(1200);
  const n = await page.evaluate(() => OO3D.Measure.shapes.filter(s => s.kind === 'pin').length);
  return { ok: n >= 1, note: `${n} pin(s)` };
});
await check('globe: a drag is not a long press', async () => {
  await page.evaluate(() => { document.querySelector('#card').classList.remove('show'); });
  if (cdp) {
    const x = vp.width / 2, y = vp.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 8, y, id: 1 }] }); await sleep(80); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else await page.evaluate(async () => { const el = document.querySelector('#globe'), o = (x) => ({ pointerId: 8, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 300, bubbles: true }); el.dispatchEvent(new PointerEvent('pointerdown', o(100))); for (let i = 1; i <= 10; i++) { el.dispatchEvent(new PointerEvent('pointermove', o(100 + i * 8))); await new Promise(r => setTimeout(r, 80)); } el.dispatchEvent(new PointerEvent('pointerup', o(180))); });
  await sleep(1500);
  const k = await page.evaluate(() => document.querySelector('#card.show .k')?.textContent || '');
  return { ok: k !== 'This spot', note: k ? `card: ${k}` : 'no card' };
});

await check('map: the hint card shows after the splash', async () => {
  await page.goto(BASE + 'open-overwatch.html');
  await page.waitForSelector('#enterSilent', { timeout: 60e3 }); await sleep(1500);
  await tap('#enterSilent').catch(() => page.click('#enterSilent'));
  const welcome = await page.waitForSelector('#welcome:not([hidden])', { timeout: 8000 }).catch(() => null);
  if (welcome) { await page.evaluate(() => OW.Welcome?.hide?.()); }
  const shown = await hintsShown();
  const text = shown ? await page.textContent('#ooHints') : '';
  return { ok: shown && /Long-press/.test(text), note: welcome ? 'after the welcome card' : 'no welcome card this time' };
});
await check('map: a tap outside the card closes it', async () => {
  await tapAt(vp.width / 2, 40); await sleep(600);
  const gone = await page.evaluate(() => !document.querySelector('#ooHints'));
  return { ok: gone, note: await page.evaluate(() => localStorage.getItem('oo-hints')) };
});
await check('map: a long press opens the spot popup, not the probe', async () => {
  await page.evaluate(() => { if (window.OW && OW.openSheet) OW.openSheet('none'); });
  await sleep(800);
  const box = await page.evaluate(() => { const r = document.querySelector('#map').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await longPress('#map', box[0], box[1]);
  await sleep(1500);
  const r = await page.evaluate(() => ({ spot: !!document.querySelector('.oo-spot'), probe: !!document.querySelector('.probe'), dd: document.querySelector('.oo-spot dd')?.textContent, link: document.querySelector('.oo-spot a')?.getAttribute('href') }));
  return { ok: r.spot && !r.probe && /globe\.html#c=/.test(r.link || ''), note: `${r.dd} → ${String(r.link).slice(0, 60)}` };
});

console.log(errors.length ? 'page errors:\n  ' + [...new Set(errors)].slice(0, 8).join('\n  ') : 'no page errors');
if (ENGINE !== 'android') await browser.close();   // the phone's Chrome stays open
const bad = results.filter(r => !r.ok).length;
console.log(`${results.length - bad}/${results.length} passed · screenshots in ${fileURLToPath(OUT)}`);
process.exit(bad ? 1 : 0);
