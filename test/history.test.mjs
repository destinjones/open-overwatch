// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Time travel (src/core/history.js): the quake catalogue's days and window, storms where they were at a moment (Hurricane
// Ian from NASA EONET against NHC's landfall point), past natural events, and the satellite archive (the nearest snapshot,
// the element set nearest the time shown, satellites hidden rather than drawn wrong). Fixtures: real USGS and EONET answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUsgs, largest } from '../src/core/quakes.js';
import { parseEonet } from '../src/core/eonet.js';
import { stormsFromEonet } from '../src/core/cyclones.js';
import { parseTle, tleEpochJd } from '../src/core/tle.js';
import { decodeView, encodeView, GO } from '../src/core/viewlink.js';
import {
  DAY_MS, isPast, utcDay, fdsnDayUrl, quakeDays, quakeInWindow, QUAKES_FROM, eonetAtUrl, gdacsTcAtUrl, gdacsPastCyclones, trackAt, stormsAt, stormsFromGdacs,
  eventActiveAt, parseHistoryIndex, nearestSnapshot, keepDays, archiveMap, chooseElements, historyFileUrl, MOMENTS, momentMs, scrubRange, HISTORY, STEPS_BACK, ARCHIVED_GROUPS,
} from '../src/core/history.js';

const fx = name => JSON.parse(readFileSync(new URL('./fixtures/history/' + name, import.meta.url), 'utf8'));
const NOW = Date.UTC(2026, 9, 13, 18, 0);

test('history: the past starts half an hour back', () => {
  assert.equal(isPast(NOW - 10 * 60e3, NOW), false);
  assert.equal(isPast(NOW - 2 * 3600e3, NOW), true);
  assert.equal(isPast(NaN, NOW), false);
  assert.equal(utcDay(Date.UTC(2011, 2, 11, 23, 59)), '2011-03-11');
});

test('history: quakes come from the USGS catalogue one UTC day at a time, biggest first and capped', () => {
  const u = new URL(fdsnDayUrl(Date.UTC(2011, 2, 11, 5, 46)));
  assert.equal(u.origin + u.pathname, 'https://earthquake.usgs.gov/fdsnws/event/1/query');
  assert.equal(u.searchParams.get('starttime'), '2011-03-11T00:00:00');
  assert.equal(u.searchParams.get('endtime'), '2011-03-12T00:00:00');
  assert.equal(u.searchParams.get('format'), 'geojson'); assert.equal(u.searchParams.get('orderby'), 'magnitude');
  assert.equal(u.searchParams.get('minmagnitude'), '2.5');
  assert.equal(new URL(fdsnDayUrl(0, { limit: 1e9, minMag: 99 })).searchParams.get('limit'), '20000');   // hostile options stay inside USGS's limits
  assert.equal(new URL(fdsnDayUrl(0, { minMag: 99 })).searchParams.get('minmagnitude'), '9');
  // the 24 h window ending at 06:30 needs the 10th and the 11th
  const at = Date.UTC(2011, 2, 11, 6, 30);
  assert.deepEqual(quakeDays(at, { now: NOW }).map(utcDay), ['2011-03-10', '2011-03-11']);
  assert.deepEqual(quakeDays(Date.UTC(2011, 2, 11, 0, 0), { now: NOW }).map(utcDay), ['2011-03-10', '2011-03-11']);
  assert.deepEqual(quakeDays(QUAKES_FROM - DAY_MS, { now: NOW }), []);   // before the catalogue: nothing to ask for
  assert.equal(quakeDays(NOW + 5 * DAY_MS, { now: NOW }).map(utcDay).pop(), utcDay(NOW));   // never days that haven't happened
});

test('history: the catalogue answer parses like the live feed (Tōhoku, 2011-03-11)', () => {
  const qs = parseUsgs(fx('fdsn_2011-03-11_m6.json')), big = largest(qs);
  assert.equal(qs.length, 25);
  assert.equal(big.mag, 9.1); assert.ok(Math.abs(big.lat - 38.297) < 0.01 && Math.abs(big.lon - 142.373) < 0.01);
  assert.equal(new Date(big.time).toISOString().slice(0, 16), '2011-03-11T05:46');
  const at = Date.UTC(2011, 2, 11, 6, 30), shown = qs.filter(q => quakeInWindow(q, at));
  assert.ok(shown.includes(big));
  assert.ok(shown.every(q => q.time <= at), 'nothing after the time shown');
  assert.ok(!quakeInWindow(big, Date.UTC(2011, 2, 11, 5, 0)), 'not before it happened');
  assert.ok(!quakeInWindow(big, Date.UTC(2011, 2, 12, 6, 0)), 'gone a day later');
  assert.equal(quakeInWindow({ time: null }, at), false);
});

