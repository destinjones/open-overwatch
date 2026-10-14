// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Licence-plate readers (ALPR) in the US and Canada: every automatic plate reader OpenStreetMap volunteers have mapped
// (largely through DeFlock), from the vector tiles FlockHopper (dontgetflocked.com) rebuilds every hour and serves with
// CORS. No Overpass: from far away the tiles carry positions only (a dot cloud of where the readers are), and below
// ~250 km every reader with its tags (make, operator, which way it faces, what it watches), as wedges close up. Elsewhere
// in the world, plate readers still come from the mapped-cameras layer (surveil.js, Overpass, close up). Locations and
// tags only: no images, no plates. © OpenStreetMap contributors (ODbL).
import { C, esc, PHONE } from './env.js';
import { rep, provStamp } from '../core/liveprov.js';
import { viewer, scene, camera, camAGL } from './viewer.js';
import { Terrain } from './terrain.js';
import { L, setCount } from './layers.js';
import { state } from './state.js';
import { vtile, tileSpec, tileInBounds, ALPR_US, ALPR_CA } from './vtiles.js';
import { tileCameras, cameraFacts, pickZoom, inBounds, routeTiles, readersAlong, tileOverlaps } from '../core/osmtiles.js';

const COLOR = '#ff4d5e', SOURCES = [ALPR_US, ALPR_CA];
const DETAIL_H = 2.5e5, DETAIL = [12, 11, 10, 9], HEAT = [8, 7, 6, 5, 4, 3];
const MAX_TILES = PHONE ? 6 : 12, MAX_CAMS = PHONE ? 8000 : 30000, MAX_HEAT = PHONE ? 15000 : 60000, KEEP = PHONE ? 30 : 80, WEDGE_H = 8000;
const pts = scene.primitives.add(new C.PointPrimitiveCollection());
const wedges = scene.primitives.add(new C.PolylineCollection());
const RED = C.Color.fromCssColorString(COLOR), HEATC = C.Color.fromCssColorString('#ff6a78').withAlpha(0.55);
const bounds = new Map();   // source -> TileJSON bounds
const tiles = new Map();   // 'src|z/x/y' -> { list, used, dots (a far tile's point batch, made once) } | { loading } | { failed }
const cams = new Map();   // osm id -> camera object (detail)
let mode = '', sig = '', timer = 0, credited = false;
Terrain.onChange(() => { for (const c of cams.values()) drop(c); cams.clear(); for (const t of tiles.values()) if (t.dots) { scene.primitives.remove(t.dots); t.dots = null; } sig = ''; });   // stand them on the new ground

const CamProto = {
  kind: 'alpr',
  get prov() { return provStamp('osm', [rep('osm', { name: 'OpenStreetMap via FlockHopper tiles' })]); },   // hourly tiles that carry no build time
  tip() { return `Plate reader${this.brand ? ' · ' + this.brand : ''}${this.operator ? ' · ' + this.operator.slice(0, 40) : ''}`; },
  cardHtml() {
    const rows = cameraFacts(this).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    return `<div class="k" style="--c:${COLOR}">Licence-plate reader · mapped in OpenStreetMap</div><h2>${esc(this.brand ? this.brand + ' reader' : 'Plate reader')}</h2>`
      + `<dl>${rows}<dt>Position</dt><dd>${this.lat.toFixed(5)}, ${this.lon.toFixed(5)}</dd></dl>`
      + `<div class="acts"><a class="chipbtn" href="https://www.openstreetmap.org/${this.osmType === 'way' ? 'way' : 'node'}/${encodeURIComponent(this.osmId)}" target="_blank" rel="noopener">On OpenStreetMap</a>`
      + `<a class="chipbtn" href="https://dontgetflocked.com/" target="_blank" rel="noopener">FlockHopper</a></div>`
      + `<div class="note" style="margin-top:8px">An automatic licence-plate reader (ALPR) that volunteers have mapped in OpenStreetMap, mostly through DeFlock; FlockHopper (dontgetflocked.com) rebuilds these tiles every hour. A location someone tagged, not a feed: no images, no plates. Readers nobody has mapped are not shown. © OpenStreetMap contributors (ODbL).</div>`;
  },
};

