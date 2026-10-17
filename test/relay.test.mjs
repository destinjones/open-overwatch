// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The public relay (relay/worker.js) with a stand-in upstream: who it serves, what it fetches, what it shares.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../relay/worker.js';
import { PUBLIC_RELAY, relayUrl } from '../src/core/relay.js';

const SITE = 'https://destinjones.github.io';
let upstream;   // the next upstream answer: { status, headers, body }
const calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); const u = upstream; return new Response(u.body, { status: u.status || 200, headers: u.headers || {} }); };
const raw = (href, headers = { origin: SITE }, method = 'GET', ctx, env = {}) => worker.fetch(new Request(href, { method, headers }), env, ctx);
const call = (url, headers, method, ctx) => raw('https://relay.test/?url=' + encodeURIComponent(url), headers, method, ctx);
const NHC = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const minute = (off = 0) => Math.floor(Date.now() / 60000) + off;   // what core/cameras.js bustUrl sends as t

test('relay: only Open Overwatch pages, only GET', async () => {
  upstream = { body: '{}', headers: { 'content-type': 'application/json' } };
  assert.equal((await call(NHC, {})).status, 403);                       // no Origin: a script, not a page
  assert.equal((await call(NHC, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(NHC, { origin: SITE }, 'POST')).status, 405);
  assert.equal((await call(NHC)).status, 200);
  assert.equal((await raw('https://relay.test/?ping=1', {})).status, 200);
});

test('relay: one canonical request form; every other spelling of a feed is a 400 and never reaches upstream', async () => {
  upstream = { body: '{}', headers: { 'content-type': 'application/json' } };
  const enc = encodeURIComponent(NHC);
  calls.length = 0;
  for (const bad of [`?url=${enc}&n=1`, `?n=2&url=${enc}`, `?url=${NHC}`, `?url=${encodeURIComponent('https://WWW.NHC.NOAA.GOV/CurrentStorms.json')}`,
    `?url=${enc.replace('%3A', '%3a')}`, `?url=${encodeURIComponent('https://www.nhc.noaa.gov:443/CurrentStorms.json')}`, `?url=${enc}&url=${enc}`,
    `?url=${enc}&t=`, `?url=${enc}&t=abc`, `?url=${enc}&t=1&t=2`, `?t=1&url=${enc}`, `?url=${enc}&ping=1`, `x?url=${enc}`])
    assert.equal((await raw('https://relay.test/' + bad)).status, 400, bad);
  assert.equal(calls.length, 0);
  assert.equal((await raw(`https://relay.test/?url=${enc}`)).status, 200);
  assert.equal((await raw(`https://relay.test/?url=${enc}&t=${minute()}`)).status, 400, 'a feed takes no t: each one would be a fresh upstream fetch');
  const still = encodeURIComponent('https://kamera.atlas.vegvesen.no/api/images/3000063_1');
  assert.equal((await raw(`https://relay.test/?url=${still}&t=${minute()}`)).status, 200);   // a still's per-minute refresh
  assert.equal(calls.length, 2);
  // the clients build the canonical form, even from a feed's odd spelling
  assert.equal(relayUrl('https://WWW.NHC.noaa.gov/CurrentStorms.json'), PUBLIC_RELAY + enc);
  assert.equal(relayUrl('https://www.submarinecablemap.com'), PUBLIC_RELAY + encodeURIComponent('https://www.submarinecablemap.com/'));
  const spelt = 'https://images.data.gov.sg/api/traffic-images/2026/10/a b\'c.jpg', r = relayUrl(spelt);
  assert.equal((await raw('https://relay.test/?' + r.slice(PUBLIC_RELAY.indexOf('?') + 1))).status, 200, r);
});

test('relay: hosts, paths, ports and target queries are checked', async () => {
  upstream = { body: '{}', headers: { 'content-type': 'application/json' } };
  for (const bad of ['https://example.com/x', 'https://www.nhc.noaa.gov/other.json', 'https://www.nhc.noaa.gov:8443/CurrentStorms.json', 'http://www.nhc.noaa.gov/CurrentStorms.json',
    'https://user:pw@www.nhc.noaa.gov/CurrentStorms.json', NHC + '?nocache=1', NHC + '#x', 'https://www.tsunami.gov/', 'https://www.ndbc.noaa.gov/station_page.php'])
    assert.equal((await call(bad)).status, 403, bad);
  for (const ok of ['https://www.ndbc.noaa.gov/activestations.xml', 'https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt', 'https://www.ndbc.noaa.gov/data/realtime2/21413.dart',
    'https://www.tsunami.gov/events/xml/PAAQAtom.xml', 'https://www.tsunami.gov/events/xml/PHEBAtom.xml'])
    assert.equal((await call(ok)).status, 200, ok);
});

test('relay: camera image hosts only for their stills', async () => {
  upstream = { body: 'jpg', headers: { 'content-type': 'image/jpeg' } };
  for (const ok of ['https://kamera.atlas.vegvesen.no/api/images/3000063_1', 'https://trafficcam.calgary.ca/loc86.jpg', 'https://atmsqf.iowadot.gov/snapshots/Public/x.JPG', 'https://atmsqf.iowadot.gov/snapshots/Public/DMTV17',
    'https://images.data.gov.sg/api/traffic-images/2026/10/d0f6db57-a294-4132-a3c8-6c37dae56813.jpg', 'https://www.drivebc.ca/images/123.jpg'])
    assert.equal((await call(ok)).status, 200, ok);
  for (const bad of ['https://kamera.atlas.vegvesen.no/not-a-picture/x', 'https://kamera.atlas.vegvesen.no/', 'https://trafficcam.calgary.ca/index.html',
    'https://atmsqf.iowadot.gov/anything', 'https://images.data.gov.sg/other/x.jpg', 'https://trafficcam.calgary.ca/loc86.jpg?x=1'])
  { const r = await call(bad); assert.equal(r.status, 403, bad); assert.match(await r.text(), /^path not on the relay allowlist/, bad); }   // not the host text: relayRefused would stop the whole host
});

test('relay: a fixed Accept upstream, HTML never shared, the byte cap holds on a stream', async () => {
  calls.length = 0; upstream = { body: 'x', headers: { 'content-type': 'application/json' } };
  await call('https://www.drivebc.ca/api/webcams/', { origin: SITE, accept: 'text/html' });
  assert.match(calls[0].init.headers.accept, /^application\/json/);   // not the caller's
  upstream = { body: '<html>', headers: { 'content-type': 'text/html; charset=utf-8' } };
  assert.equal((await call('https://www.drivebc.ca/api/webcams/')).headers.get('cache-control'), 'no-store');
  upstream = { body: '{}', headers: { 'content-type': 'application/json' } };
  assert.equal((await call('https://www.drivebc.ca/api/webcams/')).headers.get('cache-control'), 'public, max-age=3600');
  upstream = { status: 429, body: 'slow down', headers: { 'content-type': 'text/plain' } };   // a busy feed is not shared: the next visitor tries again
  assert.equal((await call(NHC)).headers.get('cache-control'), 'no-store');
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(1e6)); c.close(); } });
  upstream = { body: big, headers: { 'content-type': 'image/jpeg' } };
  await assert.rejects(async () => { const r = await call('https://kamera.atlas.vegvesen.no/api/images/big'); await r.arrayBuffer(); }, /too large/);
});

