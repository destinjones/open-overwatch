// distance: how far between places, as the crow flies on the real Earth (WGS84, Vincenty: to the millimetre) and, if asked,
// by road, bike or on foot (OSRM over OpenStreetMap, the same router as the globe's Directions); the bearing to set off on,
// the halfway point, and for several places the whole path. Its link opens the globe with the line drawn (the drawing
// travels in the link, core/measure.js), so the person sees the route the globe's own measuring tool would draw.
import { inverse, midpoint, pathLength, lengthText, bearingText, choosePair } from '../src/core/measure.js';
import { ToolError } from './feeds.mjs';
import { geocodeMany, frame, globeUrl } from './place.mjs';
import { r1, r2, coord } from './words.mjs';

const OSRM = { drive: ['routed-car', 'driving'], cycle: ['routed-bike', 'bike'], walk: ['routed-foot', 'foot'] };
const MODE_WORD = { drive: 'by road', cycle: 'by bike', walk: 'on foot' };
const RANK = { country: 7, state: 6, region: 5, province: 5, county: 4, city: 4, island: 3, town: 3, municipality: 3, borough: 2, suburb: 2, village: 2, hamlet: 1, locality: 1 };
const PLACEY = new Set(Object.keys(RANK));
const POINT = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const hm = s => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };

