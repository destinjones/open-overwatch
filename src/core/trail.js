// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Flight trails: the last N minutes of an aircraft's fixes, kept small (a fix every few seconds for an hour is a lot of
// points on a phone) by dropping repeats and thinning in 3D (Douglas-Peucker on east/north/up metres, so a climb or a
// turn keeps its points while a straight cruise keeps two), and coloured by altitude like the familiar flight-tracker
// ramp. DOM-free.

const RAD = Math.PI / 180, M_PER_DEG = 111320;

/** A trail for one aircraft. Fixes are { t (ms), lat, lon, alt (m, barometric: the colour), h (m, where to draw it;
 *  defaults to alt), ground }. */
export class Trail {
  constructor({ minutes = 30, maxPoints = 600, tolM = 25 } = {}) { this.minutes = minutes; this.maxPoints = maxPoints; this.tolM = tolM; this.pts = []; this.version = 0; }
  /** Add a fix; returns true if the trail changed. Out-of-order or duplicate fixes are ignored; a jump faster than
   *  Mach 3 (a reused address, a bad decode) starts the trail afresh. */
  add(f) {
    if (!f || !Number.isFinite(f.t) || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) return false;
    const last = this.pts[this.pts.length - 1];
    if (last) {
      if (f.t <= last.t) return false;
      const m = flatM(last, f), dt = (f.t - last.t) / 1000;
      if (m < 1 && Math.abs((f.alt || 0) - (last.alt || 0)) < 1) { last.t = f.t; return false; }   // parked: just extend
      if (m / dt > 1000) this.pts = [];
    }
    const alt = Number.isFinite(f.alt) ? f.alt : 0;
    this.pts.push({ t: f.t, lat: f.lat, lon: f.lon, alt, h: Number.isFinite(f.h) ? f.h : alt, ground: !!f.ground });
    this.trim(f.t);
    if (this.pts.length > this.maxPoints) this.pts = thin(this.pts, this.tolM * 2);
    this.version++;
    return true;
  }
  /** Drop what is older than the window (keeps one point before it, so the line reaches the window's edge). */
  trim(now) {
    const cut = now - this.minutes * 60e3; let i = 0;
    while (i < this.pts.length - 1 && this.pts[i + 1].t < cut) i++;
    if (i > 0) { this.pts.splice(0, i); this.version++; }
  }
  /** The points to draw: thinned to tolerance, always keeping the first and the last. */
  draw(tolM = this.tolM) { return thin(this.pts, tolM); }
  get length() { return this.pts.length; }
}

/** Ground distance in metres between two fixes (equirectangular: fine for the seconds between fixes). */
export function flatM(a, b) {
  const k = Math.cos((a.lat + b.lat) / 2 * RAD), dLon = ((b.lon - a.lon + 540) % 360) - 180;
  return Math.hypot((b.lat - a.lat) * M_PER_DEG, dLon * M_PER_DEG * k);
}

/** Douglas-Peucker in local metres (east, north, up) around the first point; iterative, so long trails can't overflow
 *  the stack. */
export function thin(pts, tolM) {
  if (pts.length <= 2) return pts.slice();
  const o = pts[0], k = Math.cos(o.lat * RAD);
  const xyz = pts.map(p => [(((p.lon - o.lon + 540) % 360) - 180) * M_PER_DEG * k, (p.lat - o.lat) * M_PER_DEG, p.alt || 0]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); if (j - i < 2) continue;
    let best = -1, bd = tolM;
    for (let m = i + 1; m < j; m++) { const d = segDist(xyz[m], xyz[i], xyz[j]); if (d > bd) { bd = d; best = m; } }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  // a change between ground and air is kept too (the take-off or touchdown point)
  for (let m = 1; m < pts.length - 1; m++) if (pts[m].ground !== pts[m - 1].ground) keep[m] = keep[m - 1] = 1;
  return pts.filter((_, m) => keep[m]);
}
function segDist(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, t = L2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2)) : 0;
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
}

// altitude ramp (feet -> colour), the one flight trackers use: ground grey, then orange low, through yellow, green,
// cyan and blue to violet at cruise
/** @type {[number, number[]][]} */
const STOPS = [[0, [180, 180, 180]], [500, [255, 120, 30]], [4000, [255, 200, 40]], [10000, [120, 220, 60]], [20000, [40, 210, 200]], [30000, [60, 120, 255]], [40000, [190, 80, 255]]];
/** [r, g, b] (0-255) for an altitude in metres; ground is grey. */
export function altColor(altM, ground = false) {
  if (ground) return STOPS[0][1].slice();
  const ft = Math.max(0, altM / 0.3048);
  if (ft >= STOPS[STOPS.length - 1][0]) return STOPS[STOPS.length - 1][1].slice();
  for (let i = 1; i < STOPS.length; i++) if (ft <= STOPS[i][0]) {
    const [f0, c0] = STOPS[i - 1], [f1, c1] = STOPS[i], w = (ft - f0) / (f1 - f0);
    return c0.map((v, k) => Math.round(v + (c1[k] - v) * w));
  }
  return STOPS[STOPS.length - 1][1].slice();
}
/** The ramp as CSS (for the legend). */
export const altRampCss = () => 'linear-gradient(90deg,' + STOPS.map(([ft, c]) => `rgb(${c.join(',')}) ${Math.round(ft / 400)}%`).join(',') + ')';

/** A trail's numbers for the card: { minutes, km, climbM, descentM, maxAltM }. */
export function trailStats(pts) {
  let km = 0, climb = 0, desc = 0, max = 0;
  for (let i = 1; i < pts.length; i++) {
    km += flatM(pts[i - 1], pts[i]) / 1000;
    const d = (pts[i].alt || 0) - (pts[i - 1].alt || 0); if (d > 0) climb += d; else desc -= d;
  }
  for (const p of pts) max = Math.max(max, p.alt || 0);
  return { minutes: pts.length > 1 ? (pts[pts.length - 1].t - pts[0].t) / 60e3 : 0, km, climbM: climb, descentM: desc, maxAltM: max };
}

/** A trail as a GeoJSON Feature: a LineString of [lon, lat, altitude m] with the fix times alongside (coordTimes, ISO,
 *  as GPX/KML converters read them), for pasting into geojson.io, QGIS or Google Earth. null if under two points. */
export function trailGeoJSON(pts, props = {}) {
  if (!pts || pts.length < 2) return null;
  const r6 = v => Math.round(v * 1e6) / 1e6;
  return { type: 'Feature', properties: { ...props, coordTimes: pts.map(p => new Date(p.t).toISOString()), altitude: 'barometric, metres' },
    geometry: { type: 'LineString', coordinates: pts.map(p => [r6(p.lon), r6(p.lat), Math.round(p.alt || 0)]) } };
}
