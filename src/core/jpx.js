// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// JPEG 2000 codestreams, just enough for GRIB2 data template 5.40: one grey component, the way NCEP (JasPer) and ECMWF's
// eccodes (OpenJPEG) write model fields. NOAA's WAVEWATCH III wave model files are packed this way. Pure
// (test/jpx.test.mjs); checked against eccodes on real wave fields. Reference: ITU-T T.800 (ISO/IEC 15444-1).
//
// Covered: any number of tiles and tile-parts, layers, resolution levels and precinct sizes; LRCP, RLCP and RPCL
// progressions; the reversible 5/3 and irreversible 9/7 wavelets with their quantisation; SOP/EPH markers. Not covered
// (an error says so): several components, code-block styles other than the default (bypass, per-pass termination...),
// PCRL/CPRL progressions, region of interest. Speed matters (a 0.25° global field is a million samples): the bit-plane
// coder keeps each sample's neighbour counts as it goes instead of looking around every time.

const BAND = { LL: 0, HL: 1, LH: 2, HH: 3 };

// ---- the MQ arithmetic decoder (Annex C)
const QE = [[0x5601, 1, 1, 1], [0x3401, 2, 6, 0], [0x1801, 3, 9, 0], [0x0AC1, 4, 12, 0], [0x0521, 5, 29, 0], [0x0221, 38, 33, 0], [0x5601, 7, 6, 1], [0x5401, 8, 14, 0],
  [0x4801, 9, 14, 0], [0x3801, 10, 14, 0], [0x3001, 11, 17, 0], [0x2401, 12, 18, 0], [0x1C01, 13, 20, 0], [0x1601, 29, 21, 0], [0x5601, 15, 14, 1], [0x5401, 16, 14, 0],
  [0x5101, 17, 15, 0], [0x4801, 18, 16, 0], [0x3801, 19, 17, 0], [0x3401, 20, 18, 0], [0x3001, 21, 19, 0], [0x2801, 22, 19, 0], [0x2401, 23, 20, 0], [0x2201, 24, 21, 0],
  [0x1C01, 25, 22, 0], [0x1801, 26, 23, 0], [0x1601, 27, 24, 0], [0x1401, 28, 25, 0], [0x1201, 29, 26, 0], [0x1101, 30, 27, 0], [0x0AC1, 31, 28, 0], [0x09C1, 32, 29, 0],
  [0x08A1, 33, 30, 0], [0x0521, 34, 31, 0], [0x0441, 35, 32, 0], [0x02A1, 36, 33, 0], [0x0221, 37, 34, 0], [0x0141, 38, 35, 0], [0x0111, 39, 36, 0], [0x0085, 40, 37, 0],
  [0x0049, 41, 38, 0], [0x0025, 42, 39, 0], [0x0015, 43, 40, 0], [0x0009, 44, 41, 0], [0x0005, 45, 42, 0], [0x0001, 45, 43, 0], [0x5601, 46, 46, 0]];
const Q_QE = Uint16Array.from(QE, r => r[0]), Q_NMPS = Uint8Array.from(QE, r => r[1]), Q_NLPS = Uint8Array.from(QE, r => r[2]), Q_SW = Uint8Array.from(QE, r => r[3]);

