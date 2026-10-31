// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Shader pre-warm. Cesium compiles a glTF model's shaders the first time it is drawn, on the main thread: ~100 ms per
// program under ANGLE/D3D11 and far more on phones and in Firefox, so the first aircraft and satellites coming into view
// froze the flight down to the ground (perf.mjs: 1.3 s stalls on desktop, 1.5 s on a phone). Here one sub-millimetre
// copy of each model type is drawn just in front of the camera for a few frames while the boot screen is up, then
// hidden. Hidden models keep their programs, and the shader cache hands the same programs to the real ones. Cesium
// builds different versions at different heights (fog and atmosphere below ~800 km), so main.js draws them twice.
// Dots, icons and orbit lines are the same story: Cesium compiles one program per mix of options a collection uses
// (distance scaling, fading, a display range; opaque and translucent passes), on the first frame something of that mix is
// drawn. The first Starlink toggle, the first ISS card (its orbit line) and the first lighthouses spent 68 %, 41 % and 35 %
// of their windows compiling (perf run 2026-10-31, finding 4). One faint dot of each mix the layers use, an icon like the
// aircraft's and a line like an orbit's are drawn with the models, then hidden: hidden collections keep their programs.
import { C, NO_ENV_MAP } from './env.js';
import { viewer, scene, camera } from './viewer.js';

const AHEAD_M = 30;   // in front of the camera, inside the near/far range of the closest frustum
const ents = [];

const pos = new C.Cartesian3();
const add = ({ uri, ...opts }) => ents.push(viewer.entities.add({
  position: new C.CallbackProperty(() => C.Cartesian3.add(camera.positionWC, C.Cartesian3.multiplyByScalar(camera.directionWC, AHEAD_M, pos), pos), false),
  model: { uri, scale: 1e-5, minimumPixelSize: 0, environmentMapOptions: NO_ENV_MAP, ...opts },
}));

// ---- dots, icons, lines: the option mixes of satellites.js, aircraft.js, quakes.js, lighthouses.js, volcanoes.js,
// airports.js, companies.js, storms.js, launches.js and the orbit lines (ui.js, satellites.js orbit). The values do not
// matter (they are vertex data); which options are set does.
const prims = [];
function makePrims() {
  if (prims.length) return;
  const any = new C.NearFarScalar(1, 1, 1e12, 1), range = new C.DistanceDisplayCondition(0, 1e12), faint = new C.Color(1, 1, 1, 0.02);
  const dots = (blendOption, opts) => { const c = scene.primitives.add(new C.PointPrimitiveCollection(blendOption ? { blendOption } : undefined)); c.add({ position: C.Cartesian3.ZERO, pixelSize: 1, color: faint, ...opts }); prims.push(c); };
  dots(C.BlendOption.TRANSLUCENT, { scaleByDistance: any });                                 // satellites
  dots(C.BlendOption.TRANSLUCENT, { scaleByDistance: any, translucencyByDistance: any });   // + Starlink's fade
  dots(null, { scaleByDistance: any, distanceDisplayCondition: range });                     // aircraft far out
  dots(null, { distanceDisplayCondition: range, outlineColor: faint, outlineWidth: 1 });     // lighthouses, volcanoes, airports, employers
  dots(null, { outlineColor: faint, outlineWidth: 1 });                                      // quakes, storms, launch pads
  const cv = document.createElement('canvas'); cv.width = cv.height = 2;
  const icons = scene.primitives.add(new C.BillboardCollection({ scene }));                  // aircraft icons
  icons.add({ position: C.Cartesian3.ZERO, image: cv, color: faint, alignedAxis: C.Cartesian3.UNIT_Z, scaleByDistance: any, distanceDisplayCondition: range });
  prims.push(icons);
  const lines = scene.primitives.add(new C.PolylineCollection());                            // an orbit line
  lines.add({ positions: [C.Cartesian3.ZERO, C.Cartesian3.UNIT_X], width: 1, material: C.Material.fromType('Color', { color: faint }) });
  prims.push(lines);
}
const tip = new C.Cartesian3(), side = new C.Cartesian3();
function placePrims() {   // just in front of the camera, like the models
  C.Cartesian3.add(camera.positionWC, C.Cartesian3.multiplyByScalar(camera.directionWC, AHEAD_M, tip), tip);
  C.Cartesian3.add(tip, C.Cartesian3.multiplyByScalar(camera.rightWC, 0.01, side), side);
  for (const c of prims) {
    if (c instanceof C.PolylineCollection) c.get(0).positions = [tip, side];
    else c.get(0).position = tip;
  }
}
/** Show the warm dots, icon and line for a few frames, then hide them. */
function warmPrims(frames = 3) {
  makePrims(); for (const c of prims) c.show = true;
  return new Promise(resolve => {
    let f = 0;
    const offPre = scene.preRender.addEventListener(placePrims);
    const iconReady = () => prims.every(c => !(c instanceof C.BillboardCollection) || c.get(0).ready);   // its image loads first; no program until then
    const off = scene.postRender.addEventListener(() => { if (++f < frames || (!iconReady() && f < 120)) return; off(); offPre(); for (const c of prims) c.show = false; resolve(); });
  });
}

/** Add one hidden copy of each { uri, ...model options }; resolves once they have all been drawn (see warmAgain). */
export function warmModels(items) { for (const it of items) add(it); return warmAgain(); }

/** The same, one model every `gapMs` while the page is in use: many short compiles instead of one long freeze
 *  (phones, after the globe is showing). */
export async function warmSlowly(items, gapMs = 700) {
  await warmPrims();   // a handful of small programs first
  for (const it of items) {
    const n = ents.length; add(it);
    await new Promise(resolve => { let f = 0; const t0 = performance.now(); const off = viewer.scene.postRender.addEventListener(() => {
      if (!(modelOf(ents[n])?.ready && ++f >= 3) && performance.now() - t0 < 15e3) return;
      off(); ents[n].show = false; resolve();
    }); });
    await new Promise(r => setTimeout(r, gapMs));
  }
}

/** Draw every warm copy again for a few frames (at the camera's current height), then hide them. */
export function warmAgain() {
  for (const e of ents) e.show = true;
  warmPrims();
  return new Promise(resolve => {
    let frames = 0; const t0 = performance.now();
    const off = viewer.scene.postRender.addEventListener(() => {
      const ready = ents.every(e => modelOf(e)?.ready);
      if (!(ready && ++frames >= 3) && performance.now() - t0 < 20e3) return;   // give up waiting after 20 s
      off(); for (const e of ents) e.show = false; resolve(ready);
    });
  });
}

// the Model primitive behind an entity (ModelVisualizer keeps it in a private map; without it we fall back to the timeout)
function modelOf(e) {
  const vis = viewer.dataSourceDisplay.defaultDataSource._visualizers?.find(v => v._modelHash);
  return vis?._modelHash?.[e.id]?.modelPrimitive;
}
