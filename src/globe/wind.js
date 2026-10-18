// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Wind, temperature, cloud, rain, gusts, waves and pressure for weather mode, at any moment of the weather timeline. The
// source is a weather model (model.js: NOAA GFS or ECMWF IFS, read from their files on AWS), blended between the forecast
// hours either side of the moment; with a second model chosen, the two are shown side by side, split where the slider
// is (every wash is two imagery layers, one each side of scene.splitPosition, and each wind streak follows the model on
// its side). If no model can be reached, wind and temperature fall back to a snapshot of now: Open-Meteo on a 10° grid
// (the site's scheduled build mirrors it as data/wind.json; else the browser asks Open-Meteo itself), but only for an
// observed frame within an hour of the snapshot's own time (core/wxmodels.js snapFits): a forecast frame the model can't
// give shows nothing and says so, never "now" under a label days ahead.
// Wind is drawn as moving streaks on a canvas laid over the globe (each particle is advected through the field and
// projected with the camera); temperature, cloud, rain, gusts and waves are colour washes, one image per moment, laid
// on the globe; pressure is isobars every 4 hPa (core/contour.js) drawn into a clear image, with H and L labels on the
// centres.
import { C, store, PHONE } from './env.js';
import { viewer, camera, camHeight } from './viewer.js';
import { fetchAsset } from '../core/assets.js';
import { momentOf, momentValue, momentWind, momentReading } from '../core/wxload.js';
import { WIND_COLORS as COLORS, WASH_ALPHA, paintWash, windBucket, waveDarts, pressureChart } from '../core/wxpaint.js';
import { runWords, snapFits, clockWords } from '../core/wxmodels.js';
import { Model } from './model.js';

const LATS = [], LONS = [];
for (let la = -80; la <= 80; la += 10) LATS.push(la);
for (let lo = -180; lo < 180; lo += 10) LONS.push(lo);
const NX = LONS.length, NY = LATS.length, COUNT = PHONE ? 900 : 3800;
const CHUNK = 306, TTL = 30 * 60e3, MIRROR_MAX = 7 * 3600e3, KEY = 'wx.grid.v1';
const R = 6378137, E2 = 0.00669437999014, RAD = Math.PI / 180, VP = new C.Matrix4();
const OM_CREDIT = new C.Credit('Wind and temperature: Open-Meteo.com (CC BY 4.0)');
const CREDITS = {};
/** The credit line for a model's field: the waves of GFS come from a different model. */
function creditFor(def, kind) {
  const text = def.id === 'gfs' ? (kind === 'wave' ? 'Waves: NOAA WAVEWATCH III (GFS-Wave)' : 'Weather: NOAA GFS model') : 'Weather: ECMWF IFS open data (CC BY 4.0)';
  return CREDITS[text] ||= new C.Credit(text);
}
const SIDES = ['main', 'cmp'];
const HI = !PHONE;   // detailed images (waves, isobars) at desktop size
const KEEP_IMAGES = 12;   // washes kept as images; dropped when weather closes (a loop of 46 frames never fits anyway)

