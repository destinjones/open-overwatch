// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Draw and measure (src/core/measure.js): WGS84 distances, bearings and areas against GeographicLib 2.1 (Karney's
// reference implementation, Python; run once by hand, values pasted below), the words for them, GeoJSON, voice commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inverse, direct, bisect, midpoint, pathLength, densify, groundProfile, polygonArea, multiPolygonArea, centre, selfCrossing, choosePair,
  lengthText, areaText, bearingText, lengthWords, areaWords, toGeoJSON, encodeDrawing, decodeDrawing, EARTH_AREA, AUTHALIC_R, MAX_POINTS } from '../src/core/measure.js';
import { parse } from '../src/core/voicecmd.js';

const dAz = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
// [lat1, lon1, lat2, lon2, s12 (m), azi1, azi2] from GeographicLib's Geodesic.WGS84.Inverse
const LINES = {
  'Paris to Berlin': [48.8566, 2.3522, 52.52, 13.405, 879699.31613, 58.240069285, 66.806786415],
  'JFK to Singapore Changi': [40.6413, -73.7781, 1.3644, 103.9915, 15346880.8065, 3.305999961, 177.487712387],
  'Flinders Peak to Buninyong (Vincenty 1975)': [-37.95103341666667, 144.42486788888888, -37.65282113888889, 143.92649552777777, 54972.27114, 306.868159203, 307.173630629],
  'across the date line': [-16.5, 179.8, -17.1, -179.6, 92193.72304, 136.159237527, 135.9858146],
  'one metre north in London': [51.5, -0.12, 51.500009, -0.12, 1.00132, 0, 0],
  'a quarter of the equator': [0, 0, 0, 90, 10018754.17139, 90, 90],
  // nearly opposite: Vincenty's iteration gives up here, the bisection takes over
  'nearly antipodal on the equator': [0.5, 0, -0.3, 179.6, 19970891.00073, 28.817568563, 151.183194456],
  'nearly antipodal at 30°': [30, 10, -29.8, -170.4, 19971729.80018, 30.474405797, 149.592836874],
};

test('distances and bearings match GeographicLib within a millimetre', () => {
  for (const [name, [a, b, c, d, s, z1, z2]] of Object.entries(LINES)) {
    const r = inverse(a, b, c, d);
    assert.ok(Math.abs(r.s - s) < 1e-3, `${name}: ${r.s} vs ${s}`);
    assert.ok(dAz(r.az1, z1) < 1e-6 && dAz(r.az2, z2) < 1e-6, `${name}: bearings ${r.az1}, ${r.az2}`);
  }
  assert.ok(inverse(...LINES['nearly antipodal on the equator'].slice(0, 4)).bisected, 'the near-antipodal pair goes to the bisection');
  assert.equal(inverse(10, 20, 10, 20).s, 0);
});

test('opposite points are half a meridian apart, whichever way round', () => {
  for (const [a, b, c, d] of [[0, 0, 0, 180], [45, 20, -45, -160], [90, 0, -90, 0], [-12.3, 33.3, 12.3, -146.7]]) assert.ok(Math.abs(inverse(a, b, c, d).s - 20003931.45863) < 1e-3, `${a},${b}`);
});

test('the bisection agrees with Vincenty wherever both work', () => {
  for (const [a, b, c, d, s] of Object.values(LINES)) assert.ok(Math.abs(bisect(a, c, ((d - b + 540) % 360) - 180).s - s) < 1e-3);
  for (let i = 0; i < 200; i++) {   // a deterministic spread of pairs
    const a = Math.asin(Math.sin(i * 1.7)) * 180 / Math.PI, b = ((i * 73.1) % 360) - 180, c = Math.asin(Math.cos(i * 2.3)) * 180 / Math.PI, d = ((i * 211.7) % 360) - 180;
    const v = inverse(a, b, c, d), w = bisect(a, c, ((d - b + 540) % 360) - 180);
    assert.ok(Math.abs(v.s - w.s) < 1e-3 && dAz(v.az1, w.az1) < 1e-6, `${a},${b} -> ${c},${d}`);
  }
});

