// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Solar System view growth: comets on any conic, spacecraft tracks, "where is it now?" search, share links and sky
// position. Positions are checked against JPL Horizons (test/fixtures/horizons_solar_2026-10-12.json, made by
// brand/tools/make_solar_fixture.py). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AU_KM, DEG } from '../src/core/units.js';
import { earthPosition, planetPosition } from '../src/core/planets.js';
import {
  GM_SUN, cometFromRow, cometPosition, cometVelocity, conicInPlane, solveHyperbolic, solveBarker, cometNames, cometClass,
  cometPeriodYears, activity, ionTail, dustTail, dustDays, cometsNearNow, conicArc, stateToConic, perihelionPassages,
} from '../src/core/comets.js';
import { trackPosition, trackSpeed, escaping, missionPhase, eventsAround, relativeTime, sampleIndex, lightSeconds, lagrangeL1L2, missionsNow } from '../src/core/craft.js';
import { craftAt } from '../src/core/sky.js';
import { normalize, editDistance, buildIndex, search, mergeResults, kindRank } from '../src/core/search.js';
import { encodeSolarView, decodeSolarView, isoMinute, parseIsoMinute } from '../src/core/solarlink.js';
import { skyPosition, skyPhrase, nearestConstellation, angularSep, formatRaDec, raDecOf } from '../src/core/skyplace.js';
import { jdFromMs } from '../src/core/time.js';

const root = new URL('../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root)));
const F = read('test/fixtures/horizons_solar_2026-10-12.json');
const SB = read('data/solar/small_bodies.json');
const CRAFT = read('data/solar/spacecraft.json');
const FIG = read('data/constellations.json').figures;
const dist = (p, a) => Math.hypot(p.x - a[0], p.y - a[1], p.z - a[2]);
const row = label => SB.comets.find(r => r[0].startsWith(label));

// ---------------------------------------------------------------- comets

test('comets: conic solvers satisfy their equations', () => {
  for (const [M, e] of [[0.3, 1.5], [-4, 1.01], [250, 6.14], [1e-6, 1.0001], [-1e4, 3]]) {
    const H = solveHyperbolic(M, e);
    assert.ok(Math.abs(e * Math.sinh(H) - H - M) < 1e-9 * Math.max(1, Math.abs(M)), `M ${M} e ${e}`);
  }
  for (const W of [0, 0.5, -3, 40, -1e5]) { const s = solveBarker(W); assert.ok(Math.abs(s ** 3 + 3 * s - W) < 1e-9 * Math.max(1, Math.abs(W))); }
  // at perihelion every conic sits at q on +x
  for (const e of [0.5, 1, 1.8]) {
    const p = conicInPlane({ q: 0.7, e, tp: 100 }, 100);
    assert.ok(Math.abs(p.x - 0.7) < 1e-12 && Math.abs(p.y) < 1e-12 && Math.abs(p.r - 0.7) < 1e-12, `e ${e}`);
  }
  // vis-viva on each kind of orbit: v^2 = GM (2/r - 1/a), with 1/a = (1 - e)/q (0 for a parabola)
  for (const e of [0.3, 1, 2.2]) {
    const c = { q: 1.1, e, i: 0.4, node: 1, peri: 2, tp: 0 }, jd = 37, p = cometPosition(c, jd), v = cometVelocity(c, jd);
    const r = Math.hypot(p.x, p.y, p.z), v2 = v.x * v.x + v.y * v.y + v.z * v.z;
    assert.ok(Math.abs(v2 - GM_SUN * (2 / r - (1 - e) / 1.1)) < 1e-12, `vis-viva e ${e}`);
  }
});

test('comets: state vectors back to elements, for every kind of conic and a reduced GM', () => {
  for (const [label, mu] of [['2P/', undefined], ['1P/', undefined], ['C/2025 N1', undefined], ['C/2023 A3', undefined], ['67P/', GM_SUN * 0.4]]) {
    const c = { ...cometFromRow(row(label)), mu }, jd = 2461325.5, r = cometPosition(c, jd), v = cometVelocity(c, jd);
    const k = stateToConic(r, v, jd, mu ?? GM_SUN);
    for (const t of [jd - 50, jd, jd + 400]) {
      const a = cometPosition(c, t), b = cometPosition(k, t);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-8 * Math.max(1, Math.hypot(a.x, a.y, a.z)), `${label} at ${t}`);
    }
  }
  // a circle in the ecliptic (node and perihelion undefined): still the same path
  const k = stateToConic({ x: 1, y: 0, z: 0 }, { x: 0, y: Math.sqrt(GM_SUN), z: 0 }, 0), p = cometPosition(k, 91.3);
  assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 1e-9 && p.y > 0.99);
});

