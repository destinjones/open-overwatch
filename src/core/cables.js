// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Submarine cables and their landing stations (TeleGeography's submarine cable map data): where to get them and the
// click test that finds the cable under the pointer; for the MCP server, what comes ashore or runs near a place and each
// cable's own record. Pure (test/cables.test.mjs).

// live TeleGeography first (no CORS header: through a relay), then a GitHub copy that is months behind
export const CABLE_URLS = Object.freeze(['https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
  'https://raw.githubusercontent.com/lintaojlu/submarine_cable_information/master/web/public/api/v3/cable/cable-geo.json']);
export const LANDING_URLS = Object.freeze(['https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json',
  'https://raw.githubusercontent.com/lintaojlu/submarine_cable_information/master/web/public/api/v3/landing-point/landing-point-geo.json']);
export const cablePage = id => `https://www.submarinecablemap.com/submarine-cable/${encodeURIComponent(id)}`;
export const landingPage = id => `https://www.submarinecablemap.com/landing-point/${encodeURIComponent(id)}`;
export const okColor = c => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : null);

/** Landing points (GeoJSON) → [{ id, name, lat, lon }]. */
export const parseLandings = fc => ((fc && fc.features) || []).filter(f => f && f.geometry && Array.isArray(f.geometry.coordinates)).map(f => {
  const [lon, lat] = f.geometry.coordinates, p = f.properties || {};
  return { id: String(p.id ?? ''), name: String(p.name || ''), lat: +lat, lon: +lon };
}).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));

/** The cable (a feature of the cable GeoJSON) nearest to lat, lon within tol metres, or null. A local flat frame in metres
 *  around the point; segments that jump half the world (drawn across the antimeridian) are skipped. */
export function nearestCable(features, lat, lon, tol) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540, P = c => [(((c[0] - lon) % 360 + 540) % 360 - 180) * kx, (c[1] - lat) * ky];
  let best = null, bd = tol;
  for (const f of features || []) {
    const g = f && f.geometry; if (!g) continue;
    const lines = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
    for (const line of lines) {
      let a = null;
      for (const c of line) {
        const b = P(c);
        if (a && Math.abs(b[0] - a[0]) < 180 * kx && Math.min(Math.abs(a[1]), Math.abs(b[1])) < bd + Math.abs(b[1] - a[1])) {
          const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / l2)) : 0;
          const d = Math.hypot(a[0] + t * dx, a[1] + t * dy); if (d < bd) { bd = d; best = f; }
        }
        a = b;
      }
    }
  }
  return best;
}

// ---- near a place (the MCP server's submarine_cables tool) -----------------------------------------------------------
/** One cable's and one landing station's own records on the submarine cable map. */
export const cableUrl = id => `https://www.submarinecablemap.com/api/v3/cable/${encodeURIComponent(id)}.json`;
export const landingUrl = id => `https://www.submarinecablemap.com/api/v3/landing-point/${encodeURIComponent(id)}.json`;

const KM_DEG = 111.32, D2R = Math.PI / 180;
const wrap = d => ((d + 540) % 360) - 180;

/** cable-geo.json -> [{ id, name, color, lines: [[[lon, lat], …], …], box: [w, s, e, n] (lon may run past ±180) }]. */
export function parseCables(fc) {
  const out = [];
  for (const f of (fc && fc.features) || []) {
    const p = f.properties || {}, g = f.geometry || {};
    const lines = (g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : []).map(l => (l || []).filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))).filter(l => l.length > 1);
    if (!lines.length || !p.id) continue;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const l of lines) for (const [x, y] of l) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    out.push({ id: String(p.id), name: String(p.name || p.id), color: okColor(p.color), lines, box: [w, s, e, n] });
  }
  return out;
}

/** A local flat frame around (lat0, lon0): km east and north of it (the longitude difference wrapped). */
function frame(lat0, lon0) {
  const kx = KM_DEG * Math.cos(lat0 * D2R);
  return ([lon, lat]) => [wrap(lon - lon0) * kx, (lat - lat0) * KM_DEG];
}

