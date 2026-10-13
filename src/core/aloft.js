// Weather at an aircraft, for the cockpit HUD: wind, temperature and cloud at its height from Open-Meteo's pressure
// levels (interpolated in log-pressure between the two around it), visibility and low/mid/high cloud at the surface,
// and what follows from them: head/tail and cross wind on its track, true airspeed and Mach from the ground speed and
// the wind, the deviation from the standard atmosphere, and an icing hint. DOM-free.

/** Open-Meteo's pressure levels (hPa), surface first. */
export const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30];

// ISA: sea level 288.15 K, 1013.25 hPa, lapse 6.5 K/km to the tropopause at 11 km, then 216.65 K
const T0 = 288.15, P0 = 1013.25, LAPSE = 0.0065, G = 9.80665, RD = 287.053, H_TROP = 11000, T_TROP = 216.65;
const P_TROP = P0 * Math.pow(T_TROP / T0, G / (RD * LAPSE));   // 226.32 hPa
/** Standard-atmosphere pressure (hPa) at pressure altitude h (m), up to 20 km. */
export function isaPressure(h) {
  if (h <= H_TROP) return P0 * Math.pow(1 - LAPSE * h / T0, G / (RD * LAPSE));
  return P_TROP * Math.exp(-G * (h - H_TROP) / (RD * T_TROP));
}
/** Pressure altitude (m) for a pressure (hPa): the inverse of isaPressure. */
export function isaAltitude(p) {
  if (p >= P_TROP) return T0 / LAPSE * (1 - Math.pow(p / P0, RD * LAPSE / G));
  return H_TROP - RD * T_TROP / G * Math.log(p / P_TROP);
}
/** Standard temperature (°C) at pressure altitude h (m). */
export const isaTempC = h => (h <= H_TROP ? T0 - LAPSE * h : T_TROP) - 273.15;

/**
 * The two Open-Meteo levels around a pressure altitude (a barometric altitude, which is what the transponder sends):
 * { lo, hi, w } with w the weight of hi in log-pressure. Below 1000 hPa both are 1000; above 30 hPa both are 30.
 */
export function bracket(altM) {
  const p = isaPressure(Math.max(-500, Math.min(24000, altM)));
  if (p >= LEVELS[0]) return { lo: LEVELS[0], hi: LEVELS[0], w: 0, p };
  for (let i = 0; i < LEVELS.length - 1; i++) {
    const a = LEVELS[i], b = LEVELS[i + 1];
    if (p <= a && p >= b) return { lo: a, hi: b, w: Math.log(a / p) / Math.log(a / b), p };
  }
  const last = LEVELS[LEVELS.length - 1];
  return { lo: last, hi: last, w: 0, p };
}

const SURFACE = ['visibility', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'temperature_2m', 'wind_speed_10m', 'wind_direction_10m', 'weather_code', 'surface_pressure'];
const AT_LEVEL = ['temperature', 'wind_speed', 'wind_direction', 'cloud_cover', 'relative_humidity', 'geopotential_height'];
/** Where to ask: position rounded to 0.25° (Open-Meteo's grid is coarser than that anyway, and it lets planes share
 *  answers). Returns { url, key, lat, lon, lo, hi }. */
export function aloftUrl(lat, lon, altM, base = 'https://api.open-meteo.com/v1/forecast') {
  const qLat = Math.round(lat * 4) / 4, qLon = Math.round(lon * 4) / 4, b = bracket(altM);
  const lv = [...new Set([b.lo, b.hi])];
  const vars = [...SURFACE, ...lv.flatMap(l => AT_LEVEL.map(v => `${v}_${l}hPa`))];
  const url = `${base}?latitude=${qLat}&longitude=${qLon}&current=${vars.join(',')}&wind_speed_unit=ms&timezone=UTC`;
  return { url, key: `${qLat},${qLon},${lv.join('-')}`, lat: qLat, lon: qLon, lo: b.lo, hi: b.hi };
}

const n = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const lerp = (a, b, w) => a == null ? b : b == null ? a : a + (b - a) * w;
/** Wind from (dir, speed) at two levels, mixed as vectors so 350° and 10° average to 0°, not 180°. */
function mixWind(d1, s1, d2, s2, w) {
  if (d1 == null || s1 == null) return d2 == null || s2 == null ? null : { dir: d2, speed: s2 };
  if (d2 == null || s2 == null) return { dir: d1, speed: s1 };
  const R = Math.PI / 180, u = lerp(-s1 * Math.sin(d1 * R), -s2 * Math.sin(d2 * R), w), v = lerp(-s1 * Math.cos(d1 * R), -s2 * Math.cos(d2 * R), w);
  const speed = Math.hypot(u, v);
  return { dir: speed < 1e-6 ? lerp(d1, d2, w) : (Math.atan2(-u, -v) / R + 360) % 360, speed };
}

