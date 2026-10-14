// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Where a question is about and the view that shows it: a place name (Photon, a free geocoder over OpenStreetMap data) or
// a point with a radius; a camera that frames it; and the link that opens the globe there (the website's own share-link
// format, src/core/viewlink.js, so a link from here is exactly a link someone could have copied from the globe).
import { haversine, destination } from '../src/core/geo.js';
import { encodeView } from '../src/core/viewlink.js';
import { jdFromMs } from '../src/core/time.js';
import { ToolError } from './feeds.mjs';

export const PHOTON = 'https://photon.komoot.io/api/';
const D2R = Math.PI / 180;

/** Every layer the globe has (src/globe/layers.js; test/mcp.test.mjs keeps the two in step). */
export const LAYERS = Object.freeze(['stations', 'visual', 'gnss', 'geo', 'weather', 'starlink', 'active', 'debris', 'launches', 'air', 'mil', 'airq', 'smoke', 'airports', 'quakes', 'transit',
  'buoys', 'dart', 'tides', 'sst', 'ships', 'bikes', 'traffic', 'storms', 'events', 'fires', 'radio', 'lighthouses', 'sun', 'terrain', 'buildings', 'cams', 'cctv', 'alpr', 'milareas', 'photoreal', 'volcanoes', 'companies', 'lightpollution', 'aurora',
  'clouds', 'night', 'labels']);
/** What weather mode can show (src/globe/weather.js sets). */
export const WEATHER = Object.freeze(['ir', 'radar', 'rain', 'lightning', 'wind', 'temp', 'pres', 'gust', 'wave']);

/** How big a place is when the geocoder gives no outline: km around its centre. */
const SIZE_KM = { country: 900, state: 300, region: 250, province: 250, county: 40, city: 20, town: 8, village: 4, hamlet: 2, suburb: 4, district: 6, island: 25,
  aerodrome: 4, airport: 4, peak: 10, volcano: 15, water: 40, lake: 30, sea: 500, ocean: 2500, bay: 50, strait: 50, continent: 3000 };

/** The schema properties every location tool shares. `what` finishes the radius sentence; null leaves the radius out (a point). */
export function areaProps(what = 'to look') {
  const p = {
    place: { type: 'string', maxLength: 120, description: 'A place name: a country, state, city, landmark, sea or address ("Japan", "Texas", "Gulf of Finland", "Reykjavik").' },
    lat: { type: 'number', minimum: -90, maximum: 90, description: 'Latitude in degrees (with lon, instead of a place name).' },
    lon: { type: 'number', minimum: -180, maximum: 180, description: 'Longitude in degrees, east positive.' },
  };
  if (what !== null) p.radius_km = { type: 'number', minimum: 0.1, maximum: 20000, description: `How far around the place or point ${what}, in km (default: the place's own size, or a few hundred km around a point).` };
  return p;
}

const fmtCoord = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;

/** One place by name: { name, label, lat, lon, kind, country, bbox: [w, s, e, n] | null }. */
export async function geocode(feeds, q, signal) {
  return (await geocodeMany(feeds, q, 1, signal))[0];
}
/** Up to n places by name, best match first (for "from A to B", where the pair that makes sense is picked); `near`
 *  ({ lat, lon }) asks Photon to prefer matches close to it. */
