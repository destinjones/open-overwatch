import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTile, tileAt } from '../src/core/mvt.js';
import { ringArea2, openRing, polygons, clipRing, onEdge, outlineRuns, tilePoint, ringDegrees, areaM2, ringMid, inRing, inPolygon, labelPoint,
  tileWidth, tilesAround, pickZoom, tileBuildings, buildingTint, MAX_BUILDING_H, tileMilitary, joinPieces, describeArea, areaWords,
  cardinal, facings, tileCameras, cameraFacts, inBounds } from '../src/core/osmtiles.js';

// ---- a tiny Mapbox Vector Tile encoder (points, lines, polygons), to build test tiles ----
const varint = (n, out) => { while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128); } out.push(n); };
const key = (f, w, out) => varint(f * 8 + w, out);
const bytes = (f, arr, out) => { key(f, 2, out); varint(arr.length, out); for (const b of arr) out.push(b); };
const str = (f, s, out) => bytes(f, [...new TextEncoder().encode(s)], out);
const packed = (f, nums, out) => { const b = []; for (const n of nums) varint(n, b); bytes(f, b, out); };
const zz = n => (n << 1) ^ (n >> 31);
/** type 1: parts are single points; 2: lines; 3: rings (closed with ClosePath, the first point not repeated). */
function encode(type, parts) {
  const cmds = []; let cx = 0, cy = 0;
  if (type === 1) {
    cmds.push(1 | (parts.length << 3));
    for (const [x, y] of parts) { cmds.push(zz(x - cx), zz(y - cy)); cx = x; cy = y; }
    return cmds;
  }
  for (const pts of parts) {
    cmds.push(1 | (1 << 3), zz(pts[0][0] - cx), zz(pts[0][1] - cy)); [cx, cy] = pts[0];
    cmds.push(2 | ((pts.length - 1) << 3));
    for (const [x, y] of pts.slice(1)) { cmds.push(zz(x - cx), zz(y - cy)); cx = x; cy = y; }
    if (type === 3) cmds.push(7 | (1 << 3));
  }
  return cmds;
}
function layer(name, feats, extent = 4096) {
  const keys = [], vals = [], out = [];
  key(15, 0, out); varint(2, out); str(1, name, out);
  for (const f of feats) {
    const fb = [], tags = [];
    for (const [k, v] of Object.entries(f.props || {})) {
      let ki = keys.indexOf(k); if (ki < 0) ki = keys.push(k) - 1;
      let vi = vals.indexOf(v); if (vi < 0) vi = vals.push(v) - 1;
      tags.push(ki, vi);
    }
    packed(2, tags, fb); key(3, 0, fb); varint(f.type, fb); packed(4, encode(f.type, f.parts), fb);
    bytes(2, fb, out);
  }
  for (const k of keys) str(3, k, out);
  for (const v of vals) {
    const vb = [];
    if (typeof v === 'string') str(1, v, vb);
    else if (typeof v === 'boolean') { key(7, 0, vb); varint(v ? 1 : 0, vb); }
    else if (Number.isInteger(v) && v >= 0) { key(5, 0, vb); varint(v, vb); }
    else if (Number.isInteger(v)) { key(6, 0, vb); varint(-2 * v - 1, vb); }
    else { key(3, 1, vb); const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v, true); vb.push(...new Uint8Array(d.buffer)); }
    bytes(4, vb, out);
  }
  key(5, 0, out); varint(extent, out);
  return out;
}
const tile = layers => { const out = []; for (const l of layers) bytes(3, l, out); return new Uint8Array(out); };
// a box, clockwise on screen (y down): MVT's exterior winding; reversed, a hole
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const hole = (x0, y0, x1, y1) => box(x0, y0, x1, y1).reverse();
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b} (±${eps})`);
const flat = pts => pts.flat();

// ---- rings ----

test('ring areas: MVT exterior rings are positive in tile units (y down), holes negative', () => {
  assert.equal(ringArea2(flat(box(0, 0, 10, 10))), 200);
  assert.equal(ringArea2(flat(hole(0, 0, 10, 10))), -200);
  assert.deepEqual(openRing([0, 0, 1, 0, 1, 1, 0, 0]), [0, 0, 1, 0, 1, 1]);
  assert.deepEqual(openRing([0, 0, 1, 0, 1, 1]), [0, 0, 1, 0, 1, 1]);
});

test('polygons: an exterior ring and the holes after it; zero-area rings dropped; old reversed tiles follow the first ring', () => {
  const ps = polygons([flat(box(0, 0, 100, 100)), flat(hole(10, 10, 20, 20)), [5, 5, 6, 6, 7, 7], flat(box(200, 0, 300, 100)), flat(hole(210, 10, 220, 20))]);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].holes.length, 1); assert.equal(ps[1].holes.length, 1);
  const rev = polygons([flat(hole(0, 0, 100, 100)), flat(box(10, 10, 20, 20))]);   // a tile wound the other way round
  assert.equal(rev.length, 1); assert.equal(rev[0].holes.length, 1);
  assert.equal(polygons([flat(hole(10, 10, 20, 20))]).length, 1);   // a lone ring is a polygon whatever its winding
});

test('clipRing: inside untouched, outside empty, straddling cut exactly on the edge', () => {
  assert.deepEqual(clipRing(flat(box(10, 10, 20, 20)), 0, 0, 100, 100), flat(box(10, 10, 20, 20)));
  assert.deepEqual(clipRing(flat(box(110, 10, 120, 20)), 0, 0, 100, 100), []);
  const c = clipRing(flat(box(-50, 20, 50, 40)), 0, 0, 100, 100);
  assert.equal(ringArea2(c), 2 * 50 * 20);
  for (let i = 0; i < c.length; i += 2) assert.ok(c[i] >= 0 && c[i] <= 50);
  assert.ok(c.filter((v, i) => i % 2 === 0 && v === 0).length === 2, 'two corners exactly on the west edge');
  // a corner of the box sticks out on two sides: a quarter stays
  assert.equal(ringArea2(clipRing(flat(box(-10, -10, 10, 10)), 0, 0, 100, 100)), 2 * 100);
  // a diagonal cut: a triangle across the corner keeps its in-box part
  const tri = clipRing([-10, 50, 50, -10, 50, 50], 0, 0, 100, 100);
  near(ringArea2(tri) / 2, 60 * 60 / 2 - 2 * (10 * 10 / 2), 1e-9, 'triangle area');   // 1800 less two cut corners of 50
  // wholly covering the box: the box itself
  assert.equal(ringArea2(clipRing(flat(box(-10, -10, 200, 200)), 0, 0, 100, 100)), 2 * 100 * 100);
});

test('onEdge and outlineRuns: the seams along the tile edge are not outline', () => {
  assert.equal(onEdge(0, 5, 0, 9, 0, 0, 100, 100), 'W'); assert.equal(onEdge(100, 5, 100, 9, 0, 0, 100, 100), 'E');
  assert.equal(onEdge(3, 0, 9, 0, 0, 0, 100, 100), 'N'); assert.equal(onEdge(3, 100, 9, 100, 0, 0, 100, 100), 'S');
  assert.equal(onEdge(0, 5, 3, 9, 0, 0, 100, 100), null);
  // uncut: one closed run
  const whole = outlineRuns(flat(box(10, 10, 20, 20)), 0, 0, 100, 100);
  assert.equal(whole.length, 1); assert.equal(whole[0].length, 10); assert.deepEqual(whole[0].slice(0, 2), whole[0].slice(-2));
  // cut on the west edge: one open run of three sides (top, right, bottom)
  const cut = clipRing(flat(box(-50, 20, 50, 40)), 0, 0, 100, 100), runs = outlineRuns(cut, 0, 0, 100, 100);
  assert.equal(runs.length, 1); assert.equal(runs[0].length, 8);
  for (let i = 0; i + 3 < runs[0].length; i += 2) assert.equal(onEdge(runs[0][i], runs[0][i + 1], runs[0][i + 2], runs[0][i + 3], 0, 0, 100, 100), null);
  // cut on two opposite edges: two runs (top and bottom)
  assert.equal(outlineRuns(clipRing(flat(box(-50, 20, 150, 40)), 0, 0, 100, 100), 0, 0, 100, 100).length, 2);
  // the whole tile: no outline at all
  assert.equal(outlineRuns(clipRing(flat(box(-1, -1, 101, 101)), 0, 0, 100, 100), 0, 0, 100, 100).length, 0);
});

// ---- degrees ----

test('tile points to degrees: corners of z1 tiles, and a ring in Cesium order', () => {
  const nw = tilePoint(0, 0, 1, 1, 0); near(nw.lon, 0, 1e-12); near(nw.lat, 85.0511, 1e-4);
  const se = tilePoint(4096, 4096, 1, 0, 1); near(se.lon, 0, 1e-12); near(se.lat, -85.0511, 1e-4);
  const mid = tilePoint(2048, 2048, 0, 0, 0); near(mid.lat, 0, 1e-9); near(mid.lon, 0, 1e-9);
  const t = tileAt(40.7484, -73.9857, 14), r = ringDegrees([0, 0, 4096, 4096], 14, t.x, t.y);
  assert.ok(r[0] < -73.9857 && r[2] > -73.9857 && r[1] > 40.7484 && r[3] < 40.7484, 'the tile holds its point');
});

test('areaM2: a 0.01° square at 45°N, and a lake-hole; ringMid, inRing, inPolygon', () => {
  const sq = [10, 45, 10.01, 45, 10.01, 45.01, 10, 45.01];
  near(areaM2(sq), 1111.95 * 1111.95 * Math.cos(45.005 * Math.PI / 180), 50, 'area');
  const mid = ringMid(sq); near(mid.lon, 10.005, 1e-12); near(mid.lat, 45.005, 1e-12);
  assert.ok(inRing(10.005, 45.005, sq)); assert.ok(!inRing(10.02, 45.005, sq));
  const p = { outer: [0, 0, 10, 0, 10, 10, 0, 10], holes: [[4, 4, 6, 4, 6, 6, 4, 6]] };
  assert.ok(inPolygon(2, 2, p)); assert.ok(!inPolygon(5, 5, p)); assert.ok(!inPolygon(11, 5, p));
});

test('labelPoint: inside a C shape whose corner-mean falls in its mouth', () => {
  const c = { outer: [0, 0, 10, 0, 10, 2, 2, 2, 2, 8, 10, 8, 10, 10, 0, 10], holes: [] };
  const m = ringMid(c.outer); assert.ok(!inPolygon(m.lon, m.lat, c), 'the corner mean is outside');
  const at = labelPoint(c); assert.ok(inPolygon(at.lon, at.lat, c), `label inside: ${JSON.stringify(at)}`);
  const sq = labelPoint({ outer: [0, 0, 4, 0, 4, 4, 0, 4], holes: [] }); near(sq.lon, 2, 1e-12); near(sq.lat, 2, 1e-12);
  const ring = labelPoint({ outer: [0, 0, 10, 0, 10, 10, 0, 10], holes: [[3, 3, 7, 3, 7, 7, 3, 7]] });
  assert.ok(inPolygon(ring.lon, ring.lat, { outer: [0, 0, 10, 0, 10, 10, 0, 10], holes: [[3, 3, 7, 3, 7, 7, 3, 7]] }), 'not in the hole');
});

// ---- which tiles ----

test('tilesAround: nearest first, the centre tile leads, radius grows the set, columns wrap at 180°', () => {
  near(tileWidth(14, 0), 2445.98, 0.01); near(tileWidth(14, 60), 1222.99, 0.01);
  const t = tileAt(40.7484, -73.9857, 14), list = tilesAround(40.7484, -73.9857, 500, 14);
  assert.equal(list[0], `14/${t.x}/${t.y}`);
  assert.ok(list.length >= 1 && list.length <= 4, `500 m: ${list.length} tiles`);
  assert.ok(tilesAround(40.7484, -73.9857, 3000, 14).length > list.length);
  const w = tilesAround(0, 179.99, 30000, 9);
  assert.ok(w.some(k => k.split('/')[1] === '0') && w.some(k => k.split('/')[1] === '511'), 'both sides of the antimeridian');
  assert.ok(tilesAround(85, 0, 400000, 6).every(k => +k.split('/')[2] >= 0), 'no rows past the top');
  assert.equal(new Set(list).size, list.length);
});

test('pickZoom: the most detailed zoom that fits, or none', () => {
  const p = pickZoom(35.14, -79, 8000, [12, 11, 10, 9], 16);
  assert.equal(p.z, 12); assert.ok(p.tiles.length <= 16);
  const q = pickZoom(35.14, -79, 90000, [12, 11, 10, 9], 16);
  assert.ok(q.z < 12 && q.tiles.length <= 16, `90 km -> z${q.z}`);
  assert.equal(pickZoom(35.14, -79, 2e6, [12, 11, 10, 9], 16), null);
});

// ---- buildings ----

test('tileBuildings: heights, bottoms, colours, hide_3d, holes, clipping to the tile, the biggest kept', () => {
  const buf = tile([layer('building', [
    { type: 3, props: { render_height: 30, render_min_height: 0, colour: '#C4B9A7' }, parts: [box(100, 100, 200, 200)] },
    { type: 3, props: { render_height: 120, render_min_height: 40 }, parts: [box(300, 300, 500, 500), hole(350, 350, 400, 400)] },
    { type: 3, props: { render_height: 25, hide_3d: true }, parts: [box(600, 600, 700, 700)] },
    { type: 3, props: { render_height: 9 }, parts: [box(-64, 1000, 64, 1100)] },   // straddles the west edge: half stays
    { type: 3, props: { render_height: 9 }, parts: [box(4100, 1000, 4150, 1100)] },   // in the buffer only
    { type: 3, props: { render_height: 5000 }, parts: [box(800, 800, 810, 810)] },   // a tagging mistake
    { type: 3, props: { render_height: 0 }, parts: [box(900, 900, 910, 910)] },
    { type: 2, props: { render_height: 10 }, parts: [[[0, 0], [10, 10]]] },
  ])]);
  const t = tileAt(40.7484, -73.9857, 14), bs = tileBuildings(decodeTile(buf, ['building']).building, 14, t.x, t.y);
  assert.equal(bs.length, 4);
  const [a, b, d, e] = bs;
  assert.equal(a.h, 30); assert.equal(a.min, 0); assert.equal(a.colour, '#c4b9a7'); assert.equal(a.outer.length, 8);
  assert.equal(b.h, 120); assert.equal(b.min, 40); assert.equal(b.holes.length, 1);
  near(a.area, (100 * tileWidth(14, 40.75) / 4096) ** 2, a.area * 0.01, 'footprint m²');
  assert.ok(Math.abs(d.area - a.area * 0.64) < a.area * 0.02, 'clipped to the half inside');
  assert.equal(e.h, MAX_BUILDING_H);
  const capped = tileBuildings(decodeTile(buf, ['building']).building, 14, t.x, t.y, { max: 2 });
  assert.deepEqual(capped.map(x => x.h), [120, 30], 'biggest footprint x height first (the 900 m one is a 10-unit square)');
  assert.equal(tileBuildings(decodeTile(buf, ['building']).building, 14, t.x, t.y, { minArea: 1000 }).length, 3);
  assert.deepEqual(tileBuildings(undefined, 14, 0, 0), []);
});

test('buildingTint: grey by height, mapped colours toned toward it', () => {
  const low = buildingTint({ h: 6 }), tall = buildingTint({ h: 300 });
  assert.ok(tall[0] < low[0] && tall[1] < low[1], 'taller is darker');
  const red = buildingTint({ h: 6, colour: '#ff0000' });
  assert.ok(red[0] > low[0] && red[1] < low[1], 'red shows through');
  for (const v of red) assert.ok(v >= 0 && v <= 1);
});

// ---- military areas ----

function milTile(z, x, y, feats, extra = []) { return decodeTile(tile([layer('landuse', feats), ...extra]), null); }
test('tileMilitary: only class=military, clipped, seams cut out, cuts in world units; airfields and towns', () => {
  const t = tileAt(35.14, -79.0, 12);
  const d = milTile(12, t.x, t.y, [
    { type: 3, props: { class: 'military' }, parts: [box(3000, 1000, 4160, 2000)] },   // runs past the east edge
    { type: 3, props: { class: 'residential' }, parts: [box(100, 100, 200, 200)] },
    { type: 3, props: { class: 'military' }, parts: [box(100, 3000, 400, 3300), hole(200, 3100, 300, 3200)] },
  ], [layer('aerodrome_label', [{ type: 1, props: { class: 'military', name: 'Pope Army Airfield', icao: 'KPOB' }, parts: [[3500, 1500]] },
    { type: 1, props: { class: 'public', name: 'Fayetteville Regional' }, parts: [[3600, 1500]] }]),
  layer('place', [{ type: 1, props: { class: 'city', name: 'Fayetteville', rank: 5 }, parts: [[3800, 2500]] }, { type: 1, props: { class: 'hamlet', name: 'Nowhere' }, parts: [[3000, 900]] }])]);
  const m = tileMilitary(d, 12, t.x, t.y);
  assert.equal(m.pieces.length, 2);
  const [east, small] = m.pieces;
  assert.equal(east.cuts.length, 1); assert.equal(east.cuts[0].side, 'E'); assert.equal(east.cuts[0].line, 'x' + ((t.x + 1) * 4096));
  assert.equal(east.cuts[0].a, t.y * 4096 + 1000); assert.equal(east.cuts[0].b, t.y * 4096 + 2000);
  assert.equal(east.runs.length, 1, 'one open run: the seam is not drawn');
  assert.equal(small.cuts.length, 0); assert.equal(small.runs.length, 2, 'outer and hole outlines'); assert.equal(small.polys[0].holes.length, 1);
  assert.ok(small.area > 0 && small.area < areaM2(small.polys[0].outer));
  assert.deepEqual(m.fields.map(f => [f.name, f.icao]), [['Pope Army Airfield', 'KPOB']]);
  assert.deepEqual(m.places.map(p => p.name), ['Fayetteville']);
});

test('joinPieces: an area cut by a tile edge is one area again; touching corners and other tiles\' strangers are not', () => {
  const z = 12, x = 1149, y = 1620;
  const a = tileMilitary(milTile(z, x, y, [{ type: 3, props: { class: 'military' }, parts: [box(3000, 1000, 4160, 2000)] },
    { type: 3, props: { class: 'military' }, parts: [box(3000, 3000, 3500, 4096)] }]), z, x, y);
  const b = tileMilitary(milTile(z, x + 1, y, [{ type: 3, props: { class: 'military' }, parts: [box(-64, 1000, 500, 2000)] },
    { type: 3, props: { class: 'military' }, parts: [box(-64, 2500, 300, 2900)] }]), z, x + 1, y);   // a different stretch of the same edge
  const c = tileMilitary(milTile(z, x, y + 1, [{ type: 3, props: { class: 'military' }, parts: [box(3400, -64, 3900, 300)] }]), z, x, y + 1);   // below: overlaps 3400-3500
  const areas = joinPieces([...a.pieces, ...b.pieces, ...c.pieces]);
  assert.equal(areas.length, 3);
  const big = areas.find(g => g.pieces.length === 2 && g.pieces.some(p => p.tile === `${z}/${x}/${y}`) && g.pieces.some(p => p.tile === `${z}/${x + 1}/${y}`));
  assert.ok(big, 'east-west join');
  near(big.area, big.pieces[0].area + big.pieces[1].area, 1e-6);
  assert.ok(areas.some(g => g.pieces.length === 2 && g.pieces.some(p => p.tile === `${z}/${x}/${y + 1}`)), 'north-south join');
  assert.ok(areas.some(g => g.pieces.length === 1 && g.pieces[0].tile === `${z}/${x + 1}/${y}`), 'the stranger stays alone');
  assert.equal(big.open, false, 'whole once joined'); assert.ok(areas.find(g => g.pieces.length === 1).open, 'the stranger runs on past the tiles given');
  assert.equal(joinPieces(a.pieces).find(g => g.pieces[0].cuts.length).open, true, 'alone, the cut piece is open');
  assert.ok(areas[0].area >= areas[1].area && areas[1].area >= areas[2].area, 'biggest first');
  assert.equal(joinPieces([]).length, 0);
});

test('describeArea: named by the airfields inside it, near the closest town (cities preferred), label inside', () => {
  const t = tileAt(35.14, -79.0, 12);
  const m = tileMilitary(milTile(12, t.x, t.y, [{ type: 3, props: { class: 'military' }, parts: [box(1000, 1000, 3000, 3000)] }],
    [layer('aerodrome_label', [{ type: 1, props: { class: 'military', name: 'Simmons Army Air Field' }, parts: [[1500, 1500]] },
      { type: 1, props: { class: 'military', name: 'Pope Army Airfield' }, parts: [[2500, 2500]] },
      { type: 1, props: { class: 'military', name: 'Far Field' }, parts: [[3500, 3500]] }]),
    layer('place', [{ type: 1, props: { class: 'village', name: 'Spring Lake' }, parts: [[2400, 2000]] }, { type: 1, props: { class: 'city', name: 'Fayetteville' }, parts: [[3300, 2000]] }])]), 12, t.x, t.y);
  const [area] = joinPieces(m.pieces), d = describeArea(area, m.fields, m.places);
  assert.equal(d.name, 'Simmons Army Air Field (+1)'); assert.deepEqual(d.fields, ['Simmons Army Air Field', 'Pope Army Airfield']);
  assert.equal(d.near.name, 'Spring Lake', 'a village three times as close beats the city');
  const city = m.places.find(p => p.cls === "city"), village = { ...city, cls: "village", name: "Spring Lake", lon: d.at.lon + (city.lon - d.at.lon) * 0.8 };
  assert.equal(describeArea(area, [], [village, city]).near.name, "Fayetteville", "a city a little farther beats a village");
  assert.ok(inPolygon(d.at.lon, d.at.lat, area.pieces[0].polys[0]));
  const bare = describeArea(area, [], []); assert.equal(bare.name, null); assert.equal(bare.near, null);
});

test('areaWords', () => {
  assert.equal(areaWords(5000), '1 ha'); assert.equal(areaWords(8.6e5), '86 ha');
  assert.equal(areaWords(12.44e6), '12 km²'); assert.equal(areaWords(3.25e6), '3.3 km²'); assert.equal(areaWords(3200e6), '3,200 km²');
});

// ---- plate readers ----

test('facings: numbers, lists, ranges, compass words', () => {
  assert.deepEqual(facings(190), [190]);
  assert.deepEqual(facings(null, '90;270'), [90, 270]);
  assert.deepEqual(facings(null, '350-10'), [0]);
  assert.deepEqual(facings(null, null, 'NE'), [45]);
  assert.deepEqual(facings(null, null, 'south-west'), [225]);
  assert.deepEqual(facings(-90), [270]);
  assert.deepEqual(facings(90, '90;180'), [90, 180], 'no repeats');
  assert.deepEqual(facings('W'), [270]);
  assert.deepEqual(facings(null, 'forward'), []);
  assert.deepEqual(facings(), []);
  assert.equal(cardinal(0), 'N'); assert.equal(cardinal(230), 'SW'); assert.equal(cardinal(359), 'N'); assert.equal(cardinal(101), 'E'); assert.equal(cardinal(112.5), 'ESE');
});

test('tileCameras: detail tiles carry OSM ids and tags; heat tiles only positions', () => {
  const t = tileAt(41.8781, -87.6298, 14);
  const buf = tile([layer('cameras', [
    { type: 1, props: { osmId: 14014762188, osmType: 'node', brand: 'Flock Safety', direction: 230, surveillanceZone: 'traffic', mountType: 'pole', osmTimestamp: '2026-07-14T14:36:59Z', osmVersion: 1 }, parts: [[290, 2867]] },
    { type: 1, props: { osmId: 99, osmType: 'way', operator: 'Chicago Police Department', directions: '90;270', mountType: 'traffic_signals', startDate: '2024-03', osmVersion: 3, osmTimestamp: '2025-01-02T00:00:00Z' }, parts: [[10, 10]] },
    { type: 1, props: {}, parts: [[100, 100], [200, 200]] },   // a heat point pair (multipoint)
  ])]);
  const cs = tileCameras(decodeTile(buf, ['cameras']).cameras, 14, t.x, t.y);
  assert.equal(cs.length, 4);
  const [a, b] = cs;
  assert.equal(a.id, 'n14014762188'); assert.equal(a.brand, 'Flock Safety'); assert.deepEqual(a.facings, [230]); assert.equal(a.zone, 'traffic');
  const p = tilePoint(290, 2867, 14, t.x, t.y); near(a.lat, p.lat, 1e-12); near(a.lon, p.lon, 1e-12);
  assert.ok(Math.abs(a.lat - 41.88) < 0.05 && Math.abs(a.lon + 87.63) < 0.05);
  assert.equal(b.id, 'w99'); assert.deepEqual(b.facings, [90, 270]); assert.equal(b.brand, null);
  assert.ok(cs[2].heat && cs[2].id === null && cs[3].heat);
  assert.deepEqual(tileCameras(null, 1, 0, 0), []);
  // the card in words
  const rows = Object.fromEntries(cameraFacts(a));
  assert.equal(rows.Make, 'Flock Safety'); assert.equal(rows.Faces, 'SW (230°)'); assert.equal(rows.Watches, 'Traffic'); assert.equal(rows['Mounted on'], 'a pole');
  assert.equal(rows.Mapped, '14 Jul 2026');
  const rb = Object.fromEntries(cameraFacts(b));
  assert.equal(rb['Run by'], 'Chicago Police Department'); assert.equal(rb.Faces, 'E (90°), W (270°)'); assert.equal(rb['Mounted on'], 'traffic lights');
  assert.equal(rb.Mapped, '2 Jan 2025 (edit 3)'); assert.equal(rb.Since, '2024-03');
});

test('inBounds: a TileJSON box', () => {
  const us = [-159.609375, 17.685895, -64.599609, 61.616843];
  assert.ok(inBounds(us, 41.88, -87.63)); assert.ok(!inBounds(us, 51.5, -0.12)); assert.ok(!inBounds(null, 0, 0));
});

test('tilesInBox: covers the box, middle first, capped, across the antimeridian; tileBounds and tileOverlaps', async () => {
  const { tilesInBox, tileBounds, tileOverlaps } = await import('../src/core/osmtiles.js');
  const k = tilesInBox(-88, 41.6, -87.4, 42.1, 10);
  for (const [lat, lon] of [[41.6, -88], [42.1, -87.4], [41.85, -87.7]]) { const t = tileAt(lat, lon, 10); assert.ok(k.includes(`10/${t.x}/${t.y}`), `${lat},${lon}`); }
  const mid = tileAt(41.85, -87.7, 10); assert.equal(k[0], `10/${mid.x}/${mid.y}`);
  assert.equal(new Set(k).size, k.length);
  assert.equal(tilesInBox(-88, 41.6, -87.4, 42.1, 10, 2).length, 2);
  const w = tilesInBox(179, -1, -179, 1, 4);
  assert.ok(w.some(t => t.split('/')[1] === '15') && w.some(t => t.split('/')[1] === '0'), 'both sides of 180°');
  assert.equal(tilesInBox(-200, -10, 200, 10, 2).length, 4 * 2, 'a wrapped-around world is each column once');
  const b = tileBounds('1/0/0'); near(b[0], -180, 1e-9); near(b[2], 0, 1e-9); near(b[1], 0, 1e-9); near(b[3], 85.0511, 1e-4);
  const us = [-159.6, 17.7, -64.6, 61.6], t = tileAt(41.88, -87.63, 9);
  assert.ok(tileOverlaps(`9/${t.x}/${t.y}`, us)); const l = tileAt(51.5, -0.12, 9); assert.ok(!tileOverlaps(`9/${l.x}/${l.y}`, us)); assert.ok(tileOverlaps('0/0/0', null));
});

test('routeTiles: every tile a route passes, in order, even between far-apart points', async () => {
  const { routeTiles } = await import('../src/core/osmtiles.js');
  const r = routeTiles([[-87.9, 41.8], [-87.5, 41.8]], 12);   // ~33 km due east: crosses ~5 z12 columns in one segment
  const a = tileAt(41.8, -87.9, 12), b = tileAt(41.8, -87.5, 12);
  assert.equal(r[0], `12/${a.x}/${a.y}`); assert.equal(r[r.length - 1], `12/${b.x}/${b.y}`);
  assert.equal(r.length, b.x - a.x + 1, 'no column skipped');
  assert.equal(new Set(r).size, r.length);
});

test('readersAlong: near the route only, in route order, side and facing', async () => {
  const { readersAlong, makesWords } = await import('../src/core/osmtiles.js');
  const route = [[-87.70, 41.80], [-87.60, 41.80], [-87.60, 41.90]];   // east ~8.3 km, then north ~11 km
  const m = 1 / 111320, k = m / Math.cos(41.8 * Math.PI / 180);
  const cams = [
    { id: 'a', lat: 41.80 + 20 * m, lon: -87.65, facings: [270], brand: 'Flock Safety' },   // 20 m north of the eastbound leg (left), faces west: along the road
    { id: 'b', lat: 41.80 - 30 * m, lon: -87.68, facings: [190], brand: 'Flock Safety' },   // 30 m south (right), faces south: across it
    { id: 'c', lat: 41.85, lon: -87.60 + 25 * k, facings: [], brand: 'Motorola' },          // 25 m east of the northbound leg (right)
    { id: 'd', lat: 41.80 + 200 * m, lon: -87.65, facings: [270] },                         // 200 m off: not on the route
    { id: 'e', heat: true, lat: 41.80, lon: -87.65 },
  ];
  const r = readersAlong(route, cams, 40);
  assert.deepEqual(r.map(x => x.cam.id), ['b', 'a', 'c'], 'in route order');
  const [b, a, c] = r;
  near(a.off, 20, 0.5); near(b.off, 30, 0.5); near(c.off, 25, 0.5);
  assert.equal(a.side, 'left'); assert.equal(b.side, 'right'); assert.equal(c.side, 'right');
  assert.equal(a.watches, 'route'); assert.equal(b.watches, 'cross'); assert.equal(c.watches, null);
  assert.equal(readersAlong(route, [{ ...cams[0], facings: [100] }])[0].watches, 'route', 'the other way along the road counts too');
  near(a.at, 0.05 * 111320 * Math.cos(41.8 * Math.PI / 180) * 1.0, 60, 'metres along');
  assert.ok(c.at > 8000 && c.at < 9000 + 5600);
  assert.equal(readersAlong(route, cams, 10).length, 0);
  assert.deepEqual(readersAlong([[0, 0]], cams), []);
  assert.equal(makesWords(r.map(x => x.cam)), 'Flock Safety 2, Motorola 1');
  assert.equal(makesWords([{ brand: 'A' }, { brand: 'B' }, { brand: 'C' }, {}, {}], 2), 'unknown make 2, A 1, 2 other makes');
});
