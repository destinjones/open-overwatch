// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Deep-space missions from data/solar/spacecraft.json (JPL Horizons, brand/tools/make_spacecraft.py): where a craft is
// at any instant, how fast, which way its mission is heading next, and how long its signal takes to reach Earth.
// A track is evenly spaced samples { t0_jd, step_days, xyz: [x0, y0, z0, x1, ...] } (heliocentric ecliptic J2000, AU).
//
// Between samples the path is a cubic through four samples (Catmull-Rom), within ~2,000 km of Horizons half-way
// between samples on cruise arcs (the samples themselves are rounded to 1e-5 AU, 1,500 km); linear interpolation was
// off by up to 200,000 km. A craft orbiting a planet faster than the samples is the exception: Juno sweeps past
// Jupiter's cloud tops in two hours. For it a track carries `local`: Horizons' osculating elements around the planet,
// one set a day ({ center, gm km^3/s^2, t0_jd, step_days, el: [[q km, e, i, node, peri (deg), tp], ...] }); the
// position is the planet (as the view draws it) plus a two-body orbit from the nearest set, so the perijove passes
// are exact to a few km and the craft sits on its orbit around the Jupiter on screen, not 100,000 km beside it.
// ISRO's Moon orbiters (Chandrayaan) and Mars Orbiter Mission carry the same around 'moon' and 'mars', a set every
// 3 days (6 hours for Chandrayaan-3's short stay) and no perijove sets: within ~300 km of Horizons, ~20 km for
// Chandrayaan-3 (test/fixtures/horizons_isro_orbits.json), in quiet orbit. While an orbit is being raised or lowered
// (Chandrayaan-2 in late August 2019, Chandrayaan-3 in August and October 2023) a set carried across a burn is off by
// up to ~5,000 km, and the drawn orbit jumps there at the next set. BepiColombo carries one around 'mercury' from its
// capture in November 2026 (a set every 6 hours, within ~10 km of Horizons), and data/solar/apophis.json one around
// 'earth' (a set an hour) for the asteroid's 2029 flyby: the same track format serves it.
// Past the last sample a craft that is leaving the Sun for good (above escape speed) coasts on in a straight line,
// which is how Voyager and Pioneer really fly; any other craft has no published position there (null).

import { AU_KM, C_KM_S } from './units.js';
import { GM_SUN, cometPosition } from './comets.js';
import { DEG } from './units.js';
import { earthPosition, moonGeocentric } from './planets.js';

/** Signal (light) time over au, in seconds. */
export const lightSeconds = au => au * AU_KM / C_KM_S;

const sampleCount = c => c.xyz.length / 3;
const sampleJd = (c, k) => c.t0_jd + k * c.step_days;

function sample(c, k, out) {
  const x = c.xyz;
  out.x = x[k * 3]; out.y = x[k * 3 + 1]; out.z = x[k * 3 + 2];
  return out;
}

/** Velocity in AU/day from the last two samples. */
export function lastVelocity(c) {
  const x = c.xyz, n = sampleCount(c), s = c.step_days;
  return { x: (x[n * 3 - 3] - x[n * 3 - 6]) / s, y: (x[n * 3 - 2] - x[n * 3 - 5]) / s, z: (x[n * 3 - 1] - x[n * 3 - 4]) / s };
}

/** True when the craft leaves the track faster than the Sun's escape speed there (it coasts out for good). */
export function escaping(c) {
  const n = sampleCount(c), x = c.xyz; if (n < 2) return false;
  const v = lastVelocity(c), r = Math.hypot(x[n * 3 - 3], x[n * 3 - 2], x[n * 3 - 1]);
  return (v.x * v.x + v.y * v.y + v.z * v.z) * r > 2 * GM_SUN;
}

// ---- orbits around a planet (track.local)
const KM3S2_TO_AU3D2 = 86400 * 86400 / (AU_KM * AU_KM * AU_KM);
/** Is jd inside the craft's planet-centred stretch? */
export const inLocal = (c, jd) => !!c.local && jd >= c.local.t0_jd - c.local.step_days / 2
  && jd <= Math.min(c.local.t0_jd + (c.local.el.length - 0.5) * c.local.step_days, c.end_jd ?? Infinity);   // never past the track
