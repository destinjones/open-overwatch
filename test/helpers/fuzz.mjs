// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Test helper (no tests of its own): the fuzz and property tests of the decoders that read untrusted upstream bytes
// (test/fuzz.test.mjs runs each target here in a worker, so a hang can be stopped and named). A seeded PRNG, byte and
// text mutators, and per decoder: valid seeds, what a well-formed result looks like, and properties (round trips).
// Every case comes from (seed, case number) alone, so a failure is replayed with OO_FUZZ_SEED and the case it names.
import fs from 'node:fs';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { decodeGrib2, parseIdx, MAX_POINTS } from '../../src/core/grib2.js';
import { aecDecode, aecEncode, AEC } from '../../src/core/aec.js';
import { jpxDecode, decodeBlock, synth } from '../../src/core/jpx.js';
import { decodeTile, geometry } from '../../src/core/mvt.js';
import { parseVehiclePositions, encodeVehiclePositions } from '../../src/core/gtfsrt.js';
import { parseMetar, parseTaf, metarWords, tafWords, tafWorst, tafAt, CATEGORIES } from '../../src/core/metar.js';
import { mqtt } from '../../src/core/transit.js';
import { parseTle } from '../../src/core/tle.js';
import { parseSocrates } from '../../src/core/socrates.js';
import { parseNdbcLatest, parseDart } from '../../src/core/ocean.js';
import { parseEcIndex } from '../../src/core/wxmodels.js';
import { encodeView, decodeView } from '../../src/core/viewlink.js';
import { message } from './grib2.mjs';
import { layer, tile } from './mvt.mjs';

const FIX = new URL('../fixtures/', import.meta.url);
const fixture = name => new Uint8Array(fs.readFileSync(new URL(name, FIX)));
const fixtureText = name => fs.readFileSync(new URL(name, FIX), 'utf8');

// ---- the PRNG (mulberry32) and the case seeds
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = n => Math.floor(next() * n);
  return { next, int, pick: a => a[int(a.length)], chance: p => next() < p, range: (lo, hi) => lo + int(hi - lo + 1) };
}
/** The seed of case i: every case can be made again on its own. */
export const caseSeed = (seed, i) => (Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) + Math.imul(i + 1, 0xc2b2ae35)) >>> 0;

// ---- mutations
const BIG = [0, 1, 2, 0x7f, 0x80, 0xff, 0x7fff, 0x8000, 0xffff, 0x7fffffff, 0x80000000, 0xffffffff];
/** 1-4 random edits of a copy of `src`: bit flips, odd bytes, huge or zero 16/32-bit fields, cuts, inserts, repeats.
 *  Half of the offsets land in the first `hot` bytes, where the headers and lengths live. Returns [bytes, what]. */
export function mutateBytes(src, r, hot = 256) {
  let b = Uint8Array.from(src); const what = [];
  const at = () => (b.length ? (r.chance(0.5) ? r.int(Math.min(b.length, hot)) : r.int(b.length)) : 0);
  for (let k = r.range(1, 4); k > 0; k--) {
    const op = r.int(9), p = at();
    if (op === 0 && b.length) { const n = r.range(1, 8); for (let i = 0; i < n; i++) { const q = r.chance(0.5) ? p : at(); b[q] ^= 1 << r.int(8); } what.push(`flip${n}@${p}`); }
    else if (op === 1 && b.length) { b[p] = r.pick([0, 0xff, 0x80, 0x7f, r.int(256)]); what.push(`byte@${p}`); }
    else if (op === 2 && b.length >= 4) { const v = r.pick(BIG), w = r.chance(0.5) ? 2 : 4, q = Math.min(p, b.length - w); for (let i = 0; i < w; i++) b[q + i] = Math.floor(v / 256 ** (w - 1 - i)) & 255; what.push(`u${w * 8}=${v}@${q}`); }
    else if (op === 3) { const n = r.int(b.length + 1); b = b.slice(0, n); what.push(`cut@${n}`); }
    else if (op === 4) { const ins = Uint8Array.from({ length: r.range(1, 16) }, () => r.int(256)); b = cat(b.subarray(0, p), ins, b.subarray(p)); what.push(`insert${ins.length}@${p}`); }
    else if (op === 5 && b.length) { const n = r.range(1, Math.max(1, Math.min(64, b.length - p))); b = cat(b.subarray(0, p), b.subarray(p + n)); what.push(`delete${n}@${p}`); }
    else if (op === 6 && b.length) { const n = r.range(1, Math.min(256, b.length - p)), q = at(); b = cat(b.subarray(0, q), b.subarray(p, p + n), b.subarray(q)); what.push(`repeat${n}@${p}->${q}`); }
    else if (op === 7 && b.length) { const n = r.range(1, Math.min(32, b.length - p)); for (let i = 0; i < n; i++) b[p + i] = r.int(256); what.push(`garbage${n}@${p}`); }
    else if (op === 8 && b.length) { const n = r.range(1, Math.min(16, b.length - p)); b.fill(r.pick([0, 0xff]), p, p + n); what.push(`fill${n}@${p}`); }
  }
  return [b, what.join(' ')];
}
const cat = (...parts) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };

