// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The relay host lists agree: the website's public relay (src/core/relay.js = relay/worker.js), the 2D map's NEEDS_RELAY
// (src/map/util.js) and the download's helpers (serve.js, serve.py). And a refusal from the deployed Worker is told
// apart from a feed's own 403, so the page stops asking for the rest of the visit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PUBLIC_RELAY_HOSTS, carried, markNotCarried, publicRelayable, relayRefused } from '../src/core/relay.js';
import { ADSB_LOL_HOST } from '../src/core/airgrid.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const block = (src, re, what) => { const m = re.exec(src); assert.ok(m, what + ' not found'); return m[1]; };
const hosts = (s, q) => [...s.matchAll(new RegExp(`${q}([a-z0-9-]+(?:\\.[a-z0-9-]+)+)${q}`, 'g'))].map(m => m[1]);

const worker = read('relay/worker.js');
const ttl = block(worker, /const TTL = \{([\s\S]*?)\n\};/, 'relay/worker.js TTL'), paths = block(worker, /const PATHS = \{([\s\S]*?)\n\};/, 'relay/worker.js PATHS');
const needs = hosts(block(read('src/map/util.js'), /export const NEEDS_RELAY = \[([^\]]*)\]/, 'NEEDS_RELAY'), "'");
const serveJs = hosts(block(read('serve.js'), /const ALLOWED_HOSTS = new Set\(\[([\s\S]*?)\]\)/, 'serve.js ALLOWED_HOSTS'), "'");
const servePy = hosts(block(read('serve.py'), /ALLOWED_HOSTS = \{([\s\S]*?)\n\}/, 'serve.py ALLOWED_HOSTS'), '"');

test('relayRefused: only the Worker\'s own allowlist 403', () => {
  assert.equal(relayRefused(403, 'host not on the relay allowlist: api.adsb.lol'), true);
  assert.equal(relayRefused(403, 'Forbidden'), false);                                       // OpenSky or FIRMS refusing a key
  assert.equal(relayRefused(403, 'this relay only serves Open Overwatch pages'), false);     // an origin problem, not the host
  assert.equal(relayRefused(200, ''), false);
  assert.equal(relayRefused(429, 'host not on the relay allowlist: api.adsb.lol'), false);
  assert.equal(relayRefused(403, undefined), false);
});

test('carried: a refused host stops being relayable for the visit, the others stay', () => {
  assert.ok(carried('https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt') && publicRelayable('https://www.ndbc.noaa.gov/activestations.xml'));
  markNotCarried('www.ndbc.noaa.gov');
  assert.equal(carried('https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt'), false);
  assert.equal(publicRelayable('https://www.ndbc.noaa.gov/activestations.xml'), false);
  assert.ok(publicRelayable('https://www.nhc.noaa.gov/CurrentStorms.json') && publicRelayable('https://api.adsb.lol/v2/mil'));
  assert.equal(carried('not a url'), false);
});

test('relay hosts: PUBLIC_RELAY_HOSTS is the Worker\'s TTL and PATHS tables, less the adsb.lol rule', () => {
  assert.match(ttl, /\[ADSB_LOL_HOST\]/); assert.match(paths, /\[ADSB_LOL_HOST\]/);
  const sorted = a => [...new Set(a)].sort();
  assert.deepEqual(sorted(hosts(ttl, "'")), sorted(PUBLIC_RELAY_HOSTS));
  assert.deepEqual(sorted(hosts(paths, "'")), sorted(PUBLIC_RELAY_HOSTS));
  assert.ok(!PUBLIC_RELAY_HOSTS.includes(ADSB_LOL_HOST), 'adsb.lol is carried by its per-path rule (core/airgrid.js), not by host');
});

test('relay hosts: public relay ⊆ NEEDS_RELAY ⊆ both helpers, and the helpers agree', () => {
  assert.ok(needs.length > 10 && serveJs.length > 10 && servePy.length > 10);
  for (const h of [...PUBLIC_RELAY_HOSTS, ADSB_LOL_HOST]) assert.ok(needs.includes(h), `${h} is on the public relay but not in NEEDS_RELAY (src/map/util.js)`);
  for (const h of needs) {
    assert.ok(serveJs.includes(h), `${h} is in NEEDS_RELAY but not in serve.js ALLOWED_HOSTS`);
    assert.ok(servePy.includes(h), `${h} is in NEEDS_RELAY but not in serve.py ALLOWED_HOSTS`);
  }
  assert.deepEqual([...serveJs].sort(), [...servePy].sort(), 'serve.js and serve.py relay the same hosts');
});

test('relay hosts: every NEEDS_RELAY host is one some view fetches (no dead entries)', () => {
  const files = [];
  const walk = dir => { for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) e.isDirectory() ? walk(dir + e.name + '/') : e.name.endsWith('.js') && files.push(dir + e.name); };
  walk('src/');
  const code = files.filter(f => f !== 'src/map/util.js').map(read).join('\n');
  const stills = ['kamera.atlas.vegvesen.no', 'atmsqf.iowadot.gov', 'trafficcam.calgary.ca', 'images.data.gov.sg'];   // camera pictures: the feeds name them
  for (const h of needs) if (!stills.includes(h)) assert.ok(code.includes('https://' + h) || (h === ADSB_LOL_HOST && /ADSB_LOL_HOST/.test(code)), `${h} is in NEEDS_RELAY but nothing in src/ fetches it`);
});
