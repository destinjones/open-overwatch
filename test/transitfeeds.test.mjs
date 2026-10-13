// The shared transit runner (src/core/transitfeeds.js) and the shared fire-tile plan and bike looks: what the globe and
// the 2D map both run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transitSources, TRANSIT_AREAS, sourcesAt, enturBox, startPoll, startHsl, startSource, stopSource, createFleet, transitTip, transitRows, lateness, MBTA_URL, HSL_URL } from '../src/core/transitfeeds.js';
import { mqtt } from '../src/core/transit.js';
import { fireTilesWanted, fireLevel, fireLook, keptRings, perimeterCentre, containColor } from '../src/core/hazards.js';
import { bikeLook, BIKE_STATES, checkedAgo, bikeTip } from '../src/core/bikes.js';

test('areas pick the sources for a view', () => {
  assert.deepEqual([...sourcesAt(42.35, -71.1)], ['mbta']);
  assert.deepEqual([...sourcesAt(59.9, 10.75)], ['entur']);
  assert.deepEqual([...sourcesAt(59.33, 18.07)], []);   // Stockholm: not Norway's box
  assert.deepEqual([...sourcesAt(60.2, 24.9)], ['hsl']);
  const s = transitSources();
  for (const a of TRANSIT_AREAS) assert.ok(s[a.src], a.src);
  assert.deepEqual(Object.keys(s), ['mbta', 'entur', 'hsl', 'capmetro', 'metrotransit']);
  assert.equal(s.hsl.every, 0); assert.equal(s.mbta.id, 'mbta');
  assert.deepEqual(enturBox(60, 10, 10e3), [59.459, 8.919, 60.541, 11.081]);   // at least 60 km
  const [s0, , n0] = enturBox(60, 10, 1e7); assert.ok(Math.abs((n0 - s0) * 111e3 - 500e3) < 2e3);   // at most 250 km each way
});

test('a polled source: its batches, its backoff, stop', async () => {
  const s = transitSources().mbta, timers = [];
  const doc = { data: [{ id: 'y1', attributes: { latitude: 42.35, longitude: -71.06, updated_at: '2026-10-12T10:00:00Z', label: '1234', current_status: 'STOPPED_AT' }, relationships: { route: { data: { id: 'Red' } } } }],
    included: [{ type: 'route', id: 'Red', attributes: { type: 1, short_name: '', long_name: 'Red Line', color: 'DA291C' } }] };
  let calls = 0, fail = false;
  const fakeFetch = async url => { calls++; assert.equal(url, MBTA_URL); if (fail) throw new Error('down'); return { ok: true, json: async () => doc }; };
  const got = [], errs = [];
  const stop = startPoll(s, { fetch: fakeFetch, onFixes: f => got.push(f), onError: e => errs.push(e.message), setTimer: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, clearTimer: () => {} });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(got.length, 1); assert.equal(got[0][0].mode, 'metro'); assert.equal(got[0][0].line, 'Red Line');
  const next = timers.filter(([, ms]) => ms === 15e3); assert.equal(next.length, 1);
  fail = true; next[0][0](); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(errs, ['down']); assert.equal(s.fails, 1);
  assert.ok(timers.some(([, ms]) => ms === 30e3));   // after a failure: twice as long
  stop(); const before = calls; timers[timers.length - 1][0](); await new Promise(r => setTimeout(r, 0));
  assert.ok(calls <= before + 1);
});

test('HSL: connect, subscribe, read a vehicle, disconnect', async () => {
  const sent = [];
  class FakeWS { constructor(url, proto) { assert.equal(url, HSL_URL); assert.equal(proto, 'mqtt'); FakeWS.last = this; this.readyState = 1; } send(b) { sent.push(b[0] >> 4); } close() { this.closed = true; } }
  const s = transitSources().hsl, got = [];
  const stop = startHsl(s, { WebSocket: FakeWS, onFixes: f => got.push(...f), clientId: 'test' });
  const ws = FakeWS.last; ws.onopen();
  assert.deepEqual(sent, [1]);   // CONNECT
  ws.onmessage({ data: new Uint8Array([0x20, 2, 0, 0]).buffer });   // CONNACK, accepted
  assert.deepEqual(sent, [1, 8]);   // SUBSCRIBE
  const topic = '/hfp/v2/journey/ongoing/vp/bus/0022/00865/2550/1/Itäkeskus/7:20/1454121/3/60;24/19/73/86', payload = JSON.stringify({ VP: { desi: '550', veh: 865, tst: '2026-10-12T10:00:00.000Z', lat: 60.2, long: 24.9, spd: 8, hdg: 90, oper: 22, dl: 60 } });
  const t = new TextEncoder().encode(topic), p = new TextEncoder().encode(payload), len = 2 + t.length + p.length;
  const rem = []; let x = len; do { let b = x % 128; x = Math.floor(x / 128); if (x) b |= 128; rem.push(b); } while (x);
  ws.onmessage({ data: new Uint8Array([0x30, ...rem, t.length >> 8, t.length & 255, ...t, ...p]).buffer });
  assert.equal(got.length, 1); assert.equal(got[0].line, '550'); assert.equal(got[0].mode, 'bus');
  stop(); assert.equal(ws.closed, true); assert.equal(sent[sent.length - 1], 14);   // DISCONNECT
  assert.equal(typeof mqtt.reader, 'function');
});

