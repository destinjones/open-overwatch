// Watching an airport (download version): while its card is open, and for any field you ask to keep watching, every
// plane within ~75 km is asked for a fresh fix every 15 s (adsb.lol, else adsb.fi, through the local helper; 2 minutes off
// when both say too many), so the board's estimates work from positions seconds old instead of the global snapshot's
// minutes, and the planes' trails fill in. The trails are then read for landings and take-offs (core/runwaylog.js):
// each is matched to the runway it used, and the card shows which runways the last hour's arrivals and departures used
// and when the flow changed. Each landing also scores the arrival estimates the board made for that plane
// (core/eta.js EtaLog), so the card can say how well they have been doing. Both logs are kept in this browser
// (localStorage) for two and six hours. The website has no live aircraft (the feeds refuse websites), so none of this.
import { getJSON, RELAY, store } from './env.js';
import { L } from './layers.js';
import { Air, fromAdsb } from './aircraft.js';
import { Trails } from './trails.js';
import { Runways } from './runways.js';
import { detectMoves, landingRunway, takeoffRunway, RunwayLog } from '../core/runwaylog.js';
import { EtaLog } from '../core/eta.js';

const RADIUS_NM = 40, EVERY_MS = 15e3, MAX_KEPT = 3;
// adsb.lol first; when it says too many, adsb.fi (same answer shape, `aircraft` instead of `ac`) until it fails too
const SOURCES = [
  (lat, lon) => `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${RADIUS_NM}`,
  (lat, lon) => `https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${RADIUS_NM}`,
];

export const FieldWatch = {
  available: !!RELAY,
  index: null,                                   // AirportIndex (airports.js sets it)
  open: null,                                    // the airport whose card is open
  kept: new Map(),                               // icao -> airport, watched with the card closed
  polled: new Map(),                             // icao -> last poll time
  backoff: 0, busy: false, src: 0, fails: 0,
  scanned: new Map(),                            // hex -> the last trail time read for moves
  log: RunwayLog.fromJSON(store.get('rwLog', []), { keepMin: 120 }),
  eta: EtaLog.fromJSON(store.get('etaLog', null), { keepH: 6 }),
  /** Fields being watched now. */
  watched() { const out = [...this.kept.values()]; if (this.open && !this.kept.has(this.open.icao)) out.unshift(this.open); return out; },
  isKept(a) { return this.kept.has(a.icao); },
  keep(a, on = !this.kept.has(a.icao)) {
    if (on) { if (this.kept.size >= MAX_KEPT) this.kept.delete(this.kept.keys().next().value); this.kept.set(a.icao, a); } else this.kept.delete(a.icao);
    store.set('rwKept', [...this.kept.keys()]);
    return on;
  },
  restore(index) {   // the fields kept last time
    this.index = index;
    for (const id of store.get('rwKept', [])) { const a = index.get(id); if (a) this.kept.set(a.icao, a); }
  },
  async poll() {
    if (!this.available || this.busy || document.hidden || Date.now() < this.backoff || (!L.air.on && !L.mil.on)) return;
    const now = Date.now(), due = this.watched().find(a => now - (this.polled.get(a.icao) || 0) >= EVERY_MS);
    if (!due) return;
    this.busy = true; this.polled.set(due.icao, now);
    try {
      const d = await getJSON(SOURCES[this.src](due.lat, due.lon), { relay: true, timeout: 10000 }), at = Date.now();
      for (const a of (d && (d.ac || d.aircraft)) || []) { const r = fromAdsb(a, at, !!(a.dbFlags & 1)); if (r) Air.upsert(r); }
      this.fails = 0;
    } catch (e) {   // the other source next time; both failing in a row: rest for 2 minutes
      this.src = (this.src + 1) % SOURCES.length; this.polled.delete(due.icao);
      if (++this.fails >= SOURCES.length) { this.fails = 0; this.backoff = Date.now() + 120e3; }
    }
    finally { this.busy = false; }
  },
  /** Read the trails that changed for landings and take-offs at known airports. */
  scan() {
    if (!this.index) return;
    let added = 0;
    for (const [hex, t] of Trails.map) {
      const pts = t.pts, last = pts[pts.length - 1]; if (!last || pts.length < 3) continue;
      const since = this.scanned.get(hex) ?? -Infinity, upto = pts[pts.length - 2].t;   // the last point waits for the next to confirm it
      if (upto <= since) continue;
      this.scanned.set(hex, upto);
      for (const m of detectMoves(pts, since)) {
        const ap = this.index.near(m.lat, m.lon, 6, 1)[0]; if (!ap) continue;
        const rw = Runways.of(ap), r = Air.map.get(hex);
        const used = rw ? (m.kind === 'landing' ? landingRunway(rw, pts, m.i) : takeoffRunway(rw, pts, m.i)) : null;
        if (this.log.add({ icao: ap.icao, rwy: used ? used.end.ident : '', kind: m.kind, t: m.t, hex, flight: r ? r.flight : '' })) added++;
        if (m.kind === 'landing' && this.eta.landed(ap.icao, hex, m.t).length) added++;
      }
    }
    if (this.scanned.size > 4000) for (const k of [...this.scanned.keys()].slice(0, 1000)) this.scanned.delete(k);
    const now = Date.now();
    this.log.prune(now); this.eta.prune(now);
    if (added) { store.set('rwLog', this.log.toJSON()); store.set('etaLog', this.eta.toJSON()); }
    return added;
  },
};
setInterval(() => FieldWatch.poll(), 2500);
setInterval(() => FieldWatch.scan(), 10e3);
