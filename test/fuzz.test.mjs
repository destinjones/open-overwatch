// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Fuzz and property tests of the hand-written decoders that read untrusted upstream bytes: GRIB2 (core/grib2.js), CCSDS
// AEC (core/aec.js), JPEG 2000 (core/jpx.js), vector tiles (core/mvt.js), GTFS-realtime (core/gtfsrt.js), METAR and TAF
// (core/metar.js), MQTT (core/transit.js) and the text feeds. Each target (test/helpers/fuzz.mjs) runs in a worker with
// a deadline, so a hang fails with the case it hung on instead of stalling the run. A decoder must return a well-formed
// result or throw an Error, within 250 ms a call, without asking for an absurd buffer, and with no NaN or Infinity where
// a number is promised. Then the regressions: each real bug the fuzzing found, as the input that showed it.
// OO_FUZZ=1 runs 50 times as many cases (OO_FUZZ=n: n times); OO_FUZZ_SEED=n replays another seed. See docs/TESTING.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { TARGETS, progressLabel } from './helpers/fuzz.mjs';
import { message, fields } from './helpers/grib2.mjs';
import { decodeGrib2, parseIdx } from '../src/core/grib2.js';
import { aecDecode, aecEncode, AEC } from '../src/core/aec.js';
import { jpxDecode } from '../src/core/jpx.js';
import { Pbf, decodeTile } from '../src/core/mvt.js';
import { parseVehiclePositions, encodeVehiclePositions } from '../src/core/gtfsrt.js';
import { parseMetar, parseTaf } from '../src/core/metar.js';
import { parseSocrates } from '../src/core/socrates.js';
import { parseEcIndex } from '../src/core/wxmodels.js';
import { parseDart } from '../src/core/ocean.js';

const env = process.env.OO_FUZZ, SCALE = !env ? 1 : +env === 1 ? 50 : Math.max(1, +env || 1);
const SEED = Number.isFinite(+process.env.OO_FUZZ_SEED) && process.env.OO_FUZZ_SEED ? +process.env.OO_FUZZ_SEED >>> 0 : SCALE > 1 ? (Date.now() >>> 0) : 20261017;
const DEADLINE = 60e3 * SCALE;   // the whole target; one call has 250 ms

function fuzz(name) {
  return new Promise((resolve, reject) => {
    const sab = new SharedArrayBuffer(12), progress = new Int32Array(sab);
    const w = new Worker(new URL('./helpers/fuzz.mjs', import.meta.url), { workerData: { ooFuzz: true, name, seed: SEED, scale: SCALE, budgetMs: 250, sab } });
    const at = () => progressLabel([0, 1, 2].map(i => Atomics.load(progress, i))), replay = `OO_FUZZ_SEED=${SEED}${SCALE > 1 ? ' OO_FUZZ=' + env : ''}`;
    let done = false;
    const end = (f, v) => { if (done) return; done = true; clearTimeout(timer); f(v); };
    const timer = setTimeout(() => { const where = at(); w.terminate(); end(reject, new Error(`${name}: no answer after ${DEADLINE / 1000} s: ${where} hangs (${replay})`)); }, DEADLINE);
    w.once('message', m => { end(resolve, m); w.terminate(); });
    w.once('error', e => end(reject, e));
    w.once('exit', code => end(reject, new Error(`${name}: the worker exited with code ${code} at ${at()} (${replay})`)));   // a target that ended the worker
  });
}

for (const name of Object.keys(TARGETS)) {
  test(`fuzz: ${name}: ${TARGETS[name].about}`, async t => {
    const r = await fuzz(name);
    t.diagnostic(`${r.cases} cases in ${r.ms} ms, slowest call ${r.slowestMs} ms, seed ${SEED}`);
    assert.ok(!r.failures.length, `${name} (OO_FUZZ_SEED=${SEED}${SCALE > 1 ? ' OO_FUZZ=' + env : ''}): ` + r.failures.map(f => `\n  ${f.label}: ${f.problem}\n    ${f.input}`).join(''));
  });
}

// ---- regressions: what the fuzzing found (on 2026-10-17), each as a small input that showed it. "Hung" means the call
// never returned; the others returned a wrong value without an error.
const WX = new URL('./fixtures/wx/', import.meta.url);
const grib = name => new Uint8Array(fs.readFileSync(new URL(name + '.grib2', WX)));
const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const put32 = (b, p, v) => { b[p] = v >>> 24; b[p + 1] = (v >>> 16) & 255; b[p + 2] = (v >>> 8) & 255; b[p + 3] = v & 255; return b; };
const section = (b, n) => { for (let q = 16; q < b.length; q += u32(b, q)) if (b[q + 4] === n) return q; return -1; };
const small = () => Uint8Array.from(message({ ni: 4, nj: 3, ints: Array(12).fill(1) }));
const codestream = () => { const b = grib('jpeg'), q = section(b, 7); return b.slice(q + 5, q + u32(b, q)); };

