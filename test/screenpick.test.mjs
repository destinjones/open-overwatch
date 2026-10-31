// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// core/screenpick.js: projecting dots to the screen, the Earth hiding the far side, and the nearest-dot picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { project, behindSphere, makePicker, EARTH_MIN_R } from '../src/core/screenpick.js';

// a 90° square perspective looking down -z (OpenGL), column major like Cesium's Matrix4, times a camera translation
function perspective(near = 1, far = 1e9) {
  const m = new Array(16).fill(0);
  m[0] = 1; m[5] = 1; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = 2 * far * near / (near - far);
  return m;
}
function times(a, b) {   // column major a × b
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1];
const CAM = { x: 0, y: 0, z: 2.0e7 }, VP = times(perspective(), translate(CAM.x, CAM.y, CAM.z)), W = 800, H = 600;

test('project: the centre of the view, its right edge, and behind the camera', () => {
  const m = perspective(), out = { x: -1, y: -1 };
  assert.equal(project(m, 0, 0, -10, W, H, out), true); assert.deepEqual(out, { x: 400, y: 300 });
  assert.equal(project(m, 10, 0, -10, W, H, out), true); assert.equal(out.x, 800);
  assert.equal(project(m, 0, 10, -10, W, H, out), true); assert.equal(out.y, 0);   // up is the top of the window
  out.x = 7; assert.equal(project(m, 0, 0, 10, W, H, out), false); assert.equal(out.x, 7);
});

test('behindSphere: the far side of the Earth is hidden, the near side and the sky are not', () => {
  assert.equal(behindSphere(0, 0, 2e7, 0, 0, -6.378e6), true);
  assert.equal(behindSphere(0, 0, 2e7, 0, 0, 6.378e6), false);
  assert.equal(behindSphere(0, 0, 2e7, 4.2e7, 0, 0), false);       // a GEO satellite off to the side
  assert.equal(behindSphere(0, 0, 2e7, 0, 0, -4.2e7), true);       // ...and one straight behind the Earth
  assert.equal(behindSphere(0, 0, 2e7, 0, 0, 2e7), false);         // the camera's own spot
  assert.ok(EARTH_MIN_R < 6.378e6);
});

test('makePicker: the nearest dot to the spot wins, within reach of its edge', () => {
  const at = { x: 400, y: 300 }, pk = makePicker(VP, W, H, CAM, at, 3);
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  // 1 px on screen is ~ (2e7 - 6.4e6) / 400 ≈ 34 km at the near side of the Earth
  pk.offer(0.20e6, 0, 6.4e6, 4, a);   // ~5.9 px away: out of reach (3 + 4/2)
  assert.equal(pk.item, null);
  pk.offer(0.12e6, 0, 6.4e6, 4, b);   // ~3.5 px: in reach
  pk.offer(0.05e6, 0, 6.4e6, 4, c);   // ~1.5 px: nearer
  pk.offer(0.10e6, 0, 6.4e6, 4, a);   // ~2.9 px: not nearer than c
  assert.equal(pk.item, c); assert.ok(pk.d > 1 && pk.d < 2);
});

test('makePicker: skips dots behind the Earth, at NaN, behind the camera and outside their display range', () => {
  const pk = makePicker(VP, W, H, CAM, { x: 400, y: 300 }, 5), x = { id: 'x' };
  pk.offer(0, 0, -6.4e6, 4, x);              // the far side, straight behind the near one on screen
  pk.offer(NaN, 0, 6.4e6, 4, x);
  pk.offer(0, 0, 3e7, 4, x);                 // behind the camera
  pk.offer(0, 0, 6.4e6, 4, x, 0, 1e6);       // drawn only within 1,000 km of the camera
  pk.offer(0, 0, 6.4e6, 4, x, 2e7, 3e7);     // drawn only beyond 20,000 km
  assert.equal(pk.item, null);
  pk.offer(0, 0, 6.4e6, 4, x, 0, 2e7);
  assert.equal(pk.item, x); assert.equal(pk.d, 0);
});

test('makePicker: a big icon is picked across its width', () => {
  const pk = makePicker(VP, W, H, CAM, { x: 400, y: 300 }, 0), icon = { id: 'plane' };
  pk.offer(0.4e6, 0, 6.4e6, 32, icon);   // ~11.8 px from its centre, inside half of 32 px
  assert.equal(pk.item, icon);
});
