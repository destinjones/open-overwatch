// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The Solar System view's work off the page: the eclipse search in its worker (src/solar/eclipses.worker.js), and one
// asteroid's orbit read out of the 19 MB file (src/solar/asteroidrecord.js). Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEphemeris, findEclipses, findOccultations } from '../src/core/syzygy.js';
import { viewSmallBodies, decodeElements } from '../src/core/smallbodies.js';
import { readAsteroidRecord } from '../src/solar/asteroidrecord.js';

const data = p => new URL('../data/solar/' + p, import.meta.url);

test('eclipse worker: the same events as on the page, as plain data that survives postMessage', async () => {
  const ephem = JSON.parse(readFileSync(data('ephem.json'), 'utf8')), sent = [];
  globalThis.self = { postMessage: m => sent.push(m) };
  try {
    await import('../src/solar/eclipses.worker.js');
    self.onmessage({ data: { ephem: structuredClone(ephem) } });
    const eph = createEphemeris(ephem), page = [...findEclipses(eph), ...findOccultations(eph).map(o => ({ type: 'occultation', ...o }))];
    assert.ok(page.length > 100);
    assert.deepEqual(structuredClone(sent[0].events), page);
    self.onmessage({ data: { ephem: null } });
    assert.ok(sent[1].error && !sent[1].events, 'bad data: an error to fall back on, not a dead worker');
  } finally { delete globalThis.self; }
});

const SB = JSON.parse(readFileSync(data('small_bodies.json'), 'utf8')), FILE = readFileSync(data('asteroids_b.bin'));
const buffer = FILE.buffer.slice(FILE.byteOffset, FILE.byteOffset + FILE.byteLength);
const APOPHIS = SB.named.find(n => n[2] === '99942 Apophis'), N = SB.files[1].count;

test('asteroid record: seven small reads give what the whole file gives', async () => {
  const asked = [];
  const fetchImpl = async (url, { headers }) => {
    const [, a, b] = headers.Range.match(/bytes=(\d+)-(\d+)/); asked.push(+b - +a + 1);
    return new Response(FILE.subarray(+a, +b + 1), { status: 206 });
  };
  const el = await readAsteroidRecord('asteroids_b.bin', N, APOPHIS[1], SB.epoch_jd, { fetchImpl });
  assert.deepEqual(el, decodeElements(viewSmallBodies(buffer), APOPHIS[1], SB.epoch_jd));
  assert.equal(asked.length, 7); assert.ok(asked.every(n => n <= 4), 'a few bytes each');
});

test('asteroid record: a server that ignores Range is reported, and not read; a missing copy falls back to the site', async () => {
  let aborted = 0;
  const whole = async (url, { signal }) => { signal.addEventListener('abort', () => { aborted++; }); return new Response('x'.repeat(100), { status: 200 }); };
  await assert.rejects(readAsteroidRecord('asteroids_b.bin', N, 5, SB.epoch_jd, { fetchImpl: whole }), e => e.noRange === true);
  assert.equal(aborted, 7, 'each download stopped');
  const urls = new Set();
  const moved = async (url, { headers }) => { urls.add(url.split('/')[0]);
    if (!url.startsWith('https://site.test/')) return new Response('', { status: 404 });
    const [, a, b] = headers.Range.match(/bytes=(\d+)-(\d+)/); return new Response(FILE.subarray(+a, +b + 1), { status: 206 }); };
  assert.ok((await readAsteroidRecord('asteroids_b.bin', N, 5, SB.epoch_jd, { fetchImpl: moved, site: 'https://site.test/' })).a > 0);
  assert.equal(urls.size, 2);
  await assert.rejects(readAsteroidRecord('asteroids_b.bin', N, 5, SB.epoch_jd, { fetchImpl: async () => new Response('', { status: 500 }) }), /HTTP 500/);
});
