// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Weather mode: one timeline from the last couple of hours (what satellites and radar saw) into the next five days (what
// NOAA's GFS model forecasts; three on phones), and the globe's clock moves with it: drag the slider and the day-night
// line, the satellites and the weather move together; move the clock in the time bar and the weather follows.
//  Observed, 30-minute frames:
//  - Clouds: NASA GIBS infrared, GOES-East + GOES-West + Himawari (10-minute images, ~50 min old; cold cloud tops in
//    colour). Between them they cover the Americas, the Pacific and Asia-Australia; Europe, Africa and the Indian Ocean
//    need Meteosat, which no free tile service carries.
//  - Rain: RainViewer's composite of national radars (10-minute frames; only where radar exists).
//  - Rain from space: NASA IMERG, global between 60 deg N and S, about 7 hours old (still).
//  - Lightning: NOAA nowCOAST strike density (NLDN + GLD360), the last 15 minutes, the Americas and the Pacific (still).
//  Forecast, every 3 hours (model.js, wind.js): NOAA GFS (1°) or ECMWF IFS (0.25°), or the two side by side with a
//  slider between them. Cloud cover and rain rate take the place of the satellite and radar pictures; wind, temperature,
//  pressure (isobars, H and L), gusts and ocean waves (WAVEWATCH III with GFS, ECMWF's own wave model with ECMWF) run
//  along the whole timeline. A legend says what the colours mean; pointing at the globe reads every field there.
// Nothing is fetched until the mode is opened. Frames are Cesium imagery layers made on demand; only the current frame (and
// the next, while playing) is shown, so the GPU holds a few tiles, not the whole loop.
import { C, $, toast, store, PHONE, esc } from './env.js';
import { viewer, camHeight } from './viewer.js';
import { Earth } from './earth.js';
import { state, hooks } from './state.js';
import { PRESETS } from './ui.js';
import { Wind, legendFor } from './wind.js';
import { Models, MAX_H } from './model.js';
import { Time } from './time.js';
import { timeline, relTime, windFrom, compass } from '../core/gfs.js';
import { runEnd, gustNote, clockWords } from '../core/wxmodels.js';
import { jdFromMs } from '../core/time.js';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/';
const SCHEME = () => new C.GeographicTilingScheme({ rectangle: C.Rectangle.fromDegrees(-180, -198, 396, 90), numberOfLevelZeroTilesX: 2, numberOfLevelZeroTilesY: 1 });   // see earth.js
const nasa = new C.Credit('Clouds and rain: NASA GIBS (NOAA GOES-East/West, JMA Himawari, NASA IMERG)');
const rv = new C.Credit('Radar © RainViewer.com');
const ltg = new C.Credit('Lightning: NOAA nowCOAST (NLDN and GLD360 via NCEP OPC)');
const gibsProvider = (layer, time, matrix, max) => new C.UrlTemplateImageryProvider({ url: `${GIBS}${layer}/default/${time}/${matrix}/{z}/{y}/{x}.png`, tilingScheme: SCHEME(),
  rectangle: C.Rectangle.fromDegrees(-180, -90, 180, 90), tileWidth: 512, tileHeight: 512, maximumLevel: max, credit: nasa });
/** The three infrared satellites as ONE imagery layer: each 512 px tile is the three GIBS tiles drawn onto one canvas.
 *  Three layers meant up to three more textures per globe tile, and Cesium builds (and links, on the main thread) a globe
 *  shader for every texture count it meets: opening weather built 14 programs and pressing play 13 more. */
