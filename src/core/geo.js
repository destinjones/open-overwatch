// Spherical-Earth geodesy for things that move across the map (aircraft dead reckoning, ship tracks).

export const EARTH_RADIUS_M = 6371000;
const R2D = 180 / Math.PI, D2R = Math.PI / 180;

/** Point reached from (lat, lon) after `dist` metres along initial bearing `bearing` (degrees), on a great circle. */
export function destination(lat, lon, dist, bearing) {
  const d = dist / EARTH_RADIUS_M, th = bearing * D2R, p1 = lat * D2R, l1 = lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * R2D, lon: ((l2 * R2D + 540) % 360) - 180 };
}

/** The unit vector along a course at a point (Earth-fixed, into `out` {x, y, z}): an icon's alignedAxis, which Cesium
 *  turns to the screen every frame, so a plane's nose or a ship's bow follows the true heading from any camera angle
 *  (a fixed north axis drifts with latitude and pitch). */
export function courseAxis(lat, lon, track, out) {
  const p = lat * D2R, l = lon * D2R, c = (track || 0) * D2R, sc = Math.sin(c), cc = Math.cos(c);
  const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  out.x = -sl * sc - sp * cl * cc; out.y = cl * sc - sp * sl * cc; out.z = cp * cc;
  return out;
}

/** Great-circle distance in metres (haversine). */
export function haversine(lat1, lon1, lat2, lon2) {
  const dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Where a moving object is `seconds` after its last fix, flying straight along its track at ground speed `gs` (m/s).
 * Stationary or slow (< 15 m/s, taxiing) objects and those without a track stay put.
 */
export function deadReckon({ lat, lon, gs, track, ground }, seconds) {
  if (ground || !(gs > 15) || track == null || !(seconds > 0)) return { lat, lon };
  return destination(lat, lon, gs * seconds, track);
}

/**
 * Like deadReckon, but holding a constant-rate turn (deg/s, + = right) for up to `maxTurn` seconds, then straight on:
 * an aircraft that was turning between its last two fixes keeps turning instead of flying off along a tangent.
 * Rates under 0.4 or over 4 deg/s are treated as straight (noise, or a rate no airliner holds). Returns { lat, lon, track }.
 */
export function deadReckonArc(o, seconds, turn = 0, maxTurn = 120) {
  if (o.ground || !(o.gs > 15) || o.track == null || !(seconds > 0)) return { lat: o.lat, lon: o.lon, track: o.track };
  const w = Math.abs(turn) >= 0.4 && Math.abs(turn) <= 4 ? turn * D2R : 0;
  if (!w) return { ...destination(o.lat, o.lon, o.gs * seconds, o.track), track: o.track };
  const ta = Math.min(seconds, maxTurn), c0 = o.track * D2R, r = o.gs / w;   // r: signed turn radius
  const e = r * (Math.cos(c0) - Math.cos(c0 + w * ta)), n = r * (Math.sin(c0 + w * ta) - Math.sin(c0));   // east / north of the arc's end
  const end = destination(o.lat, o.lon, Math.hypot(e, n), Math.atan2(e, n) * R2D), track = ((o.track + turn * ta) % 360 + 360) % 360;
  return seconds > ta ? { ...destination(end.lat, end.lon, o.gs * (seconds - ta), track), track } : { ...end, track };
}
