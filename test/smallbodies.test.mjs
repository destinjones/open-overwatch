// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The packed small-body format: near-parabolic comets must not decode to e = 1.  Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { viewSmallBodies, decodeElements, cometElements, packSmallBodies } from '../src/core/smallbodies.js';

const SB = JSON.parse(readFileSync(new URL('../data/solar/small_bodies.json', import.meta.url), 'utf8'));

test('small bodies: C/1933 D1 (Peltier, e = 0.9999987) packs to e < 1', () => {
  const row = SB.comets.find(r => r[0].startsWith('C/1933 D1'));
  assert.ok(row, 'C/1933 D1 is in data/solar/small_bodies.json');
  const el = cometElements(row, SB.epoch_jd);
  const back = decodeElements(viewSmallBodies(packSmallBodies([el])), 0, SB.epoch_jd);
  assert.ok(back.e < 1, `decoded e = ${back.e}`);
  assert.ok(Math.abs(back.e - el.e) < 2e-5);
});

test('small bodies: no elliptic comet in the catalogue decodes to e = 1', () => {
  const els = SB.comets.map(r => cometElements(r, SB.epoch_jd)).filter(Boolean);
  const v = viewSmallBodies(packSmallBodies(els));
  const ones = els.filter((el, k) => !(decodeElements(v, k).e < 1)).length;
  assert.equal(ones, 0);
});
