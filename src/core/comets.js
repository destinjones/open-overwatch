// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Comets: two-body positions on any conic (ellipse, parabola, hyperbola) from SBDB perihelion elements, names people
// know them by, how bright they are, and the two tails. Rows are small_bodies.json's comets: [label, q (AU), e, i, node,
// peri (deg), tp (jd TDB), M1, K1, epoch] (M1 and K1, SBDB's total-magnitude parameters, are null for comets without
// them; epoch is the orbit solution's: SBDB keeps each comet's last solution, and two-body motion drifts away from it).
//
// Tails, physically (not to scale for brightness, but pointing and curving the right way):
// - the ion (plasma) tail is blown straight out by the solar wind, so it lies along the wind's velocity as the comet sees
//   it: radial outflow at ~400 km/s minus the comet's own velocity (a few degrees off anti-sunward);
// - the dust tail is a syndyne: grains shed at an earlier time t - tau leave with the comet's velocity but feel gravity
//   reduced by radiation pressure (GM * (1 - beta)), so each one flies its own wider conic; where they all are now is
//   the tail, curving back along the orbit (exact two-body, also for a sungrazer just past perihelion).
// Activity switches on inside ~5 AU (water ice sublimates near 3 AU; CO and CO2 drive some comets farther out).

import { DEG, AU_KM, setXYZ } from './units.js';
import { earthPosition } from './planets.js';
import { TWO_PI, solveKepler } from './kepler.js';

export const GM_SUN = 0.01720209895 ** 2;   // AU^3 / day^2 (Gaussian constant squared)
export const SOLAR_WIND_AU_DAY = 400 * 86400 / AU_KM;
const PARABOLIC = 1e-7;
const muOf = c => c.mu ?? GM_SUN;   // elements may carry their own GM (dust grains: reduced by radiation pressure)

/** Names in common use for designations that are otherwise anonymous or ambiguous. */
export const COMET_NICKNAMES = Object.freeze({
  'C/1995 O1': 'Hale-Bopp', 'C/1996 B2': 'Hyakutake', 'C/2020 F3': 'NEOWISE', 'C/2023 A3': 'Tsuchinshan-ATLAS',
  'C/2025 N1': '3I/ATLAS', 'C/2022 E3': 'ZTF', 'C/2006 P1': 'McNaught', 'C/2025 A6': 'Lemmon', 'C/2024 G3': 'ATLAS',
});
/** Why some comets are famous (shown in their card). */
export const COMET_FACTS = Object.freeze({
  '1P': 'The first comet known to return. Seen every ~76 years since at least 240 BC; next at perihelion in July 2061.',
  '2P': 'The shortest period of any bright comet: around the Sun every 3.3 years. Source of the Taurid meteors.',
  '12P': 'The "devil comet" that grew horns in its 2023 outbursts; at perihelion in April 2024.',
  '13P': 'A Halley-type comet that returned in 2024 after 68 years.',
  '29P': 'Circles the Sun beyond Jupiter in an almost round orbit and erupts in outbursts several times a year.',
  '55P': 'Parent of the Leonid meteor shower, which every 33 years can turn into a storm.',
  '67P': 'ESA\'s Rosetta orbited it for two years and landed Philae on it in 2014.',
  '109P': 'Parent of the Perseid meteors; at 26 km across it is the largest object that regularly passes near Earth.',
  'C/1995 O1': 'Hale-Bopp: visible to the naked eye for a record 18 months in 1996-97. Back in about 2,400 years.',
  'C/2020 F3': 'NEOWISE: the brightest comet in the northern sky since Hale-Bopp, in July 2020.',
  'C/2023 A3': 'Tsuchinshan-ATLAS: a bright naked-eye comet of October 2024, now leaving the Solar System.',
  'C/2025 N1': '3I/ATLAS: the third known interstellar object, passing through the Solar System once on a hyperbolic path.',
  'C/2025 A6': 'Lemmon: a naked-eye comet in October-November 2025.',
});

