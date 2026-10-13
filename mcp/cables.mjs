// submarine_cables: the undersea internet and power cables that come ashore at or run near a place (TeleGeography's
// submarine cable map, the data the 2D map draws; asked directly, so no relay): the landing stations nearby and the cables
// at them, with their length, owners and the year they entered service. The two map files (~1 MB) are kept a day.
import { CABLE_GEO, LANDING_GEO, CABLE_MIRROR, cableUrl, landingUrl, cablePage, parseCables, parseLandings, cablesNear, landingsNear, parseCable, parseLanding } from '../src/core/cables.js';
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea, frame, globeUrl } from './place.mjs';
import { r1, r2, km, plural, areaData, limitProp } from './words.mjs';

export function cablesTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  let maps = null;
  const both = (url, mirror, signal) => feeds.json(url, { ttl: 864e5, timeout: 60e3, maxBytes: 40e6, signal }).catch(() => feeds.json(mirror, { ttl: 864e5, timeout: 60e3, maxBytes: 40e6, signal }));
  const load = signal => (maps = maps || Promise.all([both(CABLE_GEO, CABLE_MIRROR + 'cable/cable-geo.json', signal), both(LANDING_GEO, CABLE_MIRROR + 'landing-point/landing-point-geo.json', signal)])
    .then(([c, l]) => ({ cables: parseCables(c), landings: parseLandings(l) }), e => { maps = null; throw e; }));
  const detail = (id, signal) => feeds.json(cableUrl(id), { ttl: 864e5, timeout: 20e3, signal }).then(parseCable, () => null);
  const station = (id, signal) => feeds.json(landingUrl(id), { ttl: 864e5, timeout: 20e3, signal }).then(parseLanding, () => null);

  return {
    name: 'submarine_cables',
    title: 'Submarine cables at a place',
    description: "The submarine (undersea) cables that land at or pass near a place, from TeleGeography's submarine cable map: the landing stations nearby, each cable's name, length, owners, the year it entered (or will enter) service and where else it lands, and how close it runs. Its link opens the globe over the place.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        ...areaProps('to look (default 50 km around a point or a town, at most 2000)'),
        limit: limitProp(10, 30),
      },
    },
    async run(a, { signal }) {
      const [area, m] = await Promise.all([resolveArea(a, feeds, { need: true, pointKm: 50, signal }), load(signal)]);
      if (!m.cables.length) throw new ToolError('The submarine cable map sent no cables just now; try again later', 'unavailable');
      const radius = Math.min(2000, a.radius_km ?? Math.max(50, Math.min(area.radiusKm, 2000)));
      const lands = landingsNear(m.landings, area.lat, area.lon, radius), passing = cablesNear(m.cables, area.lat, area.lon, radius);
      const stations = (await Promise.all(lands.slice(0, 4).map(l => station(l.id, signal)))).filter(Boolean);
      const atStation = new Map();   // cable id -> the nearby station it lands at
      for (const s of stations) for (const c of s.cables) if (!atStation.has(c.id)) atStation.set(c.id, s.name);
      const byId = new Map(m.cables.map(c => [c.id, c])), near = new Map(passing.map(p => [p.id, p]));
      const ids = [...new Set([...atStation.keys(), ...passing.map(p => p.id)])].filter(id => byId.has(id) || atStation.has(id));
      ids.sort((x, y) => (atStation.has(y) - atStation.has(x)) || ((near.get(x) || { km: 1e9 }).km - (near.get(y) || { km: 1e9 }).km));
      const want = ids.slice(0, a.limit || 10), info = await Promise.all(want.slice(0, 12).map(id => detail(id, signal)));
      const rows = want.map((id, i) => {
        const d = info[i] || {}, c = byId.get(id) || {}, p = near.get(id);
        return { id, name: d.name || c.name || id, lands_here: atStation.get(id) || null, closest_km: p ? r1(p.km) : null, closest_point: p ? { lat: r2(p.at.lat), lon: r2(p.at.lon) } : null,
          length_km: d.length_km ?? null, ready: d.ready_text ?? null, planned: d.planned ?? null, owners: d.owners || [], landings: (d.landings || []).map(l => l.name), url: cablePage(id) };
      });
      const yearNow = new Date(ctx.now()).getUTCFullYear();
      const lines = rows.map(r => `${r.name}${r.lands_here ? ` · lands at ${r.lands_here}` : r.closest_km != null ? ` · passes ${km(r.closest_km)} away` : ''}${r.length_km ? ` · ${Math.round(r.length_km).toLocaleString('en-US')} km long` : ''}${r.ready ? ` · ${r.planned || +r.ready > yearNow ? 'planned for' : 'in service since'} ${r.ready}` : ''}${r.owners.length ? ` · ${r.owners.slice(0, 4).join(', ')}${r.owners.length > 4 ? ` +${r.owners.length - 4}` : ''}` : ''}${r.landings.length ? ` · ${plural(r.landings.length, 'landing')}` : ''}`);
      const head = ids.length || lands.length
        ? `${plural(lands.length, 'cable landing station')} and ${plural(ids.length, 'submarine cable')} within ${km(radius)} of ${area.label}${lands.length ? ` (nearest: ${lands.slice(0, 3).map(l => `${l.name}, ${km(l.km)}`).join('; ')})` : ''}${ids.length > rows.length ? `; the ${rows.length} nearest:` : ':'}`
        : `No submarine cables or landing stations within ${km(radius)} of ${area.label}${area.kind === 'point' ? ' (try a larger radius_km)' : ''}.`;
      const url = globeUrl(site, { camera: frame(area.lat, area.lon, Math.max(30, Math.min(radius, 1500))) });
      return { text: [head, ...lines, 'Routes on the map are TeleGeography\'s drawings, not surveyed positions.', `The place on the globe: ${url}`].join('\n'),
        data: { radius_km: radius, landing_stations: lands.slice(0, 10).map(l => ({ name: l.name, lat: r2(l.lat), lon: r2(l.lon), distance_km: r1(l.km), id: l.id })), cables: rows, total_cables: ids.length, area: areaData(area), url,
          source: 'TeleGeography Submarine Cable Map (submarinecablemap.com, CC BY-NC-SA 3.0)' } };
    },
  };
}
