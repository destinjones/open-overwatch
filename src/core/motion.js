// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Motion and loading helpers for the Solar System view (src/solar), DOM-free and three.js-free so Node can test them:
// one easing curve for every camera flight, distance blended on a log scale, a view direction that turns without
// passing through zero, chunk ranges for spreading a big GPU upload over frames, and a loading meter that only moves forward.

/** Seconds per kind of camera move: the flights, the tour and the hand-over from the globe all use these. */
export const FLIGHT = { focus: 2.2, rung: 2.4, far: 3, tour: 3.2, handover: 1.6, calm: 0.05 };

/** Cubic ease in and out on [0, 1] (clamped): starts and ends at rest, so a flight never jerks at either end. */
export function ease(s) {
  const t = Math.min(1, Math.max(0, s));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Distance d0 -> d1 at e in [0, 1], on a log scale: zooming across decades feels even. Both must be > 0. */
export const logLerp = (d0, d1, e) => Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * e);

/**
 * Unit vector a turned toward unit vector b by e in [0, 1], along the great circle (slerp), written into out {x, y, z}.
 * A plain lerp of nearly opposite directions passes through zero mid-flight and the view flips in one frame; here
 * opposite directions turn about an axis at right angles to them instead.
 */
export function slerpDir(a, b, e, out = { x: 0, y: 0, z: 0 }) {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  if (dot > 0.9995) {   // nearly the same: a lerp is exact enough, then normalise
    const x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e, z = a.z + (b.z - a.z) * e, n = Math.hypot(x, y, z) || 1;
    out.x = x / n; out.y = y / n; out.z = z / n; return out;
  }
  if (dot < -0.9995) {   // opposite: a quarter turn to a perpendicular (a x helper axis), then on to b
    const hx = Math.abs(a.x) < 0.9 ? 1 : 0, hy = 1 - hx;
    const cx = -a.z * hy, cy = a.z * hx, cz = a.x * hy - a.y * hx, n = Math.hypot(cx, cy, cz), c = { x: cx / n, y: cy / n, z: cz / n };
    return e <= 0.5 ? slerpDir(a, c, e * 2, out) : slerpDir(c, b, e * 2 - 1, out);
  }
  const th = Math.acos(dot), s = Math.sin(th), k0 = Math.sin((1 - e) * th) / s, k1 = Math.sin(e * th) / s;
  out.x = a.x * k0 + b.x * k1; out.y = a.y * k0 + b.y * k1; out.z = a.z * k0 + b.z * k1; return out;
}

/** [start, end) ranges covering 0..n in pieces of at most size (the last may be shorter). */
export function chunkRanges(n, size) {
  const out = [], step = Math.max(1, Math.floor(size));
  for (let i = 0; i < n; i += step) out.push([i, Math.min(n, i + step)]);
  return out;
}

/**
 * A loading meter for files whose bytes don't report progress. tasks: { id: weight } (weight ~ bytes). Each started
 * task creeps toward 90% of its weight while in flight (fast at first, then slower), and counts in full when done or
 * failed. value(now) is never lower than it was before, and moves at most `rate` per second, so the bar never jumps.
 */
export function createProgress(tasks, { rate = 1.6, halfLife = 1200 } = {}) {
  const total = Object.values(tasks).reduce((a, b) => a + b, 0) || 1, state = {};
  let shown = 0, last = null;
  const P = {
    start(id, now) { if (tasks[id] != null && !state[id]) state[id] = { t0: now, done: false }; },
    finish(id, now) { if (tasks[id] == null) return; if (!state[id]) state[id] = { t0: now, done: true }; state[id].done = true; },
    /** The share of the work done or reasonably expected done by now, 0..1 (not smoothed). */
    target(now) {
      let w = 0;
      for (const id in tasks) {
        const s = state[id]; if (!s) continue;
        w += s.done ? tasks[id] : tasks[id] * 0.9 * (1 - Math.pow(0.5, Math.max(0, now - s.t0) / halfLife));
      }
      return Math.min(1, w / total);
    },
    get complete() { return Object.keys(tasks).every(id => state[id] && state[id].done); },
    /** The meter to draw at time now (ms), 0..1: eased toward target, never backwards. */
    value(now) {
      const dt = last == null ? 0 : Math.max(0, now - last) / 1000; last = now;
      const t = P.target(now);
      if (t > shown) shown = Math.min(t, shown + rate * dt);
      return shown;
    },
  };
  return P;
}