/** Designation and the names a comet goes by: { label, designation, name, display, aliases }. */
export function cometNames(label) {
  const s = String(label).trim(), m = s.match(/^(\d+[PDI])\/(.+)$/);            // 1P/Halley, 67P/Churyumov-Gerasimenko
  if (m) {   // the famous few go by name alone; others keep the number (there are many "NEAT"s and "LINEAR"s)
    const nick = COMET_NICKNAMES[m[1]], name = nick || (COMET_FACTS[m[1]] || parseInt(m[1], 10) <= 20 ? m[2] : s);
    return { label: s, designation: m[1], name, display: name, aliases: [m[1], s, m[2]] };
  }
  const c = s.match(/^([CPDXAI]\/\d{4} [A-Z]{1,2}\d*(?:-[A-Z])?)(?: \(([^)]+)\))?$/);   // C/2020 F3 (NEOWISE)
  if (c) {
    const nick = COMET_NICKNAMES[c[1]], disc = c[2] || '';
    const name = nick || (disc ? `${disc} (${c[1]})` : c[1]);
    return { label: s, designation: c[1], name, display: name, aliases: [c[1], s, c[1].slice(2), disc, nick].filter(Boolean) };
  }
  return { label: s, designation: s, name: s, display: s, aliases: [s] };
}

/** small_bodies.json row -> elements { q, e, i, node, peri (rad), tp, label }. */
export function cometFromRow(row) {
  const [label, q, e, i, node, peri, tp, m1 = null, k1 = null, epoch = null] = row;
  return { label, q, e, i: i * DEG, node: node * DEG, peri: peri * DEG, tp, m1: m1 ?? null, k1: k1 ?? null, epoch: epoch ?? null };
}

/** Rotate an in-plane point (perihelion along +x) into heliocentric ecliptic J2000. */
function toEcliptic(c, xv, yv, out) {
  const cO = Math.cos(c.node), sO = Math.sin(c.node), cw = Math.cos(c.peri), sw = Math.sin(c.peri), ci = Math.cos(c.i), si = Math.sin(c.i);
  return setXYZ(out,
    (cO * cw - sO * sw * ci) * xv + (-cO * sw - sO * cw * ci) * yv,
    (sO * cw + cO * sw * ci) * xv + (-sO * sw + cO * cw * ci) * yv,
    sw * si * xv + cw * si * yv);
}

/** Hyperbolic anomaly H for mean anomaly M (any sign) and e > 1: e sinh H - H = M (Newton from an asinh start). */
export function solveHyperbolic(M, e, tol = 1e-12) {
  let H = Math.asinh(M / e);
  if (Math.abs(M) > 6 * e) H = Math.sign(M) * Math.log(2 * Math.abs(M) / e + 1.8);   // far out, a log start converges faster
  for (let k = 0; k < 60; k++) {
    const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
    H -= d; if (Math.abs(d) < tol * Math.max(1, Math.abs(H))) break;
  }
  return H;
}

/** Barker's equation for a parabola: s = tan(nu/2) with s^3 + 3s = W (closed form). */
export function solveBarker(W) {
  const a = Math.abs(W), y = Math.cbrt(a / 2 + Math.sqrt(a * a / 4 + 1));   // odd in W: solve for |W| (no cancellation)
  return Math.sign(W) * (y - 1 / y);
}

/** In-plane position (perihelion on +x) at jd: { x, y, r, nu }. */
export function conicInPlane(c, jd) {
  const { q, e } = c, dt = jd - c.tp;
  if (Math.abs(e - 1) < PARABOLIC) {
    const s = solveBarker(3 * Math.sqrt(muOf(c) / (2 * q * q * q)) * dt);
    return { x: q * (1 - s * s), y: 2 * q * s, r: q * (1 + s * s), nu: 2 * Math.atan(s) };
  }
  if (e < 1) {
    const a = q / (1 - e), n = Math.sqrt(muOf(c) / (a * a * a));
    let M = (n * dt) % TWO_PI; if (M > Math.PI) M -= TWO_PI; if (M < -Math.PI) M += TWO_PI;
    const E = solveKepler(M, e), x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
    return { x, y, r: Math.hypot(x, y), nu: Math.atan2(y, x) };
  }
  const a = q / (e - 1), n = Math.sqrt(muOf(c) / (a * a * a)), H = solveHyperbolic(n * dt, e);
  const x = a * (e - Math.cosh(H)), y = a * Math.sqrt(e * e - 1) * Math.sinh(H);
  return { x, y, r: Math.hypot(x, y), nu: Math.atan2(y, x) };
}

