// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Bike share worldwide: CityBikes' directory of ~800 systems (keyless, CORS) and the stations of the systems near the
// view, with how many bikes and free docks each has. A system loads when the camera is below ~150 km within 40 km of it;
// its stations refresh every 3 minutes while in view (CityBikes allows 300 requests an hour per address, shared by every
// tab). Colours: green plenty, orange a few, red none, blue full (nowhere to return a bike), grey closed.
import { C, esc, fmt, toast, bigStore, PHONE } from './env.js';
import { scene, camera, camHeight } from './viewer.js';
import { Terrain } from './terrain.js';
import { setCount } from './layers.js';
import { state } from './state.js';
import { parseNetworks, parseStations, networksNear, CITYBIKES_API, BIKE_STATES, bikeLook, checkedAgo, bikeTip } from '../core/bikes.js';

const API = CITYBIKES_API, MAX_H = 150e3, NEAR_KM = 40, REFRESH = 3 * 60e3, DROP_KM = 250, MAX_NETS = PHONE ? 2 : 4;
const STATES = BIKE_STATES, look = s => bikeLook(s);   // words and colours shared with the 2D map
const COLOR = Object.fromEntries(Object.entries(STATES).map(([k, [, c]]) => [k, C.Color.fromCssColorString(c)]));
const OUTLINE = C.Color.BLACK.withAlpha(0.6), SCALE = new C.NearFarScalar(500, 1.5, 6e4, 0.55);
const pts = scene.primitives.add(new C.PointPrimitiveCollection());
pts.show = false;
const nets = new Map();   // id → { net, stations, t, busy }
let directory = null, dirLoading = null, pausedUntil = 0, toldLimit = false;

const ago = checkedAgo;
const StationProto = {
  tip() { return '🚲 ' + bikeTip(this); },
  cardHtml() {
    const st = look(this), [words, color] = STATES[st], n = this.net;
    const bikes = `${fmt(this.bikes)}${this.ebikes ? ` (${fmt(this.ebikes)} electric)` : ''}`;
    return `<div class="k" style="--c:${color}">Bike share · ${esc(n.name)}</div><h2>${esc(this.name || 'Station')}</h2><dl>`
      + `<dt>Bikes</dt><dd>${esc(bikes)}</dd>` + (this.docks != null && !this.virtual ? `<dt>Free docks</dt><dd>${fmt(this.docks)}${this.total ? ' of ' + fmt(this.total) : ''}</dd>` : '')
      + `<dt>Now</dt><dd>${esc(words)}</dd>` + (this.address ? `<dt>Address</dt><dd>${esc(this.address)}</dd>` : '')
      + `<dt>System</dt><dd>${esc([n.company, n.city].filter(Boolean).join(' · ') || n.name)}</dd>`
      + (this.t ? `<dt>Checked</dt><dd>${esc(ago(Date.now() - this.t, this.t))}</dd>` : '') + '</dl>'
      + (st === 'stale' ? '<p class="note" style="margin-top:8px">This system\'s feed hasn\'t updated lately: these are its last numbers.</p>' : '')
      + '<div class="note" style="margin-top:8px">From the operator\'s own feed, gathered by CityBikes (citybik.es, open data under each operator\'s terms). Refreshed every few minutes while you look.</div>';
  },
};

async function loadDirectory() {
  if (directory) return directory;
  if (!dirLoading) dirLoading = (async () => {
    const c = await bigStore.get('citybikes');
    if (c && Date.now() - c.t < 864e5 && Array.isArray(c.list)) return (directory = c.list);
    const r = await fetch(API + '?fields=id,name,location,company');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    directory = parseNetworks(await r.json());
    bigStore.set('citybikes', { t: Date.now(), list: directory });
    return directory;
  })().finally(() => { dirLoading = null; });
  return dirLoading;
}

