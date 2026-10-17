// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stormKey, nhcForecasts, gdacsForecast, firePerimeters, fireTileDeg, fireTilesFor, parseFires, csvLine, parseCmrCsv, imageryDates, pickPair, gibsTemplate, WW, retryBackoff } from '../src/core/hazards.js';
import { pruneKept, gdacsKey, loadCyclones } from '../src/core/cyclones.js';

const feat = (properties, geometry) => ({ type: 'Feature', properties, geometry });
const pt = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] });
const line = (...c) => ({ type: 'LineString', coordinates: c });
const poly = (...c) => ({ type: 'Polygon', coordinates: [c] });

test('NHC advisory ids: storm and advisory, with or without a letter', () => {
  assert.deepEqual(stormKey('ep202026-014_5day_pts'), { id: 'ep202026', adv: '014' });
  assert.deepEqual(stormKey('ep182026-055A_5day_pgn'), { id: 'ep182026', adv: '055A' });
  assert.equal(stormKey('EP182026_lin'), null);
  assert.equal(WW.HWR[0], 'Hurricane warning');
});

test('NHC forecasts: points, track, cone, warnings, wind field and past track, joined per storm', () => {
  const s = nhcForecasts({
    points: [feat({ idp_source: 'ep202026-014_5day_pts', stormname: 'Hurricane Simon', tcdvlp: 'Major Hurricane', tau: 12, maxwind: 125, gust: 150, mslp: 9999, datelbl: '12:00 AM Sun' }, pt(-105, 18.4)),
      feat({ idp_source: 'ep202026-014_5day_pts', stormname: 'Hurricane Simon', tau: 0, maxwind: 130, gust: 160, mslp: 932, datelbl: '3:00 PM Sat' }, pt(-105, 18))],
    tracks: [feat({ idp_source: 'ep202026-014_5day_lin' }, line([-105, 18], [-105, 18.4], [-106, 20]))],
    cones: [feat({ idp_source: 'ep202026-014_5day_pgn', stormname: 'Simon' }, poly([-105, 17.5], [-104, 18], [-106, 21], [-105, 17.5]))],
    warnings: [feat({ idp_source: 'ep202026-014_ww_wwlin', tcww: 'HWR' }, line([-105.5, 19], [-105.2, 19.6])), feat({ idp_source: 'ep202026-014_ww_wwlin', tcww: 'XXX' }, line([0, 0], [1, 1]))],
    winds: [feat({ stormid: 'ep202026', radii: 34, tau: 0 }, poly([-106, 17], [-104, 17], [-105, 19], [-106, 17])), feat({ stormid: 'ep202026', radii: 34, tau: 12 }, poly([0, 0], [1, 0], [1, 1], [0, 0]))],
    past: [feat({ idp_source: 'EP202026_lin', stormtype: 'HU' }, line([-100, 14], [-103, 16]))],
  });
  const simon = s.get('ep202026');
  assert.equal(simon.name, 'Hurricane Simon'); assert.equal(simon.kind, 'Major Hurricane'); assert.equal(simon.basin, 'EP');
  assert.equal(simon.coherent, true); assert.equal(simon.advisory, '014');
  assert.deepEqual(simon.points.map(p => [p.tau, p.kt, p.mb]), [[0, 130, 932], [12, 125, null]]);   // in order; 9999 = no pressure
  assert.equal(simon.track[0].length, 3); assert.equal(simon.cone.length, 1);
  assert.deepEqual(simon.warnings.map(w => w.code), ['HWR']);                                          // unknown codes dropped
  assert.deepEqual(simon.winds.map(w => w.kt), [34]);                                                  // only the wind field now (tau 0)
  assert.equal(simon.past[0].kind, 'HU');
});

test('NHC forecasts mid-update: a cone from an older advisory than the points is not drawn with them', () => {
  const s = nhcForecasts({ points: [feat({ idp_source: 'al092026-015_5day_pts', tau: 0 }, pt(-60, 20))], tracks: [feat({ idp_source: 'al092026-015_5day_lin' }, line([-60, 20], [-61, 21]))],
    cones: [feat({ idp_source: 'al092026-014_5day_pgn' }, poly([-60, 19], [-59, 20], [-61, 22], [-60, 19]))] }).get('al092026');
  assert.equal(s.coherent, false); assert.equal(s.advisory, '015');
});

