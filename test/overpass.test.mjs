// The shared Overpass client (src/core/overpass.js): one request at a time, the next mirror when one fails, a rest for
// the one that failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overpass, overpassHealth } from '../src/core/overpass.js';

test('overpass: posts the query, falls over to the next mirror, rests the failed one', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push(url); assert.equal(init.method, 'POST'); assert.equal(init.body, 'data=' + encodeURIComponent('[out:json];node(1);out;'));
    if (url.includes('overpass-api.de')) throw new TypeError('Failed to fetch');   // a busy server's answer without CORS
    return { ok: true, json: async () => ({ elements: [{ id: 1 }] }) };
  };
  const d = await overpass('[out:json];node(1);out;', { fetch: fake, gap: 0 });
  assert.deepEqual(d, { elements: [{ id: 1 }] });
  assert.equal(calls.length, 2); assert.match(calls[1], /kumi/);
  const h = overpassHealth(); assert.equal(h[0].fails, 1); assert.ok(h[0].restingFor > 0);
  calls.length = 0;
  await overpass('[out:json];node(1);out;', { fetch: fake, gap: 0 });
  assert.equal(calls.length, 1); assert.match(calls[0], /kumi/);   // the resting server is not asked
});
