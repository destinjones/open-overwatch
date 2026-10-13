// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Test helper (no tests of its own): a tiny Mapbox Vector Tile encoder, to build test tiles for core/mvt.js decodeTile.
const varint = (n, out) => { while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128); } out.push(n); };
const key = (f, w, out) => varint(f * 8 + w, out);
const bytes = (f, arr, out) => { key(f, 2, out); varint(arr.length, out); for (const b of arr) out.push(b); };
const str = (f, s, out) => bytes(f, [...new TextEncoder().encode(s)], out);
const packed = (f, nums, out) => { const b = []; for (const n of nums) varint(n, b); bytes(f, b, out); };
const zz = n => (n << 1) ^ (n >> 31);
/** type 1: parts are single points; 2: lines; 3: rings (closed with ClosePath, the first point not repeated). */
export function encode(type, parts) {
  const cmds = []; let cx = 0, cy = 0;
  if (type === 1) {
    cmds.push(1 | (parts.length << 3));
    for (const [x, y] of parts) { cmds.push(zz(x - cx), zz(y - cy)); cx = x; cy = y; }
    return cmds;
  }
  for (const pts of parts) {
    cmds.push(1 | (1 << 3), zz(pts[0][0] - cx), zz(pts[0][1] - cy)); [cx, cy] = pts[0];
    cmds.push(2 | ((pts.length - 1) << 3));
    for (const [x, y] of pts.slice(1)) { cmds.push(zz(x - cx), zz(y - cy)); cx = x; cy = y; }
    if (type === 3) cmds.push(7 | (1 << 3));
  }
  return cmds;
}
export function layer(name, feats, extent = 4096) {
  const keys = [], vals = [], out = [];
  key(15, 0, out); varint(2, out); str(1, name, out);
  for (const f of feats) {
    const fb = [], tags = [];
    for (const [k, v] of Object.entries(f.props || {})) {
      let ki = keys.indexOf(k); if (ki < 0) ki = keys.push(k) - 1;
      let vi = vals.indexOf(v); if (vi < 0) vi = vals.push(v) - 1;
      tags.push(ki, vi);
    }
    packed(2, tags, fb); key(3, 0, fb); varint(f.type, fb); packed(4, encode(f.type, f.parts), fb);
    bytes(2, fb, out);
  }
  for (const k of keys) str(3, k, out);
  for (const v of vals) {
    const vb = [];
    if (typeof v === 'string') str(1, v, vb);
    else if (typeof v === 'boolean') { key(7, 0, vb); varint(v ? 1 : 0, vb); }
    else if (Number.isInteger(v) && v >= 0) { key(5, 0, vb); varint(v, vb); }
    else if (Number.isInteger(v)) { key(6, 0, vb); varint(-2 * v - 1, vb); }
    else { key(3, 1, vb); const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v, true); vb.push(...new Uint8Array(d.buffer)); }
    bytes(4, vb, out);
  }
  key(5, 0, out); varint(extent, out);
  return out;
}
export const tile = layers => { const out = []; for (const l of layers) bytes(3, l, out); return new Uint8Array(out); };
