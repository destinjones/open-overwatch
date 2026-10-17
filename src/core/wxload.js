// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Weather models at any moment, for every view: the globe's weather mode (src/globe/model.js, wind.js) and the 2D map's
// model layers (src/map/weather.js) read the same files the same way, and share the browser's cache of them. Each model
// (core/wxmodels.js: NOAA GFS with WAVEWATCH III, ECMWF IFS with its wave model) finds its newest run that reaches the
// last hour shown, then fetches one field and one forecast hour at a time by byte range (no key, no relay); a moment
// between two forecast hours blends the two either side of it. Fetching and decoding go through `ask`, which in the
// browser is model.worker.js (workerAsk below); the tests hand in a fake. Sampling a moment (a value, the wind, a
// reading with the pressure trend) is plain arithmetic on the decoded grids. DOM-free (test/wxload.test.mjs).
import { MODELS, bracketFor, partsOf } from './wxmodels.js';
import { idxRanges, sampleGrid } from './grib2.js';
import { sampleAt, sampleValid, sampleAngle } from './fields.js';

const pause = ms => new Promise(res => setTimeout(res, ms));

/** The browser's way in: a message to model.worker.js, answered by id. One worker per page, started on first use. */
export function workerAsk(url = new URL('./model.worker.js', import.meta.url)) {
  let worker = null, seq = 0;
  const waiting = new Map();
  return msg => {
    if (!worker) {
      worker = new Worker(url, { type: 'module' });
      worker.onmessage = e => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); if (e.data.error) w.rej(new Error(e.data.error)); else w.res(e.data); };
      worker.onerror = e => { for (const w of waiting.values()) w.rej(new Error(e.message || 'model worker failed')); waiting.clear(); worker = null; };
    }
    return new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); worker.postMessage({ ...msg, id }); });
  };
}

/** Does run c reach hour maxH? (Each run takes hours to come out; its last file is the last to appear.) S3 sheds load
 *  with "503 Slow Down", sent without CORS headers (to a page, a failed fetch): those are tried again. */
export async function runComplete(def, c, maxH, { fetch = globalThis.fetch, sleep = pause, tries = 8 } = {}) {
  const url = def.indexOf(def.file(c, Math.min(maxH, def.maxH)));
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' } }).catch(() => null);
    if (r && (r.status === 206 || r.status === 200)) { r.body?.cancel?.(); return true; }
    if (r && r.status !== 503) return false;   // 404 or 403: this run isn't (all) out yet
    await sleep(Math.min(4000, 400 * 2 ** i) + Math.random() * 600);
  }
  return false;
}

/**
 * One model, ready to be asked for moments. opts: { maxH (last hour shown), keep (forecast hours kept decoded), res (the
 * finest grid kept, degrees), ask (the worker's message function), fetch, sleep, now () → ms, cachePrefix }. The cache
 * name is shared by every view of the site, so a field the globe fetched costs the map nothing.
 * @param {any} def
 * @param {{ maxH?: number, keep?: number, res?: number, ask?: (msg: any) => Promise<any>, fetch?: typeof globalThis.fetch, sleep?: (ms: number) => Promise<any>, now?: () => number, cachePrefix?: string }} [opts]
 */
export function makeModel(def, { maxH = 120, keep = 16, res = 0.5, ask, fetch = globalThis.fetch, sleep = pause, now = () => Date.now(), cachePrefix = 'oo3d-' } = {}) {
  const cache = cachePrefix + def.id, probe = c => runComplete(def, c, maxH, { fetch, sleep });
  return {
    def, id: def.id, name: def.name, run: null, finding: null, steps: new Map(), maxH,   // forecast hour → { used, rows: { stream: promise }, kinds: { kind: promise } }
    /** The newest run whose files reach maxH. */
    ready() {
      if (this.run) return Promise.resolve(this.run);
      return this.finding ||= (async () => {
        for (const c of def.cycles(now(), 4)) if (await probe(c)) { this.run = c; ask({ keep: def.cachePath(c), cache }).catch(() => {}); return c; }
        throw new Error(`no recent ${def.short} run reachable`);
      })().finally(() => { this.finding = null; });
    },
    /** A newer run is out (GFS every 6 h, ECMWF every 12): start over with it (the caller redraws). */
    async refresh() {
      const c = def.cycles(now(), 1)[0];
      if (!this.run || c.t <= this.run.t || !(await probe(c))) return false;
      this.run = c; this.steps.clear(); ask({ keep: def.cachePath(c), cache }).catch(() => {});
      return true;
    },
    step(h) {
      let s = this.steps.get(h);
      if (!s) {   // the newest is stamped first: unstamped, it sorted as the oldest and the cache kept one hour too many
        s = { used: performance.now(), rows: {}, kinds: {} }; this.steps.set(h, s);
        if (this.steps.size > keep) for (const [k] of [...this.steps.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.steps.size - keep)) if (k !== h) this.steps.delete(k);
      }
      s.used = performance.now(); return s;
    },
    /** One kind of field for forecast hour h: 'wind' → { u, v }, 'wave' → { wave, wavedir }; others → the field
     *  ('temp' K, 'cloud' %, 'rain' kg/m²/s, 'pres' Pa, 'gust' m/s). */
    async field(h, kind) {
      const run = await this.ready(), s = this.step(h), spec = def.kinds[kind];
      if (!spec) throw new Error(`${def.short} has no ${kind}`);
      s.kinds[kind] ||= (async () => {
        const url = def.file(run, h, spec.stream);
        const rows = await (s.rows[spec.stream] ||= ask({ idx: def.indexOf(url), format: def.index, cache }).then(d => d.rows).catch(e => { delete s.rows[spec.stream]; throw e; }));
        const ranges = idxRanges(rows, spec.wants);
        if (!ranges.length) throw new Error(`no ${kind} in this forecast hour`);
        const by = Object.fromEntries((await ask({ url, ranges, res, cache })).fields.map(f => [f.key, f]));
        const parts = partsOf(kind);
        if (!parts.every(p => by[p])) throw new Error(`no ${kind} in this forecast hour`);
        return parts.length > 1 ? Object.fromEntries(parts.map(p => [p, by[p]])) : by[kind];
      })().catch(e => { delete s.kinds[kind]; throw e; });
      return s.kinds[kind];
    },
    /** The fields of `kinds` either side of moment t (ms): { a, b, w, h0, h1, run, model }, a and b being { wind, temp, … }.
     *  A kind missing from one of the two hours (ECMWF has no gusts or rain rate at hour 0) takes the other's; a kind
     *  missing from both is left out; nothing at all is an error. */
    async at(t, kinds) {
      const run = await this.ready(), { h0, h1, w } = bracketFor(def, run, t, maxH), both = w > 0.001;
      const got = await Promise.all(kinds.map(async k => {
        const [x, y] = await Promise.all([this.field(h0, k).catch(() => null), both || k === 'pres' ? this.field(h1, k).catch(() => null) : null]);   // pressure: the next hour too, for its trend
        return [k, x || y, y || x];
      }));
      const a = {}, b = {};
      for (const [k, x, y] of got) if (x) { a[k] = x; b[k] = y; }
      if (!Object.keys(a).length) throw new Error(`${def.short}: nothing reachable for this moment`);
      return { a, b, w: both ? w : 0, h0, h1, run, model: this };
    },
    /** Fetch the next hours ahead of time (while playing), quietly. */
    prefetch(t, kinds) { this.at(t, kinds).catch(() => {}); },
  };
}