/** The nearest a polyline set comes to a point: { km, lat, lon } (the closest point on it), or null when it is empty. */
export function nearestOnLines(lines, lat, lon) {
  const to = frame(lat, lon), kx = KM_DEG * Math.cos(lat * D2R);
  let best = null;
  for (const l of lines) {
    let a = to(l[0]);
    for (let i = 1; i < l.length; i++) {
      const b = to(l[i]), dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
      if (Math.abs(dx) > 10000) { a = b; continue; }   // a hop the wrong way round the world (data across the antimeridian)
      const k = len2 > 0 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2)) : 0;
      const px = a[0] + k * dx, py = a[1] + k * dy, d = Math.hypot(px, py);
      if (!best || d < best.km) best = { km: d, lat: lat + py / KM_DEG, lon: wrap(lon + px / Math.max(1e-9, kx)) };
      a = b;
    }
  }
  return best;
}

/** Could a box (lon possibly past ±180) come within `km` of the point? A cheap test before measuring. */
function boxNear([w, s, e, n], lat, lon, km) {
  const dLat = km / KM_DEG;
  if (lat < s - dLat || lat > n + dLat) return false;
  if (e - w >= 360) return true;
  const dLon = km / (KM_DEG * Math.max(0.02, Math.cos(Math.min(89, Math.abs(lat) + dLat) * D2R)));
  for (const x of [lon - 360, lon, lon + 360]) if (x >= w - dLon && x <= e + dLon) return true;
  return false;
}

/** Cables that come within `km` of a point, nearest first: [{ id, name, color, km, at: { lat, lon } }]. */
export function cablesNear(cables, lat, lon, km) {
  const out = [];
  for (const c of cables) {
    if (!boxNear(c.box, lat, lon, km)) continue;
    const p = nearestOnLines(c.lines, lat, lon);
    if (p && p.km <= km) out.push({ id: c.id, name: c.name, color: c.color, km: p.km, at: { lat: p.lat, lon: p.lon } });
  }
  return out.sort((a, b) => a.km - b.km);
}

/** Landing stations within `km` of a point, nearest first, each with its distance (km). */
export function landingsNear(points, lat, lon, km) {
  const to = frame(lat, lon), out = [];
  for (const p of points) { const [x, y] = to([p.lon, p.lat]), d = Math.hypot(x, y); if (d <= km) out.push({ ...p, km: d }); }
  return out.sort((a, b) => a.km - b.km);
}

/** One cable's own record (/api/v3/cable/<id>.json) -> { id, name, length_km, owners, suppliers, ready, planned, landings, url }. */
export function parseCable(d) {
  if (!d || !d.id) return null;
  const km = parseFloat(String(d.length || '').replace(/,/g, ''));
  const year = Number.isFinite(+d.rfs_year) && +d.rfs_year > 1800 ? +d.rfs_year : null;
  return { id: String(d.id), name: String(d.name || d.id), length_km: Number.isFinite(km) && km > 0 ? km : null,
    owners: d.owners ? String(d.owners).split(/,\s*/).map(s => s.trim()).filter(Boolean) : [], suppliers: d.suppliers ? String(d.suppliers) : null,
    ready: year, ready_text: d.rfs ? String(d.rfs) : year ? String(year) : null, planned: !!d.is_planned,
    landings: (d.landing_points || []).map(l => ({ id: String(l.id || ''), name: String(l.name || ''), country: l.country ? String(l.country) : null, tbd: !!l.is_tbd })).filter(l => l.name),
    url: /^https?:\/\//.test(d.url || '') ? d.url : null };
}

/** One landing station's record (/api/v3/landing-point/<id>.json) -> { id, name, country, cables: [{ id, name, ready, planned }] }. */
export function parseLanding(d) {
  if (!d || !d.id) return null;
  return { id: String(d.id), name: String(d.name || d.id), country: d.country ? String(d.country) : null,
    cables: (d.cables || []).map(c => ({ id: String(c.id || ''), name: String(c.name || c.id || ''), ready: Number.isFinite(+c.rfs_year) && +c.rfs_year > 1800 ? +c.rfs_year : null, planned: !!c.is_planned })).filter(c => c.id) };
}
