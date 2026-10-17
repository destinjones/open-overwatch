// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The hazard layers across the 180° meridian (Fiji, Tonga, Chukotka, the Aleutians): one storm reported either side of
// the line stays one storm, a view there loads fire tiles from both sides, and one fire there stays one fire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distKm, sameStorm, mergeNhc, mergeGdacs, stormAgreement } from '../src/core/cyclones.js';
import { fireTilesWanted, fireTileDeg, lonWrap, lonBoxes } from '../src/core/hazards.js';
import { clusterFires, fireTilesAround } from '../src/core/fireclusters.js';

test('dateline: longitudes and spans wrap into [-180, 180]', () => {
  assert.equal(lonWrap(179.5 - -179.5), -1);
  assert.equal(lonWrap(-179.5 - 179.5), 1);
  assert.equal(lonWrap(10), 10); assert.equal(lonWrap(370), 10); assert.equal(lonWrap(-725), -5);
  assert.deepEqual(lonBoxes(176, 183), [[176, 180], [-180, -177]]);
  assert.deepEqual(lonBoxes(-183, -176), [[177, 180], [-180, -176]]);
  assert.deepEqual(lonBoxes(10, 20), [[10, 20]]);
  assert.deepEqual(lonBoxes(-100, 300), [[-180, 180]]);
  assert.deepEqual(lonBoxes(181, 185), [[-179, -175]]);
  assert.deepEqual(lonBoxes(-190, -185), [[170, 175]]);
});

test('dateline: a storm at 179.5°E and 179.5°W is ~106 km, not 38,000 km', () => {
  const a = { lat: -17, lon: 179.5 }, b = { lat: -17, lon: -179.5 };
  assert.ok(Math.abs(distKm(a, b) - 106.3) < 1, String(distKm(a, b)));
  assert.equal(distKm(a, b), distKm(b, a));
  assert.equal(sameStorm(a, b), true);
  // an EONET storm and an unnamed NHC fix either side of the line: one storm, with NHC's position
  const list = [{ kind: 'storm', id: 'e1', title: 'Tropical Cyclone 04F', src: 'NASA EONET', lat: -17, lon: 179.8, track: [], links: [], reports: [{ src: 'eonet', t: 1, lat: -17, lon: 179.8, agency: '' }] }];
  mergeNhc(list, [{ id: 'cp012026', name: 'One-C', title: 'Tropical Depression One-C', code: 'TD', lat: -17, lon: -179.9, kt: 30, advisory: '2026-10-17T12:00:00Z' }]);
  assert.equal(list.length, 1); assert.equal(list[0].lon, -179.9);
  assert.deepEqual(stormAgreement(list[0]).agreeing.sort(), ['eonet', 'nhc']);   // both place it there
  // GDACS's fix across the line joins the EONET storm (attach's 300 km fallback)
  const gl = [{ kind: 'storm', id: 'e2', title: 'Tropical Depression 04F', src: 'NASA EONET', lat: -17, lon: 179.8, track: [], links: [], reports: [] }];
  mergeGdacs(gl, [{ name: 'FOUR', nice: 'Four', lat: -17, lon: -179.7, kmh: 60, fc: { cone: [], forecast: [], past: [], points: [], source: 'JTWC' } }]);
  assert.equal(gl.length, 1);
});

test('dateline: a fire view at Suva/Taveuni gets tiles on both sides of the line', () => {
  const now = Date.UTC(2026, 9, 17, 12), cells = w => new Set(w.map(x => x.key.split('/').slice(3).join('/')));
  const last = Math.ceil(360 / fireTileDeg(5)) - 1;
  for (const lon of [179.6, -179.9]) {
    const w = fireTilesWanted(-16.9, lon, 3, 5, 4, now), c = cells(w), cols = new Set([...c].map(k => +k.split('/')[1]));
    assert.ok(cols.has(0) && cols.has(last), `${lon}: ${[...c]}`);
    assert.equal(w.length, c.size * 2 * 2);   // two satellites x two days, no tile twice
  }
  // the nearest first, by the wrapped distance: from 179.6°E the tiles just across the line beat ones far to the west
  const fiji = fireTilesWanted(-16.9, 179.6, 12, 4, 2, now), fcols = new Set(fiji.map(x => +x.key.split('/')[4]));
  assert.ok(fcols.has(0), [...fcols].join());
  // zoomed out (level 3, two tiles): a view on 179°E still gets the half across the line
  const z = fireTilesWanted(0, 179, 30, 3, 4, now), zc = new Set(z.map(x => +x.key.split('/')[4]));
  assert.ok(zc.has(0) && zc.has(Math.ceil(360 / fireTileDeg(3)) - 1), [...zc].join());
  // away from the line nothing changes (Adak and Anadyr now cover both sides; the middle of Africa one tile)
  assert.ok(fireTilesWanted(-10, 20, 2, 5, 4, now).every(x => [21, 22].includes(+x.key.split('/')[4])));
  assert.ok(new Set(fireTilesWanted(51.9, -176.6, 3, 5, 4, now).map(x => +x.key.split('/')[4])).has(last));
  // the web views and the MCP tool agree on the dateline
  assert.ok(new Set(fireTilesAround(-16.9, 179.6, 300).tiles.map(t => t.col)).has(0));
});

const F = (lat, lon, frp = 10) => ({ lat, lon, frp, t: Date.parse('2026-10-17T12:00:00Z'), day: true });
test('dateline: hot pixels 1 km apart across 180° are one fire, centred on the line', () => {
  const g = clusterFires([F(-16.85, 179.995), F(-16.85, -179.995)]);
  assert.equal(g.length, 1); assert.equal(g[0].count, 2);
  assert.ok(Math.abs(Math.abs(g[0].lon) - 180) < 0.01, String(g[0].lon));   // not near 0°
  assert.ok(g[0].km < 3, String(g[0].km));   // not ~40,000 km wide
  // weighted to the stronger side, which stays on its side of the line
  const w = clusterFires([F(-16.85, 179.99, 1), F(-16.85, -179.995, 100)]);
  assert.equal(w.length, 1); assert.ok(w[0].lon < -179.9 && w[0].lon >= -180, String(w[0].lon));
  // a chain across the line, and far apart still apart
  assert.equal(clusterFires([F(65, 179.98), F(65, 179.995), F(65, -179.99), F(65, -179.97)]).length, 1);
  assert.equal(clusterFires([F(-16.85, 179.9), F(-16.85, -179.9)]).length, 2);
  // the same pair away from the line, as before
  assert.equal(clusterFires([F(-16.85, 179.985), F(-16.85, 179.995)]).length, 1);
  // near the pole (few, wide columns) every pair is still checked once
  assert.equal(clusterFires([F(86.9, 0), F(86.9, 0.3), F(86.9, 179.99), F(86.9, -179.99)]).length, 2);
});
