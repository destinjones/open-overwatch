// Live transit, the pure parts: feed parsers (MBTA, Entur, HSL), a minimal MQTT 3.1.1 codec for HSL's WebSocket broker,
// GTFS-RT agencies (Austin, Minneapolis), and the motion model that turns a fix every few seconds into steady movement.
// No DOM, no Cesium (test/transit.test.mjs).
//
// A fix is { id, t (ms, the vehicle's own report time), lat, lon, spd (m/s or null), hdg (deg or null), mode, line,
// dest, vehicle, delay (s late, or null), ... }. Modes: bus, tram, lightrail, metro, rail, ferry.

import { GTFS_STATUS } from './gtfsrt.js';

const M_PER_DEG = 111320, D2R = Math.PI / 180;
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);

// ---- parsers

// GTFS route_type as MBTA uses it
const MBTA_MODE = { 0: 'tram', 1: 'metro', 2: 'rail', 3: 'bus', 4: 'ferry' };
const MBTA_STATUS = { STOPPED_AT: 'at a stop', INCOMING_AT: 'arriving', IN_TRANSIT_TO: 'between stops' };
/** MBTA v3 /vehicles (JSON:API, include=route,trip) → fixes. */
export function parseMbta(doc) {
  const inc = new Map();
  for (const r of doc?.included || []) inc.set(r.type + ':' + r.id, r.attributes || {});
  const out = [];
  for (const v of doc?.data || []) {
    const a = v.attributes || {}, rel = v.relationships || {}, lat = num(a.latitude), lon = num(a.longitude), t = Date.parse(a.updated_at);
    if (lat == null || lon == null || !Number.isFinite(t)) continue;
    const routeId = rel.route?.data?.id || '', route = inc.get('route:' + routeId) || {}, trip = inc.get('trip:' + rel.trip?.data?.id) || {};
    out.push({ id: 'mbta:' + v.id, t, lat, lon, spd: num(a.speed), hdg: num(a.bearing), mode: MBTA_MODE[route.type] || 'bus',
      line: route.short_name || route.long_name || routeId, lineName: route.long_name || '', color: /^[0-9a-f]{6}$/i.test(route.color || '') ? '#' + route.color : null,
      dest: trip.headsign || '', vehicle: a.label || '', status: MBTA_STATUS[a.current_status] || '', delay: null, operator: 'MBTA' });
  }
  return out;
}

const ENTUR_MODE = { BUS: 'bus', COACH: 'bus', TRAM: 'tram', METRO: 'metro', RAIL: 'rail', FERRY: 'ferry', WATER: 'ferry' };
/** The Entur GraphQL query for a box (lat/lon degrees). */
export const enturQuery = (s, w, n, e) => `{ vehicles(boundingBox:{minLat:${+s},minLon:${+w},maxLat:${+n},maxLon:${+e}}) { vehicleId mode lastUpdatedEpochSecond speed bearing location { latitude longitude } line { publicCode lineName } destinationName delay codespace { codespaceId } operator { name } } }`;
/** Entur realtime/v2/vehicles GraphQL response → fixes. Its speed is km/h (SIRI VM). */
export function parseEntur(doc) {
  const out = [];
  for (const v of doc?.data?.vehicles || []) {
    const lat = num(v.location?.latitude), lon = num(v.location?.longitude), t = num(v.lastUpdatedEpochSecond);
    if (lat == null || lon == null || t == null || !v.vehicleId) continue;
    const code = v.codespace?.codespaceId || '', spd = num(v.speed);
    out.push({ id: 'entur:' + code + ':' + v.vehicleId, t: t * 1000, lat, lon, spd: spd == null ? null : spd / 3.6, hdg: num(v.bearing),
      mode: ENTUR_MODE[v.mode] || 'bus', line: v.line?.publicCode || '', lineName: v.line?.lineName || '', color: null,
      dest: v.destinationName || '', vehicle: '', status: '', delay: num(v.delay), operator: v.operator?.name || code });
  }
  return out;
}

/**
 * GTFS-RT vehicle positions (core/gtfsrt.js: parseVehiclePositions) → fixes. `routes`: route_id → [mode, name, line]
 * for the routes that aren't buses (the feed itself carries no route names or modes). Vehicles without a route are out
 * of service (driving to a garage, parked) and are left out.
 */
export function fromGtfsRt(feed, { prefix, operator, routes = {} }) {
  const out = [];
  for (const v of feed?.vehicles || []) {
    if (!v.routeId || !Number.isFinite(v.t)) continue;
    const r = routes[v.routeId] || [];
    out.push({ id: prefix + ':' + v.id, t: v.t, lat: v.lat, lon: v.lon, spd: v.spd != null && v.spd >= 0 && v.spd < 100 ? v.spd : null, hdg: v.hdg,
      mode: r[0] || 'bus', line: r[2] || v.routeId, lineName: r[1] || '', color: null, dest: '', vehicle: v.label || v.vehicleId,
      status: GTFS_STATUS[v.status] || '', delay: null, operator });
  }
  return out;
}