test('direct lands where inverse says, and back', () => {
  const [a, b, c, d, s, z1] = LINES['Flinders Peak to Buninyong (Vincenty 1975)'];
  const p = direct(a, b, z1, s);
  assert.ok(Math.abs(p.lat - c) < 1e-8 && Math.abs(p.lon - d) < 1e-8);
  const q = direct(52, 179.9, 80, 30000); assert.ok(q.lon < -179 && q.lon > -180, 'wraps across the date line: ' + q.lon);
  const m = midpoint([2.3522, 48.8566], [13.405, 52.52]), h = inverse(48.8566, 2.3522, m[1], m[0]).s;
  assert.ok(Math.abs(h - 879699.31613 / 2) < 1e-3);
  const pts = densify([0, 0], [10, 0], 100e3);
  assert.equal(pts.length, 13); assert.ok(pts.every(([, lat]) => Math.abs(lat) < 1e-9), 'the equator stays on the equator');
});

test('a path: every leg and the total', () => {
  const r = pathLength([[2.3522, 48.8566], [13.405, 52.52], [2.3522, 48.8566]]);
  assert.equal(r.legs.length, 2); assert.ok(Math.abs(r.total - 2 * 879699.31613) < 2e-3);
  assert.ok(dAz(r.legs[1].az1, LINES['Paris to Berlin'][6] + 180) < 1e-6, 'the way back leaves on the reverse of the arrival heading');
  assert.deepEqual(pathLength([[1, 1]]), { legs: [], total: 0 });
});

test('over the ground: length with the hills, climbing and descending', () => {
  const a = groundProfile(1000, [0, 100]);
  assert.ok(Math.abs(a.length - Math.hypot(1000, 100)) < 1e-9); assert.equal(a.up, 100); assert.equal(a.down, 0);
  const b = groundProfile(200, [0, 50, 0]);
  assert.ok(Math.abs(b.length - 2 * Math.hypot(100, 50)) < 1e-9); assert.equal(b.up, 50); assert.equal(b.down, 50);
  assert.deepEqual(groundProfile(500, [7]), { length: 500, up: 0, down: 0 });
});

test('the Earth: authalic radius and area', () => {
  assert.ok(Math.abs(AUTHALIC_R - 6371007.1809) < 1e-3);
  assert.ok(Math.abs(EARTH_AREA / 1e6 - 510065621.724) < 1e-3);
  assert.equal(MAX_POINTS, 512);
});

// [ring of [lon, lat], perimeter (m), area (m²)] from GeographicLib's PolygonArea (signed: counter-clockwise positive)
const AREAS = {
  'an octant (an eighth of the Earth)': [[[0, 0], [90, 0], [0, 90]], 30022685.63, 63758202715511.05],
  'a 1 km square in Oslo': [[[10.75, 59.91], [10.767969, 59.91], [10.767969, 59.918983], [10.75, 59.918983]], 4012.1201, 1006064.28],
  'roughly Texas': [[[-106.6, 31.9], [-103.0, 29.0], [-97.4, 25.9], [-93.8, 29.7], [-94.0, 33.6], [-100.0, 34.6], [-100.0, 36.5], [-103.0, 36.5], [-103.0, 32.0]], 3990661.0846, 758390360104.89],
  'round the north pole': [[[0, 80], [120, 80], [240, 80]], 5795767.8068, 1634782820860.69],
  'round the south pole, clockwise': [[[0, -70], [-90, -70], [180, -70], [90, -70]], 12500710.7277, 10175187229321.72],
  'a Pacific triangle': [[[150, -30], [-120, -40], [-160, 40]], 26997946.2266, 46345895800898.54],
  'a square on the date line': [[[179.5, -16], [-179.5, -16], [-179.5, -17], [179.5, -17]], 434847.848, -11815019730.27],
  'a 1,650 m² sliver': [[[-147.72130604893502, -49.2617740921193], [-147.72485102770642, -49.26131746703197], [-147.72572628130345, -49.26108960486907]], 662.1682, -1651.55],
  'a ring that leaves the smaller part outside': [[[0, -10], [120, -10], [240, -10]], 39092082.8341, -183887675016593.8],
};

