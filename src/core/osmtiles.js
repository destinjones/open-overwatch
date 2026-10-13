// OpenStreetMap layers from vector tiles, without the Overpass API (public Overpass refuses a busy website). Three
// layers come out of tiles the browser can cache: 3D buildings (OpenFreeMap's `building` layer: render_height and
// render_min_height, z14), military areas (OpenFreeMap's `landuse` class=military, z9-12, named from the military
// airfields inside them) and licence-plate readers (the DeFlock / FlockHopper camera tiles: every ALPR mapped in
// OpenStreetMap in the US and Canada, rebuilt hourly). This file turns decoded tiles (core/mvt.js decodeTile) into plain
// objects in degrees: polygons grouped from MVT rings and clipped exactly to their tile (tiles overlap by a buffer, so
// unclipped shapes would be drawn twice), outlines without the tile seams, areas joined across tile edges, cameras with
// their facings. Pure (Node tests it); globe/military.js, globe/alpr.js and globe/tilebuildings.js draw.
import { unproject } from './mvt.js';

const R = 6371008.8, D = Math.PI / 180;

// ---- rings and polygons (tile units, y down) ------------------------------------------------------------------------

/** Twice the signed area of a flat ring [x0, y0, x1, y1, …] (closed or not), by the surveyor's formula. In tile units
 *  (y down) an MVT exterior ring is positive (clockwise on screen) and a hole negative. */
export function ringArea2(r) {
  let s = 0; const n = r.length;
  for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; s += r[i] * r[j + 1] - r[j] * r[i + 1]; }
  return s;
}
/** A ring without its repeated closing point. */
export function openRing(r) {
  const n = r.length;
  return n >= 4 && r[0] === r[n - 2] && r[1] === r[n - 1] ? r.slice(0, n - 2) : r.slice();
}
/**
 * MVT polygon parts -> [{ outer, holes: [] }] (rings open, tile units). An exterior ring starts a polygon and the
 * negative rings after it are its holes (MVT 2.x). Zero-area rings are dropped. Some old tiles wind the other way: the
 * first ring's sign decides which sign is "exterior".
 */
export function polygons(parts) {
  const out = []; let sign = 0, cur = null;
  for (const p of parts) {
    const r = openRing(p); if (r.length < 6) continue;
    const a = ringArea2(r); if (!a) continue;
    if (!sign) sign = Math.sign(a);
    if (Math.sign(a) === sign) out.push(cur = { outer: r, holes: [] });
    else if (cur) cur.holes.push(r);
  }
  return out;
}

/** Clip an open ring to a box (Sutherland-Hodgman): an open ring, empty when nothing is inside. Points on the box's
 *  edges are put exactly on them, so `onEdge` can tell a cut from a real side. */
export function clipRing(r, x0, y0, x1, y1) {
  let pts = r;
  const sides = [[0, x0, 1], [0, x1, -1], [1, y0, 1], [1, y1, -1]];   // [axis, value, inside direction]
  for (const [ax, v, dir] of sides) {
    if (!pts.length) break;
    const out = [], n = pts.length, inside = k => (pts[k + ax] - v) * dir >= 0;
    for (let i = 0; i < n; i += 2) {
      const j = (i + n - 2) % n, ci = inside(i), cj = inside(j);
      if (ci !== cj) {   // crossing: the point on the line
        const t = (v - pts[j + ax]) / (pts[i + ax] - pts[j + ax]), o = 1 - ax;
        const q = [0, 0]; q[ax] = v; q[o] = pts[j + o] + t * (pts[i + o] - pts[j + o]);
        out.push(q[0], q[1]);
      }
      if (ci) out.push(pts[i], pts[i + 1]);
    }
    pts = out;
  }
  // drop repeated points
  const clean = [];
  for (let i = 0; i < pts.length; i += 2) { const m = clean.length; if (!m || clean[m - 2] !== pts[i] || clean[m - 1] !== pts[i + 1]) clean.push(pts[i], pts[i + 1]); }
  if (clean.length >= 4 && clean[0] === clean[clean.length - 2] && clean[1] === clean[clean.length - 1]) clean.length -= 2;
  return clean.length >= 6 && ringArea2(clean) !== 0 ? clean : [];
}

