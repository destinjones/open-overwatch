// Traffic: simulated cars on real roads. No open feed says where individual cars are (it would be a privacy disaster),
// so the cars are a simulation on OpenStreetMap's road network: how many a road carries comes from its type and the local
// time, cars follow each other and stop at mapped traffic lights, and where a city publishes measured speeds and counts
// (NYC DOT link speeds, Fintraffic's roadside sensors) they drive at those. Pure (Node tests it); globe/traffic.js draws.

/** Per road class: free-flow speed (km/h, a town's), lanes each way, cars per km per lane at the busiest hour, one-way by default. */
export const ROAD = Object.freeze({
  motorway: { speed: 100, lanes: 3, density: 22, oneway: true }, motorway_link: { speed: 60, lanes: 1, density: 10, oneway: true },
  trunk: { speed: 80, lanes: 2, density: 20 }, trunk_link: { speed: 50, lanes: 1, density: 9, oneway: true },
  primary: { speed: 50, lanes: 2, density: 22 }, primary_link: { speed: 35, lanes: 1, density: 8 },
  secondary: { speed: 45, lanes: 1, density: 18 }, secondary_link: { speed: 35, lanes: 1, density: 7 },
  tertiary: { speed: 40, lanes: 1, density: 13 }, tertiary_link: { speed: 30, lanes: 1, density: 6 },
  unclassified: { speed: 40, lanes: 1, density: 5 }, residential: { speed: 30, lanes: 1, density: 4 }, living_street: { speed: 15, lanes: 1, density: 1.5 },
});
export const HIGHWAYS = Object.keys(ROAD);
export const LANE_W = 3.2, CAR = 4.6, TRUCK = 8.5;   // metres

/** "50", "30 mph", "50;30", "none", "RU:urban" -> km/h, or null. */
export function maxspeed(tag) {
  const s = String(tag || '').trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(mph|knots)?/); if (m) return Math.round(+m[1] * (m[2] === 'mph' ? 1.609 : m[2] === 'knots' ? 1.852 : 1));
  if (/urban/.test(s)) return 50; if (/rural/.test(s)) return 90; if (/motorway/.test(s)) return 120; if (/living_street/.test(s)) return 20;
  return null;
}

/** Driving on the left (ISO 3166-1 alpha-2). */
const LEFT = new Set('AG AI AU BB BD BM BN BS BT BW CK CY DM FJ FK GB GD GG GY HK ID IE IM IN JE JM JP KE KI KN KY LC LK LS MO MS MT MU MV MW MY MZ NA NP NR NZ PG PK PN SB SC SG SH SR SZ TC TH TK TL TO TT TV TZ UG VC VG VI WS ZA ZM ZW'.split(' '));
export const drivesLeft = iso => LEFT.has(String(iso || '').toUpperCase());

/** How busy the roads are (0-1) at a local hour: workdays peak around 8:00 and 17:30; weekends build to mid-afternoon. */
export function busyness(hour, weekend = false) {
  const h = ((hour % 24) + 24) % 24, bump = (c, w) => Math.exp(-(((h - c) / w) ** 2));
  if (weekend) return Math.min(1, 0.1 + 0.62 * bump(14, 4.5) + 0.12 * bump(20, 2.5));
  return Math.min(1, 0.12 + 0.75 * bump(8, 1.6) + 0.85 * bump(17.5, 2.0) + 0.45 * bump(13, 4.0));
}
/** Local solar time at a longitude: { hour, weekend }. Within an hour or so of the clock there, which is enough for traffic. */
export function localTime(utcMs, lon) {
  const t = new Date(utcMs + lon / 15 * 3600e3), day = t.getUTCDay();
  return { hour: t.getUTCHours() + t.getUTCMinutes() / 60, weekend: day === 0 || day === 6 };
}

