// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportRow, exportRows, toGeoJSON, toCSV, toKML, csvCell, exportFile, EXPORT_FORMATS } from '../src/core/export.js';
import { stamp, rep } from '../src/core/liveprov.js';

const now = Date.parse('2026-10-14T12:00:00Z');
const quake = () => stamp({ kind: 'quake', id: 'us7000', mag: 5.2, place: 'Off "Coast", <Japan>', lat: 35.123456789, lon: 140.5, time: now - 600e3, track: [1, 2], fn() {} },
  'quakes', [rep('usgs', { dataAt: now - 60e3 })]);

test('a row: plain fields, position, the provenance columns', () => {
  const r = exportRow(quake(), { now });
  assert.equal(r.id, 'us7000'); assert.equal(r.name, 'Off "Coast", <Japan>'); assert.equal(r.lat, 35.123457);
  assert.equal(r.mag, 5.2); assert.ok(!('track' in r) && !('fn' in r) && !('prov' in r) && !('kind' in r));
  assert.equal(r.provenance, 'USGS · data 60 s old · reported'); assert.equal(r.confidence, 'reported');
  assert.equal(r.data_time, '2026-10-14T11:59:00.000Z'); assert.equal(r.data_age_s, 60); assert.equal(r.sources, 'USGS');
  const un = exportRow({ hex: 'abc', lat: 1, lon: 2, cur: { lat: 3, lon: 4 } }, { now });
  assert.equal(un.confidence, 'unknown'); assert.equal(un.lat, 3); assert.equal(un.id, 'abc');
  assert.equal(exportRows([{ id: 'x' }, quake()], { now }).length, 1);   // no position, no row
});

test('GeoJSON: a FeatureCollection of points with the provenance in the properties', () => {
  const g = JSON.parse(toGeoJSON(exportRows([quake()], { now }), { layer: 'quakes', now }));
  assert.equal(g.type, 'FeatureCollection'); assert.equal(g.metadata.layer, 'quakes');
  assert.deepEqual(g.features[0].geometry, { type: 'Point', coordinates: [140.5, 35.123457] });
  assert.equal(g.features[0].properties.confidence, 'reported');
});

test('CSV: quoted where needed, formulas defused, numbers left alone', () => {
  assert.equal(csvCell('a,b'), '"a,b"'); assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`); assert.equal(csvCell('-5'), "'-5"); assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(null), ''); assert.equal(csvCell('two\nlines'), '"two\nlines"');
  const lines = toCSV(exportRows([quake()], { now })).split('\r\n');
  assert.match(lines[0], /^id,name,lat,lon,mag,place,time,provenance,confidence,sources,agree,of,data_time,data_age_s$/);
  assert.match(lines[1], /^us7000,"Off ""Coast"", <Japan>",35\.123457,140\.5,5\.2,/);
});

test('KML: escaped, one Placemark each, lon,lat order', () => {
  const k = toKML(exportRows([quake()], { now }), { layer: 'Quakes & more' });
  assert.match(k, /<name>Quakes &amp; more<\/name>/);
  assert.match(k, /<name>Off &quot;Coast&quot;, &lt;Japan&gt;<\/name>/);
  assert.ok(!k.includes('<Japan>'));
  assert.match(k, /<coordinates>140\.5,35\.123457<\/coordinates>/);
  assert.match(k, /<description>USGS · data 60 s old · reported<\/description>/);
});

test('exportFile names the file and refuses unknown formats', () => {
  for (const f of Object.keys(EXPORT_FORMATS)) {
    const out = exportFile(f, [quake()], { layer: 'Earth quakes!', now });
    assert.equal(out.name, `open-overwatch-earth-quakes-20261014-1200.${EXPORT_FORMATS[f].ext}`); assert.equal(out.count, 1); assert.ok(out.text.length > 50);
  }
  assert.throws(() => exportFile('xls', []));
});
