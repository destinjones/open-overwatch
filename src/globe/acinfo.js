// What a plane is and where it is going (adsbdb), for the globe: core/acinfo.js asks and caches (shared with the 2D
// map), this adds where a live record is against its route on file and where it is registered.
import { store } from './env.js';
import { routeFit, hexCountry } from '../core/actype.js';
import { createAcInfo } from '../core/acinfo.js';

const client = createAcInfo({ store, warn: m => console.warn(m) });

export const AcInfo = {
  /** Cached answer for a plane, or undefined if not asked yet. */
  peek: r => client.peek(r),
  /** { aircraft, route } for a feed record (asks adsbdb once, queued); also stored on r.info. Never rejects. */
  get: r => client.get(r),
  /** Where the plane is against its route on file (core routeFit), for a live record. */
  fit(r) { const v = r.info; return v && v.route ? routeFit(v.route, { lat: r.cur?.lat ?? r.lat, lon: r.cur?.lon ?? r.lon, track: r.track, gs: r.gs, ground: r.ground }) : null; },
  country: r => r.country || hexCountry(r.hex),
  get limited() { return client.limited; },
};