const R = 6371008.8, D = Math.PI / 180;
export const dist = (a, b) => { const x = (b.lon - a.lon) * D * Math.cos((a.lat + b.lat) / 2 * D), y = (b.lat - a.lat) * D; return Math.hypot(x, y) * R; };
export const bearing = (a, b) => { const y = Math.sin((b.lon - a.lon) * D) * Math.cos(b.lat * D), x = Math.cos(a.lat * D) * Math.sin(b.lat * D) - Math.sin(a.lat * D) * Math.cos(b.lat * D) * Math.cos((b.lon - a.lon) * D); return ((Math.atan2(y, x) / D) + 360) % 360; };
/** The smallest angle between two bearings (0-180). */
export const turn = (a, b) => Math.abs(((b - a + 540) % 360) - 180);
const endHdg = e => bearing(e.pts[e.pts.length - 2], e.pts[e.pts.length - 1]), startHdg = e => bearing(e.pts[0], e.pts[1]);

/**
 * A directed road graph from Overpass ways (`out body geom`: nodes + geometry) and the ids of traffic-signal nodes. Ways
 * are cut at junctions (nodes two ways share) into edges; a two-way road gives an edge each way. Edge: { id, way, dir
 * (+1 along the way, -1 against), a (distance along the way where the edge starts, so a car's place survives a rebuild:
 * way distance = a + dir * s), cls, name, from, to, pts, cum, len, speed (km/h), lanes, density, oneway, stops: [{ s,
 * node, hdg }] (signals on the way, in travel order) }. Also: out (node -> edges leaving it), signals (node -> { off }), axis
 * (the street grid's main bearing, which sets the signal phases).
 */
export function buildGraph(ways, signalIds = []) {
  const uses = new Map(), sig = new Set(signalIds);
  for (const w of ways) if (w.nodes) for (const n of new Set(w.nodes)) uses.set(n, (uses.get(n) || 0) + 1);
  const out = new Map(), edges = [], sigAt = new Map();
  const add = e => { e.id = edges.length; edges.push(e); if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e); };
  for (const w of ways) {
    const t = w.tags || {}, base = ROAD[t.highway], n = w.nodes, g = w.geometry;
    if (!base || !n || !g || n.length !== g.length || n.length < 2) continue;
    if (/^(private|no)$/.test(t.access || '') || t.area === 'yes') continue;
    const ow = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.junction === 'roundabout' || t.junction === 'circular' || (base.oneway && t.oneway !== 'no');
    const rev = t.oneway === '-1' || t.oneway === 'reverse', one = ow || rev;
    const lanes = +t.lanes > 0 ? Math.max(1, Math.min(6, Math.round(+t.lanes / (one ? 1 : 2)))) : base.lanes;
    const speed = maxspeed(t.maxspeed) || base.speed, wc = [0];
    for (let k = 1; k < g.length; k++) wc.push(wc[k - 1] + dist(g[k - 1], g[k]));
    for (let k = 0; k < n.length; k++) if (sig.has(n[k])) sigAt.set(n[k], g[k]);
    let start = 0;
    for (let i = 1; i < n.length; i++) {
      if (i < n.length - 1 && (uses.get(n[i]) || 0) < 2) continue;   // cut only at junctions and the ends
      const idx = []; for (let k = start; k <= i; k++) idx.push(k);
      const mk = (ix, dir) => {
        const pts = ix.map(k => ({ lat: g[k].lat, lon: g[k].lon })), cum = ix.map(k => Math.abs(wc[k] - wc[ix[0]])), stops = [];
        for (let k = 1; k < ix.length; k++) if (sig.has(n[ix[k]])) stops.push({ s: cum[k], node: n[ix[k]], hdg: bearing(pts[k - 1], pts[k]) });
        return { way: w.id, dir, a: wc[ix[0]], cls: t.highway, name: t.name || t.ref || '', from: n[ix[0]], to: n[ix[ix.length - 1]], pts, cum,
          len: cum[cum.length - 1], speed, lanes, density: base.density, oneway: one, stops };
      };
      if (!rev) add(mk(idx, 1));
      if (!ow || rev) add(mk(idx.slice().reverse(), -1));
      start = i;
    }
  }
  // the grid's main bearing (mod 90), weighted by length: signals give one axis green, then the other
  const bins = new Float64Array(18);
  for (const e of edges) for (let k = 1; k < e.pts.length; k++) bins[Math.floor((bearing(e.pts[k - 1], e.pts[k]) % 90) / 5) % 18] += e.cum[k] - e.cum[k - 1];
  let best = 0; for (let b = 1; b < 18; b++) if (bins[b] > bins[best]) best = b;
  const axis = best * 5 + 2.5, signals = new Map(), ref = edges[0]?.pts[0];
  for (const [node, p] of sigAt) {   // a green wave along the axis: the offset grows with distance along it at ~40 km/h
    const x = ref ? dist(ref, p) * Math.cos((bearing(ref, p) - axis) * D) : 0;
    signals.set(node, { lat: p.lat, lon: p.lon, off: ((x / 11) % CYCLE + CYCLE) % CYCLE });
  }
  return { edges, out, signals, axis };
}

