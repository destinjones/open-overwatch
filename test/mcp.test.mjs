// The MCP server (mcp/): the protocol, argument checks, places and links, the stdio transport, and every tool against
// canned answers from each source (no network). Orbits use satellite.js (npm install) with test/fixtures/stations.tle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createOverwatchServer, SITE } from '../mcp/index.mjs';
import { checkArgs, PROTOCOL_VERSIONS } from '../mcp/protocol.mjs';
import { createFeeds } from '../mcp/feeds.mjs';
import { frame, inArea, globeUrl, LAYERS, WEATHER } from '../mcp/place.mjs';
import { decodeView } from '../src/core/viewlink.js';
import { haversine } from '../src/core/geo.js';

const sgp4 = await import('satellite.js').catch(() => null);
const needsSgp4 = sgp4 ? {} : { skip: 'satellite.js is not installed (npm install)' };
const NOW = Date.parse('2026-10-01T18:00:00Z');   // a few hours after the fixture's element sets
const fx = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);

// ---- a pretend Internet --------------------------------------------------------------------------------------------
const PLACES = {
  helsinki: { properties: { osm_value: 'city', name: 'Helsinki', state: 'Uusimaa', country: 'Finland', countrycode: 'FI', extent: [24.78, 60.30, 25.25, 59.92] }, geometry: { coordinates: [24.9435, 60.1666] } },
  texas: { properties: { osm_value: 'state', name: 'Texas', country: 'United States', countrycode: 'US', extent: [-106.65, 36.50, -93.51, 25.84] }, geometry: { coordinates: [-98.55, 31.26] } },
  paris: { properties: { osm_value: 'city', name: 'Paris', country: 'France', countrycode: 'FR' }, geometry: { coordinates: [2.3514, 48.8575] } },
  fiji: { properties: { osm_value: 'country', name: 'Fiji', countrycode: 'FJ', extent: [176.9, -12.4, -178.2, -20.7] }, geometry: { coordinates: [178.0, -17.7] } },
};
const quake = (mag, lat, lon, place, mins, extra = {}) => ({ properties: { mag, place, time: NOW - mins * 60e3, url: 'https://earthquake.usgs.gov/x', type: 'earthquake', tsunami: 0, ...extra }, geometry: { coordinates: [lon, lat, 10] } });
const QUAKES = { features: [quake(5.1, 35.6, 139.7, '20 km SE of Tokyo, Japan', 30, { tsunami: 1, alert: 'green' }), quake(3.0, 31.6, -102.0, '15 km W of Midland, Texas', 90), quake(2.6, 61.2, -150.0, 'Southern Alaska', 200),
  { properties: { mag: 3.2, place: 'quarry', time: NOW, type: 'quarry blast' }, geometry: { coordinates: [-100, 31, 0] } }] };
const meteo = url => ({ timezone: 'Europe/Helsinki', timezone_abbreviation: 'EEST', utc_offset_seconds: 10800,
  current: { time: '2026-10-01T21:00', temperature_2m: 9.4, apparent_temperature: 7.1, relative_humidity_2m: 81, precipitation: 0, weather_code: 3, cloud_cover: 96, wind_speed_10m: 5.2, wind_direction_10m: 225, wind_gusts_10m: 11.3 },
  daily: { time: ['2026-10-01', '2026-10-02'], weather_code: [3, 61], temperature_2m_max: [12, 10], temperature_2m_min: [6, 7], precipitation_sum: [0, 3.4], precipitation_probability_max: [5, 80],
    wind_speed_10m_max: [6, 8], wind_gusts_10m_max: [12, 15], sunrise: ['2026-10-01T07:22', '2026-10-02T07:25'], sunset: ['2026-10-01T18:40', '2026-10-02T18:37'] },
  hourly: { time: Array.from({ length: 72 }, (_, i) => new Date(Date.parse('2026-10-01T00:00Z') + i * 3600e3).toISOString().slice(0, 16)), cloud_cover: Array.from({ length: 72 }, (_, i) => (i % 24 < 12 ? 10 : 90)) } });
