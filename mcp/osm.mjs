// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Two MCP tools from OpenStreetMap vector tiles, the same tiles and code the globe uses (src/globe/alpr.js, military.js;
// parsing in src/core/osmtiles.js): licence-plate readers in the US and Canada (FlockHopper's hourly tiles of the ALPRs
// mapped in OpenStreetMap, mostly through DeFlock) and military land (OpenFreeMap's landuse=military). No Overpass.
import { decodeTile } from '../src/core/mvt.js';
import { tileCameras, cameraFacts, cardinal, makesWords, tileMilitary, joinPieces, describeArea, areaWords, tilesInBox, tileOverlaps, inBounds } from '../src/core/osmtiles.js';
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea, inArea, distKm, frameArea } from './place.mjs';

export const ALPR_SOURCES = ['https://tiles.dontgetflocked.com/cameras-us-hourly.json', 'https://tiles.dontgetflocked.com/cameras-ca-hourly.json'];
export const OFM = 'https://tiles.openfreemap.org/planet';
const MAX_TILES = 24;
const r2 = v => Math.round(v * 100) / 100, r5 = v => Number(v.toFixed(5));
const plural = (n, one, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const limitProp = (def, max) => ({ type: 'integer', minimum: 1, maximum: max, description: `How many to list (default ${def}, at most ${max}).` });

/** An area's box [w, s, e, n]: its own, or the square around its circle. */
export function areaBox(a) {
  if (a.bbox) return a.bbox;
  const dLat = a.radiusKm / 111.32, dLon = a.radiusKm / (111.32 * Math.max(0.05, Math.cos(a.lat * Math.PI / 180)));
  return [a.lon - dLon, Math.max(-85, a.lat - dLat), a.lon + dLon, Math.min(85, a.lat + dLat)];
}
/** The most detailed zoom in `zooms` whose tiles over the box number at most MAX_TILES: { z, keys } or null. */
export function zoomFor(box, zooms) {
  for (const z of zooms) { const keys = tilesInBox(...box, z); if (keys.length <= MAX_TILES) return { z, keys }; }
  return null;
}

export function createOsmTools(ctx, link) {
  const { feeds } = ctx;
  /** A tile of a source, decoded (an empty object where the source has none). */
  async function vtile(spec, key, want, signal) {
    const [z, x, y] = key.split('/'), url = spec.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y);
    try { const { bytes: b } = await feeds.bytes(url, { ttl: 3600e3, timeout: 30e3, signal }); return b.length ? decodeTile(b, want) : {}; }
    catch (e) { if (e.code === 'not_found') return {}; throw e; }
  }
  const specOf = async (url, signal) => { const s = await feeds.json(url, { ttl: 6 * 3600e3, signal }); if (!s || !Array.isArray(s.tiles) || !s.tiles[0]) throw new ToolError(`${new URL(url).hostname} sent no tile address`, 'unavailable'); return s; };

  const plateReaders = {
    name: 'plate_readers',
    title: 'Licence-plate readers near a place (US, Canada)',
    description: 'Automatic licence-plate readers (ALPR, such as Flock Safety cameras) mapped in OpenStreetMap near a place in the United States or Canada, from the tiles FlockHopper rebuilds every hour (mostly mapped through DeFlock): how many, their makes and operators, which way they face, and the nearest ones. Mapped locations only: no images, no plates; readers nobody has mapped are missing.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps('to count (default 3 km around a point, or the place itself)'), limit: limitProp(10, 50) } },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, pointKm: 3, signal });
      const specs = await Promise.all(ALPR_SOURCES.map(u => specOf(u, signal)));
      const lat = area.frameLat ?? area.lat, lon = area.frameLon ?? area.lon;
      if (!specs.some(s => inBounds(s.bounds, lat, lon))) throw new ToolError(`The plate-reader tiles cover the United States and Canada only; ${area.label} is outside them`, 'not_found');
      const box = areaBox(area), detail = zoomFor(box, [12, 11, 10, 9]), pick = detail || zoomFor(box, [8, 7, 6, 5, 4, 3]);
      if (!pick) throw new ToolError('That area is too large to count: ask about a state or smaller', 'invalid_arguments');
      const jobs = [];
      for (const k of pick.keys) specs.forEach(s => { if (tileOverlaps(k, s.bounds)) jobs.push(vtile(s, k, ['cameras'], signal).then(d => { const [z, x, y] = k.split('/').map(Number); return tileCameras(d.cameras, z, x, y); })); });
      const seen = new Set(), all = (await Promise.all(jobs)).flat().filter(c => inArea(area, c.lat, c.lon) && (c.heat || (!seen.has(c.id) && seen.add(c.id))));
      const camera = frameArea(area, { tilt: area.radiusKm < 30 ? 45 : 0 }), url = link({ camera, on: ['alpr'] });
      const head = `${plural(all.length, 'licence-plate reader')} mapped in OpenStreetMap${area.bbox ? ` in ${area.label}` : ` within ${r2(area.radiusKm)} km of ${area.label}`}`;
      if (!detail) {   // a big area: the far tiles carry positions only
        return { text: [`${head}.`, 'For makes, operators and the nearest ones, ask about a smaller area (a city or a county).', `On the globe: ${url}`].join('\n'),
          data: { total: all.length, detail: false, area: { name: area.label, lat: r2(lat), lon: r2(lon), radius_km: Math.round(area.radiusKm) }, url, source: 'OpenStreetMap contributors (ODbL), via DeFlock and FlockHopper (dontgetflocked.com)' } };
      }
      const ops = new Map(); for (const c of all) if (c.operator) ops.set(c.operator, (ops.get(c.operator) || 0) + 1);
      const topOps = [...ops].sort((x, y) => y[1] - x[1]).slice(0, 5), faced = all.filter(c => c.facings.length).length;
      const list = all.map(c => ({ ...c, km: distKm(area, c.lat, c.lon) })).sort((x, y) => x.km - y.km).slice(0, Math.max(1, Math.min(a.limit || 10, 50)));
      const lines = list.map(c => `${c.brand || 'Plate reader'}${c.operator ? ` (${c.operator})` : ''} · ${c.km < 1 ? Math.round(c.km * 1000) + ' m' : r2(c.km) + ' km'} away${c.facings.length ? ` · faces ${c.facings.map(cardinal).join(', ')}` : ''} · ${r5(c.lat)}, ${r5(c.lon)}`);
      const text = [`${head}${all.length ? `: ${makesWords(all, 4)}` : ''}.`,
        ...(topOps.length ? [`Run by: ${topOps.map(([k, v]) => `${k} ${v}`).join(', ')}${ops.size > 5 ? `, and ${plural(ops.size - 5, 'other')}` : ''}; ${all.length - [...ops.values()].reduce((s, v) => s + v, 0)} with no operator tagged.`] : []),
        ...(all.length ? [`${faced} of them have the direction they face tagged. Nearest first:`, ...lines] : []),
        'Mapped locations only (no images, no plates); readers nobody has mapped are not counted.', `On the globe: ${url}`];
      return { text: text.join('\n'), data: { total: all.length, detail: true, makes: makesWords(all, 8), operators: topOps.map(([name, n]) => ({ name, n })), facing_tagged: faced,
        nearest: list.map(c => ({ osm: `https://www.openstreetmap.org/${c.osmType === 'way' ? 'way' : 'node'}/${c.osmId}`, make: c.brand, operator: c.operator, lat: r5(c.lat), lon: r5(c.lon), distance_m: Math.round(c.km * 1000),
          facts: Object.fromEntries(cameraFacts(c)) })),
        area: { name: area.label, lat: r2(lat), lon: r2(lon), radius_km: Math.round(area.radiusKm) }, url, source: 'OpenStreetMap contributors (ODbL), via DeFlock and FlockHopper (dontgetflocked.com)' } };
    },
  };

  const militaryAreas = {
    name: 'military_areas',
    title: 'Military areas near a place',
    description: 'Land mapped in OpenStreetMap as military (bases, ranges, depots, barracks) near a place, anywhere in the world, from OpenFreeMap\'s map tiles: each area\'s size, the military airfields inside it, the town it is near and a link to OpenStreetMap for its full tags. The tiles carry no names for military land, so areas without an airfield come back unnamed; some countries\' sites are not mapped at all.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps('to look (default 25 km around a point, at most 150 km)'), limit: limitProp(10, 40) } },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, pointKm: 25, signal });
      if (area.radiusKm > 150) throw new ToolError('Ask about 150 km around a place at most (radius_km), or a smaller place', 'invalid_arguments');
      const spec = await specOf(OFM, signal), pick = zoomFor(areaBox(area), [12, 11, 10, 9]);
      if (!pick) throw new ToolError('That area is too large: ask about 150 km around a place at most', 'invalid_arguments');
      const ds = await Promise.all(pick.keys.map(k => vtile(spec, k, ['landuse', 'aerodrome_label', 'place'], signal).then(d => { const [z, x, y] = k.split('/').map(Number); return tileMilitary(d, z, x, y); })));
      const fields = ds.flatMap(d => d.fields), places = ds.flatMap(d => d.places), found = [];
      for (const g of joinPieces(ds.flatMap(d => d.pieces))) {
        const d = describeArea(g, fields, places);
        if (!g.pieces.some(p => p.polys.some(q => { for (let i = 0; i < q.outer.length; i += 2) if (inArea(area, q.outer[i + 1], q.outer[i])) return true; return false; }))) continue;
        found.push({ name: d.name, airfields: d.fields, near: d.near && { name: d.near.name, km: r2(d.near.km) }, area_km2: r2(g.area / 1e6), size: (g.open ? 'at least ' : '') + areaWords(g.area), at_least: g.open,
          lat: r5(d.at.lat), lon: r5(d.at.lon), distance_km: r2(distKm(area, d.at.lat, d.at.lon)), osm: `https://www.openstreetmap.org/query?lat=${d.at.lat.toFixed(5)}&lon=${d.at.lon.toFixed(5)}` });
      }
      const list = found.slice(0, Math.max(1, Math.min(a.limit || 10, 40))), total = found.reduce((s, f) => s + f.area_km2, 0);
      const camera = frameArea(area), url = link({ camera, on: ['milareas'] });
      const where = area.bbox ? `in ${area.label}` : `within ${r2(area.radiusKm)} km of ${area.label}`;
      const lines = list.map(f => `${f.name || 'Unnamed military area'} · ${f.size}${f.near ? ` · near ${f.near.name}` : ''} · ${f.distance_km} km from the middle · ${f.osm}`);
      const text = found.length ? [`${plural(found.length, 'military area')} mapped ${where}, ${r2(total)} km² in all (largest first):`, ...lines,
        'Outlines as volunteers mapped them; names come from the military airfields inside (the OpenStreetMap link shows each area\'s own tags).', `On the globe: ${url}`]
        : [`No land mapped as military ${where}. (Some countries' sites are not mapped.)`, `On the globe: ${url}`];
      return { text: text.join('\n'), data: { total: found.length, total_km2: r2(total), areas: list, zoom: pick.z, area: { name: area.label, lat: r2(area.lat), lon: r2(area.lon), radius_km: Math.round(area.radiusKm) }, url,
        source: 'OpenStreetMap contributors (ODbL), via OpenFreeMap (© OpenMapTiles)' } };
    },
  };

  return [plateReaders, militaryAreas];
}
