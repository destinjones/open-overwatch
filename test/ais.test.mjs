// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Ships from AIS (src/core/ais.js): Digitraffic parsers, AIS codes in words, motion between reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAisLocations, parseAisVessels, etaParts, etaTime, rotDegPerSec, shipKind, shipTypeName, flagOf, underway, shipAt, NAV_STATUS, cleanAisSentinels, aisstreamSocketUrl, AISSTREAM_UPSTREAM } from '../src/core/ais.js';
import { readFileSync } from 'node:fs';
import { haversine } from '../src/core/geo.js';
import { bearing as bear } from '../src/core/traffic.js';
const bearing = (la1, lo1, la2, lo2) => bear({ lat: la1, lon: lo1 }, { lat: la2, lon: lo2 });

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('locations: GeoJSON → reports; AIS "not available" codes become null', () => {
  const doc = { features: [
    { mmsi: 265007000, geometry: { coordinates: [25.552753, 60.309598] }, properties: { mmsi: 265007000, sog: 0, cog: 189.4, navStat: 5, rot: 0, heading: 180, timestampExternal: 1791679172065 } },
    { mmsi: 230000001, geometry: { coordinates: [24.9, 60.1] }, properties: { mmsi: 230000001, sog: 102.3, cog: 360, navStat: 0, rot: -128, heading: 511, timestampExternal: 1791679100000 } },
    { mmsi: 1, geometry: { coordinates: [null, 60] }, properties: { mmsi: 1, timestampExternal: 1 } },
  ] };
  const r = parseAisLocations(doc);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { mmsi: 265007000, lat: 60.309598, lon: 25.552753, sog: 0, cog: 189.4, heading: 180, turn: 0, navStat: 5, t: 1791679172065 });
  assert.deepEqual([r[1].sog, r[1].cog, r[1].heading, r[1].turn], [null, null, null, null]);
});

test('rate of turn: ROT_AIS = 4.733 √(°/min)', () => {
  near(rotDegPerSec(4.733 * Math.sqrt(30)), 0.5, 1e-9, '30°/min');
  near(rotDegPerSec(-4.733 * Math.sqrt(60)), -1, 1e-9, '60°/min to port');
  assert.equal(rotDegPerSec(127), null); assert.equal(rotDegPerSec(-128), null); assert.equal(rotDegPerSec(0), 0);
});

test('vessels: size from the antenna offsets, draught in metres, ETA bits, @ padding trimmed', () => {
  const [v] = parseAisVessels([{ callSign: '9HA3130', destination: 'USMSY@@@', draught: 140, eta: 662272, imo: 9597032, mmsi: 229177000, name: 'TAHITI ONE@@',
    referencePointA: 192, referencePointB: 37, referencePointC: 19, referencePointD: 13, shipType: 70, timestamp: 1791593459248 }]);
  assert.equal(v.name, 'TAHITI ONE'); assert.equal(v.destination, 'USMSY');
  assert.equal(v.length, 229); assert.equal(v.width, 32); assert.equal(v.draught, 14);
  assert.deepEqual(v.eta, { month: 10, day: 3, hour: 12, minute: 0 });
  assert.equal(parseAisVessels([{ mmsi: 5, referencePointA: 0, referencePointB: 0 }])[0].length, null);
});

test('ETA: no year in AIS, so the nearest one to now', () => {
  assert.equal(etaParts(0), null);
  assert.equal(etaParts((13 << 16) | (1 << 11)), null, 'month 13');
  const p = etaParts((1 << 16) | (2 << 11) | (24 << 6) | 60);   // 2 Jan, no hour or minute
  assert.deepEqual(p, { month: 1, day: 2, hour: null, minute: null });
  const dec = Date.UTC(2026, 11, 30);
  assert.equal(new Date(etaTime(p, dec)).getUTCFullYear(), 2027, 'early January seen from late December is next year');
  assert.equal(new Date(etaTime({ month: 12, day: 28, hour: 6, minute: 0 }, Date.UTC(2027, 0, 3))).getUTCFullYear(), 2026);
});

test('ship types in words and colour groups; flags from the MMSI', () => {
  assert.equal(shipKind(70), 'cargo'); assert.equal(shipKind(84), 'tanker'); assert.equal(shipKind(60), 'passenger'); assert.equal(shipKind(52), 'service');
  assert.equal(shipKind(37), 'pleasure'); assert.equal(shipKind(35), 'military'); assert.equal(shipKind(0), 'other');
  assert.equal(shipTypeName(81), 'Tanker · dangerous goods, category A'); assert.equal(shipTypeName(52), 'Tug'); assert.equal(shipTypeName(70), 'Cargo ship');
  assert.equal(shipTypeName(0), 'Unknown type');
  assert.equal(flagOf(230123456), 'Finland'); assert.equal(flagOf(266123456), 'Sweden'); assert.equal(flagOf(353000000), 'Panama'); assert.equal(flagOf(636091000), 'Liberia');
  assert.equal(flagOf(2300001), '', 'not a ship MMSI'); assert.equal(NAV_STATUS[5], 'moored');
});