/**
 * Open-Meteo's answer to aloftUrl at a given altitude: { time, windDir (from, °), windSpeed (m/s), tempC, cloudPct,
 * rh, levelHeightM (where the level really is), vis (m), cloudLow/Mid/High (%), sfcTempC, sfcWind {dir, speed},
 * weatherCode, levels: [lo, hi] } or null if the answer has none of it.
 */
export function parseAloft(json, altM) {
  const c = json && json.current; if (!c || typeof c !== 'object') return null;
  const b = bracket(altM), g = (v, l) => n(c[`${v}_${l}hPa`]);
  const wind = mixWind(g('wind_direction', b.lo), g('wind_speed', b.lo), g('wind_direction', b.hi), g('wind_speed', b.hi), b.w);
  const out = {
    time: typeof c.time === 'string' ? c.time : '', levels: [b.lo, b.hi],
    windDir: wind ? wind.dir : null, windSpeed: wind ? wind.speed : null,
    tempC: lerp(g('temperature', b.lo), g('temperature', b.hi), b.w), cloudPct: lerp(g('cloud_cover', b.lo), g('cloud_cover', b.hi), b.w),
    rh: lerp(g('relative_humidity', b.lo), g('relative_humidity', b.hi), b.w), levelHeightM: lerp(g('geopotential_height', b.lo), g('geopotential_height', b.hi), b.w),
    vis: n(c.visibility), cloudLow: n(c.cloud_cover_low), cloudMid: n(c.cloud_cover_mid), cloudHigh: n(c.cloud_cover_high),
    sfcTempC: n(c.temperature_2m), sfcWind: n(c.wind_speed_10m) != null ? { dir: n(c.wind_direction_10m), speed: n(c.wind_speed_10m) } : null,
    weatherCode: n(c.weather_code), sfcPressure: n(c.surface_pressure),
  };
  return out.windSpeed == null && out.tempC == null && out.vis == null ? null : out;
}

/**
 * What the weather means for the aircraft: p { track (°), gs (m/s), alt (m, barometric) }, w from parseAloft.
 * Returns { head (m/s, + headwind, - tailwind), cross (m/s, + from the right), tas (m/s), mach, isaDev (K), oatC, icing }.
 * True airspeed: the air's speed relative to the plane, ground velocity minus wind velocity (heading unknown, so this
 * assumes the wind correction angle is what it takes; close enough to within a few knots).
 */
export function aloftEffects(p, w) {
  if (!w) return null;
  const R = Math.PI / 180, out = { head: null, cross: null, tas: null, mach: null, isaDev: null, oatC: w.tempC, icing: false };
  if (w.windSpeed != null && w.windDir != null && p.track != null) {
    const rel = (w.windDir - p.track) * R;   // wind FROM this angle relative to the nose
    out.head = w.windSpeed * Math.cos(rel); out.cross = w.windSpeed * Math.sin(rel);
    if (p.gs != null) {
      const gE = p.gs * Math.sin(p.track * R), gN = p.gs * Math.cos(p.track * R);
      const wE = -w.windSpeed * Math.sin(w.windDir * R), wN = -w.windSpeed * Math.cos(w.windDir * R);   // wind blows TOWARD dir+180
      out.tas = Math.hypot(gE - wE, gN - wN);
    }
  } else if (p.gs != null) out.tas = p.gs;
  if (w.tempC != null) {
    if (out.tas != null) out.mach = out.tas / (20.0468 * Math.sqrt(w.tempC + 273.15));
    if (p.alt != null) out.isaDev = w.tempC - isaTempC(p.alt);
    out.icing = w.tempC <= 0 && w.tempC >= -20 && ((w.cloudPct != null && w.cloudPct >= 50) || (w.rh != null && w.rh >= 85));
  }
  return out;
}

// WMO weather codes as Open-Meteo sends them
const WMO = { 0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow',
  75: 'heavy snow', 77: 'snow grains', 80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers', 85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail' };
export const weatherWords = code => WMO[code] || '';

/** Cloud cover as aviation words: SKC/FEW/SCT/BKN/OVC by oktas. */
export function oktas(pct) {
  if (pct == null) return '';
  const o = Math.round(pct / 12.5);
  return o === 0 ? 'SKC' : o <= 2 ? 'FEW' : o <= 4 ? 'SCT' : o <= 7 ? 'BKN' : 'OVC';
}

