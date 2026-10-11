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
//  Forecast, every 3 hours (GFS, 1°: model.js, wind.js): cloud cover and rain rate take the place of the satellite and
//  radar pictures; wind and temperature run along the whole timeline.
// Nothing is fetched until the mode is opened. Frames are Cesium imagery layers made on demand; only the current frame (and
// the next, while playing) is shown, so the GPU holds a few tiles, not the whole loop.
import { C, $, toast, PHONE } from './env.js';
import { viewer, camHeight } from './viewer.js';
import { Earth } from './earth.js';
import { state, hooks } from './state.js';
import { PRESETS } from './ui.js';
import { Wind } from './wind.js';
import { Model, MAX_H } from './model.js';
import { Time } from './time.js';
import { timeline, relTime } from '../core/gfs.js';
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
const hhmm = ms => new Date(ms).toISOString().slice(11, 16) + ' UTC';
const dayTime = ms => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

async function haveWms(layer, time, minBytes) {   // whole-world 256x128 image: WMS answers a missing time with a blank image (WMTS: a 404 without CORS headers)
  try { const r = await fetch(`https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=256&HEIGHT=128&FORMAT=image/png&TRANSPARENT=true&TIME=${time}`); return r.ok && (await r.blob()).size > minBytes; } catch (e) { return false; }
}
async function latest(layer, step, from, to, minBytes) {   // newest time (ms) in [to, from] that has data
  for (let t = Math.floor(from / step) * step; t >= to; t -= step) if (await haveWms(layer, iso(t), minBytes)) return t;
  return null;
}

