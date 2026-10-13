// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The sea and the air, as on the 3D globe: NOAA NDBC buoys and DART tsunami buoys (NDBC sends no CORS: the helper or
// the website's relay), NOAA CO-OPS tide gauges, sea-surface temperature and smoke and dust as NASA GIBS tiles, and the
// CAMS air-quality model from Open-Meteo on a grid over the view. Parsing and the cards' words: core/ocean.js.
import { esc, Net } from './util.js';
import { map } from './mapview.js';
import { Layers, Points, Sel, feed } from './engine.js';
import { Detail } from './detail.js';
import { num } from '../core/format.js';
import {
  NDBC_LATEST, NDBC_STATIONS, NDBC_TYPES, parseNdbcLatest, parseNdbcStations, mergeNdbc, waveLook, buoyRows, agoWords,
  dartUrl, ndbcPage, parseDart, dartStatus, DART_MODES,
  COOPS_STATIONS, parseCoopsStations, coopsDatum, coopsUrl, parseCoopsLatest, parseCoopsHilo, nextTides, tideRows, coopsPage,
  SEA_AIR_IMAGERY, gibsDomainUrl, parseGibsDomain, aqUrl, parseAirQuality, aqiLook, aqGrid, aqRows,
} from '../core/ocean.js';

const G = 'Sea & sky', center = o => `<div class="actions"><button class="btn small" onclick="flyTo(${num(o.lat)},${num(o.lon)},8)">Center</button></div><hr class="sep">`;
const foot = t => `<p style="font-size:11.5px;color:var(--ink-faint)">${esc(t)}</p>`;
let stationsP = null;
const stations = () => stationsP || (stationsP = Net.text(NDBC_STATIONS, { timeout: 60000 }).then(parseNdbcStations).catch(e => { stationsP = null; throw e; }));
const reshow = o => { if (Sel.obj === o) Detail.render(); };   // a card whose fetch landed while it is still shown

/* ---------- buoys and coastal stations */
export const lyBuoys = Layers.add({ id: 'buoys', group: G, name: 'Ocean buoys', desc: 'NOAA NDBC · ~870 buoys and coastal stations · waves, wind, water temperature · latest report, every 10 min', color: '#62e0c8', shape: 'round', default: false, points: 'buoys' });
Points.define('buoys', 'buoys');
Detail.renderers.buoy = o => `<div class="det">${Detail.head(waveLook(o.waveM)[1], 'NOAA NDBC · ' + (NDBC_TYPES[o.type] || NDBC_TYPES.other), o.name || 'Station ' + o.id, esc(o.id + (o.owner ? ' · ' + o.owner : '')))}
${Detail.kv(buoyRows(o))}${center(o)}${Detail.links([{ text: 'NDBC station page', url: ndbcPage(o.id) }])}${foot('Each station reports about once an hour; this is its latest report. Significant wave height is the average of the highest third of the waves. NOAA National Data Buoy Center (public domain).')}</div>`;
feed(lyBuoys, { interval: 600, fetch: async () => {
  const [txt, st] = await Promise.all([Net.text(NDBC_LATEST, { timeout: 60000 }), stations().catch(() => [])]);
  const items = mergeNdbc(parseNdbcLatest(txt), st).map(o => ({ lat: o.lat, lon: o.lon, r: o.waveM != null ? 4 : 3, color: waveLook(o.waveM)[1], kind: 'buoy', obj: o,
    tip: `${o.name || o.id}${o.waveM != null ? ` · waves ${o.waveM.toFixed(1)} m` : ''}${o.waterC != null ? ` · water ${o.waterC.toFixed(1)} °C` : ''}` }));
  Points.set('buoys', items); lyBuoys.feed.count = items.length;
} });

