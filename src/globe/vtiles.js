// Vector tiles for the OpenStreetMap layers that don't use Overpass (military areas, plate readers, 3D buildings): a
// TileJSON names each source's tile URLs (OpenFreeMap's change weekly), and tiles come over plain GET with CORS, so the
// browser's HTTP cache keeps them (traffic.js fetches the same OpenFreeMap z14 tiles). A few requests at a time across
// all of these layers; the same tile asked twice while loading is fetched once.
import { getJSON } from './env.js';
import { decodeTile } from '../core/mvt.js';

export const OFM = 'https://tiles.openfreemap.org/planet';
export const ALPR_US = 'https://tiles.dontgetflocked.com/cameras-us-hourly.json', ALPR_CA = 'https://tiles.dontgetflocked.com/cameras-ca-hourly.json';
const MAX_INFLIGHT = 4, TTL = 6 * 3600e3;
const specs = new Map();   // TileJSON url -> { at, spec } | { pending }
const inflight = new Map();   // tile url + layers -> promise
let active = 0; const waiting = [];

/** A source's TileJSON (cached for 6 h): { tiles: [template], bounds, minzoom, maxzoom, … }. */
export async function tileSpec(url) {
  const s = specs.get(url);
  if (s?.spec && Date.now() - s.at < TTL) return s.spec;
  if (s?.pending) return s.pending;
  const pending = getJSON(url, { timeout: 20000 }).then(spec => {
    if (!spec?.tiles?.[0]) throw new Error('no tile URL in ' + url);
    specs.set(url, { at: Date.now(), spec }); return spec;
  }, e => { specs.delete(url); throw e; });
  specs.set(url, { pending, spec: s?.spec, at: s?.at });
  return pending;
}
const slot = () => active < MAX_INFLIGHT ? (active++, Promise.resolve()) : new Promise(r => waiting.push(r));
const release = () => { const next = waiting.shift(); if (next) next(); else active--; };

/** A tile 'z/x/y' of a source, decoded to the layers in `want` (null: all): { layer: { extent, features } }. An empty
 *  object where the source has no tile there (404/204: nothing mapped). */
export async function vtile(source, key, want = null) {
  const spec = await tileSpec(source), [z, x, y] = key.split('/');
  const url = spec.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y), id = url + '|' + (want || []).join(',');
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    await slot();
    try {
      const r = await fetch(url);
      if (r.status === 404 || r.status === 204) return {};
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = new Uint8Array(await r.arrayBuffer());
      return buf.length ? decodeTile(buf, want) : {};
    } finally { release(); }
  })();
  inflight.set(id, p);
  p.finally(() => inflight.delete(id)).catch(() => {});
  return p;
}
/** The tile 'z/x/y' as a [west, south, east, north] box in degrees. */
export function tileBox(key) {
  const [z, x, y] = key.split('/').map(Number), n = 2 ** z, lat = yy => Math.atan(Math.sinh(Math.PI * (1 - 2 * yy / n))) * 180 / Math.PI;
  return [x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)];
}
/** Does a tile overlap a TileJSON `bounds`? */
export const tileInBounds = (key, b) => { if (!b) return true; const t = tileBox(key); return t[0] <= b[2] && t[2] >= b[0] && t[1] <= b[3] && t[3] >= b[1]; };
