// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// A shared view as a URL hash, and back. Pure functions (the globe's share.js reads and applies them):
//   #c=lon,lat,height,heading,pitch  &l=layer,ids,on  &w=ir,wind  &t=julianDate,rate  &k=ISO2  &f=CALLSIGN (a flight to find)
//   &o=nvg.h.d (Ops: sensor, then h = tactical HUD, d = detection boxes)
//   &d=... the draw-and-measure drawing: pins, lines, areas, distances, country outlines (measure.js encodeDrawing)
//   &a=ids,on  &x=ids,off  layers to switch on or off, leaving the others as the visitor has them (links made elsewhere,
//   e.g. by the MCP server, which can't know a visitor's layers)  &s=25544 a satellite to follow (NORAD catalogue number)
//   #go=tonight opens a panel by itself (no camera needed): see GO; &id= names one launch (LL2 id) or eclipse (date) in it
//   &at=lat,lon&name=Pune: the place Tonight answers for (tonight.html#at=... or globe.html#go=tonight&at=...), rounded to
//   0.01 deg (~1 km, as a saved home is); tonight.html also takes &embed=1&sections=passes,planets (a card for an <iframe>)

import { SENSORS } from './voicecmd.js';
import { encodeDrawing, decodeDrawing } from './measure.js';

const r = (v, n) => +Number(v).toFixed(n);
const FLIGHT = /^[A-Za-z0-9]{2,8}$/, NORAD = /^\d{1,9}$/;
/** Panels a link may open on arrival (#go=...). Nothing that needs a tap first (look-up asks for motion sensors). */
export const GO = Object.freeze(['tonight', 'flight', 'search', 'launches', 'crew', 'eclipses', 'flybys', 'conj', 'reentry', 'now', 'history']);

/** The parts of a hash that work without a camera: { go: 'tonight' | null, flight: 'BAW123' | null }. */
export function decodeExtras(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, '')), go = p.get('go'), f = p.get('f'), id = p.get('id');
  return { go: GO.includes(go) ? go : null, flight: f && FLIGHT.test(f) ? f.toUpperCase() : null, id: id && /^[\w.-]{1,40}$/.test(id) ? id : null, at: placeOf(p) };
}

// ---- Tonight for a place: #at=lat,lon[&name=...]. Only the hash carries it (never a query string, never a server).
const DEG = /^-?\d{1,3}(\.\d+)?$/;
/** A place's name from a link: at most 60 characters, no control characters or angle brackets (it is escaped where shown too). */
export const placeName = n => { const s = String(n == null ? '' : n).replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60).trim(); return s || null; };
function placeOf(p) {
  const at = (p.get('at') || '').split(',');
  if (at.length !== 2 || !at.every(x => DEG.test(x))) return null;
  const lat = r(at[0], 2) + 0, lon = r(at[1], 2) + 0;   // + 0: no "-0"
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const name = p.has('name') ? placeName(p.get('name')) : null;
  return name ? { lat, lon, name } : { lat, lon };
}
/** The hash for Tonight at a place: 'at=18.52,73.86&name=Pune' (rounded to 0.01 deg), or '' for a place that is not one. */
export function tonightHash(pl) {
  if (!pl || !Number.isFinite(pl.lat) || !Number.isFinite(pl.lon) || Math.abs(pl.lat) > 90 || Math.abs(pl.lon) > 180) return '';
  const name = placeName(pl.name);
  return `at=${r(pl.lat, 2) + 0},${r(pl.lon, 2) + 0}${name ? '&name=' + encodeURIComponent(name) : ''}`;
}
/** The card's sections a Tonight embed can show (&sections=passes,planets): key -> the headings it opens. */
export const TONIGHT_SECTIONS = Object.freeze({ clouds: ['Clouds tonight'], sky: ['Your sky'], passes: ['Satellites you can see'], planets: ['Planets'], deepsky: ['Deep sky tonight'],
  meteors: ['Meteor showers'], launches: ['Rocket launches'], sun: ['Sun', 'The Sun now'], moon: ['Moon'], aurora: ['Aurora'], coming: ['Coming up in the sky'],
  eclipse: ['Next solar eclipse you can see', 'Solar eclipses'], far: ['Farthest from home'] });