/* ---------- DART tsunami buoys: the card reads the buoy's own file */
export const lyDart = Layers.add({ id: 'dart', group: G, name: 'Tsunami buoys (DART)', desc: 'NOAA · ~75 sea-floor pressure sensors · tap one for its water column and event mode', color: '#ffd45c', shape: 'round', default: false, points: 'dart' });
Points.define('dart', 'dart');
const DART_LOOK = { event: '#ff4d6d', standard: '#ffd45c', late: '#c9a35a', silent: '#8b9bab' };
Detail.renderers.dart = o => {
  if (!o.read) { o.read = Net.text(dartUrl(o.id), { timeout: 60000 }).then(t => { o.d = parseDart(t, { max: 200 }); }, e => { o.err = e.message; }).finally(() => reshow(o)); }
  const s = o.d && dartStatus(o.d), l = o.d?.latest;
  const rows = o.d ? [['Status', s.words], ...(l ? [['Water column', `${l.heightM.toFixed(3)} m above the sensor`], ['Sampling', DART_MODES[l.mode] || 'mode ' + l.mode], ['Last reading', agoWords(l.t, Date.now(), true)]] : []), ...(s.rangeM != null ? [['Change, last 6 h', `${s.rangeM.toFixed(3)} m (mostly the tide)`]] : [])]
    : [['Status', o.err ? 'NDBC is not answering: ' + o.err : 'reading the buoy…']];
  return `<div class="det">${Detail.head(s ? DART_LOOK[s.state] : DART_LOOK.standard, 'NOAA DART · tsunami buoy', o.name || o.id, esc(o.id + (o.owner ? ' · ' + o.owner : '')))}${Detail.kv(rows)}${center(o)}${Detail.links([{ text: 'NDBC station page', url: ndbcPage(o.id) }, { text: 'Tsunami warnings (tsunami.gov)', url: 'https://www.tsunami.gov/' }])}
${foot('A pressure sensor on the sea floor measures the water above it; tides move it by a metre or more. A sudden change, a quake or a test switches it into event mode (15-second and 1-minute readings) for a few hours. NOAA NDBC (public domain).')}</div>`;
};
feed(lyDart, { interval: 3600, fetch: async () => {
  const items = (await stations()).filter(s => s.type === 'dart').map(o => ({ lat: o.lat, lon: o.lon, r: 4.5, color: o.dartData ? DART_LOOK.standard : DART_LOOK.silent, kind: 'dart', obj: o, tip: `DART ${o.id} · ${o.name}` }));
  Points.set('dart', items); lyDart.feed.count = items.length;
} });

/* ---------- CO-OPS tide gauges: the card reads the level now and the next high and low */
export const lyTides = Layers.add({ id: 'tides', group: G, name: 'Tide gauges (US)', desc: 'NOAA CO-OPS · ~300 gauges on US coasts and the Great Lakes · tap one for the level now and the next high and low', color: '#5fd3ff', shape: 'round', default: false, points: 'tides' });
Points.define('tides', 'tides');
async function readTide(o) {
  let datum = coopsDatum(o), latest = parseCoopsLatest(await Net.json(coopsUrl(o.id, 'latest', { datum })));
  const alt = /Datum values are:\s*([A-Z]{3,4})/.exec(latest.error || ''); if (alt) { datum = alt[1]; latest = parseCoopsLatest(await Net.json(coopsUrl(o.id, 'latest', { datum }))); }
  const tides = o.tidal ? nextTides(parseCoopsHilo(await Net.json(coopsUrl(o.id, 'hilo', { datum })).catch(() => ({})))) : null;
  o.rows = tideRows({ ...o, tidal: datum === 'MLLW', greatLakes: datum === 'IGLD' }, latest, tides);
}
Detail.renderers.tide = o => {
  if (!o.read) o.read = readTide(o).catch(e => { o.err = e.message; }).finally(() => reshow(o));
  return `<div class="det">${Detail.head(o.greatLakes ? '#9fe3ff' : '#5fd3ff', 'NOAA CO-OPS · ' + (o.greatLakes ? 'lake level gauge' : o.tidal ? 'tide gauge' : 'water level gauge'), o.name + (o.state ? ', ' + o.state : ''), esc(o.id))}
${Detail.kv(o.rows || [['Water level', o.err ? 'NOAA is not answering: ' + o.err : 'reading the gauge…']])}${center(o)}${Detail.links([{ text: 'NOAA Tides & Currents page', url: coopsPage(o.id) }])}
${foot('Measured every 6 minutes (preliminary until checked); highs and lows are NOAA\'s astronomical predictions, so wind and pressure can push the water above or below them. NOAA CO-OPS (public domain).')}</div>`;
};
feed(lyTides, { interval: 86400, fetch: async () => {
  const items = parseCoopsStations(await Net.json(COOPS_STATIONS, { timeout: 60000 })).map(o => ({ lat: o.lat, lon: o.lon, r: 3.5, color: o.greatLakes ? '#9fe3ff' : '#5fd3ff', kind: 'tide', obj: o, tip: `Tide gauge · ${o.name}${o.state ? ', ' + o.state : ''}` }));
  Points.set('tides', items); lyTides.feed.count = items.length;
} });