/** Heliocentric ecliptic J2000 position (AU) at jd, for any eccentricity. */
export function cometPosition(c, jd, out = {}) {
  const p = conicInPlane(c, jd);
  return toEcliptic(c, p.x, p.y, out);
}

/** Velocity (AU/day), from the analytic conic: v = sqrt(GM/p) * (-sin nu, e + cos nu) in the orbit plane. */
export function cometVelocity(c, jd, out = {}) {
  const { nu } = conicInPlane(c, jd), k = Math.sqrt(muOf(c) / (c.q * (1 + c.e)));
  return toEcliptic(c, -k * Math.sin(nu), k * (c.e + Math.cos(nu)), out);
}

/** Orbital period in years (Infinity for open orbits). */
export const cometPeriodYears = c => c.e < 1 ? Math.pow(c.q / (1 - c.e), 1.5) : Infinity;

/** What kind of comet this is, in words. */
export function cometClass(c) {
  if (c.e > 1.2) return 'interstellar visitor';
  if (c.e >= 1) return 'one-time visitor (open orbit)';
  const P = cometPeriodYears(c);
  if (P < 20) return 'Jupiter-family comet';
  if (P < 200) return 'Halley-type comet';
  return 'long-period comet';
}

/** How active the comet is at r AU from the Sun: 1 inside 1 AU, falling as r^-2, 0 beyond 5 AU (smooth). */
export function activity(r) {
  if (!(r > 0)) return 0;
  const fall = Math.min(1, 1 / (r * r)), off = r >= 5 ? 0 : r <= 3 ? 1 : 0.5 + 0.5 * Math.cos((r - 3) / 2 * Math.PI);
  return fall * off;
}

/**
 * Ion tail: { dir: unit vector (along the solar wind as the comet sees it), length (AU) }. pos AU, vel AU/day.
 * Length is illustrative, 0.25 AU / r^2 capped at 0.6 AU (bright comets' plasma tails reach tens of millions of km).
 */
export function ionTail(pos, vel, out = {}) {
  const r = Math.hypot(pos.x, pos.y, pos.z), w = SOLAR_WIND_AU_DAY / r;
  const dx = pos.x * w - vel.x, dy = pos.y * w - vel.y, dz = pos.z * w - vel.z, d = Math.hypot(dx, dy, dz);
  out.dir = { x: dx / d, y: dy / d, z: dz / d };
  out.length = Math.min(0.6, 0.25 / (r * r)) * activity(r);
  return out;
}

/**
 * Perihelion elements of the orbit through position r (AU) with velocity v (AU/day) at jd, around a centre of
 * gravitational parameter mu: { q, e, i, node, peri, tp, mu } (radians, jd), for cometPosition / cometVelocity.
 */
