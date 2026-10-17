// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Hazards and recent imagery from public feeds, parsed (pure; Node tests it): tropical cyclone forecasts (NOAA NHC's map
// service for the Atlantic and East / Central Pacific, GDACS for every basin), US wildfire perimeters (NIFC WFIGS),
// satellite fire detections (NASA's VIIRS thermal anomalies as GIBS vector tiles: FIRMS without a key), and the dates of
// recent Landsat and Sentinel-2 pictures of a place (NASA CMR, Harmonized Landsat Sentinel-2).

const drawable = r => Array.isArray(r) && r.length >= 2;   // fewer than 2 points: nothing to draw, no corner to read
/** Outer rings [[lon, lat], …] of a GeoJSON Polygon or MultiPolygon. */
export function rings(g) {
  if (!g || !Array.isArray(g.coordinates)) return [];
  if (g.type === 'Polygon') return drawable(g.coordinates[0]) ? [g.coordinates[0]] : [];
  if (g.type === 'MultiPolygon') return g.coordinates.map(p => (Array.isArray(p) ? p[0] : null)).filter(drawable);
  return [];
}
/** Paths [[lon, lat], …] of a GeoJSON LineString or MultiLineString. */
export function paths(g) {
  if (!g || !Array.isArray(g.coordinates)) return [];
  if (g.type === 'LineString') return drawable(g.coordinates) ? [g.coordinates] : [];
  if (g.type === 'MultiLineString') return g.coordinates.filter(drawable);
  return [];
}

// ---- tropical cyclones -------------------------------------------------------------------------------------------

/** "ep202026-014_5day_pts" -> { id: "ep202026", adv: "014" } (advisories can carry a letter: "055A"). */
export function stormKey(src) {
  const m = String(src || '').match(/^([a-z]{2}\d{6})-(\d{3}[A-Z]?)_/i);
  return m ? { id: m[1].toLowerCase(), adv: m[2].toUpperCase() } : null;
}
/** NHC watch and warning codes: [name, NHC's colour]. */
export const WW = Object.freeze({ HWR: ['Hurricane warning', '#ff2e2e'], HWA: ['Hurricane watch', '#ff9fd2'], TWR: ['Tropical storm warning', '#3d7dff'], TWA: ['Tropical storm watch', '#ffe36e'] });

/** US time zones in NHC's labels (fldatelbl is local time: "2026-10-16 9:00 PM Fri CST"), hours from UTC. */
const NHC_TZ = Object.freeze({ UTC: 0, GMT: 0, Z: 0, AST: -4, ADT: -3, EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10, HDT: -9 });
/** "2026-10-16 9:00 PM Fri CST" or "2026-10-16 2100 UTC" -> UTC ms; NaN when it doesn't read (an unknown zone too). */
function nhcTime(text) {
  const m = String(text || '').trim().match(/^(\d{4})-(\d\d)-(\d\d)\s+(\d{1,2}):?(\d\d)\s*(AM|PM)?\s+(?:[A-Z][a-z]{2}\s+)?([A-Z]{1,4})$/i);
  const zone = m ? NHC_TZ[m[7].toUpperCase()] : null; if (zone == null) return NaN;
  let h = +m[4]; if (m[6]) { if (h < 1 || h > 12) return NaN; h = h % 12 + (/PM/i.test(m[6]) ? 12 : 0); }
  return h > 23 || +m[5] > 59 ? NaN : Date.UTC(+m[1], +m[2] - 1, +m[3], h, +m[5]) - zone * 3600e3;
}
/**
 * NOAA NHC's forecast layers (GeoJSON from the tropical weather summary map service: 5 forecast points, 6 forecast
 * track, 7 cone, 8 watches and warnings, 11 past track, 16 the wind field now) -> Map id -> { id, name, kind, basin,
 * advisory, advisoryAt (ms or null), coherent, points: [{ lat, lon, tau (h), kt, gust, mb, label, when }], track, cone,
 * warnings: [{ code, paths }], winds: [{ kt, rings }], past: [{ kind, paths }] }. `coherent`: points, track and cone all
 * come from the same advisory (mid-update the service can mix two; then only the points are trusted). A point without a
 * position (geometry: null) is left out. advisoryAt: the points' file time (idp_filedate), else the tau-0 fldatelbl.
 */
