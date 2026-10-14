// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Re-entry predictions from public element sets (TLEs), worked out here: keyless, offline, testable. Pure (no DOM):
// test/decay.test.mjs checks it against objects whose real re-entry times were published.
//
// How (docs/CORE.md has the long form):
//   1. From the TLE: perigee and apogee height, the first derivative of the mean motion (n-dot, line 1 columns 34-43,
//      stored as n-dot/2 in rev/day²) and SGP4's drag term B* (columns 54-61, 1/Earth radii).
//   2. n-dot is the decay actually measured over the last days: da/dt = -(2/3)·a·(dn/dt)/n. Dividing it by the air density
//      at the orbit gives the object's ballistic factor (Cd·A/m, m²/kg) as it really flew. B* gives the same factor another
//      way (Cd·A/m = 12.741621·B*, from B* = Cd·A/m·ρ0/2 with ρ0 = 0.15696615 kg/m²/ER); it is a fit parameter that soaks up
//      other errors, so n-dot leads and B* is the fallback (n-dot zero or negative) and the cross-check.
//   3. Fly that factor down through a layered exponential atmosphere (Vallado's table 8-4, from CIRA-72; a medium-activity
//      atmosphere) scaled by solar activity, da/dt = -(Cd·A/m)·ρ·√(μa), until the perigee is at 100 km. Eccentric orbits:
//      the perigee stays put while the apogee comes down (drag acts near perigee), then the circle shrinks; the density is
//      the orbit average ρ(perigee)·e^-x·I0(x), x = a·e/H (King-Hele).
//   4. The window: ±25% of the time the object had left at the TLE's epoch. That is the usual rule of thumb (Aerospace
//      Corporation and ESA quote ±20-25% of the remaining lifetime for uncontrolled re-entries): the air density at
//      150-300 km swings with the Sun from day to day, and the object's attitude (so its drag) is unknown. When n-dot and
//      B* disagree by more than a factor of 2 the window is ±50%.
//   5. The corridor: the ground track (Kepler plus J2 node and perigee drift, phase from the decaying mean motion) over the
//      orbits around the most likely time, or the whole window when that is shorter. A re-entering object can come down
//      anywhere under its track inside the window, so a window of more than a few orbits covers every longitude between
//      the latitudes ±inclination.
//
// Solar activity: F10.7 (solar flux, sfu) and Kp (geomagnetic, 0-9). core/spaceweather.js reads the solar wind, flares and
// alerts but no F10.7 or Kp index, so the default is F10.7 = 140 sfu, Kp = 2 (cycle 25's declining phase, late 2026);
// callers that know better pass { f107, kp }. Activity changes the density's shape with height; the n-dot path is calibrated
// on the real atmosphere of the last days, so it moves less with these numbers than the B* path does.
//
// Not modelled: thrusters (a working satellite can raise its orbit or come down on purpose at any time; newly launched
// ones still raising their orbit look like they are falling, so the list leaves out the last 30 days' launches), lift,
// tumbling, the fortnightly and 11-year swings of the Sun beyond the one F10.7 number.

import { tleEpochMs } from './tle.js';
import { stamp, rep } from './liveprov.js';

export const MU = 398600.4418;        // km³/s²
export const RE = 6378.137;           // km
const J2 = 1.08262668e-3, TAU = 2 * Math.PI, D2R = Math.PI / 180, DAY = 864e5;
export const BSTAR_TO_BALLISTIC = 12.741621;   // Cd·A/m (m²/kg) per unit B* (1/ER)
export const DEFAULT_SOLAR = Object.freeze({ f107: 140, kp: 2 });
export const WINDOW_FRACTION = 0.25;           // ± of the remaining lifetime
export const DISAGREE_FRACTION = 0.5;          // ± when n-dot and B* disagree by more than DISAGREE_RATIO
export const DISAGREE_RATIO = 2;
export const END_KM = 100;                     // the perigee height where we call it re-entered
export const FIT_LAG_DAYS = 0.5;               // n-dot describes the decay this long before the epoch (see ballisticFromNdot)
export const MAX_YEARS = 25;                   // beyond this the answer is "more than 25 years"
// Above this ballistic factor (m²/kg) the decay is not drag: whole satellites fly at 0.002-0.1 (Tiangong-1 0.003, GOCE 0.003,
// a Starlink 0.01-0.1); Starlinks lowering themselves with thrusters at 420-550 km come out at 0.3-3. Light debris (insulation
// flakes) can reach this too, and is left out with them: a rare miss, against a list full of false alarms.
export const MAX_BALLISTIC = 0.25;

