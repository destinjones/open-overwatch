// Live transit: feed parsers, the MQTT codec and the motion model (src/core/transit.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMbta, parseEntur, parseHfp, enturQuery, mqtt, addFix, sample, ease, approach, lagMeter, inArea } from '../src/core/transit.js';
import { haversine } from '../src/core/geo.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('MBTA: route type → mode, trip headsign, bad rows skipped', () => {
  const doc = {
    data: [
      { id: 'R-1', attributes: { latitude: 42.39, longitude: -71.14, bearing: 85, speed: null, current_status: 'STOPPED_AT', label: '1950', updated_at: '2026-10-10T16:26:25-04:00' },
        relationships: { route: { data: { id: 'Red' } }, trip: { data: { id: 't1' } } } },
      { id: 'y1', attributes: { latitude: 42.3, longitude: -71.0, bearing: 10, speed: 8, updated_at: '2026-10-10T20:26:30Z' }, relationships: { route: { data: { id: '50' } }, trip: { data: null } } },
      { id: 'bad', attributes: { latitude: null, longitude: -71, updated_at: '2026-10-10T20:26:30Z' }, relationships: {} },
    ],
    included: [
      { type: 'route', id: 'Red', attributes: { type: 1, short_name: '', long_name: 'Red Line', color: 'DA291C' } },
      { type: 'route', id: '50', attributes: { type: 3, short_name: '50', long_name: 'Cleary Square - Forest Hills', color: 'FFC72C' } },
      { type: 'trip', id: 't1', attributes: { headsign: 'Ashmont' } },
    ],
  };
  const [a, b, ...rest] = parseMbta(doc);
  assert.equal(rest.length, 0);
  assert.equal(a.id, 'mbta:R-1'); assert.equal(a.mode, 'metro'); assert.equal(a.line, 'Red Line'); assert.equal(a.dest, 'Ashmont');
  assert.equal(a.t, Date.parse('2026-10-10T20:26:25Z')); assert.equal(a.spd, null); assert.equal(a.color, '#DA291C'); assert.equal(a.status, 'at a stop');
  assert.equal(b.mode, 'bus'); assert.equal(b.line, '50'); assert.equal(b.dest, ''); assert.equal(b.spd, 8);
  assert.deepEqual(parseMbta(null), []);
});

test('Entur: km/h → m/s, modes, codespace in the id', () => {
  const doc = { data: { vehicles: [
    { vehicleId: '86', mode: 'COACH', lastUpdatedEpochSecond: 1791664000, speed: 36, bearing: 290, location: { latitude: 59.9, longitude: 10.7 }, line: { publicCode: 'FLY1', lineName: 'FLY1' }, destinationName: 'LLS', delay: 120, codespace: { codespaceId: 'FLT' }, operator: { name: null } },
    { vehicleId: '257', mode: 'FERRY', lastUpdatedEpochSecond: 1791663326, speed: null, bearing: 199, location: { latitude: 60.12, longitude: 5.2 }, line: { publicCode: '1022' }, destinationName: 'Hufthamar', delay: 0, codespace: { codespaceId: 'SKY' } },
    { vehicleId: 'x', mode: 'BUS', lastUpdatedEpochSecond: null, location: { latitude: 60, longitude: 5 } },
  ] } };
  const [a, b, ...rest] = parseEntur(doc);
  assert.equal(rest.length, 0);
  assert.equal(a.id, 'entur:FLT:86'); assert.equal(a.mode, 'bus'); assert.equal(a.spd, 10); assert.equal(a.t, 1791664000e3); assert.equal(a.delay, 120); assert.equal(a.operator, 'FLT');
  assert.equal(b.mode, 'ferry'); assert.equal(b.spd, null); assert.equal(b.dest, 'Hufthamar');
  assert.match(enturQuery(59, 10, 60, 11), /boundingBox:\{minLat:59,minLon:10,maxLat:60,maxLon:11\}/);
  assert.match(enturQuery('1;x', 0, 0, 0), /minLat:NaN/);   // numbers only reach the query
});

