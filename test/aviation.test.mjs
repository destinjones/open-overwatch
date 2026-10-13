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
  const sea = { lat: 47.45, lon: -122.31 }, bna = { lat: 36.12, lon: -86.68 };
  const asa = routeFit({ origin: sea, destination: bna }, { lat: 44.95, lon: -123.0, track: 357, gs: 192 });
  assert.equal(asa.fits, false, 'flying north out of Oregon is not Seattle to Nashville (seen live: 98° off)');
  assert.equal(routeFit({ origin: sea, destination: bna }, { lat: 46.0, lon: -117.0, track: 110, gs: 220 }).fits, true);
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

// ------------------------------------------------------------------------------------------------ flight phase
import { flightPhase, greatCircle, PHASES } from '../src/core/phase.js';
test('flight phase on the ground and in the air', () => {
  const ph = (p, ap = LHR) => flightPhase(p, ap).phase;
  const at = (deg, km) => from(LHR, deg, km);
  assert.equal(ph({ ...at(0, 0.5), ground: true, gs: 0 }), 'parked');
  assert.equal(ph({ ...at(0, 0.5), ground: true, gs: 8 }), 'taxiing');
  assert.equal(ph({ ...at(0, 0.5), ground: true, gs: 70 }), 'roll');
  assert.equal(ph({ ...at(270, 3), alt: 25 + 250, vr: 8, gs: 85, track: 270 }), 'takeoff');
  assert.equal(ph({ ...at(270, 30), alt: 3000, vr: 10, gs: 140, track: 270 }), 'climb');
  assert.equal(ph({ ...at(90, 300), alt: 11000, vr: 0, gs: 240, track: 270 }), 'cruise');
  assert.equal(ph({ ...at(90, 300), alt: 3000, vr: 0, gs: 140, track: 270 }), 'level');
  assert.equal(ph({ ...at(90, 200), alt: 8000, vr: -8, gs: 200, track: 270 }), 'descent');
  assert.equal(ph({ ...at(90, 30), alt: 2000, vr: -5, gs: 120, track: 200 }), 'approach');
  assert.equal(ph({ ...at(90, 10), alt: 600, vr: -3.5, gs: 75, track: 270 }), 'final');
  assert.equal(ph({ ...at(90, 10), alt: 600, vr: -3.5, gs: 75, track: 90 }), 'approach', 'not lined up');
  assert.equal(ph({ ...at(90, 5), alt: 300, vr: 0, gs: 70, track: 270 }), 'final', 'level on a short final');
  assert.equal(ph({ ...at(0, 5), alt: 300, vr: 0, gs: 5, cls: 'helicopter', track: 0 }), 'hover');
  assert.equal(ph({ ...at(0, 5), alt: 1000, vr: 2, gs: 40, cls: 'helicopter', track: 0 }), 'climb', 'helicopters climb slower');
  assert.equal(ph({ ...at(90, 30), alt: 2000, vr: -5, gs: 120, track: 200 }, null), 'descent', 'no airport known');
  const f = flightPhase({ ...at(90, 10), alt: 600, vr: -3.5, gs: 75, track: 270 }, LHR);
  near(f.agl, 600 - LHR.elevM, 1e-9); near(f.apKm, 10, 0.05); assert.equal(f.words, PHASES.final);
  assert.equal(flightPhase(null).phase, 'unknown');
});
test('great circle points', () => {
  const g = greatCircle(51.47, -0.45, 40.64, -73.78, 32);
  assert.equal(g.length, 33); near(g[0][0], 51.47, 1e-9); near(g[32][1], -73.78, 1e-9);
  assert.ok(Math.max(...g.map(p => p[0])) > 52, 'the arc bends north of both ends');
  let km = 0; for (let i = 1; i < g.length; i++) km += gcKm(g[i - 1][0], g[i - 1][1], g[i][0], g[i][1]);
  near(km, gcKm(51.47, -0.45, 40.64, -73.78), 0.5, 'segments add up to the great circle');
  const pac = greatCircle(35.5, 139.8, 37.6, -122.4, 16);
  for (let i = 1; i < pac.length; i++) assert.ok(Math.abs(pac[i][1] - pac[i - 1][1]) < 30, 'continuous across the antimeridian');
  assert.ok(pac[16][1] > 180, 'runs past 180 instead of jumping');
  assert.deepEqual(greatCircle(10, 10, 10, 10, 2).map(p => p.map(v => Math.round(v * 1e6) / 1e6)), [[10, 10], [10, 10], [10, 10]]);
});

