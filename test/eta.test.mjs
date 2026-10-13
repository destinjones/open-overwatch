// Arrival/departure estimates with ranges and their track record (src/core/eta.js), and the runway-use history found in
// flight trails (src/core/runwaylog.js), on Denver's real runway layout (data/runways.json, OurAirports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decelTime, arrivalEstimate, departureEstimate, rangeText, agoText, EtaLog, etaRecordText, ETA_BANDS, APPROACH_MS } from '../src/core/eta.js';
import { detectMoves, onLine, landingRunway, takeoffRunway, RunwayLog, sameFlow, identHdg, historyText } from '../src/core/runwaylog.js';
import { parseRunways } from '../src/core/runways.js';
import { gcKm, bearing } from '../src/core/actype.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const RUNWAYS = parseRunways(JSON.parse(readFileSync(new URL('../data/runways.json', import.meta.url), 'utf8')));
const DEN = { icao: 'KDEN', lat: 39.8617, lon: -104.6731, elevM: 5431 * 0.3048 }, DEN_RW = RUNWAYS.get('KDEN');
const end = id => DEN_RW.flatMap(r => r.ends).find(e => e.ident === id);
/** A point `km` from (lat, lon) along bearing `brg`. */
function move(lat, lon, brg, km) {
  const d = km / 6371.0088, b = brg * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * 180 / Math.PI, lon: ((l2 * 180 / Math.PI + 540) % 360) - 180 };
}

// ------------------------------------------------------------------------------------------------ estimates
test('eta: slowing down over a distance', () => {
  near(decelTime(10, 100, 100), 100, 1e-9, 'steady: distance over speed');
  const t = decelTime(30, 130, 70); near(t, 30000 * Math.log(130 / 70) / 60, 1e-6);
  assert.ok(t > 30000 / 130 && t < 30000 / 70, 'between the times at either speed');
  // the closed form matches stepping it out
  let s = 0, tt = 0; const D = 30000; while (s < D) { const v = 130 + (70 - 130) * s / D; s += v * 0.05; tt += 0.05; }
  near(t, tt, 0.2);
  assert.equal(decelTime(10, 0, 70), null);
  assert.ok(APPROACH_MS.widebody > APPROACH_MS.light);
});

/** Fly a straight-in approach to 34R and land: the true time to touchdown from each point, to score the estimates. */
function straightIn(startKm = 60, v0 = 130, v1 = 70, dt = 5) {
  const thr = end('34R'), back = (thr.hdg + 180) % 360, out = [];
  let s = startKm * 1000, t = 0;
  while (s > 0) {
    const v = v1 + (v0 - v1) * s / (startKm * 1000), p = move(thr.lat, thr.lon, back, s / 1000), h = Math.min(s * Math.tan(3 * Math.PI / 180), 4000);
    out.push({ ...p, t, gs: v, track: thr.hdg, alt: DEN.elevM + h + 15, vr: -v * Math.tan(3 * Math.PI / 180), sKm: s / 1000 });
    s -= v * dt; t += dt;
  }
  for (const p of out) p.trueS = t - p.t;
  return out;
}

test('eta: a straight-in approach lands inside every estimate’s range, and the range narrows on final', () => {
  const path = straightIn();
  let widths = [];
  for (const p of path.filter((_, k) => k % 6 === 0)) {
    const onFinal = p.sKm <= 20;
    const e = arrivalEstimate(DEN, p, { final: onFinal ? { km: p.sKm } : null, cls: 'narrowbody' });
    assert.ok(e, JSON.stringify(p));
    assert.ok(p.trueS >= e.loS && p.trueS <= e.hiS, `at ${p.sKm.toFixed(1)} km: true ${p.trueS.toFixed(0)} s outside ${e.loS.toFixed(0)}–${e.hiS.toFixed(0)}`);
    if (onFinal) near(e.etaS, p.trueS, Math.max(45, p.trueS * 0.12), `on final at ${p.sKm.toFixed(1)} km`);
    widths.push([p.sKm, (e.hiS - e.loS) / Math.max(60, e.etaS)]);
  }
  const far = widths.find(w => w[0] > 50)[1], fin = widths.find(w => w[0] < 15)[1];
  assert.ok(fin < far, `relative range on final ${fin.toFixed(2)} < far out ${far.toFixed(2)}`);
});

