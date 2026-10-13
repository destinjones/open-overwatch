// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Keyless 3D terrain: Mapterhorn's merged global elevation model as quantized-mesh tiles from Re:Earth (no key, CORS,
// cached 30 days; heights above the WGS84 ellipsoid with EGM2008 undulations blended in, so they match Cesium's frame;
// Cesium credits it from the tileset). A layer switch, on by default except on phones (more tiles and triangles there).
// A request the server refuses (429 or 5xx) is retried three times after a shared pause (0.75 s doubling to 15 s);
// if the tileset can't be reached at all, the globe stays the smooth ellipsoid. Things drawn at ground level ask
// `Terrain.height` where they stand (the tiles already loaded for the view answer at once).
import { C, toast } from './env.js';
import { viewer, globe, camera } from './viewer.js';

const URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
const flat = new C.EllipsoidTerrainProvider(), D = Math.PI / 180, carto = new C.Cartographic();
let provider = null, pending = null, want = false, pause = 0, pauseUntil = 0, told = false;

function resource() {
  return new C.Resource({ url: URL, retryAttempts: 3, retryCallback: async (res, err) => {
    const code = err && err.statusCode;
    if (code && code !== 429 && code < 500) return false;   // a 404 is just a tile that doesn't exist
    const now = performance.now();
    if (now - pauseUntil > 30e3) pause = 0;                 // a quiet spell resets the backoff
    pause = Math.min(15e3, pause ? pause * 2 : 750); pauseUntil = Math.max(pauseUntil, now + pause);
    await new Promise(r => setTimeout(r, pauseUntil - now));
    return true;
  } });
}

// Heights for spots, fetched in batches and kept. The most detailed ones seat cars and parked planes (the tiles drawn for
// the view are coarse until they load: a car seated on one is metres, in the mountains a hundred metres, off when it
// sharpens); coarse ones (level 9, ~300 m) keep low fliers out of the hills without fetching detail for 400 km around.
// Reading the drawn tiles instead (globe.getHeight) costs ~0.8 ms a point: fine once a second, not per car.
function cache(level) {
  const got = new Map(), queue = new Map();   // "lat,lon" (rounded) -> metres (null: no tile there) / -> [lat, lon]
  let busy = false;
  async function flush() {
    const batch = [...queue].slice(0, 500);   // small batches: the answers are handled between frames
    for (const [k] of batch) queue.delete(k);
    const cs = batch.map(([, [lat, lon]]) => C.Cartographic.fromDegrees(lon, lat));
    try { if (Terrain.on && provider) await (level == null ? C.sampleTerrainMostDetailed(provider, cs) : C.sampleTerrain(provider, level, cs)); }
    catch (e) { console.warn('terrain heights', e && e.message); }
    batch.forEach(([k], i) => got.set(k, Number.isFinite(cs[i].height) ? cs[i].height : null));
    if (got.size > 60000) { let n = got.size - 50000; for (const k of got.keys()) { got.delete(k); if (--n <= 0) break; } }
    busy = queue.size > 0;
    if (busy) setTimeout(flush, 30);
  }
  return (lat, lon, dp) => {   // the height if known (undefined: asked for; null: none there)
    const k = lat.toFixed(dp) + ',' + lon.toFixed(dp), v = got.get(k);
    if (v === undefined && !queue.has(k)) {
      queue.set(k, [+lat.toFixed(dp), +lon.toFixed(dp)]);
      if (!busy) { busy = true; setTimeout(flush, 120); }
    }
    return v;
  };
}
const detailed = cache(null), coarse = cache(9);

