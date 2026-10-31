// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Main-thread manners for the views: long jobs cut into slices that leave room for frames, a latch that holds work back
// until the view has shown its first picture, and a debounce. DOM-free: the page hands in its clock
// and how to yield (scheduler.yield, a timeout), so Node tests drive them with fakes.

/** How a page yields by default: scheduler.yield where the browser has it (the job keeps its place in line), else a
 *  zero timeout (a frame can be drawn in between either way). */
export function defaultYield() {
  const s = /** @type {any} */ (globalThis).scheduler;
  return s && typeof s.yield === 'function' ? s.yield() : new Promise(res => setTimeout(res, 0));
}

/** Run each(item, index) over items, yielding whenever a slice has run `budget` ms (8 ms leaves half a 60 Hz frame for
 *  drawing). `stop()` returning true ends the job early (a layer switched off, a newer load). Resolves with how many
 *  items ran. */
export async function sliced(items, each, { budget = 8, now = () => performance.now(), pause = defaultYield, stop = () => false } = {}) {
  let t0 = now(), i = 0;
  for (const item of items) {
    if (now() - t0 >= budget) {
      await pause(); t0 = now();
      if (stop()) return i;
    }
    each(item, i++);
  }
  return i;
}

/** A latch: wait() resolves once open() has been called (at once if it already has). */
export function latch() {
  let release, isOpen = false;
  const p = new Promise(res => { release = res; });
  return {
    get isOpen() { return isOpen; },
    open() { if (!isOpen) { isOpen = true; release(); } },
    wait() { return p; },
  };
}

/** fn(...args) once `ms` have passed with no newer call; .flush() runs a pending call now, .cancel() drops it. */
export function debounce(fn, ms, { setTimer = (f, t) => setTimeout(f, t), clearTimer = id => clearTimeout(id) } = {}) {
  let timer = null, last = null;
  const run = () => { timer = null; const a = last; last = null; fn(...a); };
  const d = (...args) => { last = args; if (timer !== null) clearTimer(timer); timer = setTimer(run, ms); };
  d.flush = () => { if (timer !== null) { clearTimer(timer); run(); } };
  d.cancel = () => { if (timer !== null) clearTimer(timer); timer = null; last = null; };
  return d;
}
