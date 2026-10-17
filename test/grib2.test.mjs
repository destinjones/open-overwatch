// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// GRIB2 (src/core/grib2.js): messages built with a small encoder (test/helpers/grib2.mjs: simple packing, complex
// packing with first- and second-order spatial differencing, a bitmap), decoded back; the .idx inventory and its byte
// ranges. The decoder was
// also checked against ECMWF's eccodes on real GFS fields (10 m wind, 2 m temperature, cloud cover, rain rate: equal to
// within float32 rounding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeGrib2, sampleGrid, parseIdx, idxRanges } from '../src/core/grib2.js';
import { message } from './helpers/grib2.mjs';

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
