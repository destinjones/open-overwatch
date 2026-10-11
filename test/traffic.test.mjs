import test from 'node:test';
import assert from 'node:assert/strict';
import { maxspeed, drivesLeft, busyness, localTime, buildGraph, nextEdge, follow, along, laneOffset, expected, green, CYCLE,
  zonedToUtc, linkPoints, parseNyc, parseTms, matchSpeeds, Sim, dist, STOP_BACK, densify } from '../src/core/traffic.js';

// a high street west-east through a junction with traffic lights (ways 1, 2), crossed by a one-way lane south to north (3, 4)
const n = (id, lat, lon) => ({ id, lat, lon });
const W2 = n(15, 51.5, -0.106), W = n(11, 51.5, -0.102), C0 = n(10, 51.5, -0.1), E = n(12, 51.5, -0.098), E2 = n(16, 51.5, -0.094);
const S = n(13, 51.498, -0.1), N = n(14, 51.502, -0.1);
const way = (id, nodes, tags) => ({ id, nodes: nodes.map(x => x.id), geometry: nodes.map(x => ({ lat: x.lat, lon: x.lon })), tags });
const ways = [way(1, [W2, W, C0], { highway: 'primary', name: 'High St' }), way(2, [C0, E, E2], { highway: 'primary', name: 'High St' }),
  way(3, [S, C0], { highway: 'residential', oneway: 'yes', name: 'Mill Ln' }), way(4, [C0, N], { highway: 'residential', oneway: 'yes', name: 'Mill Ln' })];
const seeded = (seed = 1) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const car = (e, s, extra = {}) => ({ kind: 'car', id: Math.random(), e, s, v: 0, lane: 0, next: null, vt: 99, i: 1, go: null, drv: 1, born: 0, len: 4.6, ...extra });

test('speed limits and driving side', () => {
  assert.equal(maxspeed('50'), 50); assert.equal(maxspeed('30 mph'), 48); assert.equal(maxspeed('RU:urban'), 50); assert.equal(maxspeed('none'), null);
  assert.ok(drivesLeft('GB') && drivesLeft('jp') && drivesLeft('AU')); assert.ok(!drivesLeft('US') && !drivesLeft('FI'));
});

test('time of day: quiet at night, workday peaks, a later weekend', () => {
  assert.ok(busyness(3) < 0.2); assert.ok(busyness(8) > 0.8 && busyness(17.5) > 0.9); assert.ok(busyness(13) > busyness(22));
  assert.ok(busyness(8, true) < 0.4 && busyness(14, true) > 0.6);
  const t = localTime(Date.UTC(2026, 9, 10, 12, 0), 90);   // Saturday noon UTC at 90°E is ~6 pm there
  assert.equal(Math.round(t.hour), 18); assert.equal(t.weekend, true);
  assert.equal(localTime(Date.UTC(2026, 9, 12, 2, 0), -75).weekend, true);   // Monday 2 am UTC is still Sunday evening in New York
});

test('the road graph: cut at junctions, both ways on two-way roads, signals and the grid axis', () => {
  const g = buildGraph(ways, [10]);
  assert.equal(g.edges.length, 6);   // two two-way ways x2, two one-way ways x1
  const in1 = g.edges.find(e => e.way === 1 && e.dir === 1);
  assert.ok(Math.abs(in1.len - 416) < 3, String(in1.len));   // 0.006° of longitude at 51.5°N
  assert.equal(g.out.get(13).length, 1); assert.equal(g.out.get(14), undefined);   // one-way: nothing leaves N back south
  assert.deepEqual(in1.stops.map(s => [Math.round(s.s), s.node, Math.round(s.hdg)]), [[Math.round(in1.len), 10, 90]]);
  assert.equal(g.edges.find(e => e.way === 2 && e.dir === 1).stops.length, 0);   // leaving the junction: no light
  assert.ok(g.signals.has(10) && g.axis < 5);   // a north-south / east-west grid
  const back = g.edges.find(e => e.way === 1 && e.dir === -1);
  assert.ok(Math.abs(back.a - in1.len) < 1e-6 && back.from === 10);
  assert.equal(in1.speed, 50);
});

test('lights: one axis green, then the other, with a gap between', () => {
  const sig = { off: 0 }, axis = 0;
  assert.ok(green(sig, 0, 5, axis) && green(sig, 180, 5, axis) && !green(sig, 90, 5, axis));
  assert.ok(!green(sig, 0, CYCLE / 2 + 5, axis) && green(sig, 270, CYCLE / 2 + 5, axis));
  assert.ok(!green(sig, 0, CYCLE / 2 - 1, axis) && !green(sig, 90, CYCLE / 2 - 1, axis));   // amber / all red
});

test('turning: no U-turns, straight on the same road is likeliest', () => {
  const g = buildGraph(ways), in1 = g.edges.find(e => e.way === 1 && e.dir === 1), rand = seeded(), counts = {};
  for (let i = 0; i < 2000; i++) { const x = nextEdge(g, in1, rand); counts[x.way] = (counts[x.way] || 0) + 1; }
  assert.ok(!counts[1], 'never back the way it came'); assert.ok(!counts[3], 'not the wrong way up a one-way');
  assert.ok(counts[2] > counts[4], JSON.stringify(counts));
});

