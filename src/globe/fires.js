// Wildfires. Worldwide: NASA's VIIRS fire detections from the last 24 hours (FIRMS's data, served by NASA GIBS as vector
// tiles: keyless, CORS; NOAA-20 and NOAA-21, ~375 m pixels), loaded for the view below ~2,500 km and decoded in a worker,
// drawn as points sized and coloured by fire radiative power. In the US: current interagency fire perimeters (NIFC WFIGS,
// keyless), coloured by containment and draped on the ground. A detection is a hot pixel seen from orbit, not a confirmed
// wildfire: farm and brush burning, gas flares and volcanoes show too, and clouds or smoke hide some fires.
import { C, esc, fmt, toast, PHONE, getJSON } from './env.js';
import { scene, camera, camHeight } from './viewer.js';
import { L, setCount } from './layers.js';
import { state } from './state.js';
import { Terrain } from './terrain.js';
import { fireTilesFor, firePerimeters } from '../core/hazards.js';

const SATS = { N20: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All', N21: 'VIIRS_NOAA21_Thermal_Anomalies_375m_All' };
const SAT_NAME = { N20: 'NOAA-20', N21: 'NOAA-21', N: 'Suomi NPP' };
const MAX_H = 2.5e6, MAX_TILES = PHONE ? 2 : 4, COLOR = '#ff7a2f';
const tileUrl = (layer, date, t) => `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${layer}/default/${date}/500m/${t.level}/${t.row}/${t.col}.mvt`;

// ---- the worker: fetch, unzip, decode, filter
let worker = null, seq = 0;
const waiting = new Map();
function viaWorker(url, since) {
  if (!worker) {
    worker = new Worker(new URL('./fires.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); e.data.error ? w.rej(new Error(e.data.error)) : w.res(e.data); };
  }
  return new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); worker.postMessage({ id, url, since }); });
}

// ---- hot spots: one point collection per tile and day, so a tile leaving the view is one switch, not 15,000 removals
const FRP = [[100, '#fff1d6', 8], [20, '#ff5a2e', 6], [5, '#ff9f3c', 4.5], [0, '#ffd45c', 3.2]];
const look = frp => FRP.find(([min]) => frp >= min);
const COLORS = new Map(FRP.map(([, c]) => [c, C.Color.fromCssColorString(c)])), SCALE = new C.NearFarScalar(2e4, 1.6, 2.5e6, 0.7);
const tiles = new Map();   // key -> { prims, fires, t, state: 'loading' | 'ok' | 'failed' }
let active = new Set(), inflight = 0, told = false;
const day = ms => new Date(ms).toISOString().slice(0, 10);
const keyOf = (sat, date, t) => `${sat}/${date}/${t.level}/${t.row}/${t.col}`;

