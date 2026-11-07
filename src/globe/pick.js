// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// What is under the pointer. Cesium's scene.pick draws the whole scene again into a pick buffer and waits for the GPU
// (readPixels): with the full satellite catalogue under software WebGL one hover pick was a 27 s task. Dots and icons
// (satellites, aircraft, quakes, lighthouses, airports…: every point and billboard collection in the scene) are picked here
// on the CPU from their screen positions (core/screenpick.js); what they do not cover (3D models, a storm's cone, a fire's
// perimeter) goes to scene.pick, which runs with the dot collections hidden, so it draws a few models instead of tens of
// thousands of dots. The CPU has no idea what is drawn over a dot, so the two are asked in order of closeness: a dot really
// under the pointer, then scene.pick, then a dot merely near it (core/screenpick.js pickInOrder).
import { C } from './env.js';
import { viewer, scene, camera } from './viewer.js';
import { fxShell, cloudShell, limbShell } from './earth.js';
import { Quality } from './quality.js';
import { L } from './layers.js';
import { makePicker, pickInOrder, nearFarScale, makeBackOff } from '../core/screenpick.js';
import { isSoftwareRenderer } from '../core/gpu.js';

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

// a finger covers a lot, and 18,000 satellite dots mean one is nearly always within reach: a satellite counts as touched only
// this near (px); any further and the tap was meant for what lies under it. Other dots are few enough to get the full reach.
const TOUCH_SAT_PX = 8;
const VP = new C.Matrix4();
/** The dot or icon drawn nearest `pos` (window pixels): the picker, with .item, .d and .size. r is the pick's width, so the
 *  reach is r/2 from a dot's edge, as scene.pick's square is. A dot's size is the one it is drawn at. */
function nearestDot(pos, r, touch) {
  const cv = scene.canvas, cam = camera.positionWC;
  C.Matrix4.multiply(camera.frustum.projectionMatrix, camera.viewMatrix, VP);
  const pk = makePicker(VP, cv.clientWidth, cv.clientHeight, cam, pos, r / 2);
  for (const col of collections()) {
    const bb = col instanceof C.BillboardCollection;
    for (let i = 0, n = col.length; i < n; i++) {
      const p = col.get(i);
      if (!p.show) continue;   // hidden
      const o = resolve(p.id); if (!o) continue;   // drawn but not pickable
      if (!bb && p.color && p.color.alpha === 0) continue;
      const q = (bb && p._clampedPosition) || p.position, tbd = p.translucencyByDistance;   // a pin clamped to the ground is drawn at its clamped position (military.js)
      const d2 = C.Cartesian3.distanceSquared(cam, q);
      if (tbd && tbd.farValue <= 0.01 && d2 > tbd.far * tbd.far) continue;   // faded out (Starlink beyond the GEO belt)
      const dd = p.distanceDisplayCondition, sbd = p.scaleByDistance;
      let size = bb ? Math.max(p.width || 24, p.height || 24) * (p.scale || 1) : (p.pixelSize || 4) + 2 * (p.outlineWidth || 0);
      if (sbd) size *= nearFarScale(sbd.near, sbd.nearValue, sbd.far, sbd.farValue, d2);
      pk.offer(q.x, q.y, q.z, size, p, dd ? dd.near : 0, dd ? dd.far : Infinity, touch && o.kind === 'sat' ? TOUCH_SAT_PX : Infinity);
    }
  }
  return pk;
}

// Cesium links a pick program on the main thread the first time something is drawn for a pick. A pick that had to do that says
// nothing about how fast picks are, so it is counted here and left out of the timing.
let links = 0;
{ const gl = scene.context._gl, link = gl.linkProgram.bind(gl); gl.linkProgram = p => { links++; link(p); }; }

const software = () => isSoftwareRenderer(Quality.gpu);
const backOff = makeBackOff();
const shells = [fxShell, cloudShell, limbShell];
/** Run a scene pick with the dots hidden, and the Earth's shells: they are not pickable, but from above they still cover
 *  everything under them in the pick buffer (storm cones, corridors and models could not be picked from space). */
