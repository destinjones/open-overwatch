// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// GDACS (Global Disaster Alert and Coordination System, EU JRC + UN OCHA; CORS, keyless): the disaster alert list behind
// the 2D map's "Disaster alerts" layer. Pure: the paging is a loop over the injected json().
import { GDACS_API } from './cyclones.js';

export const GDACS_TYPES = Object.freeze({ EQ: 'Earthquake', TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcano', WF: 'Wildfire', DR: 'Drought' });
export const GDACS_LEVEL_COLOR = Object.freeze({ Red: '#ff4d5e', Orange: '#ffb44d', Green: '#5fd3ff' });
const day = ms => new Date(ms).toISOString().slice(0, 10);
/** One page (100 events, newest-modified first) of every alert of the last `days` days. */
export const gdacsEventsUrl = (page = 1, now = Date.now(), days = 14) =>
  `${GDACS_API}events/geteventlist/SEARCH?eventlist=${Object.keys(GDACS_TYPES).join(';')}&fromDate=${day(now - days * 864e5)}&toDate=${day(now)}&alertlevel=Green;Orange;Red&pagenumber=${page}`;
/** GDACS times are UTC without a zone: say so, so Date.parse doesn't read them as local time. */
export const utc = s => (typeof s === 'string' && s && !/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s + 'Z' : s);

/** Event-list features → alerts, one per event (its latest episode: the list comes newest first), each the GDACS
 *  properties plus lat, lon, with fromdate / todate made explicit UTC. Green earthquakes are left out (USGS has them). */
export function parseGdacsEvents(features, { greenQuakes = false } = {}) {
  const out = [], seen = new Set();
  for (const f of features || []) {
    if (!f || !f.geometry || f.geometry.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates || [];
    if (!Number.isFinite(+lat) || !Number.isFinite(+lon)) continue;
    const p = { ...(f.properties || {}), lat: +lat, lon: +lon };
    const key = p.eventtype + p.eventid; if (p.eventid != null && seen.has(key)) continue; seen.add(key);
    p.fromdate = utc(p.fromdate); p.todate = utc(p.todate);
    if (p.eventtype === 'EQ' && p.alertlevel === 'Green' && !greenQuakes) continue;
    out.push(p);
  }
  return out;
}
/** Every page of the last `days` days (at most `pages` of 100), through json(url, opts). */
export async function loadGdacsEvents(json, { now = Date.now(), days = 14, pages = 10, opts = {} } = {}) {
  const features = [];
  for (let page = 1; page <= pages; page++) {
    const d = await json(gdacsEventsUrl(page, now, days), opts);
    const fs = (d && d.features) || []; features.push(...fs); if (fs.length < 100) break;
  }
  return parseGdacsEvents(features);
}