export function nhcForecasts({ points = [], tracks = [], cones = [], warnings = [], winds = [], past = [] }) {
  const out = new Map();
  const get = id => out.get(id) || out.set(id, { id, name: '', kind: '', basin: id.slice(0, 2).toUpperCase(), adv: {}, advisoryAt: null, points: [], track: [], cone: [], warnings: [], winds: [], past: [] }).get(id);
  for (const f of points) {
    const p = f.properties || {}, k = stormKey(p.idp_source); if (!k) continue;
    const s = get(k.id), c = f.geometry && f.geometry.coordinates || [p.lon, p.lat];
    s.adv.points = k.adv; s.name = String(p.stormname || s.name); s.kind = String(p.tcdvlp || s.kind);
    const t = +p.idp_filedate > 0 ? +p.idp_filedate : !(+p.tau) ? nhcTime(p.fldatelbl) : NaN;
    if (Number.isFinite(t) && !(s.advisoryAt >= t)) s.advisoryAt = t;
    const lat = +c[1], lon = +c[0]; if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    s.points.push({ lat, lon, tau: +p.tau || 0, kt: +p.maxwind || null, gust: +p.gust || null, mb: +p.mslp > 800 && +p.mslp < 1100 ? +p.mslp : null,
      label: String(p.datelbl || ''), when: String(p.fldatelbl || '') });
  }
  for (const f of tracks) { const k = stormKey(f.properties && f.properties.idp_source); if (!k) continue; const s = get(k.id); s.adv.track = k.adv; s.track.push(...paths(f.geometry)); }
  for (const f of cones) {
    const p = f.properties || {}, k = stormKey(p.idp_source); if (!k) continue;
    const s = get(k.id); s.adv.cone = k.adv; s.cone.push(...rings(f.geometry)); if (!s.name) s.name = String(p.stormname || '');
  }
  for (const f of warnings) { const p = f.properties || {}, k = stormKey(p.idp_source); if (k && WW[p.tcww]) get(k.id).warnings.push({ code: p.tcww, paths: paths(f.geometry) }); }
  for (const f of winds) {
    const p = f.properties || {}, id = String(p.stormid || '').toLowerCase();
    if (/^[a-z]{2}\d{6}$/.test(id) && !(+p.tau)) get(id).winds.push({ kt: +p.radii, rings: rings(f.geometry) });
  }
  for (const f of past) {
    const p = f.properties || {}, m = String(p.idp_source || '').match(/^([a-z]{2}\d{6})_/i);
    if (m) get(m[1].toLowerCase()).past.push({ kind: String(p.stormtype || ''), paths: paths(f.geometry) });
  }
  for (const s of out.values()) {
    s.points.sort((a, b) => a.tau - b.tau);
    const a = s.adv; s.coherent = !!a.points && a.points === a.track && a.points === a.cone;
    s.advisory = a.points || a.cone || a.track || ''; delete s.adv;
  }
  return out;
}

/** "05/10 18:00 UTC" with the year of the advisory -> UTC ms (GDACS labels track points so). */
function gdacsTime(label, year) {
  const m = String(label || '').match(/^(\d\d)\/(\d\d) (\d\d):(\d\d)/);
  return m ? Date.UTC(year, +m[2] - 1, +m[1], +m[3], +m[4]) : NaN;
}
/**
 * A GDACS cyclone geometry package (polygons/getgeometry) -> { id, name, source, advisory (ms), cone, past: [{ kind,
 * path }], forecast: [{ kind, path }], points: [{ lat, lon, t, label, forecast }] }. Kinds are the category labels
 * on the track segments (TD, TS, HU…). A point's forecast is undefined when the package has no advisory time.
 */
