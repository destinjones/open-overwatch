// Submarine cables (src/core/cables.js): parsing TeleGeography's files, distances to cables (across the antimeridian too),
// landing stations nearby, and the per-cable and per-station records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCables, parseLandings, nearestOnLines, cablesNear, landingsNear, parseCable, parseLanding, cablePage, cableUrl } from '../src/core/cables.js';
import { haversine } from '../src/core/geo.js';

const GEO = { features: [
  { properties: { id: 'blue', name: 'Blue', color: '#3a7bd5' }, geometry: { type: 'MultiLineString', coordinates: [[[5.37, 43.29], [5.5, 42.5], [9.0, 41.0]], [[9.0, 41.0], [12.5, 38.0]]] } },
  { properties: { id: 'pacific', name: 'Across the date line', color: 'red' }, geometry: { type: 'LineString', coordinates: [[178.0, -17.0], [179.9, -17.0], [-179.9, -17.0], [-178.0, -17.0]] } },
  { properties: { id: 'wrapped', name: 'Drawn past 180' }, geometry: { type: 'LineString', coordinates: [[178.0, -10.0], [182.0, -10.0]] } },
  { properties: { id: 'nogeom', name: 'Nothing' }, geometry: { type: 'LineString', coordinates: [[1, 1]] } },
  { properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] };
const LAND = { features: [
  { properties: { id: 'marseille-france', name: 'Marseille, France', is_tbd: false }, geometry: { type: 'Point', coordinates: [5.3698, 43.2965] } },
  { properties: { id: 'toulon-france', name: 'Toulon, France' }, geometry: { type: 'Point', coordinates: [5.93, 43.12] } },
  { properties: { id: 'bad' }, geometry: { type: 'Point', coordinates: ['x', 1] } }] };

test('cables: the map files parse into cables with boxes and landing stations', () => {
  const c = parseCables(GEO);
  assert.deepEqual(c.map(x => x.id), ['blue', 'pacific', 'wrapped'], 'one-point lines and nameless features are dropped');
  assert.deepEqual(c[0].box, [5.37, 38, 12.5, 43.29]); assert.equal(c[0].lines.length, 2); assert.equal(c[1].color, null, 'only hex colours');
  const l = parseLandings(LAND);
  assert.deepEqual(l.map(x => [x.id, x.lat, x.lon]), [['marseille-france', 43.2965, 5.3698], ['toulon-france', 43.12, 5.93]]);
  assert.deepEqual(parseCables(null), []); assert.deepEqual(parseLandings({}), []);
});

test('cables: the nearest point on a cable, measured in a flat frame that agrees with great circles nearby', () => {
  const [blue] = parseCables(GEO);
  const p = nearestOnLines(blue.lines, 43.0, 6.5);
  const truth = haversine(43.0, 6.5, p.lat, p.lon) / 1000;
  assert.ok(Math.abs(p.km - truth) / truth < 0.01, `${p.km} vs ${truth}`);
  assert.ok(p.km > 50 && p.km < 120, `${p.km}`);
  const end = nearestOnLines(blue.lines, 43.29, 5.37); assert.ok(end.km < 0.01, 'on the landing point');
  assert.equal(nearestOnLines([], 0, 0), null);
});

test('cables: across the antimeridian, in either drawing', () => {
  const c = parseCables(GEO), dl = c[1], wr = c[2];
  const a = nearestOnLines(dl.lines, -17.1, 180), b = nearestOnLines(dl.lines, -17.1, -179.95);
  assert.ok(a.km < 12 && b.km < 12, `${a.km} ${b.km}: the short way, not round the world`);
  const w = nearestOnLines(wr.lines, -10.05, -179.0);   // 181°E drawn as 181, asked as -179
  assert.ok(w.km < 6, `${w.km}`); assert.ok(w.lon < -178 && w.lon > -180, `${w.lon}`);
  assert.deepEqual(cablesNear(c, -17.0, -179.0, 50).map(x => x.id), ['pacific']);
  assert.deepEqual(cablesNear(c, -10.0, -179.5, 50).map(x => x.id), ['wrapped']);
});

test('cables: cables and landings near a place, nearest first', () => {
  const c = parseCables(GEO), l = parseLandings(LAND);
  const near = cablesNear(c, 43.3, 5.4, 30);
  assert.deepEqual(near.map(x => x.id), ['blue']); assert.ok(near[0].km < 3);
  assert.deepEqual(cablesNear(c, 50, 0, 100), []);
  const lands = landingsNear(l, 43.3, 5.4, 60);
  assert.deepEqual(lands.map(x => x.id), ['marseille-france', 'toulon-france']); assert.ok(lands[0].km < 3 && lands[1].km > 40);
  assert.deepEqual(landingsNear(l, 43.3, 5.4, 10).map(x => x.id), ['marseille-france']);
});

test('cables: one cable\'s and one station\'s records', () => {
  const d = parseCable({ id: 'apx-west', name: 'APX West', length: '4,600 km', landing_points: [{ id: 'perth', name: 'Perth, WA, Australia', country: 'Australia', is_tbd: null }, { id: 'x', name: '' }],
    owners: 'SUBCO, Other Co', suppliers: null, rfs: '2029', rfs_year: 2029, is_planned: true, url: 'https://sub.co/', notes: null });
  assert.deepEqual([d.length_km, d.owners, d.ready, d.ready_text, d.planned, d.landings.length, d.url], [4600, ['SUBCO', 'Other Co'], 2029, '2029', true, 1, 'https://sub.co/']);
  const n = parseCable({ id: 'n', name: 'N', length: 'n.a.', owners: null, rfs: null, rfs_year: null, url: 'javascript:x' });
  assert.deepEqual([n.length_km, n.owners, n.ready, n.url], [null, [], null, null]);
  assert.equal(parseCable(null), null);
  const s = parseLanding({ id: 'ganavan', name: 'Ganavan Bay, United Kingdom', country: 'United Kingdom', cables: [{ id: 'bt-hi', name: 'BT Highlands', rfs_year: 2014, is_planned: false }, { name: 'no id' }] });
  assert.deepEqual(s.cables, [{ id: 'bt-hi', name: 'BT Highlands', ready: 2014, planned: false }]);
  assert.equal(cablePage('a b'), 'https://www.submarinecablemap.com/submarine-cable/a%20b'); assert.match(cableUrl('x'), /\/api\/v3\/cable\/x\.json$/);
});
