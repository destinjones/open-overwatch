// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Export what's in view" in the layer dock: pick a live layer that is on, save its items inside the view as GeoJSON, CSV
// or KML, each with its provenance (who reported it, how many agree, how old the data is). Rows: core/export.js; the
// button row and the download: app/save.js. Items come from each layer's own module; nothing is fetched.
import { C, esc, toast } from './env.js';
import { camera, scene } from './viewer.js';
import { L } from './layers.js';
import { hooks } from './state.js';
import { Air } from './aircraft.js';
import { Sats } from './satellites.js';
import { Quakes } from './quakes.js';
import { Events } from './events.js';
import { Storms } from './storms.js';
import { Fires } from './fires.js';
import { Bikes } from './bikes.js';
import { Transit } from './transit.js';
import { Cams } from './cams.js';
import { Ships } from './ships.js';
import { Buoys, Darts, Tides } from './ocean.js';
import { Radio } from './radio.js';
import { Launches } from './launches.js';
import { Alpr } from './alpr.js';
import { Military } from './military.js';
import { Surveil } from './surveil.js';
import { exportRow } from '../app/save.js';

const sat = id => () => Sats.list.filter(s => s.layer === id && !s.gone).map(s => {
  const i = Sats.info(s); return { id: s.id, name: s.name, lat: i.lat, lon: i.lon, alt_km: Math.round(i.alt), group: s.group, prov: s.prov };
});
/** Layer id → () => its live items (objects with lat/lon and a provenance stamp). */
const SOURCES = {
  air: () => [...Air.map.values()].filter(r => !r.mil),
  mil: () => [...Air.map.values()].filter(r => r.mil),
  quakes: () => Quakes.list, events: () => Events.list, storms: () => Storms.list,
  fires: () => [...Fires.detections, ...Fires.perimeters],
  bikes: () => [...Bikes.nets.values()].flatMap(e => e.stations || []),
  transit: () => [...Transit.vehicles.values()], cams: () => Cams.list, ships: () => [...Ships.ships.values()],
  buoys: () => Buoys.list, dart: () => Darts.list, tides: () => Tides.list, radio: () => Radio.list, launches: () => Launches.list,
  alpr: () => Alpr.list, milareas: () => Military.list, cctv: () => Surveil.list,
  ...Object.fromEntries(['stations', 'visual', 'gnss', 'geo', 'weather', 'starlink', 'active', 'debris'].map(id => [id, sat(id)])),
};

/** The view as [w, s, e, n] degrees (whole Earth when the camera sees past the limb). */
function viewBox() {
  const r = camera.computeViewRectangle(scene.globe.ellipsoid);
  return r ? [r.west, r.south, r.east, r.north].map(C.Math.toDegrees) : [-180, -90, 180, 90];
}
const inBox = ([w, s, e, n]) => o => o && Number.isFinite(o.lat) && Number.isFinite(o.lon) && o.lat >= s && o.lat <= n && (w <= e ? o.lon >= w && o.lon <= e : o.lon >= w || o.lon <= e);

let chosen = '';
hooks.renderExport = el => {
  if (!el) return;
  const ids = Object.keys(SOURCES).filter(id => L[id]);   // all of them: the dock isn't redrawn when a layer is switched
  if (!chosen) chosen = ids.find(id => L[id].on) || ids[0];
  el.innerHTML = `<h3>Export what's in view</h3><select id="expLayer" aria-label="Layer to export" style="width:100%;margin:2px 0 4px;background:rgba(5,8,12,.6);color:var(--ink);border:1px solid var(--edge-dim);border-radius:8px;padding:5px 6px;font:500 12px/1 var(--mono);color-scheme:dark">${
    ids.map(id => `<option value="${esc(id)}"${id === chosen ? ' selected' : ''}>${esc(L[id].name)}</option>`).join('')}</select>`;
  const sel = el.querySelector('#expLayer');
  sel.addEventListener('change', () => { chosen = sel.value; });
  sel.addEventListener('click', e => e.stopPropagation());
  el.appendChild(exportRow(() => (SOURCES[chosen] && L[chosen].on ? SOURCES[chosen]().filter(inBox(viewBox())) : []), () => L[chosen]?.name || chosen, msg => toast(msg)));
};
