// Wind, temperature, cloud, rain, gusts, waves and pressure for weather mode, at any moment of the weather timeline. The
// source is a weather model (model.js: NOAA GFS or ECMWF IFS, read from their files on AWS), blended between the forecast
// hours either side of the moment; with a second model chosen, the two are shown side by side, split where the slider
// is (every wash is two imagery layers, one each side of scene.splitPosition, and each wind streak follows the model on
// its side). If no model can be reached, wind and temperature fall back to a snapshot of now: Open-Meteo on a 10° grid
// (the site's scheduled build mirrors it as data/wind.json; else the browser asks Open-Meteo itself).
// Wind is drawn as moving streaks on a canvas laid over the globe (each particle is advected through the field and
// projected with the camera); temperature, cloud, rain, gusts and waves are colour washes, one image per moment, laid
// on the globe; pressure is isobars every 4 hPa (core/contour.js) drawn into a clear image, with H and L labels on the
// centres.
import { C, store, PHONE } from './env.js';
import { viewer, camera, camHeight } from './viewer.js';
import { fetchAsset } from '../core/assets.js';
import { sampleGrid } from '../core/grib2.js';
import { sampleAt, sampleValid, sampleAngle, blend, coarsen } from '../core/fields.js';
import { isolines, levels, extrema, labelSpots } from '../core/contour.js';
import { runWords } from '../core/wxmodels.js';
import { Model } from './model.js';

const LATS = [], LONS = [];
for (let la = -80; la <= 80; la += 10) LATS.push(la);
for (let lo = -180; lo < 180; lo += 10) LONS.push(lo);
const NX = LONS.length, NY = LATS.length, COUNT = PHONE ? 900 : 3800;
const CHUNK = 306, TTL = 30 * 60e3, MIRROR_MAX = 7 * 3600e3, KEY = 'wx.grid.v1';
const R = 6378137, E2 = 0.00669437999014, RAD = Math.PI / 180, VP = new C.Matrix4();
const COLORS = ['#7fe8ff', '#b6f5ff', '#ffffff', '#fff3a8', '#ffc46b', '#ff7a5c'];   // calm to gale
const EDGES = [3, 6, 10, 15, 22];   // m/s between the colours
const OM_CREDIT = new C.Credit('Wind and temperature: Open-Meteo.com (CC BY 4.0)');
const CREDITS = {};
/** The credit line for a model's field: the waves of GFS come from a different model. */
function creditFor(def, kind) {
  const text = def.id === 'gfs' ? (kind === 'wave' ? 'Waves: NOAA WAVEWATCH III (GFS-Wave)' : 'Weather: NOAA GFS model') : 'Weather: ECMWF IFS open data (CC BY 4.0)';
  return CREDITS[text] ||= new C.Credit(text);
}
const WASH_ALPHA = { temp: 0.6, cloud: 1, rain: 1, gust: 0.85, wave: 0.85, pres: 1 };
const SIDES = ['main', 'cmp'];
const HI = !PHONE;   // detailed images (waves, isobars) at desktop size