// Vallado, Fundamentals of Astrodynamics and Applications, table 8-4 (CIRA-72): base height km, density kg/m³, scale height km
const ATM = [
  [0, 1.225, 7.249], [25, 3.899e-2, 6.349], [30, 1.774e-2, 6.682], [40, 3.972e-3, 7.554], [50, 1.057e-3, 8.382],
  [60, 3.206e-4, 7.714], [70, 8.770e-5, 6.549], [80, 1.905e-5, 5.799], [90, 3.396e-6, 5.382], [100, 5.297e-7, 5.877],
  [110, 9.661e-8, 7.263], [120, 2.438e-8, 9.473], [130, 8.484e-9, 12.636], [140, 3.845e-9, 16.149], [150, 2.070e-9, 22.523],
  [180, 5.464e-10, 29.740], [200, 2.789e-10, 37.105], [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628], [350, 9.518e-12, 53.298],
  [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822], [600, 1.454e-13, 71.835], [700, 3.614e-14, 88.667],
  [800, 1.170e-14, 124.64], [900, 5.245e-15, 181.05], [1000, 3.019e-15, 268.00],
];
const band = h => { let i = ATM.length - 1; while (i > 0 && h < ATM[i][0]) i--; return ATM[i]; };
/** Scale height (km) at height h (km). */
export const scaleHeight = h => band(h)[2];
/** Effective solar flux: F10.7 plus Kp's heating (Jacchia: 28 K per Kp against 3.24 K per sfu, so ~8.6 sfu per Kp above 2). */
export const effectiveFlux = ({ f107 = DEFAULT_SOLAR.f107, kp = DEFAULT_SOLAR.kp } = {}) => Math.max(60, f107 + 8.6 * (kp - 2));
/**
 * Air density (kg/m³) at height h km. The table is a medium-activity atmosphere (F10.7 ≈ 150); solar activity scales it by
 * exp(γ(h)·(F − 150)/100), γ rising from 0 at 120 km to 1.2 at 420 km and above, so 400 km is ~7× denser at solar maximum
 * (F ≈ 250) than at minimum (F ≈ 70), 200 km ~2×, 120 km not at all (the spread of the published models).
 */
export function density(h, solar = DEFAULT_SOLAR) {
  const [h0, r0, H] = band(h), F = effectiveFlux(solar), g = Math.min(1.2, Math.max(0, (h - 120) / 250));
  return r0 * Math.exp(-(h - h0) / H) * Math.exp(g * (F - 150) / 100);
}
// e^-x·I0(x): the orbit-averaged density over the perigee density, x = a·e/H
const avgFactor = x => {
  if (x < 1e-9) return 1;
  if (x > 30) return (1 + 1 / (8 * x)) / Math.sqrt(TAU * x);
  let s = 1, t = 1; for (let k = 1; k < 80; k++) { t *= (x / 2) ** 2 / (k * k); s += t; if (t < 1e-12 * s) break; }
  return s * Math.exp(-x);
};

/** TLE exponent field: " 18234-3" -> 0.18234e-3, "-11606-4" -> -0.11606e-4. */
export function expField(s) {
  const m = /^\s*([+-]?)(\d{1,5})\s*([+-]?)(\d)\s*$/.exec(String(s || ''));
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * Number('0.' + m[2]) * 10 ** ((m[3] === '-' ? -1 : 1) * +m[4]);
}

