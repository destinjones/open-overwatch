// The live hazard feeds several tools read (earthquakes, tropical cyclones, natural events), fetched and parsed once here:
// the earthquakes, tropical_storms and natural_events tools list them, country_briefing picks out one country's.
import { compass } from '../src/core/passes.js';
import { ToolError } from './feeds.mjs';
import { iso, r1, r2, coord } from './words.mjs';

export const USGS = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
export const EONET = 'https://eonet.gsfc.nasa.gov/api/v3/events';
export const NHC = 'https://www.nhc.noaa.gov/CurrentStorms.json';
export const GDACS = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red';

/** USGS's feed for a magnitude floor and period: every earthquake in it at or above `min` ({ t } in ms, the rest for answers). */
export async function loadQuakes(feeds, { min = 2.5, period = 'day', signal } = {}) {
  const feed = min >= 4.5 ? '4.5' : min >= 2.5 ? '2.5' : min >= 1 ? '1.0' : 'all';
  const d = await feeds.json(`${USGS}${feed}_${period}.geojson`, { ttl: 60e3, timeout: 30e3, signal });
  const out = [];
  for (const f of (d && d.features) || []) {
    const p = f.properties || {}, [lon, lat, depth] = (f.geometry && f.geometry.coordinates) || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(p.mag) || p.mag < min || (p.type && p.type !== 'earthquake')) continue;
    out.push({ magnitude: r1(p.mag), place: String(p.place || coord(lat, lon)), time: iso(p.time), t: p.time, depth_km: Number.isFinite(depth) ? r1(depth) : null, lat: r2(lat), lon: r2(lon),
      tsunami: !!p.tsunami, alert: p.alert || null, felt_reports: p.felt || 0, url: typeof p.url === 'string' ? p.url : null });
  }
  return out;
}

const CAT = [[137, 'Category 5'], [113, 'Category 4'], [96, 'Category 3'], [83, 'Category 2'], [64, 'Category 1'], [34, 'tropical storm strength'], [0, 'depression strength']];
const CLASS = { HU: 'Hurricane', TS: 'Tropical Storm', TD: 'Tropical Depression', STS: 'Subtropical Storm', STD: 'Subtropical Depression', PTC: 'Potential Tropical Cyclone', PC: 'Post-tropical Cyclone', TY: 'Typhoon' };
/** Every active tropical cyclone: NOAA NHC's advisories, and GDACS for every basin (merged by name). Throws when neither answers. */
export async function loadStorms(feeds, now, signal) {
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const [nhc, gd] = await Promise.all([feeds.json(NHC, { ttl: 10 * 60e3, signal }).catch(() => null),
    feeds.json(`${GDACS}&fromdate=${day(now - 10 * 864e5)}&todate=${day(now)}`, { ttl: 15 * 60e3, timeout: 30e3, signal }).catch(() => null)]);
  if (!nhc && !gd) throw new ToolError('Neither NOAA NHC nor GDACS answered; try again in a few minutes', 'unavailable');
  const list = [];
  for (const s of (nhc && nhc.activeStorms) || []) {
    const lat = +s.latitudeNumeric, lon = +s.longitudeNumeric; if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const kt = +s.intensity || null;
    list.push({ name: String(s.name || s.id), class: CLASS[s.classification] || s.classification || 'Storm', wind_kt: kt, strength: kt != null ? CAT.find(([m]) => kt >= m)[1] : null,
      pressure_mb: +s.pressure || null, movement: s.movementDir != null && s.movementSpeed != null ? `toward ${compass(+s.movementDir)} at ${s.movementSpeed} mph` : null, lat, lon,
      updated: s.lastUpdate || null, advisory: s.publicAdvisory && /^https:\/\//.test(s.publicAdvisory.url || '') ? s.publicAdvisory.url : null, source: 'NOAA NHC' });
  }
  for (const f of (gd && gd.features) || []) {
    const p = f.properties || {}, c = (f.geometry && f.geometry.coordinates) || [];
    if (String(p.iscurrent) !== 'true' || !Number.isFinite(+c[1])) continue;
    const name = String(p.eventname || '').replace(/-\d\d$/, ''), nice = name ? name[0] + name.slice(1).toLowerCase() : 'Storm', sev = p.severitydata || {};
    const g = { alert: String(p.alertlevel || '') || null, peak_wind_kmh: Number.isFinite(+sev.severity) ? Math.round(+sev.severity) : null, peak: String(sev.severitytext || '') || null, countries: String(p.country || '') || null,
      report: p.url && /^https:\/\//.test(p.url.report || '') ? p.url.report : null };
    const same = list.find(s => s.name.toLowerCase() === nice.toLowerCase());
    if (same) { same.gdacs = g; continue; }
    list.push({ name: nice, class: 'Tropical cyclone', wind_kt: null, strength: null, pressure_mb: null, movement: null, lat: +c[1], lon: +c[0], updated: p.todate ? p.todate + 'Z' : null, advisory: null, source: 'GDACS', gdacs: g });
  }
  return list;
}

export const EONET_CATS = ['wildfires', 'volcanoes', 'severeStorms', 'floods', 'seaLakeIce', 'earthquakes', 'landslides', 'dustHaze', 'drought', 'snow', 'tempExtremes', 'waterColor', 'manmade'];
/** NASA EONET's open events active in the last `days` (optionally one category), at their latest position, newest first. */
export async function loadEvents(feeds, { days = 30, category, signal } = {}) {
  const d = await feeds.json(`${EONET}?status=open&days=${days}${category ? `&category=${category}` : ''}`, { ttl: 15 * 60e3, timeout: 40e3, signal });
  const out = [];
  for (const ev of (d && d.events) || []) {
    const g = (ev.geometry || []).filter(x => x && x.coordinates).sort((x, y) => Date.parse(y.date) - Date.parse(x.date))[0]; if (!g) continue;
    let lon = +g.coordinates[0], lat = +g.coordinates[1];
    if (g.type === 'Polygon') { const ring = g.coordinates[0] || []; lon = ring.reduce((s, p) => s + p[0], 0) / ring.length; lat = ring.reduce((s, p) => s + p[1], 0) / ring.length; }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ id: String(ev.id), title: String(ev.title || 'Event'), categories: (ev.categories || []).map(c => c.title).filter(Boolean), latest: g.date || null, lat: r2(lat), lon: r2(lon),
      magnitude: g.magnitudeValue != null ? `${g.magnitudeValue} ${g.magnitudeUnit || ''}`.trim() : null, sources: (ev.sources || []).map(s => s.url).filter(u => /^https?:\/\//.test(u || '')).slice(0, 3), link: ev.link || null });
  }
  return out.sort((x, y) => Date.parse(y.latest) - Date.parse(x.latest));
}
