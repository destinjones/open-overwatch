// Which runways an airport has been using: landings and take-offs found in the flight trails (the moment a trail goes
// from airborne to on the ground, or back), each matched to the runway the plane was lined up with on its way down or
// rolled along on its way up, kept for an hour or two and summed per runway end. Airports change runways when the wind
// turns, so the log also says when the flow changed ("arrivals moved from 16 to 34 about 14:10Z"). DOM-free.

import { gcKm, bearing } from './actype.js';
import { linedUp } from './runways.js';

const RAD = Math.PI / 180;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Landings and take-offs in a trail's points ({ t, lat, lon, alt, ground }, oldest first) after time `since`:
 * [{ kind: 'landing'|'takeoff', i (the first point in the new state), t, lat, lon }]. Gaps over 5 minutes between the
 * two points say nothing (the plane may have done anything meanwhile).
 */
export function detectMoves(pts, since = -Infinity) {
  const out = [];
  for (let i = 1; i < (pts || []).length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.t <= since || a.ground === b.ground || b.t - a.t > 5 * 60e3) continue;
    out.push({ kind: b.ground ? 'landing' : 'takeoff', i, t: b.ground ? b.t : a.t, lat: b.ground ? b.lat : a.lat, lon: b.ground ? b.lon : a.lon });
  }
  return out;
}

/** Where a point is relative to a runway end's centre line: { along (m from the threshold, + down the runway), cross (m) }. */
export function onLine(end, p) {
  const km = gcKm(end.lat, end.lon, p.lat, p.lon), brg = bearing(end.lat, end.lon, p.lat, p.lon), d = (brg - end.hdg) * RAD;
  return { along: km * 1000 * Math.cos(d), cross: Math.abs(km * 1000 * Math.sin(d)) };
}
const lengthM = end => { const o = end.rw && end.rw.ends.find(e => e !== end); return o ? gcKm(end.lat, end.lon, o.lat, o.lon) * 1000 : 3000; };

/**
 * The runway end a landing used: the airborne points of the last 5 minutes before touchdown vote for the end they were
 * lined up with (core/runways.js linedUp, with the track from one point to the next), and the touchdown itself votes
 * twice for the end whose runway it is on (within 150 m of the centre line, between the thresholds) and whose heading
 * matches the way the plane was moving. Returns { end, votes, of } or null.
 */
export function landingRunway(runways, pts, i) {
  const votes = new Map(), add = (end, w) => votes.set(end, (votes.get(end) || 0) + w);
  const tdn = pts[i], t0 = tdn.t - 5 * 60e3;
  let of = 0;
  for (let j = i - 1; j >= 0 && pts[j].t >= t0; j--) {
    const a = pts[j], b = pts[j + 1];
    if (a.ground || gcKm(a.lat, a.lon, b.lat, b.lon) < 0.08) continue;
    const p = { lat: a.lat, lon: a.lon, track: bearing(a.lat, a.lon, b.lat, b.lon), ground: false };
    of++;
    for (const rw of runways || []) for (const end of rw.ends) if (linedUp(end, p)) add(end, 1);
  }
  const prev = pts[i - 1], move = prev && gcKm(prev.lat, prev.lon, tdn.lat, tdn.lon) > 0.08 ? bearing(prev.lat, prev.lon, tdn.lat, tdn.lon) : null;
  for (const rw of runways || []) for (const end of rw.ends) {
    const l = onLine(end, tdn);
    if (l.cross < 150 && l.along > -300 && l.along < lengthM(end) + 300 && (move == null || angDiff(move, end.hdg) < 30)) { add(end, move == null ? 1 : 2); of++; }
  }
  return best(votes, of);
}

/**
 * The runway end a take-off used: the last ground point and the first airborne points (up to 3 minutes after lift-off)
 * vote for the end whose centre line they sit on (within 300 m on the runway, 4° further out) and whose heading they
 * move along (within 25°). Returns { end, votes, of } or null.
 */
export function takeoffRunway(runways, pts, i) {
  const votes = new Map(), add = (end, w) => votes.set(end, (votes.get(end) || 0) + w);
  const lift = pts[i - 1], t1 = lift.t + 3 * 60e3;
  let of = 0;
  for (let j = i - 1; j < pts.length - 1 && pts[j].t <= t1; j++) {
    const a = pts[j], b = pts[j + 1];
    if (gcKm(a.lat, a.lon, b.lat, b.lon) < 0.08) continue;
    const trk = bearing(a.lat, a.lon, b.lat, b.lon);
    of++;
    for (const rw of runways || []) for (const end of rw.ends) {
      if (angDiff(trk, end.hdg) > 25) continue;
      const l = onLine(end, b), len = lengthM(end);
      if (l.along < -300) continue;
      const beyond = Math.max(0, l.along - len);
      if (l.cross < Math.max(300, beyond * Math.tan(4 * RAD)) && beyond < 15000) add(end, j === i - 1 ? 2 : 1);
    }
  }
  return best(votes, of);
}