test('grib2 regressions: no message loops for ever, no size is believed past the data, no value overflows float32', () => {
  assert.throws(() => decodeGrib2(Uint8Array.of(0x47, 0x52, 0x49, 0x42, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0)), /a message of 0 bytes/);   // hung: p = end = p
  assert.throws(() => decodeGrib2(grib('jpeg').slice(0, 298)), /cut off/);   // hung (in the JPEG 2000 tile header); a cut download now says so
  assert.throws(() => decodeGrib2(put32(small(), section(small(), 5) + 5, 0xfffffff0)), /values for 12 grid points/);   // hung: 4 billion values read from 3 bytes
  assert.throws(() => decodeGrib2(put32(small(), section(small(), 3) + 30, 0x7fffffff)), /a grid of 2147483647 × 3/);   // hung: a 6-billion-point grid
  assert.throws(() => decodeGrib2(Uint8Array.from(message({ ni: 2, nj: 1, ints: [1, 2], E: 200 }))), /out of range/);   // was Infinity
  assert.throws(() => decodeGrib2(put32(small(), section(small(), 3) + 30, 8)), /12 values for 24 grid points/);   // was 12 made-up values with no bitmap
  const wide = small(); wide[section(wide, 5) + 19] = 32;
  assert.throws(() => decodeGrib2(wide), /shorter than its values/);   // was values read from the next section and past the end
  const ccsds = small(); ccsds[section(ccsds, 5) + 10] = 42;   // a 21-byte section 5 that says CCSDS, whose parameters need 25
  assert.throws(() => decodeGrib2(ccsds), /section 5 is too short/);   // was flags and block size read from section 6
  const two = decodeGrib2(Uint8Array.from(fields(message({ ni: 3, nj: 2, ints: [1, 2, 3, 4], bitmap: [1, 0, 1, 1, 0, 1] }), message({ ni: 3, nj: 2, ints: [5, 6, 7, 8, 9, 10] }))));
  assert.deepEqual([...two[1].values], [5, 6, 7, 8, 9, 10]);   // the second field of a message has no bitmap: it inherited the first's ([5, NaN, 6, 7, NaN, 8])
  const kept = decodeGrib2(Uint8Array.from([...small(), ...grib('jpeg').slice(0, 298)]));
  assert.deepEqual(kept.map(m => m.values.length), [12]);   // a cut message after a whole one keeps the whole one
  for (const name of ['ccsds', 'jpeg', 'jpeg-lossy']) assert.equal(decodeGrib2(grib(name))[0].values.length, 5917);   // the real fields still decode
});

test('aec regressions: zero blocks per interval, zero runs past the interval, samples wider than their bits', () => {
  assert.throws(() => aecDecode(Uint8Array.of(0, 0x43, 0x04), { n: 610, bits: 12, blockSize: 64, rsi: 0, flags: AEC.PREPROCESS }), /0 blocks per reference interval/);   // hung
  assert.throws(() => aecDecode(Uint8Array.of(0, 0x43, 0x04), { n: 610, bits: 12, blockSize: 0, rsi: 128, flags: AEC.PREPROCESS }), /block size 0/);   // hung
  assert.throws(() => aecDecode(Uint8Array.of(0x02), { n: 24, bits: 8, blockSize: 8, rsi: 1, flags: 0 }), /zero run past/);   // three zero blocks in a one-block interval: was 16 NaN
  assert.throws(() => aecDecode(Uint8Array.of(0x20, 0, 0x0f, 0xfe), { n: 8, bits: 4, blockSize: 8, rsi: 1, flags: 0 }), /over 4 bits/);   // was a sample of 17 from 4 bits
  assert.throws(() => aecDecode(Uint8Array.of(0), { n: 2 ** 31, bits: 8, blockSize: 8, rsi: 1, flags: 0 }), /samples from 1 bytes/);   // a 16 GB buffer was asked for first
  const s = [3, 3, 0, 1], { bytes } = aecEncode(s, { bits: 2, blockSize: 8, rsi: 1, flags: AEC.RESTRICTED });   // the encoder too: a 1-bit option id has no split option
  assert.deepEqual([...aecDecode(bytes, { n: 4, bits: 2, blockSize: 8, rsi: 1, flags: AEC.RESTRICTED })], s);
});

test('jpx regressions: a stream cut in a header ends, a size or tile of zero or billions is refused', () => {
  assert.throws(() => jpxDecode(codestream().slice(0, 121)), /tile-part header with no SOD/);   // hung: u16 reads 0 past the end
  const cut = jpxDecode(codestream().slice(0, 156));   // hung: a packet header cut short read zero bit-planes for ever
  assert.equal(cut.data.length, 97 * 61); assert.ok(cut.data.every(Number.isFinite));
  assert.throws(() => jpxDecode(put32(codestream(), 8, 0x7fffffff)), /an image of 2147483647/);   // was a RangeError from a 1 TB buffer
  assert.throws(() => jpxDecode(put32(codestream(), 24, 0)), /tiles of 0 × 61/);   // was 5,917 zeros and no error
  assert.throws(() => jpxDecode(codestream(), { maxSamples: 1000 }), /an image of 97 × 61/);   // GRIB2 says how many it can use
  const many = codestream(), c = many.indexOf(0x52, 40) - 1; many[c + 4] |= 1; many[c + 6] = many[c + 7] = 0xff;   // 65535 layers, precincts from the bytes after
  assert.throws(() => jpxDecode(many), /precinct/);   // was out of memory (a crash, not an Error): the packet list was made up front
});