export function gdacsForecast(fc) {
  const r = { id: null, name: '', source: '', advisory: NaN, cone: [], past: [], forecast: [], points: [] };
  for (const f of (fc && fc.features) || []) {
    const p = f.properties || {}, cls = String(p.Class || '');
    if (r.id == null && p.eventid != null) r.id = p.eventid;
    if (!r.name && p.eventname) r.name = String(p.eventname).replace(/-\d\d$/, '');
    if (!r.source && p.source) r.source = String(p.source);
    if (p.polygondate && Number.isNaN(r.advisory)) r.advisory = Date.parse(String(p.polygondate) + (/(Z|[+-]\d\d:?\d\d)$/.test(String(p.polygondate)) ? '' : 'Z'));   // UTC without a zone (gdacs.js utc())
    if (cls === 'Poly_Cones') r.cone.push(...rings(f.geometry));
    else if (cls.startsWith('Line_Line')) for (const path of paths(f.geometry)) (p.forecast === true || p.forecast === 'true' ? r.forecast : r.past).push({ kind: String(p.polygonlabel || ''), path });
    else if (cls.startsWith('Point_Polygon_Point')) {
      const ring = rings(f.geometry)[0]; if (!ring || !ring.length) continue;
      let lon = 0, lat = 0; for (const q of ring) { lon += q[0] / ring.length; lat += q[1] / ring.length; }
      r.points.push({ lat, lon, label: String(p.polygonlabel || ''), t: NaN, forecast: false });
    }
  }
  const ref = Number.isNaN(r.advisory) ? Date.now() : r.advisory, year = new Date(ref).getUTCFullYear();
  const nearest = label => { let best = NaN; for (const y of [year - 1, year, year + 1]) { const t = gdacsTime(label, y); if (!Number.isNaN(t) && (Number.isNaN(best) || Math.abs(t - ref) < Math.abs(best - ref))) best = t; } return best; };   // the labels carry no year: a forecast over New Year is next year's
  for (const q of r.points) { q.t = nearest(q.label); q.forecast = Number.isNaN(r.advisory) ? undefined : q.t > r.advisory; }   // no advisory time: past or forecast is unknown
  r.points.sort((a, b) => a.t - b.t);
  return r;
}

// ---- wildfires -----------------------------------------------------------------------------------------------------

/** NIFC WFIGS current interagency perimeters (GeoJSON) -> [{ id, name, acres, contained (%), discovered, updated (ms),
 *  state, cause, where, rx (a prescribed burn), rings }]. */
export function firePerimeters(fc) {
  return ((fc && fc.features) || []).map(f => {
    const p = f.properties || {};
    return { id: String(p.attr_UniqueFireIdentifier || p.poly_IncidentName || ''), name: String(p.poly_IncidentName || p.attr_IncidentName || 'Fire'),
      acres: +p.attr_IncidentSize || null, contained: p.attr_PercentContained == null ? null : +p.attr_PercentContained,
      discovered: +p.attr_FireDiscoveryDateTime || null, updated: +p.poly_DateCurrent || null, state: String(p.attr_POOState || '').replace(/^US-/, ''),
      cause: String(p.attr_FireCause || ''), where: String(p.attr_IncidentShortDescription || ''), rx: p.attr_IncidentTypeCategory === 'RX', rings: rings(f.geometry) };
  }).filter(f => f.rings.length);
}

