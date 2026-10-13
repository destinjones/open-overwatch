// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The battery saver: the globe draws 60 frames a second only while something on screen moves. Satellites always move,
// but from far out a second of a satellite's motion is a fraction of a pixel, so with the camera still and nothing near
// it moving, the globe draws a few times a second: fewer the higher up (the rate at which a low orbit moves under a
// pixel between frames). Any touch, drag, wheel or key brings full speed back at once, and so do camera flights,
// following something, fast time, look-up, the cockpit, replays, map tiles still arriving, a projected video and the
// layers whose things cross the screen up close (traffic, transit, ships, aircraft). Off in Layers → Graphics.
import { store } from './env.js';
import { scene, globe, camera, camHeight } from './viewer.js';
import { L } from './layers.js';
import { state } from './state.js';
import { Quality } from './quality.js';
import { Follow } from './follow.js';
import { Time } from './time.js';
import { Ops } from './ops.js';
import { LookUp } from './lookup.js';
import { Ascent } from './ascent.js';
import { Director } from './director.js';
import { Photoreal } from './photoreal.js';
import { Cams } from './cams.js';
import { Air } from './aircraft.js';

const INPUT_MS = 2500, MOVE_MS = 1500;   // full speed this long after the last input / camera movement
let lastInput = performance.now(), lastMove = performance.now(), lastPos = null;

export const Saver = {
  on: store.get('saver', true),
  set(on) { this.on = on; store.set('saver', on); tick(); },
  /** Input: full speed now, not at the next check. */
  wake() { lastInput = performance.now(); if (Quality.idle) Quality.setIdle(0, 'input'); },
  /** For the console and the tests: { fps (0 = full speed), why }. */
  get state() { return { fps: Quality.idle, why: Quality.idleWhy }; },
};
for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) addEventListener(ev, () => Saver.wake(), { passive: true, capture: true });

function moved() {
  const p = camera.positionWC, d = camera.directionWC, u = camera.upWC, r = Math.hypot(p.x, p.y, p.z);
  const now = [p.x, p.y, p.z, d.x, d.y, d.z, u.x, u.y, u.z];
  const m = !lastPos || now.some((v, i) => Math.abs(v - lastPos[i]) > (i < 3 ? r * 1e-7 : 1e-7));
  lastPos = now; return m;
}
/** [why, frames a second]: 0 = as fast as the screen allows. */
function need() {
  const t = performance.now();
  if (moved()) lastMove = t;
  if (t - lastInput < INPUT_MS) return ['input', 0];
  if (t - lastMove < MOVE_MS) return ['camera moving', 0];
  if (Follow.obj) return ['following', 0];
  if (LookUp.active || state.lookup) return ['look up', 0];
  if (Ops.cockpit) return ['cockpit', 0];
  if (Ascent.playing || Director.playing) return ['replay', 0];
  if (!Time.live && Time.rate && Math.abs(Time.rate) > 1) return ['fast time', 0];
  if (!globe.tilesLoaded || (Photoreal.tileset && !Photoreal.tileset.tilesLoaded)) return ['tiles loading', 0];
  if (Cams.Proj?.video) return ['projected video', 0];
  const h = camHeight();
  if (h < 1e5 && (L.traffic?.on || L.transit?.on || L.ships?.on)) return ['moving things close by', 0];
  if (h < 3e5 && (L.air?.on || L.mil?.on) && Air.map.size) return ['aircraft close by', 30];
  // a low orbit's pixels a second at this height; below ~1,500 km, among and under the low orbits, a steady 15
  const px = 7500 * scene.canvas.clientWidth / (1.15 * Math.max(h, 1));
  let fps = h < 1.5e6 ? 15 : Math.max(5, Math.min(30, Math.ceil(px / 0.7)));
  if (Ops.hud || Ops.detect) fps = Math.max(fps, 15);   // the overlays track targets
  return ['idle', fps];
}
function tick() {
  const [why, fps] = Saver.on && !document.hidden ? need() : [Saver.on ? 'hidden' : 'off', 0];
  if (fps !== Quality.idle || why !== Quality.idleWhy) Quality.setIdle(fps, why);
}
setInterval(tick, 200);
