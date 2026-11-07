// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Cesium viewer, camera limits, shared primitive collections and the star background.
import { C, $, PHONE, loadImage } from './env.js';

export const viewer = new C.Viewer('globe', {
  baseLayer: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
  shouldAnimate: true,
  skyBox: false,                        // ours loads below; the default one was 0.9 MB downloaded only to be replaced
  showRenderLoopErrors: false,          // main.js recovers from a failed frame: no panel left over a globe that is drawing again
  msaaSamples: 1,                       // 4x MSAA blanked the globe and sky in testing; FXAA instead
  orderIndependentTranslucency: false,  // OIT ignores custom blending: the premultiplied glint/cloud-shadow shell vanished under it
  contextOptions: { webgl: { powerPreference: 'high-performance' } },
});
viewer.clock.clockStep = C.ClockStep.SYSTEM_CLOCK;
export const scene = viewer.scene, globe = scene.globe, camera = viewer.camera, ctrl = scene.screenSpaceCameraController;
// "Reduce motion" (a phone or OS setting): camera flights jump instead of swooping
export const CALM = matchMedia('(prefers-reduced-motion: reduce)');
{
  // flights start and land gently (Cesium's default is linear in time: a jolt at take-off and a hard stop), unless the
  // caller chose its own easing
  const ease = o => o.easingFunction ? o : { ...o, easingFunction: C.EasingFunction.CUBIC_IN_OUT };
  const calm = o => CALM.matches ? { ...o, duration: 0 } : ease(o), flyTo = camera.flyTo.bind(camera), flySphere = camera.flyToBoundingSphere.bind(camera);
  camera.flyTo = o => flyTo(calm(o));                                  // flyTo(options)
  camera.flyToBoundingSphere = (sphere, o = {}) => flySphere(sphere, calm(o));
  // Cesium's wheel and pinch zoom turns the camera from the point under the pointer towards the one under the canvas centre:
  // with the pointer on the exact centre pixel those are the same point, and a dot product a hair under 1 lets through a
  // rotation about a zero axis. The quaternion and then the whole camera go NaN, and every later frame throws.
  const rotate = camera.rotate.bind(camera);
  camera.rotate = (axis, angle) => { if (axis && Number.isFinite(angle) && axis.x * axis.x + axis.y * axis.y + axis.z * axis.z > 0) rotate(axis, angle); };
}
$('#credits').appendChild(viewer.cesiumWidget.creditContainer);
scene.backgroundColor = C.Color.fromCssColorString('#04060a');
// FXAA and the render resolution follow the graphics level (quality.js)
if (!scene.moon) scene.moon = new C.Moon();
if (!scene.sun) scene.sun = new C.Sun();   // Cesium only makes the Sun (and Moon) along with its default sky box, which we skip
scene.moon.show = true; scene.sun.show = true; scene.sun.glowFactor = 1.6;   // a brilliant star from orbit, not a dull disc
ctrl.maximumZoomDistance = 6.0e8;   // past the Moon (~384,000 km)
ctrl.minimumZoomDistance = 150;
// The camera controller reads a depth pixel back from the GPU (readPixels) on every zoom / pinch step to find the point
// under the cursor: a full pipeline stall each time, 1.25 s of a phone's hand-off pinch. This globe has no terrain or
// 3D tiles, so the ellipsoid intersection it falls back to is the same point. (Nothing else here uses pickPosition.)
Object.defineProperty(scene, 'pickPositionSupported', { get: () => false });

// stars: NASA SVS Deep Star Maps 2020 as cube faces in ICRF axes (brand/tools/make_skybox.py; 1024 px faces on phones).
// Cesium.SkyBox reads each face vertically flipped vs the OpenGL convention; make_skybox.py writes them that way.
{
  const dir = PHONE ? 'brand/textures/sky_1k/' : 'brand/textures/sky/';
  const faces = { positiveX: 'px', negativeX: 'nx', positiveY: 'py', negativeY: 'ny', positiveZ: 'pz', negativeZ: 'nz' };
  Promise.all(Object.entries(faces).map(([k, f]) => loadImage(dir + f + '.jpg').then(img => [k, img])))
    .then(list => { scene.skyBox = new C.SkyBox({ sources: Object.fromEntries(list) }); })
    .catch(e => { console.warn('Star map unavailable, using the default sky:', e.message); scene.skyBox = C.SkyBox.createEarthSkyBox(); });
}
viewer.creditDisplay.addStaticCredit(new C.Credit('Stars: NASA/Goddard Space Flight Center Scientific Visualization Studio; Gaia DR2: ESA/Gaia/DPAC'));

export const satPts = scene.primitives.add(new C.PointPrimitiveCollection({ blendOption: C.BlendOption.TRANSLUCENT }));
export const airPts = scene.primitives.add(new C.PointPrimitiveCollection());
export const airIcons = scene.primitives.add(new C.BillboardCollection({ scene }));
export const qkPts = scene.primitives.add(new C.PointPrimitiveCollection());
export const orbitLines = scene.primitives.add(new C.PolylineCollection());

// A NaN camera (any road to it, whatever viewer.js and ui.js guard) can't be drawn: the globe's tile walk then descends the
// whole quadtree and hangs the tab, or the frame throws. So the last whole camera is kept and put back the moment one goes
// NaN: before each frame's update (after the controller's zoom and the flights have run) and again before it is drawn
// (after the follow camera).
const good = { ok: false, transform: new C.Matrix4(), position: new C.Cartesian3(), direction: new C.Cartesian3(), up: new C.Cartesian3(), right: new C.Cartesian3() };
const whole = v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const cameraWhole = () => whole(camera.position) && whole(camera.direction) && whole(camera.up) && whole(camera.right) && whole(camera.positionWC) && whole(camera.directionWC) && whole(camera.upWC);
/** If the camera has gone NaN, stop any flight and put back the last whole one. True when it did. */
export function restoreCamera() {
  if (cameraWhole() || !good.ok) return false;
  camera.cancelFlight();
  camera.lookAtTransform(good.transform);
  for (const k of ['position', 'direction', 'up', 'right']) C.Cartesian3.clone(good[k], camera[k]);
  console.warn('camera was not finite: restored');
  return true;
}
const keepCamera = () => {
  if (restoreCamera() || !cameraWhole()) return;
  C.Matrix4.clone(camera.transform, good.transform);
  for (const k of ['position', 'direction', 'up', 'right']) C.Cartesian3.clone(camera[k], good[k]);
  good.ok = true;
};
scene.preUpdate.addEventListener(keepCamera);
scene.preRender.addEventListener(keepCamera);

/** Camera height above the ellipsoid (a sphere radius would go negative near the poles). */
export function camHeight() { const c = camera.positionCartographic; return c ? c.height : C.Cartesian3.magnitude(camera.positionWC) - 6371000; }
/** Camera height above the ground under it: the terrain where it's on (terrain.js), else the ellipsoid. For things
 *  that appear "below N km", which in Denver or the Alps means above the ground, not above sea level. */
let aglAt = 0, aglGround = 0;
export function camAGL() {
  const c = camera.positionCartographic; if (!c) return camHeight();
  if (scene.terrainProvider instanceof C.EllipsoidTerrainProvider || c.height > 5e4) return c.height;
  const t = performance.now();
  if (t - aglAt > 500) { aglAt = t; aglGround = globe.getHeight(c) || 0; }   // reading the drawn tiles costs ~0.8 ms
  return c.height - aglGround;
}
