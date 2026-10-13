// Aviation on the globe: aircraft classes from type codes (src/core/actype.js), adsbdb answers and route fits, ICAO
// address blocks, weather aloft (src/core/aloft.js), airport boards (src/core/airports.js) and trails (src/core/trail.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, shapeOf, CLASSES, parseAdsbdb, routeFit, hexCountry, gcKm, bearing } from '../src/core/actype.js';
import { isaPressure, isaAltitude, isaTempC, bracket, aloftUrl, parseAloft, aloftEffects, aloftLines, oktas, LEVELS } from '../src/core/aloft.js';
import { parseAirports, AirportIndex, boardStatus, makeBoard, etaText } from '../src/core/airports.js';
import { Trail, thin, flatM, altColor, trailStats, altRampCss } from '../src/core/trail.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);

// ------------------------------------------------------------------------------------------------ classes
test('type designators pick the class and the model shape', () => {
  const cases = { A20N: 'narrowbody', B38M: 'narrowbody', A321: 'narrowbody', BCS3: 'narrowbody', B77W: 'widebody', A359: 'widebody', B789: 'widebody', A388: 'widebody',
    E75L: 'regional', CRJ9: 'regional', E190: 'regional', AT76: 'turboprop', DH8D: 'turboprop', C208: 'turboprop', GLF6: 'bizjet', C68A: 'bizjet', FA7X: 'bizjet', PC24: 'bizjet',
    EC35: 'helicopter', R44: 'helicopter', H60: 'helicopter', A139: 'helicopter', C172: 'light', P28A: 'light', SR22: 'light', F16: 'fighter', EUFI: 'fighter', F35: 'fighter',
    C17: 'military', K35R: 'military', B52: 'military', C130: 'militaryprop', A400: 'military', V22: 'militaryprop', P8: 'military' };
  for (const [t, cls] of Object.entries(cases)) assert.equal(classify({ type: t }).cls, cls, t);
  assert.equal(shapeOf({ type: 'B744' }), 'heavy'); assert.equal(shapeOf({ type: 'EC45' }), 'heli'); assert.equal(shapeOf({ type: 'AT72' }), 'tprop');
  assert.equal(shapeOf({ type: 'F18S' }), 'fighter'); assert.equal(shapeOf({ type: 'C30J' }), 'tprop'); assert.equal(shapeOf({ type: 'C172' }), 'prop');
  assert.equal(classify({ type: 'B738' }).why, 'type');
});
test('family patterns catch unlisted variants', () => {
  assert.equal(classify({ type: 'A322' }).cls, 'narrowbody');   // not in the list, A32x family
  assert.equal(classify({ type: 'B77F' }).cls, 'widebody');
  assert.equal(classify({ type: 'EC99' }).cls, 'helicopter');
  assert.equal(classify({ type: 'CRJ5' }).cls, 'regional');
  assert.equal(classify({ type: 'LJ99' }).cls, 'bizjet');
  assert.equal(classify({ type: 'b738 ' }).cls, 'narrowbody', 'case and spaces');
});
test('without a type: adsbdb words, then emitter category, then a guess', () => {
  assert.equal(classify({ desc: 'Airbus Helicopters H145' }).cls, 'helicopter');
  assert.equal(classify({ desc: 'Boeing 787 9' }).cls, 'widebody');
  assert.equal(classify({ desc: 'Cessna Citation CJ4' }).cls, 'bizjet');
  assert.equal(classify({ desc: 'Bombardier CRJ 900' }).why, 'text');
  assert.equal(classify({ cat: 'A7' }).cls, 'helicopter'); assert.equal(classify({ cat: 'A5' }).cls, 'widebody'); assert.equal(classify({ cat: 'B6' }).cls, 'drone');
  assert.equal(classify({ cat: 'A5' }).why, 'category');
  assert.equal(classify({ gs: 50, alt: 900 }).cls, 'light');
  assert.equal(classify({ gs: 230, alt: 11000 }).cls, 'narrowbody');
  assert.equal(classify({ gs: 230, alt: 11000, mil: true }).cls, 'military');
  assert.equal(classify({ gs: 50, alt: 900, ground: true }).cls, 'narrowbody', 'on the ground speed says nothing');
  assert.equal(classify({}).why, 'guess');
});
test('the designator wins over the category and the words', () => {
  assert.equal(classify({ type: 'B748', cat: 'A1', desc: 'Cessna 172' }).cls, 'widebody');
  assert.equal(classify({ type: 'ZZZZ', cat: 'A7' }).cls, 'helicopter', 'unknown designator falls through');
});
test('every class has a model that exists', () => {
  const have = new Set(['airliner', 'heavy', 'prop', 'tprop', 'heli', 'fighter']);
  for (const [k, c] of Object.entries(CLASSES)) { assert.ok(have.has(c.shape), k); assert.ok(c.scale > 0 && c.scale <= 1, k); assert.ok(c.name, k); }
});

