// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
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
import { firePerimeters, FIRE_SAT_NAME as SAT_NAME, fireLook as look, FIRE_FRP as FRP, fireLevel, fireTilesWanted, NIFC_PERIMETERS as PERIM_URL, containColor, keptRings, perimeterCentre } from '../core/hazards.js';
import { stamp, rep, provStamp } from '../core/liveprov.js';

const MAX_H = 2.5e6, MAX_TILES = PHONE ? 2 : 4, COLOR = '#ff7a2f';

// ---- the worker: fetch, unzip, decode, filter
let worker = null, seq = 0;
const waiting = new Map();
function viaWorker(url, since) {
  if (!worker) {
    worker = new Worker(new URL('../core/fires.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); e.data.error ? w.rej(new Error(e.data.error)) : w.res(e.data); };
    worker.onerror = e => { for (const w of waiting.values()) w.rej(new Error(e.message || 'fires worker failed')); waiting.clear(); worker = null; };   // a worker that fails to load would otherwise leave every tile 'loading' for good
  }
  return new Promise((res, rej) => {   // the worker gives up after 30 s; this backstop frees the request slot whatever happens
    const id = ++seq, timer = setTimeout(() => { if (waiting.delete(id)) rej(new Error('fires worker timed out')); }, 45e3);
    waiting.set(id, { res: v => { clearTimeout(timer); res(v); }, rej: e => { clearTimeout(timer); rej(e); } }); worker.postMessage({ id, url, since });
  });
}

// ---- hot spots: one point collection per tile and day, so a tile leaving the view is one switch, not 15,000 removals
const COLORS = new Map(FRP.map(([, c]) => [c, C.Color.fromCssColorString(c)])), SCALE = new C.NearFarScalar(2e4, 1.6, 2.5e6, 0.7);
const tiles = new Map();   // key -> { prims, fires, t, state: 'loading' | 'ok' | 'failed' }
let active = new Set(), inflight = 0, told = false;

const FireProto = {
  kind: 'fire',
  get prov() { return provStamp('fires', [rep('viirs', { name: `NASA VIIRS ${SAT_NAME[this.sat] || ''}`.trim(), dataAt: this.t })]); },
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
  const p = camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), C.Ellipsoid.WGS84) || camera.positionWC;
  const g = C.Cartographic.fromCartesian(p);
  return fireTilesWanted(C.Math.toDegrees(g.latitude), C.Math.toDegrees(g.longitude), Math.min(30, h / 111e3 * 1.3), fireLevel(h / 1000), MAX_TILES);   // shared with the 2D map (core/hazards.js)
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
function drawPerimeters(list) {
  for (const p of [fillPrim, linePrim]) if (p) scene.groundPrimitives.remove(p);
  const fills = [], outs = [];
  for (const f of list) {
    const col = C.Color.fromCssColorString(containColor(f));
    for (const r of keptRings(f)) {
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
let perimAt = 0, perimBusy = false, perimList = [];
async function loadPerimeters() {
  if (perimBusy || Date.now() - perimAt < 15 * 60e3) return;
  perimBusy = true; perimAt = Date.now();
  try {
    perimList = firePerimeters(await getJSON(PERIM_URL, { timeout: 45000 }));
    for (const f of perimList) {
      Object.assign(f, { kind: 'fireperim' }, perimeterCentre(f)); stamp(f, 'perimeters', [rep('nifc', { dataAt: f.updated })]);   // where the card's buttons fly: the largest ring's middle
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
  /** The hot spots drawn now (the export buttons). */
  get detections() { const out = []; for (const k of active) { const t = tiles.get(k); if (t && t.state === 'ok') out.push(...t.fires); } return out; },
  stats() { let n = 0, loaded = 0; for (const k of active) { const t = tiles.get(k); if (t && t.state === 'ok') { n += t.fires.length; loaded++; } } return { hotSpots: n, tiles: loaded, wanted: active.size, perimeters: perimList.length }; },
};
setInterval(() => { if (L.fires.on && !state.lookup) { tick(); loadPerimeters(); } }, 2000);
