// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// GRIB2, just enough for the global model fields the globe draws: NOAA's GFS and ECMWF's IFS on their regular
// latitude/longitude grids (grid template 3.0), packed simply (data template 5.0), with complex packing (5.2) and spatial
// differencing (5.3) the way NCEP writes them, as JPEG 2000 (5.40: NOAA's WAVEWATCH III, core/jpx.js) or CCSDS (5.42:
// ECMWF's open data, core/aec.js); plus the `.idx` inventory NOAA publishes beside each file, so a browser can fetch only the
// fields it wants with HTTP range requests. Pure (test/grib2.test.mjs). Reference: WMO FM 92 GRIB2, NCEP g2clib.

import { aecDecode } from './aec.js';
import { jpxDecode } from './jpx.js';

const u16 = (b, p) => (b[p] << 8) | b[p + 1];
const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const s16 = (b, p) => { const v = u16(b, p); return v & 0x8000 ? -(v & 0x7fff) : v; };   // GRIB2 signs by the top bit
const s32 = (b, p) => { const v = u32(b, p); return v >= 0x80000000 ? -(v - 0x80000000) : v; };
const f32 = (b, p) => new DataView(b.buffer, b.byteOffset + p, 4).getFloat32(0, false);
/** The most grid points a field may declare (a 0.1° global grid is 6.5 million): a corrupt header must not ask for gigabytes. */
export const MAX_POINTS = 2 ** 24;

/** A big-endian bit reader. */
class Bits {
  constructor(b, byte, end) { this.b = b; this.pos = byte * 8; this.end = end * 8; }
  read(n) {
    if (this.pos + n > this.end) throw new Error('grib2: section 7 is shorter than its values');
    let v = 0;
    while (n > 0) {   // a byte (or what is left of it) at a time
      const p = this.pos >> 3, off = this.pos & 7, take = Math.min(8 - off, n);
      v = v * (1 << take) + ((this.b[p] >> (8 - off - take)) & ((1 << take) - 1));
      this.pos += take; n -= take;
    }
    return v;
  }
  /** Signed, sign in the top bit (the spatial differencing descriptors). */
  sread(n) { const s = this.read(1), v = this.read(n - 1); return s ? -v : v; }
  align() { this.pos = (this.pos + 7) & ~7; }
}

/** Grid template 3.0: a regular lat/lon grid. Angles in degrees. */
function grid(b, q) {
  const tmpl = u16(b, q + 12);
  if (tmpl !== 0) throw new Error('grib2: grid template ' + tmpl + ' is not supported');
  if (u32(b, q) < 72) throw new Error('grib2: section 3 is too short');
  const ni = u32(b, q + 30), nj = u32(b, q + 34);
  if (!ni || !nj || ni * nj > MAX_POINTS) throw new Error('grib2: a grid of ' + ni + ' × ' + nj + ' points');
  const basic = u32(b, q + 38), sub = u32(b, q + 42), unit = basic && sub && sub !== 0xffffffff ? basic / sub : 1e-6;
  return { npts: u32(b, q + 6), ni, nj, la1: s32(b, q + 46) * unit, lo1: s32(b, q + 50) * unit,
    la2: s32(b, q + 55) * unit, lo2: s32(b, q + 59) * unit, di: u32(b, q + 63) * unit, dj: u32(b, q + 67) * unit, scan: b[q + 71] };
}

