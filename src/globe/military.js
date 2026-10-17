// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Military areas: land that OpenStreetMap volunteers have mapped as military (landuse=military: bases, ranges, depots,
// barracks), outlined on the ground below ~400 km, from OpenFreeMap's vector tiles (z9-12: the closer, the finer) rather
// than the Overpass API. The tiles carry no names for military land, so an area is named after the military airfields
// inside it when it has any, and otherwise says which town it is near; opening its card asks OpenStreetMap for its
// real name (one small query through the shared, polite Overpass queue, only on that click). Shapes are clipped to their tiles and joined
// across tile edges (core/osmtiles.js); the outline skips the seams. © OpenMapTiles, © OpenStreetMap contributors.
import { C, esc, PHONE } from './env.js';
import { rep, provStamp } from '../core/liveprov.js';
import { viewer, scene, camera, camAGL } from './viewer.js';
import { L, setCount } from './layers.js';
import { state } from './state.js';
import { vtile, OFM } from './vtiles.js';
import { overpass } from '../core/overpass.js';
import { tileMilitary, joinPieces, describeArea, areaWords, pickZoom } from '../core/osmtiles.js';

const COLOR = '#ff6b5e', MAX_H = 4e5, ZOOMS = [12, 11, 10, 9], MAX_TILES = PHONE ? 9 : 16, KEEP = PHONE ? 24 : 48, WANT = ['landuse', 'aerodrome_label', 'place'];
const BOTH = C.ClassificationType.BOTH, ALWAYS = Number.POSITIVE_INFINITY;
const FILL = C.Color.fromCssColorString(COLOR).withAlpha(0.13), EDGE = C.Color.fromCssColorString(COLOR).withAlpha(0.9);
const labels = scene.primitives.add(new C.LabelCollection({ scene }));
const pins = scene.primitives.add(new C.BillboardCollection({ scene }));   // billboards, not points: they can sit on the terrain
const DOT = (() => { const cv = document.createElement('canvas'), r = PHONE ? 9 : 7; cv.width = cv.height = r * 2 + 4; const g = cv.getContext('2d');
  g.beginPath(); g.arc(r + 2, r + 2, r, 0, Math.PI * 2); g.fillStyle = COLOR; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
  g.beginPath(); g.moveTo(r + 2 - r * 0.5, r + 2); g.lineTo(r + 2 + r * 0.5, r + 2); g.moveTo(r + 2, r + 2 - r * 0.5); g.lineTo(r + 2, r + 2 + r * 0.5); g.strokeStyle = '#2a0f0c'; g.lineWidth = 1.6; g.stroke();
  return cv; })();
const tiles = new Map();   // 'z/x/y' -> { data, used, fill, line } | { loading } | { failed }
let shown = [], sig = '', areas = [], credited = false, timer = 0, failures = 0;
const looked = new Map();   // '<lat>,<lon>' (3 decimals) -> Promise of { name, operator, kind, osm } | null: names asked for on a click

function primsFor(t) {   // a tile's fill and outline, made once (Cesium builds them in workers)
  if (t.fill !== undefined) return;
  const polys = t.data.pieces.flatMap(p => p.polys), runs = t.data.pieces.flatMap(p => p.runs);
  t.fill = polys.length ? scene.primitives.add(new C.GroundPrimitive({ classificationType: BOTH, asynchronous: true, show: false,
    geometryInstances: polys.map(p => new C.GeometryInstance({ geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(p.outer), p.holes.map(h => new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(h)))) }),
      attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(FILL) } })),
    appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }) })) : null;
  t.line = runs.length ? scene.primitives.add(new C.GroundPolylinePrimitive({ classificationType: BOTH, asynchronous: true, show: false,
    geometryInstances: runs.map(r => new C.GeometryInstance({ geometry: new C.GroundPolylineGeometry({ positions: C.Cartesian3.fromDegreesArray(r), width: PHONE ? 2.5 : 2 }),
      attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(EDGE) } })),
    appearance: new C.PolylineColorAppearance() })) : null;
}
function dropPrims(t) { if (t.fill) scene.primitives.remove(t.fill); if (t.line) scene.primitives.remove(t.line); t.fill = t.line = undefined; }

