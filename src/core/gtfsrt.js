// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// GTFS Realtime vehicle positions (the protobuf feed most transit agencies publish), read with the small protobuf reader
// the map tiles use (core/mvt.js). Only what a moving dot needs: FeedMessage → FeedEntity → VehiclePosition { trip,
// vehicle, position, current_status, timestamp, stop, occupancy }. Pure (test/gtfsrt.test.mjs).
import { Pbf } from './mvt.js';

/** VehicleStopStatus, in words (INCOMING_AT, STOPPED_AT, IN_TRANSIT_TO). */
export const GTFS_STATUS = ['arriving', 'at a stop', 'between stops'];
/** OccupancyStatus, in words (EMPTY … NOT_BOARDABLE; 7 is "no data"). */
export const GTFS_OCCUPANCY = ['empty', 'many seats free', 'few seats free', 'standing room only', 'crushed standing room', 'full', 'not taking passengers', '', 'not boardable'];

// each reader walks one message between r.p and `end`, skipping fields it doesn't know (and wire types it doesn't expect)
function trip(r, end) {
  const o = { tripId: '', routeId: '', dir: null, start: '' };
  while (r.p < end) {
    const [f, w] = r.key();
    if (f === 1 && w === 2) o.tripId = r.str(); else if (f === 5 && w === 2) o.routeId = r.str(); else if (f === 6 && w === 0) o.dir = r.varint();
    else if (f === 2 && w === 2) o.start = r.str(); else r.skip(w);
  }
  return o;
}
function position(r, end) {
  const o = { lat: null, lon: null, hdg: null, spd: null };
  while (r.p < end) {
    const [f, w] = r.key();
    if (w === 5 && f === 1) o.lat = r.f32(); else if (w === 5 && f === 2) o.lon = r.f32(); else if (w === 5 && f === 3) o.hdg = r.f32();
    else if (w === 5 && f === 5) o.spd = r.f32(); else r.skip(w);
  }
  return o;
}
function descriptor(r, end) {
  const o = { id: '', label: '', plate: '' };
  while (r.p < end) {
    const [f, w] = r.key();
    if (w === 2 && f === 1) o.id = r.str(); else if (w === 2 && f === 2) o.label = r.str(); else if (w === 2 && f === 3) o.plate = r.str(); else r.skip(w);
  }
  return o;
}
function vehiclePosition(r, end) {
  const o = { trip: null, pos: null, veh: null, status: null, t: null, stop: '', seq: null, occupancy: null };
  while (r.p < end) {
    const [f, w] = r.key();
    if (w === 2 && (f === 1 || f === 2 || f === 8)) { const [a, b] = r.bytes(), sub = new Pbf(r.b, a, b); if (f === 1) o.trip = trip(sub, b); else if (f === 2) o.pos = position(sub, b); else o.veh = descriptor(sub, b); }
    else if (w === 0 && f === 3) o.seq = r.varint(); else if (w === 0 && f === 4) o.status = r.varint(); else if (w === 0 && f === 5) o.t = r.varint();
    else if (w === 2 && f === 7) o.stop = r.str(); else if (w === 0 && f === 9) o.occupancy = r.varint(); else r.skip(w);
  }
  return o;
}

/**
 * A GTFS-RT feed (Uint8Array) → { t (the feed's own time, ms, or null), vehicles: [{ id, lat, lon, t (ms), spd (m/s or
 * null), hdg (deg or null), tripId, routeId, dir, vehicleId, label, plate, status, stop, occupancy }] }. Entities without a
 * position, deleted ones and other kinds (trip updates, alerts) are skipped. A vehicle's own time falls back to the feed's.
 */
