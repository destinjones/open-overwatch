// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stamp, stampReports, recordOf, provBlock, provLine, rep, agreeingIds, LAYERS, SOURCES, metresBetween } from '../src/core/liveprov.js';
import { sameAircraft, readsbTime, AIR_AGREE } from '../src/core/aircraft.js';
import { sameQuake, usgsDataAt } from '../src/core/quakes.js';
import { stormsFromEonet, mergeNhc, mergeGdacs, stormAgreement, sameStorm, agencyOf } from '../src/core/cyclones.js';

const now = Date.parse('2026-10-14T12:00:00Z'), min = 60e3;

test('a stamped item gets its age when asked, not when stamped', () => {
  const q = stamp({ id: 'us1' }, 'quakes', [rep('usgs', { dataAt: now - 2 * min })]);
  assert.equal(recordOf(q, now).confidence, 'reported');
  assert.equal(recordOf(q, now + 40 * min).confidence, 'stale');   // quakes: 30 min
  assert.equal(provLine(q, now), 'USGS · data 2 min old · reported');
  assert.match(provBlock(q, now), /class="prov prov-reported"/);
  assert.equal(provBlock({}, now), ''); assert.equal(provLine(null), null);
});

test('every layer has a max age and every catalogued source a name', () => {
  for (const [id, l] of Object.entries(LAYERS)) assert.ok(l.maxAgeMs > 0 && l.dataAt, id);
  for (const [id, s] of Object.entries(SOURCES)) assert.ok(s.name && (s.url == null || /^https:\/\//.test(s.url)), id);
  assert.equal(rep('nope', { dataAt: now }).name, 'nope');
});

test('a copy is marked and the age is the data time', () => {
  const s = stamp({}, 'satellites', [rep('celestrak', { dataAt: now - 4 * 864e5, fetchedAt: now, cached: true })]);
  assert.equal(provLine(s, now), 'CelesTrak (copy) · data 4 days old · stale');
});

test('agreeingIds: the freshest report is the reference, one vote per source', () => {
  const same = (a, b) => Math.abs(a.x - b.x) < 2;
  assert.deepEqual(agreeingIds([{ src: 'a', t: 1, x: 0 }, { src: 'b', t: 3, x: 1 }, { src: 'c', t: 2, x: 9 }, { src: 'b', t: 0, x: 1 }], same), ['b', 'a']);
  assert.deepEqual(agreeingIds([], same), []);
  assert.ok(Math.abs(metresBetween({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111195) < 10);
});

test('aircraft: same hex, close in time and place (allowing for speed), similar altitude', () => {
  const a = { hex: 'abc123', lat: 51.5, lon: -0.1, t: now, gsKt: 450, altFt: 35000 };
  assert.ok(sameAircraft(a, { ...a, lat: 51.505 }));                                   // 550 m
  assert.ok(sameAircraft(a, { ...a, t: now - 10e3, lon: -0.1 + 0.03 }));               // 2.1 km in 10 s at 450 kt (2.3 km)
  assert.ok(!sameAircraft(a, { ...a, lon: -0.1 + 0.1 }));                              // 7 km at the same time
  assert.ok(!sameAircraft(a, { ...a, t: now - (AIR_AGREE.maxDtS + 1) * 1e3 }));
  assert.ok(!sameAircraft(a, { ...a, altFt: 36000 }));
  assert.ok(!sameAircraft(a, { ...a, hex: 'abc124' }));
  assert.equal(readsbTime({ seenPos: 2.5 }, now / 1000), now - 2500);
  assert.equal(readsbTime({ seenPos: 1 }, now), now - 1000);
});

test('aircraft from two feeds: confirmed; one feed off by 20 km: reported, 1 of 2', () => {
  const r = [{ src: 'adsblol', hex: 'abc', lat: 50, lon: 8, t: now - 3e3, gsKt: 400 }, { src: 'adsbfi', hex: 'abc', lat: 50.001, lon: 8, t: now - 5e3, gsKt: 400 }];
  const ok = stampReports({}, 'aircraft', r, agreeingIds(r, sameAircraft));
  assert.equal(provLine(ok, now), 'adsb.lol + adsb.fi · 2 of 2 agree · data 3 s old · confirmed');
  r[1].lat = 50.2;
  const bad = stampReports({}, 'aircraft', r, agreeingIds(r, sameAircraft));
  assert.equal(recordOf(bad, now).confidence, 'reported'); assert.equal(recordOf(bad, now).agree, 1);
});

test('quakes: same within a minute, 100 km and 0.6 magnitude', () => {
  const a = { lat: 35, lon: 140, time: now, mag: 5.1 };
  assert.ok(sameQuake(a, { lat: 35.3, lon: 140.2, time: now + 20e3, mag: 4.8 }));
  assert.ok(!sameQuake(a, { ...a, time: now + 120e3 }));
  assert.ok(!sameQuake(a, { ...a, lat: 36.5 }));
  assert.ok(!sameQuake(a, { ...a, mag: 6 }));
  assert.ok(sameQuake(a, { ...a, mag: null }));
  assert.equal(usgsDataAt({ metadata: { generated: now } }), now);
  assert.equal(usgsDataAt({}, [{ updated: now - 5 }, { updated: now - 9 }]), now - 5);
});

test('storms: EONET + NHC agree but NHC is counted once; GDACS from JTWC is a second witness', () => {
  const ev = { id: 'EONET_1', title: 'Hurricane Erin', track: [{ lat: 25, lon: -70, t: now - 6 * 3600e3, kt: 100 }], sources: [{ id: 'NOAA_NHC', url: 'https://x' }], link: '' };
  const list = stormsFromEonet([ev]);
  mergeNhc(list, [{ id: 'al05', name: 'Erin', title: 'Hurricane Erin', lat: 25.5, lon: -71, kt: 100, advisory: new Date(now - 3600e3).toISOString() }]);
  let { reports, agreeing } = stormAgreement(list[0]);
  assert.deepEqual(reports.map(r => r.src), ['eonet', 'nhc']);
  assert.deepEqual(agreeing, ['nhc']);   // EONET repeats NHC's own advisory
  assert.equal(agencyOf('JTWC'), 'jtwc'); assert.equal(agencyOf('NOAA_NHC'), 'noaa');
  const pac = stormsFromEonet([{ ...ev, id: 'E2', title: 'Typhoon Kong', sources: [{ id: 'JTWC', url: 'https://x' }], track: [{ lat: 15, lon: 135, t: now - 3 * 3600e3, kt: 90 }] }]);
  mergeGdacs(pac, [{ name: 'KONG', nice: 'Kong', lat: 15.6, lon: 134.5, kmh: 170, eventid: 1, episodeid: 2, to: now - 3600e3, fc: { id: 1, source: 'JMA', advisory: now - 3600e3, cone: [], forecast: [], past: [], points: [] } }]);
  ({ agreeing } = stormAgreement(pac[0]));
  assert.deepEqual(agreeing.sort(), ['eonet', 'gdacs']);
  assert.ok(!sameStorm({ lat: 15, lon: 135, t: now }, { lat: 20, lon: 135, t: now }));
});
