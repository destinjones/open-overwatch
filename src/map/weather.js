// Forecast weather on the 2D map, from the same models and the same code as the globe's weather mode: NOAA's GFS (with
// WAVEWATCH III waves) or ECMWF's IFS, read straight from their open buckets by byte range (core/wxload.js, decoded in
// core/model.worker.js; the browser's cache of those files is shared with the globe), blended between the forecast
// hours either side of the moment, and drawn the globe's way (core/wxpaint.js): wind as moving streaks, temperature,
// cloud, rain, gusts and waves as colour washes, pressure as isobars every 4 hPa with highs and lows. Washes and isobars
// are Leaflet grid layers painted tile by tile in Web Mercator, so they pan, zoom and wrap like the base map; the
// streaks run on a canvas of their own. A timeline bar under the map (while any of these layers is on) moves the moment
// from now to +5 days (+3 on phones), plays it, switches model, explains the colours and reads every field at the
// pointer. Nothing is fetched until a layer is switched on.
import { $, Store, PHONE, esc, throttle, debounce, late } from './util.js';
import { map } from './mapview.js';
import { Layers, feed, runFeed } from './engine.js';
import { makeModels, momentOf, momentValue, momentWind, momentReading } from '../core/wxload.js';
import { WASH_ALPHA, WIND_COLORS, paintWash, waveDarts, pressureChart, splitJumps, windBucket, legendFor } from '../core/wxpaint.js';
import { runWords } from '../core/wxmodels.js';
import { windFrom, compass } from '../core/gfs.js';

const SMALL = PHONE.matches, H = 3600e3, RAD = Math.PI / 180;
export const MAX_H = SMALL ? 72 : 120;
/** The models, as the globe has them (same cache names, so a forecast hour the globe fetched costs nothing here). */
export const Models = makeModels({ maxH: MAX_H, keep: SMALL ? 6 : 12, res: SMALL ? 1 : 0.5 });
const IMPERIAL = /^en-(us|lr)$|^my\b/i.test(navigator.language || '');
/** The 2D map's layer ids → the model field each draws (the order is the legend's). */
export const KINDS = { wx_wind: 'wind', wx_temp: 'temp', wx_pres: 'pres', wx_gust: 'gust', wx_cloud: 'cloud', wx_rain: 'rain', wx_wave: 'wave' };
const CREDIT = { gfs: 'Forecast: NOAA GFS (waves: WAVEWATCH III)', ecmwf: 'Forecast: ECMWF IFS open data (CC BY 4.0)' };

// Web Mercator, as Leaflet's EPSG:3857 does it, in world pixels at zoom z
const worldPx = z => 256 * 2 ** z;
const lonAt = (x, z) => x / worldPx(z) * 360 - 180;
const latAt = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / worldPx(z)))) / RAD;
const xAt = (lon, z) => (lon + 180) / 360 * worldPx(z);
const yAt = (lat, z) => { const s = Math.sin(Math.max(-85.06, Math.min(85.06, lat)) * RAD); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx(z); };

map.createPane('wxWash').style.zIndex = 330;   // over the base map and the satellite / radar tiles, under vectors and glyphs
map.createPane('wxTop').style.zIndex = 390;
for (const p of ['wxWash', 'wxTop']) map.getPane(p).style.pointerEvents = 'none';