test('eta: pointing away, too high, and the descent rate', () => {
  const p = { ...move(DEN.lat, DEN.lon, 180, 40), alt: DEN.elevM + 2500, gs: 120, vr: -5 };
  const head = arrivalEstimate(DEN, { ...p, track: 0 }), cross = arrivalEstimate(DEN, { ...p, track: 90 }), away = arrivalEstimate(DEN, { ...p, track: 180 });
  assert.ok(head.etaS < cross.etaS && cross.etaS < away.etaS, 'coming round takes longer');
  assert.ok((away.hiS - away.loS) > (head.hiS - head.loS), 'and is less certain');
  assert.equal(away.how, 'turning');
  const high = arrivalEstimate(DEN, { ...move(DEN.lat, DEN.lon, 180, 15), alt: DEN.elevM + 3000, gs: 120, track: 0, vr: -8 });
  assert.ok(high.pathKm >= 3000 / Math.tan(3 * Math.PI / 180) / 1000 - 0.01, '3,000 m up needs ~57 km at 3°'); assert.equal(high.how, 'high');
  const level = arrivalEstimate(DEN, { ...p, track: 0, vr: 0 }), steep = arrivalEstimate(DEN, { ...p, track: 0, vr: -20 });
  assert.ok(steep.etaS < level.etaS, 'a fast descent pulls the estimate in'); assert.ok(steep.etaS >= level.etaS * 0.7 - 1e-6, 'by at most 30%');
  assert.equal(arrivalEstimate(DEN, { ...p, gs: 5 }), null, 'no speed, no estimate');
  const wide = arrivalEstimate(DEN, { ...p, track: 0 }, { spread: 1.6 });
  assert.ok(wide.hiS - wide.loS > head.hiS - head.loS, 'a poor track record widens the range');
});

test('eta: departures, and the words', () => {
  // 2 min after lift-off at a steady acceleration from 75 to 130 m/s: ~12.4 km out, ~1,100 m up
  const p = { ...move(DEN.lat, DEN.lon, 0, 12.4), alt: DEN.elevM + 1100, gs: 130, vr: 10, track: 0 };
  const d = departureEstimate(DEN, p, { cls: 'narrowbody' });
  assert.ok(d.loS <= 120 && d.hiS >= 120, JSON.stringify(d)); near(d.agoS, 120, 40);
  assert.equal(rangeText({ etaS: 720, loS: 540, hiS: 1020 }), '≈ 12 min (9–17)');
  assert.equal(rangeText({ etaS: 30, loS: 0, hiS: 80 }), 'landing now');
  assert.equal(rangeText({ etaS: 4000, loS: 3000, hiS: 6000 }), '≈ 1 h 07 (50–100 min)');
  assert.equal(agoText({ agoS: 240, loS: 120, hiS: 360 }), 'took off ≈ 4 min ago (2–6)'); assert.equal(agoText({ agoS: 20, loS: 0, hiS: 40 }), 'took off just now');
});

test('eta: the track record scores estimates per band when the plane lands', () => {
  const log = new EtaLog(), t0 = Date.UTC(2026, 9, 13, 14);
  const est = (km, etaS) => ({ km, etaS, loS: etaS * 0.8, hiS: etaS * 1.3, how: 'direct' });
  assert.ok(log.note('KDEN', 'a1', t0, est(80, 1200)));
  assert.equal(log.note('KDEN', 'a1', t0 + 60e3, est(75, 1150)), false, 'one per band');
  assert.ok(log.note('KDEN', 'a1', t0 + 600e3, est(40, 600)));
  assert.ok(log.note('KDEN', 'a1', t0 + 1000e3, est(9, 200)));
  assert.equal(log.note('KDEN', 'a1', t0, est(300, 4000)), false, 'beyond the last band');
  const r = log.landed('KDEN', 'a1', t0 + 1230e3);
  assert.equal(r.length, 3); assert.deepEqual(r.map(x => x.band).sort((a, b) => a - b), [10, 50, 100]);
  near(r.find(x => x.band === 100).errS, 30, 1e-9); assert.equal(r.find(x => x.band === 10).inside, true);
  assert.deepEqual(log.landed('KDEN', 'a1', t0), [], 'scored once');
  assert.equal(log.spread('KDEN'), 1, 'too few landings to judge');
  for (let k = 0; k < 6; k++) { log.note('KDEN', 'b' + k, t0, est(20, 600)); log.landed('KDEN', 'b' + k, t0 + 1500e3); }   // all late, outside
  const s = log.summary('KDEN'); assert.equal(s.flights, 7); assert.ok(s.inside < s.n); assert.ok(s.biasS > 0);
  assert.equal(log.spread('KDEN'), 1.6, 'mostly outside: widen');
  assert.match(etaRecordText(s), /^Of 7 landings seen here, \d+ of \d+ estimates came in inside their range; typical miss [\d.]+ min, usually later than estimated\.$/);
  assert.equal(etaRecordText(new EtaLog().summary('KDEN')), '');
  const back = EtaLog.fromJSON(JSON.parse(JSON.stringify(log))); assert.equal(back.summary('KDEN').n, s.n);
  log.prune(t0 + 8 * 3600e3); assert.equal(log.summary().n, 0, 'old scores drop');
  assert.deepEqual(ETA_BANDS, [10, 25, 50, 100]);
});