/** GIBS's geographic tile grid (the "500m" set of the VIIRS thermal anomaly layers): level 0 is two 288° tiles. */
export const fireTileDeg = level => 288 / 2 ** level;
/** The tiles of a level that cover a box (degrees, west < east, no antimeridian crossing): [{ level, row, col }]. */
export function fireTilesFor(w, s, e, n, level) {
  const d = fireTileDeg(level), cols = Math.ceil(360 / d), rows = Math.ceil(180 / d), out = [];
  const c0 = Math.max(0, Math.floor((w + 180) / d)), c1 = Math.min(cols - 1, Math.floor((e + 180 - 1e-9) / d));
  const r0 = Math.max(0, Math.floor((90 - n) / d)), r1 = Math.min(rows - 1, Math.floor((90 - s - 1e-9) / d));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push({ level, row: r, col: c });
  return out;
}
/** VIIRS thermal anomaly layers on GIBS (keyless FIRMS), per satellite; the satellites' names for cards. */
export const FIRE_LAYERS = Object.freeze({ N20: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All', N21: 'VIIRS_NOAA21_Thermal_Anomalies_375m_All' });
export const FIRE_SAT_NAME = Object.freeze({ N20: 'NOAA-20', N21: 'NOAA-21', N: 'Suomi NPP' });
export const fireTileUrl = (layer, date, t) => `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${layer}/default/${date}/500m/${t.level}/${t.row}/${t.col}.mvt`;
/** By fire radiative power (MW): [lowest MW, colour, size in px]. */
export const FIRE_FRP = Object.freeze([[100, '#fff1d6', 8], [20, '#ff5a2e', 6], [5, '#ff9f3c', 4.5], [0, '#ffd45c', 3.2]]);
export const fireLook = frp => FIRE_FRP.find(([min]) => frp >= min);
/** The tile level for a view `km` across (about one tile per view). */
export const fireLevel = km => km > 1200 ? 3 : km > 500 ? 4 : km > 150 ? 5 : 6;
/**
 * The tiles to load for a view centred at lat, lon with radius r (degrees of latitude): the nearest `max` of `level`
 * (two at level 3), for both satellites and for today and yesterday (UTC), as [{ key, url, today }].
 */
export function fireTilesWanted(lat, lon, r, level, max, now = Date.now()) {
  const day = ms => new Date(ms).toISOString().slice(0, 10), rl = r / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const near = fireTilesFor(Math.max(-180, lon - rl), Math.max(-90, lat - r), Math.min(180, lon + rl), Math.min(90, lat + r), level)
    .map(t => { const d = fireTileDeg(t.level); return /** @type {[any, number]} */ ([t, Math.hypot(-180 + (t.col + 0.5) * d - lon, 90 - (t.row + 0.5) * d - lat)]); })
    .sort((a, b) => a[1] - b[1]).slice(0, level <= 3 ? 2 : max).map(a => a[0]);
  const out = [];
  for (const t of near) for (const sat of Object.keys(FIRE_LAYERS)) for (const d of [day(now), day(now - 864e5)])
    out.push({ key: `${sat}/${d}/${t.level}/${t.row}/${t.col}`, url: fireTileUrl(FIRE_LAYERS[sat], d, t), today: d === day(now) });
  return out;
}
/** NIFC WFIGS current interagency perimeters (keyless, CORS), simplified to ~100 m. */
export const NIFC_PERIMETERS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1'
  + '&outFields=poly_IncidentName,attr_IncidentName,attr_IncidentSize,attr_PercentContained,attr_POOState,attr_FireDiscoveryDateTime,poly_DateCurrent,attr_UniqueFireIdentifier,attr_IncidentTypeCategory,attr_FireCause,attr_IncidentShortDescription'
  + '&maxAllowableOffset=0.001&geometryPrecision=5&outSR=4326&f=geojson';
/** A perimeter's colour: prescribed burns green, then by containment (red under 30%, orange, yellow, grey when out). */
export const containColor = f => f.rx ? '#9ad17a' : f.contained == null || f.contained < 30 ? '#ff3b2f' : f.contained < 70 ? '#ff8a3d' : f.contained < 100 ? '#ffc75a' : '#9aa5b1';
/** A ring's area in hectares (flat, fine for a fire). */
export const ringHa = r => { let a = 0; for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]; return Math.abs(a) / 2 * 111.32 ** 2 * Math.cos(r[0][1] * Math.PI / 180) * 100; };
/** A fire's rings worth drawing: at least 2 ha, its 30 largest (a fire can have hundreds of spot-fire rings). */
export const keptRings = f => f.rings.filter(r => r.length >= 4).map(r => [r, ringHa(r)]).filter(([, ha]) => ha >= 2).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([r]) => r);
/** Where a perimeter's card flies to: the middle of its largest ring. */
export function perimeterCentre(f) {
  const big = f.rings.reduce((a, r) => r.length > a.length ? r : a, f.rings[0]);
  return { lat: big.reduce((a, q) => a + q[1], 0) / big.length, lon: big.reduce((a, q) => a + q[0], 0) / big.length };
}

