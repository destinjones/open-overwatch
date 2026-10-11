// Draw and measure: distances, bearings and areas on the WGS84 ellipsoid, the words for them, and the drawing as GeoJSON.
// Pure (no DOM, no Cesium), so Node tests it against GeographicLib (Karney's reference implementation).
//   inverse / direct  the shortest path over the ellipsoid (Vincenty's formulae, within a millimetre). Points within about
//                     a degree of each other's antipode, where Vincenty's iteration doesn't settle, are solved by halving
//                     the starting bearing instead (Karney's set-up), just as close
//   polygonArea       the area inside a ring of geodesic edges: each edge is split every 20 km along its geodesic and the
//                     ring is measured on the authalic sphere (the sphere with the ellipsoid's area, latitudes mapped so
//                     every region keeps its area), where great-circle edges are exact. Within 0.001% of GeographicLib
//                     (the worst of 400 random polygons, 1,600 m² to 64 million km², was 0.0003%)
// Coordinates are degrees: [lon, lat] pairs in lists (GeoJSON's order, as in borders.js and route.js), separate
// arguments otherwise. Distances in metres, areas in square metres, bearings in degrees clockwise from north.

export const WGS84 = Object.freeze({ a: 6378137, f: 1 / 298.257223563 });
/** The most points a drawing holds (pins, line and area corners together; country outlines don't count). */
export const MAX_POINTS = 512;

const A = WGS84.a, F = WGS84.f, B = A * (1 - F), E2 = F * (2 - F), E = Math.sqrt(E2), EP2 = (A * A - B * B) / (B * B);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const QP = qOf(1);   // q at the pole
/** The authalic radius: a sphere of this radius has the ellipsoid's surface area. */
export const AUTHALIC_R = A * Math.sqrt(QP / 2);
/** The ellipsoid's surface area (510,065,621.7 km²). */
export const EARTH_AREA = 4 * Math.PI * AUTHALIC_R * AUTHALIC_R;
// degrees into [-180, 180); values already there are left alone (adding 180 first would cost a small difference its last digits)
const wrap = lon => lon >= -180 && lon < 180 ? lon : ((lon + 180) % 360 + 360) % 360 - 180;
const norm = az => (az % 360 + 360) % 360;

function qOf(sinPhi) { const es = E * sinPhi; return (1 - E2) * (sinPhi / (1 - es * es) + Math.atanh(es) / E); }
// Vincenty's series for the arc on the auxiliary sphere
const coefA = u2 => 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
const coefB = u2 => u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
const deltaSigma = (Bb, sinS, cosS, c2m) => Bb * sinS * (c2m + Bb / 4 * (cosS * (-1 + 2 * c2m * c2m) - Bb / 6 * c2m * (-3 + 4 * sinS * sinS) * (-3 + 4 * c2m * c2m)));

