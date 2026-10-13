// road_speeds: how fast traffic is moving on the roads near a place, measured, not modelled: Fintraffic's roadside sensors
// (all of Finland: 5-minute average speed and vehicles an hour, each direction) and NYC DOT's speed sensors (New York City's
// highways and arterials; the city publishes them a day or so late, and the answer says how old each reading is). The
// parsers are the globe's (src/core/traffic.js), whose traffic layer colours the roads with the same readings.
import { parseNyc, parseTms } from '../src/core/traffic.js';
import { compass } from '../src/core/passes.js';
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea, distKm, frame, globeUrl } from './place.mjs';
import { iso, r1, km, ago, plural, areaData, limitProp, take } from './words.mjs';

const NYC = 'https://data.cityofnewyork.us/resource/i4gi-tjb9.json', NYC_BOX = [40.47, -74.28, 40.93, -73.67];
const TMS = 'https://tie.digitraffic.fi/api/tms/v1/stations', FI_BOX = [59.6, 19.0, 70.2, 31.7], DT = { 'Digitraffic-User': 'OpenOverwatch-MCP/0.2' };
const inBox = ([s, w, n, e], lat, lon) => lat >= s && lat <= n && lon >= w && lon <= e;
const NYC_MAX_AGE = 48 * 3600e3, FI_MAX_AGE = 20 * 60e3;

/** The nearest point of a polyline ([{ lat, lon }]) to the area's centre, km (flat, fine across a city). */
function nearestKm(area, pts) {
  let best = Infinity;
  for (const p of pts) best = Math.min(best, distKm(area, p.lat, p.lon));
  return best;
}

export function roadsTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'road_speeds',
    title: 'Measured road speeds near a place',
    description: "How fast traffic is moving near a place, from roadside sensors: all of Finland (Fintraffic: the 5-minute average speed and vehicles an hour in each direction, live) and New York City's highways and arterials (NYC DOT: link speeds, published with a delay of about a day; each reading's age is given). Its link opens the globe's traffic layer there, which colours the roads by these readings.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps('to look (default 10 km, at most 60)'), limit: limitProp(10, 30) } },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, pointKm: 10, signal }), t = ctx.now();
      const radius = Math.min(60, a.radius_km ?? (area.kind === 'point' ? 10 : Math.min(area.radiusKm, 25)));
      let rows = [], source, feed;
      if (inBox(FI_BOX, area.lat, area.lon)) {
        feed = 'Fintraffic'; source = 'Fintraffic / digitraffic.fi road traffic measurements (CC BY 4.0)';
        const st = await feeds.json(TMS, { ttl: 864e5, timeout: 60e3, headers: DT, signal });
        const live = ((st && st.features) || []).filter(f => f.properties && f.properties.collectionStatus === 'GATHERING' && f.properties.bearing != null && f.geometry);
        const near = live.map(f => [f, distKm(area, f.geometry.coordinates[1], f.geometry.coordinates[0])]).filter(([, d]) => d <= radius).sort((x, y) => x[1] - y[1]).slice(0, 10).map(([f]) => f);
        const data = await Promise.all(near.map(f => feeds.json(`${TMS}/${f.properties.id}/data`, { ttl: 60e3, timeout: 20e3, headers: DT, signal }).catch(() => null)));
        rows = parseTms(near, data.filter(Boolean)).filter(r => t - r.t < FI_MAX_AGE).map(r => ({ road: r.name.replace(/_/g, ' '), heading: compass(r.bearing), kmh: Math.round(r.kmh), vehicles_per_hour: r.flow, at: r.t, km: distKm(area, r.lat, r.lon), lat: r.lat, lon: r.lon }));
      } else if (inBox(NYC_BOX, area.lat, area.lon)) {
        feed = 'NYC DOT'; source = 'NYC DOT Traffic Speeds (NYC Open Data)';
        const q = new URLSearchParams({ $select: 'link_id,speed,data_as_of,link_name,borough,link_points', $order: 'data_as_of DESC', $limit: '1200' });
        const links = parseNyc(await feeds.json(`${NYC}?${q}`, { ttl: 5 * 60e3, timeout: 40e3, signal }));
        rows = links.filter(l => t - l.t < NYC_MAX_AGE).map(l => ({ road: l.name, borough: l.borough, kmh: Math.round(l.kmh), mph: Math.round(l.kmh / 1.609344), at: l.t, km: nearestKm(area, l.pts), lat: l.pts[0].lat, lon: l.pts[0].lon })).filter(r => r.km <= radius);
      } else throw new ToolError(`${area.label} has no road sensors this server reads: Finland (Fintraffic) and New York City (NYC DOT) only`, 'unsupported');
      rows.sort((x, y) => x.km - y.km);
      const shown = take(rows, a.limit || 10);
      const old = feed === 'NYC DOT' && shown.length ? Math.min(...shown.map(r => t - r.at)) : 0;
      const head = rows.length ? `${plural(rows.length, 'measured reading')} within ${km(radius)} of ${area.label} (${feed}${feed === 'NYC DOT' ? `; the newest is ${ago(t - old, t).replace(' ago', '')} old: the city publishes late` : ''})${rows.length > shown.length ? `, the nearest ${shown.length}:` : ':'}`
        : `No ${feed} road sensors reporting within ${km(radius)} of ${area.label}${feed === 'NYC DOT' ? ' (its ~150 links are on highways and arterials; Midtown\'s side streets have none)' : ''}.`;
      const lines = shown.map(r => `${r.road || 'Road sensor'}${r.borough ? ` (${r.borough})` : ''}${r.heading ? ` heading ${r.heading}` : ''} · ${r.kmh} km/h${r.mph != null ? ` (${r.mph} mph)` : ''}${r.vehicles_per_hour != null ? ` · ${r.vehicles_per_hour.toLocaleString('en-US')} vehicles/h` : ''} · ${km(r.km)} away · ${ago(r.at, t)}`);
      const url = globeUrl(site, { camera: frame(area.lat, area.lon, Math.max(1, Math.min(radius, 8)), { tilt: 50 }), on: ['traffic'] });
      return { text: [head, ...lines, `Traffic on the globe (roads coloured by these readings): ${url}`].join('\n'),
        data: { feed, total: rows.length, radius_km: radius, readings: shown.map(r => ({ road: r.road || null, borough: r.borough || null, heading: r.heading || null, speed_kmh: r.kmh, speed_mph: r.mph ?? Math.round(r.kmh / 1.609344),
          vehicles_per_hour: r.vehicles_per_hour ?? null, measured: iso(r.at), distance_km: r1(r.km) })), area: areaData(area), url, source } };
    },
  };
}