test('history: storms where they were — Hurricane Ian at landfall (EONET track vs NHC: Cayo Costa, 26.6N 82.2W, 19:05 UTC)', () => {
  const storms = stormsFromEonet(parseEonet(fx('eonet_2022-09-28_storms.json'))), at = Date.UTC(2022, 8, 28, 19, 5);
  const then = stormsAt(storms, at), ian = then.find(s => /Ian/.test(s.title));
  assert.ok(ian, 'Ian was going on');
  const km = Math.hypot((ian.lon + 82.2) * 111 * Math.cos(26.6 * Math.PI / 180), (ian.lat - 26.6) * 111);
  assert.ok(km < 25, `Ian ${km.toFixed(0)} km from NHC's landfall point`);
  assert.ok(ian.kt >= 113 && ian.kt <= 135, 'a category 4 then: ' + ian.kt);
  assert.ok(ian.track.every(p => Date.parse(p.date) <= at), 'the track stops at the time shown');
  assert.equal(ian.date, new Date(at).toISOString());
  assert.equal(ian.fc, undefined, 'no forecast cone from today on a past storm');
  const orig = storms.find(s => /Ian/.test(s.title));
  assert.ok(orig.track.length > ian.track.length - 1 && orig.date !== ian.date, 'the original list is untouched');
  // storms that had not formed yet are left out (Orlene's first fix is 29 Sep 06:00)
  assert.ok(!then.some(s => /Orlene/.test(s.title)));
  assert.ok(stormsAt(storms, Date.UTC(2022, 8, 29, 12)).some(s => /Orlene/.test(s.title)));
  assert.deepEqual(stormsAt(storms, Date.UTC(2020, 0, 1)), []);
});

test('history: trackAt interpolates, wraps the date line and lets a track end', () => {
  const tr = [{ lat: 10, lon: 179, kt: 50, t: 0 }, { lat: 12, lon: -179, kt: 70, t: 6 * 3600e3 }];
  const mid = trackAt(tr, 3 * 3600e3);
  assert.equal(mid.lat, 11); assert.ok(Math.abs(Math.abs(mid.lon) - 180) < 1e-9, 'across the date line, not round the world'); assert.equal(mid.kt, 60); assert.equal(mid.n, 1);
  assert.equal(trackAt(tr, -1), null);
  assert.equal(trackAt(tr, 6 * 3600e3 + 11 * 3600e3).n, 2, 'held a while after the last fix');
  assert.equal(trackAt(tr, 6 * 3600e3 + 13 * 3600e3), null, 'then gone');
  assert.equal(trackAt([{ lat: 1, lon: 2, date: '2020-01-01T00:00:00Z' }], Date.UTC(2020, 0, 1)).lat, 1, 'ISO dates work too');
  assert.equal(trackAt([{ lat: NaN, lon: 2, t: 0 }], 0), null);
});

test('history: GDACS past cyclones (also the ones that are over) and their observed tracks', () => {
  const doc = { features: [
    { geometry: { coordinates: [-82, 27] }, properties: { eventid: 1000923, episodeid: 38, eventname: 'IAN-22', alertlevel: 'Red', fromdate: '2022-09-23T09:00:00', todate: '2022-10-02T03:00:00', iscurrent: 'false', url: { report: 'https://www.gdacs.org/report.aspx?eventid=1000923' } } },
    { geometry: { coordinates: [130, 20] }, properties: { eventid: 1000925, episodeid: 13, eventname: 'KULAP-22', alertlevel: 'Green', fromdate: '2022-09-25T18:00:00', todate: '2022-09-28T18:00:00', url: { report: 'javascript:alert(1)' } } },
    { properties: { eventname: 'BROKEN', fromdate: 'x' } },
  ] };
  const past = gdacsPastCyclones(doc);
  assert.equal(past.length, 2);
  assert.equal(past[0].to, Date.UTC(2022, 9, 2, 3)); assert.equal(past[0].nice, 'Ian'); assert.equal(past[1].report, '', 'only https links');
  const fc = { source: 'JTWC', points: [{ lat: 20, lon: 130, t: Date.UTC(2022, 8, 26), forecast: false }, { lat: 22, lon: 131, t: Date.UTC(2022, 8, 27), forecast: false }, { lat: 30, lon: 140, t: Date.UTC(2022, 8, 30), forecast: true }] };
  const st = stormsFromGdacs(past.map(g => ({ ...g, fc })), [{ title: 'Hurricane Ian' }]);
  assert.deepEqual(st.map(s => s.title), ['Kulap'], 'Ian is already there from EONET');
  assert.equal(st[0].track.length, 2, 'the forecast points are not history');
  assert.equal(stormsAt(st, Date.UTC(2022, 8, 26, 12))[0].lat, 21);
  const u = new URL(gdacsTcAtUrl(Date.UTC(2022, 8, 28, 19)));
  assert.equal(u.searchParams.get('fromdate'), '2022-09-16'); assert.equal(u.searchParams.get('todate'), '2022-09-28');
});

