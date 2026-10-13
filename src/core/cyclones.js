// Tropical cyclones, assembled once for every view: NASA EONET's storm tracks (worldwide), NOAA NHC's advisories
// (Atlantic, East and Central Pacific: name, pressure, movement; CurrentStorms.json has no CORS, so through a relay),
// NOAA's tropical map service (forecast points, track, cone, watches and warnings, the wind field: CORS) and GDACS
// (a forecast track and cone for every other basin: JTWC and others). The fetching is injected (`json(url, opts)`), so
// the globe, the 2D map and Node tests share the whole recipe. Parsing of the forecast layers: core/hazards.js.
import { nhcForecasts, gdacsForecast } from './hazards.js';
import { parseEonet, eonetUrl } from './eonet.js';

/** Saffir-Simpson by wind (kt): [lowest kt, category (0 tropical storm, -1 depression), colour]. */
export const CYCLONE_CAT = Object.freeze([[137, 5, '#ff4df0'], [113, 4, '#ff4d5e'], [96, 3, '#ff7b4f'], [83, 2, '#ffb44d'], [64, 1, '#ffe36e'], [34, 0, '#7fd0ff'], [0, -1, '#9fb3bf']]);
export const category = kt => CYCLONE_CAT.find(([min]) => (Number.isFinite(kt) ? kt : 0) >= min);
export const catName = kt => { const c = category(kt)[1]; return c > 0 ? `Category ${c}` : c === 0 ? 'Tropical storm' : 'Depression or low'; };
/** NHC's classification codes. */
export const NHC_CLASS = Object.freeze({ HU: 'Hurricane', TS: 'Tropical Storm', TD: 'Tropical Depression', STS: 'Subtropical Storm', STD: 'Subtropical Depression', PTC: 'Potential Tropical Cyclone', PC: 'Post-tropical Cyclone', TY: 'Typhoon' });
/** A track segment's wind from its category label (GDACS and NHC past tracks), for its colour. */
export const KIND_KT = Object.freeze({ TD: 30, TS: 50, HU: 80, TY: 80, MH: 100, STY: 130 });

export const NHC_CURRENT = 'https://www.nhc.noaa.gov/CurrentStorms.json';
export const NOAA_TROPICAL = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer/';
/** The map service's layers: [layer id, fields, the nhcForecasts input it feeds]. */
export const NOAA_LAYERS = Object.freeze([[5, 'idp_source,stormname,tcdvlp,tau,maxwind,gust,mslp,datelbl,fldatelbl', 'points'], [6, 'idp_source', 'tracks'], [7, 'idp_source,stormname', 'cones'],
  [8, 'idp_source,tcww', 'warnings'], [16, 'stormid,radii,tau', 'winds'], [11, 'idp_source,stormtype', 'past']]);
export const noaaLayerUrl = (id, fields) => `${NOAA_TROPICAL}${id}/query?where=1%3D1&outFields=${fields}&outSR=4326&geometryPrecision=3&f=geojson`;
const day = ms => new Date(ms).toISOString().slice(0, 10);
export const GDACS_API = 'https://www.gdacs.org/gdacsapi/api/';
/** GDACS's cyclones of the last `days` days. */
export const gdacsTcUrl = (now = Date.now(), days = 10) => `${GDACS_API}events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red&fromdate=${day(now - days * 864e5)}&todate=${day(now)}`;
export const gdacsGeometryUrl = (eventid, episodeid) => `${GDACS_API}polygons/getgeometry?eventtype=TC&eventid=${encodeURIComponent(eventid)}&episodeid=${encodeURIComponent(episodeid)}`;

const https = u => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
const POINTS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass16 = deg => POINTS16[Math.round((((+deg % 360) + 360) % 360) / 22.5) % 16];
/** Great-circle-ish distance in km (equirectangular: fine for "the same storm, within 300 km"). */
export const distKm = (a, b) => { const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r; return Math.hypot(x, y) * 6371; };

/** NHC's CurrentStorms.json → [{ id, name, code, title ('Hurricane Erin'), lat, lon, kt, pressure (mb), dir (deg), mph,
 *  movement ('toward NW at 12 mph'), advisory (time text), url (public advisory), forecastUrl, advNum, bin }]. */
export function parseNhcCurrent(doc) {
  const out = [];
  for (const s of (doc && doc.activeStorms) || []) {
    const lat = +s.latitudeNumeric, lon = +s.longitudeNumeric; if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const code = String(s.classification || ''), name = String(s.name || s.id || '');
    const dir = s.movementDir != null && Number.isFinite(+s.movementDir) ? +s.movementDir : null, mph = s.movementSpeed != null && Number.isFinite(+s.movementSpeed) ? +s.movementSpeed : null;
    out.push({ id: String(s.id || name), name, code, title: `${NHC_CLASS[code] || code} ${name}`.trim(), lat, lon, kt: +s.intensity || null, pressure: +s.pressure || null, dir, mph,
      movement: dir != null && mph != null ? `toward ${compass16(dir)} at ${mph} mph` : null, advisory: s.lastUpdate ? String(s.lastUpdate) : null,
      url: https(s.publicAdvisory && s.publicAdvisory.url), advNum: s.publicAdvisory && s.publicAdvisory.advNum ? String(s.publicAdvisory.advNum) : '',
      forecastUrl: https(s.forecastAdvisory && s.forecastAdvisory.url), bin: String(s.binNumber || '') });
  }
  return out;
}