/**
 * The osculating orbit in force at jd as conic elements in AU, radians and days: { q, e, i, node, peri, tp, mu }.
 * Within 3 hours of a perijove: the nearest of the sets taken every 30 minutes around it (local.pj); elsewhere the
 * nearest daily set, but never one from the far side of a perijove (two-body motion carried through a pass is
 * thousands of km off: Jupiter's oblateness turns the orbit there).
 */
const toConic = (L, [q, e, i, node, peri, tp]) => ({ q: q / AU_KM, e, i: i * DEG, node: node * DEG, peri: peri * DEG, tp, mu: L.gm * KM3S2_TO_AU3D2 });
export function localOrbit(c, jd) {
  const L = c.local;
  if (!L.cache) L.cache = new Map();
  const p = L.pj?.length ? L.pj[nearestPj(L, jd)] : null;
  let key, set;
  if (p && jd >= p.t0 - p.step / 2 && jd <= p.t0 + (p.el.length - 0.5) * p.step) {
    const k = Math.max(0, Math.min(p.el.length - 1, Math.round((jd - p.t0) / p.step))); key = p.tp + ':' + k; set = () => p.el[k];
  } else {
    const n = L.el.length; let k = Math.max(0, Math.min(n - 1, Math.round((jd - L.t0_jd) / L.step_days)));
    const ek = L.t0_jd + k * L.step_days;
    if (p && (p.tp - ek) * (p.tp - jd) < 0) k = Math.max(0, Math.min(n - 1, k + (jd > ek ? 1 : -1)));   // the set is across the perijove: take the one on jd's side
    key = k; set = () => L.el[k];
  }
  let o = L.cache.get(key);
  if (!o) { o = toConic(L, set()); if (L.cache.size > 128) L.cache.clear(); L.cache.set(key, o); }
  return o;
}
function nearestPj(L, jd) {   // binary search in the perijoves (sorted by time)
  let lo = 0, hi = L.pj.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.pj[m].tp < jd) lo = m; else hi = m; }
  return Math.abs(L.pj[lo].tp - jd) < Math.abs(L.pj[hi].tp - jd) ? lo : hi;
}
/** Planet-centred position (AU, ecliptic J2000) at jd, or null outside the local stretch. */
export function localPosition(c, jd, out = {}) { return inLocal(c, jd) ? cometPosition(localOrbit(c, jd), jd, out) : null; }

const MG = {};
/**
 * A centre for callers without a view of their own (the MCP, the tests): the Moon as the Solar System view draws it
 * by default (Earth plus core/planets.js's lunar series), so a Moon orbiter (Chandrayaan) sits on its orbit around that
 * Moon and its distance from that Earth is the Moon's plus the orbit, not the ~2,000 km scatter of its 2-day samples.
 * Earth's centre too ('earth', for Apophis's 2029 flyby in data/solar/apophis.json, which the view draws round the same
 * Earth). Any other centre gives null: Juno, Mars Orbiter Mission and BepiColombo keep their Horizons samples, which beat
 * the approximate planets for a caller that only wants distances from Earth.
 */
export function moonCenterAt(key, jd, out = {}) {
  if (key === 'earth') return earthPosition(jd, out);
  if (key !== 'moon') return null;
  earthPosition(jd, out); moonGeocentric(jd, MG);
  out.x += MG.x; out.y += MG.y; out.z += MG.z; return out;
}

/** Periapsis passages (Juno's perijoves) inside the local stretch: [jd], in time order. */
export const periapses = c => (c.local?.pj || []).map(p => p.tp);

const P = [{}, {}, {}, {}], LP = {}, CP = {};
/**
 * Heliocentric position at jd (AU) into out, or null before the first sample / past the track for a craft that stays.
 * centerAt(key, jd, out) places a planet as the caller draws it; with it, a craft in orbit around that planet is put on
 * its two-body orbit around it (track.local) instead of the heliocentric samples.
 */
