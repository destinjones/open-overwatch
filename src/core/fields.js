// Model fields on regular latitude/longitude grids, the shape core/grib2.js decodes them into: { grid: { ni, nj, la1,
// lo1, di, dj, scan }, values: Float32Array }. Coarsening (a 0.25° global field is a million values, more than the
// globe can use and 4 MB a field), blending two forecast hours, and sampling that copes with coasts (wave fields are
// empty over land) and with directions (359° and 1° average to north, not south). Pure (test/contour.test.mjs).
import { sampleGrid } from './grib2.js';

const RAD = Math.PI / 180;
/** Does the grid go all the way round in longitude (so its last column neighbours its first)? */
export const wraps = g => Math.abs(g.ni * g.di - 360) < g.di / 2;
/** Latitude of row j, whichever way the grid scans. */
export const rowLat = (g, j) => g.scan & 0x40 ? g.la1 + j * g.dj : g.la1 - j * g.dj;

/**
 * Every k-th point of a field, each the average of the (k+1)² box round it (or, with how = 'pick', the point itself:
 * for directions). NaNs are left out of averages; a box of only NaNs stays NaN. Global grids keep wrapping.
 */
export function coarsen(f, k, how = 'mean') {
  const g = f.grid;
  if (k <= 1) return f;
  const wrap = wraps(g), ni = wrap ? Math.floor(g.ni / k) : Math.floor((g.ni - 1) / k) + 1, nj = Math.floor((g.nj - 1) / k) + 1, h = Math.floor(k / 2);
  const out = new Float32Array(ni * nj), v = f.values;
  for (let J = 0; J < nj; J++) for (let I = 0; I < ni; I++) {
    const j0 = J * k, i0 = I * k;
    if (how === 'pick') { out[J * ni + I] = v[j0 * g.ni + i0]; continue; }
    let s = 0, n = 0;
    for (let dj = -h; dj <= h; dj++) {
      const j = j0 + dj; if (j < 0 || j >= g.nj) continue;
      for (let di = -h; di <= h; di++) {
        let i = i0 + di;
        if (wrap) i = (i + g.ni) % g.ni; else if (i < 0 || i >= g.ni) continue;
        const x = v[j * g.ni + i]; if (x === x) { s += x; n++; }
      }
    }
    out[J * ni + I] = n ? s / n : NaN;
  }
  const la2 = g.scan & 0x40 ? g.la1 + (nj - 1) * g.dj * k : g.la1 - (nj - 1) * g.dj * k;
  return { ...f, grid: { ...g, ni, nj, di: g.di * k, dj: g.dj * k, lo2: ((g.lo1 + (ni - 1) * g.di * k) % 360 + 360) % 360, la2 }, values: out };
}

/** A field part way (w, 0..1) from a to b, on a's grid (the two hours of one run share it). */
export function blend(a, b, w) {
  if (!b || b === a || w <= 0) return a;
  const out = new Float32Array(a.values.length), x = a.values, y = b.values;
  for (let i = 0; i < out.length; i++) out[i] = x[i] + (y[i] - x[i]) * w;
  return { ...a, values: out };
}

/**
 * Bilinear, but a corner with no value (land, in a wave field) is left out and the others reweighted; NaN only when
 * all four are missing. Plain sampleGrid would make the whole coast NaN.
 */
export function sampleValid(f, lat, lon) {
  const g = f.grid, south = g.scan & 0x40;
  let x = ((lon - g.lo1) % 360 + 360) % 360 / g.di, y = (south ? lat - g.la1 : g.la1 - lat) / g.dj;
  y = Math.max(0, Math.min(g.nj - 1, y));
  const x0 = Math.floor(x), y0 = Math.min(g.nj - 2, Math.floor(y)), ax = x - x0, ay = y - y0, ni = g.ni, v = f.values;
  if (!wraps(g) && x0 >= ni - 1) return v[y0 * ni + ni - 1];
  const i0 = x0 % ni, i1 = (x0 + 1) % ni;
  let s = 0, wsum = 0;
  for (const [i, j, w] of [[i0, y0, (1 - ax) * (1 - ay)], [i1, y0, ax * (1 - ay)], [i0, y0 + 1, (1 - ax) * ay], [i1, y0 + 1, ax * ay]]) {
    const z = v[j * ni + i]; if (z === z && w > 0) { s += z * w; wsum += w; }
  }
  return wsum > 1e-9 ? s / wsum : NaN;
}

/** A direction field (degrees) at a point: the corners averaged as unit vectors, so 350° and 10° give 0°. */
export function sampleAngle(f, lat, lon) {
  const g = f.grid, south = g.scan & 0x40;
  let x = ((lon - g.lo1) % 360 + 360) % 360 / g.di, y = (south ? lat - g.la1 : g.la1 - lat) / g.dj;
  y = Math.max(0, Math.min(g.nj - 1, y));
  const x0 = Math.floor(x), y0 = Math.min(g.nj - 2, Math.floor(y)), ax = x - x0, ay = y - y0, ni = g.ni, v = f.values;
  const i0 = x0 % ni, i1 = (x0 + 1) % ni;
  let sx = 0, sy = 0, wsum = 0;
  for (const [i, j, w] of [[i0, y0, (1 - ax) * (1 - ay)], [i1, y0, ax * (1 - ay)], [i0, y0 + 1, (1 - ax) * ay], [i1, y0 + 1, ax * ay]]) {
    const z = v[j * ni + i]; if (z === z && w > 0) { sx += Math.sin(z * RAD) * w; sy += Math.cos(z * RAD) * w; wsum += w; }
  }
  if (wsum < 1e-9 || Math.hypot(sx, sy) < 1e-9) return NaN;
  return (Math.atan2(sx, sy) / RAD + 360) % 360;
}

/** Two directions part way from a to b (degrees), the short way round. */
export function blendAngle(a, b, w) {
  if (!(a === a)) return b; if (!(b === b)) return a;
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * w + 360) % 360;
}

/** A value from field a and b blended in time (w), with `sample` (sampleGrid by default). */
export function sampleAt(a, b, w, lat, lon, sample = sampleGrid) {
  const x = sample(a, lat, lon);
  if (!b || b === a || !w) return x;
  return sample === sampleAngle ? blendAngle(x, sample(b, lat, lon), w) : x + (sample(b, lat, lon) - x) * w;
}
