import test from 'node:test';
import assert from 'node:assert/strict';
import { toMgrs, toUtm, utmZone } from '../src/core/mgrs.js';
import { parse, normalize } from '../src/core/voicecmd.js';
import { encodeView, decodeView } from '../src/core/viewlink.js';

// reference strings from the Python `mgrs` package (NGA GeoTrans), which agrees with `utm` to < 1 mm at all of these
test('MGRS matches GeoTrans: north, south, Norway, Paris', () => {
  assert.equal(toMgrs(38.8895, -77.0353), '18S UJ 23478 06483');   // Washington Monument
  assert.equal(toMgrs(-33.8568, 151.2153), '56H LH 34900 52288');  // Sydney Opera House
  assert.equal(toMgrs(60, 5), '32V KM 76979 58157');               // inside Norway's widened zone 32V
  assert.equal(toMgrs(48.8583, 2.2945), '31U DQ 48251 11943');     // Eiffel Tower
});

test('MGRS: precision, zone exceptions, poles', () => {
  assert.equal(toMgrs(38.8895, -77.0353, 3), '18S UJ 234 064');
  assert.equal(utmZone(60, 5), 32);            // Norway's wide 32V
  assert.equal(utmZone(78, 15), 33);           // Svalbard
  assert.equal(toMgrs(85, 0), null); assert.equal(toMgrs(-81, 0), null);
  const u = toUtm(0, 3); assert.ok(Math.abs(u.easting - 500000) < 1e-6 && Math.abs(u.northing) < 1e-6);   // central meridian on the equator
});

test('voice: sensors, overlays and the cockpit', () => {
  assert.deepEqual(parse('Night vision'), { act: 'sensor', mode: 'nvg' });
  assert.deepEqual(parse('switch to thermal please'), { act: 'sensor', mode: 'flir' });
  assert.deepEqual(parse('black hot'), { act: 'sensor', mode: 'flirbh' });
  assert.deepEqual(parse('back to normal'), { act: 'sensor', mode: 'normal' });
  assert.deepEqual(parse('turn off the HUD'), { act: 'hud', on: false });
  assert.deepEqual(parse('show the bounding boxes'), { act: 'detect', on: true });
  assert.deepEqual(parse('Enter cockpit'), { act: 'cockpit', on: true });
  assert.deepEqual(parse('exit cockpit'), { act: 'cockpit', on: false });
});

test('voice: moving around', () => {
  assert.deepEqual(parse('Hey Overwatch, take me to Tokyo'), { act: 'go', place: 'tokyo' });
  assert.deepEqual(parse('fly to the Eiffel Tower'), { act: 'go', place: 'eiffel tower' });
  assert.deepEqual(parse('show me the ISS'), { act: 'go', place: 'iss' });
  assert.deepEqual(parse('track the ISS'), { act: 'track', what: 'iss' });
  assert.deepEqual(parse('lock on to the space station'), { act: 'track', what: 'space station' });
  assert.deepEqual(parse('Zoom out to a globe view.'), { act: 'reset' });
  assert.deepEqual(parse('zoom in'), { act: 'zoom', dir: 'in' });
  assert.deepEqual(parse('north up'), { act: 'north' });
  assert.deepEqual(parse('take me to the moon'), { act: 'go', place: 'moon' });
});

test('voice: layers, views, questions, time', () => {
  assert.deepEqual(parse('turn on earthquakes'), { act: 'layer', name: 'earthquakes', on: true });
  assert.deepEqual(parse('turn the satellites off'), { act: 'layer', name: 'satellites', on: false });
  assert.deepEqual(parse('hide the debris'), { act: 'layer', name: 'debris', on: false });
  assert.deepEqual(parse("What's above me tonight?"), { act: 'view', go: 'tonight' });
  assert.deepEqual(parse('show me the launches'), { act: 'view', go: 'launches' });
  assert.deepEqual(parse('open the solar system'), { act: 'view', go: 'space' });
  assert.deepEqual(parse('How many satellites are in view?'), { act: 'count', what: 'sat' });
  assert.deepEqual(parse("what's this"), { act: 'what' });
  assert.deepEqual(parse('stop time'), { act: 'pause' });
  assert.deepEqual(parse('stop following'), { act: 'stop' });
  assert.deepEqual(parse('fast forward'), { act: 'faster' });
  assert.equal(parse('banana bread').act, 'unknown');
  assert.equal(normalize("  OK computer, could you   Track it!  "), 'track it');
});

test('share links carry the sensor and overlays, and nothing else gets in', () => {
  const v = { lon: 139.7, lat: 35.6, height: 2500, heading: 0, pitch: -42, layers: null, weather: null, time: null, country: null };
  const h = '#' + encodeView({ ...v, ops: { sensor: 'nvg', hud: true, detect: true } });
  assert.match(h, /o=nvg\.h\.d/);
  assert.deepEqual(decodeView(h).ops, { sensor: 'nvg', hud: true, detect: true });
  assert.ok(!encodeView({ ...v, ops: { sensor: 'normal', hud: false, detect: false } }).includes('o='));   // the plain view adds nothing
  assert.equal(decodeView('#c=1,2,3&o=<script>.h').ops.sensor, 'normal');
  assert.equal(decodeView('#c=1,2,3').ops, undefined);
});
