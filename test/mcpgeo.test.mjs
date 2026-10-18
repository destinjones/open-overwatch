// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The MCP tools' geography (mcp/): places that run round the antimeridian, Russia's briefing, the local day at UTC+12 to
// +14 and on clock-change days, a Pacific path's camera, traffic-camera pictures under one deadline, and satellite lookups
// that parse an element set once. No network: every source is a canned answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFeeds, SITE } from '../mcp/feeds.mjs';
import { resolveArea, inArea, frameArea, preparedBorders, STORM_SEA_DEG } from '../mcp/place.mjs';
import { createTools } from '../mcp/tools.mjs';
import { inCountry, offCoast, nearParts } from '../src/core/borders.js';
import { countryTool } from '../mcp/country.mjs';
import { sunTool, localDay } from '../mcp/sun.mjs';
import { distanceTool } from '../mcp/distance.mjs';
import { volcanoesTool } from '../mcp/volcanoes.mjs';
import { camerasTool } from '../mcp/cams.mjs';
import { findSats, loadGroup, parseGroup } from '../mcp/sats.mjs';
import { CAMERA_NETS as CAM_NETS } from '../src/core/cameras.js';
import { decodeView } from '../src/core/viewlink.js';
import { haversine } from '../src/core/geo.js';

const root = new URL('../', import.meta.url);
const file = p => readFileSync(new URL(p, root), 'utf8');
const BORDERS = file('data/borders.json'), COUNTRIES = file('data/countries.json');
const NOW = Date.parse('2026-10-17T03:00:00Z');

