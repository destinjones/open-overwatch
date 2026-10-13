// Eclipses and lunar occultations (src/core/syzygy.js). The Sun and the Moon come from JPL Horizons
// (data/solar/ephem.json, brand/tools/make_ephem.py); the fit is checked against 40 Horizons instants it never saw
// (test/fixtures/horizons_ephem_check.json), the solar eclipses against the globe's own eclipse code on Horizons'
// minute tables (data/eclipses.json, core/eclipselocal.js), and the lunar eclipses against NASA's Five Millennium
// Canon (Espenak & Meeus). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chebEval, createEphemeris, minimize, root, lunations, earthShadow, lunarEclipse, solarEclipse, findEclipses,
  occultationGeometry, findOccultations, planetGeocentric, subPoint, toFixed, eventTitle, R_EARTH, DANJON, OCCULT_STARS,
} from '../src/core/syzygy.js';
import { greatestEclipse } from '../src/core/eclipselocal.js';
import { interp, R_MOON } from '../src/core/eclipse.js';
import { eqToEcl, radecToEcl, AU_KM } from '../src/core/units.js';
import { jdFromMs } from '../src/core/time.js';

const root_ = new URL('../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root_)));
const EPH = read('data/solar/ephem.json'), CHECK = read('test/fixtures/horizons_ephem_check.json'), ECL = read('data/eclipses.json');
const eph = createEphemeris(EPH);
const jd = iso => jdFromMs(Date.parse(iso + 'Z'));
const minutes = (a, b) => Math.abs(a - b) * 1440;

// ---------------------------------------------------------------- the ephemeris

test('syzygy: Chebyshev Sun and Moon match Horizons at 40 instants the fit never saw', () => {
  for (const key of ['moon', 'sun']) {
    let worst = 0;
    for (const [t, x, y, z] of CHECK[key]) { const p = eph[key](t); worst = Math.max(worst, Math.hypot(p.x - x, p.y - y, p.z - z)); }
    assert.ok(worst < (key === 'moon' ? 1 : 20), `${key}: ${worst.toFixed(3)} km`);   // the Moon to a kilometre, the Sun to 20 km of 150 million
  }
  assert.ok(eph.has(jd('2028-06-01T00:00')) && !eph.has(jd('2032-01-01T00:00')));
});

test('syzygy: Chebyshev evaluation (Clenshaw) and the small solvers', () => {
  const ser = { t0: 0, seg_days: 2, deg: 2, segs: [[[1, 2, 3], [0, 1, 0], [5, 0, 0]]] };   // x = 1 + 2t + 3(2t^2 - 1)
  for (const t of [-1, -0.3, 0, 0.8, 1]) assert.ok(Math.abs(chebEval(ser, t + 1).x - (1 + 2 * t + 3 * (2 * t * t - 1))) < 1e-12);
  assert.equal(chebEval(ser, 2).y, 1); assert.equal(chebEval(ser, 1).y, 0); assert.equal(chebEval(ser, 1).z, 5);
  assert.ok(Math.abs(minimize(x => (x - 0.3) ** 2, -1, 2).t - 0.3) < 1e-5);
  assert.ok(Math.abs(root(x => x * x - 2, 0, 2, 1e-12) - Math.SQRT2) < 1e-9);
});

test('syzygy: new and full Moons (NASA phases: 2027 full Moon 2027-02-20 23:23, new Moon 2027-08-02 10:05 UT)', () => {
  const L = lunations(eph, jd('2027-01-01T00:00'), jd('2028-01-01T00:00'));
  // 2027 has 13 new Moons (Jan 7 ... Dec 27) and 12 full ones; a synodic month apart, 29.27-29.83 days
  assert.equal(L.filter(l => l.phase === 'new').length, 13); assert.equal(L.filter(l => l.phase === 'full').length, 12);
  const nm = L.filter(l => l.phase === 'new'); for (let i = 1; i < nm.length; i++) { const d = nm[i].jd - nm[i - 1].jd; assert.ok(d > 29.2 && d < 29.9, `${d}`); }
  const full = L.find(l => l.phase === 'full' && l.jd > jd('2027-02-19T00:00')), nw = L.find(l => l.phase === 'new' && l.jd > jd('2027-08-01T00:00'));
  assert.ok(minutes(full.jd, jd('2027-02-20T23:23')) < 2, `full ${minutes(full.jd, jd('2027-02-20T23:23'))}`);
  assert.ok(minutes(nw.jd, jd('2027-08-02T10:05')) < 2, `new ${minutes(nw.jd, jd('2027-08-02T10:05'))}`);
});

// ---------------------------------------------------------------- solar eclipses

/** An "ephemeris" over one eclipse's Horizons minute table (ICRF -> ecliptic), independent of ephem.json. */
function minuteEphemeris(e) {
  const n = e.sun.length, m = t => Math.max(0, Math.min(n - 1.000001, (t - e.jd0) * 1440));
  const at = (rows, t, out = {}) => { const p = interp(rows, m(t)); return Object.assign(out, eqToEcl(p.x, p.y, p.z)); };
  return { sun: (t, o) => at(e.sun, t, o), moon: (t, o) => at(e.moon, t, o), mid: e.jd0 + (n - 1) / 2880 };
}

test('syzygy: solar eclipses agree with the globe\'s eclipse code on the same Horizons tables (10 eclipses 2027-2030)', () => {
  for (const e of ECL.eclipses) {
    const me = minuteEphemeris(e), s = solarEclipse(me, me.mid), g = greatestEclipse(structuredClone(e));
    assert.ok(s, e.date);
    assert.equal(s.kind, e.type, e.date);
    assert.ok(Math.abs((s.jd - 2440587.5) * 864e5 - g.at) < 15e3, `${e.date} greatest ${((s.jd - 2440587.5) * 864e5 - g.at) / 1e3} s`);
    assert.ok(Math.abs(s.at.lat - g.lat) < 0.2 && Math.abs(s.at.lon - g.lon) < 0.3, `${e.date} place`);
    if (g.width_km) assert.ok(Math.abs(s.width_km - g.width_km) < 1, `${e.date} width`);
    if (g.magnitude) assert.ok(Math.abs(s.magnitude - g.magnitude) < 1e-3, `${e.date} magnitude`);   // partial eclipses: the same measure
  }
});

test('syzygy: solar eclipses 2026-2030 from the Chebyshev ephemeris against NASA (type, greatest within 1 min, magnitude)', () => {
  const S = findEclipses(eph).filter(e => e.type === 'solar');
  // eclipse.gsfc.nasa.gov/SEdecade/SEdecade2021.html: greatest eclipse (TD; UT = TD - ~70 s), type, eclipse magnitude
  const NASA = [['2026-02-17T12:13:05', 'annular', 0.963], ['2026-08-12T17:47:05', 'total', 1.039], ['2027-02-06T16:00:47', 'annular', 0.928],
    ['2027-08-02T10:07:49', 'total', 1.079], ['2028-01-26T15:08:58', 'annular', 0.921], ['2028-07-22T02:56:39', 'total', 1.056],
    ['2029-01-14T17:13:47', 'partial', 0.871], ['2029-06-12T04:06:13', 'partial', 0.458], ['2029-07-11T15:37:18', 'partial', 0.230],
    ['2029-12-05T15:03:57', 'partial', 0.891], ['2030-06-01T06:29:13', 'annular', 0.944], ['2030-11-25T06:51:37', 'total', 1.047]];
  assert.equal(S.length, NASA.length, S.map(e => new Date((e.jd - 2440587.5) * 864e5).toISOString().slice(0, 10)).join(' '));
  NASA.forEach(([td, kind, mag], i) => {
    const e = S[i], ut = jd(td) - 70 / 86400;
    assert.equal(e.kind, kind, td);
    assert.ok(minutes(e.jd, ut) < 1, `${td}: ${minutes(e.jd, ut).toFixed(2)} min`);
    assert.ok(Math.abs(e.magnitude - mag) < 0.002, `${td} magnitude ${e.magnitude.toFixed(4)} vs ${mag}`);
    assert.ok(e.contacts.P1 < e.jd && e.jd < e.contacts.P4 && (e.contacts.P4 - e.contacts.P1) * 24 < 7);
  });
  const big = S[3];   // 2027-08-02: greatest near Luxor, Egypt (NASA 25.5 N 33.2 E)
  assert.ok(Math.abs(big.at.lat - 25.5) < 0.2 && Math.abs(big.at.lon - 33.2) < 0.3, `${big.at.lat} ${big.at.lon}`);
  assert.ok(Math.abs(big.gamma - 0.142) < 0.002 && S.every(e => (Math.abs(e.gamma) < 1) === e.central || e.kind === 'partial'));
  assert.equal(eventTitle({ type: 'solar', ...big }), 'Total solar eclipse');
});

// ---------------------------------------------------------------- lunar eclipses

test('syzygy: Earth\'s shadow radii by Danjon\'s rule at a typical distance', () => {
  const s = earthShadow({ x: -1.496e8, y: 0, z: 0 }, { x: 384400, y: 0, z: 0 });
  const deg = r => r * 180 / Math.PI;
  assert.ok(Math.abs(deg(s.rhoU) - 0.70) < 0.02 && Math.abs(deg(s.rhoP) - 1.23) < 0.02, `${deg(s.rhoU)} ${deg(s.rhoP)}`);
  assert.ok(s.sigma < 1e-12 && s.umbral > 1.5);   // dead centre
  assert.ok(DANJON > 1.011 && DANJON < 1.012);
});

test('syzygy: lunar eclipses 2026-2030 against NASA canon (type, greatest within 2 min, umbral magnitude within 0.01, durations)', () => {
  const Lu = findEclipses(eph).filter(e => e.type === 'lunar');
  // eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html: greatest eclipse in TD (UT = TD - ~70 s), type, umbral magnitude,
  // partial-phase and total-phase durations (minutes)
  const NASA = [['2026-03-03T11:34:52', 'total', 1.151, 207, 58], ['2026-08-28T04:14:04', 'partial', 0.930, 198], ['2027-02-20T23:14:06', 'penumbral', -0.057],
    ['2027-07-18T16:04:09', 'penumbral', -1.068], ['2027-08-17T07:14:59', 'penumbral', -0.525], ['2028-01-12T04:14:13', 'partial', 0.066, 56],
    ['2028-07-06T18:20:57', 'partial', 0.389, 141], ['2028-12-31T16:53:15', 'total', 1.246, 209, 71], ['2029-06-26T03:23:22', 'total', 1.844, 220, 102],
    ['2029-12-20T22:43:12', 'total', 1.117, 213, 54], ['2030-06-15T18:34:34', 'partial', 0.502, 144], ['2030-12-09T22:28:51', 'penumbral', -0.163]];
  assert.equal(Lu.length, NASA.length, Lu.map(e => new Date((e.jd - 2440587.5) * 864e5).toISOString().slice(0, 16)).join(' '));
  NASA.forEach(([td, kind, um, partial, total], i) => {
    const e = Lu[i], ut = jd(td) - 70 / 86400;
    assert.equal(e.kind, kind, td);
    assert.ok(minutes(e.jd, ut) < 2, `${td}: ${minutes(e.jd, ut).toFixed(2)} min`);
    assert.ok(Math.abs(e.umbral - um) < 0.01, `${td} umbral ${e.umbral.toFixed(4)} vs ${um}`);
    assert.ok(e.penumbral > 0);
    if (partial) assert.ok(Math.abs(e.durations.partial - partial) < 2, `${td} partial ${e.durations.partial}`);
    if (total) assert.ok(Math.abs(e.durations.total - total) < 2, `${td} total ${e.durations.total}`);
    else assert.equal(e.durations.total, null);
  });
  const long = Lu[8];   // 2029-06-26: one of the longest totalities of the century
  assert.ok(long.contacts.P1 < long.contacts.U1 && long.contacts.U1 < long.contacts.U2 && long.contacts.U2 < long.jd && long.contacts.U3 < long.contacts.U4 && long.contacts.U4 < long.contacts.P4);
  // the Moon is overhead somewhere on the night side: opposite the Sun's sub-point
  const s = subPoint(eph.sun(long.jd), long.jd), dl = 180 - Math.abs(((s.lon - long.sub.lon) % 360 + 540) % 360 - 180);
  assert.ok(dl < 2 && Math.abs(s.lat + long.sub.lat) < 2, `${dl} ${s.lat} ${long.sub.lat}`);
});

// ---------------------------------------------------------------- occultations

test('syzygy: occultation geometry: the Moon on the line, beside it, and behind Earth', () => {
  const star = { x: 1e15, y: 0, z: 0 };
  assert.ok(occultationGeometry({ x: 384400, y: 0, z: 0 }, star).d < 1e-9);
  const g = occultationGeometry({ x: 384400, y: R_EARTH + R_MOON - 10, z: 0 }, star);
  assert.ok(g.ahead && g.d < g.limit);   // a graze: the Moon's edge just reaches the line past Earth's limb
  assert.ok(occultationGeometry({ x: 384400, y: R_EARTH + R_MOON + 10, z: 0 }, star).d > g.limit);
  assert.equal(occultationGeometry({ x: -384400, y: 0, z: 0 }, star).ahead, false);
  // a planet's disc widens the limit by its radius as projected to the Moon's distance
  const jup = occultationGeometry({ x: 384400, y: 0, z: 0 }, { x: 6.3e8, y: 0, z: 0 }, 69911);
  assert.ok(Math.abs(jup.limit - (R_EARTH + R_MOON + 69911 * 384400 / 6.3e8)) < 1e-6);
});

test('syzygy: lunar occultations 2026-2030 (the Regulus series of 2025-2027, Antares and the Pleiades, published planet events)', () => {
  const O = findOccultations(eph);
  const by = k => O.filter(o => o.target === k);
  // the Moon covers Antares and the Pleiades every month or so in these years, Regulus monthly until 2027; Spica's
  // series ended in 2025, Aldebaran's next starts in 2033
  assert.ok(by('antares').length >= 10, `antares ${by('antares').length}`);
  assert.ok(by('regulus').length >= 10 && by('regulus').every(o => o.jd < jd('2028-01-01T00:00')), 'regulus');
  assert.equal(by('spica').length, 0);
  assert.ok(by('pleiades').length >= 10, `pleiades ${by('pleiades').length}`);
  assert.ok(by('aldebaran').length === 0, 'the next Aldebaran series starts in 2033');
  for (const o of O) {
    assert.ok(o.impact < (R_EARTH + R_MOON) / R_EARTH + 0.05, `${o.name} impact ${o.impact}`);
    assert.ok(o.at.lat >= -90 && o.at.lat <= 90 && o.at.lon >= -180 && o.at.lon <= 180);
    assert.ok(o.elongation >= 0 && o.elongation <= 180);
  }
  // published predictions: Venus in daylight over North America on 2026-06-17; Jupiter on 2026-09-08 (daylight for
  // most) and 2026-10-06 (before dawn after moonrise)
  const on = (k, day) => by(k).find(o => new Date((o.jd - 2440587.5) * 864e5).toISOString().slice(0, 10) === day);
  const v = on('venus', '2026-06-17'); assert.ok(v && v.at.lat > 20 && v.at.lat < 55 && v.at.lon > -110 && v.at.lon < -60 && v.sunAlt > 0, 'Venus 2026-06-17');
  assert.ok(on('jupiter', '2026-09-08') && on('jupiter', '2026-10-06'), 'Jupiter 2026');
  for (const p of ['mercury', 'venus', 'mars', 'jupiter']) assert.ok(by(p).length >= 3, p);
  assert.equal(by('saturn').length, 0, 'the Saturn series ended in 2025');
  // time order, and no event twice
  for (let i = 1; i < O.length; i++) assert.ok(O[i].jd >= O[i - 1].jd);
  assert.equal(eventTitle({ type: 'occultation', ...O[0] }), `The Moon covers ${O[0].name}`);
});

test('syzygy: planets from Earth: light-time corrected geocentric places (Jupiter ~4-6 AU, Venus within 1.8 AU)', () => {
  const t = jd('2027-03-01T00:00'), J = planetGeocentric('jupiter', t), V = planetGeocentric('venus', t);
  const au = p => Math.hypot(p.x, p.y, p.z) / AU_KM;
  assert.ok(au(J) > 3.9 && au(J) < 6.5 && au(V) > 0.25 && au(V) < 1.75);
  // Earth-fixed turn: the Sun's sub-point at a June solstice noon UT is near 23.4 N, 0 E
  const s = subPoint(eph.sun(jd('2027-06-21T12:00')), jd('2027-06-21T12:00'));
  assert.ok(Math.abs(s.lat - 23.4) < 0.3 && Math.abs(s.lon) < 1.5, `${s.lat} ${s.lon}`);
  assert.ok(Math.abs(Math.hypot(...Object.values(toFixed({ x: 1, y: 2, z: 3 }, t))) - Math.hypot(1, 2, 3)) < 1e-12);
  assert.ok(OCCULT_STARS.every(s => Math.abs(radecToEcl(s.ra, s.dec).z) < Math.sin(7 * Math.PI / 180)), 'every listed star is near the ecliptic');
});
