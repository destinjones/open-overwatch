// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { instruction, distanceText, durationText, haversine, measure, pointAt, bearing, compass } from '../src/core/route.js';

test('OSRM steps read as plain instructions', () => {
  assert.equal(instruction({ name: 'Strand', maneuver: { type: 'depart', bearing_after: 70 } }), 'Head east on Strand');
  assert.equal(instruction({ name: 'Fleet Street', maneuver: { type: 'turn', modifier: 'left' } }), 'Turn left onto Fleet Street');
  assert.equal(instruction({ name: '', maneuver: { type: 'turn', modifier: 'slight right' } }), 'Turn slight right');
  assert.equal(instruction({ name: 'A4', maneuver: { type: 'roundabout', exit: 2 } }), 'At the roundabout, take the 2nd exit onto A4');
  assert.equal(instruction({ name: 'B1', maneuver: { type: 'roundabout', exit: 11 } }), 'At the roundabout, take the 11th exit onto B1');
  assert.equal(instruction({ name: '', maneuver: { type: 'arrive', modifier: 'right' } }), 'Arrive: your destination is on the right');
  assert.equal(instruction({ name: 'Mall', maneuver: { type: 'turn', modifier: 'uturn' } }), 'Make a U-turn onto Mall');
  assert.equal(compass(359), 'north'); assert.equal(compass(225), 'southwest');
});

test('distances and durations in words', () => {
  assert.equal(distanceText(3), '10 m'); assert.equal(distanceText(347), '350 m'); assert.equal(distanceText(3369), '3.4 km'); assert.equal(distanceText(42195), '42 km');
  assert.equal(durationText(45), '45 s'); assert.equal(durationText(2698), '45 min'); assert.equal(durationText(3900), '1 h 05 min');
});

test('walking a polyline', () => {
  // London: Trafalgar Square to St Paul's, about 2.1 km as the crow flies
  const d = haversine([-0.1281, 51.5080], [-0.0984, 51.5138]); assert.ok(d > 2000 && d < 2300, String(d));
  const line = measure([[0, 0], [0, 1], [1, 1]]);
  assert.ok(Math.abs(line.total - 2 * 111195) < 200);
  assert.deepEqual(pointAt(line, -5), [0, 0]); assert.deepEqual(pointAt(line, 1e9), [1, 1]);
  const mid = pointAt(line, line.cum[1] / 2); assert.ok(Math.abs(mid[1] - 0.5) < 1e-9 && mid[0] === 0);
  assert.ok(Math.abs(bearing([0, 0], [0, 1]) - 0) < 1e-9); assert.ok(Math.abs(bearing([0, 0], [1, 0]) - 90) < 1e-9);
});