/** GDACS's event list (cyclones) → the current ones: [{ eventid, episodeid, name ('ERIN'), nice ('Erin'), alert, peak ('...'),
 *  kmh (strongest wind so far), countries, lat, lon, report, to (ms) }]. */
export function parseGdacsCyclones(doc) {
  const out = [];
  for (const f of (doc && doc.features) || []) {
    const p = (f && f.properties) || {}, c = (f && f.geometry && f.geometry.coordinates) || [];
    if (String(p.iscurrent) !== 'true') continue;
    const name = String(p.eventname || '').replace(/-\d\d$/, ''), sev = p.severitydata || {};
    const to = Date.parse(String(p.todate || '') + (/(Z|[+-]\d\d:?\d\d)$/.test(String(p.todate || '')) ? '' : 'Z'));
    out.push({ eventid: p.eventid, episodeid: p.episodeid, name, nice: name ? name[0] + name.slice(1).toLowerCase() : 'Storm', alert: String(p.alertlevel || ''),
      peak: String(sev.severitytext || ''), kmh: Number.isFinite(+sev.severity) && +sev.severity > 0 ? +sev.severity : null, countries: String(p.country || ''),
      lat: Number.isFinite(+c[1]) && c.length ? +c[1] : null, lon: Number.isFinite(+c[0]) && c.length ? +c[0] : null, report: https(p.url && p.url.report), to: Number.isFinite(to) ? to : null });
  }
  return out;
}

/** The storm in `list` a forecast belongs to (the same last name, or within 300 km), or a new one from make(). */
export function attach(list, name, at, make) {
  const n = String(name || '').toLowerCase().split(/\s+/).pop();
  let s = n.length > 2 ? list.find(x => x.title.toLowerCase().includes(n)) : null;
  if (!s && at) s = list.find(x => distKm(x, at) < 300);
  if (!s) { s = make(); list.push(s); }
  return s;
}

/** EONET's storm events → storms { kind: 'storm', id, title, src, lat, lon, kt, date, track, links }. */
export function stormsFromEonet(events) {
  return events.filter(e => e.track.length).map(e => {
    const last = e.track[e.track.length - 1];
    return { kind: 'storm', id: e.id, title: e.title, src: 'NASA EONET', lat: last.lat, lon: last.lon, kt: last.kt, date: last.t ? new Date(last.t).toISOString() : e.date,
      track: e.track.map(p => ({ lat: p.lat, lon: p.lon, kt: p.kt, date: p.t ? new Date(p.t).toISOString() : null })),
      links: [e.link ? { text: 'EONET event', url: e.link } : null, ...e.sources.map(s => ({ text: 'Source: ' + s.id, url: s.url }))].filter(Boolean) };
  });
}
/** NHC advisories into the list: the same storm (by name, else within 300 km: EONET's last fix can lag) gets them and NHC's
 *  position; others are added. */