export const Wind = {
  grid: null, loading: null, tried: 0, canvas: null, ctx: null, parts: [], raf: 0, windOn: false,
  model: Model,     // the model shown (model.js Models.*)
  cmpModel: null,   // a second model, side by side, or null
  cur: null,        // the model at the moment shown: { a, b, w, h0, h1, run, model } (model.js), or null (snapshot only)
  cmp: null,        // the second model at that moment
  split: 0.5,       // where the two meet, as a fraction of the width
  t: 0,             // that moment (ms)
  fcst: false,      // is it a forecast frame? (the snapshot of now never stands in for one)
  missed: false,    // the model was asked for this moment and could not give it
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
  /** The snapshot, when it may stand in for the moment shown (an observed frame near its time), else null. */
  snap() { return snapFits(this.grid, this.t, this.fcst) ? this.grid : null; },

  // ---- the snapshot (fallback): Open-Meteo, now only
  async load() {
    if (this.grid && snapFits(this.grid, Date.now())) return this.grid;
    if (this.loading) return this.loading;
    if (this.grid && Date.now() - this.tried < TTL) return this.grid;   // asked lately and nothing newer came: no new burst of 612 points
    this.tried = Date.now();
    this.loading = (async () => {
      // a snapshot stands in only within an hour of its own time (snapFits), so a copy older than that is no use near now:
      // the site's mirror is rebuilt every 6 h, so for most of each cycle it is too old and Open-Meteo is asked instead
      const ok = g => !!(g && g.u && g.u.length === NX * NY), fits = g => ok(g) && snapFits(g, Date.now());
      const c = store.get(KEY, null);
      if (fits(c) && Date.now() - c.t < TTL) return (this.grid = c);
      // the site's scheduled build keeps a copy (data/wind.json, up to 6 h old): no quota spent, one small file
      const mirror = await fetchAsset('data/wind.json', 'json').catch(() => null);
      if (fits(mirror) && Date.now() - mirror.t < MIRROR_MAX) { store.set(KEY, mirror); return (this.grid = mirror); }
      try { return (this.grid = await this.live()); }
      catch (e) {   // the newest of what we have (it draws nothing unless it fits the moment, and the note says so)
        const old = [mirror, c, this.grid].filter(ok).sort((a, b) => b.t - a.t)[0];
        if (old) return (this.grid = old);
        throw e;
      }
    })().finally(() => { this.loading = null; });
    return this.loading;
  },
  async live() {   // straight from Open-Meteo: 612 locations (it limits visitors per hour), used only when the site's copy is missing or more than an hour off now
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
   *  and the one beside it, then redraw what is showing. Resolves to true with the model, false without it (then wind
   *  and temperature of now on an observed frame near now, nothing on a forecast frame: `fcst`). */
  async moment(t, kinds, fcst = false) {
    this.t = t; this.fcst = !!fcst;
    const main = this.model, other = this.cmpModel;
    // a model whose run was found but whose fields failed is usually S3 throttling a burst: tried twice more (core/wxload.js)
    const get = m => momentOf(m, t, kinds, { still: () => this.t === t });
    const [cur, cmp] = await Promise.all([get(main), other ? get(other) : null]);
    if (this.t !== t || this.model !== main) return !!cur;   // a later moment (or another model) was asked for meanwhile
    this.cur = cur; this.cmp = this.cmpModel === other ? cmp : null; this.missed = !cur;
    if (!cur && snapFits({ t: Date.now() }, t, fcst)) await this.load();   // the snapshot is of now: worth loading only for a moment near now
    this.redraw();
    return !!this.cur;
  },
  /** A field's value at a point, blended in time: 'temp' °C, 'cloud' %, 'rain' mm/h, 'pres' hPa, 'gust' m/s, 'wave' m,
   *  'wavedir' degrees (where the waves come from), or NaN when not loaded (or over land, for waves). */
  value(kind, lat, lon, side = 'main') {
    const c = this.data(side);
    if (!c && side === 'main' && kind === 'temp' && this.snap()) return this.snapAt(lon, lat, [0, 0, 0])[2];
    return momentValue(c, kind, lat, lon);
  },
  /** Wind at a point, blended in time: out = [u, v] (m/s east, north). */
  windAt(lon, lat, out, side = 'main') {
    const c = side === 'cmp' ? this.cmp : this.cur;
    if (c && c.a.wind) return momentWind(c, lat, lon, out);
    if (side === 'main' && !c && this.snap()) { this.snapAt(lon, lat, out); return out; }
    out[0] = out[1] = 0; return out;
  },
  /** What the weather is at a point at the moment shown: { temp °C, speed m/s, u, v, cloud %, rain mm/h, gust m/s,
   *  pres hPa, presTrend (hPa over the 3 h step), wave m, waveFrom °, source, run, t }, or null. */
  reading(lat, lon, side = 'main') {
    const c = this.data(side);
    if (!c && (side === 'cmp' || !this.snap())) return null;
    const src = { source: c ? c.model.def.name : 'Open-Meteo', model: c ? c.model.id : null, run: c ? c.run : null, t: c ? this.t : this.grid.t, fcst: !!c && this.fcst };
    if (c) return { ...momentReading(c, lat, lon), ...src };   // core/wxload.js (the model without its wind: none, not the snapshot's)
    const w = this.windAt(lon, lat, [0, 0], side);
    return { ...momentReading(null, lat, lon), temp: this.value('temp', lat, lon, side), u: w[0], v: w[1], speed: Math.hypot(w[0], w[1]), ...src };
  },
  /** Words for the panel: which run, or the snapshot's time. */
  note(side = 'main') {
    const c = this.data(side);
    if (c) return `${c.model.def.name}, ${runWords(c.run)}`;
    if (side === 'cmp') return this.cmpModel ? `${this.cmpModel.def.name} not reachable` : '';
    if (this.snap()) return `${this.model.def.name} not reachable; wind and temperature: Open-Meteo, now (${clockWords(Date.parse(this.grid.at + 'Z') || this.grid.t)})`;
    return this.missed ? `${this.model.def.name} not reachable for this moment, so nothing is drawn` : '';
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
    if (!c && (kind !== 'temp' || side === 'cmp' || !this.snap())) return hide();   // the snapshot has only temperature (and wind), and only near its time
    if (c && !c.a[kind]) return hide();   // not loaded for this moment: not the last moment's picture under this one's label (moment() redraws when it is)
    const key = c ? `${kind}|${c.model.id}|${c.run.t}|${c.h0}|${c.h1}|${c.w.toFixed(2)}` : `${kind}|snap|${this.grid.t}`;
    let img = this.images.get(key);
    if (!img) { img = this.paint(kind, side); this.images.set(key, img); if (this.images.size > KEEP_IMAGES) this.images.delete(this.images.keys().next().value); }
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
    const cx = cv.getContext('2d'), img = cx.createImageData(360, 180), o = [0, 0, 0], snap = !this.data(side);   // drawSide lets the snapshot through only when snap() allows it
    paintWash(kind, img.data, 360, 180, (x, y) => { const lon = x - 180 + 0.5, lat = 90 - y - 0.5; return snap ? this.snapAt(lon, lat, o)[2] : this.value(kind, lat, lon, side); });
    cx.putImageData(img, 0, 0);
    return { url: cv.toDataURL() };
  },
  /** Wave height in colour (0.5°), and which way the waves run: a short dart every few degrees of open sea. */
  paintWaves(side) {
    const n = HI ? 720 : 360, W = n * 2, Hh = n, s = 360 / n;
    const small = document.createElement('canvas'); small.width = n; small.height = n / 2;
    const sx = small.getContext('2d'), img = sx.createImageData(n, n / 2);
    paintWash('wave', img.data, n, n / 2, (x, y) => this.value('wave', 90 - (y + 0.5) * s, -180 + (x + 0.5) * s, side));
    sx.putImageData(img, 0, 0);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = true; cx.drawImage(small, 0, 0, W, Hh);
    const step = HI ? 4 : 7, px = W / 360, len = HI ? 6 : 5;
    cx.strokeStyle = 'rgba(255,255,255,0.7)'; cx.lineWidth = 1; cx.lineCap = 'round'; cx.beginPath();
    for (const { lat, lon, to, h } of waveDarts((k, la, lo) => this.value(k, la, lo, side), { step })) {
      const go = to * RAD, cl = Math.max(0.2, Math.cos(lat * RAD));
      let dx = Math.sin(go) / cl, dy = -Math.cos(go); const m = Math.hypot(dx, dy); dx /= m; dy /= m;   // on the globe the image is squeezed east-west by cos(lat)
      const x = (lon + 180) * px, y = (90 - lat) * px, l = len * Math.min(1.4, 0.7 + h / 6);
      const x0 = x - dx * l / 2, y0 = y - dy * l / 2, x1 = x + dx * l / 2, y1 = y + dy * l / 2;
      cx.moveTo(x0, y0); cx.lineTo(x1, y1);
      cx.moveTo(x1, y1); cx.lineTo(x1 - (dx * 0.9 - dy * 0.5) * l * 0.4, y1 - (dy * 0.9 + dx * 0.5) * l * 0.4);
      cx.moveTo(x1, y1); cx.lineTo(x1 - (dx * 0.9 + dy * 0.5) * l * 0.4, y1 - (dy * 0.9 - dx * 0.5) * l * 0.4);
    }
    cx.stroke();
    return cv.toDataURL();
  },
  /** Isobars every 4 hPa (heavier every 20) with their values, on a clear image; plus the highs and lows. */
  paintPressure(side) {
    const c = this.data(side), chart = pressureChart(c.a.pres, c.b.pres, c.w, { maxCentres: PHONE ? 16 : 32 });   // core/wxpaint.js
    const W = HI ? 2048 : 1024, Hh = W / 2, px = W / 360;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; const cx = cv.getContext('2d');
    const X = lon => ((lon + 180) % 360 + 360) % 360 * px, Y = lat => (90 - lat) * px;
    cx.lineJoin = 'round'; cx.lineCap = 'round';
    for (const { bold, lines: ls } of chart.lines) {
      cx.strokeStyle = bold ? 'rgba(255,255,255,0.95)' : 'rgba(235,242,255,0.72)'; cx.lineWidth = (bold ? 2.2 : 1.3) * (HI ? 1 : 0.8);
      cx.beginPath();
      for (const line of ls) {
        let px0 = NaN;
        for (const [lon, lat] of line) { const x = X(lon), y = Y(lat); if (Number.isNaN(px0) || Math.abs(x - px0) > W / 2) cx.moveTo(x, y); else cx.lineTo(x, y); px0 = x; }
      }
      cx.stroke();
    }
    const centres = chart.centres;
    cx.font = `600 ${HI ? 15 : 11}px system-ui, sans-serif`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.lineWidth = HI ? 3.2 : 2.4;
    cx.strokeStyle = 'rgba(8,14,26,0.85)'; cx.fillStyle = '#ffffff';
    for (const { lon, lat, text } of chart.labels) { const x = X(lon), y = Y(lat); cx.strokeText(text, x, y); cx.fillText(text, x, y); }
    return { url: cv.toDataURL(), centres };
  },
  dropWashes() {
    for (const w of Object.values(this.washes)) for (const s of SIDES) if (w[s].layer) viewer.imageryLayers.remove(w[s].layer, true);
    this.washes = {}; this.hideCentres();
    this.images.clear();   // tens of MB of data: URLs (2048 px isobars), and of a run the next open may not use
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
    if (!this.cur?.a.wind && !this.cmp?.a.wind && !this.snap()) { ctx.clearRect(0, 0, W, H); this.last = null; return; }   // no wind for this moment: no streaks, not dots of "calm"
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
      if (!Number.isNaN(p.px) && Math.abs(x - p.px) < 80 && Math.abs(y - p.py) < 80) buckets[windBucket(speed)].push(p.px, p.py, x, y);
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

// the legend's colours come from the same stops as the washes (core/wxpaint.js)
export { legendFor } from '../core/wxpaint.js';