export const CYCLE = 70;   // s: half for each axis, the last 3 s of each half amber / all-red
export const STOP_BACK = 9;   // m: the stop line, back from the junction's middle (the node) by about half a street
/** Is the light green for a car heading `hdg` at a signal, `t` seconds into the day? */
export function green(sig, hdg, t, axis) {
  const rel = ((hdg - axis) % 180 + 180) % 180, main = rel < 45 || rel >= 135;
  const ph = (((t - sig.off) % CYCLE) + CYCLE) % CYCLE, half = CYCLE / 2;
  return main ? ph < half - 3 : ph >= half && ph < CYCLE - 3;
}

/** The next edge after `e`: no U-turn unless it's a dead end; prefer going straight on the same road and bigger roads. */
export function nextEdge(graph, e, rand = Math.random) {
  const opts = (graph.out.get(e.to) || []).filter(x => x.len > 0.5);
  const ahead = opts.filter(x => !(x.to === e.from && x.way === e.way));
  const list = ahead.length ? ahead : opts; if (!list.length) return null;
  const inB = endHdg(e);
  const w = list.map(x => { const tr = turn(inB, startHdg(x));
    return (x.way === e.way ? 3 : 1) * (x.name && x.name === e.name ? 2 : 1) * (1 + (ROAD[x.cls]?.density || 1) / 10) * (tr < 30 ? 2.5 : tr < 100 ? 1 : 0.15); });
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

/** Car following, simplified IDM: speed (m/s) after dt toward v0, held back by the gap (m) to the car ahead (Infinity if none). */
export function follow(v, v0, gap, vLead = 0, dt = 0.05) {
  const a = 1.6, b = 2.5, s0 = 2.5, T = 1.2;
  const sStar = s0 + Math.max(0, v * T + v * (v - vLead) / (2 * Math.sqrt(a * b)));
  const acc = a * (1 - (v / Math.max(0.5, v0)) ** 4 - (gap > 0 ? (sStar / gap) ** 2 : 100));
  return Math.max(0, Math.min(v0 * 1.15, v + Math.max(-9, acc) * dt));
}

/** The point and heading (deg) at distance s along an edge. */
export function along(e, s) {
  const c = e.cum; s = Math.max(0, Math.min(e.len, s));
  let i = 1; while (i < c.length - 1 && c[i] < s) i++;
  const a = e.pts[i - 1], b = e.pts[i], k = (s - c[i - 1]) / ((c[i] - c[i - 1]) || 1);
  return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, hdg: bearing(a, b) };
}

/** Metres right of the centre line (negative: left) for a lane: two-way roads keep to the driving side, one-ways spread out. */
export const laneOffset = (e, lane, left) => (e.oneway ? (lane - (e.lanes - 1) / 2) * LANE_W : (lane + 0.5) * LANE_W) * (left && !e.oneway ? -1 : 1);