function best(votes, of) {
  let end = null, n = 0;
  for (const [e, v] of votes) if (v > n) { end = e; n = v; }
  return end ? { end, votes: n, of } : null;
}

/**
 * The log: events { icao, rwy (the end's ident), kind, t, hex, flight } for the last `keepMin` minutes. add() ignores a
 * second event of the same kind for a plane within 10 minutes (a bounce, a trail that flickers on the ground).
 */
export class RunwayLog {
  constructor({ keepMin = 120 } = {}) { this.keepMs = keepMin * 60e3; this.events = []; }
  add(ev) {
    if (!ev || !ev.icao || !ev.kind || !Number.isFinite(ev.t)) return false;
    if (this.events.some(e => e.hex === ev.hex && e.kind === ev.kind && Math.abs(e.t - ev.t) < 10 * 60e3)) return false;
    this.events.push({ icao: ev.icao, rwy: ev.rwy || '', kind: ev.kind, t: ev.t, hex: ev.hex || '', flight: ev.flight || '' });
    this.events.sort((a, b) => a.t - b.t);
    return true;
  }
  prune(now = Date.now()) { const cut = now - this.keepMs; this.events = this.events.filter(e => e.t >= cut); }
  /**
   * An airport's last `minutes`: { arrivals: [{ rwy, n, last }], departures: [...], unknown: { arrivals, departures }
   * (seen but not matched to a runway), total, change: { kind, from, to, at } | null } — most used first. The change is
   * the latest moment the runway a kind used differs from the one used before it, when both were used at least twice.
   */
  summary(icao, now = Date.now(), minutes = 60) {
    const cut = now - minutes * 60e3, ev = this.events.filter(e => e.icao === icao && e.t >= cut && e.t <= now + 60e3);
    const tally = kind => {
      const m = new Map();
      for (const e of ev) if (e.kind === kind && e.rwy) { const x = m.get(e.rwy) || m.set(e.rwy, { rwy: e.rwy, n: 0, last: 0 }).get(e.rwy); x.n++; x.last = Math.max(x.last, e.t); }
      return [...m.values()].sort((a, b) => b.n - a.n || b.last - a.last);
    };
    const arrivals = tally('landing'), departures = tally('takeoff');
    const unknown = { arrivals: ev.filter(e => e.kind === 'landing' && !e.rwy).length, departures: ev.filter(e => e.kind === 'takeoff' && !e.rwy).length };
    let change = null;
    for (const kind of ['landing', 'takeoff']) {   // the last switch: two or more on the new flow after two or more on the old
      const seq = ev.filter(e => e.kind === kind && e.rwy);
      if (seq.length < 4) continue;
      const cur = seq[seq.length - 1].rwy;
      let k = seq.length - 1; while (k >= 0 && sameFlow(seq[k].rwy, cur)) k--;
      if (k < 0 || seq.length - 1 - k < 2 || seq.slice(0, k + 1).filter(e => sameFlow(e.rwy, seq[k].rwy)).length < 2) continue;
      const c = { kind, from: seq[k].rwy, to: seq[k + 1].rwy, at: (seq[k].t + seq[k + 1].t) / 2 };
      if (!change || c.at > change.at) change = c;
    }
    return { arrivals, departures, unknown, total: ev.length, change, minutes };
  }
  toJSON() { return this.events; }
  static fromJSON(j, opt) { const l = new RunwayLog(opt); for (const e of Array.isArray(j) ? j : []) l.add(e); return l; }
}

/** The heading a runway ident names ("34R" -> 340), or null. */
export const identHdg = ident => { const m = /^(\d{1,2})/.exec(String(ident || '')); return m ? (+m[1] * 10) % 360 : null; };
/** Do two runway ends belong to the same flow (parallel or near-parallel, landing the same way: within 45°)? "34R" and
 *  "35L" do; "34R" and "16L" do not. Idents without numbers are the same flow only when equal. */
export function sameFlow(a, b) {
  const x = identHdg(a), y = identHdg(b);
  return x == null || y == null ? a === b : angDiff(x, y) < 45;
}

/** The summary in words for the card: "Arrivals: 34R ×9, 35L ×4. Departures: 34L ×7, 25 ×5." */
export function historyText(s) {
  if (!s || !s.total) return '';
  const list = a => a.map(x => `${x.rwy} ×${x.n}`).join(', ');
  const bits = [];
  if (s.arrivals.length) bits.push(`Arrivals: ${list(s.arrivals)}${s.unknown.arrivals ? ` (+${s.unknown.arrivals} unmatched)` : ''}.`);
  else if (s.unknown.arrivals) bits.push(`${s.unknown.arrivals} landing${s.unknown.arrivals === 1 ? '' : 's'}, runway not told.`);
  if (s.departures.length) bits.push(`Departures: ${list(s.departures)}${s.unknown.departures ? ` (+${s.unknown.departures} unmatched)` : ''}.`);
  else if (s.unknown.departures) bits.push(`${s.unknown.departures} take-off${s.unknown.departures === 1 ? '' : 's'}, runway not told.`);
  return bits.join(' ');
}
