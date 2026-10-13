// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Runways for the airport cards, the boards and the cockpit (data/runways.json from OurAirports, public domain; made by
// brand/tools/make_airports.py --runways). Loaded with the airport list; without the file, everything that uses it
// simply says nothing about runways (core/runways.js RunwayBook, shared with the 2D map).
import { fetchAsset } from '../core/assets.js';
import { parseRunways, RunwayBook } from '../core/runways.js';

export const Runways = new RunwayBook();
Runways.loading = null;
Runways.load = function () {
  if (!this.loading) this.loading = fetchAsset('data/runways.json', 'json').then(d => { this.byIcao = parseRunways(d); }).catch(() => { this.byIcao = new Map(); });
  return this.loading;
};
