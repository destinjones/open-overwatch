// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Aircraft records from the two kinds of feed both views read: readsb-style JSON (adsb.lol, adsb.fi, airplanes.live: feet,
// knots, ft/min) and OpenSky's state vectors (metres, m/s). One reader each, in the feeds' own units plus SI, so the 2D map
// (aviation units) and the globe (metres) keep their own maths without parsing twice. Pure (test/aircraft.test.mjs).

export const EMERGENCY_SQUAWKS = Object.freeze(['7500', '7600', '7700']);
export const FT = 0.3048, KT = 0.514444;
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
