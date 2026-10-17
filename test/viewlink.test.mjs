// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeView, decodeView, decodeExtras, tonightHash, decodeTonight, tonightHeadings, placeName, TONIGHT_SECTIONS } from '../src/core/viewlink.js';

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
  assert.deepEqual(decodeExtras('#go=tonight'), { go: 'tonight', flight: null, id: null, at: null });
  assert.deepEqual(decodeExtras('#go=launches&id=abc-123'), { go: 'launches', flight: null, id: 'abc-123', at: null }); assert.equal(decodeExtras('#id=<x>').id, null);
  assert.deepEqual(decodeExtras('#go=lookup&f=baw123'), { go: null, flight: 'BAW123', id: null, at: null });   // look-up needs a tap first
  assert.equal(decodeExtras('#f=<img src=x>').flight, null); assert.equal(decodeExtras('#f=ABCDEFGHIJ').flight, null);
  assert.equal(decodeView('#go=tonight'), null);                                           // no camera: not a view
  assert.equal(new URLSearchParams(encodeView({ lon: 0, lat: 0, height: 1, heading: 0, pitch: 0, flight: 'a"b' })).get('f'), null);
});

test('Tonight for a place: at= and name= survive a link, rounded to ~1 km, and nothing else gets in', () => {
  const h = tonightHash({ lat: 18.52049, lon: 73.85674, name: 'Pune, Maharashtra' });
  assert.equal(h, 'at=18.52,73.86&name=Pune%2C%20Maharashtra');
  assert.deepEqual(decodeTonight('#' + h).at, { lat: 18.52, lon: 73.86, name: 'Pune, Maharashtra' });
  assert.deepEqual(decodeExtras('#go=tonight&' + h), { go: 'tonight', flight: null, id: null, at: { lat: 18.52, lon: 73.86, name: 'Pune, Maharashtra' } }, 'the globe reads it too');
  assert.deepEqual(decodeTonight('#at=28.6,77.2').at, { lat: 28.6, lon: 77.2 }, 'a name is optional');
  assert.deepEqual(decodeTonight('#at=-33.868765,151.209296').at, { lat: -33.87, lon: 151.21 }, 'rounded as a saved home is');
  assert.equal(Object.is(decodeTonight('#at=-0.001,-0.004').at.lat, 0), true, 'no "-0.00" on the card');
  for (const bad of ['', '#at=', '#at=1', '#at=1,2,3', '#at=91,0', '#at=0,181', '#at=a,b', '#at=1e2,3', '#at=Infinity,0', '#at=,5', '#at=1,%202', '#name=Pune'])
    assert.equal(decodeTonight(bad).at, null, bad);
  assert.equal(decodeTonight('#at=1,2&name=' + encodeURIComponent('<img src=x onerror=alert(1)>')).at.name, 'img src=x onerror=alert(1)', 'no angle brackets (and the card escapes it as well)');
  assert.equal(placeName('a\u0000b\nc  d'), 'ab c d'); assert.equal(placeName('x'.repeat(80)).length, 60); assert.equal(placeName('   '), null);
  assert.equal(tonightHash({ lat: 95, lon: 0 }), ''); assert.equal(tonightHash(null), ''); assert.equal(tonightHash({ lat: 51.4778, lon: -0.0014 }), 'at=51.48,0');
});

