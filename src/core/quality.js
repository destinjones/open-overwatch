// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The globe's graphics levels and the rules that pick and step between them (no DOM, no Cesium: globe/quality.js
// applies them). A phone runs out of fill rate (pixels times shader work), so the lower levels cut what every pixel
// costs: a lower render resolution, no FXAA pass, no limb halo shell, fewer cloud taps; not only tile detail and models.

export const ORDER = ['high', 'balanced', 'low'];
/** On 'balanced' the limb halo is drawn only above this height (m): below it the rim is off screen or barely there. */
export const LIMB_RIM_M = 1.0e6;

/** The three levels for this device. sse: tile detail (screen-space error); air, sat: 3D model caps; octaves: cloud
 *  noise; fps: frame cap (0 = none); scale: render resolution (× CSS pixels); fxaa: the anti-aliasing pass; limb:
 *  'all' | 'rim' (above LIMB_RIM_M) | 'off'; relief: the cloud shader's four sun-side relief taps; mesh: shell partitions. */
export function qualityLevels(phone = false) {
  return {
    high: { name: 'High', sse: 2, air: 200, sat: 40, octaves: 4, fps: 0, scale: 1, fxaa: true, limb: 'all', relief: true, mesh: phone ? 'coarse' : 'fine' },
    balanced: { name: 'Balanced', sse: 3, air: 80, sat: 25, octaves: 2, fps: 0, scale: 0.9, fxaa: true, limb: 'rim', relief: true, mesh: 'coarse' },
    low: { name: 'Low', sse: 4, air: 30, sat: 12, octaves: 1, fps: 30, scale: phone ? 0.66 : 0.75, fxaa: false, limb: 'off', relief: false, mesh: 'coarse' },
  };
}

/** Stack and slice partitions of the whole-Earth shells for a level's mesh. */
export const shellPartitions = mesh => mesh === 'fine' ? { stacks: 256, slices: 512 } : { stacks: 128, slices: 256 };

/** The level 'auto' means: phones and software renderers start low (the GPU is the limit there), the rest high. */
export const autoLevel = (phone, software) => phone || software ? 'low' : 'high';

/** Whether the limb halo shows at camera height h (m) on a level (null: no level yet, show it). */
export function limbShown(q, h) {
  const limb = q ? q.limb : 'all';
  return limb === 'all' || (limb === 'rim' && h > LIMB_RIM_M);
}

/** The median of one window's frame times (ms; sorts the array). */
export function medianFrame(times) { times.sort((a, b) => a - b); return times[times.length >> 1] || 0; }

/** One 3 s window's verdict: the new count of slow windows in a row, where 2 or more step the level down. One very slow
 *  window (median over 50 ms) counts as two; otherwise a window over budget (the level's frame cap plus 8 ms, or 28 ms,
 *  under ~36 fps, without a cap) adds one and a good one resets the count. So one slow frame never changes the level. */
export function slowWindows(median, fps, slow) {
  const budget = fps ? 1000 / fps + 8 : 28;
  return median > 50 ? 2 : median > budget ? slow + 1 : 0;
}

/** The next level down from id, or null at the bottom. */
export function lowerLevel(id) { const i = ORDER.indexOf(id); return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null; }