class MQ {
  /** `d`: the code-block's bytes, already followed by 0xFF 0xFF (the end-of-data convention). */
  constructor(d) {
    this.d = d; this.bp = 0; this.chigh = d[0]; this.clow = 0; this.ct = 0;
    this.byteIn();
    this.chigh = ((this.chigh << 7) & 0xffff) | ((this.clow >> 9) & 0x7f);
    this.clow = (this.clow << 7) & 0xffff; this.ct -= 7; this.a = 0x8000;
  }
  byteIn() {
    const d = this.d;
    if (d[this.bp] === 0xff) {
      if (d[this.bp + 1] > 0x8f) { this.clow += 0xff00; this.ct = 8; }
      else { this.bp++; this.clow += d[this.bp] << 9; this.ct = 7; }
    } else { this.bp++; this.clow += (this.bp < d.length ? d[this.bp] : 0xff) << 8; this.ct = 8; }
    if (this.clow > 0xffff) { this.chigh += this.clow >> 16; this.clow &= 0xffff; }
  }
  /** One decision in context `cx` (cxs: Uint8Array of state index << 1 | mps). */
  bit(cxs, cx) {
    let i = cxs[cx] >> 1, mps = cxs[cx] & 1, d;
    const qe = Q_QE[i];
    let a = this.a - qe;
    if (this.chigh < qe) {
      if (a < qe) { a = qe; d = mps; i = Q_NMPS[i]; }
      else { a = qe; d = 1 ^ mps; if (Q_SW[i]) mps = d; i = Q_NLPS[i]; }
    } else {
      this.chigh -= qe;
      if (a & 0x8000) { this.a = a; return mps; }
      if (a < qe) { d = 1 ^ mps; if (Q_SW[i]) mps = d; i = Q_NLPS[i]; }
      else { d = mps; i = Q_NMPS[i]; }
    }
    do {
      if (this.ct === 0) this.byteIn();
      a <<= 1;
      this.chigh = ((this.chigh << 1) & 0xffff) | ((this.clow >> 15) & 1);
      this.clow = (this.clow << 1) & 0xffff; this.ct--;
    } while ((a & 0x8000) === 0);
    this.a = a; cxs[cx] = (i << 1) | mps;
    return d;
  }
}

// ---- tier 1: the bit-plane coder (Annex D), default code-block style
const CX_UNI = 17, CX_RL = 18;
/** Zero-coding context from the horizontal, vertical and diagonal significant-neighbour counts (Table D.1). */
const ZC = (() => {
  const t = new Uint8Array(4 * 3 * 3 * 5);   // [band][h][v][d]
  const lh = (h, v, d) => h === 2 ? 8 : h === 1 ? (v >= 1 ? 7 : d >= 1 ? 6 : 5) : v === 2 ? 4 : v === 1 ? 3 : d >= 2 ? 2 : d === 1 ? 1 : 0;
  const hh = (h, v, d) => { const hv = h + v; return d >= 3 ? 8 : d === 2 ? (hv >= 1 ? 7 : 6) : d === 1 ? (hv >= 2 ? 5 : hv === 1 ? 4 : 3) : hv >= 2 ? 2 : hv === 1 ? 1 : 0; };
  for (let b = 0; b < 4; b++) for (let h = 0; h < 3; h++) for (let v = 0; v < 3; v++) for (let d = 0; d < 5; d++)
    t[((b * 3 + h) * 3 + v) * 5 + d] = b === BAND.HH ? hh(h, v, d) : b === BAND.HL ? lh(v, h, d) : lh(h, v, d);
  return t;
})();

/**
 * Decode one code-block: `data` (its bytes from every layer, with two 0xFF after), `passes` coding passes, `planes`
 * magnitude bit planes (Mb minus the zero planes), w × h samples of subband `band`. Returns a Float64Array of the
 * signed values; where passes are missing (a stream cut short to save bytes), each value sits in the middle of what its
 * last decoded bit leaves open, as OpenJPEG reconstructs it. `reversible`: whole planes decoded are exact.
 */
