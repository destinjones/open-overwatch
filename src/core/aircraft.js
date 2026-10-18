// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Aircraft records from the two kinds of feed both views read: readsb-style JSON (adsb.lol, adsb.fi, airplanes.live: feet,
// knots, ft/min) and OpenSky's state vectors (metres, m/s). One reader each, in the feeds' own units plus SI, so the 2D map
// (aviation units) and the globe (metres) keep their own maths without parsing twice. Pure (test/aircraft.test.mjs).

import { agreeingIds, stampReports } from './liveprov.js';

export const EMERGENCY_SQUAWKS = Object.freeze(['7500', '7600', '7700']);
export const FT = 0.3048, KT = 0.514444;
/** The boards' tag for an aircraft in an emergency: "SQUAWK 7700" for an emergency squawk, else "EMERGENCY" (a declared
 *  emergency can come with any squawk), or '' when it is not in one. Plain text: the views escape it. */
export const emergencyLabel = r => (!r || !r.emerg ? '' : EMERGENCY_SQUAWKS.includes(r.squawk) ? 'SQUAWK ' + r.squawk : 'EMERGENCY');
/** A hex address as it may appear in a link or a handler: its own charset only ("~" marks a non-ICAO address). */
export const cleanHex = h => String(h ?? '').toLowerCase().replace(/[^0-9a-f~]/g, '');
const fin = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * One readsb aircraft → { hex, flight, reg, type, desc, lat, lon, ground, altFt (barometric), geomFt, altM, geomM, gsKt, gsMs,
 * track, rateFpm, rateMs, squawk, emergency (its own field), emerg (an emergency squawk or declared), dbFlags, mil, seenPos,
 * seen, ... } or null without a position or address. mil: the /mil feed, or the database's military flag.
 */
export function readsb(a, { mil = false } = {}) {
  if (!a || typeof a !== 'object') return null;
  const hex = cleanHex(a.hex), lat = fin(a.lat), lon = fin(a.lon);
  if (!hex || lat == null || lon == null) return null;
  const ground = a.alt_baro === 'ground', altFt = ground ? 0 : fin(a.alt_baro), geomFt = fin(a.alt_geom);
  const gsKt = fin(a.gs), rateFpm = fin(a.baro_rate) ?? fin(a.geom_rate), dbFlags = fin(a.dbFlags) || 0, squawk = typeof a.squawk === 'string' ? a.squawk : '';
  return { hex, flight: String(a.flight || '').trim(), reg: a.r ? String(a.r) : '', type: a.t ? String(a.t) : '', desc: a.desc ? String(a.desc) : '', lat, lon, ground,
    altFt, geomFt, altM: altFt != null ? altFt * FT : null, geomM: ground || geomFt == null ? null : geomFt * FT, gsKt, gsMs: gsKt != null ? gsKt * KT : null,
    track: fin(a.track) ?? fin(a.true_heading), rateFpm, rateMs: rateFpm != null ? rateFpm * FT / 60 : null, squawk, emergency: a.emergency ? String(a.emergency) : '',
    emerg: EMERGENCY_SQUAWKS.includes(squawk) || (!!a.emergency && a.emergency !== 'none'), dbFlags, mil: mil || !!(dbFlags & 1),
    seenPos: fin(a.seen_pos) || 0, seen: fin(a.seen), category: a.category ? String(a.category) : '', nic: fin(a.nic), nacp: fin(a.nac_p), rssi: fin(a.rssi),
    mlat: Array.isArray(a.mlat) && a.mlat.length > 0, tisb: Array.isArray(a.tisb) && a.tisb.length > 0, ownOp: a.ownOp ? String(a.ownOp) : '', year: a.year ? String(a.year) : '',
    msgs: fin(a.messages), msgType: a.type ? String(a.type) : '' };
}

/**
 * One OpenSky state vector ([icao24, callsign, country, time_position, last_contact, lon, lat, baro_altitude, on_ground,
 * velocity, true_track, vertical_rate, sensors, geo_altitude, squawk, ...]) → { hex, flight, country, tpos (s), lat, lon,
 * ground, altM, geomM, gsMs, gsKt, track, rateMs, altFt, rateFpm, squawk, emerg } or null without a position.
 */
