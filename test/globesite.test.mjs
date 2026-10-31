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

test('globe site: adsb.lol is not on the public relay, so aircraft fail as not carried without a request', async () => {
  assert.equal(env.ON_SITE, true); assert.equal(env.RELAY, null);
  calls.length = 0;
  const e = await env.getJSON('https://api.adsb.lol/v2/mil', { relay: true }).then(() => null, x => x);
  assert.ok(e && e.notCarried, 'a typed, permanent error'); assert.match(e.message, /download version/);
  assert.equal(calls.length, 0, 'nothing is asked');
});

test('globe site: a deployed Worker refusing a host it should carry stops that host for the visit after one request', async () => {
  const geo = 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json', other = 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json';
  answer = () => new Response('host not on the relay allowlist: www.submarinecablemap.com', { status: 403 });
  calls.length = 0;
  const e = await env.getJSON(geo, { relay: true }).then(() => null, x => x);
  assert.ok(e && e.notCarried); assert.match(e.message, /download version/);
  assert.deepEqual(calls, [PUBLIC_RELAY + encodeURIComponent(geo)], 'asked once, through the public relay');
  assert.equal(env.carried(geo), false); assert.equal(env.relayed(other), null, 'the host is off for every query');
  const again = await env.getJSON(other, { relay: true }).then(() => null, x => x);
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
  assert.match(ui, /setText\(\$\('#sAir'\), heard\.air \? fmt\(air\) : '—'\); setText\(\$\('#sMil'\), heard\.mil \? fmt\(mil\) : '—'\);/);
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
  const lines = main.match(/'No live aircraft on the website[^']*'/g) || [];
  assert.equal(lines.length, 1); assert.match(main, /if \(Air\.offSite\) return; Air\.offSite = true;/, 'once per visit');
  assert.match(main, /ON_SITE \? 'No live aircraft on the website: they come with the free download' : 'No live aircraft here: they need the local helper/, 'the website\'s wording only on the website');
  // the line waits for the globe: the feeds stop long before the boot screen (above #toast) lifts
  assert.match(main, /function later\(msg, ms, cond = \(\) => true\) \{\n  if \(EMBED\) return;\n  const tell = \(\) => \{ if \(!Share\.booted\) return setTimeout\(tell, 1000\);/);
  assert.match(main, /setTimeout\(\(\) => cond\(\) && toast\(msg, ms\), wait\)/, 'a beat after boot, after any line already showing');
  assert.doesNotMatch(main.slice(main.indexOf('function noAir'), main.indexOf('const airKeep')), /\btoast\(/, 'noAir says it through later()');
  assert.match(main, /onStop \? onStop\(e\) : later\(`\$\{label\}: \$\{HERE\}`, 4000\)/, 'any other stopped feed says so once too');
  assert.match(main, /hooks\.airKeep = airKeep;/);
  assert.match(read('src/globe/trails.js'), /\(document\.hidden && !hooks\.airKeep\?\.\(\)\)/, 'a watched plane\'s own fixes keep coming in a hidden tab');
  assert.match(read('src/globe/voice.js'), /Air\.offSite \? 'Live aircraft come with the free download; the website has none\.'/);
  assert.match(read('src/globe/nerd.js'), /Air\.offSite \? '<dt>Live aircraft<\/dt><dd>download version<\/dd>'/);
});

test('globe and map: the website\'s dock and search text promise no live aircraft', () => {
  const layers = read('src/globe/layers.js');
  assert.match(layers, /const AIR_HERE = !!RELAY, AIR_WHERE = ON_SITE \? 'download version' : 'needs the local helper';/, 'the same test as main.js noAir');
  assert.match(layers, /AIR_HERE \? 'Civil aircraft \(OpenSky, every 15 min\)' : `Civil aircraft \(\$\{AIR_WHERE\}\)`/);
  assert.match(layers, /AIR_HERE \? 'Military aircraft \(adsb\.lol, every 60 s\)' : `Military aircraft \(\$\{AIR_WHERE\}\)`/);
  assert.match(read('open-overwatch.html'), /<p class="sub">A live picture of what is moving right now — satellites, ships, storms and quakes \(live aircraft in the free download\)/);
  for (const page of ['globe.html', 'open-overwatch.html']) {
    const html = read(page);
    for (const m of html.matchAll(/<meta (?:name="(?:twitter:)?description"|property="og:description") content="([^"]*)"/g)) {
      assert.doesNotMatch(m[1].replace('Live aircraft come with the free download.', ''), /aircraft|military flights/i, `${page}: ${m[1]}`);
      assert.match(m[1], /Live aircraft come with the free download\.$/, page);
    }
  }
});
