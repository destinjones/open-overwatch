// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The weather at one point in detail, from Open-Meteo's answers: the fields the globe's weather mode draws as maps
// (sea-level pressure, gusts, waves) read off for a place, with the words a forecaster would use for them. Pressure
// tendency over three hours (the Met Office's terms), Beaufort force, thunderstorm energy (CAPE), visibility (fog and
// mist), the UV index, how far apart the weather models are (ECMWF, GFS, ICON side by side: a forecast the models agree
// on is a forecast to trust), and the sea from the Marine API (wave height on the Douglas scale, swell, period, sea
// temperature, current). Pure: the MCP server's weather_details tool and the tests use it (test/wxpoint.test.mjs).

const fin = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const r1 = v => (v == null ? null : Math.round(v * 10) / 10);

/** Pressure tendency over three hours (hPa, signed) in the Met Office's shipping-forecast words. */
export function tendencyWords(dp) {
  if (!Number.isFinite(dp)) return '';
  const a = Math.abs(dp), way = dp < 0 ? 'falling' : 'rising';
  if (a < 0.1) return 'steady';
  return a < 1.6 ? `${way} slowly` : a < 3.6 ? way : a < 6 ? `${way} quickly` : `${way} very rapidly`;
}

const BEAUFORT = [[0.5, 'calm'], [1.6, 'light air'], [3.4, 'light breeze'], [5.5, 'gentle breeze'], [8, 'moderate breeze'], [10.8, 'fresh breeze'], [13.9, 'strong breeze'],
  [17.2, 'near gale'], [20.8, 'gale'], [24.5, 'strong gale'], [28.5, 'storm'], [32.7, 'violent storm'], [Infinity, 'hurricane force']];
/** Beaufort force for a wind speed (m/s): { force 0-12, name }, or null. */
export function beaufort(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const force = BEAUFORT.findIndex(([top]) => ms < top);
  return { force, name: BEAUFORT[force][1] };
}

/** Convective energy (CAPE, J/kg) as a thunderstorm risk in words ('' below 100: nothing to lift). */
export function capeWords(j) {
  if (!Number.isFinite(j) || j < 100) return '';
  return j < 500 ? 'a little energy for showers' : j < 1000 ? 'enough energy for thunderstorms' : j < 2500 ? 'energy for strong thunderstorms' : 'energy for severe thunderstorms';
}

/** Visibility (m) in words: fog below 1 km, mist below 5 km, haze below 10 km ('' when it is good or unknown). */
export function visibilityWords(m) {
  if (!Number.isFinite(m)) return '';
  return m < 200 ? 'thick fog' : m < 1000 ? 'fog' : m < 5000 ? 'mist' : m < 10000 ? 'haze' : '';
}

/** UV index in the WHO's bands. */
export function uvWords(uv) {
  if (!Number.isFinite(uv)) return '';
  return uv < 3 ? 'low' : uv < 6 ? 'moderate' : uv < 8 ? 'high' : uv < 11 ? 'very high' : 'extreme';
}

/** The index of the hour a 'YYYY-MM-DDTHH:MM' local time falls in, in Open-Meteo's hourly times (-1 if none). */
export function hourIndex(times, t) {
  const h = String(t || '').slice(0, 13);
  return Array.isArray(times) ? times.findIndex(x => String(x).slice(0, 13) === h) : -1;
}

/** The extreme of an hourly series from index i0 on: { value, time, i } (max, or min with low = true), or null. */
export function extreme(times, values, i0 = 0, { low = false, hours = Infinity } = {}) {
  let best = null;
  if (!Array.isArray(values)) return null;
  for (let i = Math.max(0, i0); i < values.length && i - i0 < hours; i++) {
    const v = fin(values[i]);
    if (v == null) continue;
    if (!best || (low ? v < best.value : v > best.value)) best = { value: v, time: times[i], i };
  }
  return best;
}

/**
 * An Open-Meteo forecast asked for with past_hours=3 and hourly pressure_msl, wind_gusts_10m, wind_speed_10m, cape,
 * visibility, freezing_level_height, uv_index, precipitation, precipitation_probability (and current = the same): the
 * point now and the next `hours`. Returns { now, tendency_hpa, tendency, ahead: { ... }, timezone } or null.
 */