test('NHC forecasts: a point without geometry is left out, an empty cone ring is dropped, short rings and paths too', () => {
  const s = nhcForecasts({ points: [feat({ idp_source: 'al052026-012_5day_pts', stormname: 'Erin', tau: 0 }, null), feat({ idp_source: 'al052026-012_5day_pts', tau: 12 }, pt(-62, 22)),
    feat({ idp_source: 'al052026-012_5day_pts', tau: 24 }, pt('x', 23)), feat({ idp_source: 'al052026-012_5day_pts', tau: 36 }, pt(-64, 95))],
  cones: [feat({ idp_source: 'al052026-012_5day_pgn' }, { type: 'Polygon', coordinates: [[]] }), feat({ idp_source: 'al052026-012_5day_pgn' }, { type: 'MultiPolygon', coordinates: [[[]], [[[-61, 21], [-62, 22], [-61, 21]]]] })],
  tracks: [feat({ idp_source: 'al052026-012_5day_lin' }, line([-61, 21])), feat({ idp_source: 'al052026-012_5day_lin' }, { type: 'MultiLineString', coordinates: [[[-61, 21]], [[-61, 21], [-62, 22]]] })] }).get('al052026');
  assert.deepEqual(s.points.map(p => [p.tau, p.lat, p.lon]), [[12, 22, -62]]);   // no NaN, no latitude 95
  assert.deepEqual(s.cone, [[[-61, 21], [-62, 22], [-61, 21]]]); assert.deepEqual(s.track, [[[-61, 21], [-62, 22]]]);
  const empty = nhcForecasts({ cones: [feat({ idp_source: 'al062026-001_5day_pgn' }, { type: 'Polygon', coordinates: [[]] })] }).get('al062026');
  assert.equal(empty.cone.length, 0); assert.equal(empty.points.length, 0);
});

test('NHC forecasts: the advisory time, from the file date or the tau-0 label in a US zone', () => {
  const at = (props, more = {}) => nhcForecasts({ points: [feat({ idp_source: 'al052026-012_5day_pts', tau: 0, ...props }, pt(-61, 21)), feat({ idp_source: 'al052026-012_5day_pts', tau: 12, fldatelbl: '2026-10-17 9:00 AM Sat CDT', ...more }, pt(-62, 22))] }).get('al052026').advisoryAt;
  assert.equal(at({ fldatelbl: '2026-10-16 9:00 PM Fri CST' }), Date.UTC(2026, 9, 17, 3, 0));
  assert.equal(at({ fldatelbl: '2026-10-16 2100 UTC' }), Date.UTC(2026, 9, 16, 21, 0));
  assert.equal(at({ fldatelbl: '2026-10-16 12:00 AM Fri AST' }), Date.UTC(2026, 9, 16, 4, 0));
  assert.equal(at({ fldatelbl: '2026-10-16 9:00 PM Fri XYZ' }), null);   // an unknown zone, and a later point's label is its valid time, not the advisory's
  assert.equal(at({ fldatelbl: '3:00 PM Sat' }), null);
  assert.equal(at({ fldatelbl: '2026-10-16 9:00 PM Fri CST', idp_filedate: 1792216969000 }, { idp_filedate: 1792216969000 }), 1792216969000);
});

test('GDACS: a zoned polygondate still gives the advisory; none leaves past and forecast unknown', () => {
  const pts = [feat({ Class: 'Point_Polygon_Point_0', polygonlabel: '09/10 00:00 UTC' }, poly([138, 20], [138.2, 20], [138.2, 20.2], [138, 20])),
    feat({ Class: 'Point_Polygon_Point_1', polygonlabel: '11/10 06:00 UTC' }, poly([141, 28], [141.2, 28], [141.2, 28.2], [141, 28]))];
  for (const date of ['2026-10-10T06:00:00Z', '2026-10-10T06:00:00+00:00', '2026-10-10T06:00:00']) {
    const g = gdacsForecast({ features: [feat({ Class: 'Poly_Cones', polygondate: date }, poly([140, 25], [142, 26], [139, 30], [140, 25])), ...pts] });
    assert.equal(g.advisory, Date.UTC(2026, 9, 10, 6, 0), date); assert.deepEqual(g.points.map(p => p.forecast), [false, true], date);
  }
  const none = gdacsForecast({ features: pts });
  assert.ok(Number.isNaN(none.advisory)); assert.deepEqual(none.points.map(p => p.forecast), [undefined, undefined]);
});