test('history: natural events going on at a moment (EONET open and closed)', () => {
  const u = new URL(eonetAtUrl(Date.UTC(2022, 8, 28, 19), { category: 'wildfires' }));
  assert.equal(u.searchParams.get('status'), 'all'); assert.equal(u.searchParams.get('start'), '2022-09-16'); assert.equal(u.searchParams.get('end'), '2022-09-29');
  assert.equal(u.searchParams.get('category'), 'wildfires');
  assert.equal(new URL(eonetAtUrl(0, { category: 'x&y=1' })).searchParams.get('y'), null, 'a hostile category is dropped');
  const ev = { first: '2022-09-01T00:00:00Z', date: '2022-09-10T00:00:00Z', closed: '2022-09-20T00:00:00Z' };
  assert.equal(eventActiveAt(ev, Date.UTC(2022, 7, 31)), false);
  assert.equal(eventActiveAt(ev, Date.UTC(2022, 8, 15)), true);
  assert.equal(eventActiveAt(ev, Date.UTC(2022, 8, 21)), false);
  assert.equal(eventActiveAt({ ...ev, closed: null }, Date.UTC(2022, 8, 16)), true, 'open: a week after the last fix');
  assert.equal(eventActiveAt({ ...ev, closed: null }, Date.UTC(2022, 8, 18)), false);
  // every storm in the fixture is a real event with a track: they all parse
  const evs = parseEonet(fx('eonet_2022-09-28_storms.json'));
  assert.ok(evs.length >= 10 && evs.every(e => e.closed), 'closed events, with their close dates');
  assert.ok(evs.filter(e => eventActiveAt(e, Date.UTC(2022, 8, 28, 19))).some(e => /Ian/.test(e.title)));
});

// ---- the satellite archive
const stations = parseTle(readFileSync(new URL('./fixtures/stations.tle', import.meta.url), 'utf8'));
/** The same satellite with its epoch moved to day-of-year `doy` (checksums are not read by tleEpochJd or SGP4). */
const withEpoch = (t, doy) => ({ ...t, l1: t.l1.slice(0, 20) + doy.toFixed(8).padStart(12, '0') + t.l1.slice(32) });

test('history: the archive index, the nearest snapshot and what the build keeps', () => {
  const idx = parseHistoryIndex({ days: [{ day: '2026-10-12', at: Date.UTC(2026, 9, 12, 0, 30), n: 4000 }, { day: '2026-10-01', at: Date.UTC(2026, 9, 1, 0, 30), n: 3990 },
    { day: '../../etc', at: 1, n: 1 }, { day: '2026-10-05', at: 'x', n: 5 }, { day: '2026-10-06', at: 5, n: 0 }, null] });
  assert.deepEqual(idx.map(d => d.day), ['2026-10-01', '2026-10-12'], 'oldest first, the malformed dropped');
  assert.deepEqual(parseHistoryIndex(null), []);
  assert.equal(nearestSnapshot(idx, Date.UTC(2026, 9, 3)).day, '2026-10-01');
  assert.equal(nearestSnapshot(idx, Date.UTC(2026, 9, 10)).day, '2026-10-12');
  assert.equal(nearestSnapshot(idx, Date.UTC(2026, 8, 1)), null, 'more than a week from any snapshot');
  assert.equal(historyFileUrl('2026-10-12'), 'data/tle/history/2026-10-12.txt');
  const days = Array.from({ length: 40 }, (_, i) => utcDay(Date.UTC(2026, 9, 13) - i * DAY_MS)).concat(['2026-10-13', 'nonsense', '2027-01-01']);
  const kept = keepDays(days, '2026-10-13');
  assert.equal(kept.length, 30); assert.equal(kept[0], '2026-10-13'); assert.equal(kept[29], '2026-09-14');
  assert.ok(ARCHIVED_GROUPS.includes('stations') && !ARCHIVED_GROUPS.includes('starlink') && !ARCHIVED_GROUPS.includes('active'));
});

