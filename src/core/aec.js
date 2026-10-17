// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// CCSDS 121.0-B lossless decompression (Adaptive Entropy Coding, "AEC", the Rice coder libaec implements), as GRIB2 data
// template 5.42 uses it: ECMWF writes its open-data forecasts this way. Pure (test/aec.test.mjs); checked against eccodes
// on a real IFS field. Reference: CCSDS 121.0-B-3 "Lossless Data Compression", and libaec's decoder for the details the
// standard leaves to implementations (how a zero run ends a reference sample interval).
//
// The stream is blocks of J samples; every `rsi` blocks start a "reference sample interval" whose first sample is sent
// raw. Each block opens with an option id: zero blocks (runs of all-zero blocks), the second extension (pairs of small
// values coded together), a split-sample k (each value's high part in unary, then its k low bits) or no compression.
// With preprocessing on, the decoded values are the unit-delay predictor's mapped residuals: undone per interval.

/** Flags as GRIB2 octet 22 of section 5 (template 5.42) carries them (libaec's AEC_DATA_* bits). */
export const AEC = Object.freeze({ SIGNED: 1, THREE_BYTE: 2, MSB: 4, PREPROCESS: 8, RESTRICTED: 16, PAD_RSI: 32 });
const ROS = 5;   // the "remainder of segment" code in a zero run

/** A big-endian bit reader over bytes, reading up to 32 bits at a time. */
class Reader {
  constructor(b) { this.b = b; this.pos = 0; this.end = b.length * 8; }
  bit() { const p = this.pos++; if (p >= this.end) throw new Error('aec: ran out of data'); return (this.b[p >> 3] >> (7 - (p & 7))) & 1; }
  read(n) {
    let v = 0;
    while (n > 0) {
      const p = this.pos >> 3, off = this.pos & 7, take = Math.min(8 - off, n);
      if (this.pos + take > this.end) throw new Error('aec: ran out of data');
      v = v * (1 << take) + ((this.b[p] >> (8 - off - take)) & ((1 << take) - 1));
      this.pos += take; n -= take;
    }
    return v;
  }
  /** A fundamental sequence: the number of zeros before the next one. */
  fs() {
    let n = 0;
    for (;;) {
      if (this.pos >= this.end) throw new Error('aec: ran out of data');
      const p = this.pos >> 3, off = this.pos & 7, byte = (this.b[p] << off) & 0xff;
      if (byte === 0) { n += 8 - off; this.pos += 8 - off; continue; }   // a whole (rest of a) byte of zeros
      const z = Math.clz32(byte) - 24; n += z; this.pos += z + 1; return n;
    }
  }
  align() { this.pos = (this.pos + 7) & ~7; }
}

/** The second extension's pair table: for a code m, [sum of the pair, m's offset in its diagonal]. */
const SE = (() => { const t = []; for (let i = 0; i < 13; i++) for (let j = 0; j <= i; j++) t.push([i, i * (i + 1) / 2]); return t; })();

/**
 * Decode `n` samples of `bits` bits from `bytes` (Uint8Array). `blockSize` J (8, 16, 32 or 64), `rsi` blocks per
 * reference interval, `flags` from AEC. Returns a Float64Array of the samples (signed if the SIGNED flag is set).
 */