export const Weather = {
  on: false, playing: false, frame: FRAMES - 1, timer: 0, ready: null, layers: new Map(), frames: [], clockSet: false, selfClock: false, following: false,
  sets: { ir: { name: 'Clouds', on: true }, radar: { name: 'Rain', on: true }, rain: { name: 'Rain from space', on: false }, lightning: { name: 'Lightning (Americas)', on: true }, wind: { name: 'Wind', on: false }, temp: { name: 'Temperature', on: false } },
  ir: [], radar: [], rainAt: 0, run: null,

  async init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const now = Date.now();
      const [ir, rainAt, maps, run] = await Promise.all([
        Promise.all(SATS.map(async ([layer]) => ({ layer, latest: await latest(layer, 600e3, now - 25 * 60e3, now - 4 * 3600e3, 2000) }))),
        latest('IMERG_Precipitation_Rate_30min', 1800e3, now - 3 * 3600e3, now - 30 * 3600e3, 1500),
        fetch('https://api.rainviewer.com/public/weather-maps.json').then(r => r.json()).catch(() => null),
        Model.ready().catch(e => { console.warn('weather model', e.message); return null; })]);
      this.ir = ir.filter(s => s.latest); this.rainAt = rainAt || 0; this.run = run;
      this.radar = maps && maps.radar ? maps.radar.past.map(f => ({ time: f.time * 1000, url: maps.host + f.path })) : [];
      this.end = this.ir.length ? Math.max(...this.ir.map(s => s.latest)) : Math.max(0, ...this.radar.map(f => f.time));   // the observed frames run on the satellites' clock; radar follows to the nearest frame
      if (!this.end && run) this.end = Math.floor(now / STEP) * STEP;   // no pictures at all: the forecast still works
      if (!this.end) throw new Error('no weather data reachable');
      this.frames = timeline({ obsEnd: this.end, obs: FRAMES, obsStep: STEP, run, until: now + MAX_H * 3600e3 });
    })().catch(e => { this.ready = null; throw e; });
    return this.ready;
  },
  /** A newer model run is out (every 6 h): rebuild the forecast part of the timeline on it. */
  async newRun() {
    if (!this.on || !(await Model.refresh().catch(() => false))) return;
    const f = this.frames[this.frame]; this.run = Model.run;
    this.frames = timeline({ obsEnd: this.end, obs: FRAMES, obsStep: STEP, run: this.run, until: Date.now() + MAX_H * 3600e3 });
    this.frame = f ? this.nearest(f.t) : FRAMES - 1; this.build(); this.show();
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
    const kinds = [...(S.wind.on ? ['wind'] : []), ...(S.temp.on ? ['temp'] : []), ...(cloud ? ['cloud'] : []), ...(rain ? ['rain'] : [])];
    if (this.on && kinds.length) {
      Wind.moment(f.t, kinds).then(model => { if (!model && fc && (cloud || rain)) toast('The weather model is not reachable right now: no forecast pictures', 3500); this.label(); });
      if (this.playing && next) Model.prefetch(next.t, kinds);
    }
    const field = (on, set) => (on ? set(true) : set(false)).catch(() => { toast('Weather model data is not reachable right now'); });
    field(this.on && S.wind.on, on => Wind.setWind(on)); field(this.on && S.temp.on, on => Wind.setWash('temp', on));
    field(cloud, on => Wind.setWash('cloud', on)); field(rain, on => Wind.setWash('rain', on));
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
    $('#wxTime').textContent = f.fcst ? `${dayTime(f.t)} · ${rel} · forecast` : `${hhmm(f.t)} · ${rel === 'now' ? 'just now' : rel.replace('−', '') + ' ago'} · observed`;
    $('#wxSlider').value = this.frame; $('#wxPlay').textContent = this.playing ? '❚❚' : '▶';
    const model = (this.sets.wind.on || this.sets.temp.on || f.fcst) && Wind.note() ? ` Model: ${Wind.note()}.` : '';
    const obs = f.fcst ? (this.run ? 'Forecast: clouds and rain from the model, every 3 hours.' : 'No forecast reachable.')
      : (this.ir.length ? `Infrared: ${this.ir.length} of 3 satellites reached.` : 'No infrared images reachable.') + (this.sets.radar.on && !this.radar.length ? ' Radar unreachable.' : '')
        + (this.sets.rain.on && this.rainAt ? ` Rain from space: ${hhmm(this.rainAt)}.` : '');
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
    Wind.setWind(false); Wind.dropWashes();
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
  build() {
    $('#wxSets').innerHTML = Object.entries(this.sets).map(([id, s]) => `<button class="chipbtn${s.on ? ' on' : ''}" data-set="${id}">${s.name}</button>`).join('');
    const n = this.frames.length, obs = this.frames.filter(f => !f.fcst).length;
    $('#wxSlider').max = Math.max(0, n - 1);
    const split = n > 1 ? (obs - 0.5) / (n - 1) * 100 : 100, last = this.frames[n - 1];
    $('#wxScale').innerHTML = `<span style="flex:0 0 ${split.toFixed(1)}%">◀ past</span><span class="fc">${last && last.fcst ? `forecast to ${dayTime(last.t)} ▶` : 'no forecast reachable'}</span>`;
  },
};
Time.onChange(() => Weather.followClock());
setInterval(() => { if (Weather.on && !Time.live && Time.rate) Weather.followClock(); }, 1000);   // a running clock carries the weather along
setInterval(() => { Weather.newRun(); }, 20 * 60e3);

export function initWeather() {
  const el = document.createElement('div'); el.id = 'wx'; el.className = 'glass';
  el.innerHTML = `<div class="wx-head"><b>Weather</b><span id="wxTime">loading…</span><button class="x" aria-label="Close weather">×</button></div>
    <div id="wxSets" class="wx-sets"></div>
    <div class="wx-play"><button id="wxPlay" class="chipbtn" aria-label="Play or pause">▶</button><input id="wxSlider" type="range" min="0" max="${FRAMES - 1}" value="${FRAMES - 1}" step="1" aria-label="Time"></div>
    <div id="wxScale" class="wx-scale"></div>
    <div id="wxNote" class="note"></div>`;
  document.body.append(el);
  el.querySelector('.x').onclick = () => Weather.close();
  $('#wxPlay').onclick = () => Weather.play(!Weather.playing);
  $('#wxSlider').oninput = e => { Weather.play(false); Weather.set(+e.target.value); };
  $('#wxSets').onclick = e => { const b = e.target.closest('[data-set]'); if (!b) return; const s = Weather.sets[b.dataset.set]; s.on = !s.on; b.classList.toggle('on', s.on); Weather.show(); };
}