export function parseVehiclePositions(buf) {
  const r = new Pbf(buf), out = { t: null, vehicles: [] };
  while (r.p < r.end) {
    const [f, w] = r.key();
    if (w !== 2 || (f !== 1 && f !== 2)) { r.skip(w); continue; }
    const [a, b] = r.bytes(), m = new Pbf(buf, a, b);
    if (f === 1) {   // FeedHeader: timestamp = 3
      while (m.p < b) { const [hf, hw] = m.key(); if (hf === 3 && hw === 0) out.t = m.varint() * 1000; else m.skip(hw); }
      continue;
    }
    let id = '', deleted = false, vp = null;   // FeedEntity: id = 1, is_deleted = 2, vehicle = 4
    while (m.p < b) {
      const [ef, ew] = m.key();
      if (ef === 1 && ew === 2) id = m.str(); else if (ef === 2 && ew === 0) deleted = m.varint() === 1;
      else if (ef === 4 && ew === 2) { const [va, vb] = m.bytes(); vp = vehiclePosition(new Pbf(buf, va, vb), vb); } else m.skip(ew);
    }
    const p = vp?.pos;
    if (deleted || !p || !(Math.abs(p.lat) <= 90) || !(Math.abs(p.lon) <= 180) || (p.lat === 0 && p.lon === 0)) continue;   // also drops NaN
    const fin = v => (Number.isFinite(v) ? v : null);   // a float32 field can hold NaN or Infinity
    out.vehicles.push({ id: vp.veh?.id || id, lat: p.lat, lon: p.lon, t: vp.t ? vp.t * 1000 : null, spd: fin(p.spd), hdg: fin(p.hdg),
      tripId: vp.trip?.tripId || '', routeId: vp.trip?.routeId || '', dir: vp.trip?.dir ?? null, vehicleId: vp.veh?.id || '', label: vp.veh?.label || '',
      plate: vp.veh?.plate || '', status: vp.status, stop: vp.stop, occupancy: vp.occupancy });
  }
  for (const v of out.vehicles) if (v.t == null) v.t = out.t;
  return out;
}

/** Write a FeedMessage (tests build feeds with this; agencies' own feeds are read with the parser above). */
export function encodeVehiclePositions({ t, vehicles }) {
  const bytes = [];
  const varint = (o, n) => { do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; o.push(b); } while (n); };
  const key = (o, f, w) => varint(o, f * 8 + w);
  const str = (o, f, s) => { const e = new TextEncoder().encode(s); key(o, f, 2); varint(o, e.length); o.push(...e); };
  const f32 = (o, f, x) => { key(o, f, 5); const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); o.push(...new Uint8Array(d.buffer)); };
  const sub = (o, f, inner) => { key(o, f, 2); varint(o, inner.length); o.push(...inner); };
  const head = []; str(head, 1, '2.0'); if (t != null) { key(head, 3, 0); varint(head, Math.round(t / 1000)); }
  sub(bytes, 1, head);
  for (const v of vehicles) {
    const tr = []; if (v.tripId) str(tr, 1, v.tripId); if (v.routeId) str(tr, 5, v.routeId); if (v.dir != null) { key(tr, 6, 0); varint(tr, v.dir); }
    const pos = []; f32(pos, 1, v.lat); f32(pos, 2, v.lon); if (v.hdg != null) f32(pos, 3, v.hdg); if (v.spd != null) f32(pos, 5, v.spd);
    const veh = []; if (v.vehicleId) str(veh, 1, v.vehicleId); if (v.label) str(veh, 2, v.label);
    const vp = []; sub(vp, 1, tr); sub(vp, 2, pos); if (v.status != null) { key(vp, 4, 0); varint(vp, v.status); } if (v.t != null) { key(vp, 5, 0); varint(vp, Math.round(v.t / 1000)); }
    if (v.stop) str(vp, 7, v.stop); sub(vp, 8, veh); if (v.occupancy != null) { key(vp, 9, 0); varint(vp, v.occupancy); }
    const ent = []; str(ent, 1, v.entity || v.vehicleId || 'e'); if (v.deleted) { key(ent, 2, 0); varint(ent, 1); } sub(ent, 4, vp);
    sub(bytes, 2, ent);
  }
  return Uint8Array.from(bytes);
}