export function decodeBlock(data, { w, h, band, passes, planes, reversible = true }) {
  if (planes > 31) throw new Error('jpx: ' + planes + ' bit planes');   // the magnitudes are 32-bit integers
  const n = w * h, mag = new Int32Array(n), sign = new Uint8Array(n), last = new Int8Array(n);
  const sig = new Uint8Array(n), coded = new Uint8Array(n), refined = new Uint8Array(n);
  const H = new Uint8Array(n), V = new Uint8Array(n), D = new Uint8Array(n), out = new Float64Array(n);
  if (!passes || planes <= 0) return out;
  const cxs = new Uint8Array(19); cxs[0] = 4 << 1; cxs[CX_UNI] = 46 << 1; cxs[CX_RL] = 3 << 1;
  const mq = new MQ(data), zcBase = band * 45;
  const becomeSig = (i, x, y) => {
    sig[i] = 1;
    const l = x > 0, r = x < w - 1, u = y > 0, dn = y < h - 1;
    if (l) H[i - 1]++; if (r) H[i + 1]++;
    if (u) { V[i - w]++; if (l) D[i - w - 1]++; if (r) D[i - w + 1]++; }
    if (dn) { V[i + w]++; if (l) D[i + w - 1]++; if (r) D[i + w + 1]++; }
  };
  const decodeSign = (i, x, y) => {   // Table D.3: neighbours' signs pick the context and whether to flip
    const c = (j, ok) => ok && sig[j] ? (sign[j] ? -1 : 1) : 0;
    const hc = Math.max(-1, Math.min(1, c(i - 1, x > 0) + c(i + 1, x < w - 1))), vc = Math.max(-1, Math.min(1, c(i - w, y > 0) + c(i + w, y < h - 1)));
    let cx, xr;
    if (hc === 1) { cx = vc === 1 ? 13 : vc === 0 ? 12 : 11; xr = 0; }
    else if (hc === 0) { cx = vc === 0 ? 9 : 10; xr = vc === -1 ? 1 : 0; }
    else { cx = vc === 1 ? 11 : vc === 0 ? 12 : 13; xr = 1; }
    sign[i] = mq.bit(cxs, cx) ^ xr;
  };
  const zc = i => ZC[zcBase + ((Math.min(H[i], 2) * 3 + Math.min(V[i], 2)) * 5) + Math.min(D[i], 4)];
  let plane = planes - 1, pass = 2;   // the first pass is a cleanup
  for (let p = 0; p < passes; p++) {
    const bit = 1 << plane;
    if (pass === 0) {   // significance propagation
      coded.fill(0);
      for (let y0 = 0; y0 < h; y0 += 4) for (let x = 0; x < w; x++) for (let y = y0; y < y0 + 4 && y < h; y++) {
        const i = y * w + x;
        if (sig[i] || !(H[i] | V[i] | D[i])) continue;
        coded[i] = 1;
        if (mq.bit(cxs, zc(i))) { decodeSign(i, x, y); mag[i] |= bit; last[i] = plane; becomeSig(i, x, y); }
      }
    } else if (pass === 1) {   // magnitude refinement
      for (let y0 = 0; y0 < h; y0 += 4) for (let x = 0; x < w; x++) for (let y = y0; y < y0 + 4 && y < h; y++) {
        const i = y * w + x;
        if (!sig[i] || coded[i]) continue;
        const cx = refined[i] ? 16 : (H[i] | V[i] | D[i]) ? 15 : 14;
        if (mq.bit(cxs, cx)) mag[i] |= bit;
        refined[i] = 1; last[i] = plane;
      }
    } else {   // cleanup
      for (let y0 = 0; y0 < h; y0 += 4) for (let x = 0; x < w; x++) {
        let y = y0;
        if (y0 + 3 < h) {   // run-length mode: four quiet samples in a column
          const i0 = y0 * w + x, i1 = i0 + w, i2 = i1 + w, i3 = i2 + w;
          if (!(sig[i0] | sig[i1] | sig[i2] | sig[i3] | coded[i0] | coded[i1] | coded[i2] | coded[i3] |
            H[i0] | V[i0] | D[i0] | H[i1] | V[i1] | D[i1] | H[i2] | V[i2] | D[i2] | H[i3] | V[i3] | D[i3])) {
            if (!mq.bit(cxs, CX_RL)) continue;
            const k = (mq.bit(cxs, CX_UNI) << 1) | mq.bit(cxs, CX_UNI);
            y = y0 + k; const i = y * w + x;
            decodeSign(i, x, y); mag[i] |= bit; last[i] = plane; becomeSig(i, x, y); y++;
          }
        }
        for (; y < y0 + 4 && y < h; y++) {
          const i = y * w + x;
          if (sig[i] || coded[i]) continue;
          if (mq.bit(cxs, zc(i))) { decodeSign(i, x, y); mag[i] |= bit; last[i] = plane; becomeSig(i, x, y); }
        }
      }
    }
    if (pass === 2) { if (p + 1 < passes) plane--; pass = 0; } else pass++;
    if (plane < 0) break;
  }
  for (let i = 0; i < n; i++) {
    if (!mag[i]) continue;
    const v = mag[i] + (last[i] > 0 ? 2 ** (last[i] - 1) : reversible ? 0 : 0.5);
    out[i] = sign[i] ? -v : v;
  }
  return out;
}

