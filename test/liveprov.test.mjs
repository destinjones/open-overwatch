// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stamp, stampReports, recordOf, provBlock, provLine, rep, agreeingIds, LAYERS, SOURCES, metresBetween } from '../src/core/liveprov.js';
import { sameAircraft, readsbTime, AIR_AGREE } from '../src/core/aircraft.js';
import { sameQuake, usgsDataAt, parseEmsc, emscUrl, emscAsk, emscSource, emscRepeatsUsgs, matchEmsc, stampQuake } from '../src/core/quakes.js';
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
  assert.ok(sameAircraft(a, { ...a, t: now - 60e3, lon: -0.1 + 0.18, altFt: 33000 }));   // 12.4 km and 2,000 ft in a minute: reachable
  assert.ok(!sameAircraft(a, { ...a, t: now - 60e3, lon: -0.1 + 0.3 }));                // 21 km in a minute at 450 kt: not
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
  assert.equal(provLine(stampReports(list[0], 'storms', reports, agreeing), now), "NASA EONET (NOAA's data again) + NOAA NHC · 1 of 2 agree · data 60 min old · reported");
  assert.equal(agencyOf('JTWC'), 'jtwc'); assert.equal(agencyOf('NOAA_NHC'), 'noaa');
  const pac = stormsFromEonet([{ ...ev, id: 'E2', title: 'Typhoon Kong', sources: [{ id: 'JTWC', url: 'https://x' }], track: [{ lat: 15, lon: 135, t: now - 3 * 3600e3, kt: 90 }] }]);
  mergeGdacs(pac, [{ name: 'KONG', nice: 'Kong', lat: 15.6, lon: 134.5, kmh: 170, eventid: 1, episodeid: 2, to: now - 3600e3, fc: { id: 1, source: 'JMA', advisory: now - 3600e3, cone: [], forecast: [], past: [], points: [] } }]);
  ({ agreeing } = stormAgreement(pac[0]));
  assert.deepEqual(agreeing.sort(), ['eonet', 'gdacs']);
  assert.ok(!sameStorm({ lat: 15, lon: 135, t: now }, { lat: 20, lon: 135, t: now }));
});

test('noteAircraftReport: a second network confirms, an old report drops out', async () => {
  const { noteAircraftReport } = await import('../src/core/aircraft.js');
  const rec = { hex: 'abc' };
  noteAircraftReport(rec, { src: 'adsb.lol', lat: 50, lon: 8, t: now - 2e3, gsKt: 300 }, { now });
  assert.equal(recordOf(rec, now).confidence, 'reported');
  noteAircraftReport(rec, { src: 'OpenSky', lat: 50.002, lon: 8, t: now - 6e3, gsKt: 300 }, { now, cached: true });
  assert.equal(provLine(rec, now), 'adsb.lol + OpenSky (copy) · 2 of 2 agree · data 2 s old · confirmed');
  noteAircraftReport(rec, { src: 'adsb.lol', lat: 50.1, lon: 8, t: now + 200e3 }, { now: now + 200e3 });
  assert.equal(recordOf(rec, now + 200e3).of, 1);
  noteAircraftReport(rec, { src: 'adsb.fi', lat: 50.1, lon: 8, t: now + 50e3 }, { now: now + 200e3 });   // 150 s older: kept, not compared
  assert.equal(recordOf(rec, now + 200e3).of, 1); assert.equal(rec._reports.length, 2);
});

test('stampQuake: GDACS repeating USGS is listed but does not confirm; an independent one does', async () => {
  const { stampQuake, gdacsQuakes } = await import('../src/core/quakes.js');
  const q = { lat: 35, lon: 140, time: now - 3600e3, mag: 6.1, updated: now - 600e3 };
  const g = gdacsQuakes([{ eventtype: 'EQ', eventid: 1, fromdate: new Date(now - 3600e3 + 10e3).toISOString(), lat: 35.1, lon: 140.1, severitydata: { severity: 6.0 }, source: 'NEIC', datemodified: '2026-10-14T11:50:00' }]);
  assert.equal(provLine(stampQuake({ ...q }, { dataAt: now - 60e3, gdacs: g }), now), 'USGS + GDACS (USGS solution) · 1 of 2 agree · data 60 s old · reported');
  g[0].usgs = false;
  assert.equal(recordOf(stampQuake({ ...q }, { dataAt: now - 60e3, gdacs: g }), now).confidence, 'confirmed');
  assert.equal(recordOf(stampQuake({ ...q }), now).ageMs, 600e3);
});