export const Wind = {
  grid: null, loading: null, canvas: null, ctx: null, parts: [], raf: 0, windOn: false,
  model: Model,     // the model shown (model.js Models.*)
  cmpModel: null,   // a second model, side by side, or null
  cur: null,        // the model at the moment shown: { a, b, w, h0, h1, run, model } (model.js), or null (snapshot only)
  cmp: null,        // the second model at that moment
  split: 0.5,       // where the two meet, as a fraction of the width
  t: 0,             // that moment (ms)
  washes: {},       // kind → { on, main: { layer, key }, cmp: { layer, key } }
  images: new Map(),   // a wash's key → { url, centres } (going back and forth costs nothing)
  centres: { main: null, cmp: null },   // LabelCollections of H and L

  /** Show model `main`, and `cmp` beside it (or null). The caller then asks for a moment again. */
  setModels(main, cmp = null) {
    if (main === cmp) cmp = null;
    if (this.model !== main) { this.model = main; this.cur = null; }
    if (this.cmpModel !== cmp) { this.cmpModel = cmp; this.cmp = null; }
    for (const w of Object.values(this.washes)) for (const s of SIDES) w[s].key = '';
    if (!cmp) { for (const w of Object.values(this.washes)) if (w.cmp.layer) w.cmp.layer.show = false; this.showCentres('cmp', null); }
    viewer.scene.splitPosition = this.split;
  },
  data(side) { return side === 'cmp' ? this.cmp : this.cur; },

  // ---- the snapshot (fallback): Open-Meteo, now only
  async load() {
    if (this.grid) return this.grid;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const c = store.get(KEY, null);
      if (c && Date.now() - c.t < TTL && c.u && c.u.length === NX * NY) return (this.grid = c);
      // the site's scheduled build keeps a copy (data/wind.json, up to 6 h old): no quota spent, one small file
      const mirror = await fetchAsset('data/wind.json', 'json').catch(() => null);
      if (mirror && mirror.u && mirror.u.length === NX * NY && Date.now() - mirror.t < MIRROR_MAX) { store.set(KEY, mirror); return (this.grid = mirror); }
      try { return (this.grid = await this.live()); }
      catch (e) { if (mirror && mirror.u && mirror.u.length === NX * NY) return (this.grid = mirror); throw e; }   // an old snapshot beats none
    })().catch(e => { this.loading = null; throw e; });
    return this.loading;
  },
  async live() {   // straight from Open-Meteo: 612 locations (it limits visitors per hour), used only when the site's copy is missing or stale
    const pts = []; for (const la of LATS) for (const lo of LONS) pts.push([la, lo]);
    const u = new Array(NX * NY), v = new Array(NX * NY), t = new Array(NX * NY); let when = '';
    const jobs = []; for (let i = 0; i < pts.length; i += CHUNK) jobs.push(i);
    await Promise.all(jobs.map(async i => {   // both halves at once
      const part = pts.slice(i, i + CHUNK);
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + part.map(p => p[0]).join(',') + '&longitude=' + part.map(p => p[1]).join(',') + '&current=wind_speed_10m,wind_direction_10m,temperature_2m&wind_speed_unit=ms';
      const rows = await (await fetch(url)).json();
      if (!Array.isArray(rows)) throw new Error('weather model unavailable');
      rows.forEach((r, j) => { const s = r.current.wind_speed_10m, d = r.current.wind_direction_10m * Math.PI / 180;   // direction the wind blows FROM
        u[i + j] = -s * Math.sin(d); v[i + j] = -s * Math.cos(d); t[i + j] = r.current.temperature_2m; when = r.current.time; });
    }));
    const g = { t: Date.now(), at: when, u, v, temp: t }; store.set(KEY, g); return g;
  },
  /** The snapshot's bilinear value at a point: out = [u, v, temp °C]. */
  snapAt(lon, lat, out) {
    const fx = ((lon + 180) % 360 + 360) % 360 / 10, fy = (Math.max(-80, Math.min(80, lat)) + 80) / 10;
    const x0 = Math.floor(fx) % NX, x1 = (x0 + 1) % NX, y0 = Math.min(NY - 2, Math.floor(fy)), y1 = y0 + 1, ax = fx - Math.floor(fx), ay = fy - y0, g = this.grid;
    const at = (a, x, y) => a[y * NX + x], bil = a => (at(a, x0, y0) * (1 - ax) + at(a, x1, y0) * ax) * (1 - ay) + (at(a, x0, y1) * (1 - ax) + at(a, x1, y1) * ax) * ay;
    out[0] = bil(g.u); out[1] = bil(g.v); out[2] = bil(g.temp); return out;
  },

  // ---- the model at a moment
  /** Load what `kinds` ('wind', 'temp', 'cloud', 'rain', 'pres', 'gust', 'wave') need for moment t, from the model shown
   *  and the one beside it, then redraw what is showing. Resolves to true with the model, false on the snapshot (no
   *  model reachable: wind and temperature of now only). */
  async moment(t, kinds) {
    this.t = t;
    const main = this.model, other = this.cmpModel;
    const [cur, cmp] = await Promise.all([main.at(t, kinds).catch(e => { console.warn('weather model', main.id, e.message); return null; }),
      other ? other.at(t, kinds).catch(e => { console.warn('weather model', other.id, e.message); return null; }) : null]);
    if (this.t !== t || this.model !== main) return !!cur;   // a later moment (or another model) was asked for meanwhile
    this.cur = cur; this.cmp = this.cmpModel === other ? cmp : null;
    if (!cur) await this.load();
    this.redraw();
    return !!this.cur;
  },
  /** A field's value at a point, blended in time: 'temp' °C, 'cloud' %, 'rain' mm/h, 'pres' hPa, 'gust' m/s, 'wave' m,
   *  'wavedir' degrees (where the waves come from), or NaN when not loaded (or over land, for waves). */
  value(kind, lat, lon, side = 'main') {
    const c = this.data(side), k = kind === 'wavedir' ? 'wave' : kind;
    if (!c || !c.a[k]) { if (!c && side === 'main' && kind === 'temp' && this.grid) return this.snapAt(lon, lat, [0, 0, 0])[2]; return NaN; }
    if (k === 'wave') return sampleAt(c.a.wave[kind], c.b.wave[kind], c.w, lat, lon, kind === 'wave' ? sampleValid : sampleAngle);
    const v = sampleAt(c.a[k], c.b[k], c.w, lat, lon);
    return kind === 'temp' ? v - 273.15 : kind === 'rain' ? Math.max(0, v * 3600) : kind === 'pres' ? v / 100 : v;
  },
  /** Wind at a point, blended in time: out = [u, v] (m/s east, north). */
  windAt(lon, lat, out, side = 'main') {
    const c = side === 'cmp' ? this.cmp : this.cur;
    if (c && c.a.wind) {
      const A = c.a.wind, B = c.b.wind, ua = sampleGrid(A.u, lat, lon), va = sampleGrid(A.v, lat, lon);
      if (c.w && B !== A) { out[0] = ua + (sampleGrid(B.u, lat, lon) - ua) * c.w; out[1] = va + (sampleGrid(B.v, lat, lon) - va) * c.w; } else { out[0] = ua; out[1] = va; }
      return out;
    }
    if (side === 'main' && !c && this.grid) { this.snapAt(lon, lat, out); return out; }
    out[0] = out[1] = 0; return out;
  },
  /** What the weather is at a point at the moment shown: { temp °C, speed m/s, u, v, cloud %, rain mm/h, gust m/s,
   *  pres hPa, presTrend (hPa over the 3 h step), wave m, waveFrom °, source, run, t }, or null. */
  reading(lat, lon, side = 'main') {
    const c = this.data(side);
    if (!c && (side === 'cmp' || !this.grid)) return null;
    const w = c && !c.a.wind ? [NaN, NaN] : this.windAt(lon, lat, [0, 0], side);   // the model without its wind: none, not the snapshot's
    let presTrend = NaN;
    if (c && c.a.pres && c.b.pres !== c.a.pres) presTrend = (sampleGrid(c.b.pres, lat, lon) - sampleGrid(c.a.pres, lat, lon)) / 100 * (3 / (c.h1 - c.h0));
    return { temp: this.value('temp', lat, lon, side), u: w[0], v: w[1], speed: Math.hypot(w[0], w[1]), cloud: this.value('cloud', lat, lon, side), rain: this.value('rain', lat, lon, side),
      gust: this.value('gust', lat, lon, side), pres: this.value('pres', lat, lon, side), presTrend, wave: this.value('wave', lat, lon, side), waveFrom: this.value('wavedir', lat, lon, side),
      source: c ? c.model.def.name : 'Open-Meteo', model: c ? c.model.id : null, run: c ? c.run : null, t: c ? this.t : this.grid?.t };
  },
  /** Words for the panel: which run, or the snapshot's time. */
  note(side = 'main') {
    const c = this.data(side);
    if (c) return `${c.model.def.name}, ${runWords(c.run)}`;
    if (side === 'cmp') return this.cmpModel ? `${this.cmpModel.def.name} not reachable` : '';
    return this.grid ? `Open-Meteo, ${String(this.grid.at || '').slice(11)} UTC` : '';
  },

  // ---- colour washes (temperature, cloud, rain, gusts, waves) and the isobars
  async setWash(kind, on) {
    const wsh = this.washes[kind] ||= { on: false, main: { layer: null, key: '' }, cmp: { layer: null, key: '' } };
    wsh.on = on;
    if (!on) { for (const s of SIDES) if (wsh[s].layer) wsh[s].layer.show = false; if (kind === 'pres') this.hideCentres(); viewer.scene.requestRender(); return; }
    await this.drawWash(kind);
  },
  setTemp(on) { return this.setWash('temp', on); },
  redraw() { for (const [kind, w] of Object.entries(this.washes)) if (w.on) this.drawWash(kind).catch(e => console.warn('wash', kind, e.message)); },
  async drawWash(kind) {
    const wsh = this.washes[kind]; if (!wsh || !wsh.on) return;
    await Promise.all(SIDES.map(side => this.drawSide(kind, side)));
  },
  async drawSide(kind, side) {
    const wsh = this.washes[kind], slot = wsh[side], c = this.data(side);
    const hide = () => { if (slot.layer) slot.layer.show = false; if (kind === 'pres') this.showCentres(side, null); };
    if (side === 'cmp' && !this.cmpModel) return hide();
    if (!c && (kind !== 'temp' || side === 'cmp')) return hide();   // the snapshot has only temperature (and wind)
    if (c && !c.a[kind]) return;   // not loaded for this moment yet: moment() redraws when it is
    if (!c && !this.grid) await this.load();
    const key = c ? `${kind}|${c.model.id}|${c.run.t}|${c.h0}|${c.h1}|${c.w.toFixed(2)}` : `${kind}|snap|${this.grid.t}`;
    let img = this.images.get(key);
    if (!img) { img = this.paint(kind, side); this.images.set(key, img); if (this.images.size > 40) this.images.delete(this.images.keys().next().value); }
    if (kind === 'pres') this.showCentres(side, img.centres);
    if (slot.key !== key || !slot.layer) {
      const p = await C.SingleTileImageryProvider.fromUrl(img.url, { rectangle: C.Rectangle.fromDegrees(-180, -90, 180, 90), credit: c ? creditFor(c.model.def, kind) : OM_CREDIT });
      if (!wsh.on || (side === 'cmp' && !this.cmpModel)) return;
      const old = slot.layer;
      slot.layer = viewer.imageryLayers.addImageryProvider(p); slot.layer.alpha = WASH_ALPHA[kind]; slot.key = key;
      if (old) setTimeout(() => viewer.imageryLayers.remove(old, true), 400);   // the new one's tile arrives first: no blink
    }
    slot.layer.splitDirection = this.cmpModel ? (side === 'main' ? C.SplitDirection.LEFT : C.SplitDirection.RIGHT) : C.SplitDirection.NONE;
    slot.layer.show = true; viewer.imageryLayers.raiseToTop(slot.layer);
    if (kind !== 'pres' && wsh !== this.washes.pres && this.washes.pres?.on) for (const s of SIDES) if (this.washes.pres[s].layer?.show) viewer.imageryLayers.raiseToTop(this.washes.pres[s].layer);   // isobars stay on top
    viewer.scene.requestRender();
  },
  /** One wash as an image (longitudes -180..180, latitudes 90..-90): { url, centres (pressure only) }. */
  paint(kind, side) {
    if (kind === 'pres') return this.paintPressure(side);
    if (kind === 'wave') return { url: this.paintWaves(side) };
    const cv = document.createElement('canvas'); cv.width = 360; cv.height = 180;
    const cx = cv.getContext('2d'), img = cx.createImageData(360, 180), d = img.data, o = [0, 0, 0], snap = !this.data(side);
    const colour = kind === 'temp' ? v => [...ramp(v), 255] : kind === 'cloud' ? cloudColour : kind === 'gust' ? gustColour : rainColour;
    for (let y = 0; y < 180; y++) for (let x = 0; x < 360; x++) {
      const lon = x - 180 + 0.5, lat = 90 - y - 0.5, i = (y * 360 + x) * 4;
      const [r, g, b, a] = colour(snap ? this.snapAt(lon, lat, o)[2] : this.value(kind, lat, lon, side));
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
    cx.putImageData(img, 0, 0);
    return { url: cv.toDataURL() };
  },
  /** Wave height in colour (0.5°), and which way the waves run: a short dart every few degrees of open sea. */
  paintWaves(side) {
    const n = HI ? 720 : 360, W = n * 2, Hh = n, s = 360 / n;
    const small = document.createElement('canvas'); small.width = n; small.height = n / 2;
    const sx = small.getContext('2d'), img = sx.createImageData(n, n / 2), d = img.data;
    for (let y = 0; y < n / 2; y++) for (let x = 0; x < n; x++) {
      const [r, g, b, a] = waveColour(this.value('wave', 90 - (y + 0.5) * s, -180 + (x + 0.5) * s, side)), i = (y * n + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
    sx.putImageData(img, 0, 0);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = true; cx.drawImage(small, 0, 0, W, Hh);
    const step = HI ? 5 : 8, px = W / 360, len = HI ? 9 : 7;
    cx.strokeStyle = 'rgba(255,255,255,0.85)'; cx.lineWidth = HI ? 1.4 : 1.2; cx.lineCap = 'round'; cx.beginPath();
    for (let lat = -75; lat <= 75; lat += step) {
      const k = Math.max(1, Math.round(1 / Math.cos(lat * RAD)));   // fewer darts toward the poles, where a degree is short
      for (let lon = -180 + step / 2; lon < 180; lon += step * k) {
        const h = this.value('wave', lat, lon, side), from = this.value('wavedir', lat, lon, side);
        if (!(h >= 0.3) || !Number.isFinite(from)) continue;
        const go = (from + 180) * RAD, cl = Math.max(0.2, Math.cos(lat * RAD));
        let dx = Math.sin(go) / cl, dy = -Math.cos(go); const m = Math.hypot(dx, dy); dx /= m; dy /= m;   // on the globe the image is squeezed east-west by cos(lat)
        const x = (lon + 180) * px, y = (90 - lat) * px, l = len * Math.min(1.4, 0.7 + h / 6);
        const x0 = x - dx * l / 2, y0 = y - dy * l / 2, x1 = x + dx * l / 2, y1 = y + dy * l / 2;
        cx.moveTo(x0, y0); cx.lineTo(x1, y1);
        cx.moveTo(x1, y1); cx.lineTo(x1 - (dx * 0.9 - dy * 0.5) * l * 0.4, y1 - (dy * 0.9 + dx * 0.5) * l * 0.4);
        cx.moveTo(x1, y1); cx.lineTo(x1 - (dx * 0.9 + dy * 0.5) * l * 0.4, y1 - (dy * 0.9 - dx * 0.5) * l * 0.4);
      }
    }
    cx.stroke();
    return cv.toDataURL();
  },
  /** Isobars every 4 hPa (heavier every 20) with their values, on a clear image; plus the highs and lows. */
  paintPressure(side) {
    const c = this.data(side), f0 = blend(c.a.pres, c.b.pres, c.w), k = Math.max(1, Math.round(1 / f0.grid.di));
    const f = coarsen(f0, k);   // 1°: isobars on a weather map are smooth; the 0.25° field wiggles over every mountain
    let lo = Infinity, hi = -Infinity; for (const v of f.values) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const W = HI ? 2048 : 1024, Hh = W / 2, px = W / 360;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; const cx = cv.getContext('2d');
    const X = lon => ((lon + 180) % 360 + 360) % 360 * px, Y = lat => (90 - lat) * px;
    const lines = isolines(f, levels(lo, hi, 400, 100000));
    cx.lineJoin = 'round'; cx.lineCap = 'round';
    for (const { level, lines: ls } of lines) {
      const bold = Math.round(level / 100) % 20 === 0;
      cx.strokeStyle = bold ? 'rgba(255,255,255,0.95)' : 'rgba(235,242,255,0.72)'; cx.lineWidth = (bold ? 2.2 : 1.3) * (HI ? 1 : 0.8);
      cx.beginPath();
      for (const line of ls) {
        let px0 = NaN;
        for (const [lon, lat] of line) { const x = X(lon), y = Y(lat); if (Number.isNaN(px0) || Math.abs(x - px0) > W / 2) cx.moveTo(x, y); else cx.lineTo(x, y); px0 = x; }
      }
      cx.stroke();
    }
    cx.font = `600 ${HI ? 15 : 11}px system-ui, sans-serif`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.lineWidth = HI ? 3.2 : 2.4;
    cx.strokeStyle = 'rgba(8,14,26,0.85)'; cx.fillStyle = '#ffffff';
    for (const { level, lines: ls } of lines) for (const line of ls) for (const s of labelSpots(line, { spacing: 40, minLen: 12 })) {
      if (Math.abs(s.lat) > 75) continue;
      const t = String(Math.round(level / 100)), x = X(s.lon), y = Y(s.lat);
      cx.strokeText(t, x, y); cx.fillText(t, x, y);
    }
    const centres = extrema(f, { radius: 9, depth: 250 }).slice(0, PHONE ? 16 : 32).map(e => ({ ...e, value: e.value / 100 }));
    return { url: cv.toDataURL(), centres };
  },
  dropWashes() {
    for (const w of Object.values(this.washes)) for (const s of SIDES) if (w[s].layer) viewer.imageryLayers.remove(w[s].layer, true);
    this.washes = {}; this.hideCentres();
  },
  dropTemp() { this.dropWashes(); },

  // ---- H and L
  showCentres(side, list) {
    let col = this.centres[side];
    if (!list) { if (col) col.show = false; return; }
    if (!col) { col = this.centres[side] = viewer.scene.primitives.add(new C.LabelCollection()); }
    if (col.list !== list) {
      col.removeAll(); col.list = list;
      for (const e of list) col.add({ position: C.Cartesian3.fromDegrees(e.lon, e.lat, 4000), text: `${e.type}\n${Math.round(e.value)}`, font: '800 22px system-ui, sans-serif',
        fillColor: C.Color.fromCssColorString(e.type === 'H' ? '#6cb8ff' : '#ff6b6b'), outlineColor: C.Color.fromCssColorString('#081020'), outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: C.HorizontalOrigin.CENTER, verticalOrigin: C.VerticalOrigin.CENTER, scale: PHONE ? 0.75 : 0.85,
        translucencyByDistance: new C.NearFarScalar(2.5e7, 1, 6e7, 0) });
    }
    col.show = true; this.sideCentres(); viewer.scene.requestRender();
  },
  hideCentres() { for (const s of SIDES) if (this.centres[s]) this.centres[s].show = false; },
  /** Side by side: each model's H and L only on its own side of the split (labels aren't imagery, so no splitDirection). */
  sideCentres() {
    const sc = viewer.scene, W = sc.canvas.clientWidth, cut = this.split * W, p = new C.Cartesian2();
    for (const side of SIDES) {
      const col = this.centres[side]; if (!col || !col.show) continue;
      for (let i = 0; i < col.length; i++) {
        const l = col.get(i);
        if (!this.cmpModel) { l.show = true; continue; }
        const w = C.SceneTransforms.worldToWindowCoordinates(sc, l.position, p);
        l.show = !!w && (side === 'main' ? w.x < cut : w.x >= cut);
      }
    }
  },

  // ---- wind particles
  async setWind(on) {
    if (!on) { this.windOn = false; cancelAnimationFrame(this.raf); if (this.canvas) this.canvas.style.display = 'none'; return; }
    if (this.windOn) return;   // already running (the panel calls this on every step)
    this.windOn = true;
    if (!this.cur) await this.load().catch(e => { this.windOn = false; throw e; });
    if (!this.windOn) return;   // closed while loading
    if (!this.canvas) this.makeCanvas();
    this.canvas.style.display = 'block'; this.resize(); this.parts = Array.from({ length: COUNT }, () => this.spawn({}));
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.last = null; cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => this.frame());
  },
  makeCanvas() {
    const cv = document.createElement('canvas'); cv.id = 'windcv'; cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
    document.body.append(cv); this.canvas = cv; this.ctx = cv.getContext('2d'); addEventListener('resize', () => this.windOn && this.resize());
  },
  resize() {   // phones: a canvas a third the pixels; thin streaks hardly notice, and the per-frame fade and composite cost far less
    const dpr = PHONE ? 0.6 : Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(innerWidth * dpr); this.canvas.height = Math.round(innerHeight * dpr); this.dpr = dpr;
  },
  spawn(p) {   // a random point, preferably on the side of the Earth that faces the camera
    this.camDist = this.camDist || C.Cartesian3.magnitude(camera.positionWC);
    for (let tries = 0; tries < 6; tries++) {
      p.lon = Math.random() * 360 - 180; p.lat = Math.asin(Math.random() * 2 - 1) * 180 / Math.PI;
      if (tries === 5 || this.facing(p.lon, p.lat)) break;
    }
    p.age = Math.floor(Math.random() * 90); p.life = 70 + Math.floor(Math.random() * 60); p.px = NaN; p.py = NaN; return p;
  },
  facing(lon, lat) {   // is the point on the visible hemisphere? (dot with the camera position beats the horizon)
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180, c = camera.positionWC, cr = Math.cos(la);
    return (cr * Math.cos(lo) * c.x + cr * Math.sin(lo) * c.y + Math.sin(la) * c.z) * R > R * R + 0.07 * R * this.camDist;   // a margin keeps the near-horizon pile-up off
  },
  frame() {
    if (!this.windOn) return;
    this.raf = requestAnimationFrame(() => this.frame());
    if (PHONE && (this.tick = (this.tick || 0) + 1) % 2) return;   // phones: streaks at half the frame rate; the globe keeps its own
    this.camDist = C.Cartesian3.magnitude(camera.positionWC);
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
    const hidden = !viewer.useDefaultRenderLoop || document.body.classList.contains('lookup') || camHeight() > 2.5e8;
    this.canvas.style.visibility = hidden ? 'hidden' : 'visible'; if (hidden) return;
    // the camera moved: old streaks no longer line up with the globe
    const c = camera.positionWC, d = camera.directionWC, key = [c.x, c.y, c.z, d.x, d.y, d.z], moved = !this.last || key.some((v, i) => Math.abs(v - this.last[i]) > 1e-6 * (i < 3 ? R : 1)); this.last = key;
    if (moved) { ctx.clearRect(0, 0, W, H); for (const p of this.parts) p.px = NaN; }
    else { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = PHONE ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.07)'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
    const k = Math.max(0.04, Math.min(1, camHeight() / 2.0e7)) * 0.9 / 111e3 * 900 * (PHONE ? 2 : 1), s = [0, 0], buckets = COLORS.map(() => []);   // degrees per m/s per frame
    // our own world -> screen: one view-projection matrix per frame, then four multiplies a particle (Cesium's
    // worldToWindowCoordinates costs ~15% of a phone's main thread at 900 particles)
    const M = C.Matrix4.multiply(camera.frustum.projectionMatrix, camera.viewMatrix, VP), cw = this.canvas.clientWidth || innerWidth, ch = this.canvas.clientHeight || innerHeight;
    const hor = R + 0.07 * this.camDist, cx = c.x, cy = c.y, cz = c.z, two = !!(this.cmpModel && this.cmp), cut = this.split * cw * dpr;
    for (const p of this.parts) {
      this.windAt(p.lon, p.lat, s, two && p.px >= cut ? 'cmp' : 'main'); const speed = Math.hypot(s[0], s[1]);   // side by side: the model on the streak's side
      p.lon += s[0] * k / Math.max(0.2, Math.cos(p.lat * Math.PI / 180)); p.lat += s[1] * k; p.age++;
      if (p.age > p.life || p.lat > 84 || p.lat < -84) { this.spawn(p); continue; }
      if (p.lon > 180) p.lon -= 360; else if (p.lon < -180) p.lon += 360;
      const la = p.lat * RAD, lo = p.lon * RAD, sl = Math.sin(la), cl = Math.cos(la), ux = cl * Math.cos(lo), uy = cl * Math.sin(lo);
      if (ux * cx + uy * cy + sl * cz < hor) { p.px = NaN; continue; }   // behind the horizon
      const n = R / Math.sqrt(1 - E2 * sl * sl), X = n * ux, Y = n * uy, Z = n * (1 - E2) * sl;
      const w = M[3] * X + M[7] * Y + M[11] * Z + M[15]; if (w <= 0) { p.px = NaN; continue; }
      const nx = (M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w, ny = (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w;
      if (nx < -1.2 || nx > 1.2 || ny < -1.2 || ny > 1.2) { p.px = NaN; continue; }
      const x = (nx * 0.5 + 0.5) * cw * dpr, y = (0.5 - ny * 0.5) * ch * dpr;
      if (!Number.isNaN(p.px) && Math.abs(x - p.px) < 80 && Math.abs(y - p.py) < 80) { let b = 0; while (b < EDGES.length && speed > EDGES[b]) b++; buckets[b].push(p.px, p.py, x, y); }
      p.px = x; p.py = y;
    }
    ctx.lineWidth = Math.max(1.3 * dpr, 1.1); ctx.lineCap = 'round';
    buckets.forEach((seg, b) => { if (!seg.length) return; ctx.strokeStyle = COLORS[b]; ctx.globalAlpha = 0.85; ctx.beginPath(); for (let i = 0; i < seg.length; i += 4) { ctx.moveTo(seg[i], seg[i + 1]); ctx.lineTo(seg[i + 2], seg[i + 3]); } ctx.stroke(); });
    ctx.globalAlpha = 1;
  },
};

// side by side, the H and L labels follow the camera to stay on their model's side
viewer.scene.postRender.addEventListener(() => {
  if (!Wind.cmpModel || !(Wind.centres.main?.show || Wind.centres.cmp?.show)) return;
  const c = camera.positionWC, d = camera.directionWC, k = `${c.x.toFixed(0)},${c.y.toFixed(0)},${c.z.toFixed(0)},${d.x.toFixed(4)},${d.y.toFixed(4)},${Wind.split}`;
  if (k !== Wind.camKey) { Wind.camKey = k; Wind.sideCentres(); }
});

// ---- colours (and the legend drawn from the same stops)
const STOPS = [[-40, [120, 60, 200]], [-20, [70, 100, 240]], [0, [40, 190, 250]], [10, [40, 210, 140]], [20, [255, 230, 60]], [30, [255, 130, 40]], [40, [220, 30, 30]]];
function ramp(t) {   // degrees C to colour
  if (!Number.isFinite(t)) return [0, 0, 0];
  if (t <= STOPS[0][0]) return STOPS[0][1]; if (t >= STOPS[STOPS.length - 1][0]) return STOPS[STOPS.length - 1][1];
  let i = 1; while (t > STOPS[i][0]) i++; const [t0, a] = STOPS[i - 1], [t1, b] = STOPS[i], f = (t - t0) / (t1 - t0);
  return a.map((v, j) => Math.round(v + (b[j] - v) * f));
}
/** Cloud cover (%) → white, see-through where it is thin. */
function cloudColour(pc) {
  const a = Number.isFinite(pc) ? Math.max(0, Math.min(1, (pc - 12) / 88)) : 0;
  const g = Math.round(205 + 50 * a);
  return [g, g, Math.min(255, g + 6), Math.round(Math.pow(a, 1.15) * 225)];
}
/** Linear steps through RGBA stops; below the first: clear (or the first, with `hold`). */
function stepped(stops, v, log = false) {
  if (!(v >= stops[0][0])) return [0, 0, 0, 0];
  if (v >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  let i = 1; while (v > stops[i][0]) i++;
  const [m0, a] = stops[i - 1], [m1, b] = stops[i], f = log ? Math.log(v / m0) / Math.log(m1 / m0) : (v - m0) / (m1 - m0);
  return a.map((x, j) => Math.round(x + (b[j] - x) * f));
}
const RAIN = [[0.1, [127, 214, 255, 70]], [1, [62, 224, 143, 150]], [4, [255, 224, 102, 185]], [10, [255, 159, 67, 205]], [25, [255, 77, 94, 220]]];
/** Rain rate (mm/h) → the usual radar colours, see-through when light, nothing under 0.1 mm/h. */
const rainColour = mm => stepped(RAIN, mm, true);
const GUST = [[8, [255, 245, 170, 0]], [12, [255, 236, 120, 120]], [17, [255, 176, 64, 175]], [24, [255, 90, 70, 205]], [32, [220, 40, 150, 220]], [42, [150, 60, 230, 230]]];
/** Gusts (m/s) → clear when light, yellow (strong breeze) through red (gale) to purple (hurricane force). */
const gustColour = v => stepped(GUST, v);
const WAVE = [[0, [40, 80, 160, 40]], [0.5, [40, 120, 210, 120]], [1.25, [40, 180, 220, 160]], [2.5, [70, 210, 150, 185]], [4, [240, 220, 80, 200]], [6, [250, 140, 50, 210]], [9, [230, 50, 60, 220]], [14, [180, 40, 170, 230]]];
/** Significant wave height (m) → blues for slight seas to red and purple for high and phenomenal ones; land clear. */
const waveColour = m => Number.isFinite(m) ? stepped(WAVE, Math.max(0, m)) : [0, 0, 0, 0];

/**
 * The legend for a layer: { title, gradient (a CSS linear-gradient), ticks: [[percent, label]] } in metric, or with
 * `imperial` in °F, mph and feet. Pressure has no colours: a line about the isobars instead.
 */
export function legendFor(kind, imperial = false) {
  const css = (stops, a = 1) => `linear-gradient(90deg,${stops.map(([v, c], i) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255 * a + (1 - a)}) ${(i / (stops.length - 1) * 100).toFixed(1)}%`).join(',')})`;
  const ticks = (stops, f) => stops.map(([v], i) => [i / (stops.length - 1) * 100, f(v)]);
  const mph = v => Math.round(v * 2.23694), kmh = v => Math.round(v * 3.6);
  switch (kind) {
    case 'temp': return { title: imperial ? 'Temperature °F' : 'Temperature °C', gradient: css(STOPS.map(([v, c]) => [v, [...c, 255]])), ticks: ticks(STOPS, v => imperial ? Math.round(v * 9 / 5 + 32) : v) };
    case 'gust': return { title: imperial ? 'Gusts, mph' : 'Gusts, km/h', gradient: css(GUST, 0.6), ticks: ticks(GUST, imperial ? mph : kmh) };
    case 'wave': return { title: imperial ? 'Waves, feet (darts: where they run)' : 'Waves, metres (darts: where they run)', gradient: css(WAVE, 0.6), ticks: ticks(WAVE, v => imperial ? Math.round(v * 3.28084) : v) };
    case 'rain': return { title: 'Rain, mm/h', gradient: css(RAIN, 0.6), ticks: ticks(RAIN, v => v) };
    case 'wind': return { title: imperial ? 'Wind streaks, mph' : 'Wind streaks, km/h', gradient: `linear-gradient(90deg,${COLORS.map((c, i) => `${c} ${(i / (COLORS.length - 1) * 100).toFixed(1)}%`).join(',')})`,
      ticks: [0, ...EDGES].map((v, i) => [i / EDGES.length * 100, imperial ? mph(v) : kmh(v)]) };
    case 'pres': return { title: 'Pressure: isobars every 4 hPa, heavier every 20; H high, L low', gradient: null, ticks: [] };
    default: return null;
  }
}
