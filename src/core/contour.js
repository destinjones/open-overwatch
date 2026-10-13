// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Contour lines (isobars) and pressure centres (H and L) on a model field: marching squares over a regular latitude/
// longitude grid, joined into polylines that carry on across the date line on a global grid, and the highs and lows
// that stand out from their surroundings. Pure (test/contour.test.mjs). Used by the globe's pressure layer (wind.js).
import { wraps, rowLat } from './fields.js';

/** Contour levels: every `step` from `base` (1000 hPa: the usual isobars every 4 hPa run 996, 1000, 1004...) inside [min, max]. */
export function levels(min, max, step, base = 0) {
  const out = [];
  if (!(max >= min) || !(step > 0)) return out;
  for (let v = base + Math.ceil((min - base) / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/**
 * Lines of equal value. `f`: { grid, values } (core/grib2.js shape); `lvls`: the values. Returns [{ level, lines:
 * [[[lon, lat], …], …] }]: each line is a polyline, closed (last point equals the first) when it rings round. A global
 * grid wraps (the lines go on across the last column into the first: their longitudes then run past lo1 + 360, so a
 * caller drawing on a flat map splits where they jump). Cells with a missing corner are skipped. The saddle case (two
 * opposite corners above) is settled by the cell's centre, the usual way.
 */
export function isolines(f, lvls) {
  const g = f.grid, v = f.values, wrap = wraps(g), NI = g.ni, NJ = g.nj, cols = wrap ? NI : NI - 1;
  const lon = i => g.lo1 + i * g.di, lat = j => rowLat(g, j);
  const out = [];
  for (const L of lvls) {
    // edges: horizontal (i, j)-(i+1, j) → id 2(j·NI + i); vertical (i, j)-(i, j+1) → id 2(j·NI + i) + 1
    const pts = new Map(), links = new Map();
    const point = (id, a, b, ia, ja, ib, jb) => {   // where the level crosses an edge, from the values at its ends
      if (!pts.has(id)) { const t = (L - a) / (b - a), lo0 = lon(ia), lo1 = lon(ib) < lo0 - 180 ? lon(ib) + 360 : lon(ib); pts.set(id, [lo0 + (lo1 - lo0) * t, lat(ja) + (lat(jb) - lat(ja)) * t]); }
      return id;
    };
    const link = (p, q) => { (links.get(p) || links.set(p, []).get(p)).push(q); (links.get(q) || links.set(q, []).get(q)).push(p); };
    for (let j = 0; j < NJ - 1; j++) for (let i = 0; i < cols; i++) {
      const i1 = (i + 1) % NI;
      const a = v[j * NI + i], b = v[j * NI + i1], c = v[(j + 1) * NI + i1], d = v[(j + 1) * NI + i];   // corners: top-left, top-right, bottom-right, bottom-left
      if (!(a === a && b === b && c === c && d === d)) continue;
      const k = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0);
      if (k === 0 || k === 15) continue;
      const top = () => point(2 * (j * NI + i), a, b, i, j, i + 1, j), bottom = () => point(2 * ((j + 1) * NI + i), d, c, i, j + 1, i + 1, j + 1);
      const left = () => point(2 * (j * NI + i) + 1, a, d, i, j, i, j + 1), right = () => point(2 * (j * NI + i1) + 1, b, c, i + 1, j, i + 1, j + 1);
      switch (k) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), top()); break;
        case 5: case 10: {   // a saddle: the centre says which corners join
          const up = (a + b + c + d) / 4 >= L;
          if ((k === 5) === up) { link(left(), top()); link(bottom(), right()); } else { link(left(), bottom()); link(top(), right()); }
          break;
        }
      }
    }
    // chain the segments: every crossing has one or two neighbours
    const lines = [], seen = new Set();
    const walk = (start, first) => {
      const ids = [start]; let prev = start, cur = first;
      while (cur !== undefined && !seen.has(cur)) {
        ids.push(cur); seen.add(cur);
        const n = links.get(cur); const next = n[0] === prev ? n[1] : n[0];
        prev = cur; cur = next;
        if (cur === start) { ids.push(start); break; }
      }
      return ids;
    };
    for (const [id, n] of links) if (n.length === 1 && !seen.has(id)) { seen.add(id); lines.push(walk(id, n[0])); }   // open lines first (they end at the grid's edge or a gap)
    for (const [id, n] of links) if (!seen.has(id)) { seen.add(id); lines.push(walk(id, n[0])); }   // then rings
    out.push({ level: L, lines: lines.map(ids => unwrap(ids.map(id => pts.get(id)))) });
  }
  return out;
}
/** Longitudes along a line made continuous (no jump of 360 between neighbours). */
function unwrap(line) {
  const out = line.map(p => p.slice());
  for (let i = 1; i < out.length; i++) { while (out[i][0] - out[i - 1][0] > 180) out[i][0] -= 360; while (out[i][0] - out[i - 1][0] < -180) out[i][0] += 360; }
  return out;
}

