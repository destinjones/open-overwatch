// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The globe's aviation edges that the core readers decide: a plane with only a geometric altitude is not at 0 m (so the
// airport boards don't list a cruiser as pattern traffic), a declared readsb emergency counts like a 7700 squawk, and
// AWC's empty "no METAR" answer (HTTP 204) is a cached miss, not an outage. env.js runs here with a stub page; the
// modules that need Cesium (aircraft.js, fieldwx.js, airports.js) are read from the source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readsb, openskyState } from '../src/core/aircraft.js';
import { boardStatus } from '../src/core/airports.js';
import { readAwcMetars } from '../src/core/metar.js';

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
  // the boards say EMERGENCY when the squawk isn't one
  for (const f of ['src/globe/airports.js', 'src/map/aviation.js']) assert.match(read(f), /\/\^7\[567\]00\$\/\.test\(r\.squawk \|\| ''\) \? 'SQUAWK ' \+ esc\(r\.squawk\) : 'EMERGENCY'/, f);
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

test('2D map airport card: a METAR with no usable wind falls back to the model wind', () => {
  const src = read('src/map/aviation.js');
  assert.match(src, /metarWind = mw && mw\.speedKt != null && \(mw\.dir != null \|\| mw\.vrb \|\| mw\.calm\) \? mw : null;/);
  assert.match(src, /const wx = metarWind \? null : fieldWeather\(a\);/);
  assert.match(src, /const wind = metarWind \? \{ dir: metarWind\.dir, speed: metarWind\.speedKt \} : wx && \{ dir: wx\.windDir, speed: wx\.windKt \};/);
});
