// A tiny PNG encoder and decoder (8-bit RGBA, no interlace) on Node's zlib: the stand-in map tiles the stubbed network
// serves, and the small reference pictures the screenshot checks store. No dependencies.
import { deflateSync, inflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** RGBA pixels (Uint8Array, width*height*4) → PNG bytes. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** PNG bytes → { width, height, data: RGBA Uint8Array }. Handles what encodePng and browsers' canvas encoders write
 *  (8-bit RGB or RGBA, any of the five row filters). */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, type = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), t = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (t === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); if (data[8] !== 8 || data[12]) throw new Error('only 8-bit, non-interlaced PNGs'); type = data[9]; }
    else if (t === 'IDAT') idat.push(data);
    else if (t === 'IEND') break;
    off += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0; if (!bpp) throw new Error('only RGB or RGBA PNGs');
  const raw = inflateSync(Buffer.concat(idat)), stride = width * bpp, px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - stride + x] : 0, c = x >= bpp && y ? px[o - stride + x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 255;
    }
  }
  if (bpp === 4) return { width, height, data: px };
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) { out[j] = px[i]; out[j + 1] = px[i + 1]; out[j + 2] = px[i + 2]; out[j + 3] = 255; }
  return { width, height, data: out };
}

/** A 256 px map tile: a flat fill with a faint graticule at its edges, the same for every tile of a server, so a stubbed
 *  map looks like a map (and pans visibly) without any upstream imagery. */
export function tilePng([r, g, b], grid = [r + 18, g + 22, b + 26]) {
  const n = 256, px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4, edge = x === 0 || y === 0;
    px[i] = edge ? grid[0] : r; px[i + 1] = edge ? grid[1] : g; px[i + 2] = edge ? grid[2] : b; px[i + 3] = 255;
  }
  return encodePng(n, n, px);
}
