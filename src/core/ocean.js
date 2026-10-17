// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The sea and the air over it, from keyless public feeds: NOAA NDBC's buoys and coastal stations (the latest
// observation of each, the station list) and its DART tsunami buoys; NOAA CO-OPS tide gauges (the water level now, the
// next high and low tide); NASA GIBS colour maps (sea-surface temperature, the UV aerosol index of smoke and dust: a
// legend, and the value back from a tile's pixel); and Open-Meteo's air quality (the CAMS model). No DOM: the globe,
// the 2D map and the MCP server share it. All public domain (NOAA, NASA) or CC BY 4.0 (Open-Meteo, CAMS).

const fin = v => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : XML_ENT[e.toLowerCase()]);
const attrs = s => { const o = {}; for (const m of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = unxml(m[2]); return o; };

// ---------------------------------------------------------------- NDBC: buoys, coastal stations, DART
export const NDBC = 'https://www.ndbc.noaa.gov';
export const NDBC_LATEST = NDBC + '/data/latest_obs/latest_obs.txt';   // every station's last report, ~870 rows, every ~5 min
export const NDBC_STATIONS = NDBC + '/activestations.xml';              // names, owners, types (~1,350 stations)
export const NDBC_ID = /^[A-Z0-9]{4,8}$/i;
export const dartUrl = id => NDBC_ID.test(id) ? `${NDBC}/data/realtime2/${id.toUpperCase()}.dart` : null;
export const ndbcPage = id => NDBC_ID.test(id) ? `${NDBC}/station_page.php?station=${id.toLowerCase()}` : null;

/** latest_obs.txt → [{ id, lat, lon, t (ms), windDir (° from), windMs, gustMs, waveM, wavePeriodS (dominant), avgPeriodS,
 *  waveDir (° from), pressureHpa, pressureTendencyHpa (3 h), airC, waterC, dewC, visNmi, tideFt }]. "MM" = not measured. */
export function parseNdbcLatest(text) {
  const lines = String(text).split(/\r?\n/), head = (lines.find(l => l.startsWith('#STN')) || '').slice(1).trim().split(/\s+/);
  const ix = Object.fromEntries(head.map((h, i) => [h, i])), out = [];
  if (ix.STN == null || ix.LAT == null) return out;
  for (const l of lines) {
    if (!l || l[0] === '#') continue;
    const c = l.trim().split(/\s+/), v = k => ix[k] == null || c[ix[k]] === 'MM' ? null : fin(c[ix[k]]);
    const id = c[ix.STN], lat = v('LAT'), lon = v('LON');
    if (!NDBC_ID.test(id || '') || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const t = Date.UTC(v('YYYY'), v('MM') - 1, v('DD'), v('hh'), v('mm'));   // a wave period of 0 below: not measured (KMA's buoys send 0)
    out.push({ id: id.toUpperCase(), lat, lon, t: Number.isFinite(t) ? t : null, windDir: v('WDIR'), windMs: v('WSPD'), gustMs: v('GST'), waveM: v('WVHT'),
      wavePeriodS: v('DPD') || null, avgPeriodS: v('APD') || null, waveDir: v('MWD'), pressureHpa: v('PRES'), pressureTendencyHpa: v('PTDY'),
      airC: v('ATMP'), waterC: v('WTMP'), dewC: v('DEWP'), visNmi: v('VIS'), tideFt: v('TIDE') });
  }
  return out;
}

/** activestations.xml → [{ id, lat, lon, name, owner, program, type, met, dartData }] (type: buoy, fixed, dart, tao, oilrig, usv, other). */
export function parseNdbcStations(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<station\s([^>]*?)\/?>/g)) {
    const a = attrs(m[1]), lat = fin(a.lat), lon = fin(a.lon);
    if (!NDBC_ID.test(a.id || '') || lat == null || lon == null) continue;
    out.push({ id: a.id.toUpperCase(), lat, lon, name: (a.name || '').trim(), owner: (a.owner || '').trim(), program: (a.pgm || '').trim(),
      type: (a.type || 'other').toLowerCase(), met: a.met === 'y', dartData: a.dart === 'y' });
  }
  return out;
}
export const NDBC_TYPES = Object.freeze({ buoy: 'Moored buoy', fixed: 'Coastal or offshore station', dart: 'DART tsunami buoy', tao: 'Tropical moored buoy (TAO)',
  oilrig: 'Oil or gas platform', usv: 'Uncrewed surface vehicle', other: 'Partner station' });