/** The shortest path between two points: { s: metres, az1: bearing at the start, az2: heading on arrival }. */
export function inverse(lat1, lon1, lat2, lon2) {
  lat1 = Math.max(-90, Math.min(90, lat1)); lat2 = Math.max(-90, Math.min(90, lat2));
  const L = wrap(lon2 - lon1) * D2R;
  const U1 = Math.atan((1 - F) * Math.tan(lat1 * D2R)), U2 = Math.atan((1 - F) * Math.tan(lat2 * D2R));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lam = L, sinLam = 0, cosLam = 1, sinS = 0, cosS = 1, sig = 0, cos2a = 1, c2m = 0, converged = false;
  for (let i = 0; i < 200; i++) {
    sinLam = Math.sin(lam); cosLam = Math.cos(lam);
    const t1 = cosU2 * sinLam, t2 = cosU1 * sinU2 - sinU1 * cosU2 * cosLam;
    sinS = Math.hypot(t1, t2); cosS = sinU1 * sinU2 + cosU1 * cosU2 * cosLam;
    if (sinS === 0) { if (cosS > 0) return { s: 0, az1: 0, az2: 0 }; break; }   // the same point; or exactly opposite
    sig = Math.atan2(sinS, cosS);
    const sinA = cosU1 * cosU2 * sinLam / sinS;
    cos2a = 1 - sinA * sinA;
    c2m = cos2a !== 0 ? cosS - 2 * sinU1 * sinU2 / cos2a : 0;   // 0 on the equator
    const Cc = F / 16 * cos2a * (4 + F * (4 - 3 * cos2a)), prev = lam;
    lam = L + (1 - Cc) * F * sinA * (sig + Cc * sinS * (c2m + Cc * cosS * (-1 + 2 * c2m * c2m)));
    if (Math.abs(lam) > Math.PI) break;   // it has run past the antipode: it won't settle
    if (Math.abs(lam - prev) < 1e-12) { converged = true; break; }
  }
  if (!converged) return bisect(lat1, lat2, wrap(lon2 - lon1));
  const u2 = cos2a * EP2, s = B * coefA(u2) * (sig - deltaSigma(coefB(u2), sinS, cosS, c2m));
  const az1 = Math.atan2(cosU2 * sinLam, cosU1 * sinU2 - sinU1 * cosU2 * cosLam) * R2D;
  const az2 = Math.atan2(cosU1 * sinLam, -sinU1 * cosU2 + cosU1 * sinU2 * cosLam) * R2D;
  return { s, az1: norm(az1), az2: norm(az2) };
}
// Points (nearly) opposite each other, where Vincenty's iteration on the longitude runs away: search the starting
// bearing instead. Karney (2013, section 4): with point 1 the one nearer a pole, moved to the southern hemisphere, and the
// longitude difference made positive, the shortest path leaves with a bearing in [0°, 180°] and first crosses point 2's
// latitude heading north, and the longitude where it does grows steadily with that bearing: so halve the interval
// until it lands on point 2's longitude. Longitudes along the path use the same series as Vincenty's.
export function bisect(lat1, lat2, dlon) {
  if (lat1 === 0 && lat2 === 0 && Math.abs(dlon) <= (1 - F) * 180) return { s: A * Math.abs(dlon) * D2R, az1: dlon < 0 ? 270 : 90, az2: dlon < 0 ? 270 : 90, bisected: true };   // along the equator
  const swap = Math.abs(lat1) < Math.abs(lat2); if (swap) { [lat1, lat2] = [lat2, lat1]; dlon = -dlon; }
  const flipLat = lat1 > 0, flipLon = dlon < 0, target = Math.abs(dlon) * D2R;
  const U1 = Math.atan((1 - F) * Math.tan(Math.abs(lat1) * D2R)), U2 = Math.atan((1 - F) * Math.tan((flipLat ? -lat2 : lat2) * D2R));
  const sb1 = -Math.sin(U1), cb1 = Math.cos(U1), sb2 = Math.sin(U2), cb2 = Math.cos(U2);   // sb1 is -0 on the equator
  let lo = 0, hi = Math.PI, a1 = Math.PI / 2, sig = 0, s1 = 0, ca2 = 1, cos2a = 1;
  for (let i = 0; i < 64; i++) {
    a1 = (lo + hi) / 2;
    const sa1 = Math.sin(a1), ca1 = Math.cos(a1), sa0 = sa1 * cb1;
    cos2a = 1 - sa0 * sa0;
    ca2 = Math.sqrt(Math.max(0, ca1 * ca1 * cb1 * cb1 + cb2 * cb2 - cb1 * cb1));   // cos(bearing) cos(latitude) at point 2, heading north
    s1 = Math.atan2(sb1, ca1 * cb1);
    sig = Math.max(0, Math.atan2(sb2, ca2) - s1);   // the arc from point 1 (from the node before it: s1)
    const w = Math.atan2(Math.sin(sig) * sa1, cb1 * Math.cos(sig) - sb1 * Math.sin(sig) * ca1);   // longitude on the auxiliary sphere
    const Cc = F / 16 * cos2a * (4 + F * (4 - 3 * cos2a)), c2m = Math.cos(2 * s1 + sig);
    const lam = w - (1 - Cc) * F * sa0 * (sig + Cc * Math.sin(sig) * (c2m + Cc * Math.cos(sig) * (-1 + 2 * c2m * c2m)));
    if (lam < target) lo = a1; else hi = a1;
  }
  const u2 = cos2a * EP2, s = B * coefA(u2) * (sig - deltaSigma(coefB(u2), Math.sin(sig), Math.cos(sig), Math.cos(2 * s1 + sig)));
  let az1 = a1, az2 = Math.atan2(Math.sin(a1) * cb1, ca2);
  if (flipLon) { az1 = -az1; az2 = -az2; }
  if (flipLat) { az1 = Math.PI - az1; az2 = Math.PI - az2; }
  if (swap) [az1, az2] = [az2 + Math.PI, az1 + Math.PI];
  return { s, az1: norm(az1 * R2D), az2: norm(az2 * R2D), bisected: true };
}