// EMSC (seismicportal.eu FDSN event service), one real answer captured 2026-10-17 (limit=4, minmag=4)
const EMSC_DOC = JSON.parse(readFileSync(new URL('./fixtures/emsc-sample.json', import.meta.url), 'utf8'));

test('parseEmsc: the FDSN GeoJSON answer as solutions (ISO times, depth down, agency, event page, the answer\'s data time)', () => {
  const l = parseEmsc(EMSC_DOC);
  assert.equal(l.length, 4);
  const [pan, mex] = l;
  assert.deepEqual({ ...pan }, { id: '20261017_0000194', mag: 4.1, magType: 'm', place: 'PANAMA', time: Date.parse('2026-10-17T14:39:36Z'), updated: Date.parse('2026-10-17T14:43:12.293Z'),
    depth: 10, lat: 7.0608, lon: -81.0035, auth: 'IGC', url: 'https://www.seismicportal.eu/eventdetails.html?unid=20261017_0000194', dataAt: Date.parse('2026-10-17T14:43:12.293Z') });
  assert.equal(mex.auth, 'NEIC'); assert.equal(mex.place, 'OFFSHORE CHIAPAS, MEXICO');
  assert.ok(l.every(e => e.dataAt === pan.updated), 'the newest update in the answer is its data time');
  assert.equal(l[3].depth, 133.4, 'properties.depth is km down (the coordinate is negative)');
  // nothing trusted: no position, no time, a quarry blast, a time without its Z, a link-breaking id
  const odd = parseEmsc({ features: [{ properties: { lat: 95, lon: 0, time: '2026-10-17T00:00:00Z' } }, { properties: { lat: 1, lon: 2 } },
    { properties: { lat: 1, lon: 2, time: '2026-10-17T00:00:00Z', evtype: 'qb' } },
    { id: 'x"><img>', geometry: { coordinates: [20, 40, -12] }, properties: { time: '2026-10-17T01:00:00.5', mag: '3.1', evtype: 'ke' } }] });
  assert.equal(odd.length, 1); assert.equal(odd[0].time, Date.parse('2026-10-17T01:00:00.5Z')); assert.equal(odd[0].depth, 12); assert.equal(odd[0].mag, 3.1); assert.equal(odd[0].url, '');
  assert.deepEqual(parseEmsc(null), []); assert.deepEqual(parseEmsc({ features: 'x' }), []);
  assert.deepEqual(parseEmsc(''), [], "FDSN's empty 204 (nothing matched): no solutions"); assert.equal(parseEmsc(JSON.stringify(EMSC_DOC)).length, 4, 'the body as text');
  assert.throws(() => parseEmsc('<html>'), SyntaxError);
});

