// Weather model fields off the main thread: fetch a forecast hour's inventory (.idx) or the byte ranges of the fields
// wanted from NOAA's GFS files on AWS, keep each in Cache Storage (a run's files never change, so a page reload or a
// second look costs nothing), and decode the GRIB2 into Float32Arrays handed back without copying.
import { decodeGrib2, parseIdx } from '../core/grib2.js';
import { PARAM } from '../core/gfs.js';

const CACHE = 'oo3d-gfs';
async function cached(key, get) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(key); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) { cache = null; }   // private windows: no Cache Storage
  const b = await get();
  try { await cache?.put(key, new Response(b)); } catch (e) { /* full or unavailable: fine */ }
  return b;
}
async function bytes(url, start, end) {
  const range = `bytes=${start}-${end ?? ''}`;
  return cached(`${url}?${range}`, async () => {
    const r = await fetch(url, { headers: { Range: range } });
    if (r.status === 200) { r.body?.cancel(); throw new Error('the server sent the whole file'); }   // 44 MB: never
    if (r.status !== 206) throw new Error('HTTP ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  });
}

self.onmessage = async e => {
  const { id, idx, url, ranges, keep } = e.data;
  try {
    if (keep) {   // a newer run: forget the older ones
      const cache = await caches.open(CACHE);
      for (const req of await cache.keys()) if (!req.url.includes(keep)) await cache.delete(req);
      self.postMessage({ id }); return;
    }
    if (idx) {
      const b = await cached(idx, async () => { const r = await fetch(idx); if (!r.ok) throw new Error('HTTP ' + r.status); return new Uint8Array(await r.arrayBuffer()); });
      self.postMessage({ id, rows: parseIdx(new TextDecoder().decode(b)) }); return;
    }
    const fields = [];
    for (const r of ranges) for (const m of decodeGrib2(await bytes(url, r.start, r.end))) {
      const key = m.discipline === 0 && PARAM[m.category + '.' + m.number];
      if (key) fields.push({ key, grid: m.grid, values: m.values });
    }
    self.postMessage({ id, fields }, fields.map(f => f.values.buffer));
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
