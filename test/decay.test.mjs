// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Re-entry predictions (src/core/decay.js) against real element sets whose re-entries were published.
//
// Fixture sources (public copies of the 18th Space Defense Squadron's element sets, never fetched by the tests):
//   TIANGONG 1 and ISS, epoch 2018-03-31: skyfielders/astronomy-notebooks, Talks/stations-2018-03-31.tle (GitHub).
//   GOCE, epoch 2013-10-23: AleksanderLidtke/ConjunctionDetection, Debug/Covariance 3LEs/34602.txt (GitHub).
//   STARLINK-1810 and COSMOS 2572, epochs 2026-10-13/14: this site's own copy of CelesTrak's groups (data/tle/).
// Re-entry times (the reports cited):
//   Tiangong-1: 2018-04-02 00:16 UTC over the South Pacific (China Manned Space Engineering Office; Wikipedia "Tiangong-1").
//   GOCE: 2013-11-11 00:16 UTC (ESA, "GOCE gives in to gravity", 11 Nov 2013).
//   Starlink-1810: Aerospace Corporation CORDS predicted 2026-10-13 15:37 UTC ± 6 h (aerospace.org/reentries, read by hand
//   2026-10-14); COSMOS 2572: CORDS predicted 2026-10-18 04:46 UTC ± 28 h. A reference to compare against, not a fact.
// Solar activity: March 2018 was solar minimum (F10.7 ≈ 70 sfu); late 2013 near cycle 24's maximum (F10.7 ≈ 140).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predict, elements, expField, density, corridor, windowWords, spanText, uncertaintyWords, whereWords, fallingSoon, status,
  stampDecay, quickDays, effectiveFlux, scaleHeight, ballisticFromBstar, WINDOW_FRACTION, MAX_BALLISTIC } from '../src/core/decay.js';
import { recordOf, provLine } from '../src/core/liveprov.js';

const TG1 = ['1 37820U 11053A   18090.63734353  .01995214  91302-5  18234-3 0  9994',
  '2 37820  42.7537 203.0502 0007804 350.3894   9.7592 16.37770827373815'];
const ISS = ['1 25544U 98067A   18090.58626157  .00001630  00000-0  31800-4 0  9994',
  '2 25544  51.6406  45.5717 0001685 278.7810  65.9688 15.54173033106445'];
const GOCE = ['1 34602U 09013A   13296.16200819  .00329825  19234-5  20042-3 0    58',
  '2 34602 096.5524 325.4262 0005277 350.8312 084.7431 16.18259876269912'];
const SL1810 = ['1 46709U 20073AR  26286.57776559  .09374670  12330-4  83055-3 0  9996',
  '2 46709  53.0090 234.7860 0002227 286.5126  73.5674 16.38388586331485'];
const COSMOS2572 = ['1 58435U 23182A   26287.54619006  .01161547  20183-5  47165-3 0  9997',
  '2 58435  96.6639  30.5575 0006362 261.2814  98.7758 16.23428362167489'];
const MIN2018 = { f107: 70, kp: 2 }, MAX2013 = { f107: 140, kp: 2 };
const inside = (p, iso) => { const t = Date.parse(iso); return t >= p.windowMs[0] && t <= p.windowMs[1]; };
const DAY = 864e5;

test('decay: TLE fields (exponent fields, n-dot, heights)', () => {
  assert.ok(Math.abs(expField(' 18234-3') - 0.18234e-3) < 1e-15);
  assert.ok(Math.abs(expField('-11606-4') + 0.11606e-4) < 1e-15);
  assert.equal(expField(' 00000-0'), 0);
  assert.equal(expField('junk'), 0);
  const el = elements(...TG1);
  assert.equal(el.id, '37820');
  assert.ok(Math.abs(el.ndot - 0.03990428) < 1e-9);
  assert.ok(el.perigeeKm > 160 && el.perigeeKm < 175 && el.apogeeKm > el.perigeeKm && el.apogeeKm < 185, `${el.perigeeKm} x ${el.apogeeKm}`);
  assert.equal(new Date(el.epochMs).toISOString().slice(0, 16), '2018-03-31T15:17');
  const iss = elements(...ISS);
  assert.ok(iss.perigeeKm > 395 && iss.perigeeKm < 415, iss.perigeeKm);
  assert.ok(Math.abs(ballisticFromBstar(iss) - 12.741621 * 0.318e-4) < 1e-12);
});

test('decay: the atmosphere falls off with height and swells with the Sun', () => {
  assert.ok(density(200) > density(300) && density(300) > density(400));
  assert.ok(density(400, { f107: 250 }) / density(400, { f107: 70 }) > 5, 'solar max vs min at 400 km');
  assert.ok(Math.abs(density(120, { f107: 250 }) / density(120, { f107: 70 }) - 1) < 1e-9, '120 km does not care');
  assert.ok(effectiveFlux({ f107: 140, kp: 5 }) > effectiveFlux({ f107: 140, kp: 2 }));
  assert.equal(scaleHeight(400), 58.515);
});