/** Fetch a system's stations and draw them (replacing its old dots). */
async function loadNet(net) {
  let e = nets.get(net.id);
  if (!e) { e = { net, stations: [], t: 0, busy: false }; nets.set(net.id, e); }
  if (e.busy || Date.now() < pausedUntil) return;
  e.busy = true;
  try {
    const r = await fetch(`${API}/${encodeURIComponent(net.id)}?fields=stations`);
    if (r.status === 429) { pausedUntil = Date.now() + 10 * 60e3; if (!toldLimit) { toldLimit = true; toast('Bike share: CityBikes asks us to slow down; trying again in 10 minutes', 4000); } return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const list = parseStations(await r.json());
    if (!Bikes.layer.on || nets.get(net.id) !== e) return;
    clear(e);
    e.stations = list.map(s => {
      const o = Object.assign(Object.create(StationProto), s, { kind: 'bike', net });
      o.pt = pts.add({ position: C.Cartesian3.ZERO, pixelSize: 5 + Math.min(4, (s.total || 8) / 8), color: COLOR[look(s)],
        outlineColor: OUTLINE, outlineWidth: 1, scaleByDistance: SCALE, id: o });
      seat(o); return o;
    });
    e.t = Date.now(); count();
    if (state.selected && state.selected.kind === 'bike' && state.selected.net === net) {   // the open card follows the fresh numbers
      const same = e.stations.find(o => o.id === state.selected.id); if (same) Object.assign(state.selected, same);
    }
  } catch (err) { console.warn('bike share', net.id, err.message); e.t = Date.now() - REFRESH + 60e3; }   // retry in a minute
  finally { e.busy = false; }
}
/** Stand a station on the ground (again once the detailed terrain under it arrives). */
function seat(o) { o.pt.position = C.Cartesian3.fromDegrees(o.lon, o.lat, Terrain.near(o.lat, o.lon, 4) + 2); o.gx = Terrain.exact; }
function clear(e) { for (const o of e.stations) pts.remove(o.pt); e.stations = []; }
const count = () => { let n = 0; for (const e of nets.values()) n += e.stations.length; setCount('bikes', n); };

function centre() {
  const p = camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), C.Ellipsoid.WGS84) || camera.positionWC;
  const g = C.Cartographic.fromCartesian(p); return { lat: C.Math.toDegrees(g.latitude), lon: C.Math.toDegrees(g.longitude) };
}
async function evaluate() {
  if (!Bikes.layer.on || document.hidden || camHeight() > MAX_H) return;
  let list; try { list = await loadDirectory(); } catch (e) { console.warn('bike share directory', e.message); return; }
  const c = centre(), want = networksNear(list, c.lat, c.lon, NEAR_KM + Math.min(60, camHeight() / 2000), MAX_NETS), now = Date.now();
  for (const n of want) { const e = nets.get(n.id); if (!e || (!e.busy && now - e.t > REFRESH)) loadNet(n); }
  const k = Math.cos(c.lat * Math.PI / 180);
  for (const [id, e] of nets) if (!want.includes(e.net) && Math.hypot(e.net.lat - c.lat, (e.net.lon - c.lon) * k) * 111.32 > DROP_KM) { clear(e); nets.delete(id); count(); }
}
Terrain.onChange(() => { for (const e of nets.values()) for (const o of e.stations) seat(o); });
setInterval(() => { evaluate(); for (const e of nets.values()) for (const o of e.stations) if (!o.gx) seat(o); }, 4000);
camera.moveEnd.addEventListener(() => evaluate());

export const Bikes = {
  layer: { id: 'bikes', group: 'Earth', name: 'Bike share: stations and free bikes, worldwide (CityBikes)', color: '#7dffb0', on: false },
  nets,
  /** Show or hide; nothing is fetched while off. */
  apply(on = this.layer.on) {
    this.layer.on = on; pts.show = on;
    if (!on) { for (const e of nets.values()) clear(e); nets.clear(); count(); } else evaluate();
  },
  /** For the console: the systems loaded and their stations. */
  stats() { return [...nets.values()].map(e => ({ id: e.net.id, name: e.net.name, stations: e.stations.length, bikes: e.stations.reduce((a, s) => a + s.bikes, 0) })); },
};