// ------------------------------------------------------------------------------------------------ airport weather
import { airportWxUrl, airportWx, flightCategory, airportWxLine } from '../src/core/aloft.js';
test('airport weather: request, parsing, cloud base and category', () => {
  const q = airportWxUrl(39.8617, -104.6731); assert.equal(q.key, '39.85,-104.65'); assert.match(q.url, /wind_speed_unit=kn/); assert.match(q.url, /dew_point_2m/);
  const w = airportWx({ current: { time: '2026-10-13T03:00', wind_speed_10m: 12.4, wind_direction_10m: 238, wind_gusts_10m: 24, temperature_2m: 9, dew_point_2m: 6, visibility: 8000, cloud_cover_low: 75, cloud_cover_mid: 10, cloud_cover_high: 0, weather_code: 61, pressure_msl: 1008.6 } });
  assert.equal(w.baseFt, 1200); assert.equal(w.category, 'MVFR');
  assert.equal(airportWxLine(w), 'Wind 238° 12 kt gusting 24 · 9 °C (dew point 6) · vis 8 km · low cloud BKN, base ~1,200 ft (est.) · light rain · QNH 1009');
  const clear = airportWx({ current: { wind_speed_10m: 0.4, wind_direction_10m: 0, temperature_2m: 20, dew_point_2m: 5, visibility: 30000, cloud_cover_low: 10, weather_code: 0 } });
  assert.equal(clear.baseFt, null, 'no ceiling with little low cloud'); assert.equal(clear.category, 'VFR'); assert.match(airportWxLine(clear), /^Calm · 20 °C/);
  assert.equal(airportWx({ current: {} }), null); assert.equal(airportWx(null), null); assert.equal(airportWxLine(null), '');
});
test('flight categories (FAA bands)', () => {
  assert.equal(flightCategory(30000, null), 'VFR'); assert.equal(flightCategory(30000, 3500), 'VFR');
  assert.equal(flightCategory(30000, 3000), 'MVFR'); assert.equal(flightCategory(7000, null), 'MVFR');
  assert.equal(flightCategory(30000, 900), 'IFR'); assert.equal(flightCategory(3000, null), 'IFR');
  assert.equal(flightCategory(30000, 400), 'LIFR'); assert.equal(flightCategory(1000, null), 'LIFR');
  assert.equal(flightCategory(null, null), null);
});

// ------------------------------------------------------------------------------------------------ search words
import { classWord, typeMatcher } from '../src/core/actype.js';
test('search: class words and type codes', () => {
  assert.equal(classWord('Helicopters'), 'helicopter'); assert.equal(classWord('private jets'), 'bizjet'); assert.equal(classWord('jumbo'), 'widebody');
  assert.equal(classWord('fighter jets'), 'fighter'); assert.equal(classWord('tankers'), 'military'); assert.equal(classWord('london'), null);
  const a380 = typeMatcher('A380'); assert.ok(a380('A388')); assert.ok(!a380('A320')); assert.ok(!a380('A359'));
  const b747 = typeMatcher('747'); assert.ok(b747('B744')); assert.ok(b747('B748')); assert.ok(!b747('B738'));
  const b777 = typeMatcher('Boeing 777'); assert.ok(b777('B77W')); assert.ok(b777('B772'));
  const a320 = typeMatcher('a320'); assert.ok(a320('A320')); assert.ok(a320('A321'), 'the A320 family'); assert.ok(a320('A20N') === false, 'the neo has its own code');
  const a321 = typeMatcher('A321'); assert.ok(a321('A321')); assert.ok(!a321('A320'));
  const exact = typeMatcher('B38M'); assert.ok(exact('B38M')); assert.ok(!exact('B39M'));
  assert.equal(typeMatcher('hello world'), null); assert.equal(typeMatcher(''), null);
});