export function stateToConic(r, v, jd, mu = GM_SUN) {
  const rl = Math.hypot(r.x, r.y, r.z), v2 = v.x * v.x + v.y * v.y + v.z * v.z, rv = r.x * v.x + r.y * v.y + r.z * v.z;
  const hx = r.y * v.z - r.z * v.y, hy = r.z * v.x - r.x * v.z, hz = r.x * v.y - r.y * v.x, h = Math.hypot(hx, hy, hz);
  const k = v2 - mu / rl, ex = (k * r.x - rv * v.x) / mu, ey = (k * r.y - rv * v.y) / mu, ez = (k * r.z - rv * v.z) / mu;
  const e = Math.hypot(ex, ey, ez), q = h * h / mu / (1 + e), i = Math.acos(Math.max(-1, Math.min(1, hz / h)));
  const nx = -hy, ny = hx, nl = Math.hypot(nx, ny), node = nl < 1e-14 ? 0 : Math.atan2(ny, nx);
  // in-plane axes: P toward the ascending node, Q 90 degrees ahead in the direction of motion
  const ux = Math.cos(node), uy = Math.sin(node), wx = hy * 0 - hz * uy, wy = hz * ux - hx * 0, wz = hx * uy - hy * ux;   // (h x node) / h
  const along = (ax, ay, az) => Math.atan2((ax * wx + ay * wy + az * wz) / h, ax * ux + ay * uy);
  const peri = e < 1e-10 ? 0 : along(ex, ey, ez), nu = along(r.x, r.y, r.z) - peri;
  let dt;   // time since perihelion
  if (Math.abs(e - 1) < PARABOLIC) { const s2 = Math.tan(nu / 2); dt = (s2 * s2 * s2 + 3 * s2) / (3 * Math.sqrt(mu / (2 * q * q * q))); }
  else if (e < 1) {
    const a = q / (1 - e), E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    dt = (E - e * Math.sin(E)) / Math.sqrt(mu / (a * a * a));
  } else {
    const a = q / (e - 1), H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    dt = (e * Math.sinh(H) - H) / Math.sqrt(mu / (a * a * a));
  }
  return { q, e, i, node: (node + 2 * Math.PI) % (2 * Math.PI), peri: (peri + 2 * Math.PI) % (2 * Math.PI), tp: jd - dt, mu };
}

/**
 * Dust tail as a syndyne of n points from the nucleus back to grains `days` old: a grain released at jd - tau leaves
 * with the comet's position and velocity, then moves under gravity times (1 - beta) (radiation pressure is beta of
 * gravity, ~0.1-1 for micron grains). c: the comet's elements. Returns a flat array [x0, y0, z0, x1, ...].
 */
export function dustTail(c, jd, { beta = 0.6, days = 40, n = 24 } = {}) {
  const pts = new Array(n * 3), r = {}, v = {}, p = {}, mu = muOf(c) * (1 - beta);
  for (let k = 0; k < n; k++) {
    const tau = days * k / (n - 1);
    if (k === 0) cometPosition(c, jd, p);
    else { const t0 = jd - tau; cometPosition(c, t0, r); cometVelocity(c, t0, v); cometPosition(stateToConic(r, v, t0, mu), jd, p); }
    pts[k * 3] = p.x; pts[k * 3 + 1] = p.y; pts[k * 3 + 2] = p.z;
  }
  return pts;
}

/** Days of dust to draw at r AU: a long fan near the Sun, a stub far out (capped so the tail stays plausible). */
export const dustDays = r => Math.max(4, Math.min(60, 30 / (r * r))) * (activity(r) > 0 ? 1 : 0);

/**
 * Comets near the Sun or Earth at jd, the ones worth a label: [{ row, c, r, delta, score }], best first. score is
 * 5 log10(delta) + 10 log10(r), the distance part of the standard comet magnitude (lower is brighter for the same
 * comet; the comets' own absolute magnitudes are not in our data, so this is "well placed", not "bright").
 */
