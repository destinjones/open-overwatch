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
 * offer(x, y, z, sizePx, item, range?): sizePx is the dot's drawn diameter; range: optional [near, far] camera distances
 * (m) it is drawn between. Returns the picker; .item is the winner (null for none), .d its distance from the spot (px).
 * No allocation per offer.
 */
export function makePicker(m, w, h, cam, at, r, { R = EARTH_MIN_R } = {}) {
  const s = { x: 0, y: 0 }, cx = cam.x, cy = cam.y, cz = cam.z, ax = at.x, ay = at.y;
  const pk = {
    item: null, d: Infinity,
    offer(x, y, z, sizePx, item, near = 0, far = Infinity) {
      if (!(x === x && y === y && z === z)) return false;   // NaN positions are never drawn
      if (near > 0 || far < Infinity) {
        const dx = x - cx, dy = y - cy, dz = z - cz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < near * near || d2 > far * far) return false;
      }
      if (!project(m, x, y, z, w, h, s)) return false;
      const reach = r + sizePx / 2, ex = s.x - ax, ey = s.y - ay;
      if (ex > reach || ex < -reach || ey > reach || ey < -reach) return false;   // the cheap box test first
      const d = Math.hypot(ex, ey);
      if (d > reach || d >= pk.d || behindSphere(cx, cy, cz, x, y, z, R)) return false;
      pk.item = item; pk.d = d; return true;
    },
  };
  return pk;
}
