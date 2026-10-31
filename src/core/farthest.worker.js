// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Off the main thread for the Tonight card (src/globe/tonight.js): fetch and parse data/solar/spacecraft.json (1.9 MB)
// and answer with the four spacecraft farthest from Earth (core/farthest.js). Message in: { id, now, base }, where base
// is the page's URL (the data path is relative to the site, not to this file). Out: { id, rows } or { id, error }.
import { fetchAsset } from './assets.js';
import { farthestCraft } from './farthest.js';

self.onmessage = async e => {
  const { id, now, base } = e.data;
  try {
    const all = await fetchAsset('data/solar/spacecraft.json', 'json', { fetchImpl: u => fetch(new URL(String(u), base)) });   // the site's path, then the published copy
    self.postMessage({ id, rows: farthestCraft(all, now) });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
