// Runways for the airport cards, the boards and the cockpit (data/runways.json from OurAirports, public domain; made by
// brand/tools/make_airports.py --runways). Loaded with the airport list; without the file, everything that uses it
// simply says nothing about runways.
import { fetchAsset } from '../core/assets.js';
import { parseRunways, finalFor, runwayInUse, windTable } from '../core/runways.js';

export const Runways = {
  byIcao: new Map(), loading: null,
  load() {
    if (!this.loading) this.loading = fetchAsset('data/runways.json', 'json').then(d => { this.byIcao = parseRunways(d); }).catch(() => { this.byIcao = new Map(); });
    return this.loading;
  },
  of(ap) { return ap ? this.byIcao.get(ap.icao) || null : null; },
  /** The runway end a plane is lined up with at this airport: { end, km, off } or null. */
  final(ap, p) { const rw = this.of(ap); return rw ? finalFor(rw, p) : null; },
  /** The runway in use from the board's arrivals and the field's wind ({ dir, speed } in knots). */
  inUse(ap, arrivals, wind) { const rw = this.of(ap); return rw ? runwayInUse(rw, arrivals, wind) : null; },
  /** Wind per runway end, most headwind first. */
  wind(ap, dir, speed) { const rw = this.of(ap); return rw && dir != null && speed != null ? windTable(rw, dir, speed) : []; },
};
