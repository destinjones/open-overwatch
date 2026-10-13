// Fire detections in an area, made answerable: which GIBS tiles cover it (across the antimeridian too), and the hot pixels
// grouped into fires (single linkage: detections within ~2.5 km of each other are one fire), each with its size, power and
// last sighting. Pure (test/fireclusters.test.mjs); the MCP server's wildfires tool uses it with core/hazards.js.
import { fireTilesFor, fireTileDeg } from './hazards.js';

const KM_DEG = 111.32, D2R = Math.PI / 180;

/**
 * The tiles covering a circle (lat, lon, km): the most detailed level (at most `maxLevel`) that needs no more than
 * `maxTiles`. Returns { level, tiles: [{ level, row, col }] }; a circle across the antimeridian takes tiles on both sides.
 */
export function fireTilesAround(lat, lon, km, { maxTiles = 6, maxLevel = 6, minLevel = 2 } = {}) {
  const dLat = km / KM_DEG, dLon = Math.min(180, km / (KM_DEG * Math.max(0.05, Math.cos(Math.min(89, Math.abs(lat) + dLat) * D2R))));
  const s = Math.max(-90, lat - dLat), n = Math.min(90, lat + dLat), boxes = [];
  if (dLon >= 180) boxes.push([-180, 180]);
  else {
    const w = lon - dLon, e = lon + dLon;
    if (w < -180) boxes.push([w + 360, 180], [-180, e]); else if (e > 180) boxes.push([w, 180], [-180, e - 360]); else boxes.push([w, e]);
  }
  for (let level = maxLevel; level >= minLevel; level--) {
    const tiles = boxes.flatMap(([w, e]) => fireTilesFor(w, s, e, n, level));
    if (tiles.length <= maxTiles || level === minLevel) return { level, tiles };
  }
  return { level: minLevel, tiles: [] };
}
export { fireTileDeg };

/**
 * Detections ({ lat, lon, frp, t, day, conf, sat }) grouped into fires: [{ count, frp (total MW), max_frp, lat, lon (the
 * power-weighted centre), km (the group's longest side), first, last (ms), night (detections at night) }], strongest first.
 */
export function clusterFires(fires, linkKm = 2.5) {
  const n = fires.length, parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  // cells at least a link wide both ways (east-west at the most poleward detection), so a link never skips a cell
  let top = 0; for (const f of fires) top = Math.max(top, Math.abs(f.lat));
  const cell = linkKm / KM_DEG, cellLon = cell / Math.max(0.05, Math.cos(Math.min(87, top) * D2R)), grid = new Map(), key = (y, x) => y + ',' + x;
  fires.forEach((f, i) => { const y = Math.floor(f.lat / cell), x = Math.floor(f.lon / cellLon), k = key(y, x), g = grid.get(k); if (g) g.list.push(i); else grid.set(k, { y, x, list: [i] }); });
  for (const { y, x, list } of grid.values()) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const o = grid.get(key(y + dy, x + dx)), other = o && o.list; if (!other) continue;
      for (const i of list) for (const j of other) {
        if (j <= i) continue;
        const a = fires[i], b = fires[j], kx = KM_DEG * Math.cos(a.lat * D2R);
        if (Math.hypot((a.lat - b.lat) * KM_DEG, (a.lon - b.lon) * kx) <= linkKm) join(i, j);
      }
    }
  }
  const groups = new Map();
  fires.forEach((f, i) => { const r = find(i); const g = groups.get(r); if (g) g.push(f); else groups.set(r, [f]); });
  const out = [];
  for (const list of groups.values()) {
    let frp = 0, max = 0, wl = 0, wx = 0, wy = 0, first = Infinity, last = -Infinity, night = 0, s = 90, nn = -90, w = 180, e = -180;
    for (const f of list) {
      const p = Math.max(0.1, f.frp || 0); frp += f.frp || 0; if ((f.frp || 0) > max) max = f.frp || 0;
      wl += p; wy += f.lat * p; wx += f.lon * p; if (f.t < first) first = f.t; if (f.t > last) last = f.t; if (!f.day) night++;
      if (f.lat < s) s = f.lat; if (f.lat > nn) nn = f.lat; if (f.lon < w) w = f.lon; if (f.lon > e) e = f.lon;
    }
    const lat = wy / wl, lon = wx / wl;
    out.push({ count: list.length, frp, max_frp: max, lat, lon, km: Math.max((nn - s) * KM_DEG, (e - w) * KM_DEG * Math.cos(lat * D2R)) + 0.375, first, last, night });
  }
  return out.sort((a, b) => b.frp - a.frp || b.count - a.count);
}

/** A fire group in words: how strong it looks from orbit. */
export function fireWords(g) {
  const size = g.count === 1 ? 'a single hot pixel' : `${g.count} hot pixels over about ${g.km < 1.5 ? 'a kilometre' : Math.round(g.km) + ' km'}`;
  const how = g.frp >= 1000 ? 'a very large, intense fire' : g.frp >= 200 ? 'a large fire' : g.frp >= 50 ? 'a sizeable fire' : g.count >= 3 ? 'a small fire' : 'a small hot spot';
  return `${how} (${size}, ${Math.round(g.frp).toLocaleString('en-US')} MW radiated)`;
}

/** NIFC WFIGS perimeter records without their shapes (f=json, returnCentroid) -> [{ id, name, acres, contained, state, discovered, updated, cause, prescribed, lat, lon }]. */
export function perimeterRows(d) {
  return ((d && d.features) || []).map(f => {
    const a = f.attributes || {}, c = f.centroid || {};
    const lat = Number.isFinite(+c.y) && c.y !== null ? +c.y : +a.attr_InitialLatitude, lon = Number.isFinite(+c.x) && c.x !== null ? +c.x : +a.attr_InitialLongitude;
    return { id: String(a.attr_UniqueFireIdentifier || ''), name: String(a.poly_IncidentName || a.attr_IncidentName || 'Fire'), acres: Number.isFinite(+a.attr_IncidentSize) && a.attr_IncidentSize !== null ? +a.attr_IncidentSize : null,
      contained: a.attr_PercentContained == null ? null : +a.attr_PercentContained, state: String(a.attr_POOState || '').replace(/^US-/, '') || null,
      discovered: +a.attr_FireDiscoveryDateTime || null, updated: +a.poly_DateCurrent || null, cause: a.attr_FireCause ? String(a.attr_FireCause) : null, prescribed: a.attr_IncidentTypeCategory === 'RX', lat, lon };
  }).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}
