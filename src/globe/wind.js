// Wind, temperature, cloud and rain for weather mode, at any moment of the weather timeline. The source is NOAA's GFS
// model (model.js: 1° grid, every 3 h out to +5 days, read from its files on AWS), blended between the forecast hours
// either side of the moment. If GFS can't be reached, wind and temperature fall back to a snapshot of now: Open-Meteo on
// a 10° grid (the site's scheduled build mirrors it as data/wind.json; else the browser asks Open-Meteo itself).
// Wind is drawn as moving streaks on a canvas laid over the globe (each particle is advected through the field and
// projected with the camera); temperature, cloud and rain are colour washes, one image per moment, laid on the globe.
import { C, store, PHONE } from './env.js';
import { viewer, camera, camHeight } from './viewer.js';
import { fetchAsset } from '../core/assets.js';
import { sampleGrid } from '../core/grib2.js';
import { Model } from './model.js';

const LATS = [], LONS = [];
for (let la = -80; la <= 80; la += 10) LATS.push(la);
for (let lo = -180; lo < 180; lo += 10) LONS.push(lo);
const NX = LONS.length, NY = LATS.length, COUNT = PHONE ? 900 : 3800;
const CHUNK = 306, TTL = 30 * 60e3, MIRROR_MAX = 7 * 3600e3, KEY = 'wx.grid.v1';
const R = 6378137, E2 = 0.00669437999014, RAD = Math.PI / 180, VP = new C.Matrix4();
const COLORS = ['#7fe8ff', '#b6f5ff', '#ffffff', '#fff3a8', '#ffc46b', '#ff7a5c'];   // calm to gale
const EDGES = [3, 6, 10, 15, 22];   // m/s between the colours
const GFS_CREDIT = new C.Credit('Wind, temperature, cloud and rain: NOAA GFS model'), OM_CREDIT = new C.Credit('Wind and temperature: Open-Meteo.com (CC BY 4.0)');
const WASH_ALPHA = { temp: 0.6, cloud: 1, rain: 1 };