test('decay: a fresh ISS set is nowhere near coming down (years without reboosts, not months)', () => {
  const p = predict(...ISS, { solar: MIN2018 });
  assert.equal(p.method, 'n-dot');
  assert.ok(p.days > 365 * 3, spanText(p.days));
  assert.ok(p.windowMs[0] - p.epochMs > 180 * DAY, 'even the window\'s near edge is months away');
  assert.equal(fallingSoon([{ id: '25544', name: 'ISS', l1: ISS[0], l2: ISS[1] }], { now: p.epochMs }).length, 0);
  // and a fresh one (the site's copy, 2026-10-13), near solar maximum's tail
  const now = predict('1 25544U 98067A   26286.82178372  .00006592  00000+0  12831-3 0  9991', '2 25544  51.6325  73.0089 0006710 259.3258 100.6975 15.48855783590140');
  assert.ok(now.days > 365 && !now.manoeuvring, spanText(now.days));
  assert.equal(expField(' 00000+0'), 0);
  assert.ok(Math.abs(expField(' 25552+0') - 0.25552) < 1e-12);
});

test('decay: Tiangong-1, 34 h before it came down, has 2018-04-02 00:16 UTC inside its window', () => {
  for (const solar of [MIN2018, MAX2013]) {
    const p = predict(...TG1, { solar });
    assert.ok(inside(p, '2018-04-02T00:16Z'), `${new Date(p.windowMs[0]).toISOString()} - ${new Date(p.windowMs[1]).toISOString()} (F10.7 ${solar.f107})`);
    assert.ok(Math.abs(p.reentryMs - Date.parse('2018-04-02T00:16Z')) < 6 * 3600e3, 'nominal within 6 h');
    assert.equal(p.fraction, WINDOW_FRACTION);
  }
});

test('decay: GOCE, 19 days out (just after its engine stopped), has 2013-11-11 00:16 UTC inside its window', () => {
  const p = predict(...GOCE, { solar: MAX2013 });
  assert.ok(inside(p, '2013-11-11T00:16Z'), `${new Date(p.windowMs[0]).toISOString()} - ${new Date(p.windowMs[1]).toISOString()}`);
  assert.ok(p.days > 12 && p.days < 25, spanText(p.days));
  assert.ok(p.otherDays > 12 && p.otherDays < 30, 'B* agrees roughly: ' + spanText(p.otherDays));
});

test('decay: decaying objects of today agree with Aerospace CORDS\'s predictions (the reference, by hand)', () => {
  const sl = predict(...SL1810), cos = predict(...COSMOS2572);
  // Starlink-1810: CORDS 15:37 ± 6 h; ours must overlap that window and sit within it
  assert.ok(Math.abs(sl.reentryMs - Date.parse('2026-10-13T15:37Z')) < 6 * 3600e3, new Date(sl.reentryMs).toISOString());
  // COSMOS 2572: CORDS 2026-10-18 04:46 ± 28 h; their time inside our window, ours inside theirs
  assert.ok(inside(cos, '2026-10-18T04:46Z'), windowWords(cos));
  assert.ok(Math.abs(cos.reentryMs - Date.parse('2026-10-18T04:46Z')) < 28 * 3600e3);
  assert.equal(status(cos, Date.parse('2026-10-14T20:00Z')), 'ahead');
  assert.equal(status(cos, Date.parse('2026-10-18T06:00Z')), 'window');
  assert.equal(status(cos, Date.parse('2026-10-25T00:00Z')), 'past');
});

test('decay: thruster burns are not drag (manoeuvring objects are flagged and left out)', () => {
  // a Starlink at ~550 km with the n-dot of an object 380 km lower: an operator lowering it, not the air
  const l1 = '1 64792U 25108K   26287.25000000  .01200000  00000-0  50000-2 0  9990';
  const l2 = '2 64792  43.0000 100.0000 0005000  90.0000 270.0000 15.1500000070000';
  const p = predict(l1, l2);
  assert.ok(p.ballistic > MAX_BALLISTIC && p.manoeuvring);
  assert.equal(fallingSoon([{ id: '64792', l1, l2, group: 'starlink' }], { now: p.epochMs }).length, 0);
  assert.equal(predict(...TG1).manoeuvring, false);
  // a new satellite raising itself from 300 km: n-dot negative (the orbit grows); B* alone would have it falling in weeks
  const r1 = '1 66000U 26200A   26287.25000000 -.00050000  00000-0  30000-3 0  9990';
  const r2 = '2 66000  53.0000 100.0000 0005000  90.0000 270.0000 15.9000000000100';
  assert.equal(predict(r1, r2).manoeuvring, true);
});

