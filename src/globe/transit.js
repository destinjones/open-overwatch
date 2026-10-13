// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Live transit: buses, trams, metros, trains and ferries in Boston (MBTA), Helsinki (HSL), all of Norway (Entur), Austin
// (CapMetro) and Minneapolis-St Paul (Metro Transit), straight from each operator's keyless feed (CORS or WebSocket, so
// the website needs no relay; Austin and Minneapolis publish GTFS-RT protobuf, read by core/gtfsrt.js). A feed runs only while
// the camera is near its area, below 400 km, in a visible tab. Vehicles report every few seconds; each is drawn a little
// behind live, between two real reports, so dots glide instead of hopping. The feeds, their loops and the fleet are
// shared with the 2D map (core/transitfeeds.js); the motion model is core/transit.js.
import { C, esc } from './env.js';
import { scene, camera, camHeight } from './viewer.js';
import { Terrain } from './terrain.js';
import { setCount } from './layers.js';
import { state } from './state.js';
import { TRANSIT_MODES, transitSources, sourcesAt, startSource, stopSource, createFleet, transitTip, transitRows } from '../core/transitfeeds.js';

const MAX_H = 400e3;   // above this the dots are sub-pixel specks: no feeds at all
const COLOR = Object.fromEntries(Object.entries(TRANSIT_MODES).map(([k, [, c]]) => [k, C.Color.fromCssColorString(c)]));
const OUTLINE = C.Color.BLACK.withAlpha(0.55), SCALE = new C.NearFarScalar(2e3, 1.4, 4e5, 0.5);
const pts = scene.primitives.add(new C.PointPrimitiveCollection());
pts.show = false;
const pos = new C.Cartesian3();
const SOURCES = transitSources();

const Proto = {
  tip() { return transitTip(this); },
  cardHtml() {
    const i = this.info, [m, c] = TRANSIT_MODES[i.mode] || ['Vehicle', '#fff'];
    return `<div class="k" style="--c:${c}">${esc(m)} · ${esc(this.src.name)}</div><h2>${esc(i.line || m)}${i.dest ? ' → ' + esc(i.dest) : ''}</h2><dl>`
      + transitRows(this, fleet.age(this)).map(([k, v]) => `<dt>${esc(k)}</dt><dd${k === 'Last report' ? ' data-tr-age' : ''}>${esc(v)}</dd>`).join('') + '</dl>'
      + `<div class="note" style="margin-top:8px">Drawn about ${Math.round(this.delay / 1000)} s behind live, moving between its real reports. ${esc(this.src.credit)}</div>`;
  },
  afterCard(card) {   // keep "last report" ticking while this card is open
    const id = setInterval(() => {
      const el = card.querySelector('[data-tr-age]');
      if (!el || state.selected !== this || !card.classList.contains('show')) return clearInterval(id);
      el.textContent = Math.max(0, Math.round(fleet.age(this))) + ' s ago';
    }, 1000);
  },
};
const fleet = createFleet({
  add(v) {
    Object.setPrototypeOf(v, Proto);
    v.gh = 0; v.gLat = 99; v.gLon = 0; v.gOn = null; v.gx = false;   // ground height under it (terrain), where it was read, exact yet
    v.pt = pts.add({ position: C.Cartesian3.fromDegrees(v.lon, v.lat, 4), pixelSize: 6, color: COLOR[v.info.mode] || COLOR.bus, outlineColor: OUTLINE, outlineWidth: 1, scaleByDistance: SCALE, id: v });
  },
  drop(v) { pts.remove(v.pt); },
});
const vehicles = fleet.vehicles;
const count = () => setCount('transit', vehicles.size);

/** Place a vehicle's dot: the ground under it is read again every ~50 m (and when the terrain is switched). */
function place(v) {
  if (v.gOn !== Terrain.on || !v.gx || Math.abs(v.lat - v.gLat) + Math.abs(v.lon - v.gLon) > 5e-4) {
    v.gh = Terrain.near(v.lat, v.lon, 4); v.gx = Terrain.exact; v.gLat = v.lat; v.gLon = v.lon; v.gOn = Terrain.on;
  }
  v.pt.position = C.Cartesian3.fromDegrees(v.lon, v.lat, v.gh + 4, undefined, pos);
}
function view() {
  const c = camera.positionCartographic;
  return { lat: C.Math.toDegrees(c.latitude), lon: C.Math.toDegrees(c.longitude), height: c.height };
}
function start(s) {
  startSource(s, { view, onFixes: fixes => { fleet.ingest(s, fixes, !!s.every); if (s.every) count(); }, onError: e => console.warn('transit', s.name, e.message) });
}
function stop(s) { if (stopSource(s)) { fleet.dropSource(s); count(); } }

/** Which feeds should run: layer on, tab visible, camera under 400 km and over (or within 150 km of) the area. */
function evaluate() {
  const c = camera.positionCartographic;
  const want = Transit.layer.on && !document.hidden && c && c.height < MAX_H ? sourcesAt(C.Math.toDegrees(c.latitude), C.Math.toDegrees(c.longitude)) : new Set();
  for (const s of Object.values(SOURCES)) want.has(s.id) ? start(s) : stop(s);
}
document.addEventListener('visibilitychange', evaluate);

let lastCheck = 0, lastMove = 0;
export const Transit = {
  layer: { id: 'transit', group: 'Earth', name: 'Live transit (Boston · Helsinki · Norway · Austin · Minneapolis)', color: '#3ee08f', on: false },
  vehicles, sources: SOURCES,
  /** Show or hide; starts or stops the feeds (nothing is fetched while off). */
  apply(on = this.layer.on) {
    this.layer.on = on; pts.show = on;
    if (!on) { for (const s of Object.values(SOURCES)) stopSource(s); fleet.clear(); count(); }
    else evaluate();
  },
  /** Before each render: which feeds to run (once a second) and where every vehicle is now. */
  update(now = Date.now()) {
    if (!this.layer.on) return;
    if (now - lastCheck > 1000) { lastCheck = now; evaluate(); fleet.prune(now); count(); }
    if (!vehicles.size) { lastMove = now; return; }
    if (camHeight() > 80e3 && now - lastMove < 250) return;   // from high up 4 moves a second look the same
    const dt = lastMove ? Math.min(now - lastMove, 1000) : 0;
    lastMove = now;
    for (const v of vehicles.values()) if (fleet.step(v, now, dt) || v.gOn !== Terrain.on) place(v);
  },
  /** For the console and tests: vehicles per area and mode. */
  stats: () => fleet.stats(),
};