/* ============================================================ the moment */
export const Wx = {
  modelId: (id => id in Models ? id : 'gfs')(Store.get('wx.model', 'gfs')),
  get model() { return Models[this.modelId]; },
  t0: Math.floor(Date.now() / H) * H,   // the timeline starts at the current hour
  h: 0,                                  // hours ahead of t0 shown
  cur: null,                             // the moment shown: { a, b, w, h0, h1, run, model } (core/wxload.js)
  key: '', loading: null, playing: false, timer: 0, checked: 0, charts: new Map(),
  t() { return this.t0 + this.h * H; },
  /** The fields the switched-on layers need. */
  kinds() { return Object.entries(KINDS).filter(([id]) => Layers.on(id)).map(([, k]) => k); },
  any() { return Object.keys(KINDS).some(id => Layers.on(id)); },
  /** The moment with every field the layers on need (one load shared by all of them; a newer request wins). */
  load() {
    const kinds = this.kinds(), t = this.t(), model = this.model, key = `${model.id}|${t}|${kinds.join(',')}`;
    if (this.key === key && this.loading) return this.loading;
    this.key = key;
    this.loading = (async () => {
      if (Date.now() - this.checked > 20 * 60e3) { this.checked = Date.now(); if (await model.refresh().catch(() => false)) this.t0 = Math.floor(Date.now() / H) * H; }   // a newer run is out
      const c = await momentOf(model, t, kinds, { still: () => this.key === key });
      if (this.key !== key) return this.cur;   // a later moment was asked for meanwhile
      if (!c) throw new Error(`${model.def.short} is not reachable right now`);
      this.cur = c; this.charts.clear(); this.repaint();
      return c;
    })();
    this.loading.catch(() => { if (this.key === key) this.key = ''; });   // the next try fetches again
    return this.loading;
  },
  /** Every switched-on layer reloads (its feed shows loading / ok / the error). */
  reload() { for (const id of Object.keys(KINDS)) { const d = Layers.byId[id]; if (d && d.on && d.feed) runFeed(d.feed, true); } },
  reloadSoon: debounce(() => Wx.reload(), 160),
  setHour(h) { this.h = Math.max(0, Math.min(MAX_H, h)); Bar.label(); this.reloadSoon(); },
  setModel(id) {
    if (!(id in Models) || id === this.modelId) return;
    this.modelId = id; Store.set('wx.model', id); this.cur = null; this.charts.clear(); this.key = '';
    credit(); this.repaint(); this.reload();
  },
  repaint() {
    for (const [kind, l] of Object.entries(washes)) if (l._map) l.redraw();
    if (isobars._map) isobars.redraw();
    streaks.fresh();
    Bar.label(); Bar.legend(); Bar.read();
  },
  /** The isobar chart of the moment, with value labels spaced for zoom z (cached per moment). */
  chart(z) {
    const c = this.cur; if (!c || !c.a.pres) return null;
    const spacing = Math.max(6, 40 / 2 ** Math.max(0, Math.floor(z) - 3));
    let ch = this.charts.get(spacing);
    if (!ch) {
      ch = pressureChart(c.a.pres, c.b.pres, c.w, { maxCentres: SMALL ? 16 : 32, spacing, minLen: Math.min(12, spacing / 2) });
      // flat-map pieces: longitudes into -180..180, cut where a line crosses the date line; each with its box
      ch.pieces = [];
      for (const { bold, lines } of ch.lines) for (const line of lines) for (const p of splitJumps(line.map(([lo, la]) => [((lo + 180) % 360 + 360) % 360 - 180, la]))) {
        let w = 180, e = -180, s = 90, n = -90; for (const [lo, la] of p) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la; }
        ch.pieces.push({ bold, p, w, e, s, n });
      }
      for (const l of ch.labels) l.lon = ((l.lon + 180) % 360 + 360) % 360 - 180;
      this.charts.set(spacing, ch);
    }
    return ch;
  },
  play(on = !this.playing) {
    this.playing = on; clearInterval(this.timer); Bar.label();
    if (!on) return;
    this.timer = setInterval(() => {
      if (document.hidden) return;
      if (this.loading && this.key && !this.cur) return;
      const next = this.h + 3 > MAX_H ? 0 : Math.floor(this.h / 3) * 3 + 3;
      this.setHour(next); Bar.slider.value = String(next);
      this.model.prefetch(this.t0 + (next + 3) * H, this.kinds());   // the hour after, quietly
    }, SMALL ? 1400 : 1000);
  },
};