/** Latest observations with each station's name, owner and type (from the station list, when it has the station). */
export function mergeNdbc(latest, stations) {
  const by = new Map(stations.map(s => [s.id, s]));
  return latest.map(o => { const s = by.get(o.id); return { ...o, name: s?.name || '', owner: s?.owner || '', program: s?.program || '', type: s?.type || 'other' }; });
}

/** Significant wave height (m) → [words, colour]; null = no wave sensor. */
export const WAVE_LOOK = Object.freeze([[6, 'very high seas', '#ff4d6d'], [4, 'high seas', '#ff7a45'], [2.5, 'rough', '#ffb44d'], [1.25, 'moderate', '#ffe27a'], [0.5, 'slight', '#62e0c8'], [0, 'calm', '#5fb0ff']]);
export function waveLook(m) { if (m == null) return ['no wave sensor', '#9fb4c8']; const w = WAVE_LOOK.find(([min]) => m >= min); return [w[1], w[2]]; }

/** A DART .dart file → { rows: [{ t, heightM, mode }] newest first (at most `max`), latest }. mode: the measurement
 *  type, 1 = 15-minute (standard), 2 = 1-minute and 3 = 15-second (event mode: a quake's pressure wave or a test). */
export function parseDart(text, { max = 400 } = {}) {
  const rows = [];
  for (const l of String(text).split(/\r?\n/)) {
    if (!l || l[0] === '#') continue;
    const c = l.trim().split(/\s+/); if (c.length < 8) continue;
    const t = Date.UTC(+c[0], +c[1] - 1, +c[2], +c[3], +c[4], +c[5]), h = fin(c[7]), mode = fin(c[6]);
    if (!Number.isFinite(t) || h == null || h > 9000) continue;   // 9999.000 = missing
    rows.push({ t, heightM: h, mode });
    if (rows.length >= max) break;
  }
  rows.sort((a, b) => b.t - a.t);
  return { rows, latest: rows[0] || null };
}
export const DART_MODES = Object.freeze({ 1: '15-minute (standard)', 2: '1-minute (event)', 3: '15-second (event)' });
/** What a DART buoy is doing at `now`: { state: 'event'|'standard'|'late'|'silent', words, rangeM (6 h, tides included) }.
 *  In standard mode a DART sends four 15-minute values every hour; in event mode, triggered by a seafloor pressure
 *  change (a quake's waves, a tsunami, or a test), it sends 15-second and 1-minute values for hours. */
export function dartStatus(d, now = Date.now()) {
  const l = d?.latest; if (!l) return { state: 'silent', words: 'no recent data', rangeM: null };
  const age = now - l.t, recent = d.rows.filter(r => r.t > l.t - 6 * 3600e3), hs = recent.map(r => r.heightM);
  const rangeM = hs.length > 1 ? Math.max(...hs) - Math.min(...hs) : null;
  const event = d.rows.some(r => r.mode !== 1 && l.t - r.t < 6 * 3600e3);
  if (age > 72 * 3600e3) return { state: 'silent', words: 'not reporting (last data over 3 days old)', rangeM };
  if (age > 7 * 3600e3) return { state: 'late', words: 'late (in standard mode a DART sends its readings every 6 hours; none for over 7)', rangeM };
  return event ? { state: 'event', words: 'EVENT MODE: fast sampling, triggered in the last 6 hours', rangeM } : { state: 'standard', words: 'standard reporting', rangeM };
}

// ---------------------------------------------------------------- CO-OPS: tide gauges
export const COOPS_API = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
export const COOPS_STATIONS = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels';
export const COOPS_ID = /^\d{7}$/;
export const coopsPage = id => COOPS_ID.test(id) ? `https://tidesandcurrents.noaa.gov/stationhome.html?id=${id}` : null;