/** Lines for the HUD, short and upper case like the rest of it. */
export function aloftLines(p, w, e = aloftEffects(p, w)) {
  if (!w) return [];
  const kt = v => Math.round(v * 1.943844), out = [];
  if (w.windSpeed != null) out.push(`WIND ${String(Math.round(w.windDir ?? 0) % 360).padStart(3, '0')}°/${kt(w.windSpeed)} KT`
    + (e && e.head != null ? ` · ${e.head >= 0 ? 'HEAD' : 'TAIL'} ${Math.abs(kt(e.head))} · X ${Math.abs(kt(e.cross))}${e.cross >= 0 ? 'R' : 'L'}` : ''));
  if (w.tempC != null) out.push(`OAT ${Math.round(w.tempC)}°C${e && e.isaDev != null ? ` · ISA${e.isaDev >= 0 ? '+' : '−'}${Math.abs(Math.round(e.isaDev))}` : ''}`
    + (e && e.tas != null && !p.ground ? ` · TAS ${kt(e.tas)} KT${e.mach != null && e.mach > 0.3 ? ` · M${e.mach.toFixed(2)}` : ''}` : ''));
  const layer = w.cloudPct != null ? `CLOUD HERE ${oktas(w.cloudPct)} ${Math.round(w.cloudPct)}%` : '';
  const sky = [w.cloudLow, w.cloudMid, w.cloudHigh].some(v => v != null) ? `L${oktas(w.cloudLow)} M${oktas(w.cloudMid)} H${oktas(w.cloudHigh)}` : '';
  if (layer || sky) out.push([layer, sky].filter(Boolean).join(' · '));
  if (w.vis != null) out.push(`SFC VIS ${w.vis >= 10000 ? '10+ km' : (w.vis / 1000).toFixed(w.vis < 5000 ? 1 : 0) + ' km'}${weatherWords(w.weatherCode) ? ' · ' + weatherWords(w.weatherCode).toUpperCase() : ''}`);
  if (e && e.icing) out.push('ICING POSSIBLE (0 to −20 °C in cloud)');
  return out;
}

/**
 * The same for a card, as sentences: what the wind at its height is and does to it, the air's temperature against
 * the standard atmosphere with the true airspeed and Mach, and the cloud it is in. p as aloftEffects (its gs in m/s).
 */
export function aloftWords(p, w, e = aloftEffects(p, w)) {
  if (!w) return [];
  const kt = v => Math.round(Math.abs(v) * 1.943844), out = [];
  if (w.windSpeed != null) out.push(w.windSpeed < 1 ? 'Calm at its height' : `Wind from ${String(Math.round(w.windDir ?? 0) % 360).padStart(3, '0')}° at ${kt(w.windSpeed)} kt`
    + (e && e.head != null && !p.ground ? `: ${kt(e.head)} kt ${e.head >= 0 ? 'headwind' : 'tailwind'}, ${kt(e.cross)} kt from the ${e.cross >= 0 ? 'right' : 'left'}` : ''));
  if (w.tempC != null) out.push(`${Math.round(w.tempC)} °C outside${e && e.isaDev != null && Math.abs(e.isaDev) >= 1 ? `, ${Math.abs(Math.round(e.isaDev))}° ${e.isaDev > 0 ? 'warmer' : 'colder'} than the standard atmosphere` : ''}`
    + (e && e.tas != null && !p.ground ? ` · true airspeed about ${kt(e.tas)} kt${e.mach != null && e.mach > 0.3 ? `, Mach ${e.mach.toFixed(2)}` : ''}` : ''));
  if (w.cloudPct != null) out.push(w.cloudPct >= 50 ? `In cloud (${oktas(w.cloudPct)}, ${Math.round(w.cloudPct)}%)${e && e.icing ? ': icing possible' : ''}` : w.cloudPct >= 12 ? `Scattered cloud at its level (${Math.round(w.cloudPct)}%)` : 'Clear air at its level');
  return out;
}

// ------------------------------------------------------------------------------------------------ at an airport
const SFC_VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'temperature_2m', 'dew_point_2m', 'visibility', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'weather_code', 'pressure_msl'];
/** Open-Meteo request for the weather now at an airport (rounded to 0.05°, so one answer serves a field). */
export function airportWxUrl(lat, lon, base = 'https://api.open-meteo.com/v1/forecast') {
  const qLat = Math.round(lat * 20) / 20, qLon = Math.round(lon * 20) / 20;
  return { url: `${base}?latitude=${qLat}&longitude=${qLon}&current=${SFC_VARS.join(',')}&wind_speed_unit=kn&timezone=UTC`, key: `${qLat},${qLon}` };
}
/**
 * The weather at a field, METAR-like: { time, windDir, windKt, gustKt, tempC, dewC, vis (m), cloudLow/Mid/High (%),
 * baseFt (estimated: 400 ft per °C of temperature/dew point spread, the convective cloud base; only when low cloud
 * covers half the sky or more), qnh (hPa), weatherCode, category ('VFR'|'MVFR'|'IFR'|'LIFR'), estimated: true }.
 * The category follows the FAA bands on the visibility and that estimated ceiling: a model's guess, not a METAR.
 */