test('emscUrl / emscAsk: the start floored to 10 minutes (one address, one cache entry), the magnitude floor less the agreement margin', () => {
  const t = Date.parse('2026-10-17T15:47:10Z');
  assert.equal(emscUrl({ now: t }), 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=500&minmag=1.9&starttime=2026-10-16T15:40:00');
  assert.equal(emscUrl({ now: t + 2 * min }), emscUrl({ now: t }), 'the same address within a 10-minute step'); assert.notEqual(emscUrl({ now: t + 3 * min }), emscUrl({ now: t }));
  assert.equal(emscUrl({ min: 0, hours: 1, now: t, limit: 5000 }), 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=1000&starttime=2026-10-17T14:40:00');
  assert.match(emscUrl({ min: 4.5, hours: 168, now: t }), /&limit=1000&/, 'a week or a month: the most EMSC is asked for');
  assert.match(emscUrl({ min: 1, hours: 24, now: t }), /&limit=1000&/, 'M1+ in a day'); assert.match(emscUrl({ min: 4.5, hours: 1, now: t }), /&limit=500&/);
  assert.deepEqual(emscAsk('2.5_day'), { min: 2.5, hours: 24 }); assert.deepEqual(emscAsk('4.5_week'), { min: 4.5, hours: 168 });
  assert.deepEqual(emscAsk('all_hour'), { min: 0, hours: 1 }); assert.deepEqual(emscAsk('significant_month'), { min: 4.5, hours: 720 }); assert.deepEqual(emscAsk('nonsense'), { min: 2.5, hours: 24 });
});

test('stampQuake: an EMSC solution of its own confirms a USGS quake; one too far off, or USGS\'s own, does not', () => {
  const [pan, mex] = parseEmsc(EMSC_DOC), at = Date.parse('2026-10-17T14:50:00Z');
  const q = { id: 'us7000p001', lat: 7.03, lon: -80.95, time: pan.time + 4e3, mag: 4.4 };   // USGS's solution of the Panama quake
  assert.equal(provLine(stampQuake({ ...q }, { dataAt: at - 60e3, emsc: [pan, mex] }), at), 'USGS + EMSC · 2 of 2 agree · data 60 s old · confirmed');
  assert.match(provBlock(stampQuake({ ...q }, { dataAt: at - 60e3, emsc: [pan] }), at), /<a href="https:\/\/www\.seismicportal\.eu\/eventdetails\.html\?unid=20261017_0000194"[^>]*>EMSC<\/a>/, 'the card credits EMSC and links its event');
  for (const off of [{ time: q.time + 90e3 }, { lat: 8.5 }, { mag: 5.3 }]) {   // past QUAKE_AGREE: 60 s, 100 km, 0.6
    const r = recordOf(stampQuake({ ...q, ...off }, { dataAt: at - 60e3, emsc: [pan, mex] }), at);
    assert.equal(r.of, 1, JSON.stringify(off)); assert.equal(r.confidence, 'reported');
  }
  // EMSC publishing NEIC's solution repeats USGS: listed, not a second witness
  const mq = { id: 'us7000p002', lat: 14.05, lon: -92.86, time: mex.time - 2e3, mag: 5.2 };
  assert.equal(provLine(stampQuake({ ...mq }, { dataAt: at - 60e3, emsc: [pan, mex] }), at), 'USGS + EMSC (USGS solution) · 1 of 2 agree · data 60 s old · reported');
  assert.ok(emscRepeatsUsgs({ auth: 'AK' }, { id: 'ak0261abcd' }), 'the same network as the USGS quake'); assert.ok(!emscRepeatsUsgs({ auth: 'AK' }, { id: 'us7000abcd' }));
  assert.ok(!emscRepeatsUsgs({ auth: '' }, { id: 'us7000abcd' })); assert.ok(emscRepeatsUsgs({ auth: 'usgs' }, {}));
  // stamping again when EMSC answers late replaces the USGS-only stamp; the closest of two candidates is the match
  const late = stampQuake({ ...q }, { dataAt: at - 60e3 }); assert.equal(recordOf(late, at).of, 1);
  stampQuake(late, { dataAt: at - 60e3, emsc: [pan] }); assert.equal(recordOf(late, at).confidence, 'confirmed');
  assert.equal(matchEmsc(q, [{ ...pan, id: 'far', time: q.time + 50e3 }, pan, { ...pan, id: 'near2', time: q.time - 20e3 }]).id, pan.id);
  // a long list (a week's 1000) is searched by time: the same match as a full scan, ties to the first in the list
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const long = Array.from({ length: 400 }, (_, i) => ({ ...pan, id: 'e' + i, time: q.time + Math.round((rnd() - 0.5) * 600) * 1000, lat: q.lat + (rnd() - 0.5) * 2, mag: q.mag + (rnd() - 0.5) }));
  long.push({ ...pan, id: 'nan', time: NaN });
  const scan = (x, l) => { let b = null; for (const e of l) if (sameQuake(x, e) && (!b || Math.abs(e.time - x.time) < Math.abs(b.time - x.time))) b = e; return b; };
  for (let k = 0; k < 200; k++) { const x = { ...q, time: q.time + Math.round((rnd() - 0.5) * 700) * 1000 }; assert.equal(matchEmsc(x, long), scan(x, long)); }
  const tie = [...Array.from({ length: 40 }, (_, i) => ({ ...pan, id: 'pad' + i, time: q.time + 3600e3 })), { ...pan, id: 'after', time: q.time + 5e3 }, { ...pan, id: 'before', time: q.time - 5e3 }];
  assert.equal(matchEmsc(q, tie).id, 'after', 'a tie goes to the first in the list, as a full scan does');
  assert.equal(matchEmsc({ ...q, time: NaN }, long), null);
  // an old answer (EMSC down since) still lists the quake but is no longer fresh: back to reported
  assert.equal(recordOf(stampQuake({ ...q }, { dataAt: at + 2 * 3600e3, emsc: [pan] }), at + 2 * 3600e3 + 60e3).confidence, 'reported');
});

test('emscSource: one request per question per 10 minutes, shared while in flight, and an EMSC failure never rejects', async () => {
  let t = Date.parse('2026-10-17T15:00:00Z'), fail = false; const asked = [];
  const json = async url => { asked.push(url); if (fail) throw new Error('HTTP 503'); return EMSC_DOC; };
  const src = emscSource(json, { now: () => t });
  const a = src.load({ min: 2.5, hours: 24 }), b = src.load({ min: 2.5, hours: 24 });
  assert.equal(a, b, 'one request in flight at a time');
  assert.equal((await a).length, 4); assert.equal(asked.length, 1); assert.equal(src.list.length, 4);
  t += 5 * min; await src.load({ min: 2.5, hours: 24 }); assert.equal(asked.length, 1, 'kept for 10 minutes');
  t += 6 * min; fail = true;
  const kept = await src.load({ min: 2.5, hours: 24 });
  assert.equal(asked.length, 2); assert.equal(kept.length, 4, 'a failure keeps the last list');
  await src.load({ min: 2.5, hours: 24 }); assert.equal(asked.length, 2, 'and waits the 10 minutes before asking again');
  await src.load({ min: 1, hours: 24 }); assert.equal(asked.length, 3, 'a different question (another USGS summary) asks at once');
  t += 9.6 * min; await src.load({ min: 1, hours: 24 }); assert.equal(asked.length, 4, 'a reload a moment before 10 minutes still asks');
  const bare = emscSource(async () => { throw new Error('offline'); }, { now: () => t });
  assert.deepEqual(await bare.load(), [], 'never answered: no EMSC votes, no error');
  const broken = emscSource(() => { throw new Error('sync throw'); }, { now: () => t });
  assert.deepEqual(await broken.load(), []);
  assert.deepEqual(await emscSource(async () => '<html>busy</html>', { now: () => t }).load(), [], 'a body that is not JSON is a failure too');
});

test("emscSource: a new question while another is in flight gets its own answer, never the other's list", async () => {
  const tick = () => new Promise(r => setImmediate(r));
  const t = Date.parse('2026-10-17T15:00:00Z'), asked = [], wait = [];
  const one = { features: [EMSC_DOC.features[0]] };
  const src = emscSource(url => { asked.push(url); return new Promise(res => wait.push(res)); }, { now: () => t });
  const a = src.load({ min: 2.5, hours: 24 }), b = src.load({ min: 4.5, hours: 168 });
  assert.notEqual(a, b, 'the new question asks at once'); await tick(); assert.equal(asked.length, 2); assert.match(asked[1], /minmag=3\.9/);
  wait[1](one); assert.equal((await b).length, 1); assert.equal(src.list.length, 1);
  wait[0](EMSC_DOC); assert.equal((await a).length, 4); assert.equal(src.list.length, 1, "the older question's late answer doesn't replace the newer one's");
  src.load({ min: 2.5, hours: 24 }); await tick(); assert.equal(asked.length, 3, 'switching back asks again'); assert.equal(src.list.length, 4, "while showing that question's own last list");
  wait[2](EMSC_DOC);
});

test('ships: two receivers of the same MMSI agree within 300 m plus its run', async () => {
  const { sameShip } = await import('../src/core/ais.js');
  const a = { id: 230000001, lat: 60, lon: 25, t: now, sog: 10 };
  assert.ok(sameShip(a, { ...a, t: now - 60e3, lat: 60.004 }));      // 445 m in 60 s at 10 kn (~400 m allowed + 300)
  assert.ok(!sameShip(a, { ...a, lat: 60.02 }));
  assert.ok(!sameShip(a, { ...a, id: 230000002 }));
});

test('the guide quotes the rule the cards show', async () => {
  const { readFileSync } = await import('node:fs');
  const { RULE } = await import('../src/core/provenance.js');
  const guide = readFileSync(new URL('../guide.html', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.ok(guide.includes(RULE), 'guide.html #provenance quotes RULE word for word');
});
