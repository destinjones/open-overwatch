// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Sea and air as pictures and a grid: sea-surface temperature (GHRSST MUR, daily, ~1 km, gap-free) and smoke and dust
// (Suomi NPP OMPS's UV aerosol index, today's orbits) as NASA GIBS imagery layers with a legend made from GIBS's own
// colour maps; clicking the sea while one is on reads the value back from the tile's pixel. Air quality: the CAMS model's
// current hour (PM2.5, PM10, ozone, NO2, the US and European AQI) from Open-Meteo on a grid over the view (OpenAQ's
// station measurements need an API key since v3; this needs none). All keyless and sent with CORS.
import { C, $, esc, toast, getText, getJSON, PHONE } from './env.js';
import { viewer, scene, camera } from './viewer.js';
import { L, setCount } from './layers.js';
import { state, hooks } from './state.js';
import { Earth } from './earth.js';
import {
  SEA_AIR_IMAGERY, gibsGeoUrl, gibsColormapUrl, gibsDomainUrl, parseGibsDomain, parseGibsColormap, colormapValue, legendStops, gibsPixel,
  aqUrl, parseAirQuality, aqiLook, aqGrid, aqRows, tempWords,
} from '../core/ocean.js';

const SCHEME = () => new C.GeographicTilingScheme({ rectangle: C.Rectangle.fromDegrees(-180, -198, 396, 90), numberOfLevelZeroTilesX: 2, numberOfLevelZeroTilesY: 1 });   // see earth.js
const ALPHA = { sst: 0.85, smoke: 0.8 };
const rows = list => '<dl>' + list.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>';

