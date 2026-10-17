// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The globe on the published website: a relay refusal (the deployed Worker's own 403) marks the host for the visit and
// stops its feed with no further requests, a feed's own 403 does not; the header never shows a 0 for aircraft no feed
// sent; the dock, the meta text and the feed timers say what the website carries. env.js runs here with a stub page
// on destinjones.github.io; the other globe modules need Cesium and the DOM, so they are read from the source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// a stub page on the website: no local helper, so the public relay is the only way to the CORS-less feeds
const calls = [];
let answer = () => new Response('{}', { status: 200 });
Object.assign(globalThis, {
  window: { Cesium: {} },
  location: { hostname: 'destinjones.github.io', protocol: 'https:', origin: 'https://destinjones.github.io', href: 'https://destinjones.github.io/open-overwatch/globe.html' },
  document: { body: { classList: { add() {} } }, querySelector: () => null },
  matchMedia: () => ({ matches: false }),
  screen: { width: 1920, height: 1080 },
  fetch: async (url) => { calls.push(url); return answer(url); },
});
const env = await import('../src/globe/env.js');
const { PUBLIC_RELAY } = await import('../src/core/relay.js');

test('globe site: the Worker refusing adsb.lol stops it for the visit after one request', async () => {
  assert.equal(env.ON_SITE, true); assert.equal(env.RELAY, null);
  const mil = 'https://api.adsb.lol/v2/mil', tile = 'https://api.adsb.lol/v2/point/50.054/0/250';
  answer = () => new Response('host not on the relay allowlist: api.adsb.lol', { status: 403 });
  calls.length = 0;
  const e = await env.getJSON(mil, { relay: true }).then(() => null, x => x);
  assert.ok(e && e.notCarried, 'a typed, permanent error'); assert.match(e.message, /download version/);
  assert.deepEqual(calls, [PUBLIC_RELAY + encodeURIComponent(mil)], 'asked once, through the public relay');
  assert.equal(env.carried(mil), false); assert.equal(env.relayed(tile), null, 'the host is off for every query');
  const again = await env.getJSON(tile, { relay: true }).then(() => null, x => x);
  assert.ok(again && again.notCarried); assert.equal(calls.length, 1, 'and asks no more');
});

test('globe site: a feed\'s own 403 through the relay is an ordinary failure (retried, host still carried)', async () => {
  const nhc = 'https://www.nhc.noaa.gov/CurrentStorms.json';
  answer = () => new Response('Forbidden', { status: 403 });
  const e = await env.getJSON(nhc, { relay: true }).then(() => null, x => x);
  assert.equal(e.message, 'HTTP 403'); assert.ok(!e.notCarried);
  assert.equal(env.carried(nhc), true);
  answer = () => new Response('{"activeStorms":[]}', { status: 200 });
  assert.deepEqual(await env.getJSON(nhc, { relay: true }), { activeStorms: [] });
});

test('globe site: a feed only the download\'s helper relays fails as not carried, without a request', async () => {
  calls.length = 0;
  const e = await env.getJSON('https://opensky-network.org/api/states/all', { relay: true }).then(() => null, x => x);
  assert.ok(e && e.notCarried); assert.equal(calls.length, 0);
});

test('globe site: NDBC refused through getText is not carried either (the buoy layers say "download version")', async () => {
  answer = () => new Response('host not on the relay allowlist: www.ndbc.noaa.gov', { status: 403 });
  const url = 'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt';
  const e = await env.getText(env.relayed(url)).then(() => null, x => x);
  assert.ok(e && e.notCarried); assert.equal(env.relayed(url), null);
  const ocean = read('src/globe/ocean.js');
  assert.match(ocean, /if \(e\.notCarried\) needsHelper\('buoys'\)/);
  assert.match(ocean, /if \(e\.notCarried\) lacks\(\)/);
  assert.match(ocean, /ON_SITE \? 'NOAA\\'s buoy files need the download version for now/);
});

test('globe: the header shows — for aircraft until a feed answers; phones without aircraft show SAT and QK', () => {
  const ui = read('src/globe/ui.js'), air = read('src/globe/aircraft.js'), html = read('globe.html');
  assert.match(ui, /\$\('#sAir'\)\.textContent = heard\.air \? fmt\(air\) : '—'; \$\('#sMil'\)\.textContent = heard\.mil \? fmt\(mil\) : '—';/);
  for (const k of ['air', 'air', 'mil']) assert.ok(air.includes(`this.answered.${k} = true;`));
  assert.equal(air.match(/this\.answered\.air = true;/g).length, 2, 'the snapshot and the area query both count');
  assert.match(air, /if \(e\.notCarried \|\| \/HTTP 429\/\.test\(e\.message\)\) break;/, 'one refused tile, not three');
  assert.match(html, /body\.no-air \.stats \.stat:nth-child\(-n\+2\)\{display:none\}/);
  assert.match(html, /body\.no-air \.stats \.stat:nth-child\(n\+3\)\{display:block\}/);
});

test('globe: feeds rest in a hidden tab, and a not-carried aircraft feed stops with one honest line', () => {
  const main = read('src/globe/main.js');
  assert.match(main, /document\.addEventListener\('visibilitychange', \(\) => poller\.setHidden\(document\.hidden\)\);/);
  assert.doesNotMatch(main, /return setInterval\(run, ms\)/, 'no plain interval for the feeds');
  assert.match(main, /every\(AIR_TTL\.point \* 1000, \(\) => Air\.civil\(\), 'Civil aircraft', \{ keep: airKeep, onStop: noAir \}\)/);
  assert.match(main, /every\(60e3, \(\) => Air\.military\(\), 'Military aircraft', \{ keep: airKeep, onStop: noAir \}\)/);
  assert.match(main, /every\(10 \* 60e3, \(\) => Quakes\.load\(\), 'Earthquakes'\)/, 'quakes keep the ordinary retry');
  assert.match(main, /const airKeep = \(\) => LandWatch\.map\.size > 0/, 'a plane watched for its landing keeps its feeds');
  const toasts = main.match(/toast\('No live aircraft on the website[^']*'/g) || [];
  assert.equal(toasts.length, 1); assert.match(main, /if \(Air\.offSite\) return; Air\.offSite = true;/, 'once per visit');
});

test('globe and map: the website\'s dock and search text promise no live aircraft', () => {
  const layers = read('src/globe/layers.js');
  assert.match(layers, /const AIR_HERE = !\(ON_SITE && !RELAY\);/);
  assert.match(layers, /AIR_HERE \? 'Civil aircraft \(OpenSky, every 15 min\)' : 'Civil aircraft \(download version\)'/);
  assert.match(layers, /AIR_HERE \? 'Military aircraft \(adsb\.lol, every 60 s\)' : 'Military aircraft \(download version\)'/);
  for (const page of ['globe.html', 'open-overwatch.html']) {
    const html = read(page);
    for (const m of html.matchAll(/<meta (?:name="(?:twitter:)?description"|property="og:description") content="([^"]*)"/g)) {
      assert.doesNotMatch(m[1].replace('Live aircraft come with the free download.', ''), /aircraft|military flights/i, `${page}: ${m[1]}`);
      assert.match(m[1], /Live aircraft come with the free download\.$/, page);
    }
  }
});