const ground = c => (Terrain.on ? (Terrain.near(c.lat, c.lon, 4, 0.15) ?? Terrain.ref) : 0) + 4;
function add(c) {
  const o = Object.assign(Object.create(CamProto), c), h = ground(c);
  o.tiles = new Set();
  o.pt = pts.add({ position: C.Cartesian3.fromDegrees(c.lon, c.lat, h), pixelSize: PHONE ? 8 : 7, color: RED.withAlpha(0.92), outlineColor: C.Color.BLACK.withAlpha(0.65), outlineWidth: 1, id: o,
    disableDepthTestDistance: 5000, scaleByDistance: new C.NearFarScalar(2e3, 1.15, 2e5, 0.55) });
  o.h = h; o.wedges = null;
  cams.set(c.id, o);
  return o;
}
function drop(o) { pts.remove(o.pt); if (o.wedges) for (const w of o.wedges) wedges.remove(w); o.pt = o.wedges = null; }
/** 50-degree wedges, 35 m long, toward where it looks (made when the camera comes close). */
function wedgeFor(o) {
  if (o.wedges || !o.facings.length) return;
  const R = 35, m = 111320, cos = Math.cos(o.lat * Math.PI / 180), at = a => C.Cartesian3.fromDegrees(o.lon + Math.sin(a * Math.PI / 180) * R / (m * cos), o.lat + Math.cos(a * Math.PI / 180) * R / m, o.h);
  const c0 = C.Cartesian3.fromDegrees(o.lon, o.lat, o.h), mat = C.Material.fromType('Color', { color: RED.withAlpha(0.75) });
  o.wedges = o.facings.map(dir => { const arc = []; for (let a = dir - 25; a <= dir + 25; a += 10) arc.push(at(a)); return wedges.add({ positions: [c0, ...arc, c0], width: 1.5, material: mat, id: o }); });
}

function load(src, key) {
  const id = src + '|' + key; tiles.set(id, { loading: true });
  const [z, x, y] = key.split('/').map(Number);
  vtile(src, key, ['cameras']).then(dec => {
    tiles.set(id, { list: tileCameras(dec.cameras, z, x, y), used: Date.now(), heat: z <= 8 });
    if (!credited) { credited = true; viewer.creditDisplay.addStaticCredit(new C.Credit('Plate readers: © OpenStreetMap contributors, via DeFlock and FlockHopper (dontgetflocked.com)')); }
    tick();
  }, e => { tiles.set(id, { failed: Date.now() }); console.warn('plate readers', e.message); });
}

function heatShow(on) { for (const t of tiles.values()) if (t.dots) t.dots.show = !!on && on.has(t); }
function dropTile(id) { const t = tiles.get(id); if (t?.dots) scene.primitives.remove(t.dots); tiles.delete(id); }
function hideAll() { pts.show = wedges.show = false; heatShow(null); scene.requestRender(); }

function showDetail(keys) {
  const want = new Map();
  for (const id of keys) for (const c of tiles.get(id).list) if (!c.heat && !want.has(c.id)) want.set(c.id, c);
  for (const [id, o] of cams) if (!want.has(id)) { drop(o); cams.delete(id); }
  let n = cams.size;
  for (const [id, c] of want) { if (n >= MAX_CAMS) break; if (!cams.has(id)) { add(c); n++; } }
  heatShow(null);
  setCount('alpr', cams.size);
}
/** From far away: each tile's dots (at most MAX_HEAT / MAX_TILES of them, evenly thinned) in a batch of its own. */
function showHeat(keys) {
  for (const o of cams.values()) drop(o); cams.clear();
  let n = 0; const on = new Set(), h = Terrain.on ? 1500 : 0, cap = MAX_HEAT / MAX_TILES;
  for (const id of keys) {
    const t = tiles.get(id); on.add(t); n += t.list.length;
    if (t.dots) continue;
    t.dots = scene.primitives.add(new C.PointPrimitiveCollection({ blendOption: C.BlendOption.TRANSLUCENT }));
    const step = Math.max(1, t.list.length / cap);
    for (let i = 0; i < t.list.length; i += step) { const c = t.list[Math.floor(i)]; t.dots.add({ position: C.Cartesian3.fromDegrees(c.lon, c.lat, h), pixelSize: PHONE ? 2.5 : 2, color: HEATC }); }
  }
  heatShow(on);
  setCount('alpr', n);
}

