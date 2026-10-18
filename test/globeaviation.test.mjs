// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The globe's aviation edges that the core readers decide: a plane with only a geometric altitude is not at 0 m (so the
// airport boards don't list a cruiser as pattern traffic), a declared readsb emergency counts like a 7700 squawk, and
// AWC's empty "no METAR" answer (HTTP 204) is a cached miss, not an outage. env.js runs here with a stub page; the
// modules that need Cesium (aircraft.js, fieldwx.js, airports.js) are read from the source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readsb, openskyState, emergencyLabel } from '../src/core/aircraft.js';
import { boardStatus } from '../src/core/airports.js';
import { readAwcMetars, parseWind, parseMetar, usableWind } from '../src/core/metar.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

let answer = () => new Response('[]', { status: 200 });
Object.assign(globalThis, {
  window: { Cesium: {} },
  location: { hostname: 'localhost', protocol: 'http:', origin: 'http://localhost:8787', href: 'http://localhost:8787/globe.html' },
  document: { body: { classList: { add() {} } }, querySelector: () => null },
  matchMedia: () => ({ matches: false }),
  screen: { width: 1920, height: 1080 },
  fetch: async url => answer(url),
});
const env = await import('../src/globe/env.js');

test('globe aircraft: the altitude falls back to geometric, and a declared emergency counts', () => {
  const src = read('src/globe/aircraft.js');
  assert.match(src, /alt: x\.altM \?\? x\.geomM \?\? 0,/, 'readsb: barometric, else geometric');
  assert.match(src, /alt: alt \?\? geo \?\? 0,/, 'OpenSky: barometric, else geometric');
  assert.match(src, /emerg: x\.emerg,/, 'the core reader decides (squawk or declared)');
  assert.doesNotMatch(src, /alt: x\.altM \|\| 0|alt: alt \|\| 0/);
  // why: a cruiser 5.6 km from a field with no barometric altitude
  const LHR = { icao: 'EGLL', lat: 51.4706, lon: -0.4619, elevM: 25 };
  const x = readsb({ hex: 'a1b2c3', lat: 51.5206, lon: -0.4619, alt_geom: 35000, gs: 450, track: 90, squawk: '1200', emergency: 'general' });
  assert.equal(x.altM, null); assert.ok(x.geomM > 10000); assert.equal(x.emerg, true, 'declared, with an ordinary squawk');
  const p = alt => ({ lat: x.lat, lon: x.lon, alt, gs: x.gsMs, track: x.track, vr: 0 });
  assert.ok(boardStatus(LHR, p(0)), 'at 0 m it would be on the board');
  assert.equal(boardStatus(LHR, p(x.altM ?? x.geomM ?? 0)), null, 'at its geometric altitude it is not');
  const o = openskyState(['abc123', 'X', 'Y', 0, 0, -0.4619, 51.5206, null, false, 230, 90, 0, null, 10900, '1200']);
  assert.equal(o.altM, null); assert.equal(o.geomM, 10900);
});

test('the boards’ emergency tag: SQUAWK nnnn for an emergency squawk, EMERGENCY when declared with another', () => {
  assert.equal(emergencyLabel(readsb({ hex: 'a1', lat: 0, lon: 0, squawk: '7700' })), 'SQUAWK 7700');
  assert.equal(emergencyLabel(readsb({ hex: 'a1', lat: 0, lon: 0, squawk: '7500', emergency: 'unlawful' })), 'SQUAWK 7500');
  assert.equal(emergencyLabel(readsb({ hex: 'a1', lat: 0, lon: 0, squawk: '1200', emergency: 'general' })), 'EMERGENCY');
  assert.equal(emergencyLabel(readsb({ hex: 'a1', lat: 0, lon: 0, emergency: 'minfuel' })), 'EMERGENCY', 'declared, no squawk');
  assert.equal(emergencyLabel(readsb({ hex: 'a1', lat: 0, lon: 0, squawk: '1200', emergency: 'none' })), '');
  assert.equal(emergencyLabel({ emerg: true, squawk: '7777' }), 'EMERGENCY');
  assert.equal(emergencyLabel(null), '');
  // both views' boards use it (escaped)
  for (const f of ['src/globe/airports.js', 'src/map/aviation.js']) {
    const src = read(f);
    assert.match(src, /esc\(emergencyLabel\(r\)\)/, f);
    assert.doesNotMatch(src, /'SQUAWK ' \+/, f + ': no second copy of the rule');
  }
});

test('globe field weather: AWC\'s empty 204 is no report (cached), network trouble still throws', async () => {
  answer = () => new Response(null, { status: 204 });
  const e = await env.getJSON('https://aviationweather.gov/api/data/metar?ids=AGGM&format=json').then(() => null, x => x);
  assert.ok(e instanceof SyntaxError, 'what fieldwx.js has to catch: ' + (e && e.name));
  assert.equal(readAwcMetars([]).size, 0);
  const src = read('src/globe/fieldwx.js');
  assert.match(src, /const awcJSON = url => getJSON\(url, \{ relay: true, timeout: 15000 \}\)\.catch\(e => \{ if \(e instanceof SyntaxError\) return \[\]; throw e; \}\);/);
  assert.match(src, /readAwcMetars\(await awcJSON\(metarUrl\(batch\)\)\)/);
  assert.match(src, /readAwcTafs\(await awcJSON\(tafUrl\(\[icao\]\)\)\)/);
  assert.doesNotMatch(src, /await getJSON\(/, 'every AWC answer goes through awcJSON');
  answer = () => new Response('', { status: 503 });
  const e2 = await env.getJSON('https://aviationweather.gov/api/data/metar?ids=EGLL&format=json').then(() => null, x => x);
  assert.ok(e2 && !(e2 instanceof SyntaxError), 'an HTTP error is not a miss');
});

test('airport cards: a METAR with no usable wind falls back to the model wind (both views)', () => {
  assert.equal(usableWind(parseWind('27015KT'))?.dir, 270);
  assert.equal(usableWind(parseWind('27015G//KT'))?.speedKt, 15, 'an unreported gust keeps the wind');
  assert.ok(usableWind(parseWind('VRB03KT')), 'variable');
  assert.ok(usableWind(parseWind('00000KT')), 'calm');
  assert.equal(usableWind(parseWind('///15KT')), null, 'no direction');
  assert.equal(usableWind(parseWind('/////KT')), null, 'nothing');
  assert.equal(usableWind(null), null);
  assert.equal(usableWind(parseMetar('METAR EGLL 171350Z ///15KT 9999 FEW030 15/08 Q1015', { now: Date.UTC(2026, 9, 17, 14) }).wind), null);
  assert.ok(usableWind(parseMetar('METAR EGLL 171350Z 27015KT 9999 FEW030 15/08 Q1015', { now: Date.UTC(2026, 9, 17, 14) }).wind));
  // the views take the METAR's wind only through it, else the model's, and say so on the runway-in-use line
  const map = read('src/map/aviation.js'), globe = read('src/globe/airports.js');
  assert.match(map, /const metarWind = metar \? usableWind\(metar\.wind\) : null;/);
  assert.match(map, /const wx = metarWind \? null : fieldWeather\(a\);/);
  assert.match(globe, /const mw = metar && usableWind\(metar\.wind\);/);
  assert.match(globe, /if \(!usableWind\(m\.wind\)\) fieldWeather\(a\)/, 'the globe asks the model for the wind under such a METAR');
  for (const src of [map, globe]) assert.match(src, /modelWind \? ' <(small|span class="ap-src")>\(Open-Meteo model wind\)/);
});