/** Text edits by token and by character; `vocab` holds token templates where # is a random digit. Returns [text, what]. */
export function mutateText(src, r, vocab = []) {
  let s = String(src); const what = [];
  const fill = t => t.replace(/#/g, () => String(r.int(10)));
  for (let k = r.range(1, 4); k > 0; k--) {
    const toks = s.split(' '), i = r.int(toks.length), op = r.int(10);
    if (op === 0) { toks.splice(i, 1); what.push('drop' + i); }
    else if (op === 1 && vocab.length) { toks.splice(i, 0, fill(r.pick(vocab))); what.push('add' + i); }
    else if (op === 2 && vocab.length) { toks[i] = fill(r.pick(vocab)); what.push('swap' + i); }
    else if (op === 3) { toks[i] = (toks[i] || '').replace(/\d/g, () => (r.chance(0.3) ? r.pick(['9', '0', '/']) : String(r.int(10)))); what.push('digits' + i); }
    else if (op === 4) { toks.splice(i, 0, toks[r.int(toks.length)]); what.push('dup' + i); }
    else if (op === 5) { const j = r.int(toks.length); [toks[i], toks[j]] = [toks[j], toks[i]]; what.push('move' + i); }
    else if (op === 6) { const c = r.int(s.length + 1); s = s.slice(0, c) + r.pick(['/', ' ', 'M', 'P', '9', '0', '\u0000', 'é', '\n', '=', '-', '+', 'Z', ',', '"', ':', '{']) + s.slice(c); what.push('char' + c); continue; }
    else if (op === 7) { const c = r.int(s.length + 1); s = s.slice(0, c); what.push('cut' + c); continue; }
    else if (op === 8) { toks[i] = r.pick(['9', '0', 'A', '/']).repeat(r.range(5, 400)); what.push('long' + i); }
    else { const c = r.int(s.length), n = r.range(1, 8); s = s.slice(0, c) + s.slice(c + n); what.push('erase' + c); continue; }
    s = toks.join(' ');
  }
  return [s, what.join(' ')];
}

// ---- checks
/** Every number in `v` (objects, arrays, typed arrays) is finite; `nanOk` lets typed arrays hold NaN. Returns a path or null. */
export function nonFinite(v, path = '', nanOk = false, depth = 0) {
  if (depth > 12 || v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} = ${v}`;
  if (ArrayBuffer.isView(v)) { for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i]) && !(nanOk && Number.isNaN(v[i]))) return `${path}[${i}] = ${v[i]}`; return null; }
  if (typeof v === 'object') for (const [k, x] of Object.entries(v)) { const bad = nonFinite(x, path + '.' + k, nanOk, depth + 1); if (bad) return bad; }
  return null;
}
const words = (list, path) => { for (const [i, w] of (list || []).entries()) { const t = typeof w === 'string' ? w : w?.text; if (typeof t !== 'string') return `${path}[${i}] is not text`; if (/NaN|undefined|Infinity|\[object/.test(t)) return `${path}[${i}]: ${t}`; } return null; };
const first = (...xs) => xs.find(Boolean) || null;
const isInt = (v, lo = -Infinity, hi = Infinity) => Number.isInteger(v) && v >= lo && v <= hi;

/** A typed array allocation over this many elements is a decoder believing a corrupt length (the largest real field,
 *  core/grib2.js MAX_POINTS, is half this). */
export const ALLOC_LIMIT = 2 ** 25;
export class AbsurdAllocation extends Error {}
/** In the fuzz worker only: typed array constructors refuse absurd lengths, so a decoder that would allocate them is caught
 *  even where the allocation itself would have succeeded (lazily zeroed memory makes a gigabyte cheap to ask for). */
export function guardAllocations() {
  for (const name of ['Float64Array', 'Float32Array', 'Int32Array', 'Uint32Array', 'Uint16Array', 'Int16Array', 'Uint8Array', 'Int8Array']) {
    const T = globalThis[name];
    globalThis[name] = new Proxy(T, { construct(t, args, nt) { if (typeof args[0] === 'number' && args[0] > ALLOC_LIMIT) throw new AbsurdAllocation(`new ${name}(${args[0]})`); return Reflect.construct(t, args, nt === globalThis[name] ? t : nt); } });
  }
}

// ---- GRIB2 sections, to cut the packed streams out of the real fixtures
function sections(b) {
  const u32 = p => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3], out = {};
  for (let q = 16; q + 5 < b.length && u32(q) && !(b[q] === 0x37 && b[q + 1] === 0x37); q += u32(q)) out[b[q + 4]] = [q, u32(q)];
  return { out, u32 };
}
const WX = ['ccsds', 'ccsds-bitmap', 'jpeg', 'jpeg-bitmap', 'jpeg-lossy'].map(n => fixture('wx/' + n + '.grib2'));
function aecSeedFromGrib(b) {
  const { out: s, u32 } = sections(b), [q5] = s[5], [q7, l7] = s[7];
  return { bytes: b.slice(q7 + 5, q7 + l7), opts: { n: u32(q5 + 5), bits: b[q5 + 19], flags: b[q5 + 21], blockSize: b[q5 + 22], rsi: (b[q5 + 23] << 8) | b[q5 + 24] } };
}
const jpxSeedFromGrib = b => { const { out: s } = sections(b), [q7, l7] = s[7]; return b.slice(q7 + 5, q7 + l7); };

const NOW_WX = Date.UTC(2026, 9, 13, 15);   // when the AWC fixtures were fetched
const DAY = 864e5;

// ---- the targets: seeds (valid inputs), run, check (null when the result is well formed), mutate, properties
const samplesFor = (r, n, bits) => {   // smooth, noisy, constant, zero runs or the extremes
  const max = 2 ** bits - 1, kind = r.int(5), base = r.int(max + 1);
  return Array.from({ length: n }, (_, i) => kind === 0 ? Math.min(max, Math.max(0, Math.round(base + Math.sin(i / 7) * max / 8))) : kind === 1 ? r.int(max + 1)
    : kind === 2 ? base : kind === 3 ? (r.chance(0.9) ? 0 : r.int(max + 1)) : r.pick([0, max]));
};
const aecOpts = r => ({ bits: r.pick([1, 2, 3, 4, 7, 8, 12, 16, 17, 24, 31, 32]), blockSize: r.pick([8, 16, 32, 64]), rsi: r.pick([1, 2, 3, 16, 128]), flags: r.pick([0, AEC.PREPROCESS, AEC.PREPROCESS | AEC.PAD_RSI, AEC.PAD_RSI, AEC.RESTRICTED, AEC.PREPROCESS | AEC.RESTRICTED]) });

function randomFeatures(r, extent) {
  const pt = () => [r.range(-64, extent + 64), r.range(-64, extent + 64)], feats = [];
  for (let i = r.range(1, 6); i > 0; i--) {
    const type = r.range(1, 3), n = r.range(1, 3), parts = [];
    for (let k = 0; k < n; k++) parts.push(type === 1 ? pt() : Array.from({ length: r.range(type === 2 ? 2 : 3, 8) }, pt));
    feats.push({ type, parts: type === 1 ? parts : parts, props: r.chance(0.7) ? { name: 'n' + r.int(5), h: r.int(300), f: r.int(1000) / 8, neg: -r.range(1, 99), ok: r.chance(0.5) } : {} });
  }
  return feats;
}
const randomVehicles = r => Array.from({ length: r.range(1, 6) }, (_, i) => ({ vehicleId: 'v' + r.int(1000), label: r.chance(0.5) ? 'L' + i : '', tripId: r.chance(0.7) ? 't' + r.int(99) : '', routeId: r.chance(0.7) ? 'r' + r.int(9) : '',
  dir: r.chance(0.5) ? r.int(2) : null, lat: (r.next() * 178 - 89) || 1, lon: (r.next() * 358 - 179) || 1, hdg: r.chance(0.5) ? r.int(360) : null, spd: r.chance(0.5) ? r.int(300) / 10 : null,
  status: r.chance(0.5) ? r.int(3) : null, t: r.chance(0.7) ? 1791900000000 + r.int(3600) * 1000 : null, stop: r.chance(0.5) ? 's' + r.int(50) : '', occupancy: r.chance(0.3) ? r.int(9) : null }));

/** A well-formed METAR from random parts, and what it says. */
function randomMetar(r) {
  const pad = (v, n) => String(v).padStart(n, '0'), want = {};
  const day = r.range(1, 28), hh = r.range(0, 23), mm = r.range(0, 59), toks = ['METAR', 'K' + 'ABC'[r.int(3)] + 'X' + r.int(10), pad(day, 2) + pad(hh, 2) + pad(mm, 2) + 'Z'];
  const dir = r.range(1, 36) * 10, spd = r.range(1, 60), gust = r.chance(0.3) ? spd + r.range(5, 30) : null;
  toks.push(pad(dir, 3) + pad(spd, 2) + (gust ? 'G' + pad(gust, 2) : '') + 'KT'); Object.assign(want, { dir, spd, gust });
  if (r.chance(0.5)) { const m = r.pick([200, 800, 1500, 4000, 9999]); toks.push(pad(m, 4)); want.visM = m === 9999 ? 10000 : m; }
  else { const sm = r.pick(['1/4', '1/2', '3/4', '1', '3', '10']); toks.push(sm + 'SM'); want.visSM = sm.includes('/') ? +sm[0] / +sm.slice(2) : +sm; }
  want.clouds = [];
  for (let i = r.int(4), base = 0; i > 0; i--) { base += r.range(1, 50); const c = r.pick(['FEW', 'SCT', 'BKN', 'OVC']); toks.push(c + pad(base, 3)); want.clouds.push([c, base * 100]); }
  const t = r.range(-40, 45), d = t - r.range(0, 20), T = v => (v < 0 ? 'M' : '') + pad(Math.abs(v), 2);
  toks.push(T(t) + '/' + T(d)); Object.assign(want, { t, d });
  if (r.chance(0.5)) { const q = r.range(950, 1050); toks.push('Q' + q); want.q = q; } else { const a = r.range(2800, 3100); toks.push('A' + a); want.a = a / 100; }
  return { text: toks.join(' '), want, time: Date.UTC(2026, 9, day, hh, mm) };
}
const METAR_VOCAB = ['#####KT', '###%%G##KT'.replace(/%/g, '#'), 'VRB##KT', '#####G###MPS', '###//KT', '/////KT', '#####KMH', '####', '####NE', '#/#SM', 'P#SM', 'M#/#SM', '#', '#/##SM', '##SM', 'R##L/####V####FT/U',
  'R##/P####', 'R##/######', 'FEW###', 'BKN###CB', 'OVC///', 'SCT###TCU', 'VV###', 'VV///', 'M##/M##', '##/', '//', 'A####', 'Q####', 'Q###', '-SHRA', '+TSRAGR', 'VCFG', 'RERA', 'NOSIG', 'TEMPO', 'BECMG',
  'FM######', 'PROB##', '####/####', 'TX##/####Z', 'TNM##/####Z', 'CAVOK', 'NSW', 'WS', 'ALL', 'RMK', 'T########', 'SLP###', 'PK', 'WND', '#####/####', 'AO2', '######Z', 'AUTO', 'COR', 'NIL', '9999',
  '###V###', 'WS###/#####KT', 'INTER', 'CLR', 'SKC', 'NSC', '$', 'TAF', 'AMD', 'SPECI', 'K###', 'QNH####INS'];

function mqttStream(r) {
  const parts = [], want = [];
  const pkt = (type, body) => { const len = []; let n = body.length; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; len.push(b); } while (n); return Uint8Array.from([type, ...len, ...body]); };
  for (let i = r.range(1, 6); i > 0; i--) {
    const k = r.int(4);
    if (k === 0) { parts.push(pkt(0x20, [0, 0])); want.push({ type: 2, code: 0 }); }
    else if (k === 1) { parts.push(pkt(0xd0, [])); want.push({ type: 13 }); }
    else { const topic = '/hfp/v2/journey/ongoing/vp/bus/' + r.int(99), payload = '{"VP":{"lat":60.' + r.int(999) + '}}' + 'x'.repeat(r.chance(0.2) ? 300 : 0), te = new TextEncoder();
      const tb = te.encode(topic); parts.push(pkt(0x30, [tb.length >> 8, tb.length & 255, ...tb, ...te.encode(payload)])); want.push({ type: 3, topic, payload }); }
  }
  return { bytes: cat(...parts), want };
}
const feedMqtt = (bytes, cuts) => { const read = mqtt.reader(), out = []; let p = 0; for (const c of [...cuts, bytes.length]) { if (c > p) out.push(...read(bytes.slice(p, c))); p = Math.max(p, c); } return out; };
const cutsFor = (r, n) => Array.from({ length: r.int(5) }, () => r.int(n + 1)).sort((a, b) => a - b);

export const TARGETS = {
  grib2: {
    about: 'GRIB2 messages: the real ECMWF/NOAA fixtures and small simple, complex (5.2, 5.3 order 1 and 2) and bitmap ones',
    seeds() {
      const ints = n => Array.from({ length: n }, (_, i) => (i * 37) % 101);
      return [...WX, ...[
        message({ ni: 4, nj: 3, ints: ints(12), R: 100.5, E: -1, D: 1 }),
        message({ ni: 37, nj: 1, ints: ints(37), R: -20, tmpl: 3, order: 1, group: 5 }),
        message({ ni: 37, nj: 1, ints: ints(37), tmpl: 3, order: 2, group: 5 }),
        message({ ni: 5, nj: 4, ints: ints(20), tmpl: 2, group: 3 }),
        message({ ni: 3, nj: 2, ints: [1, 2, 3, 4], bitmap: [1, 0, 1, 1, 0, 1] }),
        [...message({ ni: 2, nj: 2, ints: [0, 0, 0, 0] }), ...message({ ni: 3, nj: 1, ints: [5, 6, 7], hours: 9 })],
      ].map(m => Uint8Array.from(m))];
    },
    iterations: 1200, sweep: 4096,
    run: b => decodeGrib2(b),
    check(res) {
      if (!Array.isArray(res)) return 'not a list';
      for (const [i, m] of res.entries()) {
        const g = m.grid;
        if (!isInt(g.ni, 1) || !isInt(g.nj, 1) || g.ni * g.nj > MAX_POINTS) return `message ${i}: grid ${g.ni} × ${g.nj}`;
        if (!(m.values instanceof Float32Array) || m.values.length !== g.ni * g.nj) return `message ${i}: ${m.values?.length} values for ${g.ni * g.nj} points`;
        const bad = first(nonFinite(g, 'grid'), nonFinite(m.hours, 'hours'), nonFinite(m.values, 'values', true)); if (bad) return `message ${i}: ${bad}`;
      }
      return null;
    },
  },
  aec: {
    about: 'CCSDS 121.0 streams: the real ECMWF section 7s and random fields through the encoder, with their parameters mutated too',
    seeds() {
      const r = rng(42), out = WX.slice(0, 2).map(aecSeedFromGrib);
      for (let i = 0; i < 12; i++) { const o = aecOpts(r), n = r.range(1, 700), s = samplesFor(r, n, o.bits); out.push({ bytes: aecEncode(s, o).bytes, opts: { ...o, n } }); }
      return out;
    },
    iterations: 600, sweep: 2048,
    run: ({ bytes, opts }) => aecDecode(bytes, opts),
    mutate(seed, r) {
      if (r.chance(0.7)) { const [bytes, what] = mutateBytes(seed.bytes, r, 64); return [{ bytes, opts: seed.opts }, what]; }
      const opts = { ...seed.opts }, k = r.pick(['n', 'bits', 'blockSize', 'rsi', 'flags']);
      opts[k] = k === 'n' ? r.pick([0, 1, opts.n + 1, opts.n * 64, 2 ** 31, 2 ** 40, -1, 1.5]) : k === 'bits' ? r.pick([0, 1, 33, 64, opts.bits + 1, NaN]) : k === 'blockSize' ? r.pick([0, 1, 7, 8, 64, 65, 4096]) : k === 'rsi' ? r.pick([0, 1, 4096, 4097, 1e9]) : r.int(64);
      return [{ bytes: seed.bytes, opts }, `${k}=${opts[k]}`];
    },
    truncate: (seed, n) => ({ bytes: seed.bytes.slice(0, n), opts: seed.opts }),
    size: seed => seed.bytes.length,
    check(res, { opts }) {
      if (!(res instanceof Float64Array) || res.length !== opts.n) return `${res?.length} samples for ${opts.n}`;
      const signed = opts.flags & AEC.SIGNED, lo = signed ? -(2 ** (opts.bits - 1)) : 0, hi = signed ? 2 ** (opts.bits - 1) - 1 : 2 ** opts.bits - 1;
      for (let i = 0; i < res.length; i++) if (!Number.isInteger(res[i]) || res[i] < lo || res[i] > hi) return `sample ${i} = ${res[i]} outside ${lo}..${hi}`;
      return null;
    },
    property(r) {   // what the encoder writes comes back exactly, for every option, size and kind of field
      const o = aecOpts(r), n = r.range(1, 900), s = samplesFor(r, n, o.bits), { bytes } = aecEncode(s, o), got = aecDecode(bytes, { ...o, n });
      for (let i = 0; i < n; i++) if (got[i] !== s[i]) return `round trip ${JSON.stringify(o)} n ${n}: sample ${i} ${got[i]} vs ${s[i]}`;
      return null;
    },
  },
  jpx: {
    about: 'JPEG 2000 codestreams: the three real WAVEWATCH III / eccodes fields (5/3 and 9/7, with and without a bitmap)',
    seeds: () => WX.slice(2).map(jpxSeedFromGrib),
    iterations: 600, sweep: 200,
    run: b => jpxDecode(b, { maxSamples: 2 * 7000 + 64 }),   // as core/grib2.js calls it for these fields (under 7,000 values)
    check(res) {
      if (!isInt(res.width, 1) || !isInt(res.height, 1) || res.width * res.height > MAX_POINTS) return `an image of ${res.width} × ${res.height}`;
      if (!(res.data instanceof Float64Array) || res.data.length !== res.width * res.height) return `${res.data?.length} samples for ${res.width} × ${res.height}`;
      return nonFinite(res.data, 'data');
    },
  },
  'jpx-block': {
    about: 'one JPEG 2000 code-block from random bytes and random sizes, passes, bit planes; and the 1D wavelet',
    seeds: () => [{ data: Uint8Array.of(0x55, 0xaa, 0xff, 0xff), o: { w: 4, h: 4, band: 0, passes: 3, planes: 2, reversible: true } }],
    iterations: 2000, sweep: 0,
    mutate(_, r) {
      const w = r.range(1, 64), h = r.range(1, 64), data = cat(Uint8Array.from({ length: r.int(300) }, () => (r.chance(0.1) ? 0xff : r.int(256))), Uint8Array.of(0xff, 0xff));
      const o = { w, h, band: r.int(4), passes: r.int(120), planes: r.range(-2, 40), reversible: r.chance(0.5) };
      return [{ data, o }, JSON.stringify(o)];
    },
    run({ data, o }) {
      const v = decodeBlock(data, o), line = Float64Array.from({ length: o.w + 8 }, (_, i) => v[i % v.length] * 1e3);
      synth(line, o.w, o.h, o.reversible);
      return { v, line };
    },
    check: ({ v, line }, { o }) => (v.length !== o.w * o.h ? `${v.length} values for ${o.w} × ${o.h}` : first(nonFinite(v, 'block'), nonFinite(line, 'synth'))),
  },
  mvt: {
    about: 'Mapbox vector tiles made by test/helpers/mvt.mjs: points, lines, polygons, every value type',
    seeds() { const r = rng(7); return Array.from({ length: 6 }, (_, i) => tile([layer('roads', randomFeatures(r, 4096)), layer('water' + i, randomFeatures(r, 512), 512)])); },
    iterations: 3000, sweep: 4096,
    run: b => ({ all: decodeTile(b), roads: decodeTile(b, ['roads']) }),
    check(res) {
      for (const [name, L] of Object.entries(res.all)) {
        if (!(L.extent > 0) || !Number.isFinite(L.extent)) return `${name}: extent ${L.extent}`;
        for (const [i, f] of L.features.entries()) {
          if (f.id != null && !Number.isFinite(f.id)) return `${name}[${i}].id = ${f.id}`;
          if (!Number.isFinite(f.type)) return `${name}[${i}].type = ${f.type}`;
          for (const [k, v] of Object.entries(f.props)) if (!(v == null || typeof v === 'string' || typeof v === 'boolean' || Number.isFinite(v))) return `${name}[${i}].props.${k} = ${v}`;
          for (const p of f.parts) if (p.length % 2 || p.some(x => !Number.isFinite(x))) return `${name}[${i}]: a part ${JSON.stringify(p.slice(0, 6))}`;
        }
      }
      return null;
    },
    property(r) {   // features in the tile and its 64-unit buffer come back exactly, rings closed on their first point
      const extent = r.pick([256, 512, 4096]), feats = randomFeatures(r, extent), got = decodeTile(tile([layer('l', feats, extent)])).l;
      if (got.extent !== extent || got.features.length !== feats.length) return 'layer';
      for (const [i, f] of feats.entries()) {
        const parts = f.type === 1 ? [f.parts.flat()] : f.parts.map(pts => [...pts.flat(), ...(f.type === 3 ? pts[0] : [])]);
        const g = got.features[i], flat = f.type === 1 ? [g.parts.flat()] : g.parts;
        if (JSON.stringify(flat) !== JSON.stringify(parts)) return `feature ${i}: ${JSON.stringify(flat)} vs ${JSON.stringify(parts)}`;
        if (flat.flat().some(x => x < -64 || x > extent + 64)) return `feature ${i} left the tile's buffer`;
        if (JSON.stringify(g.props) !== JSON.stringify(f.props)) return `feature ${i} props ${JSON.stringify(g.props)}`;
      }
      return null;
    },
  },
  gtfsrt: {
    about: 'GTFS-realtime FeedMessages made by core/gtfsrt.js encodeVehiclePositions',
    seeds() { const r = rng(9); return Array.from({ length: 6 }, () => encodeVehiclePositions({ t: 1791900000000, vehicles: randomVehicles(r) })); },
    iterations: 3000, sweep: 4096,
    run: b => parseVehiclePositions(b),
    check(res) {
      if (res.t != null && !Number.isFinite(res.t)) return 't = ' + res.t;
      for (const [i, v] of res.vehicles.entries()) {
        if (!(Math.abs(v.lat) <= 90 && Math.abs(v.lon) <= 180)) return `vehicle ${i} at ${v.lat}, ${v.lon}`;
        for (const k of ['t', 'spd', 'hdg', 'dir', 'status', 'occupancy']) if (v[k] != null && !Number.isFinite(v[k])) return `vehicle ${i}.${k} = ${v[k]}`;
        for (const k of ['id', 'tripId', 'routeId', 'vehicleId', 'label', 'plate', 'stop']) if (typeof v[k] !== 'string') return `vehicle ${i}.${k} is ${typeof v[k]}`;
      }
      return null;
    },
    property(r) {
      const vehicles = randomVehicles(r), got = parseVehiclePositions(encodeVehiclePositions({ t: 1791900000000, vehicles })).vehicles, f = Math.fround;
      if (got.length !== vehicles.length) return `${got.length} of ${vehicles.length} vehicles`;
      for (const [i, v] of vehicles.entries()) {
        const g = got[i];
        if (g.lat !== f(v.lat) || g.lon !== f(v.lon) || g.vehicleId !== v.vehicleId || g.tripId !== v.tripId || g.routeId !== v.routeId || g.status !== v.status || g.occupancy !== v.occupancy
          || g.hdg !== (v.hdg == null ? null : f(v.hdg)) || g.spd !== (v.spd == null ? null : f(v.spd)) || g.t !== (v.t ?? 1791900000000) || g.dir !== v.dir || g.stop !== v.stop) return `vehicle ${i}: ${JSON.stringify(g)} vs ${JSON.stringify(v)}`;
      }
      return null;
    },
  },
  metar: {
    about: "METARs: AWC's 2026-10-13 answers and generated ones, mutated by token and character",
    text: true, mustNotThrow: true,
    seeds: () => [...JSON.parse(fixtureText('awc-metar.json')).metars.map(m => m.rawOb), ...Array.from({ length: 20 }, (_, i) => randomMetar(rng(100 + i)).text)],
    iterations: 6000,
    mutate: (s, r) => mutateText(s, r, METAR_VOCAB),
    run: s => { const r = parseMetar(s, { now: NOW_WX }); return { r, words: metarWords(r) }; },
    check({ r, words: w }) {
      if (!r) return null;
      const bad = first(nonFinite(r, 'report'), words(w, 'words'));
      if (bad) return bad;
      if (r.time != null && Math.abs(r.time - NOW_WX) > 35 * DAY) return 'time ' + new Date(r.time).toISOString();
      if (r.wind && (r.wind.dir != null && !(r.wind.dir >= 0 && r.wind.dir <= 360) || r.wind.speedKt != null && !(r.wind.speedKt >= 0))) return 'wind ' + JSON.stringify(r.wind);
      if (r.windVar && r.windVar.some(d => !(d >= 0 && d <= 360))) return 'wind range ' + r.windVar;
      if (r.visSM != null && !(r.visSM >= 0)) return 'visibility ' + r.visSM;
      if (r.clouds.some(c => c.baseFt != null && !(c.baseFt >= 0 && c.baseFt <= 99900))) return 'clouds ' + JSON.stringify(r.clouds);
      if (r.category != null && !CATEGORIES.includes(r.category)) return 'category ' + r.category;
      return null;
    },
    property(r) {   // a generated report reads back as written
      const { text, want, time } = randomMetar(r), m = parseMetar(text, { now: time + 600e3 });
      const vis = want.visM != null ? Math.abs(m.visM - want.visM) < 1e-9 : Math.abs(m.visSM - want.visSM) < 1e-9;
      const ok = m && m.time === time && m.wind?.dir === want.dir && m.wind?.speedKt === want.spd && m.wind?.gustKt === want.gust && vis && m.tempC === want.t && m.dewC === want.d
        && JSON.stringify(m.clouds.map(c => [c.cover, c.baseFt])) === JSON.stringify(want.clouds) && (want.q ? m.altimHpa === want.q : m.altimInHg === want.a) && !m.unparsed.length;
      return ok ? null : `${text} -> ${JSON.stringify(m)}`;
    },
  },
  taf: {
    about: "TAFs: AWC's 2026-10-13 answers, mutated by token and character, read at several times",
    text: true, mustNotThrow: true,
    seeds: () => JSON.parse(fixtureText('awc-taf.json')).tafs.map(t => t.rawTAF),
    iterations: 3000,
    mutate: (s, r) => mutateText(s, r, METAR_VOCAB),
    run(s) {
      const t = parseTaf(s, { now: NOW_WX });
      return { t, words: tafWords(t, { now: NOW_WX }), worst: tafWorst(t, { now: NOW_WX }), at: [0, 6, 20].map(h => tafAt(t, NOW_WX + h * 3600e3)) };
    },
    check({ t, words: w, worst }) {
      if (!t) return null;
      const bad = first(nonFinite(t, 'taf'), words(w, 'words'));
      if (bad) return bad;
      for (const p of t.periods) for (const k of ['from', 'to']) if (p[k] != null && Math.abs(p[k] - NOW_WX) > 45 * DAY) return `period ${p.kind}.${k} ${new Date(p[k]).toISOString()}`;
      if (worst != null && !CATEGORIES.includes(worst)) return 'worst ' + worst;
      return null;
    },
  },
  mqtt: {
    about: "MQTT 3.1.1 packets (HSL's stream): CONNACK, PINGRESP and PUBLISH, split across WebSocket frames anywhere",
    seeds() { const r = rng(5); return Array.from({ length: 6 }, () => mqttStream(r).bytes); },
    iterations: 3000, sweep: 4096,
    run: b => feedMqtt(b, [b.length >> 2, b.length >> 1]),
    check(res) {
      for (const p of res) {
        if (!isInt(p.type, 0, 15)) return 'type ' + p.type;
        if (p.type === 3 && (typeof p.topic !== 'string' || typeof p.payload !== 'string')) return 'a PUBLISH without text';
      }
      return null;
    },
    property(r) {   // however the stream is cut into frames, the same packets come out
      const { bytes, want } = mqttStream(r), got = feedMqtt(bytes, cutsFor(r, bytes.length));
      return JSON.stringify(got) === JSON.stringify(want) ? null : `${JSON.stringify(got).slice(0, 300)} vs ${JSON.stringify(want).slice(0, 300)}`;
    },
  },
  text: {
    about: "the text feeds' parsers: NOAA .idx and ECMWF index lines, TLEs, SOCRATES CSV, NDBC latest_obs and DART files, view links",
    text: true,
    seeds: () => [
      ['idx', '581:34601144:d=2026101018:TMP:2 m above ground:6 hour fcst:\n582:34648279:d=2026101018:SPFH:2 m above ground:6 hour fcst:\n588:35006579:d=2026101018:UGRD:10 m above ground:anl:'],
      ['ec', '{"date": "20261011", "time": "0000", "levtype": "sfc", "step": "6", "param": "tp", "_offset": 0, "_length": 603934}\n{"date": "20261011", "time": "0000", "step": "6", "levtype": "pl", "levelist": "850", "param": "u", "_offset": 603934, "_length": 500}'],
      ['tle', fixtureText('stations.tle')], ['socrates', fixtureText('socrates-small.csv')], ['ndbc', fixtureText('ocean/ndbc-latest_obs.txt')], ['dart', fixtureText('ocean/ndbc-46404.dart')],
      ['view', '#' + encodeView({ lon: 12.5, lat: 41.9, height: 20000, heading: 10, pitch: -45, layers: ['quakes', 'sats'], weather: ['wind'], time: { jd: 2461326.5, rate: 60 }, country: 'IT', drawing: [{ kind: 'line', coords: [[12, 41], [13, 42]], name: 'a' }] })],
    ],
    iterations: 5000,
    mutate: ([k, s], r) => { const [t, what] = mutateText(s, r, ['#', '-#', '##.#', 'MM', '#:#', '9999.000', 'NaN', '1e999', '"_offset": -#', '"_length": 0', '1 #####U', '2 #####', ',', '\n', ':', '#=#']); return [[k, t], what]; },
    run([k, s]) {
      if (k === 'idx') return parseIdx(s);
      if (k === 'ec') return parseEcIndex(s);
      if (k === 'tle') return parseTle(s);
      if (k === 'socrates') { try { return parseSocrates(s); } catch (e) { if (/missing column/.test(e.message)) return []; throw e; } }   // a header without the columns is refused, as it should be
      if (k === 'ndbc') return parseNdbcLatest(s);
      if (k === 'dart') return parseDart(s);
      return decodeView(s);
    },
    mustNotThrow: true,
    check(res, [k]) {
      const bad = nonFinite(res, k);
      if (bad) return bad;
      if (k === 'idx' || k === 'ec') for (const row of res) if (!isInt(row.start, 0) || (row.end != null && !(isInt(row.end, 0) && row.end >= row.start))) return `${k}: bytes ${row.start}-${row.end}`;
      return null;
    },
  },
};

