import test from 'node:test';
import assert from 'node:assert/strict';
import { target, azimuth, ascentProfile, sample, travel, eventAt } from '../src/core/ascent.js';

test('launch azimuths match the textbook cases', () => {
  assert.ok(Math.abs(azimuth(51.6, 28.5) - 44.9) < 0.5);    // ISS from Cape Canaveral: about 45 deg (north-east)
  assert.ok(Math.abs(azimuth(28.5, 28.5) - 90) < 0.5);      // due east at the pad's own latitude
  assert.equal(azimuth(10, 28.5), 90);                      // below the pad latitude: due east (a plane change comes later)
  const sso = azimuth(97.5, 34.63);                         // Vandenberg to sun-synchronous: south, a little west
  assert.ok(sso > 185 && sso < 195, String(sso));
  assert.ok(Math.abs(azimuth(90, 34.6) - 180) < 1e-9);      // polar: due south
});

test('orbit names map to targets', () => {
  assert.equal(target('Low Earth Orbit', 'Crew-12', 28.5).incl, 51.6);
  assert.equal(target('LEO', 'Starlink Group 10-5', 28.5).incl, 53);
  assert.equal(target('SSO', '', 34.6).incl, 97.5);
  assert.equal(target('GTO', '', 28.5).incl, 28.5);
  assert.equal(target('Sub', '', 31.4).sub, true);
});

test('the reconstructed climb is monotonic and ends in orbit', () => {
  const p = ascentProfile({ lat: 28.5, lon: -80.6, orbit: 'LEO', mission: 'Crew-12' });
  let prev = sample(p, 0);
  assert.ok(prev.altKm === 0 && prev.downrangeKm === 0);
  for (let t = 20; t <= p.tOrbit; t += 20) { const s = sample(p, t); assert.ok(s.altKm >= prev.altKm && s.downrangeKm >= prev.downrangeKm, 't=' + t); prev = s; }
  const end = sample(p, p.tOrbit);
  assert.ok(Math.abs(end.altKm - p.alt) < 1e-6 && end.speedKms > 6 && end.speedKms < 9, JSON.stringify(end));
  assert.ok(end.lat > 28.5 && end.lon > -80.6);            // north-east of the Cape
  assert.equal(eventAt(100), 'Max Q (approx.)'); assert.equal(eventAt(600), 'Orbit reached (approx.)');
});

test('great-circle travel', () => {
  const [la, lo] = travel(0, 0, 90, 6371.0088 * Math.PI / 2); assert.ok(Math.abs(la) < 1e-9 && Math.abs(lo - 90) < 1e-9);
  const [la2] = travel(0, 0, 0, 6371.0088 * Math.PI / 4); assert.ok(Math.abs(la2 - 45) < 1e-9);
});

test('Vandenberg always flies south', () => {
  const p = ascentProfile({ lat: 34.632, lon: -120.611, orbit: 'LEO', mission: 'Starlink Group 15-25' });
  assert.ok(p.az > 90 && p.az < 270, String(p.az));
  assert.equal(eventAt(30), 'Pitching over, downrange');
});