export function trackPosition(c, jd, out = {}, centerAt = null) {
  if (centerAt && inLocal(c, jd) && jd >= (c.launch_jd ?? -Infinity) && centerAt(c.local.center, jd, CP)) {
    localPosition(c, jd, LP);
    out.x = CP.x + LP.x; out.y = CP.y + LP.y; out.z = CP.z + LP.z;
    return out;
  }
  const n = sampleCount(c); if (n < 2) return null;
  const f = (jd - c.t0_jd) / c.step_days;
  if (f < 0) return null;
  if (f > n - 1) {
    if (!escaping(c)) return null;
    const v = lastVelocity(c), dt = jd - sampleJd(c, n - 1), x = c.xyz;
    out.x = x[n * 3 - 3] + v.x * dt; out.y = x[n * 3 - 2] + v.y * dt; out.z = x[n * 3 - 1] + v.z * dt;
    return out;
  }
  const k = Math.min(Math.floor(f), n - 2), t = f - k;
  const [p0, p1, p2, p3] = P;
  sample(c, Math.max(k - 1, 0), p0); sample(c, k, p1); sample(c, k + 1, p2); sample(c, Math.min(k + 2, n - 1), p3);
  if (k === 0) { p0.x = 2 * p1.x - p2.x; p0.y = 2 * p1.y - p2.y; p0.z = 2 * p1.z - p2.z; }           // ends: mirror a phantom sample
  if (k + 2 > n - 1) { p3.x = 2 * p2.x - p1.x; p3.y = 2 * p2.y - p1.y; p3.z = 2 * p2.z - p1.z; }
  const t2 = t * t, t3 = t2 * t;
  const w0 = -0.5 * t3 + t2 - 0.5 * t, w1 = 1.5 * t3 - 2.5 * t2 + 1, w2 = -1.5 * t3 + 2 * t2 + 0.5 * t, w3 = 0.5 * t3 - 0.5 * t2;
  out.x = w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x;
  out.y = w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y;
  out.z = w0 * p0.z + w1 * p1.z + w2 * p2.z + w3 * p3.z;
  return out;
}

const A = {}, B = {};
/** Speed relative to the Sun in km/s at jd (central difference over 0.02 day), or null where there is no position.
 *  centerAt as for trackPosition: a craft in orbit around a planet or the Moon then moves on that orbit. */
export function trackSpeed(c, jd, centerAt = null) {
  const h = 0.01;
  if (!trackPosition(c, jd - h, A, centerAt) || !trackPosition(c, jd + h, B, centerAt)) {
    if (!trackPosition(c, jd, A, centerAt) || !trackPosition(c, jd + 2 * h, B, centerAt)) return null;
    return Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) / (2 * h) * AU_KM / 86400;
  }
  return Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) / (2 * h) * AU_KM / 86400;
}

/** Index of the last sample at or before jd (clamped to the track), for drawing "flown so far" and "still to come". */
export function sampleIndex(c, jd) {
  return Math.max(0, Math.min(sampleCount(c) - 1, Math.floor((jd - c.t0_jd) / c.step_days)));
}

/**
 * Where the mission stands at jd: 'before launch' | 'flying' | 'coasting' (past the published track, leaving the Sun)
 * | 'beyond the data' (past the track; no published position).
 */
export function missionPhase(c, jd) {
  if (jd < (c.launch_jd ?? c.t0_jd)) return 'before launch';
  const end = sampleJd(c, sampleCount(c) - 1);
  if (jd <= end) return 'flying';
  return escaping(c) ? 'coasting' : 'beyond the data';
}

/** The craft's status at jd: the latest of its `phases` ([[jd, status], ...]: BepiColombo once Mercury captures it)
 *  reached by then, else its status. */
export function statusAt(c, jd) {
  let s = c.status;
  for (const [t, text] of c.phases || []) if (t <= jd) s = text;
  return s;
}

/** The year a status says the mission ended ('Ended 2017', 'Silent since 2009') as a JD (1 January), or null. */
export function endedJd(c) {
  const m = /^(Ended|Silent since) (\d{4})/.exec(c.status || '');
  return m ? 2451544.5 + (+m[2] - 2000) * 365.25 : null;
}

