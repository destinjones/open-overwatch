// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// How dark the sky is at a spot: the artificial zenith sky brightness from the 2015 World Atlas (Falchi et al. 2016,
// doi:10.5880/GFZ.1.4.2016.001, CC BY-NC 4.0: non-commercial use only) as a 1/15-degree grid in
// data/lightpollution.bin (brand/tools/make_lightpollution.py; the format is in data/lightpollution.md), turned into
// the total sky brightness, a Sky Quality Meter reading (mag/arcsec²) and a Bortle class. DOM-free: decoding needs only
// DecompressionStream (browsers, Node 18+). A modelled clear, moonless sky in 2014-15; real nights also carry airglow,
// the Milky Way, the Moon, haze and newer lights, so treat the class as the spot's best case, give or take one.

/** The atlas's natural sky (mcd/m², 22.0 mag/arcsec²): what is left with no artificial light at all. */
export const NATURAL_MCD = 0.171168;

/** Bortle classes by SQM reading (mag/arcsec²): the lowest reading for each class, with its usual name. */
export const BORTLE = [
  { cls: 1, sqm: 21.99, name: 'excellent dark-sky site' },
  { cls: 2, sqm: 21.89, name: 'typical truly dark site' },
  { cls: 3, sqm: 21.69, name: 'rural sky' },
  { cls: 4, sqm: 20.49, name: 'rural/suburban transition' },
  { cls: 5, sqm: 19.50, name: 'suburban sky' },
  { cls: 6, sqm: 18.94, name: 'bright suburban sky' },
  { cls: 7, sqm: 18.38, name: 'suburban/urban transition' },
  { cls: 8, sqm: 17.80, name: 'city sky' },
  { cls: 9, sqm: -Infinity, name: 'inner-city sky' },
];

/** Luminance (mcd/m²) as a sky brightness in mag/arcsec² (the SQM scale): 108,000 cd/m² is magnitude 0. */
export const sqmFromMcd = mcd => -2.5 * Math.log10(mcd / 1e3 / 108000);
export const mcdFromSqm = sqm => 108000e3 * 10 ** (-0.4 * sqm);

/** Bortle class (1-9) for an SQM reading. */
export const bortleFromSqm = sqm => BORTLE.find(b => sqm >= b.sqm).cls;

/**
 * The bytes of data/lightpollution.bin (ArrayBuffer or Uint8Array) -> the grid: { cols, rows, lon0, lat0, step,
 * log0, qstep, natural, cells (Uint8Array, rows north to south), meta (the file's JSON header) }.
 */
export async function decodeAtlas(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const nl1 = u8.indexOf(10), nl2 = u8.indexOf(10, nl1 + 1), dec = new TextDecoder();
  if (dec.decode(u8.subarray(0, nl1)) !== 'OOLP1') throw new Error('not a light pollution grid (OOLP1)');
  const meta = JSON.parse(dec.decode(u8.subarray(nl1 + 1, nl2))), { cols, rows } = meta.grid;
  const stream = new Blob([u8.subarray(nl2 + 1)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const cells = new Uint8Array(await new Response(stream).arrayBuffer());
  if (cells.length !== cols * rows) throw new Error(`grid has ${cells.length} cells, expected ${cols * rows}`);
  for (let i = cols; i < cells.length; i++) cells[i] = (cells[i] + cells[i - cols]) & 255;   // undo the "up" filter
  return { ...meta.grid, log0: meta.quant.log0, qstep: meta.quant.step, natural: meta.natural ?? NATURAL_MCD, cells, meta };
}

/** Fetch and decode the grid (default data/lightpollution.bin, about 1.7 MB). */
export async function loadAtlas(url = 'data/lightpollution.bin', fetchFn = fetch) {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return decodeAtlas(await r.arrayBuffer());
}

const cellMcd = (g, q) => (q ? 10 ** (g.log0 + (q - 1) * g.qstep) : 0);

/**
 * Artificial zenith brightness (mcd/m²) at lat/lon (deg), bilinear between the four nearest cell centres; null outside
 * the atlas (north of 85° N or south of 60° S).
 */
export function artificialAt(g, lat, lon) {
  const y = (g.lat0 - lat) / g.step - 0.5;
  if (!(y >= -0.5 && y <= g.rows - 0.5)) return null;
  const x = ((((lon - g.lon0) % 360) + 360) % 360) / g.step - 0.5;
  const i0 = Math.max(0, Math.min(g.rows - 1, Math.floor(y))), i1 = Math.min(g.rows - 1, i0 + 1), fy = Math.max(0, Math.min(1, y - i0));
  const j0 = Math.floor(x), fx = x - j0, ja = (j0 + g.cols) % g.cols, jb = (j0 + 1) % g.cols;
  const v = (i, j) => cellMcd(g, g.cells[i * g.cols + j]);
  return (v(i0, ja) * (1 - fx) + v(i0, jb) * fx) * (1 - fy) + (v(i1, ja) * (1 - fx) + v(i1, jb) * fx) * fy;
}

/**
 * The sky at a spot: { artificial, natural, total (mcd/m²), ratio (artificial / natural), sqm (mag/arcsec²),
 * bortle (1-9), name (the class in words) }, or null outside the atlas.
 */
export function skyAt(g, lat, lon) {
  const artificial = artificialAt(g, lat, lon);
  if (artificial == null) return null;
  const natural = g.natural ?? NATURAL_MCD, total = artificial + natural, sqm = sqmFromMcd(total), bortle = bortleFromSqm(sqm);
  return { artificial, natural, total, ratio: artificial / natural, sqm, bortle, name: BORTLE[bortle - 1].name };
}