const AreaProto = {
  kind: 'milarea',
  get prov() { return provStamp('osm', [rep('osm', { name: 'OpenStreetMap via OpenFreeMap tiles' })]); },
  tip() { return `${this.name || 'Military area'} · ${this.open ? 'at least ' : ''}${areaWords(this.area)}${this.near ? ' · near ' + this.near.name : ''}`; },
  cardHtml() {
    const at = `${this.lat.toFixed(4)}, ${this.lon.toFixed(4)}`;
    return `<div class="k" style="--c:${COLOR}">Military area · mapped in OpenStreetMap</div><h2>${esc(this.name || 'Military area')}</h2><dl>`
      + `<dt>Size</dt><dd>${this.open ? 'at least ' : ''}${esc(areaWords(this.area))}${this.open ? ' (it runs on past what is loaded: zoom out for all of it)' : ''}</dd>`
      + (this.fields.length ? `<dt>Airfields</dt><dd>${this.fields.map(esc).join(', ')}</dd>` : '')
      + (this.near ? `<dt>Near</dt><dd>${esc(this.near.name)} (${this.near.km < 1 ? 'under 1' : Math.round(this.near.km)} km)</dd>` : '')
      + `<dt>Position</dt><dd>${at}</dd>`
      + `<dt>Mapped as</dt><dd data-mil-osm>${this.osm ? esc(this.osm) : this.osm === null ? 'not found' : 'asking OpenStreetMap…'}</dd>`
      + `</dl><div class="acts"><a class="chipbtn" href="https://www.openstreetmap.org/query?lat=${this.lat.toFixed(5)}&amp;lon=${this.lon.toFixed(5)}#map=14/${this.lat.toFixed(5)}/${this.lon.toFixed(5)}" target="_blank" rel="noopener">What's here on OpenStreetMap</a></div>`
      + `<div class="note" style="margin-top:8px">Land volunteers have mapped as military (landuse=military): bases, ranges, depots, barracks. The outline is as mapped: it can be out of date, and some countries' sites are not mapped at all. The map tiles carry no names for this land, so ${this.fields.length ? 'the name is the military airfield inside it' : this.osmName ? 'its name was asked of OpenStreetMap when you opened this card (it may be the larger area this part lies in)' : 'it is named by the town nearby until OpenStreetMap answers'}. From OpenFreeMap's tiles: © OpenMapTiles, © OpenStreetMap contributors (ODbL).</div>`;
  },
  /** The tiles have no name for it: ask OpenStreetMap once, for this click only, what encloses the point. */
  afterCard(card) {
    if (this.osm !== undefined) return;
    const k = this.lat.toFixed(3) + ',' + this.lon.toFixed(3);
    if (!looked.has(k)) looked.set(k, lookUp(this.lat, this.lon).catch(e => { console.warn('military name', e.message); looked.delete(k); return undefined; }));
    looked.get(k).then(r => {
      if (r === undefined) return;
      this.osm = r ? [r.kind, r.operator && 'run by ' + r.operator].filter(Boolean).join(', ') || 'military land' : null;
      if (r?.name && !this.name) { this.name = r.name; this.osmName = true; this.label.text = r.name; }
      if (state.selected === this && card.classList.contains('show')) { const h = card.querySelector('h2'), dd = card.querySelector('[data-mil-osm]'); if (h && r?.name) h.textContent = r.name; if (dd) dd.textContent = this.osm || 'not found'; }
      scene.requestRender();
    });
  },
};
const KIND = { base: 'a base', airfield: 'an airfield', range: 'a range', training_area: 'a training area', barracks: 'barracks', naval_base: 'a naval base', danger_area: 'a danger area', checkpoint: 'a checkpoint', bunker: 'a bunker', office: 'an office', depot: 'a depot' };
/** The military land around a point, from OpenStreetMap: the smallest named one wins. */
async function lookUp(lat, lon) {
  const q = `[out:json][timeout:15];is_in(${lat.toFixed(5)},${lon.toFixed(5)})->.a;(way(pivot.a)["landuse"="military"];relation(pivot.a)["landuse"="military"];way(pivot.a)["military"];relation(pivot.a)["military"];);out tags 12;`;
  const els = (await overpass(q, { timeout: 20000 })).elements || [];
  const named = els.filter(e => e.tags?.name), e = named[named.length - 1] || els[0];   // is_in lists outer areas first
  if (!e) return null;
  const t = e.tags || {};
  return { name: t['name:en'] || t.name || null, operator: t.operator || null, kind: KIND[t.military] || (t.military ? t.military.replace(/_/g, ' ') : null) };
}