test('comets: position and velocity match a numerical derivative and the elliptic Kepler path', () => {
  const c = cometFromRow(row('2P/'));
  const a = cometPosition(c, 1000 - 1e-3), b = cometPosition(c, 1000 + 1e-3), v = cometVelocity(c, 1000);
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs((b[k] - a[k]) / 2e-3 - v[k]) < 1e-7, k);
});

test('comets: against JPL Horizons on 2026-10-12 (two-body from SBDB elements)', () => {
  // relative error allowed; the elements' epochs differ (Halley's solution is from 1968, 67P's from 2015, before
  // a Jupiter approach), so planetary perturbations since then are the error, not the maths
  const TOL = { '1P/Halley': 0.01, '67P/Churyumov-Gerasimenko': 0.1 };
  for (const [label, st] of Object.entries(F.comets)) {
    const r = row(label); assert.ok(r, label + ' is in small_bodies.json');
    const p = cometPosition(cometFromRow(r), F.comets_jd), rr = Math.hypot(st[0], st[1], st[2]);
    const rel = dist(p, st) / rr;
    assert.ok(rel < (TOL[label] ?? 0.003), `${label}: ${(rel * 100).toFixed(3)} % of r off`);
  }
  // the interstellar 3I/ATLAS on its hyperbola, to 0.1 %
  const i3 = cometFromRow(row('C/2025 N1')), st = F.comets['C/2025 N1'];
  assert.ok(dist(cometPosition(i3, F.comets_jd), st) < 0.01);
  const v = cometVelocity(i3, F.comets_jd); assert.ok(Math.hypot(v.x - st[3], v.y - st[4], v.z - st[5]) / Math.hypot(st[3], st[4], st[5]) < 0.002);
});

test('comets: names people use, classes and periods', () => {
  assert.equal(cometNames('1P/Halley').display, 'Halley');
  assert.deepEqual(cometNames('67P/Churyumov-Gerasimenko').aliases.slice(0, 1), ['67P']);
  assert.equal(cometNames('C/1995 O1 (Hale-Bopp)').display, 'Hale-Bopp');
  assert.equal(cometNames('C/2025 N1 (ATLAS)').display, '3I/ATLAS');
  assert.equal(cometNames('C/2025 R2 (SWAN)').display, 'SWAN (C/2025 R2)');
  assert.ok(cometNames('C/2025 R2 (SWAN)').aliases.includes('C/2025 R2'));
  assert.equal(cometNames('P/2026 N2').display, 'P/2026 N2');
  assert.equal(cometNames('240P/NEAT').display, '240P/NEAT');            // a numbered comet with a survey's name keeps its number
  assert.equal(cometNames('12P/Pons-Brooks').display, 'Pons-Brooks');
  assert.equal(cometClass(cometFromRow(row('2P/'))), 'Jupiter-family comet');
  assert.equal(cometClass(cometFromRow(row('1P/'))), 'Halley-type comet');
  assert.equal(cometClass(cometFromRow(row('C/1995 O1'))), 'long-period comet');
  assert.equal(cometClass(cometFromRow(row('C/2025 N1'))), 'interstellar visitor');
  assert.ok(Math.abs(cometPeriodYears(cometFromRow(row('1P/'))) - 75.3) < 1);
  assert.equal(cometPeriodYears({ q: 1, e: 1.2 }), Infinity);
});

test('comets: tails point away from the Sun, the dust tail curves behind, both shrink far out', () => {
  assert.equal(activity(0.5), 1); assert.equal(activity(6), 0); assert.ok(activity(2) > activity(4) && activity(4) > 0);
  const c = cometFromRow(row('1P/')), jd = 2446469.97 - 20;   // 20 days before Halley's 1986 perihelion
  const p = cometPosition(c, jd), v = cometVelocity(c, jd), r = Math.hypot(p.x, p.y, p.z), out = { x: p.x / r, y: p.y / r, z: p.z / r };
  const ion = ionTail(p, v), cosIon = ion.dir.x * out.x + ion.dir.y * out.y + ion.dir.z * out.z;
  assert.ok(cosIon > Math.cos(10 * DEG), 'ion tail within 10 degrees of anti-sunward');
  assert.ok(cosIon < Math.cos(0.5 * DEG), 'and bent a little by the comet\'s own motion (aberration)');
  assert.ok(ion.length > 0.1 && ion.length <= 0.6);
  assert.ok(ionTail({ x: 4.5, y: 0, z: 0 }, { x: 0, y: 0.008, z: 0 }).length < ion.length / 10);
  const pts = dustTail(c, jd, { days: 30, n: 7 });
  assert.equal(pts.length, 21);
  assert.ok(Math.hypot(pts[0] - p.x, pts[1] - p.y, pts[2] - p.z) < 1e-12, 'starts at the nucleus');
  const tip = { x: pts[18], y: pts[19], z: pts[20] };
  assert.ok(Math.hypot(tip.x, tip.y, tip.z) > r + 0.01, 'grains feel less gravity: they stay farther out than the comet falls');
  const back = { x: tip.x - p.x, y: tip.y - p.y, z: tip.z - p.z }, bl = Math.hypot(back.x, back.y, back.z);
  assert.ok((back.x * v.x + back.y * v.y + back.z * v.z) / bl / Math.hypot(v.x, v.y, v.z) < 0, 'the dust trails behind the comet');
  assert.ok(dustDays(0.6) === 60 && dustDays(3) < 5 && dustDays(6) === 0);
  // a sungrazer just past perihelion (q = 0.0057 AU): grains spread along their own orbits, the tail stays bounded
  const sg = cometFromRow(row('C/2026 A1')), d = dustTail(sg, sg.tp + 10, { days: 60, n: 12 }), s0 = cometPosition(sg, sg.tp + 10);
  for (let k = 0; k < 12; k++) assert.ok(Math.hypot(d[k * 3] - s0.x, d[k * 3 + 1] - s0.y, d[k * 3 + 2] - s0.z) < 3, 'within 3 AU of the nucleus');
});