test('GDACS: cone, past and forecast track by category, timed points', () => {
  const g = gdacsForecast({ features: [
    feat({ Class: 'Point_Centroid', eventid: 1001333, eventname: 'KOGUMA-26', source: 'JTWC' }, pt(140, 25)),
    feat({ Class: 'Poly_Cones', polygondate: '2026-10-10T18:00:00' }, poly([140, 25], [142, 26], [139, 30], [140, 25])),
    feat({ Class: 'Line_Line_0', polygonlabel: 'TS', forecast: false }, line([138, 20], [139, 23])),
    feat({ Class: 'Line_Line_1', polygonlabel: 'HU', forecast: true }, line([140, 25], [141, 28])),
    feat({ Class: 'Point_Polygon_Point_1', polygonlabel: '11/10 06:00 UTC' }, poly([140.9, 27.9], [141.1, 27.9], [141.1, 28.1], [140.9, 28.1], [140.9, 27.9])),
    feat({ Class: 'Point_Polygon_Point_0', polygonlabel: '05/10 00:00 UTC' }, poly([137.9, 19.9], [138.1, 19.9], [138.1, 20.1], [137.9, 20.1], [137.9, 19.9])),
  ] });
  assert.equal(g.id, 1001333); assert.equal(g.name, 'KOGUMA'); assert.equal(g.source, 'JTWC');
  assert.equal(g.cone.length, 1); assert.deepEqual(g.past.map(p => p.kind), ['TS']); assert.deepEqual(g.forecast.map(p => p.kind), ['HU']);
  assert.deepEqual(g.points.map(p => [p.label, p.forecast]), [['05/10 00:00 UTC', false], ['11/10 06:00 UTC', true]]);   // sorted by time
  assert.ok(Math.abs(g.points[0].lat - 20.02) < 0.05 && Math.abs(g.points[0].lon - 138.02) < 0.05);
  assert.equal(g.points[1].t, Date.UTC(2026, 9, 11, 6, 0));
});

test('NIFC perimeters: the fields a card needs', () => {
  const [f] = firePerimeters({ features: [feat({ poly_IncidentName: 'Willow', attr_IncidentSize: 7359, attr_PercentContained: 80, attr_POOState: 'US-CO', attr_FireCause: 'Human',
    attr_IncidentShortDescription: '6 Miles W from Leadville, CO', attr_UniqueFireIdentifier: '2026-COPSF-001153', attr_IncidentTypeCategory: 'WF', attr_FireDiscoveryDateTime: 1782682020000 },
    { type: 'MultiPolygon', coordinates: [[[[-106.4, 39.2], [-106.3, 39.2], [-106.3, 39.3], [-106.4, 39.2]]], [[[-106.5, 39.1], [-106.45, 39.1], [-106.45, 39.15], [-106.5, 39.1]]]] }),
    feat({ poly_IncidentName: 'Empty' }, null)] });
  assert.equal(f.name, 'Willow'); assert.equal(f.acres, 7359); assert.equal(f.contained, 80); assert.equal(f.state, 'CO'); assert.equal(f.rx, false); assert.equal(f.rings.length, 2);
});

test('fire tiles: GIBS geographic grid, and detections from the last day', () => {
  assert.equal(fireTileDeg(0), 288); assert.equal(fireTileDeg(3), 36);
  assert.deepEqual(fireTilesFor(32, 8, 34, 10, 3), [{ level: 3, row: 2, col: 5 }]);   // central Africa: the tile probed on 2026-10-09
  assert.equal(fireTilesFor(-110, 40, -100, 60, 3).length, 4);                    // a box across -108° and 54°N: two by two tiles
  assert.equal(fireTilesFor(-180, -90, 180, 90, 0).length, 2);                    // the whole world at level 0
  const layers = { fires: { features: [
    { props: { LATITUDE: 9.24, LONGITUDE: 32.97, FRP: 8.2, BRIGHT_TI4: 333.6, ACQ_DATE: '2026-10-09', ACQ_TIME: '11:19', SATELLITE: 'N20', CONFIDENCE: 'nominal', DAYNIGHT: 'D', UID: 1 } },
    { props: { LATITUDE: 9.3, LONGITUDE: 33.0, FRP: 40, ACQ_DATE: '2026-10-08', ACQ_TIME: '2310', SATELLITE: 'N21', CONFIDENCE: 'high', DAYNIGHT: 'N', UID: 2 } },
    { props: { LATITUDE: 9.4, LONGITUDE: 33.1, FRP: 3, ACQ_DATE: '2026-10-07', ACQ_TIME: '11:00', SATELLITE: 'N20', DAYNIGHT: 'D', UID: 3 } }] } };
  const f = parseFires(layers, Date.UTC(2026, 9, 8, 12));
  assert.deepEqual(f.map(x => [x.sat, x.t]), [['N20', Date.UTC(2026, 9, 9, 11, 19)], ['N21', Date.UTC(2026, 9, 8, 23, 10)]]);   // "2310" read as 23:10
  assert.equal(f[1].day, false); assert.equal(f[0].frp, 8.2);
});

