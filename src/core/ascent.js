// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// A reconstructed rocket ascent from what a launch listing says: the pad and the target orbit. Not telemetry: a generic
// two-stage climb to orbit along the launch azimuth that reaches the target inclination, then a short coast. Pure.
//   profile = ascentProfile({ lat, lon, orbit, mission, rocket })   sample(profile, tSeconds) -> { lat, lon, altKm, speedKms, downrangeKm }

const R = 6371.0088, D = Math.PI / 180;

/** Target inclination (deg) and insertion height (km) for an orbit as Launch Library names it. */
export function target(orbit = '', mission = '', padLat = 0) {
  const o = String(orbit).toUpperCase(), m = String(mission).toLowerCase(), lat = Math.abs(padLat);
  if (/SUB/.test(o)) return { incl: Math.max(lat, 0), alt: 105, sub: true, name: 'suborbital' };
  if (/SSO|SUN.?SYNC/.test(o)) return { incl: 97.5, alt: 520, name: 'sun-synchronous orbit' };
  if (/^PO$|POLAR/.test(o)) return { incl: 90, alt: 450, name: 'polar orbit' };
  if (/MEO|MEDIUM/.test(o)) return { incl: Math.max(lat, 55), alt: 200, name: 'medium orbit (parking orbit first)' };
  if (/GTO|GEO|GSO|GEOSTAT|LO$|LUNAR|MARS|HELIO|TLI/.test(o)) return { incl: lat, alt: 200, name: 'a parking orbit, then on out' };
  const iss = /\b(iss|dragon|crew|soyuz|progress|cygnus|starliner|axiom|ax-\d)\b/.test(m), starlink = /starlink/.test(m);
  return { incl: Math.max(lat, iss ? 51.6 : starlink ? 53 : lat), alt: starlink ? 280 : 220, name: 'low Earth orbit' };
}

/** Launch azimuth (deg from north) that reaches inclination i from latitude lat: north-easterly for prograde orbits,
 *  south-going for retrograde and polar ones (as from Vandenberg). Due east when i is below the pad's latitude. */
export function azimuth(i, lat) {
  const ratio = Math.cos(i * D) / Math.cos(lat * D);
  if (Math.abs(ratio) >= 1) return 90;
  const a = Math.asin(ratio) / D;               // -90..90
  return i > 90 || Math.abs(i - 90) < 1e-9 ? 180 - a : a;   // retrograde / polar: the southern branch
}

export const EVENTS = Object.freeze([[0, 'Lift-off'], [12, 'Pitching over, downrange'], [72, 'Max Q (approx.)'], [155, 'Main engine cut-off (approx.)'], [158, 'Stage separation (approx.)'],
  [165, 'Second stage ignition (approx.)'], [195, 'Fairing separation (approx.)'], [520, 'Orbit reached (approx.)']]);
export const T_ORBIT = 520, T_END = 820;   // seconds: insertion, then five minutes of coasting

// Ranges that only launch one way over the sea: Vandenberg flies south whatever the inclination (never over California)
const SOUTH_ONLY = [[34.7, -120.6]];
export function ascentProfile({ lat, lon, orbit, mission }) {
  const t = target(orbit, mission, lat);
  let az = azimuth(t.incl, lat);
  if (SOUTH_ONLY.some(([a, b]) => Math.abs(lat - a) < 0.6 && Math.abs(lon - b) < 0.6) && (az < 90 || az > 270)) az = 180 - az;
  return { lat, lon, az, ...t, downrange: t.sub ? 90 : 1750, tOrbit: t.sub ? 330 : T_ORBIT, tEnd: t.sub ? 600 : T_END };
}

/** The point at distance s (km) along a great circle from (lat, lon) heading az. */
export function travel(lat, lon, az, s) {
  const d = s / R, p1 = lat * D, l1 = lon * D, a = az * D;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(a));
  const l2 = l1 + Math.atan2(Math.sin(a) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / D, ((l2 / D + 540) % 360) - 180];
}

/** Where the reconstructed rocket is t seconds after lift-off. */
export function sample(p, t) {
  t = Math.max(0, Math.min(p.tEnd, t));
  let alt, s;
  if (p.sub) {   // up and back down on a lazy arc
    const u = t / p.tEnd; alt = p.alt * Math.sin(Math.PI * Math.min(1, u * 1.08)); s = p.downrange * u;
  } else if (t <= p.tOrbit) {
    const u = t / p.tOrbit; alt = p.alt * Math.pow(Math.sin(Math.PI / 2 * u), 1.35); s = p.downrange * Math.pow(u, 2.2);
  } else { alt = p.alt; s = p.downrange + 7.8 * (t - p.tOrbit); }   // coasting at orbital speed
  const dt = 1, a2 = t + dt <= p.tEnd ? sample0(p, t + dt) : null;
  const [la, lo] = travel(p.lat, p.lon, p.az, s);
  const speed = a2 ? Math.hypot(a2.s - s, a2.alt - alt) / dt : 7.8;
  return { lat: la, lon: lo, altKm: alt, downrangeKm: s, speedKms: speed };
}
function sample0(p, t) {   // altitude and downrange only (for the speed estimate)
  if (p.sub) { const u = t / p.tEnd; return { alt: p.alt * Math.sin(Math.PI * Math.min(1, u * 1.08)), s: p.downrange * u }; }
  if (t <= p.tOrbit) { const u = t / p.tOrbit; return { alt: p.alt * Math.pow(Math.sin(Math.PI / 2 * u), 1.35), s: p.downrange * Math.pow(u, 2.2) }; }
  return { alt: p.alt, s: p.downrange + 7.8 * (t - p.tOrbit) };
}

/** The latest event at or before t: "Max Q (approx.)". */
export const eventAt = (t, sub = false) => sub ? (t < 1 ? 'Lift-off' : t < 150 ? 'Powered ascent' : 'Coasting over the top, then back down') : ([...EVENTS].reverse().find(([s]) => t >= s) || EVENTS[0])[1];
