// Eclipses and lunar occultations, found from Earth-centred ephemerides of the Sun and the Moon (data/solar/ephem.json:
// JPL Horizons, apparent, ecliptic J2000 axes, km, fitted as Chebyshev series by brand/tools/make_ephem.py; times are
// Julian Dates in UT). The view's own Moon formula (planets.js) is ~0.3 degrees off, which is half the Moon's width:
// fine for drawing, not for saying whether the Moon covers a star.
//
// - Solar eclipses: at each new Moon the Moon's shadow axis passes closest to Earth's centre (gamma, in Earth radii);
//   the cones and where they meet the ground are core/eclipse.js's, the Earth-fixed turn core/eclipselocal.js's.
// - Lunar eclipses: at each full Moon the Moon passes closest to the axis of Earth's shadow. Shadow radii by Danjon's
//   rule (Earth's radius enlarged by 1/85 for the atmosphere), as in the Five Millennium Canon; umbral and penumbral
//   magnitudes and the six contacts.
// - Lunar occultations: a star (or planet) is hidden somewhere on Earth when the Moon's "shadow" cast by that star, a
//   cylinder for a star, touches the Earth: the Moon passes within R_earth + R_moon of the line from Earth's centre
//   toward it. Planets are placed with core/planets.js (arcminute errors: a grazing occultation may come or go).
// DOM-free; checked against Horizons and NASA's canon in test/syzygy.test.mjs.

import { R_SUN, R_MOON, WGS84, shadowCenter, seenFrom } from './eclipse.js';
import { icrfToFixed, geodetic } from './eclipselocal.js';
import { eclToEq, radecToEcl, AU_KM, C_AU_DAY } from './units.js';
import { planetPosition, earthPosition, PHYSICAL } from './planets.js';

export const R_EARTH = WGS84.a;
/** Danjon's enlargement of Earth's shadow for the atmosphere (Five Millennium Canon of Lunar Eclipses). */
export const DANJON = 1 + 1 / 85;
// Earth's radius for the shadow: equatorial radius at latitude 45 deg (the shadow's edge is an average of the limb)
const R_SHADOW = R_EARTH * 0.998340;

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z, len = a => Math.sqrt(dot(a, a));
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b)))));

// ---------------------------------------------------------------- the ephemeris

/** One Chebyshev series { t0, seg_days, deg, segs: [[cx[], cy[], cz[]], ...] } at jd (Clenshaw), into out. */
export function chebEval(ser, jd, out = {}) {
  const k = Math.min(Math.max(Math.floor((jd - ser.t0) / ser.seg_days), 0), ser.segs.length - 1);
  const t = 2 * (jd - ser.t0 - k * ser.seg_days) / ser.seg_days - 1, t2 = 2 * t, seg = ser.segs[k];
  const v = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const co = seg[c]; let b1 = 0, b2 = 0;
    for (let j = co.length - 1; j >= 1; j--) { const b = t2 * b1 - b2 + co[j]; b2 = b1; b1 = b; }
    v[c] = t * b1 - b2 + co[0];
  }
  out.x = v[0]; out.y = v[1]; out.z = v[2];
  return out;
}

/** The ephemeris file -> { range: [jd0, jd1], has(jd), moon(jd, out), sun(jd, out) } (geocentric, ecliptic J2000, km). */
export function createEphemeris(data) {
  const [a, b] = data.range;
  return { range: [a, b], has: jd => jd >= a && jd <= b, moon: (jd, out = {}) => chebEval(data.moon, jd, out), sun: (jd, out = {}) => chebEval(data.sun, jd, out) };
}

// ---------------------------------------------------------------- small searches

/** Minimum of f on [a, b] by golden section (f unimodal there): { t, f }. */
export function minimize(f, a, b, tol = 1e-6) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  while (b - a > tol) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  const t = (a + b) / 2; return { t, f: f(t) };
}
/** A root of f between a and b (f(a), f(b) of opposite signs) by bisection, to tol days. */
export function root(f, a, b, tol = 1 / 86400) {
  let fa = f(a);
  for (let i = 0; i < 60 && b - a > tol; i++) { const m = (a + b) / 2, fm = f(m); if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m; }
  return (a + b) / 2;
}

