import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapLon, decimal, dms, plain, describeSpot, spotLink } from '../src/core/spot.js';
import { decodeView } from '../src/core/viewlink.js';

test('coordinates in the usual ways', () => {
  assert.equal(decimal(48.8566, 2.3522), '48.85660° N, 2.35220° E');
  assert.equal(decimal(-33.8688, -151.2093 + 360), '33.86880° S, 151.20930° W', 'a longitude past 180 wraps');
  assert.equal(dms(48.8566, 2.3522), '48° 51′ 23.8″ N, 2° 21′ 07.9″ E');
  assert.equal(dms(-33.999999, -70.5), '34° 00′ 00.0″ S, 70° 30′ 00.0″ W', 'rounding carries, never 60″');
  assert.equal(plain(51.5007, -0.1246), '51.500700, -0.124600');
  assert.equal(wrapLon(181), -179); assert.equal(wrapLon(-181), 179); assert.equal(wrapLon(12.3456), 12.3456);
});

test('the spot card has MGRS and words for a screen reader', () => {
  const s = describeSpot(48.8566, 2.3522);
  assert.equal(s.mgrs, '31U DQ 52482 11717');
  assert.equal(s.spoken, '48.857 degrees north, 2.352 degrees east');
  assert.equal(describeSpot(NaN, 0), null);
  assert.equal(describeSpot(95, 0), null);
  assert.equal(describeSpot(89.9, 0).mgrs, null, 'MGRS stops at the polar caps');
});

test('a shared spot opens the globe straight down on it, with a pin', () => {
  const url = spotLink('https://destinjones.github.io/open-overwatch/index.html', 35.6895, 139.6917, 1e5);
  assert.ok(url.startsWith('https://destinjones.github.io/open-overwatch/globe.html#c='));
  const v = decodeView(url.split('#')[1]);
  assert.equal(v.lat, 35.6895); assert.equal(v.lon, 139.6917); assert.equal(v.height, 1e5); assert.equal(v.pitch, -90);
  assert.equal(v.drawing.length, 1); assert.equal(v.drawing[0].kind, 'pin');
  assert.ok(Math.abs(v.drawing[0].coords[0][0] - 139.6917) < 1e-4 && Math.abs(v.drawing[0].coords[0][1] - 35.6895) < 1e-4);
  assert.equal(decodeView(spotLink('https://x.org/', 0, 0, 1).split('#')[1]).height, 800, 'not inside the ground');
});