/** tonight.html's hash: { at: { lat, lon, name? } | null, embed: bool, sections: [keys] | null (null = the card as it is) }. */
export function decodeTonight(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const sections = p.has('sections') ? [...new Set(p.get('sections').split(',').filter(k => Object.hasOwn(TONIGHT_SECTIONS, k)))] : [];
  return { at: placeOf(p), embed: p.get('embed') === '1', sections: sections.length ? sections : null };
}
/** The headings a list of section keys opens (the rest fold shut in an embed). */
export const tonightHeadings = keys => new Set((keys || []).flatMap(k => TONIGHT_SECTIONS[k] || []));

/** view: { lon, lat, height, heading, pitch (degrees, metres), layers: [ids], weather: [ids] | null, time: { jd, rate } | null, country: 'JP' | null } */
export function encodeView(v) {
  const p = new URLSearchParams();
  p.set('c', [r(v.lon, 4), r(v.lat, 4), Math.round(v.height), r(v.heading, 1), r(v.pitch, 1)].join(','));
  if (v.layers) p.set('l', v.layers.join(','));
  if (v.weather) p.set('w', v.weather.join(','));
  if (v.time) p.set('t', r(v.time.jd, 5) + ',' + v.time.rate);
  if (v.country) p.set('k', v.country);
  if (v.flight && FLIGHT.test(v.flight)) p.set('f', v.flight);
  if (v.ops && (v.ops.sensor !== 'normal' || v.ops.hud || v.ops.detect)) p.set('o', [SENSORS.includes(v.ops.sensor) ? v.ops.sensor : 'normal', v.ops.hud ? 'h' : '', v.ops.detect ? 'd' : ''].filter(Boolean).join('.'));
  if (v.drawing && v.drawing.length) { const d = encodeDrawing(v.drawing); if (d) p.set('d', d); }   // left out when it would not fit a link
  if (v.add && v.add.length) p.set('a', v.add.join(','));
  if (v.drop && v.drop.length) p.set('x', v.drop.join(','));
  if (v.sat && NORAD.test(String(v.sat))) p.set('s', String(+v.sat));
  return p.toString();
}