function tick() {
  if (!L.alpr.on || state.lookup) { hideAll(); return; }
  if (SOURCES.some(s => !bounds.has(s))) {   // the TileJSONs say where each source has tiles
    for (const s of SOURCES) if (!bounds.has(s)) tileSpec(s).then(sp => { bounds.set(s, sp.bounds || null); tick(); }, e => console.warn('plate readers', e.message));
    return;
  }
  const agl = camAGL();
  const c = camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), C.Ellipsoid.WGS84) || camera.positionWC;
  const g = C.Cartographic.fromCartesian(c), lat = C.Math.toDegrees(g.latitude), lon = C.Math.toDegrees(g.longitude);
  let pick = agl < DETAIL_H && pickZoom(lat, lon, Math.min(2e5, Math.max(3e3, agl * 1.3)), DETAIL, MAX_TILES), m = 'detail';
  if (!pick) { pick = pickZoom(lat, lon, Math.min(3.5e6, Math.max(2e5, agl * 1.6)), HEAT, MAX_TILES); m = 'heat'; }
  if (!pick) { hideAll(); return; }
  const ids = [];
  for (const k of pick.tiles) for (const s of SOURCES) if (tileInBounds(k, bounds.get(s))) ids.push(s + '|' + k);
  let busy = [...tiles.values()].filter(t => t.loading).length;
  for (const id of ids) {
    const t = tiles.get(id), [s, k] = id.split('|');
    if ((!t || (t.failed && Date.now() - t.failed > 90e3)) && busy < 4) { load(s, k); busy++; }
  }
  const ready = ids.filter(id => tiles.get(id)?.list), now = Date.now();
  for (const id of ready) tiles.get(id).used = now;
  const s = m + ' ' + ready.join(' ');
  if (s !== sig) {
    sig = s; mode = m;
    if (m === 'detail') showDetail(ready); else showHeat(ready);
    const on = new Set(ids), old = [...tiles].filter(([id, t]) => t.list && !on.has(id)).sort((a, b) => a[1].used - b[1].used);
    for (const [id] of old.slice(0, Math.max(0, tiles.size - KEEP))) dropTile(id);
  }
  pts.show = mode === 'detail'; if (mode === 'detail') heatShow(null); else heatShow(new Set(ready.map(id => tiles.get(id))));
  wedges.show = mode === 'detail' && agl < WEDGE_H;
  if (wedges.show) {   // wedges for the readers near the middle of the view
    const near = Math.max(1500, agl * 1.2), k = 111320, cos = Math.cos(lat * Math.PI / 180);
    for (const o of cams.values()) if (!o.wedges && Math.abs(o.lat - lat) * k < near && Math.abs(o.lon - lon) * k * cos < near) wedgeFor(o);
  }
  scene.requestRender();
}

export const Alpr = {
  get list() { return [...cams.values()]; },
  /** Is a reader with this OpenStreetMap node id drawn here (so the mapped-cameras layer can skip its copy)? */
  has: osmNodeId => L.alpr.on && cams.has('n' + osmNodeId),
  /** Inside the tiles' coverage (the US and Canada boxes)? */
  covers: (lat, lon) => [...bounds.values()].some(b => inBounds(b, lat, lon)),
  /**
   * The mapped readers within 40 m of a route ([[lon, lat], …]) (readersAlong), from the tiles it passes (the finest zoom
   * that needs at most 40; works with the layer off). null outside the tiles' coverage or for a route too long to check.
   */
  async along(coords, maxM = 40) {
    const specs = await Promise.all(SOURCES.map(s => tileSpec(s)));
    for (const z of [12, 11, 10, 9]) {
      const keys = routeTiles(coords, z), jobs = [];
      if (keys.length > 40) continue;
      for (const k of keys) specs.forEach((sp, i) => { if (tileOverlaps(k, sp.bounds)) jobs.push(vtile(SOURCES[i], k, ['cameras']).then(d => { const [tz, x, y] = k.split('/').map(Number); return tileCameras(d.cameras, tz, x, y); })); });
      if (!jobs.length) return null;
      const seen = new Set(), cams = (await Promise.all(jobs)).flat().filter(c => !c.heat && !seen.has(c.id) && seen.add(c.id));
      return readersAlong(coords, cams, maxM);
    }
    return null;
  },
  apply() {
    if (L.alpr.on && !timer) timer = setInterval(tick, 1000);
    else if (!L.alpr.on && timer) { clearInterval(timer); timer = 0; for (const o of cams.values()) drop(o); cams.clear(); for (const id of [...tiles.keys()]) if (tiles.get(id).dots) dropTile(id); sig = ''; setCount('alpr', 0); }
    tick();
  },
};
