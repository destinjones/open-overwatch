// The live hazard feeds several tools read (earthquakes, tropical cyclones, natural events), fetched once here and parsed
// by the shared core parsers the globe and the 2D map use (core/quakes.js, core/cyclones.js, core/eonet.js): the
// earthquakes, tropical_storms and natural_events tools list them, country_briefing and volcanoes pick out a place's.
import { parseUsgs, usgsUrl, usgsFeedFor } from '../src/core/quakes.js';
import { parseEonet, eonetUrl, newestFirst, EONET_CATS } from '../src/core/eonet.js';
import { parseNhcCurrent, parseGdacsCyclones, gdacsTcUrl, NHC_CURRENT, NHC_CLASS } from '../src/core/cyclones.js';
import { ToolError } from './feeds.mjs';
import { iso, r1, r2, coord } from './words.mjs';

export { EONET_CATS };

/** USGS's feed for a magnitude floor and period: every earthquake in it at or above `min` ({ t } in ms, the rest for answers). */
export async function loadQuakes(feeds, { min = 2.5, period = 'day', signal } = {}) {
  const d = await feeds.json(usgsUrl(usgsFeedFor(min, period)), { ttl: 60e3, timeout: 30e3, signal });
  return parseUsgs(d, { min, quakesOnly: true }).map(q => ({ magnitude: r1(q.mag), place: q.place || coord(q.lat, q.lon), time: iso(q.time), t: q.time, depth_km: q.depth != null ? r1(q.depth) : null,
    lat: r2(q.lat), lon: r2(q.lon), tsunami: q.tsunami, alert: q.alert, felt_reports: q.felt || 0, url: q.url || null }));
}

const CAT = [[137, 'Category 5'], [113, 'Category 4'], [96, 'Category 3'], [83, 'Category 2'], [64, 'Category 1'], [34, 'tropical storm strength'], [0, 'depression strength']];
/** Every active tropical cyclone: NOAA NHC's advisories, and GDACS for every basin (merged by name). Throws when neither answers. */
export async function loadStorms(feeds, now, signal) {
  const [nhc, gd] = await Promise.all([feeds.json(NHC_CURRENT, { ttl: 10 * 60e3, signal }).catch(() => null),
    feeds.json(gdacsTcUrl(now), { ttl: 15 * 60e3, timeout: 30e3, signal }).catch(() => null)]);
  if (!nhc && !gd) throw new ToolError('Neither NOAA NHC nor GDACS answered; try again in a few minutes', 'unavailable');
  const list = [];
  for (const s of parseNhcCurrent(nhc)) {
    list.push({ name: s.name, class: NHC_CLASS[s.code] || s.code || 'Storm', wind_kt: s.kt, strength: s.kt != null ? CAT.find(([m]) => s.kt >= m)[1] : null,
      pressure_mb: s.pressure, movement: s.movement, lat: s.lat, lon: s.lon, updated: s.advisory, advisory: s.url || null, source: 'NOAA NHC' });
  }
  for (const c of parseGdacsCyclones(gd)) {
    if (c.lat == null) continue;
    const g = { alert: c.alert || null, peak_wind_kmh: c.kmh != null ? Math.round(c.kmh) : null, peak: c.peak || null, countries: c.countries || null, report: c.report || null };
    const same = list.find(s => s.name.toLowerCase() === c.nice.toLowerCase());
    if (same) { same.gdacs = g; continue; }
    list.push({ name: c.nice, class: 'Tropical cyclone', wind_kt: null, strength: null, pressure_mb: null, movement: null, lat: c.lat, lon: c.lon, updated: c.to ? new Date(c.to).toISOString().replace('.000Z', 'Z') : null, advisory: null, source: 'GDACS', gdacs: g });
  }
  return list;
}

/** NASA EONET's open events active in the last `days` (optionally one category), at their latest position, newest first. */
export async function loadEvents(feeds, { days = 30, category, signal } = {}) {
  const d = await feeds.json(eonetUrl({ days, category: category || '' }), { ttl: 15 * 60e3, timeout: 40e3, signal });
  return newestFirst(parseEonet(d)).map(e => ({ id: e.id, title: e.title, categories: e.cats, latest: e.date ? e.date.replace('.000Z', 'Z') : null,
    lat: r2(e.lat), lon: r2(e.lon), magnitude: e.mag, sources: e.sources.map(s => s.url).slice(0, 3), link: e.link || null }));
}