test('car following: free road speeds up, a close car ahead brakes it', () => {
  let v = 10; for (let i = 0; i < 200; i++) v = follow(v, 14, Infinity); assert.ok(Math.abs(v - 14) < 0.6, String(v));
  assert.ok(follow(14, 14, 5, 0, 0.1) < 14 - 0.5);
  assert.equal(follow(0, 14, 1, 0, 0.1), 0);   // queued: stays stopped
});

test('positions, lanes and how many cars a road should carry', () => {
  const g = buildGraph(ways), e = g.edges.find(x => x.way === 2 && x.dir === 1);
  const mid = along(e, e.len / 2); assert.ok(Math.abs(mid.lon - (-0.097)) < 1e-6 && Math.abs(mid.hdg - 90) < 0.5);
  assert.equal(laneOffset(e, 0, false), 1.6); assert.equal(laneOffset(e, 0, true), -1.6);   // keep right / keep left
  const ow = g.edges.find(x => x.way === 3); assert.equal(laneOffset(ow, 0, false), 0);   // one lane one-way: the middle
  assert.ok(Math.abs(expected(e, 1) - 22 * 2 * e.len / 1000) < 1e-9); assert.ok(expected(e, 0.2) < expected(e, 1));
  e.meas = { kmh: 50, flow: 1000 }; assert.ok(Math.abs(expected(e, 0.2) - 20 * e.len / 1000) < 1e-9);   // a real count wins
});

test('a red light stops the queue; green lets it go', () => {
  const g = buildGraph(ways, [10]); g.signals.get(10).off = 0;   // east-west is green from 35 s to 67 s of each 70 s
  const sim = new Sim({ rand: seeded() }); sim.setGraph(g); sim.zone({ lat: 51.5, lon: -0.1 }, 5000, 1);
  const e = g.edges.find(x => x.way === 1 && x.dir === 1), a = car(e, 300), b = car(e, 240);
  for (const c of [a, b]) { sim.cars.push(c); sim.enter(c); }
  let minGap = Infinity;
  for (let k = 0; k < 600; k++) { sim.step(0.05, k * 0.05); if (a.e === e && b.e === e) minGap = Math.min(minGap, a.s - a.len - b.s); }   // 0-30 s: red
  assert.ok(a.e === e && a.v < 0.2 && e.len - a.s > STOP_BACK && e.len - a.s < STOP_BACK + 5, `front car at ${(e.len - a.s).toFixed(1)} m, ${a.v.toFixed(2)} m/s`);   // at the stop line, before the junction
  assert.ok(b.e === e && b.v < 0.2 && a.s - a.len - b.s < 6, `second car ${(a.s - a.len - b.s).toFixed(1)} m behind`);
  assert.ok(minGap > 0, 'never into the car ahead');
  for (let k = 600; k < 1000; k++) sim.step(0.05, k * 0.05);   // to 50 s: green
  assert.ok(a.e !== e && b.e !== e, 'both through the junction');
});

test('new road data: cars keep their place when an edge is cut by a new junction', () => {
  const g = buildGraph(ways), sim = new Sim({ rand: seeded() }); sim.setGraph(g); sim.zone({ lat: 51.5, lon: -0.1 }, 5000, 1);
  const e = g.edges.find(x => x.way === 1 && x.dir === 1), c = car(e, 300); sim.cars.push(c); sim.enter(c);
  const before = along(c.e, c.s);
  const S2 = n(17, 51.498, -0.102), N2 = n(18, 51.502, -0.102);
  sim.setGraph(buildGraph([...ways, way(5, [S2, W, N2], { highway: 'residential' })]));   // W becomes a junction
  const after = along(c.e, c.s);
  assert.equal(c.e.from, 11); assert.ok(dist(before, after) < 0.5, String(dist(before, after)));
  sim.setGraph(buildGraph(ways.filter(w => w.id !== 1)));   // its road is gone: so is the car
  assert.equal(sim.cars.length, 0);
});

test('a busy circle: fit adds and removes, cars that leave come back in', () => {
  let added = 0, removed = 0;
  const g = buildGraph(ways, [10]), sim = new Sim({ rand: seeded(7), onAdd: () => added++, onRemove: () => removed++ });
  sim.setGraph(g); sim.zone({ lat: 51.5, lon: -0.1 }, 250, 1);
  assert.ok(sim.wanted() > 4, String(sim.wanted()));
  sim.fit(12); assert.equal(sim.cars.length, 12); assert.equal(added, 12);
  for (let k = 0; k < 2400; k++) sim.step(0.05, 30000 + k * 0.05);   // two minutes
  assert.equal(sim.cars.length, 12);
  for (const c of sim.cars) assert.ok(Math.min(dist({ lat: 51.5, lon: -0.1 }, c.e.pts[0]), dist({ lat: 51.5, lon: -0.1 }, c.e.pts[c.e.pts.length - 1])) < 250 * 1.2);
  for (const e of g.edges) for (const q of e.q) for (let i = 1; i < q.length; i++) assert.ok(q[i - 1].s >= q[i].s, 'lanes stay ordered');
  sim.fit(5); assert.equal(sim.cars.length, 5); assert.equal(removed, 7);
});