const FireProto = {
  kind: 'fire',
  tip() { return `🔥 Fire detection · ${fmt(this.frp)} MW · ${ago(this.t)}`; },
  cardHtml() {
    const row = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
    return `<div class="k" style="--c:${look(this.frp)[1]}">Fire detection · NASA VIIRS (${esc(SAT_NAME[this.sat] || this.sat)})</div><h2>${this.frp >= 100 ? 'Intense fire' : this.frp >= 20 ? 'Strong fire' : 'Fire'} detected</h2><dl>`
      + row('Fire power', `${fmt(this.frp)} MW (radiative)`) + (this.k ? row('Brightness', `${fmt(this.k)} K`) : '') + (this.conf ? row('Confidence', this.conf) : '')
      + row('Seen', `${new Date(this.t).toISOString().slice(0, 16).replace('T', ' ')} UTC (${ago(this.t)}), ${this.day ? 'day' : 'night'} pass`)
      + row('Position', `${this.lat.toFixed(3)}, ${this.lon.toFixed(3)}`) + '</dl>'
      + `<div class="acts"><a class="chipbtn" href="https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${this.lon.toFixed(3)},${this.lat.toFixed(3)},11z" target="_blank" rel="noopener">On NASA FIRMS</a></div>`
      + '<div class="note" style="margin-top:8px">A hot 375 m pixel seen from orbit: a wildfire, farm or brush burning, a gas flare or a volcano. Clouds, smoke and the satellites\' timing hide some fires. NASA FIRMS / LANCE (VIIRS NRT), through NASA GIBS.</div>';
  },
};
const ago = t => { const m = Math.round((Date.now() - t) / 60e3); return m < 90 ? `${m} min ago` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} h ago`; };

function show(tile) {
  const c = new C.PointPrimitiveCollection(); tile.prims = scene.primitives.add(c);
  for (const f of tile.fires) {
    Object.setPrototypeOf(f, FireProto);
    const [, col, size] = look(f.frp);
    f.pt = c.add({ position: C.Cartesian3.fromDegrees(f.lon, f.lat, 0), pixelSize: size, color: COLORS.get(col), outlineColor: C.Color.BLACK.withAlpha(0.45), outlineWidth: 1,
      scaleByDistance: SCALE, id: f });
    f.h = 0;
  }
  c.show = L.fires.on && active.has(tile.key);
}
async function load(key, url, since) {
  const tile = { key, fires: [], prims: null, t: Date.now(), state: 'loading' }; tiles.set(key, tile); inflight++;
  try {
    const r = await viaWorker(url, since); tile.fires = r.fires; tile.missing = !!r.missing; tile.state = 'ok'; show(tile); count();
    const mine = [...active].map(k => tiles.get(k)).filter(t => t && t.state === 'ok');   // all of them refused: NASA is down, not just a quiet day
    if (!told && mine.length >= 4 && mine.every(t => t.missing)) { told = true; toast('Fire detections are unavailable right now', 3500); }
  }
  catch (e) { tile.state = 'failed'; console.warn('fires', e.message); }
  finally { inflight--; }
}
function count() { let n = 0; for (const k of active) { const t = tiles.get(k); if (t && t.state === 'ok') n += t.fires.length; } setCount('fires', n); }

/** The tiles for the view: a level whose tiles are about the view's size, the nearest few, two satellites x two days. */
function wanted() {
  const h = camHeight(); if (h > MAX_H || state.lookup) return [];
  const level = h > 1.2e6 ? 3 : h > 5e5 ? 4 : h > 1.5e5 ? 5 : 6;
  const p = camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), C.Ellipsoid.WGS84) || camera.positionWC;
  const g = C.Cartographic.fromCartesian(p), lat = C.Math.toDegrees(g.latitude), lon = C.Math.toDegrees(g.longitude);
  const r = Math.min(30, h / 111e3 * 1.3), rl = r / Math.max(0.2, Math.cos(g.latitude));
  const near = fireTilesFor(Math.max(-180, lon - rl), Math.max(-90, lat - r), Math.min(180, lon + rl), Math.min(90, lat + r), level)
    .map(t => { const d = 288 / 2 ** t.level; return [t, Math.hypot(-180 + (t.col + 0.5) * d - lon, 90 - (t.row + 0.5) * d - lat)]; })
    .sort((a, b) => a[1] - b[1]).slice(0, level <= 3 ? 2 : MAX_TILES).map(a => a[0]);
  const now = Date.now(), out = [];
  for (const t of near) for (const sat of Object.keys(SATS)) for (const d of [day(now), day(now - 864e5)]) out.push({ key: keyOf(sat, d, t), url: tileUrl(SATS[sat], d, t), today: d === day(now) });
  return out;
}
function tick() {
  if (!L.fires.on) return;
  const want = wanted(), keys = new Set(want.map(w => w.key)), since = Date.now() - 864e5;
  for (const [k, t] of tiles) if (t.prims) t.prims.show = keys.has(k);
  active = keys;
  for (const w of want) {   // today's tiles grow with each pass: fetched again after 30 min
    const t = tiles.get(w.key);
    if (inflight >= 2) break;
    if (!t || (t.state === 'failed' && Date.now() - t.t > 120e3) || (w.today && t.state === 'ok' && Date.now() - t.t > 30 * 60e3)) {
      if (t && t.prims) { scene.primitives.remove(t.prims); }
      load(w.key, w.url, since);
    }
  }
  for (const [k, t] of tiles) if (!keys.has(k) && t.prims && tiles.size > 48) { scene.primitives.remove(t.prims); tiles.delete(k); }   // keep a few behind
  count(); seat();
}
/** Below ~300 km, the fires near the view stand on the 3D terrain (far ones and from higher up: sea level is close enough). */
function seat() {
  if (!Terrain.on) return;
  const c = camera.positionCartographic; if (!c || c.height > 3e5) return;
  const lat = C.Math.toDegrees(c.latitude), lon = C.Math.toDegrees(c.longitude);
  for (const k of active) {
    const t = tiles.get(k); if (!t || t.state !== 'ok') continue;
    for (const f of t.fires) {
      if (Math.abs(f.lat - lat) > 1.5 || Math.abs(f.lon - lon) > 1.5) continue;
      const h = Terrain.near(f.lat, f.lon, 3, 0.3);
      if (Math.abs(h - f.h) > 5) { f.h = h; f.pt.position = C.Cartesian3.fromDegrees(f.lon, f.lat, h + 30); }
    }
  }
}

// ---- US perimeters: every fire's rings in two primitives (fills, outlines), draped on the ground; a fire can have
// hundreds of spot-fire rings, so each keeps its 30 largest over 2 ha
let fillPrim = null, linePrim = null;
const ringHa = r => { let a = 0; for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]; return Math.abs(a) / 2 * 111.32 ** 2 * Math.cos(r[0][1] * Math.PI / 180) * 100; };
function drawPerimeters(list) {
  for (const p of [fillPrim, linePrim]) if (p) scene.groundPrimitives.remove(p);
  const fills = [], outs = [];
  for (const f of list) {
    const col = C.Color.fromCssColorString(containColor(f));
    const keep = f.rings.filter(r => r.length >= 4).map(r => [r, ringHa(r)]).filter(([, ha]) => ha >= 2).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([r]) => r);
    for (const r of keep) {
      const pos = C.Cartesian3.fromDegreesArray(r.flat());
      fills.push(new C.GeometryInstance({ geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(pos) }), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(col.withAlpha(0.25)) }, id: f }));
      outs.push(new C.GeometryInstance({ geometry: new C.GroundPolylineGeometry({ positions: pos, width: 2 }), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(col.withAlpha(0.95)) }, id: f }));
    }
  }
  if (!fills.length) { fillPrim = linePrim = null; return; }
  fillPrim = scene.groundPrimitives.add(new C.GroundPrimitive({ geometryInstances: fills, appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }), classificationType: C.ClassificationType.BOTH }));
  linePrim = scene.groundPrimitives.add(new C.GroundPolylinePrimitive({ geometryInstances: outs, appearance: new C.PolylineColorAppearance(), classificationType: C.ClassificationType.BOTH }));
  fillPrim.show = linePrim.show = L.fires.on && !state.lookup;
}
const PERIM_URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1'
  + '&outFields=poly_IncidentName,attr_IncidentName,attr_IncidentSize,attr_PercentContained,attr_POOState,attr_FireDiscoveryDateTime,poly_DateCurrent,attr_UniqueFireIdentifier,attr_IncidentTypeCategory,attr_FireCause,attr_IncidentShortDescription'
  + '&maxAllowableOffset=0.001&geometryPrecision=5&outSR=4326&f=geojson';
let perimAt = 0, perimBusy = false, perimList = [];
const containColor = f => f.rx ? '#9ad17a' : f.contained == null || f.contained < 30 ? '#ff3b2f' : f.contained < 70 ? '#ff8a3d' : f.contained < 100 ? '#ffc75a' : '#9aa5b1';
async function loadPerimeters() {
  if (perimBusy || Date.now() - perimAt < 15 * 60e3) return;
  perimBusy = true; perimAt = Date.now();
  try {
    perimList = firePerimeters(await getJSON(PERIM_URL, { timeout: 45000 }));
    for (const f of perimList) {
      const big = f.rings.reduce((a, r) => r.length > a.length ? r : a, f.rings[0]);   // where the card's buttons fly: the largest ring's middle
      Object.assign(f, { kind: 'fireperim', lat: big.reduce((a, q) => a + q[1], 0) / big.length, lon: big.reduce((a, q) => a + q[0], 0) / big.length });
      f.tip = () => `🔥 ${f.name} fire · ${f.acres ? fmt(f.acres) + ' acres' : ''}${f.contained != null ? ` · ${f.contained}% contained` : ''}`;
      f.cardHtml = () => perimCard(f, containColor(f));
    }
    drawPerimeters(perimList);
  } catch (e) { console.warn('fire perimeters', e.message); perimAt = Date.now() - 13 * 60e3; } finally { perimBusy = false; }
}
function perimCard(f, col) {
  const row = (k, v) => v == null || v === '' ? '' : `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`, d = t => t ? new Date(t).toISOString().slice(0, 10) : null;
  return `<div class="k" style="--c:${col}">${f.rx ? 'Prescribed burn' : 'Wildfire'} · NIFC (US interagency)</div><h2>${esc(f.name)} fire</h2><dl>`
    + row('Size', f.acres ? `${fmt(f.acres)} acres · ${fmt(f.acres * 0.404686)} ha` : null) + row('Contained', f.contained != null ? f.contained + '%' : null)
    + row('Where', [f.where, f.state].filter(Boolean).join(' · ')) + row('Cause', f.cause) + row('Discovered', d(f.discovered)) + row('Perimeter mapped', d(f.updated)) + '</dl>'
    + '<div class="note" style="margin-top:8px">The current perimeter mapped by incident teams (it can lag the fire by a day). National Interagency Fire Center, WFIGS.</div>';
}

export const Fires = {
  /** Show or hide; nothing is fetched while off. */
  apply() {
    const on = L.fires.on && !state.lookup;
    for (const p of [fillPrim, linePrim]) if (p) p.show = on;
    for (const [k, t] of tiles) if (t.prims) t.prims.show = on && active.has(k);
    if (on) { loadPerimeters(); tick(); } else setCount('fires', 0);
  },
  get perimeters() { return perimList; },
  stats() { let n = 0, loaded = 0; for (const k of active) { const t = tiles.get(k); if (t && t.state === 'ok') { n += t.fires.length; loaded++; } } return { hotSpots: n, tiles: loaded, wanted: active.size, perimeters: perimList.length }; },
};
setInterval(() => { if (L.fires.on && !state.lookup) { tick(); loadPerimeters(); } }, 2000);
