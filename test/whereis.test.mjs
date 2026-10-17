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

// ---------------------------------------------------------------- ISRO's missions (JPL Horizons, brand/tools/make_spacecraft.py)
import { trackPosition, localPosition, inLocal, missionPhase, missionsNow, moonCenterAt, lagrangeL1L2 } from '../src/core/craft.js';
import { AU_KM } from '../src/core/units.js';
import { moonGeocentric } from '../src/core/planets.js';
import { jdFromMs } from '../src/core/time.js';
const ORBITS = json('test/fixtures/horizons_isro_orbits.json');

test('whereis: ISRO missions are found by name, alias and agency', () => {
  const short = indexCatalogue(catalogue({ craft })), key = q => findBody(short, q)[0]?.key;
  assert.equal(key('Chandrayaan-2'), 'craft:Chandrayaan-2'); assert.equal(key('chandrayaan 2'), 'craft:Chandrayaan-2');
  assert.equal(key('Chandrayaan'), 'craft:Chandrayaan-2', 'the one still flying');
  assert.equal(key('Chandrayaan-1'), 'craft:Chandrayaan-1'); assert.equal(key('Chandrayaan-3'), 'craft:Chandrayaan-3 propulsion module');
  assert.equal(key('Vikram'), 'craft:Vikram lander (Chandrayaan-3)'); assert.equal(key('Aditya'), 'craft:Aditya-L1'); assert.equal(key('aditya l1'), 'craft:Aditya-L1');
  assert.equal(key('Mangalyaan'), 'craft:Mars Orbiter Mission'); assert.equal(key('ISRO Aditya-L1'), 'craft:Aditya-L1');
  const isro = craft.filter(c => c.agency === 'ISRO').map(c => c.name);
  assert.deepEqual(isro, ['Chandrayaan-2', 'Chandrayaan-3 propulsion module', 'Vikram lander (Chandrayaan-3)', 'Aditya-L1', 'Mars Orbiter Mission', 'Chandrayaan-1']);
});

test('whereis: the Moon and Mars orbiters fly within a few hundred km of Horizons around their body, and Chandrayaan-2 around the Moon', () => {
  const by = Object.fromEntries(craft.map(c => [c.name, c]));
  const tol = { 'Chandrayaan-2': 150, 'Mars Orbiter Mission': 350, 'Chandrayaan-3 propulsion module': 40 };
  for (const [name, { center, rows }] of Object.entries(ORBITS.craft)) {
    const c = by[name]; assert.equal(c.local.center, center, name); assert.ok(rows.length > 20);
    let worst = 0; for (const [t, x, y, z] of rows) { const p = localPosition(c, t); worst = Math.max(worst, Math.hypot(p.x * AU_KM - x, p.y * AU_KM - y, p.z * AU_KM - z)); }
    assert.ok(worst < tol[name], `${name}: ${worst.toFixed(0)} km off Horizons`);
    assert.deepEqual(c.local.pj, [], 'no perijove sets: only Juno has them');
  }
  // Chandrayaan-2 on 2026-10-12: about 100 km over the Moon, the Moon's distance from Earth, with the Moon's centre the MCP uses
  const ch2 = by['Chandrayaan-2'], jd = jdFromMs(Date.UTC(2026, 9, 12)), E = earthPosition(jd), m = moonGeocentric(jd);
  const l = localPosition(ch2, jd), alt = Math.hypot(l.x, l.y, l.z) * AU_KM - PHYSICAL.moon.radiusKm;
  assert.ok(inLocal(ch2, jd) && alt > 40 && alt < 200, `${alt.toFixed(0)} km up`);
  const s = stateAt(j => trackPosition(ch2, j, {}, moonCenterAt), j => earthPosition(j), jd), moonKm = Math.hypot(m.x, m.y, m.z) * AU_KM;
  assert.ok(Math.abs(s.earth_km - moonKm) < 2000, `${Math.round(s.earth_km)} km vs the Moon's ${Math.round(moonKm)}`);
  const p = trackPosition(ch2, jd, {}, moonCenterAt), q = moonCenterAt('moon', jd);
  assert.ok(Math.abs(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) * AU_KM - Math.hypot(l.x, l.y, l.z) * AU_KM) < 1e-3, 'on its orbit around that Moon');
  assert.equal(moonCenterAt('mars', jd), null, 'planet-centred tracks keep their samples');
  // the MCP list: Chandrayaan-2 is the nearest mission, at the Moon's distance
  const list = missionsNow(craft, jd, E, moonCenterAt);
  assert.equal(list[0].name, 'Chandrayaan-2'); assert.ok(Math.abs(list[0].au * AU_KM - moonKm) < 2000);
});

test('whereis: Aditya-L1 rides near Sun-Earth L1; the ended missions have honest edges', () => {
  const by = Object.fromEntries(craft.map(c => [c.name, c])), jd = jdFromMs(Date.UTC(2026, 9, 12)), E = earthPosition(jd), { L1 } = lagrangeL1L2(E);
  const a = trackPosition(by['Aditya-L1'], jd), d = Math.hypot(a.x - E.x, a.y - E.y, a.z - E.z) * AU_KM;
  assert.ok(d > 1.1e6 && d < 1.9e6, `${Math.round(d)} km from Earth`); assert.ok(Math.hypot(a.x - L1.x, a.y - L1.y, a.z - L1.z) * AU_KM < 9e5, 'within its halo orbit of L1');
  assert.ok(Math.hypot(a.x, a.y, a.z) < Math.hypot(E.x, E.y, E.z), 'sunward of Earth');
  const ch1 = by['Chandrayaan-1'];
  assert.equal(trackPosition(ch1, jdFromMs(Date.UTC(2012, 0, 1))), null, 'no track between the 2009 silence and the 2016 radar find');
  assert.equal(missionPhase(ch1, jd), 'beyond the data'); assert.match(ch1.status, /^Silent since 2009/);
  assert.equal(by['Mars Orbiter Mission'].status, 'Ended 2022'); assert.equal(trackPosition(by['Mars Orbiter Mission'], jd), null);
  const vik = by['Vikram lander (Chandrayaan-3)'], landed = jdFromMs(Date.UTC(2023, 7, 23, 12, 32));
  assert.ok(vik.end_jd < landed && trackPosition(vik, landed, {}, moonCenterAt) === null, 'never drawn flying after it landed');
  assert.ok(vik.events.some(e => Math.abs(e[0] - landed) < 1e-3 && /Shiv Shakti/.test(e[1])));
  for (const c of craft.filter(x => x.agency === 'ISRO')) assert.ok(c.launch_jd < c.t0_jd && c.events[0][1] === 'Launch', c.name);
});
