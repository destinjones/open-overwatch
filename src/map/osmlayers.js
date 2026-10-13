// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// OpenStreetMap layers from vector tiles, without the Overpass API (the 3D globe has the same: src/globe/alpr.js,
// military.js). Plate readers: every ALPR mapped in OpenStreetMap in the US and Canada, from FlockHopper's hourly tiles
// (a thinned dot cloud below zoom 10, every reader with its tags from 10 up). Military areas: OpenFreeMap's
// landuse=military from zoom 8, filled, outlined without the tile seams and joined across tiles, named by the military
// airfields inside. Both read tiles over plain GET with CORS, cached by the browser; the parsing is core/osmtiles.js.
import { num } from '../core/format.js';
import { decodeTile } from '../core/mvt.js';
import { tileCameras, cameraFacts, tileMilitary, joinPieces, describeArea, areaWords, tilesInBox, tileOverlaps } from '../core/osmtiles.js';
import { esc, fmt, Net } from './util.js';
import { map, vecRenderer } from './mapview.js';
import { Layers, Points, feed } from './engine.js';
import { Detail } from './detail.js';
import { lineLayer } from './feeds.js';

const OFM = 'https://tiles.openfreemap.org/planet', ALPR = ['https://tiles.dontgetflocked.com/cameras-us-hourly.json', 'https://tiles.dontgetflocked.com/cameras-ca-hourly.json'];
const ALPR_COL = '#ff4d5e', MIL_COL = '#ff6b5e', MAX_TILES = 16, MAX_HEAT = 20000, KEEP = 96;