export function mergeNhc(list, nhc) {
  for (const st of nhc) {
    const at = { lat: st.lat, lon: st.lon }, nm = st.name.toLowerCase();
    const same = (nm.length > 2 && list.find(x => x.title.toLowerCase().includes(nm))) || list.find(x => distKm(x, at) < 300);
    const n = { title: st.title, kt: st.kt, pressure: st.pressure, movement: st.movement, advisory: st.advisory, url: st.url, forecastUrl: st.forecastUrl, advNum: st.advNum };
    if (same) Object.assign(same, { nhc: n, kt: same.kt || st.kt, lat: st.lat, lon: st.lon });
    else list.push({ kind: 'storm', id: 'nhc-' + st.id, title: st.title, src: 'NOAA NHC', lat: st.lat, lon: st.lon, kt: st.kt, date: st.advisory, track: [at], nhc: n, links: [] });
  }
  return list;
}
/** NOAA forecasts (nhcForecasts values with points or a cone) into the list as `fc`. */
export function mergeNoaa(list, forecasts) {
  for (const f of forecasts) {
    const now = f.points[0], s = attach(list, f.name || f.id, now, () => ({ kind: 'storm', id: 'fc-' + f.id, title: f.name || f.id.toUpperCase(), src: 'NOAA NHC',
      lat: now ? now.lat : f.cone[0][0][1], lon: now ? now.lon : f.cone[0][0][0], kt: now && now.kt, track: [], links: [] }));
    s.fc = { src: 'NOAA NHC', ...f };
    if (now) { s.kt = now.kt || s.kt; s.lat = now.lat; s.lon = now.lon; }
  }
  return list;
}
/** GDACS cyclones with their parsed geometry ({ ...parseGdacsCyclones item, fc: gdacsForecast(...) }) into the list. */
export function mergeGdacs(list, gd) {
  for (const g of gd) {
    const f = g.fc, at = g.lat != null ? { lat: g.lat, lon: g.lon } : null, kt = g.kmh ? Math.round(g.kmh / 1.852) : null;
    const s = attach(list, g.name, at, () => ({ kind: 'storm', id: 'gdacs-' + (f.id ?? g.eventid), title: g.nice, src: `GDACS (${f.source || 'agency'})`,
      lat: at ? at.lat : 0, lon: at ? at.lon : 0, kt, track: [], links: [] }));
    s.fc = { src: `GDACS (${f.source || 'agency'})`, gdacs: { alert: g.alert, peak: g.peak, kmh: g.kmh, countries: g.countries }, cone: f.cone, track: f.forecast.map(x => x.path),
      past: f.past.map(x => ({ kind: x.kind, paths: [x.path] })), points: f.points.filter(q => q.forecast).map(q => ({ lat: q.lat, lon: q.lon, label: q.label.replace(' UTC', ''), kt: null })),
      warnings: [], winds: [], coherent: true };
    if (!s.kt && kt) s.kt = kt;
    if (g.report) s.links.push({ text: 'GDACS report', url: g.report });
  }
  return list;
}

/**
 * Every active cyclone with what each source knows. json(url, { timeout, relay }) fetches and parses (throws on failure);
 * nhc: whether NHC's CurrentStorms.json can be reached (a relay); kept: a Map the caller keeps between loads (GDACS
 * geometry per event/episode, ~0.4 MB each and never changed); warn(what, error) reports a source that failed (the
 * others still count). EONET failing fails the whole load (it is the backbone).
 */
export async function loadCyclones({ json, nhc = false, kept = new Map(), now = Date.now(), warn = () => {} }) {
  const list = stormsFromEonet(parseEonet(await json(eonetUrl({ days: 10, category: 'severeStorms' }), { timeout: 30000 })));
  if (nhc) {
    try { mergeNhc(list, parseNhcCurrent(await json(NHC_CURRENT, { relay: true, timeout: 25000 }))); } catch (e) { warn('NHC advisories', e); }
  }
  let noaa = [];
  try {
    const parts = await Promise.all(NOAA_LAYERS.map(([id, fields]) => json(noaaLayerUrl(id, fields), { timeout: 30000 }).then(d => (d && d.features) || []).catch(() => [])));
    const input = {}; NOAA_LAYERS.forEach(([, , key], i) => { input[key] = parts[i]; });
    noaa = [...nhcForecasts(input).values()].filter(s => s.points.length || s.cone.length);
  } catch (e) { warn('NHC forecasts', e); }
  mergeNoaa(list, noaa);
  const skip = new Set(noaa.map(f => f.name.toLowerCase().split(/\s+/).pop()));   // NOAA's own forecast is drawn for its storms
  try {
    const gd = [];
    for (const g of parseGdacsCyclones(await json(gdacsTcUrl(now), { timeout: 30000 }))) {
      if (skip.has(g.name.toLowerCase())) continue;
      const key = g.eventid + '/' + g.episodeid;
      if (!kept.has(key)) {
        try { kept.set(key, gdacsForecast(await json(gdacsGeometryUrl(g.eventid, g.episodeid), { timeout: 45000 }))); }
        catch (e) { warn('GDACS ' + g.name, e); continue; }
      }
      gd.push({ ...g, fc: kept.get(key) });
    }
    mergeGdacs(list, gd);
  } catch (e) { warn('GDACS', e); }
  return list;
}

/** "Active: Erin, Kiko +2" for a layer's description. */
export const activeLine = (list, n = 4) => list.length ? `Active: ${list.slice(0, n).map(s => s.title).join(', ')}${list.length > n ? ' +' + (list.length - n) : ''}` : '';
/** A storm's name without its class, for a label: "Hurricane Erin" → "Erin". */
export const shortName = title => String(title || '').replace(/^(Tropical Storm|Tropical Depression|Hurricane|Typhoon|Super Typhoon|Cyclone|Tropical Cyclone|Subtropical Storm|Post-tropical Cyclone|Potential Tropical Cyclone)\s+/i, '');
/** Who a storm's numbers come from, each once: "NASA EONET + NOAA NHC + GDACS (JTWC)". */
export const stormSources = s => [...new Set([s.src, s.nhc ? 'NOAA NHC' : '', s.fc ? s.fc.src : ''].filter(Boolean))].join(' + ');