/** Which side of the box a segment lies along ('W', 'E', 'N', 'S'), or null for a real side of the shape. */
export function onEdge(ax, ay, bx, by, x0, y0, x1, y1) {
  if (ax === x0 && bx === x0) return 'W'; if (ax === x1 && bx === x1) return 'E';
  if (ay === y0 && by === y0) return 'N'; if (ay === y1 && by === y1) return 'S';
  return null;
}
/** A clipped ring's outline without the cuts along the box: the runs of real sides, each a flat polyline. A ring with
 *  no cuts comes back closed (its first point repeated). */
export function outlineRuns(r, x0, y0, x1, y1) {
  const n = r.length / 2; if (n < 3) return [];
  const real = []; for (let k = 0; k < n; k++) { const a = k * 2, b = ((k + 1) % n) * 2; real.push(!onEdge(r[a], r[a + 1], r[b], r[b + 1], x0, y0, x1, y1)); }
  if (real.every(Boolean)) return [[...r, r[0], r[1]]];
  if (!real.some(Boolean)) return [];
  const start = real.indexOf(false), runs = []; let cur = null;   // begin just after a cut so no run wraps
  for (let s = 1; s <= n; s++) {
    const k = (start + s) % n;
    if (!real[k]) { cur = null; continue; }
    const a = k * 2, b = ((k + 1) % n) * 2;
    if (!cur) runs.push(cur = [r[a], r[a + 1]]);
    cur.push(r[b], r[b + 1]);
  }
  return runs;
}

// ---- tile units -> degrees ------------------------------------------------------------------------------------------

/** A tile's local point -> { lat, lon } (local 0..extent, the buffer beyond). */
export function tilePoint(px, py, z, x, y, extent = 4096) {
  return unproject(x * extent + px, y * extent + py, 2 ** z * extent);
}
/** A flat ring of local points -> flat [lon0, lat0, lon1, lat1, …] (Cesium's fromDegreesArray order). */
export function ringDegrees(r, z, x, y, extent = 4096) {
  const out = new Array(r.length);
  for (let i = 0; i < r.length; i += 2) { const p = tilePoint(r[i], r[i + 1], z, x, y, extent); out[i] = p.lon; out[i + 1] = p.lat; }
  return out;
}
/** Area in m² of a flat [lon, lat, …] ring (open), on a sphere, equirectangular about its middle: within a fraction of a
 *  percent for anything a tile holds. */