/** The elements decay needs from a TLE. Heights in km above the equatorial radius, angles in degrees, n in rev/day. */
export function elements(l1, l2) {
  const n = +l2.slice(52, 63), e = Number('0.' + l2.slice(26, 33).trim()), ndot2 = +l1.slice(33, 43);
  const a = Math.cbrt(MU / (n * TAU / 86400) ** 2);
  return {
    id: l1.slice(2, 7).trim(), epochMs: tleEpochMs(l1), n, ndot: 2 * (Number.isFinite(ndot2) ? ndot2 : 0), bstar: expField(l1.slice(53, 61)),
    incl: +l2.slice(8, 16), raan: +l2.slice(17, 25), e, argp: +l2.slice(34, 42), M: +l2.slice(43, 51),
    a, perigeeKm: a * (1 - e) - RE, apogeeKm: a * (1 + e) - RE, periodMin: 1440 / n,
  };
}

// da/dt in km/day for ballistic factor B (m²/kg) at semi-major axis a (km) with the perigee at hp (km)
function adot(B, a, hp, solar) {
  const e = Math.max(0, 1 - (RE + hp) / a), H = scaleHeight(hp);
  const rho = density(hp, solar) * avgFactor(a * e / H);
  return -B * rho * Math.sqrt(MU * 1e9 * a * 1e3) * 86.4;   // m/s -> km/day
}

/** The ballistic factor (m²/kg) that n-dot says the object flew with, or null when n-dot is no use. */
export function ballisticFromNdot(el, solar = DEFAULT_SOLAR) {
  if (!(el.ndot > 1e-8) || el.perigeeKm > 1000) return null;
  const aDot = (2 / 3) * el.a * el.ndot / el.n;   // km/day, decreasing
  // n-dot is fitted over about the last day of tracking, so it is the decay of half a day ago, a little higher up: calibrate
  // there (at most a scale height up). Near the end, when the decay doubles within hours, this matters (Tiangong-1, Starlinks).
  const up = Math.min(aDot * FIT_LAG_DAYS, scaleHeight(el.perigeeKm));
  const per = -adot(1, el.a + up, Math.min(el.perigeeKm, el.a - RE) + up, solar);
  return per > 0 ? aDot / per : null;
}
export const ballisticFromBstar = el => (el.bstar > 0 ? BSTAR_TO_BALLISTIC * el.bstar : null);

/**
 * Fly ballistic factor B down from the TLE's orbit. Returns { days (Infinity beyond MAX_YEARS), path: [{ t (days from epoch),
 * a, e, M (rad, cumulative), raan, argp (rad) }] } — path is what the corridor needs.
 */
export function lifetime(el, B, solar = DEFAULT_SOLAR, { keepPath = false } = {}) {
  let a = el.a, hp = Math.min(el.perigeeKm, el.a - RE), t = 0, M = el.M * D2R, raan = el.raan * D2R, argp = el.argp * D2R;
  const cosI = Math.cos(el.incl * D2R), path = keepPath ? [] : null, maxDays = MAX_YEARS * 365.25;
  const push = () => path && path.push({ t, a, e: Math.max(0, 1 - (RE + hp) / a), M, raan, argp });
  const rates = (a, e) => {
    const n = Math.sqrt(MU / a ** 3) * 86400, p = a * (1 - e * e), k = n * J2 * (RE / p) ** 2;   // rad/day
    return { n, draan: -1.5 * k * cosI, dargp: 0.75 * k * (5 * cosI * cosI - 1) };
  };
  push();
  for (let i = 0; i < 50000 && hp > END_KM && t < maxDays; i++) {
    const H = scaleHeight(hp), r1 = adot(B, a, hp, solar);
    if (!(r1 < 0)) return { days: Infinity, path };
    const span = Math.max(H, a - RE - hp);   // circular: a scale height; eccentric: the apogee's height above perigee
    let dt = Math.min(0.02 * span / -r1, maxDays - t);
    if (hp < 130) dt = Math.min(dt, 0.002);   // the last orbits: about 3 minutes
    const am = a + r1 * dt / 2, hm = Math.min(hp, am - RE), r2 = adot(B, am, hm, solar);   // midpoint step
    const rt = rates(am, Math.max(0, 1 - (RE + hm) / am));
    a += r2 * dt; t += dt; M += rt.n * dt; raan += rt.draan * dt; argp += rt.dargp * dt;
    if (a - RE < hp) hp = a - RE;   // circular now: the circle shrinks
    push();
  }
  return { days: hp <= END_KM ? t : Infinity, path };
}