test('HSL: topic and VP payload; late is positive; junk is null', () => {
  const topic = '/hfp/v2/journey/ongoing/vp/bus/0022/01137/2510/2/Herttoniemi (M)/23:14/1303114/3/60;24/18/84/15';
  const vp = { desi: '510', dir: '2', oper: 22, veh: 1137, tst: '2026-10-10T20:39:07.251Z', tsi: 1791664747, spd: 14.12, hdg: 76, lat: 60.181053, long: 24.845203, dl: -42, drst: 0 };
  const f = parseHfp(topic, JSON.stringify({ VP: vp }));
  assert.equal(f.id, 'hsl:0022/01137'); assert.equal(f.mode, 'bus'); assert.equal(f.line, '510'); assert.equal(f.dest, 'Herttoniemi (M)');
  assert.equal(f.delay, 42); assert.equal(f.spd, 14.12); assert.equal(f.lon, 24.845203); assert.equal(f.t, Date.parse('2026-10-10T20:39:07.251Z'));
  assert.equal(parseHfp(topic.replace('/bus/', '/train/'), JSON.stringify({ VP: vp })).mode, 'rail');
  assert.equal(parseHfp(topic, JSON.stringify({ VP: { ...vp, lat: null } })), null);   // no fix (loc N/A)
  assert.equal(parseHfp(topic, '{not json'), null);
  assert.equal(parseHfp('/other/topic', '{}'), null);
});

test('MQTT: CONNECT and SUBSCRIBE bytes', () => {
  assert.equal(Buffer.from(mqtt.connect('abc')).toString('hex'), '100f00044d5154540402003c0003616263');
  assert.equal(Buffer.from(mqtt.subscribe(1, ['a/#'])).toString('hex'), '82080001000361' + '2f2300');
  assert.equal(Buffer.from(mqtt.unsubscribe(3, ['a/#'])).toString('hex'), 'a207000300036' + '12f23');
  const long = mqtt.subscribe(2, ['x'.repeat(200)]);   // remaining length over 127 takes two bytes
  assert.equal(long[1], (2 + 2 + 200 + 1) % 128 | 128); assert.equal(long[2], 1); assert.equal(long.length, 3 + 205);
});

test('MQTT reader: packets split across frames and several in one frame', () => {
  const enc = new TextEncoder();
  const publish = (topic, payload, qos = 0) => {
    const t = enc.encode(topic), p = enc.encode(payload), body = [t.length >> 8, t.length & 255, ...t, ...(qos ? [0, 7] : []), ...p];
    const len = []; let n = body.length; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; len.push(b); } while (n);
    return Uint8Array.from([0x30 | (qos << 1), ...len, ...body]);
  };
  const big = 'é'.repeat(150);   // multi-byte UTF-8 and a two-byte length
  const stream = Uint8Array.from([0x20, 2, 0, 0, ...publish('/hfp/a', '{"x":1}'), ...publish('/hfp/b', big, 1), 0xd0, 0, 0x90, 3, 0, 1, 0]);
  for (const cut of [1, 3, 5, 17, 200, stream.length]) {
    const read = mqtt.reader(), got = [];
    for (let i = 0; i < stream.length; i += cut) got.push(...read(stream.slice(i, i + cut)));
    assert.deepEqual(got.map(p => p.type), [2, 3, 3, 13, 9], 'cut ' + cut);
    assert.equal(got[0].code, 0); assert.equal(got[1].topic, '/hfp/a'); assert.equal(got[1].payload, '{"x":1}');
    assert.equal(got[2].topic, '/hfp/b'); assert.equal(got[2].payload, big);
  }
});

test('addFix: ignores repeats and old fixes, keeps the last 4, tracks the gap', () => {
  const v = {};
  assert.equal(addFix(v, { t: 1000, lat: 0, lon: 0 }), true);
  assert.equal(addFix(v, { t: 1000, lat: 1, lon: 1 }), false);
  assert.equal(addFix(v, { t: 500, lat: 1, lon: 1 }), false);
  for (let i = 1; i <= 5; i++) addFix(v, { t: 1000 + i * 10e3, lat: i, lon: 0 });
  assert.equal(v.fixes.length, 4); assert.equal(v.fixes[0].lat, 2); assert.equal(v.gap, 10e3);
  addFix(v, { t: 1000 + 50e3 + 600e3, lat: 9, lon: 0 });   // a 10-minute layover counts as 60 s
  near(v.gap, 10e3 * 0.7 + 60e3 * 0.3, 1e-6);
  const w = {}; addFix(w, { t: 0, lat: 0, lon: 0 }); addFix(w, { t: 1000, lat: 0, lon: 0 });
  assert.equal(w.gap, undefined); assert.equal(w.fixes.length, 2);   // HSL's 1 s sweep: kept, but not a reporting rate
});