export function distanceTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  /** A place name or "lat, lon" -> candidates ({ label, lat, lon }), best first. */
  const candidates = async (q, n, signal, near) => {
    const m = String(q).match(POINT);
    if (m) { const lat = +m[1], lon = +m[2]; if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new ToolError(`"${q}" is not a latitude, longitude`, 'invalid_arguments'); return [{ label: coord(lat, lon), lat, lon, fixed: true }]; }
    return geocodeMany(feeds, q, n, signal, near);
  };
  /** The two places meant: the best pair of matches; when those are far apart, each name is asked again near the other.
   *  Other matches only stand in for a best one of their own sort (Springfield, Illinois for Springfield, Massachusetts;
   *  never a diner called "Chicago Sam's" for Chicago). */
  const pair = async (qa, qb, signal) => {
    const sorted = l => [l[0], ...l.slice(1).filter(x => x.kind === l[0].kind || (PLACEY.has(x.kind) && PLACEY.has(l[0].kind)))];
    const [as, bs] = (await Promise.all([candidates(qa, 5, signal), candidates(qb, 5, signal)])).map(sorted);
    if (as[0].fixed || bs[0].fixed) return [as[0], bs[0]];   // a point was given: the name means its best match, not whichever namesake is nearest
    let best = choosePair(as, bs), d = inverse(best[0].lat, best[0].lon, best[1].lat, best[1].lon).s;
    if (d > 50e3) {
      // a nearer namesake may replace a mountain or a landmark, but never a city with a village or a diner of the same name
      const ok = (was, now) => !(was.kind in RANK) || (RANK[now.kind] || 0) >= RANK[was.kind];
      const tries = await Promise.all([candidates(qa, 1, signal, best[1]).then(l => ok(best[0], l[0]) && [l[0], best[1]], () => null),
        candidates(qb, 1, signal, best[0]).then(l => ok(best[1], l[0]) && [best[0], l[0]], () => null)]);
      for (const p of tries.filter(Boolean)) { const x = inverse(p[0].lat, p[0].lon, p[1].lat, p[1].lon).s; if (x < d) { d = x; best = p; } }
    }
    return best;
  };
  const route = async (pts, mode, signal) => {
    const [host, prof] = OSRM[mode], path = pts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    let d;
    try { d = await feeds.json(`https://routing.openstreetmap.de/${host}/route/v1/${prof}/${path}?overview=false&steps=false`, { ttl: 3600e3, timeout: 25e3, signal }); }
    catch (e) { if (e.code === 'unavailable' && /HTTP 400/.test(e.message)) return null; throw e; }   // OSRM says "no route" with a 400
    return d && d.code === 'Ok' && d.routes && d.routes[0] ? { m: d.routes[0].distance, s: d.routes[0].duration } : null;
  };

  return {
    name: 'distance',
    title: 'Distance between places',
    description: 'How far it is between two or more places: the true distance over the Earth\'s surface (the WGS84 ellipsoid, to the millimetre), the compass bearing to set off on, the halfway point, and optionally the distance and time by road, by bike or on foot (OSRM over OpenStreetMap). Places can be names or "lat, lon". Its link opens the globe with the line drawn and measured.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['places'],
      properties: {
        places: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'string', maxLength: 120 }, description: 'Two or more places in order: names ("Paris", "Big Ben") or "lat, lon" ("48.85, 2.35"). A path through them is measured leg by leg.' },
        by: { type: 'string', enum: ['air', 'drive', 'cycle', 'walk'], description: 'air (default: the straight line over the Earth) or also the route by road (drive), bike (cycle) or on foot (walk).' },
        units: { type: 'string', enum: ['metric', 'imperial'], description: 'metric (default) or imperial.' },
      },
    },
    async run(a, { signal }) {
      if (!Array.isArray(a.places) || a.places.length < 2) throw new ToolError('Name at least two places', 'invalid_arguments');
      const imp = a.units === 'imperial', by = a.by || 'air', L = m => lengthText(m, imp);
      let pts;
      if (a.places.length === 2) pts = await pair(a.places[0], a.places[1], signal);   // the pair that makes sense: Paris and Berlin the capitals, Big Ben the one in London
      else pts = await Promise.all(a.places.map(q => candidates(q, 1, signal).then(l => l[0])));
      const legs = [];
      for (let i = 1; i < pts.length; i++) { const g = inverse(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon); legs.push({ from: pts[i - 1].label, to: pts[i].label, m: g.s, az: g.az1 }); }
      const total = pathLength(pts.map(p => [p.lon, p.lat])).total, first = legs[0];
      let road = null;
      if (by !== 'air') {
        road = await route(pts, by, signal);
        if (!road) throw new ToolError(`OSRM finds no way ${MODE_WORD[by]} between ${pts.map(p => p.label).join(' and ')} (across the sea, or off the road network)`, 'not_found');
      }
      const mid = pts.length === 2 ? midpoint([pts[0].lon, pts[0].lat], [pts[1].lon, pts[1].lat]) : null;
      const out = [pts.length === 2 ? `From ${pts[0].label} to ${pts[1].label}: ${L(total)} as the crow flies, setting off ${bearingText(first.az)}.`
        : `Through ${pts.length} places: ${L(total)} as the crow flies.`];
      if (pts.length > 2) out.push(...legs.map(l => `${l.from} → ${l.to}: ${L(l.m)}, ${bearingText(l.az)}`));
      if (mid) out.push(`Halfway: ${coord(mid[1], mid[0])}.`);
      if (road) out.push(`${MODE_WORD[by][0].toUpperCase() + MODE_WORD[by].slice(1)}: ${L(road.m)}, about ${hm(road.s)} (OSRM; ${r1(road.m / total)} times the straight line).`);
      // the drawing: a distance arrow (re-routed by road on arrival) for two places, a line through more
      const shape = pts.length === 2 ? { kind: 'arrow', coords: pts.map(p => [p.lon, p.lat]), ...(by === 'drive' ? { road: true } : {}) } : { kind: 'line', coords: pts.map(p => [p.lon, p.lat]) };
      const c = pts.length === 2 ? { lat: mid[1], lon: mid[0] } : { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
      const span = Math.max(...pts.map(p => inverse(c.lat, c.lon, p.lat, p.lon).s)) / 1000;
      const url = globeUrl(site, { camera: frame(c.lat, c.lon, Math.max(0.3, span * 1.15)), drawing: [shape] });
      out.push(`The line on the globe: ${url}`);
      return { text: out.join('\n'), data: { places: pts.map(p => ({ name: p.label, lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5) })), distance_km: Math.round(total) / 1000, distance_text: L(total),
        bearing_deg: r1(first.az), legs: legs.map(l => ({ from: l.from, to: l.to, km: Math.round(l.m) / 1000, bearing_deg: r1(l.az) })), halfway: mid ? { lat: r2(mid[1]), lon: r2(mid[0]) } : null,
        route: road ? { by, km: Math.round(road.m) / 1000, minutes: Math.round(road.s / 60), detour_factor: r2(road.m / total) } : null, url,
        source: `WGS84 geodesics (Vincenty)${road ? '; FOSSGIS OSRM routing over OpenStreetMap (© OpenStreetMap contributors)' : ''}` } };
    },
  };
}