test('startSource / stopSource run a source once', () => {
  const s = transitSources().metrotransit; let n = 0;
  startSource(s, { fetch: async () => { n++; return { ok: false, status: 503 }; }, onFixes: () => {}, onError: () => {}, setTimer: () => 0, clearTimer: () => {} });
  startSource(s, { fetch: async () => { n++; }, onFixes: () => {} });
  assert.equal(n, 1); assert.equal(s.running, true);
  assert.equal(stopSource(s), true); assert.equal(stopSource(s), false); assert.equal(s.running, false);
});

test('the fleet: whole batches replace, streams add, motion between reports, prune', () => {
  const src = transitSources().mbta, added = [], dropped = [];
  const fleet = createFleet({ add: v => added.push(v.id), drop: v => dropped.push(v.id) });
  const t0 = 1_760_000_000_000;
  const fix = (id, t, lat, extra = {}) => ({ id, t, lat, lon: -71, spd: null, hdg: null, mode: 'bus', line: '39', dest: 'Forest Hills', vehicle: '', status: '', delay: null, operator: 'MBTA', ...extra });
  fleet.ingest(src, [fix('a', t0, 42.3), fix('b', t0, 42.31)], true, t0 + 1000);
  assert.deepEqual(added, ['a', 'b']);
  fleet.ingest(src, [fix('a', t0 + 15e3, 42.301)], true, t0 + 16e3);
  assert.deepEqual(dropped, ['b']);   // missing from a whole poll: gone
  const v = fleet.vehicles.get('a');
  assert.equal(v.fixes.length, 2); assert.equal(v.gap, 15e3);
  // drawn behind live, between its two fixes
  let moved = false; for (let k = 0; k < 40; k++) moved = fleet.step(v, t0 + 16e3 + 18e3 + k * 250, 250) || moved;
  assert.ok(moved); assert.ok(v.lat > 42.3 && v.lat <= 42.3011, String(v.lat));
  assert.equal(transitTip(v), 'Bus 39 → Forest Hills · MBTA');
  assert.deepEqual(transitRows(v, 12.4).at(-1), ['Last report', '12 s ago']);
  assert.ok(transitRows({ ...v, info: { ...v.info, delay: -120, spd: 10 } }, 0).some(([k, x]) => k === 'Schedule' && x === '2 min early'));
  assert.equal(fleet.stats().MBTA.total, 1);
  fleet.prune(t0 + 15e3 + 16 * 60e3 + 2000); assert.deepEqual(dropped, ['b', 'a']);
  fleet.ingest(src, [fix('old', t0 - 3600e3, 42)], false, t0);   // older than the source keeps
  assert.equal(fleet.vehicles.size, 0);
  assert.equal(lateness(0), 'on time'); assert.equal(lateness(null), '');
});

test('fire tiles for a view, perimeters, bike looks', () => {
  const w = fireTilesWanted(-10, 20, 2, 5, 4, Date.UTC(2026, 9, 12, 12));
  assert.equal(w.length, 4 * 2 * 2);   // 4 tiles × 2 satellites × 2 days
  assert.ok(w[0].url.startsWith('https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_NOAA20_Thermal_Anomalies_375m_All/default/2026-10-12/500m/5/'));
  assert.equal(w.filter(x => x.today).length, 8);
  assert.equal(fireTilesWanted(0, 0, 30, 3, 4).length, 2 * 2 * 2);   // level 3: two tiles at most
  assert.equal(fireLevel(2000), 3); assert.equal(fireLevel(100), 6);
  assert.equal(fireLook(150)[1], '#fff1d6'); assert.equal(fireLook(1)[2], 3.2);
  const f = { rings: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]], [[1, 1], [1.1, 1], [1.1, 1.1], [1, 1.1], [1, 1]]], contained: 50 };
  assert.equal(keptRings(f).length, 1);   // a 1 ha sliver is left out
  assert.ok(Math.abs(perimeterCentre(f).lat - 0.0004) < 1e-9);   // the first of the longest rings
  assert.equal(containColor(f), '#ff8a3d'); assert.equal(containColor({ rx: true }), '#9ad17a');
  const now = Date.UTC(2026, 9, 12);
  assert.equal(bikeLook({ bikes: 5, docks: 5, total: 10, t: now - 3 * 864e5 }, now), 'stale');
  assert.equal(bikeLook({ bikes: 0, docks: 5, t: now }, now), 'empty');
  assert.ok(BIKE_STATES.full[1].startsWith('#'));
  assert.equal(checkedAgo(30e3), 'just now'); assert.equal(checkedAgo(5400e3), '1.5 h ago');
  assert.equal(bikeTip({ name: 'Kamppi', bikes: 1, docks: 0 }), 'Kamppi · 1 bike · 0 free docks');
});