const listeners = [];
export const Terrain = {
  on: false,
  /** true when the last ground() answer was the most detailed height (false: it was null, ask again later). */
  exact: false,
  /** The ground under the camera (refreshed each second): a stand-in for points whose height hasn't arrived. */
  ref: 0,
  /** Ground height at a point to `dp` decimals (5 ~ 1 m, 4 ~ 10 m): the most detailed height once fetched (exact = true),
   *  null until then (it is fetched in the background). 0 while terrain is off. */
  ground(lat, lon, dp = 5) {
    if (!this.on) { this.exact = true; return 0; }
    const v = detailed(lat, lon, dp);
    this.exact = v != null;
    return v ?? null;
  },
  /** A coarse ground height (level 9, ~300 m) at a point to 2 decimals (~1 km), or null until it has arrived. */
  coarse(lat, lon) { return this.on ? coarse(lat, lon, 2) ?? null : 0; },
  camLat: 0, camLon: 0,
  /** Ground height for something seen from the camera, never null: the most detailed within `detailDeg` of the camera
   *  (exact = true once it has arrived), a coarse one within 2°, else the ground under the camera. Far things only get
   *  coarse tiles, so a feed spread over a country never pulls the detailed tiles for all of it. */
  near(lat, lon, dp = 4, detailDeg = 0.1) {
    if (!this.on) { this.exact = true; return 0; }
    const dLat = Math.abs(lat - this.camLat), dLon = Math.abs(((lon - this.camLon + 540) % 360) - 180) * Math.cos(lat * D);
    this.exact = true;
    if (dLat < detailDeg && dLon < detailDeg) { const g = detailed(lat, lon, dp); if (g != null) return g; this.exact = false; }
    if (dLat < 2 && dLon < 2) { const g = coarse(lat, lon, 2); if (g != null) return g; this.exact = false; }
    return this.ref;
  },
  /** Ground height (m above the ellipsoid) at a point from the tiles drawn now; `fallback` where none is loaded. 0 while
   *  terrain is off. ~0.8 ms a call: for one-offs, never per object per frame. */
  height(lat, lon, fallback = 0) {
    if (!this.on) return 0;
    carto.longitude = lon * D; carto.latitude = lat * D; carto.height = 0;
    const h = globe.getHeight(carto);
    return h === undefined ? fallback : h;
  },
  /** The most detailed ground height at points [{ lat, lon }] (async, fetches tiles as needed); 0s while terrain is off. */
  async heights(points) {
    if (!this.on || !points.length) return points.map(() => 0);
    const cs = points.map(p => C.Cartographic.fromDegrees(p.lon, p.lat));
    try { await C.sampleTerrainMostDetailed(provider, cs); } catch (e) { console.warn('terrain heights', e.message); }
    return cs.map(c => Number.isFinite(c.height) ? c.height : 0);
  },
  /** fn(on): called whenever the terrain comes or goes (things standing on the ground re-seat themselves). */
  onChange(fn) { listeners.push(fn); },
  /** Turn on or off (the dock switch). */
  async apply(on) {
    want = on;
    if (!on) { if (this.on) { this.on = false; viewer.terrainProvider = flat; for (const fn of listeners) fn(false); } return; }
    if (this.on) return;
    try {
      provider = provider || await (pending = pending || C.CesiumTerrainProvider.fromUrl(resource(), { requestVertexNormals: true }));
      if (!want || this.on) return;   // switched off again while it loaded
      viewer.terrainProvider = provider; this.on = true;
      for (const fn of listeners) fn(true);
    } catch (e) {
      pending = null; console.warn('terrain', e && e.message);
      if (!told) { told = true; toast('3D terrain is unavailable right now: the globe stays smooth', 4000); }
    }
  },
};
setInterval(() => {   // a camera that a scripted flight left inside a hill (Cesium only guards the user's own moves): lift it out
  const c = Terrain.on && camera.positionCartographic; if (!c || c.height > 1e4) return;
  const g = globe.getHeight(c);
  if (g !== undefined && c.height < g - 5) camera.setView({ destination: C.Cartesian3.fromRadians(c.longitude, c.latitude, g + 60), orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 } });
}, 500);
setInterval(() => {   // the ground under the camera, for stand-ins
  const c = Terrain.on && camera.positionCartographic; if (!c) return;
  Terrain.camLat = C.Math.toDegrees(c.latitude); Terrain.camLon = C.Math.toDegrees(c.longitude);
  if (c.height > 3e5) return;
  const g = Terrain.ground(Terrain.camLat, Terrain.camLon, 3); if (g != null) Terrain.ref = g;
}, 1000);
