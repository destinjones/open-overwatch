// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Satellite passes over an observer: when it rises above a minimum elevation, how high it gets, where it sets, and
// whether you could see it (the satellite in sunlight while your sky is dark). DOM-free: the caller supplies the
// satellite's Earth-fixed position at any time (SGP4 in the browser) and the Sun's direction.

const RAD = 180 / Math.PI;

/** Elevation (deg) and azimuth (deg from north through east) of Earth-fixed point p (km) seen from o = { pos, east, north, up }. */
export function lookAngles(p, o) {
  const dx = p.x - o.pos.x, dy = p.y - o.pos.y, dz = p.z - o.pos.z, r = Math.hypot(dx, dy, dz);
  const e = (dx * o.east.x + dy * o.east.y + dz * o.east.z) / r, n = (dx * o.north.x + dy * o.north.y + dz * o.north.z) / r, u = (dx * o.up.x + dy * o.up.y + dz * o.up.z) / r;
  return { el: Math.asin(Math.max(-1, Math.min(1, u))) * RAD, az: ((Math.atan2(e, n) * RAD) + 360) % 360, range: r };
}

/** Is Earth-fixed point p (km) in sunlight? (cylindrical shadow, sun = unit vector toward the Sun) */
export function sunlit(p, sun, earthR = 6371) {
  const s = p.x * sun.x + p.y * sun.y + p.z * sun.z;
  if (s > 0) return true;
  return Math.hypot(p.x - s * sun.x, p.y - s * sun.y, p.z - s * sun.z) > earthR;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = az => COMPASS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];

/**
 * Passes between t0 and t1 (ms). positionAt(ms) -> {x, y, z} km Earth-fixed (or null); observer { pos, east, north, up }.
 * Options: step (ms, default 20 s), minEl (deg, default 10), sunAt(ms) -> unit vector (Earth-fixed) to flag visibility.
 * Returns [{ rise, peak, set (ms), maxEl, azRise, azPeak, azSet, visible }].
 */
export function findPasses(positionAt, observer, t0, t1, { step = 20e3, minEl = 10, sunAt = null } = {}) {
  const el = t => { const p = positionAt(t); return p ? lookAngles(p, observer).el : -90; };
  const edge = (a, b, rising) => {   // bisect the minEl crossing between a and b
    for (let k = 0; k < 20 && b - a > 500; k++) { const m = (a + b) / 2; if ((el(m) >= minEl) === rising) b = m; else a = m; }
    return (a + b) / 2;
  };
  const out = [];
  let prev = el(t0), tPrev = t0, rise = prev >= minEl ? t0 : null;
  for (let t = t0 + step; t <= t1; t += step) {
    const cur = el(t);
    if (rise == null && cur >= minEl && prev < minEl) rise = edge(tPrev, t, true);
    if (rise != null && cur < minEl && prev >= minEl) {
      const set = edge(tPrev, t, false);
      let peak = rise, best = -90;                                 // golden-section-free: sample, then refine around the best
      for (let s = rise; s <= set; s += 5e3) { const e = el(s); if (e > best) { best = e; peak = s; } }
      for (let h = 2500; h >= 250; h /= 2) for (const s of [peak - h, peak + h]) { const e = el(s); if (e > best) { best = e; peak = s; } }
      // Azimuth at t, or (where SGP4 has already failed at t, e.g. a decaying object) at the nearest valid instant on the way to the peak
      const a = t => { for (let k = 0; k < 16; k++, t = (t + peak) / 2) { const p = positionAt(t); if (p) return lookAngles(p, observer).az; } return null; };
      const pPeak = positionAt(peak), azRise = a(rise), azPeak = a(peak), azSet = a(set);
      let visible = null;
      if (sunAt && pPeak) {
        const sun = sunAt(peak), o = observer, sunEl = Math.asin(sun.x * o.up.x + sun.y * o.up.y + sun.z * o.up.z) * RAD;
        visible = sunEl < -6 && sunlit(pPeak, sun);
      }
      if (azRise != null && azPeak != null && azSet != null) out.push({ rise, peak, set, maxEl: best, azRise, azPeak, azSet, visible });
      rise = null;
    }
    prev = cur; tPrev = t;
  }
  return out;
}

/** A satellite.js record's position (Earth-fixed km) at any ms, or null where SGP4 fails: findPasses's positionAt. `sl` is
 *  the satellite.js library (a page global, or the MCP server's import), so this file stays free of it. */
export const ecfAt = (sl, rec) => ms => {
  const d = new Date(ms), pv = sl.propagate(rec, d);
  if (!pv || !pv.position || isNaN(pv.position.x)) return null;
  const f = sl.eciToEcf(pv.position, sl.gstime(d)); return { x: f.x, y: f.y, z: f.z };
};
/** The next pass (or the one under way) above minEl in the next `hours`, or null. */
export function nextPass(positionAt, obs, now, { minEl = 10, hours = 24, step = 30e3, sunAt = null } = {}) {
  return findPasses(positionAt, obs, now, now + hours * 3600e3, { minEl, step, sunAt })[0] || null;
}