// ---- tier 2: packets
class TagTree {
  constructor(w, h) {
    this.levels = [];
    for (;;) { this.levels.push({ w, h, value: new Int32Array(w * h).fill(0x7fffffff), low: new Int32Array(w * h) }); if (w <= 1 && h <= 1) break; w = (w + 1) >> 1; h = (h + 1) >> 1; }
  }
  /** Is the leaf (x, y)'s value below `threshold`? Reads only the bits needed. */
  below(x, y, threshold, rd) {
    let low = 0;
    for (let l = this.levels.length - 1; l >= 0; l--) {
      const L = this.levels[l], k = (y >> l) * L.w + (x >> l);
      if (low > L.low[k]) L.low[k] = low; else low = L.low[k];
      while (low < threshold && low < L.value[k]) { if (rd.bit()) L.value[k] = low; else low++; }
      L.low[k] = low;
    }
    return this.levels[0].value[y * this.levels[0].w + x] < threshold;
  }
}
/** Packet-header bits: after an 0xFF byte the next byte carries only 7 (the stuffed zero). */
class HeaderBits {
  constructor(d, p) { this.d = d; this.p = p; this.n = 0; this.byte = 0; this.ff = false; }
  bit() {
    if (this.n === 0) {
      if (this.p >= this.d.length) throw new CutOff();   // past the end a tag tree would read zeros for ever
      this.byte = this.d[this.p++]; this.n = this.ff ? 7 : 8; this.ff = this.byte === 0xff;
    }
    return (this.byte >> --this.n) & 1;
  }
  read(k) { let v = 0; while (k--) v = v * 2 + this.bit(); return v; }
  align() { this.n = 0; if (this.ff) { this.p++; this.ff = false; } }
}

/** A packet header that runs past the data: a stream cut short, decoded up to there. */
class CutOff extends Error { constructor() { super('jpx: cut off'); } }

// ---- the codestream
const u16 = (b, p) => (b[p] << 8) | b[p + 1];
const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
/** The most samples an image may declare (GRIB2's own limit, core/grib2.js MAX_POINTS). */
const MAX_SAMPLES = 2 ** 24;

function readCod(b, p, into) {
  const s = b[p];
  into.precincts = !!(s & 1); into.sop = !!(s & 2); into.eph = !!(s & 4);
  into.progression = b[p + 1]; into.layers = u16(b, p + 2); into.mct = b[p + 4];
  readCoc(b, p + 5, into, s & 1);
}
function readCoc(b, p, into, userPrecincts) {
  into.levels = b[p]; into.xcb = (b[p + 1] & 15) + 2; into.ycb = (b[p + 2] & 15) + 2; into.style = b[p + 3]; into.reversible = b[p + 4] === 1;
  into.ppx = []; into.ppy = [];
  for (let r = 0; r <= into.levels; r++) { const v = userPrecincts ? b[p + 5 + r] : 0xff; into.ppx.push(v & 15); into.ppy.push(v >> 4); }
}
function readQcd(b, p, len, into) {
  const s = b[p], style = s & 31, guard = s >> 5, steps = [];
  if (style === 0) for (let i = 1; i < len; i++) steps.push({ eps: b[p + i] >> 3, mu: 0 });
  else for (let i = 1; i + 1 < len; i += 2) { const v = u16(b, p + i); steps.push({ eps: v >> 11, mu: v & 0x7ff }); }
  into.q = { style, guard, steps };
}
const stepFor = (q, k, levels) => {   // style 1 ("derived") sends only the LL step: the others follow from it
  if (q.style !== 1) return q.steps[k];
  const ll = q.steps[0], nb = k === 0 ? levels : levels - Math.floor((k - 1) / 3);
  return { eps: ll.eps - levels + nb, mu: ll.mu };
};

/**
 * Decode a JPEG 2000 codestream (Uint8Array starting with the SOC marker 0xFF4F) → { width, height, data: Float64Array
 * of the samples in raster order (integers for a reversible stream) }. `maxSamples`: the most the caller can use (GRIB2
 * knows its field's size), so a corrupt size is refused before a big image is decoded for nothing.
 */