/** Where a path that sets off on bearing `az` from (lat, lon) is after `s` metres: { lat, lon, az: its heading there }. */
export function direct(lat, lon, az, s) {
  const a1 = az * D2R, sinA1 = Math.sin(a1), cosA1 = Math.cos(a1);
  const tanU1 = (1 - F) * Math.tan(lat * D2R), cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1), sinU1 = tanU1 * cosU1;
  const sig1 = Math.atan2(tanU1, cosA1), sinA = cosU1 * sinA1, cos2a = 1 - sinA * sinA, u2 = cos2a * EP2;
  const Aa = coefA(u2), Bb = coefB(u2), first = s / (B * Aa);
  let sig = first, sinS = 0, cosS = 1, c2m = 0;
  for (let i = 0; i < 100; i++) {
    c2m = Math.cos(2 * sig1 + sig); sinS = Math.sin(sig); cosS = Math.cos(sig);
    const next = first + deltaSigma(Bb, sinS, cosS, c2m);
    if (Math.abs(next - sig) < 1e-12) { sig = next; break; }
    sig = next;
  }
  c2m = Math.cos(2 * sig1 + sig); sinS = Math.sin(sig); cosS = Math.cos(sig);
  const x = sinU1 * sinS - cosU1 * cosS * cosA1;
  const lat2 = Math.atan2(sinU1 * cosS + cosU1 * sinS * cosA1, (1 - F) * Math.hypot(sinA, x));
  const lam = Math.atan2(sinS * sinA1, cosU1 * cosS - sinU1 * sinS * cosA1);
  const Cc = F / 16 * cos2a * (4 + F * (4 - 3 * cos2a));
  const L = lam - (1 - Cc) * F * sinA * (sig + Cc * sinS * (c2m + Cc * cosS * (-1 + 2 * c2m * c2m)));
  return { lat: lat2 * R2D, lon: wrap(lon + L * R2D), az: norm(Math.atan2(sinA, -x) * R2D) };
}

/** Halfway along the shortest path: [lon, lat]. */
export function midpoint(a, b) {
  const g = inverse(a[1], a[0], b[1], b[0]); if (!g.s) return [a[0], a[1]];
  const m = direct(a[1], a[0], g.az1, g.s / 2); return [m.lon, m.lat];
}

