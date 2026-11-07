// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// One asteroid's orbit out of a packed file (core/whereis.js says where its bytes sit): seven tiny ranged reads, not the
// 19 MB file a phone otherwise never downloads. A server that ignores Range answers with the whole file: rather than
// take it here, that is reported (e.noRange) and the caller loads the file the usual way.
import { recordRanges, elementsFromBytes } from '../core/whereis.js';
import { SITE } from '../core/assets.js';

async function read(url, off, n, fetchImpl) {
  const stop = new AbortController();
  const r = await fetchImpl(url, { headers: { Range: `bytes=${off}-${off + n - 1}` }, signal: stop.signal });
  if (r.status !== 206) { stop.abort(); throw Object.assign(new Error(`HTTP ${r.status}`), { noRange: r.ok }); }
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length !== n) throw new Error('short read');
  return b;
}

/** The elements of record idx of N in data/solar/<name>, epoch as in small_bodies.json. Rejects if it cannot be read. */
export async function readAsteroidRecord(name, N, idx, epoch, { fetchImpl = (...a) => globalThis.fetch(...a), site = SITE } = {}) {
  let last;
  for (const url of [`data/solar/${name}`, `${site}data/solar/${name}`]) {   // archived versions read the data from the site root (core/assets.js)
    try {
      const parts = await Promise.all(recordRanges(N, idx).map(async ([k, off, n]) => [k, await read(url, off, n, fetchImpl)]));
      return elementsFromBytes(Object.fromEntries(parts), epoch);
    } catch (e) { if (e.noRange) throw e; last = e; }
  }
  throw last;
}
