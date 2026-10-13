// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// wildfires: fire hot spots in an area from NASA's VIIRS detections (FIRMS's data as GIBS vector tiles, the same the globe's
// fire layer draws: NOAA-20 and NOAA-21, ~375 m pixels, the last day or two), grouped into fires and ranked by the power
// they radiate, each placed by name; in the US also the named, mapped fires with their size and containment (NIFC WFIGS).
// A detection is a hot pixel seen from orbit, not a confirmed wildfire: the answer says so.
import { decodeTile } from '../src/core/mvt.js';
import { parseFires } from '../src/core/hazards.js';
import { fireTilesAround, clusterFires, fireWords, perimeterRows } from '../src/core/fireclusters.js';
import { inverse } from '../src/core/measure.js';
import { compass } from '../src/core/passes.js';
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea, inArea, frameArea, globeUrl, PHOTON } from './place.mjs';
import { iso, r1, r2, coord, km, ago, plural, areaData, limitProp, take } from './words.mjs';

const SATS = { N20: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All', N21: 'VIIRS_NOAA21_Thermal_Anomalies_375m_All' };
export const gibsFireTile = (layer, date, t) => `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${layer}/default/${date}/500m/${t.level}/${t.row}/${t.col}.mvt`;
export const WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query';
const US = [[18, -180, 72, -64], [51, 172, 54, 180]];   // the United States and Alaska's far islands: where NIFC maps fires

/** GIBS sends its tiles gzipped without saying so: unzip when the bytes say gzip (web streams: no Node zlib). */
async function gunzip(b) {
  if (!(b[0] === 0x1f && b[1] === 0x8b)) return b;
  return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

export function firesTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  async function tile(url, today, signal) {
    let got;
    try { got = await feeds.bytes(url, { ttl: today ? 30 * 60e3 : 6 * 3600e3, timeout: 40e3, maxBytes: 24e6, signal }); }
    catch (e) { if (e.code === 'not_found') return { fires: [], ok: true }; return { fires: [], ok: false }; }   // a day with no data yet is a 404
    return { fires: parseFires(decodeTile(await gunzip(got.bytes))), ok: true };
  }
  /** The nearest named place (Photon, within 50 km) and where the fire is from it: "Near X" or "24 km NE of X". */
  const placeName = async (lat, lon, signal) => {
    const d = await feeds.json(`${PHOTON.replace(/api\/$/, 'reverse')}?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&lang=en&limit=1&radius=50`, { ttl: 7 * 864e5, timeout: 10e3, signal }).catch(() => null);
    const f = d && d.features && d.features[0], p = f && f.properties; if (!p) return null;
    const named = p.osm_key === 'highway' || /^(street|house)$/.test(p.type || '') ? null : p.name;   // a settlement, else a named feature (not a street), else the county
    const name = [p.city || p.town || p.village || named || p.county, p.state, p.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
    if (!name) return null;
    const [plon, plat] = (f.geometry && f.geometry.coordinates) || [];
    if (!Number.isFinite(plat) || !Number.isFinite(plon) || p.city || p.town || p.village) return { name, text: `Near ${name}` };   // a settlement: its area holds the fire
    const g = inverse(plat, plon, lat, lon), dkm = g.s / 1000;
    return { name, text: dkm < 3 ? `Near ${name}` : `${Math.round(dkm)} km ${compass(g.az1)} of ${name}` };
  };

  return {
    name: 'wildfires',
    title: 'Wildfire hot spots in an area',
    description: "Fires burning in an area now, from NASA's VIIRS satellite fire detections (NOAA-20 and NOAA-21, ~375 m pixels, the last 24 hours by default): the hot pixels grouped into fires, strongest first, with their size, the power they radiate, when they were last seen and the nearest named place; in the United States also the named fires NIFC has mapped, with acres burned and containment. A detection is a hot pixel seen from orbit (a wildfire, but also farm burning, gas flares or a volcano), and clouds or smoke can hide fires.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        ...areaProps('to look (default: the place\'s own size, or 100 km around a point; at most 1500)'),
        hours: { type: 'integer', minimum: 1, maximum: 48, description: 'Detections from the last this many hours (default 24).' },
        limit: limitProp(10, 30),
      },
    },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, pointKm: 100, signal }), t = ctx.now(), hours = a.hours || 24, since = t - hours * 3600e3;
      const radius = Math.min(1500, area.radiusKm), cLat = area.frameLat ?? area.lat, cLon = area.frameLon ?? area.lon;
      const { level, tiles } = fireTilesAround(cLat, cLon, radius);
      const days = [...new Set([0, 1, 2].map(d => new Date(t - d * 864e5).toISOString().slice(0, 10)).filter(d => Date.parse(d + 'T23:59:59Z') >= since))];
      const jobs = [];
      for (const tl of tiles) for (const sat of Object.keys(SATS)) for (const d of days) jobs.push({ url: gibsFireTile(SATS[sat], d, tl), today: d === days[0] });
      const got = [];
      for (let i = 0; i < jobs.length; i += 6) got.push(...await Promise.all(jobs.slice(i, i + 6).map(j => tile(j.url, j.today, signal))));   // six at a time
      if (got.length && got.every(g => !g.ok)) throw new ToolError("NASA's fire detection tiles (GIBS) are not answering; try again in a few minutes", 'unavailable');
      const seen = new Set(), dets = [];
      for (const g of got) for (const f of g.fires) if (f.t >= since && f.t <= t + 3600e3 && !seen.has(f.id) && seen.add(f.id) && inArea(area.bbox ? area : { ...area, radiusKm: radius }, f.lat, f.lon)) dets.push(f);
      const groups = clusterFires(dets), shown = take(groups, a.limit || 10);
      const names = await Promise.all(shown.slice(0, 6).map(g => placeName(g.lat, g.lon, signal)));
      const rows = shown.map((g, i) => ({ lat: r2(g.lat), lon: r2(g.lon), near: names[i] ? names[i].name : null, from: names[i] ? names[i].text : null, detections: g.count, power_mw: Math.round(g.frp), strongest_pixel_mw: r1(g.max_frp), extent_km: r1(g.km),
        first_seen: iso(g.first), last_seen: iso(g.last), night_detections: g.night, words: fireWords(g) }));
      let perims = [];
      const usHit = US.some(([s, w, n, e]) => (area.lat + radius / 111 >= s && area.lat - radius / 111 <= n) && (area.lon >= w - 15 && area.lon <= e + 15));
      if (usHit) {
        const dLat = radius / 111.32, dLon = Math.min(179, radius / (111.32 * Math.max(0.05, Math.cos(cLat * Math.PI / 180))));
        const env = [Math.max(-180, cLon - dLon), Math.max(-90, cLat - dLat), Math.min(180, cLon + dLon), Math.min(90, cLat + dLat)].map(x => x.toFixed(3)).join(',');
        const q = `${WFIGS}?where=1%3D1&geometry=${env}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=poly_IncidentName,attr_IncidentName,attr_IncidentSize,attr_PercentContained,attr_POOState,attr_FireDiscoveryDateTime,poly_DateCurrent,attr_UniqueFireIdentifier,attr_IncidentTypeCategory,attr_FireCause,attr_InitialLatitude,attr_InitialLongitude&returnGeometry=false&returnCentroid=true&outSR=4326&orderByFields=attr_IncidentSize%20DESC&resultRecordCount=200&f=json`;
        const d = await feeds.json(q, { ttl: 15 * 60e3, timeout: 30e3, signal }).catch(() => null);
        perims = perimeterRows(d).filter(p => inArea(area.bbox ? area : { ...area, radiusKm: radius }, p.lat, p.lon) && (p.contained == null || p.contained < 100)).slice(0, 10);
      }
      const head = dets.length ? `${plural(dets.length, 'fire detection')} in the last ${plural(hours, 'hour')}${area.bbox ? ` in ${area.label}` : ` within ${km(radius)} of ${area.label}`}, in ${plural(groups.length, 'group')}${groups.length > shown.length ? ` (the ${shown.length} strongest below)` : ''}:`
        : `No fire detections in the last ${plural(hours, 'hour')}${area.bbox ? ` in ${area.label}` : ` within ${km(radius)} of ${area.label}`} (clouds or smoke can hide fires, and the satellites pass a few times a day).`;
      const lines = rows.map(r => `${r.from ? `${r.from} (${coord(r.lat, r.lon)})` : coord(r.lat, r.lon)} · ${r.words} · last seen ${ago(Date.parse(r.last_seen), t)}${r.night_detections ? ` · ${r.night_detections} at night` : ''}`);
      const plines = perims.map(p => `${p.prescribed ? 'Prescribed burn' : 'Fire'} "${p.name}"${p.state ? ` (${p.state})` : ''}: ${p.acres != null ? `${Math.round(p.acres).toLocaleString('en-US')} acres` : 'size not reported'}${p.contained != null ? `, ${Math.round(p.contained)}% contained` : ''}${p.discovered ? `, since ${new Date(p.discovered).toISOString().slice(0, 10)}` : ''}${p.cause ? `, cause ${p.cause.toLowerCase()}` : ''}`);
      const url = globeUrl(site, { camera: frameArea({ ...area, radiusKm: Math.max(20, Math.min(radius, 1500)) }), on: ['fires'] });
      const text = [head, ...lines, ...(perims.length ? ['Named fires NIFC has mapped here (not yet fully contained):', ...plines] : []),
        'A detection is a hot 375 m pixel seen from orbit: a wildfire, farm or brush burning, a gas flare or a volcano.', `Fires on the globe: ${url}`].join('\n');
      return { text, data: { total_detections: dets.length, groups: groups.length, hours, tile_level: level, fires: rows, named_fires: perims.map(p => ({ ...p, discovered: iso(p.discovered), updated: iso(p.updated) })),
        area: areaData(area), url, source: 'NASA FIRMS / LANCE VIIRS (NOAA-20, NOAA-21) via NASA GIBS; NIFC WFIGS interagency perimeters' } };
    },
  };
}
