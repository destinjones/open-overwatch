// Regressions from the 2026-10-11 core review: accented place names, hour rollover, int64 tags, cut-off tiles, poles,
// numeric fire times, GDACS over New Year, the ascent slider below zero, wind with no direction, boxes over the dateline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, normalize, weatherSentence } from '../src/core/voicecmd.js';
import { durationText } from '../src/core/route.js';
import { Pbf, geometry, tileAt } from '../src/core/mvt.js';
import { parseFires, gdacsForecast } from '../src/core/hazards.js';
import { eventAt } from '../src/core/ascent.js';
import { toMgrs, toUtm } from '../src/core/mgrs.js';
import { inArea } from '../src/core/transit.js';

test('voice: accents are dropped, not the letters; "in the air" and "above me" are not places', () => {
  assert.equal(normalize('go to Zürich'), 'go to zurich');
  assert.deepEqual(parse('fly to Malmö'), { act: 'go', place: 'malmo' });
  assert.equal(parse('take me to São Paulo').place, 'sao paulo');
  assert.deepEqual(parse('how many planes are in the air'), { act: 'count', what: 'air' });
  assert.deepEqual(parse('how many satellites are above me'), { act: 'count', what: 'sat' });
  assert.equal(parse('how many planes over Texas').place, 'texas');
  assert.equal(weatherSentence({ temp: 10, speed: 5 }), '10 degrees Celsius, wind 18 kilometres an hour');
  assert.match(weatherSentence({ temp: 10, speed: 5, from: 225 }), /from the south-west$/);
});

test('route: durations round to whole minutes before the hour split', () => {
  assert.equal(durationText(3570), '1 h 00 min');
  assert.equal(durationText(7199), '2 h 00 min');
  assert.equal(durationText(86399), '24 h 00 min');
  assert.equal(durationText(3540), '59 min');
  assert.equal(durationText(3900), '1 h 05 min');
});

test('mvt: a negative int64 tag, a LineTo before any MoveTo, a cut-off geometry, tiles at the poles and the dateline', () => {
  assert.equal(new Pbf(Uint8Array.from([0xfb, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01])).int64(), -5);
  assert.equal(new Pbf(Uint8Array.from([0x2a])).int64(), 42);
  assert.deepEqual(geometry([(1 << 3) | 2, 2, 2]), []);                       // LineTo first: skipped
  assert.deepEqual(geometry([(1 << 3) | 1, 2, 2, (2 << 3) | 2, 4]), [[1, 1]]);   // the second LineTo point is missing: no throw
  assert.deepEqual(tileAt(90, 0, 3), { z: 3, x: 4, y: 0 });
  assert.deepEqual(tileAt(-90, 180, 3), { z: 3, x: 0, y: 7 });   // 180 wraps to -180: the first column, never one past the last
  assert.deepEqual(tileAt(0, 179.99, 3), { z: 3, x: 7, y: 4 });
  assert.deepEqual(tileAt(0, -180, 2), { z: 2, x: 0, y: 2 });
  assert.throws(() => new Pbf(Uint8Array.from([1, 2])).f32(), /cut off/);
});

test('fires: a numeric acquisition time keeps the detection', () => {
  const l = { l: { features: [{ props: { ACQ_DATE: '2026-10-10', ACQ_TIME: 312, LATITUDE: 1, LONGITUDE: 2, UID: 'u', SATELLITE: 'N' } }, { props: { ACQ_DATE: '2026-10-10', ACQ_TIME: '0312', LATITUDE: 1, LONGITUDE: 2, UID: 'v', SATELLITE: 'N' } }] } };
  const out = parseFires(l);
  assert.equal(out.length, 2); assert.equal(out[0].t, out[1].t); assert.equal(out[0].t, Date.UTC(2026, 9, 10, 3, 12));
});

test('GDACS: a forecast label past New Year lands in the new year', () => {
  const feat = (properties, geometry) => ({ type: 'Feature', properties, geometry }), box = (lon, lat) => ({ type: 'Polygon', coordinates: [[[lon - .1, lat - .1], [lon + .1, lat - .1], [lon + .1, lat + .1], [lon - .1, lat + .1], [lon - .1, lat - .1]]] });
  const g = gdacsForecast({ features: [
    feat({ Class: 'Point_Centroid', eventid: 1, eventname: 'X-26', source: 'JTWC' }, { type: 'Point', coordinates: [140, 25] }),
    feat({ Class: 'Poly_Cones', polygondate: '2026-12-31T18:00:00' }, box(140, 25)),
    feat({ Class: 'Point_Polygon_Point_1', polygonlabel: '01/01 06:00 UTC' }, box(141, 28)),
    feat({ Class: 'Point_Polygon_Point_0', polygonlabel: '31/12 12:00 UTC' }, box(138, 20)),
  ] });
  assert.deepEqual(g.points.map(p => [p.t, p.forecast]), [[Date.UTC(2026, 11, 31, 12), false], [Date.UTC(2027, 0, 1, 6), true]]);
});

test('ascent: the event before lift-off, and a slider value that is not a number', () => {
  assert.equal(eventAt(-1), eventAt(0)); assert.equal(eventAt(NaN), eventAt(0)); assert.equal(typeof eventAt(-1), 'string');
});

test('MGRS: 84°N is in band X; zero digits is the 100 km square', () => {
  assert.equal(toUtm(84, 10).band, 'X'); assert.equal(toUtm(84.0001, 10), null);
  assert.equal(toMgrs(38.8977, -77.0365, 0), '18S UJ');
  assert.equal(toMgrs(38.8977, -77.0365, 5), '18S UJ 23394 07395');
});

test('transit: an area box over the antimeridian', () => {
  assert.equal(inArea({ box: [-10, 170, 10, -170] }, 0, 179), true);
  assert.equal(inArea({ box: [-10, 170, 10, -170] }, 0, -175), true);
  assert.equal(inArea({ box: [-10, 170, 10, -170] }, 0, 0), false);
  assert.equal(inArea({ box: [50, -1, 52, 1] }, 51, 0), true);
});