export const Wind = {
  grid: null, loading: null, canvas: null, ctx: null, parts: [], raf: 0, windOn: false,
  cur: null,        // the model at the moment shown: { a, b, w, h0, h1, run } (model.js), or null (snapshot only)
  t: 0,             // that moment (ms)
  washes: {},       // kind → { layer, key, on }
  images: new Map(),   // `${kind}|${h0}|${h1}|${w}` → data URL (going back and forth costs nothing)

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
  /** Load what `kinds` ('wind', 'temp', 'cloud', 'rain') need for moment t, then redraw what is showing. Resolves to
   *  true with the model, false on the snapshot (GFS unreachable: wind and temperature of now only). */
  async moment(t, kinds) {
    this.t = t;
    try {
      const cur = await Model.at(t, kinds);
      if (this.t !== t) return true;   // a later moment was asked for meanwhile
      this.cur = cur;
    } catch (e) {
      console.warn('weather model', e.message);
      if (this.t !== t) return false;
      this.cur = null; await this.load();
    }
    this.redraw();
    return !!this.cur;
  },
  /** A field's value at a point, blended in time: 'temp' °C, 'cloud' %, 'rain' mm/h, or NaN when not loaded. */
  value(kind, lat, lon) {
    const c = this.cur;
    if (!c || !c.a[kind]) { if (!c && kind === 'temp' && this.grid) return this.snapAt(lon, lat, [0, 0, 0])[2]; return NaN; }
    const a = sampleGrid(c.a[kind], lat, lon), v = c.w ? a + (sampleGrid(c.b[kind], lat, lon) - a) * c.w : a;
    return kind === 'temp' ? v - 273.15 : kind === 'rain' ? Math.max(0, v * 3600) : v;
  },
  /** Wind at a point, blended in time: out = [u, v] (m/s east, north). */
  windAt(lon, lat, out) {
    const c = this.cur;
    if (c && c.a.wind) {
      const A = c.a.wind, B = c.b.wind, ua = sampleGrid(A.u, lat, lon), va = sampleGrid(A.v, lat, lon);
      if (c.w && B !== A) { out[0] = ua + (sampleGrid(B.u, lat, lon) - ua) * c.w; out[1] = va + (sampleGrid(B.v, lat, lon) - va) * c.w; } else { out[0] = ua; out[1] = va; }
      return out;
    }
    if (this.grid) { this.snapAt(lon, lat, out); return out; }
    out[0] = out[1] = 0; return out;
  },
  /** What the weather is at a point at the moment shown: { temp °C, speed m/s, u, v, cloud %, rain mm/h, source, t }, or null. */
  reading(lat, lon) {
    if (!this.cur && !this.grid) return null;
    const w = this.cur && !this.cur.a.wind ? [NaN, NaN] : this.windAt(lon, lat, [0, 0]);   // the model without its wind: none, not the snapshot's
    return { temp: this.value('temp', lat, lon), u: w[0], v: w[1], speed: Math.hypot(w[0], w[1]), cloud: this.value('cloud', lat, lon), rain: this.value('rain', lat, lon),
      source: this.cur ? 'NOAA GFS' : 'Open-Meteo', t: this.cur ? this.t : this.grid?.t };
  },
  /** Words for the panel: which run, or the snapshot's time. */
  note() {
    if (this.cur) { const r = this.cur.run; return `NOAA GFS, the ${r.hour}:00 UTC run of ${r.date.slice(6, 8)}/${r.date.slice(4, 6)}`; }
    return this.grid ? `Open-Meteo, ${String(this.grid.at || '').slice(11)} UTC` : '';
  },

  // ---- colour washes (temperature, cloud, rain)
  async setWash(kind, on) {
    const wsh = this.washes[kind] || (this.washes[kind] = { layer: null, key: '', on: false });
    wsh.on = on;
    if (!on) { if (wsh.layer) wsh.layer.show = false; viewer.scene.requestRender(); return; }
    await this.drawWash(kind);
  },
  setTemp(on) { return this.setWash('temp', on); },
  redraw() { for (const [kind, w] of Object.entries(this.washes)) if (w.on) this.drawWash(kind).catch(e => console.warn('wash', kind, e.message)); },
  async drawWash(kind) {
    const wsh = this.washes[kind]; if (!wsh || !wsh.on) return;
    const c = this.cur;
    if (!c && kind !== 'temp') { if (wsh.layer) wsh.layer.show = false; return; }   // the snapshot has no cloud or rain
    if (c && !c.a[kind]) return;   // not loaded for this moment yet: moment() redraws when it is
    if (!c && !this.grid) await this.load();
    const key = c ? `${kind}|${c.run.t}|${c.h0}|${c.h1}|${c.w.toFixed(2)}` : `${kind}|snap|${this.grid.t}`;
    if (wsh.key !== key || !wsh.layer) {
      let url = this.images.get(key);
      if (!url) { url = this.paint(kind); this.images.set(key, url); if (this.images.size > 40) this.images.delete(this.images.keys().next().value); }
      const p = await C.SingleTileImageryProvider.fromUrl(url, { rectangle: C.Rectangle.fromDegrees(-180, -90, 180, 90), credit: c ? GFS_CREDIT : OM_CREDIT });
      if (!wsh.on) return;
      const old = wsh.layer;
      wsh.layer = viewer.imageryLayers.addImageryProvider(p); wsh.layer.alpha = WASH_ALPHA[kind]; wsh.key = key;
      if (old) setTimeout(() => viewer.imageryLayers.remove(old, true), 400);   // the new one's tile arrives first: no blink
    }
    wsh.layer.show = true; viewer.imageryLayers.raiseToTop(wsh.layer); viewer.scene.requestRender();
  },
  /** One wash as an image: 1° pixels, longitudes -180..180, latitudes 90..-90. */
  paint(kind) {
    const cv = document.createElement('canvas'); cv.width = 360; cv.height = 180;
    const cx = cv.getContext('2d'), img = cx.createImageData(360, 180), d = img.data, o = [0, 0, 0];
    for (let y = 0; y < 180; y++) for (let x = 0; x < 360; x++) {
      const lon = x - 180 + 0.5, lat = 90 - y - 0.5, i = (y * 360 + x) * 4;
      const v = this.cur ? this.value(kind, lat, lon) : this.snapAt(lon, lat, o)[2];
      const [r, g, b, a] = kind === 'temp' ? [...ramp(v), 255] : kind === 'cloud' ? cloudColour(v) : rainColour(v);
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
    cx.putImageData(img, 0, 0);
    return cv.toDataURL();
  },
  dropWashes() { for (const w of Object.values(this.washes)) if (w.layer) viewer.imageryLayers.remove(w.layer, true); this.washes = {}; },
  dropTemp() { this.dropWashes(); },

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
    const hor = R + 0.07 * this.camDist, cx = c.x, cy = c.y, cz = c.z;
    for (const p of this.parts) {
      this.windAt(p.lon, p.lat, s); const speed = Math.hypot(s[0], s[1]);
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
const RAIN = [[0.1, [127, 214, 255, 70]], [1, [62, 224, 143, 150]], [4, [255, 224, 102, 185]], [10, [255, 159, 67, 205]], [25, [255, 77, 94, 220]]];
/** Rain rate (mm/h) → the usual radar colours, see-through when light, nothing under 0.1 mm/h. */
function rainColour(mm) {
  if (!(mm >= RAIN[0][0])) return [0, 0, 0, 0];
  if (mm >= RAIN[RAIN.length - 1][0]) return RAIN[RAIN.length - 1][1];
  let i = 1; while (mm > RAIN[i][0]) i++;
  const [m0, a] = RAIN[i - 1], [m1, b] = RAIN[i], f = Math.log(mm / m0) / Math.log(m1 / m0);
  return a.map((v, j) => Math.round(v + (b[j] - v) * f));
}