/** Cars an edge should carry: from a measured count where there is one (flow / speed = cars per km), else type x time of day. */
export const expected = (e, busy) => e.meas && e.meas.flow > 0 && e.meas.kmh > 3 ? e.meas.flow / e.meas.kmh * e.len / 1000
  : (ROAD[e.cls]?.density || 2) * e.lanes * busy * e.len / 1000;

// ---- measured speeds -----------------------------------------------------------------------------------------------

/** A wall-clock time in a time zone ("2026-10-10T15:31:06.000", "America/New_York") -> UTC ms. */
export function zonedToUtc(local, tz) {
  const m = String(local || '').match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/); if (!m) return NaN;
  const guess = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const off = t => { const p = Object.fromEntries(fmt.formatToParts(t).map(x => [x.type, x.value])); return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t; };
  return guess - off(guess - off(guess));
}

/** NYC DOT "link_points" text ("lat,lon lat,lon …") -> [{ lat, lon }]. The text is cut at a fixed length, so a pair with
 *  fewer than 4 decimals (a cut-off number) is dropped. */
export function linkPoints(text) {
  const ok = s => /^-?\d{1,3}\.\d{4,}$/.test(s);
  return String(text || '').trim().split(/\s+/).map(p => p.split(',')).filter(p => p.length === 2 && ok(p[0]) && ok(p[1]))
    .map(([a, b]) => ({ lat: +a, lon: +b })).filter(p => Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
}

/** NYC DOT Traffic Speeds rows -> the latest reading per link: [{ id, name, borough, kmh, t, pts }]. Speed 0 means no reading. */
export function parseNyc(rows, tz = 'America/New_York') {
  const best = new Map();
  for (const r of rows || []) {
    const t = zonedToUtc(r.data_as_of, tz), mph = +r.speed;
    if (!Number.isFinite(t) || !(mph > 0) || mph > 120) continue;
    const old = best.get(r.link_id); if (old && old.t >= t) continue;
    const pts = linkPoints(r.link_points); if (pts.length < 2) continue;
    best.set(r.link_id, { id: String(r.link_id), name: String(r.link_name || ''), borough: String(r.borough || ''), kmh: mph * 1.609344, t, pts });
  }
  return [...best.values()];
}

/** Fintraffic TMS: station GeoJSON features + their data -> a reading per direction: [{ lat, lon, kmh, flow (cars/h), bearing,
 *  t, name }]. Direction 1 travels along the station's bearing, direction 2 the opposite way. */
export function parseTms(features, data) {
  const at = new Map((features || []).map(f => [f.properties?.id ?? f.id, f])), out = [];
  for (const d of data || []) {
    const f = at.get(d.id), b = f?.properties?.bearing; if (!f || b == null || !f.geometry) continue;
    const [lon, lat] = f.geometry.coordinates, val = name => (d.sensorValues || []).find(s => s.name === name);
    for (const [k, hdg] of [[1, b], [2, (b + 180) % 360]]) {
      const sp = val('KESKINOPEUS_5MIN_LIUKUVA_SUUNTA' + k), fl = val('OHITUKSET_5MIN_LIUKUVA_SUUNTA' + k);
      if (!sp || !(sp.value > 0) || sp.value > 200) continue;
      out.push({ lat, lon, kmh: sp.value, flow: fl && fl.value >= 0 ? fl.value : null, bearing: hdg, t: Date.parse(sp.measuredTime) || Date.parse(d.dataUpdatedTime), name: String(f.properties.name || '') });
    }
  }
  return out;
}

/** Metres from p to the segment a-b (a local flat projection: fine over a few hundred metres). */
function segDist(p, a, b) {
  const k = Math.cos(p.lat * D) * R * D, ax = (a.lon - p.lon) * k, ay = (a.lat - p.lat) * R * D, bx = (b.lon - p.lon) * k, by = (b.lat - p.lat) * R * D;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, u = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + u * dx, ay + u * dy);
}