/* ============================================================ washes: one grid layer per field, painted per tile */
const WashLayer = L.GridLayer.extend({
  initialize(kind) { L.GridLayer.prototype.initialize.call(this, { pane: 'wxWash', opacity: WASH_ALPHA[kind], tileSize: 256, updateWhenZooming: false, keepBuffer: 1, className: 'wx-' + kind }); this.kind = kind; },
  createTile(coords) {
    const tile = document.createElement('canvas'); tile.width = tile.height = 256;
    const c = Wx.cur, kind = this.kind; if (!c || !c.a[kind]) return tile;
    const ctx = tile.getContext('2d'), img = ctx.createImageData(256, 256), z = coords.z, x0 = coords.x * 256, y0 = coords.y * 256;
    const lat = new Float64Array(256); for (let y = 0; y < 256; y++) lat[y] = latAt(y0 + y + 0.5, z);   // Mercator: latitude by row, longitude by column
    paintWash(kind, img.data, 256, 256, (x, y) => momentValue(c, kind, lat[Math.min(255, Math.round(y))], lonAt(x0 + x + 0.5, z)), z >= 7 ? 4 : 2);
    ctx.putImageData(img, 0, 0);
    if (kind === 'wave') darts(ctx, c, coords);
    return tile;
  },
});
/** Which way the waves run: white darts on open sea, denser as the map zooms in (on a grid fixed to the world). */
function darts(ctx, c, { x, y, z }) {
  const x0 = x * 256, y0 = y * 256, pad = 12, step = z <= 2 ? 6 : z <= 3 ? 4 : z <= 4 ? 2 : z <= 6 ? 1 : 0.5, len = 9;
  const box = { west: lonAt(x0 - pad, z), east: lonAt(x0 + 256 + pad, z), north: latAt(y0 - pad, z), south: latAt(y0 + 256 + pad, z), step };
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round'; ctx.beginPath();
  for (const d of waveDarts((k, la, lo) => momentValue(c, k, la, lo), box)) {
    const px = xAt(d.lon, z) - x0, py = yAt(d.lat, z) - y0, go = d.to * RAD, l = len * Math.min(1.4, 0.7 + d.h / 6);
    const dx = Math.sin(go), dy = -Math.cos(go);   // Mercator keeps angles: no squeeze to undo
    const x1 = px + dx * l / 2, y1 = py + dy * l / 2;
    ctx.moveTo(px - dx * l / 2, py - dy * l / 2); ctx.lineTo(x1, y1);
    ctx.moveTo(x1, y1); ctx.lineTo(x1 - (dx * 0.9 - dy * 0.5) * l * 0.4, y1 - (dy * 0.9 + dx * 0.5) * l * 0.4);
    ctx.moveTo(x1, y1); ctx.lineTo(x1 - (dx * 0.9 + dy * 0.5) * l * 0.4, y1 - (dy * 0.9 - dx * 0.5) * l * 0.4);
  }
  ctx.stroke();
}
const washes = Object.fromEntries(['temp', 'cloud', 'rain', 'gust', 'wave'].map(k => [k, new WashLayer(k)]));

