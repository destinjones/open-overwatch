// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// airport_weather: an airport's latest METAR and its TAF from the Aviation Weather Center (NOAA), decoded into plain words
// by the same code as the globe's airport cards (src/core/metar.js), with the flight category, the forecast period by
// period, the worst category in the next hours, and which runway the wind favours (the website's OurAirports runways).
// Node needs no relay: AWC sends no CORS headers, which only matters to browsers.
import { ToolError, derive } from './feeds.mjs';
import { frame, globeUrl } from './place.mjs';
import { r1, ago } from './words.mjs';
import { provStamp, provLine, rep } from '../src/core/liveprov.js';
import { parseAirports, AirportIndex, findAirport } from '../src/core/airports.js';
import { parseRunways, windTable } from '../src/core/runways.js';
import { readAwcMetars, readAwcTafs, metarUrl, tafUrl, metarWords, tafWords, tafWorst, CAT_WORDS } from '../src/core/metar.js';

const AWC = { name: 'Aviation Weather Center (NOAA)', url: 'https://aviationweather.gov/' };
const METAR_MAX_AGE = 2 * 3600e3, TAF_MAX_AGE = 9 * 3600e3;   // METARs come hourly (more often when the weather turns); TAFs every 6 h

export function airportWxTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'airport_weather',
    title: 'Airport weather (METAR and TAF)',
    description: "An airport's latest weather report (METAR) and forecast (TAF) from the Aviation Weather Center (NOAA), decoded into plain words: wind, visibility, weather, cloud, temperature, pressure, the flight category (VFR, MVFR, IFR, LIFR), the forecast period by period, and the runway the wind favours. Give an airport code (ICAO or IATA), a name or a city, or a point for the nearest large or medium airport. Its link opens the globe's airport layer there.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        airport: { type: 'string', maxLength: 80, description: 'ICAO or IATA code ("KDEN", "LHR"), an airport name ("Heathrow") or a city ("Denver": its largest airport).' },
        lat: { type: 'number', minimum: -90, maximum: 90, description: 'Latitude, for the nearest airport (instead of airport).' },
        lon: { type: 'number', minimum: -180, maximum: 180, description: 'Longitude, with lat.' },
        hours: { type: 'integer', minimum: 1, maximum: 30, description: 'Hours of forecast to describe (default 12).' },
      },
    },
    async run(a, { signal }) {
      const t = ctx.now(), hours = a.hours || 12;
      const [ad, rd] = await Promise.all([feeds.json(feeds.site('data/airports.json'), { ttl: 864e5, timeout: 60e3, signal }), feeds.json(feeds.site('data/runways.json'), { ttl: 864e5, timeout: 60e3, signal }).catch(() => null)]);
      const list = derive(ad, 'airports', parseAirports);   // built once per isolate, not per question (findAirport keeps each airport's normalised name)
      let ap = null;
      if (a.airport) ap = findAirport(list, a.airport);
      else if (Number.isFinite(a.lat) && Number.isFinite(a.lon)) ap = derive(list, 'index', l => new AirportIndex(l)).nearest(a.lat, a.lon, 400);
      else throw new ToolError('Say which airport (a code, a name or a city), or give lat and lon', 'invalid_arguments');
      if (!ap) throw new ToolError(a.airport ? `No large or medium airport matches "${String(a.airport).slice(0, 80)}"` : 'No large or medium airport within 400 km of that point', 'not_found');
      if (!/^[A-Z]{4}$/.test(ap.icao)) throw new ToolError(`${ap.name} has no ICAO code to ask the Aviation Weather Center about`, 'not_found');
      // a field with no METAR is answered 204 (feeds: null); an error is the service's own, and the TAF can still answer
      /** @type {any} */ let metarError = null;
      const [mj, tj] = await Promise.all([feeds.json(metarUrl([ap.icao]), { ttl: 5 * 60e3, timeout: 20e3, signal }).catch(e => { metarError = e; return null; }),
        feeds.json(tafUrl([ap.icao]), { ttl: 10 * 60e3, timeout: 20e3, signal }).catch(() => null)]);
      const m = readAwcMetars(mj, { now: t }).get(ap.icao) || null, taf = tj ? readAwcTafs(tj, { now: t }).get(ap.icao) || null : null;
      if (metarError && !taf) throw metarError;   // nothing to say at all
      const name = `${ap.name} (${ap.icao}${ap.iata ? '/' + ap.iata : ''})`, out = [], data = { airport: { icao: ap.icao, iata: ap.iata || null, name: ap.name, city: ap.city || null, country: ap.cc || null, lat: ap.lat, lon: ap.lon, elevation_ft: Math.round(ap.elevM / 0.3048) } };
      if (m) {
        out.push(`${name}, ${m.type} ${m.time ? `${new Date(m.time).toISOString().slice(11, 16)}Z (${ago(m.time, t)})` : ''}: ${m.category ? CAT_WORDS[m.category] : 'no flight category (no sky report)'}.`);
        out.push(...metarWords(m).map(w => w.text));
        out.push(`As sent: ${m.raw}`);
        data.metar = { raw: m.raw, time: m.time ? new Date(m.time).toISOString() : null, category: m.category, wind_from_deg: m.wind ? m.wind.dir : null, wind_kt: m.wind ? m.wind.speedKt : null, gust_kt: m.wind ? m.wind.gustKt : null,
          visibility_sm: m.visSM != null ? r1(m.visSM) : null, ceiling_ft: m.ceilFt, weather: m.weather.map(w => w.text), clouds: m.clouds.map(c => ({ cover: c.cover, base_ft: c.baseFt, type: c.type || null })),
          temperature_c: m.tempC, dew_point_c: m.dewC, pressure_hpa: m.altimHpa, words: metarWords(m).map(w => w.text) };
        // the runway the wind favours (most headwind), when the wind says anything
        const rw = rd ? derive(rd, 'runways', parseRunways).get(ap.icao) : null;
        if (rw && m.wind && m.wind.dir != null && m.wind.speedKt >= 3) {
          const best = windTable(rw, m.wind.dir, m.wind.speedKt)[0];
          if (best) { out.push(`The wind favours runway ${best.end.ident}: ${Math.round(best.head)} kt headwind, ${Math.abs(best.cross) < 1 ? 'no crosswind' : `${Math.round(Math.abs(best.cross))} kt crosswind from the ${best.cross >= 0 ? 'right' : 'left'}`} (the tower decides; noise rules and traffic count too).`);
            data.favoured_runway = { runway: best.end.ident, headwind_kt: r1(best.head), crosswind_kt: r1(Math.abs(best.cross)) }; }
        }
      } else if (metarError) {
        out.push(`${name}: the latest METAR could not be had (${metarError.message}).`);
        data.metar = null; data.metar_unavailable = true;
      } else out.push(`${name} sent no METAR to the Aviation Weather Center in the last hours.`);
      if (taf) {
        const lines = tafWords(taf, { now: t, hours }), worst = tafWorst(taf, { now: t, hours: Math.min(hours, 6) });
        out.push(`Forecast (TAF${taf.issued ? ` issued ${new Date(taf.issued).toISOString().slice(11, 16)}Z` : ''}${worst ? `; at worst ${worst} in the next ${Math.min(hours, 6)} h` : ''}):`);
        out.push(...(lines.length ? lines.map(l => (l.category ? `[${l.category}] ` : '') + l.text) : ['The forecast has ended.']));
        data.taf = { raw: taf.raw, issued: taf.issued ? new Date(taf.issued).toISOString() : null, valid_from: taf.from ? new Date(taf.from).toISOString() : null, valid_to: taf.to ? new Date(taf.to).toISOString() : null,
          worst_next_hours: worst, periods: lines.map(l => ({ kind: l.kind, from: l.from ? new Date(l.from).toISOString() : null, to: l.to ? new Date(l.to).toISOString() : null, category: l.category, text: l.text })) };
      } else out.push('No TAF for this airport (only fields with a forecast office\'s TAF have one).');
      const url = globeUrl(site, { camera: frame(ap.lat, ap.lon, 25, { tilt: 50 }), on: feeds.hasAircraft ? ['airports', 'air'] : ['airports'] });
      out.push(`Times in UTC. ${ap.icao} on the globe${feeds.hasAircraft ? '' : ' (live aircraft show in the download version)'}: ${url}`);
      // provenance: the report's own time (the METAR's, or the TAF's issue time without one)
      const at = m && m.time ? m.time : taf && taf.issued ? taf.issued : null;
      const provenance = m || taf ? provLine({ prov: { ...provStamp(m ? 'metar' : 'taf', [rep('awc', { ...AWC, dataAt: at })]), maxAgeMs: m ? METAR_MAX_AGE : TAF_MAX_AGE } }, t) : null;
      return { text: out.join('\n'), data: { provenance, ...data, url, source: 'Aviation Weather Center (NOAA/NWS), aviationweather.gov; airports and runways OurAirports (public domain)' } };
    },
  };
}