test('areas match GeographicLib within 0.001%, perimeters within a millimetre', () => {
  for (const [name, [ring, per, area]] of Object.entries(AREAS)) {
    const r = polygonArea(ring);
    assert.ok(Math.abs(r.area - Math.abs(area)) <= Math.max(1e-5 * Math.abs(area), 0.01), `${name}: ${r.area} vs ${area}`);
    assert.ok(Math.abs(r.perimeter - per) < 1e-3, `${name}: perimeter ${r.perimeter} vs ${per}`);
  }
  assert.equal(polygonArea(AREAS['an octant (an eighth of the Earth)'][0]).area.toFixed(0), (EARTH_AREA / 8).toFixed(0));
});

test('areas: either direction, closed or open, too few points', () => {
  const ring = AREAS['roughly Texas'][0], a = polygonArea(ring).area;
  assert.ok(Math.abs(polygonArea([...ring].reverse()).area - a) < 1e-3 * 1e6);
  assert.ok(Math.abs(polygonArea([...ring, ring[0]]).area - a) < 1);
  assert.deepEqual(polygonArea([[0, 0], [1, 1]]), { area: 0, perimeter: 0 });
});

test('country areas from the bundled borders, against GeographicLib on the same outlines', () => {
  const borders = JSON.parse(readFileSync(new URL('../data/borders.json', import.meta.url), 'utf8'));
  const GL = { FR: 634542182225, US: 9567641826692, RU: 16962516378659, IT: 301191959979, FJ: 17837088062, SG: 354408748 };   // m²
  for (const [iso, area] of Object.entries(GL)) {
    const b = borders.find(x => x.iso === iso), r = multiPolygonArea(b.poly);
    assert.ok(Math.abs(r.area - area) / area < 1e-5, `${iso}: ${r.area} vs ${area}`);
  }
  assert.equal(multiPolygonArea([[[[0, 0], [1, 0], [1, 1], [0, 1]], [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]]]).parts, 1);
  const holed = multiPolygonArea([[[[0, 0], [1, 0], [1, 1], [0, 1]], [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]]]).area;
  const full = polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]]).area, hole = polygonArea([[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]).area;
  assert.ok(Math.abs(holed - (full - hole)) < 1, 'holes are taken out');
});

test('a ring that crosses itself is caught (also across the date line)', () => {
  assert.equal(selfCrossing([[0, 0], [1, 1], [1, 0], [0, 1]]), 0);   // a bow tie
  assert.equal(selfCrossing([[0, 0], [1, 0], [1, 1], [0, 1]]), -1);
  assert.equal(selfCrossing([[179.5, 0], [-179.5, 1], [-179.5, 0], [179.5, 1]]), 0);
  assert.equal(selfCrossing([[179.5, 0], [-179.5, 0], [-179.5, 1], [179.5, 1]]), -1);
  assert.equal(selfCrossing([[0, 80], [120, 80], [240, 80], [300, 80]]), -1, 'round a pole: not judged');
});

test('the middle of some points', () => {
  const [lon, lat] = centre([[179, 10], [-179, 10], [-179, 12], [179, 12]]);
  assert.ok(Math.abs(Math.abs(lon) - 180) < 1e-9 && Math.abs(lat - 11) < 0.01);
});