/**
 * Highs and lows: grid points that are the highest (lowest) within `radius` degrees of latitude (and the same distance
 * east-west, so more columns toward the poles) and stand at least `depth` above (below) the mean of that circle's
 * rim. Poleward of `maxLat` none (the grid's rows bunch up there). [{ type: 'H' | 'L', lat, lon, value }], strongest
 * first.
 */
export function extrema(f, { radius = 8, depth = 2, maxLat = 80 } = {}) {
  const g = f.grid, v = f.values, wrap = wraps(g), NI = g.ni, NJ = g.nj, out = [];
  const rj = Math.max(1, Math.round(radius / g.dj));
  for (let j = 0; j < NJ; j++) {
    const la = rowLat(g, j); if (Math.abs(la) > maxLat) continue;
    const ri = Math.max(1, Math.round(radius / g.di / Math.max(0.2, Math.cos(la * Math.PI / 180))));
    if (!wrap && ri * 2 >= NI) continue;
    for (let i = 0; i < NI; i++) {
      const x = v[j * NI + i]; if (!(x === x)) continue;
      let isMax = true, isMin = true, rim = 0, nr = 0;
      for (let dj = -rj; dj <= rj && (isMax || isMin); dj++) {
        const jj = j + dj; if (jj < 0 || jj >= NJ) continue;
        for (let di = -ri; di <= ri; di++) {
          if (!dj && !di) continue;
          let ii = i + di; if (wrap) ii = (ii + NI) % NI; else if (ii < 0 || ii >= NI) continue;
          const e = (dj / rj) ** 2 + (di / ri) ** 2; if (e > 1) continue;   // an ellipse in grid steps: a circle on the ground
          const y = v[jj * NI + ii]; if (!(y === y)) continue;
          // ties: the first of equal values in scan order wins, so a flat top gives one centre
          const before = dj < 0 || (dj === 0 && di < 0);
          if (y > x || (y === x && before)) isMax = false;
          if (y < x || (y === x && before)) isMin = false;
          if (e > 0.6) { rim += y; nr++; }
        }
      }
      if (!(isMax || isMin) || !nr) continue;
      const stand = x - rim / nr;
      if (isMax && stand >= depth) out.push({ type: 'H', lat: la, lon: g.lo1 + i * g.di, value: x, stand });
      else if (isMin && -stand >= depth) out.push({ type: 'L', lat: la, lon: g.lo1 + i * g.di, value: x, stand: -stand });
    }
  }
  return out.sort((a, b) => b.stand - a.stand).map(({ type, lat, lon, value }) => ({ type, lat, lon: ((lon + 180) % 360 + 360) % 360 - 180, value }));
}

/**
 * Where to write a contour's value: points along a line about every `spacing` degrees of arc (at least one per line
 * longer than `minLen`), each with the line's direction there (degrees, so a label can lie along it). [{ lon, lat, angle }]
 */
export function labelSpots(line, { spacing = 25, minLen = 6 } = {}) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i], c = Math.cos((y0 + y1) / 2 * Math.PI / 180);
    const d = Math.hypot((x1 - x0) * c, y1 - y0); seg.push(d); total += d;
  }
  if (total < minLen) return [];
  const n = Math.max(1, Math.floor(total / spacing)), out = [];
  for (let k = 0; k < n; k++) {
    let want = (k + 0.5) * total / n, i = 0;
    while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
    const t = seg[i] ? want / seg[i] : 0, [x0, y0] = line[i], [x1, y1] = line[i + 1];
    out.push({ lon: x0 + (x1 - x0) * t, lat: y0 + (y1 - y0) * t, angle: Math.atan2(-(y1 - y0), (x1 - x0) * Math.cos(y0 * Math.PI / 180)) * 180 / Math.PI });
  }
  return out;
}