/** Fire detections from a decoded GIBS thermal anomaly tile (FIRMS's fields) at or after `since` (ms):
 *  [{ id, lat, lon, frp (MW), k (brightness, kelvin), conf, sat, t (ms), day }]. */
export function parseFires(layers, since = 0) {
  const out = [];
  for (const l of Object.values(layers || {})) for (const f of l.features) {
    const p = f.props, raw = String(p.ACQ_TIME ?? ''), time = (/^\d{1,4}$/.test(raw) ? raw.padStart(4, '0') : raw).replace(/^(\d\d)(\d\d)$/, '$1:$2'), t = Date.parse(`${p.ACQ_DATE}T${time.padStart(5, '0')}:00Z`);   // "0312", 312 (a number: 03:12) or "03:12"
    const lat = +p.LATITUDE, lon = +p.LONGITUDE;
    if (!(t >= since) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ id: `${p.SATELLITE}:${p.ACQ_DATE}:${p.UID}`, lat, lon, frp: +p.FRP || 0, k: +p.BRIGHT_TI4 || null, conf: String(p.CONFIDENCE || ''), sat: String(p.SATELLITE || ''), t, day: p.DAYNIGHT === 'D' });
  }
  return out;
}

// ---- recent imagery ------------------------------------------------------------------------------------------------

/** One CSV line -> fields (quoted fields may hold commas and doubled quotes). */
export function csvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
/** NASA CMR granules.csv for the HLS collections -> [{ ur, sensor ("S30" Sentinel-2 | "L30" Landsat), t (ms), date, cloud (%) }]. */
export function parseCmrCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean); if (lines.length < 2) return [];
  const head = csvLine(lines[0]), iUr = head.indexOf('Granule UR'), iT = head.indexOf('Start Time'), iC = head.indexOf('Cloud Cover');
  return lines.slice(1).map(csvLine).map(f => {
    const ur = f[iUr] || '', sensor = (ur.match(/^HLS\.(S30|L30)\./) || [])[1], t = Date.parse(f[iT]);
    return sensor && Number.isFinite(t) ? { ur, sensor, t, date: new Date(t).toISOString().slice(0, 10), cloud: f[iC] === '' || f[iC] == null ? null : +f[iC] } : null;
  }).filter(Boolean);
}
/** One entry per day and sensor (its clearest granule), newest first: [{ date, sensor, cloud, t }]. */
export function imageryDates(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.date + r.sensor, o = by.get(k);
    if (!o || (r.cloud ?? 101) < (o.cloud ?? 101)) by.set(k, { date: r.date, sensor: r.sensor, cloud: r.cloud, t: r.t });
  }
  return [...by.values()].sort((a, b) => b.t - a.t);
}
/** A sensible first comparison: "after" = the newest fairly clear picture, "before" = the oldest fairly clear one at
 *  least two weeks earlier (else the oldest). null if there are fewer than two. */
export function pickPair(dates, clear = 20) {
  if (dates.length < 2) return null;
  const ok = d => d.cloud != null && d.cloud <= clear;
  const after = dates.find(ok) || dates[0];
  const earlier = dates.filter(d => d.t <= after.t - 14 * 864e5), before = earlier.slice().reverse().find(ok) || earlier[earlier.length - 1] || dates[dates.length - 1];
  return before === after ? null : { before, after };
}
/** GIBS layer names and tile URL templates for the imagery the comparison uses (EPSG:3857, Google Maps tiling). */
export const IMAGERY = Object.freeze({
  S30: { name: 'Sentinel-2', layer: 'HLS_S30_Nadir_BRDF_Adjusted_Reflectance', max: 12, ext: 'png', res: '30 m' },
  L30: { name: 'Landsat 8/9', layer: 'HLS_L30_Nadir_BRDF_Adjusted_Reflectance', max: 12, ext: 'png', res: '30 m' },
  VIIRS: { name: 'VIIRS (daily)', layer: 'VIIRS_NOAA21_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg', res: '250-375 m' },
});
export const gibsTemplate = (sensor, date) => { const s = IMAGERY[sensor]; return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${s.layer}/default/${date}/GoogleMapsCompatible_Level${s.max}/{z}/{y}/{x}.${s.ext}`; };