test('relay: adsb.lol and the other aircraft feeds are not carried', async () => {
  upstream = { body: '{"ac":[]}', headers: { 'content-type': 'application/json' } };
  calls.length = 0;
  for (const bad of ['https://api.adsb.lol/v2/mil', 'https://api.adsb.lol/v2/squawk/7700', 'https://api.adsb.lol/v2/point/48/2/250', 'https://opensky-network.org/api/states/all',
    'https://opendata.adsb.fi/api/v2/mil', 'https://api.airplanes.live/v2/mil', 'https://api.adsb.one/v2/mil']) {
    const r = await call(bad);
    assert.equal(r.status, 403, bad); assert.match(await r.text(), /host not on the relay allowlist/);   // the text core/relay.js relayRefused reads
  }
  assert.equal(calls.length, 0);
});

test('relay: the inner cache is keyed by the canonical target, whatever t says', async () => {
  const store = new Map(), waits = [];
  globalThis.caches = { default: {
    async match(k) { const r = store.get(k.url); return r && r.clone(); },
    async put(k, r) { store.set(k.url, new Response(await r.arrayBuffer(), r)); },
  } };
  try {
    const ctx = { waitUntil: p => waits.push(p) }, enc = encodeURIComponent('https://kamera.atlas.vegvesen.no/api/images/1');
    calls.length = 0; upstream = { body: 'jpg', headers: { 'content-type': 'image/jpeg' } };
    const first = await raw(`https://relay.test/?url=${enc}&t=${minute()}`, undefined, 'GET', ctx);
    assert.equal(await first.text(), 'jpg'); await Promise.all(waits);
    assert.deepEqual([...store.keys()], [`https://relay.test/?url=${enc}`]);
    const again = await raw(`https://relay.test/?url=${enc}&t=${minute(1)}`, undefined, 'GET', ctx);
    assert.equal(again.status, 200); assert.equal(await again.text(), 'jpg'); assert.equal(calls.length, 1);   // one upstream fetch for both
    upstream = { status: 503, body: 'down', headers: { 'content-type': 'text/plain' } };   // errors are never put
    await raw('https://relay.test/?url=' + encodeURIComponent(NHC), undefined, 'GET', ctx); await Promise.all(waits);
    assert.equal(store.size, 1);
  } finally { delete globalThis.caches; }
});

