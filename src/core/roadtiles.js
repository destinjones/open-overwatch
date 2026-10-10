// Roads from vector tiles (the OpenMapTiles schema that OpenFreeMap serves) as "ways" for core/traffic.js's buildGraph.
// Tiles overlap by a buffer, so each road line is clipped to its own tile and joined to its neighbour where both cross
// the shared edge; junctions are where lines share a vertex (or where a street ends on another road between its
// vertices); names come from the transportation_name layer; and since the tiles carry no traffic signals, junctions of
// busy roads get lights. Each tile is prepared once (prepareTile); joining the tiles in view is cheap (joinTiles).
// Points are world units: tile * extent + local (z14 x 4096 -> ~0.6 m at the equator). Pure (Node tests it).
import { unproject } from './mvt.js';

const CLASS = { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'residential' };
const RAMP = { motorway: 'motorway_link', trunk: 'trunk_link', primary: 'primary_link', secondary: 'secondary_link', tertiary: 'tertiary_link' };
const RANK = { primary: 4, secondary: 3, trunk: 3, tertiary: 2, residential: 1 };   // for lights; links and motorways never get any
const M = 134217728;   // 2^27: node key = x * M + y (world units stay below 2^26 at z14)
export const nodeKey = (x, y) => Math.round(x) * M + Math.round(y);

/** Clip a polyline (flat [x, y, …]) to a box: the pieces inside, with points on the edge put exactly on it. */
export function clip(p, x0, y0, x1, y1) {
  const out = [], snap = (v, a, b) => Math.abs(v - a) < 1e-6 ? a : Math.abs(v - b) < 1e-6 ? b : v; let cur = null;
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k], ay = p[k + 1], dx = p[k + 2] - ax, dy = p[k + 3] - ay; let t0 = 0, t1 = 1, ok = true;
    for (const [q, r] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
      if (q === 0) { if (r < 0) { ok = false; break; } continue; }
      const t = r / q;
      if (q < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (!ok || t1 - t0 < 1e-12) { cur = null; continue; }
    const sx = snap(ax + dx * t0, x0, x1), sy = snap(ay + dy * t0, y0, y1), ex = snap(ax + dx * t1, x0, x1), ey = snap(ay + dy * t1, y0, y1);
    if (!cur || t0 > 0) out.push(cur = [sx, sy]);
    cur.push(ex, ey);
    if (t1 < 1) cur = null;
  }
  return out.filter(q => q.length >= 4);
}

/** A grid over segments (cell size g world units): each segment is listed in the cells along it, sampled every g/4, so a
 *  lookup of a point's cell and its eight neighbours finds every segment that passes within ~g/2 of it. */
function segGrid(lines, g) {
  const grid = new Map();
  lines.forEach((l, li) => { for (let k = 0; k + 3 < l.pts.length; k += 2) {
    const ax = l.pts[k], ay = l.pts[k + 1], bx = l.pts[k + 2], by = l.pts[k + 3], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (g / 4)));
    let last = '';
    for (let i = 0; i <= n; i++) {
      const key = Math.floor((ax + (bx - ax) * i / n) / g) + ',' + Math.floor((ay + (by - ay) * i / n) / g);
      if (key !== last) { last = key; const list = grid.get(key) || grid.set(key, []).get(key); const e = list[list.length - 1]; if (!e || e[0] !== li || e[1] !== k) list.push([li, k]); }
    }
  } });
  return grid;
}
/** Grid entries around a point (its cell and the eight next to it). */
function* near(grid, x, y, g) {
  const cx = Math.floor(x / g), cy = Math.floor(y / g);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) yield* grid.get((cx + dx) + ',' + (cy + dy)) || [];
}
function nearSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, u = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return { d: Math.hypot(ax + u * dx - px, ay + u * dy - py), u };
}

/**
 * One tile, ready to join: { pieces: [{ id, cls, oneway, name, keys, geometry: [{ lat, lon }], seams: [[i, x, y, onX]] }],
 * signals: [keys] }. `layers`: decodeTile's transportation and transportation_name; z/x/y: the tile.
 */