class CompositeProvider {
  constructor(urls, maximumLevel) {
    Object.assign(this, { urls, tilingScheme: SCHEME(), rectangle: C.Rectangle.fromDegrees(-180, -90, 180, 90), tileWidth: 512, tileHeight: 512, maximumLevel, minimumLevel: 0,
      tileDiscardPolicy: undefined, errorEvent: new C.Event(), credit: nasa, proxy: undefined, hasAlphaChannel: true, ready: true });
  }
  getTileCredits() { return undefined; }
  pickFeatures() { return undefined; }
  requestImage(x, y, level) {
    const url = u => u.replace('{z}', level).replace('{y}', y).replace('{x}', x);
    return Promise.all(this.urls.map(u => C.Resource.fetchImage({ url: url(u), preferImageBitmap: false }).catch(() => null))).then(imgs => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 512; const cx = cv.getContext('2d');
      for (const im of imgs) if (im) cx.drawImage(im, 0, 0, 512, 512);
      return cv;
    });
  }
}
const SATS = [['GOES-East_ABI_Band13_Clean_Infrared'], ['GOES-West_ABI_Band13_Clean_Infrared'], ['Himawari_AHI_Band13_Clean_Infrared']];
const FRAMES = PHONE ? 4 : 6, STEP = 30 * 60e3, PLAY_MS = 900, PLAY_FCST_MS = 700;
const iso = ms => new Date(ms).toISOString().slice(0, 19) + 'Z';
const H = 3600e3;
const IMPERIAL = /^en-(us|lr)$|^my\b/i.test(navigator.language || '');
const MODEL_SETS = ['wind', 'temp', 'pres', 'gust', 'wave'];   // the model's layers that run along the whole timeline

async function haveWms(layer, time, minBytes) {   // whole-world 256x128 image: WMS answers a missing time with a blank image (WMTS: a 404 without CORS headers)
  try { const r = await fetch(`https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=256&HEIGHT=128&FORMAT=image/png&TRANSPARENT=true&TIME=${time}`); return r.ok && (await r.blob()).size > minBytes; } catch (e) { return false; }
}
async function latest(layer, step, from, to, minBytes) {   // newest time (ms) in [to, from] that has data
  for (let t = Math.floor(from / step) * step; t >= to; t -= step) if (await haveWms(layer, iso(t), minBytes)) return t;
  return null;
}

