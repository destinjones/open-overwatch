// 3D buildings with no account and no key, and no Overpass: close to the ground (below ~3 km) the z14 vector tiles of
// OpenFreeMap (the same tiles traffic.js drives on, so the browser often has them already) give every building
// OpenStreetMap knows, with its height and the height its lowest part starts at (render_height / render_min_height,
// from height, min_height or levels), and its colour when one is mapped. Each tile becomes one primitive, built in
// Cesium's workers, standing on the terrain when 3D terrain is on. Phones get fewer tiles and skip the smallest sheds.
// If OpenFreeMap can't be reached, the older Overpass path (osmbuildings.js) takes over. © OpenMapTiles, © OSM.
import { C, esc, fmt, PHONE } from './env.js';
import { viewer, scene, camera, camAGL } from './viewer.js';
import { Terrain } from './terrain.js';
import { L } from './layers.js';
import { state } from './state.js';
import { vtile, OFM } from './vtiles.js';
import { tileBuildings, buildingTint, ringMid, pickZoom, areaWords } from '../core/osmtiles.js';
import { OsmBuildings } from './osmbuildings.js';

const Z = 14, MAX_H = PHONE ? 2200 : 3500, MAX_TILES = PHONE ? 4 : 9, KEEP = PHONE ? 6 : 16;
const PER_TILE = PHONE ? 1800 : 6000, MIN_AREA = PHONE ? 25 : 0;
const tiles = new Map();   // 'z/x/y' -> { prim, used, n } | { loading } | { failed }
let timer = 0, credited = false, fails = 0, fallback = false, epoch = 0;
Terrain.onChange(() => { for (const t of tiles.values()) if (t.prim) scene.primitives.remove(t.prim); tiles.clear(); epoch++; });   // stand them on the new ground

const BldProto = {
  kind: 'building',
  tip() { return `Building · ${fmt(this.h)} m${this.min > 0 ? ` (from ${fmt(this.min)} m up)` : ''}`; },
  cardHtml() {
    return `<div class="k" style="--c:#c9d3e0">Building · OpenStreetMap</div><h2>${fmt(this.h)} m tall</h2><dl>`
      + (this.min > 0 ? `<dt>This part</dt><dd>from ${fmt(this.min)} m to ${fmt(this.h)} m above the ground</dd>` : '')
      + `<dt>Footprint</dt><dd>${esc(areaWords(this.area))}${this.area < 1e4 ? ` (${fmt(this.area)} m²)` : ''}</dd>`
      + (this.colour ? `<dt>Colour</dt><dd><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${this.colour};vertical-align:middle"></span> ${esc(this.colour)} (as mapped)</dd>` : '')
      + `<dt>Position</dt><dd>${this.lat.toFixed(5)}, ${this.lon.toFixed(5)}</dd></dl>`
      + `<div class="acts"><a class="chipbtn" href="https://www.openstreetmap.org/query?lat=${this.lat.toFixed(6)}&amp;lon=${this.lon.toFixed(6)}#map=19/${this.lat.toFixed(6)}/${this.lon.toFixed(6)}" target="_blank" rel="noopener">What's here on OpenStreetMap</a></div>`
      + `<div class="note" style="margin-top:8px">The height is the mapped height, or the number of floors times about 3 m, or a guess where neither is mapped (OpenMapTiles' render_height). Shapes are as volunteers drew them. From OpenFreeMap's tiles: © OpenMapTiles, © OpenStreetMap contributors (ODbL).</div>`;
  },
};

