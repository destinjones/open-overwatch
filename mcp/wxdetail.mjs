// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// weather_details: the fields the globe's weather mode draws as maps (sea-level pressure with its isobars, gusts, ocean
// waves), read off at one point, with what a forecaster would say about them: the pressure and which way it is going
// (a fast fall means a storm on the way), the strongest gust and when, Beaufort force, thunderstorm energy, fog, the
// freezing level, UV; at sea the waves, swell, period, sea temperature and current; and whether the big weather models
// (ECMWF, GFS, ICON) agree on the coming days. Open-Meteo's forecast, marine and multi-model APIs; core/wxpoint.js reads them.
import { readDetails, readMarine, modelSpread, spreadLine, capeWords, visibilityWords, uvWords, MODELS } from '../src/core/wxpoint.js';
import { skyWords } from '../src/core/voicecmd.js';
import { compass } from '../src/core/passes.js';
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea, frame, globeUrl } from './place.mjs';
import { r1, areaData } from './words.mjs';

const METEO = 'https://api.open-meteo.com/v1/forecast', MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const VARS = 'pressure_msl,wind_speed_10m,wind_gusts_10m,cape,visibility,freezing_level_height,uv_index';
const CURRENT = `${VARS},surface_pressure,temperature_2m,dew_point_2m,relative_humidity_2m,wind_direction_10m,cloud_cover_low,cloud_cover_mid,cloud_cover_high,weather_code`;
const SEA = 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,sea_surface_temperature,ocean_current_velocity,ocean_current_direction';

/** 'Thu 21:00' from Open-Meteo's local 'YYYY-MM-DDTHH:MM'. */
const when = s => (s ? `${new Date(String(s).slice(0, 10) + 'T12:00:00Z').toUTCString().slice(0, 3)} ${String(s).slice(11, 16)}` : '');
const dayName = s => new Date(s + 'T12:00:00Z').toUTCString().slice(0, 11);

