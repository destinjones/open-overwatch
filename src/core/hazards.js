// Hazards and recent imagery from public feeds, parsed (pure; Node tests it): tropical cyclone forecasts (NOAA NHC's map
// service for the Atlantic and East / Central Pacific, GDACS for every basin), US wildfire perimeters (NIFC WFIGS),
// satellite fire detections (NASA's VIIRS thermal anomalies as GIBS vector tiles: FIRMS without a key), and the dates of
// recent Landsat and Sentinel-2 pictures of a place (NASA CMR, Harmonized Landsat Sentinel-2).

/** Outer rings [[lon, lat], …] of a GeoJSON Polygon or MultiPolygon. */
export function rings(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates.length ? [g.coordinates[0]] : [];
  if (g.type === 'MultiPolygon') return g.coordinates.filter(p => p.length).map(p => p[0]);
  return [];
}
/** Paths [[lon, lat], …] of a GeoJSON LineString or MultiLineString. */
export function paths(g) {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
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

/**
 * NOAA NHC's forecast layers (GeoJSON from the tropical weather summary map service: 5 forecast points, 6 forecast
 * track, 7 cone, 8 watches and warnings, 11 past track, 16 the wind field now) -> Map id -> { id, name, kind, basin,
 * advisory, coherent, points: [{ lat, lon, tau (h), kt, gust, mb, label, when }], track, cone, warnings: [{ code,
 * paths }], winds: [{ kt, rings }], past: [{ kind, paths }] }. `coherent`: points, track and cone all come from the same
 * advisory (mid-update the service can mix two; then only the points are trusted).
 */
export function nhcForecasts({ points = [], tracks = [], cones = [], warnings = [], winds = [], past = [] }) {
  const out = new Map();
  const get = id => out.get(id) || out.set(id, { id, name: '', kind: '', basin: id.slice(0, 2).toUpperCase(), adv: {}, points: [], track: [], cone: [], warnings: [], winds: [], past: [] }).get(id);
  for (const f of points) {
    const p = f.properties || {}, k = stormKey(p.idp_source); if (!k) continue;
    const s = get(k.id), c = f.geometry && f.geometry.coordinates || [p.lon, p.lat];
    s.adv.points = k.adv; s.name = String(p.stormname || s.name); s.kind = String(p.tcdvlp || s.kind);
    s.points.push({ lat: +c[1], lon: +c[0], tau: +p.tau || 0, kt: +p.maxwind || null, gust: +p.gust || null, mb: +p.mslp > 800 && +p.mslp < 1100 ? +p.mslp : null,
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
 * on the track segments (TD, TS, HU…).
 */
export function gdacsForecast(fc) {
  const r = { id: null, name: '', source: '', advisory: NaN, cone: [], past: [], forecast: [], points: [] };
  for (const f of (fc && fc.features) || []) {
    const p = f.properties || {}, cls = String(p.Class || '');
    if (r.id == null && p.eventid != null) r.id = p.eventid;
    if (!r.name && p.eventname) r.name = String(p.eventname).replace(/-\d\d$/, '');
    if (!r.source && p.source) r.source = String(p.source);
    if (p.polygondate && Number.isNaN(r.advisory)) r.advisory = Date.parse(p.polygondate + 'Z');
    if (cls === 'Poly_Cones') r.cone.push(...rings(f.geometry));
    else if (cls.startsWith('Line_Line')) for (const path of paths(f.geometry)) (p.forecast === true || p.forecast === 'true' ? r.forecast : r.past).push({ kind: String(p.polygonlabel || ''), path });
    else if (cls.startsWith('Point_Polygon_Point')) {
      const ring = rings(f.geometry)[0]; if (!ring || !ring.length) continue;
      let lon = 0, lat = 0; for (const q of ring) { lon += q[0] / ring.length; lat += q[1] / ring.length; }
      r.points.push({ lat, lon, label: String(p.polygonlabel || ''), t: NaN, forecast: false });
    }
  }
  const year = Number.isNaN(r.advisory) ? new Date().getUTCFullYear() : new Date(r.advisory).getUTCFullYear();
  for (const q of r.points) { q.t = gdacsTime(q.label, year); q.forecast = q.t > r.advisory; }
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
/** Fire detections from a decoded GIBS thermal anomaly tile (FIRMS's fields) at or after `since` (ms):
 *  [{ id, lat, lon, frp (MW), k (brightness, kelvin), conf, sat, t (ms), day }]. */
export function parseFires(layers, since = 0) {
  const out = [];
  for (const l of Object.values(layers || {})) for (const f of l.features) {
    const p = f.props, time = String(p.ACQ_TIME || '').replace(/^(\d\d)(\d\d)$/, '$1:$2'), t = Date.parse(`${p.ACQ_DATE}T${time.padStart(5, '0')}:00Z`);
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
