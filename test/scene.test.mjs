import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeScene, decodeScene, cleanShot, parseSceneFile, sceneFile, MAX_SHOTS } from '../src/core/scene.js';

const shot = (o = {}) => ({ lon: 139.7671, lat: 35.6812, h: 2500, heading: 30, pitch: -40, roll: 0, dur: 5, hold: 1, sensor: 'nvg', ...o });

test('scenes survive a link round trip', () => {
  const shots = [shot(), shot({ lon: -0.1276, lat: 51.5072, h: 1.4e6, sensor: 'iron', dur: 8 })];
  const back = decodeScene(encodeScene(shots));
  assert.equal(back.length, 2); assert.equal(back[1].sensor, 'iron'); assert.equal(back[0].lon, 139.7671); assert.equal(back[1].h, 1400000);
  assert.match(encodeScene(shots), /^[A-Za-z0-9_-]+$/);   // safe in a URL hash
});

test('nothing out of range gets in', () => {
  assert.equal(cleanShot(shot({ lat: 91 })), null); assert.equal(cleanShot(shot({ h: -5 })), null); assert.equal(cleanShot(shot({ dur: 999 })), null);
  assert.equal(cleanShot(shot({ sensor: '<img onerror=x>' })).sensor, 'normal');
  assert.deepEqual(decodeScene('not a scene'), []); assert.deepEqual(decodeScene(''), []);
  assert.equal(decodeScene(encodeScene(Array.from({ length: 60 }, () => shot()))).length, MAX_SHOTS);
});

test('scene files', () => {
  const f = sceneFile('Tokyo at night', [shot()]); const p = parseSceneFile(f);
  assert.equal(p.title, 'Tokyo at night'); assert.equal(p.shots.length, 1);
  assert.equal(parseSceneFile('{"shots":[]}'), null); assert.equal(parseSceneFile('{oops'), null);
});

test('angles are wrapped, not rejected', () => {
  assert.equal(cleanShot(shot({ roll: 359.99 })).roll, 0);
  assert.equal(cleanShot(shot({ roll: -190 })).roll, 170);
  assert.equal(cleanShot(shot({ heading: -30 })).heading, 330);
  assert.equal(cleanShot(shot({ heading: NaN })), null);
});