/** Every model, keyed by id, sharing one `ask`. */
export function makeModels(opts = {}) {
  const ask = opts.ask || workerAsk();
  return Object.fromEntries(Object.values(MODELS).map(d => [d.id, makeModel(d, { ...opts, ask })]));
}

/** Like model.at, but a model whose run was found and whose fields failed (usually S3 throttling a burst) is tried
 *  twice more; resolves to null when it can't be had. `still()` false stops early (a later moment was asked for). */
export async function momentOf(model, t, kinds, { still = () => true, sleep = pause, tries = 3 } = {}) {
  for (let i = 0; ; i++) {
    try { return await model.at(t, kinds); }
    catch (e) { if (i + 1 >= tries || !model.run || !still()) return null; await sleep(3000 * (i + 1)); }
  }
}

/** A field's value at a point of a moment (model.at's answer), blended in time: 'temp' °C, 'cloud' %, 'rain' mm/h,
 *  'pres' hPa, 'gust' m/s, 'wave' m, 'wavedir' ° (where the waves come from); NaN when not loaded (or over land, for waves). */
export function momentValue(c, kind, lat, lon) {
  const k = kind === 'wavedir' ? 'wave' : kind;
  if (!c || !c.a[k]) return NaN;
  if (k === 'wave') return sampleAt(c.a.wave[kind], c.b.wave[kind], c.w, lat, lon, kind === 'wave' ? sampleValid : sampleAngle);
  const v = sampleAt(c.a[k], c.b[k], c.w, lat, lon);
  return kind === 'temp' ? v - 273.15 : kind === 'rain' ? Math.max(0, v * 3600) : kind === 'pres' ? v / 100 : v;
}

/** The wind at a point of a moment, blended in time: out = [u, v] (m/s east, north); zeros when not loaded. */
export function momentWind(c, lat, lon, out = [0, 0]) {
  if (!c || !c.a.wind) { out[0] = out[1] = 0; return out; }
  const A = c.a.wind, B = c.b.wind, ua = sampleGrid(A.u, lat, lon), va = sampleGrid(A.v, lat, lon);
  if (c.w && B !== A) { out[0] = ua + (sampleGrid(B.u, lat, lon) - ua) * c.w; out[1] = va + (sampleGrid(B.v, lat, lon) - va) * c.w; } else { out[0] = ua; out[1] = va; }
  return out;
}

/** Everything a moment says about a point: { temp °C, u, v, speed m/s, cloud %, rain mm/h, gust m/s, pres hPa,
 *  presTrend (hPa over 3 h), wave m, waveFrom ° }; NaN for what isn't loaded. */
export function momentReading(c, lat, lon) {
  const w = c && c.a.wind ? momentWind(c, lat, lon, [0, 0]) : [NaN, NaN];
  let presTrend = NaN;
  if (c && c.a.pres && c.b.pres !== c.a.pres) presTrend = (sampleGrid(c.b.pres, lat, lon) - sampleGrid(c.a.pres, lat, lon)) / 100 * (3 / (c.h1 - c.h0));
  const v = k => momentValue(c, k, lat, lon);
  return { temp: v('temp'), u: w[0], v: w[1], speed: Math.hypot(w[0], w[1]), cloud: v('cloud'), rain: v('rain'), gust: v('gust'), pres: v('pres'), presTrend, wave: v('wave'), waveFrom: v('wavedir') };
}