export function areaM2(ll) {
  if (ll.length < 6) return 0;
  let lat0 = 0; for (let i = 1; i < ll.length; i += 2) lat0 += ll[i]; lat0 /= ll.length / 2;
  const k = Math.cos(lat0 * D); let s = 0; const n = ll.length;
  for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; s += ll[i] * k * ll[j + 1] - ll[j] * k * ll[i + 1]; }
  return Math.abs(s) / 2 * D * D * R * R;
}
/** The middle of a flat [lon, lat, …] ring (the mean of its corners: fine for a building's terrain base). */
export function ringMid(ll) {
  let lon = 0, lat = 0; const n = ll.length / 2;
  for (let i = 0; i < ll.length; i += 2) { lon += ll[i]; lat += ll[i + 1]; }
  return { lon: lon / n, lat: lat / n };
}
/** Is a point inside a flat [lon, lat, …] ring (open)? Even-odd. */
export function inRing(lon, lat, ll) {
  let inside = false; const n = ll.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ll[i], yi = ll[i + 1], xj = ll[j], yj = ll[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Inside a polygon { outer, holes } in degrees? */
export const inPolygon = (lon, lat, p) => inRing(lon, lat, p.outer) && !p.holes.some(h => inRing(lon, lat, h));

/** A point well inside a polygon for its label: the middle of the widest span across a few horizontal lines (the mean
 *  of the corners can fall outside an L or a C). { lon, lat }. */
export function labelPoint(p) {
  const o = p.outer; let s = Infinity, n = -Infinity;
  for (let i = 1; i < o.length; i += 2) { s = Math.min(s, o[i]); n = Math.max(n, o[i]); }
  let best = null;
  for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    const lat = s + (n - s) * f, xs = [];
    for (const r of [o, ...p.holes]) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1], yj = r[j + 1];
      if ((yi > lat) !== (yj > lat)) xs.push(r[i] + (lat - yi) / (yj - yi) * (r[j] - r[i]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) { const w = xs[k + 1] - xs[k]; if (!best || w > best.w) best = { w, lon: (xs[k] + xs[k + 1]) / 2, lat }; }
    if (best && f === 0.5 && best.w > 0) break;   // the middle line is usually enough
  }
  return best ? { lon: best.lon, lat: best.lat } : ringMid(o);
}

// ---- which tiles ----------------------------------------------------------------------------------------------------

const EARTH = 40075016.686;
/** A tile's width in metres at a latitude. */
export const tileWidth = (z, lat) => EARTH * Math.cos(lat * D) / 2 ** z;
/** The tiles a circle (radius m) around a point touches, nearest first: ['z/x/y', …]. Columns wrap at 180°; rows stop
 *  at Web Mercator's edge. */
export function tilesAround(lat, lon, radius, z) {
  const n = 2 ** z, la = Math.max(-85.05, Math.min(85.05, lat));
  const fx = (((lon + 180) % 360 + 360) % 360) / 360 * n, s = Math.sin(la * D), fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const cx = Math.floor(fx), cy = Math.min(n - 1, Math.floor(fy));
  const span = Math.ceil(radius / Math.max(1, tileWidth(z, la))) + 1, out = [];
  const rowLat = yy => Math.atan(Math.sinh(Math.PI * (1 - 2 * yy / n))) / D;
  for (let dy = -span; dy <= span; dy++) {
    const ty = cy + dy; if (ty < 0 || ty >= n) continue;
    for (let dx = -span; dx <= span; dx++) {
      const tx = ((cx + dx) % n + n) % n;
      // nearest point of the tile to the centre, in metres
      const nx = Math.max(cx + dx, Math.min(fx, cx + dx + 1)), latN = rowLat(ty), latS = rowLat(ty + 1), qlat = Math.max(latS, Math.min(latN, la));
      const d = Math.hypot((nx - fx) / n * EARTH * Math.cos(la * D), (qlat - la) * D * R);
      if (d <= radius) out.push([`${z}/${tx}/${ty}`, d]);
    }
  }
  return out.sort((a, b) => a[1] - b[1]).map(t => t[0]);
}
/** The most detailed zoom in `zooms` (highest first) whose tiles for a circle number at most `max`; null if none. */
export function pickZoom(lat, lon, radius, zooms, max) {
  for (const z of zooms) { const t = tilesAround(lat, lon, radius, z); if (t.length <= max) return { z, tiles: t }; }
  return null;
}

// ---- 3D buildings (OpenFreeMap `building`, z14) ---------------------------------------------------------------------

export const MAX_BUILDING_H = 900;   // the tallest towers are ~830 m; anything taller is a tagging mistake
/**
 * A tile's buildings: [{ outer, holes (flat lon/lat, open), h (top, m), min (bottom, m), colour (css or null), area (m²) }],
 * clipped to the tile, the biggest (footprint x height) first when there are more than `max`. Parts marked hide_3d (a
 * building outline whose parts are drawn instead) are left out.
 */
export function tileBuildings(layer, z, x, y, { max = Infinity, minArea = 0 } = {}) {
  if (!layer) return [];
  const ext = layer.extent || 4096, out = [];
  for (const f of layer.features) {
    if (f.type !== 3 || f.props.hide_3d) continue;
    const h = Math.min(MAX_BUILDING_H, Number(f.props.render_height) || 0), min = Math.max(0, Math.min(h - 1, Number(f.props.render_min_height) || 0));
    if (!(h > 0)) continue;
    const colour = typeof f.props.colour === 'string' && /^#[0-9a-f]{6}$/i.test(f.props.colour) ? f.props.colour.toLowerCase() : null;
    for (const p of polygons(f.parts)) {
      const outer = clipRing(p.outer, 0, 0, ext, ext); if (!outer.length) continue;
      const holes = p.holes.map(hr => clipRing(hr, 0, 0, ext, ext)).filter(hr => hr.length);
      const ll = ringDegrees(outer, z, x, y, ext), area = areaM2(ll);
      if (area < minArea) continue;
      out.push({ outer: ll, holes: holes.map(hr => ringDegrees(hr, z, x, y, ext)), h, min, colour, area });
    }
  }
  if (out.length > max) { out.sort((a, b) => b.area * b.h - a.area * a.h); out.length = max; }
  return out;
}
/** A building's colour: its mapped colour (OpenMapTiles' `colour`, from building:colour or the material) toned toward a
 *  light grey so the city reads as one, else the grey, a little cooler and darker the taller. [r, g, b] 0..1. */
export function buildingTint(b) {
  const k = Math.min(1, b.h / 150), grey = [0.80 - 0.18 * k, 0.81 - 0.14 * k, 0.84 - 0.04 * k];
  if (!b.colour) return grey;
  const c = [1, 3, 5].map(i => parseInt(b.colour.slice(i, i + 2), 16) / 255);
  return grey.map((g, i) => g * 0.45 + c[i] * 0.55);
}

// ---- military areas (OpenFreeMap `landuse` class=military, z9-12) ---------------------------------------------------

/**
 * A tile's military areas and what can name them. pieces: [{ id ('z/x/y#n'), tile, polys: [{ outer, holes }] (lon/lat,
 * clipped to the tile), runs: [flat lon/lat polylines] (the outline, no tile seams), cuts: [{ line, a, b, side }]
 * (where it was cut at the tile's edge, in world units, for joining), area (m²) }]. fields: military airfields
 * (aerodrome_label class=military) [{ name, lat, lon, icao, iata }]. places: towns [{ name, lat, lon, cls, rank }].
 */
export function tileMilitary(decoded, z, x, y) {
  const out = { pieces: [], fields: [], places: [] }, tile = `${z}/${x}/${y}`;
  const lu = decoded.landuse;
  if (lu) {
    const ext = lu.extent || 4096;
    lu.features.forEach((f, n) => {
      if (f.type !== 3 || f.props.class !== 'military') return;
      const polys = [], runs = [], cuts = [];
      for (const p of polygons(f.parts)) {
        const outer = clipRing(p.outer, 0, 0, ext, ext); if (!outer.length) continue;
        const holes = p.holes.map(hr => clipRing(hr, 0, 0, ext, ext)).filter(hr => hr.length);
        polys.push({ outer: ringDegrees(outer, z, x, y, ext), holes: holes.map(hr => ringDegrees(hr, z, x, y, ext)) });
        for (const r of [outer, ...holes]) {
          for (const run of outlineRuns(r, 0, 0, ext, ext)) runs.push(ringDegrees(run, z, x, y, ext));
          for (let i = 0; i < r.length; i += 2) {   // the cuts, in world units so neighbours meet on the same line
            const j = (i + 2) % r.length, side = onEdge(r[i], r[i + 1], r[j], r[j + 1], 0, 0, ext, ext); if (!side) continue;
            const vert = side === 'W' || side === 'E', line = vert ? x * ext + r[i] : y * ext + r[i + 1];
            const a = vert ? y * ext + r[i + 1] : x * ext + r[i], b = vert ? y * ext + r[j + 1] : x * ext + r[j];
            cuts.push({ line: (vert ? 'x' : 'y') + line, side, a: Math.min(a, b), b: Math.max(a, b), ext });
          }
        }
      }
      if (!polys.length) return;
      out.pieces.push({ id: `${tile}#${n}`, tile, z, polys, runs, cuts, area: polys.reduce((s, p) => s + areaM2(p.outer) - p.holes.reduce((t, h) => t + areaM2(h), 0), 0) });
    });
  }
  const pt = (f, l) => f.parts[0] && tilePoint(f.parts[0][0], f.parts[0][1], z, x, y, l.extent || 4096);
  for (const f of decoded.aerodrome_label?.features || []) {
    if (f.props.class !== 'military' || !f.props.name) continue;
    const p = pt(f, decoded.aerodrome_label); if (!p) continue;
    out.fields.push({ name: String(f.props.name_en || f.props.name), lat: p.lat, lon: p.lon, icao: f.props.icao || null, iata: f.props.iata || null });
  }
  for (const f of decoded.place?.features || []) {
    if (!['city', 'town', 'village'].includes(f.props.class) || !f.props.name) continue;
    const p = pt(f, decoded.place); if (!p) continue;
    out.places.push({ name: String(f.props.name_en || f.props.name), lat: p.lat, lon: p.lon, cls: f.props.class, rank: Number(f.props.rank) || 99 });
  }
  return out;
}
const OPP = { W: 'E', E: 'W', N: 'S', S: 'N' };
/**
 * Join pieces from neighbouring tiles (one zoom) into whole areas: two pieces belong together where one's cut on a tile
 * edge overlaps the other's cut on the same line from the other side. -> [{ pieces, area (m²), key (the id of its
 * biggest piece, stable while that piece is loaded) }], biggest first.
 */
export function joinPieces(pieces) {
  const parent = pieces.map((_, i) => i), find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const byLine = new Map();
  pieces.forEach((p, i) => { for (const c of p.cuts) { const k = p.z + ':' + c.line; if (!byLine.has(k)) byLine.set(k, []); byLine.get(k).push([i, c]); } });
  for (const list of byLine.values()) {
    for (let s = 0; s < list.length; s++) for (let t = s + 1; t < list.length; t++) {
      const [i, a] = list[s], [j, b] = list[t];
      if (OPP[a.side] !== b.side || pieces[i].tile === pieces[j].tile) continue;
      if (Math.min(a.b, b.b) - Math.max(a.a, b.a) > 1e-6) { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; }
    }
  }
  const groups = new Map();
  pieces.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  return [...groups.values()].map(ps => {
    const big = ps.reduce((a, b) => b.area > a.area ? b : a);
    return { pieces: ps, area: ps.reduce((s, p) => s + p.area, 0), key: big.id };
  }).sort((a, b) => b.area - a.area);
}
const PLACE_ORDER = { city: 0, town: 1, village: 2 };
const km = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * D), b.lat - a.lat) * D * R / 1000;
/**
 * What to call an area and where to put its label: { name (the military airfields inside, or null), fields: [names],
 * near ({ name, km } the nearest town, cities preferred within 1.5x the distance), at ({ lon, lat }, inside its biggest
 * polygon) }. OpenFreeMap's tiles carry no names for military land, so an area without an airfield stays unnamed.
 */