test('history: each satellite uses the element set nearest the time shown, or hides', () => {
  const iss = stations.find(t => t.id === '25544');   // epoch 2026 day 274.5 (1 Oct)
  const list = [{ ...iss, group: 'stations' }, { id: '99999', name: 'NEW', l1: iss.l1.replace('25544', '99999'), l2: iss.l2.replace('25544', '99999'), group: 'stations' },
    { id: '44713', name: 'STARLINK', l1: iss.l1.replace('25544', '44713'), l2: iss.l2.replace('25544', '44713'), group: 'starlink' }];
  const old = withEpoch(iss, 260.5);   // 17 Sep
  const archive = archiveMap([old]);
  assert.equal(archive.get('25544').jd, tleEpochJd(old.l1));
  const epochMs = jd => (jd - 2440587.5) * DAY_MS;
  // on 18 Sep: the ISS takes the archived set (1 day off, not 13), the new satellite hides (not catalogued then), and
  // Starlink (not archived) hides: today's set is 13 days away
  const r = chooseElements(list, archive, epochMs(tleEpochJd(old.l1)) + DAY_MS, { covers: true });
  assert.deepEqual(r.sets[0], [old.l1, old.l2]);
  assert.equal(r.sets[1], null); assert.equal(r.sets[2], null);
  assert.deepEqual([r.archived, r.today, r.hidden], [1, 0, 2]);
  // on 29 Sep: today's sets are 2 days off; the archive's is 12: everyone uses today's, including the new one (no covering snapshot)
  const r2 = chooseElements(list, archive, epochMs(tleEpochJd(iss.l1)) - 2 * DAY_MS, { covers: false });
  assert.deepEqual(r2.sets.map(s => s && s[0]), list.map(s => s.l1));
  assert.deepEqual([r2.archived, r2.today, r2.hidden], [0, 3, 0]);
  // a year back: nothing is within a week, so nothing is drawn
  assert.equal(chooseElements(list, archive, Date.UTC(2025, 9, 1)).hidden, 3);
  // no archive at all (the site build hasn't kept one yet): today's sets within a week only
  assert.equal(chooseElements(list, null, epochMs(tleEpochJd(iss.l1)) - 6 * DAY_MS).today, 3);
  assert.equal(chooseElements(list, null, epochMs(tleEpochJd(iss.l1)) - 8 * DAY_MS).hidden, 3);
});

test('history: the presets, quick steps, scrubber range and the honest table', () => {
  for (const m of MOMENTS) {
    assert.ok(Number.isFinite(momentMs(m)) && momentMs(m) < NOW, m.id);
    assert.ok(Math.abs(m.at[0]) <= 180 && Math.abs(m.at[1]) <= 90 && m.at[2] > 1e5, m.id);
    assert.ok(/^[a-z0-9]+$/.test(m.id) && m.name && m.note, m.id);
  }
  assert.equal(new Date(momentMs(MOMENTS.find(m => m.id === 'tohoku'))).toISOString(), '2011-03-11T06:30:00.000Z');
  assert.ok(STEPS_BACK.every(([label, ms]) => label && ms > 0));
  const recent = scrubRange(NOW - 3 * DAY_MS, NOW);
  assert.equal(recent.to, NOW); assert.ok(NOW - recent.from >= 30 * DAY_MS);
  const far = scrubRange(Date.UTC(2011, 2, 11, 6, 30), NOW);
  assert.ok(far.from < Date.UTC(2011, 2, 11, 6, 30) && far.to > Date.UTC(2011, 2, 11, 6, 30) && far.to - far.from === 6 * DAY_MS);
  assert.ok(HISTORY.some(h => h.what === 'Aircraft' && !h.has) && HISTORY.some(h => /launches/.test(h.what) && !h.has), 'aircraft and launches are said to be live only');
  assert.ok(HISTORY.some(h => /Cameras/.test(h.what) && !h.has));
  // a moment opens from a link: the time travels in t= and the panel in go=history
  assert.ok(GO.includes('history'));
  const v = decodeView('#' + encodeView({ lon: 142.4, lat: 38.3, height: 3.2e6, heading: 0, pitch: -90, time: { jd: momentMs(MOMENTS[0]) / DAY_MS + 2440587.5, rate: 0 } }));
  assert.ok(Math.abs((v.time.jd - 2440587.5) * DAY_MS - momentMs(MOMENTS[0])) < 1000);
  assert.equal(v.time.rate, 0);
});