function withoutDots(fn) {
  const off = collections();
  for (const s of shells) if (s.primitive.show) off.push(s.primitive);
  for (const c of off) c.show = false;
  try { return fn(); } finally { for (const c of off) c.show = true; }
}

// could scene.pick alone find anything at `pos`? A model near the spot (the nearest few satellites always have one, GPS and GEO
// ones even from the opening height), an entity with an owner, or a layer drawing lines, shapes or buildings of its own.
// Labels don't count: each stands beside a dot that picks the same thing.
const MODEL_PX = 60, MODEL_CLOSE_M = 2e4;
function sceneTargets(pos) {
  if (L.reentry?.on || L.fires?.on || L.traffic?.on || L.alpr?.on || L.ships?.on || L.buildings?.on) return true;
  const time = viewer.clock.currentTime;
  for (const e of viewer.entities.values) {
    if (!(e.sat || e.air || e.obj) || !e.isShowing) continue;
    if (e.obj) return true;
    const q = e.position?.getValue(time), w = q && C.SceneTransforms.worldToWindowCoordinates(scene, q);
    if (w && (Math.hypot(w.x - pos.x, w.y - pos.y) < MODEL_PX || C.Cartesian3.distance(camera.positionWC, q) < MODEL_CLOSE_M)) return true;
  }
  for (let i = 0; i < viewer.dataSources.length; i++) { const ds = viewer.dataSources.get(i); if (ds.show && ds.entities.values.some(e => e.obj && e.isShowing)) return true; }
  return false;
}

/** scene.pick for what is not a dot (models, entities). hover: skipped while picks are slow (core/screenpick.js makeBackOff),
 *  and always when WebGL is drawn in software, where a pick is tens of seconds however few things it draws; a click there
 *  asks only when there is something for it to find. */
export function pickScene(pos, r, { hover = false } = {}) {
  if (software() ? hover || !sceneTargets(pos) : hover && !backOff.allowed(performance.now())) return null;
  const t0 = performance.now(), linked = links;
  try { return withoutDots(() => resolve(scene.pick(pos, r, r)?.id)); }
  catch (e) { console.warn('pick', e); backOff.failed(performance.now()); return null; }   // never let a pick take the render loop down with it
  finally { const now = performance.now(); if (links === linked) backOff.took(now - t0, now); }
}

/** What is under `pos`, in order of closeness. r: the pick's width in px; hover: a hover pick (see pickScene); touch: a finger. */
export function pickAt(pos, r, { hover = false, touch = false } = {}) {
  const pk = nearestDot(pos, r, touch);
  return pickInOrder(pk.item && resolve(pk.item.id), pk.d, pk.size, r, () => pickScene(pos, r, { hover }));
}

/** Link the pick programs now, one scene pick as wide as the canvas (a smaller one only draws what lies under it), so the
 *  first hover or tap doesn't freeze (about half a second on a desktop GPU). Not in software, where hover never asks and this one pick would be tens of seconds. It never
 *  touches the back-off. Returns how many programs it linked. */
export function warmPick() {
  if (software()) return 0;
  const cv = scene.canvas, linked = links;
  try { withoutDots(() => scene.pick(new C.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2), cv.clientWidth, cv.clientHeight)); }
  catch (e) { console.warn('warm pick', e); }
  return links - linked;
}

/** Hide every dot or icon whose position is not a finite number and park it at the centre of the Earth. This does not cure
 *  a failing render: a NaN position does not spread into a collection's bounding sphere (BoundingSphere.expand skips it), and
 *  the "Invalid array length" failures seen were a NaN camera (main.js, viewer.js). It keeps a bad dot from being picked, and
 *  the count it returns is logged in case some other cause turns up. */
export function dropBadPositions() {
  let n = 0;
  for (const col of collections()) for (let i = 0, k = col.length; i < k; i++) {
    const p = col.get(i), q = p.position;
    if (q && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z)) continue;
    p.show = false; p.position = C.Cartesian3.ZERO; n++;
  }
  return n;
}
