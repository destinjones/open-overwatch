// Isobars and pressure centres (src/core/contour.js) and the field helpers under them (src/core/fields.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levels, isolines, extrema, labelSpots } from '../src/core/contour.js';
import { coarsen, blend, sampleValid, sampleAngle, blendAngle, sampleAt, wraps } from '../src/core/fields.js';

/** A global 1° field (north to south, 0..359 E), f(lat, lon). */
function globe(fn, step = 1) {
  const ni = 360 / step, nj = 180 / step + 1, values = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) values[j * ni + i] = fn(90 - j * step, i * step);
  return { grid: { ni, nj, la1: 90, lo1: 0, la2: -90, lo2: 360 - step, di: step, dj: step, scan: 0 }, values };
}
const dist = (la1, lo1, la2, lo2) => { const r = Math.PI / 180; return Math.acos(Math.min(1, Math.sin(la1 * r) * Math.sin(la2 * r) + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.cos((lo2 - lo1) * r))) / r; };
const low = (la0, lo0, depth, size) => (la, lo) => -depth * Math.exp(-((dist(la, lo, la0, lo0) / size) ** 2));

test('levels: every step from a base, inside the range', () => {
  assert.deepEqual(levels(993.2, 1013, 4, 1000), [996, 1000, 1004, 1008, 1012]);
  assert.deepEqual(levels(10, 9, 4), []);
  assert.deepEqual(levels(-3, 3, 2), [-2, 0, 2]);
});

test('isolines: a low gives closed rings at the right distance', () => {
  const f = globe((la, lo) => 1012 + low(40, 200, 30, 12)(la, lo));
  const [ring] = isolines(f, [1000]);
  assert.equal(ring.lines.length, 1);
  const line = ring.lines[0];
  assert.deepEqual(line[0], line[line.length - 1], 'closed');
  // 1012 - 30 exp(-(d/12)^2) = 1000  →  d = 12 √ln(30/12)
  const want = 12 * Math.sqrt(Math.log(30 / 12));
  for (const [lon, lat] of line) assert.ok(Math.abs(dist(lat, lon, 40, 200) - want) < 0.6, `${lat},${lon}`);
});

test('isolines: lines carry on across the date line on a global grid', () => {
  const f = globe((la, lo) => 1010 + low(10, 0, 20, 15)(la, lo));   // centred on the grid's first column
  const [r] = isolines(f, [1000]);
  assert.equal(r.lines.length, 1, 'one ring, not two halves');
  const lons = r.lines[0].map(p => p[0]);
  for (let i = 1; i < lons.length; i++) assert.ok(Math.abs(lons[i] - lons[i - 1]) < 5, 'no jump of 360');
  assert.ok(Math.min(...lons) < 0 || Math.max(...lons) > 360 - 20, 'it spans the seam');
});

test('isolines: a band field gives open lines; gaps and saddles are handled', () => {
  const f = globe(la => la);   // latitude itself: each level is a full circle of latitude
  const out = isolines(f, [30, -45.5]);
  for (const { level, lines } of out) {
    assert.equal(lines.length, 1);
    for (const [, lat] of lines[0]) assert.ok(Math.abs(lat - level) < 1e-6);
    assert.ok(lines[0].length >= 360);
  }
  // a hole of missing values cuts the circle open: one line from one edge of the hole round to the other
  const g = globe(la => la); for (let j = 55; j <= 65; j++) for (let i = 100; i < 110; i++) g.values[j * 360 + i] = NaN;
  const [cut] = isolines(g, [30]);
  assert.equal(cut.lines.length, 1);
  assert.notDeepEqual(cut.lines[0][0], cut.lines[0][cut.lines[0].length - 1]);
  // a checkerboard saddle: four corners, two up, two down → two segments, no crash
  const s = { grid: { ni: 2, nj: 2, la1: 1, lo1: 0, di: 1, dj: 1, scan: 0 }, values: Float32Array.from([1, 0, 0, 1]) };
  const [sad] = isolines(s, [0.5]);
  assert.equal(sad.lines.length, 2);
});

