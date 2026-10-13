// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Arrival and departure estimates for the airport boards, from nothing but what the live aircraft say about themselves:
// how far out they are, how fast they are going over the ground, how high they are and how fast they are coming down.
// There is no schedule and no flight plan here, so every estimate comes with a range, and the range is honest about
// the two things that make it wide: distance (vectoring, holds, the downwind leg) and pointing the wrong way. A plane
// already lined up with a runway gets a narrow range; one 80 km out and crossing gets a wide one. The board also keeps
// score (EtaLog): when a plane it estimated is seen on the ground, the miss is recorded, and the card says how the
// estimates at that field have been doing. DOM-free.

import { gcKm, bearing } from './actype.js';

const RAD = Math.PI / 180;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const GLIDE = Math.tan(3 * RAD);   // a 3° approach: 52 m of height per km

/** Typical speed over the threshold (m/s) for a kind of plane (core/actype.js classes), and what we assume otherwise. */
export const APPROACH_MS = Object.freeze({ widebody: 75, narrowbody: 70, regional: 65, bizjet: 63, turboprop: 55, light: 36, glider: 28, helicopter: 20, fighter: 80, military: 70, militaryprop: 55, drone: 25 });
const approachMs = (cls, gs) => Math.min(gs, APPROACH_MS[cls] ?? (gs > 120 ? 70 : gs > 70 ? 55 : 36));

/**
 * Time (s) to fly `km` while slowing steadily (with distance) from v0 to v1 m/s: the integral of ds / v(s) for a
 * speed that falls linearly over the distance, D ln(v0/v1) / (v0 - v1).
 */
export function decelTime(km, v0, v1) {
  const D = km * 1000;
  if (!(v0 > 0) || !(v1 > 0)) return null;
  if (Math.abs(v0 - v1) < 0.5) return D / ((v0 + v1) / 2);
  return D * Math.log(v0 / v1) / (v0 - v1);
}

/**
 * When an arriving plane should land: { etaS, loS, hiS, pathKm, how } (seconds from the fix's time), or null without a
 * speed. p: { lat, lon, alt (m), gs (m/s), track, vr (m/s) }; ap: { lat, lon, elevM }. opt.final: { km } when the plane
 * is lined up with a runway (core/runways.js finalFor), opt.cls: its class (for the approach speed), opt.spread: a
 * factor from the field's track record (EtaLog) that widens or narrows the range.
 *
 * The path: lined up, the distance to the threshold. Otherwise the straight distance plus what approaches add (joining
 * the final ~8 km out, and turning round when pointing away), and never shorter than the distance a 3° glide needs to
 * lose its height. Speed falls from the ground speed now to an approach speed. A steady descent rate gives a second
 * opinion: the two are blended (the path counts more) and the descent may pull the estimate by at most -30% / +40%.
 */
export function arrivalEstimate(ap, p, { final = null, cls = '', spread = 1 } = {}) {
  if (!p || !(p.gs > 15) || !Number.isFinite(p.lat)) return null;
  const km = gcKm(p.lat, p.lon, ap.lat, ap.lon), aboveM = Math.max(0, (p.alt || 0) - (ap.elevM || 0));
  const off = p.track == null ? 90 : angDiff(p.track, bearing(p.lat, p.lon, ap.lat, ap.lon));
  let pathKm, how, lo, hi;
  if (final && Number.isFinite(final.km)) {
    pathKm = final.km; how = 'final';
    lo = 0.85; hi = 1.2;
  } else {
    const join = km < 15 ? 3 : 8;                          // straight-in from far out is rare: the final is joined some way out
    const turn = off > 30 ? km * (off - 30) / 150 + 4 : 0;  // pointing away or crossing: it has to come round
    pathKm = km * 1.08 + join + turn; how = off > 60 ? 'turning' : 'direct';
    lo = 0.75; hi = 1.35 + Math.min(0.5, km / 200) + (off > 60 ? 0.35 : 0);   // far and crossing: holds and vectors
  }
  const needKm = aboveM / GLIDE / 1000;                     // how far it must fly to get down at 3°
  if (needKm > pathKm * 1.1 + 0.5) {   // too high for a 3° glide (with a little slack): off the final it flies further to get down; on it, it dives (or goes round)
    if (how === 'final') { how = 'high on final'; hi += 0.3; } else { pathKm = needKm; how = 'high'; hi += 0.2; }
  }
  const v1 = approachMs(cls, p.gs);
  let etaS = decelTime(pathKm, p.gs, v1);
  if (etaS == null) return null;
  if ((p.vr ?? 0) < -1 && aboveM > 150) {                   // the descent rate's opinion
    const tDesc = aboveM / -p.vr;
    etaS = Math.max(etaS * 0.7, Math.min(etaS * 1.4, 0.7 * etaS + 0.3 * tDesc));
  }
  const s = Math.max(0.5, Math.min(2.5, spread || 1));
  const loS = Math.max(0, etaS * (1 - (1 - lo) * s) - 30), hiS = etaS * (1 + (hi - 1) * s) + 30;
  return { etaS, loS, hiS, pathKm, km, aboveM, off, how };
}

