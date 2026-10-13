// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Aircraft records (src/core/aircraft.js): the readsb and OpenSky readers both views share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readsb, openskyState, cleanHex } from '../src/core/aircraft.js';

test('readsb: units, ground, flags, emergencies, junk', () => {
  const a = readsb({ hex: 'AE01CE', flight: 'RCH123  ', r: '05-5140', t: 'C17', lat: 38.8, lon: -77, alt_baro: 31000, alt_geom: 31500, gs: 450, track: 92.5, baro_rate: -640, squawk: '7700', dbFlags: 1, seen_pos: 2.5, mlat: ['lat'] });
  assert.equal(a.hex, 'ae01ce'); assert.equal(a.flight, 'RCH123'); assert.equal(a.mil, true); assert.equal(a.emerg, true); assert.equal(a.mlat, true);
  assert.ok(Math.abs(a.altM - 9448.8) < 1e-6); assert.ok(Math.abs(a.geomM - 9601.2) < 1e-6); assert.ok(Math.abs(a.gsMs - 231.4998) < 1e-3); assert.ok(Math.abs(a.rateMs + 3.2512) < 1e-9);
  assert.equal(a.seenPos, 2.5); assert.equal(a.altFt, 31000); assert.equal(a.rateFpm, -640);
  const g = readsb({ hex: '<b>abc~1', lat: 51.47, lon: -0.45, alt_baro: 'ground', alt_geom: 120, true_heading: 270, geom_rate: 64, emergency: 'none' });
  assert.equal(g.hex, 'babc~1');   // markup goes, hex letters stay assert.equal(g.ground, true); assert.equal(g.altM, 0); assert.equal(g.geomM, null); assert.equal(g.track, 270); assert.equal(g.rateFpm, 64); assert.equal(g.emerg, false); assert.equal(g.mil, false);
  assert.equal(readsb({ hex: 'abc', lat: 1, lon: 2, emergency: 'general' }).emerg, true);
  assert.equal(readsb({ hex: 'abc', lat: 1, lon: 2 }, { mil: true }).mil, true);
  assert.equal(readsb({ hex: 'abc', lat: null, lon: 2 }), null); assert.equal(readsb({ hex: '', lat: 1, lon: 2 }), null); assert.equal(readsb(null), null);
  assert.equal(cleanHex('A1"B2'), 'a1b2');
});

test('OpenSky state vectors', () => {
  const s = openskyState(['4ca7b5', 'RYR12AB ', 'Ireland', 1760000000, 1760000001, -6.27, 53.42, 10668, false, 230.5, 271.2, -5.2, null, 10900, '7600', false, 0]);
  assert.equal(s.hex, '4ca7b5'); assert.equal(s.flight, 'RYR12AB'); assert.equal(s.altM, 10668); assert.ok(Math.abs(s.altFt - 35000) < 1); assert.ok(Math.abs(s.gsKt - 448.06) < 0.01);
  assert.ok(Math.abs(s.rateFpm + 1023.6) < 0.1); assert.equal(s.geomM, 10900); assert.equal(s.emerg, true); assert.equal(s.tpos, 1760000000);
  const gnd = openskyState(['abc123', '', 'X', null, 0, 1, 2, 50, true, 3, 90, null, null, 60, null]);
  assert.equal(gnd.altM, 0); assert.equal(gnd.geomM, null); assert.equal(gnd.rateMs, null); assert.equal(gnd.squawk, '');
  assert.equal(openskyState(['abc', 'x', 'y', 0, 0, null, 2]), null); assert.equal(openskyState({}), null);
});