/** The view in a hash ('#c=...'), or null if it is not a usable link. Nothing here is trusted: numbers are checked, ids are limited. */
export function decodeView(hash) {
  if (!hash || hash.length < 4) return null;
  const p = new URLSearchParams(hash.replace(/^#/, '')), c = (p.get('c') || '').split(',').map(Number);
  if (c.length < 3 || c.slice(0, 3).some(x => !Number.isFinite(x)) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90 || c[2] < 0 || c[2] > 1e10) return null;
  const ids = s => (s || '').split(',').filter(x => /^[a-z0-9_-]{1,24}$/i.test(x)).slice(0, 60);
  const out = { lon: c[0], lat: c[1], height: c[2], heading: Number.isFinite(c[3]) ? c[3] : 0, pitch: Number.isFinite(c[4]) ? c[4] : -90, layers: p.has('l') ? ids(p.get('l')) : null, weather: p.has('w') ? ids(p.get('w')) : null, time: null, country: null };
  if (p.has('t')) { const [jd, rate] = p.get('t').split(',').map(Number); if (Number.isFinite(jd) && jd > 2000000 && jd < 3000000) out.time = { jd, rate: Number.isFinite(rate) ? rate : 1 }; }
  if (/^[A-Z]{2}$/.test(p.get('k') || '')) out.country = p.get('k');
  out.flight = decodeExtras(hash).flight;
  const o = (p.get('o') || '').split('.');
  if (p.has('o')) out.ops = { sensor: SENSORS.includes(o[0]) ? o[0] : 'normal', hud: o.includes('h'), detect: o.includes('d') };   // only when the link has it: older views decode as before
  if (p.has('d')) { const d = decodeDrawing(p.get('d')); if (d.length) out.drawing = d; }   // likewise: only what checks out
  if (p.has('a')) out.add = ids(p.get('a'));
  if (p.has('x')) out.drop = ids(p.get('x'));
  if (NORAD.test(p.get('s') || '')) out.sat = String(+p.get('s'));
  return out;
}

// ---- the 2D map's zoom and the globe's camera height: a link made on one opens the same area on the other. At zoom z a
// Web Mercator pixel is 40,075 km × cos(lat) / (256 × 2^z); a ~950 px wide map then spans what a 60° camera sees from
// about this height (checked against both views: London at zoom 12 ≈ 20 km up).
const EQUATOR_M = 40075016.686, MAP_PX = 950, FOV_K = 1.15;
/** The globe camera height (m) that shows about what the 2D map shows at zoom z, latitude lat. */
export const zoomToHeight = (z, lat = 0) => Math.round(EQUATOR_M * Math.max(0.05, Math.cos(lat * Math.PI / 180)) / 2 ** z * MAP_PX / 256 / FOV_K);
/** The 2D map zoom for a globe camera height (m), at latitude lat: 2..19, in half steps (the map's zoomSnap). */
export const heightToZoom = (h, lat = 0) => Math.min(19, Math.max(2, Math.round(2 * Math.log2(EQUATOR_M * Math.max(0.05, Math.cos(lat * Math.PI / 180)) * MAP_PX / 256 / FOV_K / Math.max(1, h))) / 2));

// ---- layers across the two views: the 2D map's layer ids → the globe's, for links from one to the other (as &a=, so the
// other view's own layers stay as its visitor has them)
export const MAP_TO_GLOBE = Object.freeze({ quakes: 'quakes', storms: 'storms', cams: 'cams', transit: 'transit', bikes: 'bikes', aurora: 'aurora', ships_fi: 'ships',
  hotspots: 'fires', fireperims: 'fires', fires: 'fires', terminator: 'sun', air_mil: 'mil', air_local: 'air', air_opensky: 'air', airports: 'airports',
  buoys: 'buoys', dart: 'dart', tides: 'tides', sst: 'sst', smoke: 'smoke', airq: 'airq', lightpollution: 'lightpollution' });
// the 2D map's forecast layers ↔ the globe's weather mode (its `w=` list): the model's fields have the same names; the
// globe's clouds and rain sets show the model's cloud and rain on their forecast steps
export const MAP_TO_WEATHER = Object.freeze({ wx_wind: 'wind', wx_temp: 'temp', wx_pres: 'pres', wx_gust: 'gust', wx_wave: 'wave', wx_cloud: 'ir', wx_rain: 'radar' });
/** The globe's `w=` list for these 2D map layers and model ('gfs' | 'ecmwf'), or null when none of them is a forecast layer. */
export function weatherFor(mapIds, model = 'gfs') {
  const w = [...new Set(mapIds.map(id => MAP_TO_WEATHER[id]).filter(Boolean))];
  return w.length ? [...w, ...(model === 'ecmwf' ? ['ecmwf'] : [])] : null;
}
/** The 2D map's forecast layers and model for a globe `w=` list: { layers, model }. */
export function mapWeatherFor(w) {
  const list = Array.isArray(w) ? w : [];
  return { layers: Object.keys(MAP_TO_WEATHER).filter(id => list.includes(MAP_TO_WEATHER[id])), model: list.includes('ecmwf') ? 'ecmwf' : 'gfs' };
}
/** The globe layers that show what these 2D map layers show. */
export const globeLayersFor = mapIds => [...new Set(mapIds.map(id => MAP_TO_GLOBE[id]).filter(Boolean))];
/** The 2D map layers that show what these globe layers show. */
export const mapLayersFor = globeIds => Object.keys(MAP_TO_GLOBE).filter(m => globeIds.includes(MAP_TO_GLOBE[m]) && !['fires', 'air_local', 'air_opensky'].includes(m));