/**
 * How long ago a departing plane took off: { agoS, loS, hiS } or null. Its distance from the field over the average
 * of a lift-off speed and its speed now (it accelerated the whole way), checked against the height it has gained at
 * its climb rate; ±30% and a minute either way, because the climb-out may not have been straight.
 */
export function departureEstimate(ap, p, { cls = '' } = {}) {
  if (!p || !(p.gs > 15) || !Number.isFinite(p.lat)) return null;
  const km = gcKm(p.lat, p.lon, ap.lat, ap.lon), aboveM = Math.max(0, (p.alt || 0) - (ap.elevM || 0));
  const v0 = approachMs(cls, p.gs) * 1.05;                  // lift-off speed ~ the approach speed
  let agoS = decelTime(km, v0, p.gs) ?? km * 1000 / p.gs;
  if ((p.vr ?? 0) > 1.5 && aboveM > 100) agoS = Math.max(agoS * 0.7, Math.min(agoS * 1.4, 0.6 * agoS + 0.4 * aboveM / p.vr));
  return { agoS, loS: Math.max(0, agoS * 0.7 - 60), hiS: agoS * 1.3 + 60, km, aboveM };
}

/** "≈ 12 min (9–17)" for an estimate in seconds, or "landing now". */
export function rangeText(e) {
  if (!e) return '';
  const m = s => Math.max(0, Math.round(s / 60));
  if (e.hiS < 90) return 'landing now';
  const lo = m(e.loS), hi = Math.max(m(e.hiS), lo + 1), mid = Math.min(hi, Math.max(lo, m(e.etaS)));
  return mid >= 60 ? `≈ ${Math.floor(mid / 60)} h ${String(mid % 60).padStart(2, '0')} (${lo}–${hi} min)` : `≈ ${mid} min (${lo}–${hi})`;
}
/** "took off ≈ 4 min ago (2–6)". */
export function agoText(e) {
  if (!e) return '';
  const m = s => Math.max(0, Math.round(s / 60)), lo = m(e.loS), hi = Math.max(m(e.hiS), lo + 1), mid = Math.min(hi, Math.max(lo, m(e.agoS)));
  return mid < 1 ? 'took off just now' : `took off ≈ ${mid} min ago (${lo}–${hi})`;
}

/** The distance bands the track record is kept in (km): an estimate is scored once per band per flight. */
export const ETA_BANDS = Object.freeze([10, 25, 50, 100]);
const bandOf = km => ETA_BANDS.find(b => km <= b) ?? null;

/**
 * The estimates' track record at each airport. note() keeps the first estimate a flight gets in each distance band
 * (as a predicted landing time and range); landed() scores them against when the plane was seen to land. summary()
 * says how many came in inside their range and the typical miss, per band and overall; spread() turns that into the
 * factor arrivalEstimate widens or narrows its range by (1 until there are 5 landings to go on).
 */