const ROUTES = [
  [/photon\.komoot\.io\/api\/\?q=([^&]+)/, url => ({ features: [PLACES[decodeURIComponent(url.match(/q=([^&]+)/)[1]).toLowerCase()]].filter(Boolean) })],
  [/earthquake\.usgs\.gov\/.*\/2\.5_(day|week)\.geojson$/, QUAKES],
  [SITE + 'data/tle/stations.txt', fx('stations.tle')],
  [SITE + 'data/launches.json', { t: NOW, results: JSON.parse(fx('ll2_launch.json')).results }],
  [SITE + 'data/astronauts.json', { t: NOW, ...JSON.parse(fx('ll2_astronauts.json')) }],
  [SITE + 'data/flybys.json', { t: NOW, rows: [{ des: '2026 TO8', name: '(2026 TO8)', tca: NOW + 2 * 864e5, au: 0.0088, minAu: 0.0088, kms: 8.96, h: 27.7, km: null },
    { des: '99942', name: '99942 Apophis (2004 MN4)', tca: NOW + 20 * 864e5, au: 0.1, minAu: 0.1, kms: 7.4, h: 19.1, km: 0.34 }] }],
  ['https://www.nhc.noaa.gov/CurrentStorms.json', { activeStorms: [{ id: 'al092026', name: 'Isaias', classification: 'HU', intensity: '105', pressure: '958', latitudeNumeric: 25.5, longitudeNumeric: -80.2, movementDir: 315, movementSpeed: 10, lastUpdate: '2026-10-01T15:00:00.000Z', publicAdvisory: { url: 'https://www.nhc.noaa.gov/text/MIATCPAT4.shtml' } }] }],
  [/gdacs\.org\/gdacsapi\/api\/events\/geteventlist/, { features: [{ properties: { eventname: 'ISAIAS-26', iscurrent: 'true', alertlevel: 'Orange', country: 'United States', severitydata: { severity: 194.4, severitytext: 'x' }, url: { report: 'https://www.gdacs.org/report.aspx?eventid=1' } }, geometry: { coordinates: [-80.2, 25.5] } },
    { properties: { eventname: 'KOGUMA-26', iscurrent: 'true', alertlevel: 'Green', country: '', severitydata: { severity: 222.2 }, todate: '2026-10-01T12:00:00' }, geometry: { coordinates: [147.4, 26.2] } },
    { properties: { eventname: 'OLD-26', iscurrent: 'false' }, geometry: { coordinates: [0, 0] } }] }],
  [/eonet\.gsfc\.nasa\.gov\/api\/v3\/events/, { events: [
    { id: 'EONET_1', title: 'Wildfire near Austin, Texas', categories: [{ id: 'wildfires', title: 'Wildfires' }], sources: [{ url: 'https://inciweb.example/1' }], link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1', geometry: [{ date: '2026-09-30T00:00:00Z', type: 'Point', coordinates: [-97.7, 30.3], magnitudeValue: 1200, magnitudeUnit: 'acres' }] },
    { id: 'EONET_2', title: 'Etna eruption', categories: [{ id: 'volcanoes', title: 'Volcanoes' }], sources: [], geometry: [{ date: '2026-09-29T00:00:00Z', type: 'Point', coordinates: [15.0, 37.75] }] }] }],
  [/meri\.digitraffic\.fi\/api\/ais\/v1\/locations/, { features: [
    { mmsi: 230629000, geometry: { coordinates: [24.96, 60.16] }, properties: { mmsi: 230629000, sog: 17.2, cog: 200, heading: 199, navStat: 0, rot: 0, timestampExternal: NOW - 60e3 } },
    { mmsi: 230024660, geometry: { coordinates: [24.963, 60.176] }, properties: { mmsi: 230024660, sog: 0, cog: 336, heading: 49, navStat: 5, rot: 0, timestampExternal: NOW - 120e3 } },
    { mmsi: 276000001, geometry: { coordinates: [25.6, 60.4] }, properties: { mmsi: 276000001, sog: 9, cog: 90, navStat: 0, timestampExternal: NOW - 5 * 3600e3 } }] }],   // too old: dropped
  [/meri\.digitraffic\.fi\/api\/ais\/v1\/vessels\/230629000$/, { mmsi: 230629000, name: 'VIKING GRACE@@', callSign: 'OJPQ', imo: 9606900, shipType: 60, referencePointA: 22, referencePointB: 196, referencePointC: 16, referencePointD: 16, draught: 67, destination: 'SESTO', eta: 678962, timestamp: NOW }],
  [/meri\.digitraffic\.fi\/api\/ais\/v1\/vessels\/230024660$/, { mmsi: 230024660, name: 'SUOMENLINNA II', shipType: 69, referencePointA: 10, referencePointB: 20, timestamp: NOW }],
  [/api\.citybik\.es\/v2\/networks\?/, { networks: [{ id: 'velib', name: 'Vélib\' Métropole', company: ['Smovengo'], location: { city: 'Paris', country: 'FR', latitude: 48.8566, longitude: 2.3522 } },
    { id: 'citybikes-helsinki', name: 'City bikes', location: { city: 'Helsinki', country: 'FI', latitude: 60.17, longitude: 24.94 } }] }],
  [/api\.citybik\.es\/v2\/networks\/velib$/, { network: { stations: [
    { id: 'a', name: 'Hôtel de Ville', latitude: 48.8566, longitude: 2.3524, free_bikes: 7, empty_slots: 12, timestamp: '2026-10-01T17:59:00.000000+00:00Z', extra: { ebikes: 3, slots: 20 } },
    { id: 'b', name: 'Louvre', latitude: 48.8606, longitude: 2.3376, free_bikes: 0, empty_slots: 30, timestamp: '2026-10-01T17:58:00Z', extra: { slots: 30 } },
    { id: 'c', name: 'Bastille', latitude: 48.8532, longitude: 2.3692, free_bikes: 2, empty_slots: 0, extra: { renting: 1 } }] } }],
  [/api\.open-meteo\.com\/v1\/forecast/, meteo],
  ['https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', [{ time_tag: '2026-10-01T12:00:00', Kp: 4.33 }, { time_tag: '2026-10-01T15:00:00', Kp: 5.67 }]],
  ['https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', [{ time_tag: '2026-10-01T15:00:00', kp: 5.67, observed: 'observed', noaa_scale: 'G2' },
    { time_tag: '2026-10-01T21:00:00', kp: 6.0, observed: 'predicted', noaa_scale: 'G2' }, { time_tag: '2026-10-02T03:00:00', kp: 4.0, observed: 'predicted', noaa_scale: null }]],
  ['https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', { 'Forecast Time': '2026-10-01T18:30:00Z', coordinates: [[25, 60, 5], [25, 66, 40], [25, 61, 15]] }],
];

function pretendInternet(routes = ROUTES) {
  const asked = [];
  const fetchImpl = async url => {
    asked.push(url);
    for (const [match, body] of routes) {
      if (!(typeof match === 'string' ? url.startsWith(match) : match.test(url))) continue;
      const b = typeof body === 'function' ? body(url) : body;
      if (b instanceof Error) throw b;
      if (b && b.status) return new Response(b.body ?? '', { status: b.status });
      return new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('nothing here', { status: 404 });
  };
  return { fetchImpl, asked };
}
const serve = (net = pretendInternet()) => ({ net, server: createOverwatchServer({ fetchImpl: net.fetchImpl, sgp4: sgp4 || undefined, now: () => NOW }) });
const rpc = (server, method, params, id = 1) => server.handle({ jsonrpc: '2.0', id, method, params });
async function call(server, name, args = {}) {
  const r = await rpc(server, 'tools/call', { name, arguments: args });
  assert.ok(r.result, JSON.stringify(r));
  return r.result;
}
const ok = r => { assert.equal(r.isError, false, r.content[0].text); return r; };
const hashOf = url => decodeView(new URL(url).hash);

// ---- the protocol -------------------------------------------------------------------------------------------------
test('mcp: initialize agrees a protocol version and says what the server offers', async () => {
  const { server } = serve();
  const a = (await rpc(server, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).result;
  assert.equal(a.protocolVersion, '2025-06-18'); assert.equal(a.serverInfo.name, 'open-overwatch'); assert.ok(a.capabilities.tools && a.capabilities.resources); assert.match(a.instructions, /show_on_globe/);
  assert.equal((await rpc(server, 'initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, PROTOCOL_VERSIONS[0]);
  assert.deepEqual((await rpc(server, 'ping')).result, {});
  assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'notifications get no answer');
  assert.equal((await rpc(server, 'nope')).error.code, -32601);
  assert.equal((await server.handle({ id: 3, method: 'ping' })).error.code, -32600);
  assert.equal((await rpc(server, 'tools/call', { name: 'nope' })).error.code, -32602);
});

test('mcp: every tool is listed read-only with a schema; show_on_globe names the globe panel', async () => {
  const { server } = serve(), { tools } = (await rpc(server, 'tools/list')).result;
  assert.equal(tools.length, 14);
  for (const t of tools) {
    assert.match(t.name, /^[a-z_]+$/); assert.ok(t.description.length > 60, t.name); assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.openWorldHint, true);
  }
  const show = tools.find(t => t.name === 'show_on_globe');
  assert.equal(show._meta.ui.resourceUri, 'ui://open-overwatch/globe'); assert.equal(show._meta['ui/resourceUri'], 'ui://open-overwatch/globe');
  assert.equal(tools.filter(t => t._meta).length, 1, 'only show_on_globe opens the panel');
});

test('mcp: the globe panel is an MCP App that may frame the site and nothing else', async () => {
  const { server } = serve(), list = (await rpc(server, 'resources/list')).result.resources;
  assert.deepEqual(list.map(r => [r.uri, r.mimeType, 'text' in r]), [['ui://open-overwatch/globe', 'text/html;profile=mcp-app', false]]);
  const [c] = (await rpc(server, 'resources/read', { uri: 'ui://open-overwatch/globe' })).result.contents;
  assert.deepEqual(c._meta.ui.csp, { frameDomains: ['https://destinjones.github.io'] });
  assert.match(c.text, /^<!doctype html>/); assert.match(c.text, /ui\/initialize/); assert.match(c.text, /ui\/notifications\/initialized/); assert.match(c.text, /oo:ready/);
  assert.match(c.text, /embed=1&/, 'the site in embed mode');
  assert.equal((await rpc(server, 'resources/read', { uri: 'ui://other' })).error.code, -32002);
  const local = createOverwatchServer({ site: 'http://localhost:8787/' });
  const [l] = (await rpc(local, 'resources/read', { uri: 'ui://open-overwatch/globe' })).result.contents;
  assert.deepEqual(l._meta.ui.csp.frameDomains, ['http://localhost:8787']);
});

test('mcp: arguments are checked against the schema, with gentle coercion', () => {
  const s = { type: 'object', additionalProperties: false, properties: { n: { type: 'integer', minimum: 1, maximum: 10 }, b: { type: 'boolean' }, e: { type: 'string', enum: ['a', 'b'] }, l: { type: 'array', items: { type: 'string', enum: ['x', 'y'] } } } };
  assert.deepEqual(checkArgs(s, { n: '3', b: 'true', e: 'a', l: 'x, y' }), { n: 3, b: true, e: 'a', l: ['x', 'y'] });
  assert.deepEqual(checkArgs(s, undefined), {});
  for (const bad of [{ n: 0 }, { n: 'many' }, { e: 'c' }, { l: ['z'] }, { other: 1 }, [1]]) assert.throws(() => checkArgs(s, bad), e => e.code === 'invalid_arguments', JSON.stringify(bad));
});

test('mcp: a tool error reaches the model as a readable error, not a crash', async () => {
  const { server } = serve(), r = await call(server, 'earthquakes', { min_magnitude: 12 });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /min_magnitude.*at most 10/);
  const w = await call(server, 'weather', {});
  assert.equal(w.isError, true); assert.match(w.content[0].text, /Say where/);
  const p = await call(server, 'weather', { place: 'Atlantis' });
  assert.equal(p.isError, true); assert.match(p.content[0].text, /No place called "Atlantis"/); assert.equal(p.structuredContent.error, 'not_found');
});

// ---- the network layer, places and links ----------------------------------------------------------------------------
test('mcp: CelesTrak is never asked; answers are cached, and an old answer beats none when a source fails', async () => {
  let n = 0, fail = false, t = 0;
  const feeds = createFeeds({ fetchImpl: async () => { n++; if (fail) throw new Error('down'); return new Response('{"v":1}'); }, now: () => t });
  await assert.rejects(feeds.text('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations'), /CelesTrak/);
  await assert.rejects(feeds.text('http://example.com/x'), /https/);
  assert.equal(n, 0);
  assert.deepEqual(await feeds.json('https://a.example/x', { ttl: 1000 }), { v: 1 });
  await feeds.json('https://a.example/x', { ttl: 1000 }); assert.equal(n, 1, 'cached');
  t = 5000; fail = true;
  assert.deepEqual(await feeds.json('https://a.example/x', { ttl: 1000 }), { v: 1 }, 'stale but there'); assert.equal(n, 2);
  t = 2 * 864e5;
  await assert.rejects(feeds.json('https://a.example/x', { ttl: 1000 }), /did not answer/);
});

test('mcp: framing, areas (an outline across the antimeridian too) and links in the globe\'s own format', () => {
  const f = frame(60.17, 24.94, 20);
  assert.equal(f.pitch, -90); assert.equal(f.height, 48000);
  const t = frame(60.17, 24.94, 20, { tilt: 50 });
  assert.equal(t.pitch, -40); assert.ok(t.lat < 60.17, 'stands back to the south');
  const back = haversine(t.lat, t.lon, 60.17, 24.94); assert.ok(Math.abs(back - t.height / Math.tan(40 * Math.PI / 180)) < 50, `${back}`);
  assert.equal(frame(0, 0, 1e5).height, 2.0e7);
  const fiji = { lat: -17.7, lon: 178, bbox: [176.9, -20.7, -178.2, -12.4] };
  assert.ok(inArea(fiji, -18, 179.5) && inArea(fiji, -18, -179) && !inArea(fiji, -18, 170));
  assert.ok(inArea({ lat: 0, lon: 0, radiusKm: 120 }, 0, 1) && !inArea({ lat: 0, lon: 0, radiusKm: 100 }, 0, 1));
  const url = globeUrl(SITE, { camera: f, on: ['ships', 'nope'], off: ['starlink', 'ships'], weather: ['wind', 'x'], time: { ms: NOW, rate: 20 }, sat: '25544', sensor: 'nvg' });
  assert.ok(url.startsWith(SITE + 'globe.html#c='));
  const v = hashOf(url);
  assert.deepEqual([v.add, v.drop, v.weather, v.sat, v.ops.sensor, v.time.rate], [['ships'], ['starlink'], ['wind'], '25544', 'nvg', 20]);
  assert.ok(Math.abs(v.time.jd - (NOW / 864e5 + 2440587.5)) < 1e-4);
});

test('mcp: the layers and weather it can name are the globe\'s own', () => {
  const layers = readFileSync(new URL('src/globe/layers.js', root), 'utf8'), block = layers.slice(layers.indexOf('export const LAYERS'), layers.indexOf('];', layers.indexOf('export const LAYERS')));
  assert.deepEqual([...block.matchAll(/\{ id: '([a-z0-9_-]+)'/g)].map(m => m[1]), [...LAYERS]);
  const wx = readFileSync(new URL('src/globe/weather.js', root), 'utf8').match(/sets: \{(.*)\},\n/)[1];
  assert.deepEqual([...wx.matchAll(/(\w+): \{ name:/g)].map(m => m[1]), [...WEATHER]);
});

// ---- the tools ------------------------------------------------------------------------------------------------------
test('mcp: earthquakes, strongest first, in an area or worldwide, with a link that turns the layer on', async () => {
  const { server } = serve();
  const all = ok(await call(server, 'earthquakes', {}));
  assert.deepEqual(all.structuredContent.earthquakes.map(q => q.magnitude), [5.1, 3.0, 2.6], 'no quarry blasts');
  assert.match(all.content[0].text, /^3 earthquakes of magnitude 2\.5\+ in the last day worldwide\./); assert.match(all.content[0].text, /M5\.1 · 20 km SE of Tokyo, Japan .* tsunami flag · PAGER green/);
  const v = hashOf(all.structuredContent.url); assert.deepEqual(v.add, ['quakes']); assert.ok(Math.abs(v.lat - 35.6) < 0.01, 'framed on the strongest');
  const tx = ok(await call(server, 'earthquakes', { place: 'Texas', sort: 'time' }));
  assert.deepEqual(tx.structuredContent.earthquakes.map(q => q.place), ['15 km W of Midland, Texas']); assert.equal(tx.structuredContent.area.name, 'Texas, United States');
  const near = ok(await call(server, 'earthquakes', { lat: 61, lon: -150, radius_km: 100, period: 'week' }));
  assert.equal(near.structuredContent.total, 1); assert.match(near.content[0].text, /last 24 hours/);
  assert.equal((await call(server, 'earthquakes', { period: 'month', min_magnitude: 1 })).isError, true);
});

test('mcp: where is the ISS (SGP4 on the website copy of the elements), and a link that follows it', needsSgp4, async () => {
  const { server, net } = serve(), r = ok(await call(server, 'where_is_satellite', {})), d = r.structuredContent;
  assert.equal(d.satellite.norad, '25544'); assert.ok(d.altitude_km > 380 && d.altitude_km < 440, `${d.altitude_km}`); assert.ok(Math.abs(d.speed_km_s - 7.66) < 0.05);
  assert.ok(Math.abs(d.lat) <= 51.7, 'inclination bounds the latitude'); assert.equal(d.inclination_deg, 51.6);
  const v = hashOf(d.url); assert.equal(v.sat, '25544'); assert.deepEqual(v.add, ['stations']);
  assert.ok(net.asked.every(u => !/celestrak/i.test(u)) && net.asked.some(u => u === SITE + 'data/tle/stations.txt'));
  const css = ok(await call(server, 'where_is_satellite', { satellite: 'tiangong' }));
  assert.equal(css.structuredContent.satellite.name, 'CSS (TIANHE)');
  const jw = await call(server, 'where_is_satellite', { satellite: 'JWST' });
  assert.equal(jw.isError, true); assert.match(jw.content[0].text, /L2/);
});

test('mcp: ISS passes over Helsinki, in local time, and a link that replays the first visible one', needsSgp4, async () => {
  const { server } = serve(), r = ok(await call(server, 'satellite_passes', { place: 'Helsinki', days: 3 })), d = r.structuredContent;
  assert.ok(d.passes.length >= 4, `${d.passes.length}`); assert.equal(d.timezone, 'Europe/Helsinki');
  for (const p of d.passes) { assert.ok(p.max_elevation_deg >= 10); assert.ok(Date.parse(p.set) > Date.parse(p.rise)); assert.match(p.rise_local, /EEST|GMT\+3/); }
  const v = hashOf(d.url), first = d.passes.find(p => p.visible) || d.passes[0];
  assert.equal(v.time.rate, 20); assert.ok(Math.abs((v.time.jd - 2440587.5) * 864e5 - (Date.parse(first.rise) - 60e3)) < 2000);
  const vis = ok(await call(server, 'satellite_passes', { place: 'Helsinki', visible_only: true }));
  assert.ok(vis.structuredContent.passes.every(p => p.visible));
});

test('mcp: launches, crew and asteroid flybys come from the website copies', async () => {
  const { server, net } = serve();
  const l = ok(await call(server, 'launches', { days: 30 })).structuredContent;
  assert.equal(l.launches.length, 1); assert.match(l.launches[0].name, /Falcon 9/); assert.equal(l.launches[0].url, `${SITE}globe.html#go=launches&id=${l.launches[0].id}`);
  assert.equal(ok(await call(server, 'launches', { search: 'Ariane' })).structuredContent.total, 0);
  const c = ok(await call(server, 'people_in_space', {}));
  assert.match(c.content[0].text, /people are in space right now/); assert.equal(c.structuredContent.url, `${SITE}globe.html#go=crew`); assert.equal(hashOf(c.structuredContent.iss_url).sat, '25544');
  const f = ok(await call(server, 'asteroid_flybys', {})).structuredContent;
  assert.deepEqual(f.flybys.map(x => x.name), ['2026 TO8']); assert.ok(Math.abs(f.flybys[0].lunar_distances - 3.42) < 0.01); assert.ok(f.flybys[0].size_m[0] < f.flybys[0].size_m[1]);
  assert.equal(ok(await call(server, 'asteroid_flybys', { max_lunar_distances: 50 })).structuredContent.total, 2);
  assert.ok(net.asked.every(u => !u.includes('thespacedevs.com')), 'never Launch Library itself (15 requests an hour)');
});

test('mcp: tropical cyclones from NOAA and GDACS, merged by name', async () => {
  const { server } = serve(), r = ok(await call(server, 'tropical_storms', {})), s = r.structuredContent.storms;
  assert.deepEqual(s.map(x => x.name), ['Isaias', 'Koguma']);
  assert.equal(s[0].strength, 'Category 3'); assert.equal(s[0].movement, 'toward NW at 10 mph'); assert.equal(s[0].gdacs.alert, 'Orange');
  assert.match(r.content[0].text, /Hurricane Isaias · 25\.50°N 80\.20°W · 105 kt \(Category 3\)/);
  assert.deepEqual(hashOf(r.structuredContent.url).add, ['storms']);
  assert.deepEqual(ok(await call(server, 'tropical_storms', { lat: 25, lon: 145, radius_km: 800 })).structuredContent.storms.map(x => x.name), ['Koguma']);
});

test('mcp: natural events by kind and place', async () => {
  const { server } = serve(), r = ok(await call(server, 'natural_events', { category: 'wildfires', place: 'Texas' })).structuredContent;
  assert.deepEqual(r.events.map(e => e.title), ['Wildfire near Austin, Texas']); assert.deepEqual(hashOf(r.url).add, ['fires']);
  assert.equal(ok(await call(server, 'natural_events', {})).structuredContent.total, 2);
});

test('mcp: ships near Helsinki (Baltic only), nearest first with names, types and destinations', async () => {
  const { server } = serve(), r = ok(await call(server, 'ships_baltic', { place: 'Helsinki', radius_km: 20 })), s = r.structuredContent.ships;
  assert.deepEqual(s.map(x => x.name), ['VIKING GRACE', 'SUOMENLINNA II'], 'a 5-hour-old report is dropped');
  assert.equal(s[0].type, 'Passenger ship'); assert.equal(s[0].length_m, 218); assert.equal(s[0].destination, 'SESTO'); assert.equal(s[1].status, 'moored');
  assert.deepEqual(hashOf(r.structuredContent.url).add, ['ships']);
  assert.deepEqual(ok(await call(server, 'ships_baltic', { place: 'Helsinki', kind: 'passenger', name: 'suomen' })).structuredContent.ships.map(x => x.mmsi), [230024660]);
  const far = await call(server, 'ships_baltic', { place: 'Paris' });
  assert.equal(far.isError, true); assert.match(far.content[0].text, /northern Baltic only/);
});

test('mcp: bike share nearest a place, with the system totals', async () => {
  const { server } = serve(), r = ok(await call(server, 'bike_share', { place: 'Paris', limit: 2 })), d = r.structuredContent;
  assert.equal(d.system.name, 'Vélib\' Métropole'); assert.equal(d.system.bikes, 9); assert.equal(d.system.ebikes, 3);
  assert.deepEqual(d.stations.map(s => [s.name, s.state]), [['Hôtel de Ville', 'ok'], ['Louvre', 'empty']]);
  assert.deepEqual(hashOf(d.url).add, ['bikes']);
  assert.equal((await call(server, 'bike_share', { lat: 0, lon: -30 })).isError, true);
});

test('mcp: weather now and ahead, metric or imperial, and a link to weather mode over the place', async () => {
  const { server } = serve(), m = ok(await call(server, 'weather', { place: 'Helsinki', days: 2 }));
  assert.match(m.content[0].text, /^Now at Helsinki, Uusimaa, Finland \(2026-10-01 21:00 EEST\): 9 degrees Celsius, overcast, wind 19 kilometres an hour from the south-west/);
  assert.match(m.content[0].text, /Fri, 02 Oct: light rain, 7 °C to 10 °C, 3\.4 mm rain \(80% chance\)/);
  const v = hashOf(m.structuredContent.url); assert.deepEqual(v.weather, ['ir', 'radar', 'wind']); assert.ok(v.height >= 3.0e6, 'weather mode keeps a whole-Earth height');
  assert.match(ok(await call(server, 'weather', { place: 'Helsinki', units: 'imperial' })).content[0].text, /49 degrees Fahrenheit.*43 °F to 54 °F.*0\.13 in rain/s);
});

test('mcp: the aurora: Kp now and ahead, the chance at a place, the oval on the globe', async () => {
  const { server } = serve(), r = ok(await call(server, 'aurora', { place: 'Helsinki' })), d = r.structuredContent;
  assert.equal(d.kp_now, 5.67); assert.match(d.activity, /G1/); assert.deepEqual(d.forecast.map(x => x.max_kp), [6, 4]);
  assert.equal(d.local.overhead_percent, 5); assert.equal(d.local.horizon_percent, 40); assert.match(d.local.verdict, /likely on the northern horizon/);
  assert.deepEqual(hashOf(d.url).add, ['aurora']); assert.equal(ok(await call(server, 'aurora', {})).structuredContent.local, null);
});

test('mcp: tonight\'s sky: darkness, clouds, planets, the Moon, showers and bright passes', needsSgp4, async () => {
  const { server } = serve(), r = ok(await call(server, 'night_sky', { place: 'Helsinki' })), d = r.structuredContent, text = r.content[0].text;
  assert.match(text, /^Tonight from Helsinki, Uusimaa, Finland \(times Europe\/Helsinki\):/);
  assert.ok(d.dark && Date.parse(d.dark.from) >= NOW - 3600e3); assert.equal(typeof d.cloud_percent, 'number'); assert.equal(d.planets.length, 5);
  assert.match(text, /Moon: .*% lit/); assert.ok(Array.isArray(d.passes));
  const v = hashOf(d.url); assert.equal(v.time.rate, 60); assert.deepEqual(v.add, ['stations', 'visual']);
});

test('mcp: show_on_globe builds a view, or shows another answer\'s link, and only the site\'s', async () => {
  const { server } = serve();
  const a = ok(await call(server, 'show_on_globe', { place: 'Helsinki', tilt: 60, layers_on: ['ships', 'terrain'], layers_off: ['starlink'], time: '2026-10-01T20:00:00Z', time_speed: 30, country: 'fi' }));
  const v = hashOf(a.structuredContent.url);
  assert.deepEqual([v.add, v.drop, v.country, v.time.rate, v.pitch], [['ships', 'terrain'], ['starlink'], 'FI', 30, -30]);
  const same = ok(await call(server, 'show_on_globe', { url: a.structuredContent.url }));
  assert.equal(same.structuredContent.url, a.structuredContent.url);
  for (const url of ['https://example.com/globe.html#c=1,2,3', 'https://destinjones.github.io/other/globe.html#c=1,2,3', 'javascript:alert(1)']) {
    const r = await call(server, 'show_on_globe', { url }); assert.equal(r.isError, true, url);
  }
  assert.match(ok(await call(server, 'show_on_globe', {})).content[0].text, /the whole Earth/);
  assert.equal((await call(server, 'show_on_globe', { time: 'yesterday-ish' })).isError, true);
});

test('mcp: show_on_globe follows a satellite by name', needsSgp4, async () => {
  const { server } = serve(), r = ok(await call(server, 'show_on_globe', { satellite: 'ISS' })), v = hashOf(r.structuredContent.url);
  assert.equal(v.sat, '25544'); assert.deepEqual(v.add, ['stations']); assert.match(r.content[0].text, /^Following ISS \(ZARYA\) \(NORAD 25544\) on the globe: https/);
});

// ---- over stdio, as a client starts it -------------------------------------------------------------------------------
test('mcp: the stdio server answers a client and exits when stdin closes', async () => {
  const p = spawn(process.execPath, [new URL('mcp/server.mjs', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', b => { out += b; }); p.stderr.on('data', b => { err += b; });
  const send = m => p.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } }, clientInfo: { name: 'test', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  p.stdin.write('this is not json\n');
  p.stdin.end();
  const code = await new Promise(res => p.on('close', res));
  assert.equal(code, 0, err);
  const lines = out.trim().split('\n').map(l => JSON.parse(l)), byId = id => lines.find(l => l.id === id);   // answers may come in any order
  assert.equal(lines.length, 3, out);
  assert.equal(byId(1).result.serverInfo.name, 'open-overwatch'); assert.equal(byId(2).result.tools.length, 14); assert.equal(byId(null).error.code, -32700);
  assert.match(err, /open-overwatch-mcp \d+\.\d+\.\d+ · links to https:\/\/destinjones\.github\.io\/open-overwatch\//);
});

test('mcp: the npm package, the Claude Desktop bundle and the server agree on the version and the tools', async () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')), man = JSON.parse(readFileSync(new URL('mcp/manifest.json', root), 'utf8'));
  const { VERSION } = await import('../mcp/feeds.mjs'), { tools } = (await rpc(serve().server, 'tools/list')).result;
  assert.equal(pkg.version, VERSION); assert.equal(man.version, VERSION);
  assert.deepEqual(man.tools.map(t => t.name), tools.map(t => t.name));
  assert.equal(pkg.bin['open-overwatch-mcp'], 'mcp/server.mjs'); assert.equal(man.server.entry_point, 'mcp/server.mjs');
  assert.deepEqual(Object.keys(pkg.dependencies), ['satellite.js']);
});
