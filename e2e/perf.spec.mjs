// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Performance and smoothness of every page, on a desktop and on a Pixel-class phone with its CPU slowed 4×. Run by
// e2e/perf.config.mjs (on GitHub Actions: .github/workflows/perf.yml), skipped by the plain browser tests. Per page:
//   1. boot: first contentful and largest paint, the page's own ready signal, long tasks and blocking time until then,
//      and the requests and bytes it took;
//   2. a settle window after boot (late hitches: the globe's first satellite draw, background preloads);
//   3. scripted interactions, each its own window: frame times from requestAnimationFrame (p50/p95/p99, frames over
//      33 and 100 ms), long tasks (with the long-animation-frame script that ran, file and character position), layout
//      shift;
//   4. leaks: JS heap and DOM nodes after garbage collection, before and after 2 minutes idle and 2 minutes of a loop of
//      the same interactions;
//   5. a second, profiled pass (a fresh page, the V8 sampling profiler on) naming the hottest functions per window,
//      kept apart so the profiler's own cost never lands in the numbers above.
// Interactions never fail the test: a step that cannot run is recorded with its error, and the rest still run.
import { test } from './support/fixtures.mjs';
import { PROBE, pageNow, window_, stats, cdp, bigCatalogue } from './support/perfprobe.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test.skip(!process.env.OO_PERF, 'the performance run: npx playwright test -c e2e/perf.config.mjs');

