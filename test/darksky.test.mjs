// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Dark skies in words (src/core/darksky.js) on the real grids: what a city and a dark-sky park mean for the eye, the
// nearest darker sky found on land (not offshore), the Moon and clouds in "how good is tonight", the gear picker's reach,
// and the overlay's colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeAtlas, skyAt, mcdFromSqm, NATURAL_MCD } from '../src/core/lightpollution.js';
import { parseDeepsky } from '../src/core/deepsky.js';
import { prepare, countryAt } from '../src/core/borders.js';
import { darkWindow } from '../src/core/sky.js';
import {
  nelmFromSqm, starsVisible, skyWords, bearing, qLimit, nearestDark, nearestDarker, darkText, moonOver, tonightQuality,
  GEAR, gearLimits, surfaceBrightness, withinReach, describe, deepSkyTonight, overlayTable, paintAtlas, paintTile,
} from '../src/core/darksky.js';

const file = p => readFileSync(new URL(`../${p}`, import.meta.url));
const grid = await decodeAtlas(file('data/lightpollution.bin'));
const ALL = parseDeepsky(JSON.parse(file('data/deepsky.json')));
const B = prepare(JSON.parse(file('data/borders.json')));
const land = (la, lo) => !!countryAt(B, lo, la);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const T0 = Date.parse('2026-10-14T16:00:00Z');

test('darksky: the eye under a sky: limiting magnitude and star counts', () => {
  near(nelmFromSqm(22), 6.6, 0.1, 'a pristine sky shows stars to ~6.6');
  near(nelmFromSqm(18), 4.0, 0.15, 'a city sky to ~4');
  assert.ok(nelmFromSqm(21) > nelmFromSqm(20));
  near(starsVisible(6.6), 4000, 800, 'a few thousand stars in a dark sky');
  assert.ok(starsVisible(4) < 300 && starsVisible(4) > 100, 'a couple of hundred in a city');
  for (let m = 0; m < 7; m += 0.5) assert.ok(starsVisible(m + 0.5) >= starsVisible(m), 'more stars with a deeper limit');
});

test('darksky: a city and a dark-sky park in words', () => {
  const city = skyWords(skyAt(grid, 51.507, -0.128)), park = skyWords(skyAt(grid, 41.66, -77.82));   // London, Cherry Springs
  assert.ok(city.bortle >= 8); assert.equal(city.milkyWay, 'none'); assert.match(city.text, /^Bortle \d, an inner-city sky|^Bortle 8, a city sky/);
  assert.match(city.text, /times brighter than a natural sky/);
  assert.ok(park.bortle <= 2); assert.equal(park.milkyWay, 'bright'); assert.match(park.text, /nearly natural|no measurable/);
  assert.ok(park.stars > 10 * city.stars);
});

test('darksky: the nearest darker sky is on land, near, and the right way', () => {
  assert.ok(qLimit(grid, 3) < qLimit(grid, 4) && qLimit(grid, 4) < qLimit(grid, 9));
  near(bearing(51.5, 0, 52.5, 0), 0, 1e-6, 'north'); near(bearing(0, 0, 0, 10), 90, 1e-6, 'east');
  const den = nearestDark(grid, 39.74, -104.99, { land });   // Denver: the Rockies to the west
  assert.ok(den && den.km < 150 && den.bortle <= 3, JSON.stringify(den));
  assert.ok(den.bearing > 180 && den.bearing < 300, 'west of Denver');
  assert.ok(land(den.lat, den.lon));
  assert.ok(skyAt(grid, den.lat, den.lon).bortle <= 4, 'the place it names is dark (bilinear blur aside)');
  const lon = nearestDarker(grid, 51.507, -0.128, { land });   // London: mid-Wales, across the country, not the North Sea
  assert.ok(lon && !lon.fallback && lon.km > 150 && lon.km < 350 && lon.dir.includes('W'), JSON.stringify(lon));
  const off = nearestDark(grid, 51.507, -0.128, { maxKm: 1000 });   // without the land test the sea wins
  assert.ok(!land(off.lat, off.lon), 'offshore');
  assert.deepEqual(nearestDark(grid, 41.66, -77.82).here, true);
  assert.match(darkText(den), /^The nearest dark sky \(Bortle [123]\) is about \d+ km to the (west|west-south-west|west-north-west|south-west)/);
  assert.match(darkText(null), /No Bortle 3 or 4 sky within 1,000 km/);
  assert.match(darkText({ ...lon, fallback: true, bortle: 4 }), /^No Bortle 3 sky within 1,000 km on land\. The nearest darker one \(Bortle 4\)/);
  assert.equal(nearestDark(grid, -75, 0), null, 'outside the atlas');
});