test('"from A to B": the two best matches, unless one of them is much nearer another candidate', () => {
  const paris = { name: 'Paris', lat: 48.86, lon: 2.35 }, parisME = { name: 'Paris, Maine', lat: 44.26, lon: -70.5 };
  const berlin = { name: 'Berlin', lat: 52.52, lon: 13.4 }, berlinNH = { name: 'Berlin, New Hampshire', lat: 44.47, lon: -71.19 };
  assert.deepEqual(choosePair([paris, parisME], [berlin, berlinNH]), [paris, berlin]);
  const bigBenQld = { name: 'Big Ben (Queensland)', lat: -17.1, lon: 145.8 }, bigBen = { name: 'Big Ben', lat: 51.5007, lon: -0.1246 }, tower = { name: 'Tower of London', lat: 51.5081, lon: -0.0759 };
  assert.deepEqual(choosePair([bigBenQld, bigBen], [tower]), [bigBen, tower]);
  assert.equal(choosePair([], [tower]), null);
});

test('lengths, areas and bearings in words', () => {
  assert.equal(lengthText(3.42), '3.4 m'); assert.equal(lengthText(820.4), '820 m'); assert.equal(lengthText(54972.27), '54.97 km');
  assert.equal(lengthText(879699.3), '879.7 km'); assert.equal(lengthText(15346880), '15,347 km');
  assert.equal(lengthText(820, true), '0.51 mi'); assert.equal(lengthText(150, true), '492 ft'); assert.equal(lengthText(54972.27, true), '34.16 mi'); assert.equal(lengthText(15346880, true), '9,536 mi');
  assert.equal(areaText(8400), '8,400 m²'); assert.equal(areaText(1006064), '1.01 km²'); assert.equal(areaText(634542182225), '634,542 km²');
  assert.equal(areaText(12545, true), '3.10 acres'); assert.equal(areaText(634542182225, true), '244,998 mi²');
  assert.equal(bearingText(58.24), '58° ENE'); assert.equal(bearingText(359.8), '0° N'); assert.equal(bearingText(-90), '270° W');
  assert.equal(lengthWords(879699), '880 kilometres'); assert.equal(lengthWords(1234), '1.2 kilometres'); assert.equal(lengthWords(1000), '1 kilometre'); assert.equal(lengthWords(820), '820 metres');
  assert.equal(lengthWords(879699, true), '547 miles'); assert.equal(lengthWords(150, true), '492 feet');
  assert.equal(areaWords(634542182225), '634,542 square kilometres'); assert.equal(areaWords(840000), '84 hectares'); assert.equal(areaWords(634542182225, true), '244,998 square miles');
});

test('the drawing as GeoJSON', () => {
  const g = toGeoJSON([
    { kind: 'pin', name: 'Pin 1', coords: [[2.29448, 48.85837]] },
    { kind: 'line', name: 'Line 1', coords: [[2.3522, 48.8566], [13.405, 52.52]] },
    { kind: 'area', name: 'Area 1', coords: AREAS['a 1 km square in Oslo'][0] },
    { kind: 'arrow', name: 'Paris to Berlin', coords: [[2.3522, 48.8566], [13.405, 52.52]], road: { coords: [[2.3522, 48.8566], [8, 50], [13.405, 52.52]], distance: 1054000.4, duration: 34800.6 } },
  ]);
  assert.equal(g.type, 'FeatureCollection'); assert.equal(g.features.length, 5);
  assert.deepEqual(g.features[0].geometry, { type: 'Point', coordinates: [2.29448, 48.85837] });
  assert.ok(Math.abs(g.features[1].properties.length_m - 879699.3) < 0.1);
  const ring = g.features[2].geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'polygons close'); assert.ok(Math.abs(g.features[2].properties.area_m2 - 1006064.28) < 1);
  assert.deepEqual(g.features[4].properties, { kind: 'road', name: 'Paris to Berlin by road', length_m: 1054000, duration_s: 34801 });
});

