// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Mapbox Vector Tiles (the .pbf tiles of OpenMapTiles / OpenFreeMap): a small decoder for the layers you ask for.
// Protocol Buffers by hand: varints, length-delimited fields; geometry as MoveTo / LineTo / ClosePath commands with
// zigzag deltas, in tile units (0..extent, plus a buffer). Pure (Node tests it).

const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

/** A protobuf reader (also used by core/gtfsrt.js): varints, length-delimited fields, fixed 32/64-bit numbers. */
export class Pbf {
  constructor(buf, start = 0, end = buf.length) { this.b = buf; this.p = start; this.end = end; this.dv = null; }
  varint() {   // exact to 2^53; ten bytes at most (an eleventh would make 128^11 overflow into NaN)
    let v = 0, s = 1, b, n = 0;
    do { if (++n > 10) throw new Error('pbf: varint too long'); b = this.b[this.p++]; v += (b & 0x7f) * s; s *= 128; } while (b & 0x80);
    return v;
  }
  /** A signed 64-bit varint (protobuf int64): a negative value is 10 bytes, past a double's exactness, so it is read as a BigInt. */
  int64() { let v = 0n, s = 0n, b; do { if (s > 63n) throw new Error('pbf: varint too long'); b = this.b[this.p++]; v |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80); return Number(BigInt.asIntN(64, v)); }
  key() { const k = this.varint(); return [Math.floor(k / 8), k & 7]; }
  /** A length-delimited field as [start, end): the end stops at this message's own, so a declared length past the data
   *  (a cut-off download, or a hostile one) is read only as far as the bytes go instead of walking 2^53 missing ones. */
  bytes() { const l = this.varint(), a = this.p; this.p += l; return [a, Math.min(this.p, this.end)]; }
  str() { const [a, b] = this.bytes(); return td.decode(this.b.subarray(a, b)); }
  view() { return this.dv || (this.dv = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength)); }
  f32() { if (this.p + 4 > this.end) throw new Error('mvt: cut off'); const v = this.view().getFloat32(this.p, true); this.p += 4; return v; }   // a plain error for a truncated download, not a RangeError
  f64() { if (this.p + 8 > this.end) throw new Error('mvt: cut off'); const v = this.view().getFloat64(this.p, true); this.p += 8; return v; }
  skip(wire) {
    if (wire === 0) this.varint(); else if (wire === 1) this.p += 8; else if (wire === 2) { const l = this.varint(); this.p += l; } else if (wire === 5) this.p += 4;   // not `p += varint()`: that adds to p as it was before the length
    else throw new Error('mvt: wire type ' + wire);
  }
  packed() { const [a, b] = this.bytes(), out = [], r = new Pbf(this.b, a, b); while (r.p < b) out.push(r.varint()); return out; }
}

function value(r, end) {
  let v = null;
  while (r.p < end) {
    const [f, w] = r.key();
    if (f === 1) v = r.str();
    else if (f === 2 || f === 3) { v = f === 2 ? r.f32() : r.f64(); if (!Number.isFinite(v)) v = null; }   // NaN or Infinity is no value
    else if (f === 4) v = r.int64();
    else if (f === 5) v = r.varint();
    else if (f === 6) { const n = r.varint(); v = n % 2 === 1 ? -(n + 1) / 2 : n / 2; }
    else if (f === 7) v = r.varint() === 1;
    else r.skip(w);
  }
  return v;
}
const zz = n => (n >>> 1) ^ -(n & 1);

/** Geometry commands -> parts, each a flat [x0, y0, x1, y1, …] in tile units (a closed ring repeats its first point). */
export function geometry(cmds) {
  const out = []; let x = 0, y = 0, i = 0, cur = null;
  while (i < cmds.length) {
    const c = cmds[i++], id = c & 7, n = c >>> 3;
    if (id === 1 || id === 2) for (let k = 0; k < n && i + 1 < cmds.length; k++) { x += zz(cmds[i++]); y += zz(cmds[i++]); if (id === 1) out.push(cur = [x, y]); else if (cur) cur.push(x, y); }   // a LineTo before any MoveTo, or a cut-off tile, is skipped, not thrown
    else if (id === 7) { if (cur) cur.push(cur[0], cur[1]); }
    else break;
  }
  return out;
}

/**
 * Decode the named layers of a tile (Uint8Array): { name: { extent, features: [{ id, type (1 point, 2 line, 3 polygon),
 * props, parts }] } }. Other layers are skipped without decoding.
 */
export function decodeTile(buf, want) {
  const r = new Pbf(buf), out = {};
  while (r.p < r.end) {
    const [f, w] = r.key();
    if (f !== 3 || w !== 2) { r.skip(w); continue; }
    const [a, b] = r.bytes(), L = new Pbf(buf, a, b);
    let name = null; const feats = [], keys = [], vals = []; let extent = 4096;
    while (L.p < b) {   // the name usually comes first: stop early on a layer nobody wants
      const [lf, lw] = L.key();
      if (lf === 1) { name = L.str(); if (want && !want.includes(name)) break; }
      else if (lf === 2) feats.push(L.bytes());
      else if (lf === 3) keys.push(L.str());
      else if (lf === 4) { const [va, vb] = L.bytes(); vals.push(value(new Pbf(buf, va, vb), vb)); }
      else if (lf === 5) extent = L.varint() || 4096;   // the callers divide by it
      else L.skip(lw);
    }
    if (!name || (want && !want.includes(name))) continue;
    const features = feats.map(([fa, fb]) => {
      const F = new Pbf(buf, fa, fb), ft = { id: null, type: 0, props: {}, parts: [] }; let tags = [], geom = [];
      while (F.p < fb) {
        const [ff, fw] = F.key();
        if (ff === 1) ft.id = F.varint(); else if (ff === 2) tags = F.packed(); else if (ff === 3) ft.type = F.varint(); else if (ff === 4) geom = F.packed(); else F.skip(fw);
      }
      for (let k = 0; k + 1 < tags.length; k += 2) if (tags[k] < keys.length && tags[k + 1] < vals.length && keys[tags[k]] !== '__proto__') ft.props[keys[tags[k]]] = vals[tags[k + 1]];
      ft.parts = geometry(geom);
      return ft;
    });
    out[name] = { extent, features };
  }
  return out;
}

/** The z/x/y tile (Web Mercator) that holds a point. */
export function tileAt(lat, lon, z) {
  const n = 2 ** z, s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180), clamp = v => Math.max(0, Math.min(n - 1, Math.floor(v)));   // Web Mercator ends at ±85.05°; lon 180 is the last column, not one past it
  return { z, x: clamp((((lon + 180) % 360 + 360) % 360) / 360 * n), y: clamp((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n) };
}
/** World pixel (0..scale on both axes, y down) -> { lat, lon }. */
export function unproject(px, py, scale) {
  return { lon: px / scale * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * py / scale))) * 180 / Math.PI };
}
