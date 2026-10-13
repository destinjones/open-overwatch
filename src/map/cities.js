// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// City layers the 3D globe had first: bike share worldwide (CityBikes) and live transit (Boston, Helsinki, Norway, Austin,
// Minneapolis). The feeds, their loops, the vehicles' motion and the station looks are the globe's own (core/bikes.js,
// core/transitfeeds.js, core/transit.js); this file only places them on the 2D map's canvas.
import { C, esc, fmt, Log, Net, toast } from './util.js';
import { map } from './mapview.js';
import { Layers, Movers, Points, feed, requestDraw } from './engine.js';
import { Detail } from './detail.js';
import { parseNetworks, parseStations, networksNear, CITYBIKES_API, BIKE_STATES, bikeLook, checkedAgo, bikeTip } from '../core/bikes.js';
import { TRANSIT_MODES, TRANSIT_AREAS, transitSources, sourcesAt, startSource, stopSource, createFleet, transitTip, transitRows } from '../core/transitfeeds.js';
import { zoomToHeight } from '../core/viewlink.js';
import { num } from '../core/format.js';

const wrapLon = lon => ((lon + 540) % 360) - 180;

/* ---------- Bike share: the systems near the view and their stations, refreshed every 3 minutes while in view */
export const lyBikes = Layers.add({ id: 'bikes', group: 'Cities', name: 'Bike share', desc: 'CityBikes · ~800 systems worldwide · stations with free bikes and docks, from zoom 11', color: BIKE_STATES.ok[1], shape: 'round', default: false, points: 'bikes' });
Points.define('bikes', 'bikes', { minZoom: 11 });
let bikeDir = null, bikePause = 0;
const bikeNets = new Map();   // id → { net, stations, t }
Detail.renderers.bike = s => {
  const st = bikeLook(s), [words, color] = BIKE_STATES[st], n = s.net;
  return `<div class="det">${Detail.head(color, 'Bike share · ' + n.name, s.name || 'Station', esc([n.company, n.city].filter(Boolean).join(' · ')), [{ t: words, cls: st === 'ok' ? 'good' : st === 'empty' || st === 'full' ? 'warn' : '' }])}
${Detail.kv([['Bikes', `${fmt.n(s.bikes)}${s.ebikes ? ` (${fmt.n(s.ebikes)} electric)` : ''}`], ['Free docks', s.docks != null && !s.virtual ? `${fmt.n(s.docks)}${s.total ? ' of ' + fmt.n(s.total) : ''}` : null], ['Address', s.address], ['Checked', s.t ? checkedAgo(Date.now() - s.t, s.t) : null], ['Position', fmt.ll(s.lat, s.lon)]])}
${st === 'stale' ? '<p style="font-size:12px;color:var(--ink-dim)">This system\'s feed hasn\'t updated lately: these are its last numbers.</p>' : ''}
<div class="actions"><button class="btn small" onclick="flyTo(${num(s.lat)},${num(s.lon)},16)">Center</button></div><hr class="sep">
<p style="font-size:11.5px;color:var(--ink-faint)">From the operator's own feed, gathered by CityBikes (citybik.es, open data under each operator's terms).</p></div>`;
};
feed(lyBikes, { interval: 180, viewDependent: true, minZoom: 11, fetch: async () => {
  if (Date.now() < bikePause) throw new Error('CityBikes asked us to slow down: trying again shortly');
  bikeDir ||= parseNetworks(await Net.json(CITYBIKES_API + '?fields=id,name,location,company', { timeout: 40000 }));
  const c = map.getCenter(), b = map.getBounds(), km = Math.min(120, Math.max(40, map.distance(b.getNorthWest(), b.getSouthEast()) / 2000));
  const want = networksNear(bikeDir, c.lat, wrapLon(c.lng), km, 4), items = [];
  for (const net of want) {
    let e = bikeNets.get(net.id);
    if (!e || Date.now() - e.t > 170e3) {
      try { e = { net, t: Date.now(), stations: parseStations(await Net.json(`${CITYBIKES_API}/${encodeURIComponent(net.id)}?fields=stations`, { timeout: 40000, throttle: 'citybikes', gap: 400 })).map(s => ({ ...s, net, kind: 'bike' })) }; bikeNets.set(net.id, e); }
      catch (err) { if (/429/.test(err.message)) { bikePause = Date.now() + 10 * 60e3; toast('Bike share: CityBikes asks us to slow down; trying again in 10 minutes'); } if (!e) { Log.warn(`Bike share ${net.name}: ${err.message}`); continue; } }
    }
    for (const s of e.stations) items.push({ lat: s.lat, lon: s.lon, r: z => (z >= 15 ? 5 : z >= 13 ? 4 : 3) + Math.min(2, (s.total || 8) / 16), color: BIKE_STATES[bikeLook(s)][1], fillAlpha: .75, kind: 'bike', obj: s, tip: bikeTip(s) });
  }
  for (const [id, e] of bikeNets) if (!want.includes(e.net) && Date.now() - e.t > 30 * 60e3) bikeNets.delete(id);
  Points.set('bikes', items); lyBikes.feed.count = items.length;
  lyBikes.desc = want.length ? `${want.map(n => n.name + (n.city ? ` (${n.city})` : '')).join(', ')} · ${items.length} stations` : 'No bike share system near the middle of the map';
} });

