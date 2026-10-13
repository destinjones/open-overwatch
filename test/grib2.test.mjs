// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// GRIB2 (src/core/grib2.js): messages built here with a small encoder (simple packing, complex packing with first- and
// second-order spatial differencing, a bitmap), decoded back; the .idx inventory and its byte ranges. The decoder was
// also checked against ECMWF's eccodes on real GFS fields (10 m wind, 2 m temperature, cloud cover, rain rate: equal to
// within float32 rounding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeGrib2, sampleGrid, parseIdx, idxRanges } from '../src/core/grib2.js';

// ---- a minimal GRIB2 writer
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

function message({ ni, nj, la1 = 90, lo1 = 0, di = 1, dj = 1, scan = 0, ints, R = 0, E = 0, D = 0, tmpl = 0, order = 0, group = 4, bitmap = null, hours = 6 }) {
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

const field = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('simple packing: reference, binary and decimal scale', () => {
  const ints = field(12, i => (i * 7) % 23);
  const [m] = decodeGrib2(Uint8Array.from(message({ ni: 4, nj: 3, ints, R: 100.5, E: -1, D: 1 })));
  assert.deepEqual([m.discipline, m.category, m.number, m.hours], [0, 2, 2, 6]);
  assert.deepEqual([m.grid.ni, m.grid.nj, m.grid.la1, m.grid.lo1, m.grid.la2, m.grid.lo2, m.grid.di], [4, 3, 90, 0, 88, 3, 1]);
  ints.forEach((x, i) => near(m.values[i], (100.5 + x * 0.5) / 10, 1e-5, 'value ' + i));
});

test('complex packing with first- and second-order spatial differencing, uneven groups', () => {
  const smooth = field(37, i => Math.round(500 + 40 * Math.sin(i / 5) + i * 3)), rough = field(37, i => (i * 131) % 97);
  for (const [order, ints] of [[1, smooth], [2, smooth], [2, rough], [1, rough]]) {
    const [m] = decodeGrib2(Uint8Array.from(message({ ni: 37, nj: 1, ints, R: -20, E: 0, D: 0, tmpl: 3, order, group: 5 })));
    ints.forEach((x, i) => assert.equal(m.values[i], x - 20, `order ${order} value ${i}`));
  }
  const ints = field(20, i => i * i);
  const [m] = decodeGrib2(Uint8Array.from(message({ ni: 5, nj: 4, ints, tmpl: 2, group: 3 })));   // 5.2: no differencing
  ints.forEach((x, i) => assert.equal(m.values[i], x));
});

test('a bitmap leaves NaN where there is no value; two messages in one buffer', () => {
  const bitmap = [1, 0, 1, 1, 0, 1], a = message({ ni: 3, nj: 2, ints: [1, 2, 3, 4], bitmap }), b = message({ ni: 3, nj: 2, ints: field(6, i => i), hours: 9 });
  const [x, y] = decodeGrib2(Uint8Array.from([...a, ...b]));
  assert.deepEqual(Array.from(x.values).map(v => Number.isNaN(v) ? null : v), [1, null, 2, 3, null, 4]);
  assert.equal(y.hours, 9); assert.deepEqual(Array.from(y.values), [0, 1, 2, 3, 4, 5]);
});

test('sampling: bilinear, longitude wraps, rows clamp at the poles', () => {
  const [m] = decodeGrib2(Uint8Array.from(message({ ni: 4, nj: 3, di: 90, dj: 90, la1: 90, ints: field(12, i => i) })));   // rows at 90, 0, -90
  assert.equal(sampleGrid(m, 0, 90), 5);
  near(sampleGrid(m, 45, 45), (0.5 + 4.5) / 2, 1e-9, 'between four');
  near(sampleGrid(m, 0, 315), (7 + 4) / 2, 1e-9, 'across the date line');
  near(sampleGrid(m, 0, -45), (7 + 4) / 2, 1e-9, 'negative longitude');
  assert.equal(sampleGrid(m, -95, 0), 8);
});

test('the .idx inventory: ranges for the wanted instant fields, neighbours merged', () => {
  const idx = ['581:34601144:d=2026101018:TMP:2 m above ground:6 hour fcst:', '582:34648279:d=2026101018:SPFH:2 m above ground:6 hour fcst:',
    '588:35006579:d=2026101018:UGRD:10 m above ground:6 hour fcst:', '589:35085422:d=2026101018:VGRD:10 m above ground:6 hour fcst:',
    '590:35164639:d=2026101018:GUST:surface:6 hour fcst:', '593:35277686:d=2026101018:PRATE:surface:6 hour fcst:',
    '595:35405289:d=2026101018:PRATE:surface:0-6 hour ave fcst:', '636:37066291:d=2026101018:TCDC:entire atmosphere:6 hour fcst:'].join('\n');
  const rows = parseIdx(idx);
  assert.equal(rows.length, 8); assert.equal(rows[0].end, 34648278); assert.equal(rows[7].end, null);
  const r = idxRanges(rows, [['UGRD', '10 m above ground'], ['VGRD', '10 m above ground'], ['PRATE', 'surface'], ['TCDC', 'entire atmosphere']]);
  assert.deepEqual(r.map(x => [x.start, x.end, x.fields.length]), [[35006579, 35164638, 2], [35277686, 35405288, 1], [37066291, null, 1]]);
  assert.equal(idxRanges(parseIdx('1:0:d=2026101018:UGRD:10 m above ground:anl:\n2:99:d=2026101018:VGRD:10 m above ground:anl:'), [['UGRD', '10 m above ground']])[0].end, 98);
});