/** A path of [lon, lat] points: { legs: [{ s, az1, az2 }], total } (metres). */
export function pathLength(coords) {
  const legs = [];
  for (let i = 1; i < coords.length; i++) legs.push(inverse(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  return { legs, total: legs.reduce((t, g) => t + g.s, 0) };
}

/** A path's length over the hills, from ground heights sampled at equal steps along it (`flat`: its length at sea level):
 *  { length, up, down } in metres, like Google Earth's "ground length", with the climbing and the descending on the way. */
export function groundProfile(flat, heights) {
  const n = heights.length - 1; if (n < 1) return { length: flat, up: 0, down: 0 };
  const step = flat / n; let length = 0, up = 0, down = 0;
  for (let i = 1; i <= n; i++) { const dh = heights[i] - heights[i - 1]; length += Math.hypot(step, dh); if (dh > 0) up += dh; else down -= dh; }
  return { length, up, down };
}

/** Points every `step` metres or less along the shortest path from a to b, both ends included: [[lon, lat], ...]. */
export function densify(a, b, step = 50e3) {
  const g = inverse(a[1], a[0], b[1], b[0]), k = Math.ceil(g.s / step), out = [[a[0], a[1]]];
  for (let j = 1; j < k; j++) { const p = direct(a[1], a[0], g.az1, g.s * j / k); out.push([p.lon, p.lat]); }
  out.push([b[0], b[1]]);
  return out;
}

/** The area inside a ring of [lon, lat] points joined by shortest paths (it closes itself; a repeated first point is
 *  fine): { area: m², perimeter: m }. A ring splits the Earth in two: this is the smaller part. */
export function polygonArea(ring, step = 20e3) {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const n = pts.length; if (n < 3) return { area: 0, perimeter: 0 };
  let excess = 0, turns = 0, perimeter = 0;
  // the signed area between each piece and the equator on the authalic sphere (Karney 2013, eq. 58), and how far the ring
  // goes round in longitude (a ring round a pole takes in a hemisphere the per-edge sum leaves out)
  const tq = ([lon, lat]) => { const sx = qOf(Math.sin(lat * D2R)) / QP, cx = Math.sqrt(Math.max(0, 1 - sx * sx)); return [lon, sx / (1 + cx)]; };   // tan(authalic latitude / 2)
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], g = inverse(a[1], a[0], b[1], b[0]);
    perimeter += g.s;
    const k = Math.max(1, Math.ceil(g.s / step));
    let p = tq(a);
    for (let j = 1; j <= k; j++) {
      const c = j === k ? b : (d => [d.lon, d.lat])(direct(a[1], a[0], g.az1, g.s * j / k)), q = tq(c);
      const dl = wrap(q[0] - p[0]) * D2R;
      excess += 2 * Math.atan2(Math.tan(dl / 2) * (p[1] + q[1]), 1 + p[1] * q[1]);
      turns += dl; p = q;
    }
  }
  // the region on the ring's left (steradians, up to whole spheres), into (-2π, 2π]: its size is then the smaller part.
  // Never add 4π to a small area: the sum would keep only its first few digits
  let left = 2 * Math.PI * Math.round(turns / (2 * Math.PI)) - excess;
  left -= 4 * Math.PI * Math.round(left / (4 * Math.PI));
  return { area: Math.abs(left) * AUTHALIC_R * AUTHALIC_R, perimeter };
}

/** A country from borders.json (polygons, each [outline, ...holes]): { area: m², parts }. */
export function multiPolygonArea(poly, step = 20e3) {
  let area = 0;
  for (const rings of poly) rings.forEach((r, k) => { area += (k ? -1 : 1) * polygonArea(r, step).area; });
  return { area: Math.max(0, area), parts: poly.length };
}

/** Roughly the middle of some [lon, lat] points (the mean direction from the Earth's centre): where an area's label goes. */
export function centre(coords) {
  let x = 0, y = 0, z = 0;
  for (const [lon, lat] of coords) { const c = Math.cos(lat * D2R); x += c * Math.cos(lon * D2R); y += c * Math.sin(lon * D2R); z += Math.sin(lat * D2R); }
  return [Math.atan2(y, x) * R2D, Math.atan2(z, Math.hypot(x, y)) * R2D];
}

