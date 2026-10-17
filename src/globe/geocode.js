// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Places by name: cities, landmarks, airports, addresses. Photon (komoot), a free geocoder over OpenStreetMap data with
// no key and CORS. Only the words typed (or said) are sent, never the camera position or the visitor's location. No
// Cesium here, so the light tonight.html can use it too (places.js adds flying to a place on the globe).

const API = 'https://photon.komoot.io/api/';
const cache = new Map();
let custom = null, customCredit = '';
/** Another geocoder takes over (Google's, while Photoreal 3D is on: its terms require it); null = Photon again. */
export function setGeocoder(fn, credit = '') { custom = fn; customCredit = credit; cache.clear(); }
/** The line that credits whoever answered place searches. */
export const PHOTON_CREDIT = 'Places: Photon (komoot) · © OpenStreetMap contributors (ODbL)';
export const placesCredit = () => custom ? customCredit : PHOTON_CREDIT;

/** [{ name, sub, lon, lat, type, extent: [w, n, e, s] | null }] for a query (at most `limit`). */
export async function findPlaces(q, limit = 5, near = null) {
  if (!custom) return photon(q, limit, near);
  const key = 'custom|' + q.trim().toLowerCase() + '|' + limit; if (!q.trim()) return [];
  if (cache.has(key)) return cache.get(key);
  const out = await custom(q.trim().slice(0, 80), limit); cache.set(key, out); return out;
}

/** The same search, always from Photon (Tonight promises that a typed place goes there and nowhere else). */
export async function photon(q, limit = 5, near = null) {
  const bias = near && Number.isFinite(near.lat) ? `&lat=${near.lat.toFixed(3)}&lon=${near.lon.toFixed(3)}` : '';   // prefer results near a point
  const key = q.trim().toLowerCase() + '|' + limit + bias; if (!q.trim()) return [];
  if (cache.has(key)) return cache.get(key);
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