test('addFix after a long silence sets off from where the vehicle is drawn, not mid-way along the new line', () => {
  const v = {}, o = {};
  addFix(v, { t: 0, lat: 42.30, lon: -71.06, spd: 0, hdg: 0 });
  const at = { t: 150e3, lat: 42.30, lon: -71.06 };           // held at the old fix while the feed said nothing
  addFix(v, { t: 200e3, lat: 42.32, lon: -71.06, spd: null, hdg: null }, at);
  assert.equal(v.fixes.length, 3); assert.equal(v.gap, 60e3);   // the drawn point is a fix; the gap counts real fixes only
  sample(v.fixes, 150e3, o); near(o.lat, 42.30, 1e-9);          // no leap: still where it was drawn
  sample(v.fixes, 175e3, o); near(o.lat, 42.31, 1e-9);
  const u = {}; addFix(u, { t: 0, lat: 1, lon: 1 }); addFix(u, { t: 10e3, lat: 2, lon: 1 });
  addFix(u, { t: 20e3, lat: 3, lon: 1 }, { t: 5e3, lat: 1.5, lon: 1 });
  assert.deepEqual(u.fixes.map(f => f.t), [0, 10e3, 20e3]);      // drawn between fixes already: nothing to add
});

test('sample: interpolates between fixes, dead-reckons a short gap, then holds', () => {
  const fixes = [{ t: 0, lat: 60, lon: 25, spd: null, hdg: null }, { t: 10e3, lat: 60.001, lon: 25, spd: null, hdg: null }];
  const o = {};
  assert.equal(sample(fixes, 5e3, o), 'interp'); near(o.lat, 60.0005, 1e-9); near(o.hdg, 0, 1e-6);
  assert.equal(sample(fixes, -5e3, o), 'hold'); assert.equal(o.lat, 60);
  // past the last fix: keeps going north at the last hop's ~11 m/s, for at most 15 s
  assert.equal(sample(fixes, 15e3, o), 'dr'); near(haversine(60.001, 25, o.lat, o.lon), 0.001 * 111320 / 2, 2);
  sample(fixes, 60e3, o); near(haversine(60.001, 25, o.lat, o.lon), 0.001 * 111320 * 1.5, 3);
  // a reported speed and heading win over the hop
  const east = [{ t: 0, lat: 60, lon: 25, spd: 10, hdg: 90 }];
  assert.equal(sample(east, 5e3, o), 'dr'); near(haversine(60, 25, o.lat, o.lon), 50, 0.5); assert.ok(o.lon > 25);
  assert.equal(sample([{ t: 0, lat: 1, lon: 2, spd: 0, hdg: 90 }], 5e3, o), 'hold');   // standing still
  assert.equal(sample([], 0, o), null);
});

test('ease glides toward a revised position and jumps over 3 km', () => {
  const p = { lat: 60, lon: 25 };
  ease(p, { lat: 60.001, lon: 25 }, 1200, 1200);
  near(p.lat, 60 + 0.001 * (1 - Math.exp(-1)), 1e-9);
  ease(p, { lat: 61, lon: 25 }, 16); assert.equal(p.lat, 61);
  const q = { lat: 0, lon: 0 }; ease(q, { lat: 0.001, lon: 0 }, 0); assert.equal(q.lat, 0.001);   // first frame: no dt, no glide
});

test('approach, lagMeter, inArea', () => {
  assert.equal(approach(10, 20, 3), 13); assert.equal(approach(10, 5, 3), 7); assert.equal(approach(10, 11, 3), 11);
  const poll = lagMeter(1);                            // a poll: each batch is one window
  poll.note(9000, 0); poll.note(2000, 0); assert.equal(poll.value, 2000);
  poll.note(4000, 15e3); poll.note(6000, 15e3); assert.equal(poll.value, 2000);   // last batch's minimum takes effect on the next
  poll.note(5000, 30e3); assert.equal(poll.value, 3000);
  const fast = lagMeter(1); fast.note(-120e3, 0); assert.equal(fast.value, -120e3);   // a clock two minutes slow
  assert.ok(inArea({ lat: 42.36, lon: -71.06, r: 150e3 }, 42.3, -71.1));
  assert.ok(!inArea({ lat: 42.36, lon: -71.06, r: 150e3 }, 40.7, -74.0));   // New York is not Boston
  assert.ok(inArea({ box: [57.8, 4.3, 63.5, 12.7] }, 59.91, 10.75)); assert.ok(!inArea({ box: [57.8, 4.3, 63.5, 12.7] }, 59.33, 18.07));
});
