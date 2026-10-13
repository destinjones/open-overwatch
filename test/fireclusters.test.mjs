// Fire detections grouped into fires (src/core/fireclusters.js): the tiles that cover an area (across the antimeridian
// too), single-linkage grouping that holds at high latitudes, fires in words, and NIFC perimeter rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireTilesAround, clusterFires, fireWords, perimeterRows, fireTileDeg } from '../src/core/fireclusters.js';

test('fireclusters: the most detailed tiles that stay few, both sides of the antimeridian', () => {
  const small = fireTilesAround(37, -120, 30);
  assert.equal(small.level, 6); assert.ok(small.tiles.length >= 1 && small.tiles.length <= 6);
  const big = fireTilesAround(37, -120, 1200);
  assert.ok(big.level < 6 && big.tiles.length <= 6, JSON.stringify(big));
  const d = fireTileDeg(big.level), covered = big.tiles.map(t => [-180 + t.col * d, 90 - (t.row + 1) * d, -180 + (t.col + 1) * d, 90 - t.row * d]);
  for (const [lat, lon] of [[37, -120], [47, -120], [27, -133], [37, -106]]) assert.ok(covered.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n), `${lat},${lon} covered`);
  const fiji = fireTilesAround(-17.7, 179.5, 200);
  const cols = new Set(fiji.tiles.map(t => t.col)), last = Math.ceil(360 / fireTileDeg(fiji.level)) - 1;
  assert.ok(cols.has(0) && cols.has(last), `both edges: ${[...cols]}`);
  const west = fireTilesAround(-17.7, -179.5, 200), wcols = new Set(west.tiles.map(t => t.col));
  assert.ok(wcols.has(0) && wcols.has(Math.ceil(360 / fireTileDeg(west.level)) - 1));
  assert.ok(fireTilesAround(89, 0, 300).tiles.length >= 1, 'near the pole');
});

const F = (lat, lon, frp, mins, day = true) => ({ lat, lon, frp, t: Date.parse('2026-10-12T12:00:00Z') + mins * 60e3, day });
test('fireclusters: detections within ~2.5 km are one fire, strongest fire first', () => {
  const kmLat = 1 / 111.32;
  const fires = [F(10, 20, 5, 0), F(10 + 2 * kmLat, 20, 7, 1), F(10 + 4 * kmLat, 20, 3, 2, false),   // a chain: each link under 2.5 km
    F(10.5, 20.5, 300, 5), F(10.5 + 0.5 * kmLat, 20.5, 100, 6),   // a strong pair
    F(11, 21, 1, 9)];   // alone
  const g = clusterFires(fires);
  assert.deepEqual(g.map(x => x.count), [2, 3, 1]);
  assert.equal(g[0].frp, 400); assert.equal(g[0].max_frp, 300); assert.ok(Math.abs(g[0].lat - 10.5) < 0.004, 'power-weighted centre');
  assert.equal(g[1].night, 1); assert.ok(g[1].km > 3.5 && g[1].km < 5, `${g[1].km}`); assert.equal(g[1].last - g[1].first, 2 * 60e3);
  assert.deepEqual(clusterFires([]), []);
});

test('fireclusters: at 70°N a link east-west spans more longitude, and is still found', () => {
  const kmLon = 1 / (111.32 * Math.cos(70 * Math.PI / 180));
  const g = clusterFires([F(70, 30, 10, 0), F(70, 30 + 2.2 * kmLon, 10, 0), F(70, 30 + 4.4 * kmLon, 10, 0), F(70, 30 + 9 * kmLon, 10, 0)]);
  assert.deepEqual(g.map(x => x.count).sort(), [1, 3]);
  const far = clusterFires([F(-33, 151, 1, 0), F(-33, 151 + 3.5 / (111.32 * Math.cos(33 * Math.PI / 180)), 1, 0)]);
  assert.equal(far.length, 2, '3.5 km apart: two fires');
});

test('fireclusters: a fire in words', () => {
  assert.equal(fireWords({ count: 1, km: 0.375, frp: 2 }), 'a small hot spot (a single hot pixel, 2 MW radiated)');
  assert.match(fireWords({ count: 351, km: 24, frp: 3280 }), /^a very large, intense fire \(351 hot pixels over about 24 km, 3,280 MW radiated\)$/);
  assert.match(fireWords({ count: 5, km: 1.2, frp: 60 }), /^a sizeable fire \(5 hot pixels over about a kilometre/);
});

test('fireclusters: NIFC perimeter rows from attributes and centroids', () => {
  const rows = perimeterRows({ features: [
    { attributes: { poly_IncidentName: 'Timber', attr_IncidentSize: 25350, attr_PercentContained: 97, attr_POOState: 'US-CA', attr_FireDiscoveryDateTime: 1786246500000, poly_DateCurrent: 1791537522000,
      attr_UniqueFireIdentifier: '2026-CALPF-002271', attr_IncidentTypeCategory: 'WF', attr_InitialLatitude: 35.93, attr_InitialLongitude: -121.4, attr_FireCause: 'Undetermined' }, centroid: { x: -121.39, y: 35.92 } },
    { attributes: { poly_IncidentName: 'Rx unit', attr_IncidentTypeCategory: 'RX', attr_InitialLatitude: 40, attr_InitialLongitude: -110, attr_PercentContained: null } },
    { attributes: { poly_IncidentName: 'nowhere' } }] });
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].name, rows[0].state, rows[0].acres, rows[0].contained, rows[0].lat, rows[0].prescribed], ['Timber', 'CA', 25350, 97, 35.92, false]);
  assert.deepEqual([rows[1].prescribed, rows[1].contained, rows[1].lat, rows[1].acres], [true, null, 40, null]);
  assert.deepEqual(perimeterRows(null), []);
});