test('NYC DOT speeds: local times, cut-off points, no-reading zeros, the latest per link', () => {
  assert.equal(new Date(zonedToUtc('2026-10-10T15:31:06.000', 'America/New_York')).toISOString(), '2026-10-10T19:31:06.000Z');   // EDT
  assert.equal(new Date(zonedToUtc('2026-01-10T15:31:06', 'America/New_York')).toISOString(), '2026-01-10T20:31:06.000Z');      // EST
  assert.deepEqual(linkPoints('40.71141,-73.97866 40.72504,-73.9'), [{ lat: 40.71141, lon: -73.97866 }]);
  const pts = '40.7369006,-73.974651 40.74,-73.9725 40.7465204,-73.96929';
  const rows = [{ link_id: '1', speed: '18.01', data_as_of: '2026-10-10T14:53:05.000', link_name: 'FDR N 25th - 63rd St', borough: 'Manhattan', link_points: pts },
    { link_id: '1', speed: '25', data_as_of: '2026-10-10T14:58:05.000', link_name: 'FDR N 25th - 63rd St', borough: 'Manhattan', link_points: pts },
    { link_id: '2', speed: '0', data_as_of: '2026-10-10T14:58:05.000', link_name: 'TNB', link_points: pts }];
  const l = parseNyc(rows); assert.equal(l.length, 1); assert.ok(Math.abs(l[0].kmh - 40.23) < 0.01); assert.equal(l[0].pts.length, 2);
});

test('Fintraffic sensors: a reading per direction, direction 1 along the station bearing', () => {
  const f = [{ type: 'Feature', id: 20002, geometry: { type: 'Point', coordinates: [24.7, 60.2, 0] }, properties: { id: 20002, name: 'vt1_Espoo_Hirvisuo', bearing: 298 } }];
  const d = [{ id: 20002, dataUpdatedTime: '2026-10-10T22:06:11Z', sensorValues: [
    { name: 'KESKINOPEUS_5MIN_LIUKUVA_SUUNTA1', value: 88, measuredTime: '2026-10-10T22:06:02Z' }, { name: 'KESKINOPEUS_5MIN_LIUKUVA_SUUNTA2', value: 71, measuredTime: '2026-10-10T22:06:02Z' },
    { name: 'OHITUKSET_5MIN_LIUKUVA_SUUNTA1', value: 120 }, { name: 'OHITUKSET_5MIN_LIUKUVA_SUUNTA2', value: 96 }] }];
  const r = parseTms(f, d);
  assert.deepEqual(r.map(x => [x.kmh, x.flow, x.bearing]), [[88, 120, 298], [71, 96, 118]]);
  assert.equal(r[0].t, Date.parse('2026-10-10T22:06:02Z'));
});

test('measured speeds land on the right roads, in the right direction', () => {
  const g = buildGraph(ways), fwd = g.edges.find(e => e.way === 2 && e.dir === 1), back = g.edges.find(e => e.way === 2 && e.dir === -1);
  const lane = g.edges.find(e => e.way === 4);
  matchSpeeds(g.edges, [{ lat: 51.5003, lon: -0.097, kmh: 23, flow: 600, bearing: 90, t: 1, name: 'x' }]);
  assert.equal(fwd.meas?.kmh, 23); assert.equal(back.meas, null); assert.equal(lane.meas, null);   // not the other way, not a side street
  const n2 = matchSpeeds(g.edges, [], [{ kmh: 30, t: 2, name: 'link', pts: [{ lat: 51.50005, lon: -0.099 }, { lat: 51.50005, lon: -0.095 }] }]);
  assert.equal(n2, 1); assert.equal(fwd.meas.src, 'nyc'); assert.equal(back.meas, null);
});

test('densified roads: more points along long segments, the same network and lengths', () => {
  const dense = densify(ways, 25), g0 = buildGraph(ways, [10]), g1 = buildGraph(dense, [10]);
  assert.equal(g1.edges.length, g0.edges.length);   // no new junctions
  const e0 = g0.edges.find(e => e.way === 1 && e.dir === 1), e1 = g1.edges.find(e => e.way === 1 && e.dir === 1);
  assert.ok(e1.pts.length > 10 && Math.abs(e1.len - e0.len) < 1e-6, `${e1.pts.length} points, ${e1.len} m`);
  assert.ok(e1.cum.every((c, i) => i === 0 || c - e1.cum[i - 1] <= 25.01));
  assert.deepEqual(e1.stops.map(s => [Math.round(s.s), s.node]), e0.stops.map(s => [Math.round(s.s), s.node]));   // the light is still at the junction
  assert.equal(densify([way(9, [W, C0], { highway: 'residential' })], 1000)[0].nodes.length, 2);   // short: untouched
});