export function weatherDetailsTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'weather_details',
    title: 'Pressure, gusts, storms, waves and model agreement at a point',
    description: "The detailed weather at a point, the fields weather maps are made of: sea-level pressure and its three-hour tendency (falling quickly means a storm coming), the lowest pressure and strongest gust in the next hours and when, wind on the Beaufort scale, thunderstorm energy (CAPE), visibility and fog, the freezing level, the UV index, cloud at three heights; at sea or on a coast the waves (height on the Douglas sea-state scale, direction, period), swell, sea temperature and current; and whether the ECMWF, GFS and ICON models agree on the coming days (how much to trust the forecast). Open-Meteo. Its link opens the globe's weather mode with isobars, gusts and waves.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        ...areaProps(null),
        hours: { type: 'integer', minimum: 6, maximum: 120, description: 'How far ahead to look for the extremes, in hours (default 48).' },
        units: { type: 'string', enum: ['metric', 'imperial'], description: 'metric (default) or imperial.' },
      },
    },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, signal }), hours = a.hours || 48, imp = a.units === 'imperial';
      const ll = `latitude=${area.lat.toFixed(3)}&longitude=${area.lon.toFixed(3)}`;
      const [fc, sea, models] = await Promise.all([
        feeds.json(`${METEO}?${ll}&timezone=auto&wind_speed_unit=ms&past_hours=3&forecast_hours=${hours}&current=${CURRENT}&hourly=${VARS},precipitation,precipitation_probability`, { ttl: 10 * 60e3, signal }),
        feeds.json(`${MARINE}?${ll}&timezone=auto&forecast_hours=${hours}&cell_selection=sea&current=${SEA}&hourly=wave_height`, { ttl: 30 * 60e3, signal }).catch(() => null),   // inland: an error or empty values
        feeds.json(`${METEO}?${ll}&timezone=auto&wind_speed_unit=ms&forecast_days=4&daily=temperature_2m_max,precipitation_sum,wind_gusts_10m_max&models=${Object.keys(MODELS).join(',')}`, { ttl: 60 * 60e3, signal }).catch(() => null),
      ]);
      const d = readDetails(fc, hours);
      if (!d) throw new ToolError('Open-Meteo sent no detailed forecast for that point', 'unavailable');
      const marine = readMarine(sea, hours), spread = modelSpread(models).slice(1), n = d.now, ah = d.ahead;   // from tomorrow: today is mostly over, and observed
      const W = v => (v == null ? '?' : imp ? `${Math.round(v * 2.23694)} mph` : `${Math.round(v * 3.6)} km/h`), T = v => (v == null ? '?' : imp ? `${Math.round(v * 9 / 5 + 32)} °F` : `${Math.round(v)} °C`);
      const P = v => (v == null ? '?' : imp ? `${(v * 0.02953).toFixed(2)} inHg` : `${Math.round(v)} hPa`), M = v => (imp ? `${Math.round(v * 3.28084)} ft` : `${v < 10 ? r1(v) : Math.round(v)} m`);
      const L = v => (v >= 1000 ? (imp ? `${Math.round(v / 1609.34)} mi` : `${Math.round(v / 1000)} km`) : imp ? `${Math.round(v * 3.28084)} ft` : `${Math.round(v)} m`);
      const out = [`At ${area.label} (${String(n.time).replace('T', ' ')} ${fc.timezone_abbreviation || d.timezone || ''}):`];
      out.push(`Pressure ${P(n.pressure_hpa)}${d.tendency ? `, ${d.tendency}${d.tendency_hpa != null && d.tendency !== 'steady' ? ` (${d.tendency_hpa > 0 ? '+' : ''}${d.tendency_hpa} hPa in 3 h)` : ''}` : ''}.`
        + `${n.beaufort ? ` Wind force ${n.beaufort.force} (${n.beaufort.name}), ${W(n.wind_ms)}${n.wind_from_deg != null ? ` from the ${compass(n.wind_from_deg)}` : ''}, gusts ${W(n.gusts_ms)}.` : ''}`
        + `${n.temperature_c != null ? ` ${T(n.temperature_c)}, dew point ${T(n.dew_point_c)}${skyWords({ code: n.weather_code }) ? `, ${skyWords({ code: n.weather_code })}` : ''}.` : ''}`);
      const extras = [visibilityWords(n.visibility_m) && `${visibilityWords(n.visibility_m)} (visibility ${L(n.visibility_m)})`, capeWords(n.cape_j_kg) && `${capeWords(n.cape_j_kg)} (CAPE ${Math.round(n.cape_j_kg)} J/kg)`,
        n.freezing_level_m != null && `freezing level ${L(n.freezing_level_m)}`, n.uv_index != null && n.uv_index >= 1 && `UV ${n.uv_index} (${uvWords(n.uv_index)})`,
        [n.cloud_low_percent, n.cloud_mid_percent, n.cloud_high_percent].every(v => v != null) && `cloud low ${n.cloud_low_percent}%, mid ${n.cloud_mid_percent}%, high ${n.cloud_high_percent}%`].filter(Boolean);
      if (extras.length) { const e = extras.join('; '); out.push(e[0].toUpperCase() + e.slice(1) + '.'); }
      const next = [`In the next ${ah.hours} hours:`,
        ah.lowest_pressure && ah.highest_pressure && `pressure ${P(ah.lowest_pressure.value)} (${when(ah.lowest_pressure.time)}) to ${P(ah.highest_pressure.value)} (${when(ah.highest_pressure.time)})`,
        ah.strongest_gust && `strongest gust ${W(ah.strongest_gust.value)} ${when(ah.strongest_gust.time)}`,
        ah.most_cape && capeWords(ah.most_cape.value) && `${capeWords(ah.most_cape.value)} ${when(ah.most_cape.time)} (CAPE ${Math.round(ah.most_cape.value)} J/kg)`,
        ah.lowest_visibility && visibilityWords(ah.lowest_visibility.value) && `${visibilityWords(ah.lowest_visibility.value)} likely ${when(ah.lowest_visibility.time)}`,
        ah.rain_mm > 0 ? `${imp ? `${(ah.rain_mm / 25.4).toFixed(2)} in` : `${ah.rain_mm} mm`} of rain in all${ah.rain_chance_max ? ` (chance up to ${ah.rain_chance_max.value}%)` : ''}` : 'no rain'];
      out.push(next[0] + ' ' + next.slice(1).filter(Boolean).join('; ') + '.');
      if (marine) {
        const s = marine;
        out.push(`The sea: ${s.sea ? `${s.sea.name}${s.wave_height_m != null ? `, waves ${M(s.wave_height_m)}` : ''}${s.wave_from_deg != null ? ` from the ${compass(s.wave_from_deg)}` : ''}${s.wave_period_s ? ` every ${s.wave_period_s} s` : ''}` : 'no wave reading'}`
          + `${s.swell_height_m ? `; swell ${M(s.swell_height_m)}${s.swell_from_deg != null ? ` from the ${compass(s.swell_from_deg)}` : ''}${s.swell_period_s ? ` (${s.swell_period_s} s)` : ''}` : ''}`
          + `${s.sea_temperature_c != null ? `; sea ${T(s.sea_temperature_c)}` : ''}${s.current_ms ? `; current ${imp ? `${r1(s.current_ms * 1.94384)} kn` : `${r1(s.current_ms)} m/s`} toward the ${compass(s.current_toward_deg)}` : ''}`
          + `${s.highest_waves && s.wave_height_m != null && s.highest_waves.value > s.wave_height_m + 0.2 ? `. Building to ${M(s.highest_waves.value)} ${when(s.highest_waves.time)}` : ''}.`);
      }
      const agree = spreadLine(spread, dayName, { imperial: imp });
      if (agree) out.push(agree);
      const layers = ['pres', 'gust', ...(marine ? ['wave'] : [])], url = globeUrl(site, { camera: frame(area.lat, area.lon, 3000), weather: layers });   // weather mode wants the whole Earth below 3,000 km
      out.push(`Isobars, gusts${marine ? ' and waves' : ''} on the globe: ${url}`);
      return { text: out.join('\n'), data: { place: areaData(area), timezone: d.timezone, units: imp ? 'imperial' : 'metric', now: n, pressure_tendency_hpa_3h: d.tendency_hpa, pressure_tendency: d.tendency || null,
        ahead: ah, sea: marine, models: spread, url, source: 'Open-Meteo.com forecast, marine and multi-model APIs (CC BY 4.0): ECMWF IFS, NOAA GFS, DWD ICON and wave models' } };
    },
  };
}
