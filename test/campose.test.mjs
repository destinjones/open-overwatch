import test from 'node:test';
import assert from 'node:assert/strict';
import { bearingFromText, alongRoad, estimatePose, enuDir, axes, cornerRays, footprint, roadBearings, angleDiff } from '../src/core/campose.js';

test('compass words from real TfL view texts', () => {
  assert.equal(bearingFromText('South (Earls Court Road)'), 180);
  assert.equal(bearingFromText('Zoom west - Deptford Bridge'), 270);
  assert.equal(bearingFromText('ZOOM WEST-The Grove'), 270);
  assert.equal(bearingFromText('EAST ZOOM - Kenilworth Road footbridge'), 90);
  assert.equal(bearingFromText('North - Marsham St twds P Sq'), 0);
  assert.equal(bearingFromText('Zoom north - Lansdowne Road jct'), 0);
  assert.equal(bearingFromText('West'), 270);
  assert.equal(bearingFromText('looking north-east over the junction'), 45);
  assert.equal(bearingFromText('I-5 NB at Main St'), 0);
  assert.equal(bearingFromText('SR-99 southbound'), 180);
});

test('road names are not directions', () => {
  for (const t of ['A205 South Circular Rd', 'West End Lane', 'West St @ 86 St', 'Piccadilly Circus', 'ZOOM-near old Croydon Airport', 'Met', '', null])
    assert.equal(bearingFromText(t), null, String(t));
});

test('facing along the road', () => {
  assert.equal(alongRoad([10, 95], 180), 190);          // "south" on a road running 10/190: face 190
  assert.equal(alongRoad([92]), 92); assert.equal(alongRoad([92], null, true), 272);
  assert.equal(alongRoad([0], 90), 90);                 // the only road crosses the hinted view: trust the words
  assert.equal(alongRoad([], 45), null);
  assert.equal(angleDiff(350, 10), 20);
});

test('pose guesses, best source first', () => {
  const cal = estimatePose({ net: 'tfl', view: 'South', calibrated: { heading: 123, pitch: -20, fov: 40, height: 9 } });
  assert.equal(cal.source, 'calibrated'); assert.equal(cal.heading, 123);
  const both = estimatePose({ net: 'tfl', view: 'South (Earls Court Road)' }, [8]);
  assert.deepEqual([both.heading, both.source, both.height], [188, 'words + road', 7]);
  assert.equal(estimatePose({ net: 'caltrans', direction: 'West' }).heading, 270);
  assert.equal(estimatePose({ net: 'finland', presetDir: 'decreasing' }, [30]).heading, 210);
  assert.equal(estimatePose({ net: 'finland', view: 'Tienpinta' }).pitch, -55);
  assert.equal(estimatePose({ net: 'nyc', name: 'Central Park West @ 86 St' }).source, 'default');
});

test('frustum geometry', () => {
  const near = (a, b, e = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < e);
  assert.ok(near(enuDir(90, 0), [1, 0, 0])); assert.ok(near(enuDir(0, -90), [0, 0, -1]));
  const { f, r, u } = axes({ heading: 0, pitch: 0 }); assert.ok(near(f, [0, 1, 0]) && near(r, [1, 0, 0]) && near(u, [0, 0, 1]));
  const pose = { heading: 0, pitch: -45, fov: 90, height: 10 };
  assert.equal(cornerRays(pose, 1).length, 4);
  const fp = footprint(pose, 1, 500);
  assert.ok(near(fp[0], [-7.0711, 0], 1e-3) && near(fp[1], [7.0711, 0], 1e-3), JSON.stringify(fp));   // bottom edge on the ground, below the camera
  assert.ok(Math.abs(Math.hypot(...fp[2]) - 500) < 1e-6 && fp[2][1] > 0);   // top edge is level: cut off at 500 m, ahead
  assert.equal(footprint({ heading: 0, pitch: 60, fov: 40, height: 10 }, 1), null);   // looking at the sky
});

test('road bearings from OpenStreetMap geometry', () => {
  const lat = 51.5, lon = -0.12, ns = { geometry: [{ lat: 51.499, lon }, { lat: 51.501, lon }] };            // through the camera, south to north
  const ew = { geometry: [{ lat: 51.5003, lon: -0.121 }, { lat: 51.5003, lon: -0.119 }] };                    // 33 m north, west to east
  const far = { geometry: [{ lat: 51.51, lon: -0.13 }, { lat: 51.51, lon: -0.11 }] };                          // 1 km away
  const b = roadBearings([ew, far, ns], lat, lon);
  assert.equal(b.length, 2); assert.ok(Math.abs(b[0] - 0) < 0.5 && Math.abs(b[1] - 90) < 0.5, JSON.stringify(b));
});
