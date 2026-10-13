// CCSDS AEC (src/core/aec.js) and the JPEG 2000 subset (src/core/jpx.js) behind GRIB2 templates 5.42 and 5.40: round
// trips through the test encoder (every AEC coding option), the wavelets against their forward transforms, and small
// GRIB2 messages written by ECMWF's eccodes (libaec, OpenJPEG) checked against eccodes' own decoding of them
// (test/fixtures/wx). Real fields were also checked: ECMWF IFS 10 m wind, mean sea-level pressure, cloud, rain rate,
// gusts, wave height and direction (CCSDS) and NOAA WAVEWATCH III wave height and direction (JPEG 2000), all equal to
// eccodes within float32 rounding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aecDecode, aecEncode, AEC } from '../src/core/aec.js';
import { synth, jpxDecode } from '../src/core/jpx.js';
import { decodeGrib2 } from '../src/core/grib2.js';

let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

function roundTrip(samples, opts) {
  const { bytes } = aecEncode(samples, opts);
  const back = aecDecode(bytes, { ...opts, n: samples.length });
  assert.deepEqual(Array.from(back), samples);
  return bytes.length;
}

test('AEC: a smooth field with the predictor, every block size', () => {
  for (const J of [8, 16, 32, 64]) {
    const s = Array.from({ length: 1000 }, (_, i) => Math.round(2000 + 900 * Math.sin(i / 37) + rand() * 6));
    const size = roundTrip(s, { bits: 12, blockSize: J, rsi: 16, flags: AEC.PREPROCESS | AEC.MSB });
    assert.ok(size < 1000 * 12 / 8 * 0.6, `J=${J} compresses (${size} bytes)`);
  }
});

test('AEC: zero runs, including "the rest of the segment" and runs over 64 blocks', () => {
  const s = [5, ...Array(32 * 70).fill(5), 9, 9, 9, ...Array(200).fill(9), 4095, 0, 4095, ...Array(31 * 5).fill(7)];
  roundTrip(s, { bits: 12, blockSize: 32, rsi: 128, flags: AEC.PREPROCESS | AEC.MSB });
  roundTrip(s, { bits: 12, blockSize: 8, rsi: 3, flags: AEC.PREPROCESS });
  roundTrip(Array(64 * 9).fill(0), { bits: 8, blockSize: 8, rsi: 64, flags: AEC.PREPROCESS });
});

test('AEC: the second extension, uncompressed blocks, no predictor, padded intervals', () => {
  const tiny = Array.from({ length: 640 }, (_, i) => 100 + (i % 3 === 0 ? 1 : 0) - (i % 7 === 0 ? 1 : 0));
  roundTrip(tiny, { bits: 10, blockSize: 16, rsi: 8, flags: AEC.PREPROCESS });
  const noise = Array.from({ length: 333 }, () => Math.floor(rand() * 65536));
  roundTrip(noise, { bits: 16, blockSize: 32, rsi: 4, flags: AEC.PREPROCESS | AEC.MSB });
  roundTrip(noise.map(v => v >> 4), { bits: 12, blockSize: 16, rsi: 4, flags: 0 });
  roundTrip(noise.map(v => v >> 8), { bits: 8, blockSize: 16, rsi: 5, flags: AEC.PREPROCESS | AEC.PAD_RSI });
  roundTrip(noise.map(v => v * 37 % 2 ** 20), { bits: 20, blockSize: 32, rsi: 2, flags: AEC.PREPROCESS | AEC.THREE_BYTE });
});

test('AEC: values at the ends of the range (the predictor folds residuals there)', () => {
  const s = Array.from({ length: 512 }, (_, i) => [0, 1, 4095, 4094, 2048, 0, 0, 4095][i % 8]);
  roundTrip(s, { bits: 12, blockSize: 16, rsi: 32, flags: AEC.PREPROCESS });
  assert.throws(() => aecDecode(new Uint8Array(3), { n: 100, bits: 12, blockSize: 32, rsi: 128, flags: AEC.PREPROCESS }), /ran out/);
});