/**
 * Put measured readings on edges (e.meas = { kmh, flow, t, src, name }). Points (roadside sensors) colour main roads within
 * 400 m heading the same way; links (polylines, NYC) colour roads whose middle lies within 30 m of a link segment heading
 * the same way. Returns how many edges got a reading.
 */
export function matchSpeeds(edges, points = [], links = []) {
  let n = 0;
  const segs = [];
  for (const l of links) for (let k = 1; k < l.pts.length; k++) segs.push({ a: l.pts[k - 1], b: l.pts[k], hdg: bearing(l.pts[k - 1], l.pts[k]), l });
  for (const e of edges) {
    e.meas = null;
    const mid = along(e, e.len / 2);
    if (points.length && /^(motorway|trunk|primary)$/.test(e.cls)) {
      let bd = 400;
      for (const m of points) { const d = dist(mid, m); if (d < bd && turn(m.bearing, mid.hdg) < 50) { bd = d; e.meas = { kmh: m.kmh, flow: m.flow, t: m.t, src: 'fintraffic', name: m.name }; } }
    }
    if (!e.meas && segs.length && /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(e.cls)) {
      let bd = 30;
      for (const s of segs) {
        if (Math.abs(s.a.lat - mid.lat) > 0.01 && Math.abs(s.b.lat - mid.lat) > 0.01) continue;
        const d = segDist(mid, s.a, s.b); if (d < bd && turn(s.hdg, mid.hdg) < 40) { bd = d; e.meas = { kmh: s.l.kmh, flow: null, t: s.l.t, src: 'nyc', name: s.l.name }; }
      }
    }
    if (e.meas) n++;
  }
  return n;
}

// ---- the simulation ------------------------------------------------------------------------------------------------

/**
 * Cars on a graph, inside a circle (the area in view). `fit(n)` sets how many; `step(dt, t)` moves them: each follows the
 * car ahead in its lane (also across into the next edge), slows for turns, stops at red lights it can stop for, and picks
 * its next edge (nextEdge) as it enters one. A car that leaves the circle comes back in: at a random place while the
 * circle is short of cars (after a move), else on a road leading in at the rim. Car: { e, s, v, lane, next, drv, len, i, born }.
 */