const fracOf = (dn, db) => (dn && db && Number.isFinite(dn) && Number.isFinite(db) && Math.max(dn / db, db / dn) > DISAGREE_RATIO ? DISAGREE_FRACTION : WINDOW_FRACTION);

/**
 * The re-entry prediction for one TLE. Returns null when neither n-dot nor B* says anything, else
 * { id, epochMs, perigeeKm, apogeeKm, incl, periodMin, method: 'n-dot' | 'B*', ballistic (m²/kg), days (from epoch,
 *   Infinity beyond 25 years), reentryMs, windowMs: [lo, hi], fraction, otherDays (the other method's answer or null),
 *   manoeuvring (the decay is too fast to be drag: thrusters, so the prediction means nothing), solar: { f107, kp }, el, path (only with keepPath) }.
 */
export function predict(l1, l2, { solar = DEFAULT_SOLAR, keepPath = false } = {}) {
  const el = elements(l1, l2);
  if (!(el.n > 0) || !Number.isFinite(el.a)) return null;
  const Bn = ballisticFromNdot(el, solar), Bb = ballisticFromBstar(el);
  if (!Bn && !Bb) return null;
  const manoeuvring = (Bn || Bb) > MAX_BALLISTIC;
  const main = lifetime(el, Bn || Bb, solar, { keepPath });
  const other = Bn && Bb ? lifetime(el, Bb, solar).days : null;
  const days = main.days, fraction = fracOf(days, other);
  const reentryMs = Number.isFinite(days) ? el.epochMs + days * DAY : Infinity;
  const half = Number.isFinite(days) ? fraction * days * DAY : Infinity;
  return {
    id: el.id, epochMs: el.epochMs, perigeeKm: el.perigeeKm, apogeeKm: el.apogeeKm, incl: el.incl, periodMin: el.periodMin,
    method: Bn ? 'n-dot' : 'B*', ballistic: Bn || Bb, days, reentryMs, windowMs: [reentryMs - half, reentryMs + half], fraction,
    otherDays: other, manoeuvring, solar: { f107: solar.f107 ?? DEFAULT_SOLAR.f107, kp: solar.kp ?? DEFAULT_SOLAR.kp }, el, path: main.path,
  };
}

/** Where the prediction stands at `now`: 'ahead' (window not open yet), 'window' (inside it), 'past' (after it: most likely down). */
export const status = (p, now = Date.now()) => (!p || !Number.isFinite(p.reentryMs) ? 'ahead' : now > p.windowMs[1] ? 'past' : now >= p.windowMs[0] ? 'window' : 'ahead');

// Greenwich mean sidereal angle (rad) at ms
const gmst = ms => ((280.46061837 + 360.98564736629 * (ms / DAY + 2440587.5 - 2451545)) % 360) * D2R;
function stateAt(path, tDays) {
  let i = 0, j = path.length - 1;
  if (tDays <= path[0].t) return path[0];
  if (tDays >= path[j].t) { const p = path[j], prev = path[Math.max(0, j - 1)], k = p.t > prev.t ? (tDays - p.t) / (p.t - prev.t) : 0;
    return { a: p.a, e: p.e, M: p.M + (p.M - prev.M) * k, raan: p.raan + (p.raan - prev.raan) * k, argp: p.argp + (p.argp - prev.argp) * k }; }
  while (j - i > 1) { const m = (i + j) >> 1; if (path[m].t <= tDays) i = m; else j = m; }
  const p = path[i], q = path[j], k = (tDays - p.t) / (q.t - p.t), L = (x, y) => x + (y - x) * k;
  return { a: L(p.a, q.a), e: L(p.e, q.e), M: L(p.M, q.M), raan: L(p.raan, q.raan), argp: L(p.argp, q.argp) };
}
/** Sub-satellite point { lat, lon } (degrees, geocentric latitude) from a path state at ms. */
function groundPoint(s, incl, ms) {
  let E = s.M; for (let k = 0; k < 8; k++) E -= (E - s.e * Math.sin(E) - s.M) / (1 - s.e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + s.e) * Math.sin(E / 2), Math.sqrt(1 - s.e) * Math.cos(E / 2)), u = s.argp + nu, i = incl * D2R;
  const x = Math.cos(s.raan) * Math.cos(u) - Math.sin(s.raan) * Math.sin(u) * Math.cos(i);
  const y = Math.sin(s.raan) * Math.cos(u) + Math.cos(s.raan) * Math.sin(u) * Math.cos(i), z = Math.sin(u) * Math.sin(i);
  let lon = (Math.atan2(y, x) - gmst(ms)) / D2R; lon = ((lon + 540) % 360) - 180;
  return { lat: Math.asin(Math.max(-1, Math.min(1, z))) / D2R, lon };
}

