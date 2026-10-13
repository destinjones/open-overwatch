// Airports and their boards. The board is made from the live aircraft we already have, not from schedules: near an
// airport, a plane low and descending towards it is arriving, one climbing away from it is departing, and one on the
// ground there is at the gate or taxiing. A route on file (adsbdb) that names the airport makes the call firmer.
// DOM-free.

import { gcKm, bearing } from './actype.js';

const RAD = Math.PI / 180, FT = 0.3048;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** data/airports.json rows ([icao, iata, name, city, cc, lat, lon, elevFt, size]) as objects. size: 2 large, 1 medium. */
export function parseAirports(json) {
  const rows = json && Array.isArray(json.airports) ? json.airports : Array.isArray(json) ? json : [];
  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 7) continue;
    const [icao, iata, name, city, cc, lat, lon, elevFt, size] = r;
    if (typeof icao !== 'string' || !/^[A-Z0-9]{3,4}$/.test(icao) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ icao, iata: typeof iata === 'string' && /^[A-Z0-9]{3}$/.test(iata) ? iata : '', name: String(name || icao).slice(0, 90), city: String(city || '').slice(0, 60),
      cc: typeof cc === 'string' ? cc.slice(0, 2) : '', lat, lon, elevM: Number.isFinite(elevFt) ? elevFt * FT : 0, size: size === 2 ? 2 : 1, kind: 'airport' });
  }
  return out;
}

/** A 1°-cell index over the airports, for "nearest airport" and "airports in view" without scanning thousands. */
export class AirportIndex {
  constructor(list = []) {
    this.list = list; this.cells = new Map(); this.byCode = new Map();
    for (const a of list) {
      const k = this._key(Math.floor(a.lat), Math.floor(a.lon));
      (this.cells.get(k) || this.cells.set(k, []).get(k)).push(a);
      this.byCode.set(a.icao, a); if (a.iata && !this.byCode.has(a.iata)) this.byCode.set(a.iata, a);
    }
  }
  _key(i, j) { return i * 1000 + (((j + 180) % 360 + 360) % 360); }
  /** By ICAO or IATA code (upper case). */
  get(code) { return this.byCode.get(String(code || '').toUpperCase()) || null; }
  /** Airports within km of a point, nearest first, each with .km. */
  near(lat, lon, km = 50, max = 50) {
    const dLat = Math.ceil(km / 111), dLon = Math.min(180, Math.ceil(km / (111 * Math.max(0.02, Math.cos(Math.min(89, Math.abs(lat)) * RAD)))));
    const i0 = Math.floor(lat), j0 = Math.floor(lon), out = [];
    for (let i = i0 - dLat; i <= i0 + dLat; i++) {
      if (i < -90 || i > 89) continue;
      for (let j = j0 - dLon; j <= j0 + dLon; j++) for (const a of this.cells.get(this._key(i, j)) || []) {
        const d = gcKm(lat, lon, a.lat, a.lon); if (d <= km) out.push({ a, d });
      }
    }
    out.sort((x, y) => x.d - y.d);
    return out.slice(0, max).map(({ a, d }) => ({ ...a, km: d }));
  }
  /** The nearest airport within km (default 400), or null. */
  nearest(lat, lon, km = 400) {
    for (const r of [25, 100, km]) { if (r > km) break; const n = this.near(lat, lon, r, 1); if (n.length) return n[0]; }
    return null;
  }
  /** Airports inside a lat/lon box (west may be > east across the antimeridian), large first. */
  inBox(south, west, north, east, max = 400) {
    const out = [], wrap = west > east;
    for (const a of this.list) if (a.lat >= south && a.lat <= north && (wrap ? a.lon >= west || a.lon <= east : a.lon >= west && a.lon <= east)) out.push(a);
    out.sort((x, y) => y.size - x.size);
    return out.slice(0, max);
  }
}

/** The board's reach: planes this close (km) and this low above the field (m) can be arriving or departing. */
export const BOARD = { radiusKm: 90, groundKm: 5, maxAboveM: 7500, cone: 55 };

