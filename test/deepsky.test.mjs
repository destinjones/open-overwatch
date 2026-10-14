// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The deep-sky catalogue (data/deepsky.json, from OpenNGC) and src/core/deepsky.js: the Messier list is complete,
// famous objects sit where atlases put them, and "visible tonight" knows Andromeda is a northern-autumn object and
// Omega Centauri a southern one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeepsky, loadDeepsky, filterDeepsky, altAzOf, visibleTonight, label, TYPES } from '../src/core/deepsky.js';
import { gmst } from '../src/core/sky.js';
import { jdFromMs } from '../src/core/time.js';

const DOC = JSON.parse(readFileSync(new URL('../data/deepsky.json', import.meta.url), 'utf8'));
const ALL = parseDeepsky(DOC);
const byM = n => ALL.find(o => o.m === n), byId = id => ALL.find(o => o.id === id);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('deepsky: the file says what it is derived from and under which licence', () => {
  assert.equal(DOC.licence, 'CC-BY-SA-4.0');
  assert.match(DOC.note, /^CC-BY-SA-4\.0, derived from OpenNGC v\d{8}/);
  assert.equal(DOC.source.tag, DOC.note.match(/OpenNGC (v\d{8})/)[1]);
  for (const sha of Object.values(DOC.source.sha256)) assert.match(sha, /^[0-9a-f]{64}$/);
});

test('deepsky: every Messier object but M102 (a duplicate of M101 in OpenNGC), and about 2,400 objects in all', () => {
  const ms = new Set(ALL.filter(o => o.m).map(o => o.m));
  assert.deepEqual(Array.from({ length: 110 }, (_, i) => i + 1).filter(n => !ms.has(n)), [102]);
  assert.ok(ALL.length > 2000 && ALL.length < 3000, `${ALL.length} objects`);
  for (const o of ALL) {
    assert.ok(o.ra >= 0 && o.ra < 360 && o.dec >= -90 && o.dec <= 90, `${o.id} position`);
    assert.ok(TYPES[o.type], `${o.id}: type ${o.type} has a label`);
    assert.ok(o.m || o.mag == null || o.mag <= 12.5, `${o.id}: magnitude ${o.mag}`);
  }
});

test('deepsky: famous objects where the atlases put them', () => {
  const m31 = byM(31);
  assert.equal(m31.id, 'NGC 224'); assert.equal(m31.name, 'Andromeda Galaxy'); assert.equal(TYPES[m31.type].group, 'galaxy');
  near(m31.ra, 10.6847, 0.01, 'M31 RA'); near(m31.dec, 41.2689, 0.01, 'M31 Dec'); near(m31.mag, 3.4, 0.1, 'M31 mag');
  const m42 = byM(42); near(m42.ra, 83.82, 0.05, 'M42 RA'); near(m42.dec, -5.39, 0.05, 'M42 Dec');
  assert.equal(byM(45).name, 'Pleiades');
  assert.equal(byM(1).name, 'Crab Nebula');
  const omega = byId('NGC 5139'); assert.equal(omega.name, 'Omega Centauri'); assert.equal(omega.type, 'GCl');
  assert.equal(label(m31), 'M 31 (Andromeda Galaxy)'); assert.equal(label(omega), 'NGC 5139 (Omega Centauri)');
});

test('deepsky: filters by magnitude, group, type and Messier', () => {
  const bright = filterDeepsky(ALL, { maxMag: 6 });
  assert.ok(bright.length > 30 && bright.every(o => o.mag <= 6));
  const gc = filterDeepsky(ALL, { types: ['GCl'], messier: true });
  assert.ok(gc.length > 25 && gc.every(o => o.type === 'GCl' && o.m));
  const pn = filterDeepsky(ALL, { groups: ['planetary'], maxMag: 10 });
  assert.ok(pn.some(o => o.m === 57) && pn.every(o => o.type === 'PN'));
  assert.ok(!filterDeepsky(ALL).some(o => o.mag == null));
  assert.ok(filterDeepsky(ALL, { unknownMag: true }).some(o => o.name === 'Horsehead Nebula'));
});

test('deepsky: an object at the meridian at its own declination is overhead', () => {
  const ms = Date.UTC(2026, 9, 15, 22), m31 = byM(31);
  const lon = ((m31.ra - gmst(jdFromMs(ms))) % 360 + 540) % 360 - 180;
  near(altAzOf(m31, m31.dec, lon, ms).alt, 90, 0.01, 'zenith');
  near(altAzOf(m31, m31.dec - 30, lon, ms).alt, 60, 0.01, '30° south of it');
  near(altAzOf(m31, m31.dec - 30, lon, ms).az, 0, 0.01, 'due north');
});

test('deepsky: visible tonight in October from London and from Sydney', async () => {
  const t0 = Date.UTC(2026, 9, 15, 12), list = filterDeepsky(ALL, { maxMag: 7 });
  const london = visibleTonight(list, 51.5, -0.13, t0, { minAlt: 30 });
  const sydney = visibleTonight(list, -33.87, 151.21, t0, { minAlt: 30 });
  const has = (v, m) => v.some(x => x.obj.m === m || x.obj.id === m);
  assert.ok(has(london, 31) && !has(london, 'NGC 5139'), 'London: Andromeda, not Omega Centauri');
  assert.ok(!has(sydney, 31) && has(sydney, 'NGC 104'), 'Sydney: 47 Tucanae, Andromeda too low');
  const a = london.find(x => x.obj.m === 31);
  assert.ok(Math.abs(a.alt - (90 - 51.5 + a.obj.dec)) < 1 && a.from <= a.best && a.best <= a.to, `Andromeda culminates at 90° - lat + dec: ${a.alt.toFixed(1)}°`);
  for (let i = 1; i < london.length; i++) assert.ok(london[i - 1].obj.mag <= london[i].obj.mag, 'brightest first');
  assert.equal(visibleTonight(list, 51.5, -0.13, t0, { limit: 5 }).length, 5);
  assert.deepEqual(visibleTonight(list, 78.2, 15.6, Date.UTC(2026, 5, 21)), [], 'Svalbard at midsummer: no dark sky');
  const loaded = await loadDeepsky('x', async () => new Response(JSON.stringify(DOC)));
  assert.equal(loaded.length, ALL.length);
});