import { findAirport } from '../src/core/airports.js';
test('finding an airport by code, name or city', () => {
  const list = [...APS, ...parseAirports({ airports: [['KDEN', 'DEN', 'Denver International Airport', 'Denver', 'US', 39.86, -104.67, 5431, 2], ['KAPA', 'APA', 'Centennial Airport', 'Denver', 'US', 39.57, -104.85, 5885, 1],
    ['LFPG', 'CDG', 'Charles de Gaulle International Airport', 'Paris', 'FR', 49.01, 2.55, 392, 2], ['KLGA', 'LGA', 'LaGuardia Airport', 'New York', 'US', 40.78, -73.87, 21, 2]] })];
  assert.equal(findAirport(list, 'lhr').icao, 'EGLL'); assert.equal(findAirport(list, 'EGKK').iata, 'LGW'); assert.equal(findAirport(list, 'LHR airport').icao, 'EGLL');
  assert.equal(findAirport(list, 'Heathrow').icao, 'EGLL'); assert.equal(findAirport(list, 'gatwick airport').icao, 'EGKK');
  assert.equal(findAirport(list, 'Charles de Gaulle').icao, 'LFPG'); assert.equal(findAirport(list, 'Denver').icao, 'KDEN', 'the large one');
  assert.equal(findAirport(list, 'kennedy').icao, 'KJFK'); assert.equal(findAirport(list, 'laguardia').icao, 'KLGA');
  assert.equal(findAirport(list, 'london city').icao, 'EGLC'); assert.equal(findAirport(list, 'atlantis'), null); assert.equal(findAirport(list, ''), null);
});

import { parse as voice } from '../src/core/voicecmd.js';
test('voice: airport boards, what a plane is, trails', () => {
  assert.deepEqual(voice('Arrivals at Heathrow'), { act: 'board', place: 'heathrow', which: 'arriving' });
  assert.deepEqual(voice("What's taking off from JFK?"), { act: 'board', place: 'jfk', which: 'departing' });
  assert.deepEqual(voice('what is landing at denver airport'), { act: 'board', place: 'denver', which: 'arriving' });
  assert.deepEqual(voice('show me the departures from Charles de Gaulle'), { act: 'board', place: 'charles de gaulle', which: 'departing' });
  assert.deepEqual(voice('show Gatwick airport'), { act: 'board', place: 'gatwick', which: null });
  assert.deepEqual(voice('flights at LAX'), { act: 'board', place: 'lax', which: null });
  assert.deepEqual(voice('what plane is that'), { act: 'what' });
  assert.deepEqual(voice('what kind of aircraft is this?'), { act: 'what' });
  assert.deepEqual(voice('where is that plane going'), { act: 'what' });
  assert.deepEqual(voice('show trails'), { act: 'trails', on: true }); assert.deepEqual(voice('hide the flight trails'), { act: 'trails', on: false });
  assert.deepEqual(voice('trails off'), { act: 'trails', on: false });
  // nothing else changed meaning
  assert.equal(voice('take me to Tokyo').act, 'go'); assert.equal(voice('how many planes over Texas').act, 'count'); assert.equal(voice('turn on planes').act, 'layer');
  assert.equal(voice('track BA 123').act, 'track'); assert.equal(voice("what's the weather in Paris").act, 'weather');
});

import { trailGeoJSON } from '../src/core/trail.js';
test('trail as GeoJSON', () => {
  const g = trailGeoJSON([{ t: 0, lat: 51.1234567, lon: -0.1, alt: 100.4 }, { t: 60e3, lat: 51.2, lon: -0.2, alt: 900.6 }], { callsign: 'BAW1' });
  assert.equal(g.geometry.type, 'LineString'); assert.deepEqual(g.geometry.coordinates[0], [-0.1, 51.123457, 100]); assert.deepEqual(g.geometry.coordinates[1], [-0.2, 51.2, 901]);
  assert.deepEqual(g.properties.coordTimes, ['1970-01-01T00:00:00.000Z', '1970-01-01T00:01:00.000Z']); assert.equal(g.properties.callsign, 'BAW1');
  assert.equal(trailGeoJSON([{ t: 0, lat: 1, lon: 1 }]), null);
});

