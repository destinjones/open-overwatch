// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepare, countryAt, inRing, mainBox } from '../src/core/borders.js';

const borders = prepare(JSON.parse(readFileSync(new URL('../data/borders.json', import.meta.url), 'utf8')));
const facts = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url), 'utf8')).countries;
const at = (lon, lat) => (countryAt(borders, lon, lat) || {}).iso || null;

test('even-odd ring test, with a hole', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  assert.equal(inRing(square, 5, 5), true); assert.equal(inRing(square, 11, 5), false); assert.equal(inRing(square, 5, -1), false);
});

test('cities land in their countries', () => {
  const cities = { Tokyo: [139.7, 35.7, 'JP'], Paris: [2.35, 48.86, 'FR'], London: [-0.12, 51.5, 'GB'], Sydney: [151.2, -33.87, 'AU'], 'Cape Town': [18.42, -33.92, 'ZA'],
    Brasilia: [-47.9, -15.8, 'BR'], Delhi: [77.2, 28.6, 'IN'], Washington: [-77.04, 38.9, 'US'], Beijing: [116.4, 39.9, 'CN'], Cairo: [31.2, 30.04, 'EG'], Moscow: [37.6, 55.75, 'RU'],
    Amsterdam: [4.9, 52.37, 'NL'], Reykjavik: [-21.9, 64.15, 'IS'], Nairobi: [36.8, -1.29, 'KE'] };
  for (const [name, [lon, lat, iso]] of Object.entries(cities)) assert.equal(at(lon, lat), iso, name);
});

test('open ocean is nobody\'s', () => {
  assert.equal(at(-40, 30), null); assert.equal(at(-150, 0), null); assert.equal(at(80, -50), null);
});

test('every border has facts, and a sane main box', () => {
  for (const b of borders) {
    assert.ok(facts[b.iso], 'no facts for ' + b.iso);
    const [w, s, e, n] = mainBox(b); assert.ok(w < e && s < n && w >= -180 && e <= 180 && s >= -90 && n <= 90, b.iso);
  }
  assert.ok(borders.length > 180);
});

test('facts carry what the dossier prints', () => {
  for (const iso of ['US', 'JP', 'DE', 'BR', 'IN', 'NG']) { const f = facts[iso]; assert.ok(f.name && f.capital && f.pop > 1e6 && f.gdp > 1e10 && f.life > 40 && f.life < 95, iso); }
});

test('a country drawn across the antimeridian claims its own land only', () => {
  // Russia's mainland ring runs on into Chukotka (-170°): read flat, it was a band round the world over Canada and Alaska
  for (const [lon, lat, iso] of [[-66.4, 66.9, 'CA'], [-100, 60, 'CA'], [-115, 65, 'CA'], [-150, 64, 'US'], [-160, 66.5, 'US'], [-75, 45.4, 'CA']]) assert.equal(at(lon, lat), iso, `${lon},${lat}`);
  for (const [lon, lat] of [[-175, 66.5], [175, 67], [-179.5, 71.2], [37.6, 55.75], [135, 62]]) assert.equal(at(lon, lat), 'RU', `${lon},${lat}`);
  assert.equal(at(-170, 60), null, 'the Bering Sea');
  let ru = 0; for (let lat = 50; lat < 80; lat += 2) for (let lon = -140; lon < -60; lon += 4) if (at(lon, lat) === 'RU') ru++;
  assert.equal(ru, 0, "no grid point in Canada is Russia's");
});