export function jpxDecode(b, { maxSamples = MAX_SAMPLES } = {}) {
  if (u16(b, 0) !== 0xff4f) throw new Error('jpx: not a JPEG 2000 codestream');
  let p = 2, siz = null;
  const main = {}, tiles = new Map();
  /** @type {any} */ let tile = null;   // the tile part being read (its own COD/QCD), or null in the main header
  while (p < b.length) {
    const m = u16(b, p);
    if (m === 0xffd9) break;   // EOC
    const len = u16(b, p + 2), q = p + 4;
    if (m === 0xff51) {   // SIZ
      siz = { w: u32(b, q + 2), h: u32(b, q + 6), x0: u32(b, q + 10), y0: u32(b, q + 14), tw: u32(b, q + 18), th: u32(b, q + 22), tx0: u32(b, q + 26), ty0: u32(b, q + 30), comps: u16(b, q + 34),
        bits: (b[q + 36] & 0x7f) + 1, signed: !!(b[q + 36] & 0x80) };
      if (siz.comps !== 1) throw new Error('jpx: ' + siz.comps + ' components');
      const { w, h, x0, y0, tw, th, tx0, ty0 } = siz;   // T.800 A.5.1: the first tile holds the image's first sample
      if (!(w > x0 && h > y0 && tw && th && tx0 <= x0 && ty0 <= y0 && tx0 + tw > x0 && ty0 + th > y0) || (w - x0) * (h - y0) > Math.min(maxSamples, MAX_SAMPLES)) throw new Error(`jpx: an image of ${w} × ${h} in tiles of ${tw} × ${th}`);
      if (b[q + 37] !== 1 || b[q + 38] !== 1) throw new Error('jpx: subsampled component');
    } else if (m === 0xff52) readCod(b, q, tile ? tile.cod : main);
    else if (m === 0xff53) readCoc(b, q + 2, tile ? tile.cod : main, b[q + 1] & 1);
    else if (m === 0xff5c || m === 0xff5d) { const at = m === 0xff5d ? q + 1 : q; readQcd(b, at, len - 2 - (at - q), tile ? tile.cod : main); }
    else if (m === 0xff5e) throw new Error('jpx: region of interest');
    else if (m === 0xff90) {   // SOT: a tile-part; its header runs to SOD, its data to the end of Psot
      const idx = u16(b, q), psot = u32(b, q + 2);
      if (!tiles.has(idx)) tiles.set(idx, { idx, cod: null, parts: [] });
      tile = tiles.get(idx);
      if (!tile.cod) tile.cod = { ...main, q: main.q };
      let r = p + 2 + len;
      while (u16(b, r) !== 0xff93) {   // tile-part header markers
        if (r + 4 > b.length) throw new Error('jpx: a tile-part header with no SOD');   // past the end u16 reads 0: for ever
        const mm = u16(b, r), ll = u16(b, r + 2), qq = r + 4;
        if (mm === 0xff52) readCod(b, qq, tile.cod);
        else if (mm === 0xff53) readCoc(b, qq + 2, tile.cod, b[qq + 1] & 1);
        else if (mm === 0xff5c || mm === 0xff5d) { const at = mm === 0xff5d ? qq + 1 : qq; readQcd(b, at, ll - 2 - (at - qq), tile.cod); }
        else if (mm === 0xff5e) throw new Error('jpx: region of interest');
        r += 2 + ll;
      }
      const start = r + 2, end = psot ? p + psot : b.length - 2;
      tile.parts.push(b.subarray(start, end));
      p = end; tile = null; continue;
    }
    p += 2 + len;
  }
  if (!siz) throw new Error('jpx: no SIZ marker');
  const W = siz.w - siz.x0, Hh = siz.h - siz.y0, out = new Float64Array(W * Hh);
  const ntx = Math.ceil((siz.w - siz.tx0) / siz.tw), nty = Math.ceil((siz.h - siz.ty0) / siz.th);
  for (const t of tiles.values()) {
    const tx = t.idx % ntx, ty = Math.floor(t.idx / ntx);
    if (ty >= nty) continue;
    const x0 = Math.max(siz.tx0 + tx * siz.tw, siz.x0), x1 = Math.min(siz.tx0 + (tx + 1) * siz.tw, siz.w);
    const y0 = Math.max(siz.ty0 + ty * siz.th, siz.y0), y1 = Math.min(siz.ty0 + (ty + 1) * siz.th, siz.h);
    let data = t.parts[0];
    if (t.parts.length > 1) { data = new Uint8Array(t.parts.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of t.parts) { data.set(x, o); o += x.length; } }
    const pix = decodeTile(data, t.cod, siz, x0, y0, x1, y1);
    const shift = siz.signed ? 0 : 2 ** (siz.bits - 1);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[(y - siz.y0) * W + (x - siz.x0)] = pix[(y - y0) * (x1 - x0) + (x - x0)] + shift;
  }
  return { width: W, height: Hh, data: out };
}

