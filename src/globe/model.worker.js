// Weather model fields off the main thread: fetch a forecast hour's inventory (NOAA's .idx or ECMWF's .index) or the
// byte ranges of the fields wanted from the models' files on AWS, keep each in Cache Storage (a run's files never
// change, so a page reload or a second look costs nothing), decode the GRIB2 (simple and complex packing for GFS,
// JPEG 2000 for WAVEWATCH III, CCSDS for ECMWF) and thin grids finer than asked (0.25° → 0.5°: a quarter of the
// memory) into Float32Arrays handed back without copying.
import { decodeGrib2, parseIdx } from '../core/grib2.js';
import { paramKey, parseEcIndex } from '../core/wxmodels.js';
import { coarsen } from '../core/fields.js';

async function cached(cacheName, key, get) {
  let cache = null;
  try { cache = await caches.open(cacheName); const hit = await cache.match(key); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) { cache = null; }   // private windows: no Cache Storage
  const b = await get();
  try { await cache?.put(key, new Response(b)); } catch (e) { /* full or unavailable: fine */ }
  return b;
}
// S3 sheds load with "503 Slow Down": ECMWF's bucket answers a good share of requests that way while a new run is
// popular, and without CORS headers, so the browser reports a plain network error. Both are tried again, and no more
// than four requests run at once (a burst of parallel ranges is what makes S3 say slow down).
let running = 0;
const queue = [];
async function slot(fn) {
  if (running >= 4) await new Promise(res => queue.push(res));
  running++;
  try { return await fn(); } finally { running--; queue.shift()?.(); }
}
/** Fetch and read a response (`read`: the response → its bytes, or throw), trying again after a moment when S3 asks
 *  us to slow down. The whole download holds one of the four slots. */
async function fetchRetry(url, init, read, tries = 8) {
  const wait = i => new Promise(res => setTimeout(res, Math.min(4000, 400 * 2 ** i) + Math.random() * 600));
  for (let i = 0; ; i++) {
    try {
      const out = await slot(async () => {
        const r = await fetch(url, init);
        if (r.status === 503 || r.status === 500) { r.body?.cancel(); return null; }
        return read(r);
      });
      if (out) return out;
      if (i + 1 >= tries) throw new Error('the server is busy (HTTP 503)');
    } catch (e) { if (i + 1 >= tries || e.final) throw e; }
    await wait(i);
  }
}
const final = msg => Object.assign(new Error(msg), { final: true });   // not worth trying again
async function bytes(cacheName, url, start, end) {
  const range = `bytes=${start}-${end ?? ''}`;
  return cached(cacheName, `${url}?${range}`, () => fetchRetry(url, { headers: { Range: range } }, async r => {
    if (r.status === 200) { r.body?.cancel(); throw final('the server sent the whole file'); }   // 44-150 MB: never
    if (r.status !== 206) throw final('HTTP ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }));
}

self.onmessage = async e => {
  const { id, idx, format, url, ranges, keep, res, cache = 'oo3d-gfs' } = e.data;
  try {
    if (keep) {   // a newer run: forget this model's older ones
      const c = await caches.open(cache);
      for (const req of await c.keys()) if (!req.url.includes(keep)) await c.delete(req);
      self.postMessage({ id }); return;
    }
    if (idx) {
      const b = await cached(cache, idx, () => fetchRetry(idx, {}, async r => { if (!r.ok) throw final('HTTP ' + r.status); return new Uint8Array(await r.arrayBuffer()); }));
      const text = new TextDecoder().decode(b);
      self.postMessage({ id, rows: format === 'json' ? parseEcIndex(text) : parseIdx(text) }); return;
    }
    const fields = [];
    for (const r of ranges) for (const m of decodeGrib2(await bytes(cache, url, r.start, r.end))) {
      const p = paramKey(m); if (!p) continue;
      if (p.scale !== 1) for (let i = 0; i < m.values.length; i++) m.values[i] *= p.scale;
      const k = res ? Math.round(res / m.grid.di) : 1;
      const f = k >= 2 ? coarsen({ grid: m.grid, values: m.values }, k, p.key === 'wavedir' ? 'pick' : 'mean') : { grid: m.grid, values: m.values };
      fields.push({ key: p.key, grid: f.grid, values: f.values });
    }
    self.postMessage({ id, fields }, fields.map(f => f.values.buffer));
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
