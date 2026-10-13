// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// NASA EONET (Earth Observatory Natural Event Tracker, v3; CORS, keyless): open wildfires, storms, volcanoes, floods, ice...
// One parser for the 2D map's events and storm tracks, the globe's cyclones and the MCP server. Pure.

export const EONET = 'https://eonet.gsfc.nasa.gov/api/v3/events';
/** Open events active in the last `days` days, optionally one category ('severeStorms', 'wildfires'...). */
export const eonetUrl = ({ days = 20, category = '' } = {}) => `${EONET}?status=open&days=${Math.max(1, Math.min(365, days | 0))}${/^[a-zA-Z]+$/.test(category) ? '&category=' + category : ''}`;
export const EONET_CATS = Object.freeze(['wildfires', 'volcanoes', 'severeStorms', 'floods', 'seaLakeIce', 'earthquakes', 'landslides', 'dustHaze', 'drought', 'snow', 'tempExtremes', 'waterColor', 'manmade']);
/** A colour per category (the 2D map's markers and tracks). */
export const EONET_COLOR = Object.freeze({ wildfires: '#ff8c42', severeStorms: '#7fd0ff', volcanoes: '#ff5c5c', seaLakeIce: '#bfe8ff', floods: '#4fa3ff', drought: '#e0c068', dustHaze: '#d9b38c',
  earthquakes: '#ff7b4f', landslides: '#b08968', manmade: '#e3e3e3', snow: '#ffffff', tempExtremes: '#ff7b00', waterColor: '#4fd1c5' });

const http = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
const t = d => { const v = Date.parse(d); return Number.isFinite(v) ? v : 0; };
const okLL = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
/** The middle of a polygon geometry's outer ring (EONET draws some fires and ice as boxes). */
function middle(g) {
  const ring = (Array.isArray(g.coordinates) && g.coordinates[0]) || [];
  let x = 0, y = 0, n = 0;
  for (const p of ring) if (Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) { x += +p[0]; y += +p[1]; n++; }
  return n ? { lon: x / n, lat: y / n } : null;
}

/** An EONET answer → events, each { id, title, cat (first category id), catIds, cats (titles), lat, lon (the newest fix; a
 *  polygon's middle), date, first (ms of the first fix), n (fixes), track ([{ lat, lon, t, kt }] points, oldest first),
 *  kt (wind of the newest point in knots, storms), mag ('65 kts'), link, sources ([{ id, url }] with web addresses), closed }. */
export function parseEonet(doc) {
  const out = [];
  for (const ev of (doc && doc.events) || []) {
    if (!ev || typeof ev !== 'object') continue;
    const geos = (Array.isArray(ev.geometry) ? ev.geometry : []).filter(g => g && Array.isArray(g.coordinates)).map(g => ({ g, t: t(g.date) })).sort((a, b) => a.t - b.t);
    const track = [];
    let last = null;
    for (const { g, t: ms } of geos) {
      let p = null;
      if (g.type === 'Point') p = { lon: +g.coordinates[0], lat: +g.coordinates[1] };
      else if (g.type === 'Polygon') p = middle(g);
      if (!p || !okLL(p.lat, p.lon)) continue;
      const kt = g.magnitudeUnit === 'kts' && Number.isFinite(+g.magnitudeValue) ? +g.magnitudeValue : null;
      last = { ...p, t: ms, kt, g };
      if (g.type === 'Point') track.push({ lat: p.lat, lon: p.lon, t: ms, kt });
    }
    if (!last) continue;
    const cats = Array.isArray(ev.categories) ? ev.categories.filter(c => c && typeof c === 'object') : [];
    out.push({ id: String(ev.id ?? ''), title: String(ev.title || 'Event'), cat: String(cats[0]?.id || 'other'), catIds: cats.map(c => String(c.id || '')), cats: cats.map(c => String(c.title || '')).filter(Boolean),
      lat: last.lat, lon: last.lon, date: last.t ? new Date(last.t).toISOString() : null, first: geos.length && geos[0].t ? new Date(geos[0].t).toISOString() : null, n: geos.length, track, kt: last.kt,
      mag: last.g.magnitudeValue != null && last.g.magnitudeValue !== '' ? `${last.g.magnitudeValue} ${last.g.magnitudeUnit || ''}`.trim() : null,
      link: http(ev.link), sources: (Array.isArray(ev.sources) ? ev.sources : []).filter(s => s && http(s.url)).map(s => ({ id: String(s.id || 'source'), url: s.url })),
      closed: typeof ev.closed === 'string' ? ev.closed : null });
  }
  return out;
}

/** The newest first (events without a date last). */
export const newestFirst = list => list.slice().sort((a, b) => t(b.date) - t(a.date));
