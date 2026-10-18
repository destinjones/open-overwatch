// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The 2D map's feed layers (src/map/feeds.js, ocean.js, util.js). Those modules need Leaflet and a page, so the pieces
// with logic are lifted out of the source text and run here with the core functions they call; the wiring is checked
// as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kpSeries, kpSummary, KP_FORECAST_URL } from '../src/core/earthnow.js';
import { latestKp, KP_URL } from '../src/core/aurora.js';

const src = f => readFileSync(new URL('../src/map/' + f, import.meta.url), 'utf8');
const FEEDS = src('feeds.js'), OCEAN = src('ocean.js'), UTIL = src('util.js'), MEASURE = src('measure.js');
/** The text of `function name(...) { ... }` (or a class) from a module's source, braces matched. */
function block(text, start) {
  const i = text.indexOf(start); assert.ok(i >= 0, 'not found: ' + start);
  let depth = 0, j = text.indexOf('{', i);
  for (; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}' && --depth === 0) break; }
  return text.slice(i, j + 1).replace(/^export /, '');
}
const lift = (code, name, deps = {}) => new Function(...Object.keys(deps), `${code}\nreturn ${name};`)(...Object.values(deps));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('unwrap (util.js): a track through ±180 keeps continuous longitudes; measure.js uses the same one', () => {
  const unwrap = lift(block(UTIL, 'export function unwrap('), 'unwrap');
  const track = [[178.5, -16], [179.5, -17], [-179.5, -18], [-178.2, -19]];   // [lon, lat], a South Pacific cyclone
  const ll = unwrap(track);
  assert.deepEqual(ll.map(p => p[0]), [-16, -17, -18, -19], 'lat first, for Leaflet');
  for (let i = 1; i < ll.length; i++) assert.ok(Math.abs(ll[i][1] - ll[i - 1][1]) < 5, `step ${i}: ${ll[i - 1][1]} → ${ll[i][1]}`);
  near(ll[2][1], 180.5, 1e-9); near(ll[3][1], 181.8, 1e-9);
  near(unwrap([[-179.5, 0], [179.5, 0]])[1][1], -180.5, 1e-9, 'westward too');
  near(unwrap([[10, 0]], 370)[0][1], 370, 1e-9, 'the copy nearest a reference longitude');
  assert.deepEqual(unwrap([[10, 50], [20, 51]]), [[50, 10], [51, 20]], 'an ordinary path is unchanged');
  assert.ok(!/function unwrap\(/.test(MEASURE) && /unwrap \} from '\.\/util\.js'|, unwrap \}/.test(MEASURE), 'measure.js imports it rather than keeping its own');
});