test('comets: perihelion passages (two-body estimate): Halley in 1910, 1986 and 2061', () => {
  const h = cometFromRow(row('1P/')), yr = jd => 2000 + (jd - 2451545) / 365.25;
  const t = perihelionPassages(h, 2415020, 2480000).map(yr);   // 1900 .. 2078
  assert.equal(t.length, 3);
  assert.ok(Math.abs(t[0] - 1910.3) < 0.6 && Math.abs(t[1] - 1986.1) < 0.01 && Math.abs(t[2] - 2061.6) < 0.6, t.join());
  const i3 = cometFromRow(row('C/2025 N1'));
  assert.equal(perihelionPassages(i3, 2460000, 2462000).length, 1);
  assert.equal(perihelionPassages(i3, 2462000, 2470000).length, 0);
});

test('comets: the ones near the Sun now, and arcs of open orbits', () => {
  const jd = F.comets_jd, E = earthPosition(jd), near = cometsNearNow(SB.comets, jd, E, { maxR: 3, limit: 50 });
  assert.ok(near.length >= 5, `${near.length} comets inside 3 AU`);
  for (let k = 1; k < near.length; k++) assert.ok(near[k].score >= near[k - 1].score);
  for (const n of near) assert.ok(n.r < 3 && n.delta > 0 && !/^\d*D\/|-[A-Z]{1,2}( |$)/.test(n.row[0]), n.row[0]);
  const arc = conicArc(cometFromRow(row('C/2025 N1')), jd - 365, jd + 365, 64);
  assert.equal(arc.length, 192);
  const mid = conicArc(cometFromRow(row('C/2025 N1')), 2460977.99, 2460977.99, 2);
  assert.ok(Math.abs(Math.hypot(mid[0], mid[1], mid[2]) - 1.3564) < 1e-3, '3I/ATLAS at perihelion, q = 1.356 AU');
});

test('comets: small_bodies.json keeps recent open-orbit comets for the view, elliptic ones for the point cloud', () => {
  const open = SB.comets.filter(r => r[2] >= 1);
  assert.ok(open.length > 20 && open.length < 300);
  for (const r of open) assert.ok(Math.abs(r[6] - SB.epoch_jd) < 3 * 365.25 + 1 || /^(C\/2023 A3|C\/2025 N1)/.test(r[0]), r[0]);
});

// ---------------------------------------------------------------- spacecraft

test('spacecraft: every track is well formed, with agency, status and sorted events', () => {
  assert.ok(CRAFT.length >= 20);
  const names = new Set();
  for (const c of CRAFT) {
    assert.ok(!names.has(c.name)); names.add(c.name);
    assert.equal(c.xyz.length, c.n * 3, c.name);
    assert.ok(Math.abs(c.t0_jd + (c.n - 1) * c.step_days - c.end_jd) < 1e-6, c.name);
    assert.ok(c.agency && c.status && Array.isArray(c.alias), c.name);
    assert.ok(c.launch_jd <= c.t0_jd + 1, c.name);
    for (let k = 1; k < c.events.length; k++) assert.ok(c.events[k][0] >= c.events[k - 1][0], c.name + ' events in order');
  }
  for (const n of ['Juno', 'James Webb Space Telescope', 'BepiColombo', 'Cassini', 'Rosetta', 'Dawn', 'Galileo', 'Ulysses']) assert.ok(names.has(n), n);
});