test('motion: straight along the course, through a reported turn, held when moored', () => {
  const s = { lat: 60, lon: 25, sog: 10, cog: 90, heading: 92, turn: 0, navStat: 0 };
  assert.ok(underway(s));
  const p = shipAt(s, 60);
  near(haversine(60, 25, p.lat, p.lon), 10 * 0.514444 * 60, 0.5, 'distance in a minute');
  near(bearing(60, 25, p.lat, p.lon), 90, 0.5, 'due east');
  const turning = shipAt({ ...s, turn: 1 }, 90);   // 1°/s to starboard for 90 s: heading south at the end
  near(turning.cog, 180, 1e-9, 'course after the turn');
  near(haversine(60, 25, turning.lat, turning.lon), 2 * (10 * 0.514444 / (Math.PI / 180)) * Math.sin(Math.PI / 4), 1, 'chord of a quarter circle');
  const moored = shipAt({ ...s, navStat: 5 }, 600);
  assert.deepEqual([moored.lat, moored.lon], [60, 25]);
  const capped = shipAt(s, 5000);
  near(haversine(60, 25, capped.lat, capped.lon), 10 * 0.514444 * 600, 1, 'ten minutes at most');
});

test('aisstream.io PositionReport: "not available" codes become null, so the ship is not dead-reckoned on them', () => {
  const pr = { Sog: 102.3, Cog: 360, TrueHeading: 511, RateOfTurn: -128, NavigationalStatus: 15 };
  const c = cleanAisSentinels(pr);
  assert.deepEqual(c, { sog: null, cog: null, heading: null, turn: null, navStat: 15 });
  const ship = { lat: 50, lon: 0, ...c }, p = shipAt(ship, 600);
  assert.deepEqual([p.lat, p.lon], [50, 0], 'held where it was reported, not 31 km north');
  // a real speed with a "course not available": it moves along its heading, not due north
  const h = cleanAisSentinels({ Sog: 12, Cog: 360, TrueHeading: 90, RateOfTurn: 0, NavigationalStatus: 0 });
  assert.deepEqual(h, { sog: 12, cog: null, heading: 90, turn: 0, navStat: 0 });
  const q = shipAt({ lat: 50, lon: 0, ...h }, 60);
  near(bearing(50, 0, q.lat, q.lon), 90, 0.5, 'east along the heading');
  // the same rules as Digitraffic's, under either set of names
  const d = cleanAisSentinels({ sog: 8.5, cog: 359.9, heading: 0, rot: 4.733 * Math.sqrt(30), navStat: 0 });
  assert.deepEqual({ ...d, turn: undefined }, { sog: 8.5, cog: 359.9, heading: 0, turn: undefined, navStat: 0 }); near(d.turn, 0.5, 1e-9, '30°/min');
  assert.equal(cleanAisSentinels({ Sog: -1 }).sog, null); assert.equal(cleanAisSentinels({ NavigationalStatus: 99 }).navStat, 15); assert.equal(cleanAisSentinels(null).sog, null);
});

test('aisstream.io only through the download\'s local helper: the website never opens stream.aisstream.io', () => {
  assert.equal(aisstreamSocketUrl({ protocol: 'http:', hostname: 'localhost', host: 'localhost:8787' }), 'ws://localhost:8787/aisstream');
  assert.equal(aisstreamSocketUrl({ protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1:8787' }), 'ws://127.0.0.1:8787/aisstream');
  assert.equal(aisstreamSocketUrl({ protocol: 'https:', hostname: 'destinjones.github.io', host: 'destinjones.github.io' }), null);
  assert.equal(aisstreamSocketUrl({ protocol: 'file:', hostname: '', host: '' }), null);
  assert.equal(aisstreamSocketUrl({ protocol: 'http:', hostname: 'localhost.evil.example', host: 'localhost.evil.example' }), null);
  assert.equal(AISSTREAM_UPSTREAM, 'wss://stream.aisstream.io/v0/stream');
  const feeds = readFileSync(new URL('../src/map/feeds.js', import.meta.url), 'utf8');
  assert.ok(!/wss:\/\/|stream\.aisstream\.io/.test(feeds), 'the 2D map opens no socket of its own to aisstream.io');
  assert.match(feeds, /new WebSocket\(url\)/, 'only to the helper');
  assert.match(feeds, /aisstreamSocketUrl\(location\)/, 'the 2D map asks where the helper is');
  assert.match(feeds, /cleanAisSentinels\(/, 'the 2D map cleans aisstream reports');
});
