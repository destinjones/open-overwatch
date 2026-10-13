// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// HSL's GTFS-RT file read into lines and modes (src/core/transit.js), CapMetro's moving file, and the MCP transit box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hslRoute, fromHslRt } from '../src/core/transit.js';
import { capmetroFile, sourcesAt } from '../src/core/transitfeeds.js';
import { boxAround } from '../mcp/transit.mjs';
import { encodeVehiclePositions, parseVehiclePositions } from '../src/core/gtfsrt.js';

test("transit: CapMetro's current file, and the MCP server's box around a place for Entur", () => {
  assert.equal(capmetroFile('abc-123'), 'https://data.texas.gov/api/views/eiei-9rpf/files/abc-123?filename=vehiclepositions.pb');
  assert.equal(capmetroFile('../etc'), null); assert.equal(capmetroFile(undefined), null);
  const [s, w, n, e] = boxAround(60, 10, 11.132);
  assert.ok(Math.abs(n - s - 0.2) < 0.002 && Math.abs((e - w) - 0.4) < 0.005, `${[s, w, n, e]}`);
  assert.deepEqual([...sourcesAt(60.17, 24.94)], ['hsl']); assert.deepEqual([...sourcesAt(59.33, 18.07)], [], 'Stockholm: not Norway');
});

test('transit: HSL route ids as people know them', () => {
  assert.deepEqual(hslRoute('1055'), ['bus', '55']); assert.deepEqual(hslRoute('2550'), ['bus', '550']); assert.deepEqual(hslRoute('4615'), ['bus', '615']);
  assert.deepEqual(hslRoute('2121A'), ['bus', '121A']); assert.deepEqual(hslRoute('1006T'), ['tram', '6T']); assert.deepEqual(hslRoute('1009'), ['tram', '9']);
  assert.deepEqual(hslRoute('1014'), ['bus', '14'], 'bus 14, not a tram'); assert.deepEqual(hslRoute('31M1'), ['metro', 'M1']); assert.deepEqual(hslRoute('31M2B'), ['metro', 'M2']);
  assert.deepEqual(hslRoute('3001R'), ['rail', 'R']); assert.deepEqual(hslRoute('1019'), ['ferry', '19']); assert.deepEqual(hslRoute('9785'), ['bus', '785']); assert.deepEqual(hslRoute(''), ['bus', '']);
});

test('transit: HSL\'s GTFS-RT file becomes fixes with modes and lines', () => {
  const T = Date.parse('2026-10-12T10:00:00Z');
  const buf = encodeVehiclePositions({ t: T, vehicles: [
    { vehicleId: '18/167', lat: 60.1718, lon: 24.9437, hdg: 266, spd: 0.01, routeId: '1009', dir: 1, status: 1, t: T - 5000 },
    { vehicleId: '50/167', lat: 60.2086, lon: 25.054, spd: 18.7, routeId: '31M1', status: 2, t: T - 1000 },
    { vehicleId: '22/1', lat: 60.2, lon: 24.9, routeId: '', t: T }] });   // no route: out of service
  const f = fromHslRt(parseVehiclePositions(buf));
  assert.deepEqual(f.map(x => [x.id, x.mode, x.line, x.status, x.operator]), [['hsl:18/167', 'tram', '9', 'at a stop', 'HSL'], ['hsl:50/167', 'metro', 'M1', 'between stops', 'HSL']]);
  assert.ok(Math.abs(f[1].spd - 18.7) < 0.01); assert.equal(f[0].t, T - 5000);
});
