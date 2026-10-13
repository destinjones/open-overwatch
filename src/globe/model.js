// The weather models for the globe, read straight from their files on AWS one field and one forecast hour at a time
// (byte ranges; no key, no relay): NOAA's GFS (1°, newest complete run; every 3 h out to +120 h, +72 h on phones) with
// NOAA's WAVEWATCH III waves, and ECMWF's IFS (0.25°, CC BY 4.0) with its wave model. Fetching and decoding happen in
// model.worker.js, which also thins 0.25° grids to 0.5° (1° on phones): finer than the globe can show, and 4 MB a field.
// A moment between two forecast hours blends the two either side of it. core/wxmodels.js says where everything is.
import { PHONE } from './env.js';
import { MODELS, bracketFor, partsOf } from '../core/wxmodels.js';
import { idxRanges } from '../core/grib2.js';

export const MAX_H = PHONE ? 72 : 120;
const KEEP = PHONE ? 6 : 16;   // forecast hours kept decoded per model (a 1° hour with every field is ~1.3 MB)
const RES = PHONE ? 1 : 0.5;    // degrees: the finest grid kept

let worker = null, seq = 0;
const waiting = new Map();
function ask(msg) {
  if (!worker) {
    worker = new Worker(new URL('./model.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); if (e.data.error) w.rej(new Error(e.data.error)); else w.res(e.data); };
    worker.onerror = e => { for (const w of waiting.values()) w.rej(new Error(e.message || 'model worker failed')); waiting.clear(); worker = null; };
  }
  return new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); worker.postMessage({ ...msg, id }); });
}
/** Does run c reach the last hour we show? (Each run takes hours to come out; its last file is the last to appear.) */
async function complete(def, c) {
  const url = def.indexOf(def.file(c, Math.min(MAX_H, def.maxH)));
  for (let i = 0; i < 8; i++) {   // S3 sheds load with "503 Slow Down", sent without CORS headers: to us, a failed fetch
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' } }).catch(() => null);
    if (r && (r.status === 206 || r.status === 200)) { r.body?.cancel(); return true; }
    if (r && r.status !== 503) return false;   // 404 or 403: this run isn't (all) out yet
    await new Promise(res => setTimeout(res, Math.min(4000, 400 * 2 ** i) + Math.random() * 600));
  }
  return false;
}

function makeModel(def) {
  const cache = 'oo3d-' + def.id;
  return {
    def, id: def.id, name: def.name, run: null, finding: null, steps: new Map(),   // forecast hour → { used, rows: { stream: promise }, kinds: { kind: promise } }
    /** The newest run whose files reach MAX_H. */
    ready() {
      if (this.run) return Promise.resolve(this.run);
      return this.finding ||= (async () => {
        for (const c of def.cycles(Date.now(), 4)) if (await complete(def, c)) { this.run = c; ask({ keep: def.cachePath(c), cache }).catch(() => {}); return c; }
        throw new Error(`no recent ${def.short} run reachable`);
      })().finally(() => { this.finding = null; });
    },
    /** A newer run is out (GFS every 6 h, ECMWF every 12): start over with it (the caller redraws). */
    async refresh() {
      const c = def.cycles(Date.now(), 1)[0];
      if (!this.run || c.t <= this.run.t || !(await complete(def, c))) return false;
      this.run = c; this.steps.clear(); ask({ keep: def.cachePath(c), cache }).catch(() => {});
      return true;
    },
    step(h) {
      let s = this.steps.get(h);
      if (!s) {
        s = { used: 0, rows: {}, kinds: {} }; this.steps.set(h, s);
        if (this.steps.size > KEEP) for (const [k] of [...this.steps.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.steps.size - KEEP)) if (k !== h) this.steps.delete(k);
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
        const by = Object.fromEntries((await ask({ url, ranges, res: RES, cache })).fields.map(f => [f.key, f]));
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
      const run = await this.ready(), { h0, h1, w } = bracketFor(def, run, t, MAX_H), both = w > 0.001;
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

/** Every model the globe can show. */
export const Models = Object.fromEntries(Object.values(MODELS).map(d => [d.id, makeModel(d)]));
/** GFS: the default, and the one older callers mean. */
export const Model = Models.gfs;
