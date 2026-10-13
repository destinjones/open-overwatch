// How weather-model fields look (src/core/wxpaint.js): colour ramps, washes painted through a projection, wave darts,
// the isobar chart, and the legends, shared by the globe and the 2D map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMP, RAIN, GUST, WAVE, WIND_COLORS, WIND_EDGES, tempRgb, stepped, cloudRgba, washRgba, windBucket, paintWash, waveDarts, pressureChart, splitJumps, legendFor } from '../src/core/wxpaint.js';

function globe(fn, step = 1) {
  const ni = 360 / step, nj = 180 / step + 1, values = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) values[j * ni + i] = fn(90 - j * step, i * step);
  return { grid: { ni, nj, la1: 90, lo1: 0, la2: -90, lo2: 360 - step, di: step, dj: step, scan: 0 }, values };
}
const dist = (la1, lo1, la2, lo2) => { const r = Math.PI / 180; return Math.acos(Math.min(1, Math.sin(la1 * r) * Math.sin(la2 * r) + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.cos((lo2 - lo1) * r))) / r; };

test('temperature ramp: the stops exactly, halfway between them, clamped outside', () => {
  for (const [t, c] of TEMP) assert.deepEqual(tempRgb(t), c);
  assert.deepEqual(tempRgb(5), [40, 200, 195]);   // halfway from 0 °C [40,190,250] to 10 °C [40,210,140]
  assert.deepEqual(tempRgb(-90), TEMP[0][1]); assert.deepEqual(tempRgb(60), TEMP[TEMP.length - 1][1]);
  assert.deepEqual(tempRgb(NaN), [0, 0, 0]);
  tempRgb(-90)[0] = 0; assert.equal(TEMP[0][1][0], 120, 'callers get a copy, not the stop itself');
});

test('stepped colours: clear below the first stop, log steps for rain', () => {
  assert.deepEqual(stepped(RAIN, 0.05, true), [0, 0, 0, 0]);
  assert.deepEqual(stepped(RAIN, 1, true), RAIN[1][1]);
  const mid = stepped(RAIN, Math.sqrt(1 * 4), true);   // geometric middle of 1 and 4 mm/h: halfway in log steps
  RAIN[1][1].forEach((v, i) => assert.equal(mid[i], Math.round(v + (RAIN[2][1][i] - v) / 2)));
  assert.equal(stepped(GUST, 7)[3], 0, 'light gusts: clear');
  assert.deepEqual(stepped(GUST, 99), GUST[GUST.length - 1][1]);
});

test('wash colours by kind: land is clear in waves, temperature opaque, thin cloud see-through', () => {
  assert.deepEqual(washRgba('wave', NaN), [0, 0, 0, 0]);
  assert.deepEqual(washRgba('wave', 0), WAVE[0][1]);
  assert.equal(washRgba('temp', 20)[3], 255);
  assert.equal(washRgba('temp', NaN)[3], 0);
  assert.equal(cloudRgba(10)[3], 0); assert.equal(cloudRgba(100)[3], 225); assert.ok(cloudRgba(50)[3] > 0 && cloudRgba(50)[3] < 225);
  assert.deepEqual(washRgba('nonsense', 3), [0, 0, 0, 0]);
});

test('wind streak colours: one more colour than edges, speeds bucketed at the edges', () => {
  assert.equal(WIND_COLORS.length, WIND_EDGES.length + 1);
  assert.equal(windBucket(0), 0); assert.equal(windBucket(3), 0); assert.equal(windBucket(3.01), 1);
  assert.equal(windBucket(22), 4); assert.equal(windBucket(40), 5);
});

test('paintWash: each pixel through the projection; step fills blocks', () => {
  const w = 4, h = 2, px = new Uint8ClampedArray(w * h * 4), seen = [];
  paintWash('temp', px, w, h, (x, y) => { seen.push([x, y]); return x < 2 ? -40 : 40; });
  assert.equal(seen.length, 8); assert.deepEqual(seen[0], [0, 0]);
  assert.deepEqual([...px.slice(0, 4)], [...TEMP[0][1], 255]);
  assert.deepEqual([...px.slice(12, 16)], [...TEMP[TEMP.length - 1][1], 255]);
  const q = new Uint8ClampedArray(w * h * 4), asked = [];
  paintWash('temp', q, w, h, (x, y) => { asked.push([x, y]); return 0; }, 2);
  assert.deepEqual(asked, [[0.5, 0.5], [2.5, 0.5]], 'block centres');
  for (let i = 0; i < w * h; i++) assert.equal(q[i * 4 + 3], 255, 'every pixel filled');
});