import { recentMove } from '../src/core/airports.js';
test('board: landed and departed between two fixes', () => {
  const now = 1e12, t0 = now - 10 * 60e3;
  const w = { ...from(LHR, 90, 20), ground: false, alt: 900, gs: 80, ts: t0 };
  const landed = recentMove(LHR, { ...from(LHR, 0, 1), ground: true, gs: 5, ts: now - 60e3, was: w }, now);
  assert.equal(landed.status, 'landed'); near(landed.at, t0 + 20000 / 80 * 1000, 2000, 'touchdown ~250 s after the old fix'); near(landed.agoS, (now - landed.at) / 1000, 1e-9);
  const dep = recentMove(LHR, { ...from(LHR, 270, 30), ground: false, gs: 150, alt: 3000, ts: now, was: { ...from(LHR, 0, 1), ground: true, ts: t0, gs: 0 } }, now);
  assert.equal(dep.status, 'departed'); near(dep.at, now - 30000 / 150 * 1000, 2000, 'lift-off 200 s before the new fix');
  assert.equal(recentMove(LHR, { ...from(LHR, 0, 1), ground: true, ts: now, was: { ...w, ts: now - 40 * 60e3 } }, now), null, 'fixes too far apart');
  assert.equal(recentMove(LHR, { ...from(LHR, 0, 1), ground: true, ts: now, was: { ...from(LHR, 90, 100), ground: false, ts: t0 } }, now), null, 'was too far away');
  assert.equal(recentMove(LHR, { ...from(LHR, 0, 1), ground: true, ts: now, was: { ...from(LHR, 0, 1), ground: true, ts: t0 } }, now), null, 'parked both times');
  assert.equal(recentMove(LHR, { ...from(LHR, 0, 1), ground: true, ts: now }, now), null, 'one fix only');
  const b = makeBoard(LHR, [{ hex: 'z', ...from(LHR, 0, 1), ground: true, gs: 0, ts: now - 60e3, was: w }], { now });
  assert.equal(b.recent.length, 1); assert.equal(b.recent[0].status, 'landed'); assert.equal(b.ground.length, 0, 'not listed twice');
});

// ------------------------------------------------------------------------------------------------ runways
import { parseRunways, windOn, windTable, linedUp, finalFor, runwayInUse } from '../src/core/runways.js';
// Heathrow's two runways (09L/27R north, 09R/27L south), thresholds as OurAirports gives them
const RW = parseRunways({ runways: [
  ['EGLL', '09L', '27R', 51.4775, -0.4850, 51.4777, -0.4334, 12799, 'ASP'],
  ['EGLL', '09R', '27L', 51.4647, -0.4822, 51.4650, -0.4340, 12008, 'ASP'],
  ['EGLL', 'H1', 'H1', 51.47, -0.46, 51.47, -0.46, 50, 'CON'],   // a helipad: dropped
  ['XXXX', '01', '19', 'a', 0, 1, 1, 1, ''],                     // junk: dropped
] }).get('EGLL');
test('runways: parsing and headings', () => {
  assert.equal(RW.length, 2); const [n09, n27] = RW[0].ends;
  assert.equal(n09.ident, '09L'); assert.equal(n27.ident, '27R'); near(n09.hdg, 89.8, 0.5); near(n27.hdg, 269.8, 0.5);
  assert.equal(n09.rw, RW[0]); assert.equal(RW[0].lengthFt, 12799);
});
test('runways: wind components and the table', () => {
  const w = windOn(270, 300, 20); near(w.head, 20 * Math.cos(30 * Math.PI / 180), 1e-9); near(w.cross, 10, 1e-9, 'from the right');
  near(windOn(90, 300, 20).head, -17.32, 0.01, 'a tailwind landing east');
  const t = windTable(RW, 250, 15); assert.match(t[0].end.ident, /^27/); assert.ok(t[0].head > 13); assert.ok(t[t.length - 1].head < -13);
});
test('runways: lined up, the final, and the runway in use', () => {
  const [, r27R] = RW[0].ends, [, r27L] = RW[1].ends;
  const onFinal = { lat: r27L.lat + 0.0005, lon: r27L.lon + 0.12, alt: 600, track: 270, ground: false };   // ~8 km east of 27L
  const l = linedUp(r27L, onFinal); assert.ok(l && l.km > 7 && l.km < 9 && l.off < 200, JSON.stringify(l));
  assert.equal(linedUp(r27R, onFinal), null, 'the other runway is 1.4 km north');
  assert.equal(finalFor(RW, onFinal).end.ident, '27L');
  assert.equal(linedUp(r27L, { ...onFinal, track: 200 }), null, 'not tracking the runway');
  assert.equal(linedUp(r27L, { ...onFinal, lon: r27L.lon - 0.05 }), null, 'past the threshold');
  assert.equal(linedUp(r27L, { ...onFinal, ground: true }), null);
  assert.equal(linedUp(r27L, { ...onFinal, lon: r27L.lon + 0.4 }), null, 'too far out');
  const inUse = runwayInUse(RW, [onFinal, { ...onFinal, lon: onFinal.lon + 0.05 }, { lat: 51.6, lon: 0, track: 90 }], { dir: 90, speed: 20 });
  assert.deepEqual([inUse.end.ident, inUse.how, inUse.n], ['27L', 'arrivals', 2], 'arrivals beat the wind');
  const byWind = runwayInUse(RW, [], { dir: 90, speed: 12 }); assert.match(byWind.end.ident, /^09/); assert.equal(byWind.how, 'wind');
  assert.equal(runwayInUse(RW, [], { dir: 90, speed: 3 }), null, 'light wind says little');
});