test('recent imagery: CMR CSV, one entry per day and sensor, a sensible first pair', () => {
  assert.deepEqual(csvLine('a,"b,c ""q""",d'), ['a', 'b,c "q"', 'd']);
  const csv = ['Granule UR,Producer Granule ID,Start Time,End Time,Online Access URLs,Browse URLs,Cloud Cover,Day/Night,Size',
    'HLS.S30.T18TWL.2026281T155701.v2.0,x,2026-10-08T16:01:59.697Z,2026-10-08T16:01:59.697Z,"https://a/1.tif,https://a/2.tif",,10,DAY,1',
    'HLS.S30.T18TWK.2026281T155701.v2.0,x,2026-10-08T16:02:13.971Z,2026-10-08T16:02:13.971Z,"https://a/3.tif",,1,DAY,1',
    'HLS.L30.T18TWL.2026270T153000.v2.0,x,2026-09-27T15:30:00.000Z,2026-09-27T15:30:00.000Z,"",,45,DAY,1',
    'HLS.S30.T18TWL.2026250T155701.v2.0,x,2026-09-07T16:00:00.000Z,2026-09-07T16:00:00.000Z,"",,3,DAY,1',
    'NOT.HLS,x,2026-09-01T00:00:00Z,,,,0,DAY,1'].join('\n');
  const rows = parseCmrCsv(csv);
  assert.equal(rows.length, 4); assert.deepEqual(rows.map(r => r.sensor), ['S30', 'S30', 'L30', 'S30']);
  const dates = imageryDates(rows);
  assert.deepEqual(dates.map(d => [d.date, d.sensor, d.cloud]), [['2026-10-08', 'S30', 1], ['2026-09-27', 'L30', 45], ['2026-09-07', 'S30', 3]]);
  const pair = pickPair(dates);
  assert.equal(pair.after.date, '2026-10-08'); assert.equal(pair.before.date, '2026-09-07');   // the cloudy Landsat day is skipped
  assert.equal(pickPair(dates.slice(0, 1)), null);
  assert.match(gibsTemplate('S30', '2026-10-08'), /HLS_S30_Nadir_BRDF_Adjusted_Reflectance\/default\/2026-10-08\/GoogleMapsCompatible_Level12\/\{z\}\/\{y\}\/\{x\}\.png$/);
});

// ---- the hazard layers stay gentle and bounded: time travel's backoff, the GDACS cache, the fire worker's timeout ----

test('time travel backoff: a failed day waits 30 s, doubling to 5 min, and is held while asked', () => {
  const r = retryBackoff(), t0 = 1e6;
  assert.equal(r.claim('2026-10-01', t0), false);   // nothing failed: the caller asks for a new day itself
  assert.equal(r.failed('2026-10-01', t0), 30e3);
  assert.equal(r.claim('2026-10-01', t0 + 1000), false);   // the next second: not again
  assert.equal(r.claim('2026-10-01', t0 + 29e3), false);
  assert.equal(r.claim('2026-10-02', t0 + 31e3), false);   // another day is not this one's to retry
  assert.equal(r.claim('2026-10-01', t0 + 30e3), true);
  assert.equal(r.claim('2026-10-01', t0 + 31e3), false);   // held while the retry is out
  let t = t0 + 31e3;
  const waits = [];
  for (let i = 0; i < 6; i++) { waits.push(r.failed('2026-10-01', t)); t += waits[i]; assert.equal(r.claim('2026-10-01', t), true); }
  assert.deepEqual(waits, [60e3, 120e3, 240e3, 300e3, 300e3, 300e3]);
  r.ok(); assert.equal(r.key, null); assert.equal(r.claim('2026-10-01', t + 1e9), false);
  assert.equal(r.failed('2026-10-01', t), 30e3);   // a fresh failure starts again at 30 s
  // a failure every second for an hour asks the same day ~16 times, not 3,600
  const q = retryBackoff();
  let asked = 0;
  for (let s = 0; s < 3600; s++) { const now = s * 1000; if (s === 0 || q.claim('d', now)) { asked++; q.failed('d', now); } }
  assert.ok(asked <= 16, String(asked));
});