export class Sim {
  constructor({ rand = Math.random, onAdd = () => {}, onRemove = () => {}, proto = Object.prototype } = {}) {   // proto: what cars inherit (cards, getters)
    Object.assign(this, { rand, onAdd, onRemove, proto, g: { edges: [], out: new Map(), signals: new Map(), axis: 0 }, cars: [], clock: 0, tod: 0, busy: 1,
      centre: null, R: 1000, w: null, rim: null, inside: 0, nextId: 1, live: new Set() });
  }
  /** A new graph: cars keep their place (by way, direction and distance along the way); those whose road is gone leave. */
  setGraph(g) {
    const byWay = new Map();
    for (const e of g.edges) { e.q = Array.from({ length: e.lanes }, () => []); const k = e.way + (e.dir > 0 ? '+' : '-'); (byWay.get(k) || byWay.set(k, []).get(k)).push(e); }
    this.g = g; this.live = new Set();
    for (const c of [...this.cars]) {
      const wd = c.e.a + c.e.dir * c.s, cand = byWay.get(c.e.way + (c.e.dir > 0 ? '+' : '-')) || [];
      const e = cand.find(x => { const s = (wd - x.a) * x.dir; return s >= -0.01 && s <= x.len + 0.01; });
      if (!e) { this.remove(c); continue; }
      c.e = e; c.s = Math.max(0, Math.min(e.len, (wd - e.a) * e.dir)); c.lane = Math.min(c.lane, e.lanes - 1); c.next = null; c.i = 1;
      this.enter(c, true);
    }
    this.zone(this.centre, this.R);
  }
  /** The circle the cars live in (centre { lat, lon }, radius m) and the time of day's busyness. */
  zone(centre, R, busy = this.busy) {
    this.centre = centre; this.R = R; this.busy = busy;
    if (!centre) { this.w = this.rim = null; return; }
    const w = [], rim = [];
    for (const e of this.g.edges) {
      const a = dist(centre, e.pts[0]), b = dist(centre, e.pts[e.pts.length - 1]), x = expected(e, busy);
      if (Math.min(a, b) < R && x > 0) w.push([e, x]);
      if (a > 0.75 * R && a < R * 1.1 && b < a && x > 0) rim.push([e, x]);
    }
    const cum = list => { let s = 0; return { list: list.map(([e]) => e), acc: list.map(([, x]) => (s += x)), total: s }; };
    this.w = cum(w); this.rim = cum(rim);
  }
  /** How many cars the circle should hold now (before any cap). */
  wanted() { return this.w ? this.w.total : 0; }
  pick(set) {
    if (!set || !set.total) return null;
    const r = this.rand() * set.total; let lo = 0, hi = set.acc.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (set.acc[m] < r) lo = m + 1; else hi = m; }
    return set.list[lo];
  }
  /** Place a car: on a road leading in at the rim (s = 0), or anywhere in the circle; false if there is no road. */
  place(c, rim) {
    for (let tries = 0; tries < 6; tries++) {
      const e = (rim && this.pick(this.rim)) || this.pick(this.w); if (!e) return false;
      const lane = Math.floor(this.rand() * e.lanes), s = rim ? 0 : this.rand() * e.len, q = e.q[lane];
      if (q.some(o => Math.abs(o.s - s) < 12)) continue;   // too close to another car
      if (c.e) this.leave(c);
      Object.assign(c, { e, s, lane, v: Math.min(e.speed / 3.6, 8) * (rim ? 1 : this.rand()), next: null, i: 1, born: this.clock, go: null });
      this.enter(c); return true;
    }
    return false;
  }
  add() {
    const c = Object.assign(Object.create(this.proto), { kind: 'car', id: this.nextId++, e: null, s: 0, v: 0, lane: 0, next: null, vt: 99, i: 1, go: null, drv: 0.86 + this.rand() * 0.2, born: this.clock });
    c.truck = this.rand() < 0.07; c.len = c.truck ? TRUCK : CAR; c.look = Math.floor(this.rand() * 1e6);
    if (!this.place(c, false)) return null;
    this.cars.push(c); this.onAdd(c); return c;
  }
  remove(c) { if (c.e) this.leave(c); const i = this.cars.indexOf(c); if (i >= 0) this.cars.splice(i, 1); this.onRemove(c); }
  /** Add or remove cars toward n (removing the ones farthest from the centre first). */
  fit(n) {
    n = Math.max(0, Math.round(n));
    for (let k = 0; this.cars.length < n && k < 600; k++) if (!this.add()) break;
    if (this.cars.length > n && this.centre) {
      const far = this.cars.map(c => [c, dist(this.centre, c.e.pts[0])]).sort((a, b) => b[1] - a[1]).slice(0, this.cars.length - n);
      for (const [c] of far) this.remove(c);
    }
  }
  enter(c, keep) {
    const q = c.e.q[c.lane]; let i = q.length; while (i > 0 && q[i - 1].s < c.s) i--;   // ordered front (largest s) to back
    q.splice(i, 0, c); this.live.add(c.e);
    if (!keep || !c.next) c.next = nextEdge(this.g, c.e, this.rand);
    const tr = c.next ? turn(endHdg(c.e), startHdg(c.next)) : 0;   // how slow to take the turn onto it (m/s)
    c.vt = tr > 150 ? 2.5 : tr > 60 ? 4.5 : tr > 30 ? 8 : 99;
  }
  leave(c) {
    const q = c.e.q[c.lane], i = q.indexOf(c); if (i >= 0) q.splice(i, 1);
    if (c.e.q.every(x => !x.length)) this.live.delete(c.e);
  }
  /** Advance every car by dt seconds; tod = seconds into the day (for the lights). */
  step(dt, tod) {
    this.clock += dt; this.tod = tod; const g = this.g, t = tod;
    for (const e of this.live) for (const q of e.q) for (let i = 0; i < q.length; i++) {
      const c = q[i], v0road = (e.meas && e.meas.kmh > 3 ? Math.min(e.meas.kmh * 1.1, e.speed) : e.speed) / 3.6;
      let v0 = v0road * c.drv, gap = Infinity, vLead = 0;
      if (i > 0) { gap = q[i - 1].s - q[i - 1].len - c.s; vLead = q[i - 1].v; }
      else if (c.next) {   // the last car in the next edge's lane
        const nq = c.next.q[Math.min(c.lane, c.next.lanes - 1)], o = nq[nq.length - 1];
        if (o) { gap = e.len - c.s + o.s - o.len; vLead = o.v; }
      }
      const toEnd = e.len - c.s;
      if (c.next && toEnd < 45 && c.vt < v0) v0 = c.vt + (toEnd / 45) * (v0 - c.vt);   // slow for the turn ahead
      for (const st of e.stops) {   // the next light on this edge
        if (st.s < c.s - 0.5) continue;
        const sig = g.signals.get(st.node), d = st.s - c.s - STOP_BACK;
        if (sig && c.go !== st.node) {
          if (green(sig, st.hdg, t, g.axis)) { if (d < c.v * c.v / 5 + 2) c.go = st.node; }   // past the point of stopping: keep going
          else if (d < c.v * c.v / 8) c.go = st.node;   // too close to stop when it changed
          else if (d < gap) { gap = d; vLead = 0; }
        }
        break;
      }
      c.vn = follow(c.v, v0, gap, vLead, dt);
    }
    const moved = [];
    for (const e of this.live) for (const q of e.q) for (let i = 0; i < q.length; i++) {
      const c = q[i]; c.v = c.vn ?? c.v; c.s += c.v * dt;
      const lim = i > 0 ? q[i - 1].s - q[i - 1].len - 0.3 : Infinity;   // never into the car ahead
      if (c.s > lim) { c.s = Math.max(lim, c.s - c.v * dt); c.v = Math.min(c.v, q[i - 1].v); }
      if (c.s >= e.len) moved.push(c);
    }
    for (const c of moved) this.onward(c);
  }
  /** A car past the end of its edge: onto the next one, or back into the circle if it left it (or hit a dead end). */
  onward(c) {
    for (let hop = 0; c.s >= c.e.len && hop < 8; hop++) {
      const nx = c.next, end = c.e.pts[c.e.pts.length - 1];
      if (!nx || (this.centre && dist(this.centre, end) > this.R * 1.15)) {
        const short = this.inCircle() < 0.85 * this.wanted();
        if (!this.place(c, !short)) this.remove(c);
        return;
      }
      const s = c.s - c.e.len; this.leave(c);
      c.e = nx; c.s = s; c.i = 1; c.go = null;
      if (c.lane >= nx.lanes || (nx.lanes > 1 && this.rand() < 0.15)) c.lane = Math.floor(this.rand() * nx.lanes);
      c.next = null; this.enter(c);
    }
  }
  /** Cars inside the circle now (counted at most twice a second). */
  inCircle() {
    if (this.clock - (this._ct ?? -9) < 0.5 && this._ci != null) return this._ci;
    this._ct = this.clock; let n = 0;
    if (this.centre) for (const c of this.cars) if (dist(this.centre, c.e.pts[0]) < this.R) n++;
    return (this._ci = n);
  }
}
