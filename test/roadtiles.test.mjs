import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTile, geometry, tileAt, unproject } from '../src/core/mvt.js';
import { clip, prepareTile, joinTiles, nodeKey } from '../src/core/roadtiles.js';
import { buildGraph } from '../src/core/traffic.js';

// ---- a tiny Mapbox Vector Tile encoder, to build test tiles ----
const varint = (n, out) => { while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128); } out.push(n); };
const key = (f, w, out) => varint(f * 8 + w, out);
const bytes = (f, arr, out) => { key(f, 2, out); varint(arr.length, out); for (const b of arr) out.push(b); };
const str = (f, s, out) => bytes(f, [...new TextEncoder().encode(s)], out);
const packed = (f, nums, out) => { const b = []; for (const n of nums) varint(n, b); bytes(f, b, out); };
const zz = n => (n << 1) ^ (n >> 31);
function encodeLines(parts) {   // the cursor carries on from one part to the next
  const cmds = []; let cx = 0, cy = 0;
  for (const pts of parts) {
    cmds.push(1 | (1 << 3), zz(pts[0][0] - cx), zz(pts[0][1] - cy)); [cx, cy] = pts[0];
    cmds.push(2 | ((pts.length - 1) << 3));
    for (const [x, y] of pts.slice(1)) { cmds.push(zz(x - cx), zz(y - cy)); cx = x; cy = y; }
  }
  return cmds;
}
function layer(name, feats, extent = 4096) {
  const keys = [], vals = [], out = [];
  key(15, 0, out); varint(2, out); str(1, name, out);
  for (const f of feats) {
    const fb = [], tags = [];
    for (const [k, v] of Object.entries(f.props)) {
      let ki = keys.indexOf(k); if (ki < 0) ki = keys.push(k) - 1;
      let vi = vals.indexOf(v); if (vi < 0) vi = vals.push(v) - 1;
      tags.push(ki, vi);
    }
    packed(2, tags, fb); key(3, 0, fb); varint(f.type || 2, fb); packed(4, encodeLines(f.lines), fb);
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

// Tile A (z14, 100/200) and its east neighbour B (101/200). Main St (primary) runs east across the shared edge; Broad Ave
// (primary) crosses it at a shared vertex; Side St (residential) ends on Main St between its vertices; Elm and Oak
// (residential) cross. Lines run 64 units into the buffer, as real tiles do.
const road = (cls, lines, extra = {}) => ({ props: { class: cls, ...extra }, lines });
const name = (n, lines) => ({ props: { name: n, class: 'primary' }, lines });
const A = tile([
  layer('water', [{ type: 3, props: { class: 'ocean' }, lines: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }]),   // skipped
  layer('transportation', [
    road('primary', [[[1000, 1000], [3000, 1066], [4160, 1105]]]),
    road('primary', [[[3000, 500], [3000, 1066], [3000, 3500]]]),
    road('minor', [[[2000, 2000], [2000, 1033]]]),
    road('minor', [[[1200, 3000], [1500, 3000], [1800, 3000]]]), road('minor', [[[1500, 2700], [1500, 3000], [1500, 3300]]]),
    road('path', [[[100, 100], [200, 200]]]), road('service', [[[300, 300], [400, 400]]]),   // not for cars
  ]),
  layer('transportation_name', [name('Main St', [[[1000, 1000], [3000, 1066], [4160, 1105]]]), name('Broad Ave', [[[3000, 500], [3000, 3500]]])]),
]);
const B = tile([
  layer('transportation', [road('primary', [[[-64, 1101], [2904, 1200]]])]),
  layer('transportation_name', [name('Main St', [[[-64, 1101], [2904, 1200]]])]),
]);
const W = ['transportation', 'transportation_name'];

test('vector tiles: wanted layers only, properties, geometry with a running cursor', () => {
  const t = decodeTile(A, W);
  assert.deepEqual(Object.keys(t).sort(), W);
  assert.equal(t.transportation.extent, 4096); assert.equal(t.transportation.features.length, 7);
  assert.deepEqual(t.transportation.features[0].parts, [[1000, 1000, 3000, 1066, 4160, 1105]]);
  assert.equal(t.transportation_name.features[0].props.name, 'Main St');
  const v = decodeTile(tile([layer('x', [{ props: { a: -3, b: true, c: 2.5, d: 7 }, lines: [[[1, 1], [2, 2]], [[5, 5], [6, 4]]] }])]));
  assert.deepEqual(v.x.features[0].props, { a: -3, b: true, c: 2.5, d: 7 });
  assert.deepEqual(v.x.features[0].parts, [[1, 1, 2, 2], [5, 5, 6, 4]]);
  assert.deepEqual(geometry([9, 2, 2, 18, 2, 0, 0, 2, 15]), [[1, 1, 2, 1, 2, 2, 1, 1]]);   // MoveTo, LineTo x2, ClosePath repeats the first point
});

test('tiles and world positions', () => {
  assert.deepEqual(tileAt(40.7505, -73.9855, 14), { z: 14, x: 4824, y: 6157 });
  const p = unproject((4824 + 0.5) * 4096, (6157 + 0.5) * 4096, 2 ** 14 * 4096);
  assert.ok(Math.abs(p.lat - 40.749) < 0.01 && Math.abs(p.lon - (-73.98)) < 0.02, JSON.stringify(p));
});

test('clipping a line to its tile: points on the edge exactly', () => {
  assert.deepEqual(clip([-10, 5, 10, 5], 0, 0, 100, 100), [[0, 5, 10, 5]]);
  assert.deepEqual(clip([50, 50, 150, 50, 150, 60, 50, 60], 0, 0, 100, 100), [[50, 50, 100, 50], [100, 60, 50, 60]]);   // out and back in: two pieces
  assert.deepEqual(clip([150, 50, 160, 50], 0, 0, 100, 100), []);
});

test('one tile: cars-only roads, a street ending mid-road becomes a junction, lights at busy junctions only', () => {
  const t = prepareTile(decodeTile(A, W), 14, 100, 200);
  assert.equal(t.pieces.length, 5);   // no path, no service road
  const main = t.pieces.find(p => p.name === 'Main St'), side = t.pieces.find(p => p.cls === 'residential' && p.keys.length === 2 && !p.name);
  assert.ok(main && side, 'pieces named and classed');
  assert.ok(main.keys.includes(side.keys[1]), 'Main St got a vertex where Side St ends');
  const x0 = 100 * 4096, y0 = 200 * 4096;
  assert.deepEqual(t.signals, [nodeKey(x0 + 3000, y0 + 1066)], 'only the primary crossroads');
  assert.equal(main.seams.length, 1); assert.equal(main.seams[0][1], x0 + 4096);   // where it leaves the tile
});

test('two tiles: a road crossing the shared edge is one road; the graph runs on into the next tile', () => {
  const a = prepareTile(decodeTile(A, W), 14, 100, 200), b = prepareTile(decodeTile(B, W), 14, 101, 200);
  const { ways, signals } = joinTiles([a, b]), g = buildGraph(ways, signals);
  const east = g.edges.find(e => e.way.startsWith('14/100/200') && e.name === 'Main St' && e.dir === 1 && (g.out.get(e.to) || []).some(x => x.way.startsWith('14/101/200')));
  assert.ok(east, 'eastbound Main St continues into the next tile');
  const across = g.out.get(east.to).find(x => x.way.startsWith('14/101/200'));
  assert.equal(across.name, 'Main St'); assert.ok(Math.abs(across.pts[0].lat - east.pts[east.pts.length - 1].lat) < 1e-9);
  assert.ok(g.signals.size === 1);
  const alone = buildGraph(joinTiles([a]).ways, []);
  assert.equal(alone.edges.filter(e => e.way.startsWith('14/101')).length, 0);
});
