// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Cameras near a place (src/core/cameras.js, the MCP server's traffic_cameras tool): which networks cover a point, the
// nearest cameras, and pictures recognised by their bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camNetsNear, camsNear, camCoverage, imageType } from '../src/core/cameras.js';

test('cameras near: which networks cover a point, the nearest cameras', () => {
  assert.deepEqual(camNetsNear(51.507, -0.128), ['tfl']);
  assert.deepEqual(camNetsNear(48.86, 2.35, 50), [], 'Paris: none');
  assert.ok(camNetsNear(37.8, -122.4).includes('ca04'));
  assert.deepEqual(camNetsNear(51.9, -0.6, 0), [], 'just outside London');
  assert.deepEqual(camNetsNear(51.9, -0.6, 30), ['tfl'], 'within reach of its box');
  assert.ok(camCoverage().includes('Caltrans') && !camCoverage().some(n => /district/.test(n)) && camCoverage().length === 12);
  const near = camsNear([{ id: 'a', lat: 51.5, lon: -0.12 }, { id: 'b', lat: 51.51, lon: -0.12 }, { id: 'c', lat: 52, lon: 0 }], 51.5, -0.12, 5);
  assert.deepEqual(near.map(c => c.id), ['a', 'b']); assert.ok(Math.abs(near[1].km - 1.11) < 0.01);
});

test('cameras near: pictures are recognised by their bytes, not their label', () => {
  const pad = a => Uint8Array.from([...a, ...new Array(12).fill(0)]);
  assert.equal(imageType(pad([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(imageType(pad([0x89, 0x50, 0x4e, 0x47])), 'image/png');
  assert.equal(imageType(pad([0x47, 0x49, 0x46, 0x38])), 'image/gif');
  assert.equal(imageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'image/webp');
  assert.equal(imageType(new TextEncoder().encode('<html>not a picture</html>')), null);
  assert.equal(imageType(new Uint8Array(3)), null);
});