/** stations.json → [{ id, name, state, lat, lon, tidal, greatLakes, tz }] */
export function parseCoopsStations(json) {
  return (json?.stations || []).map(s => ({ id: String(s.id), name: String(s.name || '').trim(), state: String(s.state || ''), lat: fin(s.lat), lon: fin(s.lng ?? s.lon),
    tidal: !!s.tidal, greatLakes: !!s.greatlakes, tz: String(s.timezone || '') })).filter(s => COOPS_ID.test(s.id) && s.lat != null && s.lon != null);
}
/** The datum a gauge's levels are given against: the lowest low tides' average where there are tides, the lake
 *  datum on the Great Lakes, mean sea level elsewhere. */
export const coopsDatum = s => s.tidal ? 'MLLW' : s.greatLakes ? 'IGLD' : 'MSL';
export const DATUM_WORDS = Object.freeze({ MLLW: 'above mean lower low water (chart datum)', IGLD: 'above the Great Lakes datum (IGLD 1985)', MSL: 'relative to mean sea level' });
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
/** A CO-OPS data URL: 'latest' water level, or high/low 'hilo' predictions from yesterday for three days. Metres, UTC. */
export function coopsUrl(id, what, { datum = 'MLLW', now = Date.now() } = {}) {
  if (!COOPS_ID.test(id) || !/^[A-Z]{3,4}$/.test(datum)) return null;
  const q = `${COOPS_API}?application=open_overwatch&station=${id}&datum=${datum}&units=metric&time_zone=gmt&format=json`;
  return what === 'hilo' ? `${q}&product=predictions&interval=hilo&begin_date=${ymd(now - 864e5)}&range=96` : `${q}&product=water_level&date=latest`;
}
const coopsTime = s => { const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)$/.exec(String(s || '').trim()); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; };
/** The latest water level → { t, levelM, sigmaM, verified } or { error } (the API answers errors with HTTP 200). */
export function parseCoopsLatest(json) {
  if (json?.error) return { error: String(json.error.message || 'no data').trim() };
  const d = json?.data?.[json.data.length - 1], t = coopsTime(d?.t), v = fin(d?.v);
  if (t == null || v == null) return { error: 'no recent reading' };
  return { t, levelM: v, sigmaM: fin(d.s), verified: d.q === 'v' };
}
/** High and low tide predictions → [{ t, levelM, type: 'H'|'L' }] in time order. */
export function parseCoopsHilo(json) {
  return (json?.predictions || []).map(p => ({ t: coopsTime(p.t), levelM: fin(p.v), type: p.type === 'H' ? 'H' : p.type === 'L' ? 'L' : null }))
    .filter(p => p.t != null && p.levelM != null && p.type).sort((a, b) => a.t - b.t);
}
/** { next high, next low, last (the extreme just passed), rising } at `now`. */
export function nextTides(list, now = Date.now()) {
  const past = list.filter(p => p.t <= now), fut = list.filter(p => p.t > now), last = past[past.length - 1] || null;
  return { high: fut.find(p => p.type === 'H') || null, low: fut.find(p => p.type === 'L') || null, last, rising: last ? last.type === 'L' : fut[0] ? fut[0].type === 'H' : null };
}