const OUT = fileURLToPath(new URL('.results/perf/', import.meta.url));
const IDLE_S = +(process.env.OO_PERF_IDLE_S ?? 120), LOOP_S = +(process.env.OO_PERF_LOOP_S ?? 120);
const PROFILE = process.env.OO_PERF_PROFILE !== '0';
const ONLY = (process.env.OO_PERF_PAGES || '').split(',').map(s => s.trim()).filter(Boolean);
const CI = !!process.env.CI;

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** `p`, or an error once `ms` have passed (the work itself may still be running; the next window measures that too). */
function within(p, ms, what) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: still going after ${ms / 1000} s`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

// ---- the pages: where they start, their ready signal, the interactions and the leak loop ----
// ready: a function run in the page until it returns a truthy value. enter: what a visitor does before the page is in
// use (the 2D map's splash). steps: [name, fn(ctx), { settle, timeout }]. loop: one round of the leak loop.
const PAGES = {
  landing: {
    url: 'index.html',
    ready: () => document.readyState === 'complete' && /quake/.test(document.querySelector('#qk')?.textContent || ''),
    steps: [
      ['Scroll the landing page to the bottom and back', x => x.scrollPage(12000, true)],
      ['Fleet viewer: every model in turn', async x => { const n = await x.page.locator('#picker button').count(); for (let i = 0; i < n; i++) { await x.click(`#picker button >> nth=${i}`); await sleep(700); } }, { settle: 2000 }],
      ['Version picker: an older version and back', async x => { await x.page.locator('#verSel').selectOption('v0.9.1'); await sleep(600); await x.page.locator('#verSel').selectOption({ index: 0 }); }],
    ],
    loop: async x => { await x.scrollPage(5000, true); for (let i = 0; i < 3; i++) await x.click(`#picker button >> nth=${i}`); },
  },
  map: {
    url: 'open-overwatch.html',
    ready: () => !!document.querySelector('#enterSilent'),
    enter: async x => {
      await x.page.locator('#enterSilent').click();
      await x.page.waitForFunction(() => { const s = document.querySelector('#splash'); return window.OW && OW.Layers && OW.Layers.defs.length > 10 && (!s || s.classList.contains('out') || getComputedStyle(s).display === 'none'); }, null, { timeout: 120000, polling: 100 });
      if (await x.page.locator('#welcome').isVisible()) await x.click('#wSkip');
    },
    center: '#map',
    steps: [
      ['Preset: Storms & quakes', x => x.click('#views .view[data-preset="hazards"]'), { settle: 3000 }],
      ['Preset: Space (satellites, full catalogue)', x => x.click('#views .view[data-preset="space"]'), { settle: 5000 }],
      ['Preset: Military aircraft', x => x.click('#views .view[data-preset="mil"]'), { settle: 3000 }],
      ['Layer rail: open every group, then close them', async x => {
        const s = x.page.locator('#layers details.group > summary'), n = await s.count();
        if (x.phone) await x.click('#mobilebar [data-sheet="rail"]');
        for (let i = 0; i < n; i++) await s.nth(i).evaluate(e => e.click());
        await sleep(800);
        for (let i = 0; i < n; i++) await s.nth(i).evaluate(e => e.click());
        if (x.phone) await x.click('#mobilebar [data-sheet="none"]');
      }],
      ['Zoom in (6 steps)', x => x.zoom(+1, 6), { settle: 2500 }],
      ['Zoom out (6 steps)', x => x.zoom(-1, 6), { settle: 2500 }],
      ['Pan the map (3 drags)', x => x.pan(3), { settle: 2500 }],
      ['Open a quake from the map, then close it', async x => {
        await x.page.evaluate(() => { OW.Layers.set('quakes', true); OW.map.setView([40.6, 142.9], 6, { animate: false }); });
        await sleep(2000);
        const at = await x.page.evaluate(() => { const p = OW.map.latLngToContainerPoint([40.6, 142.9]), r = document.querySelector('#map').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; });
        await x.page.mouse.click(at.x, at.y);
        await sleep(1200);
        await x.page.keyboard.press('Escape');
      }],
      ['Intel tabs: brief, log, setup, detail', async x => { for (const t of ['brief', 'log', 'setup', 'detail']) { if (x.phone) await x.click('#mobilebar [data-sheet="panel"]'); await x.click(`#tab-${t}`); await sleep(500); } if (x.phone) await x.click('#mobilebar [data-sheet="none"]'); }],
    ],
    loop: async x => {
      for (const p of ['hazards', 'space', 'mil']) { await x.click(`#views .view[data-preset="${p}"]`); await sleep(800); }
      await x.zoom(+1, 3); await x.zoom(-1, 3);
      for (const t of ['brief', 'log', 'detail']) await x.click(`#tab-${t}`);
    },
  },
  globe: {
    url: 'globe.html',
    ready: () => !!(window.OO3D && OO3D.viewer && (!document.querySelector('#boot') || document.querySelector('#boot').classList.contains('out'))),
    readyTimeout: CI ? 300000 : 150000,
    steps: [
      ['Layers dock: open', x => x.click('#btnDock')],
      ['Layers: Starlink (~8,000 dots) toggled, then back', async x => { await x.click('#dock [data-ly="starlink"]'); await sleep(4000); await x.click('#dock [data-ly="starlink"]'); }, { settle: 3000 }],
      ['Layers: debris (~3,200 dots) toggled, then back', async x => { await x.click('#dock [data-ly="debris"]'); await sleep(3000); await x.click('#dock [data-ly="debris"]'); }, { settle: 3000 }],
      ['Layers: airports toggled, then back', async x => { await x.click('#dock [data-ly="airports"]'); await sleep(3000); await x.click('#dock [data-ly="airports"]'); }],
      ['Layers: lighthouses and volcanoes toggled, then back', async x => { for (const l of ['lighthouses', 'volcanoes']) await x.click(`#dock [data-ly="${l}"]`); await sleep(3000); for (const l of ['lighthouses', 'volcanoes']) await x.click(`#dock [data-ly="${l}"]`); }],
      ['Layers dock: close', x => x.click('#btnDock')],
      ['Search: the ISS, its card, close', async x => {
        await x.click('#band [data-go="search"]');
        await x.page.locator('#srQ').fill('iss');
        await x.page.locator('#srRes .sr').first().click({ timeout: 20000 });
        await x.page.locator('#card').filter({ hasText: '25544' }).waitFor({ timeout: 20000 });
        await sleep(1500);
        await x.click('#card .x');
      }],
      ['Launches card: open, close', async x => { await x.click('#band [data-go="launches"]'); await x.page.locator('#card .cj').first().waitFor({ timeout: 20000 }); await sleep(1500); await x.click('#card .x'); }],
      ['Eclipses card: open, close', async x => { await x.click('#band [data-go="eclipses"]'); await x.page.locator('#card .cj').first().waitFor({ timeout: 20000 }); await sleep(1500); await x.click('#card .x'); }],
      ['Earth now: open, close', async x => { await x.click('#band [data-go="now"]'); await sleep(3000); await x.page.keyboard.press('Escape'); }],
      ['Zoom in (10 steps)', x => x.zoom(+1, 10), { settle: 3000 }],
      ['Zoom out (10 steps)', x => x.zoom(-1, 10), { settle: 3000 }],
      ['Pan the globe (3 drags)', x => x.pan(3), { settle: 3000 }],
      ['Fly to a London street (3 s flight)', async x => { await x.page.evaluate(() => OO3D.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(-0.1276, 51.5072, 900), orientation: { heading: 0, pitch: -0.45, roll: 0 }, duration: 3 })); await sleep(3500); }, { settle: 4000 }],
      ['Fly back out to 20,000 km', async x => { await x.page.evaluate(() => OO3D.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(10, 30, 2.0e7), duration: 3 })); await sleep(3500); }, { settle: 3000 }],
      ['Hand-off: zoom out past the Moon into the Solar System', async x => {
        await x.page.evaluate(() => OO3D.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(20, 10, 4.0e8) }));
        await x.page.waitForFunction(() => OO3D.space && OO3D.space.active, null, { timeout: CI ? 280000 : 150000, polling: 500 });
      }, { settle: 4000, timeout: 300000 }],
      ['Hand-back: the Solar System flies home to the globe', async x => {
        const solar = 'iframe[src="solar.html?embed=1"]';
        await x.page.waitForFunction(s => document.querySelector(s)?.contentWindow?.OOSS?.controls?.enabled, solar, { timeout: 60000, polling: 500 });
        await x.page.evaluate(s => document.querySelector(s).contentWindow.OOSS.embed.goToEarth(), solar);
        await x.page.waitForFunction(() => !OO3D.space.active, null, { timeout: 150000, polling: 500 });
      }, { settle: 4000, timeout: 200000 }],
    ],
    loop: async x => {
      await x.click('#btnDock'); await sleep(500); await x.click('#btnDock');
      await x.click('#band [data-go="launches"]'); await sleep(1500); await x.click('#card .x');
      await x.zoom(+1, 4); await x.zoom(-1, 4);
    },
  },
  solar: {
    url: 'solar.html',
    ready: () => !!(window.OOSS && document.querySelector('#load')?.classList.contains('gone')),
    readyTimeout: CI ? 240000 : 120000,
    steps: [
      ['Search: Mars, Enter, fly there', async x => {
        await x.page.locator('#q').fill('mars');
        await x.page.locator('#hits button').first().waitFor({ timeout: 15000 });
        await x.page.locator('#q').press('Enter');
        await x.page.waitForFunction(() => OOSS.nav.focus?.key === 'mars', null, { timeout: 30000 });
      }, { settle: 5000 }],
      ['Layers menu: open, close', async x => { await x.click('#menuBtn'); await sleep(800); await x.click('#menuBtn'); }],
      ['Deep-space missions list: open, close', async x => { await x.click('#menuBtn'); await x.click('#bMissions'); await sleep(2000); await x.click('#listX'); }],
      ['Comets list: open, close', async x => { await x.click('#menuBtn'); await x.click('#bComets'); await sleep(2000); await x.click('#listX'); }],
      ['Zoom out to the Oort cloud', x => x.zoom(-1, 30), { settle: 4000 }],
      ['Zoom back in', x => x.zoom(+1, 30), { settle: 4000 }],
      ['Orbit the view (3 drags)', x => x.pan(3), { settle: 2500 }],
      ['Time: a year per second for 4 s, then real time', async x => { await x.click('[data-rate="6"]'); await sleep(4000); await x.click('[data-rate="1"]'); }],
      ['Search: back to Earth', async x => { await x.page.locator('#q').fill('earth'); await x.page.locator('#hits button').first().waitFor({ timeout: 15000 }); await x.page.locator('#q').press('Enter'); await x.page.waitForFunction(() => OOSS.nav.focus?.key === 'earth', null, { timeout: 30000 }); }, { settle: 4000 }],
    ],
    loop: async x => {
      await x.click('#menuBtn'); await sleep(400); await x.click('#menuBtn');
      await x.zoom(-1, 8); await x.zoom(+1, 8);
      for (const k of ['mars', 'earth']) { await x.page.locator('#q').fill(k); await sleep(300); await x.page.locator('#q').press('Enter'); await sleep(2500); }
    },
  },
  tonight: {
    url: 'tonight.html',
    ready: () => document.readyState === 'complete' && !!(document.querySelector('#tnGreen') || document.querySelector('#tnLoc')),
    steps: [
      ['Try Greenwich: the whole sky card', async x => { await x.click('#tnGreen'); await x.page.waitForFunction(() => document.querySelectorAll('#card .tn-row').length > 4, null, { timeout: 60000, polling: 100 }); }, { settle: 3000 }],
      ['Scroll the card to the bottom and back', x => x.scrollPage(8000, true)],
    ],
    loop: async x => { await x.scrollPage(4000, true); },
  },
  guide: {
    url: 'guide.html',
    ready: () => document.readyState === 'complete' && document.querySelectorAll('.toc a').length >= 10,
    steps: [
      ['Scroll the guide to the bottom and back', x => x.scrollPage(40000, true)],
      ['On-this-page links: four jumps', async x => { for (const i of [2, 6, 10, 14]) { await x.click(`.toc a >> nth=${i}`); await sleep(700); } }],
    ],
    loop: async x => { await x.scrollPage(15000, true); },
  },
  india: {
    url: 'india/',
    ready: () => document.readyState === 'complete' && /IST/.test(document.querySelector('#ist')?.textContent || ''),
    steps: [
      ['हिन्दी toggle and back', async x => { await x.click('#langBtn'); await sleep(1500); await x.click('#langBtn'); }],
      ['Clip tabs: each recording', async x => { const n = await x.page.locator('[role="tab"][data-clip]').count(); for (let i = 0; i < n; i++) { await x.click(`[role="tab"][data-clip] >> nth=${i}`); await sleep(800); } }],
      ['Scroll the page to the bottom and back', x => x.scrollPage(12000, true)],
    ],
    loop: async x => { await x.click('#langBtn'); await sleep(500); await x.click('#langBtn'); await x.scrollPage(5000, true); },
  },
};

