// The public relay (relay/worker.js) with a stand-in upstream: who it serves, what it fetches, what it shares.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../relay/worker.js';

const SITE = 'https://destinjones.github.io';
let upstream;   // the next upstream answer: { status, headers, body }
const calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); const u = upstream; return new Response(u.body, { status: u.status || 200, headers: u.headers || {} }); };
const call = (url, headers = { origin: SITE }, method = 'GET') => worker.fetch(new Request('https://relay.test/?url=' + encodeURIComponent(url), { method, headers }));

test('relay: only Open Overwatch pages, only GET', async () => {
  upstream = { body: '{}', headers: { 'content-type': 'application/json' } };
  assert.equal((await call('https://www.nhc.noaa.gov/CurrentStorms.json', {})).status, 403);                       // no Origin: a script, not a page
  assert.equal((await call('https://www.nhc.noaa.gov/CurrentStorms.json', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('https://www.nhc.noaa.gov/CurrentStorms.json', { origin: SITE }, 'POST')).status, 405);
  assert.equal((await call('https://www.nhc.noaa.gov/CurrentStorms.json')).status, 200);
});

test('relay: hosts, paths and ports are checked', async () => {
  upstream = { body: '{}', headers: { 'content-type': 'application/json' } };
  for (const bad of ['https://example.com/x', 'https://www.nhc.noaa.gov/other.json', 'https://www.nhc.noaa.gov:8443/CurrentStorms.json', 'http://www.nhc.noaa.gov/CurrentStorms.json', 'https://user:pw@www.nhc.noaa.gov/CurrentStorms.json']) {
    assert.equal((await call(bad)).status, 403, bad);
  }
  assert.equal((await call('https://kamera.atlas.vegvesen.no/any/still.jpg')).status, 200);   // image hosts: any path
});

test('relay: a fixed Accept upstream, HTML never shared, the byte cap holds on a stream', async () => {
  calls.length = 0; upstream = { body: 'x', headers: { 'content-type': 'application/json' } };
  await call('https://www.drivebc.ca/api/webcams/', { origin: SITE, accept: 'text/html' });
  assert.match(calls[0].init.headers.accept, /^application\/json/);   // not the caller's
  upstream = { body: '<html>', headers: { 'content-type': 'text/html; charset=utf-8' } };
  assert.equal((await call('https://www.drivebc.ca/api/webcams/')).headers.get('cache-control'), 'no-store');
  upstream = { body: '{}', headers: { 'content-type': 'application/json' } };
  assert.equal((await call('https://www.drivebc.ca/api/webcams/')).headers.get('cache-control'), 'public, max-age=3600');
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(1e6)); c.close(); } });
  upstream = { body: big, headers: { 'content-type': 'application/octet-stream' } };
  await assert.rejects(async () => { const r = await call('https://kamera.atlas.vegvesen.no/big.jpg'); await r.arrayBuffer(); }, /too large/);
});