const wrapPi = x => x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI));
/** Moon's ecliptic longitude minus the Sun's (geocentric, radians, -pi..pi). 0 = new Moon, +-pi = full Moon. */
export function elongationLon(eph, jd) {
  const m = eph.moon(jd), s = eph.sun(jd);
  return wrapPi(Math.atan2(m.y, m.x) - Math.atan2(s.y, s.x));
}

/** New and full Moons between jd0 and jd1: [{ jd, phase: 'new' | 'full' }], in time order. */
export function lunations(eph, jd0, jd1) {
  const out = [], step = 1;
  const fNew = t => elongationLon(eph, t), fFull = t => wrapPi(elongationLon(eph, t) - Math.PI);
  for (let t = jd0; t < jd1; t += step) {
    const t1 = Math.min(t + step, jd1);
    for (const [phase, f] of [['new', fNew], ['full', fFull]]) {
      const a = f(t), b = f(t1);
      if (a < 0 && b >= 0 && b - a < Math.PI) out.push({ jd: root(f, t, t1, 1e-6), phase });
    }
  }
  return out.sort((x, y) => x.jd - y.jd);
}

// ---------------------------------------------------------------- lunar eclipses

/**
 * Earth's shadow at the Moon at one instant: { sigma (Moon's centre from the shadow axis), rhoU, rhoP (umbra and
 * penumbra radii), sM (Moon's radius), all angles in radians as seen from Earth's centre; umbral, penumbral magnitudes }.
 */
export function earthShadow(sun, moon) {
  const dM = len(moon), dS = len(sun);
  const piM = Math.asin(R_SHADOW / dM), piS = Math.asin(R_SHADOW / dS), sS = Math.asin(R_SUN / dS), sM = Math.asin(R_MOON / dM);
  const rhoU = DANJON * (piM + piS) - sS, rhoP = DANJON * (piM + piS) + sS;
  const sigma = angle(moon, { x: -sun.x, y: -sun.y, z: -sun.z });
  return { sigma, rhoU, rhoP, sM, umbral: (rhoU + sM - sigma) / (2 * sM), penumbral: (rhoP + sM - sigma) / (2 * sM) };
}

/**
 * The lunar eclipse at a full Moon, or null: { kind: 'total' | 'partial' | 'penumbral', jd (greatest), umbral,
 * penumbral (magnitudes), gamma (Moon's closest pass from the shadow axis, Earth radii; + north of it), contacts:
 * { P1, U1, U2, U3, U4, P4 } (jd or null), durations (minutes): { penumbral, partial, total }, sub: { lat, lon }
 * (where the Moon is overhead at greatest: the middle of the half of Earth that sees it) }.
 */
export function lunarEclipse(eph, jdFull) {
  const at = t => earthShadow(eph.sun(t), eph.moon(t));
  const g = minimize(t => at(t).sigma, jdFull - 0.25, jdFull + 0.25, 1e-7), s = at(g.t);
  if (s.penumbral <= 0) return null;
  const kind = s.umbral >= 1 ? 'total' : s.umbral > 0 ? 'partial' : 'penumbral';
  const edge = (lim, before) => {   // when sigma crosses lim on one side of greatest
    const f = t => at(t).sigma - lim(at(t)), a = before ? g.t - 0.3 : g.t, b = before ? g.t : g.t + 0.3;
    return f(g.t) < 0 ? root(f, a, b) : null;
  };
  const P = x => x.rhoP + x.sM, U = x => x.rhoU + x.sM, T = x => x.rhoU - x.sM;
  const contacts = { P1: edge(P, true), U1: edge(U, true), U2: edge(T, true), U3: edge(T, false), U4: edge(U, false), P4: edge(P, false) };
  const mins = (a, b) => a != null && b != null ? Math.round((b - a) * 1440 * 10) / 10 : null;
  const moon = eph.moon(g.t), sun = eph.sun(g.t);
  const anti = { x: -sun.x, y: -sun.y, z: -sun.z }, dA = len(anti), dM = len(moon);
  // signed closest pass: + when the Moon passes north (of the equator's direction) of the shadow axis
  const ax = { x: anti.x / dA, y: anti.y / dA, z: anti.z / dA }, along = dot(moon, ax);
  const off = { x: moon.x - ax.x * along, y: moon.y - ax.y * along, z: moon.z - ax.z * along }, offEq = eclToEq(off.x, off.y, off.z);
  return {
    kind, jd: g.t, umbral: s.umbral, penumbral: s.penumbral, gamma: Math.sign(offEq.z || 1) * len(off) / R_EARTH,
    contacts, durations: { penumbral: mins(contacts.P1, contacts.P4), partial: mins(contacts.U1, contacts.U4), total: mins(contacts.U2, contacts.U3) },
    sub: subPoint(moon, g.t), distanceKm: dM,
  };
}

