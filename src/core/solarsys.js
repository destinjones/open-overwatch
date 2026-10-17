// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The planets as seen from Earth, in numbers people use: how far (from the Sun and from us, and how long their light takes),
// how far from the Sun in our sky (elongation; evening or morning side), how much of the disc is lit, how bright (visual
// magnitude), and the next oppositions, conjunctions and greatest elongations. Built on core/planets.js (JPL's approximate
// elements, 1800-2050); a degree or so and a tenth of a magnitude, which is what "when and where to look" needs.
// Pure (test/solarsys.test.mjs); the MCP server's solar_system tool reads it.
import { DEG, AU_KM, C_KM_S } from './units.js';
import { planetPosition, earthPosition, moonGeocentric, PHYSICAL, PLANET_KEYS } from './planets.js';
import { julianCenturies } from './time.js';

/** The planets one can ask about (Earth excluded). */
export const SKY_PLANETS = Object.freeze(PLANET_KEYS.filter(k => k !== 'earth'));
const INNER = new Set(['mercury', 'venus']);
const LIGHT_MIN_PER_AU = AU_KM / C_KM_S / 60;

const len = v => Math.hypot(v.x, v.y, v.z);
const lonOf = v => ((Math.atan2(v.y, v.x) / DEG) + 360) % 360;
const latOf = v => Math.asin(v.z / len(v)) / DEG;
const angle = (cos) => Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;

/** Saturn's ring tilt toward Earth, degrees (Meeus ch. 45, ring plane of date; geocentric ecliptic longitude/latitude in degrees). */
export function saturnRingTilt(lam, beta, jd) {
  const T = julianCenturies(jd), i = (28.075216 - 0.012998 * T + 0.000004 * T * T) * DEG, node = (169.508470 + 1.394681 * T + 0.000412 * T * T) * DEG;
  const l = lam * DEG, b = beta * DEG;
  return Math.asin(Math.sin(i) * Math.cos(b) * Math.sin(l - node) - Math.cos(i) * Math.sin(b)) / DEG;
}

/**
 * dU (deg, 0-180): the difference of the Saturnicentric longitudes of the Sun and the Earth in the ring plane (Meeus ch. 45),
 * from Saturn's geocentric (lam, beta) and heliocentric (l0, b0) ecliptic longitude/latitude in degrees and its distance r (AU).
 */
