// transit_vehicles: the buses, trams, metros, trains and ferries moving near a place right now, from the same keyless
// operator feeds as the globe's transit layer (src/core/transit.js): MBTA (Boston), HSL (Helsinki, its GTFS-RT file),
// Entur (all of Norway), CapMetro (Austin) and Metro Transit (Minneapolis-St Paul; both GTFS-RT, read by core/gtfsrt.js).
import { parseMbta, parseEntur, enturQuery, fromGtfsRt, fromHslRt, transitAt, boxAround, TRANSIT_AREAS, MBTA_VEHICLES, ENTUR_VEHICLES, METRO_TRANSIT_PB, CAPMETRO_VIEW, capmetroFile,
  HSL_PB, METRO_TRANSIT_ROUTES, CAPMETRO_ROUTES } from '../src/core/transit.js';
import { parseVehiclePositions } from '../src/core/gtfsrt.js';
import { compass } from '../src/core/passes.js';
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea, distKm, frame, globeUrl } from './place.mjs';
import { iso, r1, km, ago, plural, areaData, limitProp, take } from './words.mjs';

const MODES = ['bus', 'tram', 'lightrail', 'metro', 'rail', 'ferry'];
const MODE_WORD = { bus: 'Bus', tram: 'Tram', lightrail: 'Light rail', metro: 'Metro', rail: 'Train', ferry: 'Ferry' };
const CREDIT = { mbta: 'MBTA v3 API (MassDOT developer licence)', hsl: 'HSL GTFS Realtime (CC BY 4.0)', entur: 'Entur (NLOD 2.0)', capmetro: 'CapMetro GTFS-RT via the Texas Open Data Portal',
  metrotransit: 'Metro Transit GTFS-RT (Metropolitan Council)' };
const NAME = { mbta: 'MBTA', hsl: 'HSL', entur: 'Entur', capmetro: 'CapMetro', metrotransit: 'Metro Transit' };
const STALE = 10 * 60e3;   // a report older than this: parked, or a vehicle that has gone off the air