// ---------------------------------------------------------------- solar eclipses

/** Ecliptic J2000 km -> Earth-fixed km at jd (UT). */
export function toFixed(p, jd) {
  const q = eclToEq(p.x, p.y, p.z), M = icrfToFixed(jd);
  return { x: M[0][0] * q.x + M[0][1] * q.y + M[0][2] * q.z, y: M[1][0] * q.x + M[1][1] * q.y + M[1][2] * q.z, z: M[2][0] * q.x + M[2][1] * q.y + M[2][2] * q.z };
}
/** The ground point (lat, lon degrees) under a geocentric direction at jd. */
export function subPoint(p, jd) { const f = toFixed(p, jd), r = len(f), g = geodetic({ x: f.x / r * R_EARTH, y: f.y / r * R_EARTH, z: f.z / r * WGS84.b }); return { lat: g.lat, lon: g.lon }; }

/**
 * The solar eclipse at a new Moon, or null: { kind: 'total' | 'annular' | 'hybrid' | 'partial', jd (greatest: the
 * shadow axis closest to Earth's centre), gamma (that distance in Earth radii, + north), magnitude (at the greatest point:
 * the fraction of the Sun's diameter covered), at: { lat, lon } (where the axis meets the ground, or the ground
 * under its closest pass), width_km (of the central path there), contacts: { P1, P4 } (penumbra first and last touches
 * the Earth) }. Earth-fixed geometry on the WGS84 ellipsoid.
 */
export function solarEclipse(eph, jdNew) {
  const at = t => { const sun = toFixed(eph.sun(t), t), moon = toFixed(eph.moon(t), t); return { sun, moon, s: shadowCenter(sun, moon) }; };
  const g = minimize(t => at(t).s.miss, jdNew - 0.25, jdNew + 0.25, 1e-7), A = at(g.t), s = A.s;
  // the penumbra's edge vs Earth: touches when the axis passes within R_earth + penumbra radius (sphere, slightly generous)
  const reach = x => x.s.miss - (R_EARTH + x.s.penumbra);
  if (reach(A) > 0) return null;
  const ax = s.cones.axis, t0 = -dot(A.moon, ax), near = { x: A.moon.x + ax.x * t0, y: A.moon.y + ax.y * t0, z: A.moon.z + ax.z * t0 };
  const gamma = Math.sign(near.z || 1) * s.miss / R_EARTH;
  let kind = 'partial', place, width = null, magnitude;
  if (s.center) {
    place = geodetic(s.center); width = 2 * Math.abs(s.umbra);
    kind = s.kind;
    // hybrid: the shadow tip reaches the ground at mid-path and falls short near its ends (or the other way round)
    const kinds = new Set([s.kind]);
    for (const dt of [-1.2, -0.8, -0.4, 0.4, 0.8, 1.2]) { const x = at(g.t + dt / 24).s; if (x.center) kinds.add(x.kind); }
    if (kinds.size > 1) kind = 'hybrid';
    const w = seenFrom(A.sun, A.moon, s.center); magnitude = w.rm / w.rs;   // central: NASA's magnitude is the Moon's diameter over the Sun's
  } else {
    const r = len(near), obs = { x: near.x / r * R_EARTH, y: near.y / r * R_EARTH, z: near.z / r * WGS84.b };
    place = geodetic(obs);
    const w = seenFrom(A.sun, A.moon, obs); magnitude = (w.rs + w.rm - w.sep) / (2 * w.rs);
    if (w.kind === 'total' || w.kind === 'annular') kind = w.kind;   // non-central: only the shadow's edge grazes a pole
  }
  const P1 = root(t => -reach(at(t)), g.t - 0.25, g.t), P4 = root(t => reach(at(t)), g.t, g.t + 0.25);
  return { kind, jd: g.t, gamma, magnitude, at: { lat: place.lat, lon: place.lon }, width_km: width, contacts: { P1, P4 }, central: !!s.center };
}

