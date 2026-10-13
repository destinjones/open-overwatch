// Runways: which way each runway end faces, the wind along and across it, the runway a plane is lined up with, and
// the runway in use (the one arrivals are lined up with, else the one most into the wind). From OurAirports runway
// rows (data/runways.json, built by brand/tools/make_airports.py). DOM-free.

import { gcKm, bearing } from './actype.js';

const RAD = Math.PI / 180;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** data/runways.json { runways: [[icao, leIdent, heIdent, leLat, leLon, heLat, heLon, lengthFt, surface], ...] } as
 *  a Map icao -> [{ ends: [end, end], lengthFt, surface }], each end { ident, lat, lon, hdg } facing the way planes
 *  land on it (from that end's threshold towards the other). Rows without both thresholds are dropped. */
export function parseRunways(json) {
  const rows = json && Array.isArray(json.runways) ? json.runways : [], out = new Map();
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 7) continue;
    const [icao, le, he, laLat, laLon, haLat, haLon, lengthFt, surface] = r;
    if (typeof icao !== 'string' || ![laLat, laLon, haLat, haLon].every(Number.isFinite)) continue;
    if (gcKm(laLat, laLon, haLat, haLon) < 0.2) continue;   // a helipad or a bad row
    const a = { ident: String(le || '').slice(0, 4), lat: laLat, lon: laLon, hdg: bearing(laLat, laLon, haLat, haLon) };
    const b = { ident: String(he || '').slice(0, 4), lat: haLat, lon: haLon, hdg: bearing(haLat, haLon, laLat, laLon) };
    const rw = { ends: [a, b], lengthFt: Number.isFinite(lengthFt) ? lengthFt : null, surface: typeof surface === 'string' ? surface.slice(0, 12) : '' };
    a.rw = b.rw = rw;
    (out.get(icao) || out.set(icao, []).get(icao)).push(rw);
  }
  return out;
}

/** Wind (from windDir °, speed) on a runway heading: { head (+ into the wind), cross (+ from the right) } in the
 *  wind's units. */
export function windOn(hdg, windDir, speed) {
  const rel = (windDir - hdg) * RAD;
  return { head: speed * Math.cos(rel), cross: speed * Math.sin(rel) };
}

/** Every runway end of an airport with its wind: [{ end, head, cross }], most headwind first. */
export function windTable(runways, windDir, speed) {
  const out = [];
  for (const rw of runways || []) for (const end of rw.ends) out.push({ end, ...windOn(end.hdg, windDir, speed) });
  return out.sort((x, y) => y.head - x.head);
}

/**
 * Is a plane lined up to land on this runway end? Within 20 km of the threshold, on the near side of it, within 1 km
 * of the extended centre line (and 4° of it further out), and tracking within 20° of the runway heading.
 * Returns { km (to the threshold), off (m from the centre line) } or null.
 */
export function linedUp(end, p) {
  if (!p || p.ground || p.track == null || !Number.isFinite(p.lat)) return null;
  const km = gcKm(p.lat, p.lon, end.lat, end.lon);
  if (km > 20 || km < 0.05 || angDiff(p.track, end.hdg) > 20) return null;
  const toThr = bearing(p.lat, p.lon, end.lat, end.lon), dev = ((toThr - end.hdg + 540) % 360) - 180;
  if (Math.abs(dev) > 90) return null;   // past the threshold
  const off = Math.abs(Math.sin(dev * RAD)) * km * 1000;
  if (off > Math.max(1000, km * 1000 * Math.tan(4 * RAD))) return null;
  return { km, off };
}

/** The runway end a plane is lined up with, out of all an airport has: { end, km, off } or null. */
export function finalFor(runways, p) {
  let best = null;
  for (const rw of runways || []) for (const end of rw.ends) {
    const l = linedUp(end, p); if (l && (!best || l.off < best.off)) best = { end, ...l };
  }
  return best;
}

/**
 * The runway in use: the end most arrivals are lined up with ({ end, how: 'arrivals', n }), else the end most into the
 * wind ({ end, how: 'wind', head }), else null. Light wind (< 5 kt) says little, so arrivals decide first.
 */
export function runwayInUse(runways, arrivals = [], wind = null) {
  const n = new Map();
  for (const p of arrivals) { const f = finalFor(runways, p); if (f) n.set(f.end, (n.get(f.end) || 0) + 1); }
  if (n.size) { const [end, k] = [...n.entries()].sort((x, y) => y[1] - x[1])[0]; return { end, how: 'arrivals', n: k }; }
  if (wind && wind.speed != null && wind.dir != null && wind.speed >= 5) {
    const t = windTable(runways, wind.dir, wind.speed); if (t.length) return { end: t[0].end, how: 'wind', head: t[0].head };
  }
  return null;
}
