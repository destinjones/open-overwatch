// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// src/core/ecfvel.js: the Earth-fixed velocity from one SGP4 run matches differencing two Earth-fixed positions, for the
// stations in test/fixtures/stations.tle over 100 times across two days. SGP4 is the vendored copy the workers load
// (src/vendor/satellite.min.js, run here in a bare context), so this needs no npm install; the globe worker runs on it too.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { eciVelToEcf, EARTH_RATE } from '../src/core/ecfvel.js';
import { parseTle } from '../src/core/tle.js';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../src/vendor/satellite.min.js', import.meta.url), 'utf8'), ctx);
const satellite = ctx.satellite, VmDate = vm.runInContext('Date', ctx);   // satellite.js checks instanceof Date: dates from its own realm
const sats = parseTle(readFileSync(new URL('fixtures/stations.tle', import.meta.url), 'utf8'));
const T0 = Date.UTC(2026, 9, 1, 12);   // the fixture's epochs are 2026-10-01

const ecfAt = (rec, ms) => { const d = new VmDate(ms), pv = satellite.propagate(rec, d); return { pv, g: satellite.gstime(d), p: pv.position && satellite.eciToEcf(pv.position, satellite.gstime(d)) }; };
const diff = (a, b, h) => ({ x: (b.x - a.x) / h, y: (b.y - a.y) / h, z: (b.z - a.z) / h });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('one propagation gives the Earth-fixed velocity the positions say (within 1 m/s), 100 times per station', () => {
  assert.ok(sats.length >= 3 && satellite && typeof satellite.propagate === 'function');
  let n = 0;
  for (const s of sats) {
    const rec = satellite.twoline2satrec(s.l1, s.l2);
    for (let k = 0; k < 100; k++) {
      const ms = T0 + k * 1717e3;   // 100 times over ~2 days, at every phase of the orbit
      const { pv, g, p } = ecfAt(rec, ms);
      const v = eciVelToEcf(p, pv.velocity, g, {});
      // a central difference over 1 s is the velocity at ms to well under a mm/s
      const central = diff(ecfAt(rec, ms - 500).p, ecfAt(rec, ms + 500).p, 1);
      assert.ok(dist(v, central) * 1000 < 1, `${s.name} at +${k}: ${(dist(v, central) * 1000).toFixed(3)} m/s`);
      // the old 1 s forward difference is the velocity half a second later: a few m/s off (gravity), never more
      const forward = diff(p, ecfAt(rec, ms + 1000).p, 1);
      assert.ok(dist(v, forward) * 1000 < 6, `${s.name} at +${k}: forward ${(dist(v, forward) * 1000).toFixed(2)} m/s`);
      n++;
    }
  }
  assert.equal(n, sats.length * 100);
});

test('the frame turns with the Earth: a point fixed in space moves west at omega x r', () => {
  const v = eciVelToEcf({ x: 7000, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
  assert.ok(Math.abs(v.y + EARTH_RATE * 7000) < 1e-12 && v.x === 0 && v.z === 0, JSON.stringify(v));
  // a geostationary satellite stands still in the Earth-fixed frame
  const r = 42164, gmst = 1.1, u = { x: Math.cos(gmst + 0.3), y: Math.sin(gmst + 0.3) }, sp = EARTH_RATE * r;
  const rEcf = { x: r * Math.cos(0.3), y: r * Math.sin(0.3), z: 0 }, vEci = { x: -u.y * sp, y: u.x * sp, z: 0 }, out = {};
  assert.equal(eciVelToEcf(rEcf, vEci, gmst, out), out, 'writes into out');
  assert.ok(Math.hypot(out.x, out.y, out.z) < 1e-9, JSON.stringify(out));
});

test("the globe's satellite worker: one tick gives each satellite's Earth-fixed position and velocity", () => {
  // the worker source from src/globe/satellites.js, with its two interpolations filled in as the page does
  const file = readFileSync(new URL('../src/globe/satellites.js', import.meta.url), 'utf8');
  let src = /const WORKER_SRC = `([\s\S]*?)`;/.exec(file)[1];
  src = src.replace('${JSON.stringify(SAT_LIB)}', '"vendor"').replace('${eciVelToEcf}', String(eciVelToEcf));
  assert.ok(!src.includes('${'), 'no other interpolation');
  const lib = readFileSync(new URL('../src/vendor/satellite.min.js', import.meta.url), 'utf8'), posted = [];
  const w = vm.createContext({ performance, postMessage: m => posted.push(m) });
  w.importScripts = url => { assert.equal(url, 'vendor'); vm.runInContext(lib, w); };
  vm.runInContext(src, w);
  w.onmessage({ data: { type: 'load', tles: [...sats.map(s => [s.l1, s.l2]), null] } });
  const t = T0 + 3600e3; w.onmessage({ data: { type: 'tick', t } });
  const { buf } = posted[0], D = vm.runInContext('Date', w);
  assert.equal(buf.length, (sats.length + 1) * 6);
  sats.forEach((s, i) => {
    const rec = w.satellite.twoline2satrec(s.l1, s.l2), pv = w.satellite.propagate(rec, new D(t)), g = w.satellite.gstime(new D(t));
    const p = w.satellite.eciToEcf(pv.position, g), v = eciVelToEcf(p, pv.velocity, g);
    const got = [...buf.slice(i * 6, i * 6 + 6)];
    [p.x, p.y, p.z, v.x, v.y, v.z].forEach((x, k) => assert.ok(Math.abs(got[k] - x) < (k < 3 ? 1e-2 : 1e-5), `${s.name} [${k}] ${got[k]} vs ${x}`));
  });
  assert.ok(Number.isNaN(buf[sats.length * 6]), 'no elements: hidden');
});

test('self-contained, so the workers can inline it with toString()', () => {
  const inlined = new Function(`${eciVelToEcf}; return eciVelToEcf;`)();
  assert.deepEqual(inlined({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }, 0.7), eciVelToEcf({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }, 0.7));
  assert.match(String(eciVelToEcf), /7\.2921159e-5/, 'the rate is written out, matching EARTH_RATE');
  assert.equal(EARTH_RATE, 7.2921159e-5);
});
