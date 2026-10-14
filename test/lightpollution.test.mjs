// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Light pollution at a spot (src/core/lightpollution.js) from data/lightpollution.bin, the 2015 World Atlas resampled
// to 1/15 deg: big cities come out as city skies, dark-sky parks as dark, the open ocean as pristine. The places' SQM
// values are from the atlas itself (and agree with published meter readings to a few tenths: Cherry Springs ~21.9,
// central London and Manhattan ~17-18), so the grid and its decoding are what is under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { decodeAtlas, loadAtlas, artificialAt, skyAt, sqmFromMcd, mcdFromSqm, bortleFromSqm, BORTLE, NATURAL_MCD } from '../src/core/lightpollution.js';

const FILE = new URL('../data/lightpollution.bin', import.meta.url);
const grid = await decodeAtlas(readFileSync(FILE));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('lightpollution: units and the Bortle scale', () => {
  near(sqmFromMcd(NATURAL_MCD), 22.0, 1e-4, 'the natural sky is 22.0 mag/arcsec²');
  near(sqmFromMcd(mcdFromSqm(18.3)), 18.3, 1e-9, 'round trip');
  near(sqmFromMcd(10 * NATURAL_MCD), 19.5, 1e-3, 'ten times brighter is 2.5 mag');
  assert.deepEqual([22.0, 21.99, 21.95, 21.8, 21.0, 20.0, 19.0, 18.5, 18.0, 17.0].map(bortleFromSqm), [1, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(BORTLE.length, 9);
});

test('lightpollution: the file is small, says where it came from, and decodes to its grid', () => {
  const size = statSync(FILE).size;
  assert.ok(size > 1e6 && size < 3e6, `about 1-3 MB for a phone: ${size}`);
  assert.equal(grid.cols * grid.rows, grid.cells.length);
  near(grid.step, 1 / 15, 1e-6, 'cell size');
  near(grid.lon0, -180, 1e-6, 'west edge'); near(grid.lat0 - grid.rows * grid.step, -60, 0.1, 'south edge');
  assert.match(grid.meta.source, /10\.5880\/GFZ\.1\.4\.2016\.001/);
  assert.match(grid.meta.licence, /CC BY-NC 4\.0/);
  assert.match(grid.meta.licence, /[Nn]on-commercial/);
});

test('lightpollution: loadAtlas fetches and decodes the same grid', async () => {
  const g = await loadAtlas('x', async () => new Response(readFileSync(FILE)));
  assert.deepEqual([g.cols, g.rows, g.cells[1234567]], [grid.cols, grid.rows, grid.cells[1234567]]);
  await assert.rejects(loadAtlas('x', async () => new Response('', { status: 404 })), /404/);
  await assert.rejects(decodeAtlas(new TextEncoder().encode('PNG\n{}\n')), /OOLP1/);
});

test('lightpollution: big cities are city skies', () => {
  for (const [name, lat, lon] of [['Manhattan', 40.758, -73.9855], ['Paris', 48.8566, 2.3522], ['London', 51.5074, -0.1278], ['Tokyo', 35.6812, 139.7671], ['Las Vegas Strip', 36.1147, -115.1728]]) {
    const s = skyAt(grid, lat, lon);
    assert.ok(s.bortle >= 8 && s.sqm < 18.4 && s.sqm > 16.5, `${name}: SQM ${s.sqm.toFixed(2)}, Bortle ${s.bortle}`);
    assert.ok(s.ratio > 20, `${name}: ${s.ratio.toFixed(0)}× the natural sky`);
  }
});

test('lightpollution: dark-sky parks are dark', () => {
  for (const [name, lat, lon, maxClass] of [['Cherry Springs State Park, PA', 41.6626, -77.8239, 2], ['NamibRand Nature Reserve', -24.95, 16.0, 1],
    ['Natural Bridges, UT', 37.6018, -110.0137, 1], ['Aoraki Mackenzie, NZ', -43.9856, 170.4648, 2], ['Galloway Forest Park', 55.1, -4.4, 2]]) {
    const s = skyAt(grid, lat, lon);
    assert.ok(s.bortle <= maxClass && s.sqm > 21.85, `${name}: SQM ${s.sqm.toFixed(2)}, Bortle ${s.bortle}`);
  }
  near(skyAt(grid, 41.6626, -77.8239).sqm, 21.93, 0.05, 'Cherry Springs');
});

test('lightpollution: the open ocean is pristine, the edges and the date line behave', () => {
  const pacific = skyAt(grid, 0, -150);
  assert.equal(pacific.artificial, 0); assert.equal(pacific.bortle, 1); near(pacific.sqm, 22.0, 1e-4, 'Pacific');
  assert.equal(skyAt(grid, 86, 0), null, 'north of the atlas');
  assert.equal(skyAt(grid, -61, 0), null, 'south of the atlas');
  near(artificialAt(grid, -16.5, 179.999), artificialAt(grid, -16.5, -180.001), 1e-3, 'Fiji across the date line');
  near(artificialAt(grid, 40.758, -73.9855), artificialAt(grid, 40.758, 286.0145), 1e-9, 'longitude wraps');
});