// ---- the runner (in the worker)
const preview = x => {
  if (x instanceof Uint8Array) return x.length <= 600 ? 'hex ' + Buffer.from(x).toString('hex') : `${x.length} bytes`;
  if (typeof x === 'string') return JSON.stringify(x.length <= 400 ? x : x.slice(0, 400) + '…');
  if (Array.isArray(x)) return x.map(preview).join(' ');
  if (x && x.bytes) return preview(x.bytes) + ' ' + JSON.stringify(x.opts);
  if (x && x.data) return preview(x.data) + ' ' + JSON.stringify(x.o);
  return JSON.stringify(x);
};

/**
 * Run one target: its seeds (which must decode cleanly), every truncation of the small ones, `iterations × scale`
 * mutated cases and as many property cases. Returns { cases, failures: [{ label, problem, input }], slowestMs, ms }.
 * `progress` (an Int32Array(3) on shared memory) gets [phase, a, b] before each call, for the parent to name a hang
 * (progressLabel).
 */
export function runTarget(name, { seed = 1, scale = 1, budgetMs = 250, progress = null, maxFailures = 8 } = {}) {
  const T = TARGETS[name], seeds = T.seeds(), failures = [], start = performance.now();
  let cases = 0, slowestMs = 0;
  const fail = (label, problem, input) => { if (failures.length < maxFailures) failures.push({ label, problem, input: preview(input) }); };
  const call = input => { let res, err; const t0 = performance.now(); try { res = T.run(input); } catch (e) { err = e; } return { res, err, ms: performance.now() - t0 }; };
  const mark = (phase, a, b = 0) => { if (progress) { Atomics.store(progress, 1, a); Atomics.store(progress, 2, b); Atomics.store(progress, 0, phase); } };
  const one = (input, label) => {
    cases++;
    let { res, err, ms } = call(input);
    if (ms > budgetMs) ms = Math.min(ms, call(input).ms);   // once more: a garbage collection is not the decoder's fault
    slowestMs = Math.max(slowestMs, ms);
    if (ms > budgetMs) fail(label, `took ${ms.toFixed(0)} ms (budget ${budgetMs})`, input);
    if (err) {
      if (err instanceof AbsurdAllocation) fail(label, 'allocated ' + err.message, input);
      else if (!(err instanceof Error)) fail(label, 'threw a non-Error: ' + String(err), input);
      else if (err instanceof RangeError && /allocation|array length|Invalid typed array|Maximum call stack/i.test(err.message)) fail(label, 'RangeError: ' + err.message, input);
      else if (T.mustNotThrow) fail(label, 'threw ' + err.message, input);
      return;
    }
    let bad; try { bad = T.check(res, input); } catch (e) { bad = 'check threw ' + e.message; }
    if (bad) fail(label, bad, input);
  };
  // the seeds: valid, so no error at all
  seeds.forEach((s, i) => { mark(1, i); const { res, err } = call(s); cases++; if (err) fail('seed ' + i, 'a valid input threw ' + err.message, s); else { const bad = T.check(res, s); if (bad) fail('seed ' + i, bad, s); } });
  // every cut of the small seeds (spread over the first `sweep` bytes of big ones)
  if (!T.text && T.sweep) seeds.forEach((s, i) => {
    const len = T.size ? T.size(s) : s.length, step = Math.max(1, Math.ceil(Math.min(len, T.sweep) / (T.sweep * scale)));
    for (let n = 0; n < Math.min(len, T.sweep * scale); n += step) mark(2, i, n), one(T.truncate ? T.truncate(s, n) : s.slice(0, n), `seed ${i} cut at ${n}`);
  });
  // mutations
  const N = Math.round(T.iterations * scale);
  for (let i = 0; i < N; i++) {
    const r = rng(caseSeed(seed, i)), s = r.pick(seeds), [input, what] = T.mutate ? T.mutate(s, r) : mutateBytes(s, r);
    mark(3, i); one(input, `case ${i} (${what})`);
  }
  // properties
  if (T.property) for (let i = 0; i < Math.max(50, N / 4); i++) {
    mark(4, i); cases++;
    let bad; try { bad = T.property(rng(caseSeed(seed ^ 0x5bd1e995, i))); } catch (e) { bad = 'threw ' + e.message; }
    if (bad) fail(`property case ${i}`, bad, '');
  }
  return { cases, failures, slowestMs: Math.round(slowestMs), ms: Math.round(performance.now() - start) };
}

/** What [phase, a, b] from runTarget's progress names. */
export const progressLabel = ([phase, a, b]) => ['before the first case', `seed ${a}`, `seed ${a} cut at ${b}`, `case ${a}`, `property case ${a}`][phase] || '?';

if (!isMainThread && workerData?.ooFuzz) {
  guardAllocations();
  const { name, seed, scale, budgetMs, sab } = workerData;
  parentPort.postMessage(runTarget(name, { seed, scale, budgetMs, progress: new Int32Array(sab) }));
}