/**
 * The re-entry corridor: the ground track over the window when it is short, else over `maxOrbits` orbits centred on the most
 * likely time. p must come from predict(..., { keepPath: true }). Returns { from, to (ms), coversWindow, latMax (degrees:
 * the track never leaves ±latMax), segments: [[{ lat, lon, t }]] split where the track crosses the antimeridian }.
 */
export function corridor(p, { maxOrbits = 3, stepS = 60 } = {}) {
  if (!p || !p.path || !Number.isFinite(p.reentryMs)) return null;
  const orbit = 88.5 * 60e3, half = Math.min((p.windowMs[1] - p.windowMs[0]) / 2, maxOrbits * orbit / 2);
  const from = p.reentryMs - half, to = p.reentryMs + half, segs = [];
  let seg = [], prev = null;
  for (let t = from; t <= to + 1; t += stepS * 1000) {
    const g = groundPoint(stateAt(p.path, (t - p.epochMs) / DAY), p.incl, t), pt = { lat: g.lat, lon: g.lon, t };
    if (prev && Math.abs(pt.lon - prev.lon) > 180) { segs.push(seg); seg = []; }
    seg.push(pt); prev = pt;
  }
  if (seg.length) segs.push(seg);
  return { from, to, coversWindow: half < maxOrbits * orbit / 2, latMax: p.incl > 90 ? 180 - p.incl : p.incl, segments: segs.filter(s => s.length > 1) };
}

// ---- words ----
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = x => String(x).padStart(2, '0');
const dayTime = d => `${DOW[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const dayDate = d => `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
// a window edge rounded to the nearest hour (to 10 minutes when the window is under 6 hours: more would be false precision)
const roundTo = (ms, step) => Math.round(ms / step) * step;

/**
 * The window in plain words: "between Tue 03:00 and Thu 21:00 UTC" (under 6 days), "between Tue 14 Oct and Sat 25 Oct"
 * (under 60 days), "between 14 Oct 2026 and 3 Feb 2027", or "not in the next 25 years".
 */
