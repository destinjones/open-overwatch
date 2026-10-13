// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Canned answers for the live feeds, so the browser tests never depend on (or bother) the real services. Small and
// made up, in each feed's real shape (the parsers in src/core/ read them like the real thing); times are relative to
// the moment of the request, so "the last 24 hours" and "the next launch" always hold something.
import { readFileSync } from 'node:fs';
import { windFixture } from '../../brand/tools/wind_fixture.mjs';

const ROOT = new URL('../../', import.meta.url);
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const H = 3600e3;

/** USGS M2.5+ day summary: five quakes, the largest an M6.1 off Japan (the tests look for it by name). */
export function usgs(now = Date.now()) {
  const q = (id, mag, place, lon, lat, depth, ago, extra = {}) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [lon, lat, depth] },
    properties: { mag, place, time: now - ago, updated: now - ago + 600e3, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`, felt: null, alert: null, status: 'reviewed', tsunami: 0, magType: 'mww', type: 'earthquake', title: `M ${mag} - ${place}`, code: id.slice(2), ...extra } });
  const features = [
    q('us7000e2e1', 6.1, '112 km E of Hachinohe, Japan', 142.9, 40.6, 35, 2 * H, { alert: 'green', felt: 41 }),
    q('us7000e2e2', 4.8, '45 km SW of Ovalle, Chile', -71.5, -30.9, 58, 5 * H),
    q('ak0e2e0003', 3.2, '30 km N of Petersville, Alaska', -150.8, 62.8, 88, 7 * H),
    q('ci0e2e0004', 2.7, '9 km NE of Ridgecrest, CA', -117.6, 35.7, 6, 11 * H),
    q('us7000e2e5', 5.3, 'Tonga region', -174.3, -18.7, 210, 19 * H),
  ];
  return { type: 'FeatureCollection', metadata: { generated: now, title: 'USGS Magnitude 2.5+ Earthquakes, Past Day (e2e fixture)', status: 200, count: features.length }, features };
}

/** NASA EONET open events: a wildfire, a volcano and a named storm with a short track. */
export function eonet(now = Date.now()) {
  return { title: 'EONET Events (e2e fixture)', events: [
    { id: 'EONET_E2E1', title: 'Hollow Creek Fire, Oregon', link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_E2E1', closed: null, categories: [{ id: 'wildfires', title: 'Wildfires' }],
      sources: [{ id: 'InciWeb', url: 'https://inciweb.wildfire.gov/' }], geometry: [{ magnitudeValue: 1200, magnitudeUnit: 'acres', date: iso(now - 30 * H), type: 'Point', coordinates: [-121.9, 44.1] }] },
    { id: 'EONET_E2E2', title: 'Etna Volcano, Italy', link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_E2E2', closed: null, categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
      sources: [{ id: 'SIVolcano', url: 'https://volcano.si.edu/' }], geometry: [{ magnitudeValue: null, magnitudeUnit: null, date: iso(now - 50 * H), type: 'Point', coordinates: [14.99, 37.75] }] },
    { id: 'EONET_E2E3', title: 'Typhoon Kestrel', link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_E2E3', closed: null, categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      sources: [{ id: 'JTWC', url: 'https://www.metoc.navy.mil/jtwc/jtwc.html' }],
      geometry: [0, 1, 2, 3].map(i => ({ magnitudeValue: 55 + i * 10, magnitudeUnit: 'kts', date: iso(now - (36 - i * 12) * H), type: 'Point', coordinates: [138 - i * 1.4, 16 + i * 0.9] })) },
  ] };
}

/** NOAA SWPC planetary K-index, the newer list-of-objects shape: the last reading is Kp 3.67. */
export function kp(now = Date.now()) {
  const t0 = Math.floor(now / (3 * H)) * 3 * H;
  return [2.33, 3, 2.67, 3.67].map((k, i) => ({ time_tag: iso(t0 - (3 - i) * 3 * H).slice(0, 19), Kp: k, a_running: 12, station_count: 8 }));
}

/** NOAA OVATION aurora nowcast: the full 360 x 181 grid, a smooth oval around each magnetic pole. */
export function ovation(now = Date.now()) {
  const coordinates = [];
  for (let lon = 0; lon < 360; lon++) for (let lat = -90; lat <= 90; lat++) {
    const ring = Math.abs(Math.abs(lat) - 67 + 4 * Math.cos((lon - 290) * Math.PI / 180));
    coordinates.push([lon, lat, ring < 6 ? Math.round(40 * (1 - ring / 6)) : 0]);
  }
  return { 'Observation Time': iso(now - 30 * 60e3), 'Forecast Time': iso(now + 30 * 60e3), 'Data Format': '[Longitude, Latitude, Aurora]', coordinates, type: 'MultiPoint' };
}

/** The readsb shape (adsb.lol, adsb.fi, airplanes.live): /v2/mil gets three military aircraft, a point query a few
 *  civil ones around its centre, one of them squawking 7700. */
export function readsb(url, now = Date.now()) {
  const mil = /\/mil\b/.test(url);
  const m = url.match(/(?:point|lat)\/(-?[\d.]+)\/(?:lon\/)?(-?[\d.]+)/);
  const [lat0, lon0] = m ? [+m[1], +m[2]] : [50, 5];
  const ac = mil ? [
    { hex: 'ae1234', flight: 'RCH871  ', r: '05-5140', t: 'C17', desc: 'BOEING C-17 Globemaster III', alt_baro: 31000, alt_geom: 31650, gs: 452, track: 72, baro_rate: 0, squawk: '4421', lat: 51.2, lon: -20.4, dbFlags: 1, seen: 1, seen_pos: 1 },
    { hex: '43c6f1', flight: 'ASCOT24 ', r: 'ZZ336', t: 'A332', desc: 'AIRBUS A-330 Voyager', alt_baro: 27000, gs: 410, track: 115, squawk: '6107', lat: 53.1, lon: -1.9, dbFlags: 1, seen: 2, seen_pos: 2 },
    { hex: '3f4a21', flight: 'GAF612  ', r: '10+27', t: 'A400', desc: 'AIRBUS A-400M Atlas', alt_baro: 22000, gs: 320, track: 190, squawk: '1000', lat: 49.4, lon: 8.1, dbFlags: 1, seen: 3, seen_pos: 3 },
  ] : [
    { hex: '4ca87c', flight: 'RYR4TW  ', r: 'EI-DWS', t: 'B738', alt_baro: 36000, alt_geom: 36575, gs: 448, track: 245, baro_rate: 0, squawk: '2614', lat: lat0 + 0.6, lon: lon0 - 0.8, seen: 1, seen_pos: 1 },
    { hex: '3c6752', flight: 'DLH9KA  ', r: 'D-AIZR', t: 'A320', alt_baro: 12400, gs: 301, track: 31, baro_rate: 1856, squawk: '1000', lat: lat0 - 0.4, lon: lon0 + 0.3, seen: 1, seen_pos: 1 },
    { hex: 'a1b2c3', flight: 'N512EE  ', r: 'N512EE', t: 'C172', alt_baro: 3500, gs: 105, track: 300, squawk: '7700', emergency: 'general', lat: lat0 + 0.1, lon: lon0 + 0.9, seen: 0.5, seen_pos: 0.5 },
  ];
  return { ac, msg: 'No error', now, total: ac.length, ctime: now, ptime: 3 };
}

/** OpenSky /states/all: four state vectors. */
export function opensky(now = Date.now()) {
  const t = Math.floor(now / 1000);
  return { time: t, states: [
    ['4ca87c', 'RYR4TW  ', 'Ireland', t - 5, t - 2, 2.35, 48.86, 10970, false, 230.4, 245, 0, null, 11148, '2614', false, 0],
    ['a835af', 'UAL901  ', 'United States', t - 3, t - 1, -73.78, 40.64, 3048, false, 140.2, 52, 9.8, null, 3100, '3021', false, 0],
    ['780a3c', 'CPA880  ', 'China', t - 8, t - 4, 151.18, -33.95, 0, true, 0, 90, null, null, null, null, false, 0],
    ['7c6b2d', 'QFA1    ', 'Australia', t - 4, t - 2, 103.99, 1.36, 11582, false, 251.0, 300, 0, null, 11800, '4417', false, 0],
  ] };
}

/** Launch Library 2 (the site build's trimmed copy, data/launches.json): three launches in the next days, one
 *  "TBD" a month out. The first is the real fixture in test/fixtures, moved into the future. */
export function launches(now = Date.now()) {
  const base = JSON.parse(readFileSync(new URL('test/fixtures/ll2_launch.json', ROOT), 'utf8')).results[0];
  const at = (h, extra) => ({ ...structuredClone(base), ...extra, net: iso(now + h * H), window_start: iso(now + h * H), window_end: iso(now + h * H + 2 * H) });
  return { t: now, results: [
    at(30, { id: 'e2e-1' }),
    at(78, { id: 'e2e-2', name: 'Electron | Owl Night', rocket: { configuration: { name: 'Electron', full_name: 'Electron' } }, mission: { name: 'Owl Night', type: 'Earth Science', orbit: { name: 'Sun-Synchronous Orbit', abbrev: 'SSO' } },
      pad: { name: 'Rocket Lab LC-1A', latitude: -39.26, longitude: 177.86, country: { alpha_2_code: 'NZ', name: 'New Zealand' }, location: { name: 'Mahia Peninsula, New Zealand' } }, launch_service_provider: { name: 'Rocket Lab', type: { name: 'Commercial' } }, vid_urls: [] }),
    at(130, { id: 'e2e-3', name: 'Long March 2D | Yaogan', net_precision: { abbrev: 'HR', name: 'Hour' }, rocket: { configuration: { name: 'Long March 2D', full_name: 'Long March 2D' } }, mission: { name: 'Yaogan', type: 'Government/Top Secret', orbit: { name: 'Low Earth Orbit', abbrev: 'LEO' } },
      pad: { name: 'LC-3', latitude: 38.85, longitude: 111.6, country: { alpha_2_code: 'CN', name: 'China' }, location: { name: 'Taiyuan, China' } }, launch_service_provider: { name: 'CASC', type: { name: 'Government' } }, vid_urls: [] }),
    at(24 * 30, { id: 'e2e-4', name: 'Starship | Flight 14', net_precision: { abbrev: 'M', name: 'Month' } }),
  ] };
}

/** Who is in space (data/astronauts.json, the site build's trimmed Launch Library 2 copy): the real fixture in test/fixtures. */
export function astronauts(now = Date.now()) {
  return { t: now, source: 'e2e fixture', results: JSON.parse(readFileSync(new URL('test/fixtures/ll2_astronauts.json', ROOT), 'utf8')).results };
}

/** Open-Meteo's hourly cloud cover and rain chance for Tonight (unixtime, GMT): four days, clear in the evenings,
 *  overcast by day. Only this one point query; the weather panel's grids stay blocked (Open-Meteo's per-IP quota). */
export function openMeteoClouds(href, now = Date.now()) {
  const u = new URL(href), t0 = Math.floor(now / H) * 3600 - 24 * 3600, time = [], cloud_cover = [], precipitation_probability = [];
  for (let i = 0; i < 120; i++) { const t = t0 + i * 3600, h = new Date(t * 1000).getUTCHours(); time.push(t); cloud_cover.push(h >= 18 || h < 5 ? 12 : 85); precipitation_probability.push(h >= 18 || h < 5 ? 0 : 40); }
  return { latitude: +u.searchParams.get('latitude'), longitude: +u.searchParams.get('longitude'), utc_offset_seconds: 0, timezone: 'GMT', hourly_units: { time: 'unixtime', cloud_cover: '%', precipitation_probability: '%' }, hourly: { time, cloud_cover, precipitation_probability } };
}

/** The ISS over the English Channel. */
export const wheretheiss = now => ({ name: 'iss', id: 25544, latitude: 50.2, longitude: -1.4, altitude: 418.3, velocity: 27580.1, visibility: 'daylight', footprint: 4500, timestamp: Math.floor(now / 1000), units: 'kilometers' });

/** GitHub's latest release, for the landing page's version line. */
export const githubRelease = () => ({ tag_name: 'v0.9.2.9', name: 'v0.9.2.9', published_at: '2026-10-13T12:00:00Z', html_url: 'https://github.com/destinjones/open-overwatch/releases/tag/v0.9.2.9' });

/** versions.json (the site build writes it): two versions, the older one without a Solar System view. */
export const versions = () => ({ versions: [
  { tag: 'v0.9.2.9', date: '2026-10-13', title: 'The growth push', notes: 'Weather 2.0, solar missions and comets, aviation.', map: 'v/v0.9.2.9/open-overwatch.html', globe: 'v/v0.9.2.9/globe.html', solar: 'v/v0.9.2.9/solar.html' },
  { tag: 'v0.9.1', date: '2026-10-02', title: 'The rebuild', notes: '', map: 'v/v0.9.1/open-overwatch.html', globe: 'v/v0.9.1/globe.html' },
] });

/** The USGS catalogue (time travel): the real M6+ quakes of 2011-03-11 (test/fixtures/history) for that day, none for any other. */
export function catalogue(href) {
  const day = new URL(href).searchParams.get('starttime') || '';
  return day.startsWith('2011-03-11') ? JSON.parse(readFileSync(new URL('test/fixtures/history/fdsn_2011-03-11_m6.json', ROOT), 'utf8')) : { type: 'FeatureCollection', features: [] };
}

/** The TLE mirror (data/tle/<group>.txt): the space stations from test/fixtures for every group, so each layer has dots. */
export const tle = () => readFileSync(new URL('test/fixtures/stations.tle', ROOT), 'utf8');

export const wind = () => windFixture();

/** Empty but valid answers: no warnings, no storms. */
export const EMPTY = {
  nws: () => ({ type: 'FeatureCollection', features: [], title: 'Current watches, warnings, and advisories (e2e fixture)', updated: iso(Date.now()) }),
  nhc: () => ({ activeStorms: [] }),
  gdacs: () => ({ type: 'FeatureCollection', features: [] }),
  arcgis: () => ({ features: [], objectIdFieldName: 'OBJECTID', geometryType: 'esriGeometryPolygon', spatialReference: { wkid: 4326 } }),
};