export const Weather = {
  on: false, playing: false, frame: FRAMES - 1, timer: 0, ready: null, layers: new Map(), frames: [], clockSet: false, selfClock: false, following: false,
  sets: { ir: { name: 'Clouds', on: true }, radar: { name: 'Rain', on: true }, rain: { name: 'Rain from space', on: false }, lightning: { name: 'Lightning (Americas)', on: true }, wind: { name: 'Wind', on: false }, temp: { name: 'Temperature', on: false }, pres: { name: 'Pressure', on: false }, gust: { name: 'Gusts', on: false }, wave: { name: 'Waves', on: false } },
  ir: [], radar: [], rainAt: 0, run: null,
  modelId: store.get('wx.model', 'gfs') in Models ? store.get('wx.model', 'gfs') : 'gfs', compare: false,
  get model() { return Models[this.modelId]; },
  get other() { return Object.values(Models).find(m => m !== this.model); },

  /** The pictures and the model's run are looked for together, but the pictures don't wait for the run: a bucket that
   *  can't be reached is tried again and again (core/wxload.js runComplete: S3's "503 Slow Down" comes without CORS, so it
   *  looks like a failed fetch), minutes for both models, and weather mode sat on "loading…" all that time with the radar
   *  and satellite frames in hand. It opens on what was seen; the forecast joins the timeline when its run is found
   *  (adoptRun). With no pictures at all it waits for the run, as before. */
  async init() {
    if (this.ready) return this.ready;
    const ready = this.ready = (async () => {
      const now = Date.now();
      let run = null, found = false;
      const runFound = this.findRun().then(r => { found = true; return (run = r); });
      const [ir, rainAt, maps] = await Promise.all([
        Promise.all(SATS.map(async ([layer]) => ({ layer, latest: await latest(layer, 600e3, now - 25 * 60e3, now - 4 * 3600e3, 2000) }))),
        latest('IMERG_Precipitation_Rate_30min', 1800e3, now - 3 * 3600e3, now - 30 * 3600e3, 1500),
        fetch('https://api.rainviewer.com/public/weather-maps.json').then(r => r.json()).catch(() => null)]);
      this.ir = ir.filter(s => s.latest); this.rainAt = rainAt || 0;
      this.radar = maps && maps.radar ? maps.radar.past.map(f => ({ time: f.time * 1000, url: maps.host + f.path })) : [];
      this.end = this.ir.length ? Math.max(...this.ir.map(s => s.latest)) : Math.max(0, ...this.radar.map(f => f.time));   // the observed frames run on the satellites' clock; radar follows to the nearest frame
      if (!this.end) { await runFound; if (run) this.end = Math.floor(now / STEP) * STEP; }   // no pictures at all: the forecast still works
      if (!this.end) throw new Error('no weather data reachable');
      this.run = run;
      this.frames = timeline({ obsEnd: this.end, obs: FRAMES, obsStep: STEP, run, until: this.until(run, now) });
      if (!found) runFound.then(r => this.adoptRun(r, ready)).catch(e => console.warn('weather forecast', e));
    })().catch(e => { if (this.ready === ready) this.ready = null; throw e; });
    return ready;
  },
  /** The run, found after weather opened on its pictures: the forecast part of the timeline joins it (unless weather was
   *  closed or reopened since, or a model change found one first: `ready` is that opening's). */
  adoptRun(run, ready) {
    if (!run || run !== this.model.run || this.run || !this.on || this.ready !== ready || !this.frames.length) return;   // the model shown may have changed meanwhile
    this.run = run; this.retime();
  },
  /** The timeline again on this.run (a new run, another model), staying on the moment shown. */
  retime() {
    const f = this.frames[this.frame];
    this.frames = timeline({ obsEnd: this.end, obs: FRAMES, obsStep: STEP, run: this.run, until: this.until(this.run, Date.now()) });
    this.frame = f ? this.nearest(f.t) : FRAMES - 1; this.build(); this.show();
  },
  /** Where the forecast part of the timeline stops: MAX_H from now, but never past the last hour run reaches (a later
   *  frame would repeat that hour under a later label). The models are read a day past MAX_H (model.js), so this only
   *  bites on an old fallback run, on either side when two are compared. */
  until(run, now) {
    if (!run) return now;
    const end = Math.min(now + MAX_H * H, runEnd(this.model.def, run, this.model.maxH)), o = this.other;
    return this.compare && o.run ? Math.min(end, runEnd(o.def, o.run, o.maxH)) : end;   // side by side: the run that ends sooner (as the map's top())
  },
  /** The second model's run was found after the timeline was built: cut the frames past where it ends. */
  fitOther() {
    const last = this.frames[this.frames.length - 1];
    if (this.on && this.compare && this.run && last && last.fcst && this.until(this.run, Date.now()) < last.t) this.retime();
  },
  /** The model choice in a share link, beside the layer ids: 'ecmwf' (GFS is the default), 'compare'. */
  shareTokens() { return [...(this.modelId !== 'gfs' ? [this.modelId] : []), ...(this.compare ? ['compare'] : [])]; },
  fromTokens(list) { this.modelId = Object.keys(Models).find(id => id !== 'gfs' && list.includes(id)) || 'gfs'; this.compare = list.includes('compare'); },
  /** The chosen model's newest run; if it can't be reached, the other model's (and say so). */
  async findRun() {
    const run = await this.model.ready().catch(e => { console.warn('weather model', e.message); return null; });
    if (this.compare) this.other.ready().then(() => this.fitOther()).catch(() => {});   // its run may end sooner: the timeline stops there
    if (run || this.compare) return run;
    const alt = await this.other.ready().catch(() => null);
    if (alt) { toast(`${this.model.def.short} is not reachable right now: showing ${this.other.def.short}`, 3500); this.modelId = this.other.id; Wind.setModels(this.model, null); }
    return alt;
  },
  /** Another model, or both side by side: the forecast part of the timeline follows the one on the left. */
  async setModel(id, compare = this.compare) {
    if (!(id in Models)) return;
    this.modelId = id; this.compare = compare; store.set('wx.model', id);
    Wind.setModels(this.model, compare ? this.other : null); this.splitBar(compare && this.on);
    if (!this.on || !this.frames.length) return;
    const run = await this.findRun();
    if (!this.on) return;
    this.run = run; this.retime();
  },
  /** A newer model run is out (every 6 h): rebuild the forecast part of the timeline on it. */
  async newRun() {
    if (!this.on) return;
    if (this.compare) this.other.refresh().then(n => n && this.show()).catch(() => {});
    if (!(await this.model.refresh().catch(() => false))) return;
    this.run = this.model.run; this.retime();
  },

  // the imagery layers of one observed frame of one set (made once, hidden until shown)
  layersFor(set, k) {
    const key = set + k; if (this.layers.has(key)) return this.layers.get(key);
    const at = this.end - (FRAMES - 1 - k) * STEP, out = [];
    if (set === 'ir' && this.ir.length) out.push(this.add(new CompositeProvider(this.ir.map(s => `${GIBS}${s.layer}/default/${iso(s.latest - (FRAMES - 1 - k) * STEP)}/2km/{z}/{y}/{x}.png`), 5)));
    else if (set === 'radar' && this.radar.length) {
      const f = this.radar.reduce((a, b) => Math.abs(b.time - at) < Math.abs(a.time - at) ? b : a);
      out.push(this.add(new C.UrlTemplateImageryProvider({ url: `${f.url}/256/{z}/{x}/{y}/2/1_1.png`, maximumLevel: 7, credit: rv })));
    } else if (set === 'rain' && this.rainAt) out.push(this.add(gibsProvider('IMERG_Precipitation_Rate_30min', iso(this.rainAt), '2km', 5)));
    else if (set === 'lightning') out.push(this.add(new C.WebMapServiceImageryProvider({ url: 'https://nowcoast.noaa.gov/geoserver/ows', layers: 'lightning_detection:ldn_lightning_strike_density',
      parameters: { transparent: true, format: 'image/png' }, rectangle: C.Rectangle.fromDegrees(-180, -25, 180, 80), maximumLevel: 6, credit: ltg })));
    this.layers.set(key, out); return out;
  },
  add(provider) { const l = viewer.imageryLayers.addImageryProvider(provider); l.show = false; l.alpha = 0.9; return l; },

  show() {   // the current moment: its pictures (observed) or the model's cloud and rain (forecast), plus wind and temperature
    const f = this.frames[this.frame]; if (!f) return;
    const fc = f.fcst, next = this.frames[this.frame + 1];
    const want = new Set(fc ? [] : [f.k, ...(this.playing && next && !next.fcst ? [next.k] : [])]);
    for (const set of ['ir', 'rain', 'radar', 'lightning']) {   // bottom to top
      const still = set === 'rain' || set === 'lightning', ks = still ? [FRAMES - 1] : [...Array(FRAMES).keys()];
      for (const k of ks) {
        const on = this.on && this.sets[set].on && !fc && (still || want.has(k));
        if (on) this.layersFor(set, k);
        for (const l of this.layers.get(set + k) || []) {
          l.show = on && !Earth.hidden; l.alpha = (set === 'ir' ? 0.92 : set === 'rain' ? 0.7 : set === 'lightning' ? 0.95 : 0.85) * (still || k === f.k ? 1 : 0.001);
          if (l.show) viewer.imageryLayers.raiseToTop(l);
        }
      }
    }
    // the model: wind and temperature all along; cloud and rain in place of the pictures in the forecast
    const S = this.sets, cloud = this.on && fc && S.ir.on, rain = this.on && fc && S.radar.on;
    const kinds = [...MODEL_SETS.filter(k => S[k].on), ...(cloud ? ['cloud'] : []), ...(rain ? ['rain'] : [])];
    if (this.on && kinds.length) {
      // a forecast frame the model can't give is left empty (wind.js never stands the snapshot of now in for it): say so,
      // whichever layers are on
      Wind.moment(f.t, kinds, fc).then(model => { if (!model && fc) toast('The weather model is not reachable for this moment: nothing is drawn for it', 3500); this.label(); }).catch(() => this.label());
      if (this.playing && next) { this.model.prefetch(next.t, kinds); if (this.compare) this.other.prefetch(next.t, kinds); }
    }
    const field = (on, set) => (on ? set(true) : set(false)).catch(() => { toast('Weather model data is not reachable right now'); });
    field(this.on && S.wind.on, on => Wind.setWind(on)); field(this.on && S.temp.on, on => Wind.setWash('temp', on));
    field(cloud, on => Wind.setWash('cloud', on)); field(rain, on => Wind.setWash('rain', on));
    for (const k of ['pres', 'gust', 'wave']) field(this.on && S[k].on, on => Wind.setWash(k, on));
    this.legend();
    this.syncClock(f);
    viewer.scene.requestRender();
    this.label();
  },
  /** The globe's clock follows the timeline: live on the newest observed frame, paused at the moment otherwise. */
  syncClock(f) {
    if (this.following || !this.on) return;
    this.selfClock = true;
    try {
      if (!f.fcst && f.k === FRAMES - 1) { if (this.clockSet) { this.clockSet = false; Time.goLive(); } }
      else { this.clockSet = true; Time.setJd(jdFromMs(f.t), 0); }
    } finally { this.selfClock = false; }
  },
  nearest(t) { let best = 0; this.frames.forEach((f, i) => { if (Math.abs(f.t - t) < Math.abs(this.frames[best].t - t)) best = i; }); return best; },
  /** The clock moved (the time bar, "now", fast-forward): show the nearest moment, without moving the clock again. */
  followClock() {
    if (!this.on || this.selfClock || !this.frames.length) return;
    const i = Time.live ? FRAMES - 1 : this.nearest(Time.nowMs());
    if (i === this.frame) return;
    this.following = true; this.frame = i; if (Time.live) this.clockSet = false;
    try { this.show(); } finally { this.following = false; }
  },
  label() {
    const f = this.frames[this.frame]; if (!f) return;
    const rel = relTime(f.t, Date.now());
    $('#wxTime').textContent = f.fcst ? `${clockWords(f.t)} · ${rel} · forecast` : `${clockWords(f.t)} · ${rel === 'now' ? 'just now' : rel.replace('−', '') + ' ago'} · observed`;   // one clock, with its zone, both sides of now
    $('#wxSlider').value = this.frame; $('#wxPlay').textContent = this.playing ? '❚❚' : '▶';
    const any = MODEL_SETS.some(k => this.sets[k].on) || f.fcst;
    const model = any && Wind.note() ? (this.compare ? ` Left: ${Wind.note()}. Right: ${Wind.note('cmp')}.` : ` Model: ${Wind.note()}.`) : '';
    const obs = f.fcst ? (this.run ? 'Forecast: clouds and rain from the model, every 3 hours.' : 'No forecast reachable.')
      : (this.ir.length ? `Infrared: ${this.ir.length} of 3 satellites reached.` : 'No infrared images reachable.') + (this.sets.radar.on && !this.radar.length ? ' Radar unreachable.' : '')
        + (this.sets.rain.on && this.rainAt ? ` Rain from space: ${clockWords(this.rainAt)}.` : '');
    $('#wxNote').textContent = obs + model;
  },
  set(frame) { this.frame = Math.max(0, Math.min(this.frames.length - 1, frame)); this.show(); },
  play(on) {
    this.playing = on; clearTimeout(this.timer);
    const tick = () => { if (!this.playing) return; this.set(this.frame + 1 >= this.frames.length ? 0 : this.frame + 1); this.timer = setTimeout(tick, this.frames[this.frame]?.fcst ? PLAY_FCST_MS : PLAY_MS); };
    if (on) this.timer = setTimeout(tick, PLAY_MS);
    this.show();
  },

  async open() {
    if (this.on) return;
    this.on = true; state.weather = true; $('#wx').classList.add('show'); Earth.apply(); hooks.applyVisibility();
    Wind.setModels(this.model, this.compare ? this.other : null); this.splitBar(this.compare);
    if (camHeight() < 3.0e6) PRESETS.earth();   // weather is a whole-Earth picture
    try { await this.init(); } catch (e) { this.close(); toast('Weather data is not reachable right now'); return; }
    if (!this.on) return;
    const t = Time.nowMs(), last = this.frames[this.frames.length - 1], inside = !Time.live && t >= this.frames[0].t - STEP && t <= last.t + 3 * 3600e3;
    if (!Time.live && !inside) { this.selfClock = true; try { Time.goLive(); } finally { this.selfClock = false; } }   // weather is about now: a clock far in the past or future comes back
    this.frame = inside ? this.nearest(t) : FRAMES - 1; this.clockSet = inside;
    this.build(); this.show();
    this.newRun();   // the run found when weather first opened may have been replaced since
  },
  close() {
    this.on = false; state.weather = false; this.play(false); $('#wx').classList.remove('show');
    for (const ls of this.layers.values()) for (const l of ls) viewer.imageryLayers.remove(l, true);
    Wind.setWind(false); Wind.dropWashes(); this.splitBar(false); this.readout(null);
    this.layers.clear(); Earth.apply(); hooks.applyVisibility(); viewer.scene.requestRender();
    document.querySelector('[data-go="weather"]')?.classList.remove('on');
    if (this.clockSet) { this.clockSet = false; this.selfClock = true; try { Time.goLive(); } finally { this.selfClock = false; } }
    this.ready = null;   // the next open finds the newest pictures and run
  },
  /** Opening weather the first time froze the globe for ~0.6 s (Cesium links a new globe shader for every count of imagery layers
   *  on a tile; later opens are smooth because the programs stay cached). Here a few blank layers (a 1 px data: image, no
   *  network) are shown for a moment while the page is idle, one more every few frames, so those programs are built before
   *  anyone asks. Layer properties matter (alpha below 1 is a shader flag), so they match the real ones. */
  prewarm() {
    if (this.warmed || this.on || state.weather || Earth.hidden) return; this.warmed = true;
    const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const layers = []; let frames = 0;
    const off = viewer.scene.postRender.addEventListener(() => {
      frames++;
      if (frames % 4 === 1 && layers.length < 5) { const l = viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: px, maximumLevel: 3 })); l.alpha = 0.9; layers.push(l); }
      if (frames >= 40 || this.on) { off(); for (const l of layers) viewer.imageryLayers.remove(l, true); viewer.scene.requestRender(); }
    });
    viewer.scene.requestRender();
  },
  toggle() { this.on ? this.close() : this.open(); },
  /** What the colours mean, for each model layer that is on (and cloud or rain in the forecast). */
  legend() {
    const el = $('#wxLegend'); if (!el) return;
    const f = this.frames[this.frame], S = this.sets;
    const kinds = [...MODEL_SETS.filter(k => S[k].on), ...(f && f.fcst && S.radar.on ? ['rain'] : [])];
    el.innerHTML = kinds.map(k => legendFor(k, IMPERIAL)).filter(Boolean).map(l => l.gradient
      ? `<div class="wx-leg"><span class="wx-leg-t">${l.title}</span><span class="wx-leg-bar" style="background:${l.gradient}"></span><span class="wx-leg-ticks">${l.ticks.map(([p, t]) => `<i style="left:${p.toFixed(1)}%">${t}</i>`).join('')}</span></div>`
      : `<div class="wx-leg"><span class="wx-leg-t">${l.title}</span></div>`).join('')
      + (S.gust.on ? `<div class="wx-leg-n">${esc(gustNote(this.compare ? [this.model.def, this.other.def] : [this.model.def]))}</div>` : '');   // GFS's gust is at the hour, ECMWF's the hour's strongest
  },
  /** Every loaded field at a point, in a line per model (two side by side). `at` null clears it. */
  readout(at) {
    const el = $('#wxRead'); if (!el) return;
    if (!at || !this.on) { el.textContent = ''; el.hidden = true; return; }
    const { lat, lon } = at, rows = [], f = this.frames[this.frame];
    if (!f || Wind.t !== f.t) { el.textContent = ''; el.hidden = true; return; }   // nothing loaded for this frame: not another moment's fields
    const spd = v => IMPERIAL ? `${Math.round(v * 2.23694)} mph` : `${Math.round(v * 3.6)} km/h`;
    for (const side of this.compare ? ['main', 'cmp'] : ['main']) {
      const r = Wind.reading(lat, lon, side); if (!r) continue;
      const bits = [];
      if (Number.isFinite(r.temp)) bits.push(IMPERIAL ? `${Math.round(r.temp * 9 / 5 + 32)} °F` : `${Math.round(r.temp)} °C`);
      if (Number.isFinite(r.speed) && Number.isFinite(r.u)) bits.push(`wind ${r.speed < 0.5 ? 'calm' : `${compassShort(windFrom(r.u, r.v).from)} ${spd(r.speed)}`}`);
      if (Number.isFinite(r.gust)) bits.push(`gusts ${spd(r.gust)}`);
      if (Number.isFinite(r.pres)) bits.push(`${Math.round(r.pres)} hPa${Number.isFinite(r.presTrend) && Math.abs(r.presTrend) >= 1 ? (r.presTrend < 0 ? ' ↓' : ' ↑') : ''}`);
      if (this.sets.wave.on) bits.push(Number.isFinite(r.wave) ? `waves ${IMPERIAL ? Math.round(r.wave * 3.28084) + ' ft' : r.wave.toFixed(1) + ' m'}${Number.isFinite(r.waveFrom) && r.wave >= 0.1 ? ' from ' + compassShort(r.waveFrom) : ''}` : 'no waves (land)');
      if (Number.isFinite(r.cloud) && this.frames[this.frame]?.fcst) bits.push(`cloud ${Math.round(r.cloud)}%`);
      if (Number.isFinite(r.rain) && r.rain >= 0.1) bits.push(`rain ${r.rain.toFixed(1)} mm/h`);
      if (bits.length) rows.push(`${this.compare ? `<b>${r.model ? Models[r.model].def.short : r.source}</b> ` : ''}${bits.join(' · ')}`);
    }
    const where = `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}`;
    el.hidden = !rows.length;
    el.innerHTML = rows.length ? `<span class="wx-at">${where}</span>${rows.map(r => `<span>${r}</span>`).join('')}` : '';
  },
  /** The bar between the two models, side by side: drag it to move the split. */
  splitBar(on) {
    let bar = $('#wxSplit');
    if (!on) { if (bar) bar.style.display = 'none'; return; }
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'wxSplit';
      bar.innerHTML = '<div class="ws-line"></div><button class="ws-grip" aria-label="Drag to compare the two models">⇆</button><span class="ws-l"></span><span class="ws-r"></span>';
      document.body.append(bar);
      const grip = bar.querySelector('.ws-grip');
      grip.addEventListener('pointerdown', e => {
        grip.setPointerCapture(e.pointerId);
        const move = ev => { const r = viewer.scene.canvas.getBoundingClientRect(); Wind.split = Math.min(0.97, Math.max(0.03, (ev.clientX - r.left) / r.width)); this.placeSplit(); };
        const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
        grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
      });
    }
    bar.style.display = 'block'; this.placeSplit();
  },
  placeSplit() {
    const bar = $('#wxSplit'); if (!bar) return;
    const r = viewer.scene.canvas.getBoundingClientRect();
    bar.style.left = (r.left + Wind.split * r.width) + 'px'; viewer.scene.splitPosition = Wind.split; viewer.scene.requestRender();
    bar.querySelector('.ws-l').textContent = '◀ ' + this.model.def.short; bar.querySelector('.ws-r').textContent = this.other.def.short + ' ▶';
  },
  build() {
    $('#wxSets').innerHTML = Object.entries(this.sets).map(([id, s]) => `<button class="chipbtn${s.on ? ' on' : ''}" data-set="${id}">${s.name}</button>`).join('');
    $('#wxModels').innerHTML = '<span>Model</span>' + Object.values(Models).map(m => `<button class="chipbtn${m.id === this.modelId ? ' on' : ''}" data-model="${m.id}" title="${m.def.name}, ${m.def.grid} (${m.def.licence})">${m.def.short}</button>`).join('')
      + `<button class="chipbtn${this.compare ? ' on' : ''}" data-compare="1" title="The two models side by side, a slider between them">Compare</button>`;
    const n = this.frames.length, obs = this.frames.filter(f => !f.fcst).length;
    $('#wxSlider').max = Math.max(0, n - 1);
    const split = n > 1 ? (obs - 0.5) / (n - 1) * 100 : 100, last = this.frames[n - 1];
    $('#wxScale').innerHTML = `<span style="flex:0 0 ${split.toFixed(1)}%">◀ past</span><span class="fc">${last && last.fcst ? `forecast to ${clockWords(last.t)} ▶` : 'no forecast reachable'}</span>`;
  },
};
const compassShort = deg => ({ north: 'N', 'north-east': 'NE', east: 'E', 'south-east': 'SE', south: 'S', 'south-west': 'SW', west: 'W', 'north-west': 'NW' })[compass(deg)];
Time.onChange(() => Weather.followClock());
setInterval(() => { if (Weather.on && !Time.live && Time.rate) Weather.followClock(); }, 1000);   // a running clock carries the weather along
setInterval(() => { Weather.newRun(); }, 20 * 60e3);