/* ============================================================ isobars, values and the highs and lows, per tile */
const IsobarLayer = L.GridLayer.extend({
  initialize() { L.GridLayer.prototype.initialize.call(this, { pane: 'wxTop', tileSize: 256, updateWhenZooming: false, keepBuffer: 1, className: 'wx-pres' }); },
  createTile(coords) {
    const tile = document.createElement('canvas'), dpr = Math.min(2, devicePixelRatio || 1); tile.width = tile.height = 256 * dpr;
    const ch = Wx.chart(coords.z); if (!ch) return tile;
    const ctx = tile.getContext('2d'), z = coords.z, x0 = coords.x * 256, y0 = coords.y * 256, pad = 40;
    ctx.scale(dpr, dpr);
    const w = lonAt(x0 - pad, z), e = lonAt(x0 + 256 + pad, z), n = latAt(y0 - pad, z), s = latAt(y0 + 256 + pad, z);
    const X = lon => xAt(lon, z) - x0, Y = lat => yAt(lat, z) - y0;
    ctx.lineJoin = ctx.lineCap = 'round';
    for (const bold of [false, true]) {
      ctx.strokeStyle = bold ? 'rgba(255,255,255,0.92)' : 'rgba(225,235,250,0.62)'; ctx.lineWidth = bold ? 1.8 : 1; ctx.beginPath();
      for (const pc of ch.pieces) {
        if (pc.bold !== bold || pc.e < w || pc.w > e || pc.n < s || pc.s > n) continue;
        pc.p.forEach(([lo, la], i) => i ? ctx.lineTo(X(lo), Y(la)) : ctx.moveTo(X(lo), Y(la)));
      }
      ctx.stroke();
    }
    ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(6,10,18,0.85)'; ctx.fillStyle = '#fff';
    for (const l of ch.labels) if (l.lon >= w && l.lon <= e && l.lat >= s && l.lat <= n) { ctx.strokeText(l.text, X(l.lon), Y(l.lat)); ctx.fillText(l.text, X(l.lon), Y(l.lat)); }
    for (const c of ch.centres) {
      if (c.lon < w || c.lon > e || c.lat < s || c.lat > n) continue;
      const x = X(c.lon), y = Y(c.lat);
      ctx.font = '800 22px system-ui, sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = '#081020'; ctx.fillStyle = c.type === 'H' ? '#6cb8ff' : '#ff6b6b';
      ctx.strokeText(c.type, x, y - 7); ctx.fillText(c.type, x, y - 7);
      ctx.font = '700 11px "IBM Plex Mono", ui-monospace, monospace'; ctx.lineWidth = 3; ctx.strokeText(String(Math.round(c.value)), x, y + 10); ctx.fillText(String(Math.round(c.value)), x, y + 10);
    }
    return tile;
  },
});
const isobars = new IsobarLayer();