test('spacecraft: cubic interpolation against JPL Horizons half-way between samples', () => {
  const by = Object.fromEntries(CRAFT.map(c => [c.name, c]));
  for (const [name, { jd, state }] of Object.entries(F.craft)) {
    const c = by[name], p = trackPosition(c, jd), km = dist(p, state) * AU_KM;
    // Juno loops Jupiter faster than its 3-day samples: within 2 % of its ~8 million km orbit; the rest within
    // 2,500 km (the samples are rounded to 1e-5 AU = 1,500 km)
    const tol = name === 'Juno' ? 2.5e5 : 2500;
    assert.ok(km < tol, `${name}: ${Math.round(km)} km off`);
    const lin = craftAt(c, jd); assert.ok(lin && dist(lin, state) * AU_KM < tol, 'sky.js craftAt uses the same path');
  }
  // speed: Horizons' velocity vector vs our derivative
  const pk = F.craft['Parker Solar Probe'], v = trackSpeed(by['Parker Solar Probe'], pk.jd), vh = Math.hypot(...pk.state.slice(3)) * AU_KM / 86400;
  assert.ok(Math.abs(v - vh) / vh < 0.01, `Parker ${v.toFixed(2)} vs ${vh.toFixed(2)} km/s`);
});

test('spacecraft: who coasts on past the data and who stops', () => {
  const by = Object.fromEntries(CRAFT.map(c => [c.name, c]));
  for (const n of ['Voyager 1', 'Voyager 2', 'Pioneer 10', 'New Horizons']) assert.ok(escaping(by[n]), n + ' is leaving the Sun');
  for (const n of ['Cassini', 'Galileo', 'Rosetta', 'Hera', 'Psyche']) assert.ok(!escaping(by[n]), n);
  const v1 = by['Voyager 1'], far = v1.end_jd + 3652.5;
  assert.equal(missionPhase(v1, far), 'coasting');
  const p = trackPosition(v1, far); assert.ok(Math.hypot(p.x, p.y, p.z) > 200, 'Voyager 1 beyond 200 AU in 2044');
  const cas = by.Cassini;
  assert.equal(trackPosition(cas, cas.end_jd + 30), null);
  assert.equal(missionPhase(cas, cas.end_jd + 30), 'beyond the data');
  assert.equal(missionPhase(cas, cas.launch_jd - 1), 'before launch');
  assert.equal(missionPhase(cas, 2453000), 'flying');
  assert.equal(trackPosition(cas, cas.t0_jd - 1), null);
  // Cassini near Saturn while in orbit there (2005-05-16; its orbits then reached ~80 Saturn radii, 0.03 AU)
  const sat = planetPosition('saturn', 2453501.5), cp = trackPosition(cas, 2453501.5);
  assert.ok(Math.hypot(cp.x - sat.x, cp.y - sat.y, cp.z - sat.z) < 0.06);
});

test('spacecraft: JWST rides about 1.5 million km from Earth, near L2 (anti-sunward)', () => {
  const j = CRAFT.find(c => c.name === 'James Webb Space Telescope'), jd = F.comets_jd, p = trackPosition(j, jd), E = earthPosition(jd);
  const d = Math.hypot(p.x - E.x, p.y - E.y, p.z - E.z) * AU_KM;
  assert.ok(d > 1.0e6 && d < 1.9e6, `${Math.round(d)} km`);
  const r = Math.hypot(E.x, E.y, E.z), cos = ((p.x - E.x) * E.x + (p.y - E.y) * E.y + (p.z - E.z) * E.z) / (d / AU_KM * r);
  assert.ok(cos > Math.cos(35 * DEG), 'on the night side of Earth, away from the Sun');
});

test('spacecraft: events, countdowns, light time and the flown/ahead split', () => {
  const c = CRAFT.find(x => x.name === 'Europa Clipper'), jd = jdFromMs(Date.UTC(2026, 9, 12));
  const { last, next } = eventsAround(c, jd);
  assert.equal(last[1], 'Mars gravity assist'); assert.equal(next[1], 'Earth gravity assist');
  assert.ok(next[0] > jd && next[0] - jd < 120);
  assert.equal(relativeTime(0.01), 'now');
  assert.equal(relativeTime(3), 'in 3 days');
  assert.equal(relativeTime(-0.5), '12 hours ago');
  assert.equal(relativeTime(90), 'in 3 months');
  assert.equal(relativeTime(-500), '1 year 4 months ago');
  assert.equal(relativeTime(365.25 * 30), 'in 30 years');
  assert.ok(Math.abs(lightSeconds(1) - 499.005) < 0.01);
  assert.equal(sampleIndex(c, c.t0_jd - 10), 0);
  assert.equal(sampleIndex(c, c.end_jd + 10), c.n - 1);
  assert.equal(sampleIndex(c, c.t0_jd + 2.5 * c.step_days), 2);
  const v1 = CRAFT.find(x => x.name === 'Voyager 1'), E = earthPosition(jd), p = trackPosition(v1, jd);
  const hours = lightSeconds(Math.hypot(p.x - E.x, p.y - E.y, p.z - E.z)) / 3600;
  assert.ok(hours > 23 && hours < 24.5, `Voyager 1 signal ${hours.toFixed(2)} h (it passes one light-day in late 2026)`);
});