test('pbf, mvt and gtfsrt regressions: a length past the end, an endless varint, NaN in a float field', () => {
  assert.deepEqual(decodeTile(Uint8Array.of(0x1a, 0xff, 0xff, 0xff, 0xff, 0x0f)), {});   // hung: walked 4 billion missing bytes
  assert.deepEqual(parseVehiclePositions(Uint8Array.of(0x12, 0xff, 0xff, 0xff, 0xff, 0x0f)), { t: null, vehicles: [] });   // likewise
  assert.throws(() => new Pbf(Uint8Array.from([...Array(147).fill(0x80), 0])).varint(), /varint too long/);   // was NaN
  const f64 = v => { const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v, true); return [...new Uint8Array(d.buffer)]; };
  const t = Uint8Array.from([0x1a, 30, 0x0a, 1, 0x6c, 0x12, 9, 0x12, 2, 0, 0, 0x18, 1, 0x22, 1, 9, 0x1a, 1, 0x68, 0x22, 9, 0x19, ...f64(NaN), 0x28, 0]);   // value NaN, extent 0
  assert.deepEqual(decodeTile(t).l, { extent: 4096, features: [{ id: null, type: 1, props: { h: null }, parts: [] }] });   // were NaN and 0 (the callers divide by it)
  const v = parseVehiclePositions(encodeVehiclePositions({ t: 0, vehicles: [{ vehicleId: 'a', lat: 95, lon: 10 }, { vehicleId: 'b', lat: 10, lon: 10, spd: NaN, hdg: Infinity }] })).vehicles;
  assert.deepEqual(v.map(x => [x.vehicleId, x.spd, x.hdg]), [['b', null, null]]);   // were a vehicle at 95° N, and NaN and Infinity
});

test('metar regressions: directions past 360°, impossible days and hours, a visibility of Infinity', () => {
  const now = Date.UTC(2026, 9, 13, 15);
  assert.equal(parseMetar('METAR PANC 131353Z 97802KT 10SM BKN070 03/02 A2969').wind, null);   // was a wind from 978°
  assert.equal(parseMetar('METAR SCEL 131400Z 03003KT 9999 903V700 14/10 Q1015').windVar, null);   // was "swinging between 903° and 700°"
  assert.equal(parseMetar('KHUT 911597Z 19014KT 10SM CLR 26/21 A2985', { now }).time, null);   // day 91, 15:97 was 2026-11-30T16:37Z
  assert.equal(parseMetar('METAR KJFK 131351Z 18010KT ' + '9'.repeat(400) + 'SM SKC 20/10 A3000').visSM, null);   // was Infinity
  const taf = parseTaf('TAF KJFK 131130Z 9999/9999 18010KT P6SM SKC FM991299 20012KT P6SM BKN050', { now });
  assert.deepEqual([taf.from, taf.to, taf.periods.map(p => p.kind)], [null, null, ['BASE']]);   // were 2027-01-11 and an FM period on 2027-01-07
  assert.equal(parseMetar('METAR KJFK 131351Z 36010KT 10SM SKC 20/10 A3000', { now }).wind.dir, 360);   // north stays north
});

test('text feed regressions: a short SOCRATES row, garbled numbers, .idx offsets that are not offsets', () => {
  const head = 'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB\n';
  assert.equal(parseSocrates(head + '25544,ISS,0.5,49863,DEB,1.2,2026-10-14 15:00:00.000,0.412,14.2,1e-4\n482').length, 1);   // threw a TypeError: the whole list lost
  assert.deepEqual(parseSocrates(head + '25544,ISS,0.5,49863,DEB,1.2,2026-10-14 15:00:00.000,0.412,fast,high').map(r => [r.speedKmS, r.maxProb]), [[null, null]]);   // were NaN
  assert.deepEqual(parseIdx('1:0:d=1:UGRD:10 m above ground:anl:\n2:x99:d=1:VGRD:10 m above ground:anl:\n3:50:d=1:TMP:2 m:anl:\n4:20:d=1:RH:2 m:anl:').map(r => [r.start, r.end]), [[0, 49], [50, null]]);   // were NaN and a backwards range
  assert.deepEqual(parseEcIndex('{"param": "u", "levtype": "sfc", "step": "6", "_offset": -5, "_length": 0.5}'), []);   // was bytes -5 to -5.5
  assert.equal(parseDart('2026 10 13 18 00 00 X 2737.734').rows[0].mode, null);   // was NaN
});