/** Does a ring cross itself? The index of the first edge that another crosses, or -1. Checked flat in degrees (longitudes
 *  unwrapped across the date line), good enough to warn that a figure-of-eight's area counts its loops against each other. */
export function selfCrossing(ring) {
  const n = ring.length; if (n < 4) return -1;
  const p = [[ring[0][0], ring[0][1]]];   // longitudes unwrapped across the date line; p[n] closes the ring
  for (let i = 1; i <= n; i++) { const c = ring[i % n]; p.push([p[i - 1][0] + wrap(c[0] - ring[i - 1][0]), c[1]]); }
  if (Math.abs(p[n][0] - p[0][0]) > 180) return -1;   // round a pole: flat geometry can't tell
  const side = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;   // neighbours through the closing edge
    if (side(p[i], p[i + 1], p[j]) * side(p[i], p[i + 1], p[j + 1]) < 0 && side(p[j], p[j + 1], p[i]) * side(p[j], p[j + 1], p[i + 1]) < 0) return i;
  }
  return -1;
}

/** Two lists of candidate places ({ lat, lon }, best match first) for "from A to B": the pair meant. The two best matches,
 *  unless another pair with one of them is much closer: "Paris" and "Berlin" are the capitals, not Paris, Maine and
 *  Berlin, New Hampshire, but "Big Ben" next to "the Tower of London" is the clock tower, not the mountain in Queensland. */
export function choosePair(as, bs) {
  if (!as.length || !bs.length) return null;
  const d = (a, b) => inverse(a.lat, a.lon, b.lat, b.lon).s;
  let best = [as[0], bs[0]], top = d(as[0], bs[0]), bestD = top;
  for (const a of as) for (const b of bs) {
    if ((a === as[0]) === (b === bs[0])) continue;   // pairs with exactly one best match
    const x = d(a, b); if (x < bestD && x < top / 3) { bestD = x; best = [a, b]; }
  }
  return best;
}

// ---- words
const group = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const num = x => x < 100 ? x.toFixed(2) : x < 1000 ? x.toFixed(1) : group(Math.round(x));
/** "3.4 m", "820 m", "54.97 km", "878.4 km", "12,345 km"; imperial: "2,690 ft", "34.16 mi". */
export function lengthText(m, imperial = false) {
  if (imperial) { const mi = m / 1609.344; return mi < 0.2 ? `${group(Math.round(m / 0.3048))} ft` : `${num(mi)} mi`; }
  return m < 10 ? `${m.toFixed(1)} m` : m < 1000 ? `${Math.round(m)} m` : `${num(m / 1000)} km`;
}
/** "8,400 m²", "0.84 km²", "551,695 km²"; imperial: "3.10 acres", "212.8 mi²" (a square mile and up). */
export function areaText(m2, imperial = false) {
  if (imperial) { const mi2 = m2 / 2589988.110336, ac = m2 / 4046.8564224; return mi2 >= 1 ? `${num(mi2)} mi²` : ac < 1000 ? `${num(ac)} acres` : `${group(Math.round(ac))} acres`; }
  return m2 < 1e4 ? `${group(Math.round(m2))} m²` : `${num(m2 / 1e6)} km²`;
}
const POINTS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** "61° ENE". */
export const bearingText = az => `${Math.round(norm(az)) % 360}° ${POINTS16[Math.round(norm(az) / 22.5) % 16]}`;
/** Spoken: "east-north-east". */
export const bearingWords = az => [...POINTS16[Math.round(norm(az) / 22.5) % 16]].map(c => ({ N: 'north', E: 'east', S: 'south', W: 'west' })[c]).join('-');
/** Spoken: "878 kilometres", "1.2 kilometres", "820 metres"; imperial: "545 miles", "0.5 miles", "900 feet". */
export function lengthWords(m, imperial = false) {
  const say = (x, one, many) => { const v = x < 10 ? Math.round(x * 10) / 10 : Math.round(x); return `${group(v)} ${v === 1 ? one : many}`; };
  if (imperial) { const mi = m / 1609.344; return mi < 0.2 ? say(m / 0.3048, 'foot', 'feet') : say(mi, 'mile', 'miles'); }
  return m < 1000 ? say(m, 'metre', 'metres') : say(m / 1000, 'kilometre', 'kilometres');
}
/** Spoken: "551,695 square kilometres", "84 hectares"... kept to the units people say aloud. */
export function areaWords(m2, imperial = false) {
  if (imperial) { const mi2 = m2 / 2589988.110336; return mi2 >= 1 ? `${group(mi2 < 10 ? Math.round(mi2 * 10) / 10 : Math.round(mi2))} square miles` : `${group(Math.round(m2 / 4046.8564224))} acres`; }
  const k = m2 / 1e6; return k >= 1 ? `${group(k < 10 ? Math.round(k * 10) / 10 : Math.round(k))} square kilometres` : m2 >= 1e4 ? `${group(Math.round(m2 / 1e4))} hectares` : `${group(Math.round(m2))} square metres`;
}