/** The packed values (Section 5 + 7) → integers before scaling, as a Float64Array of `n` values. */
function unpack(b, s5, s7, n) {
  const tmpl = u16(b, s5 + 9), nbits = b[s5 + 19], data = s7 + 5, end7 = s7 + u32(b, s7);
  if (nbits > 32 && tmpl !== 40) throw new Error('grib2: ' + nbits + ' bits per value');
  const out = new Float64Array(n);
  if (tmpl === 0) {   // simple packing
    if (nbits) { const r = new Bits(b, data, end7); for (let i = 0; i < n; i++) out[i] = r.read(nbits); }
    return out;
  }
  if (tmpl === 42) {   // CCSDS: flags, block size, reference sample interval
    if (u32(b, s5) < 25) throw new Error('grib2: section 5 is too short');
    if (!nbits) return out;
    return aecDecode(b.subarray(data, s7 + u32(b, s7)), { n, bits: nbits, flags: b[s5 + 21], blockSize: b[s5 + 22], rsi: u16(b, s5 + 23) });
  }
  if (tmpl === 40) {   // JPEG 2000: one image of the n values (a grid, or one long row when a bitmap thins it)
    if (!nbits || u32(b, s7) <= 5) return out;
    const img = jpxDecode(b.subarray(data, s7 + u32(b, s7)), { maxSamples: 2 * n + 64 });   // eccodes and g2clib write exactly n
    if (img.data.length < n) throw new Error('grib2: the JPEG 2000 image is smaller than the field');
    return img.data.length === n ? img.data : img.data.subarray(0, n);
  }
  if (tmpl !== 2 && tmpl !== 3) throw new Error('grib2: data template 5.' + tmpl + ' is not supported');
  if (u32(b, s5) < (tmpl === 3 ? 49 : 47)) throw new Error('grib2: section 5 is too short');
  const missing = b[s5 + 22];
  if (missing !== 0) throw new Error('grib2: missing-value management is not supported');
  const ng = u32(b, s5 + 31), wRef = b[s5 + 35], wBits = b[s5 + 36], lRef = u32(b, s5 + 37), lInc = b[s5 + 41], lLast = u32(b, s5 + 42), lBits = b[s5 + 46];
  if (ng > n) throw new Error('grib2: more groups than values');
  const r = new Bits(b, data, end7);
  let order = 0, v1 = 0, v2 = 0, min = 0;
  if (tmpl === 3) {
    order = b[s5 + 47]; const octets = b[s5 + 48] * 8;
    if (order > 2 || (order && (octets < 8 || octets > 48))) throw new Error('grib2: spatial differencing of order ' + order + ' in ' + octets / 8 + ' octets');
    if (order >= 1) v1 = r.sread(octets);
    if (order === 2) v2 = r.sread(octets);
    if (order) min = r.sread(octets);
  }
  const refs = new Float64Array(ng), widths = new Uint8Array(ng), lens = new Float64Array(ng);
  for (let g = 0; g < ng; g++) refs[g] = r.read(nbits); r.align();
  for (let g = 0; g < ng; g++) if ((widths[g] = (wBits ? r.read(wBits) : 0) + wRef) > 32) throw new Error('grib2: a group of ' + widths[g] + '-bit values'); r.align();
  for (let g = 0; g < ng; g++) lens[g] = (lBits ? r.read(lBits) : 0) * lInc + lRef; r.align();
  if (ng) lens[ng - 1] = lLast;
  let k = 0;
  for (let g = 0; g < ng && k < n; g++) {
    const w = widths[g], ref = refs[g], len = Math.min(lens[g], n - k);
    if (w) for (let i = 0; i < len; i++) out[k++] = ref + r.read(w);
    else for (let i = 0; i < len; i++) out[k++] = ref;
  }
  if (k < n) throw new Error('grib2: the groups hold ' + k + ' of ' + n + ' values');
  if (order === 1) { out[0] = v1; for (let i = 1; i < n; i++) out[i] = out[i] + min + out[i - 1]; }
  else if (order === 2) { out[0] = v1; if (n > 1) out[1] = v2; for (let i = 2; i < n; i++) out[i] = out[i] + min + 2 * out[i - 1] - out[i - 2]; }
  return out;
}

/**
 * Every message in a GRIB2 buffer (Uint8Array) → [{ discipline, category, number, hours (forecast time), grid: { ni, nj,
 * la1, lo1, la2, lo2, di, dj, scan }, values: Float32Array (ni × nj, in the file's scan order; NaN where a bitmap says
 * there is no value) }].
 */
