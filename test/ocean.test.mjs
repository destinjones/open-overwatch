// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The sea and air feeds (src/core/ocean.js) against real answers captured on 2026-10-13 (test/fixtures/ocean/): NDBC's
// latest observations, station list and a DART file; CO-OPS stations, a water level and tide predictions; two GIBS colour
// maps; Open-Meteo's air quality.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseNdbcLatest, parseNdbcStations, mergeNdbc, waveLook, parseDart, dartStatus, dartUrl, ndbcPage,
  parseCoopsStations, coopsDatum, coopsUrl, parseCoopsLatest, parseCoopsHilo, nextTides, coopsPage,
  parseGibsColormap, parseGibsDomain, gibsDomainUrl, colormapValue, legendStops, gibsPixel, gibsGeoUrl, SEA_AIR_IMAGERY,
  aqUrl, parseAirQuality, aqiLook, aqGrid,
} from '../src/core/ocean.js';

const fx = f => readFileSync(new URL('./fixtures/ocean/' + f, import.meta.url), 'utf8');

test('NDBC latest observations: columns by name, MM is null, times in UTC', () => {
  const rows = parseNdbcLatest(fx('ndbc-latest_obs.txt'));
  assert.equal(rows.length, 15);
  const b = rows.find(r => r.id === '44013');
  assert.deepEqual([b.lat, b.lon, b.windDir, b.windMs, b.gustMs, b.waveM, b.pressureHpa, b.airC, b.waterC, b.dewC], [42.346, -70.651, 160, 6, 8, null, 1014.7, 14.1, 14.3, 13.9]);
  assert.equal(new Date(b.t).toISOString(), '2026-10-13T19:30:00.000Z');
  const w = rows.find(r => r.id === '41070');
  assert.deepEqual([w.waveM, w.wavePeriodS, w.avgPeriodS, w.waveDir, w.windMs], [0.6, 7, 3.6, 58, null]);
  assert.equal(rows.find(r => r.id === 'BURL1').pressureTendencyHpa, -1.3);
  assert.deepEqual([rows.find(r => r.id === '22101').waveM, rows.find(r => r.id === '22101').wavePeriodS], [1, null]);   // KMA's 0 s = not measured
  assert.equal(rows.find(r => r.id === 'PILM4').pressureTendencyHpa, 0.6);
  // junk lines and impossible positions are dropped
  assert.equal(parseNdbcLatest('#STN LAT LON YYYY MM DD hh mm\n<script> 1 2 2026 1 1 0 0\nAB12 95 0 2026 1 1 0 0\nAB12 10 20 2026 1 1 0 0\n').length, 1);
  assert.deepEqual(parseNdbcLatest('not a table'), []);
});

test('NDBC station list: attributes, names trimmed and entities decoded, DART flags', () => {
  const st = parseNdbcStations(fx('ndbc-activestations.xml'));
  assert.equal(st.length, 10);
  const d = st.find(s => s.id === '21414');
  assert.deepEqual([d.type, d.name, d.program, d.dartData], ['dart', 'AMCHITKA - 170 NM South of Amchitka, AK', 'Tsunami', false]);
  assert.equal(st.find(s => s.id === '46404').dartData, true);
  assert.equal(st.filter(s => s.type === 'dart').length, 5);
  assert.equal(parseNdbcStations('<station id="X&amp;1" lat="1" lon="2"/><station id="AB12" lat="1" lon="2" name="A &amp; B &#233;"/>')[0].name, 'A & B é');
  const merged = mergeNdbc(parseNdbcLatest(fx('ndbc-latest_obs.txt')), st);
  assert.equal(merged.find(r => r.id === '46042').name, 'MONTEREY - 27NM WNW of Monterey, CA');
  assert.equal(merged.find(r => r.id === '41070').type, 'other');   // not in the trimmed list
  assert.deepEqual(waveLook(null)[0], 'no wave sensor'); assert.equal(waveLook(0.3)[0], 'calm'); assert.equal(waveLook(3)[0], 'rough'); assert.equal(waveLook(9)[0], 'very high seas');
  assert.equal(dartUrl('46404'), 'https://www.ndbc.noaa.gov/data/realtime2/46404.dart'); assert.equal(dartUrl('../x'), null);
  assert.equal(ndbcPage('BURL1'), 'https://www.ndbc.noaa.gov/station_page.php?station=burl1'); assert.equal(ndbcPage('a"b'), null);
});

