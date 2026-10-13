// Submarine cables and their landing stations (TeleGeography's submarine cable map data, the files the 2D map draws):
// parse the GeoJSON once, then find what comes ashore or runs near a place. Distances are measured on a local flat
// projection around the place (good to a percent or so within a couple of thousand km), across the antimeridian too.
// Pure (test/cables.test.mjs); the MCP server's submarine_cables tool uses it.

export const CABLE_GEO = 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json';
export const LANDING_GEO = 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json';
/** A copy of the same files on GitHub, for when the map's own server is down. */
export const CABLE_MIRROR = 'https://raw.githubusercontent.com/lintaojlu/submarine_cable_information/master/web/public/api/v3/';
export const cableUrl = id => `https://www.submarinecablemap.com/api/v3/cable/${encodeURIComponent(id)}.json`;
export const landingUrl = id => `https://www.submarinecablemap.com/api/v3/landing-point/${encodeURIComponent(id)}.json`;
export const cablePage = id => `https://www.submarinecablemap.com/submarine-cable/${encodeURIComponent(id)}`;

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
    out.push({ id: String(p.id), name: String(p.name || p.id), color: /^#[0-9a-f]{3,8}$/i.test(p.color || '') ? p.color : null, lines, box: [w, s, e, n] });
  }
  return out;
}

/** landing-point-geo.json -> [{ id, name, lat, lon, tbd }]. */
export function parseLandings(fc) {
  const out = [];
  for (const f of (fc && fc.features) || []) {
    const p = f.properties || {}, c = (f.geometry && f.geometry.coordinates) || [];
    if (!p.id || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    out.push({ id: String(p.id), name: String(p.name || p.id), lat: c[1], lon: c[0], tbd: !!p.is_tbd });
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