function rebuild() {   // the areas made of the tiles shown, their labels and pins
  labels.removeAll(); pins.removeAll(); areas = [];
  const ds = shown.map(k => tiles.get(k).data), fields = ds.flatMap(d => d.fields), places = ds.flatMap(d => d.places);
  for (const g of joinPieces(ds.flatMap(d => d.pieces))) {
    const d = describeArea(g, fields, places), o = Object.assign(Object.create(AreaProto), { name: d.name, fields: d.fields, near: d.near, area: g.area, open: g.open, lat: d.at.lat, lon: d.at.lon });
    const far = Math.max(12e3, Math.sqrt(g.area) * (d.name ? 9 : 5)), pos = C.Cartesian3.fromDegrees(o.lon, o.lat);
    o.pin = pins.add({ position: pos, image: DOT, id: o, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: ALWAYS,
      distanceDisplayCondition: new C.DistanceDisplayCondition(0, far * 2) });
    o.label = labels.add({ position: pos, text: d.name || 'Military area', font: '600 12px IBM Plex Mono, monospace', fillColor: C.Color.fromCssColorString('#ffd7d2'), outlineColor: C.Color.BLACK, outlineWidth: 3,
      style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -14), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: ALWAYS, id: o,
      distanceDisplayCondition: new C.DistanceDisplayCondition(0, far) });
    areas.push(o);
  }
  setCount('milareas', areas.length);
}

function load(key) {
  tiles.set(key, { loading: true });
  const [z, x, y] = key.split('/').map(Number);
  vtile(OFM, key, WANT).then(dec => {
    tiles.set(key, { data: tileMilitary(dec, z, x, y), used: Date.now() }); failures = 0;
    if (!credited) { credited = true; viewer.creditDisplay.addStaticCredit(new C.Credit('Military areas: <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>, data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors')); }
    tick();
  }, e => { tiles.set(key, { failed: Date.now() }); failures++; console.warn('military areas', e.message); });
}

function hideAll() { for (const t of tiles.values()) { if (t.fill) t.fill.show = false; if (t.line) t.line.show = false; } labels.show = pins.show = false; scene.requestRender(); }

function tick() {
  if (!L.milareas.on || state.lookup) { hideAll(); return; }
  const agl = camAGL();
  if (agl > MAX_H) { hideAll(); setCount('milareas', 0); return; }
  const c = camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), C.Ellipsoid.WGS84) || camera.positionWC;
  const g = C.Cartographic.fromCartesian(c), lat = C.Math.toDegrees(g.latitude), lon = C.Math.toDegrees(g.longitude);
  const pick = pickZoom(lat, lon, Math.min(2.5e5, Math.max(6e3, agl * 1.3)), ZOOMS, MAX_TILES) || pickZoom(lat, lon, 1e5, [9], MAX_TILES * 2);
  if (!pick) { hideAll(); return; }
  let busy = 0;
  for (const k of pick.tiles) {
    const t = tiles.get(k);
    if (t?.loading) busy++;
    else if ((!t || (t.failed && Date.now() - t.failed > 60e3 * Math.min(10, failures))) && busy < 3) { load(k); busy++; }
  }
  const ready = pick.tiles.filter(k => tiles.get(k)?.data);
  const now = Date.now(); for (const k of ready) tiles.get(k).used = now;
  const s = ready.join(' ');
  if (s !== sig) {   // which tiles are drawn changed
    sig = s; shown = ready;
    const on = new Set(ready);
    for (const [k, t] of tiles) { if (on.has(k)) primsFor(t); if (t.fill) t.fill.show = on.has(k); if (t.line) t.line.show = on.has(k); }
    rebuild();
    // forget the tiles least recently wanted
    const old = [...tiles].filter(([k, t]) => t.data && !on.has(k)).sort((a, b) => a[1].used - b[1].used);
    for (const [k, t] of old.slice(0, Math.max(0, tiles.size - KEEP))) { dropPrims(t); tiles.delete(k); }
  }
  labels.show = pins.show = true;
  for (const k of shown) { const t = tiles.get(k); if (t?.fill) t.fill.show = true; if (t?.line) t.line.show = true; }
  scene.requestRender();
}

export const Military = {
  get list() { return areas; },
  /** Show or hide (off: nothing is fetched). */
  apply() {
    if (L.milareas.on && !timer) timer = setInterval(tick, 1200);
    else if (!L.milareas.on && timer) { clearInterval(timer); timer = 0; setCount('milareas', 0); }
    tick();
  },
};