/** One tile: packets → code-blocks → subbands → inverse wavelet. Returns the tile's samples (before the level shift). */
function decodeTile(data, cod, siz, tx0, ty0, tx1, ty1) {
  if (cod.levels == null || !cod.q) throw new Error('jpx: no COD or QCD marker');
  if (cod.style & 0x3f) throw new Error('jpx: code-block style ' + cod.style + ' is not supported');
  if (cod.mct) throw new Error('jpx: component transform');
  if (cod.levels > 32 || cod.xcb > 10 || cod.ycb > 10 || cod.xcb + cod.ycb > 12) throw new Error(`jpx: ${cod.levels} levels, code-blocks of 2^${cod.xcb} × 2^${cod.ycb}`);   // T.800 A.6.1
  if (cod.ppx.some((v, r) => r && !v) || cod.ppy.some((v, r) => r && !v)) throw new Error('jpx: a one-sample precinct above the lowest resolution');
  if (cod.progression > 2) throw new Error('jpx: progression order ' + cod.progression + ' is not supported');
  const NL = cod.levels, q = cod.q, ceilDiv = (a, k) => Math.ceil(a / 2 ** k);
  // resolutions, their bands, precincts and code-blocks
  const res = [];
  for (let r = 0; r <= NL; r++) {
    const s = NL - r, rx0 = ceilDiv(tx0, s), ry0 = ceilDiv(ty0, s), rx1 = ceilDiv(tx1, s), ry1 = ceilDiv(ty1, s);
    const ppx = cod.ppx[r], ppy = cod.ppy[r];
    const pw = rx1 > rx0 ? Math.ceil(rx1 / 2 ** ppx) - Math.floor(rx0 / 2 ** ppx) : 0, ph = ry1 > ry0 ? Math.ceil(ry1 / 2 ** ppy) - Math.floor(ry0 / 2 ** ppy) : 0;
    const xcb = Math.min(cod.xcb, r ? ppx - 1 : ppx), ycb = Math.min(cod.ycb, r ? ppy - 1 : ppy);
    const bands = (r ? [BAND.HL, BAND.LH, BAND.HH] : [BAND.LL]).map((type, j) => {
      const nb = r ? NL - r + 1 : NL, xo = type === BAND.HL || type === BAND.HH ? 1 : 0, yo = type === BAND.LH || type === BAND.HH ? 1 : 0;
      const bx0 = Math.ceil((tx0 - 2 ** (nb - 1) * xo) / 2 ** nb), by0 = Math.ceil((ty0 - 2 ** (nb - 1) * yo) / 2 ** nb);
      const bx1 = Math.ceil((tx1 - 2 ** (nb - 1) * xo) / 2 ** nb), by1 = Math.ceil((ty1 - 2 ** (nb - 1) * yo) / 2 ** nb);
      const k = r ? 1 + 3 * (r - 1) + j : 0, st = stepFor(q, k, NL);
      if (!st) throw new Error('jpx: no quantisation step for subband ' + k);
      const gain = type === BAND.LL ? 0 : type === BAND.HH ? 2 : 1;
      const Mb = q.guard + st.eps - 1, delta = cod.reversible ? 1 : 2 ** (siz.bits + gain - st.eps) * (1 + st.mu / 2048);
      return { type, x0: bx0, y0: by0, x1: bx1, y1: by1, w: Math.max(0, bx1 - bx0), h: Math.max(0, by1 - by0), Mb, delta, coef: new Float64Array(Math.max(0, bx1 - bx0) * Math.max(0, by1 - by0)), blocks: [] };
    });
    const precincts = [];
    const px0 = Math.floor(rx0 / 2 ** ppx), py0 = Math.floor(ry0 / 2 ** ppy);
    for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
      // the precinct in resolution coordinates, then in each band's
      const prx0 = (px0 + i) * 2 ** ppx, pry0 = (py0 + j) * 2 ** ppy, d = r ? 1 : 0;
      const pbands = bands.map(B => {
        const qx0 = Math.max(B.x0, prx0 >> d), qy0 = Math.max(B.y0, pry0 >> d), qx1 = Math.min(B.x1, (prx0 + 2 ** ppx) >> d), qy1 = Math.min(B.y1, (pry0 + 2 ** ppy) >> d);
        if (qx1 <= qx0 || qy1 <= qy0) return { B, cw: 0, ch: 0, blocks: [] };
        const cx0 = Math.floor(qx0 / 2 ** xcb), cy0 = Math.floor(qy0 / 2 ** ycb), cw = Math.ceil(qx1 / 2 ** xcb) - cx0, ch = Math.ceil(qy1 / 2 ** ycb) - cy0, blocks = [];
        for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
          const x0 = Math.max(qx0, (cx0 + cx) * 2 ** xcb), y0 = Math.max(qy0, (cy0 + cy) * 2 ** ycb), x1 = Math.min(qx1, (cx0 + cx + 1) * 2 ** xcb), y1 = Math.min(qy1, (cy0 + cy + 1) * 2 ** ycb);
          const blk = { x0, y0, w: x1 - x0, h: y1 - y0, cx, cy, included: false, lblock: 3, zero: 0, passes: 0, chunks: [] };
          blocks.push(blk); B.blocks.push(blk);
        }
        return { B, cw, ch, blocks, incl: new TagTree(cw, ch), zbp: new TagTree(cw, ch) };
      });
      precincts.push(pbands);
    }
    res.push({ rx0, ry0, rx1, ry1, bands, precincts });
  }
  // packets, in the stream's progression order (made as they are read: 65535 layers of a big tile would not fit a list)
  function* order() {
    const P = r => res[r].precincts.length;
    if (cod.progression === 0) { for (let l = 0; l < cod.layers; l++) for (let r = 0; r <= NL; r++) for (let k = 0; k < P(r); k++) yield [l, r, k]; }
    else for (let r = 0; r <= NL; r++) {
      if (cod.progression === 1) { for (let l = 0; l < cod.layers; l++) for (let k = 0; k < P(r); k++) yield [l, r, k]; }
      else for (let k = 0; k < P(r); k++) for (let l = 0; l < cod.layers; l++) yield [l, r, k];
    }
  }
  let p = 0;
  for (const [l, r, k] of order()) {
    if (p >= data.length) break;   // a truncated stream: what arrived is decoded
    if (cod.sop && data[p] === 0xff && data[p + 1] === 0x91) p += 6;
    const rd = new HeaderBits(data, p), pbands = res[r].precincts[k], got = [];
    try {
      if (rd.bit()) {
        for (const pb of pbands) for (const blk of pb.blocks) {
          let inc;
          if (!blk.included) inc = pb.incl.below(blk.cx, blk.cy, l + 1, rd);
          else inc = !!rd.bit();
          if (!inc) continue;
          if (!blk.included) {
            let z = 0;
            while (!pb.zbp.below(blk.cx, blk.cy, z + 1, rd)) if (++z > 74) throw new Error('jpx: ' + z + ' zero bit planes');   // Mb is at most 7 + 31 + 37
            blk.zero = z; blk.included = true;
          }
          let np = 1;
          if (rd.bit()) { np = 2; if (rd.bit()) { const v = rd.read(2); np = 3 + v; if (v === 3) { const v5 = rd.read(5); np = 6 + v5; if (v5 === 31) np = 37 + rd.read(7); } } }
          while (rd.bit()) if (++blk.lblock > 32) throw new Error('jpx: a code-block length of over 32 bits');
          got.push([blk, rd.read(blk.lblock + Math.floor(Math.log2(np))), np]);
        }
      }
    } catch (e) { if (e instanceof CutOff) break; throw e; }   // the header runs past the data: that packet never arrived
    for (const [blk, , np] of got) blk.passes += np;
    rd.align(); p = rd.p;
    if (cod.eph && data[p] === 0xff && data[p + 1] === 0x92) p += 2;
    for (const [blk, len] of got) { blk.chunks.push(data.subarray(p, p + len)); p += len; }
  }
  // code-blocks → coefficients
  for (const R of res) for (const B of R.bands) for (const blk of B.blocks) {
    if (!blk.chunks.length || !blk.w || !blk.h) continue;
    const n = blk.chunks.reduce((a, c) => a + c.length, 0), d = new Uint8Array(n + 2);
    let o = 0; for (const c of blk.chunks) { d.set(c, o); o += c.length; } d[n] = d[n + 1] = 0xff;
    const vals = decodeBlock(d, { w: blk.w, h: blk.h, band: B.type, passes: blk.passes, planes: B.Mb - blk.zero, reversible: cod.reversible });
    for (let y = 0; y < blk.h; y++) for (let x = 0; x < blk.w; x++) B.coef[(blk.y0 - B.y0 + y) * B.w + (blk.x0 - B.x0 + x)] = vals[y * blk.w + x] * B.delta;
  }
  // the inverse wavelet, one resolution at a time
  let cur = res[0].bands[0].coef, cw = res[0].rx1 - res[0].rx0;   // cur is cw wide; its height is never needed (each level reads its own)
  for (let r = 1; r <= NL; r++) {
    const R = res[r], w = R.rx1 - R.rx0, h = R.ry1 - R.ry0, a = new Float64Array(w * h);
    const [HL, LH, HH] = R.bands, lx = Math.ceil(R.rx0 / 2), hx = Math.floor(R.rx0 / 2), ly = Math.ceil(R.ry0 / 2), hy = Math.floor(R.ry0 / 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {   // interleave: low-pass samples on even coordinates
      const X = x + R.rx0, Y = y + R.ry0, ix = X & 1 ? ((X - 1) >> 1) - hx : (X >> 1) - lx, iy = Y & 1 ? ((Y - 1) >> 1) - hy : (Y >> 1) - ly;
      a[y * w + x] = X & 1 ? (Y & 1 ? HH.coef[iy * HH.w + ix] : HL.coef[iy * HL.w + ix]) : Y & 1 ? LH.coef[iy * LH.w + ix] : cur[iy * cw + ix];
    }
    const line = new Float64Array(Math.max(w, h) + 8);
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) line[x] = a[y * w + x]; synth(line, w, R.rx0, cod.reversible); for (let x = 0; x < w; x++) a[y * w + x] = line[x]; }
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) line[y] = a[y * w + x]; synth(line, h, R.ry0, cod.reversible); for (let y = 0; y < h; y++) a[y * w + x] = line[y]; }
    cur = a; cw = w;
  }
  if (cod.reversible) for (let i = 0; i < cur.length; i++) cur[i] = Math.round(cur[i]);
  return cur;
}