test('decay: the corridor is the ground track around the likeliest time, never beyond ±inclination', () => {
  const p = predict(...TG1, { solar: MIN2018, keepPath: true }), c = corridor(p);
  assert.ok(c.segments.length >= 2, 'split at the antimeridian');
  const pts = c.segments.flat();
  assert.ok(pts.every(q => Math.abs(q.lat) <= 42.76 + 0.01 && q.lon >= -180 && q.lon <= 180));
  assert.ok(Math.max(...pts.map(q => q.lat)) > 41 && Math.min(...pts.map(q => q.lat)) < -41, 'reaches both turning latitudes');
  assert.equal(c.coversWindow, false, 'a 17 h window is more than 3 orbits');
  assert.ok(c.from < p.reentryMs && c.to > p.reentryMs && c.to - c.from < 5 * 3600e3);
  for (const s of c.segments) for (let i = 1; i < s.length; i++) assert.ok(Math.abs(s[i].lon - s[i - 1].lon) < 180);
  // a short window is covered whole: Starlink-1810's ± 1.9 h is under 3 orbits
  const q = corridor(predict(...SL1810, { keepPath: true }));
  assert.equal(q.coversWindow, true);
  assert.ok(q.to - q.from < 4 * 3600e3);
  assert.equal(corridor(predict(...TG1)), null, 'needs keepPath');
});

test('decay: the window in plain words', () => {
  const at = (lo, hi) => ({ reentryMs: (Date.parse(lo) + Date.parse(hi)) / 2, windowMs: [Date.parse(lo), Date.parse(hi)], days: 4, fraction: 0.25 });
  assert.equal(windowWords(at('2026-10-20T03:10Z', '2026-10-22T20:50Z')), 'between Tue 03:00 and Thu 21:00 UTC');
  assert.equal(windowWords(at('2026-10-20T03:04Z', '2026-10-20T05:58Z')), 'between Tue 03:00 and Tue 06:00 UTC');
  assert.equal(windowWords(at('2026-10-20T00:00Z', '2026-11-01T00:00Z')), 'between Tue 20 Oct and Sun 1 Nov');
  assert.equal(windowWords(at('2026-10-20T00:00Z', '2027-02-01T00:00Z')), 'between 20 Oct 2026 and 1 Feb 2027');
  assert.equal(windowWords({ reentryMs: Infinity }), 'not in the next 25 years');
  assert.equal(spanText(0.5), '12 h');
  assert.equal(spanText(3.21), '3.2 days');
  assert.equal(spanText(800), '2.2 years');
  assert.match(uncertaintyWords(predict(...TG1)), /^±25% of the 3\d h it had left/);
  const p = predict(...TG1, { keepPath: true }), c = corridor(p);
  assert.match(whereWords(p, c), /^between \w{3} \d\d:\d\d and \w{3} \d\d:\d\d UTC; anywhere under its track between 43° N and S/);
  assert.match(whereWords(p, { ...c, coversWindow: true }), /; anywhere along these tracks$/);
});

test('decay: provenance (the TLE epoch is the data time; confidence follows the prediction\'s uncertainty)', () => {
  const p = stampDecay(predict(...TG1), TG1[0], 'mirror');
  assert.equal(p.prov.layer, 'reentry');
  assert.equal(p.prov.sources[0].dataAt, p.epochMs);
  assert.equal(p.prov.sources[0].cached, true);
  // 34 h left: stale once the element set is older than a fifth of that (~6.8 h)
  assert.equal(recordOf(p, p.epochMs + 3600e3).confidence, 'reported');
  assert.equal(recordOf(p, p.epochMs + 8 * 3600e3).confidence, 'stale');
  assert.match(provLine(p, p.epochMs + 3600e3), /^CelesTrak \(copy\) · data 60 min old · reported$/);
  const iss = stampDecay(predict(...ISS), ISS[0], 'celestrak');
  assert.equal(iss.prov.maxAgeMs, 3 * DAY, 'capped at 3 days');
  assert.equal(iss.prov.sources[0].cached, false);
});

test('decay: "Falling soon" sorts, filters to the next 30 days, skips launches and the far-off', () => {
  const now = Date.parse('2026-10-14T20:00Z');
  const sats = [
    { id: '58435', name: 'COSMOS 2572', l1: COSMOS2572[0], l2: COSMOS2572[1], group: 'active' },
    { id: '46709', name: 'STARLINK-1810', l1: SL1810[0], l2: SL1810[1], group: 'starlink' },   // window closed before `now`
    { id: '25544', name: 'ISS', l1: ISS[0], l2: ISS[1], group: 'stations' },
    { id: '58435', name: 'COSMOS 2572 again', l1: COSMOS2572[0], l2: COSMOS2572[1] },
  ];
  const list = fallingSoon(sats, { now });
  assert.deepEqual(list.map(p => p.id), ['58435']);
  assert.equal(list[0].name, 'COSMOS 2572');
  assert.equal(list[0].working, true);
  assert.ok(list[0].path && list[0].prov);
  const early = fallingSoon(sats, { now: Date.parse('2026-10-13T14:00Z') });
  assert.deepEqual(early.map(p => p.id), ['46709', '58435'], 'soonest first');
  assert.equal(fallingSoon(sats, { now, exclude: new Set(['58435']) }).length, 0);
  assert.equal(fallingSoon(sats, { now, days: 2 }).length, 0, 'not within 2 days');
  const deb = fallingSoon([{ ...sats[0], group: 'cosmos-2251-debris' }], { now });
  assert.equal(deb[0].working, false);
  assert.ok(quickDays(elements(...ISS)) > 365, 'the quick screen skips the ISS');
});