export function aecDecode(bytes, { n, bits, blockSize, rsi, flags }) {
  if (!Number.isInteger(n) || n < 0) throw new Error('aec: ' + n + ' samples');
  if (!Number.isInteger(bits) || bits < 1 || bits > 32) throw new Error('aec: ' + bits + ' bits per sample');
  if (![8, 16, 32, 64].includes(blockSize)) throw new Error('aec: block size ' + blockSize);   // 0 would never finish an interval
  if (!Number.isInteger(rsi) || rsi < 1 || rsi > 4096) throw new Error('aec: ' + rsi + ' blocks per reference interval');
  // the most a stream can hold: a 9-bit "rest of the segment" zero run stands for at most 64 blocks of 64 samples
  if (n > bytes.length * 8 * 4096 + 64) throw new Error('aec: ' + n + ' samples from ' + bytes.length + ' bytes');
  const out = new Float64Array(n);
  if (!n) return out;
  const J = blockSize, pp = !!(flags & AEC.PREPROCESS), signed = !!(flags & AEC.SIGNED);
  const idLen = bits > 16 ? 5 : bits > 8 ? 4 : (flags & AEC.RESTRICTED) && bits <= 4 ? (bits <= 2 ? 1 : 2) : 3;
  const UNCOMP = 2 ** idLen - 1, xmax = 2 ** bits - 1, half = 2 ** (bits - 1);
  const r = new Reader(bytes), interval = new Float64Array(J * rsi);
  let k = 0;   // samples written to out
  while (k < n) {
    // one reference sample interval: up to rsi blocks, decoded into `interval`, then post-processed into out
    let used = 0;
    while (used < J * rsi && k + used < n) {
      const ref = pp && used === 0 ? 1 : 0, id = r.read(idLen);
      if (id === 0) {   // low entropy: zero blocks or the second extension
        const se = r.bit();
        if (ref) interval[used++] = r.read(bits);
        if (se) {
          let i = ref;
          while (i < J) {
            const m = r.fs(); if (m >= SE.length) throw new Error('aec: bad second-extension code');
            const [sum, ms] = SE[m], d1 = m - ms;
            if ((i & 1) === 0) { interval[used++] = sum - d1; i++; }
            interval[used++] = d1; i++;
          }
        } else {
          let blocks = r.fs() + 1;
          if (blocks === ROS) { const b = Math.floor((used - ref) / J); blocks = Math.min(rsi - b, 64 - (b % 64)); }
          else if (blocks > ROS) blocks--;
          if (used + blocks * J - ref > J * rsi) throw new Error('aec: a zero run past its reference interval');
          for (let i = blocks * J - ref; i > 0; i--) interval[used++] = 0;
        }
      } else if (id === UNCOMP) {
        for (let i = 0; i < J; i++) interval[used++] = r.read(bits);
      } else {   // split sample, k = id - 1: every value's high part in unary first, then the low bits
        const kk = id - 1, start = used;
        if (ref) interval[used++] = r.read(bits);
        const first = used;
        for (let i = ref; i < J; i++) interval[used++] = r.fs() * 2 ** kk;
        if (kk) for (let i = first; i < used; i++) interval[i] += r.read(kk);
        if (used - start !== J) throw new Error('aec: block size');
      }
    }
    if (flags & AEC.PAD_RSI) r.align();
    // post-process: undo the predictor (or copy), and stop at n
    const m = Math.min(used, n - k);
    for (let i = 0; i < m; i++) if (interval[i] > xmax) throw new Error('aec: a sample over ' + bits + ' bits');
    if (!pp) {
      for (let i = 0; i < m; i++) out[k + i] = signed && interval[i] >= half ? interval[i] - 2 * half : interval[i];
    } else {
      // the reference is the first sample; each later value is a mapped residual against the one before
      const lo = signed ? -half : 0, hi = signed ? half - 1 : xmax;
      let x = signed && interval[0] >= half ? interval[0] - 2 * half : interval[0];
      out[k] = x;
      for (let i = 1; i < m; i++) {
        const d = interval[i], theta = Math.min(x - lo, hi - x);
        if (d <= 2 * theta) x += d % 2 ? -(d + 1) / 2 : d / 2;
        else x = theta === x - lo ? lo + d : hi - d;
        out[k + i] = x;
      }
    }
    k += m;
  }
  return out;
}

/**
 * The AEC encoder's counterpart, for tests and fixtures: `samples` (non-negative integers below 2^bits) → bytes. It
 * picks each block's option the simple way (the cheapest of split k, second extension, zero run, uncompressed), so a
 * test sees every option. Not used by the site.
 */