test('extrema: the highs and lows that stand out, not the noise', () => {
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const f = globe((la, lo) => 1013 + low(50, 330, 28, 10)(la, lo) + low(-40, 120, 15, 8)(la, lo) - low(30, 200, 12, 15)(la, lo) + rnd() * 0.3);
  const c = extrema(f, { radius: 8, depth: 2 });
  assert.equal(c.length, 3, JSON.stringify(c));
  assert.deepEqual(c.map(x => x.type), ['L', 'L', 'H']);
  assert.ok(dist(c[0].lat, c[0].lon, 50, 330) <= 1.5 && Math.abs(c[0].value - 985) < 1);
  assert.ok(dist(c[1].lat, c[1].lon, -40, 120) <= 1.5);
  assert.ok(dist(c[2].lat, c[2].lon, 30, 200) <= 1.5 && c[2].value > 1024);
  assert.ok(c[0].lon >= -180 && c[0].lon < 180, 'longitudes come back in -180..180');
  // a flat top counts once; nothing poleward of maxLat
  const flat = globe((la, lo) => dist(la, lo, 0, 90) < 4 ? 1030 : 1010);
  assert.equal(extrema(flat).filter(x => x.type === 'H').length, 1);
  assert.equal(extrema(globe((la, lo) => 1000 + low(86, 0, 30, 5)(la, lo))).length, 0);
});

test('labelSpots: evenly along a line, with its direction', () => {
  const line = Array.from({ length: 61 }, (_, i) => [i, 0]);
  const s = labelSpots(line, { spacing: 20 });
  assert.equal(s.length, 3);
  assert.ok(Math.abs(s[0].lon - 10) < 1e-9 && Math.abs(s[1].lon - 30) < 1e-9);
  assert.ok(Math.abs(s[0].angle) < 1e-9);
  assert.deepEqual(labelSpots([[0, 0], [1, 0]]), []);
});

test('coarsen: box means on every k-th point, wrapping and skipping gaps; pick for directions', () => {
  const f = globe((la, lo) => lo, 0.25);
  assert.ok(wraps(f.grid));
  const c = coarsen(f, 4);
  assert.equal(c.grid.ni, 360); assert.equal(c.grid.nj, 181); assert.equal(c.grid.di, 1);
  assert.ok(Math.abs(c.values[90 * 360 + 10] - 10) < 1e-4, 'mean of 9.5..10.5');
  assert.ok(c.values[90 * 360] > 30, 'the first column averages across the seam (359.5..0.5)');
  const p = coarsen(f, 4, 'pick'); assert.equal(p.values[90 * 360 + 10], 10);
  const h = globe(() => NaN, 0.5); h.values[100] = 7;
  const hc = coarsen(h, 2); assert.equal(hc.values[50], 7); assert.ok(Number.isNaN(hc.values[51]));
});

test('blend and sampling: time, coasts, directions', () => {
  const a = globe(() => 10), b = globe(() => 20);
  assert.equal(blend(a, b, 0.25).values[5], 12.5);
  assert.equal(blend(a, b, 0), a);
  const coast = globe((la, lo) => lo < 10 ? NaN : 3);
  assert.equal(sampleValid(coast, 0, 9.5), 3, 'a coastal point takes the sea corners');
  assert.ok(Number.isNaN(sampleValid(coast, 0, 5)));
  const dir = globe((la, lo) => lo < 100 ? 350 : 10);
  assert.ok(Math.abs(sampleAngle(dir, 0, 99.5)) < 1e-6 || Math.abs(sampleAngle(dir, 0, 99.5) - 360) < 1e-6, 'halfway between 350 and 10 is north');
  assert.equal(blendAngle(350, 10, 0.5), 0);
  assert.equal(blendAngle(10, 350, 0.25), 5);
  assert.equal(sampleAt(a, b, 0.5, 0, 0), 15);
  assert.ok(Math.abs(sampleAt(globe(() => 340), globe(() => 20), 0.5, 0, 0, sampleAngle)) < 1e-9);
});
