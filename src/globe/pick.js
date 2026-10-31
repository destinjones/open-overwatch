// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// What is under the pointer. Cesium's scene.pick draws the whole scene again into a pick buffer and waits for the GPU
// (readPixels): with the full satellite catalogue under software WebGL one hover pick was a 27 s task, and the globe then
// stopped drawing (perf run 2026-10-31, finding 1). Dots and icons (satellites, aircraft, quakes, lighthouses, airports…:
// every point and billboard collection in the scene) are picked here on the CPU from their screen positions
// (core/screenpick.js); only what they do not cover (3D models, a storm's cone, a fire's perimeter) goes to scene.pick, and
// that pick runs with the dot collections hidden, so it draws a few models instead of tens of thousands of dots. A slow
// scene pick (or one that throws) turns hover picks of that kind off for a while; clicks still ask.
import { C } from './env.js';
import { scene, camera } from './viewer.js';
import { makePicker } from '../core/screenpick.js';

/** The thing behind a picked id: points carry the object itself; model entities carry .sat / .air; .obj is an entity
 *  drawn for something (a storm's cone, a fire's perimeter). */
export const resolve = id => (id ? (id.kind ? id : id.sat || id.air || id.obj || null) : null);

// every shown point and billboard collection, nested ones too (LabelCollections keep their billboards inside: not listed)
function collections(col = scene.primitives, out = []) {
  for (let i = 0, n = col.length; i < n; i++) {
    const p = col.get(i);
    if (!p || p.show === false) continue;
    if (p instanceof C.PointPrimitiveCollection || p instanceof C.BillboardCollection) out.push(p);
    else if (p instanceof C.PrimitiveCollection) collections(p, out);
  }
  return out;
}

const VP = new C.Matrix4();
/** The dot or icon drawn nearest `pos` (window pixels) within r px of its edge, or null. */
export function pickDots(pos, r) {
  const cv = scene.canvas;
  C.Matrix4.multiply(camera.frustum.projectionMatrix, camera.viewMatrix, VP);
  const pk = makePicker(VP, cv.clientWidth, cv.clientHeight, camera.positionWC, pos, r);
  for (const col of collections()) {
    const bb = col instanceof C.BillboardCollection;
    for (let i = 0, n = col.length; i < n; i++) {
      const p = col.get(i);
      if (!p.show || !resolve(p.id)) continue;   // hidden, or drawn but not pickable
      if (!bb && p.color && p.color.alpha === 0) continue;
      const q = p.position, tbd = p.translucencyByDistance;
      if (tbd && tbd.farValue <= 0.01 && C.Cartesian3.distanceSquared(camera.positionWC, q) > tbd.far * tbd.far) continue;   // faded out (Starlink beyond the GEO belt)
      const dd = p.distanceDisplayCondition, size = bb ? Math.max(p.width || 24, p.height || 24) * (p.scale || 1) : (p.pixelSize || 4) + 2 * (p.outlineWidth || 0);
      pk.offer(q.x, q.y, q.z, size, p, dd ? dd.near : 0, dd ? dd.far : Infinity);
    }
  }
  return pk.item ? resolve(pk.item.id) : null;
}

let slowUntil = 0;
const SLOW_MS = 250, BACK_OFF_MS = 60e3;
/** scene.pick for what is not a dot (models, entities), with the dot collections hidden. hover: skipped while picks are
 *  slow (one took over 250 ms, or threw, in the last minute). */
export function pickScene(pos, r, { hover = false } = {}) {
  if (hover && performance.now() < slowUntil) return null;
  const hidden = collections();
  for (const c of hidden) c.show = false;
  const t0 = performance.now();
  try { return resolve(scene.pick(pos, r, r)?.id); }
  catch (e) { console.warn('pick', e); slowUntil = performance.now() + BACK_OFF_MS; return null; }   // never let a pick take the render loop down with it
  finally {
    for (const c of hidden) c.show = true;
    if (performance.now() - t0 > SLOW_MS) slowUntil = performance.now() + BACK_OFF_MS;
  }
}

/** What is under `pos`: a dot or icon first, else a model or entity. */
export function pickAt(pos, r, opts) { return pickDots(pos, r) || pickScene(pos, r, opts); }

/** Hide every dot or icon whose position is not a finite number and park it at the centre of the Earth. One NaN position
 *  makes its collection's bounding sphere NaN, and Cesium's frustum count with it: "RangeError: Invalid array length" in
 *  createPotentiallyVisibleSet on every frame (main.js calls this when a render fails). Returns how many it fixed. */
export function dropBadPositions() {
  let n = 0;
  for (const col of collections()) for (let i = 0, k = col.length; i < k; i++) {
    const p = col.get(i), q = p.position;
    if (q && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z)) continue;
    p.show = false; p.position = C.Cartesian3.ZERO; n++;
  }
  return n;
}