// ------------------------------------------------------------------------------------------------ runway history
/** A trail landing on a runway end: 15-s fixes down a 3° slope from 12 km, touchdown 400 m in, then rolling out. */
function landingTrail(id, t0 = 0, { offsetM = 0 } = {}) {
  const thr = end(id), back = (thr.hdg + 180) % 360, pts = [];
  for (let k = 0; k <= 8; k++) {
    const s = 12 - k * 1.5, p = move(thr.lat, thr.lon, back, s), q = offsetM ? move(p.lat, p.lon, (thr.hdg + 90) % 360, offsetM / 1000) : p;
    pts.push({ t: t0 + k * 15e3, ...q, alt: DEN.elevM + s * 52, ground: false });
  }
  const td = move(thr.lat, thr.lon, thr.hdg, 0.4), roll = move(thr.lat, thr.lon, thr.hdg, 1.6);
  pts.push({ t: t0 + 9 * 15e3, ...td, alt: 0, ground: true }, { t: t0 + 10 * 15e3, ...roll, alt: 0, ground: true });
  return pts;
}
/** A trail taking off from a runway end: rolling, then climbing out along its heading. */
function takeoffTrail(id, t0 = 0) {
  const thr = end(id), pts = [];
  pts.push({ t: t0, ...move(thr.lat, thr.lon, thr.hdg, 0.2), alt: 0, ground: true }, { t: t0 + 20e3, ...move(thr.lat, thr.lon, thr.hdg, 1.4), alt: 0, ground: true });
  for (let k = 1; k <= 6; k++) pts.push({ t: t0 + 20e3 + k * 15e3, ...move(thr.lat, thr.lon, thr.hdg, 1.4 + k * 1.6), alt: DEN.elevM + k * 180, ground: false });
  return pts;
}

test('runway history: moves in a trail', () => {
  const pts = [...landingTrail('34R', 0), ...takeoffTrail('25', 40 * 60e3)];
  const m = detectMoves(pts);
  assert.deepEqual(m.map(x => x.kind), ['landing', 'takeoff']);
  assert.equal(m[0].i, 9); assert.equal(m[0].t, 9 * 15e3, 'the first fix on the ground');
  assert.equal(detectMoves(pts, m[0].t).length, 1, 'only after `since`');
  const gap = [{ t: 0, lat: 0, lon: 0, ground: false }, { t: 6 * 60e3, lat: 0, lon: 0, ground: true }];
  assert.deepEqual(detectMoves(gap), [], 'a gap over 5 minutes says nothing');
  const P = (t, ground) => ({ t: t * 1e3, lat: 39.86, lon: -104.67, ground });
  assert.deepEqual(detectMoves([P(0, false), P(10, true), P(11, false), P(20, false)]), [], 'a flicker of the ground flag is not a landing and a take-off');
  assert.deepEqual(detectMoves([P(0, false), P(10, true)]), [], 'the last point waits for the next');
  assert.equal(detectMoves([P(0, false), P(10, true), P(20, true)]).length, 1);
});

test('runway history: which runway a landing or take-off used, on Denver\'s layout', () => {
  for (const id of ['34R', '35L', '16L', '17R', '07', '26']) {
    const pts = landingTrail(id), i = detectMoves(pts)[0].i, r = landingRunway(DEN_RW, pts, i);
    assert.equal(r && r.end.ident, id, `landing on ${id}`); assert.ok(r.votes >= 5, `${id}: ${r.votes} votes`);
  }
  for (const id of ['34L', '25', '17L', '08']) {
    const pts = takeoffTrail(id), i = detectMoves(pts)[0].i, r = takeoffRunway(DEN_RW, pts, i);
    assert.equal(r && r.end.ident, id, `take-off from ${id}`);
  }
  // an approach 3.5 km west of 34R (2.7 km past 34L, the westernmost north runway) lines up with none of them
  const off = landingTrail('34R', 0, { offsetM: -3500 }); off.splice(9);   // no touchdown on a runway either
  off.push({ t: 9 * 15e3, ...move(39.95, -104.5, 0, 0), alt: 0, ground: true });
  assert.equal(landingRunway(DEN_RW, off, 9), null);
  const l = onLine(end('34R'), move(end('34R').lat, end('34R').lon, end('34R').hdg, 1)); near(l.along, 1000, 2); near(l.cross, 0, 2);
  near(bearing(end('34R').lat, end('34R').lon, end('16L').lat, end('16L').lon), end('34R').hdg, 0.01);
  near(gcKm(end('34R').lat, end('34R').lon, end('16L').lat, end('16L').lon), 12000 * 0.3048 / 1000, 0.1, 'thresholds 12,000 ft apart');
});

