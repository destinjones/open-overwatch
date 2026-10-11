import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeView, decodeView, decodeExtras } from '../src/core/viewlink.js';

const view = { lon: 139.6917, lat: 35.6895, height: 4_500_000, heading: 12.5, pitch: -63.2, layers: ['stations', 'quakes', 'companies'], weather: ['ir', 'wind'], time: { jd: 2461314.12345, rate: 60 }, country: 'JP', flight: 'BAW123' };

test('a view survives the round trip', () => {
  const back = decodeView('#' + encodeView(view));
  assert.deepEqual(back, { ...view, lon: 139.6917, lat: 35.6895 });
});

test('optional parts are optional', () => {
  const back = decodeView('#' + encodeView({ lon: 0, lat: 0, height: 2e7, heading: 0, pitch: -90 }));
  assert.equal(back.layers, null); assert.equal(back.weather, null); assert.equal(back.time, null); assert.equal(back.country, null);
});

test('bad links are refused or cleaned, never trusted', () => {
  for (const h of ['', '#', '#abc', '#c=', '#c=1,2', '#c=a,b,c', '#c=200,0,1000', '#c=0,95,1000', '#c=0,0,-5', '#c=0,0,1e12']) assert.equal(decodeView(h), null, h);
  const v = decodeView('#c=10,20,3000&l=quakes,<script>,ok_1,' + 'x'.repeat(40) + '&k=jp&t=5,1&w=ir,wind;drop');
  assert.deepEqual(v.layers, ['quakes', 'ok_1']); assert.equal(v.country, null); assert.equal(v.time, null); assert.deepEqual(v.weather, ['ir']);
});

test('missing heading and pitch default to a straight-down view', () => {
  const v = decodeView('#c=10,20,3000'); assert.equal(v.heading, 0); assert.equal(v.pitch, -90);
});

test('links can open a panel or find a flight, and nothing else', () => {
  assert.deepEqual(decodeExtras('#go=tonight'), { go: 'tonight', flight: null, id: null });
  assert.deepEqual(decodeExtras('#go=launches&id=abc-123'), { go: 'launches', flight: null, id: 'abc-123' }); assert.equal(decodeExtras('#id=<x>').id, null);
  assert.deepEqual(decodeExtras('#go=lookup&f=baw123'), { go: null, flight: 'BAW123', id: null });   // look-up needs a tap first
  assert.equal(decodeExtras('#f=<img src=x>').flight, null); assert.equal(decodeExtras('#f=ABCDEFGHIJ').flight, null);
  assert.equal(decodeView('#go=tonight'), null);                                           // no camera: not a view
  assert.equal(new URLSearchParams(encodeView({ lon: 0, lat: 0, height: 1, heading: 0, pitch: 0, flight: 'a"b' })).get('f'), null);
});

test('a drawing rides along, and only a good one', () => {
  const drawing = [{ kind: 'pin', coords: [[-0.1246, 51.5007]], name: 'Big Ben' }, { kind: 'arrow', coords: [[2.3522, 48.8566], [13.405, 52.52]], road: true }, { kind: 'outline', iso: 'JP' }];
  const back = decodeView('#' + encodeView({ ...view, drawing }));
  assert.deepEqual(back, { ...view, drawing });
  assert.equal('drawing' in decodeView('#' + encodeView(view)), false, 'no drawing, no key');
  assert.equal('drawing' in decodeView('#c=10,20,3000&d=<script>alert(1)</script>'), false);
  assert.deepEqual(decodeView('#c=10,20,3000&d=pAA.pAAAA.oXX.ofr').drawing, [{ kind: 'pin', coords: [[0, 0]] }, { kind: 'outline', iso: 'XX' }], 'what checks out is kept (a two-point pin is not)');
  assert.equal(new URLSearchParams(encodeView({ lon: 0, lat: 0, height: 1, heading: 0, pitch: 0, drawing: [{ kind: 'line', coords: [[1, 1]] }] })).has('d'), false);
});