/* ---------- sea-surface temperature and smoke: GIBS tiles of the newest day */
const pane = map.createPane('seaair', map.getPane('tilePane')); pane.style.zIndex = 380; pane.style.pointerEvents = 'none';
function gibsLayer(id, lyId, words) {
  const spec = SEA_AIR_IMAGERY[id], ly = Layers.add({ id: lyId, group: G, name: spec.name, desc: words, color: id === 'sst' ? '#ff9f5c' : '#c9a07a', default: false });
  let tiles = null;
  ly.enable = () => { if (tiles) tiles.addTo(map); }; ly.disable = () => { if (tiles) map.removeLayer(tiles); };
  feed(ly, { interval: 3 * 3600, fetch: async () => {
    const day = parseGibsDomain(await Net.text(gibsDomainUrl(spec))) || 'default', lvl = id === 'sst' ? 7 : 6;
    if (tiles && tiles.options.day === day) { ly.feed.count = 1; return; }
    if (tiles) map.removeLayer(tiles);
    tiles = L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${spec.layer}/default/${day}/GoogleMapsCompatible_Level${lvl}/{z}/{y}/{x}.png`, { day, pane: 'seaair', opacity: id === 'sst' ? .8 : .75, maxNativeZoom: lvl, attribution: spec.credit });
    if (ly.on) tiles.addTo(map);
    ly.desc = `${words} · ${day}`; ly.feed.count = 1;
  } });
  return ly;
}
export const lySst = gibsLayer('sst', 'sst', 'NASA GHRSST MUR · daily, ~1 km · purple 0 °C, blue 10, green 18, yellow 22, red 30 °C');
export const lySmoke = gibsLayer('smoke', 'smoke', 'Suomi NPP OMPS UV aerosol index · the UTC day\'s orbits so far · yellow from about 1 (smoke or dust), red at 3+');

/* ---------- air quality: the CAMS model on a grid over the view */
export const lyAirq = Layers.add({ id: 'airq', group: G, name: 'Air quality (modelled)', desc: 'CAMS via Open-Meteo · PM2.5, ozone, NO2 and the US AQI on a grid over the view · a model, not a sensor', color: '#ffe066', shape: 'round', default: false, points: 'airq' });
Points.define('airq', 'airq');
Detail.renderers.airq = q => `<div class="det">${Detail.head(aqiLook(q.usAqi)[1], 'Air quality · CAMS model via Open-Meteo', aqiLook(q.usAqi)[0], esc(`${q.lat.toFixed(2)}°, ${q.lon.toFixed(2)}°`))}${Detail.kv(aqRows(q))}${center(q)}
${foot('A forecast model\'s value for this hour, not a sensor\'s (about 11 km over Europe, 45 km elsewhere): a busy street or a nearby fire can be worse. Generated using Copernicus Atmosphere Monitoring Service information; served by Open-Meteo (CC BY 4.0). OpenAQ\'s stations need an API key.')}</div>`;
feed(lyAirq, { interval: 1800, viewDependent: true, fetch: async () => {
  const b = map.getBounds(), { points } = aqGrid(Math.max(-180, b.getWest()), Math.max(-80, b.getSouth()), Math.min(180, b.getEast()), Math.min(80, b.getNorth()), 48);
  if (!points.length) { Points.set('airq', []); lyAirq.feed.count = 0; return; }   // no view yet (a hidden map has no size)
  const got = parseAirQuality(await Net.json(aqUrl(points)));
  const items = got.map((q, i) => ({ ...q, lat: points[i].lat, lon: points[i].lon })).filter(q => q.usAqi != null)
    .map(q => ({ lat: q.lat, lon: q.lon, r: 7, fillAlpha: .8, color: aqiLook(q.usAqi)[1], kind: 'airq', obj: q, tip: `AQI ${Math.round(q.usAqi)} ${aqiLook(q.usAqi)[0].toLowerCase()}${q.pm25 != null ? ` · PM2.5 ${q.pm25.toFixed(1)} µg/m³` : ''} (model)` }));
  Points.set('airq', items); lyAirq.feed.count = items.length;
} });
