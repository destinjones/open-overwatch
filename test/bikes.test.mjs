// Bike share (src/core/bikes.js): the CityBikes directory, stations, how full each one is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cbTime, parseNetworks, parseStations, stationState, networksNear } from '../src/core/bikes.js';

test('CityBikes times: with an offset and a Z, or plain', () => {
  assert.equal(cbTime('2026-10-11T00:45:26.482297+00:00Z'), Date.UTC(2026, 9, 11, 0, 45, 26, 482));
  assert.equal(cbTime('2026-10-11T00:45:26Z'), Date.UTC(2026, 9, 11, 0, 45, 26));
  assert.equal(cbTime('soon'), null); assert.equal(cbTime(null), null);
});

test('directory and stations', () => {
  const nets = parseNetworks({ networks: [
    { id: 'velib', name: 'Vélib\' Métropole', location: { latitude: 48.856, longitude: 2.352, city: 'Paris', country: 'FR' }, company: ['Smovengo'] },
    { id: 'broken', location: {} },
  ] });
  assert.deepEqual(nets, [{ id: 'velib', name: 'Vélib\' Métropole', company: 'Smovengo', city: 'Paris', country: 'FR', lat: 48.856, lon: 2.352 }]);
  const [a, b] = parseStations({ network: { stations: [
    { id: 'x1', name: 'Argenson', latitude: 48.8886, longitude: 2.2642, timestamp: '2026-10-11T00:45:26.48+00:00Z', free_bikes: 11, empty_slots: 13, extra: { renting: 1, returning: 1, slots: 25, ebikes: 5 } },
    { id: 'x2', name: 'Closed', latitude: 48.9, longitude: 2.3, free_bikes: 0, empty_slots: 4, extra: { renting: 0 } },
    { id: 'bad', latitude: null, longitude: 2 },
  ] } });
  assert.deepEqual([a.bikes, a.ebikes, a.docks, a.total, a.renting], [11, 5, 13, 25, true]);
  assert.deepEqual([b.total, b.renting, b.ebikes], [4, false, null]);
});

test('station states and nearby systems', () => {
  assert.equal(stationState({ renting: false, bikes: 5 }), 'offline');
  assert.equal(stationState({ bikes: 0, docks: 10 }), 'empty');
  assert.equal(stationState({ bikes: 12, docks: 0, total: 12 }), 'full');
  assert.equal(stationState({ bikes: 2, docks: 10, total: 12 }), 'low');
  assert.equal(stationState({ bikes: 9, docks: 10, total: 19 }), 'ok');
  assert.equal(stationState({ bikes: 1, docks: 0, virtual: true }), 'low', 'a virtual station is never full');
  const list = [{ id: 'far', lat: 52.5, lon: 13.4 }, { id: 'near', lat: 48.86, lon: 2.35 }, { id: 'nearer', lat: 48.85, lon: 2.3 }];
  assert.deepEqual(networksNear(list, 48.85, 2.31, 40).map(n => n.id), ['nearer', 'near']);
});
