// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// 3D buildings with no account and no key: close to the ground (below ~2.5 km) the globe asks OpenStreetMap, through the public
// Overpass API, for the building outlines of the 0.01-degree squares around the view, and stands each one up as a block (its mapped
// height, or its floors x 3.2 m, or 9 m). One request at a time, one every 6 s at most, each square cached for the session.
// (c) OpenStreetMap contributors, ODbL. Now only the fallback for when OpenFreeMap's tiles can't be reached (tilebuildings.js).
import { C, toast } from './env.js';
import { viewer, scene, camera, camAGL } from './viewer.js';
import { Terrain } from './terrain.js';
import { L } from './layers.js';
import { state } from './state.js';
import { overpass } from '../core/overpass.js';

const CELL = 0.01, MAX_H = 2500, MAX_CELLS = 40, MAX_PER_CELL = 2500, GAP_MS = 6000;
const cells = new Map();   // key -> { prim, t }  (prim null while loading or empty)
let busy = false, last = 0, timer = 0, told = false, credited = false;
Terrain.onChange(() => { for (const c of cells.values()) if (c.prim) scene.primitives.remove(c.prim); cells.clear(); });   // stand them on the new ground: load again

const key = (ix, iy) => ix + ',' + iy;
const heightOf = t => { const h = parseFloat(t.height); if (h > 0) return Math.min(h, 500); const lv = parseFloat(t['building:levels']); if (lv > 0) return Math.min(lv * 3.2 + 1.5, 500); return 9; };
const tint = h => { const k = Math.min(1, h / 150); return new C.Color(0.80 - 0.18 * k, 0.81 - 0.14 * k, 0.84 - 0.04 * k, 1); };   // warm light grey, cooler and darker the taller

async function fetchCell(ix, iy) {
  const s = iy * CELL, w = ix * CELL, q = `[out:json][timeout:25];way["building"](${s},${w},${s + CELL},${w + CELL});out geom tags;`;
  return (await overpass(q, { timeout: 40000 })).elements || [];   // the shared, polite queue (both servers)
}

function build(els, bases = []) {
  const inst = [];
  els.slice(0, MAX_PER_CELL).forEach((e, i) => {
    if (!e.geometry || e.geometry.length < 4) return;
    const h = heightOf(e.tags || {}), pts = e.geometry.map(p => [p.lon, p.lat]).flat();
    const g = Terrain.on ? (bases[i] || 0) - 1.5 : 0;
    try { inst.push(new C.GeometryInstance({ geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(pts)), height: g, extrudedHeight: g + h, vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT }),
      attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(tint(h)) } })); } catch (err) { /* a degenerate outline */ }
  });
  return inst.length ? scene.primitives.add(new C.Primitive({ geometryInstances: inst, appearance: new C.PerInstanceColorAppearance({ translucent: false, closed: true }), show: true })) : null;
}

async function tick() {
  const on = L.buildings.on && !state.lookup && !state.photoreal, low = camAGL() < MAX_H;   // Google's photoreal city has its own   // from look-up's eye height they'd tower over the sky
  for (const c of cells.values()) if (c.prim) c.prim.show = on && low;
  if (!on || !low || busy || performance.now() - last < GAP_MS) return;
  const p = camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), scene.globe.ellipsoid) || camera.positionWC;
  const g = C.Cartographic.fromCartesian(p), lon = C.Math.toDegrees(g.longitude), lat = C.Math.toDegrees(g.latitude);
  const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
  // the squares around the view centre, nearest first (a 3 x 3 block; low down, one square is a screenful)
  const want = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) want.push([cx + dx, cy + dy, Math.abs(dx) + Math.abs(dy)]);
  want.sort((a, b) => a[2] - b[2]);
  const next = want.find(([x, y]) => !cells.has(key(x, y)));
  if (!next) return;
  const k = key(next[0], next[1]); cells.set(k, { prim: null, t: Date.now() }); busy = true; last = performance.now();
  try {
    const els = (await fetchCell(next[0], next[1])).slice(0, MAX_PER_CELL);
    const mids = els.map(e => { const g = e.geometry || [{ lat: 0, lon: 0 }]; return { lat: g.reduce((a, p) => a + p.lat, 0) / g.length, lon: g.reduce((a, p) => a + p.lon, 0) / g.length }; });
    const bases = await Terrain.heights(mids);   // the ground under each block (0s while terrain is off)
    const c = cells.get(k); if (!c) return;      // cleared while it loaded (the terrain changed)
    c.prim = build(els, bases);
    if (!credited) { viewer.creditDisplay.addStaticCredit(new C.Credit('Buildings © OpenStreetMap contributors (ODbL)')); credited = true; }
    if (cells.size > MAX_CELLS) { const oldest = [...cells].filter(([, c]) => c !== cells.get(k)).sort((a, b) => a[1].t - b[1].t)[0]; if (oldest) { if (oldest[1].prim) scene.primitives.remove(oldest[1].prim); cells.delete(oldest[0]); } }
    scene.requestRender();
  } catch (e) { cells.delete(k); if (!told) { told = true; toast('Building data is busy right now: it will retry as you move', 4000); } }
  busy = false;
}

export const OsmBuildings = {
  apply() { if (L.buildings.on && !timer) { timer = setInterval(tick, 800); tick(); } else if (!L.buildings.on) { for (const c of cells.values()) if (c.prim) c.prim.show = false; } scene.requestRender(); },
};
