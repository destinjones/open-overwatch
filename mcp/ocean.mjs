// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// sea_conditions: the ocean buoys and coastal stations nearest a place (NOAA NDBC: waves, wind, water temperature, their
// latest report) and the nearest US tide gauge (NOAA CO-OPS: the level now, the next high and low tide).
// air_quality: the CAMS model's current hour at a place (Open-Meteo): US and European AQI, PM2.5, PM10, ozone, NO2.
// The parsing and the words are the globe's (src/core/ocean.js).
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea, distKm, frame, globeUrl } from './place.mjs';
import { r1, r2, km, plural, areaData, limitProp, take } from './words.mjs';
import {
  NDBC_LATEST, NDBC_STATIONS, NDBC_TYPES, parseNdbcLatest, parseNdbcStations, mergeNdbc, buoyRows, ndbcPage,
  COOPS_STATIONS, parseCoopsStations, coopsDatum, coopsUrl, parseCoopsLatest, parseCoopsHilo, nextTides, tideRows, coopsPage,
  aqUrl, parseAirQuality, aqiLook, aqRows,
} from '../src/core/ocean.js';

const line = rows => rows.map(([k, v]) => `${k}: ${v}`).join('; ');

export function seaTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'sea_conditions',
    title: 'Sea conditions: buoys and tides near a place',
    description: 'The ocean buoys and coastal stations nearest a place, with their latest report (NOAA NDBC, about 870 worldwide, most off the US: wave height and period, wind and gusts, water and air temperature, pressure), and the nearest US tide gauge with the water level now and the next high and low tide (NOAA CO-OPS). Its link opens the globe with the buoy, tide and sea-temperature layers.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps('to look (default 400 km around a point)'), limit: limitProp(5, 20) } },
    async run(a, { signal }) {
      const t = ctx.now();
      const [area, txt, stXml, coopsJ] = await Promise.all([resolveArea(a, feeds, { need: true, pointKm: 400, signal }),
        feeds.text(NDBC_LATEST, { ttl: 300e3, timeout: 45e3, signal }), feeds.text(NDBC_STATIONS, { ttl: 864e5, timeout: 45e3, signal }).catch(() => ''),
        feeds.json(COOPS_STATIONS, { ttl: 864e5, timeout: 45e3, signal }).catch(() => null)]);
      const all = mergeNdbc(parseNdbcLatest(txt), parseNdbcStations(stXml));
      if (!all.length) throw new ToolError('NOAA NDBC sent no observations', 'unavailable');
      const radius = Math.max(area.radiusKm, 50), fresh = o => o.t != null && t - o.t < 6 * 3600e3;
      const near = all.map(o => ({ ...o, km: distKm(area, o.lat, o.lon) })).filter(o => o.km <= radius && fresh(o)).sort((x, y) => x.km - y.km);
      const shown = take(near, a.limit || 5);
      const gauges = coopsJ ? parseCoopsStations(coopsJ).map(s => ({ ...s, km: distKm(area, s.lat, s.lon) })).filter(s => s.km <= Math.max(radius, 150)).sort((x, y) => x.km - y.km) : [];
      let tide = null;
      if (gauges.length) {
        const g = gauges[0], datum = coopsDatum(g);
        const [latest, hilo] = await Promise.all([feeds.json(coopsUrl(g.id, 'latest', { datum, now: t }), { ttl: 300e3, signal }).then(parseCoopsLatest).catch(e => ({ error: e.message })),
          g.tidal ? feeds.json(coopsUrl(g.id, 'hilo', { datum, now: t }), { ttl: 3600e3, signal }).then(parseCoopsHilo).catch(() => []) : []]);
        const tides = g.tidal ? nextTides(hilo, t) : null;
        tide = { g, latest, tides, rows: tideRows(g, latest, tides, t) };
      }
      const head = near.length ? `${plural(near.length, 'buoy or station', 'buoys and stations')} reporting within ${km(radius)} of ${area.label} in the last 6 hours${near.length > shown.length ? ` (the nearest ${shown.length})` : ''}:`
        : `No NOAA NDBC buoy or station has reported within ${km(radius)} of ${area.label} in the last 6 hours.`;
      const lines = shown.map(o => `${o.name || 'Station ' + o.id} (${o.id}, ${(NDBC_TYPES[o.type] || NDBC_TYPES.other).toLowerCase()}, ${km(o.km)} away): ${line(buoyRows(o, t))}`);
      if (tide) lines.push(`Tide gauge ${tide.g.name}${tide.g.state ? ', ' + tide.g.state : ''} (${tide.g.id}, ${km(tide.g.km)} away): ${line(tide.rows)}`);
      const camera = frame(area.lat, area.lon, Math.min(radius, 600));
      const url = globeUrl(site, { camera, on: ['buoys', 'tides', 'sst'] });
      return {
        text: [head, ...lines, `Times are UTC. NOAA NDBC and CO-OPS (public domain); the tide times are NOAA's predictions. On the globe: ${url}`].join('\n'),
        data: {
          total: near.length, area: areaData(area), url, source: 'NOAA National Data Buoy Center; NOAA CO-OPS Tides & Currents',
          stations: shown.map(o => ({ id: o.id, name: o.name || null, type: o.type, lat: r2(o.lat), lon: r2(o.lon), distance_km: r1(o.km), observed: new Date(o.t).toISOString(), wave_height_m: o.waveM,
            wave_period_s: o.wavePeriodS, wave_from_deg: o.waveDir, wind_ms: o.windMs, gust_ms: o.gustMs, wind_from_deg: o.windDir, water_temp_c: o.waterC, air_temp_c: o.airC, pressure_hpa: o.pressureHpa, page: ndbcPage(o.id) })),
          tide_gauge: tide && { id: tide.g.id, name: tide.g.name, distance_km: r1(tide.g.km), datum: coopsDatum(tide.g), level_m: tide.latest?.levelM ?? null, measured: tide.latest?.t ? new Date(tide.latest.t).toISOString() : null,
            rising: tide.tides?.rising ?? null, next_high: tide.tides?.high ? { time: new Date(tide.tides.high.t).toISOString(), level_m: tide.tides.high.levelM } : null,
            next_low: tide.tides?.low ? { time: new Date(tide.tides.low.t).toISOString(), level_m: tide.tides.low.levelM } : null, page: coopsPage(tide.g.id) },
        },
      };
    },
  };
}