test('spacecraft: Sun-Earth L1 and L2, and the missions list', () => {
  const E = earthPosition(F.comets_jd), { L1, L2 } = lagrangeL1L2(E), r = Math.hypot(E.x, E.y, E.z);
  for (const L of [L1, L2]) { const km = Math.hypot(L.x - E.x, L.y - E.y, L.z - E.z) * AU_KM; assert.ok(Math.abs(km - 1.5e6) < 0.03e6 * (r / 1) + 3e4, `${km}`); }
  assert.ok(Math.hypot(L1.x, L1.y, L1.z) < r && Math.hypot(L2.x, L2.y, L2.z) > r);
  // JWST is within 1 million km of L2 (its halo orbit is ~800,000 km across)
  const j = trackPosition(CRAFT.find(c => c.name === 'James Webb Space Telescope'), F.comets_jd);
  assert.ok(Math.hypot(j.x - L2.x, j.y - L2.y, j.z - L2.z) * AU_KM < 1e6);
  const list = missionsNow(CRAFT, F.comets_jd, E);
  assert.equal(list.length, CRAFT.length);
  assert.equal(list[0].name, 'James Webb Space Telescope');                     // the nearest, at L2
  const v1 = list.find(m => m.name === 'Voyager 1'); assert.ok(v1.light > 23 * 3600);
  for (let k = 1; k < list.length; k++) assert.ok((list[k].au ?? Infinity) >= (list[k - 1].au ?? Infinity));
  assert.equal(list.find(m => m.name === 'Cassini').au, null);                   // no position after 2017
});

// ---------------------------------------------------------------- search

const ITEMS = [
  { key: 'sun', name: 'Sun', kind: 'star', weight: 100 },
  ...['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'].map(n => ({ key: n.toLowerCase(), name: n, kind: 'planet', weight: 90 })),
  { key: 'moon', name: 'Moon', kind: 'moon', weight: 90 }, { key: 'titan', name: 'Titan', kind: 'moon', weight: 60 },
  { key: 'io', name: 'Io', kind: 'moon', weight: 60 }, { key: 'europa', name: 'Europa', kind: 'moon', weight: 60 },
  { key: 'pluto', name: 'Pluto', kind: 'dwarf planet', weight: 80 }, { key: 'ceres', name: 'Ceres', kind: 'dwarf planet', weight: 60 },
  ...CRAFT.map(c => ({ key: 'craft:' + c.name, name: c.name, kind: 'spacecraft', aliases: c.alias, weight: 50 })),
  ...SB.comets.map(r => { const n = cometNames(r[0]); return { key: 'comet:' + r[0], name: n.display, kind: 'comet', aliases: n.aliases }; }),
  ...SB.named.slice(0, 3000).map(n => ({ key: 'ast:' + n[2], name: n[2], kind: 'asteroid' })),
  { key: 'star:Sirius', name: 'Sirius', kind: 'star' }, { key: 'exo:TRAPPIST-1', name: 'TRAPPIST-1', kind: 'exoplanet system' },
];
const IDX = buildIndex(ITEMS);
const top = q => search(IDX, q, 5)[0]?.key;

test('search: normalising and edit distance', () => {
  assert.equal(normalize('  Churyumov–Gerasimenko (67P) '), 'churyumov gerasimenko 67p');
  assert.equal(normalize('Ça Va'), 'ca va');
  assert.equal(editDistance('jupiter', 'jupitre'), 1);   // a swap is one edit
  assert.equal(editDistance('saturn', 'saturn'), 0);
  assert.equal(editDistance('mars', 'venus', 2), 3);      // capped early
  assert.equal(kindRank('exoplanet system'), kindRank('exoplanet'));
  assert.ok(kindRank('main-belt asteroid') === kindRank('asteroid') && kindRank('galaxy cluster') === kindRank('galaxy'));
});