export function openskyState(s) {
  if (!Array.isArray(s)) return null;
  const hex = cleanHex(s[0]), lon = fin(s[5]), lat = fin(s[6]);
  if (!hex || lat == null || lon == null) return null;
  const ground = !!s[8], altM = ground ? 0 : fin(s[7]), gsMs = fin(s[9]), rateMs = fin(s[11]), squawk = typeof s[14] === 'string' ? s[14] : '';
  return { hex, flight: String(s[1] || '').trim(), country: String(s[2] || ''), tpos: fin(s[3]), lat, lon, ground, altM, geomM: ground ? null : fin(s[13]),
    gsMs, gsKt: gsMs != null ? gsMs / KT : null, track: fin(s[10]), rateMs, altFt: altM != null ? altM / FT : null, rateFpm: rateMs != null ? rateMs / FT * 60 : null,
    squawk, emerg: EMERGENCY_SQUAWKS.includes(squawk) };
}

/** When two feeds' reports are the same aircraft in the same place (provenance agreement): the same hex, data times at most
 *  maxDtS apart (the feeds are polled 15-60 s apart), positions within posM plus the distance it can fly in the gap (the
 *  faster ground speed, slack × it: a turn only shortens the line), and barometric altitudes within altFt plus climbFpm
 *  over the gap where both have one. Reports further apart in time are not compared at all (outdated, not contradicting). */
export const AIR_AGREE = Object.freeze({ maxDtS: 120, posM: 1500, slack: 1.15, altFt: 500, climbFpm: 4000 });

/** Do reports a and b ({ hex, lat, lon, t (ms), gsKt?, altFt? }) agree within AIR_AGREE? */
export function sameAircraft(a, b, tol = AIR_AGREE) {
  if (!a || !b || cleanHex(a.hex) !== cleanHex(b.hex)) return false;
  const dt = Number.isFinite(a.t) && Number.isFinite(b.t) ? Math.abs(a.t - b.t) / 1000 : 0;
  if (dt > tol.maxDtS) return false;
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
  const m = Math.hypot(x, y) * 6371008.8, v = Math.max(fin(a.gsKt) || 0, fin(b.gsKt) || 0) * KT;
  if (m > tol.posM + v * dt * tol.slack) return false;
  return !(fin(a.altFt) != null && fin(b.altFt) != null && Math.abs(a.altFt - b.altFt) > tol.altFt + tol.climbFpm * dt / 60);
}

/** A readsb report's data time (ms): the response's `now` (s or ms) less the aircraft's seen_pos. */
export const readsbTime = (rec, now) => { const n = fin(now); if (n == null) return null; return (n < 1e11 ? n * 1000 : n) - (rec && fin(rec.seenPos) || 0) * 1000; };

/** The feeds' names as the views keep them → provenance source ids (core/liveprov.js SOURCES). */
export const AIR_SOURCE_ID = Object.freeze({ 'adsb.lol': 'adsblol', 'adsb.fi': 'adsbfi', 'adsb.one': 'adsbone', 'airplanes.live': 'airplaneslive', opensky: 'opensky', OpenSky: 'opensky' });

/**
 * One feed's report of an aircraft into its record's provenance: keeps each feed's newest report for keepMs, works out
 * which agree (sameAircraft) and stamps the record. r: { src (a feed name), lat, lon, t (ms, the position's time), gsKt?,
 * altFt? }; cached: it came from a copy (a stored snapshot, the public relay). Returns the record.
 */
export function noteAircraftReport(rec, r, { now = Date.now(), keepMs = 150e3, cached = false } = {}) {
  if (!rec || !r) return rec;
  const src = AIR_SOURCE_ID[r.src] || String(r.src || 'adsb').toLowerCase().replace(/[^a-z0-9]/g, '') || 'adsb';
  const rep = { src, hex: rec.hex, lat: r.lat, lon: r.lon, t: Number.isFinite(r.t) ? r.t : null, gsKt: fin(r.gsKt), altFt: fin(r.altFt), cached: !!cached };
  const reps = (rec._reports || []).filter(x => x.src !== src && (x.t == null || now - x.t <= keepMs));
  reps.push(rep); rec._reports = reps;
  const newest = reps.reduce((m, x) => ((x.t ?? -Infinity) > (m.t ?? -Infinity) ? x : m));   // only reports close enough in time to compare count
  const near = reps.filter(x => x === newest || (x.t != null && newest.t != null && Math.abs(newest.t - x.t) <= AIR_AGREE.maxDtS * 1000));
  return stampReports(rec, 'aircraft', near, agreeingIds(near, sameAircraft), { cached: near.filter(x => x.cached).map(x => x.src) });
}