export function saturnDeltaU(lam, beta, l0, b0, r, jd) {
  const T = julianCenturies(jd), i = (28.075216 - 0.012998 * T + 0.000004 * T * T) * DEG, node = (169.508470 + 1.394681 * T + 0.000412 * T * T) * DEG;
  const N = (113.6655 + 0.8771 * T) * DEG, l1 = (l0 - 0.01759 / r) * DEG, b1 = (b0 - 0.000764 * Math.cos(l0 * DEG - N) / r) * DEG;   // the Sun's aberration seen from Saturn
  const U = (l, b) => Math.atan2(Math.sin(i) * Math.sin(b) + Math.cos(i) * Math.cos(b) * Math.sin(l - node), Math.cos(b) * Math.cos(l - node));
  const d = Math.abs(U(l1, b1) - U(lam * DEG, beta * DEG)) / DEG % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Visual magnitude from the Sun distance r and Earth distance d (AU) and the phase angle i (deg): the Astronomical Almanac
 * formulas in Meeus (ch. 41); Saturn adds its rings (tilt B, deg) and its phase as dU (deg, saturnDeltaU).
 */
export function magnitude(key, r, d, i, B = 0, dU = 0) {
  const k = 5 * Math.log10(r * d);
  switch (key) {
    case 'mercury': return -0.42 + k + 0.0380 * i - 0.000273 * i * i + 0.000002 * i * i * i;
    case 'venus': return -4.40 + k + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i * i * i;
    case 'mars': return -1.52 + k + 0.016 * i;
    case 'jupiter': return -9.40 + k + 0.005 * i;
    case 'saturn': { const s = Math.sin(Math.abs(B) * DEG); return -8.88 + k + 0.044 * Math.abs(dU) - 2.60 * s + 1.25 * s * s; }
    case 'uranus': return -7.19 + k;
    case 'neptune': return -6.87 + k;
    default: return null;
  }
}

/**
 * A planet from Earth at jd: { key, name, sun_au, earth_au, earth_km, light_min, elongation (deg from the Sun), side
 * ('evening' | 'morning'), phase_angle, lit (0-1), magnitude, size_arcsec, lon / lat (geocentric ecliptic, deg), ring_tilt? }.
 */
export function planetFromEarth(key, jd) {
  if (!SKY_PLANETS.includes(key)) throw new Error('unknown planet ' + key);
  const p = planetPosition(key, jd), E = earthPosition(jd), g = { x: p.x - E.x, y: p.y - E.y, z: p.z - E.z };
  const r = len(p), d = len(g), R = len(E);
  const phase = angle((r * r + d * d - R * R) / (2 * r * d)), elong = angle((R * R + d * d - r * r) / (2 * R * d));
  const lam = lonOf(g), beta = latOf(g), sunLon = lonOf({ x: -E.x, y: -E.y, z: -E.z });
  const east = ((lam - sunLon + 360) % 360) < 180;   // east of the Sun: in the evening sky
  const B = key === 'saturn' ? saturnRingTilt(lam, beta, jd) : 0, dU = key === 'saturn' ? saturnDeltaU(lam, beta, lonOf(p), latOf(p), r, jd) : 0;
  const out = { key, name: PHYSICAL[key].name, sun_au: r, earth_au: d, earth_km: d * AU_KM, light_min: d * LIGHT_MIN_PER_AU, elongation: elong, side: east ? 'evening' : 'morning',
    phase_angle: phase, lit: (1 + Math.cos(phase * DEG)) / 2, magnitude: magnitude(key, r, d, phase, B, dU), size_arcsec: 2 * Math.atan(PHYSICAL[key].radiusKm / (d * AU_KM)) / DEG * 3600, lon: lam, lat: beta };
  if (key === 'saturn') out.ring_tilt = B;
  return out;
}

/** The Moon from Earth at jd: { name, earth_km, light_s, lon, lat, size_arcsec }. */
export function moonFromEarth(jd) {
  const m = moonGeocentric(jd), km = len(m) * AU_KM;
  return { name: 'Moon', earth_km: km, light_s: km / C_KM_S, lon: lonOf(m), lat: latOf(m), size_arcsec: 2 * Math.atan(PHYSICAL.moon.radiusKm / km) / DEG * 3600 };
}

/**
 * The planet's next sky events within `days` (from jd, a day at a time, then to the hour): outer planets' oppositions and
 * conjunctions, inner planets' greatest elongations (east: evening, west: morning) and inferior and superior conjunctions.
 * [{ jd, kind, elongation }], by time.
 */
export function skyEvents(key, jd, days = 800) {
  const el = t => planetFromEarth(key, t), out = [];
  const refine = (a, b, f, want) => {   // golden-section on the elongation, to about an hour
    const g = 0.381966; let x1 = a + g * (b - a), x2 = b - g * (b - a), f1 = f(x1), f2 = f(x2);
    while (b - a > 1 / 24) { if (want(f1, f2)) { b = x2; x2 = x1; f2 = f1; x1 = a + g * (b - a); f1 = f(x1); } else { a = x1; x1 = x2; f1 = f2; x2 = b - g * (b - a); f2 = f(x2); } }
    return (a + b) / 2;
  };
  const E = t => el(t).elongation;
  let prev2 = E(jd - 1), prev = E(jd);
  for (let i = 1; i <= days; i++) {
    const t = jd + i, cur = E(t), mid = t - 1;
    if (prev >= prev2 && prev > cur) {   // a peak of elongation
      const at = refine(mid - 1, t, E, (a, b) => a > b), p = el(at);
      if (!INNER.has(key)) out.push({ jd: at, kind: 'opposition', elongation: p.elongation });
      else out.push({ jd: at, kind: p.side === 'evening' ? 'greatest eastern elongation' : 'greatest western elongation', elongation: p.elongation });
    }
    if (prev <= prev2 && prev < cur) {   // a dip: the planet passes the Sun
      const at = refine(mid - 1, t, E, (a, b) => a < b), p = el(at);
      const kind = !INNER.has(key) ? 'conjunction with the Sun' : p.earth_au < 1 ? 'inferior conjunction' : 'superior conjunction';
      out.push({ jd: at, kind, elongation: p.elongation });
    }
    prev2 = prev; prev = cur;
  }
  return out;
}

/** How easy a planet is to see, in a phrase, from its elongation and brightness. */
export function visibility(p) {
  if (p.elongation < (p.key === 'mercury' ? 12 : p.key === 'venus' ? 8 : 15)) return 'too close to the Sun to see';
  if (p.magnitude > 6) return `too faint for the eye (magnitude ${p.magnitude.toFixed(1)}): binoculars or a telescope`;
  const when = p.elongation > 150 ? 'all night' : p.side === 'evening' ? 'in the evening sky after sunset' : 'in the morning sky before sunrise';
  const how = p.magnitude < -3 ? 'brilliant' : p.magnitude < -1 ? 'very bright' : p.magnitude < 1 ? 'bright' : p.magnitude < 4 ? 'easy to see' : 'faint (dark skies)';
  return `${how}, ${when}`;
}