/* ============================================================ wind streaks: particles carried by the wind on a canvas */
const COUNT = SMALL ? 900 : 2600;
const Streaks = L.Layer.extend({
  onAdd(m) {
    this.cv = L.DomUtil.create('canvas', 'wx-streaks leaflet-zoom-hide'); m.getPane('wxTop').appendChild(this.cv);
    this.ctx = this.cv.getContext('2d'); this.parts = [];
    m.on('moveend zoomend resize viewreset', this.reset, this); m.on('movestart zoomstart', this.hold, this);
    this.reset(); this.loop(); return this;
  },
  onRemove(m) { cancelAnimationFrame(this.raf); this.raf = 0; L.DomUtil.remove(this.cv); m.off('moveend zoomend resize viewreset', this.reset, this); m.off('movestart zoomstart', this.hold, this); },
  hold() { this.moving = true; },
  /** A new moment: the old streaks fade out on their own, new ones follow the new field. */
  fresh() { if (this.parts) for (const p of this.parts) p.px = NaN; },
  reset() {
    if (!this._map) return;
    const m = this._map, size = m.getSize(), dpr = SMALL ? 1 : Math.min(2, devicePixelRatio || 1);
    this.dpr = dpr; this.cv.width = size.x * dpr; this.cv.height = size.y * dpr; this.cv.style.width = size.x + 'px'; this.cv.style.height = size.y + 'px';
    L.DomUtil.setPosition(this.cv, m.containerPointToLayerPoint([0, 0]));
    const b = m.getBounds(); this.box = { s: Math.max(-84, b.getSouth()), n: Math.min(84, b.getNorth()), w: b.getWest(), e: b.getEast() };
    const n = Math.round(COUNT * Math.min(1, size.x * size.y / (1400 * 800)) + 200);
    this.parts = Array.from({ length: n }, () => this.spawn({}));
    this.moving = false;
  },
  spawn(p) {
    const B = this.box, s = Math.sin(B.s * RAD), n = Math.sin(B.n * RAD);
    p.lat = Math.asin(s + Math.random() * (n - s)) / RAD;   // even over the area, not crowded toward the poles
    p.lon = B.w + Math.random() * (B.e - B.w); p.age = Math.floor(Math.random() * 80); p.life = 60 + Math.floor(Math.random() * 60); p.px = NaN;
    return p;
  },
  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    if (this.moving || document.hidden || !Wx.cur || !Wx.cur.a.wind) return;
    if (SMALL && (this.tick = (this.tick || 0) + 1) % 2) return;   // phones: half the frame rate
    const m = this._map, ctx = this.ctx, dpr = this.dpr, z = m.getZoom(), W = this.cv.width, Hh = this.cv.height;
    const o = m.project(m.containerPointToLatLng([0, 0]), z);   // the canvas's top-left in world pixels
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = SMALL ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.08)'; ctx.fillRect(0, 0, W, Hh); ctx.globalCompositeOperation = 'source-over';
    const k = (SMALL ? 0.3 : 0.18) / (worldPx(z) / 360), wv = [0, 0], buckets = WIND_COLORS.map(() => []);   // the same screen speed per m/s at every zoom
    for (const p of this.parts) {
      momentWind(Wx.cur, p.lat, p.lon, wv);
      const cl = Math.cos(p.lat * RAD);
      p.lon += wv[0] * k; p.lat += wv[1] * k * cl; p.age++;   // Mercator is conformal: north-south the same screen speed as east-west
      if (p.age > p.life || p.lat > this.box.n || p.lat < this.box.s || p.lon < this.box.w || p.lon > this.box.e) { this.spawn(p); continue; }
      const x = (xAt(p.lon, z) - o.x) * dpr, y = (yAt(p.lat, z) - o.y) * dpr;
      if (!Number.isNaN(p.px)) buckets[windBucket(Math.hypot(wv[0], wv[1]))].push(p.px, p.py, x, y);
      p.px = x; p.py = y;
    }
    ctx.lineWidth = 1.2 * dpr; ctx.lineCap = 'round'; ctx.globalAlpha = 0.9;
    buckets.forEach((seg, b) => { if (!seg.length) return; ctx.strokeStyle = WIND_COLORS[b]; ctx.beginPath(); for (let i = 0; i < seg.length; i += 4) { ctx.moveTo(seg[i], seg[i + 1]); ctx.lineTo(seg[i + 2], seg[i + 3]); } ctx.stroke(); });
    ctx.globalAlpha = 1;
  },
});
const streaks = new Streaks();

