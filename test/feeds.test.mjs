// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The shared feed parsers (src/core/quakes, eonet, cyclones, gdacs, aurora, cables): one copy for the 2D map, the globe
// and the MCP server. Inputs are small hand-made copies of each service's real answer shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsgs, usgsUrl, usgsFeedFor, largest, quakeTitle, gdacsQuakes } from '../src/core/quakes.js';
import { parseEonet, eonetUrl, newestFirst } from '../src/core/eonet.js';
import { nhcForecasts } from '../src/core/hazards.js';
import { stampReports, recordOf } from '../src/core/liveprov.js';
import { parseNhcCurrent, parseGdacsCyclones, stormsFromEonet, mergeNhc, mergeNoaa, mergeGdacs, stormAgreement, loadCyclones, category, catName, compass16, gdacsTcUrl, NOAA_LAYERS, NHC_CURRENT, activeLine, shortName, stormSources } from '../src/core/cyclones.js';
import { parseGdacsEvents, loadGdacsEvents, gdacsEventsUrl, utc } from '../src/core/gdacs.js';
import { parseOvation, ovationAt, paintEquirect, paintMercator, auroraColor, latestKp } from '../src/core/aurora.js';
import { parseLandings, nearestCable, okColor } from '../src/core/cables.js';

const quake = (id, mag, lon, lat, extra = {}) => ({ type: 'Feature', id, properties: { mag, place: 'somewhere', time: 1760000000000, updated: 1760000100000, url: 'https://earthquake.usgs.gov/x', magType: 'ml', type: 'earthquake', status: 'reviewed', ...extra }, geometry: { type: 'Point', coordinates: [lon, lat, 10.5] } });