/* ---------- Live transit: a feed runs while the map's middle is in (or near) its area, from zoom 9, in a visible tab;
   each vehicle is drawn a little behind live, between two real reports, so it glides instead of hopping */
export const lyTransit = Layers.add({ id: 'transit', group: 'Cities', name: 'Live transit', desc: 'Boston (MBTA) · Helsinki (HSL) · Norway (Entur) · Austin (CapMetro) · Minneapolis (Metro Transit) · buses, trams, metros, trains, ferries · from zoom 9', color: TRANSIT_MODES.tram[1], default: false });
const SOURCES = transitSources();
const vehicles = Movers.define('transit', { layerId: 'transit', kind: 'transit', minZoom: 9,
  at(v, now, out) {
    const dt = v.stepT ? Math.min(now - v.stepT, 1000) : 0; v.stepT = now;
    fleet.step(v, now, dt); out.lat = v.lat; out.lon = v.lon; out.hdg = v.hdg;
  },
  glyph(ctx, x, y, v, z, sel, hdg) {
    const col = (TRANSIT_MODES[v.info.mode] || TRANSIT_MODES.bus)[1], r = z >= 14 ? 4.5 : z >= 12 ? 3.6 : 2.8;
    if (hdg != null && z >= 12) { const a = (hdg - 90) * Math.PI / 180; ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5)); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
  },
  tip: v => transitTip(v),
  label: (v, z, sel) => (sel || z >= 15) && v.info.line ? String(v.info.line) : null,
});
const fleet = createFleet({ drop: () => requestDraw() }, vehicles);   // the fleet keeps its vehicles in the canvas's set
Detail.renderers.transit = v => {
  const i = v.info, [m, c] = TRANSIT_MODES[i.mode] || ['Vehicle', '#ffffff'];
  return `<div class="det">${Detail.head(c, `${m} · ${v.src.name}`, `${i.line || m}${i.dest ? ' → ' + i.dest : ''}`, '')}
${Detail.kv(transitRows(v, fleet.age(v)))}
<p style="font-size:12px;color:var(--ink-dim)">Drawn about ${Math.round(v.delay / 1000)} s behind live, moving between its real reports. ${esc(v.src.credit)}</p>
<div class="actions"><button class="btn small" onclick="flyTo(${num(v.lat)},${num(v.lon)},15)">Center</button></div></div>`;
};
function transitView() { const c = map.getCenter(); return { lat: c.lat, lon: wrapLon(c.lng), height: zoomToHeight(map.getZoom(), c.lat) }; }
function evaluate() {
  const v = transitView(), want = lyTransit.on && !document.hidden && map.getZoom() >= 9 ? sourcesAt(v.lat, v.lon) : new Set();
  for (const s of Object.values(SOURCES)) {
    if (want.has(s.id)) startSource(s, { view: transitView, onFixes: fixes => { fleet.ingest(s, fixes, !!s.every); requestDraw(); }, onError: e => Log.warn(`Transit ${s.name}: ${e.message}`) });
    else if (stopSource(s)) fleet.dropSource(s);
  }
}
setInterval(() => { if (lyTransit.on) { evaluate(); fleet.prune(); } }, 1000);
document.addEventListener('visibilitychange', evaluate);
lyTransit.disable = () => { for (const s of Object.values(SOURCES)) stopSource(s); fleet.clear(); requestDraw(); };
feed(lyTransit, { interval: 5, fetch: async () => {   // status only: the sources run on their own loops (above)
  evaluate(); lyTransit.feed.count = vehicles.size;
  const running = Object.values(SOURCES).filter(s => s.running), v = transitView();
  const near = TRANSIT_AREAS.filter((a, i, all) => all.findIndex(b => b.name === a.name) === i).map(a => a.name).join(', ');
  lyTransit.desc = running.length ? `${running.map(s => s.name).join(', ')}: ${fmt.n(vehicles.size)} vehicles` : map.getZoom() < 9 ? 'Zoom in (9+) over ' + near : `No live feed here (${fmt.ll(v.lat, v.lon)}) · covered: ${near}`;
  const dead = running.filter(s => s.fails > 2); if (dead.length && !vehicles.size) throw new Error(dead.map(s => s.name).join(', ') + ' not answering');
} });

export const Cities = { fleet, sources: SOURCES, bikeNets, stats: () => ({ transit: fleet.stats(), bikes: [...bikeNets.values()].map(e => ({ id: e.net.id, stations: e.stations.length })) }) };