test('voice: measure, outline, draw, pins, undo, clear', () => {
  assert.deepEqual(parse('Measure from Paris to Berlin'), { act: 'measure', from: 'paris', to: 'berlin', road: false });
  assert.deepEqual(parse('how far is it from London to Paris by car'), { act: 'measure', from: 'london', to: 'paris', road: true });
  assert.deepEqual(parse("what's the driving distance from Austin to Dallas"), { act: 'measure', from: 'austin', to: 'dallas', road: true });
  assert.deepEqual(parse('distance between Tokyo and Osaka'), { act: 'measure', from: 'tokyo', to: 'osaka', road: false });
  assert.deepEqual(parse('How far is Paris from Berlin?'), { act: 'measure', from: 'berlin', to: 'paris', road: false });
  assert.deepEqual(parse('how far away is the Moon'), { act: 'measure', to: 'moon', road: false });
  assert.deepEqual(parse('draw a line from Paris to Rome'), { act: 'measure', from: 'paris', to: 'rome', road: false });
  assert.deepEqual(parse('measure Madrid to Lisbon'), { act: 'measure', from: 'madrid', to: 'lisbon', road: false });
  assert.deepEqual(parse('outline France'), { act: 'outline', place: 'france' });
  assert.deepEqual(parse('show me the border of Japan'), { act: 'outline', place: 'japan' });
  assert.deepEqual(parse('How big is Brazil?'), { act: 'outline', place: 'brazil', area: true });
  assert.deepEqual(parse('measure an area'), { act: 'draw', mode: 'area' });
  assert.deepEqual(parse('draw a line'), { act: 'draw', mode: 'line' });
  assert.deepEqual(parse('measure a distance'), { act: 'draw', mode: 'arrow' });
  assert.deepEqual(parse('start drawing'), { act: 'draw', mode: 'line' });
  assert.deepEqual(parse('stop drawing'), { act: 'draw', on: false });
  assert.deepEqual(parse('drop a pin'), { act: 'pin' });
  assert.deepEqual(parse('drop a pin here'), { act: 'pin' });
  assert.deepEqual(parse('put a pin on the Eiffel Tower'), { act: 'pin', place: 'eiffel tower' });
  assert.deepEqual(parse('undo'), { act: 'undoDraw' });
  assert.deepEqual(parse('Clear the drawing'), { act: 'clearDraw' });
  assert.deepEqual(parse('erase all the lines'), { act: 'clearDraw' });
  assert.deepEqual(parse('how long is it'), { act: 'drawInfo' });
  // the commands that were there before still mean what they meant
  assert.deepEqual(parse('stop following'), { act: 'stop' });
  assert.deepEqual(parse('Draw the walking route from the Capitol to Zilker Park'), { act: 'route', from: 'capitol', to: 'zilker park', mode: 'walk' });
  assert.deepEqual(parse('hide the satellites'), { act: 'layer', name: 'satellites', on: false });
  assert.deepEqual(parse('show the bounding boxes'), { act: 'detect', on: true });
  assert.deepEqual(parse('reset'), { act: 'reset' });
});

// ---- the drawing in share links
const DRAWING = [
  { kind: 'pin', coords: [[2.294481, 48.858370]], name: 'Café de l’Homme, Paris ✓' },
  { kind: 'line', coords: [[-0.129, 51.508], [-0.1196, 51.5046], [-0.108, 51.5079], [-0.087, 51.5074]] },
  { kind: 'area', coords: [[-0.188, 51.511], [-0.1585, 51.513], [-0.1527, 51.5032], [-0.187, 51.5005]] },
  { kind: 'arrow', coords: [[2.3522, 48.8566], [13.405, 52.52]], name: 'Paris → Berlin', road: true },
  { kind: 'arrow', coords: [[179.95, -16.5], [-179.6, -17.1]] },
  { kind: 'outline', iso: 'FR' },
];