/** The probe, the full-size satellite catalogue and the CPU throttle on a page; returns its CDP helpers. */
async function prepare(page, phone) {
  await page.addInitScript(PROBE);
  await bigCatalogue(page);
  const c = await cdp(page);
  if (phone) await c.throttle(4);
  return c;
}

/** What the steps get: the page and its gestures (touch on the phone, mouse and wheel on the desktop). */
function actions(page, c, phone, def) {
  const vp = page.viewportSize();
  const center = async () => {
    if (def.center) { const b = await page.locator(def.center).boundingBox().catch(() => null); if (b) return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; }
    return { x: vp.width / 2, y: vp.height / 2, w: vp.width, h: vp.height };
  };
  return {
    page, phone, c,
    /** A visible element is clicked like a visitor would; one hidden behind a menu or sheet is clicked in the DOM. */
    async click(sel) {
      const l = page.locator(sel).first();
      if (await l.isVisible().catch(() => false)) await l.click({ timeout: 10000 });
      else await l.evaluate(e => e.click(), null, { timeout: 5000 });
    },
    /** Scroll the page down by `px` (and back up): a finger on the phone, the wheel on the desktop. */
    async scrollPage(px, back = false) {
      const at = { x: vp.width / 2, y: vp.height / 2 }, src = phone ? 'touch' : 'mouse';
      for (let left = px; left > 0; left -= 2000) await c.scroll(at.x, at.y, 0, -Math.min(2000, left), src, phone ? 1500 : 2400);
      if (back) for (let left = px; left > 0; left -= 2000) await c.scroll(at.x, at.y, 0, Math.min(2000, left), src, phone ? 1500 : 2400);
    },
    /** Zoom in (+1) or out (-1): wheel notches on the desktop, pinches on the phone. */
    async zoom(dir, n) {
      const m = await center();
      if (phone) { for (let i = 0; i < Math.ceil(n / 2); i++) { await c.pinch(m.x, m.y, dir > 0 ? 1.8 : 0.55); await sleep(150); } return; }
      await page.mouse.move(m.x, m.y);
      for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dir > 0 ? -240 : 240); await sleep(120); }
    },
    /** n drags across the middle of the view. */
    async pan(n) {
      const m = await center(), d = Math.min(m.w, m.h) * 0.3;
      const moves = [[d, 0], [-d, d * 0.6], [0, -d * 0.6], [-d, 0]];
      for (let i = 0; i < n; i++) {
        const [dx, dy] = moves[i % moves.length];
        if (phone) await c.scroll(m.x - dx / 2, m.y - dy / 2, dx, dy, 'touch', 900);
        else { await page.mouse.move(m.x - dx / 2, m.y - dy / 2); await page.mouse.down(); await page.mouse.move(m.x + dx / 2, m.y + dy / 2, { steps: 24 }); await page.mouse.up(); }
        await sleep(300);
      }
    },
  };
}

