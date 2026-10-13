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
import { gzipSync } from 'node:zlib';
import { CAM_NETS } from '../src/core/cams.js';
import { HSL_PB, ENTUR_VEHICLES } from '../src/core/transit.js';
import { encodeVehiclePositions } from '../src/core/gtfsrt.js';
import { CABLE_GEO, LANDING_GEO, cableUrl, landingUrl } from '../src/core/cables.js';
import { createHttpHandler, originAllowed, MAX_BODY } from '../mcp/http.mjs';
import { serveHttp } from '../mcp/http-node.mjs';

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
  const fetchImpl = async (url, init = {}) => {
    asked.push(url);
    for (const [match, body] of routes) {
      if (!(typeof match === 'string' ? url.startsWith(match) : match.test(url))) continue;
      const b = typeof body === 'function' ? body(url, init) : body;
      if (b instanceof Error) throw b;
      if (b instanceof Uint8Array) return new Response(b, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
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
  assert.equal(tools.length, 20);
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
  assert.equal(byId(1).result.serverInfo.name, 'open-overwatch'); assert.equal(byId(2).result.tools.length, 20); assert.equal(byId(null).error.code, -32700);
  assert.match(err, /open-overwatch-mcp \d+\.\d+\.\d+ - links to https:\/\/destinjones\.github\.io\/open-overwatch\//);
});

test('mcp: the npm package, the Claude Desktop bundle and the server agree on the version and the tools', async () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')), man = JSON.parse(readFileSync(new URL('mcp/manifest.json', root), 'utf8'));
  const { VERSION } = await import('../mcp/feeds.mjs'), { tools } = (await rpc(serve().server, 'tools/list')).result;
  assert.equal(pkg.version, VERSION); assert.equal(man.version, VERSION);
  assert.deepEqual(man.tools.map(t => t.name), tools.map(t => t.name));
  assert.equal(pkg.bin['open-overwatch-mcp'], 'mcp/server.mjs'); assert.equal(man.server.entry_point, 'mcp/server.mjs');
  assert.deepEqual(Object.keys(pkg.dependencies), ['satellite.js']);
});

// ---- the 0.2 tools: traffic cameras, live transit, wildfires, country briefings, submarine cables, the planets -----
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
/** A Mapbox vector tile with point features carrying `props` (what GIBS's fire tiles look like inside). */
function mvt(name, feats) {
  const enc = new TextEncoder(), varint = (o, n) => { do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; o.push(b); } while (n); };
  const key = (o, f, w) => varint(o, f * 8 + w), bytes = (o, f, a) => { key(o, f, 2); varint(o, a.length); o.push(...a); }, str = (o, f, s) => bytes(o, f, [...enc.encode(s)]);
  const packed = a => { const t = []; for (const x of a) varint(t, x); return t; };
  const keys = [], vals = [], layer = [];
  key(layer, 15, 0); varint(layer, 2); str(layer, 1, name);
  for (const p of feats) {
    const tags = [], f = [];
    for (const [k, v] of Object.entries(p)) { let ki = keys.indexOf(k); if (ki < 0) ki = keys.push(k) - 1; tags.push(ki, vals.push(v) - 1); }
    bytes(f, 2, packed(tags)); key(f, 3, 0); varint(f, 1); bytes(f, 4, packed([9, 0, 0]));
    bytes(layer, 2, f);
  }
  for (const k of keys) str(layer, 3, k);
  for (const v of vals) { const o = []; if (typeof v === 'string') str(o, 1, v); else { key(o, 3, 1); const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v, true); o.push(...new Uint8Array(d.buffer)); } bytes(layer, 4, o); }
  key(layer, 5, 0); varint(layer, 4096);
  const out = []; bytes(out, 3, layer); return Uint8Array.from(out);
}
const fire = (uid, lat, lon, frp, date, time, dn = 'N') => ({ LATITUDE: lat, LONGITUDE: lon, FRP: frp, BRIGHT_TI4: 340, ACQ_DATE: date, ACQ_TIME: time, SATELLITE: 'N20', CONFIDENCE: 'nominal', DAYNIGHT: dn, UID: uid });
const FIRE_TILE = gzipSync(mvt('VIIRS_NOAA20_Thermal_Anomalies_375m_All', [fire(1, -15.0, 132.0, 100, '2026-10-01', '0430'), fire(2, -15.003, 132.01, 50, '2026-10-01', '0430'), fire(3, -15.01, 132.0, 30, '2026-10-01', '0431'),
  fire(4, -15.3, 132.4, 2, '2026-10-01', '1600', 'D'), fire(5, -25, 140, 80, '2026-10-01', '0430')]));