/** createFeeds over canned answers: routes are [string prefix | RegExp, body | (url) => body]; anything else is a 404. */
function feedsFor(routes, extra = {}) {
  const asked = [];
  const fetchImpl = async url => {
    asked.push(url);
    for (const [m, body] of routes) {
      if (!(typeof m === 'string' ? url.startsWith(m) : m.test(url))) continue;
      const b = typeof body === 'function' ? body(url) : body;
      if (b instanceof Uint8Array) return new Response(b, { status: 200 });
      return new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('nothing here', { status: 404 });
  };
  return { feeds: createFeeds({ fetchImpl, now: () => NOW, ...extra }), asked };
}
const photon = feature => [/photon\.komoot\.io\/api\//, { features: [feature] }];
const run = (tool, args) => tool.run(args, { signal: undefined });
const viewOf = url => decodeView(new URL(url).hash);

// ---- places right round the world -----------------------------------------------------------------------------------
// Photon's own extents (checked live 2026-10-17): land on both sides of the antimeridian comes back as west -180, east 180
const WIDE = {
  'United States': { kind: 'country', cc: 'US', extent: [-180, 71.5889534, 180, -14.7608358], at: [-100.445882, 39.7837304],
    inside: [[61.22, -149.9, 'Anchorage'], [21.31, -157.86, 'Honolulu'], [39.1, -94.6, 'Kansas City'], [27, -90, 'the Gulf of Mexico'], [51.5, -178, 'the Aleutian trench, west of the main box'], [19.0, -155.6, 'the sea just off Hawaii']],
    outside: [[27.47, -112.59, 'Tres Vírgenes, Baja California'], [49.28, -123.12, 'Vancouver']] },
  Russia: { kind: 'country', cc: 'RU', extent: [-180, 82.0586, 180, 41.1851], at: [97.7453061, 64.6863136], inside: [[55.75, 37.6, 'Moscow'], [62.03, 129.73, 'Yakutsk'], [66, -172, 'Chukotka east of 180'], [53.0, 158.65, 'Petropavlovsk'], [45, 153, 'the Kuril trench']],
    outside: [[51, -178, "the Aleutian trench (Alaska's)"], [42.5, 144.5, "off Hokkaido's Pacific coast (Japan's)"], [64.5, -165.4, 'Nome']] },
  Fiji: { kind: 'country', cc: 'FJ', extent: [-180, -12.2613866, 180, -21.9434274], at: [177.9737, -17.7134], inside: [[-18.14, 178.44, 'Suva'], [-18, -178.5, 'the Fiji region east of 180']], outside: [[-21.2, -175.2, 'Tonga']] },
  Alaska: { kind: 'state', cc: 'US', extent: [-180, 71.5889534, 180, 51.0070029], at: [-152.2782, 64.4459613],
    inside: [[61.22, -149.9, 'Anchorage'], [64.84, -147.72, 'Fairbanks'], [51.88, -176.66, 'Adak'], [51.5, -178, 'the Aleutian trench'], [52.9, 173.2, 'Attu'], [55.34, -131.64, 'Ketchikan']],
    outside: [[47.6, -122.3, 'Seattle'], [64.73, 177.5, 'Anadyr'], [60.72, -135.06, 'Whitehorse']] },
  Chukotka: { kind: 'state', cc: 'RU', extent: [-180, 71.81, 180, 61.61], at: [171.0, 66.0], inside: [[64.73, 177.5, 'Anadyr']], outside: [[64.5, -165.4, 'Nome'], [55.75, 37.6, 'Moscow']] },
};
const FAR = [[64.15, -21.94, 'Reykjavik'], [51.5, -0.12, 'London'], [6.45, 3.39, 'Lagos'], [43.65, -79.38, 'Toronto']];
const wideFeature = (name, w) => ({ properties: { osm_key: 'place', osm_value: w.kind, type: w.kind, name, countrycode: w.cc, extent: w.extent }, geometry: { coordinates: w.at } });

test('mcp geo: a place Photon writes right round the world (USA, Russia, Fiji, Alaska, Chukotka) is not a band over every longitude', async () => {
  for (const [name, w] of Object.entries(WIDE)) {
    const { feeds } = feedsFor([photon(wideFeature(name, w)), [SITE + 'data/borders.json', BORDERS]]);
    const a = await resolveArea({ place: name }, feeds);
    for (const [lat, lon, city] of FAR) assert.equal(inArea(a, lat, lon), false, `${city} is not in ${name}`);
    for (const [lat, lon, what] of w.inside) assert.equal(inArea(a, lat, lon), true, `${what} is in ${name}`);
    for (const [lat, lon, what] of w.outside) assert.equal(inArea(a, lat, lon), false, `${what} is not in ${name}`);
    const cam = frameArea(a);
    assert.ok(Math.abs(cam.lon) < 179.9, `${name}'s camera is not parked on the antimeridian: ${cam.lon}`);
    assert.ok(haversine(cam.lat, cam.lon, w.at[1], w.at[0]) < 3500e3, `${name}'s camera is over ${name}: ${cam.lat}, ${cam.lon}`);
    assert.ok(!a.bbox || a.bbox[0] > -179.9 || a.bbox[2] < 179.9, `${name}: no world-wide box left: ${a.bbox}`);
    assert.equal(JSON.stringify(a).includes('poly'), false, 'the outline it tests with stays out of answers');
  }
});

test('mcp geo: the USA frames North America (its main part), Russia Siberia; a round-the-world state is a circle as tall as its box', async () => {
  const { feeds } = feedsFor([photon(wideFeature('United States', WIDE['United States'])), [SITE + 'data/borders.json', BORDERS]]);
  const us = await resolveArea({ place: 'United States' }, feeds), cam = frameArea(us);
  assert.ok(cam.lon > -110 && cam.lon < -85 && cam.lat > 30 && cam.lat < 45, `over the lower 48: ${cam.lat}, ${cam.lon}`);
  const ru = await resolveArea({ place: 'Russia' }, feedsFor([photon(wideFeature('Russia', WIDE.Russia)), [SITE + 'data/borders.json', BORDERS]]).feeds);
  assert.ok(ru.frameLon > 95 && ru.frameLon < 120, `Russia framed over Siberia: ${ru.frameLon}`); assert.ok(ru.bbox[0] > ru.bbox[2], 'its box crosses the antimeridian (west > east)');
  const ak = await resolveArea({ place: 'Alaska' }, feedsFor([photon(wideFeature('Alaska', WIDE.Alaska))]).feeds);
  assert.equal(ak.bbox, null); assert.ok(ak.radiusKm > 1000 && ak.radiusKm < 1300, `Alaska: ${ak.radiusKm} km`);
  // the outlines not loading: a country falls back to a circle too, still nowhere near London
  const lone = await resolveArea({ place: 'United States' }, feedsFor([photon(wideFeature('United States', WIDE['United States']))]).feeds);
  assert.equal(lone.bbox, null); assert.equal(inArea(lone, 51.5, -0.12), false); assert.equal(inArea(lone, 39.1, -94.6), true);
  // a box that really crosses the antimeridian (west > east) is kept as it was
  const fj = await resolveArea({ place: 'Fiji' }, feedsFor([photon({ properties: { osm_value: 'country', name: 'Fiji', countrycode: 'FJ', extent: [176.9, -12.4, -178.2, -20.7] }, geometry: { coordinates: [178, -17.7] } })]).feeds);
  assert.deepEqual(fj.bbox, [176.9, -20.7, -178.2, -12.4]); assert.equal(inArea(fj, -17, -179), true); assert.equal(inArea(fj, -17, 0), false);
});

// ---- country_briefing: Russia ---------------------------------------------------------------------------------------
const quake = (mag, lat, lon, place) => ({ properties: { mag, place, time: NOW - 3600e3, url: 'https://earthquake.usgs.gov/x', type: 'earthquake', tsunami: 0 }, geometry: { coordinates: [lon, lat, 10] } });
const storm = (id, name, lat, lon) => ({ id, name, classification: 'HU', intensity: '90', pressure: '970', latitudeNumeric: lat, longitudeNumeric: lon, movementDir: 0, movementSpeed: 10, lastUpdate: new Date(NOW - 3600e3).toISOString() });

test('mcp geo: country_briefing for Russia counts the Kuril trench off its coast, not Mendocino, the Atlantic ridge, the Gulf of Alaska, the Aleutians or Hokkaido', async () => {
  const { feeds } = feedsFor([
    [SITE + 'data/countries.json', COUNTRIES], [SITE + 'data/borders.json', BORDERS],
    [/earthquake\.usgs\.gov\/.*\/2\.5_week\.geojson$/, { features: [quake(4.1, 40.4, -125.6, 'off Mendocino'), quake(4.6, 45, -28, 'Mid-Atlantic Ridge'), quake(4.2, 57, -147, 'Gulf of Alaska'), quake(5.0, 45.0, 153.0, 'Kuril trench'),
      quake(5.4, 51, -178, 'Aleutian Islands, Alaska'), quake(5.2, 42.5, 144.5, 'off Hokkaido')] }],
    ['https://www.nhc.noaa.gov/CurrentStorms.json', { activeStorms: [storm('al052026', 'Atlantic', 35, -60), storm('wp302026', 'Kamchatka', 50, 160)] }],
  ]);
  const r = await run(countryTool({ feeds, now: () => NOW }), { country: 'Russia' });
  assert.equal(r.data.earthquakes_week.inside, 0); assert.equal(r.data.earthquakes_week.offshore, 1, r.text);
  assert.equal(r.data.earthquakes_week.strongest.place, 'Kuril trench');
  assert.deepEqual(r.data.storms_near.map(s => s.name), ['Kamchatka'], 'a hurricane at 35N 60W is not near Russia');
  const cam = viewOf(r.data.url);
  assert.ok(cam.lon > 95 && cam.lon < 120 && cam.lat > 50 && cam.lat < 65, `framed over Siberia, not the North Sea: ${cam.lat}, ${cam.lon}`);
});

// ---- volcanoes: a round-the-world country is its outline, not its main part's box ------------------------------------
test('mcp geo: volcanoes in the United States take in Alaska and Hawaii (Kilauea) and leave out Baja California', async () => {
  const { feeds } = feedsFor([photon(wideFeature('United States', WIDE['United States'])), [SITE + 'data/borders.json', BORDERS], [SITE + 'data/volcanoes.json', file('data/volcanoes.json')],
    [/earthquake\.usgs\.gov\/.*\/2\.5_week\.geojson$/, { features: [quake(3.1, 19.40, -155.28, 'Kilauea'), quake(3.0, 19.41, -155.27, 'Kilauea'), quake(3.2, 27.47, -112.58, 'Baja'), quake(3.3, 27.46, -112.6, 'Baja'), quake(3.4, 27.48, -112.59, 'Baja')] }]]);
  const r = await run(volcanoesTool({ feeds, now: () => NOW }), { place: 'United States', limit: 40 });
  const names = r.data.volcanoes.map(v => v.name);
  assert.ok(names.includes('Kīlauea'), `Kilauea, restless, is listed among the first: ${names.join(', ')}`);
  assert.ok(!names.includes('Tres Vírgenes'), 'Tres Vírgenes is in Mexico');
  assert.ok(r.data.volcanoes.every(v => v.country === 'United States' || v.country == null), names.join(', '));
  assert.ok(r.data.total > 150, `Alaska's and Hawaii's are counted: ${r.data.total}`);
  assert.match(r.text, /volcanoes in United States/);
});

// ---- storms: a round-the-world country reaches further out to sea --------------------------------------------------
test('mcp geo: storms in the United States include a Gulf hurricane and one off the Southeast (inArea sea reach), not one mid-Atlantic', async () => {
  const gulf = [[25, -88, 'the central Gulf (Yucatán is nearer)'], [27, -93, 'the NW Gulf'], [30, -75, 'off the Southeast (the Bahamas are nearer)']];
  const { feeds } = feedsFor([photon(wideFeature('United States', WIDE['United States'])), [SITE + 'data/borders.json', BORDERS]]);
  const us = await resolveArea({ place: 'United States' }, feeds);
  assert.equal(inArea(us, 25, -88), false, 'the plain area stays the outline and its 2.5° coast (earthquakes, volcanoes)');
  for (const [lat, lon, what] of gulf) assert.equal(inArea(us, lat, lon, { sea: STORM_SEA_DEG }), true, what);
  for (const [lat, lon, what] of [[35, -40, 'mid-Atlantic'], ...FAR]) assert.equal(inArea(us, lat, lon, { sea: STORM_SEA_DEG }), false, what);
  // the reach is sea only: another country's land is never "in" this one
  for (const [lat, lon, what] of [[23.11, -82.37, 'Havana'], [25.69, -100.32, 'Monterrey'], [43.65, -79.38, 'Toronto']]) assert.equal(inArea(us, lat, lon, { sea: STORM_SEA_DEG }), false, what);
  const ru = await resolveArea({ place: 'Russia' }, feedsFor([photon(wideFeature('Russia', WIDE.Russia)), [SITE + 'data/borders.json', BORDERS]]).feeds);
  for (const [lat, lon, what] of [[43.06, 141.35, 'Sapporo'], [37.57, 126.98, 'Seoul'], [60.17, 24.94, 'Helsinki']]) assert.equal(inArea(ru, lat, lon, { sea: STORM_SEA_DEG }), false, what);
  assert.equal(inArea(ru, 44, 150, { sea: STORM_SEA_DEG }), true, 'a typhoon at sea off the Kurils');
  // the cheap box gate agrees with the full test on a grid round the world (it only skips work)
  const bd = preparedBorders(JSON.parse(BORDERS)), b = bd.find(x => x.iso === 'US');
  for (let lat = -60; lat <= 80; lat += 5) for (let lon = -180; lon < 180; lon += 5) {
    if (!nearParts(b, lat, lon, STORM_SEA_DEG)) assert.equal(inCountry(b, lon, lat) || offCoast(bd, b, lat, lon, 2.5, STORM_SEA_DEG), false, `${lat}, ${lon}`);
  }
  const nhc = ['https://www.nhc.noaa.gov/CurrentStorms.json', { activeStorms: [...gulf.map(([lat, lon], k) => storm(`al0${k + 1}2026`, `Gulf${k}`, lat, lon)), storm('al092026', 'Atlantic', 35, -40)] }];
  const sev = (id, lat, lon, cat = { id: 'severeStorms', title: 'Severe Storms' }) => ({ id, title: id, categories: [cat], sources: [], geometry: [{ type: 'Point', date: '2026-10-16T12:00:00Z', coordinates: [lon, lat] }] });
  const eonet = [/eonet\.gsfc\.nasa\.gov\/api\/v3\/events/, { events: [sev('Gulf storm', 25, -88), sev('Atlantic storm', 35, -40), sev('Gulf flood', 25, -88, { id: 'floods', title: 'Floods' })] }];
  const tools = createTools({ feeds: feedsFor([photon(wideFeature('United States', WIDE['United States'])), [SITE + 'data/borders.json', BORDERS], nhc, eonet]).feeds, now: () => NOW });
  const st = await run(tools.find(t => t.name === 'tropical_storms'), { place: 'United States' });
  assert.deepEqual(st.data.storms.map(s => s.name).sort(), ['Gulf0', 'Gulf1', 'Gulf2'], st.text);
  const ev = await run(tools.find(t => t.name === 'natural_events'), { place: 'United States' });
  assert.deepEqual(ev.data.events.map(e => e.title), ['Gulf storm'], 'a severe storm reaches out to sea; other events keep the plain coast');
});

// ---- sun_and_moon: the local day ------------------------------------------------------------------------------------
const sunFeeds = tz => feedsFor([[/api\.open-meteo\.com\/v1\/forecast/, { timezone: tz }]]).feeds;

test('mcp geo: the local day starts at its own 00:00, 23 h long on a spring-forward day', () => {
  const ny = localDay('2027-03-14', 'America/New_York'), ldn = localDay('2027-03-28', 'Europe/London'), akl = localDay('2026-12-25', 'Pacific/Auckland');
  assert.equal(new Date(ny.t0).toISOString(), '2027-03-14T05:00:00.000Z'); assert.equal(ny.ms, 23 * 3600e3);
  assert.equal(new Date(ldn.t0).toISOString(), '2027-03-28T00:00:00.000Z'); assert.equal(ldn.ms, 23 * 3600e3);
  assert.equal(new Date(akl.t0).toISOString(), '2026-12-24T11:00:00.000Z'); assert.equal(akl.ms, 24 * 3600e3);
  assert.equal(localDay('2026-11-01', 'America/New_York').ms, 25 * 3600e3, 'fall back: 25 h');
  // clocks that spring forward at midnight: the day starts at 01:00 (zonedToUtc alone gives 23:00 the evening before)
  const hm = (t, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(t);
  for (const [tz, date] of [['America/Santiago', '2026-09-06'], ['America/Havana', '2027-03-14']]) {
    const d = localDay(date, tz);
    assert.equal(hm(d.t0, tz), `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}, 01:00`, tz); assert.equal(d.ms, 23 * 3600e3, `${tz}: 23 h`);
  }
  assert.equal(localDay('2011-12-29', 'Pacific/Apia').ms, 24 * 3600e3, 'the day before Samoa skipped one is whole');
  assert.equal(localDay('2011-12-30', 'Pacific/Apia').ms, 0, 'the skipped day has no length');
});

test('mcp geo: sun_and_moon answers for the day asked at UTC+12 to +14 (Auckland, Kiritimati), and data.date agrees', async () => {
  for (const [tz, lat, lon] of [['Pacific/Auckland', -36.85, 174.76], ['Pacific/Kiritimati', 1.87, -157.4], ['Pacific/Fiji', -18.14, 178.44], ['Asia/Tokyo', 35.68, 139.69]]) {
    const r = await run(sunTool({ feeds: sunFeeds(tz), now: () => NOW }), { lat, lon, date: '2026-12-25' });
    assert.match(r.text, /^Fri 25 Dec at /, tz); assert.equal(r.data.date, '2026-12-25', tz);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(r.data.sunrise));
    assert.equal(local, '2026-12-25', `${tz}: the sunrise is on the 25th there`);
    const today = await run(sunTool({ feeds: sunFeeds(tz), now: () => NOW }), { lat, lon });
    const there = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(NOW));
    assert.equal(today.data.date, there, `${tz}: today is today there`);
  }
  const akl = await run(sunTool({ feeds: sunFeeds('Pacific/Auckland'), now: () => NOW }), { lat: -36.85, lon: 174.76 });
  assert.match(akl.text, /^Sat 17 Oct/); assert.equal(akl.data.date, '2026-10-17');
});

test('mcp geo: sun_and_moon on clock-change days starts at local midnight (New York, London)', async () => {
  for (const [tz, lat, lon, date] of [['America/New_York', 40.71, -74.01, '2027-03-14'], ['Europe/London', 51.5, -0.12, '2027-03-28']]) {
    const r = await run(sunTool({ feeds: sunFeeds(tz), now: () => NOW }), { lat, lon, date });
    assert.equal(r.data.date, date);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    for (const k of ['sunrise', 'sunset', 'solar_noon']) assert.equal(day.format(new Date(r.data[k])), date, `${tz} ${k}`);
    if (r.data.moon.rise) assert.equal(day.format(new Date(r.data.moon.rise)), date, `${tz}: a moonrise in the hour before midnight is not that day's`);
  }
});

// ---- distance: a path across the Pacific ----------------------------------------------------------------------------
test('mcp geo: distance through Tokyo, Honolulu and Los Angeles is framed over the Pacific', async () => {
  const { feeds } = feedsFor([]);
  const r = await run(distanceTool({ feeds, now: () => NOW }), { places: ['35.68, 139.69', '21.31, -157.86', '34.05, -118.24'] });
  const cam = viewOf(r.data.url);
  assert.ok(Math.abs(cam.lon - -163.5) < 3 && Math.abs(cam.lat - 37.6) < 3, `the mean direction, not the mean longitude: ${cam.lat}, ${cam.lon}`);
  assert.ok(cam.height < 2e7, `the whole route in view: ${cam.height}`);
});

// ---- traffic_cameras: pictures under one deadline -------------------------------------------------------------------
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const jam = (id, lat, lon) => ({ id, commonName: 'Cam ' + id, lat, lon, additionalProperties: [{ key: 'imageUrl', value: `https://cams.example/${id}.jpg` }, { key: 'available', value: 'true' }] });
const JAMS = Array.from({ length: 12 }, (_, i) => jam('c' + i, 51.5079 + i * 0.0004, -0.1283));

test('mcp geo: traffic_cameras tries a few pictures at once and answers inside its deadline when an image host hangs', async () => {
  const tried = [];
  const listOnly = { json: async u => { assert.equal(u, CAM_NETS.tfl.url); return JAMS; }, text: async () => { throw new Error('no'); }, site: p => SITE + p, siteBase: SITE };
  const hanging = { ...listOnly, bytes: u => { tried.push(u); return u.endsWith('c1.jpg') ? Promise.resolve({ bytes: JPEG, type: 'image/jpeg' }) : new Promise(() => {}); } };   // only c1 answers; every other never does
  const t0 = Date.now(), r = await run(camerasTool({ feeds: hanging, now: () => NOW, pictureDeadlineMs: 150 }), { lat: 51.5079, lon: -0.1283, radius_km: 2, pictures: 2, limit: 12 });
  const took = Date.now() - t0;
  assert.ok(took < 1500, `one deadline for the call, not 15 s a camera: ${took} ms`);
  assert.equal(tried.length, 4, 'pictures + 2 tried, no more');
  assert.deepEqual(r.data.cameras.map(c => c.picture_attached).slice(0, 4), [false, true, false, false], 'the picture that came is sent');
  assert.equal(r.images.length, 1); assert.equal(r.data.cameras.length, 12, 'the list still answers');
  // all of them answering: the nearest `pictures` ones, nearest first
  const fine = { ...listOnly, bytes: async () => ({ bytes: JPEG, type: 'image/jpeg' }) };
  const all = await run(camerasTool({ feeds: fine, now: () => NOW }), { lat: 51.5079, lon: -0.1283, radius_km: 2, pictures: 3, limit: 12 });
  assert.deepEqual(all.data.cameras.map(c => c.picture_attached).slice(0, 5), [true, true, true, false, false]);
  // a cancelled call stops
  const ac = new AbortController(), p = camerasTool({ feeds: hanging, now: () => NOW, pictureDeadlineMs: 5000 }).run({ lat: 51.5079, lon: -0.1283, radius_km: 2, pictures: 1 }, { signal: ac.signal });
  setTimeout(() => ac.abort(new Error('cancelled')), 20);
  await assert.rejects(p, /cancelled/);
});

// ---- satellites: an element set parsed once -------------------------------------------------------------------------
test('mcp geo: a satellite lookup parses each element set once, and finds catalogue numbers written with leading zeros', async () => {
  const tle = readFileSync(new URL('./fixtures/stations.tle', import.meta.url), 'utf8');
  const [, l1, l2] = tle.split(/\r?\n/);
  const vanguard = `VANGUARD 1\n${l1.replace(/^1 25544/, '1 00005')}\n${l2.replace(/^2 25544/, '2 00005')}\n`;
  const { feeds, asked } = feedsFor([[SITE + 'data/tle/active.txt', tle + vanguard]]);
  const before = parseGroup.parses;
  const [iss] = await findSats(feeds, 'ISS (ZARYA)');
  assert.equal(iss.id, '25544'); assert.equal(iss.group, 'active');
  const parsedFirst = parseGroup.parses - before;
  assert.ok(parsedFirst >= 1);
  const [again] = await findSats(feeds, 'CSS'), [v] = await findSats(feeds, '5'), [v5] = await findSats(feeds, '00005'), [byId] = await findSats(feeds, '25544');
  assert.equal(parseGroup.parses - before, parsedFirst, 'later lookups parse nothing');
  assert.equal(again.id, '48274'); assert.equal(v.name, 'VANGUARD 1'); assert.equal(v5, v); assert.equal(byId, iss, 'the same satellite object (so its satrec is reused)');
  assert.equal(await loadGroup(feeds, 'active'), await loadGroup(feeds, 'active'), 'loadGroup hands back the one parsed list');
  assert.equal(asked.filter(u => u.endsWith('active.txt')).length, 1, 'the text was fetched once too');
  // new text for the group: parsed again
  const other = feedsFor([[SITE + 'data/tle/active.txt', vanguard]]).feeds, n = parseGroup.parses;
  assert.equal((await findSats(other, '5'))[0].name, 'VANGUARD 1'); assert.equal(parseGroup.parses, n + 1);
});