/* ============================================================ the timeline bar */
const when = t => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const Bar = {
  el: null, slider: null,
  build() {
    if (this.el) return;
    const el = this.el = document.createElement('div'); el.id = 'wxbar'; el.className = 'wxbar'; el.hidden = true;
    el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Forecast timeline');
    el.innerHTML = `<div class="wx-row"><button type="button" class="wx-btn wx-play" aria-label="Play the forecast">▶</button>`
      + `<input type="range" class="wx-slider" min="0" max="${MAX_H}" step="1" value="0" aria-label="Hours ahead">`
      + `<span class="wx-when" aria-live="off"></span>`
      + `<select class="wx-model" aria-label="Forecast model">${Object.values(Models).map(m => `<option value="${esc(m.id)}">${esc(m.def.short)}</option>`).join('')}</select>`
      + `<button type="button" class="wx-btn wx-x" aria-label="Switch the forecast layers off">✕</button></div>`
      + `<div class="wx-legend"></div><div class="wx-read"></div><div class="wx-src"></div>`;
    $('#mapwrap').appendChild(el);
    L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
    this.slider = $('.wx-slider', el);
    this.slider.addEventListener('input', () => { Wx.play(false); Wx.setHour(+this.slider.value); });
    $('.wx-play', el).addEventListener('click', () => Wx.play());
    const sel = $('.wx-model', el); sel.value = Wx.modelId; sel.addEventListener('change', () => Wx.setModel(sel.value));
    $('.wx-x', el).addEventListener('click', () => { Wx.play(false); for (const id of Object.keys(KINDS)) Layers.set(id, false); });
  },
  sync() {
    this.build(); const on = Wx.any();
    if (this.el.hidden === on) { this.el.hidden = !on; document.body.classList.toggle('wx-on', on); }
    if (!on) Wx.play(false);
    this.label(); this.legend(); this.read();
  },
  label() {
    if (!this.el) return;
    $('.wx-play', this.el).textContent = Wx.playing ? '❚❚' : '▶'; $('.wx-play', this.el).setAttribute('aria-label', Wx.playing ? 'Pause' : 'Play the forecast');
    $('.wx-when', this.el).textContent = `${when(Wx.t())} · ${Wx.h ? '+' + Wx.h + ' h' : 'now'}`;
    const c = Wx.cur;
    $('.wx-src', this.el).textContent = c ? `${c.model.def.name}, ${runWords(c.run)}: a forecast, blended between its 3-hourly steps` : `${Wx.model.def.name}: looking for its newest run…`;
  },
  legend() {
    if (!this.el) return;
    const kinds = Object.entries(KINDS).filter(([id]) => Layers.on(id)).map(([, k]) => k);
    $('.wx-legend', this.el).innerHTML = kinds.map(k => legendFor(k, IMPERIAL)).filter(Boolean).map(l => l.gradient
      ? `<div class="wx-lg"><span>${esc(l.title)}</span><i style="background:${l.gradient}"></i><small>${l.ticks.map(([p, v]) => `<em style="left:${p.toFixed(1)}%">${esc(String(v))}</em>`).join('')}</small></div>`
      : `<div class="wx-lg"><span>${esc(l.title)}</span></div>`).join('');
  },
  at: null,
  /** Every field at the pointer (or the map's centre on touch screens). */
  read(ll = this.at) {
    if (!this.el || this.el.hidden) return;
    const c = Wx.cur, p = ll || map.getCenter();
    if (!c) { $('.wx-read', this.el).textContent = ''; return; }
    const lon = ((p.lng + 540) % 360) - 180, r = momentReading(c, p.lat, lon), out = [];
    const spd = v => IMPERIAL ? `${Math.round(v * 2.23694)} mph` : `${Math.round(v * 3.6)} km/h`;
    if (Number.isFinite(r.temp)) out.push(IMPERIAL ? `${Math.round(r.temp * 9 / 5 + 32)} °F` : `${Math.round(r.temp)} °C`);
    if (Number.isFinite(r.u)) { const w = windFrom(r.u, r.v); out.push(w.speed < 0.5 ? 'calm' : `wind ${spd(w.speed)} from the ${compass(w.from)}`); }
    if (Number.isFinite(r.gust)) out.push(`gusts ${spd(r.gust)}`);
    if (Number.isFinite(r.pres)) out.push(`${Math.round(r.pres)} hPa${Number.isFinite(r.presTrend) && Math.abs(r.presTrend) >= 0.5 ? (r.presTrend > 0 ? ' rising' : ' falling') : ''}`);
    if (Number.isFinite(r.cloud)) out.push(`${Math.round(r.cloud)}% cloud`);
    if (Number.isFinite(r.rain) && r.rain >= 0.1) out.push(`rain ${r.rain.toFixed(1)} mm/h`);
    if (Number.isFinite(r.wave)) out.push(`waves ${IMPERIAL ? Math.round(r.wave * 3.28084) + ' ft' : r.wave.toFixed(1) + ' m'}${Number.isFinite(r.waveFrom) ? ' from the ' + compass(r.waveFrom) : ''}`);
    $('.wx-read', this.el).textContent = out.length ? `${ll ? 'Here' : 'Map centre'}: ${out.join(' · ')}` : '';
  },
};
map.on('mousemove', throttle(e => { if (Bar.el && !Bar.el.hidden) { Bar.at = e.latlng; Bar.read(); } }, 120));
map.on('mouseout', () => { Bar.at = null; Bar.read(); });
map.on('moveend', () => { if (!Bar.at) Bar.read(); });
let shownCredit = '';
function credit() {
  const want = Wx.any() ? CREDIT[Wx.modelId] : '';
  if (want === shownCredit) return;
  if (shownCredit) map.attributionControl.removeAttribution(shownCredit);
  if (want) map.attributionControl.addAttribution(want);
  shownCredit = want;
}

