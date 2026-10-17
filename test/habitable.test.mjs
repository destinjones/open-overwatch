// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Habitable zones (src/core/habitable.js, Kopparapu et al. 2014) against the exoplanet catalogue the Solar System view
// ships (data/solar/exoplanets.json): the conservative zone it stores, the optimistic one the view adds, and the
// labelled famous systems whose facts must agree with the card and the drawing. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KOPPARAPU, seff, habitableZone, systemZones, zoneOf, zoneCounts, zoneWords } from '../src/core/habitable.js';

const root = new URL('../', import.meta.url);
const E = JSON.parse(readFileSync(new URL('data/solar/exoplanets.json', root)));
const sys = host => E.list.find(s => s.host === host);
const planet = (host, suffix) => sys(host).pl.find(p => p[0] === suffix);

test('habitable zone: the Sun\'s zones are where Kopparapu et al. 2014 put them', () => {
  const c = habitableZone(0, 5780), o = habitableZone(0, 5780, 'optimistic');
  assert.ok(Math.abs(c[0] - 0.950) < 0.002 && Math.abs(c[1] - 1.676) < 0.002, JSON.stringify(c));   // their 0.95-1.67 AU
  assert.ok(Math.abs(o[0] - 0.750) < 0.002 && Math.abs(o[1] - 1.768) < 0.002, JSON.stringify(o));   // their 0.75-1.77 AU
  assert.ok(o[0] < c[0] && o[1] > c[1], 'the optimistic zone holds the conservative one');
  for (const k of Object.keys(KOPPARAPU)) assert.equal(seff(k, 1000), seff(k, 2600), 'below 2600 K the fit is clamped');
  assert.equal(seff('earlyMars', null), seff('earlyMars', 5780), 'no temperature: the Sun\'s');
  assert.equal(habitableZone(null, 5000), null);
});

test('habitable zone: the stored conservative zones are the same formula (to the 5-digit rounding of the file)', () => {
  let n = 0;
  for (const s of E.list) {
    if (!s.hz) continue;
    const h = habitableZone(s.lum, s.teff);
    for (const k of [0, 1]) assert.ok(Math.abs(h[k] / s.hz[k] - 1) < 0.005, `${s.host}: ${h[k]} vs ${s.hz[k]}`);
    n++;
  }
  assert.ok(n > 4000, `${n} systems with a zone`);
});

test('habitable zone: the famous systems the view labels agree with their facts', () => {
  const where = (host, sfx) => zoneOf(systemZones(sys(host)), planet(host, sfx)[1], !!planet(host, sfx)[11]);
  // "a sub-Neptune in the habitable zone", "two Earth-mass planets in the habitable zone": the optimistic one
  assert.equal(where('K2-18', 'b'), 'optimistic');
  assert.equal(where('Teegarden\'s Star', 'b'), 'optimistic');
  assert.equal(where('Teegarden\'s Star', 'c'), 'habitable');
  assert.equal(where('Kepler-452', 'b'), 'optimistic');
  assert.equal(where('Proxima Cen', 'b'), 'habitable');
  assert.deepEqual(zoneCounts(sys('TRAPPIST-1')), { habitable: 3, optimistic: 1 });   // "three of them in the habitable zone"
  // Kepler-186 f sits just past even the optimistic edge: its fact says "at the outer edge"
  const k186 = systemZones(sys('Kepler-186')), f = planet('Kepler-186', 'f')[1];
  assert.equal(where('Kepler-186', 'f'), '');
  assert.ok(f > k186.opt[1] && f < k186.opt[1] * 1.05, `${f} AU vs the outer edge ${k186.opt[1]}`);
  const text = readFileSync(new URL('src/solar/exoplanets.js', root), 'utf8');
  assert.match(text, /\['Kepler-186',[^\n]*outer edge of the habitable zone/);
  assert.doesNotMatch(text, /Kepler-186 f was the first Earth-sized planet found in a habitable zone/);
});

test('habitable zone: the card counts both zones', () => {
  assert.equal(zoneWords(sys('K2-18')), '2 (1 in the optimistic zone)');
  assert.equal(zoneWords(sys('Teegarden\'s Star')), '3 (1 in the habitable zone, 1 more in the optimistic zone)');
  assert.equal(zoneWords(sys('51 Peg')), '1');
  assert.equal(zoneWords({ pl: [['b', 1, 365, 0, 90, 1, 1, 255, 0, 2000, 'T', 0]], hz: [0.95, 1.68], lum: 0, teff: 5780 }), '1 (1 in the habitable zone)');
  assert.equal(zoneOf({ hz: null, opt: null }, 1, true), 'habitable', 'the catalogue\'s flag counts even without a zone');
  // a stored optimistic zone (files written by make_exoplanets.py from now on) wins over the computed one
  assert.deepEqual(systemZones({ hz: [1, 2], hz_opt: [0.5, 3], lum: 0, teff: 5780 }).opt, [0.5, 3]);
});

test('habitable zone: about 291 catalogue planets in the optimistic zone, 190 of them in the conservative one', () => {
  let habitable = 0, optimistic = 0, flagged = 0;
  for (const s of E.list) { const c = zoneCounts(s); habitable += c.habitable; optimistic += c.optimistic; flagged += s.pl.filter(p => p[11]).length; }
  assert.equal(habitable, flagged, 'the conservative count is the catalogue\'s own in_HZ flags');
  assert.ok(habitable >= 180 && habitable <= 200, `${habitable}`);
  assert.ok(habitable + optimistic >= 280 && habitable + optimistic <= 300, `${habitable + optimistic}`);
});
