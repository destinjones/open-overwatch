// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The globe's aurora picture off the main thread (src/globe/aurora.js): fetch NOAA's OVATION grid (~0.7 MB of JSON, 65,000
// cells), read it and paint the 360 × 181 picture here. Parsing it on the page was a 462 ms task in the globe's boot (perf
// run 2026-10-31, finding 6). Answers { id, px (RGBA, transferred), at, peak } or { id, error }.
import { OVATION_URL, parseOvation, paintEquirect } from './aurora.js';

self.onmessage = async e => {
  const { id, url = OVATION_URL, timeout = 30000 } = e.data;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { grid, at, peak } = parseOvation(await r.json()), px = paintEquirect(grid);
    self.postMessage({ id, px, at, peak }, [px.buffer]);
  } catch (err) { self.postMessage({ id, error: err && err.name === 'TimeoutError' ? 'timed out' : String(err && err.message || err) }); }
};