test('runway history: the log, its summary and a change of flow', () => {
  const log = new RunwayLog(), t0 = Date.UTC(2026, 9, 13, 13);
  const add = (rwy, kind, min, hex) => log.add({ icao: 'KDEN', rwy, kind, t: t0 + min * 60e3, hex, flight: 'UAL' + hex });
  add('16L', 'landing', 0, 'a'); add('17R', 'landing', 5, 'b'); add('16R', 'landing', 9, 'c');
  add('34R', 'landing', 20, 'd'); add('35L', 'landing', 26, 'e'); add('34R', 'landing', 31, 'f'); add('', 'landing', 33, 'g');
  add('25', 'takeoff', 10, 'h'); add('34L', 'takeoff', 25, 'i'); add('34L', 'takeoff', 35, 'j');
  assert.equal(add('34R', 'landing', 32, 'f'), false, 'the same plane landing twice in 10 min is one landing');
  const s = log.summary('KDEN', t0 + 40 * 60e3, 60);
  assert.deepEqual(s.arrivals.map(x => [x.rwy, x.n]), [['34R', 2], ['35L', 1], ['16R', 1], ['17R', 1], ['16L', 1]]);
  assert.deepEqual(s.departures.map(x => [x.rwy, x.n]), [['34L', 2], ['25', 1]]);
  assert.equal(s.unknown.arrivals, 1); assert.equal(s.total, 10);
  assert.deepEqual(s.change && [s.change.kind, s.change.from, s.change.to], ['landing', '16R', '34R'], 'south flow turned north');
  assert.equal(s.change.at, t0 + 14.5 * 60e3);
  assert.equal(historyText(s), 'Arrivals: 34R ×2, 35L ×1, 16R ×1, 17R ×1, 16L ×1 (+1 unmatched). Departures: 34L ×2, 25 ×1.');
  assert.equal(log.summary('KDEN', t0 + 90 * 60e3, 60).total, 3, 'only the last hour'); assert.equal(log.summary('EGLL', t0).total, 0);
  assert.equal(historyText(log.summary('EGLL', t0)), '');
  log.prune(t0 + 150 * 60e3); assert.equal(log.events.length, 3, 'kept two hours');
  assert.equal(RunwayLog.fromJSON(JSON.parse(JSON.stringify(log))).events.length, 3);
  assert.ok(sameFlow('34R', '35L')); assert.ok(!sameFlow('34R', '16L')); assert.ok(!sameFlow('07', '25')); assert.ok(sameFlow('H1', 'H1'));
  assert.equal(identHdg('34R'), 340); assert.equal(identHdg('36'), 0); assert.equal(identHdg('N'), null);
  const steady = new RunwayLog(); for (let k = 0; k < 5; k++) steady.add({ icao: 'X', rwy: k % 2 ? '34R' : '35L', kind: 'landing', t: t0 + k * 60e3, hex: 'p' + k });
  assert.equal(steady.summary('X', t0 + 10 * 60e3).change, null, 'parallel runways are one flow');
  const both = new RunwayLog(); ['25', '08', '25', '08', '08', '25', '25'].forEach((r, k) => both.add({ icao: 'X', rwy: r, kind: 'takeoff', t: t0 + k * 60e3, hex: 'q' + k }));
  assert.equal(both.summary('X', t0 + 10 * 60e3).change, null, 'departing east and west at once (Denver) is not a change of flow');
});

test('eta: high on final keeps the short path but widens the range', () => {
  const thr = end('34R'), p = { ...move(thr.lat, thr.lon, (thr.hdg + 180) % 360, 6), alt: DEN.elevM + 600, gs: 77, track: thr.hdg, vr: -5 };
  const e = arrivalEstimate(DEN, p, { final: { km: 6 } }), low = arrivalEstimate(DEN, { ...p, alt: DEN.elevM + 300 }, { final: { km: 6 } });
  assert.equal(e.how, 'high on final'); near(e.pathKm, 6, 1e-9); assert.ok(e.etaS < 120, `${e.etaS}`);
  assert.ok(e.hiS - e.etaS > low.hiS - low.etaS, 'a go-around is possible');
});