export function aecEncode(samples, { bits, blockSize, rsi, flags }) {
  const J = blockSize, pp = !!(flags & AEC.PREPROCESS), xmax = 2 ** bits - 1;
  const idLen = bits > 16 ? 5 : bits > 8 ? 4 : (flags & AEC.RESTRICTED) && bits <= 4 ? (bits <= 2 ? 1 : 2) : 3, UNCOMP = 2 ** idLen - 1;
  const out = []; let cur = 0, nb = 0;
  const put = (v, k) => { for (let i = k - 1; i >= 0; i--) { cur = (cur << 1) | (Math.floor(v / 2 ** i) % 2); if (++nb === 8) { out.push(cur); cur = 0; nb = 0; } } };
  const fs = v => { for (let i = 0; i < v; i++) put(0, 1); put(1, 1); };
  // pad to whole blocks and intervals the way libaec does: repeat the last sample
  const n = samples.length, padded = samples.slice();
  while (padded.length % J) padded.push(padded[padded.length - 1]);
  for (let s = 0; s < padded.length; s += J * rsi) {
    const iv = padded.slice(s, s + J * rsi), d = iv.slice();
    if (pp) for (let i = iv.length - 1; i >= 1; i--) {
      const x = iv[i - 1], delta = iv[i] - x, theta = Math.min(x, xmax - x);
      d[i] = delta >= 0 && delta <= theta ? 2 * delta : delta < 0 && -delta <= theta ? -2 * delta - 1 : theta + Math.abs(delta);
    }
    const blocks = []; for (let b = 0; b < iv.length; b += J) blocks.push(d.slice(b, b + J));
    for (let b = 0; b < blocks.length; b++) {
      const ref = pp && b === 0, blk = blocks[b], vals = ref ? blk.slice(1) : blk;
      if (vals.every(v => v === 0)) {   // a run of zero blocks, within its interval and its 64-block segment
        const cap = Math.min(blocks.length - b, 64 - (b % 64));
        let run = 1; while (run < cap && blocks[b + run].every(v => v === 0)) run++;
        put(0, idLen); put(0, 1); if (ref) put(blk[0], bits);
        if (run === cap && run >= ROS) fs(ROS - 1);   // "the rest of the segment"
        else fs(run < ROS ? run - 1 : run);
        b += run - 1; continue;
      }
      let best = { k: 0, cost: Infinity };   // with a 1-bit option id (restricted, 1 or 2 bits) there is no split option
      for (let k = 0; k < UNCOMP - 1; k++) { const cost = vals.reduce((a, v) => a + Math.floor(v / 2 ** k) + 1 + k, 0); if (cost < best.cost) best = { k, cost }; }
      let seCost = 0;
      for (let i = 0; i < J; i += 2) { const a = ref && i === 0 ? 0 : blk[i], c = blk[i + 1], sum = a + c; seCost += sum > 12 ? Infinity : sum * (sum + 1) / 2 + c + 1; }
      if (seCost < best.cost && seCost < J * bits) {
        put(0, idLen); put(1, 1); if (ref) put(blk[0], bits);
        for (let i = 0; i < J; i += 2) { const a = ref && i === 0 ? null : blk[i], c = blk[i + 1], sum = (a ?? 0) + c; fs(sum * (sum + 1) / 2 + c); }
      } else if (best.cost < J * bits) {
        put(best.k + 1, idLen); if (ref) put(blk[0], bits);
        for (const v of vals) fs(Math.floor(v / 2 ** best.k));
        if (best.k) for (const v of vals) put(v % 2 ** best.k, best.k);
      } else {
        put(UNCOMP, idLen); for (const v of blk) put(v, bits);
      }
    }
    if (flags & AEC.PAD_RSI && nb) { out.push(cur << (8 - nb)); cur = 0; nb = 0; }
  }
  if (nb) out.push(cur << (8 - nb));
  return { bytes: new Uint8Array(out), n };
}