test('search: ranking puts the obvious answer first', () => {
  assert.equal(top('mars'), 'mars');
  assert.equal(top('MARS'), 'mars');
  assert.equal(top('sat'), 'saturn');                                 // a planet before any asteroid starting "Sat"
  assert.equal(top('jupitr'), 'jupiter');                             // a typo
  assert.equal(top('nepture'), 'neptune');
  assert.equal(top('voyager1'), 'craft:Voyager 1');                   // no space
  assert.equal(top('voyager 2'), 'craft:Voyager 2');
  assert.equal(top('jwst'), 'craft:James Webb Space Telescope');      // alias
  assert.equal(top('webb'), 'craft:James Webb Space Telescope');
  assert.equal(top('osiris-rex'), 'craft:OSIRIS-APEX');
  assert.equal(top('67p'), 'comet:67P/Churyumov-Gerasimenko');
  assert.equal(top('halley'), 'comet:1P/Halley');
  assert.equal(top('1p'), 'comet:1P/Halley');
  assert.equal(top('hale bopp'), 'comet:C/1995 O1 (Hale-Bopp)');
  assert.equal(top('3i'), 'comet:C/2025 N1 (ATLAS)');
  assert.equal(top('ceres'), 'ceres');                                // the dwarf planet, not "1 Ceres" the asteroid entry
  assert.equal(top('io'), 'io');
  assert.equal(top('sirius'), 'star:Sirius');
  assert.equal(top('trappist'), 'exo:TRAPPIST-1');
  assert.equal(top('eros'), 'ast:433 Eros');                          // word inside a numbered name
  assert.ok(!search(IDX, '67p', 12).some(r => /^\d+ /.test(r.name)), 'no numbered asteroid just for containing "67" then "p"');
  assert.deepEqual(search(IDX, 'm', 5), []);                          // one letter is too little
  assert.deepEqual(search(IDX, 'zzzzqqq', 5), []);
});

test('search: results are ordered and limited, and merging keeps the best of each', () => {
  const r = search(IDX, 'ju', 10);
  assert.ok(r.length <= 10 && r[0].key === 'jupiter');
  for (let k = 1; k < r.length; k++) assert.ok(r[k].score <= r[k - 1].score);
  const m = mergeResults([[{ key: 'a', name: 'A', score: 5 }], [{ key: 'a', name: 'A', score: 9 }, { key: 'b', name: 'B', score: 7 }], [{ key: 'c', name: 'a', score: 1 }]], 5);
  assert.deepEqual(m.map(x => [x.key, x.score]), [['a', 9], ['b', 7]]);
});

// ---------------------------------------------------------------- share links

test('share link: round trip, live and hand-written links', () => {
  const jd = jdFromMs(Date.UTC(2026, 9, 12, 6, 0));
  const h = encodeSolarView({ focus: 'craft:Voyager 1', jd, dist: 0.0012345, rate: 1 });
  assert.equal(h, 'f=craft%3AVoyager+1&t=2026-10-12T06%3A00&r=1&d=0.00123');
  const v = decodeSolarView('#' + h);
  assert.equal(v.focus, 'craft:Voyager 1'); assert.ok(Math.abs(v.jd - jd) < 1e-6); assert.equal(v.rate, 1); assert.equal(v.dist, 0.00123);
  const live = decodeSolarView('#' + encodeSolarView({ focus: 'comet:C/2020 F3 (NEOWISE)', jd: null, dist: 2 }));
  assert.equal(live.focus, 'comet:C/2020 F3 (NEOWISE)'); assert.equal(live.jd, null); assert.equal(live.rate, null);
  assert.deepEqual(decodeSolarView('#q=halley'), { focus: null, query: 'halley', jd: null, rate: null, dist: null });
  assert.equal(isoMinute(2451545), '2000-01-01T12:00');
  assert.equal(parseIsoMinute('2000-01-01T12:00Z'), 2451545);
  assert.equal(parseIsoMinute('2000-01-01'), 2451544.5);
});

test('share link: nothing in a hash is trusted', () => {
  assert.equal(decodeSolarView(''), null);
  assert.equal(decodeSolarView('#foo=bar'), null);
  assert.equal(decodeSolarView('#f=<script>alert(1)</script>'), null);
  assert.equal(decodeSolarView('#f=' + 'x'.repeat(200)), null);
  const v = decodeSolarView('#f=mars&t=1066-10-14T09:00&d=-5&r=1e9');
  assert.equal(v.focus, 'mars'); assert.equal(v.jd, null); assert.equal(v.dist, null); assert.equal(v.rate, null);
  assert.equal(decodeSolarView('#f=mars&t=2026-13-01').jd, null);
  assert.equal(decodeSolarView('#f=mars&t=2026-10-12&r=NaN').rate, null);
  assert.equal(decodeSolarView('#q=a'), null);
  assert.equal(encodeSolarView({ focus: 'bad<key>', query: 'mars' }), 'q=mars');
});

// ---------------------------------------------------------------- sky position

