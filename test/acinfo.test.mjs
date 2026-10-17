// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// adsbdb, the aircraft and route lookup the globe's and the 2D map's cards and boards share (src/core/acinfo.js):
// one request at a time, a day's cache per hex + callsign in the view's store, a callsign lookup for unknown airframes,
// and the rate limit honoured. The network is a fake that records what it was asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAcInfo, acKey, retryAfter, ADSBDB } from '../src/core/acinfo.js';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/adsbdb-4ca87c.json', import.meta.url), 'utf8'));
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function net(answer) {
  const seen = [];
  return { seen, fetch: async url => { seen.push(url); return answer(url); } };
}
const memStore = () => { const m = {}; return { m, get: (k, d) => k in m ? m[k] : d, set: (k, v) => { m[k] = v; } }; };

test('acinfo: keys and the 429 wait', () => {
  assert.equal(acKey('4CA87C', 'RYR4WZ'), '4ca87c|RYR4WZ');
  assert.equal(acKey('~4CA87C', 'RYR4WZ'), '~4ca87c|RYR4WZ', 'a non-ICAO track keeps its own entry');
  assert.equal(retryAfter({ response: 'rate limited for 37 seconds' }), 37);
  assert.equal(retryAfter(null), 120);
});

test('acinfo: asks once with the callsign, answers from cache after, stores it on the record', async () => {
  const n = net(() => reply(200, FIX)), store = memStore();
  const ai = createAcInfo({ fetch: n.fetch, store, sleep: async () => {} });
  const r = { hex: '4ca87c', flight: 'RYR4WZ  ' };
  assert.equal(ai.peek(r), undefined);
  const v = await ai.get(r);
  assert.equal(n.seen[0], `${ADSBDB}/aircraft/4ca87c?callsign=RYR4WZ`);
  assert.equal(v.aircraft.reg, 'EI-EJG'); assert.equal(v.route.airline.name, 'Ryanair'); assert.equal(r.info, v);
  const again = { hex: '4CA87C', flight: 'RYR4WZ' };
  assert.equal(await ai.get(again), v); assert.equal(n.seen.length, 1, 'cached'); assert.equal(again.info, v);
  const two = await Promise.all([ai.get({ hex: '400001', flight: '' }), ai.get({ hex: '400001', flight: '' })]);
  assert.equal(two[0], two[1]); assert.equal(n.seen.length, 2, 'two callers, one request');
  assert.equal(n.seen[1], `${ADSBDB}/aircraft/400001`, 'no callsign: none asked for');
});

test('acinfo: the cache survives a reload through the store, and expires', async () => {
  let now = 1e12; const store = memStore();
  const n = net(() => reply(200, FIX));
  const a = createAcInfo({ fetch: n.fetch, store, now: () => now, sleep: async () => {} });
  await a.get({ hex: '4ca87c', flight: 'RYR4WZ' });
  await new Promise(r => setTimeout(r, 2100));   // written at most every 2 s
  assert.ok(store.m.adsbdb['4ca87c|RYR4WZ'], 'saved');
  const b = createAcInfo({ fetch: n.fetch, store, now: () => now });
  assert.equal(b.peek({ hex: '4ca87c', flight: 'RYR4WZ' }).aircraft.reg, 'EI-EJG', 'a new page load still knows it');
  now += 25 * 3600e3;
  assert.equal(b.peek({ hex: '4ca87c', flight: 'RYR4WZ' }), undefined, 'a day later: ask again');
});

test('acinfo: an unknown airframe with an airline callsign asks for the route by callsign', async () => {
  const n = net(url => url.includes('/callsign/') ? reply(200, { response: { flightroute: FIX.response.flightroute } }) : reply(404, {}));
  const ai = createAcInfo({ fetch: n.fetch, sleep: async () => {} });
  const v = await ai.get({ hex: 'abcdef', flight: 'RYR4WZ' });
  assert.equal(v.aircraft, null); assert.equal(v.route.callsign, 'RYR4WZ');
  assert.deepEqual(n.seen, [`${ADSBDB}/aircraft/abcdef?callsign=RYR4WZ`, `${ADSBDB}/callsign/RYR4WZ`]);
});

test('acinfo: rate limited means silence until adsbdb says; bad hexes are never asked', async () => {
  let now = 1e12;
  const n = net(() => reply(429, { response: 'rate limited for 30 seconds' })), warned = [];
  const ai = createAcInfo({ fetch: n.fetch, now: () => now, sleep: async () => {}, warn: m => warned.push(m) });
  assert.equal(await ai.get({ hex: '4ca87c', flight: '' }), null);
  assert.ok(ai.limited); assert.match(warned[0], /rate limited/);
  assert.equal(await ai.get({ hex: '4ca87d', flight: '' }), null); assert.equal(n.seen.length, 1, 'nothing asked while blocked');
  now += 31e3; assert.ok(!ai.limited);
  assert.equal(await ai.get({ hex: '~zz0001', flight: '' }), null); assert.equal(n.seen.length, 1, 'not an ICAO hex');
});

test('acinfo: a non-ICAO "~" address is never looked up, nor answered from the entry of the real airframe', async () => {
  const n = net(() => reply(200, FIX));
  const ai = createAcInfo({ fetch: n.fetch, sleep: async () => {} });
  const real = await ai.get({ hex: '4ca87c', flight: 'RYR4WZ' }); assert.equal(real.aircraft.reg, 'EI-EJG'); assert.equal(n.seen.length, 1);
  const tisb = { hex: '~4ca87c', flight: 'RYR4WZ' };
  assert.equal(ai.peek(tisb), undefined, 'not the cached answer for 4ca87c');
  assert.equal(await ai.get(tisb), null); assert.equal(tisb.info, undefined);
  assert.equal(await ai.get({ hex: '~a1b2c3', flight: 'N12345' }), null);
  assert.equal(n.seen.length, 1, 'adsbdb never asked about the six digits');
});

test('acinfo: one request at a time, at least 1.1 s apart', async () => {
  let now = 0; const waits = [];
  const n = net(() => reply(200, FIX));
  const ai = createAcInfo({ fetch: n.fetch, now: () => now, sleep: async ms => { waits.push(ms); now += ms; } });
  await Promise.all([ai.get({ hex: '000001', flight: '' }), ai.get({ hex: '000002', flight: '' }), ai.get({ hex: '000003', flight: '' })]);
  assert.equal(n.seen.length, 3); assert.deepEqual(waits, [1100, 1100]);
});