export function windowWords(p) {
  if (!p || !Number.isFinite(p.reentryMs)) return `not in the next ${MAX_YEARS} years`;
  const [lo, hi] = p.windowMs, span = hi - lo;
  if (span < 6 * DAY) { const step = span < 6 * 3600e3 ? 600e3 : 3600e3, a = new Date(roundTo(lo, step)), b = new Date(roundTo(hi, step));
    return `between ${dayTime(a)} and ${dayTime(b)} UTC`; }
  const a = new Date(lo), b = new Date(hi);
  if (span < 60 * DAY) return `between ${dayDate(a)} and ${dayDate(b)}`;
  const dm = d => `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `between ${dm(a)} and ${dm(b)}`;
}
/** "3.2 days", "14 h", "40 min", "2.1 years". */
export function spanText(days) {
  if (!Number.isFinite(days)) return `more than ${MAX_YEARS} years`;
  if (days >= 365.25) return (days / 365.25).toFixed(1) + ' years';
  if (days >= 2) return (days < 20 ? days.toFixed(1) : Math.round(days)) + ' days';
  if (days * 24 >= 1.5) return Math.round(days * 24) + ' h';
  return Math.round(days * 1440) + ' min';
}
/** Why the window is that wide, in one sentence. */
export function uncertaintyWords(p) {
  if (!p || !Number.isFinite(p.reentryMs)) return 'Drag is too weak here to bring it down within decades.';
  const pct = Math.round(p.fraction * 100), why = p.fraction > WINDOW_FRACTION ? ' (wider than the usual ±25%: the two drag estimates disagree)' : '';
  return `±${pct}% of the ${spanText(p.days)} it had left when its orbit was measured${why}; the air up there swells and shrinks with the Sun, and how the object tumbles changes its drag.`;
}
/** The card's sentence: "between Tue 03:00 and Thu 21:00 UTC; anywhere along these tracks". */
export const whereWords = (p, c) => `${windowWords(p)}; ${c && c.coversWindow ? 'anywhere along these tracks' : `anywhere under its track between ${Math.round(c ? c.latMax : p.incl)}° N and S (the tracks drawn are the orbits around the likeliest time)`}`;

/**
 * Stamp a prediction with its provenance: CelesTrak's element set (via the site's copy unless direct), its epoch the data
 * time. It goes stale when the element set is older than a fifth of the time it had left (2 h to 3 days): a newer element set
 * would move the window by about that much, so confidence follows the prediction's own uncertainty.
 */
export function stampDecay(p, l1, source = 'mirror') {
  stamp(p, 'reentry', [rep('celestrak', { dataAt: tleEpochMs(l1), cached: source !== 'celestrak' })]);
  const left = Number.isFinite(p.days) ? p.days * DAY : 3 * DAY;
  p.prov.maxAgeMs = Math.min(3 * DAY, Math.max(2 * 3600e3, 0.2 * left));
  return p;
}

/** A quick upper bound on the lifetime (days): a scale height over today's decay rate (the real one is shorter, as the air
 *  thickens on the way down). Lets the list skip the thousands of objects nowhere near coming down without flying them. */
export function quickDays(el, solar = DEFAULT_SOLAR) {
  const B = Math.max(ballisticFromNdot(el, solar) || 0, ballisticFromBstar(el) || 0);
  if (!B) return Infinity;
  return scaleHeight(el.perigeeKm) / -adot(B, el.a, Math.min(el.perigeeKm, el.a - RE), solar);
}

/**
 * "Falling soon": every satellite predicted to re-enter between `now` and `now + days` (and those whose window is still
 * open), soonest first. sats: [{ id, name, l1, l2, source? }]. exclude: ids to leave out (the last 30 days' launches,
 * which are still raising their orbits). Objects whose perigee is above 700 km are skipped unread (decades up there), and
 * so are the manoeuvring ones (see MAX_BALLISTIC). Each item gets `working`: a satellite in service (any group but the debris
 * ones, or s.working) may still be kept up or brought down by its operator.
 */
export function fallingSoon(sats, { now = Date.now(), days = 30, solar = DEFAULT_SOLAR, exclude = null, keepPath = true, limit = 200 } = {}) {
  const out = [], seen = new Set(), end = now + days * DAY;
  for (const s of sats || []) {
    if (!s || !s.l1 || !s.l2 || seen.has(s.id) || (exclude && exclude.has(String(s.id)))) continue;
    seen.add(s.id);
    const n = +s.l2.slice(52, 63), e = Number('0.' + s.l2.slice(26, 33).trim());
    if (!(n > 0) || Math.cbrt(MU / (n * TAU / 86400) ** 2) * (1 - e) - RE > 700) continue;
    let p = null;
    try { const el = elements(s.l1, s.l2); if (quickDays(el, solar) * DAY < end - el.epochMs) p = predict(s.l1, s.l2, { solar, keepPath }); } catch { p = null; }
    if (!p || p.manoeuvring || !Number.isFinite(p.reentryMs) || p.reentryMs > end || p.windowMs[1] < now) continue;
    p.name = s.name || s.id; p.group = s.group || null; p.working = s.working ?? !/debris/i.test(s.group || '');
    stampDecay(p, s.l1, s.source || 'mirror');
    out.push(p);
  }
  return out.sort((a, b) => a.reentryMs - b.reentryMs).slice(0, limit);
}
