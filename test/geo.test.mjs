// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Dead reckoning and great-circle helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination, haversine, deadReckon, deadReckonArc, EARTH_RADIUS_M } from '../src/core/geo.js';

test('destination: quarter of the way round the equator, and due north', () => {
  const q = destination(0, 0, Math.PI / 2 * EARTH_RADIUS_M, 90);
  assert.ok(Math.abs(q.lat) < 1e-9 && Math.abs(q.lon - 90) < 1e-9);
  const n = destination(10, 20, 111195, 0);                      // ~1 degree of latitude
  assert.ok(Math.abs(n.lat - 11) < 1e-3 && Math.abs(n.lon - 20) < 1e-9);
  assert.ok(Math.abs(destination(0, 179, 222390, 90).lon + 179) < 1e-3);   // wraps across the antimeridian
});

test('haversine agrees with destination', () => {
  const p = destination(51.47, -0.45, 5.5e6, 288);              // London Heathrow, westbound
  assert.ok(Math.abs(haversine(51.47, -0.45, p.lat, p.lon) - 5.5e6) < 1);
});

test('deadReckon: moves fast movers, leaves parked and slow ones alone', () => {
  const a = { lat: 40, lon: -74, gs: 230, track: 45, ground: false };
  const p = deadReckon(a, 600);
  assert.ok(Math.abs(haversine(40, -74, p.lat, p.lon) - 138000) < 1);
  assert.deepEqual(deadReckon({ ...a, ground: true }, 600), { lat: 40, lon: -74 });
  assert.deepEqual(deadReckon({ ...a, gs: 8 }, 600), { lat: 40, lon: -74 });
  assert.deepEqual(deadReckon({ ...a, track: null }, 600), { lat: 40, lon: -74 });
});

test('dead reckoning through a turn: a held turn rate curves the path, then it flies straight', () => {
  const plane = { lat: 40, lon: -74, gs: 100, track: 0, ground: false };
  const straight = deadReckonArc(plane, 60, 0);
  assert.ok(Math.abs(haversine(40, -74, straight.lat, straight.lon) - 6000) < 1 && straight.track === 0);
  const half = deadReckonArc(plane, 60, 3);   // 3 deg/s right for 60 s: a half circle, radius 100 / (3 deg/s) ~ 1,910 m
  const r = 100 / (3 * Math.PI / 180);
  assert.ok(Math.abs(half.track - 180) < 1e-9);
  assert.ok(Math.abs(haversine(40, -74, half.lat, half.lon) - 2 * r) < 2, String(haversine(40, -74, half.lat, half.lon)));   // ends one diameter away...
  assert.ok(half.lon > -74 && Math.abs(half.lat - 40) < 1e-4);                                                          // ...due east (a right turn)
  const left = deadReckonArc(plane, 60, -3); assert.ok(left.lon < -74 && Math.abs(left.track - 180) < 1e-9);         // left turn: west
  const after = deadReckonArc(plane, 90, 3, 60);   // the turn lasts 60 s, then 30 s straight south at 100 m/s
  assert.ok(Math.abs(haversine(half.lat, half.lon, after.lat, after.lon) - 3000) < 2 && after.lat < half.lat);
  assert.deepEqual(deadReckonArc(plane, 60, 0.1), straight);   // a rate this small is noise: straight on
  assert.deepEqual(deadReckonArc({ ...plane, ground: true }, 60, 3), { lat: 40, lon: -74, track: 0 });
});

test('deadReckonArc and destination fill an out object, with the same answer as allocating, in every branch', () => {
  const plane = { lat: 40, lon: -74, gs: 100, track: 0, ground: false }, out = { lat: NaN, lon: NaN, track: NaN };
  const cases = [[60, 0], [60, 3], [60, -3], [90, 3, 60], [60, 0.1], [0, 3], [600, 2.5, 120]];
  for (const [s, turn, max] of cases) {
    const fresh = deadReckonArc(plane, s, turn, max), filled = deadReckonArc(plane, s, turn, max, out);
    assert.equal(filled, out, 'returns the object it was given');
    assert.deepEqual({ ...filled }, fresh, `seconds ${s}, turn ${turn}`);
  }
  assert.deepEqual({ ...deadReckonArc({ ...plane, ground: true }, 60, 3, 120, out) }, { lat: 40, lon: -74, track: 0 });   // parked: copied, not moved
  assert.deepEqual({ ...deadReckonArc({ ...plane, track: null }, 60, 3, 120, out) }, { lat: 40, lon: -74, track: null });
  const d = {}; assert.equal(destination(51.47, -0.45, 5.5e6, 288, d), d); assert.deepEqual(d, destination(51.47, -0.45, 5.5e6, 288));
  assert.notEqual(deadReckonArc(plane, 60, 3), deadReckonArc(plane, 60, 3));   // no out: a new object each call, as before
});