export function readDetails(d, hours = 48) {
  const c = d && d.current, h = d && d.hourly;
  if (!c || !h || !Array.isArray(h.time)) return null;
  let i0 = hourIndex(h.time, c.time);
  if (i0 < 0) i0 = Math.min(3, h.time.length - 1);
  const p = h.pressure_msl || [], pNow = fin(c.pressure_msl) ?? fin(p[i0]), pBefore = i0 >= 3 ? fin(p[i0 - 3]) : null;
  const tendency = pNow != null && pBefore != null ? pNow - pBefore : null;
  const wind = fin(c.wind_speed_10m), gust = fin(c.wind_gusts_10m);
  const now = {
    time: c.time, pressure_hpa: r1(pNow), surface_pressure_hpa: r1(fin(c.surface_pressure)), temperature_c: r1(fin(c.temperature_2m)), dew_point_c: r1(fin(c.dew_point_2m)),
    humidity_percent: fin(c.relative_humidity_2m), wind_ms: r1(wind), wind_from_deg: fin(c.wind_direction_10m), gusts_ms: r1(gust), beaufort: beaufort(wind),
    cape_j_kg: fin(c.cape), visibility_m: fin(c.visibility), freezing_level_m: fin(c.freezing_level_height), uv_index: r1(fin(c.uv_index)),
    cloud_low_percent: fin(c.cloud_cover_low), cloud_mid_percent: fin(c.cloud_cover_mid), cloud_high_percent: fin(c.cloud_cover_high), weather_code: fin(c.weather_code),
  };
  const span = { hours }, at = (k, o = {}) => extreme(h.time, h[k], i0, { ...span, ...o });
  const rainSum = (h.precipitation || []).slice(i0, i0 + hours).reduce((s, v) => s + (fin(v) || 0), 0);
  const ahead = {
    hours: Math.min(hours, h.time.length - i0),
    lowest_pressure: at('pressure_msl', { low: true }), highest_pressure: at('pressure_msl'), strongest_gust: at('wind_gusts_10m'), strongest_wind: at('wind_speed_10m'),
    most_cape: at('cape'), lowest_visibility: at('visibility', { low: true }), highest_uv: at('uv_index'), lowest_freezing_level: at('freezing_level_height', { low: true }),
    rain_mm: r1(rainSum), rain_chance_max: at('precipitation_probability'),
  };
  return { now, tendency_hpa: r1(tendency), tendency: tendencyWords(tendency), ahead, timezone: d.timezone || null };
}

/** The models Open-Meteo is asked to put side by side, with their names. */
export const MODELS = Object.freeze({ ecmwf_ifs025: 'ECMWF IFS', gfs_seamless: 'NOAA GFS', icon_seamless: 'DWD ICON' });

/**
 * An Open-Meteo answer with models=ecmwf_ifs025,gfs_seamless,icon_seamless and daily temperature_2m_max,
 * precipitation_sum, wind_gusts_10m_max: per day, each model's numbers and how far apart they are, and a verdict:
 * [{ date, models: { key: { high, rain, gust } }, spread: { high, rain, gust }, agree: 'agree' | 'differ a little' | 'disagree' }].
 */
export function modelSpread(d) {
  const dy = d && d.daily;
  if (!dy || !Array.isArray(dy.time)) return [];
  const keys = Object.keys(MODELS).filter(k => Array.isArray(dy[`temperature_2m_max_${k}`]));
  if (keys.length < 2) return [];
  return dy.time.map((date, i) => {
    const models = {};
    for (const k of keys) models[k] = { high: fin(dy[`temperature_2m_max_${k}`][i]), rain: fin((dy[`precipitation_sum_${k}`] || [])[i]), gust: fin((dy[`wind_gusts_10m_max_${k}`] || [])[i]) };
    const range = f => { const v = keys.map(k => models[k][f]).filter(x => x != null); return v.length >= 2 ? r1(Math.max(...v) - Math.min(...v)) : null; };
    const spread = { high: range('high'), rain: range('rain'), gust: range('gust') };
    const rains = keys.map(k => models[k].rain).filter(x => x != null), wetDry = rains.some(x => x >= 2) && rains.some(x => x < 0.2);   // one model dry, another wet
    const score = Math.max((spread.high ?? 0) / 2, (spread.rain ?? 0) / 5, (spread.gust ?? 0) / 6) + (wetDry ? 1 : 0);
    return { date, models, spread, agree: score <= 1 ? 'agree' : score <= 2 ? 'differ a little' : 'disagree' };
  });
}

