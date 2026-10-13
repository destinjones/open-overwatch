// The aurora oval, live: NOAA SWPC's OVATION model (a 1-degree grid of the chance of seeing aurora, updated every few minutes,
// public domain, sends CORS). Painted once into a 360 x 180 picture and laid over the Earth as a single imagery layer: green
// where it is faint, through yellow to pink where it is strong. Loaded only while the layer is on; refreshed every 10 minutes.
import { C } from './env.js';
import { viewer } from './viewer.js';
import { L, setCount } from './layers.js';
import { OVATION_URL, parseOvation, paintEquirect } from '../core/aurora.js';

export const Aurora = {
  layer: null, loading: false, at: '', peak: 0, tried: 0, raw: null, rawAt: 0,
  /** The OVATION grid itself ({ 'Forecast Time', coordinates: [[lon, lat, %], ...] }), at most 10 minutes old (Tonight reads it). */
  async grid() {
    if (!this.raw || Date.now() - this.rawAt > 10 * 60e3) { const r = await fetch(OVATION_URL); if (!r.ok) throw new Error('HTTP ' + r.status); this.raw = await r.json(); this.rawAt = Date.now(); }
    return this.raw;
  },
  async load() {
    if (this.loading) return; this.loading = true; this.tried = Date.now();
    try {
      const d = await this.grid(), { grid, peak } = parseOvation(d);   // the grid and colours are shared with the 2D map (core/aurora.js)
      const cv = document.createElement('canvas'); cv.width = 360; cv.height = 181; const cx = cv.getContext('2d'), img = cx.createImageData(360, 181);
      img.data.set(paintEquirect(grid)); cx.putImageData(img, 0, 0);
      const provider = await C.SingleTileImageryProvider.fromUrl(cv.toDataURL(), { rectangle: C.Rectangle.fromDegrees(-180, -90.5, 180, 90.5), credit: new C.Credit('Aurora forecast: NOAA Space Weather Prediction Center (OVATION)') });
      const old = this.layer; this.layer = viewer.imageryLayers.addImageryProvider(provider); this.layer.alpha = 0.9; if (old) viewer.imageryLayers.remove(old, true);
      this.at = d['Forecast Time']; this.peak = peak; setCount('aurora', 0); this.apply();
    } catch (e) { console.warn('aurora', e); } finally { this.loading = false; }
  },
  apply() {
    if (this.layer) { this.layer.show = L.aurora.on; if (L.aurora.on) viewer.imageryLayers.raiseToTop(this.layer); viewer.scene.requestRender(); }
    if (L.aurora.on && (!this.layer || Date.now() - this.tried > 10 * 60e3)) this.load();
  },
};
