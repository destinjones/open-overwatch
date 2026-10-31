// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The aurora oval, live: NOAA SWPC's OVATION model (a 1-degree grid of the chance of seeing aurora, updated every few minutes,
// public domain, sends CORS). Painted once into a 360 x 180 picture and laid over the Earth as a single imagery layer: green
// where it is faint, through yellow to pink where it is strong. Loaded only while the layer is on; refreshed every 10 minutes.
// The grid is fetched, read and painted in a worker (core/aurora.worker.js), after the globe's first picture: on the page
// it was a 462 ms task in the boot. Without workers it is read here, after the first picture all the same.
import { C } from './env.js';
import { viewer } from './viewer.js';
import { L, setCount } from './layers.js';
import { settled } from './state.js';
import { OVATION_URL, parseOvation, paintEquirect } from '../core/aurora.js';

// the worker: one request at a time (the layer reloads every 10 minutes at most). A failed download rejects with
// { feed: true }; a worker that cannot start (no module workers) rejects without it, and the page reads the grid itself.
let worker = null, seq = 0;
function viaWorker() {
  return new Promise((res, rej) => {
    const w = worker || (worker = new Worker(new URL('../core/aurora.worker.js', import.meta.url), { type: 'module' }));
    const id = ++seq, timer = setTimeout(() => done(Object.assign(new Error('aurora worker timed out'), { feed: true })), 45e3);
    const done = (err, v) => { clearTimeout(timer); w.onmessage = w.onerror = null; err ? rej(err) : res(v); };
    w.onmessage = e => { if (e.data.id === id) e.data.error ? done(Object.assign(new Error(e.data.error), { feed: true })) : done(null, e.data); };
    w.onerror = e => { e.preventDefault?.(); if (worker === w) worker = null; done(new Error(e.message || 'aurora worker failed')); };
    w.postMessage({ id });
  });
}
async function onPage(a) { const d = await a.grid(), { grid, peak, at } = parseOvation(d); return { px: paintEquirect(grid), peak, at }; }

export const Aurora = {
  layer: null, loading: false, at: '', peak: 0, tried: 0, raw: null, rawAt: 0,
  /** The OVATION grid itself ({ 'Forecast Time', coordinates: [[lon, lat, %], ...] }), at most 10 minutes old (Tonight reads
   *  it; the layer's picture comes from the worker and does not fill this). */
  async grid() {
    if (!this.raw || Date.now() - this.rawAt > 10 * 60e3) { const r = await fetch(OVATION_URL); if (!r.ok) throw new Error('HTTP ' + r.status); this.raw = await r.json(); this.rawAt = Date.now(); }
    return this.raw;
  },
  async load() {
    if (this.loading) return; this.loading = true; this.tried = Date.now();
    try {
      await settled.wait();   // not inside the boot (state.js)
      // the grid and colours are shared with the 2D map (core/aurora.js)
      const { px, peak, at } = await viaWorker().catch(e => { if (e.feed) throw e; console.warn('aurora worker', e.message); return onPage(this); });
      const cv = document.createElement('canvas'); cv.width = 360; cv.height = 181; const cx = cv.getContext('2d'), img = cx.createImageData(360, 181);
      img.data.set(px); cx.putImageData(img, 0, 0);
      const provider = await C.SingleTileImageryProvider.fromUrl(cv.toDataURL(), { rectangle: C.Rectangle.fromDegrees(-180, -90.5, 180, 90.5), credit: new C.Credit('Aurora forecast: NOAA Space Weather Prediction Center (OVATION)') });
      const old = this.layer; this.layer = viewer.imageryLayers.addImageryProvider(provider); this.layer.alpha = 0.9; if (old) viewer.imageryLayers.remove(old, true);
      this.at = at; this.peak = peak; setCount('aurora', 0); this.apply();
    } catch (e) { console.warn('aurora', e); } finally { this.loading = false; }
  },
  apply() {
    if (this.layer) { this.layer.show = L.aurora.on; if (L.aurora.on) viewer.imageryLayers.raiseToTop(this.layer); viewer.scene.requestRender(); }
    if (L.aurora.on && (!this.layer || Date.now() - this.tried > 10 * 60e3)) this.load();
  },
};