test('relay: t= only on camera stills, and only near the current minute', async () => {
  upstream = { body: 'jpg', headers: { 'content-type': 'image/jpeg' } };
  const q = (url, t) => raw(`https://relay.test/?url=${encodeURIComponent(url)}&t=${t}`);
  calls.length = 0;
  for (const feed of [NHC, 'https://www.ndbc.noaa.gov/activestations.xml', 'https://www.tsunami.gov/events/xml/PAAQAtom.xml', 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
    'https://www.drivebc.ca/api/webcams/', 'https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json']) {
    const r = await q(feed, minute()); assert.equal(r.status, 400, feed); assert.match(await r.text(), /only for a camera still/);
  }
  for (const stale of [minute(-12), minute(12), 9000000001, 29345678, 0]) assert.equal((await q('https://trafficcam.calgary.ca/loc86.jpg', stale)).status, 400, String(stale));
  assert.equal(calls.length, 0, 'none of those reached upstream');
  for (const still of ['https://kamera.atlas.vegvesen.no/api/images/1', 'https://atmsqf.iowadot.gov/snapshots/Public/x.jpg', 'https://trafficcam.calgary.ca/loc86.jpg',
    'https://images.data.gov.sg/api/traffic-images/2026/10/x.jpg', 'https://www.drivebc.ca/images/42.jpg'])
    for (const off of [0, -9, 9]) assert.equal((await q(still, minute(off))).status, 200, still + ' ' + off);   // a visitor's clock a few minutes off still works
});

test('relay: the per-address rate limit (LIMITER) answers 429, counted only on the way upstream', async () => {
  upstream = { body: '{}', headers: { 'content-type': 'application/json' } };
  const keys = [];
  let allow = true;
  const env = { LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: allow }; } } };
  const go = (headers = { origin: SITE, 'cf-connecting-ip': '203.0.113.7' }, url = NHC) => raw('https://relay.test/?url=' + encodeURIComponent(url), headers, 'GET', undefined, env);
  assert.equal((await go()).status, 200);
  assert.deepEqual(keys, ['203.0.113.7']);
  allow = false; calls.length = 0;
  const r = await go();
  assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '60'); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('access-control-allow-origin'), SITE, 'the page can read why');
  assert.equal(calls.length, 0, 'nothing went upstream');
  keys.length = 0;
  assert.equal((await go({ origin: 'https://evil.example' })).status, 403);
  assert.equal((await go(undefined, 'https://example.com/x')).status, 403);
  assert.equal((await raw('https://relay.test/?ping=1', {}, 'GET', undefined, env)).status, 200);
  assert.deepEqual(keys, [], 'refused requests and pings never count against an address');
  // a broken binding lets the request through rather than taking the relay down
  const broken = { LIMITER: { limit: async () => { throw new Error('binding down'); } } };
  assert.equal((await raw('https://relay.test/?url=' + encodeURIComponent(NHC), undefined, 'GET', undefined, broken)).status, 200);
  // an inner-cache hit never counts either (it costs the feed nothing)
  const store = new Map();
  globalThis.caches = { default: { async match(k) { const x = store.get(k.url); return x && x.clone(); }, async put(k, x) { store.set(k.url, new Response(await x.arrayBuffer(), x)); } } };
  try {
    allow = true; keys.length = 0; const waits = [], ctx = { waitUntil: p => waits.push(p) };
    await raw('https://relay.test/?url=' + encodeURIComponent(NHC), undefined, 'GET', ctx, env); await Promise.all(waits);
    allow = false;
    assert.equal((await raw('https://relay.test/?url=' + encodeURIComponent(NHC), undefined, 'GET', ctx, env)).status, 200, 'served from the inner cache');
    assert.equal(keys.length, 1);
  } finally { delete globalThis.caches; }
});

test('relay: wrangler.toml binds LIMITER, and the code no longer claims a WAF rule', () => {
  const toml = readFileSync(new URL('../relay/wrangler.toml', import.meta.url), 'utf8'), src = readFileSync(new URL('../relay/worker.js', import.meta.url), 'utf8');
  assert.match(toml, /\[\[ratelimits\]\]\s*\nname = "LIMITER"\s*\nnamespace_id = "\d+"[\s\S]*?\[ratelimits\.simple\]\s*\n\s*limit = 60\s*\n\s*period = 60/);
  assert.doesNotMatch(src, /is a Cloudflare WAF rule on the route/);
});
