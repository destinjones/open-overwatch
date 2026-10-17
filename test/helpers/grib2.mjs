// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Test helper (no tests of its own): a minimal GRIB2 writer, to build messages for core/grib2.js decodeGrib2 (simple
// packing, complex packing with first- and second-order spatial differencing, a bitmap). test/grib2.test.mjs and
// test/fuzz.test.mjs build their messages with it.
class W {
  constructor() { this.bytes = []; this.cur = 0; this.n = 0; }
  bits(v, k) { for (let i = k - 1; i >= 0; i--) { this.cur = (this.cur << 1) | (Math.floor(v / 2 ** i) % 2); if (++this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; } } }
  sbits(v, k) { this.bits(v < 0 ? 1 : 0, 1); this.bits(Math.abs(v), k - 1); }
  align() { if (this.n) { this.bytes.push(this.cur << (8 - this.n)); this.cur = 0; this.n = 0; } }
}
const be = (v, k) => { const o = []; for (let i = k - 1; i >= 0; i--) o.push(Math.floor(v / 256 ** i) % 256); return o; };
const sm = (v, k) => be(v < 0 ? 2 ** (8 * k - 1) + Math.abs(v) : v, k);   // sign-magnitude
const f32 = v => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v, false); return [...new Uint8Array(d.buffer)]; };
const nbits = v => { let k = 0; while (2 ** k <= v) k++; return k; };
const section = (num, body) => [...be(body.length + 5, 4), num, ...body];

export function message({ ni, nj, la1 = 90, lo1 = 0, di = 1, dj = 1, scan = 0, ints, R = 0, E = 0, D = 0, tmpl = 0, order = 0, group = 4, bitmap = null, hours = 6 }) {
  const la2 = la1 - (nj - 1) * dj, lo2 = lo1 + (ni - 1) * di, mic = x => Math.round(x * 1e6);
  const s3 = section(3, [0, ...be(ni * nj, 4), 0, 0, ...be(0, 2), 6, 0, ...be(0, 4), 0, ...be(0, 4), 0, ...be(0, 4), ...be(ni, 4), ...be(nj, 4), ...be(0, 4), ...be(0xffffffff, 4),
    ...sm(mic(la1), 4), ...sm(mic(lo1), 4), 48, ...sm(mic(la2), 4), ...sm(mic(lo2), 4), ...be(mic(di), 4), ...be(mic(dj), 4), scan]);
  const s4 = section(4, [...be(0, 2), ...be(0, 2), 2, 2, 2, 0, 96, ...be(0, 2), 0, 1, ...be(hours, 4), 103, 0, ...be(10, 4), 255, 0, ...be(0, 4)]);
  let s5, s7;
  if (tmpl === 0) {
    const k = nbits(Math.max(0, ...ints)), w = new W(); for (const v of ints) w.bits(v, k); w.align();
    s5 = section(5, [...be(ints.length, 4), ...be(0, 2), ...f32(R), ...sm(E, 2), ...sm(D, 2), k, 0]);
    s7 = section(7, w.bytes);
  } else {
    // spatial differences, then groups of `group` values: a reference each, widths over their own reference
    const n = ints.length, d = ints.slice();
    if (order === 1) for (let i = n - 1; i >= 1; i--) d[i] = ints[i] - ints[i - 1];
    if (order === 2) for (let i = n - 1; i >= 2; i--) d[i] = ints[i] - 2 * ints[i - 1] + ints[i - 2];
    const min = order ? Math.min(...d.slice(order)) : 0, packed = d.map((v, i) => i < order ? 0 : v - min);
    const groups = []; for (let i = 0; i < n; i += group) groups.push(packed.slice(i, i + group));
    const refs = groups.map(g => Math.min(...g)), widths = groups.map((g, i) => nbits(Math.max(...g) - refs[i]));
    const refBits = nbits(Math.max(...refs)), wRef = Math.min(...widths), wBits = nbits(Math.max(...widths) - wRef);
    const octets = 2, w = new W();
    if (order) { w.sbits(ints[0], 16); if (order === 2) w.sbits(ints[1], 16); w.sbits(min, 16); }
    for (const r of refs) w.bits(r, refBits); w.align();
    for (const x of widths) w.bits(x - wRef, wBits); w.align();
    groups.forEach((g, i) => { for (const v of g) w.bits(v - refs[i], widths[i]); }); w.align();
    s5 = section(5, [...be(n, 4), ...be(tmpl, 2), ...f32(R), ...sm(E, 2), ...sm(D, 2), refBits, 0, 1, 0, ...be(0, 4), ...be(0, 4), ...be(groups.length, 4), wRef, wBits,
      ...be(group, 4), 1, ...be(groups[groups.length - 1].length, 4), 0, ...(tmpl === 3 ? [order, octets] : [])]);
    s7 = section(7, w.bytes);
  }
  const s6 = bitmap ? section(6, [0, ...(() => { const w = new W(); for (const b of bitmap) w.bits(b ? 1 : 0, 1); w.align(); return w.bytes; })()]) : section(6, [255]);
  const s1 = section(1, [...be(7, 2), ...be(0, 2), 2, 1, 1, ...be(2026, 2), 10, 10, 18, 0, 0, 0, 1]);
  const body = [...s1, ...s3, ...s4, ...s5, ...s6, ...s7, 0x37, 0x37, 0x37, 0x37];
  return [0x47, 0x52, 0x49, 0x42, 0, 0, 0, 2, ...be(16 + body.length, 8), ...body];
}
