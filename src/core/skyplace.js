// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Where something in the Solar System appears in Earth's sky: its direction (RA/Dec), how far it is from the Sun in
// the sky (elongation), whether that puts it in the evening or the morning sky, and the constellation figure it sits
// nearest (data/constellations.json, the d3-celestial stick figures; the nearest figure, not the IAU boundary).
// Positions are heliocentric ecliptic J2000 AU; the answer is geocentric, J2000, "where to look" accuracy.

import { DEG, eclToEq } from './units.js';

/** RA/Dec (deg, J2000) of an ecliptic vector. */
export function raDecOf(x, y, z) {
  const q = eclToEq(x, y, z), r = Math.hypot(q.x, q.y, q.z);
  return { ra: ((Math.atan2(q.y, q.x) / DEG) + 360) % 360, dec: Math.asin(q.z / r) / DEG };
}

/**
 * target, earth: heliocentric positions { x, y, z } (AU). Returns { ra, dec, delta (AU from Earth), elong (deg from the
 * Sun), east (true = east of the Sun = evening sky), lon (geocentric ecliptic longitude, deg) }.
 */
export function skyPosition(target, earth) {
  const gx = target.x - earth.x, gy = target.y - earth.y, gz = target.z - earth.z, delta = Math.hypot(gx, gy, gz);
  const sx = -earth.x, sy = -earth.y, sz = -earth.z, sr = Math.hypot(sx, sy, sz);
  const elong = Math.acos(Math.max(-1, Math.min(1, (gx * sx + gy * sy + gz * sz) / (delta * sr)))) / DEG;
  const lon = (Math.atan2(gy, gx) / DEG + 360) % 360, sunLon = (Math.atan2(sy, sx) / DEG + 360) % 360;
  const east = ((lon - sunLon + 360) % 360) < 180;
  return { ...raDecOf(gx, gy, gz), delta, elong, east, lon };
}

/** When to look, in words, from the elongation and side. */
export function skyPhrase({ elong, east }) {
  if (elong < 15) return 'lost in the Sun\'s glare';
  if (elong > 150) return 'up all night, opposite the Sun';
  if (elong > 110) return east ? 'in the evening and most of the night' : 'from late evening into the morning';
  if (elong < 40) return east ? 'low in the west after sunset' : 'low in the east before sunrise';
  return east ? 'in the evening sky' : 'in the morning sky';
}

/** Angular distance (deg) between two RA/Dec points. */
export function angularSep(ra1, dec1, ra2, dec2) {
  const c = Math.sin(dec1 * DEG) * Math.sin(dec2 * DEG) + Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.cos((ra1 - ra2) * DEG);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

const unit = (ra, dec) => [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)];
/** Angular distance (deg) from point p to the great-circle arc a-b (all unit vectors). */
function arcSep(p, a, b) {
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nl = Math.hypot(...n);
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], ang = (u, v) => Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) / DEG;
  if (nl < 1e-12) return ang(p, a);
  const k = dot(p, n) / nl, proj = [p[0] - k * n[0] / nl, p[1] - k * n[1] / nl, p[2] - k * n[2] / nl], pl = Math.hypot(...proj);
  if (pl > 1e-12) {
    const f = proj.map(v => v / pl), ab = ang(a, b);
    if (Math.abs(ang(a, f) + ang(f, b) - ab) < 1e-6) return ang(p, f);   // the foot of the perpendicular lies on the arc
  }
  return Math.min(ang(p, a), ang(p, b));
}

/** The constellation figure nearest a direction: { id, name, sep (deg) } or null. figures: constellations.json's figures. */
export function nearestConstellation(ra, dec, figures) {
  const p = unit(ra, dec); let best = null;
  for (const f of figures || []) {
    let d = Infinity;
    for (const l of f.l) for (let k = 0; k + 3 < l.length; k += 2) d = Math.min(d, arcSep(p, unit(l[k], l[k + 1]), unit(l[k + 2], l[k + 3])));
    if (!best || d < best.sep) best = { id: f.id, name: f.name, sep: d };
  }
  return best;
}

/** "RA 17h 45m, Dec −29°" */
export function formatRaDec({ ra, dec }) {
  const h = ra / 15, hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const [H, M] = mm === 60 ? [(hh + 1) % 24, 0] : [hh, mm];
  return `RA ${H}h ${String(M).padStart(2, '0')}m, Dec ${dec < 0 ? '−' : '+'}${Math.abs(Math.round(dec))}°`;
}
