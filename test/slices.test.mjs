// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// core/slices.js: long jobs yield on a time budget, the boot latch, and the debounce. Fake clocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sliced, latch, debounce, defaultYield } from '../src/core/slices.js';

test('sliced: runs every item in order and yields once per budget', async () => {
  let t = 0, pauses = 0; const seen = [];
  const n = await sliced([10, 11, 12, 13, 14], (x, i) => { seen.push([x, i]); t += 3; }, { budget: 8, now: () => t, pause: async () => { pauses++; } });
  assert.equal(n, 5);
  assert.deepEqual(seen, [[10, 0], [11, 1], [12, 2], [13, 3], [14, 4]]);
  assert.equal(pauses, 1);   // 3 items fill a slice (9 ms >= 8), the next 2 run after one yield
});

test('sliced: a cheap job never yields', async () => {
  let pauses = 0;
  const n = await sliced(new Set(['a', 'b', 'c']), () => {}, { now: () => 0, pause: async () => { pauses++; } });
  assert.equal(n, 3); assert.equal(pauses, 0);
});

test('sliced: stop() after a yield ends the job early', async () => {
  let t = 0, stopped = false; const seen = [];
  const n = await sliced([1, 2, 3, 4, 5, 6], x => { seen.push(x); t += 5; if (x === 2) stopped = true; }, { budget: 8, now: () => t, pause: async () => {}, stop: () => stopped });
  assert.equal(n, 2); assert.deepEqual(seen, [1, 2]);
});

test('sliced: the default clock and yield work in Node', async () => {
  const seen = [];
  assert.equal(await sliced([1, 2], x => seen.push(x)), 2);
  assert.deepEqual(seen, [1, 2]);
  await defaultYield();   // a zero timeout here (no scheduler.yield in Node)
});

test('defaultYield: uses scheduler.yield where there is one', async () => {
  const g = /** @type {any} */ (globalThis), had = g.scheduler; let used = 0;
  g.scheduler = { yield: () => { used++; return Promise.resolve(); } };
  try { await defaultYield(); } finally { if (had === undefined) delete g.scheduler; else g.scheduler = had; }
  assert.equal(used, 1);
});

test('latch: waits until opened, then resolves at once', async () => {
  const l = latch(); let done = false;
  const w = l.wait().then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false); assert.equal(l.isOpen, false);
  l.open(); l.open(); await w;
  assert.equal(done, true); assert.equal(l.isOpen, true);
  await l.wait();   // already open
});

test('debounce: only the last call in a burst runs, with its arguments', () => {
  let id = 0; const timers = new Map(), calls = [];
  const d = debounce((...a) => calls.push(a), 100, { setTimer: (f) => { timers.set(++id, f); return id; }, clearTimer: i => timers.delete(i) });
  d('a'); d('b', 2); assert.equal(timers.size, 1);
  for (const f of timers.values()) f();
  assert.deepEqual(calls, [['b', 2]]);
});

test('debounce: flush runs a pending call now, cancel drops it', () => {
  let id = 0; const timers = new Map(), calls = [];
  const d = debounce(x => calls.push(x), 50, { setTimer: (f) => { timers.set(++id, f); return id; }, clearTimer: i => timers.delete(i) });
  d.flush(); assert.deepEqual(calls, []);   // nothing pending
  d(1); d.flush(); assert.deepEqual(calls, [1]); assert.equal(timers.size, 0);
  d(2); d.cancel(); assert.equal(timers.size, 0); d.cancel();
  assert.deepEqual(calls, [1]);
});

test('debounce: real timers by default', async () => {
  const calls = []; const d = debounce(x => calls.push(x), 1);
  d(1); d(2); await new Promise(r => setTimeout(r, 15));
  assert.deepEqual(calls, [2]);
});