test('feeds.js: storm tracks, cones, wind rings, warnings and EONET tracks go through unwrap', () => {
  assert.match(FEEDS, /const ll = \(path, ref\) => unwrap\(path, ref\)/, 'drawForecast: cone, forecast track, warnings, past track, wind rings');
  assert.ok(!/ll\([rp]\)/.test(FEEDS), 'every drawForecast shape passes the storm reference');
  assert.match(FEEDS, /drawForecast\(s\.fc, s\.lon\)/, 'one reference longitude a storm: its own');
  assert.match(FEEDS, /L\.polyline\(unwrap\(s\.track\.map\(p => \[p\.lon, p\.lat\]\), s\.lon\)/, 'the EONET storm track, in the world copy of the storm');
  assert.match(FEEDS, /L\.polyline\(unwrap\(ev\.track\.slice\(-12\)\.map\(x => \[x\.lon, x\.lat\]\)\)/, 'natural-event tracks');
  assert.ok(!/L\.poly(line|gon)\([a-z.]+\.map\(\w+ => \[\w+\.lat, \w+\.lon\]\)/.test(FEEDS), 'no raw [lat, lon] paths left');
});

test('Natural events leave the storms to the cyclones layer (as the globe does)', () => {
  assert.match(FEEDS, /parseEonet\(await Net\.json\(eonetUrl\(\{ days: 20 \}\)\)\)\.filter\(e => e\.cat !== 'severeStorms'\); gEvents\.clearLayers\(\); const items = \[\];/, 'filtered, and the layer still cleared each load');
  const desc = /id: 'events'[^\n]*desc: '([^']*)'/.exec(FEEDS)[1];
  assert.ok(!/storms,/.test(desc), desc);
});

test('NWS: typhoon and tropical storm alerts get the alert colour; zone alerts are listed, escaped, and their zones drawn on opening', () => {
  const major = new RegExp(/NWS_MAJOR = \/(.*)\/i;/.exec(FEEDS)[1], 'i');
  for (const ev of ['Typhoon Warning', 'Tropical Storm Warning', 'Hurricane Warning', 'Tornado Warning', 'Extreme Wind Warning']) assert.ok(major.test(ev), ev);
  for (const ev of ['Freeze Warning', 'Red Flag Warning', 'Flood Warning']) assert.ok(!major.test(ev), ev);
  const zone = new RegExp(/NWS_ZONE = \/(.*?)\/, NWS_ZONES_MAX = (\d+)/.exec(FEEDS)[1]);
  assert.equal(+/NWS_ZONES_MAX = (\d+)/.exec(FEEDS)[1], 5, 'at most 5 zones an alert');
  for (const u of ['https://api.weather.gov/zones/forecast/GUZ001', 'https://api.weather.gov/zones/county/TXC123', 'https://api.weather.gov/zones/fire/CAZ241']) assert.ok(zone.test(u), u);
  for (const u of ['https://evil.example/zones/forecast/GUZ001', 'https://api.weather.gov/zones/forecast/GUZ001?x=1', 'http://api.weather.gov/zones/forecast/GUZ001', 'https://api.weather.gov/alerts/active']) assert.ok(!zone.test(u), u);
  assert.match(FEEDS, /p\.zoneOnly = !f\.geometry/, 'null-geometry alerts are kept, marked');
  assert.match(FEEDS, /NWS_ZONE_TTL = 86400e3/, 'zones kept a day');
  assert.match(FEEDS, /if \(Sel\.obj === p \|\| Sel\.obj === cur\) Detail\.render\(\)/, 'the open card says what was drawn');
  const list = block(FEEDS, 'const nwsList = {');
  const holes = [...list.matchAll(/\$\{([^{}]*)\}/g)].map(m => m[1]).filter(e => /\bp\./.test(e));
  assert.ok(holes.length >= 3, 'event, area and expiry are interpolated');
  for (const e of holes) assert.match(e, /^esc\(/, 'every upstream string through esc(): ' + e);
  assert.match(list, /data-nws="\$\{i\}"/, 'the button carries an index, not upstream text');
  assert.match(list, /querySelector\('details'\)\?\.open/, 'a refresh keeps an open list open');
  assert.match(list, /if \(!lyNws\.on\) \{ el\.innerHTML = ''/, 'no stale list while the layer is off');
  assert.match(FEEDS, /read: turn the layer on to see them/, 'the card does not say drawn while the layer is off');
});

test('Kp chip: the forecast product\'s block in progress (as the globe), the observed list only as a fallback', async () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/earthnow/swpc_kp_forecast_2026-10-13.json', import.meta.url), 'utf8'));
  const series = kpSeries(fx, { now: Date.UTC(2026, 9, 13, 23), pastH: 1e6, aheadH: 1e6 });
  const est = series.find(r => r.kind === 'estimated'); assert.ok(est, 'the fixture has an estimated block');
  const now = est.t + 3600e3, real = Date.now;
  const observed = [['time_tag', 'Kp'], [new Date(est.t - 3 * 3600e3).toISOString().slice(0, 19), '6.00']];
  let calls = [];
  const kpNow = lift(block(FEEDS, 'export async function kpNow('), 'kpNow', {
    Net: { json: async u => { calls.push(u); if (u === KP_FORECAST_URL) { if (kpNow.failForecast) throw new Error('timeout'); return fx; } return observed; } },
    kpSeries, kpSummary, latestKp, KP_URL, KP_FORECAST_URL,
  });
  Date.now = () => now;
  try {
    const k = await kpNow();
    assert.equal(k.kind, 'estimated'); assert.equal(k.kp, est.kp); assert.equal(k.t, new Date(est.t).toISOString().slice(0, 19));
    assert.deepEqual(calls, [KP_FORECAST_URL], 'one request when the forecast answers');
    assert.equal(k.kp, kpSummary(kpSeries(fx, { now }), now).now.kp, 'the globe\'s Earth-now value');
    calls = []; kpNow.failForecast = true;
    const f = await kpNow();
    assert.deepEqual(f, { kp: 6, t: observed[1][0], kind: 'observed' }); assert.deepEqual(calls, [KP_FORECAST_URL, KP_URL]);
  } finally { Date.now = real; }
  assert.match(FEEDS, /now\.kind === 'estimated' \? ' \(estimated/, 'the chip title says estimated');
});

test('slow-changing files may come from the browser cache; live feeds stay no-store', () => {
  assert.match(FEEDS, /firstOk\(CABLE_URLS, \{ timeout: 60000, cache: 'default' \}\)/);
  assert.match(FEEDS, /firstOk\(LANDING_URLS, \{ timeout: 60000, cache: 'default' \}\)/);
  assert.match(FEEDS, /cache: id === 'sg' \? 'no-store' : 'default'/, 'camera lists (Singapore\'s addresses change every few minutes)');
  assert.match(FEEDS, /aisGet\('vessels', 'default'\)/, 'Digitraffic ship details'); assert.match(FEEDS, /aisGet\('locations'\)/, 'positions stay live');
  assert.match(UTIL, /cache = 'no-store'/, 'Net.fetch still defaults to no-store');
});

test('GDACS geometry: episodes gone from the list are dropped, at most 24 kept', () => {
  const Kept = lift(block(FEEDS, 'class KeptGeometry extends Map'), 'KeptGeometry');
  const k = new Kept(); for (const id of ['1/1', '1/2', '2/7']) k.set(id, { id });
  k.used.clear(); k.has('1/2'); k.get('1/2'); k.get('2/7');
  const prune = /if \(!gdacsDown\) (for \(const k of \[\.\.\.gdacsKept\.keys\(\)\]\) if \(!gdacsKept\.used\.has\(k\)\) gdacsKept\.delete\(k\);)/.exec(FEEDS);
  assert.ok(prune, 'pruned only when GDACS answered');
  new Function('gdacsKept', prune[1])(k);
  assert.deepEqual([...k.keys()], ['1/2', '2/7']);
  assert.match(FEEDS, /if \(what === 'GDACS'\) gdacsDown = true/);
  assert.match(FEEDS, /GDACS_KEEP = 24/); assert.match(FEEDS, /while \(gdacsKept\.size > GDACS_KEEP\) gdacsKept\.delete\(gdacsKept\.keys\(\)\.next\(\)\.value\)/);
});

test('ocean cards: a DART reading is re-read after 5 min and a tide after 10; a failed read is retried on a later opening', () => {
  const readDue = lift(OCEAN.match(/export const readDue = ([^\n]*);\n/)[1].replace(/^/, 'const readDue = '), 'readDue');
  const t0 = 1e12;
  assert.equal(readDue({}, 300e3, t0), true, 'never read');
  assert.equal(readDue({ reading: Promise.resolve() }, 300e3, t0), false, 'a read in flight');
  assert.equal(readDue({ readAt: t0 - 60e3 }, 300e3, t0), false, 'fresh');
  assert.equal(readDue({ readAt: t0 - 301e3 }, 300e3, t0), true, 'stale: read again');
  assert.equal(readDue({ failAt: t0 - 1e3, err: 'timeout' }, 300e3, t0), false, 'the re-render right after a failure does not loop');
  assert.equal(readDue({ failAt: t0 - 20e3, err: 'timeout' }, 300e3, t0), true, 'the next opening retries');
  assert.match(OCEAN, /DART_MAX_AGE = 5 \* 60e3, TIDE_MAX_AGE = 10 \* 60e3/);
  assert.match(OCEAN, /if \(readDue\(o, DART_MAX_AGE\)\)/); assert.match(OCEAN, /if \(readDue\(o, TIDE_MAX_AGE\)\) reread\(o, readTide\)/);
  assert.ok(!/o\.read = /.test(OCEAN), 'no once-per-visit promise left');
  assert.match(OCEAN, /tideRows\(t\.st, t\.latest, t\.hilo \? nextTides\(t\.hilo\) : null\)/, 'tide rows worded when drawn, not frozen at the read');
});