export function prepareTile(layers, z, x, y) {
  const T = layers.transportation, N = layers.transportation_name, pieces = [], names = [];
  if (!T) return { pieces, signals: [] };
  const E = T.extent, x0 = x * E, y0 = y * E, x1 = x0 + E, y1 = y0 + E, scale = 2 ** z * E;
  T.features.forEach((f, fi) => {
    const p = f.props, cls = p.ramp ? RAMP[p.class] : CLASS[p.class];
    if (f.type !== 2 || !cls || p.access === 'no' || p.indoor) return;
    const level = `${p.layer || 0}${p.brunnel === 'tunnel' ? 't' : p.brunnel === 'bridge' ? 'b' : ''}`;
    f.parts.forEach((part, pi) => {
      const w = part.map((v, k) => v + (k % 2 ? y0 : x0));
      clip(w, x0, y0, x1, y1).forEach((pts, ci) => pieces.push({ id: `${z}/${x}/${y}/${fi}.${pi}.${ci}`, cls, oneway: p.oneway === 1 || p.oneway === -1 ? p.oneway : 0, level, pts }));
    });
  });
  if (N) for (const f of N.features) {
    const name = f.props.name || f.props.name_en || f.props['name:latin'] || f.props.ref; if (f.type !== 2 || !name) continue;
    for (const part of f.parts) names.push({ name: String(name), pts: part.map((v, k) => v + (k % 2 ? y0 : x0)) });
  }
  // keys: vertices are whole units; points on the tile's edge are noted, to be joined to the neighbour's (joinTiles)
  const edge = (px, py) => px === x0 || px === x1 ? 1 : py === y0 || py === y1 ? 2 : 0;
  for (const p of pieces) {
    p.keys = []; p.seams = [];
    for (let k = 0; k < p.pts.length; k += 2) {
      const px = p.pts[k], py = p.pts[k + 1], e = edge(px, py);
      if (e) { p.pts[k] = Math.round(px); p.pts[k + 1] = Math.round(py); p.seams.push([k / 2, p.pts[k], p.pts[k + 1], e === 1]); }   // whole units, like the neighbour's
      p.keys.push(nodeKey(px, py));
    }
  }
  // a street that ends on another road between its vertices: give that road a vertex there (same level only)
  const uses = new Map(); for (const p of pieces) for (const k of new Set(p.keys)) uses.set(k, (uses.get(k) || 0) + 1);
  const G = 16, grid = segGrid(pieces, G), ins = [];
  for (const p of pieces) for (const end of [0, p.keys.length - 1]) {
    const key = p.keys[end], px = p.pts[end * 2], py = p.pts[end * 2 + 1];
    if (uses.get(key) > 1 || edge(px, py)) continue;
    let best = null;
    for (const [li, k] of near(grid, px, py, G)) {
      const q = pieces[li]; if (q === p || q.level !== p.level) continue;
      const r = nearSeg(px, py, q.pts[k], q.pts[k + 1], q.pts[k + 2], q.pts[k + 3]);
      if (r.d < 1.6 && r.u > 0.001 && r.u < 0.999 && (!best || r.d < best.d)) best = { q, k, u: r.u, d: r.d };
    }
    if (best) { ins.push({ ...best, px, py, key }); uses.set(key, 2); }
  }
  ins.sort((a, b) => b.k - a.k || b.u - a.u);   // back to front, so earlier indices stay put
  for (const n of ins) {
    n.q.pts.splice(n.k + 2, 0, n.px, n.py); n.q.keys.splice(n.k / 2 + 1, 0, n.key);
    for (const s of n.q.seams) if (s[0] > n.k / 2) s[0]++;
  }
  // names: the name line that runs along each piece's middle
  const ng = segGrid(names, G);
  for (const p of pieces) {
    const m = Math.max(0, Math.floor(p.pts.length / 4) * 2 - 2), ax = p.pts[m], ay = p.pts[m + 1], bx = p.pts[m + 2], by = p.pts[m + 3];
    const mx = (ax + bx) / 2, my = (ay + by) / 2, l = Math.hypot(bx - ax, by - ay) || 1; let best = null;
    for (const [li, k] of near(ng, mx, my, G)) {
      const n = names[li], cx = n.pts[k + 2] - n.pts[k], cy = n.pts[k + 3] - n.pts[k + 1], cl = Math.hypot(cx, cy) || 1;
      if (Math.abs(((bx - ax) * cx + (by - ay) * cy) / (l * cl)) < 0.9) continue;   // not running the same way
      const r = nearSeg(mx, my, n.pts[k], n.pts[k + 1], n.pts[k + 2], n.pts[k + 3]);
      if (r.d < 4 && (!best || r.d < best.d)) best = { n, d: r.d };
    }
    p.name = best ? best.n.name : '';
  }
  // lights where busy roads meet: two different roads, both tertiary or better; or a secondary+ road at a crossroads
  const at = new Map();
  for (const p of pieces) p.keys.forEach((k, i) => { const end = i === 0 || i === p.keys.length - 1; (at.get(k) || at.set(k, []).get(k)).push([p, end ? 1 : 2]); });
  const signals = [];
  for (const [k, list] of at) {
    if (list.length < 2) continue;
    const arms = list.reduce((a, [, n]) => a + n, 0);
    if (arms < 3 || list.some(([p]) => /^motorway|_link$/.test(p.cls))) continue;
    const roads = new Map(); for (const [p] of list) { const id = p.name || p.id; roads.set(id, Math.max(roads.get(id) ?? 0, RANK[p.cls] || 0)); }   // pieces of one named road are one road
    if (roads.size < 2) continue;
    const r = [...roads.values()].sort((a, b) => b - a);
    if ((r[0] >= 2 && r[1] >= 2) || (r[0] >= 3 && arms >= 4)) signals.push(k);
  }
  for (const p of pieces) { p.geometry = p.keys.map((_, i) => unproject(p.pts[i * 2], p.pts[i * 2 + 1], scale)); delete p.pts; delete p.level; }
  return { pieces, signals };
}

/**
 * Prepared tiles -> { ways, signals } for buildGraph. Where a road crosses from one tile to the next, both tiles put a
 * point on the shared edge; the two are made one node (within a unit along the edge: each tile clipped on its own).
 */
export function joinTiles(tiles) {
  const seam = new Map(), ways = [], signals = [];
  for (const t of tiles) {
    for (const s of t.signals) signals.push(s);
    for (const p of t.pieces) {
      let keys = p.keys;
      if (p.seams.length) {
        keys = keys.slice();
        for (const [i, x, y, onX] of p.seams) {
          let k = null;
          for (const d of [0, -1, 1]) { const j = onX ? nodeKey(x, y + d) : nodeKey(x + d, y); if (seam.has(j)) { k = seam.get(j); break; } }
          if (k == null) { k = keys[i]; seam.set(k, k); }
          keys[i] = k;
        }
      }
      ways.push({ id: p.id, nodes: keys, geometry: p.geometry, tags: { highway: p.cls, oneway: p.oneway === 1 ? 'yes' : p.oneway === -1 ? '-1' : undefined, name: p.name } });
    }
  }
  return { ways, signals };
}