export function airportWx(json) {
  const c = json && json.current; if (!c || typeof c !== 'object') return null;
  const w = { time: typeof c.time === 'string' ? c.time : '', windDir: n(c.wind_direction_10m), windKt: n(c.wind_speed_10m), gustKt: n(c.wind_gusts_10m),
    tempC: n(c.temperature_2m), dewC: n(c.dew_point_2m), vis: n(c.visibility), cloudLow: n(c.cloud_cover_low), cloudMid: n(c.cloud_cover_mid), cloudHigh: n(c.cloud_cover_high),
    weatherCode: n(c.weather_code), qnh: n(c.pressure_msl), baseFt: null, category: null, estimated: true };
  if (w.windKt == null && w.tempC == null && w.vis == null) return null;
  if (w.tempC != null && w.dewC != null && w.cloudLow != null && w.cloudLow >= 50) w.baseFt = Math.max(0, Math.round((w.tempC - w.dewC) * 400 / 100) * 100);
  w.category = flightCategory(w.vis, w.baseFt);
  return w;
}
/** FAA flight category from visibility (m) and ceiling (ft, null = none): LIFR < 500 ft or < 1 sm; IFR < 1,000 ft or
 *  < 3 sm; MVFR <= 3,000 ft or <= 5 sm; else VFR. */
export function flightCategory(visM, ceilFt) {
  if (visM == null && ceilFt == null) return null;
  const sm = visM == null ? Infinity : visM / 1609.344, c = ceilFt == null ? Infinity : ceilFt;
  if (c < 500 || sm < 1) return 'LIFR';
  if (c < 1000 || sm < 3) return 'IFR';
  if (c <= 3000 || sm <= 5) return 'MVFR';
  return 'VFR';
}
/** One line for the airport card: "Wind 240° 12 kt gusting 22 · 14 °C · vis 10+ km · low cloud BKN, base ~1,200 ft (est.) · light rain". */
export function airportWxLine(w) {
  if (!w) return '';
  const parts = [];
  if (w.windKt != null) parts.push(w.windKt < 1 ? 'Calm' : `Wind ${String(Math.round(w.windDir ?? 0) % 360).padStart(3, '0')}° ${Math.round(w.windKt)} kt${w.gustKt != null && w.gustKt >= w.windKt + 10 ? ` gusting ${Math.round(w.gustKt)}` : ''}`);
  if (w.tempC != null) parts.push(`${Math.round(w.tempC)} °C${w.dewC != null ? ` (dew point ${Math.round(w.dewC)})` : ''}`);
  if (w.vis != null) parts.push(`vis ${w.vis >= 10000 ? '10+ km' : (w.vis / 1000).toFixed(w.vis < 5000 ? 1 : 0) + ' km'}`);
  if (w.cloudLow != null) parts.push(`low cloud ${oktas(w.cloudLow)}${w.baseFt != null ? `, base ~${w.baseFt.toLocaleString('en-US')} ft (est.)` : ''}`);
  const ww = weatherWords(w.weatherCode); if (ww && !/clear|cloudy|overcast/.test(ww)) parts.push(ww);
  if (w.qnh != null) parts.push(`QNH ${Math.round(w.qnh)}`);
  return parts.join(' · ');
}

/**
 * The weather at airports for cards that re-render: one Open-Meteo request per field (rounded to 0.05°) per `ttl`,
 * shared by every caller. `json(url)` is the view's fetch. get(ap) → Promise of airportWx's answer (null when it
 * failed); peek(ap) → that answer, or undefined while nothing has come back yet.
 */
export function airportWxCache({ json, ttl = 15 * 60e3, now = () => Date.now() } = {}) {
  const cache = new Map();   // key -> { t, w, pending }
  return {
    get(ap) {
      const q = airportWxUrl(ap.lat, ap.lon), c = cache.get(q.key);
      if (c && (c.pending || now() - c.t < ttl)) return c.pending || Promise.resolve(c.w);
      const pending = Promise.resolve().then(() => json(q.url)).then(airportWx).catch(() => null)
        .then(w => { cache.set(q.key, { t: now(), w }); return w; });
      cache.set(q.key, { t: now(), w: c ? c.w : undefined, pending });
      return pending;
    },
    peek(ap) { const c = cache.get(airportWxUrl(ap.lat, ap.lon).key); return c ? c.w : undefined; },
  };
}