export function initWeather() {
  const el = document.createElement('div'); el.id = 'wx'; el.className = 'glass';
  el.innerHTML = `<div class="wx-head"><b>Weather</b><span id="wxTime">loading…</span><button class="x" aria-label="Close weather">×</button></div>
    <div id="wxSets" class="wx-sets"></div>
    <div id="wxModels" class="wx-models"></div>
    <div class="wx-play"><button id="wxPlay" class="chipbtn" aria-label="Play or pause">▶</button><input id="wxSlider" type="range" min="0" max="${FRAMES - 1}" value="${FRAMES - 1}" step="1" aria-label="Time"></div>
    <div id="wxScale" class="wx-scale"></div>
    <div id="wxLegend" class="wx-legend"></div>
    <div id="wxRead" class="wx-read" hidden></div>
    <div id="wxNote" class="note"></div>`;
  document.body.append(el);
  el.querySelector('.x').onclick = () => Weather.close();
  $('#wxPlay').onclick = () => Weather.play(!Weather.playing);
  $('#wxSlider').oninput = e => { Weather.play(false); Weather.set(+e.target.value); };
  $('#wxSets').onclick = e => { const b = e.target.closest('[data-set]'); if (!b) return; const s = Weather.sets[b.dataset.set]; s.on = !s.on; b.classList.toggle('on', s.on); Weather.show(); };
  $('#wxModels').onclick = e => {
    const b = e.target.closest('[data-model],[data-compare]'); if (!b) return;
    if (b.dataset.compare) Weather.setModel(Weather.modelId, !Weather.compare);
    else if (b.dataset.model !== Weather.modelId) Weather.setModel(b.dataset.model);
    Weather.build();
  };
  // the readout: what every loaded field is where the pointer rests (a tap on touch screens)
  const canvas = viewer.scene.canvas; let last = 0, tid = 0;
  const read = (x, y) => {
    if (!Weather.on) return;
    const g = viewer.camera.pickEllipsoid(new C.Cartesian2(x, y), C.Ellipsoid.WGS84);
    if (!g) { Weather.readout(null); return; }
    const c = C.Cartographic.fromCartesian(g); Weather.readout({ lat: C.Math.toDegrees(c.latitude), lon: C.Math.toDegrees(c.longitude) });
  };
  canvas.addEventListener('pointermove', e => {
    if (!Weather.on || e.pointerType !== 'mouse' || e.buttons) return;
    clearTimeout(tid); const now = performance.now(), x = e.offsetX, y = e.offsetY;
    if (now - last > 120) { last = now; read(x, y); } else tid = setTimeout(() => read(x, y), 130);
  }, { passive: true });
  canvas.addEventListener('pointerup', e => { if (Weather.on && e.pointerType !== 'mouse') read(e.offsetX, e.offsetY); }, { passive: true });
  addEventListener('resize', () => { if (Weather.compare && Weather.on) Weather.placeSplit(); });
}