test('USGS: quakes with positions, checked fields', () => {
  const doc = { features: [quake('a', 4.2, 140, 35, { tsunami: 1, alert: 'orange', felt: 12 }), quake('b', null, 10, 10), quake('c', 2, 'x', 10), quake('d', 6.1, 200, 10),
    quake('e', 3, -120, 37, { url: 'javascript:alert(1)', alert: '<b>', type: 'quarry blast' }), { type: 'Feature' }, null] };
  const q = parseUsgs(doc);
  assert.deepEqual(q.map(x => x.id), ['a', 'b', 'e']);
  assert.equal(q[0].depth, 10.5); assert.equal(q[0].tsunami, true); assert.equal(q[0].alert, 'orange'); assert.equal(q[0].felt, 12); assert.equal(q[0].url, 'https://earthquake.usgs.gov/x');
  assert.equal(q[1].mag, null);
  assert.equal(q[2].url, ''); assert.equal(q[2].alert, null);
  assert.deepEqual(parseUsgs(doc, { min: 3, quakesOnly: true }).map(x => x.id), ['a']);
  assert.equal(largest(q).id, 'a'); assert.equal(largest([]), null);
  assert.equal(quakeTitle(q[0]), 'M4.2 · somewhere');
  assert.equal(usgsUrl('4.5_week'), 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson');
  assert.match(usgsUrl('../../etc'), /2\.5_day\.geojson$/);
  assert.equal(usgsFeedFor(5, 'week'), '4.5_week'); assert.equal(usgsFeedFor(0.5), 'all_day'); assert.equal(usgsFeedFor(1.2, 'month'), '1.0_month');
});

const eonetDoc = { events: [
  { id: 'EONET_1', title: 'Hurricane Erin', link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1', closed: null, categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
    sources: [{ id: 'JTWC', url: 'https://www.metoc.navy.mil/x' }, { id: 'bad', url: 'javascript:1' }],
    geometry: [{ type: 'Point', date: '2026-10-10T12:00:00Z', coordinates: [-60, 20], magnitudeValue: 90, magnitudeUnit: 'kts' }, { type: 'Point', date: '2026-10-10T00:00:00Z', coordinates: [-58, 19], magnitudeValue: 70, magnitudeUnit: 'kts' }] },
  { id: 'EONET_2', title: 'Fire box', categories: [{ id: 'wildfires', title: 'Wildfires' }], sources: [],
    geometry: [{ type: 'Polygon', date: '2026-10-09T00:00:00Z', coordinates: [[[10, 40], [12, 40], [12, 42], [10, 42], [10, 40]]] }] },
  { id: 'EONET_3', title: 'Nowhere', categories: [], geometry: [{ type: 'Point', date: 'x', coordinates: [500, 0] }] },
] };

test('EONET: newest fix, polygons by their middle, a point track oldest first', () => {
  const ev = parseEonet(eonetDoc);
  assert.equal(ev.length, 2);
  const [h, f] = ev;
  assert.equal(h.cat, 'severeStorms'); assert.deepEqual(h.cats, ['Severe Storms']);
  assert.equal(h.lat, 20); assert.equal(h.lon, -60); assert.equal(h.kt, 90); assert.equal(h.mag, '90 kts');
  assert.deepEqual(h.track.map(p => p.lon), [-58, -60]);   // sorted by date
  assert.equal(h.first, '2026-10-10T00:00:00.000Z'); assert.equal(h.n, 2);
  assert.deepEqual(h.sources, [{ id: 'JTWC', url: 'https://www.metoc.navy.mil/x' }]);
  assert.ok(Math.abs(f.lat - 40.8) < 1e-9 && Math.abs(f.lon - 10.8) < 1e-9);   // the ring's points averaged (the closing point counts)
  assert.equal(f.track.length, 0);
  assert.deepEqual(newestFirst(ev).map(e => e.id), ['EONET_1', 'EONET_2']);
  assert.equal(eonetUrl({ days: 10, category: 'severeStorms' }), 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=10&category=severeStorms');
  assert.equal(eonetUrl({ days: 9999, category: 'a&b' }), 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=365');
});

const nhcDoc = { activeStorms: [{ id: 'al052026', name: 'Erin', classification: 'HU', latitudeNumeric: 21.5, longitudeNumeric: -61, intensity: '100', pressure: '960', movementDir: 300, movementSpeed: 12,
  lastUpdate: '2026-10-10T15:00:00.000Z', publicAdvisory: { advNum: '12', url: 'https://www.nhc.noaa.gov/text/x.shtml' } }, { id: 'ep1', name: 'Kiko', classification: 'TS', latitudeNumeric: 'n/a' }] };
const gdacsList = { features: [
  { properties: { eventid: 1001, episodeid: 7, eventname: 'BUALOI-25', iscurrent: 'true', alertlevel: 'Orange', severitydata: { severity: 185, severitytext: 'Typhoon' }, country: 'Philippines', url: { report: 'https://www.gdacs.org/report.aspx?x' }, todate: '2026-10-10T06:00:00' }, geometry: { type: 'Point', coordinates: [125, 14] } },
  { properties: { eventid: 1002, episodeid: 1, eventname: 'OLD', iscurrent: 'false' }, geometry: { type: 'Point', coordinates: [0, 0] } },
  { properties: { eventid: 1003, episodeid: 2, eventname: 'ERIN', iscurrent: 'true', alertlevel: 'Green' }, geometry: { type: 'Point', coordinates: [-61, 21] } },
] };
const gdacsGeom = { features: [
  { properties: { Class: 'Poly_Cones', eventid: 1001, eventname: 'BUALOI-25', source: 'JTWC', polygondate: '2026-10-10T06:00:00' }, geometry: { type: 'Polygon', coordinates: [[[124, 13], [130, 15], [131, 20], [124, 13]]] } },
  { properties: { Class: 'Line_Line_1', forecast: true, polygonlabel: 'TY' }, geometry: { type: 'LineString', coordinates: [[125, 14], [128, 17]] } },
  { properties: { Class: 'Line_Line_0', forecast: false, polygonlabel: 'TS' }, geometry: { type: 'LineString', coordinates: [[120, 10], [125, 14]] } },
  { properties: { Class: 'Point_Polygon_Point_1', polygonlabel: '11/10 06:00 UTC' }, geometry: { type: 'Polygon', coordinates: [[[128, 17], [128.2, 17], [128.2, 17.2], [128, 17]]] } },
] };

test('NHC and GDACS lists parse; movement in words', () => {
  const n = parseNhcCurrent(nhcDoc);
  assert.equal(n.length, 1);
  assert.equal(n[0].title, 'Hurricane Erin'); assert.equal(n[0].kt, 100); assert.equal(n[0].pressure, 960);
  assert.equal(n[0].movement, 'toward WNW at 12 mph'); assert.equal(n[0].url, 'https://www.nhc.noaa.gov/text/x.shtml');
  assert.equal(compass16(359), 'N'); assert.equal(compass16(-90), 'W');
  const g = parseGdacsCyclones(gdacsList);
  assert.deepEqual(g.map(x => x.nice), ['Bualoi', 'Erin']);
  assert.equal(g[0].kmh, 185); assert.equal(g[0].to, Date.UTC(2026, 9, 10, 6)); assert.equal(g[0].report, 'https://www.gdacs.org/report.aspx?x');
  assert.equal(category(100)[1], 3); assert.equal(catName(40), 'Tropical storm'); assert.equal(catName(null), 'Depression or low');
  assert.equal(shortName('Super Typhoon Bualoi'), 'Bualoi');
  assert.equal(activeLine([{ title: 'A' }, { title: 'B' }], 1), 'Active: A +1');
  assert.match(gdacsTcUrl(Date.UTC(2026, 9, 12)), /fromdate=2026-10-02&todate=2026-10-12$/);
});

test('cyclones: EONET, NHC, NOAA and GDACS merge into one storm each', async () => {
  const noaaPts = { features: [{ properties: { idp_source: 'al052026-012_5day_pts', stormname: 'Hurricane Erin', tau: 0, maxwind: 105, mslp: 958, datelbl: '11:00 AM Fri' }, geometry: { type: 'Point', coordinates: [-61.2, 21.6] } },
    { properties: { idp_source: 'al052026-012_5day_pts', stormname: 'Hurricane Erin', tau: 24, maxwind: 115, datelbl: '8:00 AM Sat' }, geometry: { type: 'Point', coordinates: [-64, 24] } }] };
  const noaaCone = { features: [{ properties: { idp_source: 'al052026-012_5day_pgn', stormname: 'Erin' }, geometry: { type: 'Polygon', coordinates: [[[-61, 21], [-66, 26], [-62, 26], [-61, 21]]] } }] };
  const noaaTrack = { features: [{ properties: { idp_source: 'al052026-012_5day_lin' }, geometry: { type: 'LineString', coordinates: [[-61.2, 21.6], [-64, 24]] } }] };
  const asked = [];
  const json = async (url, o = {}) => {
    asked.push(url);
    if (url.startsWith('https://eonet')) return eonetDoc;
    if (url === NHC_CURRENT) { assert.equal(o.relay, true); return nhcDoc; }
    if (url.includes('/MapServer/5/')) return noaaPts;
    if (url.includes('/MapServer/6/')) return noaaTrack;
    if (url.includes('/MapServer/7/')) return noaaCone;
    if (url.includes('/MapServer/')) return { features: [] };
    if (url.includes('geteventlist')) return gdacsList;
    if (url.includes('getgeometry')) return gdacsGeom;
    throw new Error('unexpected ' + url);
  };
  const kept = new Map(), warns = [];
  const list = await loadCyclones({ json, nhc: true, kept, warn: (w, e) => warns.push(w + ': ' + e.message) });
  assert.deepEqual(warns, []);
  assert.equal(list.length, 2);
  const erin = list.find(s => /Erin/.test(s.title)), bualoi = list.find(s => /Bualoi/.test(s.title));
  assert.equal(erin.src, 'NASA EONET'); assert.equal(erin.nhc.title, 'Hurricane Erin'); assert.equal(erin.kt, 105);   // NOAA's forecast "now" wins
  assert.equal(erin.fc.src, 'NOAA NHC'); assert.equal(erin.fc.coherent, true); assert.equal(erin.fc.cone.length, 1);
  assert.equal(erin.lat, 21.6);
  assert.equal(stormSources(erin), 'NASA EONET + NOAA NHC');   // each source once
  assert.equal(stormSources(list.find(s => /Bualoi/.test(s.title))), 'GDACS (JTWC)');
  assert.equal(bualoi.src, 'GDACS (JTWC)'); assert.equal(bualoi.kt, Math.round(185 / 1.852)); assert.equal(bualoi.fc.track.length, 1);
  assert.equal(bualoi.fc.points.length, 1); assert.equal(bualoi.fc.points[0].label, '11/10 06:00');
  assert.ok(bualoi.links.some(l => l.text === 'GDACS report'));
  assert.equal(asked.filter(u => u.includes('getgeometry')).length, 1);   // Erin's GDACS entry is skipped: NOAA forecasts it
  assert.equal(kept.size, 1);
  asked.length = 0;
  await loadCyclones({ json, nhc: false, kept });
  assert.equal(asked.filter(u => u.includes('getgeometry')).length, 0);   // an episode is fetched once
  assert.ok(!asked.includes(NHC_CURRENT));
  assert.equal(NOAA_LAYERS.length, 6);
});

test('cyclones: a failing source is reported, EONET failing fails the load', async () => {
  const warns = [];
  const list = await loadCyclones({ json: async url => { if (url.startsWith('https://eonet')) return eonetDoc; throw new Error('down'); }, nhc: true, warn: w => warns.push(w) });
  assert.equal(list.length, 1); assert.ok(warns.includes('NHC advisories') && warns.includes('GDACS'));
  await assert.rejects(loadCyclones({ json: async () => { throw new Error('offline'); } }), /offline/);
});

test('cyclones: merge helpers keep separate storms apart', () => {
  const list = stormsFromEonet(parseEonet(eonetDoc));
  assert.equal(list.length, 1);
  mergeNhc(list, [{ id: 'x', name: 'Far', title: 'Tropical Storm Far', lat: -20, lon: 100, kt: 40, advisory: 'now' }]);
  assert.equal(list.length, 2); assert.equal(list[1].src, 'NOAA NHC');
  mergeNoaa(list, [{ id: 'cp01', name: '', points: [], cone: [[[170, 10], [171, 10], [171, 11]]], track: [], warnings: [], winds: [], past: [] }]);
  assert.equal(list.length, 3); assert.equal(list[2].lon, 170);
  mergeGdacs(list, [{ name: 'FAR', nice: 'Far', lat: -20.5, lon: 100.2, kmh: 100, report: '', fc: { id: 9, source: 'JTWC', cone: [], forecast: [], past: [], points: [] } }]);
  assert.equal(list.length, 3); assert.equal(list[1].fc.src, 'GDACS (JTWC)');
});

test('cyclones: a storm without a position is never drawn at NaN or 0,0, and one bad forecast loses nothing else', async () => {
  assert.doesNotThrow(() => mergeNoaa([], [{ id: 'al05', name: 'Erin', points: [], cone: [[]] }]));
  assert.deepEqual(mergeNoaa([], [{ id: 'al05', name: 'Erin', points: [{ lat: NaN, lon: NaN, tau: 0 }], cone: [] }]), []);   // nothing to place it by
  const fc = nhcForecasts({ points: [{ properties: { idp_source: 'al052026-012_5day_pts', stormname: 'Erin', tau: 0 }, geometry: null }] });
  assert.deepEqual(mergeNoaa([], [...fc.values()]), []);
  const gd = parseGdacsCyclones({ features: [{ properties: { iscurrent: 'true', eventid: 7, episodeid: 1, eventname: 'KOGUMA-26', todate: '2026-10-10T06:00:00' }, geometry: { type: 'Point', coordinates: [] } }] });
  assert.equal(gd[0].lat, null);
  const empty = { id: 7, source: 'JTWC', advisory: NaN, cone: [], forecast: [], past: [], points: [] };
  assert.deepEqual(mergeGdacs([], [{ ...gd[0], fc: empty }]), []);   // not at 0,0
  const known = [{ kind: 'storm', title: 'Typhoon Koguma', lat: 25, lon: 140, track: [], links: [] }];
  mergeGdacs(known, [{ ...gd[0], fc: empty }]);
  assert.equal(known.length, 1); assert.equal(known[0].lat, 25); assert.equal(known[0].fc.src, 'GDACS (JTWC)'); assert.equal(known[0].reports, undefined);   // joins by name, adds no fix
  const list = await loadCyclones({ json: async url => {
    if (url.startsWith('https://eonet')) return eonetDoc;
    if (url.includes('/MapServer/5/')) return { features: [{ properties: { idp_source: 'al062026-001_5day_pts', tau: 0 }, geometry: null }] };
    if (url.includes('/MapServer/7/')) return { features: [{ properties: { idp_source: 'al072026-001_5day_pgn', stormname: 'Odd' }, geometry: { type: 'Polygon', coordinates: [[]] } }] };
    return { features: [] };
  } });
  assert.equal(list.length, 1); assert.ok(list.every(s => Number.isFinite(s.lat) && Number.isFinite(s.lon)));   // EONET's storm survives
});

test('cyclones: only the NOAA tau-0 point moves a storm; a dropped forecast still lets GDACS draw it; a bad field is retried', async () => {
  const pts = [{ properties: { idp_source: 'al052026-012_5day_pts', stormname: 'Hurricane Erin', tau: 0, maxwind: 105 }, geometry: null },
    { properties: { idp_source: 'al052026-012_5day_pts', stormname: 'Hurricane Erin', tau: 12, maxwind: 115 }, geometry: { type: 'Point', coordinates: [-64, 24] } }];
  const known = [{ kind: 'storm', title: 'Hurricane Erin', lat: 21.6, lon: -61.2, kt: 100, track: [], links: [] }];
  mergeNoaa(known, [...nhcForecasts({ points: pts }).values()]);
  assert.equal(known.length, 1); assert.equal(known[0].lat, 21.6); assert.equal(known[0].lon, -61.2); assert.equal(known[0].kt, 100);
  assert.equal(known[0].fc.src, 'NOAA NHC'); assert.equal(known[0].reports, undefined);   // the forecast is drawn, the tau-12 point is no fix
  assert.deepEqual(mergeNoaa([], [...nhcForecasts({ points: pts }).values()]), []);   // a new storm has no cone corner to start at
  const asked = [], warns = [];
  const list = await loadCyclones({ json: async url => {
    asked.push(url);
    if (url.startsWith('https://eonet')) return eonetDoc;
    if (url.includes('/MapServer/5/')) return url.includes('idp_filedate') ? { error: { code: 400, message: 'Invalid field' } } : { features: pts };
    if (url.includes('/MapServer/')) return { features: [] };
    if (url.includes('geteventlist')) return gdacsList;
    if (url.includes('getgeometry')) return gdacsGeom;
    throw new Error('unexpected ' + url);
  }, warn: w => warns.push(w) });
  assert.equal(asked.filter(u => u.includes('/MapServer/5/')).length, 2); assert.deepEqual(warns, []);   // asked again without idp_filedate
  assert.ok(list.every(s => Number.isFinite(s.lat) && Number.isFinite(s.lon)));
  const w2 = [];
  await loadCyclones({ json: async url => (url.startsWith('https://eonet') ? eonetDoc : url.includes('/MapServer/6/') ? { error: { code: 500 } } : { features: [] }), warn: w => w2.push(w) });
  assert.deepEqual(w2, ['NHC forecast layer 6']);   // an ArcGIS error is said, not drawn as "no storms"
  const lone = [{ properties: { idp_source: 'wp302026-001_5day_pts', stormname: 'Koguma', tau: 12 }, geometry: { type: 'Point', coordinates: [140, 25] } }];
  const asked2 = [];
  await loadCyclones({ json: async url => {
    asked2.push(url);
    if (url.startsWith('https://eonet')) return { events: [] };
    if (url.includes('/MapServer/5/')) return { features: lone };
    if (url.includes('/MapServer/')) return { features: [] };
    if (url.includes('geteventlist')) return { features: [{ properties: { iscurrent: 'true', eventid: 9, episodeid: 1, eventname: 'KOGUMA-26' }, geometry: { type: 'Point', coordinates: [140, 25] } }] };
    if (url.includes('getgeometry')) return gdacsGeom;
    throw new Error('unexpected ' + url);
  } });
  assert.equal(asked2.filter(u => u.includes('getgeometry')).length, 1);   // NOAA placed nothing for Koguma, so GDACS's forecast is fetched
});

test('cyclones: a NOAA forecast report carries the advisory time, so its provenance has an age', () => {
  const fc = nhcForecasts({ points: [{ properties: { idp_source: 'al052026-012_5day_pts', stormname: 'Hurricane Erin', tau: 0, maxwind: 105, fldatelbl: '2026-10-16 9:00 PM Fri CST' }, geometry: { type: 'Point', coordinates: [-61.2, 21.6] } }] });
  const [erin] = mergeNoaa([], [...fc.values()]);
  assert.equal(erin.reports[0].t, Date.UTC(2026, 9, 17, 3, 0)); assert.equal(erin.lat, 21.6);
  const { reports, agreeing } = stormAgreement(erin);
  assert.equal(recordOf(stampReports(erin, 'storms', reports, agreeing), Date.UTC(2026, 9, 17, 4, 0)).confidence, 'reported');   // was 'unknown'
});

test('GDACS alerts: one per event, explicit UTC, green quakes out, paged', async () => {
  const f = (type, id, level, extra = {}) => ({ geometry: { type: 'Point', coordinates: [10, 20] }, properties: { eventtype: type, eventid: id, alertlevel: level, fromdate: '2026-10-01T00:00:00', ...extra } });
  const list = parseGdacsEvents([f('FL', 1, 'Orange'), f('FL', 1, 'Green'), f('EQ', 2, 'Green'), f('EQ', 3, 'Red', { fromdate: '2026-10-01T00:00:00+02:00' }), { geometry: { type: 'Polygon' } }]);
  assert.deepEqual(list.map(p => p.eventtype + p.eventid), ['FL1', 'EQ3']);
  assert.equal(list[0].fromdate, '2026-10-01T00:00:00Z'); assert.equal(list[1].fromdate, '2026-10-01T00:00:00+02:00');
  const [mod] = parseGdacsEvents([f('FL', 5, 'Orange', { datemodified: '2026-10-12T07:00:00' })]);
  assert.equal(mod.datemodified, '2026-10-12T07:00:00Z');   // the gdacs layer's data time: UTC, not the visitor's local time
  assert.equal(gdacsQuakes(parseGdacsEvents([f('EQ', 6, 'Red', { datemodified: '2026-10-12T07:00:00' })]))[0].dataAt, Date.UTC(2026, 9, 12, 7, 0));
  assert.equal(utc(undefined), undefined);
  const pages = [Array.from({ length: 100 }, (_, i) => f('VO', 100 + i, 'Green')), [f('DR', 999, 'Red')]];
  const urls = [];
  const all = await loadGdacsEvents(async url => { urls.push(url); return { features: pages[urls.length - 1] || [] }; }, { now: Date.UTC(2026, 9, 12) });
  assert.equal(all.length, 101); assert.equal(urls.length, 2); assert.match(urls[1], /pagenumber=2$/);
  assert.match(gdacsEventsUrl(1, Date.UTC(2026, 9, 12)), /fromDate=2026-09-28&toDate=2026-10-12/);
});

test('aurora: OVATION grid, spot reading, both pictures', () => {
  const d = { 'Forecast Time': '2026-10-12T10:00:00Z', coordinates: [[0, 65, 40], [359, 65, 10], [180, -70, 90], [20, 95, 50], ['x', 0, 1]] };
  const o = parseOvation(d);
  assert.equal(o.at, '2026-10-12T10:00:00Z'); assert.equal(o.peak, 90); assert.equal(o.cells20, 2);
  assert.equal(ovationAt(o.grid, 65.2, 0.4), 40); assert.equal(ovationAt(o.grid, 65, -1), 10); assert.equal(ovationAt(o.grid, -70, -180), 90);
  assert.equal(parseOvation({ coordinates: [[-10, 0, 5]] }).grid[90 * 360 + 350], 5);   // -180..180 longitudes too
  const eq = paintEquirect(o.grid);
  assert.equal(eq.length, 360 * 181 * 4);
  const at = (lat, lon) => ((90 - lat) * 360 + (lon + 180)) * 4;   // top row 90°N, left column 180°W
  assert.deepEqual([...eq.slice(at(65, 0), at(65, 0) + 4)], [...auroraColor(40), 200]);
  assert.equal(eq[at(65, 1) + 3], 0);
  const merc = paintMercator(o.grid, 360, 360);
  assert.ok(merc.some((v, i) => i % 4 === 3 && v > 0));
  assert.deepEqual(auroraColor(3), [60, 255, 160]); assert.deepEqual(auroraColor(100), [255, 80, 200]);
  assert.deepEqual(latestKp([['time_tag', 'Kp'], ['2026-10-12 00:00', '2.33'], ['2026-10-12 03:00', '5.0']]), { t: '2026-10-12 03:00', kp: 5 });
  assert.deepEqual(latestKp([{ time_tag: 't', Kp: 3.67 }]), { t: 't', kp: 3.67 });
  assert.equal(latestKp({}), null);
});

test('cables: landings and the click test', () => {
  assert.deepEqual(parseLandings({ features: [{ geometry: { coordinates: [1, 2] }, properties: { id: 'x', name: 'Y' } }, { geometry: null }] }), [{ id: 'x', name: 'Y', lat: 2, lon: 1 }]);
  const fc = [{ id: 'a', geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] } }, { id: 'b', geometry: { type: 'MultiLineString', coordinates: [[[0, 1], [10, 1]]] } },
    { id: 'c', geometry: { type: 'LineString', coordinates: [[179.9, 30], [-179.9, 30]] } }];
  assert.equal(nearestCable(fc, 0.1, 5, 20000).id, 'a');
  assert.equal(nearestCable(fc, 0.9, 5, 20000).id, 'b');
  assert.equal(nearestCable(fc, 0.5, 5, 20000), null);
  assert.equal(nearestCable(fc, 30.05, -179.95, 20000).id, 'c');   // across the antimeridian
  assert.equal(okColor('#12ab'), '#12ab'); assert.equal(okColor('red;x'), null);
});

test('passes: ecfAt wraps a satellite.js record, nextPass finds the first pass', async () => {
  const { ecfAt, nextPass } = await import('../src/core/passes.js'), { observer } = await import('../src/core/observer.js');
  // a fake satellite.js: a point 500 km up crossing the observer's meridian from south to north over 20 minutes
  const sl = { propagate: (rec, d) => { const t = (d.getTime() - rec.t0) / 60e3; if (t > 1000) return { position: false }; return { position: { x: 0, lat: -20 + t * 2, h: 500 } }; },
    gstime: () => 0, eciToEcf: (p) => { const o = observer(p.lat, 10, p.h); return o.pos; } };
  const t0 = Date.UTC(2026, 9, 12), at = ecfAt(sl, { t0 });
  assert.ok(at(t0).x > 0); assert.equal(at(t0 + 2000 * 60e3), null);
  const p = nextPass(at, observer(0, 10), t0, { minEl: 10, step: 20e3 });
  assert.ok(p && p.maxEl > 85, JSON.stringify(p));
  assert.ok(Math.abs(p.peak - (t0 + 10 * 60e3)) < 20e3);   // overhead at minute 10 (latitude 0)
  assert.equal(nextPass(at, observer(60, 100), t0), null);
});