/** Every solar and lunar eclipse between jd0 and jd1 (inside the ephemeris): [{ type: 'solar' | 'lunar', ...details }]. */
export function findEclipses(eph, jd0 = eph.range[0], jd1 = eph.range[1]) {
  const a = Math.max(jd0, eph.range[0] + 0.5), b = Math.min(jd1, eph.range[1] - 0.5), out = [];
  for (const l of lunations(eph, a, b)) {
    const e = l.phase === 'new' ? solarEclipse(eph, l.jd) : lunarEclipse(eph, l.jd);
    if (e) out.push({ type: l.phase === 'new' ? 'solar' : 'lunar', ...e });
  }
  return out;
}

// ---------------------------------------------------------------- lunar occultations

/** Bright stars the Moon can cover (within ~6.6 deg of the ecliptic): J2000 RA/Dec (deg), V magnitude. */
export const OCCULT_STARS = Object.freeze([
  { key: 'aldebaran', name: 'Aldebaran', ra: 68.98016, dec: 16.50930, mag: 0.86, con: 'Taurus' },
  { key: 'regulus', name: 'Regulus', ra: 152.09296, dec: 11.96721, mag: 1.36, con: 'Leo' },
  { key: 'spica', name: 'Spica', ra: 201.29825, dec: -11.16132, mag: 0.97, con: 'Virgo' },
  { key: 'antares', name: 'Antares', ra: 247.35192, dec: -26.43200, mag: 1.06, con: 'Scorpius' },
  { key: 'pleiades', name: 'the Pleiades (Alcyone)', ra: 56.87115, dec: 24.10514, mag: 2.87, con: 'Taurus', cluster: true },
]);
/** Planets checked for occultations. */
export const OCCULT_PLANETS = Object.freeze(['mercury', 'venus', 'mars', 'jupiter', 'saturn']);

const STAR_DIR = new Map();
function starDir(s) { let d = STAR_DIR.get(s.key); if (!d) { d = radecToEcl(s.ra, s.dec); STAR_DIR.set(s.key, d); } return d; }

/** Geocentric position of a planet at jd (km, ecliptic J2000), corrected for light time. */
export function planetGeocentric(key, jd, out = {}) {
  const E = earthPosition(jd), p = {};
  let lt = 0;
  for (let i = 0; i < 2; i++) { planetPosition(key, jd - lt, p); lt = Math.hypot(p.x - E.x, p.y - E.y, p.z - E.z) / C_AU_DAY; }
  out.x = (p.x - E.x) * AU_KM; out.y = (p.y - E.y) * AU_KM; out.z = (p.z - E.z) * AU_KM;
  return out;
}

/**
 * The Moon's cylinder toward a target at one instant: { d (km, Moon's centre from the line Earth-target), ahead (Moon
 * on the target's side of Earth), limit (km: R_earth + R_moon + the target's own radius scaled to the Moon), sep (rad) }.
 */
export function occultationGeometry(moon, target, targetRadiusKm = 0) {
  const r = len(target), u = { x: target.x / r, y: target.y / r, z: target.z / r }, along = dot(moon, u);
  const off = { x: moon.x - u.x * along, y: moon.y - u.y * along, z: moon.z - u.z * along };
  const scaled = targetRadiusKm && r < 1e12 ? targetRadiusKm * along / r : 0;
  return { d: len(off), ahead: along > 0, limit: R_EARTH + R_MOON + scaled, sep: angle(moon, target), u, along };
}