// ---- tiles: TileJSON templates (6 h), decoded tiles kept for the session (least recently used go first) ----
const specs = new Map(), tiles = new Map();
async function spec(url) {
  const s = specs.get(url);
  if (s && Date.now() - s.at < 6 * 3600e3) return s.v;
  const v = await Net.json(url, { timeout: 20000 }); if (!v?.tiles?.[0]) throw new Error('no tile URL');
  specs.set(url, { at: Date.now(), v }); return v;
}
async function tile(src, key, want) {
  const id = src + '|' + key + '|' + want.join(',');
  if (tiles.has(id)) { const t = tiles.get(id); tiles.delete(id); tiles.set(id, t); return t; }   // touch: most recent last
  const p = (async () => {
    const [z, x, y] = key.split('/'), url = (await spec(src)).tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y);
    try { const b = await Net.bytes(url, { timeout: 30000 }); return b.length ? decodeTile(b, want) : {}; }
    catch (e) { if (/HTTP 40[04]|HTTP 204/.test(e.message)) return {}; throw e; }   // no tile there: nothing mapped
  })();
  tiles.set(id, p); p.catch(() => tiles.delete(id));
  while (tiles.size > KEEP) tiles.delete(tiles.keys().next().value);
  return p;
}
const view = () => { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- licence-plate readers ----
const DESC = 'OpenStreetMap via DeFlock / FlockHopper, rebuilt hourly · a dot cloud below zoom 10, every reader with its tags from 10';
export const lyAlpr = Layers.add({ id: 'alpr', group: 'Ground', name: 'Licence-plate readers (US, Canada)', desc: DESC, color: ALPR_COL, shape: 'round', default: false, points: 'alpr' });
Points.define('alpr', 'alpr', { minZoom: 3 });
Detail.renderers.alpr = c => `<div class="det">${Detail.head(ALPR_COL, 'Licence-plate reader · OpenStreetMap', c.brand ? c.brand + ' reader' : 'Plate reader', esc(c.operator || ''))}
${Detail.kv([...cameraFacts(c), ['Position', fmt.ll(c.lat, c.lon)]])}
<div class="actions"><button class="btn small" onclick="flyTo(${num(c.lat)},${num(c.lon)},17)">Center</button></div>
<p style="font-size:12px;line-height:1.45;color:var(--ink-dim)">An automatic licence-plate reader (ALPR) volunteers have mapped in OpenStreetMap, mostly through DeFlock. A location, not a feed: no images, no plates; readers nobody has mapped are not shown. © OpenStreetMap contributors (ODbL).</p>
<hr class="sep">${Detail.links([{ text: `OSM ${c.osmType === 'way' ? 'way' : 'node'} ${c.osmId}`, url: `https://www.openstreetmap.org/${c.osmType === 'way' ? 'way' : 'node'}/${encodeURIComponent(c.osmId)}` }, { text: 'FlockHopper', url: 'https://dontgetflocked.com/' }])}</div>`;
feed(lyAlpr, { interval: 3600, viewDependent: true, minZoom: 3, fetch: async () => {
  const zm = map.getZoom(), detail = zm >= 10, tz = detail ? clamp(zm - 2, 9, 12) : clamp(zm - 3, 3, 8), [w, s, e, n] = view();
  const bounds = await Promise.all(ALPR.map(u => spec(u).then(v => v.bounds || null)));
  const keys = tilesInBox(w, s, e, n, tz, MAX_TILES), jobs = [];
  for (const k of keys) ALPR.forEach((u, i) => { if (tileOverlaps(k, bounds[i])) jobs.push(tile(u, k, ['cameras']).then(d => { const [z, x, y] = k.split('/').map(Number); return tileCameras(d.cameras, z, x, y); })); });
  const lists = await Promise.all(jobs), items = [], seen = new Set();
  let total = 0;
  for (const l of lists) total += l.length;
  if (detail) {
    for (const l of lists) for (const c of l) {
      if (c.heat || seen.has(c.id)) continue; seen.add(c.id);
      items.push({ lat: c.lat, lon: c.lon, r: z => z >= 15 ? 5 : 3.5, color: ALPR_COL, fillAlpha: .7, stroke: true, kind: 'alpr', obj: c, tip: `Plate reader${c.brand ? ' · ' + c.brand : ''}${c.operator ? ' · ' + c.operator : ''}` });
    }
  } else {
    const step = Math.max(1, total / MAX_HEAT);
    for (const l of lists) for (let i = 0; i < l.length; i += step) { const c = l[Math.floor(i)]; items.push({ lat: c.lat, lon: c.lon, r: 1.4, color: ALPR_COL, alpha: .55, fillAlpha: .9 }); }
  }
  Points.set('alpr', items);
  lyAlpr.feed.count = detail ? items.length : total;
  lyAlpr.desc = keys.some(k => bounds.some(b => tileOverlaps(k, b))) ? DESC : 'Only the US and Canada are tiled: none in this view';
} });

// ---- military areas ----
export const lyMil = Layers.add({ id: 'milareas', group: 'Infrastructure', name: 'Military areas', desc: 'OpenStreetMap landuse=military via OpenFreeMap · from zoom 8 · named by the military airfields inside', color: MIL_COL, shape: 'round', default: false, points: 'milareas' });
const gMil = lineLayer(lyMil);
Points.define('milareas', 'milareas', { minZoom: 8 });
Detail.renderers.milarea = a => `<div class="det">${Detail.head(MIL_COL, 'Military area · OpenStreetMap', a.name || 'Military area', esc(a.near ? `near ${a.near.name}` : ''))}
${Detail.kv([['Size', `${a.open ? 'at least ' : ''}${areaWords(a.area)}`], ['Airfields', a.fields.join(', ')], ['Near', a.near ? `${a.near.name} (${a.near.km < 1 ? 'under 1' : Math.round(a.near.km)} km)` : null], ['Position', fmt.ll(a.lat, a.lon)]])}
<div class="actions"><button class="btn small" onclick="flyTo(${num(a.lat)},${num(a.lon)},13)">Center</button></div>
<p style="font-size:12px;line-height:1.45;color:var(--ink-dim)">Land volunteers have mapped as military (landuse=military): bases, ranges, depots, barracks. Outlines are as mapped; the tiles carry no names for military land, so the name is a military airfield inside it when there is one${a.open ? '; it runs on past the view, so its size is a lower bound' : ''}. © OpenMapTiles, © OpenStreetMap contributors (ODbL).</p>
<hr class="sep">${Detail.links([{ text: "What's here on OpenStreetMap", url: `https://www.openstreetmap.org/query?lat=${a.lat.toFixed(5)}&lon=${a.lon.toFixed(5)}` }])}</div>`;
feed(lyMil, { interval: 3600, viewDependent: true, minZoom: 8, fetch: async () => {
  const tz = clamp(map.getZoom() - 2, 9, 12), [w, s, e, n] = view(), keys = tilesInBox(w, s, e, n, tz, MAX_TILES);
  const ds = await Promise.all(keys.map(k => tile(OFM, k, ['landuse', 'aerodrome_label', 'place']).then(d => { const [z, x, y] = k.split('/').map(Number); return tileMilitary(d, z, x, y); })));
  const fields = ds.flatMap(d => d.fields), places = ds.flatMap(d => d.places), pins = [];
  gMil.clearLayers();
  const style = { renderer: vecRenderer, bubblingMouseEvents: false };
  for (const g of joinPieces(ds.flatMap(d => d.pieces))) {
    const d = describeArea(g, fields, places), a = { id: g.key, name: d.name, fields: d.fields, near: d.near, area: g.area, open: g.open, lat: d.at.lat, lon: d.at.lon };
    const ll = r => { const out = []; for (let i = 0; i < r.length; i += 2) out.push([r[i + 1], r[i]]); return out; };
    for (const p of g.pieces) {
      for (const q of p.polys) { const poly = L.polygon([ll(q.outer), ...q.holes.map(ll)], { ...style, stroke: false, fillColor: MIL_COL, fillOpacity: .14 }); poly.on('click', () => Detail.show('milarea', a, a.id)); gMil.addLayer(poly); }
      for (const r of p.runs) gMil.addLayer(L.polyline(ll(r), { ...style, interactive: false, color: MIL_COL, weight: 1.6, opacity: .9 }));
    }
    pins.push({ lat: a.lat, lon: a.lon, r: 4, color: MIL_COL, shape: 'tri', kind: 'milarea', obj: a, tip: `${a.name || 'Military area'} · ${a.open ? 'at least ' : ''}${areaWords(a.area)}`, label: a.name || null, labelZoom: 10 });
  }
  Points.set('milareas', pins);
  lyMil.feed.count = pins.length;
} });