test('a Tonight embed: embed=1, and the sections it opens (only known ones)', () => {
  assert.deepEqual(decodeTonight('#embed=1&at=28.6,77.2&sections=passes,planets'), { at: { lat: 28.6, lon: 77.2 }, embed: true, sections: ['passes', 'planets'] });
  assert.deepEqual(decodeTonight('#at=28.6,77.2'), { at: { lat: 28.6, lon: 77.2 }, embed: false, sections: null });
  assert.equal(decodeTonight('#embed=1&sections=__proto__,constructor,<b>').sections, null, 'nothing known: the whole card');
  assert.deepEqual(decodeTonight('#embed=yes&sections=moon,moon').embed, false);
  assert.deepEqual([...tonightHeadings(['passes', 'sun'])], ['Satellites you can see', 'Sun', 'The Sun now']);
  assert.equal(tonightHeadings(null).size, 0);
  for (const [k, v] of Object.entries(TONIGHT_SECTIONS)) { assert.match(k, /^[a-z]+$/); assert.ok(Array.isArray(v) && v.length, k); }
  // the card's headings (globe/tonight.js and the parts it draws): a renamed heading must be renamed here too
  const src = ['tonight', 'darksky', 'sunnow'].map(f => readFileSync(new URL(`../src/globe/${f}.js`, import.meta.url), 'utf8')).join('\n');
  for (const h of tonightHeadings(Object.keys(TONIGHT_SECTIONS))) assert.ok(src.includes(`<h3>${h}`), `no <h3>${h} on the card`);
  // a typed place goes to Photon and nowhere else: Tonight never uses the globe's switchable geocoder
  const tn = readFileSync(new URL('../src/globe/tonight.js', import.meta.url), 'utf8');
  assert.match(tn, /import \{ photon, PHOTON_CREDIT \} from '\.\/geocode\.js'/); assert.doesNotMatch(tn, /findPlaces|places\.js/);
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

test('links made elsewhere switch layers on or off and leave the rest; a satellite to follow', () => {
  const v = { lon: 24.95, lat: 60.17, height: 30000, heading: 0, pitch: -50, add: ['ships', 'terrain'], drop: ['starlink'], sat: '25544' };
  const back = decodeView('#' + encodeView(v));
  assert.deepEqual([back.add, back.drop, back.sat, back.layers], [['ships', 'terrain'], ['starlink'], '25544', null]);
  const plain = decodeView('#c=1,2,3000');
  assert.equal('add' in plain || 'drop' in plain || 'sat' in plain, false, 'older links decode as before');
  const bad = decodeView('#c=1,2,3000&a=ships,<b>&x=' + 'y'.repeat(30) + '&s=ISS');
  assert.deepEqual(bad.add, ['ships']); assert.deepEqual(bad.drop, []); assert.equal('sat' in bad, false);
  assert.equal(new URLSearchParams(encodeView({ ...v, sat: '25544; drop' })).has('s'), false);
  assert.equal(decodeView('#c=1,2,3000&s=0025544').sat, '25544');
});

test('2D forecast layers and the globe\'s weather mode open each other', async () => {
  const { weatherFor, mapWeatherFor, MAP_TO_WEATHER, globeLayersFor, mapLayersFor } = await import('../src/core/viewlink.js');
  assert.deepEqual(weatherFor(['quakes', 'wx_wind', 'wx_pres', 'wx_rain']), ['wind', 'pres', 'radar']);
  assert.deepEqual(weatherFor(['wx_temp'], 'ecmwf'), ['temp', 'ecmwf']);
  assert.equal(weatherFor(['quakes', 'airports']), null, 'no forecast layer: weather mode stays closed');
  assert.deepEqual(mapWeatherFor(['ir', 'radar', 'lightning', 'wave', 'ecmwf', 'compare']), { layers: ['wx_wave', 'wx_cloud', 'wx_rain'], model: 'ecmwf' });
  assert.deepEqual(mapWeatherFor(null), { layers: [], model: 'gfs' });
  for (const id of Object.keys(MAP_TO_WEATHER)) assert.match(id, /^wx_[a-z]+$/);
  const back = decodeView('#' + encodeView({ lon: 0, lat: 50, height: 3e6, heading: 0, pitch: -90, weather: weatherFor(['wx_gust', 'wx_cloud'], 'ecmwf') }));
  assert.deepEqual(mapWeatherFor(back.weather), { layers: ['wx_gust', 'wx_cloud'], model: 'ecmwf' }, 'through a link');
  assert.deepEqual(globeLayersFor(['airports']), ['airports']); assert.deepEqual(mapLayersFor(['airports', 'air']), ['airports'], 'a link never starts the aircraft sweep');
});