const HSL_MODE = { bus: 'bus', ubus: 'bus', robot: 'bus', tram: 'tram', metro: 'metro', train: 'rail', ferry: 'ferry' };
/**
 * One HSL high-frequency positioning message → a fix, or null. Topic:
 * /hfp/v2/journey/ongoing/vp/<mode>/<operator>/<vehicle>/<route>/<direction>/<headsign>/<start>/<next stop>/<geohash level>/<geohash>/…
 * `dl` is seconds ahead of schedule (negative = late), so it is negated into `delay`.
 */
export function parseHfp(topic, text) {
  const p = String(topic).split('/');
  if (p[1] !== 'hfp' || p[5] !== 'vp') return null;
  let vp; try { vp = JSON.parse(text).VP; } catch (e) { return null; }
  const lat = num(vp?.lat), lon = num(vp?.long), t = Date.parse(vp?.tst);
  if (lat == null || lon == null || !Number.isFinite(t)) return null;
  const dl = num(vp.dl);
  return { id: 'hsl:' + p[7] + '/' + p[8], t, lat, lon, spd: num(vp.spd), hdg: num(vp.hdg), mode: HSL_MODE[p[6]] || 'bus',
    line: vp.desi != null ? String(vp.desi) : '', lineName: '', color: null, dest: p[11] || '', vehicle: String(vp.veh ?? p[8]),
    status: vp.drst === 1 ? 'doors open' : '', delay: dl == null ? null : -dl, operator: 'HSL' };
}

// ---- MQTT 3.1.1, just enough to subscribe at QoS 0 (CONNECT, SUBSCRIBE, PINGREQ, DISCONNECT out; CONNACK, SUBACK,
// PUBLISH, PINGRESP in). The npm client is 330 KB as an ES module; this is all a read-only subscriber needs.
const enc = new TextEncoder(), dec = new TextDecoder();
function packet(type, body) {
  const len = []; let n = body.length;
  do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; len.push(b); } while (n);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = type; out.set(len, 1); out.set(body, 1 + len.length);
  return out;
}
function str(s) { const b = enc.encode(s), o = new Uint8Array(2 + b.length); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; }
const cat = parts => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };

export const mqtt = {
  /** CONNECT with a clean session and no credentials. */
  connect: (clientId, keepAlive = 60) => packet(0x10, cat([str('MQTT'), Uint8Array.of(4, 0x02, keepAlive >> 8, keepAlive & 255), str(clientId)])),
  /** SUBSCRIBE to topic filters at QoS 0. */
  subscribe: (id, topics) => packet(0x82, cat([Uint8Array.of(id >> 8, id & 255), ...topics.flatMap(t => [str(t), Uint8Array.of(0)])])),
  unsubscribe: (id, topics) => packet(0xa2, cat([Uint8Array.of(id >> 8, id & 255), ...topics.map(str)])),
  ping: () => Uint8Array.of(0xc0, 0),
  disconnect: () => Uint8Array.of(0xe0, 0),
  /** A stream reader: feed it bytes as they arrive (a packet may span WebSocket frames, a frame may hold several);
   *  it returns the packets completed so far: { type, code? (CONNACK), topic + payload (PUBLISH, payload as text) }. */
  reader() {
    let buf = new Uint8Array(0);
    return chunk => {
      buf = buf.length ? cat([buf, chunk]) : chunk;
      const out = [];
      for (;;) {
        let len = 0, mul = 1, i = 1, b;
        do { if (i >= buf.length) return keep(out); b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128 && i < 5);
        if (buf.length < i + len) return keep(out);
        const type = buf[0] >> 4, body = buf.subarray(i, i + len);
        if (type === 3) {
          const tl = (body[0] << 8) | body[1], qos = (buf[0] >> 1) & 3, start = 2 + tl + (qos ? 2 : 0);
          out.push({ type, topic: dec.decode(body.subarray(2, 2 + tl)), payload: dec.decode(body.subarray(start)) });
        } else out.push(type === 2 ? { type, code: body[1] } : { type });
        buf = buf.subarray(i + len);
      }
      function keep(o) { buf = buf.slice(); return o; }   // copy the remainder so the caller's chunk can be reused
    };
  },
};

// ---- motion

/**
 * Add a fix to a vehicle's recent track (oldest first, last 4). Repeats and out-of-order fixes are ignored; the gap
 * between real fixes is tracked (ms, smoothed) so the vehicle can be drawn far enough behind live to stay between them.
 * `at` = { t, lat, lon }: where the vehicle is drawn now and for what time. If that is past the last fix (it was held or
 * dead-reckoned through a long silence) the drawn point becomes a fix too, so it sets off from where it is instead of
 * leaping to wherever the line between the old and new fix has got to.
 */
