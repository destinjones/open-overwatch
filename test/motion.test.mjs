// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Solar System view's motion helpers (src/core/motion.js): the flight easing, the log-scale zoom, the direction
// blend that must never flip the view, the upload chunks and the loading meter that never jumps. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLIGHT, ease, logLerp, slerpDir, chunkRanges, createProgress, clockDue } from '../src/core/motion.js';

const len = v => Math.hypot(v.x, v.y, v.z), dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('motion: ease starts and ends at rest, is symmetric, monotonic and clamped', () => {
  assert.equal(ease(0), 0); assert.equal(ease(1), 1); close(ease(0.5), 0.5);
  assert.equal(ease(-1), 0); assert.equal(ease(2), 1);
  for (let s = 0; s <= 1; s += 0.01) close(ease(s) + ease(1 - s), 1, 1e-12);
  let prev = -1; for (let s = 0; s <= 1.0001; s += 0.001) { const e = ease(s); assert.ok(e >= prev); prev = e; }
  const h = 1e-4; assert.ok(ease(h) / h < 1e-3, 'no velocity at the start'); assert.ok((1 - ease(1 - h)) / h < 1e-3, 'none at the end');
  // the largest step between two frames of a 60 fps flight is bounded: no frame where the camera leaps
  const frames = FLIGHT.focus * 60; let worst = 0;
  for (let k = 1; k <= frames; k++) worst = Math.max(worst, ease(k / frames) - ease((k - 1) / frames));
  assert.ok(worst <= 3 / frames, `largest step ${worst}`);   // peak speed 3x the average, at the middle
});

test('motion: logLerp zooms evenly across decades', () => {
  close(logLerp(1e-3, 1e5, 0), 1e-3, 1e-15); close(logLerp(1e-3, 1e5, 1), 1e5, 1e-6); close(logLerp(1e-3, 1e5, 0.5), 10, 1e-9);
  close(logLerp(4, 4, 0.3), 4);
});

test('motion: slerpDir keeps unit length, hits its ends, and turns through opposite directions without passing zero', () => {
  const a = { x: 1, y: 0, z: 0 }, b = { x: 0, y: 1, z: 0 }, out = { x: 0, y: 0, z: 0 };
  assert.equal(slerpDir(a, b, 0.5, out), out, 'writes into out');
  close(out.x, Math.SQRT1_2); close(out.y, Math.SQRT1_2); close(out.z, 0);
  for (const e of [0, 0.25, 1]) close(len(slerpDir(a, b, e)), 1);
  const s0 = slerpDir(a, b, 0), s1 = slerpDir(a, b, 1); close(dot(s0, a), 1); close(dot(s1, b), 1);
  // nearly the same direction: still unit, still between them
  const c = { x: Math.cos(1e-3), y: Math.sin(1e-3), z: 0 }; close(len(slerpDir(a, c, 0.5)), 1);
  // exactly opposite (and from each axis): each frame's turn from the last is small, and the ends are right
  for (const from of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }]) {
    const to = { x: -from.x, y: -from.y, z: -from.z }; let prev = slerpDir(from, to, 0), worst = 0;
    for (let k = 1; k <= 120; k++) {
      const v = slerpDir(from, to, k / 120); close(len(v), 1, 1e-9);
      worst = Math.max(worst, Math.acos(Math.min(1, dot(prev, v)))); prev = v;
    }
    assert.ok(worst < 0.03, `largest turn per frame ${worst} rad`);
    close(dot(slerpDir(from, to, 1), to), 1, 1e-9);
  }
});

test('motion: chunkRanges covers everything once, in pieces of at most size', () => {
  assert.deepEqual(chunkRanges(10, 4), [[0, 4], [4, 8], [8, 10]]);
  assert.deepEqual(chunkRanges(0, 4), []);
  assert.deepEqual(chunkRanges(3, 0), [[0, 1], [1, 2], [2, 3]]);
  const r = chunkRanges(1269434, 262144); assert.equal(r.length, 5); assert.equal(r.at(-1)[1], 1269434);
});

test('motion: the loading meter creeps, finishes, and never moves backwards or jumps', () => {
  const P = createProgress({ a: 4.5, b: 2.2, c: 1 }, { rate: 1.6 });
  assert.equal(P.value(0), 0); assert.equal(P.complete, false);
  P.start('a', 0); P.start('b', 0); P.start('nope', 0);
  let prev = 0, t = 0;
  const step = ms => { t += ms; const v = P.value(t); assert.ok(v >= prev, 'never backwards'); assert.ok(v - prev <= 1.6 * ms / 1000 + 1e-12, 'never faster than rate'); prev = v; return v; };
  for (let k = 0; k < 60; k++) step(16);
  assert.ok(prev > 0 && prev < 0.9 * (6.7 / 7.7), 'in flight: below 90% of the started work');
  P.finish('a', t); P.finish('b', t); P.start('c', t); P.finish('c', t); P.finish('zzz', t);
  assert.equal(P.complete, true); assert.equal(P.target(t), 1);
  for (let k = 0; k < 200; k++) step(16);
  close(prev, 1, 1e-12);
  // a task that ends without ever being started (failed before its fetch) still counts
  const Q = createProgress({ x: 1 }); Q.finish('x', 0); assert.equal(Q.complete, true); assert.equal(Q.target(0), 1);
  assert.equal(createProgress({}).complete, true);
});

test('motion: clockDue redraws a fast clock at most every ms, a slow one now and then, a stopped one never', () => {
  assert.equal(clockDue(null, 0, 0), true, 'never done');
  const last = { jd: 100, at: 1000 };
  assert.equal(clockDue(last, 100, 99999), false, 'the clock stopped: nothing to redo');
  assert.equal(clockDue(last, 106, 1050), false, 'a year a second, 50 ms later: not yet');
  assert.equal(clockDue(last, 106, 1100), true, 'and at 100 ms');
  assert.equal(clockDue(last, 99.4, 1200), true, 'backwards counts too');
  assert.equal(clockDue(last, 100.001, 2000), false, 'real time: under a day');
  assert.equal(clockDue(last, 100.001, 3000), true, 'but caught up after 2 s');
  assert.equal(clockDue(last, 101, 1300, { days: 2, ms: 0, idleMs: 1e9 }), false);
});
