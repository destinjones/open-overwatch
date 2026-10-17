// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Graphics quality: three levels (core/quality.js), chosen per device and stepped down automatically when frames run slow.
// Phones start on "low" (the GPU is the limit there and emulation can't measure it); everything else starts on "high".
// Below "high" the globe renders fewer pixels (resolutionScale), "low" also drops the FXAA pass and the limb halo.
// While the page is visible, the median frame time of each 3 s window is watched: one very slow window (median over
// 50 ms) or two in a row over 28 ms (under ~36 fps) step the level down once. The median ignores one-off shader-compile stalls. A level the
// user picks in the dock is kept (localStorage) and never changed automatically.
import { PHONE, store, toast } from './env.js';
import { viewer, scene, globe } from './viewer.js';
import { rendererName, isSoftwareRenderer, SOFTWARE_HINT } from '../core/gpu.js';
import { qualityLevels, autoLevel, medianFrame, slowWindows, lowerLevel } from '../core/quality.js';

export const LEVELS = qualityLevels(PHONE);

export const Quality = {
  chosen: store.get('quality', 'auto'),          // 'auto' or a level id
  level: null, targets: [],
  idle: 0, idleWhy: '',                           // the battery saver's frame-rate cap (saver.js; 0 = none) and why
  /** Things that follow the level: fn(levelSettings) is called now and on every change. */
  follow(fn) { this.targets.push(fn); if (this.level) fn(LEVELS[this.level]); },
  apply(id) {
    this.level = id; const q = LEVELS[id];
    globe.maximumScreenSpaceError = q.sse;
    viewer.resolutionScale = q.scale;                 // fragment work scales with the pixel count: 0.75 is ~44% less
    scene.postProcessStages.fxaa.enabled = q.fxaa;    // a full-screen pass (4x MSAA blanked the globe, so FXAA it is)
    this.applyFps();   // 30 fps on low: half the GPU work, cooler phones, steadier frames
    for (const fn of this.targets) fn(q);
  },
  /** The battery saver's cap: frames a second while nothing moves (0 = none). */
  setIdle(fps, why = '') { this.idle = fps; this.idleWhy = why; this.applyFps(); },
  applyFps() { const caps = [LEVELS[this.level].fps, this.idle].filter(f => f > 0); viewer.targetFrameRate = caps.length ? Math.min(...caps) : undefined; },
  gpu: rendererName(scene.context._gl),
  get autoLevel() { return autoLevel(PHONE, isSoftwareRenderer(this.gpu)); },
  choose(id) { this.chosen = id; store.set('quality', id); this.apply(id === 'auto' ? this.autoLevel : id); },
};
Quality.apply(Quality.chosen === 'auto' ? Quality.autoLevel : Quality.chosen);
if (isSoftwareRenderer(Quality.gpu)) setTimeout(() => toast(SOFTWARE_HINT, 15000), 4000);

// ---- the automatic step-down
{
  let times = [], last = 0, windowStart = 0, slow = 0;
  const startAt = performance.now() + 12e3;        // let the boot and the first tile burst pass
  scene.postRender.addEventListener(() => {
    const t = performance.now();
    if (document.hidden || t < startAt || Quality.chosen !== 'auto' || Quality.idle) { last = 0; return; }   // the battery saver's slow frames are not slow hardware
    if (last) times.push(t - last);
    last = t;
    if (!windowStart) windowStart = t;
    if (t - windowStart < 3000) return;
    const median = medianFrame(times); times = []; windowStart = t;
    slow = slowWindows(median, LEVELS[Quality.level].fps, slow);   // two slow windows in a row, never one slow frame
    const next = lowerLevel(Quality.level);
    if (slow >= 2 && next) {
      slow = 0; Quality.apply(next);
      toast(`Graphics set to ${LEVELS[Quality.level].name} for smoother motion (change it in Layers)`, 4000);
    }
  });
  addEventListener('visibilitychange', () => { last = 0; times = []; windowStart = 0; });
}
