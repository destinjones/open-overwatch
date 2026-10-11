// Routes for the globe's directions: OSRM step -> plain-English instruction, distances and times in words, and a point
// a given distance along a polyline (the "fly it" camera rides that). Pure, so Node tests it.

const ORD = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 >= 11 && n % 100 <= 13) ? 0 : Math.min(n % 10, 4) % 4] || 'th');
const DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const compass = deg => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** One OSRM step (route/v1, steps=true) as an instruction, e.g. "Turn left onto Strand". */
export function instruction(step) {
  const m = step.maneuver || {}, name = (step.name || step.ref || '').trim(), onto = name ? ` onto ${name}` : '', mod = (m.modifier || '').replace('uturn', 'U-turn');
  switch (m.type) {
    case 'depart': return `Head ${compass(m.bearing_after || 0)}${name ? ` on ${name}` : ''}`;
    case 'arrive': return mod === 'left' || mod === 'right' ? `Arrive: your destination is on the ${mod}` : 'Arrive at your destination';
    case 'turn': case 'end of road': return mod === 'straight' ? `Continue straight${onto}` : mod === 'U-turn' ? `Make a U-turn${onto}` : `Turn ${mod}${onto}`;
    case 'continue': case 'new name': return `Continue${mod && mod !== 'straight' ? ' ' + mod : ''}${onto}`;
    case 'merge': return `Merge${mod ? ' ' + mod : ''}${onto}`;
    case 'on ramp': return `Take the ramp${mod ? ' on the ' + mod : ''}${onto}`;
    case 'off ramp': return `Take the exit${mod ? ' on the ' + mod : ''}${onto}`;
    case 'fork': return `Keep ${mod || 'straight'} at the fork${onto}`;
    case 'roundabout': case 'rotary': return m.exit ? `At the roundabout, take the ${ORD(m.exit)} exit${onto}` : `Enter the roundabout${onto}`;
    case 'exit roundabout': case 'exit rotary': return `Leave the roundabout${onto}`;
    default: return mod ? `Go ${mod}${onto}` : `Continue${onto}`;
  }
}

/** "350 m", "4.2 km", "12 km"; "45 s", "8 min", "1 h 05 min". */
export const distanceText = m => m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : m < 9950 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`;
export const durationText = s => { const m = Math.round(s / 60); return s < 60 ? `${Math.round(s)} s` : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };   // whole minutes first: never "1 h 60 min"

/** Great-circle metres between [lon, lat] points. */
export function haversine(a, b) {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A polyline of [lon, lat] made walkable: { coords, cum: metres to each vertex, total }. */
export function measure(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  return { coords, cum, total: cum[cum.length - 1] || 0 };
}

/** [lon, lat] at distance d along a measured line (clamped to its ends). */
export function pointAt(line, d) {
  const { coords, cum, total } = line;
  if (!coords.length) return null;
  if (d <= 0) return coords[0].slice(0, 2);
  if (d >= total) return coords[coords.length - 1].slice(0, 2);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const k = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1), a = coords[lo], b = coords[hi];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Initial bearing in degrees from a to b ([lon, lat]). */
export function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}
