// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// What a plane is doing right now, in the words a pilot would use: parked, taxiing, take-off roll, take-off, climbing,
// cruise, level, descending, approach, final, landing roll; from its own fix (ground flag, speeds, vertical rate,
// altitude) and the nearest airport (for height above the field and whether it is lined up). DOM-free.

import { gcKm, bearing } from './actype.js';

const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export const PHASES = {
  parked: 'Parked', taxiing: 'Taxiing', roll: 'Take-off or landing roll', takeoff: 'Taking off', climb: 'Climbing',
  cruise: 'Cruising', level: 'Level flight', descent: 'Descending', approach: 'On approach', final: 'On final',
  hover: 'Hovering or slow', unknown: '—',
};

/**
 * p: { ground, gs (m/s), vr (m/s), alt (m barometric), track, lat, lon, cls? (core/actype class) };
 * ap: { lat, lon, elevM } the nearest airport, or null. Returns { phase, words, agl (m, or null), apKm (or null) }.
 * Helicopters hover and climb slowly; their thresholds are lower.
 */
export function flightPhase(p, ap = null) {
  if (!p) return { phase: 'unknown', words: PHASES.unknown, agl: null, apKm: null };
  const gs = p.gs ?? null, vr = p.vr || 0, heli = p.cls === 'helicopter';
  const apKm = ap && Number.isFinite(p.lat) ? gcKm(p.lat, p.lon, ap.lat, ap.lon) : null;
  const near = apKm != null && apKm < 40;
  const agl = p.ground ? 0 : Number.isFinite(p.alt) ? p.alt - (near ? ap.elevM || 0 : 0) : null;
  const out = phase => ({ phase, words: PHASES[phase], agl, apKm });
  if (p.ground) {
    if (gs == null || gs < 3) return out('parked');
    return out(gs < (heli ? 15 : 25) ? 'taxiing' : 'roll');
  }
  if (heli && gs != null && gs < 15 && Math.abs(vr) < 2) return out('hover');
  const climb = heli ? 1.5 : 2.5, desc = heli ? -1.5 : -2.5;
  if (vr > climb) return out(near && agl != null && agl < 450 && apKm < 8 ? 'takeoff' : 'climb');
  if (vr < desc) {
    if (near && agl != null && agl < 900 && apKm < 15 && p.track != null && angDiff(p.track, bearing(p.lat, p.lon, ap.lat, ap.lon)) < 30) return out('final');
    if (near && agl != null && agl < 3000) return out('approach');
    return out('descent');
  }
  if (Number.isFinite(p.alt) && p.alt > 6000 && !heli) return out('cruise');
  if (near && agl != null && agl < 600 && apKm < 10 && p.track != null && angDiff(p.track, bearing(p.lat, p.lon, ap.lat, ap.lon)) < 30) return out('final');
  return out('level');
}

/**
 * The phase line of an aircraft card, the same on every view: { head ("On final for 13L"), where ("3 km from JFK, 137 ft
 * above it"), code (the airport's) } or null when the phase is unknown. f: flightPhase's answer; ap: the nearest airport
 * with .km; fin: the runway end it is lined up with; fmt: the view's number format.
 */
export function phaseWords(f, ap, { fin = null, ground = false, fmt = n => Math.round(n).toLocaleString('en-US') } = {}) {
  if (!f || f.phase === 'unknown') return null;
  const head = f.words + (fin && (f.phase === 'final' || f.phase === 'approach') ? ' for ' + fin.end.ident : '');
  if (!ap) return { head, where: '', code: '' };
  const code = ap.iata || ap.icao, above = f.agl != null && !ground && ap.km < 40 ? `, ${fmt(Math.max(0, f.agl) / 0.3048)} ft above it` : '';
  return { head, where: `${fmt(ap.km)} km from ${code}${above}`, code };
}

/** Points along the great circle from 1 to 2 (n + 1 of them, both ends included), as [lat, lon]; lon kept continuous
 *  across the antimeridian (it may run past ±180, which globes draw fine). */
export function greatCircle(lat1, lon1, lat2, lon2, n = 64) {
  const R = Math.PI / 180, f1 = lat1 * R, l1 = lon1 * R, f2 = lat2 * R, l2 = lon2 * R;
  const a = [Math.cos(f1) * Math.cos(l1), Math.cos(f1) * Math.sin(l1), Math.sin(f1)], b = [Math.cos(f2) * Math.cos(l2), Math.cos(f2) * Math.sin(l2), Math.sin(f2)];
  const d = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const out = [];
  let prevLon = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x, y, z;
    if (d < 1e-9) [x, y, z] = a;
    else { const s = Math.sin(d), k1 = Math.sin((1 - t) * d) / s, k2 = Math.sin(t * d) / s; x = k1 * a[0] + k2 * b[0]; y = k1 * a[1] + k2 * b[1]; z = k1 * a[2] + k2 * b[2]; }
    let lon = Math.atan2(y, x) / R;
    if (prevLon != null) lon += Math.round((prevLon - lon) / 360) * 360;
    prevLon = lon;
    out.push([Math.atan2(z, Math.hypot(x, y)) / R, lon]);
  }
  return out;
}
