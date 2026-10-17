// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The globe's graphics levels (core/quality.js): the lower levels must cut per-pixel GPU work (render resolution, the
// FXAA pass, the limb halo, cloud taps), not only tile detail, and the automatic step-down keeps its hysteresis. The
// globe modules need Cesium and the DOM, so their wiring is checked from the source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ORDER, LIMB_RIM_M, qualityLevels, shellPartitions, autoLevel, limbShown, medianFrame, slowWindows, lowerLevel } from '../src/core/quality.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('quality: the levels, desktop and phone', () => {
  for (const phone of [false, true]) {
    const L = qualityLevels(phone);
    assert.deepEqual(Object.keys(L), ORDER);
    for (const id of ORDER) for (const k of ['name', 'sse', 'air', 'sat', 'octaves', 'fps', 'scale', 'fxaa', 'limb', 'relief', 'mesh']) assert.ok(k in L[id], `${id}.${k}`);
    // high is as it was: full resolution, FXAA, the limb halo everywhere, relief
    assert.deepEqual([L.high.scale, L.high.fxaa, L.high.limb, L.high.relief, L.high.fps], [1, true, 'all', true, 0]);
    // each step down costs less per pixel and never more anywhere
    for (let i = 1; i < ORDER.length; i++) {
      const a = L[ORDER[i - 1]], b = L[ORDER[i]];
      assert.ok(b.scale < a.scale && b.sse > a.sse && b.air < a.air && b.sat < a.sat && b.octaves < a.octaves, `${ORDER[i]} below ${ORDER[i - 1]}`);
    }
    assert.equal(L.balanced.fxaa, true); assert.equal(L.balanced.limb, 'rim'); assert.equal(L.balanced.scale, 0.9);
    assert.deepEqual([L.low.fxaa, L.low.limb, L.low.relief, L.low.fps], [false, 'off', false, 30]);
  }
  // the owner's choice ("faster, slightly softer"): low renders at 0.75, 0.66 on phones
  assert.equal(qualityLevels(false).low.scale, 0.75);
  assert.equal(qualityLevels(true).low.scale, 0.66);
});

test('quality: shell partitions follow the mesh', () => {
  assert.deepEqual(shellPartitions('fine'), { stacks: 256, slices: 512 });
  assert.deepEqual(shellPartitions('coarse'), { stacks: 128, slices: 256 });
  assert.equal(qualityLevels(false).high.mesh, 'fine');
  assert.equal(qualityLevels(true).high.mesh, 'coarse');   // phones always had the coarse shells
  assert.equal(qualityLevels(false).balanced.mesh, 'coarse');
});

test('quality: auto starts phones and software renderers low, the rest high', () => {
  assert.equal(autoLevel(false, false), 'high');
  assert.equal(autoLevel(true, false), 'low');
  assert.equal(autoLevel(false, true), 'low');
});

test('quality: the limb halo per level and height', () => {
  const L = qualityLevels(false);
  assert.equal(limbShown(null, 500), true, 'no level yet: as before');
  for (const h of [500, 2e5, 3e7]) { assert.equal(limbShown(L.high, h), true); assert.equal(limbShown(L.low, h), false); }
  assert.equal(limbShown(L.balanced, LIMB_RIM_M - 1), false);
  assert.equal(limbShown(L.balanced, LIMB_RIM_M + 1), true);
  assert.equal(limbShown(L.balanced, 2.0e7), true);
});

test('quality: the step-down needs two slow windows, or one very slow one', () => {
  assert.equal(medianFrame([30, 10, 20]), 20);
  assert.equal(medianFrame([]), 0);
  // no frame cap: the budget is 28 ms
  assert.equal(slowWindows(20, 0, 0), 0);
  assert.equal(slowWindows(30, 0, 0), 1, 'one slow window is not enough');
  assert.equal(slowWindows(30, 0, 1), 2, 'two in a row are');
  assert.equal(slowWindows(20, 0, 1), 0, 'a good window resets the count');
  assert.equal(slowWindows(60, 0, 0), 2, 'one very slow window steps down at once');
  // a 30 fps cap: 33.3 + 8 ms, so capped frames are not slow frames
  assert.equal(slowWindows(34, 30, 1), 0);
  assert.equal(slowWindows(45, 30, 1), 2);
  assert.equal(lowerLevel('high'), 'balanced');
  assert.equal(lowerLevel('balanced'), 'low');
  assert.equal(lowerLevel('low'), null);
  assert.equal(lowerLevel('nonsense'), null);
});

test('quality: the globe applies resolution, FXAA, the limb and the relief taps from the level', () => {
  const q = read('src/globe/quality.js'), v = read('src/globe/viewer.js'), e = read('src/globe/earth.js'), m = read('src/globe/main.js');
  assert.match(q, /export const LEVELS = qualityLevels\(PHONE\)/);
  assert.match(q, /viewer\.resolutionScale = q\.scale/);
  assert.match(q, /scene\.postProcessStages\.fxaa\.enabled = q\.fxaa/);
  assert.doesNotMatch(v, /fxaa\.enabled = true/, 'FXAA is the level\'s to switch, not always on');
  assert.match(e, /limbShell\.primitive\.show = limbShown\(this\.q, h\)/);
  assert.doesNotMatch(e, /limbShell\.primitive\.show = true/);
  assert.match(e, /uniform float bumps;/); assert.match(e, /if \(bumps > 0\.5\)/);
  assert.match(e, /bumps: q\.relief \? 1\.0 : 0\.0/);
  assert.match(e, /stackPartitions: MESH\.stacks, slicePartitions: MESH\.slices/);
  assert.match(m, /Quality\.follow\(q => \{[^\n]*Earth\.setQuality\(q\)/);
});

test('quality: Starlink is off by default on phones, and the dock says so', () => {
  const line = read('src/globe/layers.js').split('\n').find(l => l.includes("{ id: 'starlink'"));
  assert.match(line, /on: !PHONE/);
  assert.match(line, /name: PHONE \? '[^']*off by default on phones[^']*tap to show[^']*' : 'Starlink'/);
});
