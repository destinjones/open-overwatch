// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Which country is at a longitude/latitude? Plain geometry on the simplified borders in data/borders.json ([{ iso, name, poly }]:
// poly = list of polygons, each a list of rings of [lon, lat], the first the outline and the rest holes). DOM-free, so Node tests it.

/** Even-odd test: is (x, y) inside the ring? */
export function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** [west, south, east, north] of a polygon's outline. */
export function boxOf(poly) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [lo, la] of poly[0]) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la; }
  return [w, s, e, n];
}

/** Does a ring jump across the antimeridian (an edge more than 180° of longitude long)? */
const crosses = ring => ring.some((q, i) => i > 0 && Math.abs(q[0] - ring[i - 1][0]) > 180);
const east = ring => ring.map(([lo, la]) => [lo < 0 ? lo + 360 : lo, la]);

/** Add the bounding boxes the lookups use (once, after loading). A part drawn across the antimeridian (Russia's mainland
 *  with Chukotka, Wrangel Island) also gets its rings with longitudes run on past 180 (b.east[k]), so the even-odd test
 *  sees one shape instead of a band round the world that would claim Alaska and Canada. */
export function prepare(borders) {
  for (const b of borders) {
    b.box = b.poly.map(boxOf);
    b.east = b.poly.map(p => (crosses(p[0]) ? p.map(east) : null));
    b.wbox = b.poly.map((p, k) => (b.east[k] ? boxOfAny(b.east[k]) : b.box[k]));   // each part's box, a crossing part kept whole
  }
  return borders;
}

/** Is the point in this country (any of its parts, and not in a hole)? Needs prepare() first. */
export function inCountry(b, x, y) {
  return b.poly.some((p, k) => {
    const e = b.east && b.east[k];
    if (e) { const xe = x < 0 ? x + 360 : x; return y >= b.box[k][1] && y <= b.box[k][3] && inRing(e[0], xe, y) && !e.slice(1).some(h => inRing(h, xe, y)); }
    const bx = b.box[k]; return x >= bx[0] && x <= bx[2] && y >= bx[1] && y <= bx[3] && inRing(p[0], x, y) && !p.slice(1).some(h => inRing(h, x, y));
  });
}

/** The border record at the point, or null (at sea). */
export function countryAt(borders, lon, lat) { return borders.find(b => inCountry(b, lon, lat)) || null; }

/** The biggest part's bounding box, so a far-off island does not drag a fly-to away from the mainland. */
export function mainBox(b) {
  let best = b.box[0], area = 0;
  for (const bx of b.box) { const a = (bx[2] - bx[0]) * (bx[3] - bx[1]); if (a > area) { area = a; best = bx; } }
  return best;
}

/** [west, south, east, north] of a ring set whose longitudes may run past 180 (b.east[k]): east > 180 for a crossing part. */
function boxOfAny(poly) {
  let w = Infinity, s = 90, e = -Infinity, n = -90;
  for (const [lo, la] of poly[0]) { if (lo < w) w = lo; if (lo > e) e = lo; if (la < s) s = la; if (la > n) n = la; }
  return [w, s, e, n];
}

/** The biggest part's box with a part that crosses the antimeridian kept whole: west < east always, and east runs past 180
 *  for such a part (Russia's mainland: about [27.4, 41.2, 190.3, 77.7]). mainBox gives the flat box ([-180 … 179.9] for
 *  Russia); the fly-to, the outline label and the briefing's "near it" tests want this one (with boxContains/boxCentre). Needs prepare(). */
export function mainBoxWrapped(b) {
  let best = null, area = -1;
  b.poly.forEach((p, k) => {
    const bx = b.east && b.east[k] ? boxOfAny(b.east[k]) : b.box ? b.box[k] : boxOf(p), a = (bx[2] - bx[0]) * (bx[3] - bx[1]);
    if (a > area) { area = a; best = bx; }
  });
  return best;
}

/** Is lat/lon inside the box (grown by `pad` degrees on every side)? The box may cross the antimeridian, written either way:
 *  west > east, or east past 180 (mainBoxWrapped). */
export function boxContains(box, lat, lon, pad = 0) {
  const [w, s, e0, n] = box, e = e0 < w ? e0 + 360 : e0;
  if (lat < s - pad || lat > n + pad) return false;
  return [lon, lon + 360, lon - 360].some(x => x >= w - pad && x <= e + pad);
}

/** The middle of a box as [lon, lat], its longitude wrapped to -180…180 (a crossing box's middle is on its own side). */
export function boxCentre(box) {
  const [w, s, e0, n] = box, e = e0 < w ? e0 + 360 : e0;
  return [((((w + e) / 2) + 540) % 360) - 180, (s + n) / 2];
}

/** How wide a box is in degrees of longitude (a crossing box measured the short way across the antimeridian). */
export const boxWidth = box => (box[2] < box[0] ? box[2] + 360 : box[2]) - box[0];

/** How far "off its coast" reaches: degrees (of latitude, ~280 km) from the nearest point of a country's simplified outline. */
export const OFFSHORE_DEG = 2.5;

/** Degrees (longitude scaled by cos(lat), so about 111 km each) from lat/lon to the nearest edge of any of the country's part
 *  outlines, looking only at parts whose box grown by `pad` reaches the point: Infinity when none does. Needs prepare(). */
export function coastDistance(b, lat, lon, pad = OFFSHORE_DEG) {
  const c = Math.max(0.05, Math.cos(lat * Math.PI / 180)), padLon = pad / c;
  let best = Infinity;
  b.poly.forEach((p, k) => {
    const [w, s, e, n] = b.wbox[k];
    if (lat < s - pad || lat > n + pad) return;
    const x = [lon, lon + 360, lon - 360].find(v => v >= w - padLon && v <= e + padLon); if (x == null) return;
    const ring = b.east[k] ? b.east[k][0] : p[0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i]; if (Math.abs(x2 - x1) > 180) continue;   // the jump of a ring drawn across 180
      const ax = (x1 - x) * c, ay = y1 - lat, dx = (x2 - x1) * c, dy = y2 - y1, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0, ex = ax + t * dx, ey = ay + t * dy, d = Math.sqrt(ex * ex + ey * ey);
      if (d < best) best = d;
    }
  });
  return best;
}

/** Is lat/lon at sea "off the coast" of country b: in nobody's outline, within `pad` degrees of b's, and no other country's
 *  outline nearer? (The Aleutian trench is off Alaska, not Russia; Hokkaido's Pacific coast is Japan's, not the Kurils'.) */
export function offCoast(borders, b, lat, lon, pad = OFFSHORE_DEG) {
  const d = coastDistance(b, lat, lon, pad);
  if (!(d <= pad) || countryAt(borders, lon, lat)) return false;
  return !borders.some(o => o !== b && coastDistance(o, lat, lon, d) < d);
}
