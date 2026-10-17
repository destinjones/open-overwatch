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

test('a hostile rate, heading or pitch is clamped, not applied', () => {
  assert.equal(decodeView('#c=0,0,1e7&t=2461000,1e300').time.rate, 3652.5 * 86400);
  assert.equal(decodeView('#c=0,0,1e7&t=2461000,-1e300').time.rate, -3652.5 * 86400);
  assert.equal(decodeView('#c=0,0,1e7&t=2461000,3600').time.rate, 3600);           // the time bar's fastest survives
  assert.equal(decodeView('#c=0,0,1e7&t=2461000,x').time.rate, 1);
  const v = decodeView('#c=0,0,1000,1e308,-1e308');
  assert.ok(v.heading >= 0 && v.heading < 360, `heading ${v.heading}`); assert.equal(v.pitch, -90);
  assert.equal(decodeView('#c=0,0,1000,-90,400').heading, 270); assert.equal(decodeView('#c=0,0,1000,-90,400').pitch, 90);
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

test('a satellite numbered under 10000 survives a link: "00005" in the TLE, "5" in s=, found either way', async () => {
  const { noradKeys } = await import('../src/core/viewlink.js');
  const { parseTle } = await import('../src/core/tle.js');
  const tle = 'VANGUARD 1\n1 00005U 58002B   26274.50000000  .00000100  00000+0  10000-3 0  9990\n2 00005  34.2500 100.0000 1845000 200.0000 150.0000 10.85000000400000\n';
  const [t] = parseTle(tle);
  assert.equal(t.id, '00005', 'the TLE keeps the padding');
  const back = decodeView('#' + encodeView({ lon: 0, lat: 0, height: 2e7, heading: 0, pitch: -90, sat: t.id }));
  assert.equal(back.sat, '5', 's= drops leading zeros (docs/LINK_FORMAT.md)');
  // the globe's Sats.byId is filled the same way (src/globe/satellites.js): both spellings find the satellite
  const byId = new Map(); for (const k of noradKeys(t.id)) byId.set(k, t);
  assert.equal(byId.get(back.sat), t, 'a link finds it'); assert.equal(byId.get('00005'), t, 'the padded id still does');
  assert.deepEqual(noradKeys('25544'), ['25544']); assert.deepEqual(noradKeys('A0001'), ['A0001'], 'Alpha-5 ids are left alone');
  assert.deepEqual(noradKeys(900), ['900']); assert.deepEqual(noradKeys('00900'), ['00900', '900']);
  assert.match(readFileSync(new URL('../src/globe/satellites.js', import.meta.url), 'utf8'), /for \(const k of noradKeys\(t\.id\)\) this\.byId\.set\(k, s\)/, 'the globe registers both spellings');
});

test('every layer both views have under the same id is carried by cross-view links', async () => {
  const { MAP_TO_GLOBE, globeLayersFor, mapLayersFor } = await import('../src/core/viewlink.js');
  const { readdirSync } = await import('node:fs');
  const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const globe = new Set([...read('src/globe/layers.js').matchAll(/\{ id: '([a-z0-9_]+)', group:/g)].map(m => m[1]));
  const map = new Set();
  for (const f of readdirSync(new URL('../src/map/', import.meta.url)).filter(f => f.endsWith('.js'))) {
    const src = read('src/map/' + f);
    for (const m of src.matchAll(/Layers\.add\(\{\s*id: '([a-z0-9_]+)'/g)) map.add(m[1]);
    for (const m of src.matchAll(/gibsLayer\('[a-z0-9_]+', '([a-z0-9_]+)'/g)) map.add(m[1]);
  }
  assert.ok(globe.size > 40 && map.size > 40, `both lists parsed (${globe.size} globe, ${map.size} map)`);
  for (const [m, g] of Object.entries(MAP_TO_GLOBE)) { assert.ok(map.has(m), `${m} is a 2D map layer`); assert.ok(globe.has(g), `${g} is a globe layer`); }
  // a layer both views have under one id is mapped to itself, unless it is listed here with the reason it is not
  /** @type {Record<string, string>} */
  const EXCLUDED = {};
  for (const id of [...map].filter(id => globe.has(id) && !(id in EXCLUDED))) {
    assert.equal(MAP_TO_GLOBE[/** @type {keyof typeof MAP_TO_GLOBE} */ (id)], id, `${id}: in both views, so MAP_TO_GLOBE carries it`);
    assert.deepEqual(globeLayersFor([id]), [id], `${id}: map to globe`);
    assert.ok(mapLayersFor([id]).length, `${id}: globe to map`);
  }
  for (const id of ['events', 'reentry', 'alpr', 'milareas']) assert.ok(mapLayersFor([id]).includes(id), id);
});