// ---------------------------------------------------------------- NASA GIBS: imagery, colour maps, reading a pixel
export const GIBS_GEO = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/';
/** The imagery layers: GIBS layer, tile matrix set and its deepest level, colour map, unit, and what it shows. */
export const SEA_AIR_IMAGERY = Object.freeze({
  sst: { layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature', matrix: '1km', maxLevel: 6, colormap: 'GHRSST_Sea_Surface_Temperature', unit: '°C', digits: 1,
    name: 'Sea-surface temperature', source: "GHRSST MUR L4 (NASA JPL): yesterday's pre-dawn temperature, gaps filled", credit: 'Sea-surface temperature: GHRSST MUR (NASA JPL PO.DAAC), via NASA GIBS' },
  smoke: { layer: 'OMPS_Aerosol_Index', matrix: '2km', maxLevel: 5, colormap: 'OMPS_Aerosol_Index', unit: '', digits: 2,
    name: 'UV aerosol index (smoke and dust)', source: "Suomi NPP OMPS: the UTC day's orbits so far (places not yet passed over are empty)", credit: 'Smoke and dust: Suomi NPP OMPS aerosol index (NASA), via NASA GIBS' },
});
/** GIBS's list of the days a layer has between two dates (its DescribeDomains answer), to name the newest one. */
export const gibsDomainUrl = (spec, now = Date.now()) => `${GIBS_GEO}1.0.0/${spec.layer}/default/${spec.matrix}/all/${new Date(now - 20 * 864e5).toISOString().slice(0, 10)}--${new Date(now + 864e5).toISOString().slice(0, 10)}.xml`;
/** The newest day in a DescribeDomains answer ('YYYY-MM-DD'), or null. Domains are 'a/b/P1D' periods or single days, comma-separated. */
export function parseGibsDomain(xml) {
  const d = (/<Domain>([^<]*)<\/Domain>/.exec(String(xml)) || [])[1]; if (!d) return null;
  const days = d.split(',').flatMap(x => x.split('/').filter(y => /^\d{4}-\d\d-\d\d/.test(y))).map(y => y.slice(0, 10)).sort();
  return days[days.length - 1] || null;
}
export const gibsColormapUrl = name => `https://gibs.earthdata.nasa.gov/colormaps/v1.3/${name}.xml`;
/** A tile URL in GIBS's geographic grid ("default" date = the newest day it has). */
export const gibsGeoUrl = (spec, level, row, col, date = 'default') => `${GIBS_GEO}${spec.layer}/default/${date}/${spec.matrix}/${level}/${row}/${col}.png`;
/** Which 512 px tile and pixel of the geographic grid hold a point: level 0 is two 288° tiles. */
export function gibsPixel(lon, lat, level) {
  const d = 288 / 2 ** level, fx = (((lon + 180) % 360) + 360) % 360 / d, fy = (90 - Math.max(-90, Math.min(90, lat))) / d;
  const col = Math.floor(fx), row = Math.min(Math.floor(fy), Math.ceil(180 / d) - 1);
  return { level, row, col, x: Math.min(511, Math.floor((fx - col) * 512)), y: Math.min(511, Math.floor((fy - row) * 512)) };
}
/** A GIBS colour map (v1.3 XML) → { entries: [{ r, g, b, lo, hi }], min, max, minLabel, maxLabel }: lo/hi bound each
 *  colour's value range (±Infinity at the ends); no-data and transparent entries are left out. */
export function parseGibsColormap(xml) {
  const s = String(xml), entries = [];
  for (const m of s.matchAll(/<ColorMapEntry\s([^>]*?)\/?>/g)) {
    const a = attrs(m[1]); if (a.nodata === 'true' || a.transparent === 'true' || !a.value) continue;
    const rgb = (a.rgb || '').split(',').map(Number), v = /^\[\s*([^,]+),\s*([^)\]]+)[)\]]$/.exec(a.value.trim());
    if (rgb.length !== 3 || rgb.some(n => !(n >= 0 && n <= 255)) || !v) continue;
    const num = t => /^[-+]?INF$/i.test(t.trim()) ? (t.trim()[0] === '-' ? -Infinity : Infinity) : fin(t);
    const lo = num(v[1]), hi = num(v[2]); if (lo == null || hi == null) continue;
    entries.push({ r: rgb[0], g: rgb[1], b: rgb[2], lo, hi });
  }
  const finite = entries.flatMap(e => [e.lo, e.hi]).filter(Number.isFinite), leg = /<Legend\s[^>]*type="continuous"([^>]*)>/.exec(s), la = leg ? attrs(leg[1]) : {};
  return { entries, min: finite.length ? Math.min(...finite) : null, max: finite.length ? Math.max(...finite) : null, minLabel: la.minLabel || '', maxLabel: la.maxLabel || '' };
}
/** The value a pixel's colour stands for: { value (the middle of its range), lo, hi } or null (no data, land, cloud gap). */
export function colormapValue(cm, r, g, b, a = 255) {
  if (a < 128) return null;
  if (!cm._ix) cm._ix = new Map(cm.entries.map(e => [(e.r << 16) | (e.g << 8) | e.b, e]));
  const e = cm._ix.get((r << 16) | (g << 8) | b); if (!e) return null;
  const value = Number.isFinite(e.lo) && Number.isFinite(e.hi) ? (e.lo + e.hi) / 2 : Number.isFinite(e.lo) ? e.lo : e.hi;
  return { value, lo: e.lo, hi: e.hi };
}
/** n evenly spaced colours from min to max, for a CSS gradient legend: [{ value, color: '#rrggbb' }]. */
export function legendStops(cm, n = 9) {
  if (!cm.entries.length || cm.min == null) return [];
  const hex = e => '#' + [e.r, e.g, e.b].map(x => x.toString(16).padStart(2, '0')).join(''), out = [];
  for (let i = 0; i < n; i++) {
    const v = cm.min + (cm.max - cm.min) * i / (n - 1), e = cm.entries.find(x => v >= x.lo && v < x.hi) || (v >= cm.max ? cm.entries[cm.entries.length - 1] : cm.entries[0]);
    out.push({ value: v, color: hex(e) });
  }
  return out;
}