test('GDACS cache: current episodes stay, the rest go oldest first past the cap', () => {
  const kept = new Map(Array.from({ length: 30 }, (_, i) => ['e' + i + '/1', { i }]));
  pruneKept(kept, [{ eventid: 'e0', episodeid: 1 }, 'e1/1']);
  assert.equal(kept.size, 24); assert.ok(kept.has('e0/1') && kept.has('e1/1'));   // the oldest, but current
  assert.ok(!kept.has('e2/1') && !kept.has('e7/1') && kept.has('e8/1') && kept.has('e29/1'));
  const many = new Map(Array.from({ length: 30 }, (_, i) => ['c' + i + '/1', i]));
  pruneKept(many, [...many.keys()]); assert.equal(many.size, 30);   // never a current one
  assert.equal(gdacsKey({ eventid: 1001335, episodeid: 38 }), '1001335/38');
  const small = new Map([['a/1', 1]]); assert.equal(pruneKept(small), small); assert.equal(small.size, 1);
});

test('GDACS cache: a live load drops old episodes once the list answers, and keeps them when it does not', async () => {
  const list = { features: [{ properties: { iscurrent: 'true', eventid: 7, episodeid: 9, eventname: 'BUALOI-26', alertlevel: 'Green' }, geometry: { type: 'Point', coordinates: [130, 15] } }] };
  const json = async url => (url.startsWith('https://eonet') ? { events: [] } : url.includes('geteventlist') ? list : { features: [] });
  const kept = new Map(Array.from({ length: 40 }, (_, i) => ['old' + i + '/1', {}]));
  await loadCyclones({ json, kept });
  assert.equal(kept.size, 24); assert.ok(kept.has('7/9')); assert.ok(!kept.has('old0/1') && kept.has('old39/1'));
  const kept2 = new Map(Array.from({ length: 40 }, (_, i) => ['old' + i + '/1', {}]));
  await loadCyclones({ json: async url => { if (url.includes('geteventlist')) throw new Error('down'); return json(url); }, kept: kept2 });
  assert.equal(kept2.size, 40);   // no list, no judgement
});

test('fire worker: a stalled request or body read answers with an error after its timeout', async () => {
  const posted = [], had = { self: globalThis.self, fetch: globalThis.fetch }, g = /** @type {any} */ (globalThis);
  const stall = signal => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason)));
  const url = 'https://gibs.example/t.mvt', keep = setInterval(() => {}, 1000);   // AbortSignal.timeout's timer does not hold Node's event loop
  try {
    g.self = { postMessage: m => posted.push(m) };
    await import('../src/core/fires.worker.js');
    const run = data => g.self.onmessage({ data });
    g.fetch = (u, o) => stall(o.signal);   // the server never answers
    await run({ id: 1, url, since: 0, timeout: 30 });
    g.fetch = async (u, o) => ({ status: 200, ok: true, arrayBuffer: () => stall(o.signal) });   // headers, then nothing
    await run({ id: 2, url, since: 0, timeout: 30 });
    g.fetch = async () => { throw new TypeError('Failed to fetch'); };   // GIBS's 404 without CORS: no data that day yet
    await run({ id: 3, url, since: 0, timeout: 30 });
    g.fetch = async (u, o) => { assert.ok(o.signal instanceof AbortSignal); return { status: 404, ok: false }; };
    await run({ id: 4, url, since: 0 });
  } finally { g.self = had.self; g.fetch = had.fetch; clearInterval(keep); }
  assert.deepEqual(posted, [{ id: 1, error: 'timed out' }, { id: 2, error: 'timed out' }, { id: 3, fires: [], missing: true }, { id: 4, fires: [] }]);
});