test('sky position: elongation, evening or morning, and the constellation it is in front of', () => {
  const jd = F.comets_jd, E = earthPosition(jd);
  // the Sun's direction is 0 degrees from the Sun; the opposite point is up all night
  const anti = { x: E.x * 2, y: E.y * 2, z: E.z * 2 }, o = skyPosition(anti, E);
  assert.ok(o.elong > 179.9); assert.equal(skyPhrase(o), 'up all night, opposite the Sun');
  assert.equal(skyPhrase({ elong: 10, east: true }), 'lost in the Sun\'s glare');
  assert.equal(skyPhrase({ elong: 30, east: true }), 'low in the west after sunset');
  assert.equal(skyPhrase({ elong: 70, east: false }), 'in the morning sky');
  // Jupiter in mid-October 2026 is a morning object in Cancer/Leo, ~57 degrees west of the Sun
  const J = planetPosition('jupiter', jd), j = skyPosition(J, E);
  assert.ok(!j.east && j.elong > 50 && j.elong < 65, JSON.stringify(j));
  assert.equal(skyPhrase(j), 'in the morning sky');
  assert.equal(nearestConstellation(j.ra, j.dec, FIG).id, 'Leo');
  // the nearest stick figure, not the IAU boundary: the galactic centre (in Sagittarius) is nearest Ophiuchus' figure
  assert.ok(['Sgr', 'Sco', 'Oph'].includes(nearestConstellation(266.4, -28.9, FIG).id));
  const ori = nearestConstellation(88.79, 7.41, FIG);   // Betelgeuse is a vertex of Orion's figure
  assert.ok(ori.id === 'Ori' && ori.sep < 1e-3);
  assert.ok(Math.abs(angularSep(0, 0, 90, 0) - 90) < 1e-9 && Math.abs(angularSep(10, 89.9, 190, 89.9) - 0.2) < 1e-6);
  assert.equal(formatRaDec({ ra: 266.4, dec: -28.94 }), 'RA 17h 46m, Dec −29°');
  assert.equal(formatRaDec({ ra: 359.999, dec: 5 }), 'RA 0h 00m, Dec +5°');
  const pole = raDecOf(0, Math.sin(23.4392911 * DEG), Math.cos(23.4392911 * DEG));
  assert.ok(pole.dec > 89.999, 'the celestial pole in ecliptic coordinates comes out at Dec +90');
});

// ---------------------------------------------------------------- comet brightness (SBDB M1/K1)

import { cometMagnitude, cometMagnitudeAt, cometPeak, brightComets, cometsComing, seeingWords, orbitFresh } from '../src/core/comets.js';
const MAGS = read('test/fixtures/horizons_comet_mags.json');

test('comets: total magnitudes match JPL Horizons T-mag where the orbit is fresh; stale orbits are flagged', () => {
  let checked = 0;
  for (const { label, rows } of MAGS.comets) {
    const c = cometFromRow(row(label));
    assert.ok(c.m1 != null && c.k1 != null && c.epoch > 2.4e6, label);
    for (const [d, tmag, r, delta] of rows) {
      const jd = +d.slice(2);
      // the formula alone, on Horizons' own distances: exact
      assert.ok(Math.abs(cometMagnitude(c, r, delta) - tmag) < 0.006, `${label} formula ${cometMagnitude(c, r, delta)} vs ${tmag}`);
      if (!orbitFresh(c, jd)) continue;
      // our two-body orbit and Earth: within 0.1 mag of Horizons' integration
      assert.ok(Math.abs(cometMagnitudeAt(c, jd) - tmag) < 0.1, `${label} ${d}: ${cometMagnitudeAt(c, jd).toFixed(2)} vs ${tmag}`);
      checked++;
    }
  }
  assert.ok(checked >= 15, `${checked} fresh comparisons`);
  // 16P/Brooks 2 (2016 elements, 1.5 AU off now) and 67P (2015, a Jupiter pass since) must not count as fresh
  assert.equal(orbitFresh(cometFromRow(row('16P/')), jdFromMs(Date.UTC(2026, 9, 12))), false);
  assert.equal(orbitFresh(cometFromRow(row('67P/')), jdFromMs(Date.UTC(2026, 9, 12))), false);
  assert.equal(orbitFresh(cometFromRow(row('2P/')), jdFromMs(Date.UTC(2026, 9, 12))), true);
  assert.equal(cometMagnitude({ m1: null, k1: 4 }, 1, 1), null);
});