test('wave darts: on open sea with waves, pointing where the waves run, on a grid fixed to the world', () => {
  const value = (k, lat, lon) => k === 'wave' ? (lon > 0 ? 2 : lon < -100 ? NaN : 0.1) : 270;   // from the west
  const d = waveDarts(value, { step: 4 });
  assert.ok(d.length > 50);
  for (const x of d) { assert.ok(x.lon > 0, 'only where waves reach 0.3 m'); assert.equal(x.to, 90, 'running east'); assert.ok(Math.abs(x.lat) <= 75); }
  const a = waveDarts(value, { step: 4, west: 10, east: 30, south: 0, north: 10 }), b = waveDarts(value, { step: 4, west: 11.3, east: 30, south: 0, north: 10 });
  assert.deepEqual(a.map(x => x.lon).filter(l => l > 12), b.map(x => x.lon).filter(l => l > 12), 'a pan does not move them');
  assert.ok(a.every(x => ((x.lon + 178) % 4 + 4) % 4 === 0), 'on the globe\'s grid: -178, -174, …');
  assert.ok(waveDarts(value, { step: 4, south: 70, north: 75 }).every(x => (x.lon + 178) % 8 === 0 || (x.lon + 178) % 12 === 0 || (x.lon + 178) % 16 === 0), 'sparser near the poles');
});

test('pressure chart: rings round a low every 4 hPa, an L at its centre, values written on the lines', () => {
  const f = globe((la, lo) => 101100 - 2900 * Math.exp(-((dist(la, lo, 50, 340) / 12) ** 2)));   // a 982 hPa low west of Ireland
  const c = pressureChart(f);
  assert.deepEqual(c.lines.map(l => l.hpa), [984, 988, 992, 996, 1000, 1004, 1008]);
  assert.ok(c.lines.find(l => l.hpa === 1000).bold && !c.lines.find(l => l.hpa === 996).bold);
  assert.equal(c.centres.length, 1); assert.equal(c.centres[0].type, 'L');
  assert.equal(c.centres[0].lat, 50); assert.equal(c.centres[0].lon, -20); assert.ok(Math.abs(c.centres[0].value - 982) < 0.01);
  assert.ok(c.labels.length > 0 && c.labels.every(l => /^\d{3,4}$/.test(l.text)));
  assert.ok(c.labels.every(l => dist(l.lat, l.lon, 50, 340) >= 4.9), 'no value written over the L');
});

test('pressure chart: blends two hours and smooths a fine grid to 1° first', () => {
  const low = (la, lo) => 101100 - 2900 * Math.exp(-((dist(la, lo, 50, 340) / 12) ** 2));
  const a = globe(low, 0.5), b = globe(() => 101100, 0.5);
  const c = pressureChart(a, b, 0.5);   // halfway: a 996.5 hPa low
  assert.equal(c.centres.length, 1); assert.ok(Math.abs(c.centres[0].value - 996.5) < 0.1, String(c.centres[0].value));
  assert.deepEqual(c.lines.map(l => l.hpa), [1000, 1004, 1008]);
  assert.deepEqual(pressureChart(b).lines, [], 'flat 1011 hPa: no lines');
});

test('splitJumps: a line that wraps is cut where it jumps half the world', () => {
  assert.deepEqual(splitJumps([[170, 0], [179, 1], [-179, 2], [-170, 3]]), [[[170, 0], [179, 1]], [[-179, 2], [-170, 3]]]);
  assert.deepEqual(splitJumps([[10, 0], [20, 0]]), [[[10, 0], [20, 0]]]);
  assert.deepEqual(splitJumps([[10, 0]]), []);
});

test('legends: drawn from the same stops, metric or imperial', () => {
  const t = legendFor('temp'), f = legendFor('temp', true);
  assert.equal(t.ticks.length, TEMP.length); assert.equal(t.ticks[0][1], -40); assert.equal(f.ticks[0][1], -40); assert.equal(f.ticks.at(-1)[1], 104);
  assert.match(t.gradient, /^linear-gradient\(90deg,rgba\(120,60,200,1\) 0\.0%/);
  assert.equal(legendFor('wind').ticks.length, WIND_EDGES.length + 1);
  assert.deepEqual(legendFor('wind', true).ticks.map(x => x[1]), [0, 7, 13, 22, 34, 49]);
  assert.equal(legendFor('pres').gradient, null);
  for (const k of ['gust', 'wave', 'rain', 'cloud']) assert.ok(legendFor(k).gradient.startsWith('linear-gradient'), k);
  assert.equal(legendFor('nope'), null);
});