export function cometsNearNow(rows, jd, earth, { maxR = 3, limit = 12 } = {}) {
  const out = [], p = {};
  for (const row of rows) {
    if (/^\d*D\/|-[A-Z]{1,2}( |$)/.test(row[0])) continue;      // defunct (D/) comets and fragments (C/2020 P4-B, 73P/... 3-AA) are not shown
    const c = cometFromRow(row);
    if (c.q > maxR) continue;
    cometPosition(c, jd, p);
    const r = Math.hypot(p.x, p.y, p.z); if (r > maxR) continue;
    const delta = Math.hypot(p.x - earth.x, p.y - earth.y, p.z - earth.z);
    out.push({ row, c, r, delta, score: 5 * Math.log10(delta) + 10 * Math.log10(r) });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}

/** A drawable stretch of an open (or very long) orbit: n points from jd0 to jd1, flat [x, y, z, ...]. origin and out
 *  as for kepler.js orbitPath (origin subtracted in float64, so a line far out can be drawn relative to its body).
 *  at: a jd inside the stretch that gets a sample of its own (the body's now), the grid shifted by under one step. */
export function conicArc(c, jd0, jd1, n = 256, { origin = null, out = null, at = null } = {}) {
  const pts = out || new Float32Array(n * 3), p = {}, ox = origin ? origin.x : 0, oy = origin ? origin.y : 0, oz = origin ? origin.z : 0;
  const step = (jd1 - jd0) / (n - 1), shift = at != null && step > 0 && at >= jd0 && at <= jd1 ? at - (jd0 + Math.round((at - jd0) / step) * step) : 0;
  for (let k = 0; k < n; k++) {
    cometPosition(c, jd0 + shift + (jd1 - jd0) * k / (n - 1), p);
    pts[k * 3] = p.x - ox; pts[k * 3 + 1] = p.y - oy; pts[k * 3 + 2] = p.z - oz;
  }
  return pts;
}

/** Perihelion passages of a closed orbit between jd0 and jd1 (two-body: an estimate, planets shift them by days to
 *  months over centuries); an open orbit has its one passage if it falls inside. */
export function perihelionPassages(c, jd0, jd1) {
  if (c.e >= 1) return c.tp >= jd0 && c.tp <= jd1 ? [c.tp] : [];
  const P = cometPeriodYears(c) * 365.25, out = [];
  for (let t = c.tp + Math.ceil((jd0 - c.tp) / P) * P; t <= jd1 && out.length < 200; t += P) out.push(t);
  return out;
}

// ---------------------------------------------------------------- brightness

/**
 * Total visual magnitude from SBDB's comet parameters: m = M1 + 5 log10(delta) + K1 log10(r) (r from the Sun, delta from
 * Earth, AU), the same formula JPL Horizons uses for its T-mag. Null without M1/K1. Comets are famously unpredictable:
 * the parameters are fitted to past observations, and outbursts or a fading nucleus can put a comet magnitudes off.
 */
export function cometMagnitude(c, r, delta) {
  if (c.m1 == null || c.k1 == null || !(r > 0) || !(delta > 0)) return null;
  return c.m1 + 5 * Math.log10(delta) + c.k1 * Math.log10(r);
}

const EP = {}, CP = {};
/** Magnitude at jd as seen from Earth (core/planets.js), or null. */
export function cometMagnitudeAt(c, jd, earth = earthPosition(jd, EP)) {
  if (c.m1 == null) return null;
  cometPosition(c, jd, CP);
  return cometMagnitude(c, Math.hypot(CP.x, CP.y, CP.z), Math.hypot(CP.x - earth.x, CP.y - earth.y, CP.z - earth.z));
}

/** What it takes to see a comet of magnitude m (under a dark sky; a comet's light is spread out, so a bit more). */
export function seeingWords(m) {
  if (m == null) return 'brightness unknown';
  if (m < 0) return 'brilliant: easy to the naked eye, maybe in daylight near the Sun';
  if (m < 4) return 'naked eye';
  if (m < 6) return 'naked eye under a dark sky';
  if (m < 9) return 'binoculars';
  if (m < 12) return 'a small telescope';
  return 'a large telescope';
}

/**
 * The brightest moment between jd0 and jd1: { jd, mag } or null. Daily samples (half-day inside 0.3 AU of the Sun),
 * then a golden-section refinement around the best one. The peak usually falls near perihelion or the closest pass by
 * Earth, whichever wins.
 */
export function cometPeak(c, jd0, jd1) {
  if (c.m1 == null) return null;
  let best = null;
  for (let t = jd0; t <= jd1;) {
    const m = cometMagnitudeAt(c, t); if (m != null && (!best || m < best.mag)) best = { jd: t, mag: m };
    cometPosition(c, t, CP); t += Math.hypot(CP.x, CP.y, CP.z) < 0.3 ? 0.5 : 1;
  }
  if (!best) return null;
  let a = Math.max(jd0, best.jd - 1), b = Math.min(jd1, best.jd + 1);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 40; k++) {
    const x1 = b - g * (b - a), x2 = a + g * (b - a);
    if (cometMagnitudeAt(c, x1) < cometMagnitudeAt(c, x2)) b = x2; else a = x1;
  }
  const t = (a + b) / 2, m = cometMagnitudeAt(c, t);
  return m < best.mag ? { jd: t, mag: m } : best;
}

