// Shared by the globe (src/globe/fires.js) and the 2D map (src/map/hazards.js).
// Fire tiles off the main thread: fetch a GIBS VIIRS thermal anomaly vector tile (served gzipped without saying so),
// unzip it, decode it and keep the detections since `since`. A tile can hold 15,000 detections in a burning season.
import { decodeTile } from './mvt.js';
import { parseFires } from './hazards.js';

self.onmessage = async e => {
  const { id, url, since } = e.data;
  try {
    let r;
    try { r = await fetch(url); }
    catch (e) { self.postMessage({ id, fires: [], missing: true }); return; }   // GIBS answers a day with no data yet with a 404 without CORS: unreadable
    if (r.status === 404) { self.postMessage({ id, fires: [] }); return; }   // no detections there that day
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let b = new Uint8Array(await r.arrayBuffer());
    if (b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    self.postMessage({ id, fires: parseFires(decodeTile(b), since) });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
