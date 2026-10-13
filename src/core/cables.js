// Submarine cables and their landing stations (TeleGeography's submarine cable map data): where to get them and the
// click test that finds the cable under the pointer. Pure.

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