// ------------------------------------------------------------------------------------------------ adsbdb
const SAMPLE = JSON.parse(readFileSync(new URL('./fixtures/adsbdb-4ca87c.json', import.meta.url), 'utf8'));
test('adsbdb answers become plain records', () => {
  const { aircraft: a, route: r } = parseAdsbdb(SAMPLE);
  assert.equal(a.icaoType, 'A332'); assert.equal(a.reg, 'EI-EJG'); assert.equal(a.hex, '4ca87c'); assert.equal(a.manufacturer, 'Airbus');
  assert.equal(a.owner, 'Italia Trasporto Aereo'); assert.equal(a.ownerCountry, 'Ireland'); assert.match(a.photo, /^https:\/\/image\.airport-data\.com\//);
  assert.equal(r.callsign, 'RYR4WZ'); assert.equal(r.iata, 'FR4WZ'); assert.equal(r.airline.name, 'Ryanair');
  assert.equal(r.origin.icao, 'EDJA'); assert.equal(r.origin.iata, 'FMM'); assert.equal(r.destination.icao, 'LPPR'); near(r.destination.lat, 41.2481, 1e-9);
  assert.equal(classify({ type: a.icaoType }).cls, 'widebody');
});
test('adsbdb: unknown answers, junk and unsafe photos', () => {
  assert.deepEqual(parseAdsbdb({ response: 'unknown aircraft' }), { aircraft: null, route: null });
  assert.deepEqual(parseAdsbdb(null), { aircraft: null, route: null });
  assert.deepEqual(parseAdsbdb({ response: { aircraft: 7 } }), { aircraft: null, route: null });
  const evil = structuredClone(SAMPLE); evil.response.aircraft.url_photo = 'javascript:alert(1)'; evil.response.aircraft.url_photo_thumbnail = 'http://airport-data.com/x.jpg';
  const { aircraft } = parseAdsbdb(evil); assert.equal(aircraft.photo, ''); assert.equal(aircraft.thumb, '');
  const bad = structuredClone(SAMPLE); bad.response.flightroute.origin.latitude = 'x';
  const { route } = parseAdsbdb(bad); assert.equal(route.origin, null); assert.equal(route.airline.icao, 'RYR', 'airline kept without a usable route');
  const long = structuredClone(SAMPLE); long.response.aircraft.registered_owner = 'x'.repeat(500);
  assert.equal(parseAdsbdb(long).aircraft.owner.length, 80);
});
test('route fit: on the way, off it, heading away', () => {
  const { route } = parseAdsbdb(SAMPLE);   // Memmingen -> Porto
  const mid = { lat: 44.6, lon: 0.8, track: 235, gs: 230 };
  const f = routeFit(route, mid);
  assert.ok(f.fits, f.why); assert.ok(f.progress > 0.4 && f.progress < 0.65, String(f.progress)); near(f.totalKm, 1669, 5);
  near(f.etaS, f.leftKm * 1000 / 230, 1);
  assert.equal(routeFit(route, { lat: 60, lon: 25, track: 200, gs: 230 }).fits, false, 'Helsinki is not on the way');
  const away = routeFit(route, { ...mid, track: 50 }); assert.equal(away.fits, false); assert.match(away.why, /heading away/);
  assert.equal(routeFit(route, { lat: 47.99, lon: 10.24, track: 50, gs: 0, ground: true }).fits, true, 'parked at the origin');
  assert.equal(routeFit(null, mid), null); assert.equal(routeFit(route, { lat: NaN, lon: 0 }), null);
});
test('great circle and bearing', () => {
  near(gcKm(51.47, -0.4543, 40.6413, -73.7781), 5540, 5, 'LHR-JFK on the sphere (5,555 on WGS84)');
  near(bearing(0, 0, 0, 10), 90, 1e-9); near(bearing(0, 0, 10, 0), 0, 1e-9); near(bearing(10, 0, 0, 0), 180, 1e-9);
});
test('ICAO address blocks', () => {
  assert.equal(hexCountry('4ca87c'), 'Ireland'); assert.equal(hexCountry('A1B2C3'), 'United States'); assert.equal(hexCountry('3c6444'), 'Germany');
  assert.equal(hexCountry('400f01'), 'United Kingdom'); assert.equal(hexCountry('c03456'), 'Canada'); assert.equal(hexCountry('7c1234'), 'Australia');
  assert.equal(hexCountry('~4ca87c'), 'Ireland', 'TIS-B prefix'); assert.equal(hexCountry('zzzzzz'), ''); assert.equal(hexCountry('f00000'), '');
});

// ------------------------------------------------------------------------------------------------ aloft
test('standard atmosphere', () => {
  near(isaPressure(0), 1013.25, 1e-9); near(isaPressure(11000), 226.32, 0.05); near(isaPressure(5574), 500, 0.5, '500 hPa is at 5,574 m');
  near(isaPressure(16000), 102.9, 0.3);
  for (const h of [0, 1500, 9144, 11000, 13000, 18000]) near(isaAltitude(isaPressure(h)), h, 1e-6, 'round trip');
  near(isaTempC(0), 15, 1e-9); near(isaTempC(11000), -56.5, 1e-9); near(isaTempC(15000), -56.5, 1e-9);
});
test('pressure levels around an altitude', () => {
  const b = bracket(10668);   // FL350: ~238 hPa, between 250 and 200
  assert.equal(b.lo, 250); assert.equal(b.hi, 200); assert.ok(b.w > 0.1 && b.w < 0.4, String(b.w));
  assert.deepEqual([bracket(-100).lo, bracket(-100).hi], [1000, 1000]);
  assert.deepEqual([bracket(30000).lo, bracket(30000).hi], [30, 30]);
  const exact = bracket(isaAltitude(500)); assert.equal(exact.lo === 500 || exact.hi === 500, true);
  for (let i = 0; i < LEVELS.length - 1; i++) assert.ok(LEVELS[i] > LEVELS[i + 1]);
});
test('the Open-Meteo request', () => {
  const q = aloftUrl(51.4712, -0.4619, 10668);
  assert.equal(q.lat, 51.5); assert.equal(q.lon, -0.5); assert.match(q.url, /current=.*temperature_250hPa.*wind_speed_200hPa/);
  assert.match(q.url, /wind_speed_unit=ms/); assert.match(q.url, /visibility/); assert.equal(q.key, '51.5,-0.5,250-200');
  assert.equal(aloftUrl(51.4712, -0.4619, 10600).key, q.key, 'nearby planes share');
});
const OM = JSON.parse(readFileSync(new URL('./fixtures/openmeteo-aloft.json', import.meta.url), 'utf8'));
test('weather at the plane: interpolation and vectors', () => {
  const w = parseAloft(OM, 10668);
  assert.ok(w.tempC < -45 && w.tempC > -55, String(w.tempC));
  assert.ok(w.windSpeed > 30 && w.windSpeed < 50, String(w.windSpeed));
  near(w.vis, 21060, 1e-9); assert.equal(w.cloudLow, 100); assert.deepEqual(w.levels, [250, 200]);
  // 350° and 10° at equal strength mix to north, not south
  const mixed = parseAloft({ current: { wind_direction_250hPa: 350, wind_speed_250hPa: 20, wind_direction_200hPa: 10, wind_speed_200hPa: 20 } }, isaAltitude(Math.sqrt(250 * 200)));
  assert.ok(mixed.windDir > 355 || mixed.windDir < 5, String(mixed.windDir)); near(mixed.windSpeed, 20 * Math.cos(10 * Math.PI / 180), 0.05);
  assert.equal(parseAloft({}, 1000), null); assert.equal(parseAloft({ current: { time: 'x' } }, 1000), null);
});
test('what the wind does to the plane', () => {
  const w = { windDir: 270, windSpeed: 50, tempC: -50, cloudPct: 0, rh: 30 };
  const head = aloftEffects({ track: 270, gs: 200, alt: 10668 }, w);
  near(head.head, 50, 1e-9); near(head.cross, 0, 1e-9); near(head.tas, 250, 1e-9, 'into wind TAS = GS + wind');
  near(head.mach, 250 / (20.0468 * Math.sqrt(223.15)), 1e-9); near(head.isaDev, -50 - isaTempC(10668), 1e-9);
  const tail = aloftEffects({ track: 90, gs: 300, alt: 10668 }, w); near(tail.head, -50, 1e-9); near(tail.tas, 250, 1e-9);
  const cross = aloftEffects({ track: 0, gs: 200, alt: 10668 }, w); near(cross.head, 0, 1e-9); near(cross.cross, -50, 1e-9, 'wind from the left');
  near(cross.tas, Math.hypot(200, 50), 1e-9);
  assert.equal(aloftEffects({ track: 0, gs: 100, alt: 3000 }, { windDir: 0, windSpeed: 5, tempC: -8, cloudPct: 90 }).icing, true);
  assert.equal(aloftEffects({ track: 0, gs: 100, alt: 3000 }, { windDir: 0, windSpeed: 5, tempC: -8, cloudPct: 10, rh: 40 }).icing, false);
  assert.equal(aloftEffects({ track: 0, gs: 100 }, null), null);
});
test('HUD lines', () => {
  const p = { track: 270, gs: 200, alt: 10668 }, w = { windDir: 270, windSpeed: 50, tempC: -50, cloudPct: 0, vis: 30000, cloudLow: 90, cloudMid: 0, cloudHigh: 30, weatherCode: 3 };
  const lines = aloftLines(p, w);
  assert.match(lines[0], /^WIND 270°\/97 KT · HEAD 97 · X 0/); assert.match(lines[1], /OAT -50°C · ISA\+4 · TAS 486 KT · M0\.8\d/);
  assert.match(lines[2], /L(OVC|BKN) MSKC HFEW/); assert.match(lines[3], /SFC VIS 10\+ km · OVERCAST/);
  assert.deepEqual(aloftLines(p, null), []);
  assert.equal(oktas(0), 'SKC'); assert.equal(oktas(20), 'FEW'); assert.equal(oktas(50), 'SCT'); assert.equal(oktas(75), 'BKN'); assert.equal(oktas(100), 'OVC'); assert.equal(oktas(null), '');
});

// ------------------------------------------------------------------------------------------------ airports
const APS = parseAirports({ airports: [
  ['EGLL', 'LHR', 'London Heathrow Airport', 'London', 'GB', 51.4706, -0.461941, 83, 2],
  ['EGKK', 'LGW', 'London Gatwick Airport', 'London', 'GB', 51.1481, -0.190278, 202, 2],
  ['EGLC', 'LCY', 'London City Airport', 'London', 'GB', 51.5053, 0.055278, 19, 1],
  ['KJFK', 'JFK', 'John F Kennedy International Airport', 'New York', 'US', 40.6398, -73.7789, 13, 2],
  ['NZAA', 'AKL', 'Auckland International Airport', 'Auckland', 'NZ', -37.0082, 174.785, 23, 2],
  ['NFFN', 'NAN', 'Nadi International Airport', 'Nadi', 'FJ', -17.7554, 177.443, 59, 2],
  ['NSTU', 'PPG', 'Pago Pago International Airport', 'Pago Pago', 'AS', -14.331, -170.711, 32, 1],
  ['bad', 'x', 'junk', '', '', 0, 0, 0, 1], ['XXXX', '', 'no position', '', '', 'a', 0, 0, 1],
] });
const IDX = new AirportIndex(APS);
test('airport list parsing and lookup', () => {
  assert.equal(APS.length, 7); assert.equal(APS[0].iata, 'LHR'); near(APS[0].elevM, 83 * 0.3048, 1e-9); assert.equal(APS[2].size, 1);
  assert.equal(IDX.get('lhr').icao, 'EGLL'); assert.equal(IDX.get('EGKK').iata, 'LGW'); assert.equal(IDX.get('ZZZ'), null);
  const n = IDX.near(51.4, -0.3, 60); assert.deepEqual(n.map(a => a.icao), ['EGLL', 'EGLC', 'EGKK']); assert.ok(n[0].km < n[1].km);
  assert.equal(IDX.nearest(40.7, -73.9).icao, 'KJFK'); assert.equal(IDX.nearest(0, -30), null);
  assert.equal(IDX.nearest(-17.5, 179.9, 400).icao, 'NFFN', 'across the antimeridian');
  assert.deepEqual(IDX.inBox(-40, 170, -10, -170).map(a => a.icao).sort(), ['NFFN', 'NSTU', 'NZAA'], 'box across the antimeridian');
  assert.deepEqual(IDX.inBox(50, -1, 52, 1).map(a => a.icao)[2], 'EGLC', 'large first');
});
const LHR = IDX.get('EGLL');
// a point at distance km along bearing deg from the airport (flat-earth; fine at these ranges)
const from = (ap, deg, km) => ({ lat: ap.lat + km * Math.cos(deg * Math.PI / 180) / 111.32, lon: ap.lon + km * Math.sin(deg * Math.PI / 180) / (111.32 * Math.cos(ap.lat * Math.PI / 180)) });
test('board: arriving, departing, on the ground', () => {
  const finalApp = { ...from(LHR, 90, 20), alt: 1100, vr: -3.5, gs: 80, track: 270, ground: false };   // 20 km east on the 27L final
  const s = boardStatus(LHR, finalApp); assert.equal(s.status, 'arriving'); assert.ok(s.etaS > 200 && s.etaS < 400, String(s.etaS));
  const climb = { ...from(LHR, 270, 12), alt: 1800, vr: 12, gs: 110, track: 265, ground: false };
  assert.equal(boardStatus(LHR, climb).status, 'departing');
  assert.equal(boardStatus(LHR, { ...from(LHR, 0, 1), ground: true, gs: 0, alt: 0 }).status, 'ground');
  assert.equal(boardStatus(LHR, { ...from(LHR, 0, 1), ground: true, gs: 8, alt: 0 }).status, 'taxiing');
  assert.equal(boardStatus(LHR, { ...from(LHR, 0, 9), ground: true, gs: 0, alt: 0 }), null, 'on the ground elsewhere');
});
test('board: what is not on it', () => {
  assert.equal(boardStatus(LHR, { ...from(LHR, 90, 40), alt: 11000, vr: 0, gs: 240, track: 270 }), null, 'cruising over');
  assert.equal(boardStatus(LHR, { ...from(LHR, 90, 40), alt: 3000, vr: -5, gs: 150, track: 90 }), null, 'descending away (to somewhere else)');
  assert.equal(boardStatus(LHR, { ...from(LHR, 90, 150), alt: 3000, vr: -5, gs: 150, track: 270 }), null, 'too far');
  assert.equal(boardStatus(LHR, { ...from(LHR, 90, 10), alt: 5000, vr: -5, gs: 150, track: 270 }), null, 'too high for that distance');
  assert.equal(boardStatus(LHR, { lat: NaN, lon: 0 }), null);
});
test('board: a route on file decides', () => {
  const holding = { ...from(LHR, 45, 30), alt: 2400, vr: 0, gs: 120, track: 180 };   // level in the hold
  assert.equal(boardStatus(LHR, holding), null);
  const s = boardStatus(LHR, { ...holding, route: { origin: { icao: 'LIRF' }, destination: { icao: 'EGLL' } } });
  assert.equal(s.status, 'arriving'); assert.equal(s.sure, true);
  const elsewhere = { ...from(LHR, 90, 40), alt: 2500, vr: -4, gs: 140, track: 270, route: { origin: { icao: 'EDDF' }, destination: { icao: 'EGLC' } } };
  assert.equal(boardStatus(LHR, elsewhere), null, 'descending this way but going to City');
});
test('makeBoard sorts, and gives a plane to the airport it belongs to', () => {
  const lcy = IDX.get('EGLC');
  const planes = [
    { hex: 'a', ...from(LHR, 90, 30), alt: 1500, vr: -4, gs: 90, track: 270 },
    { hex: 'b', ...from(LHR, 90, 12), alt: 700, vr: -3.5, gs: 75, track: 270 },
    { hex: 'c', ...from(LHR, 270, 10), alt: 1200, vr: 10, gs: 100, track: 270 },
    { hex: 'd', ...from(LHR, 180, 0.8), ground: true, gs: 0, alt: 0 },
    { hex: 'e', ...from(LHR, 0, 0.6), ground: true, gs: 9, alt: 0 },
    { hex: 'f', ...from(lcy, 270, 6), alt: 400, vr: -3, gs: 70, track: 90 },   // on final into City, heading east
  ];
  const b = makeBoard(LHR, planes, { others: IDX.near(LHR.lat, LHR.lon, 90) });
  assert.deepEqual(b.arriving.map(e => e.r.hex), ['b', 'a']);
  assert.deepEqual(b.departing.map(e => e.r.hex), ['c']);
  assert.deepEqual(b.ground.map(e => e.r.hex), ['e', 'd'], 'taxiing first');
  const c = makeBoard(lcy, planes, { others: IDX.near(lcy.lat, lcy.lon, 90) });
  assert.deepEqual(c.arriving.map(e => e.r.hex), ['f']);
});
test('ETA words', () => {
  assert.equal(etaText(30), 'now'); assert.equal(etaText(400), '7 min'); assert.equal(etaText(3900), '1 h 05'); assert.equal(etaText(null), '—');
});

// ------------------------------------------------------------------------------------------------ trails
test('trail: window, duplicates, jumps', () => {
  const t = new Trail({ minutes: 10 });
  let ms = 0;
  for (let i = 0; i < 100; i++) { ms = i * 15e3; t.add({ t: ms, lat: 50 + i * 0.01, lon: 0, alt: 3000 + i * 10 }); }
  assert.ok(t.length <= 42 && t.length >= 40, String(t.length));   // 10 min of 15 s fixes, plus the one before the window
  assert.ok(t.pts[0].t <= ms - 10 * 60e3 && t.pts[1].t >= ms - 10 * 60e3);
  assert.equal(t.add({ t: ms, lat: 60, lon: 0 }), false, 'same time');
  assert.equal(t.add({ t: ms - 1, lat: 60, lon: 0 }), false, 'out of order');
  assert.equal(t.add({ t: ms + 1000, lat: 50 + 99 * 0.01, lon: 0, alt: 3990 }), false, 'parked/no move');
  t.add({ t: ms + 16000, lat: 10, lon: 10 }); assert.equal(t.length, 1, 'a jump restarts it');
  assert.equal(t.add({ t: NaN, lat: 1, lon: 1 }), false);
  t.add({ t: ms + 30000, lat: 10.01, lon: 10, alt: 900, h: 950 }); assert.equal(t.pts[1].h, 950); assert.equal(t.pts[0].h, 0, 'h defaults to alt');
});
test('thinning keeps turns and climbs, drops straight cruise', () => {
  const pts = [];
  for (let i = 0; i <= 100; i++) pts.push({ t: i * 1000, lat: 50, lon: i * 0.01, alt: 10000, ground: false });
  assert.equal(thin(pts, 25).length, 2, 'straight and level');
  const turn = pts.slice(0, 51).concat(pts.slice(1, 51).map((p, i) => ({ ...p, t: 51000 + i * 1000, lat: 50 + (i + 1) * 0.01, lon: 0.5 })));
  const tt = thin(turn, 25); assert.equal(tt.length, 3); assert.equal(tt[1].lon, 0.5);
  const climb = pts.map((p, i) => ({ ...p, alt: i < 50 ? 1000 : 1000 + (i - 50) * 100 }));
  assert.equal(thin(climb, 25).length, 3, 'the level-off point stays');
  const takeoff = pts.map((p, i) => ({ ...p, alt: 0, ground: i < 30 }));
  assert.ok(thin(takeoff, 25).some(p => p.t === 30000), 'the lift-off point stays');
  const big = new Trail({ minutes: 999, maxPoints: 100 });
  for (let i = 0; i < 500; i++) big.add({ t: i * 1000, lat: 50 + Math.sin(i / 20) * 0.05, lon: i * 0.002, alt: 5000 });
  assert.ok(big.length <= 100, String(big.length));
});
test('flat distance and stats', () => {
  near(flatM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 111320, 1); near(flatM({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 }), 22264, 1, 'antimeridian');
  const s = trailStats([{ t: 0, lat: 0, lon: 0, alt: 100 }, { t: 60e3, lat: 0, lon: 0.1, alt: 600 }, { t: 120e3, lat: 0, lon: 0.2, alt: 400 }]);
  near(s.minutes, 2, 1e-9); near(s.km, 22.264, 0.01); assert.equal(s.climbM, 500); assert.equal(s.descentM, 200); assert.equal(s.maxAltM, 600);
});
test('altitude colours', () => {
  assert.deepEqual(altColor(5000, true), [180, 180, 180]);
  assert.deepEqual(altColor(0), [180, 180, 180]); assert.deepEqual(altColor(20000), [190, 80, 255]);
  assert.deepEqual(altColor(10000 * 0.3048), [120, 220, 60]);
  const mid = altColor(7000 * 0.3048); assert.ok(mid[0] > 120 && mid[0] < 255);
  assert.match(altRampCss(), /^linear-gradient\(90deg,rgb\(180,180,180\) 0%/);
});