test('comets: the peak of an apparition and the "bright now" and "coming up" lists', () => {
  // 2P/Encke's 2027 return: Horizons has it at 13.8 on 2027-02-19 (r 0.43 AU); its peak is near that perihelion
  const enc = cometFromRow(row('2P/')), pk = cometPeak(enc, jdFromMs(Date.UTC(2026, 9, 1)), jdFromMs(Date.UTC(2027, 5, 1)));
  assert.ok(Math.abs(pk.jd - enc.tp - Math.round((pk.jd - enc.tp) / (cometPeriodYears(enc) * 365.25)) * cometPeriodYears(enc) * 365.25) < 20, 'near a perihelion');
  assert.ok(pk.mag < cometMagnitudeAt(enc, jdFromMs(Date.UTC(2026, 9, 12))) && pk.mag < 13.8 + 0.1);
  // the minimum really is one: a day either side is fainter
  assert.ok(cometMagnitudeAt(enc, pk.jd - 1) >= pk.mag - 1e-9 && cometMagnitudeAt(enc, pk.jd + 1) >= pk.mag - 1e-9);
  const jd = jdFromMs(Date.UTC(2026, 9, 12)), now = brightComets(SB.comets, jd, { maxMag: 16, limit: 20 });
  assert.ok(now.length >= 1);
  for (let i = 1; i < now.length; i++) assert.ok(now[i].mag >= now[i - 1].mag);
  for (const n of now) { assert.ok(orbitFresh(n.c, jd) && n.mag <= 16 && !/^\d*D\//.test(n.row[0])); if (n.peak) assert.ok(n.peak.mag <= n.mag + 1e-9); }
  assert.ok(!now.some(n => n.row[0].startsWith('16P/')), 'a stale orbit never makes the list');
  const soon = cometsComing(SB.comets, jd, { days: 1100, maxMag: 12 });
  for (let i = 1; i < soon.length; i++) assert.ok(soon[i].peak.jd >= soon[i - 1].peak.jd);
  for (const s of soon) assert.ok(s.peak.mag <= 12 && s.peak.jd > jd && s.peak.jd < jd + 1100);
  assert.equal(seeingWords(3), 'naked eye'); assert.equal(seeingWords(8), 'binoculars'); assert.equal(seeingWords(null), 'brightness unknown');
});

// ---------------------------------------------------------------- Juno around Jupiter (track.local)

import { localPosition, localOrbit, inLocal, periapses } from '../src/core/craft.js';
const PJ = read('test/fixtures/horizons_juno_perijoves.json');

test('craft: Juno on its osculating orbits follows Horizons through three perijoves (within 150 km over two days)', () => {
  const juno = CRAFT.find(c => c.name === 'Juno');
  assert.ok(juno.local && juno.local.center === 'jupiter' && juno.local.el.length > 4000 && juno.step_days === 1);
  for (const pass of PJ.passes) {
    let worst = 0, rmin = Infinity;
    for (const [t, x, y, z] of pass.rows) {
      const p = localPosition(juno, t); worst = Math.max(worst, Math.hypot(p.x * AU_KM - x, p.y * AU_KM - y, p.z * AU_KM - z));
      rmin = Math.min(rmin, Math.hypot(x, y, z));
    }
    assert.ok(worst < 150, `perijove ${pass.tp}: ${worst.toFixed(0)} km`);
    assert.ok(rmin < 90000 && rmin > 71492, 'a real skim over the cloud tops');   // Jupiter's equatorial radius 71,492 km
  }
  // the old 3-day heliocentric samples were ~200,000 km off near perijove; one day is the floor the local orbit beats
  const pj = periapses(juno);
  assert.ok(pj.length > 100 && pj.every((t, i) => i === 0 || t - pj[i - 1] > 25), 'one entry per perijove, 33-53 days apart');
  assert.ok(Math.abs(pj[0] - jdFromMs(Date.UTC(2016, 7, 27, 12, 50))) < 0.1, 'PJ1 2016-08-27 12:50 UT (NASA)');
  assert.ok(!inLocal(juno, jdFromMs(Date.UTC(2015, 0, 1))) && inLocal(juno, jdFromMs(Date.UTC(2026, 9, 12))));
});

test('craft: a planet-centred track rides the planet the caller draws; never carries a set across a perijove', () => {
  const juno = CRAFT.find(c => c.name === 'Juno'), t = jdFromMs(Date.UTC(2026, 9, 12));
  const helio = trackPosition(juno, t, {}), jup = planetPosition('jupiter', t, {});
  const local = trackPosition(juno, t, {}, (k, jd, out) => planetPosition(k, jd, out));
  const rel = localPosition(juno, t);
  assert.ok(Math.abs(local.x - jup.x - rel.x) < 1e-12 && Math.abs(local.z - jup.z - rel.z) < 1e-12);
  // the heliocentric samples differ by the planet formula's own error: JPL's approximate Jupiter is 0.5-0.9 million km
  // off Horizons' in 2020-2026, so on the samples Juno flew that far from the Jupiter on screen
  const off = Math.hypot(local.x - helio.x, local.y - helio.y, local.z - helio.z);
  assert.ok(off > 1e-4 && off < 0.008, `${off} AU`);
  // half a day before a perijove whose nearest daily set is after it: the set used is from before
  const L = juno.local, p = L.pj[40];
  for (const dt of [-0.6, -0.3, 0.3, 0.6]) {
    const o = localOrbit(juno, p.tp + dt); if (Math.abs(dt) * 24 <= 3) continue;
    const k = Math.round((p.tp + dt - L.t0_jd) / L.step_days), epoch = L.t0_jd + k * L.step_days;
    assert.ok(o.tp != null && ((epoch - p.tp) * dt > 0 || L.el.some((e, j) => e[5] === o.tp && (L.t0_jd + j - p.tp) * dt > 0)), `dt ${dt}`);
  }
  assert.equal(trackPosition(juno, t, {}, () => null) && true, true, 'no centre: back to the heliocentric samples');
});
