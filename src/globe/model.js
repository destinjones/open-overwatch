// The GFS weather model for the globe: NOAA's newest complete run (1° grid, every 3 h out to +120 h; +72 h on phones),
// read straight from its files on AWS one field and one forecast hour at a time (byte ranges: ~160 KB for a moment's
// wind; no key, no relay). Fetching and decoding happen in model.worker.js. A moment between two forecast hours blends
// the two either side of it.
import { PHONE } from './env.js';
import { gfsCycles, gfsFile, bracket, FIELDS } from '../core/gfs.js';
import { idxRanges } from '../core/grib2.js';

export const MAX_H = PHONE ? 72 : 120;
const KEEP = PHONE ? 6 : 16;   // forecast hours kept decoded (a hour with every field is ~1.3 MB)

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

export const Model = {
  run: null, finding: null, steps: new Map(),   // forecast hour → { used, rows, kinds: { wind, temp, cloud, rain } (promises) }
  /** The newest run whose files reach MAX_H (each run takes 4-5 h to come out). */
  ready() {
    if (this.run) return Promise.resolve(this.run);
    return this.finding ||= (async () => {
      for (const c of gfsCycles(Date.now(), 4)) {
        const r = await fetch(gfsFile(c, MAX_H) + '.idx', { headers: { Range: 'bytes=0-0' } }).catch(() => null);
        if (r && (r.status === 206 || r.status === 200)) { r.body?.cancel(); this.run = c; ask({ keep: `/gfs.${c.date}/${c.hour}/` }).catch(() => {}); return c; }
      }
      throw new Error('no recent model run reachable');
    })().finally(() => { this.finding = null; });
  },
  /** Every few hours a newer run comes out: start over with it (the caller redraws). */
  async refresh() {
    const c = gfsCycles(Date.now(), 1)[0];
    if (!this.run || c.t <= this.run.t) return false;
    const r = await fetch(gfsFile(c, MAX_H) + '.idx', { headers: { Range: 'bytes=0-0' } }).catch(() => null);
    if (!r || !(r.status === 206 || r.status === 200)) return false;
    r.body?.cancel(); this.run = c; this.steps.clear(); ask({ keep: `/gfs.${c.date}/${c.hour}/` }).catch(() => {});
    return true;
  },
  step(h) {
    let s = this.steps.get(h);
    if (!s) {
      s = { used: 0, rows: null, kinds: {} }; this.steps.set(h, s);
      if (this.steps.size > KEEP) for (const [k] of [...this.steps.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.steps.size - KEEP)) if (k !== h) this.steps.delete(k);
    }
    s.used = performance.now(); return s;
  },
  /** One kind of field for forecast hour h: 'wind' → { u, v }; 'temp' (K), 'cloud' (%), 'rain' (kg/m²/s) → a field. */
  async field(h, kind) {
    const run = await this.ready(), s = this.step(h);
    s.kinds[kind] ||= (async () => {
      const url = gfsFile(run, h);
      const rows = await (s.rows ||= ask({ idx: url + '.idx' }).then(d => d.rows).catch(e => { s.rows = null; throw e; }));
      const ranges = idxRanges(rows, FIELDS[kind]);
      if (!ranges.length) throw new Error(`no ${kind} in this forecast hour`);
      const by = Object.fromEntries((await ask({ url, ranges })).fields.map(f => [f.key, f]));
      if (kind === 'wind' ? !(by.u && by.v) : !by[kind]) throw new Error(`no ${kind} in this forecast hour`);
      return kind === 'wind' ? { u: by.u, v: by.v } : by[kind];
    })().catch(e => { delete s.kinds[kind]; throw e; });
    return s.kinds[kind];
  },
  /** The fields of `kinds` either side of moment t (ms): { a, b, w, h0, h1, run }, a and b being { wind, temp, … }. */
  async at(t, kinds) {
    const run = await this.ready(), { h0, h1, w } = bracket(run, t, MAX_H);
    const get = async h => Object.fromEntries(await Promise.all(kinds.map(async k => [k, await this.field(h, k)])));
    const [a, b] = await Promise.all([get(h0), w > 0.001 ? get(h1) : null]);   // exactly on a forecast hour: one is enough
    return { a, b: b || a, w: b ? w : 0, h0, h1, run };
  },
  /** Fetch the next hours ahead of time (while playing), quietly. */
  prefetch(t, kinds) { this.at(t, kinds).catch(() => {}); },
};
