// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The visitor's own place on the 2D map (src/core/myplace.js): kept only from the device or a pick on the map, rounded
// to 0.01°, for 24 h; a position from an older version's IP lookup is dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keptPlace, makePlace, roundPlace, PLACE_TTL, PLACE_SOURCES } from '../src/core/myplace.js';

const NOW = Date.parse('2026-10-17T12:00:00Z');

test('a place is rounded to 0.01° (about 1 km) and its longitude wrapped', () => {
  assert.deepEqual(roundPlace(51.507351, -0.127758), { lat: 51.51, lon: -0.13 });
  assert.deepEqual(roundPlace(-33.86785, 151.20732), { lat: -33.87, lon: 151.21 });
  assert.deepEqual(roundPlace(10, 190.004), { lat: 10, lon: -170 });   // a map tap one world copy east
  assert.deepEqual(roundPlace(10, -540), { lat: 10, lon: -180 });
  assert.ok(Object.is(roundPlace(-0.001, -0.001).lat, 0) && Object.is(roundPlace(-0.001, -0.001).lon, 0), 'no -0');
  for (const [la, lo] of [[NaN, 0], [0, Infinity], [91, 0], ['51', 0], [null, 0]]) assert.equal(roundPlace(la, lo), null, `${la}, ${lo}`);
});

test('only the device and a pick on the map are kept: never an IP lookup', () => {
  assert.deepEqual(PLACE_SOURCES, ['device', 'picked']);
  assert.deepEqual(makePlace(48.85837, 2.29448, 'device', NOW), { lat: 48.86, lon: 2.29, how: 'device', t: NOW });
  assert.deepEqual(makePlace(48.85837, 2.29448, 'picked', NOW), { lat: 48.86, lon: 2.29, how: 'picked', t: NOW });
  assert.equal(makePlace(48.85837, 2.29448, 'approximate (IP)', NOW), null);
  assert.equal(makePlace(48.85837, 2.29448, undefined, NOW), null);
  assert.equal(makePlace(NaN, 2, 'device', NOW), null);
  assert.equal(makePlace(1, 2, 'device').t > NOW, true, 'stamped now by default');
});

test('a kept place is read back for 24 h, re-rounded; older, future, malformed or IP-derived ones are dropped', () => {
  const exact = { lat: 40.712776, lon: -74.005974, how: 'device', t: NOW - 3600e3 };   // an older version kept it unrounded
  assert.deepEqual(keptPlace(exact, NOW), { lat: 40.71, lon: -74.01, how: 'device', t: NOW - 3600e3 });
  assert.equal(PLACE_TTL, 24 * 3600e3);
  assert.ok(keptPlace({ ...exact, t: NOW - PLACE_TTL + 1000 }, NOW));
  assert.equal(keptPlace({ ...exact, t: NOW - PLACE_TTL }, NOW), null, 'a day old');
  assert.equal(keptPlace({ ...exact, t: NOW - 30 * 86400e3 }, NOW), null, 'a month old');
  assert.equal(keptPlace({ ...exact, t: NOW + 3600e3 }, NOW), null, 'from the future');
  assert.equal(keptPlace({ ...exact, how: 'approximate (IP)' }, NOW), null, 'the old ipapi.co fallback');
  for (const bad of [null, undefined, 'x', 42, {}, { lat: 1, lon: 2, how: 'device' }, { lat: 'a', lon: 2, how: 'device', t: NOW }])
    assert.equal(keptPlace(bad, NOW), null, JSON.stringify(bad));
  assert.ok(keptPlace({ lat: 1, lon: 2, how: 'picked', t: Date.now() }), 'now by default');
});
