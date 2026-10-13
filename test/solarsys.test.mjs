// The planets from Earth (src/core/solarsys.js) against events everyone could look up: oppositions, greatest elongations,
// Saturn's ring-plane crossing, and the brightness the almanacs gave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planetFromEarth, moonFromEarth, skyEvents, visibility, magnitude, saturnRingTilt, SKY_PLANETS } from '../src/core/solarsys.js';
import { jdFromMs, msFromJd } from '../src/core/time.js';

const jd = s => jdFromMs(Date.parse(s));
const day = j => new Date(msFromJd(j)).toISOString().slice(0, 10);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('solarsys: Mars at its January 2025 opposition, Jupiter at its January 2026 one', () => {
  const m = planetFromEarth('mars', jd('2025-01-16T02:00:00Z'));
  near(m.earth_au, 0.642, 0.01, 'Mars distance'); near(m.magnitude, -1.4, 0.2, 'Mars magnitude'); assert.ok(m.elongation > 170); near(m.size_arcsec, 14.6, 0.5, 'Mars size');
  near(m.light_min, 0.642 * 8.317, 0.1, 'light time');
  const j = planetFromEarth('jupiter', jd('2026-01-10T08:00:00Z'));
  near(j.earth_au, 4.21, 0.03, 'Jupiter distance'); near(j.magnitude, -2.7, 0.15, 'Jupiter magnitude'); near(j.size_arcsec, 46.8, 1.5, 'Jupiter size');
  assert.equal(j.lit > 0.999, true, 'full disc at opposition');
});

test('solarsys: Venus at greatest eastern elongation (10 January 2025): half lit, in the evening', () => {
  const v = planetFromEarth('venus', jd('2025-01-10T04:00:00Z'));
  near(v.elongation, 47.2, 0.3, 'elongation'); assert.equal(v.side, 'evening'); near(v.lit, 0.5, 0.05, 'phase'); near(v.magnitude, -4.4, 0.25, 'magnitude');
  assert.match(visibility(v), /^brilliant, in the evening sky/);
});

test('solarsys: Saturn\'s rings edge-on in March 2025, open again by late 2026', () => {
  const s = planetFromEarth('saturn', jd('2025-03-23T00:00:00Z'));
  near(s.ring_tilt, 0, 0.6, 'ring tilt at the crossing');
  const later = planetFromEarth('saturn', jd('2026-10-12T00:00:00Z'));
  assert.ok(Math.abs(later.ring_tilt) > 5 && Math.abs(later.ring_tilt) < 10, `${later.ring_tilt}`);
  assert.ok(magnitude('saturn', 9.5, 8.5, 0, 26) < magnitude('saturn', 9.5, 8.5, 0, 0) - 0.8, 'open rings make Saturn brighter');
  near(saturnRingTilt(0, 0, jd('2000-01-01T12:00:00Z')), saturnRingTilt(360, 0, jd('2000-01-01T12:00:00Z')), 1e-9, 'periodic in longitude');
});

test('solarsys: the next events land on the dates the almanacs gave', () => {
  const t0 = jd('2025-01-01T00:00:00Z');
  const mars = skyEvents('mars', t0, 400);
  assert.equal(mars[0].kind, 'opposition'); assert.equal(day(mars[0].jd), '2025-01-16');
  assert.equal(mars[1].kind, 'conjunction with the Sun'); assert.equal(day(mars[1].jd), '2026-01-09');
  const venus = skyEvents('venus', t0, 400).map(e => [e.kind, day(e.jd)]);
  assert.deepEqual(venus.slice(0, 3), [['greatest eastern elongation', '2025-01-10'], ['inferior conjunction', '2025-03-23'], ['greatest western elongation', '2025-06-01']]);
  const merc = skyEvents('mercury', t0, 120).map(e => e.kind);
  assert.deepEqual(merc.slice(0, 3), ['superior conjunction', 'greatest eastern elongation', 'inferior conjunction']);
  const jup = skyEvents('jupiter', t0, 400).map(e => [e.kind, day(e.jd)]);
  assert.deepEqual(jup, [['conjunction with the Sun', '2025-06-24'], ['opposition', '2026-01-10']]);
});

test('solarsys: visibility in words, every planet answerable, the Moon', () => {
  assert.deepEqual(SKY_PLANETS, ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
  for (const k of SKY_PLANETS) { const p = planetFromEarth(k, jd('2026-10-12T00:00:00Z')); assert.ok(Number.isFinite(p.magnitude) && p.earth_au > 0 && p.lit >= 0 && p.lit <= 1, k); }
  assert.match(visibility({ key: 'venus', elongation: 3, magnitude: -3.9, side: 'evening' }), /too close to the Sun/);
  assert.match(visibility({ key: 'neptune', elongation: 160, magnitude: 7.8, side: 'evening' }), /too faint for the eye/);
  assert.match(visibility({ key: 'saturn', elongation: 175, magnitude: 0.4, side: 'morning' }), /^bright, all night$/);
  assert.throws(() => planetFromEarth('pluto', 2451545), /unknown planet/);
  const moon = moonFromEarth(jd('2026-10-12T00:00:00Z'));
  assert.ok(moon.earth_km > 356000 && moon.earth_km < 407000, `${moon.earth_km}`); near(moon.light_s, moon.earth_km / 299792.458, 1e-9, 'light seconds'); assert.ok(moon.size_arcsec > 1750 && moon.size_arcsec < 2020);
});