/** Boot a page and time it: paints, the ready signal, and the requests and bytes up to then. */
async function boot(page, def, x) {
  const reqs = [], sizes = [];
  let failed = 0;
  page.on('request', () => reqs.push(1));
  page.on('requestfailed', () => failed++);
  page.on('requestfinished', r => sizes.push(r.sizes().then(s => ({ url: r.url(), type: r.resourceType(), bytes: s.responseBodySize + s.responseHeadersSize })).catch(() => ({ url: r.url(), type: r.resourceType(), bytes: 0 }))));
  await page.goto(def.url, { waitUntil: 'commit' });
  const origin = await page.evaluate(() => performance.timeOrigin);
  const h = await page.waitForFunction(`(${def.ready})() && performance.now()`, null, { timeout: def.readyTimeout || (CI ? 120000 : 60000), polling: 100 });
  const firstReadyMs = Math.round(await h.jsonValue());
  if (def.enter) await within(def.enter(x), 150000, 'enter');
  const readyMs = def.enter ? Math.round(await pageNow(page) - origin) : firstReadyMs;
  const nReq = reqs.length, nFailed = failed;
  const done = await Promise.all(sizes.slice());
  const paint = await page.evaluate(() => ({ fcp: window.__oop?.paint['first-contentful-paint'] || 0, lcp: window.__oop?.lcp || 0 }));
  const byType = {};
  for (const s of done) { const t = (byType[s.type] ||= { n: 0, kB: 0 }); t.n++; t.kB += s.bytes / 1024; }
  for (const t of Object.values(byType)) t.kB = Math.round(t.kB);
  return {
    origin, firstReadyMs, readyMs, fcpMs: Math.round(paint.fcp), lcpMs: Math.round(paint.lcp),
    requests: nReq, failedRequests: nFailed, MB: Math.round(done.reduce((s, d) => s + d.bytes, 0) / 1048576 * 100) / 100, byType,
    biggest: done.sort((a, b) => b.bytes - a.bytes).slice(0, 8).map(d => ({ url: d.url.replace(/^https?:\/\/localhost:\d+\//, '/'), kB: Math.round(d.bytes / 1024) })),
  };
}

/** Run one window: mark, do it, let the aftermath land, mark. */
async function measure(page, name, fn, { settle = 1500, timeout = 90000 } = {}) {
  const t0 = await pageNow(page), w0 = Date.now();
  let error = null;
  try { await within(Promise.resolve().then(fn), timeout, name); } catch (e) { error = String(e.message || e).split('\n')[0].slice(0, 240); }
  await sleep(settle);
  return { name, t0, t1: await pageNow(page), wallMs: Date.now() - w0, error };
}

for (const [key, def] of Object.entries(PAGES)) {
  if (ONLY.length && !ONLY.includes(key)) continue;
  test(`perf: ${key}`, async ({ page, context, errors }, testInfo) => {
    errors.allow(/./);   // measured, not judged: the browser tests (e2e/*.spec.mjs) own correctness
    const profile = testInfo.project.name.replace(/^perf-/, ''), phone = profile === 'phone';
    mkdirSync(OUT, { recursive: true });
    const file = `${OUT}${key}-${profile}.json`;
    const report = { page: key, profile, url: def.url, at: new Date().toISOString(), commit: process.env.GITHUB_SHA || '', cpuSlowdown: phone ? 4 : 1, env: {}, boot: null, phases: [], leak: {}, cpuProfile: null, pageErrors: [] };
    const save = () => { report.pageErrors = errors.list.slice(0, 20); writeFileSync(file, JSON.stringify(report, null, 1)); };

    const c = await prepare(page, phone);
    const x = actions(page, c, phone, def);
    try {
      // 1. boot
      report.boot = await boot(page, def, x);
      const origin = report.boot.origin;
      report.boot.window = stats(await window_(page, origin, origin + report.boot.readyMs));
      report.env = await page.evaluate(() => {
        let gl = ''; try { const g = document.createElement('canvas').getContext('webgl'); const d = g.getExtension('WEBGL_debug_renderer_info'); gl = d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } catch (e) { gl = 'none'; }
        return { ua: navigator.userAgent, gl, dpr: devicePixelRatio, viewport: `${innerWidth}x${innerHeight}`, cores: navigator.hardwareConcurrency };
      });
      save();
      // 2. the settle window after boot, then 3. the interactions
      const windows = [await measure(page, 'Settle after boot (12 s, no input)', () => sleep(12000), { settle: 0 })];
      for (const [name, fn, o] of def.steps) windows.push(await measure(page, name, () => fn(x), o));
      for (const w of windows) report.phases.push({ name: w.name, wallMs: w.wallMs, error: w.error, ...stats(await window_(page, w.t0, w.t1)) });
      save();

      // 4. leaks: idle, then the loop
      const m0 = await c.memory();
      await sleep(IDLE_S * 1000);
      const m1 = await c.memory();
      const l0 = await pageNow(page), end = Date.now() + LOOP_S * 1000;
      let rounds = 0, loopErr = null;
      while (Date.now() < end) { try { await within(def.loop(x), 60000, 'loop'); } catch (e) { loopErr ||= String(e.message || e).split('\n')[0].slice(0, 200); await sleep(1000); } rounds++; }
      const loopWin = stats(await window_(page, l0, await pageNow(page)));
      const m2 = await c.memory();
      const grow = (a, b) => ({ heapMB: Math.round((b.heapMB - a.heapMB) * 10) / 10, nodes: b.nodes - a.nodes, listeners: b.listeners - a.listeners, documents: b.documents - a.documents });
      report.leak = { idleS: IDLE_S, loopS: LOOP_S, start: m0, afterIdle: m1, afterLoop: m2, idle: grow(m0, m1), loop: { ...grow(m1, m2), rounds, error: loopErr }, loopFrames: loopWin.frames, loopLongTasks: { n: loopWin.longTasks.n, tbtMs: loopWin.longTasks.tbtMs, maxMs: loopWin.longTasks.maxMs } };
      save();
    } finally {
      save();
    }

    // 5. the profiled pass, on a fresh page
    if (!PROFILE) return;
    await page.close();
    const p2 = await context.newPage();
    const c2 = await prepare(p2, phone), x2 = actions(p2, c2, phone, def);
    const prof = { boot: null, phases: {} };
    try {
      let stop = await c2.profile();
      await boot(p2, def, x2);
      prof.boot = await stop();
      await sleep(1500);
      stop = await c2.profile(); await sleep(12000); prof.phases['Settle after boot (12 s, no input)'] = await stop();
      for (const [name, fn, o] of def.steps) {
        stop = await c2.profile();
        try { await within(Promise.resolve().then(() => fn(x2)), (o && o.timeout) || 90000, name); } catch (e) { /* the measured pass recorded it */ }
        await sleep((o && o.settle) ?? 1500);
        prof.phases[name] = await stop();
      }
    } catch (e) {
      prof.error = String(e.message || e).split('\n')[0].slice(0, 240);
    } finally {
      report.cpuProfile = prof;
      save();
    }
  });
}