export function describeArea(area, fields, places) {
  const big = area.pieces.reduce((a, b) => b.area > a.area ? b : a);
  const poly = big.polys.reduce((a, b) => areaM2(b.outer) > areaM2(a.outer) ? b : a), at = labelPoint(poly);
  const inside = [], seen = new Set();
  for (const f of fields) if (!seen.has(f.name) && area.pieces.some(p => p.polys.some(q => inPolygon(f.lon, f.lat, q)))) { seen.add(f.name); inside.push(f); }
  let near = null;
  for (const p of places) {
    const d = km(at, p), score = d * (1 + 0.25 * (PLACE_ORDER[p.cls] ?? 3));
    if (d < 60 && (!near || score < near.score)) near = { name: p.name, km: d, score };
  }
  return { name: inside.length ? inside[0].name + (inside.length > 1 ? ` (+${inside.length - 1})` : '') : null, fields: inside.map(f => f.name), near: near && { name: near.name, km: near.km }, at };
}
/** "12.4 km²", "860 ha", "3,200 km²". */
export function areaWords(m2) {
  if (m2 < 1e6) return `${Math.max(1, Math.round(m2 / 1e4)).toLocaleString('en-US')} ha`;
  const k = m2 / 1e6;
  return `${k < 10 ? k.toFixed(1) : Math.round(k).toLocaleString('en-US')} km²`;
}