test('a drawing survives the link: every shape, its points to a millionth of a degree, names, the road flag', () => {
  const d = encodeDrawing(DRAWING);
  assert.deepEqual(decodeDrawing(d), DRAWING);
  assert.equal(new URLSearchParams({ d }).toString(), 'd=' + d, 'nothing in it is percent-encoded');
  assert.ok(d.length < 200, `${d.length} characters`);
  const p = decodeDrawing(encodeDrawing([{ kind: 'pin', coords: [[12.3456789, -45.6789012]] }]))[0].coords[0];
  assert.deepEqual(p, [12.345679, -45.678901]);
});

test('a full drawing still fits a link; past 512 points, shapes are left out', () => {
  const pts = Array.from({ length: 512 }, (_, i) => [((i * 137.508) % 360) - 180, ((i * 59.3) % 170) - 85]);   // far apart: the worst case
  const d = encodeDrawing([{ kind: 'line', coords: pts }]);
  assert.ok(d.length > 0 && d.length <= 9000, `${d.length} characters`);
  assert.equal(decodeDrawing(d)[0].coords.length, MAX_POINTS);
  const two = decodeDrawing(encodeDrawing([{ kind: 'line', coords: pts.slice(0, 511) }, { kind: 'arrow', coords: pts.slice(0, 2) }, { kind: 'pin', coords: [[1, 1]] }]));
  assert.deepEqual(two.map(s => s.kind), ['line', 'pin'], 'the arrow would be points 512-513');
  assert.equal(decodeDrawing(encodeDrawing([{ kind: 'pin', coords: [[1, 2]], name: 'x'.repeat(80) }]))[0].name.length, 60);
});

test('a link is not trusted: broken, oversized or hostile drawings are dropped, names cleaned', () => {
  for (const t of ['', '<script>', 'l', 'p', 'lA', 'x' + encodeDrawing([DRAWING[1]]).slice(1), 'oFRA', 'ofr', 'o12', 'a' + encodeDrawing([DRAWING[1]]).slice(1, 9),
    'p' + '_'.repeat(8) + 'A', 'pAB_', 'd%41', 'l'.repeat(9001)]) assert.deepEqual(decodeDrawing(t), [], t.slice(0, 20));
  assert.deepEqual(decodeDrawing(encodeDrawing([{ kind: 'pin', coords: [[1, 1], [2, 2]] }])), [], 'a pin is one point');
  assert.deepEqual(decodeDrawing(encodeDrawing([{ kind: 'area', coords: [[1, 1], [2, 2]] }])), [], 'an area has three corners or more');
  const far = encodeDrawing([{ kind: 'pin', coords: [[10, 80]] }]).replace(/^p/, 'p') + '.p' + encodeDrawing([{ kind: 'pin', coords: [[0, 95]] }]).slice(1);
  assert.equal(decodeDrawing(far).length, 1, 'latitude 95 is refused');
  const named = name => decodeDrawing(encodeDrawing([{ kind: 'pin', coords: [[1, 2]], name }]))[0].name;
  assert.equal(named('Big\u0007 Ben‮'), 'Big Ben'); assert.equal(named('   '), undefined); assert.equal(named('<b>Tower</b>'), '<b>Tower</b>', 'kept as text: the card escapes it');
  const bad = encodeDrawing([{ kind: 'pin', coords: [[1, 2]] }]) + '*_w';   // byte 0xFF: not UTF-8
  assert.deepEqual(decodeDrawing(bad), [{ kind: 'pin', coords: [[1, 2]] }], 'an unreadable name is dropped, the pin kept');
  assert.deepEqual(decodeDrawing('oFR.oFR.oJP').map(s => s.iso), ['FR', 'JP']);
  assert.deepEqual(decodeDrawing('pAA.l<b>.p%41.oJP').map(s => s.kind), ['pin', 'outline'], 'a mangled part costs only itself');
  assert.equal(encodeDrawing([{ kind: 'outline', iso: 'fr' }, { kind: 'weird', coords: [[1, 1]] }, null].filter(Boolean)), '');
});