/* ============================================================ the layers */
const leafletOf = kind => kind === 'wind' ? streaks : kind === 'pres' ? isobars : washes[kind];
/** A forecast layer: its Leaflet layer on and off with it, and a feed whose status says whether the model answered. */
function wxLayer(ly) {
  const kind = KINDS[ly.id], base = ly.desc;
  ly.enable = () => { Bar.sync(); credit(); leafletOf(kind).addTo(map); };
  ly.disable = () => { map.removeLayer(leafletOf(kind)); Bar.sync(); credit(); if (!Wx.any()) { Wx.cur = null; Wx.key = ''; } };
  feed(ly, { interval: 900, errorInterval: 60, fetch: async () => {
    const c = await Wx.load();
    if (!c || !c.a[kind]) throw new Error(`${Wx.model.def.short} has no ${kind === 'pres' ? 'pressure' : kind} for this hour`);
    ly.desc = `${c.model.def.short} · ${Wx.h ? '+' + Wx.h + ' h' : 'now'} · ${base}`;
    ly.feed.count = 0;
  } });
  return ly;
}
const G = 'Weather & space weather';
wxLayer(Layers.add({ id: 'wx_wind', group: G, name: 'Wind (forecast)', desc: 'Moving streaks, 10 m above the ground · NOAA GFS or ECMWF, now to +5 days on the timeline', color: '#b6f5ff', default: false }));
wxLayer(Layers.add({ id: 'wx_temp', group: G, name: 'Temperature (forecast)', desc: 'At 2 m · colours from −40 to +40 °C', color: '#ffc46b', default: false }));
wxLayer(Layers.add({ id: 'wx_pres', group: G, name: 'Pressure: isobars, highs and lows', desc: 'Sea-level pressure every 4 hPa, heavier every 20 · H and L at the centres', color: '#e6edf3', default: false }));
wxLayer(Layers.add({ id: 'wx_gust', group: G, name: 'Wind gusts (forecast)', desc: 'Yellow from a strong breeze to purple at hurricane force', color: '#ff9f43', default: false }));
wxLayer(Layers.add({ id: 'wx_cloud', group: G, name: 'Cloud cover (forecast)', desc: 'The model’s total cloud, white where it is thick', color: '#d7dde3', default: false }));
wxLayer(Layers.add({ id: 'wx_rain', group: G, name: 'Rain (forecast)', desc: 'The model’s rain rate in radar colours · not observed: Precipitation radar shows now', color: '#3ee08f', default: false }));
wxLayer(Layers.add({ id: 'wx_wave', group: G, name: 'Ocean waves (forecast)', desc: 'Significant wave height, darts where they run · WAVEWATCH III with GFS, ECMWF’s wave model with ECMWF', color: '#46b4dc', default: false }));
// layers switched on by a saved state or a link before INIT: the bar and the drawing follow once the map is up
setTimeout(() => { if (Wx.any()) { Bar.sync(); credit(); for (const [id, k] of Object.entries(KINDS)) if (Layers.on(id)) leafletOf(k).addTo(map); } }, 0);

export const Weather2D = { Wx, Bar, Models, washes, isobars, streaks };
late.Wx = Wx;