export function transitTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  const pb = async (url, signal) => parseVehiclePositions((await feeds.bytes(url, { ttl: 15e3, timeout: 30e3, maxBytes: 16e6, signal })).bytes);
  const FETCH = {
    mbta: signal => feeds.json(MBTA_VEHICLES, { ttl: 15e3, timeout: 30e3, signal }).then(parseMbta),
    hsl: signal => pb(HSL_PB, signal).then(fromHslRt),
    capmetro: async signal => { const f = capmetroFile((await feeds.json(CAPMETRO_VIEW, { ttl: 60e3, signal })).blobId); if (!f) throw new ToolError('CapMetro names no current vehicle file just now', 'unavailable'); return fromGtfsRt(await pb(f, signal), { prefix: 'capmetro', operator: 'CapMetro', routes: CAPMETRO_ROUTES }); },
    metrotransit: signal => pb(METRO_TRANSIT_PB, signal).then(f => fromGtfsRt(f, { prefix: 'mt', operator: 'Metro Transit', routes: METRO_TRANSIT_ROUTES })),
    entur: (signal, area, radius) => { const [s, w, n, e] = boxAround(area.lat, area.lon, Math.max(1, radius));
      return feeds.json(ENTUR_VEHICLES, { method: 'POST', body: JSON.stringify({ query: enturQuery(s, w, n, e) }), headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'openoverwatch-mcp' }, ttl: 15e3, timeout: 30e3, signal }).then(parseEntur); },
  };

  return {
    name: 'transit_vehicles',
    title: 'Live buses, trams and trains near a place',
    description: 'The public transport vehicles moving near a place right now, live from the operators\' own feeds: Boston (MBTA), Helsinki (HSL), all of Norway (Entur), Austin (CapMetro) and Minneapolis-St Paul (Metro Transit). Each with its mode, line, destination where the feed gives it, speed, heading, how late it is (Norway, where reported) and when it last reported. Its link opens the globe\'s transit layer there, where the vehicles glide between their reports.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        ...areaProps('to look (default 1 km, at most 30)'),
        mode: { type: 'string', enum: MODES, description: 'Only this kind: bus, tram, lightrail, metro, rail (trains) or ferry.' },
        line: { type: 'string', maxLength: 20, description: 'Only this line, as written on the vehicle ("55", "Red", "M1", "Green").' },
        limit: limitProp(15, 50),
      },
    },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, pointKm: 1, signal });
      const src = transitAt(area.lat, area.lon);
      if (!src) throw new ToolError(`${area.label} is outside the live transit this server reads: ${[...new Set(TRANSIT_AREAS.map(x => x.name))].join(', ')}`, 'unsupported');
      const radius = Math.min(30, a.radius_km ?? (area.kind === 'point' ? 1 : Math.min(area.radiusKm, 5))), t = ctx.now();
      const fixes = await FETCH[src](signal, area, radius);
      const want = String(a.line || '').trim().toLowerCase();
      const near = fixes.filter(f => t - f.t < STALE).map(f => ({ ...f, km: distKm(area, f.lat, f.lon) })).filter(f => f.km <= radius
        && (!a.mode || f.mode === a.mode) && (!want || [f.line, f.lineName].some(x => String(x || '').toLowerCase() === want))).sort((x, y) => x.km - y.km);
      const shown = take(near, a.limit || 15);
      const rows = shown.map(f => ({ mode: f.mode, line: f.line || null, line_name: f.lineName && f.lineName !== f.line ? f.lineName : null, destination: f.dest || null, operator: f.operator || NAME[src],
        vehicle: f.vehicle || null, status: f.status || null, speed_kmh: f.spd != null ? Math.round(f.spd * 3.6) : null, heading: f.hdg != null ? compass(f.hdg) : null,
        delay_min: f.delay != null ? r1(f.delay / 60) : null, lat: +f.lat.toFixed(5), lon: +f.lon.toFixed(5), distance_km: Math.round(f.km * 100) / 100, reported: iso(f.t) }));
      const counts = {}; for (const f of near) counts[f.mode] = (counts[f.mode] || 0) + 1;
      const mix = Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([m, n]) => plural(n, MODE_WORD[m].toLowerCase(), m === 'bus' ? 'buses' : m === 'ferry' ? 'ferries' : MODE_WORD[m].toLowerCase() + 's')).join(', ');
      const late = d => (d == null ? '' : Math.abs(d) < 1 ? ' · on time' : ` · ${Math.round(Math.abs(d))} min ${d > 0 ? 'late' : 'early'}`);
      const lines = rows.map((r, i) => `${MODE_WORD[r.mode]} ${r.line || ''}${r.destination ? ` → ${r.destination}` : ''}${r.line_name ? ` (${r.line_name})` : ''} · ${km(r.distance_km)} away${r.speed_kmh != null ? ` · ${r.speed_kmh} km/h` : ''}${r.heading && r.speed_kmh ? ` heading ${r.heading}` : ''}${r.status ? ` · ${r.status}` : ''}${late(r.delay_min)} · reported ${ago(shown[i].t, t)}`.replace(/ {2,}/g, ' '));
      const what = [a.mode && MODE_WORD[a.mode].toLowerCase(), want && `line ${a.line}`].filter(Boolean).join(', ');
      const head = near.length ? `${plural(near.length, 'vehicle')}${what ? ` (${what})` : ''} within ${km(radius)} of ${area.label} right now (${mix}; ${NAME[src]})${near.length > shown.length ? `, the nearest ${shown.length}:` : ':'}`
        : `No ${what || 'public transport'} vehicles reporting within ${km(radius)} of ${area.label} right now (${NAME[src]}; ${fixes.length.toLocaleString('en-US')} in its feed).`;
      const url = globeUrl(site, { camera: frame(area.lat, area.lon, Math.max(0.8, Math.min(radius * 1.2, 15)), { tilt: 45 }), on: ['transit'] });
      return { text: [head, ...lines, `Live on the globe: ${url}`].join('\n'),
        data: { total: near.length, radius_km: radius, feed: NAME[src], vehicles: rows, area: areaData(area), url, source: CREDIT[src] } };
    },
  };
}