/**
 * Can two-body motion from the comet's elements be trusted at jd? SBDB keeps the last orbit solution (some from the
 * 1990s); a comet that has been round the Sun since may have met Jupiter (16P/Brooks 2's 2016 elements put it 1.5 AU
 * from the Horizons position in 2026, 67P's 2015 ones 0.3 AU). Trusted: within 8 years of the epoch and, on a closed
 * orbit, within 1.2 periods of it. Comets without an epoch count as trusted.
 */
export function orbitFresh(c, jd) {
  if (c.epoch == null) return true;
  const yrs = Math.abs(jd - c.epoch) / 365.25, P = cometPeriodYears(c);
  return yrs <= 8 && (!Number.isFinite(P) || yrs <= 1.2 * P);
}

/**
 * The brightest comets at jd: [{ row, c, mag, r, delta, peak: { jd, mag } | null }], brightest first, down to maxMag.
 * Only comets with magnitude parameters, an orbit fresh enough to trust (orbitFresh) and within maxR AU of the Sun
 * (beyond that none is bright); defunct (D/) comets and fragments are left out. The peak is searched within +-span days.
 */
export function brightComets(rows, jd, { maxMag = 15, limit = 15, maxR = 6, span = 400, earth = earthPosition(jd, {}) } = {}) {
  const out = [], p = {};
  for (const row of rows) {
    if (row[7] == null || /^\d*D\/|-[A-Z]{1,2}( |$)/.test(row[0])) continue;
    const c = cometFromRow(row);
    if (c.q > maxR || !orbitFresh(c, jd)) continue;
    cometPosition(c, jd, p);
    const r = Math.hypot(p.x, p.y, p.z); if (r > maxR) continue;
    const delta = Math.hypot(p.x - earth.x, p.y - earth.y, p.z - earth.z), mag = cometMagnitude(c, r, delta);
    if (mag != null && mag <= maxMag) out.push({ row, c, mag, r, delta });
  }
  out.sort((a, b) => a.mag - b.mag);
  const top = out.slice(0, limit);
  for (const o of top) o.peak = cometPeak(o.c, jd - span, jd + span);
  return top;
}

/**
 * Comets due to peak brighter than maxMag in the next `days`: [{ row, c, peak: { jd, mag } }], soonest first. Only
 * trusted orbits (orbitFresh at the peak) with a perihelion inside the window (or just before it) and q under 3 AU.
 */
export function cometsComing(rows, jd, { days = 730, maxMag = 12, limit = 10 } = {}) {
  const out = [];
  for (const row of rows) {
    if (row[7] == null || /^\d*D\/|-[A-Z]{1,2}( |$)/.test(row[0])) continue;
    const c = cometFromRow(row);
    if (c.q > 3) continue;
    const tp = perihelionPassages(c, jd - 60, jd + days)[0]; if (tp == null) continue;
    // the brightest a comet can get is near perihelion with Earth close: skip what cannot reach maxMag even at Earth's distance
    if (cometMagnitude(c, c.q, Math.max(0.05, Math.abs(c.q - 1))) > maxMag) continue;
    const pk = cometPeak(c, Math.max(jd, tp - 150), Math.min(jd + days, tp + 150));
    if (pk && pk.mag <= maxMag && pk.jd > jd + 1 && orbitFresh(c, pk.jd)) out.push({ row, c, peak: pk });
  }
  return out.sort((a, b) => a.peak.jd - b.peak.jd).slice(0, limit);
}