async function build(key) {
  const [z, x, y] = key.split('/').map(Number), my = epoch;
  tiles.set(key, { loading: true });
  try {
    const dec = await vtile(OFM, key, ['building']);
    const bs = tileBuildings(dec.building, z, x, y, { max: PER_TILE, minArea: MIN_AREA });
    const mids = bs.map(b => ringMid(b.outer));
    const bases = Terrain.on && !state.photoreal ? await Terrain.heights(mids) : null;   // the ground under each
    if (my !== epoch) return;   // the terrain changed while it loaded
    const inst = [];
    bs.forEach((b, i) => {
      const g = bases ? bases[i] : 0, bottom = b.min > 0 ? g + b.min : g - 1.5;   // sink ground floors a little into slopes
      const [r, gg, bb] = buildingTint(b), m = mids[i];
      try {
        inst.push(new C.GeometryInstance({ id: Object.assign(Object.create(BldProto), { h: b.h, min: b.min, area: b.area, colour: b.colour, lat: m.lat, lon: m.lon }),
          geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(b.outer), b.holes.map(h => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(h)))),
            height: bottom, extrudedHeight: g + b.h, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }),
          attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(new C.Color(r, gg, bb, 1)) } }));
      } catch (e) { /* a degenerate outline */ }
    });
    const prim = inst.length ? scene.primitives.add(new C.Primitive({ geometryInstances: inst, appearance: new C.PerInstanceColorAppearance({ translucent: false, closed: true }), asynchronous: true, show: false })) : null;
    tiles.set(key, { prim, used: Date.now(), n: inst.length });
    fails = 0;
    if (!credited) { credited = true; viewer.creditDisplay.addStaticCredit(new C.Credit('Buildings: OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors')); }
    tick();
  } catch (e) {
    tiles.set(key, { failed: Date.now() }); fails++; console.warn('buildings (OpenFreeMap)', e.message);
    if (fails >= 4 && !fallback) { fallback = true; console.warn('buildings: OpenFreeMap unreachable, using Overpass'); OsmBuildings.apply(); }
  }
}

function tick() {
  const on = L.buildings.on && !state.lookup && !state.photoreal, agl = camAGL(), low = agl < MAX_H;
  if (!on || !low || fallback) { for (const t of tiles.values()) if (t.prim) t.prim.show = false; return; }
  const c = camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), C.Ellipsoid.WGS84) || camera.positionWC;
  const g = C.Cartographic.fromCartesian(c), lat = C.Math.toDegrees(g.latitude), lon = C.Math.toDegrees(g.longitude);
  const pick = pickZoom(lat, lon, Math.min(2600, Math.max(500, agl * 1.4)), [Z], MAX_TILES) || { tiles: pickZoom(lat, lon, 500, [Z], MAX_TILES)?.tiles || [] };
  const want = new Set(pick.tiles);
  let busy = [...tiles.values()].filter(t => t.loading).length;
  for (const k of pick.tiles) {   // nearest first, two at a time (each is a few thousand polygons to build)
    const t = tiles.get(k);
    if ((!t || (t.failed && Date.now() - t.failed > 60e3)) && busy < 2) { build(k); busy++; }
  }
  const now = Date.now();
  for (const [k, t] of tiles) { if (!t.prim && !('prim' in t)) continue; const w = want.has(k); if (t.prim) t.prim.show = w; if (w) t.used = now; }
  const old = [...tiles].filter(([k, t]) => 'prim' in t && !want.has(k)).sort((a, b) => a[1].used - b[1].used);
  for (const [k, t] of old.slice(0, Math.max(0, tiles.size - KEEP))) { if (t.prim) scene.primitives.remove(t.prim); tiles.delete(k); }
  scene.requestRender();
}

export const TileBuildings = {
  /** Buildings drawn now (for the console). */
  get count() { let n = 0; for (const t of tiles.values()) if (t.prim?.show) n += t.n; return n; },
  get fallback() { return fallback; },
  apply() {
    if (fallback) { OsmBuildings.apply(); return; }
    if (L.buildings.on && !timer) timer = setInterval(tick, 800);
    else if (!L.buildings.on && timer) { clearInterval(timer); timer = 0; }
    tick(); scene.requestRender();
  },
  /** Hide without stopping (the ion tileset took over). */
  hide() { if (timer) { clearInterval(timer); timer = 0; } for (const t of tiles.values()) if (t.prim) t.prim.show = false; },
};