test('DART: water column heights newest first, modes, event detection and silence', () => {
  const d = parseDart(fx('ndbc-46404.dart'));
  assert.equal(d.rows.length, 38);
  assert.deepEqual([new Date(d.latest.t).toISOString(), d.latest.heightM, d.latest.mode], ['2026-10-13T18:00:00.000Z', 2737.734, 1]);
  const now = Date.UTC(2026, 9, 13, 19, 0);
  const s = dartStatus(d, now);
  assert.equal(s.state, 'standard'); assert.ok(s.rangeM > 0 && s.rangeM < 3);
  const ev = parseDart('#YY\n2026 10 13 18 59 45 3 2737.900\n2026 10 13 18 59 30 3 2737.880\n2026 10 13 18 00 00 1 2737.700\n2026 10 13 17 00 00 1 9999.000\n');
  assert.equal(ev.rows.length, 3);
  assert.equal(dartStatus(ev, now).state, 'event');
  assert.equal(dartStatus(d, now + 4 * 3600e3).state, 'standard'); assert.equal(dartStatus(d, now + 7 * 3600e3).state, 'late');
  assert.equal(dartStatus(d, now + 4 * 864e5).state, 'silent');
  assert.equal(dartStatus(parseDart(''), now).state, 'silent');
});

test('CO-OPS: stations, datums, URLs, the latest level, highs and lows', () => {
  const st = parseCoopsStations(JSON.parse(fx('coops-stations.json')));
  assert.equal(st.length, 4);
  const sf = st.find(s => s.id === '9414290');
  assert.deepEqual([sf.name, sf.state, sf.tidal, sf.greatLakes], ['San Francisco', 'CA', true, false]);
  assert.ok(Math.abs(sf.lat - 37.806) < 0.01 && Math.abs(sf.lon + 122.466) < 0.01);
  assert.deepEqual(st.map(coopsDatum), st.map(s => s.tidal ? 'MLLW' : s.greatLakes ? 'IGLD' : 'MSL'));
  assert.equal(coopsDatum(st.find(s => s.id === '8311030')), 'IGLD');
  const now = Date.UTC(2026, 9, 13, 19, 50);
  assert.equal(coopsUrl('9414290', 'latest'), 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?application=open_overwatch&station=9414290&datum=MLLW&units=metric&time_zone=gmt&format=json&product=water_level&date=latest');
  assert.match(coopsUrl('9414290', 'hilo', { now }), /product=predictions&interval=hilo&begin_date=20261012&range=96$/);
  assert.equal(coopsUrl('94142&x=1', 'latest'), null); assert.equal(coopsUrl('9414290', 'latest', { datum: 'x;y' }), null);
  const l = parseCoopsLatest(JSON.parse(fx('coops-latest.json')));
  assert.deepEqual([new Date(l.t).toISOString(), l.levelM, l.verified], ['2026-10-13T19:54:00.000Z', 2.072, false]);
  assert.equal(parseCoopsLatest({ error: { message: ' The supported Datum values are: MSL, NAVD' } }).error, 'The supported Datum values are: MSL, NAVD');
  assert.equal(parseCoopsLatest({ data: [] }).error, 'no recent reading');
  const hl = parseCoopsHilo(JSON.parse(fx('coops-hilo.json')));
  assert.ok(hl.length >= 6); assert.ok(hl.every((p, i) => !i || p.t > hl[i - 1].t));
  const n = nextTides(hl, now);
  assert.equal(new Date(n.high.t).toISOString(), '2026-10-13T20:14:00.000Z'); assert.equal(n.high.levelM, 1.799);
  assert.equal(new Date(n.low.t).toISOString(), '2026-10-14T03:01:00.000Z');
  assert.equal(n.last.type, 'L'); assert.equal(n.rising, true);
  assert.equal(coopsPage('9414290'), 'https://tidesandcurrents.noaa.gov/stationhome.html?id=9414290');
});

test('GIBS colour maps: ranges, a pixel back to a value, the legend, the tile grid', () => {
  const sst = parseGibsColormap(fx('gibs-GHRSST_Sea_Surface_Temperature.xml'));
  assert.equal(sst.entries.length, 215);
  assert.deepEqual([sst.min, sst.max], [0, 32]);
  assert.equal(sst.entries[0].lo, -Infinity); assert.equal(sst.entries[sst.entries.length - 1].hi, Infinity);
  assert.deepEqual(colormapValue(sst, 252, 243, 0), { value: 22.125, lo: 22.05, hi: 22.2 });   // [22.05,22.20)
  assert.equal(colormapValue(sst, 0, 0, 0), null);                 // no data
  assert.equal(colormapValue(sst, 252, 243, 0, 0), null);          // transparent pixel
  assert.equal(colormapValue(sst, 43, 0, 26).value, 0);             // below 0 °C: the open end reads as its bound
  const stops = legendStops(sst, 5);
  assert.deepEqual(stops.map(s => s.value), [0, 8, 16, 24, 32]); assert.ok(stops.every(s => /^#[0-9a-f]{6}$/.test(s.color)));
  const ai = parseGibsColormap(fx('gibs-OMPS_Aerosol_Index.xml'));
  assert.deepEqual([ai.min, ai.max], [0, 5]); assert.equal(colormapValue(ai, 237, 13, 0).value, 3.6875);
  // the geographic grid: level 0 is two 288° tiles of 512 px
  assert.deepEqual(gibsPixel(-180, 90, 0), { level: 0, row: 0, col: 0, x: 0, y: 0 });
  assert.deepEqual(gibsPixel(108, 0, 0), { level: 0, row: 0, col: 1, x: 0, y: 160 });
  const p = gibsPixel(-122.5, 36.8, 5);   // 9° tiles
  assert.deepEqual([p.row, p.col], [5, 6]); assert.equal(p.x, Math.floor(((57.5 / 9) - 6) * 512)); assert.equal(p.y, Math.floor(((53.2 / 9) - 5) * 512));
  assert.equal(gibsPixel(180, -90, 5).row, 19);
  assert.equal(parseGibsDomain("<Domains><DimensionDomain><Domain>2026-10-01/2026-10-12/P1D</Domain></DimensionDomain></Domains>"), '2026-10-12');
  assert.equal(parseGibsDomain('<Domain>2026-09-30,2026-10-02/2026-10-05/P1D,2026-10-07</Domain>'), '2026-10-07');
  assert.equal(parseGibsDomain('<Domains/>'), null);
  assert.equal(gibsDomainUrl(SEA_AIR_IMAGERY.smoke, Date.UTC(2026, 9, 13)), 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/OMPS_Aerosol_Index/default/2km/all/2026-09-23--2026-10-14.xml');
  assert.equal(gibsGeoUrl(SEA_AIR_IMAGERY.sst, 5, 5, 6), 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/GHRSST_L4_MUR_Sea_Surface_Temperature/default/default/1km/5/5/6.png');
});

test('Open-Meteo air quality: many points in one request, EPA bands, a grid on round numbers', () => {
  const u = aqUrl([{ lat: 40.712, lon: -74.006 }, { lat: 28.6, lon: 77.2 }]);
  assert.match(u, /^https:\/\/air-quality-api\.open-meteo\.com\/v1\/air-quality\?latitude=40\.71,28\.6&longitude=-74\.01,77\.2&current=us_aqi,/);
  const q = parseAirQuality(JSON.parse(fx('openmeteo-aq.json')));
  assert.equal(q.length, 3);
  assert.deepEqual([q[0].usAqi, q[0].euAqi, q[0].pm25, q[0].pm10, q[0].aod, new Date(q[0].t).toISOString()], [86, 44, 21.9, 24, 0.36, '2026-10-13T19:00:00.000Z']);
  assert.equal(parseAirQuality({ latitude: 1, longitude: 2, current: { time: '2026-10-13T19:00', us_aqi: 12 } })[0].usAqi, 12);   // a single point answers with an object
  assert.deepEqual(parseAirQuality(null), []);
  assert.deepEqual(aqiLook(0), ['Good', '#00e400']); assert.deepEqual(aqiLook(86)[0], 'Moderate'); assert.equal(aqiLook(101)[0], 'Unhealthy for sensitive groups');
  assert.equal(aqiLook(350)[0], 'Hazardous'); assert.equal(aqiLook(null)[0], 'no data');
  const g = aqGrid(-10, 35, 30, 60, 48);
  assert.equal(g.step, 5); assert.ok(g.points.length <= 77 && g.points.length > 30);
  assert.ok(g.points.every(p => p.lat % 5 === 0 && p.lon % 5 === 0));
  const x = aqGrid(170, -10, -170, 10, 20);   // across the antimeridian
  assert.ok(x.points.some(p => p.lon === 180 || p.lon === -180) && x.points.every(p => p.lon >= 170 || p.lon <= -170));
});

test('card words: only what was measured, both unit systems, honest times', async () => {
  const { buoyRows, tideRows, aqRows, agoWords, tempWords } = await import('../src/core/ocean.js');
  const rows = parseNdbcLatest(fx('ndbc-latest_obs.txt')), now = Date.UTC(2026, 9, 13, 20, 0);
  const b = Object.fromEntries(buoyRows(rows.find(r => r.id === '44013'), now));
  assert.equal(b.Wind, '6.0 m/s (12 kn) from the SSE (160°), gusts 8.0 m/s (16 kn)');
  assert.equal(b['Water temperature'], '14.3 °C (58 °F)'); assert.equal(b.Waves, undefined);
  assert.equal(b.Observed, '2026-10-13 19:30 UTC (30 min ago)');
  const w = Object.fromEntries(buoyRows(rows.find(r => r.id === '41070'), now));
  assert.equal(w.Waves, '0.6 m (2.0 ft) significant height, slight, every 7 s from the ENE');
  assert.equal(tempWords(-1.5), '-1.5 °C (29 °F)');
  assert.equal(agoWords(now - 3 * 864e5, now), '3 days ago'); assert.equal(agoWords(null), '');
  const st = parseCoopsStations(JSON.parse(fx('coops-stations.json'))).find(s => s.id === '9414290');
  const t = Object.fromEntries(tideRows(st, parseCoopsLatest(JSON.parse(fx('coops-latest.json'))), nextTides(parseCoopsHilo(JSON.parse(fx('coops-hilo.json'))), now), now));
  assert.match(t['Water level'], /^2\.1 m \(6\.8 ft\) above mean lower low water/);
  assert.equal(t['Next high tide'], '2026-10-13 20:14 UTC, 1.8 m (5.9 ft)'); assert.equal(t.Tide, 'rising');
  assert.match(Object.fromEntries(tideRows(st, { error: 'No data was found.' }, null))['Water level'], /^not available: No data/);
  const a = Object.fromEntries(aqRows(parseAirQuality(JSON.parse(fx('openmeteo-aq.json')))[0]));
  assert.equal(a['US AQI'], '86, moderate'); assert.equal(a['PM2.5'], '21.9 µg/m³'); assert.equal(a.Dust, undefined);
});
