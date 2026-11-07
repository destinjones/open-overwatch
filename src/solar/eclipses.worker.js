// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Off the main thread for eclipses.js: every eclipse and occultation in the ephemeris (core/syzygy.js walks ten targets in
// 3-hour steps over five years, a 0.8-1.7 s task on a phone). Message in: { ephem } (data/solar/ephem.json as parsed).
// Out: { events: [plain objects] }, or { error }, and the page then does it itself.
import { createEphemeris, findEclipses, findOccultations } from '../core/syzygy.js';

self.onmessage = e => {
  try {
    const eph = createEphemeris(e.data.ephem);
    self.postMessage({ events: [...findEclipses(eph), ...findOccultations(eph).map(o => ({ type: 'occultation', ...o }))] });
  } catch (err) { self.postMessage({ error: String(err && err.message || err) }); }
};