/**
 * What one aircraft is doing with respect to an airport, or null if nothing. p: { lat, lon, alt (m baro), ground,
 * gs (m/s), track, vr (m/s), route? ({ origin, destination } from adsbdb, icao codes) }.
 * Returns { status: 'arriving'|'departing'|'ground'|'taxiing'|'landed'|'departed', km, aboveM, etaS, sure } where
 * sure says a route on file agrees.
 */
export function boardStatus(ap, p, opt = BOARD) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  const km = gcKm(ap.lat, ap.lon, p.lat, p.lon);
  if (km > opt.radiusKm) return null;
  const rOrig = p.route && p.route.origin && p.route.origin.icao, rDest = p.route && p.route.destination && p.route.destination.icao;
  const toHere = rDest === ap.icao, fromHere = rOrig === ap.icao, routeOther = !!(rOrig && rDest) && !toHere && !fromHere;
  if (p.ground) {
    if (km > opt.groundKm) return null;
    const moving = (p.gs || 0) > 3;   // over ~6 kt: taxiing (or rolling)
    return { status: moving ? 'taxiing' : 'ground', km, aboveM: 0, etaS: null, score: km, sure: toHere || fromHere, toHere, fromHere };
  }
  const aboveM = (p.alt || 0) - (ap.elevM || 0);
  if (aboveM > opt.maxAboveM) return null;
  const toAp = bearing(p.lat, p.lon, ap.lat, ap.lon), off = p.track == null ? 90 : angDiff(p.track, toAp);
  const vr = p.vr || 0, gs = p.gs || 0;
  // a sensible approach: no more than ~1,000 m above the field per 3 km out (a 3° glide is ~160 m/km), plus room to
  // spare for holds and the downwind leg, which is why "low and close" counts even when it is not pointing at the field
  const glideOk = aboveM <= 120 + km * 330;
  const closeLow = km < 12 && aboveM < 900;   // in the circuit: can point anywhere
  let status = null;
  if (vr < -1.0 && glideOk && (off < opt.cone || closeLow)) status = 'arriving';
  else if (vr > 1.0 && (off > 180 - opt.cone - 25 || closeLow) && aboveM < 6000 && km < 70) status = 'departing';
  else if (closeLow && Math.abs(vr) <= 1.0 && aboveM < 600) status = off < 90 ? 'arriving' : 'departing';   // pattern work, level on final
  if (!status && toHere && vr <= 0.5 && glideOk) status = 'arriving';
  if (!status && fromHere && vr >= -0.5 && km < 70) status = 'departing';
  if (!status) return null;
  if (routeOther && !closeLow) return null;   // a route on file names other airports: it is passing by (a nearby field)
  let etaS = null;
  if (status === 'arriving' && gs > 20) {
    const along = km * Math.max(0.2, Math.cos(Math.min(off, 80) * RAD));   // pointing away still has to come round
    etaS = Math.max(along, km) * 1000 / gs * (off < 30 ? 1 : 1.15);
    if (vr < -0.5) etaS = Math.max(etaS * 0.6, Math.min(etaS * 1.6, (etaS + aboveM / -vr) / 2));   // what the descent rate says
  }
  // how well it fits (lower is better): near, and pointing at the field (arriving) or away from it (departing)
  const score = km * (1 + (status === 'arriving' ? off : 180 - off) / 45);
  return { status, km, aboveM, etaS, score, sure: status === 'arriving' ? toHere : fromHere, toHere, fromHere };
}

/**
 * The board for an airport from a list of aircraft: { arriving, departing, ground, recent } each sorted (arrivals by
 * ETA, departures by distance flown, ground by distance, recent landings and take-offs newest first), entries
 * { r, ...boardStatus } (recent: { r, ...recentMove, km }). A plane counts once: if another
 * airport in `others` fits it clearly better (nearer, and pointed at it), it is left to that one (fields close together).
 */
