// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Picking dots on the CPU: which of many world points (metres, Earth-fixed) is drawn nearest a spot on the screen. The
// globe's GPU pick draws the whole scene again into a pick buffer and reads it back; with ~18,000 satellite dots under
// software WebGL that was one 27 s task and then a dead globe (perf run 2026-10-31). Projecting the dots is a few
// multiplies each. DOM-free and Cesium-free: the view hands in its view-projection matrix and canvas size.

/** The Earth's polar radius (m): a dot is hidden when the line from the camera to it passes inside this sphere. A little
 *  under the equatorial radius, so dots on the ground near the limb are never hidden by mistake. */
export const EARTH_MIN_R = 6356752;

/** World (x, y, z) → window pixels (top-left origin) with a column-major 4 × 4 view-projection matrix `m` (Cesium's
 *  Matrix4 layout) and a w × h canvas. False (and `out` untouched) for points behind the camera. */
export function project(m, x, y, z, w, h, out) {
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (!(cw > 1e-9)) return false;
  out.x = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw + 1) * 0.5 * w;
  out.y = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw) * 0.5 * h;
  return true;
}

/** True when the straight line from the camera (cx, cy, cz) to the point passes inside a sphere of radius R about the
 *  origin: the point is on the far side of the Earth. */
export function behindSphere(cx, cy, cz, px, py, pz, R = EARTH_MIN_R) {
  const dx = px - cx, dy = py - cy, dz = pz - cz, L2 = dx * dx + dy * dy + dz * dz;
  if (!(L2 > 0)) return false;
  const t = -(cx * dx + cy * dy + cz * dz) / L2;   // where the line comes closest to the centre
  if (t <= 0 || t >= 1) return false;               // ...beyond either end: both ends are outside, nothing in between
  const qx = cx + t * dx, qy = cy + t * dy, qz = cz + t * dz;
  return qx * qx + qy * qy + qz * qz < R * R;
}

/**
 * A picker for one spot and one camera: offer it every candidate, it keeps the one drawn nearest the spot.
 * at: { x, y } in window pixels; r: how far from a dot's edge still counts (px); cam: { x, y, z } camera position.
 * offer(x, y, z, sizePx, item, near?, far?, cap?): sizePx is the dot's drawn diameter; near, far: camera distances (m) it is
 * drawn between; cap: px, its reach is no more than this however big r is (a finger's reach for a satellite, pick.js).
 * Returns the picker; .item is the winner (null for none), .d its distance from the spot (px), .size its sizePx.
 * No allocation per offer.
 */
export function makePicker(m, w, h, cam, at, r, { R = EARTH_MIN_R } = {}) {
  const s = { x: 0, y: 0 }, cx = cam.x, cy = cam.y, cz = cam.z, ax = at.x, ay = at.y;
  const pk = {
    item: null, d: Infinity, size: 0,
    offer(x, y, z, sizePx, item, near = 0, far = Infinity, cap = Infinity) {
      if (!(x === x && y === y && z === z)) return false;   // NaN positions are never drawn
      if (near > 0 || far < Infinity) {
        const dx = x - cx, dy = y - cy, dz = z - cz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < near * near || d2 > far * far) return false;
      }
      if (!project(m, x, y, z, w, h, s)) return false;
      const reach = Math.min(r + sizePx / 2, cap), ex = s.x - ax, ey = s.y - ay;
      if (ex > reach || ex < -reach || ey > reach || ey < -reach) return false;   // the cheap box test first
      const d = Math.hypot(ex, ey);
      if (d > reach || d >= pk.d || behindSphere(cx, cy, cz, x, y, z, R)) return false;
      pk.item = item; pk.d = d; pk.size = sizePx; return true;
    },
  };
  return pk;
}

/** The factor Cesium's NearFarScalar gives at a squared camera distance d2 (the shaders' czm_nearFarScalar): what a dot with
 *  scaleByDistance is drawn at, for picking what is drawn rather than its nominal size. */
export function nearFarScale(near, nearValue, far, farValue, d2) {
  const n2 = near * near, t = Math.min(1, Math.max(0, (d2 - n2) / (far * far - n2)));
  return nearValue + (farValue - nearValue) * Math.pow(t, 0.2);
}

/**
 * What is under the pointer, asking in order of closeness. A dot picked on the CPU knows nothing of what is drawn over or
 * under it, so a dot only beats scene.pick when the pointer is really on it (its drawn radius plus a quarter of r); a
 * dot merely nearby (out to r/2 from its edge: the old pick square) wins only if scene.pick finds nothing.
 * dot: the nearest dot's object or null; d, size: its distance from the spot and drawn diameter (px); r: the pick's width.
 * ask(): the scene pick, called only when needed.
 */
export function pickInOrder(dot, d, size, r, ask) {
  if (dot && d <= size / 2 + r / 4) return dot;
  return ask() || dot || null;
}

/**
 * When to stop asking a slow thing (scene.pick): after an answer that took over slowMs, or a failure, not again for baseMs,
 * doubling up to maxMs for as long as it stays slow; one quick answer starts the wait over from baseMs.
 * allowed(now): may it be asked now. took(ms, now): an answer took ms. failed(now): it threw.
 */
export function makeBackOff({ slowMs = 250, baseMs = 60e3, maxMs = 600e3 } = {}) {
  let until = 0, wait = baseMs;
  const arm = now => { until = now + wait; wait = Math.min(wait * 2, maxMs); };
  return {
    allowed: now => now >= until,
    took(ms, now) { if (ms > slowMs) arm(now); else wait = baseMs; },
    failed: arm,
  };
}
