// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Where is it now?" (src/core/whereis.js): the catalogue and its two searches, an asteroid's elements read by byte range
// (checked against decoding the whole packed file), the H-G magnitude, and the state from the Sun and from Earth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogue, indexCatalogue, findBody, quickIndex, findQuick, fold, recordRanges, elementsFromBytes, fileRecords, RECORD_BYTES, hgMagnitude, stateAt, lightWords, distanceWords, seeingWords, IAU_NAMES, DWARF_PLANETS } from '../src/core/whereis.js';
import { viewSmallBodies, decodeElements } from '../src/core/smallbodies.js';
import { planetPosition, earthPosition } from '../src/core/planets.js';
import { planetFromEarth, SKY_PLANETS } from '../src/core/solarsys.js';
import { PHYSICAL } from '../src/core/planets.js';
import { positionAt } from '../src/core/kepler.js';

const root = new URL('../', import.meta.url);
const json = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const small = json('data/solar/small_bodies.json'), craft = json('data/solar/spacecraft.json'), moons = json('data/solar/moons.json').moons;

test('whereis: an asteroid read with seven byte ranges is the asteroid the whole file decodes to', () => {
  const buf = readFileSync(new URL('data/solar/asteroids_a.bin', root)), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), view = viewSmallBodies(ab);
  assert.equal(fileRecords(small, 'a'), view.N); assert.equal(buf.length, view.N * RECORD_BYTES);
  for (const name of ['1 Ceres', '4 Vesta', '433 Eros', '134340 Pluto']) {
    const row = small.named.find(n => n[2] === name); assert.equal(row[0], 'a', name);
    const parts = Object.fromEntries(recordRanges(view.N, row[1]).map(([k, off, n]) => [k, new Uint8Array(buf.subarray(off, off + n))]));
    assert.deepEqual(elementsFromBytes(parts, small.epoch_jd), decodeElements(view, row[1], small.epoch_jd), name);
  }
  assert.throws(() => recordRanges(10, 10), RangeError);
  assert.deepEqual(recordRanges(100, 7).map(r => r[1]), [28, 414, 614, 814, 1014, 1214, 1407]);
  const ceres = small.named.find(n => n[2] === '1 Ceres'), el = decodeElements(view, ceres[1], small.epoch_jd);
  assert.ok(Math.abs(el.a - 2.77) < 0.01 && Math.abs(el.e - 0.079) < 0.002, 'Ceres: a 2.77 AU, e 0.079');
});

test('whereis: the catalogue, the fuzzy search for short lists and the quick one for 28,000 names', () => {
  const short = indexCatalogue(catalogue({ planets: SKY_PLANETS.map(key => ({ key, name: PHYSICAL[key].name })), moons, craft }));
  assert.equal(findBody(short, 'jupiter')[0].key, 'jupiter'); assert.equal(findBody(short, 'Jupitr')[0].key, 'jupiter', 'a typo');
  assert.equal(findBody(short, 'Webb')[0].key, 'craft:James Webb Space Telescope'); assert.equal(findBody(short, 'titan')[0].ref.moonOf, 'saturn');
  assert.equal(findBody(short, 'the Moon')[0].key, 'moon');
  const items = catalogue({ small }), qi = quickIndex(items);
  assert.equal(items.length, small.named.length + small.comets.length + 1, 'and the Moon, always');
  const top = q => findQuick(qi, q)[0];
  assert.equal(top('Pluto').key, 'ast:134340 Pluto'); assert.equal(top('Pluto').kind, 'dwarf planet');
  assert.equal(top('99942').name, '99942 Apophis'); assert.equal(top('Halley').key, 'comet:1P/Halley'); assert.equal(top('67P').kind, 'comet');
  assert.equal(top('Sedna').kind, 'trans-Neptunian object'); assert.equal(top('Bennu').kind, 'asteroid');
  assert.equal(findQuick(qi, 'Eros').length, 1, 'an exact name is the answer'); assert.ok(findQuick(qi, 'Erossz').length >= 1, 'else names that start so');
  assert.deepEqual(findQuick(qi, 'x'), []); assert.deepEqual(findQuick(qi, 'qqqqqqzz'), []);
  for (const d of DWARF_PLANETS) assert.equal(top(d).kind, 'dwarf planet', d);
  assert.equal(fold('  Šteins / 2867 '), 'steins 2867');
});

test('whereis: the state from the Sun and Earth agrees with the planets module; light, distance and magnitude in words', () => {
  const jd = 2461315.25, s = stateAt(j => planetPosition('mars', j), j => earthPosition(j), jd), p = planetFromEarth('mars', jd);
  assert.ok(Math.abs(s.earth_au - p.earth_au) < 1e-9 && Math.abs(s.sun_au - p.sun_au) < 1e-9);
  assert.ok(Math.abs(s.elongation - p.elongation) < 1e-6 && Math.abs(s.phase_deg - p.phase_angle) < 1e-6);
  assert.ok(s.speed_km_s > 21 && s.speed_km_s < 27, `Mars moves 22-26.5 km/s: ${s.speed_km_s}`);
  const earth = stateAt(j => earthPosition(j), j => ({ x: 0, y: 0, z: 0 }), jd);   // Earth seen from the Sun: 29-30 km/s
  assert.ok(earth.speed_km_s > 29 && earth.speed_km_s < 30.5);
  assert.equal(stateAt(() => null, earthPosition, jd), null);
  assert.deepEqual([1.28, 499, 8000, 90000, 200000].map(lightWords), ['1.3 light-seconds', '8.3 light-minutes', '2.2 light-hours', '25 light-hours', '2.3 light-days']);
  assert.equal(distanceWords(0.0025), '373,995 km'); assert.equal(distanceWords(1.5), '224 million km'); assert.match(distanceWords(170), /^170 AU \(25\.4 billion km\)$/);
  assert.deepEqual([5, 8, 12, 15, 21].map(seeingWords), ['', 'binoculars', 'a small telescope', 'a large amateur telescope', 'a research telescope']);
  // Ceres at opposition (r 2.6, delta 1.6, phase ~0) is about magnitude 6.9; Vesta near 5.5
  assert.ok(Math.abs(hgMagnitude(3.34, 2.6, 1.6, 2) - 6.9) < 0.3); assert.ok(Math.abs(hgMagnitude(3.25, 2.2, 1.2, 5) - 5.6) < 0.4);
  assert.ok(hgMagnitude(3.34, 2.6, 1.6, 40) > hgMagnitude(3.34, 2.6, 1.6, 2), 'fainter away from opposition');
  assert.equal(hgMagnitude(null, 1, 1, 0), null);
});

test('whereis: the IAU names cover every constellation figure, and Pluto by its elements sits where it should', () => {
  const figs = json('data/constellations.json').figures;
  assert.equal(Object.keys(IAU_NAMES).length, 88); assert.deepEqual(figs.map(f => f.id).filter(id => !IAU_NAMES[id]), []);
  assert.equal(IAU_NAMES.Ari, 'Aries'); assert.equal(IAU_NAMES.CrB, 'Corona Borealis');
  const buf = readFileSync(new URL('data/solar/asteroids_a.bin', root)), view = viewSmallBodies(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const pluto = small.named.find(n => n[2] === '134340 Pluto'), el = decodeElements(view, pluto[1], small.epoch_jd);
  const r = Math.hypot(...Object.values(positionAt(el, 2461315.25, {})).slice(0, 3));
  assert.ok(r > 35 && r < 36.5, `Pluto in late 2026 is ~35.7 AU from the Sun: ${r}`);
});