export function makeBoard(ap, aircraft, { others = [], opt = BOARD, max = 40, now = Date.now() } = {}) {
  const arriving = [], departing = [], ground = [], recent = [];
  for (const r of aircraft) {
    const mv = recentMove(ap, r, now, opt);
    const fresh = mv && mv.agoS < 30 * 60;
    if (fresh) recent.push({ r, ...mv, km: gcKm(ap.lat, ap.lon, r.lat, r.lon) });
    const s = boardStatus(ap, r, opt); if (!s || (fresh && mv.status === 'landed')) continue;   // just landed: listed once, as that
    if (!s.sure && others.length) {
      let closer = false;
      for (const o of others) {
        if (o.icao === ap.icao) continue;
        const so = boardStatus(o, r, opt);
        if (so && (so.sure || (so.status === s.status && so.score < s.score * 0.8))) { closer = true; break; }
      }
      if (closer) continue;
    }
    const e = { r, ...s };
    if (s.status === 'arriving') arriving.push(e); else if (s.status === 'departing') departing.push(e); else ground.push(e);
  }
  arriving.sort((a, b) => (a.etaS ?? 1e9) - (b.etaS ?? 1e9) || a.km - b.km);
  departing.sort((a, b) => a.km - b.km);
  ground.sort((a, b) => (b.status === 'taxiing') - (a.status === 'taxiing') || a.km - b.km);
  recent.sort((a, b) => b.at - a.at);
  return { arriving: arriving.slice(0, max), departing: departing.slice(0, max), ground: ground.slice(0, max), recent: recent.slice(0, max) };
}

/**
 * A landing or take-off between a plane's last two fixes, at this airport: { status: 'landed'|'departed', at (ms,
 * estimated), agoS } or null. Landed: on the ground within groundKm now, airborne within 60 km at the fix before (at
 * most 20 min earlier); the touchdown is put where the old fix's ground speed would have brought it to the field.
 * Departed: airborne now, on the ground here at the fix before; lift-off where the new fix's speed says it left.
 */
export function recentMove(ap, r, now, opt = BOARD) {
  const w = r && r.was;
  if (!w || !Number.isFinite(r.ts) || !Number.isFinite(w.ts) || r.ts - w.ts > 20 * 60e3 || r.ts <= w.ts) return null;
  const kmNow = gcKm(ap.lat, ap.lon, r.lat, r.lon), kmWas = gcKm(ap.lat, ap.lon, w.lat, w.lon);
  const clamp = t => Math.max(w.ts, Math.min(r.ts, t));
  if (r.ground && !w.ground && kmNow <= opt.groundKm && kmWas <= 60) {
    const at = clamp(w.gs > 20 ? w.ts + kmWas * 1e6 / w.gs : (w.ts + r.ts) / 2);
    return { status: 'landed', at, agoS: (now - at) / 1000 };
  }
  if (!r.ground && w.ground && kmWas <= opt.groundKm) {
    const at = clamp(r.gs > 20 ? r.ts - kmNow * 1e6 / r.gs : (w.ts + r.ts) / 2);
    return { status: 'departed', at, agoS: (now - at) / 1000 };
  }
  return null;
}

/** "6 min", "1 h 05", "now" for an ETA in seconds. */
export function etaText(s) {
  if (s == null || !Number.isFinite(s)) return '—';
  if (s < 60) return 'now';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** The airport someone means: a code ("LHR", "EGLL"), a name ("Heathrow", "Charles de Gaulle", "JFK International")
 *  or a city ("Denver", "New York": its largest field). Returns the airport or null. */
export function findAirport(list, query) {
  const raw = String(query || '').trim();
  if (!raw) return null;
  const code = raw.toUpperCase().replace(/\s+AIRPORT$/, '');
  if (/^[A-Z0-9]{3,4}$/.test(code)) { const c = list.find(a => a.iata === code) || list.find(a => a.icao === code); if (c) return c; }
  const q = raw.toLowerCase().replace(/[’']/g, '').replace(/\b(the|airport|international|intl|aeroporto|aeropuerto|aéroport|flughafen)\b/g, ' ').replace(/[^a-z0-9à-ÿ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const norm = s => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9à-ÿ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = q.split(' ');
  let best = null, bestScore = 0;
  for (const a of list) {
    const name = norm(a.name), city = norm(a.city);
    let s = 0;
    if (city === q) s = 50;
    else if (name.includes(q)) s = name.startsWith(q) || name.includes(' ' + q) ? 60 : 40;
    else if (words.length > 1 && words.every(w => name.includes(w) || city.includes(w))) s = 30;
    if (!s) continue;
    s += a.size === 2 ? 20 : 0;
    if (s > bestScore) { best = a; bestScore = s; }
  }
  return best;
}
