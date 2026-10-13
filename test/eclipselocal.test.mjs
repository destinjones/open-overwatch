// Solar eclipses on the ground (src/core/eclipselocal.js) against NASA's published circumstances (Espenak & Meeus,
// eclipse.gsfc.nasa.gov) for the eclipses in data/eclipses.json, and the Earth-fixed rotation it rests on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { icrfToFixed, greatestEclipse, localEclipse, ecef, geodetic } from '../src/core/eclipselocal.js';

const DATA = JSON.parse(readFileSync(new URL('../data/eclipses.json', import.meta.url), 'utf8')).eclipses;
const ecl = date => structuredClone(DATA.find(e => e.date === date));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const hhmm = ms => new Date(ms).toISOString().slice(11, 16);

test('eclipselocal: the ICRF -> Earth-fixed rotation is a rotation, and turns with the Earth', () => {
  const M = icrfToFixed(2461620.0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(M[i].reduce((s, _, k) => s + M[i][k] * M[j][k], 0), i === j ? 1 : 0, 1e-12, `orthonormal ${i}${j}`);
  const z = [0, 0, 1], a = M.map(r => r[0] * z[0] + r[1] * z[1] + r[2] * z[2]);
  assert.ok(a[2] > 0.99999, 'the pole stays near the pole (precession moves it by a third of a degree since 2000)');
  const M2 = icrfToFixed(2461620.0 + 0.99726957);
  const p1 = M.map(r => r[0]), p2 = M2.map(r => r[0]); near(Math.acos(p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2]) * 180 / Math.PI, 0, 0.01, 'one sidereal day: back where it was');
});

test('eclipselocal: places on the ellipsoid and back', () => {
  for (const [lat, lon] of [[0, 0], [51.5, -0.13], [-33.9, 151.2], [89.9, 10], [25.5, 33.2]]) { const g = geodetic(ecef(lat, lon)); near(g.lat, lat, 1e-9, 'lat'); near(g.lon, lon, 1e-9, 'lon'); }
  near(Math.hypot(...Object.values(ecef(0, 0))), 6378.137, 1e-9, 'equator radius'); near(ecef(90, 0).z, 6356.7523, 1e-3, 'pole');
});

test('eclipselocal: 2 August 2027, greatest eclipse over Egypt as NASA gives it', () => {
  const g = greatestEclipse(ecl('2027-08-02'));
  assert.equal(g.kind, 'total'); assert.equal(hhmm(g.at), '10:06');   // NASA: 10:07:50 TD = 10:06:40 UT
  near(g.lat, 25.52, 0.1, 'latitude (25°31\'N)'); near(g.lon, 33.13, 0.1, 'longitude (33°08\'E)');
  near(g.duration_s, 383, 8, 'duration (6 min 23 s)'); near(g.width_km, 258, 5, 'path width'); near(g.sun_alt, 82, 1, 'Sun altitude');
});

test('eclipselocal: what Luxor, Madrid and London see on 2 August 2027', () => {
  const e = ecl('2027-08-02');
  const lux = localEclipse(e, 25.687, 32.639);
  assert.equal(lux.kind, 'total'); assert.ok(lux.central_s > 360 && lux.central_s < 400, `${lux.central_s}`); assert.equal(lux.covered, 1);
  assert.ok(lux.start < lux.max && lux.max < lux.end); near((lux.end - lux.start) / 60e3, 166, 6, 'about two and three-quarter hours');
  const mad = localEclipse(e, 40.4168, -3.7038);
  assert.equal(mad.kind, 'partial'); near(mad.magnitude, 0.88, 0.03, 'Madrid magnitude'); assert.equal(mad.central_s, 0);
  const lon = localEclipse(e, 51.5074, -0.1278);
  assert.equal(lon.kind, 'partial'); assert.ok(lon.covered > 0.3 && lon.covered < 0.55, `${lon.covered}`); assert.equal(lon.rises_eclipsed, false);
  assert.equal(localEclipse(e, 30.27, -97.74), null, 'Austin: night there');
});

test('eclipselocal: the annular eclipse of 26 January 2028 sets annular over Seville; partial eclipses peak on the polar ground', () => {
  const s = localEclipse(ecl('2028-01-26'), 37.389, -5.984);
  assert.equal(s.kind, 'annular'); assert.ok(s.central_s > 300, `${s.central_s}`); assert.ok(s.sun_alt < 12); assert.equal(s.sets_eclipsed, true, 'the Sun sets before the Moon leaves it');
  const p = greatestEclipse(ecl('2029-01-14'));
  assert.equal(p.kind, null); near(p.lat, 63.7, 0.4, 'latitude'); near(p.lon, -114.2, 0.4, 'longitude'); near(p.magnitude, 0.871, 0.005, 'NASA magnitude 0.871');
  near(greatestEclipse(ecl('2029-06-12')).magnitude, 0.458, 0.005, 'NASA magnitude 0.458');
});