// ------------------------------------------------------------------------- shared by the globe and the 2D map
import { RunwayBook, windWords } from '../src/core/runways.js';
import { planesNear, boardRowWords, BOARD_SECTIONS } from '../src/core/airports.js';
test('runway book: by airport, empty without data', () => {
  const book = new RunwayBook(new Map([['EGLL', RW]])), lhr = { icao: 'EGLL' };
  assert.equal(book.of(lhr), RW); assert.equal(book.of({ icao: 'KJFK' }), null); assert.equal(book.of(null), null);
  const [, r27L] = RW[1].ends, onFinal = { lat: r27L.lat + 0.0005, lon: r27L.lon + 0.12, alt: 600, track: 270, ground: false };
  assert.equal(book.final(lhr, onFinal).end.ident, '27L');
  assert.equal(book.inUse(lhr, [onFinal], null).end.ident, '27L');
  assert.match(book.wind(lhr, 250, 15)[0].end.ident, /^27/);
  assert.deepEqual(book.wind(lhr, null, 15), []); assert.deepEqual(new RunwayBook().wind(lhr, 250, 15), []);
  assert.equal(new RunwayBook().final(lhr, onFinal), null);
});
test('wind on a runway in words', () => {
  assert.equal(windWords(windOn(270, 300, 20)), '17 kt head, 10 kt from the right');
  assert.equal(windWords(windOn(90, 240, 10)), '9 kt tail, 5 kt from the right', 'landing east, wind from the south-west: behind and right');
  assert.equal(windWords(windOn(90, 300, 10)), '9 kt tail, 5 kt from the left');
  assert.equal(windWords({ head: 0.2, cross: -0.3 }), 'calm'); assert.equal(windWords(null), 'calm');
});
test('planes near an airport: a box of ~180 km, fresh fixes, where the view draws them', () => {
  const now = 1e12, recs = [
    { hex: 'a', lat: 51.6, lon: -0.2, ts: now - 1000, info: { route: { origin: { icao: 'LFPG' } } } },
    { hex: 'b', lat: 53.4, lon: -0.4, ts: now },                // 2° north: out
    { hex: 'c', lat: 51.5, lon: 1.9, ts: now },                 // 2.4° east at 51°: inside the widened box
    { hex: 'd', lat: 51.5, lon: -0.4, ts: now - 25 * 60e3 },    // stale
    { hex: 'e', lat: 51.5, lon: -0.4, ts: now, hidden: true },  // the view leaves it out
  ];
  const got = planesNear(LHR, recs, r => r.hidden ? null : { lat: r.lat, lon: r.lon, ts: r.ts, alt: 1000 }, now);
  assert.deepEqual(got.map(p => p.r.hex), ['a', 'c']);
  assert.equal(got[0].route.origin.icao, 'LFPG'); assert.equal(got[0].alt, 1000);
  const anti = { lat: 0, lon: 179.5 }; assert.equal(planesNear(anti, [{ lat: 0, lon: -179.5, ts: now }], r => ({ ...r }), now).length, 1, 'across the date line');
});
test('board rows in words: where from or to, ETA and final, the climb, parked or taxiing', () => {
  const route = { origin: { icao: 'LEMD', iata: 'MAD' }, destination: { icao: 'EGLL', iata: 'LHR' } };
  const arr = boardRowWords({ r: { info: { route }, vr: -4 }, status: 'arriving', etaS: 420, aboveM: 900, km: 22, toHere: true }, LHR, { fin: { end: { ident: '27L' } } });
  assert.deepEqual(arr, { where: 'from MAD', right: '7 min · final 27L', sub: '2,953 ft above the field · 22 km' });
  const dep = boardRowWords({ r: { info: { route: { origin: { icao: 'EGLL' }, destination: { icao: 'KJFK', iata: 'JFK' } } }, vr: 10 }, status: 'departing', aboveM: 1200, km: 15, fromHere: true }, LHR);
  assert.equal(dep.where, 'to JFK'); assert.equal(dep.right, 'climbing 1,969 ft/min');
  const odd = boardRowWords({ r: { info: { route: { origin: { icao: 'EGLL' }, destination: { icao: 'LEMD', iata: 'MAD' } } } }, status: 'arriving', etaS: 30, aboveM: 300, km: 5, fromHere: true }, LHR);
  assert.equal(odd.where, '', 'a route that leaves from here on a plane landing here: another day\'s flight'); assert.equal(odd.right, 'now');
  const elsewhere = boardRowWords({ r: { info: { route: { origin: { icao: 'KLGA', iata: 'LGA' }, destination: { icao: 'KATL', iata: 'ATL' } } } }, status: 'arriving', etaS: 120, aboveM: 400, km: 6 }, LHR);
  assert.equal(elsewhere.where, '', 'a route between two other fields says nothing about this one');
  const parked = boardRowWords({ r: {}, status: 'ground', aboveM: 0, km: 1 }, LHR, { kind: 'Narrow-body airliner' });
  assert.deepEqual(parked, { where: '', right: 'parked', sub: 'Narrow-body airliner' });
  assert.equal(boardRowWords({ r: {}, status: 'landed', agoS: 20, km: 1 }, LHR).right, 'landed just now');
  assert.equal(boardRowWords({ r: {}, status: 'departed', agoS: 400, km: 3 }, LHR).right, 'departed about 7 min ago');
  assert.deepEqual(BOARD_SECTIONS.map(s => s[0]), ['arriving', 'departing', 'recent', 'ground']);
});
test('card words shared by both views: kind, phase, route', async () => {
  const { kindWords } = await import('../src/core/actype.js');
  const { phaseWords, flightPhase } = await import('../src/core/phase.js');
  const { routeWords, ROUTE_CAVEAT } = await import('../src/core/airports.js');
  assert.equal(kindWords(classify({ type: 'B38M' })), 'Narrow-body airliner');
  assert.equal(kindWords(classify({})), 'Narrow-body airliner (a guess: no type known)');
  assert.match(kindWords(classify({ cat: 'A7' })), /\(from its transponder category\)$/);
  const jfk = { icao: 'KJFK', iata: 'JFK', lat: 40.6398, lon: -73.7789, elevM: 4, km: 3.2 };
  const f = flightPhase({ lat: 40.66, lon: -73.80, alt: 46, vr: -3.6, gs: 79, track: 121, ground: false }, jfk);
  assert.equal(f.phase, 'final');
  assert.deepEqual(phaseWords(f, jfk, { fin: { end: { ident: '13L' } } }), { head: 'On final for 13L', where: '3 km from JFK, 138 ft above it', code: 'JFK' });
  assert.deepEqual(phaseWords({ phase: 'cruise', words: 'Cruising', agl: 11000 }, { ...jfk, km: 250 }), { head: 'Cruising', where: '250 km from JFK', code: 'JFK' }, 'far out: no height above it');
  assert.equal(phaseWords({ phase: 'unknown' }, jfk), null);
  assert.deepEqual(phaseWords({ phase: 'climb', words: 'Climbing', agl: 900 }, null), { head: 'Climbing', where: '', code: '' });
  const rt = { origin: { icao: 'KORD', iata: 'ORD', city: 'Chicago' }, destination: { icao: 'KJFK', iata: 'JFK', city: 'New York' }, airline: { name: 'American Airlines' }, iata: 'AA2341' };
  const on = routeWords(rt, { fits: true, progress: 0.62, leftKm: 412.4, etaS: 2700 });
  assert.deepEqual(on, { pct: 62, places: 'ORD Chicago → JFK New York · American Airlines AA2341', state: '412 km left · about 45 min to go at this speed', off: '' });
  assert.equal(routeWords(rt, { fits: true, progress: 1, leftKm: 0, etaS: 5 }, { ground: true }).state, '0 km left', 'on the ground: no ETA');
  assert.equal(routeWords(rt, { fits: true, progress: 1, leftKm: 2.6, etaS: 33 }).state, '3 km left · arriving now', 'not "about now to go"');
  assert.deepEqual(routeWords(rt, { fits: false, progress: 0.3, why: 'off the route on file' }).off, 'off the route on file');
  assert.equal(routeWords(rt, null).state, ''); assert.equal(routeWords({ airline: { name: 'X' } }, null), null);
  assert.match(ROUTE_CAVEAT, /usual route/);
});
