// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Shared by the globe (src/globe/fires.js) and the 2D map (src/map/hazards.js).
// Fire tiles off the main thread: fetch a GIBS VIIRS thermal anomaly vector tile (served gzipped without saying so),
// unzip it, decode it and keep the detections since `since`. A tile can hold 15,000 detections in a burning season.
// The request and its body have `timeout` ms (30 s): a stalled one answers with an error (the tile is tried again later)
// rather than never, which would hold the globe's two request slots and the 2D map's hotspots feed for the session.
import { decodeTile } from './mvt.js';
import { parseFires } from './hazards.js';

self.onmessage = async e => {
  const { id, url, since, timeout = 30000 } = e.data;
  try {
    let r;
    const signal = AbortSignal.timeout(timeout);   // also ends the body read below
    try { r = await fetch(url, { signal }); }
    catch (e) { if (signal.aborted) throw new Error('timed out'); self.postMessage({ id, fires: [], missing: true }); return; }   // GIBS answers a day with no data yet with a 404 without CORS: unreadable
    if (r.status === 404) { self.postMessage({ id, fires: [] }); return; }   // no detections there that day
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let b = new Uint8Array(await r.arrayBuffer());
    if (b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    self.postMessage({ id, fires: parseFires(decodeTile(b), since) });
  } catch (err) { self.postMessage({ id, error: err && err.name === 'TimeoutError' ? 'timed out' : String(err && err.message || err) }); }
};
