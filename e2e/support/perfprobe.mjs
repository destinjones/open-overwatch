// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// What the performance run (e2e/perf.spec.mjs) puts into every page and reads back out:
//   - an in-page probe (PROBE, an init script): long tasks, long animation frames with their script attribution, layout
//     shifts, paints and a requestAnimationFrame clock, all stamped in epoch milliseconds (performance.timeOrigin + t) so
//     the top page and the embedded Solar System iframe share one time line;
//   - stats over a time window of that record (window_());
//   - the Chrome DevTools Protocol bits Playwright has no API for: CPU throttling, garbage collection and heap/DOM
//     counters, the sampling CPU profiler, and real touch/mouse gestures (scroll, pinch);
//   - a full-size satellite catalogue: the suite's TLE fixture is 4 space stations for every group, which would make the
//     ~15,000-dot Starlink/active/debris layers cost nothing, so those groups get synthetic but valid element sets.

/** The in-page probe. Runs in every frame before the page's own scripts; only the top frame keeps the frame clock. */
export function PROBE() {
  if (window.__oop) return;
  const T0 = performance.timeOrigin, top = window === window.top;
  const P = window.__oop = { lt: [], loaf: [], cls: [], paint: {}, lcp: 0, frames: top ? new Float64Array(1 << 18) : null, nf: 0 };
  const describe = n => { try { if (!n || !n.tagName) return n && n.nodeName || ''; return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.classList && n.classList.length ? '.' + [...n.classList].slice(0, 2).join('.') : ''); } catch (e) { return ''; } };
  const obs = (type, fn) => { try { new PerformanceObserver(l => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch (e) { /* not in this browser */ } };
  obs('longtask', e => P.lt.push({ t: T0 + e.startTime, d: e.duration, a: (e.attribution || []).map(a => `${a.containerType || ''}${a.containerSrc ? ' ' + a.containerSrc : ''}`).join(',') }));
  obs('long-animation-frame', e => P.loaf.push({
    t: T0 + e.startTime, d: e.duration, block: e.blockingDuration || 0,
    render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
    layout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
    scripts: (e.scripts || []).map(s => ({ d: s.duration, inv: s.invoker, type: s.invokerType, url: s.sourceURL, fn: s.sourceFunctionName, pos: s.sourceCharPosition, forced: s.forcedStyleAndLayoutDuration })).sort((a, b) => b.d - a.d).slice(0, 4),
  }));
  obs('layout-shift', e => { if (!e.hadRecentInput) P.cls.push({ t: T0 + e.startTime, v: e.value, src: (e.sources || []).slice(0, 3).map(s => describe(s.node)) }); });
  obs('paint', e => { P.paint[e.name] = e.startTime; });
  obs('largest-contentful-paint', e => { P.lcp = e.startTime; });
  if (top) { const tick = now => { if (P.nf < P.frames.length) P.frames[P.nf++] = T0 + now; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
}

/** Epoch milliseconds on the page's clock (the same clock as the probe's stamps). */
export const pageNow = page => page.evaluate(() => performance.timeOrigin + performance.now());

/** Everything the probe saw in [t0, t1), over the top page and every same-origin frame (deduplicated). */
export async function window_(page, t0, t1) {
  const pick = ([a, b]) => {
    const P = window.__oop; if (!P) return null;
    const inW = x => x.t >= a && x.t < b;
    const frames = [];
    if (P.frames) for (let i = 1; i < P.nf; i++) if (P.frames[i] >= a && P.frames[i] < b) frames.push(P.frames[i] - P.frames[i - 1]);
    return { lt: P.lt.filter(inW), loaf: P.loaf.filter(inW), cls: P.cls.filter(inW), frames };
  };
  const all = { lt: [], loaf: [], cls: [], frames: [] }, seen = new Set();
  for (const f of page.frames()) {
    let r; try { r = await f.evaluate(pick, [t0, t1]); } catch (e) { continue; }
    if (!r) continue;
    if (r.frames.length) all.frames = r.frames;   // only the top frame keeps a frame clock
    for (const k of ['lt', 'loaf', 'cls']) for (const x of r[k]) {
      const key = `${k}:${Math.round(x.t)}:${Math.round(x.d ?? x.v * 1e6)}`;
      if (!seen.has(key)) { seen.add(key); all[k].push(x); }
    }
  }
  return all;
}

const q = (s, p) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
const r1 = x => Math.round(x * 10) / 10;

/** The numbers of one window: frame percentiles, long tasks and blocking time, layout shift, the worst frames' scripts. */
export function stats(w) {
  const f = [...w.frames].sort((a, b) => a - b);
  const lt = [...w.lt].sort((a, b) => b.d - a.d);
  const loaf = [...w.loaf].sort((a, b) => b.d - a.d);
  return {
    frames: { n: f.length, p50: r1(q(f, 0.5)), p95: r1(q(f, 0.95)), p99: r1(q(f, 0.99)), max: r1(f[f.length - 1] || 0), over33: f.filter(x => x > 33.4).length, over100: f.filter(x => x > 100).length },
    longTasks: { n: lt.length, totalMs: Math.round(lt.reduce((s, x) => s + x.d, 0)), tbtMs: Math.round(lt.reduce((s, x) => s + Math.max(0, x.d - 50), 0)), maxMs: Math.round(lt[0]?.d || 0), top: lt.slice(0, 5).map(x => ({ ms: Math.round(x.d), at: x.t, attribution: x.a })) },
    loaf: { n: loaf.length, blockingMs: Math.round(loaf.reduce((s, x) => s + x.block, 0)), top: loaf.slice(0, 5).map(x => ({ ms: Math.round(x.d), blockMs: Math.round(x.block), renderMs: Math.round(x.render), layoutMs: Math.round(x.layout), at: x.t, scripts: x.scripts })) },
    cls: { total: Math.round(w.cls.reduce((s, x) => s + x.v, 0) * 1e4) / 1e4, top: [...w.cls].sort((a, b) => b.v - a.v).slice(0, 3).map(x => ({ v: Math.round(x.v * 1e4) / 1e4, src: x.src })) },
  };
}

/** CDP helpers for one page. */
export async function cdp(page) {
  const s = await page.context().newCDPSession(page);
  await s.send('Performance.enable').catch(() => {});
  return {
    session: s,
    throttle: rate => s.send('Emulation.setCPUThrottlingRate', { rate }),
    /** Collect garbage (twice: finalizers free more), then the heap and DOM counters. */
    async memory() {
      await s.send('HeapProfiler.collectGarbage').catch(() => {});
      await s.send('HeapProfiler.collectGarbage').catch(() => {});
      const heap = await s.send('Runtime.getHeapUsage').catch(() => ({ usedSize: 0 }));
      const m = Object.fromEntries((await s.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
      return { heapMB: Math.round(heap.usedSize / 1048576 * 10) / 10, nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents, frames: m.Frames, layoutCount: m.LayoutCount, recalcStyleCount: m.RecalcStyleCount };
    },
    /** Sampling CPU profiler: start, then stop() returns the hottest functions by self time. */
    async profile() {
      await s.send('Profiler.enable');
      await s.send('Profiler.setSamplingInterval', { interval: 500 });
      await s.send('Profiler.start');
      return async () => hottest((await s.send('Profiler.stop')).profile);
    },
    /** A real gesture: a touch drag on phones (source 'touch'), a wheel-ish mouse scroll on desktops. */
    scroll: (x, y, dx, dy, source = 'mouse', speed = 1200) => s.send('Input.synthesizeScrollGesture', { x, y, xDistance: dx, yDistance: dy, gestureSourceType: source, speed, preventFling: true }),
    /** Two-finger pinch: scale > 1 zooms in. */
    pinch: (x, y, scale) => s.send('Input.synthesizePinchGesture', { x, y, scaleFactor: scale, relativeSpeed: 600, gestureSourceType: 'touch' }),
  };
}

/** Self time per function in a V8 CPU profile, the 15 hottest, with the share of the sampled time. */
export function hottest(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = new Map();
  for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
  const agg = new Map(); let total = 0, idle = 0;
  for (const [id, us] of dt) {
    const cf = byId.get(id).callFrame;
    if (cf.functionName === '(idle)') { idle += us; continue; }
    total += us;
    const key = `${cf.functionName || '(anonymous)'}|${cf.url}|${cf.lineNumber}|${cf.columnNumber}`;
    agg.set(key, (agg.get(key) || 0) + us);
  }
  const top = [...agg].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, us]) => {
    const [fn, url, line, col] = k.split('|');
    return { fn, url, line: +line + 1, col: +col + 1, ms: Math.round(us / 100) / 10, pct: total ? Math.round(us / total * 1000) / 10 : 0 };
  });
  return { busyMs: Math.round(total / 1000), idleMs: Math.round(idle / 1000), top };
}

// ---- a full-size satellite catalogue (synthetic, valid TLEs with today's epoch) ----
const L1 = '1 25544U 98067A   26274.49758378  .00003723  00000+0  76468-4 0  9991';
const L2 = '2 25544  51.6318 133.9648 0006934 209.9872 150.0720 15.48703850588231';
const sum = s => { let c = 0; for (const ch of s.slice(0, 68)) c += ch === '-' ? 1 : /\d/.test(ch) ? +ch : 0; return s.slice(0, 68) + (c % 10); };
const put = (s, at, v) => s.slice(0, at) + v + s.slice(at + v.length);
const f = (x, w, d) => x.toFixed(d).padStart(w, ' ');
function epoch(now) {
  const d = new Date(now), y = d.getUTCFullYear(), start = Date.UTC(y, 0, 1);
  return String(y % 100).padStart(2, '0') + ((now - start) / 86400e3 + 1).toFixed(8).padStart(12, '0');
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** `n` element sets like a constellation or debris cloud: inclination, mean motion and their spread. */
export function syntheticTle({ name, n, first, incl, inclSpread = 0, mm, mmSpread = 0, ecc = 0.0002, seed = 1, now = Date.now() }) {
  const r = rng(seed), ep = epoch(now), out = [];
  for (let i = 0; i < n; i++) {
    const num = String(first + i).padStart(5, '0');
    let a = put(put(put(L1, 2, num), 9, `24${String(1 + (i % 999)).padStart(3, '0')}A  `), 18, ep);
    let b = put(L2, 2, num);
    b = put(b, 8, f(incl + (r() - 0.5) * 2 * inclSpread, 8, 4));
    b = put(b, 17, f(r() * 360, 8, 4));
    b = put(b, 26, String(Math.round(ecc * (0.5 + r()) * 1e7)).padStart(7, '0'));
    b = put(b, 34, f(r() * 360, 8, 4));
    b = put(b, 43, f(r() * 360, 8, 4));
    b = put(b, 52, f(mm + (r() - 0.5) * 2 * mmSpread, 11, 8));
    out.push(`${name}-${i + 1}`.padEnd(24, ' '), sum(a), sum(b));
  }
  return out.join('\n') + '\n';
}

/** The groups that are big in real life: ~8,000 Starlink, ~4,500 other active, ~3,000 debris. */
export const BIG_GROUPS = {
  starlink: o => syntheticTle({ name: 'STARLINK', n: 8000, first: 60000, incl: 53, inclSpread: 0.2, mm: 15.06, mmSpread: 0.05, seed: 11, ...o }),
  active: o => syntheticTle({ name: 'ACTIVE', n: 4500, first: 70000, incl: 75, inclSpread: 25, mm: 14.6, mmSpread: 0.9, ecc: 0.001, seed: 12, ...o }),
  'fengyun-1c-debris': o => syntheticTle({ name: 'FENGYUN 1C DEB', n: 1500, first: 80000, incl: 98.8, inclSpread: 0.6, mm: 14.4, mmSpread: 0.4, ecc: 0.006, seed: 13, ...o }),
  'iridium-33-debris': o => syntheticTle({ name: 'IRIDIUM 33 DEB', n: 600, first: 84000, incl: 86.4, inclSpread: 0.3, mm: 14.5, mmSpread: 0.3, ecc: 0.004, seed: 14, ...o }),
  'cosmos-2251-debris': o => syntheticTle({ name: 'COSMOS 2251 DEB', n: 1100, first: 88000, incl: 74.0, inclSpread: 0.3, mm: 14.6, mmSpread: 0.3, ecc: 0.004, seed: 15, ...o }),
};

/** Serve the big groups to a page (page routes come before the suite's context routes in net.mjs). */
export async function bigCatalogue(page) {
  const cache = {};
  await page.route(u => /\/data\/tle\/(starlink|active|[\w-]+-debris)\.txt$/.test(u.pathname), route => {
    const g = new URL(route.request().url()).pathname.match(/\/data\/tle\/([\w-]+)\.txt$/)[1];
    if (!BIG_GROUPS[g]) return route.fallback();
    cache[g] ||= BIG_GROUPS[g]();
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body: cache[g] });
  });
}