// ---- export
const r6 = ([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
/** A drawing as GeoJSON (RFC 7946). Shapes: { kind: 'pin' | 'line' | 'arrow' | 'area' | 'outline', name, coords: [[lon, lat]],
 *  poly (outlines: borders.json polygons), road? (the driving route, [[lon, lat]]) }, measured on the way out. */
export function toGeoJSON(shapes) {
  const features = [];
  for (const sh of shapes) {
    const props = { kind: sh.kind, name: sh.name || '' };
    let geometry;
    if (sh.kind === 'pin') geometry = { type: 'Point', coordinates: r6(sh.coords[0]) };
    else if (sh.kind === 'area') { const ring = sh.coords.map(r6); ring.push(ring[0]); geometry = { type: 'Polygon', coordinates: [ring] }; Object.assign(props, rounded(polygonArea(sh.coords))); }
    else if (sh.kind === 'outline') { geometry = { type: 'MultiPolygon', coordinates: sh.poly.map(rings => rings.map(r => r.map(r6))) }; props.area_m2 = Math.round(multiPolygonArea(sh.poly).area); }
    else { geometry = { type: 'LineString', coordinates: sh.coords.map(r6) }; props.length_m = Math.round(pathLength(sh.coords).total * 10) / 10; }
    features.push({ type: 'Feature', properties: props, geometry });
    if (sh.road) features.push({ type: 'Feature', properties: { kind: 'road', name: (sh.name || '') + ' by road', length_m: Math.round(sh.road.distance), duration_s: Math.round(sh.road.duration) }, geometry: { type: 'LineString', coordinates: sh.road.coords.map(r6) } });
  }
  return { type: 'FeatureCollection', features };
}
const rounded = ({ area, perimeter }) => ({ area_m2: Math.round(area * 10) / 10, perimeter_m: Math.round(perimeter * 10) / 10 });

// ---- the drawing in a share link (#...&d=): shapes joined by '.', each a kind letter (p pin, l line, a area, d distance,
// D a distance whose road route is asked for again on arrival), then its points as steps of a millionth of a degree
// (~0.1 m), zigzag varints in the URL-safe base64 alphabet (5 bits a character, the sixth says "more", as in Google's
// polyline format), then optionally '*' and its name as base64url UTF-8; a country outline is 'o' and its ISO code. Every
// character is one URLSearchParams leaves alone. Links are not trusted: decodeDrawing checks each number, count and name
// and drops a shape that fails.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', B64_AT = Object.fromEntries([...B64].map((c, i) => [c, i]));
const CODE = { pin: 'p', line: 'l', area: 'a', arrow: 'd' }, KIND_OF = { p: 'pin', l: 'line', a: 'area', d: 'arrow', D: 'arrow' };
const STEP = 1e6, LINK_MAX = 9000;   // a 512-point drawing of far-apart points is ~6 KB
const fits = (kind, n) => kind === 'pin' ? n === 1 : kind === 'arrow' ? n === 2 : kind === 'line' ? n >= 2 : kind === 'area' ? n >= 3 : false;
function putInt(out, v) { let z = v < 0 ? -2 * v - 1 : 2 * v; do { const c = z % 32; z = Math.floor(z / 32); out.push(B64[c + (z > 0 ? 32 : 0)]); } while (z > 0); }
function readInts(s) {
  const out = []; let z = 0, k = 1, n = 0;
  for (const ch of s) {
    const c = B64_AT[ch]; if (c === undefined || ++n > 7) return null;   // 7 characters hold any step round the Earth
    z += (c & 31) * k; k *= 32;
    if (!(c & 32)) { out.push(z % 2 ? -(z + 1) / 2 : z / 2); z = 0; k = 1; n = 0; }
  }
  return n ? null : out;   // a number cut short
}
const nameOut = s => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
function nameIn(s) {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
    return [...text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '').trim()].slice(0, 60).join('').trim() || null;   // no control or direction-flipping characters
  } catch (e) { return null; }
}
/** Shapes ({ kind, coords: [[lon, lat]], name?, road? } or { kind: 'outline', iso }) as the text of a link's d= field ('' if
 *  there is nothing to carry or it would not fit a link). At most MAX_POINTS points; names are cut to 60 characters. */
