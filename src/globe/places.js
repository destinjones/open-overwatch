// Places by name: cities, landmarks, airports, addresses. Photon (komoot), a free geocoder over OpenStreetMap data with
// no key and CORS. Only the words typed (or said) are sent, never the camera position. Used by Search and voice.
import { C } from './env.js';
import { camera } from './viewer.js';
import { release } from './follow.js';

const API = 'https://photon.komoot.io/api/';
const cache = new Map();
let custom = null, customCredit = '';
/** Another geocoder takes over (Google's, while Photoreal 3D is on: its terms require it); null = Photon again. */
export function setGeocoder(fn, credit = '') { custom = fn; customCredit = credit; cache.clear(); }
/** The line that credits whoever answered place searches. */
export const placesCredit = () => custom ? customCredit : 'Places: Photon (komoot) · © OpenStreetMap contributors';

/** [{ name, sub, lon, lat, type, extent: [w, n, e, s] | null }] for a query (at most `limit`). */
export async function findPlaces(q, limit = 5, near = null) {
  const bias = near && Number.isFinite(near.lat) ? `&lat=${near.lat.toFixed(3)}&lon=${near.lon.toFixed(3)}` : '';   // prefer results near a point
  const key = q.trim().toLowerCase() + '|' + limit + bias; if (key.length < 3) return [];
  if (cache.has(key)) return cache.get(key);
  if (custom) { const out = await custom(q.trim().slice(0, 80), limit); cache.set(key, out); return out; }
  const lang = (navigator.language || 'en').slice(0, 2), url = `${API}?q=${encodeURIComponent(q.trim().slice(0, 80))}&limit=${limit}${bias}${['en', 'de', 'fr', 'it'].includes(lang) ? '&lang=' + lang : ''}`;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const out = ((await r.json()).features || []).map(f => {
      const p = f.properties || {}, [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const where = [p.city !== p.name ? p.city : null, p.state !== p.name ? p.state : null, p.country !== p.name ? p.country : null].filter(Boolean);
      const ext = Array.isArray(p.extent) && p.extent.length === 4 && p.extent.every(Number.isFinite) ? p.extent : null;
      return { name: String(p.name || p.street || 'Unnamed place'), sub: [typeName(p), ...where].filter(Boolean).join(' · '), lon, lat, type: p.osm_value || p.type || '', extent: ext };
    }).filter(Boolean);
    cache.set(key, out); return out;
  } finally { clearTimeout(t); }
}

const TYPES = { country: 'Country', state: 'Region', city: 'City', town: 'Town', village: 'Village', aerodrome: 'Airport', airport: 'Airport', peak: 'Mountain', volcano: 'Volcano', island: 'Island', stadium: 'Stadium', museum: 'Museum', attraction: 'Landmark', monument: 'Monument', castle: 'Castle', bridge: 'Bridge', tower: 'Tower', university: 'University', park: 'Park', lake: 'Lake', river: 'River', sea: 'Sea' };
const typeName = p => TYPES[p.osm_value] || TYPES[p.type] || '';

/** Fly to a place: a country or region by its outline, anything smaller at a height that suits it, tilted. */
export function flyToPlace(pl) {
  release();
  const big = { country: 2.6e6, state: 9.0e5, county: 2.5e5, region: 9.0e5, city: 2.6e4, town: 1.2e4, village: 6.0e3, island: 6.0e4, aerodrome: 6.0e3, airport: 6.0e3 }[pl.type];
  const wide = pl.extent && Math.max(Math.abs(pl.extent[2] - pl.extent[0]), Math.abs(pl.extent[1] - pl.extent[3])) > 0.6;   // ~60 km: a region, not a building
  if (pl.extent && (pl.type === 'country' || pl.type === 'state' || pl.type === 'region' || (!pl.type && wide))) {
    const [w, n, e, s] = pl.extent;
    camera.flyTo({ destination: C.Rectangle.fromDegrees(w, s, e, n), duration: 3 }); return;
  }
  const h = big || 2500, back = h / Math.tan(C.Math.toRadians(42)) / 111000;   // stand off to the south so a 42-degree tilt looks at it
  camera.flyTo({ destination: C.Cartesian3.fromDegrees(pl.lon, pl.lat - back, h), orientation: { heading: 0, pitch: C.Math.toRadians(-42), roll: 0 }, duration: 3 });
}