// ---- wavelets: synthesis undoes analysis
function analysis53(x, i0) {   // forward 5/3 lifting with whole-sample symmetric extension
  if (x.length === 1) return x.slice();   // a lone sample at an even place passes through
  const n = x.length, at = (a, k) => { const p = 2 * (n - 1); k = ((k % p) + p) % p; return a[k >= n ? p - k : k]; };
  const y = x.slice(), odd = k => ((k + i0) & 1) === 1;
  for (let k = 0; k < n; k++) if (odd(k)) y[k] = x[k] - Math.floor((at(x, k - 1) + at(x, k + 1)) / 2);
  const z = y.slice(); for (let k = 0; k < n; k++) if (!odd(k)) z[k] = y[k] + Math.floor((at(y, k - 1) + at(y, k + 1) + 2) / 4);
  return z;
}
function analysis97(x, i0) {
  const n = x.length, ext = a => k => { const p = 2 * (n - 1) || 1; k = ((k % p) + p) % p; return a[k >= n ? p - k : k]; }, odd = k => ((k + i0) & 1) === 1;
  const A = -1.586134342059924, B = -0.052980118572961, G = 0.882911075530934, D = 0.443506852043971, K = 1.230174104914001;
  let y = x.slice();
  for (const [c, wantOdd] of [[A, true], [B, false], [G, true], [D, false]]) { const e = ext(y.slice()); for (let k = 0; k < n; k++) if (odd(k) === wantOdd) y[k] = e(k) + c * (e(k - 1) + e(k + 1)); }
  return y.map((v, k) => odd(k) ? v * K : v / K);
}

test('wavelets: 5/3 is exact, 9/7 within rounding, on either parity and short lengths', () => {
  for (const n of [1, 2, 3, 4, 5, 8, 13, 64]) for (const i0 of [0, 1]) {
    const x = Array.from({ length: n }, () => Math.floor(rand() * 4096) - 2048);
    if (n > 1 || i0 === 0) {
      const y = Float64Array.from(analysis53(x, i0)); synth(y, n, i0, true);
      assert.deepEqual(Array.from(y), x, `5/3 n=${n} i0=${i0}`);
    }
    if (n > 1) {
      const z = Float64Array.from(analysis97(x, i0)); synth(z, n, i0, false);
      for (let k = 0; k < n; k++) assert.ok(Math.abs(z[k] - x[k]) < 1e-6, `9/7 n=${n} i0=${i0}`);
    }
  }
});

// ---- messages eccodes wrote
const FIX = new URL('./fixtures/wx/', import.meta.url);
for (const name of ['ccsds', 'ccsds-bitmap', 'jpeg', 'jpeg-bitmap', 'jpeg-lossy']) {
  test(`eccodes-written GRIB2 (${name}) decodes as eccodes decodes it`, () => {
    const want = JSON.parse(fs.readFileSync(new URL(name + '.json', FIX), 'utf8'));
    const [m] = decodeGrib2(new Uint8Array(fs.readFileSync(new URL(name + '.grib2', FIX))));
    assert.equal(m.values.length, want.n);
    assert.equal(m.category + '.' + m.number, '3.0');
    let sum = 0, miss = 0; for (const v of m.values) { if (Number.isNaN(v)) miss++; else sum += v; }
    assert.equal(miss, want.missing);
    assert.ok(Math.abs(sum - want.sum) < 0.01 * want.n, `sum ${sum} vs ${want.sum}`);
    for (const [i, v] of want.samples) if (v === null) assert.ok(Number.isNaN(m.values[i]), `index ${i} missing`); else assert.ok(Math.abs(m.values[i] - v) < 0.01, `index ${i}: ${m.values[i]} vs ${v}`);
  });
}

test('JPEG 2000: the codestream header is checked', () => {
  assert.throws(() => jpxDecode(new Uint8Array([0, 1, 2, 3])), /not a JPEG 2000/);
});