// ---------------------------------------------------------------- Open-Meteo air quality (CAMS)
export const OPENMETEO_AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const AQ_VARS = 'us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,carbon_monoxide,dust,aerosol_optical_depth';
/** One request for many points ([{ lat, lon }], at most 100): the current hour of the CAMS forecast at each. */
export function aqUrl(points) {
  const p = points.slice(0, 100), r = x => (Math.round(x * 100) / 100).toString();
  return `${OPENMETEO_AQ}?latitude=${p.map(q => r(q.lat)).join(',')}&longitude=${p.map(q => r(q.lon)).join(',')}&current=${AQ_VARS}&timezone=GMT`;
}
/** One answer or a list of them → [{ lat, lon, t, usAqi, euAqi, pm25, pm10, o3, no2, co, dust, aod }] in request order. */
export function parseAirQuality(json) {
  const list = Array.isArray(json) ? json : json ? [json] : [];
  return list.map(d => {
    const c = d?.current || {}, t = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(c.time || '') ? Date.parse(c.time + 'Z') : null;
    return { lat: fin(d?.latitude), lon: fin(d?.longitude), t, usAqi: fin(c.us_aqi), euAqi: fin(c.european_aqi), pm25: fin(c.pm2_5), pm10: fin(c.pm10), o3: fin(c.ozone),
      no2: fin(c.nitrogen_dioxide), co: fin(c.carbon_monoxide), dust: fin(c.dust), aod: fin(c.aerosol_optical_depth) };
  });
}
/** The US EPA's AQI bands: [lowest AQI, words, colour]. */
export const US_AQI = Object.freeze([[301, 'Hazardous', '#7e0023'], [201, 'Very unhealthy', '#8f3f97'], [151, 'Unhealthy', '#ff0000'],
  [101, 'Unhealthy for sensitive groups', '#ff7e00'], [51, 'Moderate', '#ffff00'], [0, 'Good', '#00e400']]);
export function aqiLook(aqi) { if (aqi == null) return ['no data', '#9fb4c8']; const b = US_AQI.find(([min]) => aqi >= min) || US_AQI[US_AQI.length - 1]; return [b[1], b[2]]; }
/** A grid of at most ~`max` points over a box (degrees; east may exceed 180 across the antimeridian), on round
 *  numbers so the same places come back as the view moves (and caches hit). */
export function aqGrid(w, s, e, n, max = 48) {
  if (e < w) e += 360;
  const area = Math.max(1e-6, (e - w) * (n - s)), raw = Math.sqrt(area / max), steps = [0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 20, 30];
  const step = steps.find(x => x >= raw) || 30, out = [];
  for (let lat = Math.ceil(s / step) * step; lat <= n + 1e-9; lat += step) {
    if (Math.abs(lat) > 85) continue;
    for (let lon = Math.ceil(w / step) * step; lon <= e + 1e-9; lon += step) out.push({ lat: +lat.toFixed(2), lon: +((((lon + 180) % 360 + 360) % 360) - 180).toFixed(2) });
  }
  return { step, points: out.slice(0, Math.ceil(max * 1.6)) };
}