const OLD_TILE = mvt('VIIRS_NOAA20_Thermal_Anomalies_375m_All', [fire(9, -15.0, 132.0, 500, '2026-09-30', '0100'), fire(1, -15.0, 132.0, 100, '2026-10-01', '0430')]);   // not gzipped; one too old, one the same as today's
const hsl = (vehicleId, lat, lon, routeId, extra = {}) => ({ vehicleId, lat, lon, routeId, t: NOW - 3000, status: 2, spd: 8, hdg: 90, ...extra });
const MORE_PLACES = {
  marseille: { properties: { osm_value: 'city', name: 'Marseille', country: 'France', countrycode: 'FR' }, geometry: { coordinates: [5.3698, 43.2965] } },
  kyoto: { properties: { osm_value: 'city', name: 'Kyoto', country: 'Japan', countrycode: 'JP' }, geometry: { coordinates: [135.768, 35.0116] } },
  'tokyo, japan': { properties: { osm_value: 'city', name: 'Tokyo', country: 'Japan', countrycode: 'JP' }, geometry: { coordinates: [139.6917, 35.6895] } },
};
Object.assign(PLACES, MORE_PLACES);
ROUTES.unshift(
  [CAM_NETS.tfl.url, [{ id: 'JamCams_A', commonName: 'Trafalgar Square', lat: 51.5080, lon: -0.1281, additionalProperties: [{ key: 'imageUrl', value: 'https://cams.example/a.jpg' }, { key: 'view', value: 'Trafalgar Sq' }, { key: 'available', value: 'true' }] },
    { id: 'JamCams_B', commonName: 'Strand / Charing Cross (North - twds Trafalgar)', lat: 51.5086, lon: -0.1240, additionalProperties: [{ key: 'imageUrl', value: 'https://cams.example/b.jpg' }] },
    { id: 'JamCams_C', commonName: 'Whitehall', lat: 51.5045, lon: -0.1265, additionalProperties: [{ key: 'imageUrl', value: 'https://cams.example/c.jpg' }] },
    { id: 'JamCams_D', commonName: 'Far away', lat: 51.6, lon: -0.3, additionalProperties: [{ key: 'imageUrl', value: 'https://cams.example/d.jpg' }] }]],
  ['https://cams.example/a.jpg', JPEG], ['https://cams.example/b.jpg', '<html>camera offline</html>'], ['https://cams.example/c.jpg', JPEG],
  [HSL_PB, () => encodeVehiclePositions({ t: NOW, vehicles: [hsl('18/1', 60.1702, 24.9410, '1009'), hsl('18/2', 60.1712, 24.9440, '1055', { status: 1, spd: 0 }), hsl('50/3', 60.1690, 24.9380, '31M1'),
    hsl('18/4', 60.1700, 24.9420, '1006T', { t: NOW - 20 * 60e3 }), hsl('18/5', 60.30, 25.10, '1055')] })],
  [/api-v3\.mbta\.com\/vehicles/, { data: [{ id: 'R-1', attributes: { latitude: 42.3564, longitude: -71.0624, bearing: 10, speed: null, current_status: 'STOPPED_AT', label: '1800', updated_at: new Date(NOW - 30e3).toISOString() },
    relationships: { route: { data: { id: 'Red' } }, trip: { data: { id: 't1' } } } }], included: [{ type: 'route', id: 'Red', attributes: { type: 1, short_name: '', long_name: 'Red Line', color: 'DA291C' } }, { type: 'trip', id: 't1', attributes: { headsign: 'Alewife' } }] }],
  [ENTUR_VEHICLES, (url, init) => (/boundingBox:\{minLat:59\.8/.test(JSON.parse(init.body).query) ? { data: { vehicles: [
    { vehicleId: 'v1', mode: 'TRAM', lastUpdatedEpochSecond: (NOW - 10e3) / 1000, speed: 18, bearing: 180, location: { latitude: 59.912, longitude: 10.75 }, line: { publicCode: '12', lineName: 'Majorstuen - Kjelsås' }, destinationName: 'Kjelsås', delay: 150, codespace: { codespaceId: 'RUT' }, operator: { name: 'Sporveien' } }] } } : { errors: ['wrong box'] })],
  [/gibs\.earthdata\.nasa\.gov\/wmts\/epsg4326\/best\/VIIRS_NOAA20_[^/]+\/default\/2026-10-01\//, FIRE_TILE],
  [/gibs\.earthdata\.nasa\.gov\/wmts\/epsg4326\/best\/VIIRS_NOAA20_[^/]+\/default\/2026-09-30\//, OLD_TILE],
  [/gibs\.earthdata\.nasa\.gov/, { status: 404 }],
  [/photon\.komoot\.io\/reverse/, { features: [{ properties: { name: 'Mainoru', county: 'Roper Gulf', state: 'Northern Territory', country: 'Australia', osm_key: 'place' }, geometry: { coordinates: [131.9, -15.2] } }] }],
  [/services3\.arcgis\.com\/T4QMspbfLg3qTGWY\/.*WFIGS_Interagency_Perimeters_Current/, { features: [{ attributes: { poly_IncidentName: 'Timber', attr_IncidentSize: 25350, attr_PercentContained: 97, attr_POOState: 'US-CA',
    attr_FireDiscoveryDateTime: 1786246500000, attr_UniqueFireIdentifier: '2026-CALPF-002271', attr_IncidentTypeCategory: 'WF', attr_FireCause: 'Undetermined' }, centroid: { x: -121.39, y: 35.92 } },
    { attributes: { poly_IncidentName: 'Done', attr_IncidentSize: 10, attr_PercentContained: 100 }, centroid: { x: -121.5, y: 36 } }] }],
  [SITE + 'data/countries.json', readFileSync(new URL('data/countries.json', root), 'utf8')],
  [SITE + 'data/borders.json', readFileSync(new URL('data/borders.json', root), 'utf8')],
  [CABLE_GEO, { features: [{ properties: { id: 'blue', name: 'Blue', color: '#3a7bd5' }, geometry: { type: 'MultiLineString', coordinates: [[[5.37, 43.29], [5.5, 42.5], [9.0, 41.0]]] } },
    { properties: { id: 'medloop', name: 'Medloop' }, geometry: { type: 'LineString', coordinates: [[5.45, 42.9], [8, 42]] } }, { properties: { id: 'far', name: 'Far' }, geometry: { type: 'LineString', coordinates: [[-10, 50], [-20, 50]] } }] }],
  [LANDING_GEO, { features: [{ properties: { id: 'marseille-france', name: 'Marseille, France' }, geometry: { type: 'Point', coordinates: [5.3698, 43.2965] } }, { properties: { id: 'far', name: 'Far' }, geometry: { type: 'Point', coordinates: [0, 0] } }] }],
  [cableUrl('blue'), { id: 'blue', name: 'Blue', length: '5,055 km', owners: 'Google, Sparkle', rfs: '2023', rfs_year: 2023, is_planned: false, landing_points: [{ id: 'marseille-france', name: 'Marseille, France' }, { id: 'genoa', name: 'Genoa, Italy' }] }],
  [landingUrl('marseille-france'), { id: 'marseille-france', name: 'Marseille, France', country: 'France', cables: [{ id: 'blue', name: 'Blue', rfs_year: 2023 }, { id: '2africa', name: '2Africa', rfs_year: 2024, is_planned: false }] }],
);

test('mcp: traffic cameras near a place, nearest first, with the latest pictures as images (and only real pictures)', async () => {
  const { server } = serve(), r = ok(await call(server, 'traffic_cameras', { lat: 51.5079, lon: -0.1283, radius_km: 1, pictures: 2 }));
  const d = r.structuredContent;
  assert.deepEqual(d.cameras.map(c => c.name), ['Trafalgar Square', 'Strand / Charing Cross (North - twds Trafalgar)', 'Whitehall'], 'nearest first, the far one left out');
  assert.deepEqual(d.cameras.map(c => c.picture_attached), [true, false, true], 'an HTML page is not a picture: the next camera\'s is sent');
  assert.deepEqual(r.content.slice(1).map(c => [c.type, c.mimeType, c.data]), [['image', 'image/jpeg', Buffer.from(JPEG).toString('base64')], ['image', 'image/jpeg', Buffer.from(JPEG).toString('base64')]]);
  assert.equal(d.cameras[1].facing_guess, 'N (from its name)'); assert.equal(d.cameras[0].network, 'TfL JamCams'); assert.match(d.source, /TfL Open Data/);
  assert.deepEqual(hashOf(d.url).add, ['cams']); assert.match(r.content[0].text, /^3 traffic cameras within 1 km of 51\.51°N 0\.13°W:/);
  const none = ok(await call(server, 'traffic_cameras', { lat: 51.5079, lon: -0.1283, pictures: 0 }));
  assert.equal(none.content.length, 1); assert.equal(none.structuredContent.radius_km, 5);
  const paris = await call(server, 'traffic_cameras', { place: 'Paris' });
  assert.equal(paris.isError, true); assert.match(paris.content[0].text, /No public camera network .* covers Paris.*TfL JamCams/); assert.equal(paris.structuredContent.error, 'not_found');
});

test('mcp: live transit near a place: HSL\'s file read into lines and modes, filters, stale reports dropped', async () => {
  const { server } = serve(), r = ok(await call(server, 'transit_vehicles', { lat: 60.1699, lon: 24.9384 })), d = r.structuredContent;
  assert.equal(d.feed, 'HSL'); assert.deepEqual(d.vehicles.map(v => [v.mode, v.line]), [['metro', 'M1'], ['tram', '9'], ['bus', '55']], 'nearest first; the 20-minute-old tram and the one 18 km away are out');
  assert.equal(d.vehicles[2].status, 'at a stop'); assert.equal(d.vehicles[1].speed_kmh, 29); assert.equal(d.vehicles[1].heading, 'E');
  assert.match(r.content[0].text, /^3 vehicles within 1 km of .* \(1 metro, 1 tram, 1 bus; HSL\):/); assert.deepEqual(hashOf(d.url).add, ['transit']);
  assert.deepEqual(ok(await call(server, 'transit_vehicles', { lat: 60.1699, lon: 24.9384, mode: 'tram' })).structuredContent.vehicles.map(v => v.line), ['9']);
  assert.deepEqual(ok(await call(server, 'transit_vehicles', { lat: 60.1699, lon: 24.9384, line: '55' })).structuredContent.vehicles.map(v => v.mode), ['bus']);
  assert.match(ok(await call(server, 'transit_vehicles', { lat: 60.1699, lon: 24.9384, mode: 'ferry' })).content[0].text, /^No ferry vehicles reporting within 1 km/);
  const far = await call(server, 'transit_vehicles', { place: 'Paris' });
  assert.equal(far.isError, true); assert.match(far.content[0].text, /outside the live transit .*Boston, Helsinki, Austin, Minneapolis, Norway/);
});

test('mcp: live transit in Boston (MBTA) and Oslo (Entur, asked for a box around the place by POST)', async () => {
  const { server, net } = serve();
  const b = ok(await call(server, 'transit_vehicles', { lat: 42.3564, lon: -71.0620 })).structuredContent.vehicles;
  assert.deepEqual([b[0].mode, b[0].line, b[0].destination, b[0].status], ['metro', 'Red Line', 'Alewife', 'at a stop']);
  const o = ok(await call(server, 'transit_vehicles', { lat: 59.913, lon: 10.752, radius_km: 2 }));
  const v = o.structuredContent.vehicles[0];
  assert.deepEqual([v.mode, v.line, v.destination, v.delay_min, v.speed_kmh, v.operator], ['tram', '12', 'Kjelsås', 2.5, 18, 'Sporveien']);
  assert.match(o.content[0].text, /Tram 12 → Kjelsås \(Majorstuen - Kjelsås\) · .* · 3 min late/);
  assert.ok(net.asked.includes(ENTUR_VEHICLES));
});

test('mcp: wildfires: VIIRS hot pixels grouped into fires, placed by name, the last 24 hours only', async () => {
  const { server, net } = serve(), r = ok(await call(server, 'wildfires', { lat: -15.05, lon: 132.1, radius_km: 100 })), d = r.structuredContent;
  assert.equal(d.total_detections, 4, 'the old one and the far one are out; the repeat across days counts once');
  assert.deepEqual(d.fires.map(f => [f.detections, f.power_mw]), [[3, 180], [1, 2]]);
  assert.equal(d.fires[0].near, 'Mainoru, Northern Territory, Australia'); assert.equal(d.fires[0].from, '24 km NNE of Mainoru, Northern Territory, Australia'); assert.equal(d.fires[0].night_detections, 3); assert.equal(d.fires[0].last_seen, '2026-10-01T04:31:00Z');
  assert.match(r.content[0].text, /^4 fire detections in the last 24 hours within 100 km of .*, in 2 groups:\n24 km NNE of Mainoru, Northern Territory, Australia \(15\.00°S 132\.00°E\) · a sizeable fire \(3 hot pixels/);
  assert.match(r.content[0].text, /A detection is a hot 375 m pixel/); assert.deepEqual(hashOf(d.url).add, ['fires']); assert.deepEqual(d.named_fires, []);
  assert.ok(!net.asked.some(u => u.includes('WFIGS')), 'NIFC only for the US');
  assert.equal(ok(await call(server, 'wildfires', { lat: -15.05, lon: 132.1, radius_km: 100, hours: 6 })).structuredContent.total_detections, 1, 'only the afternoon one in the last 6 hours');
  const ca = ok(await call(server, 'wildfires', { lat: 36, lon: -121.4, radius_km: 50 }));
  assert.equal(ca.structuredContent.total_detections, 0); assert.deepEqual(ca.structuredContent.named_fires.map(f => [f.name, f.acres, f.contained]), [['Timber', 25350, 97]], 'a contained fire is left out');
  assert.match(ca.content[0].text, /No fire detections .*\nNamed fires NIFC has mapped here \(not yet fully contained\):\nFire "Timber" \(CA\): 25,350 acres, 97% contained/);
});

test('mcp: wildfires: when NASA\'s tiles cannot be had, say so', async () => {
  const { server } = serve(pretendInternet([[/gibs\.earthdata/, new Error('down')], ...ROUTES]));
  const r = await call(server, 'wildfires', { lat: -15, lon: 132 });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /GIBS\) are not answering/);
});

test('mcp: a country briefing by name, code, alias, place or point: facts, area, quakes, storms, the capital\'s weather', async () => {
  const { server } = serve(), r = ok(await call(server, 'country_briefing', { country: 'Japan' })), d = r.structuredContent;
  assert.equal(d.country.iso, 'JP'); assert.equal(d.country.capital, 'Tokyo'); assert.ok(d.country.area_km2 > 340000 && d.country.area_km2 < 400000, `${d.country.area_km2}`);
  assert.equal(d.earthquakes_week.inside + d.earthquakes_week.offshore, 1); assert.equal(d.earthquakes_week.strongest.magnitude, 5.1);
  assert.deepEqual(d.storms_near.map(s => s.name), ['Koguma']); assert.equal(d.capital_weather.temperature_c, 9.4);
  assert.match(r.content[0].text, /^🇯🇵 Japan \(JP\/JPN\): Capital Tokyo; Asia; population [\d.]+ million/); assert.match(r.content[0].text, /In Tokyo now \(2026-10-01 21:00 local\): 9 degrees Celsius, overcast/);
  const v = hashOf(d.url); assert.equal(v.country, 'JP'); assert.deepEqual(v.add, ['quakes']);
  for (const q of [{ country: 'jp' }, { country: 'JPN' }, { country: 'japan' }, { place: 'Kyoto' }, { lat: 36.2, lon: 138.25 }]) assert.equal(ok(await call(server, 'country_briefing', q)).structuredContent.country.iso, 'JP', JSON.stringify(q));
  assert.equal(ok(await call(server, 'country_briefing', { country: 'UK' })).structuredContent.country.iso, 'GB');
  assert.equal(ok(await call(server, 'country_briefing', { country: "Cote d'Ivoire" })).structuredContent.country.iso, 'CI');
  const us = ok(await call(server, 'country_briefing', { country: 'United States' })).structuredContent;
  assert.ok(us.earthquakes_week.list.some(q => /Texas/.test(q.place))); assert.ok(us.events.some(e => /Austin/.test(e.title))); assert.ok(us.storms_near.some(s => s.name === 'Isaias'));
  for (const [q, re] of [[{ country: 'Atlantis' }, /No country called "Atlantis"/], [{ lat: 0, lon: -30 }, /not inside any country/], [{}, /Say which country/]]) {
    const e = await call(server, 'country_briefing', q); assert.equal(e.isError, true); assert.match(e.content[0].text, re);
  }
});

test('mcp: submarine cables at a place: the landing station, the cables there and passing by, with their records', async () => {
  const { server } = serve(), r = ok(await call(server, 'submarine_cables', { place: 'Marseille' })), d = r.structuredContent;
  assert.deepEqual(d.landing_stations.map(l => l.name), ['Marseille, France']);
  assert.deepEqual(d.cables.map(c => [c.name, c.lands_here]), [['Blue', 'Marseille, France'], ['2Africa', 'Marseille, France'], ['Medloop', null]], 'landing here first, then passing by');
  assert.deepEqual([d.cables[0].length_km, d.cables[0].owners, d.cables[0].ready, d.cables[0].landings], [5055, ['Google', 'Sparkle'], '2023', ['Marseille, France', 'Genoa, Italy']]);
  assert.equal(d.cables[1].ready, '2024', 'from the station\'s record when the cable\'s own is missing');
  assert.ok(d.cables[2].closest_km > 40 && d.cables[2].closest_km < 50, `${d.cables[2].closest_km}`);
  assert.match(r.content[0].text, /^1 cable landing station and 3 submarine cables within 50 km of Marseille, France \(nearest: Marseille, France, \d+ m\):\nBlue · lands at Marseille, France · 5,055 km long · in service since 2023 · Google, Sparkle · 2 landings/);
  assert.match(d.cables[0].url, /submarine-cable\/blue$/);
  assert.match(ok(await call(server, 'submarine_cables', { lat: 0, lon: -140, radius_km: 50 })).content[0].text, /^No submarine cables or landing stations within 50 km/);
});

test('mcp: the planets: where, how bright, when to see them from a place, and what comes next', async () => {
  const { server, net } = serve();
  const all = ok(await call(server, 'solar_system', {})), d = all.structuredContent;
  assert.deepEqual(d.planets.map(p => p.key), ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
  assert.ok(d.moon && Array.isArray(d.meetings)); assert.equal(d.url, `${SITE}globe.html#go=tonight`); assert.equal(d.solar_url, `${SITE}solar.html`);
  assert.equal(net.asked.length, 0, 'no network without a place');
  const sat = d.planets.find(p => p.key === 'saturn'); assert.ok(sat.elongation_deg > 150 && Math.abs(sat.ring_tilt_deg) < 10, JSON.stringify(sat));
  const h = ok(await call(server, 'solar_system', { body: 'saturn', place: 'Helsinki' })), s = h.structuredContent;
  assert.equal(s.timezone, 'Europe/Helsinki'); assert.equal(s.planets.length, 1); assert.equal(s.moon, undefined);
  assert.ok(s.planets[0].sky && typeof s.planets[0].sky.altitude_deg === 'number'); assert.ok(s.planets[0].next.length >= 2);
  assert.match(h.content[0].text, /^The planets from Helsinki, Uusimaa, Finland now \(times Europe\/Helsinki\):\nSaturn: [\d,.]+ million km away \(\d+(\.\d)? light-minutes\)/);
  assert.equal(s.solar_url, `${SITE}solar.html?focus=saturn`); assert.deepEqual(hashOf(s.url).add, ['stations', 'visual']);
  const m = ok(await call(server, 'solar_system', { body: 'moon', time: '2026-10-26T04:00:00Z' })).structuredContent;
  assert.ok(m.moon.lit_percent > 97, `${m.moon.lit_percent}`); assert.equal(m.planets, undefined);
  for (const time of ['2077-01-01T00:00:00Z', 'soon']) assert.equal((await call(server, 'solar_system', { time })).isError, true, time);
});

// ---- Streamable HTTP: the handler (web Request/Response) and the Node server on loopback --------------------------
const post = (body, headers = {}, url = 'http://127.0.0.1:8793/mcp') => new Request(url, { method: 'POST', headers: { host: new URL(url).host, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('mcp http: one JSON-RPC message per POST, answered as JSON; notifications get 202', async () => {
  const h = createHttpHandler(serve().server, { name: 'open-overwatch-mcp', version: '0.2.0' });
  const init = await h(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }));
  assert.equal(init.status, 200); assert.match(init.headers.get('content-type'), /application\/json/); assert.equal(init.headers.get('mcp-protocol-version'), '2025-06-18');
  assert.equal((await init.json()).result.serverInfo.name, 'open-overwatch');
  const list = await (await h(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-protocol-version': '2025-06-18' }))).json();
  assert.equal(list.result.tools.length, 20);
  const q = await (await h(post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'earthquakes', arguments: {} } }))).json();
  assert.equal(q.result.structuredContent.total, 3);
  const n = await h(post({ jsonrpc: '2.0', method: 'notifications/initialized' })); assert.equal(n.status, 202); assert.equal(await n.text(), '');
  const back = await h(post({ jsonrpc: '2.0', id: 9, result: {} })); assert.equal(back.status, 202, 'a response from the client');
  const root0 = await h(new Request('http://localhost:8793/', { headers: { host: 'localhost:8793' } })); assert.equal(root0.status, 200); assert.match(await root0.text(), /^open-overwatch-mcp 0\.2\.0: .*POST JSON-RPC to \/mcp/);
});

test('mcp http: the guards: Host, Origin, method, media types, protocol version, size, batches', async () => {
  const h = createHttpHandler(serve().server), ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  const status = async r => (await h(r)).status;
  assert.equal(await status(post(ping, { host: 'evil.example:8793' })), 403, 'DNS rebinding: a foreign Host');
  assert.equal(await status(post(ping, { origin: 'https://evil.example' })), 403);
  assert.equal(await status(post(ping, { origin: 'null' })), 403);
  const okOrigin = await h(post(ping, { origin: 'http://localhost:6274' }));
  assert.equal(okOrigin.status, 200); assert.equal(okOrigin.headers.get('access-control-allow-origin'), 'http://localhost:6274');
  const pre = await h(new Request('http://127.0.0.1:8793/mcp', { method: 'OPTIONS', headers: { host: '127.0.0.1:8793', origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'POST' } }));
  assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers'), /MCP-Protocol-Version/); assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  const listed = createHttpHandler(serve().server, { origins: ['https://app.example'] });
  assert.equal((await listed(post(ping, { origin: 'https://app.example' }))).status, 200);
  const get = await h(new Request('http://127.0.0.1:8793/mcp', { headers: { host: '127.0.0.1:8793', accept: 'text/event-stream' } }));
  assert.equal(get.status, 405); assert.equal(get.headers.get('allow'), 'POST, OPTIONS');
  assert.equal(await status(new Request('http://127.0.0.1:8793/mcp', { method: 'DELETE', headers: { host: '127.0.0.1:8793' } })), 405, 'no sessions to end');
  assert.equal(await status(post(ping, { 'content-type': 'text/plain' })), 415);
  assert.equal(await status(post(ping, { accept: 'text/html' })), 406);
  assert.equal(await status(post(ping, { 'mcp-protocol-version': '1999-01-01' })), 400);
  assert.equal(await status(post([ping, ping])), 400, 'one message per POST');
  const bad = await h(post('{not json')); assert.equal(bad.status, 400); assert.equal((await bad.json()).error.code, -32700);
  assert.equal(await status(post('x'.repeat(MAX_BODY + 1))), 413);
  assert.equal(await status(post(ping, {}, 'http://127.0.0.1:8793/other')), 404);
  assert.equal(await status(post(ping, { host: '[::1]:8793' })), 200); assert.equal(await status(post(ping, { host: 'localhost' })), 200);
  const open = createHttpHandler(serve().server, { hosts: null });
  assert.equal((await open(post(ping, { host: 'mcp.example.com' }))).status, 200, 'behind a real domain the Host check can be turned off');
  assert.ok(originAllowed(undefined) && originAllowed('http://[::1]:3000') && !originAllowed('http://localhost.evil.example') && !originAllowed('file://'));
});

test('mcp http: the Node server listens on loopback only and answers a real client; a hang-up cancels the call', async () => {
  await assert.rejects(serveHttp(serve().server, { port: 0, host: '0.0.0.0' }), /loopback/);
  let started = null;
  const slow = { handle: async (m, { signal }) => { started = signal; await new Promise(r => signal.addEventListener('abort', r)); return { jsonrpc: '2.0', id: m.id, result: {} }; } };
  const h = await serveHttp(serve().server, { port: 0 });
  try {
    assert.match(h.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const r = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'tropical_storms', arguments: {} } }) });
    assert.equal(r.status, 200); assert.deepEqual((await r.json()).result.structuredContent.storms.map(s => s.name), ['Isaias', 'Koguma']);
    const big = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(MAX_BODY + 10) });
    assert.equal(big.status, 413);
  } finally { await h.close(); }
  const s = await serveHttp(slow, { port: 0 });
  try {
    const ctl = new AbortController();
    const p = fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' }), signal: ctl.signal }).catch(e => e);
    for (let i = 0; i < 100 && !started; i++) await new Promise(r => setTimeout(r, 10));
    assert.ok(started, 'the call began'); ctl.abort(); await p;
    for (let i = 0; i < 100 && !started.aborted; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(started.aborted, true, 'the client hung up: the tool call was cancelled');
  } finally { await s.close(); }
});

test('mcp http: node mcp/server.mjs --http serves Streamable HTTP until stopped', async () => {
  const p = spawn(process.execPath, [new URL('mcp/server.mjs', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--http', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let err = '';
    const url = await new Promise((res, rej) => { p.stderr.on('data', b => { err += b; const m = err.match(/Streamable HTTP at (http:\/\/127\.0\.0\.1:\d+\/mcp)/); if (m) res(m[1]); }); p.on('close', c => rej(new Error('exited ' + c + ': ' + err))); });
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(r.status, 200); assert.equal((await r.json()).result.tools.length, 20);
  } finally { p.kill(); }
  const bad = spawn(process.execPath, [new URL('mcp/server.mjs', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--http', '0', '--host', '0.0.0.0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let e2 = ''; bad.stderr.on('data', b => { e2 += b; });
  assert.equal(await new Promise(r => bad.on('close', r)), 1); assert.match(e2, /loopback/);
});