// ---- licence-plate readers (DeFlock / FlockHopper camera tiles) -----------------------------------------------------

const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** Degrees -> 'N', 'NE', … (16 points). */
export const cardinal = deg => CARD[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
/**
 * Where a camera faces, in degrees: from `direction` (a number), `directions` ("90;270", "45-135" as its middle) or a
 * compass word ("NE", "south-west"). [] when untagged. Each 0-360.
 */
export function facings(direction, directions, word) {
  const out = [], add = v => { if (Number.isFinite(v)) { const d = ((v % 360) + 360) % 360; if (!out.some(o => Math.abs(o - d) < 0.5)) out.push(d); } };
  const parse = s => {
    for (const bit of String(s).split(/[;,]/)) {
      const t = bit.trim(); if (!t) continue;
      const range = t.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
      if (range) { let a = +range[1], b = +range[2]; if (b < a) b += 360; add((a + b) / 2); continue; }
      if (/^-?\d+(\.\d+)?$/.test(t)) { add(+t); continue; }
      const w = t.toUpperCase().replace(/[^A-Z]/g, '').replace(/NORTH/g, 'N').replace(/SOUTH/g, 'S').replace(/EAST/g, 'E').replace(/WEST/g, 'W');
      const k = CARD.indexOf(w); if (k >= 0) add(k * 22.5);
    }
  };
  if (typeof direction === 'number') add(direction); else if (direction != null) parse(direction);
  if (directions != null) parse(directions);
  if (!out.length && word) parse(word);
  return out;
}
/**
 * A camera tile's cameras: [{ id ('n123' / 'w123'), osmId, osmType, lat, lon, brand, operator, facings: [deg], zone,
 * mount, ref, since, edited, version }]. Below the detail zoom the tiles only carry positions (a heat map): those come
 * back as { id: null, heat: true, lat, lon }.
 */
export function tileCameras(layer, z, x, y) {
  if (!layer) return [];
  const ext = layer.extent || 4096, out = [], str = v => v == null || v === '' ? null : String(v);
  for (const f of layer.features) {
    if (f.type !== 1) continue;
    const p = f.props;
    for (const part of f.parts) for (let i = 0; i + 1 < part.length; i += 2) {
      const ll = tilePoint(part[i], part[i + 1], z, x, y, ext);
      if (p.osmId == null) { out.push({ id: null, heat: true, lat: ll.lat, lon: ll.lon }); continue; }
      const type = str(p.osmType) || 'node';
      out.push({ id: type[0] + p.osmId, osmId: Number(p.osmId), osmType: type, lat: ll.lat, lon: ll.lon,
        brand: str(p.brand), operator: str(p.operator), facings: facings(p.direction, p.directions, p.directionCardinal), zone: str(p.surveillanceZone),
        mount: str(p.mountType), ref: str(p.ref), since: str(p.startDate), edited: str(p.osmTimestamp), version: Number(p.osmVersion) || null });
    }
  }
  return out;
}
const ZONE = { traffic: 'Traffic', parking: 'A car park', town: 'A town street', street: 'A street', building: 'A building', shop: 'A shop' };
const MOUNT = { pole: 'a pole', traffic_signals: 'traffic lights', street_lamp: 'a street light', wall: 'a wall', ceiling: 'a ceiling', building: 'a building', trailer: 'a trailer (mobile)', bridge: 'a bridge', gantry: 'a gantry' };
const DAY = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : s; };
/** A plate reader's card rows: [[label, text]] in plain words (escaping is the caller's job). */
export function cameraFacts(c) {
  const rows = [];
  if (c.brand) rows.push(['Make', c.brand]);
  if (c.operator) rows.push(['Run by', c.operator]);
  if (c.facings.length) rows.push(['Faces', c.facings.map(d => `${cardinal(d)} (${Math.round(d)}°)`).join(', ')]);
  if (c.zone) rows.push(['Watches', ZONE[c.zone] || c.zone.replace(/_/g, ' ')]);
  if (c.mount) rows.push(['Mounted on', MOUNT[c.mount] || c.mount.replace(/_/g, ' ')]);
  if (c.ref) rows.push(['Ref', c.ref]);
  if (c.since) rows.push(['Since', DAY(c.since)]);
  if (c.edited) rows.push(['Mapped', `${DAY(c.edited)}${c.version > 1 ? ` (edit ${c.version})` : ''}`]);
  return rows;
}
/** Is a point inside a TileJSON `bounds` [w, s, e, n]? */
export const inBounds = (b, lat, lon) => !!b && lon >= b[0] && lat >= b[1] && lon <= b[2] && lat <= b[3];