export class EtaLog {
  constructor({ keepH = 6 } = {}) { this.keepMs = keepH * 3600e3; this.open = new Map(); this.done = []; }
  _key(icao, hex) { return icao + ' ' + hex; }
  /** An estimate made at time `at` (ms) for a flight `km` out: e = arrivalEstimate(). */
  note(icao, hex, at, e) {
    if (!e || !Number.isFinite(at)) return false;
    const band = bandOf(e.km); if (band == null) return false;
    const k = this._key(icao, hex), o = this.open.get(k) || this.open.set(k, { icao, hex, first: at, bands: {} }).get(k);
    if (o.bands[band]) return false;
    o.bands[band] = { at, t: at + e.etaS * 1000, lo: at + e.loS * 1000, hi: at + e.hiS * 1000, how: e.how };
    o.last = at;
    return true;
  }
  /** The flight was seen on the ground here at `at` (ms): score its estimates. Returns the scored results. */
  landed(icao, hex, at) {
    const k = this._key(icao, hex), o = this.open.get(k);
    if (!o) return [];
    this.open.delete(k);
    const out = [];
    for (const [band, b] of Object.entries(o.bands)) {
      if (at < b.at) continue;
      out.push({ icao, hex, band: +band, at, errS: (at - b.t) / 1000, inside: at >= b.lo && at <= b.hi, how: b.how, leadS: (at - b.at) / 1000 });
    }
    this.done.push(...out);
    return out;
  }
  /** Forget what is too old: open estimates not updated for an hour, scores older than keepH. */
  prune(now = Date.now()) {
    for (const [k, o] of this.open) if (now - (o.last || o.first) > 3600e3) this.open.delete(k);
    this.done = this.done.filter(d => now - d.at < this.keepMs);
  }
  /** { n, inside (count), medianAbsS, biasS (median signed: + means later than estimated), byBand: { 10: {...}, ... } } */
  summary(icao) {
    const all = this.done.filter(d => !icao || d.icao === icao);
    const stat = list => {
      if (!list.length) return { n: 0, inside: 0, medianAbsS: null, biasS: null };
      return { n: list.length, inside: list.filter(d => d.inside).length, medianAbsS: median(list.map(d => Math.abs(d.errS))), biasS: median(list.map(d => d.errS)) };
    };
    const byBand = {}; for (const b of ETA_BANDS) { const s = stat(all.filter(d => d.band === b)); if (s.n) byBand[b] = s; }
    return { ...stat(all), flights: new Set(all.map(d => d.hex)).size, byBand };
  }
  /** The range factor for a field: wider when fewer than ~80% landed inside their range, narrower when nearly all did. */
  spread(icao) {
    const s = this.summary(icao);
    if (s.flights < 5) return 1;
    const hit = s.inside / s.n;
    return hit < 0.6 ? 1.6 : hit < 0.8 ? 1.25 : hit > 0.95 ? 0.85 : 1;
  }
  toJSON() { return { open: [...this.open.values()], done: this.done }; }
  static fromJSON(j, opt) {
    const l = new EtaLog(opt);
    for (const o of (j && j.open) || []) if (o && o.icao && o.hex) l.open.set(l._key(o.icao, o.hex), o);
    if (j && Array.isArray(j.done)) l.done = j.done.filter(d => d && Number.isFinite(d.at) && Number.isFinite(d.errS));
    return l;
  }
}
function median(a) { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }

/** The track record in words: "Of 14 landings seen here, 11 came in inside their range; typical miss 1.4 min, usually
 *  later than estimated." Empty under 3 landings. */
export function etaRecordText(s) {
  if (!s || s.flights < 3) return '';
  const miss = s.medianAbsS < 60 ? `${Math.round(s.medianAbsS)} s` : `${(s.medianAbsS / 60).toFixed(1)} min`;
  const lean = Math.abs(s.biasS) < 30 ? '' : s.biasS > 0 ? ', usually later than estimated' : ', usually earlier than estimated';
  return `Of ${s.flights} landing${s.flights === 1 ? '' : 's'} seen here, ${s.inside} of ${s.n} estimates came in inside their range; typical miss ${miss}${lean}.`;
}