export function decodeGrib2(buf) {
  const b = buf, out = [];
  let p = 0;
  while (p + 16 <= b.length) {
    if (b[p] !== 0x47 || b[p + 1] !== 0x52 || b[p + 2] !== 0x49 || b[p + 3] !== 0x42) { p++; continue; }   // "GRIB"
    if (b[p + 7] !== 2) throw new Error('grib2: edition ' + b[p + 7]);
    const total = u32(b, p + 8) * 4294967296 + u32(b, p + 12), end = p + total, msg = { discipline: b[p + 6] };
    if (total < 20) throw new Error('grib2: a message of ' + total + ' bytes');   // 0 would read the same message forever
    if (end > b.length) {   // a cut download: keep the whole messages before it (a merged .idx range can hold several)
      if (out.length) break;
      throw new Error('grib2: the message is cut off (' + (b.length - p) + ' of ' + total + ' bytes)');
    }
    let q = p + 16, gridDef = null, s5 = 0, bitmap = null, nvals = 0;
    while (q + 4 < end) {
      if (b[q] === 0x37 && b[q + 1] === 0x37 && b[q + 2] === 0x37 && b[q + 3] === 0x37) break;   // "7777"
      const len = u32(b, q), sec = b[q + 4];
      if (len < 5 || q + len > end) throw new Error('grib2: section ' + sec + ' runs past its message');
      if (sec === 3) gridDef = grid(b, q);
      else if (sec === 4) { if (len < 22) throw new Error('grib2: section 4 is too short'); msg.category = b[q + 9]; msg.number = b[q + 10]; const unit = b[q + 17], t = u32(b, q + 18); msg.hours = unit === 1 ? t : unit === 0 ? t / 60 : unit === 2 ? t * 24 : t; }
      else if (sec === 5) { if (len < 21) throw new Error('grib2: section 5 is too short'); s5 = q; nvals = u32(b, q + 5); }
      else if (sec === 6) { const ind = b[q + 5]; if (ind === 0) bitmap = { at: q + 6, end: q + len }; else if (ind === 255) bitmap = null; else throw new Error('grib2: predefined bitmap ' + ind); }
      else if (sec === 7) {
        if (!gridDef || !s5) throw new Error('grib2: data before its grid or packing');
        const npts = gridDef.ni * gridDef.nj;
        if (nvals > npts || (!bitmap && nvals < npts)) throw new Error('grib2: ' + nvals + ' values for ' + npts + ' grid points');
        if (bitmap && bitmap.at + Math.ceil(npts / 8) > bitmap.end) throw new Error('grib2: the bitmap is shorter than the grid');
        const ints = unpack(b, s5, q, nvals), R = f32(b, s5 + 11), E = 2 ** s16(b, s5 + 15), D = 10 ** -s16(b, s5 + 17);
        const values = new Float32Array(npts);
        if (bitmap) {
          let k = 0;
          for (let i = 0; i < npts; i++) {
            if (!((b[bitmap.at + (i >> 3)] >> (7 - (i & 7))) & 1)) { values[i] = NaN; continue; }
            if (k >= nvals) throw new Error('grib2: the bitmap marks more points than the field has values');
            values[i] = (R + ints[k++] * E) * D;
            if (!Number.isFinite(values[i])) throw new Error('grib2: a value out of range');
          }
        } else for (let i = 0; i < npts; i++) { values[i] = (R + ints[i] * E) * D; if (!Number.isFinite(values[i])) throw new Error('grib2: a value out of range'); }   // read back: a double can overflow float32. NaN means "no value", which only a bitmap says
        out.push({ ...msg, grid: gridDef, values });
      }
      if (!len) break;
      q += len;
    }
    p = end;
  }
  return out;
}

/**
 * A regular-grid field's value at a point (degrees), bilinear, wrapping in longitude. Grids that scan north to south
 * (GFS: 90 → -90) and south to north both work; points beyond the first or last row take that row.
 */
export function sampleGrid(f, lat, lon) {
  const g = f.grid, south = g.scan & 0x40;
  let x = ((lon - g.lo1) % 360 + 360) % 360 / g.di, y = (south ? lat - g.la1 : g.la1 - lat) / g.dj;
  y = Math.max(0, Math.min(g.nj - 1, y));
  const x0 = Math.floor(x), y0 = Math.min(g.nj - 2, Math.floor(y)), ax = x - x0, ay = y - y0, ni = g.ni;
  const i0 = x0 % ni, i1 = (x0 + 1) % ni, v = f.values;
  const a = v[y0 * ni + i0], c = v[y0 * ni + i1], d = v[(y0 + 1) * ni + i0], e = v[(y0 + 1) * ni + i1];
  return (a * (1 - ax) + c * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay;
}

/**
 * A NOAA `.idx` inventory → [{ n, start, end (inclusive, or null for the file's last message), date, variable, level,
 * forecast }]. Lines look like `588:35006579:d=2026101018:UGRD:10 m above ground:6 hour fcst:`.
 */
export function parseIdx(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    const f = line.split(':'); if (f.length < 6 || !/^\d+$/.test(f[0]) || !/^\d+$/.test(f[1])) continue;
    if (rows.length && +f[1] <= rows[rows.length - 1].start) continue;   // offsets only grow: a garbled line would make a backwards range
    rows.push({ n: +f[0], start: +f[1], end: null, date: f[2].replace(/^d=/, ''), variable: f[3], level: f[4], forecast: f[5] });
  }
  for (let i = 0; i + 1 < rows.length; i++) rows[i].end = rows[i + 1].start - 1;
  return rows;
}
/**
 * Byte ranges for the wanted fields ([variable, level] pairs; only instantaneous ones: "anl" or "N hour fcst", not the
 * averages), neighbours merged into one request: [{ start, end, fields: [[variable, level], …] }].
 */
export function idxRanges(rows, wants) {
  const instant = r => r.forecast === 'anl' || /^\d+ hour fcst$/.test(r.forecast);
  const pick = rows.filter(r => instant(r) && wants.some(([v, l]) => r.variable === v && r.level === l))
    .filter((r, i, a) => a.findIndex(x => x.variable === r.variable && x.level === r.level) === i)   // the first of any repeats
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of pick) {
    const last = out[out.length - 1];
    if (last && last.end != null && last.end + 1 === r.start) { last.end = r.end; last.fields.push([r.variable, r.level]); }
    else out.push({ start: r.start, end: r.end, fields: [[r.variable, r.level]] });
  }
  return out;
}