// ---------------------------------------------------------------- words for cards (the globe, the 2D map, the MCP server)
const POINTS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = deg => POINTS16[Math.round((((+deg % 360) + 360) % 360) / 22.5) % 16];
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
export const tempWords = c => `${f1(c)} °C (${Math.round(c * 9 / 5 + 32)} °F)`;
export const heightWords = m => `${f1(m)} m (${f1(m / 0.3048)} ft)`;
export const speedWords = ms => `${f1(ms)} m/s (${Math.round(ms * 1.943844)} kn)`;
/** "12 min ago", "3 h ago", "2 days ago" (or "just now"); with the UTC time when asked. */
export function agoWords(t, now = Date.now(), withTime = false) {
  if (t == null) return '';
  const m = Math.round((now - t) / 60e3), rel = m < 1 ? 'just now' : m < 90 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  return withTime ? `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC (${rel})` : rel;
}
/** A buoy or station's latest observation as [label, value] rows; only what it measured. */
export function buoyRows(o, now = Date.now()) {
  const r = [];
  if (o.waveM != null) r.push(['Waves', `${heightWords(o.waveM)} significant height, ${waveLook(o.waveM)[0]}${o.wavePeriodS != null ? `, every ${o.wavePeriodS} s` : ''}${o.waveDir != null ? ` from the ${compass(o.waveDir)}` : ''}`]);
  if (o.windMs != null) r.push(['Wind', `${speedWords(o.windMs)}${o.windDir != null ? ` from the ${compass(o.windDir)} (${o.windDir}°)` : ''}${o.gustMs != null ? `, gusts ${speedWords(o.gustMs)}` : ''}`]);
  if (o.waterC != null) r.push(['Water temperature', tempWords(o.waterC)]);
  if (o.airC != null) r.push(['Air temperature', tempWords(o.airC)]);
  if (o.pressureHpa != null) r.push(['Pressure', `${f1(o.pressureHpa)} hPa${o.pressureTendencyHpa != null ? ` (${o.pressureTendencyHpa > 0 ? '+' : ''}${f1(o.pressureTendencyHpa)} in 3 h)` : ''}`]);
  if (o.visNmi != null) r.push(['Visibility', `${o.visNmi} nmi`]);
  if (o.t != null) r.push(['Observed', agoWords(o.t, now, true)]);
  return r;
}
/** A tide gauge's card rows from its latest level and its predicted highs and lows. */
export function tideRows(st, latest, tides, now = Date.now()) {
  const r = [], datum = coopsDatum(st);
  if (latest && !latest.error) r.push(['Water level', `${f1(latest.levelM)} m (${f1(latest.levelM / 0.3048)} ft) ${DATUM_WORDS[datum]}`], ['Measured', agoWords(latest.t, now, true) + (latest.verified ? ', verified' : ', preliminary')]);
  else r.push(['Water level', latest?.error ? `not available: ${latest.error}` : 'not available']);
  if (tides) {
    const at = p => `${new Date(p.t).toISOString().slice(0, 16).replace('T', ' ')} UTC, ${heightWords(p.levelM)}`;
    if (tides.rising != null) r.push(['Tide', tides.rising ? 'rising' : 'falling']);
    if (tides.high) r.push(['Next high tide', at(tides.high)]);
    if (tides.low) r.push(['Next low tide', at(tides.low)]);
  }
  return r;
}
/** Air quality at a point as card rows (the CAMS model's current hour, not a measurement). */
export function aqRows(q) {
  const r = [], ug = v => `${f1(v)} µg/m³`;
  if (q.usAqi != null) r.push(['US AQI', `${Math.round(q.usAqi)}, ${aqiLook(q.usAqi)[0].toLowerCase()}`]);
  if (q.euAqi != null) r.push(['European AQI', String(Math.round(q.euAqi))]);
  if (q.pm25 != null) r.push(['PM2.5', ug(q.pm25)]);
  if (q.pm10 != null) r.push(['PM10', ug(q.pm10)]);
  if (q.o3 != null) r.push(['Ozone', ug(q.o3)]);
  if (q.no2 != null) r.push(['Nitrogen dioxide', ug(q.no2)]);
  if (q.dust != null && q.dust > 0) r.push(['Dust', ug(q.dust)]);
  if (q.aod != null) r.push(['Aerosol optical depth', q.aod.toFixed(2)]);
  if (q.t != null) r.push(['Model hour', new Date(q.t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC']);
  return r;
}
