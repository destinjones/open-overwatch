// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Solar eclipses on the ground without Cesium: JPL Horizons' Earth-centred ICRF Sun and Moon (data/eclipses.json) turned
// Earth-fixed with IAU 1976 precession, the main nutation terms and apparent sidereal time (to ~1 km on the ground:
// polar motion and UT1-UTC left out), then core/eclipse.js's cones. Gives each eclipse's greatest point and its central
// duration, and what a place sees: when it starts, peaks and ends there, and how much of the Sun is covered.
// Pure (test/eclipselocal.test.mjs); the MCP server's eclipses tool uses it.
import { shadowCenter, seenFrom, interp, WGS84 } from './eclipse.js';

const AS = Math.PI / (180 * 3600), D2R = Math.PI / 180;
const mul = (A, B) => A.map((r, i) => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const apply = (M, [x, y, z]) => [M[0][0] * x + M[0][1] * y + M[0][2] * z, M[1][0] * x + M[1][1] * y + M[1][2] * z, M[2][0] * x + M[2][1] * y + M[2][2] * z];
const R1 = a => [[1, 0, 0], [0, Math.cos(a), Math.sin(a)], [0, -Math.sin(a), Math.cos(a)]];
const R2 = a => [[Math.cos(a), 0, -Math.sin(a)], [0, 1, 0], [Math.sin(a), 0, Math.cos(a)]];
const R3 = a => [[Math.cos(a), Math.sin(a), 0], [-Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

/** The rotation from ICRF (GCRS) to Earth-fixed axes at a UT Julian date: R3(GAST) · N · P (frame bias, polar motion ignored). */
export function icrfToFixed(jd) {
  const T = (jd - 2451545) / 36525;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * AS, z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * AS;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * AS;
  const P = mul(R3(-z), mul(R2(theta), R3(-zeta)));
  const om = (125.04452 - 1934.136261 * T) * D2R, L = (280.4665 + 36000.7698 * T) * D2R, Lm = (218.3165 + 481267.8813 * T) * D2R;
  const dpsi = (-17.20 * Math.sin(om) - 1.32 * Math.sin(2 * L) - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * om)) * AS;
  const deps = (9.20 * Math.cos(om) + 0.57 * Math.cos(2 * L) + 0.10 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * om)) * AS;
  const eps = (23.43929111 - 0.0130041667 * T - 1.6389e-7 * T * T + 5.0361e-7 * T ** 3) * D2R;
  const N = mul(R1(-(eps + deps)), mul(R3(-dpsi), R1(eps)));
  const gmst = (280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - T ** 3 / 38710000) * D2R;
  return mul(R3(gmst + dpsi * Math.cos(eps)), mul(N, P));
}

/** An eclipse record's minute tables turned Earth-fixed: adds e.fixed = { sun, moon } (rows of [x, y, z] km) and e.at(m). */
export function prepareEclipse(e) {
  if (e.fixed) return e;
  const step = (e.step_s || 60) / 86400, sun = [], moon = [];
  for (let i = 0; i < e.sun.length; i++) { const M = icrfToFixed(e.jd0 + i * step); sun.push(apply(M, e.sun[i])); moon.push(apply(M, e.moon[i])); }
  e.fixed = { sun, moon };
  e.at = m => ({ sun: interp(sun, m), moon: interp(moon, m) });
  return e;
}

/** Earth-fixed km of a place (geodetic degrees, height km). */
export function ecef(lat, lon, h = 0) {
  const a = WGS84.a, b = WGS84.b, e2 = 1 - (b * b) / (a * a), f = lat * D2R, l = lon * D2R, N = a / Math.sqrt(1 - e2 * Math.sin(f) ** 2);
  return { x: (N + h) * Math.cos(f) * Math.cos(l), y: (N + h) * Math.cos(f) * Math.sin(l), z: (N * (1 - e2) + h) * Math.sin(f) };
}
/** Geodetic latitude/longitude (degrees) of an Earth-fixed point (km), by Bowring's method. */
export function geodetic(p) {
  const a = WGS84.a, b = WGS84.b, e2 = 1 - (b * b) / (a * a), ep2 = (a * a) / (b * b) - 1, r = Math.hypot(p.x, p.y);
  const t = Math.atan2(p.z * a, r * b), lat = Math.atan2(p.z + ep2 * b * Math.sin(t) ** 3, r - e2 * a * Math.cos(t) ** 3);
  return { lat: lat / D2R, lon: Math.atan2(p.y, p.x) / D2R };
}
/** The Sun's altitude (degrees) over the ellipsoid's horizon at an Earth-fixed place. */
function sunAltitude(sun, obs, lat, lon) {
  const up = { x: Math.cos(lat * D2R) * Math.cos(lon * D2R), y: Math.cos(lat * D2R) * Math.sin(lon * D2R), z: Math.sin(lat * D2R) };
  const s = { x: sun.x - obs.x, y: sun.y - obs.y, z: sun.z - obs.z }, d = Math.hypot(s.x, s.y, s.z);
  return Math.asin((s.x * up.x + s.y * up.y + s.z * up.z) / d) / D2R;
}

const msOf = (e, m) => (e.jd0 - 2440587.5) * 864e5 + m * (e.step_s || 60) * 1000;

/**
 * Greatest eclipse (the shadow axis closest to Earth's centre): { at (ms), lat, lon (where the axis meets the Earth, or for a
 * partial eclipse the ground under its closest pass), kind ('total' | 'annular' | null: partial), duration_s (of the central
 * phase there), width_km, sun_alt, magnitude (partial eclipses: the fraction of the Sun's diameter covered there) }.
 */
export function greatestEclipse(e) {
  prepareEclipse(e);
  const n = e.fixed.sun.length; let best = null;
  for (let m = 0; m <= n - 1; m += 1 / 6) { const { sun, moon } = e.at(m), s = shadowCenter(sun, moon); if (!best || s.miss < best.s.miss) best = { m, s }; }
  for (let h = 1 / 12; h > 1 / 3600; h /= 2) for (const m of [best.m - h, best.m + h]) { if (m < 0 || m > n - 1) continue; const { sun, moon } = e.at(m), s = shadowCenter(sun, moon); if (s.miss < best.s.miss) best = { m, s }; }
  const out = { at: msOf(e, best.m), m: best.m, kind: best.s.kind, lat: null, lon: null, duration_s: null, width_km: null, sun_alt: null, magnitude: null };
  if (!best.s.center) {   // a partial eclipse: the axis misses, and the deepest eclipse is on the ground right under its closest pass
    const { sun, moon } = e.at(best.m), ax = best.s.cones.axis, t = -(moon.x * ax.x + moon.y * ax.y + moon.z * ax.z);
    const p = { x: moon.x + ax.x * t, y: moon.y + ax.y * t, z: moon.z + ax.z * t }, g = geodetic(p), obs = ecef(g.lat, g.lon), w = seenFrom(sun, moon, obs);
    Object.assign(out, { lat: g.lat, lon: g.lon, magnitude: (w.rs + w.rm - w.sep) / (2 * w.rs), sun_alt: sunAltitude(sun, obs, g.lat, g.lon) });
  } else {
    const g = geodetic(best.s.center), obs = best.s.center;
    let first = null, last = null;
    for (let m = best.m - 12; m <= best.m + 12; m += 1 / 60) { const { sun, moon } = e.at(m), w = seenFrom(sun, moon, obs); if (w.kind === 'total' || w.kind === 'annular') { if (first == null) first = m; last = m; } }
    Object.assign(out, { lat: g.lat, lon: g.lon, duration_s: first == null ? 0 : Math.round((last - first) * 60) + 1, width_km: 2 * Math.abs(best.s.umbra), sun_alt: sunAltitude(e.at(best.m).sun, obs, g.lat, g.lon) });
  }
  return out;
}

/**
 * What a place sees: null if the Moon never covers any of the Sun there while it is up; else { start, max, end (ms: first
 * and last contact, or sunrise / sunset when rises_eclipsed / sets_eclipsed), covered (0-1, of the Sun's disc, at max), magnitude (of its diameter),
 * kind at max ('partial' | 'total' | 'annular'), central_s (seconds of totality or annularity), sun_alt (deg at max) }.
 */
export function localEclipse(e, lat, lon, h = 0) {
  prepareEclipse(e);
  const obs = ecef(lat, lon, h), n = e.fixed.sun.length;
  const look = m => { const { sun, moon } = e.at(m), w = seenFrom(sun, moon, obs), alt = sunAltitude(sun, obs, lat, lon); return { ...w, alt, on: w.covered > 0 && alt > -0.833 }; };
  let first = null, last = null, best = null;
  for (let m = 0; m <= n - 1; m += 1) { const w = look(m); if (w.on) { if (first == null) first = m; last = m; if (!best || w.covered > best.covered) best = { m, ...w }; } }
  if (best == null) return null;
  const edge = (a, b, inside) => { for (let k = 0; k < 14; k++) { const mid = (a + b) / 2; if (look(mid).on === inside) a = mid; else b = mid; } return (a + b) / 2; };
  const before = first > 0 ? look(first - 1) : null, after = last < n - 1 ? look(last + 1) : null;
  const start = before ? edge(first, first - 1, true) : null, end = after ? edge(last, last + 1, true) : null;   // first and last contact, or sunrise and sunset
  for (let h2 = 0.5; h2 > 1 / 3600; h2 /= 2) for (const m of [best.m - h2, best.m + h2]) { if (m < 0 || m > n - 1) continue; const w = look(m); if (w.on && w.covered > best.covered) best = { m, ...w }; }
  let central = 0;
  if (best.kind === 'total' || best.kind === 'annular') for (let m = best.m - 8; m <= best.m + 8; m += 1 / 60) { const w = look(m); if (w.kind === best.kind) central++; }
  return { start: start == null ? null : msOf(e, start), max: msOf(e, best.m), end: end == null ? null : msOf(e, end), covered: best.covered, magnitude: (best.rs + best.rm - best.sep) / (2 * best.rs),
    kind: best.kind, central_s: central, sun_alt: best.alt, rises_eclipsed: !!before && before.covered > 0, sets_eclipsed: !!after && after.covered > 0 };
}