/** One-dimensional synthesis in place (Annex F, 1D_SR): `n` interleaved samples whose first sits at coordinate i0. */
export function synth(x, n, i0, reversible) {
  if (n === 1) { if (i0 & 1) x[0] /= 2; return; }
  if (n === 0) return;
  const P = 4, e = new Float64Array(n + 2 * P);   // symmetric extension, whole-sample
  for (let i = 0; i < n + 2 * P; i++) { let k = i - P; const period = 2 * (n - 1); k = ((k % period) + period) % period; if (k >= n) k = period - k; e[i] = x[k]; }
  const odd = k => ((k - P + i0) & 1) === 1;   // is extended index k at an odd coordinate?
  if (reversible) {
    for (let k = 1; k < n + 2 * P - 1; k++) if (!odd(k)) e[k] -= Math.floor((e[k - 1] + e[k + 1] + 2) / 4);
    for (let k = 1; k < n + 2 * P - 1; k++) if (odd(k)) e[k] += Math.floor((e[k - 1] + e[k + 1]) / 2);
  } else {
    const A = -1.586134342059924, Bt = -0.052980118572961, G = 0.882911075530934, Dl = 0.443506852043971, K = 1.230174104914001;
    for (let k = 0; k < n + 2 * P; k++) e[k] = odd(k) ? e[k] / K : e[k] * K;
    for (let k = 1; k < n + 2 * P - 1; k++) if (!odd(k)) e[k] -= Dl * (e[k - 1] + e[k + 1]);
    for (let k = 1; k < n + 2 * P - 1; k++) if (odd(k)) e[k] -= G * (e[k - 1] + e[k + 1]);
    for (let k = 1; k < n + 2 * P - 1; k++) if (!odd(k)) e[k] -= Bt * (e[k - 1] + e[k + 1]);
    for (let k = 1; k < n + 2 * P - 1; k++) if (odd(k)) e[k] -= A * (e[k - 1] + e[k + 1]);
  }
  for (let i = 0; i < n; i++) x[i] = e[i + P];
}