export function airTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'air_quality',
    title: 'Air quality at a place',
    description: 'Air quality at a place for the current hour from the Copernicus Atmosphere Monitoring Service (CAMS) model via Open-Meteo: the US and European AQI, PM2.5, PM10, ozone, nitrogen dioxide, dust and aerosol optical depth. A model on a 11 km (Europe) to 45 km grid, not a station measurement. Its link opens the globe with the air-quality and smoke layers.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps('(a point; an area uses its centre)') } },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, pointKm: 50, signal });
      const [q] = parseAirQuality(await feeds.json(aqUrl([{ lat: area.lat, lon: area.lon }]), { ttl: 1800e3, signal }));
      if (!q || q.usAqi == null && q.pm25 == null) throw new ToolError(`Open-Meteo has no air-quality value for ${area.label}`, 'unavailable');
      const [words] = aqiLook(q.usAqi), url = globeUrl(site, { camera: frame(area.lat, area.lon, 400), on: ['airq', 'smoke'] });
      return {
        text: [`Air quality at ${area.label}: ${words.toLowerCase()} (US AQI ${q.usAqi == null ? 'n/a' : Math.round(q.usAqi)}), from the CAMS model for this hour (not a measurement).`, line(aqRows(q)),
          `Generated using Copernicus Atmosphere Monitoring Service information, served by Open-Meteo (CC BY 4.0). On the globe: ${url}`].join('\n'),
        data: { area: areaData(area), category: words, us_aqi: q.usAqi, european_aqi: q.euAqi, pm2_5_ugm3: q.pm25, pm10_ugm3: q.pm10, ozone_ugm3: q.o3, no2_ugm3: q.no2, co_ugm3: q.co, dust_ugm3: q.dust,
          aerosol_optical_depth: q.aod, model_hour: q.t ? new Date(q.t).toISOString() : null, url, source: 'Copernicus Atmosphere Monitoring Service (CAMS) via Open-Meteo, CC BY 4.0', measured: false },
      };
    },
  };
}
