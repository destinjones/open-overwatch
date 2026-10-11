// GTFS Realtime vehicle positions (src/core/gtfsrt.js) and their mapping to transit fixes (src/core/transit.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVehiclePositions, encodeVehiclePositions, GTFS_STATUS } from '../src/core/gtfsrt.js';
import { fromGtfsRt } from '../src/core/transit.js';
import { Pbf } from '../src/core/mvt.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('a feed round-trips: positions (float32), trip, vehicle, status, stop', () => {
  const feed = encodeVehiclePositions({ t: 1791678431000, vehicles: [
    { vehicleId: '1848', label: '1848', tripId: '1369649', routeId: '10', dir: 1, lat: 44.98096, lon: -93.26886, hdg: 220, spd: 2, t: 1791678406000, status: 2, stop: '17976' },
    { vehicleId: '1846', label: 'Bus 1846', tripId: 't2', routeId: '901', lat: 44.97073, lon: -93.27744, status: 1, occupancy: 2 },
  ] });
  const d = parseVehiclePositions(feed);
  assert.equal(d.t, 1791678431000);
  assert.equal(d.vehicles.length, 2);
  const [a, b] = d.vehicles;
  near(a.lat, 44.98096, 1e-5, 'lat'); near(a.lon, -93.26886, 1e-5, 'lon');
  assert.equal(a.hdg, 220); assert.equal(a.spd, 2); assert.equal(a.t, 1791678406000);
  assert.equal(a.routeId, '10'); assert.equal(a.tripId, '1369649'); assert.equal(a.dir, 1); assert.equal(a.stop, '17976');
  assert.equal(GTFS_STATUS[a.status], 'between stops');
  assert.equal(b.t, 1791678431000, 'no own time: the feed time');
  assert.equal(b.hdg, null); assert.equal(b.spd, null); assert.equal(b.label, 'Bus 1846'); assert.equal(b.occupancy, 2);
});

test('deleted entities, entities without a position and (0, 0) are skipped', () => {
  const feed = encodeVehiclePositions({ t: 1e12, vehicles: [
    { vehicleId: 'a', routeId: '1', lat: 30.26, lon: -97.74 },
    { vehicleId: 'b', routeId: '1', lat: 30.26, lon: -97.74, deleted: true },
    { vehicleId: 'c', routeId: '1', lat: 0, lon: 0 },
  ] });
  assert.deepEqual(parseVehiclePositions(feed).vehicles.map(v => v.id), ['a']);
  assert.deepEqual(parseVehiclePositions(new Uint8Array(0)), { t: null, vehicles: [] });
});

test('unknown fields of every wire type are skipped, not misread', () => {
  // a header with an extra length-delimited field before the timestamp (this used to shift the reader by a byte)
  const bytes = [0x0a, 0x0d, 0x0a, 0x03, 0x32, 0x2e, 0x30, 0x10, 0x00, 0x18, 0xdf, 0xaf, 0xab, 0xd6, 0x06];
  assert.equal(parseVehiclePositions(Uint8Array.from(bytes)).t, 1791678431000);
  const r = new Pbf(Uint8Array.from([0x12, 0x02, 0x41, 0x42, 0x08, 0x05])); const [f, w] = r.key(); r.skip(w);
  assert.equal(f, 2); assert.deepEqual(r.key(), [1, 0]); assert.equal(r.varint(), 5);
});

test('fixes: route table gives mode and line names; out-of-service vehicles and silly speeds dropped', () => {
  const feed = parseVehiclePositions(encodeVehiclePositions({ t: 1e12, vehicles: [
    { vehicleId: '1', label: 'L1', routeId: '901', lat: 44.97, lon: -93.27, spd: 12 },
    { vehicleId: '2', routeId: '10', lat: 44.98, lon: -93.26, spd: 250, status: 1 },
    { vehicleId: '3', lat: 44.99, lon: -93.25 },
  ] }));
  const fx = fromGtfsRt(feed, { prefix: 'mt', operator: 'Metro Transit', routes: { 901: ['lightrail', 'METRO Blue Line', 'Blue'] } });
  assert.equal(fx.length, 2);
  assert.deepEqual([fx[0].id, fx[0].mode, fx[0].line, fx[0].lineName, fx[0].vehicle, fx[0].spd], ['mt:1', 'lightrail', 'Blue', 'METRO Blue Line', 'L1', 12]);
  assert.deepEqual([fx[1].mode, fx[1].line, fx[1].spd, fx[1].status, fx[1].operator], ['bus', '10', null, 'at a stop', 'Metro Transit']);
});