test('darksky: the Moon over the night and "how good is tonight"', () => {
  const lat = 39.74, lon = -104.99;
  const full = moonOver(lat, lon, darkWindow(lat, lon, Date.parse('2026-10-26T00:00:00Z'))), fresh = moonOver(lat, lon, darkWindow(lat, lon, Date.parse('2026-10-10T00:00:00Z')));
  assert.ok(full.lit > 0.9 && full.upHours > 6, `full Moon up most of the night: ${full.lit} ${full.upHours}`);
  assert.ok(fresh.lit < 0.15, `a thin Moon: ${fresh.lit}`);
  assert.ok(full.moonless < 3);
  const park = skyAt(grid, 41.66, -77.82), city = skyAt(grid, 51.507, -0.128), clear = { mean: 5, clear: [{ from: 0, to: 1 }] }, cloudy = { mean: 95, clear: [] };
  const best = tonightQuality({ sky: park, moon: fresh, clouds: clear });
  assert.equal(best.word, 'excellent'); assert.match(best.text, /^Tonight: excellent\. A Bortle [12] sky, .*clear skies\.$/);
  assert.ok(tonightQuality({ sky: park, moon: full, clouds: clear }).score < best.score, 'the full Moon costs');
  assert.equal(tonightQuality({ sky: park, moon: fresh, clouds: cloudy }).word, 'not worth it');
  assert.ok(['poor', 'not worth it'].includes(tonightQuality({ sky: city, moon: fresh, clouds: clear }).word));
  assert.match(tonightQuality({ sky: park, moon: fresh }).text, /no cloud forecast yet/);
  near(tonightQuality({ sky: park, moon: full, clouds: clear }).sqm, 18.5, 0.8, 'a full Moon high brightens a dark sky to ~SQM 18.5');
});

test('darksky: the gear picker reaches deeper, and a bright sky hides faint glows', () => {
  const dark = 21.9, city = 18.0, m = n => ALL.find(o => o.m === n);
  for (const sqm of [dark, city]) assert.ok(gearLimits('eyes', sqm).maxMag < gearLimits('binoculars', sqm).maxMag && gearLimits('binoculars', sqm).maxMag < gearLimits('scope', sqm).maxMag);
  assert.ok(gearLimits('scope', city).maxMag < gearLimits('scope', dark).maxMag, 'the class shifts the limit');
  const n = (g, s) => withinReach(ALL, g, s).length;
  assert.ok(n('eyes', dark) < n('binoculars', dark) && n('binoculars', dark) < n('scope', dark));
  assert.ok(n('scope', city) < n('scope', dark) / 3, `a city sky hides most: ${n('scope', city)} vs ${n('scope', dark)}`);
  const ids = (g, s) => new Set(withinReach(ALL, g, s).map(o => o.id));
  assert.ok(ids('eyes', dark).has(m(31).id), 'Andromeda by eye from a dark site');
  assert.ok(!ids('eyes', city).has(m(31).id), 'not from a city');
  assert.ok(ids('scope', city).has(m(57).id), 'the Ring Nebula (small and bright) through a scope in town');
  assert.ok(!ids('scope', city).has(m(101).id), 'the Pinwheel (big and faint) is lost in a city sky');
  assert.ok(ids('scope', dark).has(m(101).id));
  assert.ok(surfaceBrightness(m(101)) > surfaceBrightness(m(57)));
  assert.equal(surfaceBrightness({ mag: 5, maj: null }), null);
  assert.equal(describe(m(13)), 'Globular cluster in Hercules · mag 5.8 · 17′ across');
  assert.match(describe(m(31)), /^Galaxy in Andromeda · mag 3\.4 · 3° across$/);
  assert.deepEqual(Object.keys(GEAR), ['eyes', 'binoculars', 'scope']);
});

test('darksky: deep sky tonight is well placed, within reach and labelled', () => {
  const lat = 41.66, lon = -77.82, list = deepSkyTonight(ALL, lat, lon, T0, { gear: 'binoculars', sqm: 21.9 });
  assert.ok(list.length === 30, `a full list from a dark site: ${list.length}`);
  for (const v of list) {
    assert.ok(v.alt >= 25 && v.obj.mag <= gearLimits('binoculars', 21.9).maxMag);
    assert.match(v.label, /^(M \d+|NGC|IC|Cl|ESO|Mel|C )/); assert.match(v.dir, /^[NESW]{1,3}$/); assert.ok(v.text.includes(' in '));
  }
  assert.ok(list.some(v => v.obj.m === 31), 'Andromeda is up on an October night');
  assert.ok(!list.some(v => v.obj.m === 7), 'M7 (far south, a summer object) is not');
  const city = deepSkyTonight(ALL, 51.507, -0.128, T0, { gear: 'eyes', sqm: 17.7 });
  assert.ok(city.length < 6, `few from a city by eye: ${city.map(v => v.label)}`);
});

test('darksky: overlay colours by class, clear where dark; tiles in Web Mercator', () => {
  const t = overlayTable(grid);
  assert.equal(t[3], 0, 'byte 0 (no light) is clear');
  const qAt = sqm => Math.round((Math.log10(mcdFromSqm(sqm) - NATURAL_MCD) - grid.log0) / grid.qstep + 1);
  assert.equal(t[qAt(21.95) * 4 + 3], 0, 'Bortle 2 is clear'); assert.ok(t[qAt(17.0) * 4 + 3] > 200, 'a city centre is strong');
  const img = paintAtlas(grid, 360, 145);
  assert.equal(img.length, 360 * 145 * 4);
  const px = (lat, lon) => img[(Math.floor((grid.lat0 - lat) / 1) * 360 + Math.floor(lon + 180)) * 4 + 3];
  assert.ok(px(51.5, -0.1) > 150, 'London glows'); assert.equal(px(-30, -140), 0, 'the South Pacific is dark');
  const tile = paintTile(grid, 6, 31, 21, 64);   // the tile over London at zoom 6 (64 px)
  assert.equal(tile.length, 64 * 64 * 4);
  let lit = 0; for (let i = 3; i < tile.length; i += 4) if (tile[i] > 0) lit++;
  assert.ok(lit > 64 * 64 * 0.3, `south-east England is mostly lit: ${lit}`);
});