/**
 * Lunar occultations of the bright stars and planets between jd0 and jd1: [{ target, name, kind: 'star' | 'planet',
 * jd (closest), impact (Moon's centre from the line, in Earth radii; under ~1.27 the target is covered somewhere),
 * central (the line through the Moon's centre meets the Earth), at: { lat, lon } (where the Moon passes centrally over
 * it, or the ground nearest the line), dark (the Sun below -6 deg there), sunAlt (deg), elongation (Moon from the Sun,
 * deg), mag }], in time order. Steps of 3 h, then a golden-section minimum.
 */
export function findOccultations(eph, jd0 = eph.range[0], jd1 = eph.range[1], { stars = OCCULT_STARS, planets = OCCULT_PLANETS, step = 0.125 } = {}) {
  const a = Math.max(jd0, eph.range[0]), b = Math.min(jd1, eph.range[1]), out = [];
  const targets = [...stars.map(s => ({ key: s.key, name: s.name, kind: 'star', mag: s.mag, cluster: !!s.cluster, pos: () => { const d = starDir(s); return { x: d.x * 1e15, y: d.y * 1e15, z: d.z * 1e15 }; }, radius: 0 })),
    ...planets.map(k => ({ key: k, name: k[0].toUpperCase() + k.slice(1), kind: 'planet', mag: null, pos: t => planetGeocentric(k, t), radius: PHYSICAL[k]?.radiusKm || 0 }))];
  const near = 4 * Math.PI / 180;   // the Moon moves ~1.6 deg in 3 h against the stars: closer than this, look closely
  for (const T of targets) {
    let prev = Infinity, prevT = a, falling = false;
    for (let t = a; t <= b; t += step) {
      const sep = angle(eph.moon(t), T.pos(t));
      if (sep > prev && falling && prev < near) {   // passed a minimum of separation between prevT - step and t
        const geo = x => occultationGeometry(eph.moon(x), T.pos(x), T.radius);
        const m = minimize(x => geo(x).d + (geo(x).ahead ? 0 : 1e9), Math.max(a, prevT - step), t, 1e-6), G = geo(m.t);
        if (G.ahead && G.d < G.limit) out.push(describeOccultation(eph, T, m.t, G));
      }
      falling = sep < prev; prev = sep; prevT = t;
    }
  }
  return out.sort((x, y) => x.jd - y.jd);
}

function describeOccultation(eph, T, jd, G) {
  const moon = eph.moon(jd), sun = eph.sun(jd);
  // the line through the Moon's centre toward the target, back to Earth: where it meets the ground (central), or
  // the point of the ground closest to it
  const ax = { x: -G.u.x, y: -G.u.y, z: -G.u.z }, foot = { x: moon.x - G.u.x * G.along, y: moon.y - G.u.y * G.along, z: moon.z - G.u.z * G.along };
  let ground = foot;
  const c = G.d < R_EARTH;
  if (c) { const h = Math.sqrt(R_EARTH * R_EARTH - G.d * G.d); ground = { x: foot.x - ax.x * h, y: foot.y - ax.y * h, z: foot.z - ax.z * h }; }   // the near side (facing the target)
  const at = subPoint(ground, jd), gl = len(ground), up = { x: ground.x / gl, y: ground.y / gl, z: ground.z / gl };
  const toSun = { x: sun.x - ground.x, y: sun.y - ground.y, z: sun.z - ground.z }, sunAlt = Math.asin(dot(up, toSun) / len(toSun)) * 180 / Math.PI;
  const elongation = angle(moon, sun) * 180 / Math.PI;
  const planetMag = T.kind === 'planet' ? null : T.mag;
  return { target: T.key, name: T.name, kind: T.kind, cluster: !!T.cluster, jd, impact: G.d / R_EARTH, central: c, at, sunAlt, dark: sunAlt < -6, elongation, mag: planetMag };
}

/** One-line words for an eclipse or occultation, for lists and cards. */
export function eventTitle(e) {
  if (e.type === 'solar') return { total: 'Total solar eclipse', annular: 'Annular solar eclipse', hybrid: 'Hybrid solar eclipse', partial: 'Partial solar eclipse' }[e.kind];
  if (e.type === 'lunar') return { total: 'Total lunar eclipse', partial: 'Partial lunar eclipse', penumbral: 'Penumbral lunar eclipse' }[e.kind];
  return `The Moon covers ${e.name}`;
}