export async function geocodeMany(feeds, q, n, signal, near) {
  const text = String(q || '').trim().slice(0, 120);
  if (text.length < 2) throw new ToolError('Name a place (two letters or more)', 'invalid_arguments');
  const bias = near ? `&lat=${near.lat.toFixed(3)}&lon=${near.lon.toFixed(3)}&location_bias_scale=0.1&zoom=10` : '';
  const d = await feeds.json(`${PHOTON}?q=${encodeURIComponent(text)}&limit=${n}&lang=en${bias}`, { ttl: 7 * 864e5, signal });
  const out = ((d && Array.isArray(d.features) ? d.features : []).map(f => placeOf(f, text))).filter(Boolean);
  if (!out.length) throw new ToolError(`No place called "${text}" was found`, 'not_found');
  return out;
}
function placeOf(f, text) {
  const p = (f && f.properties) || {}, c = (f && f.geometry && f.geometry.coordinates) || [];
  const lon = +c[0], lat = +c[1];
  if (!f || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const e = Array.isArray(p.extent) && p.extent.length === 4 && p.extent.every(Number.isFinite) ? p.extent : null;   // Photon: [west, north, east, south]
  let bbox = e ? [e[0], e[3], e[2], e[1]] : null;
  if (bbox && ((bbox[2] - bbox[0] + 360) % 360 > 300 || bbox[3] - bbox[1] > 150)) bbox = null;   // wraps most of the world (territories far away): use a circle
  const name = String(p.name || p.street || text), parts = [name];
  for (const k of ['city', 'state', 'country']) if (p[k] && !parts.includes(p[k])) parts.push(p[k]);
  return { name, label: parts.join(', '), lat, lon, kind: String(p.osm_value || p.type || ''), country: /^[A-Z]{2}$/.test(p.countrycode || '') ? p.countrycode : null, bbox };
}

const bboxCentre = ([w, s, e, n]) => ({ lat: (s + n) / 2, lon: ((w + ((e - w + 360) % 360) / 2 + 540) % 360) - 180 });
/** Half the bbox's diagonal, km: the radius of a circle around it. */
const bboxRadiusKm = b => { const c = bboxCentre(b); return Math.max(haversine(c.lat, c.lon, b[3], b[2]), haversine(c.lat, c.lon, b[1], b[0])) / 1000; };

/**
 * The area a call is about, or null when it names none (unless `need`): { name, label, lat, lon, radiusKm, bbox, kind, country }.
 * A place with an outline keeps its box (and is framed on the box); radius_km turns it into a circle around its centre.
 */
export async function resolveArea(args, feeds, { need = false, pointKm = 300, signal } = {}) {
  const a = args || {}, hasPt = a.lat != null || a.lon != null;
  if (hasPt && !(Number.isFinite(a.lat) && Number.isFinite(a.lon) && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180)) throw new ToolError('Give both lat (-90 to 90) and lon (-180 to 180)', 'invalid_arguments');
  const r = a.radius_km != null ? +a.radius_km : null;
  if (r != null && !(r > 0 && r <= 20000)) throw new ToolError('radius_km must be between 0.1 and 20000', 'invalid_arguments');
  if (hasPt) { const name = a.place ? String(a.place).slice(0, 120) : fmtCoord(a.lat, a.lon); return { name, label: name, lat: a.lat, lon: a.lon, radiusKm: r ?? pointKm, bbox: null, kind: 'point', country: null }; }
  if (!a.place) { if (need) throw new ToolError('Say where: a place name, or lat and lon', 'invalid_arguments'); return null; }
  const g = await geocode(feeds, a.place, signal);
  if (r != null) return { ...g, radiusKm: r, bbox: null };
  if (g.bbox) { const c = bboxCentre(g.bbox); return { ...g, frameLat: c.lat, frameLon: c.lon, radiusKm: Math.max(1, bboxRadiusKm(g.bbox)) }; }
  return { ...g, radiusKm: SIZE_KM[g.kind] ?? 15 };
}

export const distKm = (a, lat, lon) => haversine(a.lat, a.lon, lat, lon) / 1000;
/** Is lat/lon inside the area (its box, or its circle)? A box may cross the antimeridian (west > east). */
export function inArea(a, lat, lon) {
  if (!a) return true;
  if (a.bbox) { const [w, s, e, n] = a.bbox; return lat >= s && lat <= n && (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e); }
  return distKm(a, lat, lon) <= a.radiusKm;
}

/**
 * A camera that shows a circle `km` in radius around lat/lon: { lon, lat, height (m), heading, pitch (deg) }. Straight down
 * by default; `tilt` (degrees from straight down) stands the camera back toward `heading` + 180 so the point stays centred.
 */
export function frame(lat, lon, km, { tilt = 0, heading = 0 } = {}) {
  const height = Math.round(Math.min(2.0e7, Math.max(350, km * 2400)));   // a ~60° view: 2.4 x the radius shows it all with a margin
  const t = Math.max(0, Math.min(80, +tilt || 0));
  if (!t || height > 2.5e6) return { lon: +lon.toFixed(5), lat: +lat.toFixed(5), height, heading: 0, pitch: -90 };
  const pitch = -(90 - t), back = height / Math.tan(-pitch * D2R), c = destination(lat, lon, back, (heading + 180) % 360);
  return { lon: +c.lon.toFixed(5), lat: +c.lat.toFixed(5), height, heading: ((heading % 360) + 360) % 360, pitch };
}

/** The camera for an area (its box centre for a place with an outline). */
export const frameArea = (a, opts) => frame(a.frameLat ?? a.lat, a.frameLon ?? a.lon, a.radiusKm, opts);

/**
 * The globe link for a view: { camera, on: [layer ids], off, weather: [ids], time: { ms, rate }, country, flight, sat, sensor,
 * drawing: [shapes] (core/measure.js: pins, lines, areas, distances; drawn on arrival, left out if too long for a link) }.
 * Layers named in on/off change; every other layer stays as the visitor has it.
 */
export function globeUrl(site, v) {
  const keep = (list, ok) => (Array.isArray(list) ? [...new Set(list)].filter(x => ok.includes(x)) : []);
  const on = keep(v.on, LAYERS), off = keep(v.off, LAYERS).filter(x => !on.includes(x)), weather = keep(v.weather, WEATHER);
  const view = { ...v.camera, layers: null, weather: weather.length ? weather : null, country: v.country || null, flight: v.flight || null,
    time: v.time && Number.isFinite(v.time.ms) ? { jd: jdFromMs(v.time.ms), rate: Number.isFinite(v.time.rate) ? v.time.rate : 1 } : null,
    add: on.length ? on : null, drop: off.length ? off : null, sat: v.sat || null, ops: v.sensor ? { sensor: v.sensor, hud: false, detect: false } : null,
    drawing: Array.isArray(v.drawing) && v.drawing.length ? v.drawing : null };
  return site + 'globe.html#' + encodeView(view);
}

/** A link that opens one of the globe's panels (launches, crew, flybys, tonight), optionally at one item. */
export const panelUrl = (site, go, id) => `${site}globe.html#go=${go}${id ? '&id=' + encodeURIComponent(id) : ''}`;