export function addFix(v, f, at) {
  const fx = v.fixes || (v.fixes = []), last = fx[fx.length - 1];
  if (last && f.t <= last.t) return false;
  // gaps under 2 s are HSL's one-second sweep, not the rate the vehicle will report at; a long stop isn't a slow feed
  const prev = v.lastT ?? last?.t;
  if (prev != null && f.t - prev >= 2000) { const dt = Math.min(f.t - prev, 60e3); v.gap = v.gap == null ? dt : v.gap * 0.7 + dt * 0.3; }
  if (last && at && at.t > last.t && at.t < f.t) fx.push({ t: at.t, lat: at.lat, lon: at.lon, spd: null, hdg: null });
  fx.push({ t: f.t, lat: f.lat, lon: f.lon, spd: f.spd, hdg: f.hdg });
  while (fx.length > 4) fx.shift();
  v.lastT = f.t;
  return true;
}

/** Bearing (deg) and length (m) of a short hop, flat-Earth (fine for a few km). */
function hop(a, b) {
  const dy = (b.lat - a.lat) * M_PER_DEG, dx = (b.lon - a.lon) * M_PER_DEG * Math.cos(a.lat * D2R);
  return { d: Math.hypot(dx, dy), hdg: (Math.atan2(dx, dy) / D2R + 360) % 360 };
}
function move(p, dist, hdg, out) {
  out.lat = p.lat + dist * Math.cos(hdg * D2R) / M_PER_DEG;
  out.lon = p.lon + dist * Math.sin(hdg * D2R) / (M_PER_DEG * Math.cos(p.lat * D2R));
}

/**
 * Where a vehicle was at time t (ms), into out { lat, lon, hdg }: between two fixes, along the straight line; past the
 * last fix, dead-reckoned for at most `maxDr` ms (its reported speed and heading, else the last hop's), then held.
 * Returns 'interp', 'dr', 'hold' or null (no fixes).
 */
export function sample(fixes, t, out, maxDr = 15e3) {
  const n = fixes?.length || 0;
  if (!n) return null;
  const last = fixes[n - 1];
  if (t >= last.t) {
    let spd = last.spd, hdg = last.hdg;
    if ((spd == null || hdg == null) && n > 1) {
      const prev = fixes[n - 2], dt = last.t - prev.t;
      if (dt > 0 && dt <= 120e3) { const h = hop(prev, last); if (spd == null) spd = h.d / (dt / 1000); if (hdg == null) hdg = h.hdg; }
    }
    const s = Math.min(t - last.t, maxDr) / 1000;
    out.hdg = hdg;
    if (spd > 0.3 && hdg != null && s > 0 && spd < 70) { move(last, spd * s, hdg, out); return 'dr'; }
    out.lat = last.lat; out.lon = last.lon; return 'hold';
  }
  if (t <= fixes[0].t) { out.lat = fixes[0].lat; out.lon = fixes[0].lon; out.hdg = fixes[0].hdg; return 'hold'; }
  let i = n - 2; while (i > 0 && fixes[i].t > t) i--;
  const a = fixes[i], b = fixes[i + 1], k = (t - a.t) / (b.t - a.t);
  out.lat = a.lat + (b.lat - a.lat) * k; out.lon = a.lon + (b.lon - a.lon) * k;
  const h = hop(a, b); out.hdg = h.d > 2 ? h.hdg : (b.hdg ?? a.hdg);
  return 'interp';
}

/** Ease a drawn position toward its target (time constant tau ms), so a revised dead-reckoning glides instead of
 *  jumping. Farther than `snap` metres (a first fix, a GPS glitch) it jumps. Returns the distance it was off (m). */
export function ease(p, target, dt, tau = 1200, snap = 3000) {
  const off = hop(p, target).d;
  const k = off > snap || !(dt > 0) ? 1 : 1 - Math.exp(-dt / tau);
  p.lat += (target.lat - p.lat) * k; p.lon += (target.lon - p.lon) * k;
  return off;
}

/** Move `cur` toward `target` by at most `step`: changes the playback delay slowly (time runs at 0.8–1.2x), never in jumps. */
export const approach = (cur, target, step) => cur + Math.max(-step, Math.min(step, target - cur));

/**
 * A feed's clock against ours: the smallest (arrival time − fix time) seen ≈ clock offset + latency. Taken over a
 * window (a batch, or `win` ms of a stream) and smoothed, so one fast or slow device clock doesn't put every vehicle
 * permanently in dead reckoning.
 */
export function lagMeter(win = 15e3) {
  let min = Infinity, start = -Infinity, value = 0, ok = false;
  return {
    note(age, now) {
      if (now - start >= win) { if (min < Infinity) { value = ok ? value * 0.5 + min * 0.5 : min; ok = true; } min = Infinity; start = now; }
      if (age < min) min = age;
      if (!ok) value = min;
    },
    get value() { return value; },
  };
}

/** Is (lat, lon) inside an area: a circle { lat, lon, r (m) } or a box { box: [s, w, n, e] }? Flat-Earth, fine at 150 km. */
export function inArea(a, lat, lon) {
  if (a.box) return lat >= a.box[0] && lat <= a.box[2] && lon >= a.box[1] && lon <= a.box[3];
  return hop(a, { lat, lon }).d <= a.r;
}
