// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Earth now" (src/core/earthnow.js): the aggregation behind the globe's dashboard, against captured feed answers
// (USGS M4.5+ week, NOAA SWPC's Kp forecast product with its own G-scale labels, NASA EONET wildfires, 2026-10-13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  quakeRegion, quakeClass, summarizeQuakes, dailyCounts, utcDayStart, kpLevel, kpSeries, kpSummary, auroraReach,
  summarizeStorms, summarizeWildfires, prescribed, wildfireRegion, launchesSoon, preciseLaunch, launchesToday, launchesByMonth, summarizeFlybys,
  fieldExtremes, windiest, weatherExtremes, tempWords, windWords, latLonWords, barsSvg, quakeChart, kpChart, launchChart,
} from '../src/core/earthnow.js';
import { parseUsgs } from '../src/core/quakes.js';
import { parseEonet } from '../src/core/eonet.js';
import { fromLL2, when, preciseLaunch as corePrecise } from '../src/core/launches.js';

const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/earthnow/${name}`, import.meta.url), 'utf8'));
const USGS = fx('usgs_4.5_week_2026-10-13.json'), KP = fx('swpc_kp_forecast_2026-10-13.json'), EONET = fx('eonet_wildfires_2026-10-13.json');
const NOW = Date.UTC(2026, 9, 13, 10, 0);

test('earthnow: USGS places → regions', () => {
  assert.equal(quakeRegion('122 km S of Kokopo, Papua New Guinea'), 'Papua New Guinea');
  assert.equal(quakeRegion('central Mid-Atlantic Ridge'), 'Mid-Atlantic Ridge');
  assert.equal(quakeRegion('southern Mid-Atlantic Ridge'), 'Mid-Atlantic Ridge');
  assert.equal(quakeRegion('5 km W of Cobb, CA'), 'California');
  assert.equal(quakeRegion('12 km NNE of Pahala, Hawaii'), 'Hawaii');
  assert.equal(quakeRegion('south of the Fiji Islands'), 'Fiji Islands');
  assert.equal(quakeRegion('Fiji region'), 'Fiji');
  assert.equal(quakeRegion('off the coast of Oregon'), 'Oregon');
  assert.equal(quakeRegion('Kermadec Islands, New Zealand'), 'New Zealand');
  assert.equal(quakeRegion('10 km SSW of Ensenada, B.C., MX'), 'Mexico');
  assert.equal(quakeRegion(''), 'Unnamed area');
  assert.equal(quakeRegion(null), 'Unnamed area');
  assert.equal(quakeClass(7.1), 'major'); assert.equal(quakeClass(4.5), 'light'); assert.equal(quakeClass(null), 'unknown');
});

test('earthnow: quake summary of a real USGS week', () => {
  const qs = parseUsgs(USGS);
  const s = summarizeQuakes(qs);
  assert.equal(s.count, USGS.features.length);
  // the strongest, worked out here independently of the code under test
  const top = Math.max(...USGS.features.map(f => f.properties.mag));
  assert.equal(s.strongest.mag, top);
  assert.equal(s.m45, USGS.features.filter(f => f.properties.mag >= 4.5).length);
  assert.equal(s.m6, USGS.features.filter(f => f.properties.mag >= 6).length);
  // the Panama swarm leads the regions in this week, with every one of its quakes counted
  const panama = USGS.features.filter(f => /, Panama$/.test(f.properties.place)).length;
  assert.ok(panama >= 8);
  const byName = Object.fromEntries(s.regions.map(r => [r.region, r]));
  assert.equal(byName.Panama.n, panama);
  assert.ok(s.regions[0].n >= s.regions[1].n, 'busiest first');
  assert.equal(byName.Panama.q.mag, Math.max(...USGS.features.filter(f => /, Panama$/.test(f.properties.place)).map(f => f.properties.mag)));
  // newest
  assert.equal(s.latest.time, Math.max(...USGS.features.map(f => f.properties.time)));
  // since: a later cut-off keeps fewer
  const later = summarizeQuakes(qs, { since: s.latest.time - 864e5 });
  assert.ok(later.count < s.count && later.count > 0);
  assert.deepEqual(summarizeQuakes(null), { count: 0, strongest: null, latest: null, m45: 0, m6: 0, tsunami: 0, alerts: 0, regions: [] });
});

test('earthnow: quakes per UTC day', () => {
  const qs = parseUsgs(USGS), gen = USGS.metadata.generated;
  const days = dailyCounts(qs, { now: gen, days: 8 });
  assert.equal(days.length, 8);
  assert.equal(days.at(-1).t, utcDayStart(gen)); assert.equal(days.at(-1).partial, true); assert.equal(days[0].partial, false);
  // every quake in the window lands in exactly one day
  const first = days[0].t, inWindow = qs.filter(q => q.time >= first).length;
  assert.equal(days.reduce((a, d) => a + d.n, 0), inWindow);
  // the day of the strongest quake has it as its max
  const top = qs.reduce((m, q) => (q.mag > m.mag ? q : m));
  const d = days.find(x => x.day === new Date(top.time).toISOString().slice(0, 10));
  assert.equal(d.max, top.mag);
  assert.match(days[0].label, /^[A-Z][a-z]{2} \d{1,2}$/);
  // a magnitude floor, and junk ignored
  const big = dailyCounts([...qs, { time: NaN }, null, { time: gen, mag: null }], { now: gen, days: 8, min: 5 });
  assert.equal(big.reduce((a, x) => a + x.n, 0), qs.filter(q => q.time >= first && q.mag >= 5).length);
});

test('earthnow: Kp levels agree with SWPC\'s own G-scale labels', () => {
  let checked = 0;
  for (const r of KP) {
    const g = kpLevel(r.kp).g, theirs = r.noaa_scale ? +r.noaa_scale.slice(1) : 0;
    assert.equal(g, theirs, `Kp ${r.kp} at ${r.time_tag}`); checked++;
  }
  assert.ok(checked > 50);
  assert.equal(kpLevel(9).g, 5); assert.equal(kpLevel(9).name, 'G5 extreme storm');
  assert.equal(kpLevel(2).name, 'quiet'); assert.equal(kpLevel(3.33).name, 'unsettled'); assert.equal(kpLevel(4).name, 'active');
  assert.equal(kpLevel(NaN).name, 'unknown');
  assert.match(auroraReach(7), /mid-latitudes/); assert.equal(auroraReach(null), '');
});

test('earthnow: Kp series and summary from the forecast product', () => {
  const all = kpSeries(KP, { now: NOW, pastH: 1e6, aheadH: 1e6 });
  assert.equal(all.length, KP.length);
  assert.ok(all.every((r, i) => i === 0 || r.t > all[i - 1].t));
  assert.deepEqual([...new Set(all.map(r => r.kind))].sort(), ['estimated', 'observed', 'predicted']);
  const past = kpSeries(KP, { now: NOW, pastH: 72 });
  assert.ok(past.every(r => r.t >= NOW - 72 * 3600e3 && r.t <= NOW));
  assert.ok(past.length >= 23 && past.length <= 25, String(past.length));
  const s = kpSummary(kpSeries(KP, { now: NOW, pastH: 7 * 24, aheadH: 72 }), NOW);
  assert.equal(s.max.kp, 7); assert.equal(kpLevel(s.max.kp).g, 3);   // the G3 storm of this week
  assert.notEqual(s.now.kind, 'predicted'); assert.ok(s.next.t > NOW);
  // the older product: a header row, then arrays of strings
  const old = kpSeries([['time_tag', 'Kp', 'a_running', 'station_count'], ['2026-10-13 06:00:00.000', '3.33', '18', '8'], ['2026-10-13 09:00:00.000', '4.00', '27', '8'], ['bad', 'x']], { now: NOW });
  assert.deepEqual(old.map(r => r.kp), [3.33, 4]);
  assert.equal(old[0].t, Date.UTC(2026, 9, 13, 6));
  assert.ok(s.now.t <= NOW && s.next.t > s.now.t);
  // a row "estimated" for a block that hasn't begun is not "now"
  const ahead = kpSummary([{ t: NOW - 3 * 3600e3, kp: 2, kind: 'observed' }, { t: NOW + 3 * 3600e3, kp: 5, kind: 'estimated' }], NOW);
  assert.equal(ahead.now.kp, 2); assert.equal(ahead.next.kp, 5); assert.equal(ahead.level.name, 'quiet');
  assert.equal(kpSummary([]), null);
  assert.deepEqual(kpSeries(null), []);
});

test('earthnow: wildfires from EONET, prescribed burns apart', () => {
  const ev = parseEonet(EONET);
  const s = summarizeWildfires(ev, { now: NOW });
  const rx = EONET.events.filter(e => /^Prescribed Fire/.test(e.title)).length;
  assert.equal(s.rx, rx); assert.equal(s.count, EONET.events.length - rx);
  assert.ok(!prescribed(s.largest));
  const wild = EONET.events.filter(e => !/^Prescribed Fire/.test(e.title));
  assert.equal(s.largestAcres, Math.max(...wild.map(e => e.geometry.at(-1).magnitudeValue)));
  assert.equal(wildfireRegion('Wildfire Buckhorn 2, Cassia, Idaho'), 'Idaho');
  assert.equal(wildfireRegion('Wildfire'), 'Elsewhere');
  assert.ok(prescribed({ title: 'Prescribed Fire West Fork RX, Wasatch, Utah' }));
  assert.ok(!prescribed({ title: 'Wildfire Rxyz, Kern, California' }));
  assert.equal(s.places[0].n, Math.max(...s.places.map(p => p.n)));
  assert.equal(summarizeWildfires(ev.map(e => ({ ...e, closed: '2026-10-12' }))).count, 0);
});

test('earthnow: storms, strongest first', () => {
  const s = summarizeStorms([{ title: 'Tropical Storm A', kt: 45, lat: 15, lon: -40 }, { title: 'Hurricane B', kt: 120, lat: 20, lon: -60 }, { title: 'no position', kt: 160 }, { title: 'Low C', lat: 10, lon: 130 }]);
  assert.equal(s.count, 3); assert.equal(s.strongest.title, 'Hurricane B'); assert.deepEqual(s.list.map(x => x.title), ['Hurricane B', 'Tropical Storm A', 'Low C']);
  assert.deepEqual(summarizeStorms(undefined), { count: 0, strongest: null, list: [] });
});

test('earthnow: launches soon, today and per month', () => {
  const base = fromLL2(fx('../ll2_launch.json').results[0]);
  assert.ok(base, 'the shared LL2 fixture maps');
  const L = (h, extra = {}) => ({ ...base, net: NOW + h * 3600e3, precision: 'MIN', status: 'Go', ...extra });
  const list = [L(-30), L(2), L(10), L(30), L(24 * 20), L(24 * 30, { precision: 'MONTH' }), L(24 * 40), L(0.5, { status: 'In Flight' })];
  assert.equal(launchesSoon(list, { now: NOW }).length, 3);
  assert.deepEqual(launchesSoon(list, { now: NOW }).map(l => l.net), [NOW + 0.5 * 3600e3, NOW + 2 * 3600e3, NOW + 10 * 3600e3]);
  // today (UTC 13 Oct): -30 h is the 12th; +2, +10, +0.5 are today; +30 h is the 14th
  assert.equal(launchesToday(list, NOW).length, 3);
  const months = launchesByMonth(list, { now: NOW, months: 3 });
  assert.deepEqual(months.map(m => m.month), ['2026-10', '2026-11', '2026-12']);
  assert.deepEqual(months.map(m => m.label), ['Oct', 'Nov', 'Dec']);
  // October: -30 h, +0.5 h, +2 h, +10 h, +30 h; November: +20 d (2 Nov) and +40 d; the MONTH-precision one is left out
  assert.equal(months[0].n, 5); assert.equal(months[1].n, 2); assert.equal(months[2].n, 0);
  assert.equal(months[0].partial, true); assert.equal(months[2].partial, true);
  assert.equal(launchesByMonth([], { now: NOW, months: 2 }).every(m => m.n === 0), true);
});

test('earthnow: flybys this week', () => {
  const rows = [{ name: 'a', tca: NOW - 3600e3, au: 0.001 }, { name: 'b', tca: NOW + 2 * 864e5, au: 0.02 }, { name: 'c', tca: NOW + 5 * 864e5, au: 0.004 }, { name: 'd', tca: NOW + 20 * 864e5, au: 0.0001 }];
  const s = summarizeFlybys(rows, { now: NOW });
  assert.equal(s.next7, 2); assert.equal(s.closest.name, 'c'); assert.equal(s.next.name, 'b'); assert.equal(s.total, 3);
  assert.ok(Math.abs(s.ld - 0.004 * 149597870.7 / 384400) < 1e-9);
  assert.equal(summarizeFlybys(null).closest, null);
});

test('earthnow: model extremes on a grid', () => {
  // a 1° global grid scanning north to south from 90°N, 0°E, like GFS
  const ni = 360, nj = 181, grid = { ni, nj, la1: 90, lo1: 0, di: 1, dj: 1, scan: 0 };
  const values = new Float32Array(ni * nj).fill(288);
  const at = (lat, lon) => (90 - lat) * ni + ((lon + 360) % 360);
  values[at(25, 50)] = 320; values[at(-78, 106)] = 200; values[at(0, 0)] = NaN;
  const e = fieldExtremes({ grid, values });
  assert.deepEqual(e.max, { v: 320, lat: 25, lon: 50 });
  assert.equal(e.min.lat, -78); assert.equal(e.min.lon, 106); assert.ok(Math.abs(e.min.v - 200) < 1e-4);
  const west = fieldExtremes({ grid, values }, { pick: (lat, lon) => lon < 0 });
  assert.equal(west.max.v, 288);
  const u = new Float32Array(ni * nj), v = new Float32Array(ni * nj);
  u[at(-55, -60)] = 30; v[at(-55, -60)] = 0;   // a 30 m/s westerly in the Drake Passage: blowing toward the east, from 270°
  const w = windiest({ u: { grid, values: u }, v: { grid, values: v } });
  assert.equal(w.lat, -55); assert.equal(w.lon, -60); assert.equal(w.v, 30); assert.ok(Math.abs(w.from - 270) < 1e-9);
  const all = weatherExtremes({ temp: { grid, values }, wind: { u: { grid, values: u }, v: { grid, values: v } } });
  assert.equal(all.hottest.v, 320); assert.equal(all.windiest.v, 30);
  assert.deepEqual(weatherExtremes({}), { hottest: null, coldest: null, windiest: null });
  assert.equal(tempWords(273.15 + 40), '40 °C · 104 °F'); assert.equal(windWords(10), '36 km/h · 19 kt'); assert.equal(tempWords(null), '—');
  assert.equal(latLonWords(-33.9, 151.2), '33.9°S 151.2°E');
});

test('earthnow: charts are accessible SVG with every value described and every label escaped', () => {
  const svg = barsSvg([{ n: 3, label: 'Mon' }, { n: 0, label: '<b>' }, { n: 7, label: 'Wed', dim: true, color: '#ff0000' }], { title: 'Quakes & more', id: 'x1', unit: 'quakes' });
  assert.match(svg, /^<svg [^>]*role="img"[^>]*aria-labelledby="x1-t x1-d"/);
  assert.match(svg, /<title id="x1-t">Quakes &amp; more<\/title>/);
  assert.match(svg, /<desc id="x1-d">Mon: 3 quakes; &lt;b&gt;: 0 quakes; Wed: 7 quakes \(partial\)<\/desc>/);
  assert.ok(!svg.includes('<b>'));
  assert.equal((svg.match(/<rect /g) || []).length, 3);
  assert.match(svg, /fill="currentColor"/); assert.match(svg, /fill="#ff0000" opacity="\.45"/);
  // the tallest bar fills the plot; a zero bar has no height
  const hs = [...svg.matchAll(/<rect [^>]*height="([\d.]+)"/g)].map(m => +m[1]);
  assert.equal(hs[1], 0); assert.ok(hs[2] > hs[0]);
  const qs = parseUsgs(USGS), days = dailyCounts(qs, { now: USGS.metadata.generated, days: 7 });
  const qc = quakeChart(days);
  assert.equal((qc.match(/<rect /g) || []).length, 7);
  assert.match(qc, /<desc[^>]*>[A-Z][a-z]{2} \d{1,2}: \d+ quakes;/, 'the description names the month, not just the day');
  assert.equal((qc.match(/aria-hidden="true">\d+</g) || []).length, 7, 'a count over each of the 7 bars');
  const kp = kpChart(kpSeries(KP, { now: NOW, pastH: 72, aheadH: 24 }));
  assert.match(kp, /G1 storm/); assert.match(kp, /predicted/);
  assert.match(kp, /<desc[^>]*>Oct \d{1,2} \d\d:00 UTC: [\d.]+ Kp/);
  assert.match(launchChart(launchesByMonth([], { now: NOW })), /Launches scheduled per month/);
  assert.match(barsSvg([]), /^<svg/);
});

test('earthnow: month, quarter and day placeholders get no countdown in the next 24 h', () => {
  const base = fromLL2(fx('../ll2_launch.json').results[0]);
  const at = (iso, precision, extra = {}) => ({ ...base, net: Date.parse(iso), precision, status: 'Go', ...extra });
  const now = Date.parse('2026-10-30T12:00:00Z');
  // LL2 parks "NET October" at 00:00Z on the month's last day, and a day-only date at 00:00Z of the day
  const list = [at('2026-10-31T00:00:00Z', 'M'), at('2026-10-31T00:00:00Z', 'Q4'), at('2026-10-31T00:00:00Z', 'DAY'), at('2026-10-31T03:15:00Z', 'MIN'),
    at('2026-10-30T20:00:00Z', 'HR'), at('2026-10-30T18:00:00Z', ''), at('2026-10-30T11:50:00Z', 'M', { status: 'In Flight' })];
  const soon = launchesSoon(list, { now });
  assert.deepEqual(soon.map(l => l.precision), ['M', '', 'HR', 'MIN'], 'the flight in progress stays; the placeholders are left out');
  assert.equal(launchesSoon([at('2026-10-31T00:00:00Z', 'M')], { now: Date.parse('2026-10-31T00:30:00Z') }).length, 0, 'no fake T+00:30 after midnight');
  assert.ok(preciseLaunch(at('2026-10-31T00:00:00Z', 'SEC')) && preciseLaunch(at('2026-10-31T00:00:00Z', 'minute')));
  assert.ok(!preciseLaunch(at('2026-10-31T00:00:00Z', 'Y')) && !preciseLaunch({ precision: 'MIN', net: NaN }) && !preciseLaunch(null));
  assert.equal(preciseLaunch, corePrecise, 'one test, kept beside when() in core/launches.js');
  // a launch with no precision field at all: a countdown in launchesSoon and the full time from when(), not the year only
  const bare = { net: Date.parse('2026-10-30T18:00:00Z') };
  assert.ok(preciseLaunch(bare));
  assert.equal(when(bare), '2026-10-30 18:00 UTC');
});
