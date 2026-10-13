// Wildfires without a key, as on the 3D globe: NASA's VIIRS fire detections of the last 24 hours (FIRMS's data served by
// NASA GIBS as vector tiles, unzipped and decoded in the shared worker core/fires.worker.js) and the current US fire
// perimeters (NIFC WFIGS). Which tiles, their colours and the perimeter source: core/hazards.js. A detection is a hot
// pixel seen from orbit, not a confirmed wildfire: farm burning, gas flares and volcanoes show too.
import { esc, fmt, Log, Net, PHONE } from './util.js';
import { map, vecRenderer } from './mapview.js';
import { Layers, Points, feed } from './engine.js';
import { Detail } from './detail.js';
import { lineLayer } from './feeds.js';
import { fireTilesWanted, fireLevel, fireLook, FIRE_SAT_NAME, NIFC_PERIMETERS, firePerimeters, containColor, keptRings, perimeterCentre } from '../core/hazards.js';
import { zoomToHeight } from '../core/viewlink.js';
import { num } from '../core/format.js';

/* ---------- hot spots */
export const lyHot = Layers.add({ id: 'hotspots', group: 'Ground', name: 'Wildfire hot spots', desc: 'NASA VIIRS (NOAA-20, NOAA-21) · last 24 h · keyless, via NASA GIBS · from zoom 4', color: '#ff7a2f', shape: 'round', default: false, points: 'hotspots' });
Points.define('hotspots', 'hotspots', { minZoom: 4 });
let worker = null, seq = 0;
const waiting = new Map(), tiles = new Map();   // key → { fires, t, state, missing }
function viaWorker(url, since) {
  if (!worker) {
    worker = new Worker(new URL('../core/fires.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); e.data.error ? w.rej(new Error(e.data.error)) : w.res(e.data); };
    worker.onerror = e => { for (const w of waiting.values()) w.rej(new Error(e.message || 'fires worker failed')); waiting.clear(); worker = null; };
  }
  return new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); worker.postMessage({ id, url, since }); });
}
const ago = t => { const m = Math.round((Date.now() - t) / 60e3); return m < 90 ? `${m} min ago` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} h ago`; };
Detail.renderers.hotspot = f => `<div class="det">${Detail.head(fireLook(f.frp)[1], `Fire detection · NASA VIIRS (${FIRE_SAT_NAME[f.sat] || f.sat})`, f.frp >= 100 ? 'Intense fire' : f.frp >= 20 ? 'Strong fire' : 'Fire detected', esc(`${new Date(f.t).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${ago(f.t)} · ${f.day ? 'day' : 'night'} pass`))}
${Detail.kv([['Fire power', `${fmt.n(f.frp)} MW (radiative)`], ['Brightness', f.k ? `${fmt.n(f.k)} K` : null], ['Confidence', f.conf], ['Position', fmt.ll(f.lat, f.lon)]])}
<p style="font-size:12px;color:var(--ink-dim);line-height:1.45">A hot 375 m pixel seen from orbit: a wildfire, farm or brush burning, a gas flare or a volcano. Clouds, smoke and the satellites' timing hide some fires. NASA FIRMS / LANCE (VIIRS NRT), through NASA GIBS.</p>
<div class="actions"><button class="btn small" onclick="flyTo(${num(f.lat)},${num(f.lon)},11)">Center</button></div><hr class="sep">${Detail.links([{ text: 'On NASA FIRMS', url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${num(f.lon).toFixed(3)},${num(f.lat).toFixed(3)},11z` }])}</div>`;
const hotItem = f => { const [, color, size] = fireLook(f.frp); return { lat: f.lat, lon: f.lon, r: size * .8, color, fillAlpha: .8, stroke: true, kind: 'hotspot', obj: f, tip: `Fire · ${fmt.n(f.frp)} MW · ${ago(f.t)}` }; };
feed(lyHot, { interval: 30, viewDependent: true, minZoom: 4, fetch: async () => {
  const c = map.getCenter(), z = map.getZoom(), h = zoomToHeight(z, c.lat), lon = ((c.lng + 540) % 360) - 180;
  const want = fireTilesWanted(c.lat, lon, Math.min(30, h / 111e3 * 1.3), fireLevel(h / 1000), PHONE.matches ? 2 : 4), since = Date.now() - 864e5;
  const jobs = [];
  for (const w of want) {   // today's tiles grow with each satellite pass: fetched again after 30 min
    const t = tiles.get(w.key);
    if (!t || (t.state === 'failed' && Date.now() - t.t > 120e3) || (w.today && t.state === 'ok' && Date.now() - t.t > 30 * 60e3)) {
      const tile = { fires: t ? t.fires : [], t: Date.now(), state: 'loading' }; tiles.set(w.key, tile);
      jobs.push(viaWorker(w.url, since).then(r => { tile.fires = r.fires; tile.missing = !!r.missing; tile.state = 'ok'; }, e => { tile.state = 'failed'; Log.warn('Fire tile: ' + e.message); }));
    }
  }
  await Promise.all(jobs);
  const mine = want.map(w => tiles.get(w.key)).filter(Boolean), items = [], seen = new Set();
  for (const t of mine) for (const f of t.fires) if (!seen.has(f.id)) { seen.add(f.id); items.push(hotItem(f)); }
  for (const k of [...tiles.keys()]) if (tiles.size > 48 && !want.some(w => w.key === k)) tiles.delete(k);   // keep a few behind
  Points.set('hotspots', items); lyHot.feed.count = items.length;
  if (mine.length && mine.every(t => t.state === 'failed' || t.missing)) throw new Error('NASA GIBS fire tiles are unavailable right now');
} });

/* ---------- US perimeters (each fire's 30 largest rings over 2 ha), coloured by containment */
export const lyPerim = Layers.add({ id: 'fireperims', group: 'Ground', name: 'US wildfire perimeters', desc: 'NIFC WFIGS · current interagency perimeters, coloured by containment', color: '#ff3b2f', default: false, points: 'fireperims' });
export const gPerim = lineLayer(lyPerim); Points.define('fireperims', 'fireperims');
Detail.renderers.fireperim = f => {
  const d = t => t ? new Date(t).toISOString().slice(0, 10) : null;
  return `<div class="det">${Detail.head(containColor(f), (f.rx ? 'Prescribed burn' : 'Wildfire') + ' · NIFC (US interagency)', f.name + ' fire', esc([f.where, f.state].filter(Boolean).join(' · ')))}
${Detail.kv([['Size', f.acres ? `${fmt.n(f.acres)} acres · ${fmt.n(f.acres * 0.404686)} ha` : null], ['Contained', f.contained != null ? f.contained + '%' : null], ['Cause', f.cause], ['Discovered', d(f.discovered)], ['Perimeter mapped', d(f.updated)]])}
<p style="font-size:12px;color:var(--ink-dim)">The current perimeter mapped by incident teams (it can lag the fire by a day). National Interagency Fire Center, WFIGS.</p>
<div class="actions"><button class="btn small" onclick="flyTo(${num(f.lat)},${num(f.lon)},10)">Center</button></div></div>`;
};
feed(lyPerim, { interval: 900, fetch: async () => {
  const list = firePerimeters(await Net.json(NIFC_PERIMETERS, { timeout: 60000 })); gPerim.clearLayers(); const items = [];
  for (const f of list) {
    Object.assign(f, perimeterCentre(f)); const col = containColor(f);
    for (const r of keptRings(f)) L.polygon(r.map(([lon, lat]) => [lat, lon]), { color: col, weight: 1.6, opacity: .95, fillColor: col, fillOpacity: .25, interactive: false, renderer: vecRenderer }).addTo(gPerim);
    items.push({ lat: f.lat, lon: f.lon, r: 3.5, color: col, fillAlpha: .9, kind: 'fireperim', obj: f, tip: `${f.name} fire${f.acres ? ' · ' + fmt.n(f.acres) + ' acres' : ''}${f.contained != null ? ` · ${f.contained}% contained` : ''}`, label: f.acres >= 1000 ? f.name : null, labelZoom: 6 });
  }
  Points.set('fireperims', items); lyPerim.feed.count = list.length; lyPerim.desc = `${list.length} current perimeters · ${list.filter(f => (f.contained ?? 0) < 100 && !f.rx).length} not yet contained`;
} });

export const Hazards = { tiles, stats: () => ({ tiles: tiles.size, hotSpots: Points.sets.hotspots.items.length }) };
