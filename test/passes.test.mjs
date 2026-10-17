// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Satellite pass finding against a synthetic orbit: a circular polar orbit over a non-rotating Earth, observer on the
// equator at longitude 0, so the satellite passes straight overhead once per orbit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookAngles, sunlit, findPasses, compass } from '../src/core/passes.js';

const R = 6371, ALT = 420, PERIOD = 92.7 * 60e3;   // ms
const sat = t => { const th = 2 * Math.PI * t / PERIOD - Math.PI / 2; return { x: (R + ALT) * Math.cos(th), y: 0, z: (R + ALT) * Math.sin(th) }; };   // in the x-z plane
const obs = { pos: { x: R, y: 0, z: 0 }, east: { x: 0, y: 1, z: 0 }, north: { x: 0, y: 0, z: 1 }, up: { x: 1, y: 0, z: 0 } };

test('passes: look angles (zenith, horizon, compass)', () => {
  assert.ok(Math.abs(lookAngles({ x: R + 400, y: 0, z: 0 }, obs).el - 90) < 1e-9);
  const a = lookAngles({ x: R, y: 0, z: 1000 }, obs); assert.ok(Math.abs(a.el) < 1e-9 && Math.abs(a.az) < 1e-9);   // due north on the horizon
  assert.equal(compass(0), 'N'); assert.equal(compass(225), 'SW'); assert.equal(compass(359), 'N');
});

test('passes: one overhead pass per orbit, south to north, peak near 90 deg', () => {
  const p = findPasses(sat, obs, 0, 2 * PERIOD);
  assert.equal(p.length, 2);
  for (const q of p) {
    assert.ok(q.maxEl > 89, `max ${q.maxEl}`); assert.ok(q.set > q.peak && q.peak > q.rise);
    assert.equal(compass(q.azRise), 'S'); assert.equal(compass(q.azSet), 'N');
    assert.ok(Math.abs((q.set - q.rise) / 60e3 - 7.2) < 1.5, `${(q.set - q.rise) / 60e3} min above 10 deg`);   // ~7 min for the ISS
  }
  assert.ok(Math.abs(p[1].peak - p[0].peak - PERIOD) < 2e3);
});

test('passes: visibility needs a sunlit satellite and a dark sky', () => {
  assert.ok(sunlit({ x: 7000, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }));
  assert.ok(!sunlit({ x: -7000, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }));          // behind the Earth
  assert.ok(sunlit({ x: -7000, y: 0, z: 7000 }, { x: 1, y: 0, z: 0 }));       // behind, but out of the shadow cylinder
  const night = findPasses(sat, obs, 0, PERIOD, { sunAt: () => ({ x: 0, y: -0.2, z: Math.sqrt(1 - 0.04) }) });   // sun below the horizon
  assert.equal(night.length, 1); assert.equal(typeof night[0].visible, 'boolean');
});

test('passes: a satellite whose propagation fails mid-pass (decay) ends the pass, it does not throw', () => {
  const sun = () => ({ x: 0, y: -0.2, z: Math.sqrt(1 - 0.04) });
  for (let k = 0; k < 20; k++) {                         // the set-edge bisection lands on either side of the cut-off
    const cut = PERIOD / 4 + 90e3 + k * 37;               // 90 s after the first overhead peak
    const dying = t => (t > cut ? null : sat(t));
    const p = findPasses(dying, obs, 0, 2 * PERIOD, { sunAt: sun });
    assert.equal(p.length, 1);
    for (const f of ['azRise', 'azPeak', 'azSet']) assert.ok(Number.isFinite(p[0][f]), `${f} = ${p[0][f]}`);
    assert.equal(compass(p[0].azSet), 'N');
  }
});

test('passes: after a mid-pass failure the set azimuth comes from the last valid instant, not half-way back to the peak', () => {
  const f = 3 / (180 / Math.PI), c = Math.cos(f), s = Math.sin(f);   // observer 3 deg east of the ground track: the azimuth swings
  const off = { pos: { x: R * c, y: R * s, z: 0 }, east: { x: -s, y: c, z: 0 }, north: { x: 0, y: 0, z: 1 }, up: { x: c, y: s, z: 0 } };
  for (let k = 0; k < 20; k++) {                         // the set edge lands on either side of the cut-off
    const cut = PERIOD / 4 + 90e3 + k * 37, dying = t => (t > cut ? null : sat(t));
    const p = findPasses(dying, off, 0, PERIOD);
    assert.equal(p.length, 1);
    const want = lookAngles(sat(cut), off).az;
    assert.ok(Math.abs(p[0].azSet - want) < 0.5, `azSet ${p[0].azSet} vs ${want} at the cut-off`);
  }
});

test('passes: a pass whose peak cannot be propagated when the azimuths are read is dropped', () => {
  const seen = new Set();                                  // every instant works once, then fails (the peak is read twice)
  const flaky = t => { if (seen.has(t)) return null; seen.add(t); return sat(t); };
  assert.deepEqual(findPasses(flaky, obs, 0, PERIOD, { sunAt: () => ({ x: 0, y: -0.2, z: Math.sqrt(1 - 0.04) }) }), []);
});