/**
 * One line on the models: "The models (ECMWF IFS, NOAA GFS, DWD ICON) agree on Thu-Fri; disagree on Sat (rain 0-12 mm)".
 * Days in a row with the same verdict and nothing to explain are joined. dayName(date) names a day; imperial: °F, mph, in.
 */
export function spreadLine(days, dayName = d => d, { imperial = false } = {}) {
  if (!days.length) return '';
  const U = imperial ? { rain: [1 / 25.4, 'in', 2], high: [null, '°F'], gust: [2.23694, 'mph'] } : { rain: [1, 'mm'], high: [null, '°C'], gust: [3.6, 'km/h'] };
  const groups = [];
  for (const x of days) {
    const why = x.agree === 'agree' ? '' : [x.spread.rain >= 3 && `rain ${rangeOf(x, 'rain', U.rain)}`, x.spread.high >= 3 && `highs ${rangeOf(x, 'high', U.high)}`, x.spread.gust >= 5 && `gusts ${rangeOf(x, 'gust', U.gust)}`].filter(Boolean).join(', ');
    const last = groups[groups.length - 1];
    if (last && !why && !last.why && last.agree === x.agree) last.to = x.date; else groups.push({ agree: x.agree, from: x.date, to: x.date, why });
  }
  const parts = groups.map(g => `${g.agree} on ${dayName(g.from)}${g.to !== g.from ? ` to ${dayName(g.to)}` : ''}${g.why ? ` (${g.why})` : ''}`);
  return `The models (${Object.values(MODELS).join(', ')}) ${parts.join('; ')}.`;
}
function rangeOf(x, f, [k, unit, dp = 0]) {
  const conv = n => (k == null ? n * 9 / 5 + 32 : n * k);
  const v = Object.values(x.models).map(m => m[f]).filter(n => n != null).map(n => (unit === '°C' ? n : unit === '°F' ? conv(n) : n * k));
  const fmt = n => (dp ? n.toFixed(dp) : String(Math.round(n)));
  return `${fmt(Math.min(...v))}-${fmt(Math.max(...v))} ${unit}`;
}

/**
 * A Marine API answer (current wave_height, wave_direction, wave_period, swell_wave_height, swell_wave_direction,
 * swell_wave_period, wind_wave_height, sea_surface_temperature, ocean_current_velocity (km/h), ocean_current_direction;
 * hourly wave_height): the sea now and its roughest in the coming hours, or null over land (every value missing).
 */
export function readMarine(d, hours = 48) {
  const c = d && d.current;
  if (!c) return null;
  const wave = fin(c.wave_height), swell = fin(c.swell_wave_height), sst = fin(c.sea_surface_temperature);
  if (wave == null && swell == null && sst == null) return null;
  const h = d.hourly || {}, i0 = Math.max(0, hourIndex(h.time, c.time));
  const cur = fin(c.ocean_current_velocity);
  return {
    time: c.time, wave_height_m: r1(wave), sea: seaState(wave), wave_from_deg: fin(c.wave_direction), wave_period_s: r1(fin(c.wave_period)),
    swell_height_m: r1(swell), swell_from_deg: fin(c.swell_wave_direction), swell_period_s: r1(fin(c.swell_wave_period)), wind_wave_height_m: r1(fin(c.wind_wave_height)),
    sea_temperature_c: r1(sst), current_ms: cur == null ? null : r1(cur / 3.6), current_toward_deg: fin(c.ocean_current_direction),
    highest_waves: extreme(h.time, h.wave_height, i0, { hours }),
  };
}
/** Douglas sea state for significant wave height (m): { code 0-9, name } or null. */
export function seaState(m) {
  if (!Number.isFinite(m)) return null;
  const tops = [[0.05, 'calm (glassy)'], [0.1, 'calm (rippled)'], [0.5, 'smooth'], [1.25, 'slight'], [2.5, 'moderate'], [4, 'rough'], [6, 'very rough'], [9, 'high'], [14, 'very high'], [Infinity, 'phenomenal']];
  const code = tops.findIndex(([t]) => m < t);
  return { code, name: tops[code][1] };
}