// ---------------------------------------------------------------- the imagery layers and their legend
const img = Object.fromEntries(Object.keys(SEA_AIR_IMAGERY).map(id => [id, { layer: null, date: null, cm: null, loading: null }]));
async function prepare(id) {
  const spec = SEA_AIR_IMAGERY[id], s = img[id];
  const [dom, cm] = await Promise.all([getText(gibsDomainUrl(spec), { timeout: 30000 }).then(parseGibsDomain).catch(() => null), getText(gibsColormapUrl(spec.colormap), { timeout: 30000 }).then(parseGibsColormap)]);
  s.date = dom; s.cm = cm;
  const p = new C.UrlTemplateImageryProvider({ url: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${spec.layer}/default/${dom || 'default'}/${spec.matrix}/{z}/{y}/{x}.png`, tilingScheme: SCHEME(),
    rectangle: C.Rectangle.fromDegrees(-180, -90, 180, 90), tileWidth: 512, tileHeight: 512, maximumLevel: spec.maxLevel, credit: new C.Credit(spec.credit) });
  s.layer = viewer.imageryLayers.addImageryProvider(p); s.layer.alpha = ALPHA[id];
}
let legendEl = null;
function legend() {
  const on = Object.keys(img).filter(id => L[id].on && img[id].cm);
  if (!on.length || state.lookup) { if (legendEl) legendEl.style.display = 'none'; return; }
  if (!legendEl) { legendEl = document.createElement('div'); legendEl.id = 'seaLegend'; legendEl.setAttribute('role', 'note'); document.body.appendChild(legendEl);
    Object.assign(legendEl.style, { position: 'fixed', right: PHONE ? '8px' : '72px', bottom: PHONE ? '150px' : '96px', zIndex: 5, background: 'rgba(8,14,22,.82)', border: '1px solid rgba(255,255,255,.12)', borderRadius: '8px', padding: '7px 10px', font: '11.5px/1.35 system-ui,sans-serif', color: '#e6edf3', maxWidth: PHONE ? '62vw' : '300px', pointerEvents: 'none' }); }
  legendEl.innerHTML = on.map(id => {
    const spec = SEA_AIR_IMAGERY[id], s = img[id], stops = legendStops(s.cm, 12), unit = spec.unit ? ' ' + spec.unit : '';
    const grad = stops.map((x, i) => `${x.color} ${Math.round(i / (stops.length - 1) * 100)}%`).join(',');
    return `<div style="margin:2px 0 6px"><b>${esc(spec.name)}</b><div style="height:9px;border-radius:3px;margin:4px 0 2px;background:linear-gradient(90deg,${grad})"></div>`
      + `<div style="display:flex;justify-content:space-between;color:#aebccb"><span>${esc(s.cm.minLabel || String(s.cm.min))}${esc(unit)}</span><span>${esc(String((s.cm.min + s.cm.max) / 2))}${esc(unit)}</span><span>${esc(s.cm.maxLabel || String(s.cm.max))}${esc(unit)}</span></div>`
      + `<div style="color:#8b9bab">${esc(spec.source)}${s.date ? ' · ' + esc(s.date) : ''}</div></div>`;
  }).join('') + '<div style="color:#8b9bab">Click the sea to read a value.</div>';
  legendEl.style.display = 'block';
}
export const SeaImagery = {
  apply() {
    for (const id of Object.keys(img)) {
      const s = img[id], show = L[id].on && !Earth.hidden && !Earth.covered;
      if (s.layer) { s.layer.show = show; if (show) viewer.imageryLayers.raiseToTop(s.layer); }
      else if (L[id].on && !s.loading) s.loading = prepare(id).then(() => { this.apply(); setCount(id, 0); }).catch(e => { console.warn(id, e.message); toast('NASA GIBS is not answering right now', 3000); }).finally(() => { s.loading = null; });
    }
    legend(); scene.requestRender();
  },
  /** The value of a switched-on imagery layer at a point: { id, value, lo, hi, date } or null. Reads the tile's pixel. */
  async valueAt(id, lon, lat) {
    const spec = SEA_AIR_IMAGERY[id], s = img[id]; if (!s.cm) return null;
    const p = gibsPixel(lon, lat, Math.min(spec.maxLevel, 5));
    const im = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('no tile')); i.src = gibsGeoUrl(spec, p.level, p.row, p.col, s.date || 'default'); });
    const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingEnabled = false;
    cx.drawImage(im, p.x, p.y, 1, 1, 0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data;
    const v = colormapValue(s.cm, d[0], d[1], d[2], d[3]);
    return v && { id, ...v, date: s.date };
  },
};
// clicking the sea (no country there) with a picture layer on: a card with the values under the click
hooks.seaAt = (lon, lat) => {
  const ids = Object.keys(img).filter(id => L[id].on && img[id].cm); if (!ids.length) return false;
  const o = {
    kind: 'searead', lon, lat,
    cardHtml: () => `<div class="k" style="--c:#5fd3ff">NASA GIBS · the picture's value here</div><h2>${lat.toFixed(2)}°, ${lon.toFixed(2)}°</h2><div id="seaBody"><p class="note">Reading…</p></div>`
      + '<div class="note" style="margin-top:8px">Read back from the colour of the map tile: each colour stands for a small range of values, so this is as precise as the picture (±0.1 °C for sea temperature). The sea temperature is a satellite analysis of yesterday before dawn: checked against the thermometers of 40 NOAA buoys on 2026-10-13 it read a median 0.5 °C cooler (−2.1 to +1.8 °C), as the afternoon sun warms the top metre. An aerosol index above about 1 means smoke or dust; 0.5 to 1 is haze.</div>',
    afterCard: async card => {
      const out = [];
      for (const id of ids) {
        const spec = SEA_AIR_IMAGERY[id];
        try { const v = await SeaImagery.valueAt(id, lon, lat); out.push([spec.name, v ? (id === 'sst' ? tempWords(v.value) : v.value.toFixed(spec.digits)) + (v.date ? ` (${v.date})` : '') : 'no data here (land, ice, or a gap between orbits)']); }
        catch (e) { out.push([spec.name, 'the tile did not load']); }
      }
      const b = card.querySelector('#seaBody'); if (b && state.selected === o) b.innerHTML = rows(out);
    },
  };
  hooks.reselect?.(o); return true;
};

// ---------------------------------------------------------------- air quality on a grid over the view
const aqPts = scene.primitives.add(new C.PointPrimitiveCollection());
aqPts.show = false;
const cache = new Map();   // 'lat,lon' → { q, at }
const AQ_TTL = 30 * 60e3, MAX = PHONE ? 30 : 48;
let aqBusy = false, aqLast = 0, aqTimer = 0;
const AqProto = {
  kind: 'airq',
  tip() { return `Air quality (model) · AQI ${this.usAqi == null ? '—' : Math.round(this.usAqi)} ${aqiLook(this.usAqi)[0].toLowerCase()}${this.pm25 != null ? ` · PM2.5 ${this.pm25.toFixed(1)} µg/m³` : ''}`; },
  cardHtml() {
    const [words, color] = aqiLook(this.usAqi);
    return `<div class="k" style="--c:${color}">Air quality · CAMS model via Open-Meteo</div><h2>${esc(words)}</h2>${rows([...aqRows(this), ['Grid point', `${this.lat.toFixed(2)}°, ${this.lon.toFixed(2)}°`]])}`
      + '<div class="note" style="margin-top:8px">A forecast model\'s value for this hour, not a sensor\'s: the Copernicus Atmosphere Monitoring Service (about 11 km over Europe, 45 km elsewhere), so a busy street or a single fire can be worse than this. Generated using Copernicus Atmosphere Monitoring Service information; served by Open-Meteo (CC BY 4.0). OpenAQ\'s ground stations need an API key, so they are not used.</div>';
  },
};
function viewBox() {
  const r = camera.computeViewRectangle(scene.globe.ellipsoid);
  if (!r) return [-180, -60, 180, 75];
  const d = C.Math.toDegrees; let w = d(r.west), e = d(r.east); const s = Math.max(-80, d(r.south)), n = Math.min(80, d(r.north));
  if (e - w > 300 || (e < w && e + 360 - w > 300)) { w = -180; e = 180; }
  return [w, s, e, n];
}
function draw() {
  aqPts.removeAll(); let n = 0;
  const [w, s, e, nn] = viewBox(), { points } = aqGrid(w, s, e, nn, MAX);
  for (const p of points) {
    const c = cache.get(p.lat + ',' + p.lon); if (!c?.q || c.q.usAqi == null) continue;
    const o = Object.assign(Object.create(AqProto), c.q, { lat: p.lat, lon: p.lon });
    aqPts.add({ position: C.Cartesian3.fromDegrees(p.lon, p.lat, 0), pixelSize: PHONE ? 12 : 14, color: C.Color.fromCssColorString(aqiLook(c.q.usAqi)[1]).withAlpha(0.88), outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1.5, id: o });
    n++;
  }
  setCount('airq', n); scene.requestRender();
}
async function refreshAq() {
  if (!L.airq.on || aqBusy) return;
  const [w, s, e, n] = viewBox(), { points } = aqGrid(w, s, e, n, MAX), now = Date.now();
  const need = points.filter(p => { const c = cache.get(p.lat + ',' + p.lon); return !c || now - c.at > AQ_TTL; });
  draw();
  if (!need.length) return;
  if (now - aqLast < 15e3) { clearTimeout(aqTimer); aqTimer = setTimeout(refreshAq, 15e3 - (now - aqLast)); return; }
  aqBusy = true; aqLast = now;
  try {
    for (let i = 0; i < need.length; i += 100) {
      const part = need.slice(i, i + 100), got = parseAirQuality(await getJSON(aqUrl(part), { timeout: 30000 }));
      part.forEach((p, k) => cache.set(p.lat + ',' + p.lon, { q: got[k] || null, at: Date.now() }));
    }
    draw();
  } catch (e) { console.warn('airq', e.message); toast('Open-Meteo\'s air quality is not answering right now', 3000); }
  finally { aqBusy = false; }
}
camera.moveEnd.addEventListener(() => { if (L.airq.on) { clearTimeout(aqTimer); aqTimer = setTimeout(refreshAq, 700); } });
export const AirQuality = {
  apply() {
    aqPts.show = L.airq.on; scene.requestRender();
    if (L.airq.on) refreshAq();
  },
};