/**
 * Which samples the view draws at jd: { flown: [first, count], ahead: [first, count], over }. Unfocused, the path
 * flown is the last year (all of it for a craft leaving the Sun, `leaving`) and the path ahead the next half year;
 * focused, the whole track. A craft past its published track (no position: 'beyond the data') or a year past the end
 * of its mission (`over`) draws no lines, unless focused: an orange arc ending in empty space is no use to anyone.
 */
export function trailRanges(c, jd, focused = false, leaving = escaping(c), ended = endedJd(c)) {
  const i = sampleIndex(c, jd), before = jd < c.t0_jd, n = sampleCount(c);
  const from = focused || leaving ? 0 : sampleIndex(c, jd - 365.25), to = focused ? n : sampleIndex(c, jd + 182.6) + 1;
  const over = !focused && ((ended != null && jd > ended + 365.25) || (!leaving && jd > sampleJd(c, n - 1)));
  return { flown: [from, before || over ? 0 : i + 1 - from], ahead: [before ? 0 : i, over ? 0 : Math.max(0, to - (before ? 0 : i))], over };
}

/** The latest event at or before jd and the next one after it: { last: [jd, text] | null, next: [jd, text] | null }. */
export function eventsAround(c, jd) {
  let last = null, next = null;
  for (const e of c.events || []) { if (e[0] <= jd) last = e; else if (!next) next = e; }
  return { last, next };
}

/** "in 3 days", "in 1 year 4 months", "5 hours ago", "now": a span in days, signed (positive = in the future). */
export function relativeTime(days) {
  const a = Math.abs(days), wrap = s => days >= 0 ? 'in ' + s : s + ' ago';
  if (a < 1 / 24) return 'now';
  const pl = (n, u) => `${n} ${u}${n === 1 ? '' : 's'}`;
  if (a < 2) return wrap(pl(Math.round(a * 24), 'hour'));
  if (a < 60) return wrap(pl(Math.round(a), 'day'));
  if (a < 365.25) return wrap(pl(Math.round(a / 30.44), 'month'));
  const y = Math.floor(a / 365.25), m = Math.round((a - y * 365.25) / 30.44);
  return wrap(m && m < 12 && y < 10 ? `${pl(y, 'year')} ${pl(m, 'month')}` : pl(Math.round(a / 365.25), 'year'));
}

/** Mission elapsed time at jd in days since launch (negative before). */
export const missionDays = (c, jd) => jd - (c.launch_jd ?? c.t0_jd);

/** Search words for a craft: its name, aliases and agency. */
export const craftAliases = c => [...(c.alias || []), ...(c.agency ? [c.agency] : [])];

/** Sun-Earth Lagrange points L1 and L2 (heliocentric AU) for Earth at `earth`: on the Sun-Earth line, a Hill radius
 *  r (mu / 3)^(1/3) inside and outside Earth (mu = Earth+Moon over Sun; ~1.5 million km). */
export const EARTH_MOON_MU = 3.0404e-6;
export function lagrangeL1L2(earth, mu = EARTH_MOON_MU) {
  const k = Math.cbrt(mu / 3);
  return { L1: { x: earth.x * (1 - k), y: earth.y * (1 - k), z: earth.z * (1 - k) }, L2: { x: earth.x * (1 + k), y: earth.y * (1 + k), z: earth.z * (1 + k) } };
}

/** One line per mission for a list: { name, phase, au (from Earth) | null, light (s) | null, next: [jd, text] | null }, nearest first.
 *  centerAt as for trackPosition (the view's own planets and Moon, or moonCenterAt). */
export function missionsNow(tracks, jd, earth, centerAt = null) {
  const p = {};
  return tracks.map(c => {
    const at = trackPosition(c, jd, p, centerAt), au = at && jd >= c.launch_jd ? Math.hypot(p.x - earth.x, p.y - earth.y, p.z - earth.z) : null;
    return { name: c.name, status: statusAt(c, jd), phase: missionPhase(c, jd), au, light: au == null ? null : lightSeconds(au), next: eventsAround(c, jd).next };
  }).sort((a, b) => (a.au ?? Infinity) - (b.au ?? Infinity));
}
