// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepare, countryAt, inRing, mainBox, mainBoxWrapped, boxContains, boxCentre, boxWidth, offCoast, coastDistance } from '../src/core/borders.js';

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

test('a crossing main part keeps one box: Russia is centred over Siberia, not the North Sea', () => {
  const ru = borders.find(b => b.iso === 'RU'), bx = mainBoxWrapped(ru);
  assert.ok(bx[0] > 20 && bx[0] < 35 && bx[2] > 185 && bx[2] < 195, `RU spans its mainland, east past 180: ${bx}`);
  const [lon, lat] = boxCentre(bx);
  assert.ok(lon > 95 && lon < 120 && lat > 55 && lat < 65, `centre ${lon}, ${lat}`);
  assert.ok(boxWidth(bx) < 170, 'about 163 degrees wide, not 360');
  // inside: Moscow, Yakutsk, Chukotka (west of 180 and east of it); outside: the North Sea, Alaska, the Atlantic, Mendocino
  for (const [la, lo] of [[55.75, 37.6], [62, 129.7], [66, -172], [65, 178]]) assert.ok(boxContains(bx, la, lo), `${la}, ${lo} in`);
  for (const [la, lo] of [[57, 3], [64.8, -147.7], [45, -28], [40.4, -125.6], [57, -147]]) assert.ok(!boxContains(bx, la, lo, 1.5), `${la}, ${lo} out`);
  // every other main box is the flat one, and every box is west < east and under 300 degrees
  for (const b of borders) {
    const w = mainBoxWrapped(b); assert.ok(w[0] < w[2] && w[2] - w[0] < 300 && w[1] < w[3], b.iso);
    if (b.iso !== 'RU') assert.deepEqual(w, mainBox(b), b.iso);
  }
});

test('box helpers read a crossing box written west > east the same as one running past 180', () => {
  const a = [170, -20, -170, -10], b = [170, -20, 190, -10];
  for (const [la, lo, inside] of [[-15, 175, true], [-15, -175, true], [-15, 180, true], [-15, 0, false], [-15, 160, false], [-5, 175, false]]) {
    assert.equal(boxContains(a, la, lo), inside, `${la}, ${lo}`); assert.equal(boxContains(b, la, lo), inside, `${la}, ${lo}`);
  }
  assert.deepEqual(boxCentre(a), [-180, -15]); assert.deepEqual(boxCentre(b), [-180, -15]); assert.deepEqual(boxCentre([10, 0, 20, 10]), [15, 5]);
  assert.equal(boxWidth(a), 20); assert.equal(boxWidth(b), 20);
  assert.ok(boxContains([10, 0, 20, 10], 11, 21, 1.5) && !boxContains([10, 0, 20, 10], 11, 22, 1.5), 'the pad grows every side');
});

test('off its coast: at sea, near one of its parts, and nearer it than any other country', () => {
  const of = iso => borders.find(b => b.iso === iso);
  assert.equal(offCoast(borders, of('US'), 51, -178), true, 'the Aleutian trench is off Alaska');
  assert.equal(offCoast(borders, of('RU'), 51, -178), false, '... not off Russia, although its wrapped box reaches past 180');
  assert.equal(offCoast(borders, of('JP'), 42.5, 144.5), true, "off Hokkaido's Pacific coast is Japan's");
  assert.equal(offCoast(borders, of('RU'), 42.5, 144.5), false, '... not the Kurils\'');
  assert.equal(offCoast(borders, of('FJ'), -18, -178.5), true, 'the Fiji region east of 180');
  assert.equal(offCoast(borders, of('US'), 39.1, -94.6), false, 'on land is not off a coast');
  assert.equal(offCoast(borders, of('US'), 30, -40), false, 'mid-Atlantic is nobody\'s coast');
  assert.ok(coastDistance(of('RU'), 51, -178) > 10, 'Russia is far from the Aleutians');
  assert.equal(coastDistance(of('FR'), -18, -178.5), Infinity, 'a country nowhere near: no part looked at');
});