export function encodeDrawing(shapes) {
  const parts = []; let n = 0;
  for (const s of shapes || []) {
    if (s.kind === 'outline') { if (/^[A-Z]{2}$/.test(s.iso || '')) parts.push('o' + s.iso); continue; }
    if (!CODE[s.kind] || !Array.isArray(s.coords) || !fits(s.kind, s.coords.length) || n + s.coords.length > MAX_POINTS) continue;
    n += s.coords.length;
    const out = [s.kind === 'arrow' && s.road ? 'D' : CODE[s.kind]]; let x0 = 0, y0 = 0;
    for (const [lon, lat] of s.coords) { const x = Math.round(lon * STEP), y = Math.round(lat * STEP); putInt(out, x - x0); putInt(out, y - y0); x0 = x; y0 = y; }
    if (s.name) out.push('*', nameOut([...String(s.name)].slice(0, 60).join('')));
    parts.push(out.join(''));
  }
  const d = parts.join('.');
  return d.length <= LINK_MAX ? d : '';
}
/** A link's d= field back into shapes, keeping only what checks out: [] for anything unusable. */
export function decodeDrawing(text) {
  const s = String(text || ''); if (!s || s.length > LINK_MAX) return [];   // each part is checked on its own: one mangled shape costs only itself
  const out = []; let n = 0;
  for (const part of s.split('.').slice(0, 200)) {
    if (/^o[A-Z]{2}$/.test(part)) { if (!out.some(o => o.iso === part.slice(1))) out.push({ kind: 'outline', iso: part.slice(1) }); continue; }
    const m = part.match(/^([pladD])([A-Za-z0-9_-]+)(?:\*([A-Za-z0-9_-]{2,320}))?$/); if (!m) continue;   // 60 characters of up to 4 bytes
    const ints = readInts(m[2]); if (!ints || ints.length % 2) continue;
    const coords = []; let x = 0, y = 0;
    for (let i = 0; i < ints.length; i += 2) { x += ints[i]; y += ints[i + 1]; coords.push([x / STEP, y / STEP]); }
    const kind = KIND_OF[m[1]];
    if (coords.some(([lon, lat]) => !(Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) || !fits(kind, coords.length) || n + coords.length > MAX_POINTS) continue;
    n += coords.length;
    const sh = { kind, coords }, name = m[3] ? nameIn(m[3]) : null;
    if (name) sh.name = name;
    if (m[1] === 'D') sh.road = true;
    out.push(sh);
  }
  return out;
}
