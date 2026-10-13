// Draw and measure on the 2D map, as on the 3D globe: lines, areas, distance arrows (with the same trip by road, OSRM) and
// pins, up to 512 points, each leg and the total measured over the WGS84 ellipsoid and areas on it (core/measure.js:
// within a millimetre of GeographicLib). Lines are drawn as the real shortest paths (curved on a Mercator map), not
// straight map lines. The drawing goes into share links (&d=, the globe's format) and out as GeoJSON. The R key, the
// ruler button, or Escape to put the tool down. Nothing leaves the browser except a "by road" request's two ends (OSRM).
import { $, esc, Store, toast, PHONE, late } from './util.js';
import { map } from './mapview.js';
import { inverse, midpoint, pathLength, polygonArea, multiPolygonArea, centre, selfCrossing, densify, lengthText, areaText, bearingText, toGeoJSON, MAX_POINTS } from '../core/measure.js';
import { fetchRoute, durationText } from '../core/route.js';
import { toMgrs } from '../core/mgrs.js';

const GOLD = '#ffd45c', ROAD = '#7dffa6';
const TOOLS = { line: 'Line', area: 'Area', arrow: 'Distance', pin: 'Pin' }, KIND = { ...TOOLS, outline: 'Country outline' };
const HINT = {
  line: 'Click to add points. Double-click, Enter or Finish ends the line; Backspace takes a point back.',
  area: 'Click the corners. Click the first one again, double-click or press Enter to close it.',
  arrow: 'Click a start, then an end: the shortest path between them, its length and its bearing.',
  pin: 'Click to drop pins: each gets its coordinates and a grid reference.',
};
const group = L.layerGroup().addTo(map);
let imperial = Store.get('ms_imperial', /^en-(us|lr)$|^my\b/i.test(navigator.language || ''));
const len = m => lengthText(m, imperial), area = m2 => areaText(m2, imperial);
const both = m => `${lengthText(m, imperial)} · ${lengthText(m, !imperial)}`;
const where = ([lon, lat]) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
let seq = 0;
const newShape = (kind, name) => ({ id: ++seq, kind, name: name || `${KIND[kind]} ${seq}`, coords: [], done: false, layers: [] });

/** Longitudes made continuous along a path (so a line across the date line doesn't jump back across the map). */
function unwrap(path, ref = null) {
  const out = []; let prev = ref;
  for (const [lon, lat] of path) { let x = lon; if (prev != null) x = prev + ((((lon - prev) % 360) + 540) % 360 - 180); out.push([lat, x]); prev = x; }
  return out;
}
/** The shortest path through some points, as Leaflet lat/lngs: each leg split every 25 km so it curves as it should. */
function geodesic(coords, closed = false) {
  const pts = closed ? [...coords, coords[0]] : coords, out = [];
  for (let i = 1; i < pts.length; i++) { const seg = densify(pts[i - 1], pts[i], 25e3); out.push(...(i > 1 ? seg.slice(1) : seg)); }
  return unwrap(out.length ? out : pts, map.getCenter().lng);
}
const tag = (latlng, html, cls = '') => L.marker(latlng, { interactive: true, keyboard: false, icon: L.divIcon({ className: 'ms-tag ' + cls, html, iconSize: null }) });
const near = (lon, ref) => ref + ((((lon - ref) % 360) + 540) % 360 - 180);

/** What a shape measures, in words for the card: [main, detail]. */
function readout(sh) {
  if (sh.kind === 'pin') return sh.coords.length ? [where(sh.coords[0]), 'MGRS ' + toMgrs(sh.coords[0][1], sh.coords[0][0])] : ['', ''];
  if (sh.kind === 'outline') return [area(sh.area || 0), `${sh.parts || 1} part${sh.parts === 1 ? '' : 's'}, from the bundled borders`];
  if (sh.kind === 'area') {
    if (sh.coords.length < 3) return [`${sh.coords.length} corner${sh.coords.length === 1 ? '' : 's'}`, 'at least three'];
    const m = polygonArea(sh.coords), x = selfCrossing(sh.coords) >= 0;
    return [`${area(m.area)} · ${areaText(m.area, !imperial)}`, `${len(m.perimeter)} around · ${sh.coords.length} corners${x ? ' · it crosses itself: its loops count against each other' : ''}`];
  }
  if (sh.coords.length < 2) return [sh.coords.length ? '1 point' : '', ''];
  const p = pathLength(sh.coords);
  if (sh.kind === 'arrow') {
    const g = p.legs[0], road = sh.road && sh.road.coords ? ` · by road ${len(sh.road.distance)}, ${durationText(sh.road.duration)}` : sh.road === 'asking' ? ' · asking for the road…' : '';
    return [both(p.total), `heading ${bearingText(g.az1)}, arriving ${bearingText(g.az2)}${road}`];
  }
  return [both(p.total), `${p.legs.length} leg${p.legs.length === 1 ? '' : 's'}${p.legs.length > 1 ? ', longest ' + len(Math.max(...p.legs.map(l => l.s))) : ''}`];
}

/** (Re)draw one shape: its line or area, corners, labels, arrowhead, road. */
function draw(sh) {
  for (const l of sh.layers) group.removeLayer(l); sh.layers = [];
  const add = l => { l.addTo(group); sh.layers.push(l); l.on('click', e => { L.DomEvent.stopPropagation(e); if (!Measure.tool) Measure.select(sh); }); return l; };
  const c = sh.coords, ref = map.getCenter().lng, sel = Measure.sel === sh;
  if (sh.kind === 'outline') {
    for (const rings of sh.poly) add(L.polygon(rings.map(r => unwrap(r, ref)), { color: GOLD, weight: sel ? 3 : 2, fillColor: GOLD, fillOpacity: .12 }));
    const [lon, lat] = centre(sh.poly[0][0]); add(tag([lat, near(lon, ref)], `${esc(sh.name)}<b>${esc(area(sh.area))}</b>`)); return;
  }
  if (sh.kind === 'pin') {
    if (!c.length) return;
    const [lon, lat] = c[0];
    add(L.marker([lat, near(lon, ref)], { icon: L.divIcon({ className: 'ms-pin', html: '<svg width="22" height="30" viewBox="0 0 26 36"><path d="M13 34.5S2.5 21.6 2.5 13a10.5 10.5 0 0 1 21 0c0 8.6-10.5 21.5-10.5 21.5z" fill="#ffd45c" stroke="#080c12" stroke-width="2"/><circle cx="13" cy="13" r="4" fill="#080c12"/></svg>', iconSize: [22, 30], iconAnchor: [11, 29] }) }));
    add(tag([lat, near(lon, ref)], `${esc(sh.custom ? sh.name : '')}${sh.custom ? '<br>' : ''}${esc(where(c[0]))}`, 'ms-up'));
    return;
  }
  if (c.length >= 2) {   // an area's closing side is a shortest path too
    if (sh.kind === 'area' && c.length >= 3) add(L.polygon(geodesic(c, true), { color: GOLD, weight: sel ? 3 : 2, fillColor: GOLD, fillOpacity: .14 }));
    else add(L.polyline(geodesic(c), { color: GOLD, weight: sel ? 4 : 3, opacity: .95 }));
  }
  if (sh.road && sh.road.coords) add(L.polyline(unwrap(sh.road.coords, ref), { color: ROAD, weight: 3, opacity: .9, dashArray: '2 6' }));
  // corners (the first one closes an area)
  c.forEach(([lon, lat], i) => add(L.circleMarker([lat, near(lon, ref)], { radius: i === 0 && sh.kind === 'area' && !sh.done ? 6 : 4, color: '#080c12', weight: 2, fillColor: GOLD, fillOpacity: 1 })).on('click', e => {
    if (Measure.tool && Measure.cur === sh && i === 0 && sh.kind === 'area' && c.length >= 3) { L.DomEvent.stopPropagation(e); Measure.finish(); }
  }));
  // labels: each leg of a line, the total at the end; an area's size in its middle; a distance's length and bearing
  if (sh.kind === 'line' && c.length >= 2) {
    const p = pathLength(c);
    if (c.length > 2 && p.legs.length <= 24) p.legs.forEach((g, i) => { const [lon, lat] = midpoint(c[i], c[i + 1]); add(tag([lat, near(lon, ref)], esc(len(g.s)), 'ms-leg')); });
    const [lon, lat] = c[c.length - 1]; add(tag([lat, near(lon, ref)], `<b>${esc(len(p.total))}</b>`, 'ms-up'));
  } else if (sh.kind === 'area' && c.length >= 3) {
    const [lon, lat] = centre(c); add(tag([lat, near(lon, ref)], `<b>${esc(area(polygonArea(c).area))}</b>`));
  } else if (sh.kind === 'arrow' && c.length === 2) {
    const g = inverse(c[0][1], c[0][0], c[1][1], c[1][0]), [lon, lat] = midpoint(c[0], c[1]), [elon, elat] = c[1];
    add(tag([lat, near(lon, ref)], `<b>${esc(len(g.s))}</b> ${esc(bearingText(g.az1))}`));
    add(L.marker([elat, near(elon, ref)], { interactive: false, icon: L.divIcon({ className: 'ms-head', html: `<svg width="22" height="26" viewBox="0 0 22 26" style="transform:rotate(${g.az2.toFixed(1)}deg)"><path d="M11 1.5 20.5 24.5 11 18.5 1.5 24.5z" fill="#ffd45c" stroke="#080c12" stroke-width="2" stroke-linejoin="round"/></svg>`, iconSize: [22, 26], iconAnchor: [11, 2] }) }));
  }
}
function redrawAll() { for (const s of Measure.shapes) draw(s); }

// ---- the rubber band to the pointer while placing points (mice)
const band = L.polyline([], { color: GOLD, weight: 2, opacity: .7, dashArray: '4 6', interactive: false }).addTo(group);
map.on('mousemove', e => {
  const sh = Measure.cur; if (!Measure.tool || !sh || !sh.coords.length || sh.kind === 'pin') { if (band.getLatLngs().length) band.setLatLngs([]); return; }
  const last = sh.coords[sh.coords.length - 1], to = [((e.latlng.lng + 540) % 360) - 180, e.latlng.lat];
  const pts = sh.kind === 'area' && sh.coords.length >= 2 ? [last, to, sh.coords[0]] : [last, to];
  band.setLatLngs(geodesic(pts));
  const g = inverse(last[1], last[0], to[1], to[0]); Measure.hover = g.s; Measure.paint(true);
});

// ---- clicks: a quick (under 0.45 s) second click on the last point is the double-click that finishes
let lastClick = { t: 0, x: 0, y: 0 };
function onClick(e) {
  if (!Measure.tool) return;
  const now = Date.now(), p = e.containerPoint, quick = now - lastClick.t < 450 && Math.hypot(p.x - lastClick.x, p.y - lastClick.y) < 8;
  lastClick = { t: now, x: p.x, y: p.y };
  if (quick && Measure.cur && Measure.tool !== 'pin') { Measure.finish(); return; }
  Measure.add([((e.latlng.lng + 540) % 360) - 180, e.latlng.lat]);
}
map.on('click', onClick);

export const Measure = {
  shapes: [], tool: null, cur: null, sel: null, hover: null, card: null,
  get armed() { return !!this.tool; },
  /** Open the card (and pick a tool). */
  open(tool) { this.ensureCard(); this.card.hidden = false; if (tool) this.arm(tool); this.paint(); },
  close() { this.disarm(); if (this.card) this.card.hidden = true; },
  toggle() { if (this.card && !this.card.hidden) this.close(); else this.open(); },
  arm(tool) {
    if (!TOOLS[tool]) return; this.finish(true); this.tool = tool; this.cur = null; map.doubleClickZoom.disable(); $('#map').classList.add('ms-armed'); this.paint();
  },
  disarm() { this.finish(true); this.tool = null; map.doubleClickZoom.enable(); $('#map').classList.remove('ms-armed'); band.setLatLngs([]); this.paint(); },
  points() { return this.shapes.reduce((n, s) => n + (s.kind === 'outline' ? 0 : s.coords.length), 0); },
  add(ll) {
    if (this.points() >= MAX_POINTS) { toast(`A drawing holds ${MAX_POINTS} points at most`); return; }
    if (this.tool === 'pin') { const sh = newShape('pin'); sh.coords = [ll]; sh.done = true; this.shapes.push(sh); this.sel = sh; draw(sh); this.paint(); return; }
    let sh = this.cur;
    if (!sh) { sh = this.cur = newShape(this.tool); this.shapes.push(sh); this.sel = sh; }
    sh.coords.push(ll); draw(sh);
    if (sh.kind === 'arrow' && sh.coords.length === 2) this.finish();
    this.paint();
  },
  /** End the shape in hand (an unfinished one too short to measure is dropped). quiet: no road request. */
  finish(quiet = false) {
    const sh = this.cur; this.cur = null; band.setLatLngs([]); this.hover = null;
    if (!sh) return;
    const min = sh.kind === 'area' ? 3 : 2;
    if (sh.coords.length < min) { this.remove(sh); return; }
    sh.done = true; draw(sh); this.paint();
    if (sh.kind === 'arrow' && !quiet && $('#msRoad')?.checked) this.road(sh);
  },
  async road(sh) {
    sh.road = 'asking'; this.paint();
    const [a, b] = sh.coords.map(([lon, lat]) => ({ lat, lon }));
    try { const r = await fetchRoute(a, b, 'drive'); sh.road = { coords: r.coords, distance: r.distance, duration: r.duration }; }
    catch (e) { sh.road = null; toast(e.noRoute ? 'No road between those two points' : 'The route service did not answer: ' + e.message); }
    if (this.shapes.includes(sh)) { draw(sh); this.paint(); }
  },
  undo() {
    const sh = this.cur || this.shapes[this.shapes.length - 1]; if (!sh) return false;
    if (sh.kind === 'pin' || sh.kind === 'outline') { this.remove(sh); return true; }
    if (!this.cur) { if (this.tool !== sh.kind) this.arm(sh.kind); this.cur = sh; sh.done = false; }   // reopen the last shape
    sh.coords.pop(); sh.road = null; if (!sh.coords.length) { this.remove(sh); this.cur = null; } else draw(sh);
    this.paint(); return true;
  },
  remove(sh) { for (const l of sh.layers) group.removeLayer(l); this.shapes = this.shapes.filter(s => s !== sh); if (this.cur === sh) this.cur = null; if (this.sel === sh) this.sel = null; this.paint(); },
  clear() { for (const s of [...this.shapes]) this.remove(s); this.cur = null; this.paint(); },
  select(sh) { this.sel = sh; this.open(); redrawAll(); },
  fly(sh) {
    const pts = sh.kind === 'outline' ? sh.poly.flat(2) : sh.coords, ref = map.getCenter().lng;
    if (pts.length === 1) map.flyTo([pts[0][1], near(pts[0][0], ref)], Math.max(map.getZoom(), 12), { duration: .8 });
    else map.flyToBounds(L.latLngBounds(pts.map(([lon, lat]) => [lat, near(lon, ref)])), { padding: [60, 60], duration: .8, maxZoom: 15 });
  },
  /** The drawing for a share link (core/measure.js encodeDrawing's input). */
  exportShapes() {
    return this.shapes.filter(s => s.kind === 'outline' || s.coords.length >= (s.kind === 'area' ? 3 : s.kind === 'pin' ? 1 : 2))
      .map(s => s.kind === 'outline' ? { kind: 'outline', iso: s.iso } : { kind: s.kind, coords: s.coords, ...(s.custom ? { name: s.name } : {}), ...(s.road ? { road: true } : {}) });
  },
  /** A link's drawing back on the map (decodeDrawing's output: already checked). */
  async importShapes(list) {
    for (const s of list) {
      if (s.kind === 'outline') { await this.outline(s.iso).catch(() => null); continue; }
      const sh = newShape(s.kind, s.name); if (s.name) sh.custom = true; sh.coords = s.coords.map(c => [c[0], c[1]]); sh.done = true; this.shapes.push(sh); draw(sh);
      if (s.road) this.road(sh);
    }
    this.paint();
  },
  /** A country's outline and area, from the bundled borders (the globe's file). */
  async outline(iso) {
    const borders = await (this._borders ||= fetch('data/borders.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(e => { this._borders = null; throw e; }));
    const b = borders.find(x => x.iso === iso); if (!b) return null;
    const sh = newShape('outline', b.name); sh.iso = b.iso; sh.poly = b.poly; sh.done = true; const m = multiPolygonArea(b.poly); sh.area = m.area; sh.parts = m.parts;
    this.shapes.push(sh); draw(sh); this.paint(); return sh;
  },
  geojson() { return toGeoJSON(this.shapes.filter(s => s.kind === 'outline' || s.coords.length >= (s.kind === 'area' ? 3 : s.kind === 'pin' ? 1 : 2)).map(s => ({ ...s, road: s.road && s.road.coords ? s.road : null }))); },

  // ---- the card
  ensureCard() {
    if (this.card) return;
    const el = this.card = document.createElement('div'); el.id = 'msCard'; el.className = 'ms-card'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Draw and measure');
    L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
    $('#mapwrap').appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-ms]'); if (!b) return; const a = b.dataset.ms, sh = this.shapes.find(s => s.id === +b.dataset.id);
      if (TOOLS[a]) this.tool === a ? this.disarm() : this.arm(a);
      else if (a === 'undo') this.undo(); else if (a === 'finish') this.finish(); else if (a === 'clear') { if (this.shapes.length) this.clear(); }
      else if (a === 'close') this.close(); else if (a === 'units') { imperial = !imperial; Store.set('ms_imperial', imperial); redrawAll(); this.paint(); }
      else if (a === 'geojson') this.copy(JSON.stringify(this.geojson(), null, 1), 'GeoJSON copied');
      else if (a === 'link') this.copy(late.Share ? late.Share.link() : location.href, 'Link copied: it opens this view with the drawing');
      else if (a === 'fly' && sh) { this.sel = sh; this.fly(sh); redrawAll(); this.paint(); }
      else if (a === 'del' && sh) this.remove(sh);
      else if (a === 'name' && sh) { const n = prompt('Name', sh.name); if (n != null && n.trim()) { sh.name = [...n.trim()].slice(0, 60).join(''); sh.custom = true; draw(sh); this.paint(); } }
    });
    el.addEventListener('submit', async e => {
      e.preventDefault(); const q = el.querySelector('#msCountry').value.trim().toLowerCase(); if (!q) return;
      const borders = await (this._borders ||= fetch('data/borders.json').then(r => r.json())).catch(() => []);
      const b = borders.find(x => x.name.toLowerCase() === q || x.iso.toLowerCase() === q) || borders.find(x => x.name.toLowerCase().startsWith(q));
      if (!b) { toast(`No country called "${q.slice(0, 40)}" in the bundled borders`); return; }
      const sh = this.shapes.find(s => s.iso === b.iso) || await this.outline(b.iso); this.sel = sh; this.fly(sh); el.querySelector('#msCountry').value = '';
    });
  },
  async copy(text, ok) { try { await navigator.clipboard.writeText(text); toast(ok); } catch (e) { prompt('Copy this:', text); } },
  paint(light = false) {
    const el = this.card; if (!el || el.hidden) return;
    el.classList.toggle('armed', !!this.tool);   // phones: a slimmer card while placing points (measure.css)
    const sh = this.cur || this.sel, [main, sub] = sh ? readout(sh) : ['', ''];
    const live = this.cur && this.hover != null ? `<div class="ms-dim">to the pointer: ${esc(len(this.hover))}</div>` : '';
    if (light) { const r = el.querySelector('.ms-read'); if (r) { r.innerHTML = this.readHtml(sh, main, sub) + live; return; } }
    const list = this.shapes.filter(s => s !== this.cur || s.coords.length);
    el.innerHTML = `<div class="ms-top"><b>Draw and measure</b><button class="ms-x" data-ms="close" title="Close (Esc)">✕</button></div>
      <div class="ms-tools">${Object.entries(TOOLS).map(([k, v]) => `<button data-ms="${k}" class="${this.tool === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="ms-hint">${this.tool ? esc(HINT[this.tool]) : 'Pick a tool, then click the map. Shortest paths over the WGS84 ellipsoid; areas on it.'}</div>
      ${this.tool === 'arrow' ? `<label class="ms-road"><input type="checkbox" id="msRoad" ${Store.get('ms_road', false) ? 'checked' : ''}> and by road (OSRM)</label>` : ''}
      <div class="ms-read">${this.readHtml(sh, main, sub)}${live}</div>
      <div class="ms-acts"><button data-ms="undo">Undo</button><button data-ms="finish" ${this.cur ? '' : 'disabled'}>Finish</button><button data-ms="units">${imperial ? 'mi' : 'km'}</button><button data-ms="clear" ${this.shapes.length ? '' : 'disabled'}>Clear</button></div>
      ${list.length ? `<ul class="ms-list">${list.map(s => `<li class="${s === this.sel ? 'on' : ''}"><button data-ms="fly" data-id="${s.id}" title="Show it">${esc(s.name)}<small>${esc(readout(s)[0])}</small></button><button data-ms="name" data-id="${s.id}" title="Rename">✎</button><button data-ms="del" data-id="${s.id}" title="Remove">✕</button></li>`).join('')}</ul>` : ''}
      <form class="ms-country"><input id="msCountry" placeholder="Outline a country…" aria-label="Outline a country"><button>Outline</button></form>
      <div class="ms-acts"><button data-ms="link" ${this.shapes.length ? '' : 'disabled'}>Copy link</button><button data-ms="geojson" ${this.shapes.length ? '' : 'disabled'}>GeoJSON</button></div>`;
    const road = el.querySelector('#msRoad'); if (road) road.onchange = () => Store.set('ms_road', road.checked);
  },
  readHtml(sh, main, sub) { return sh ? `<div class="ms-k">${esc(KIND[sh.kind])}${sh.custom ? ' · ' + esc(sh.name) : ''}</div><div class="ms-n">${esc(main)}</div><div class="ms-dim">${esc(sub)}</div>` : '<div class="ms-dim">Nothing drawn yet.</div>'; },
};
map.on('moveend', () => { if (Measure.shapes.some(s => Math.abs(map.getCenter().lng) > 120)) redrawAll(); });   // keep shapes on the copy of the world in view

// the ruler button under the zoom control
const Ctl = L.Control.extend({ options: { position: 'topleft' }, onAdd() {
  const d = L.DomUtil.create('div', 'leaflet-bar ms-ctl'), a = L.DomUtil.create('a', '', d);
  a.href = '#'; a.title = 'Draw and measure (R)'; a.setAttribute('role', 'button'); a.setAttribute('aria-label', 'Draw and measure');
  a.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/></svg>';
  L.DomEvent.on(a, 'click', e => { L.DomEvent.stop(e); Measure.toggle(); });
  return d;
} });
new Ctl().addTo(map);
document.addEventListener('keydown', e => {
  const t = e.target; if (t && t.matches && t.matches('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'r' || e.key === 'R') { Measure.toggle(); return; }
  if (!Measure.tool) return;
  if (e.key === 'Enter') { e.preventDefault(); Measure.finish(); }
  else if (e.key === 'Backspace') { e.preventDefault(); Measure.undo(); }
  else if (e.key === 'Escape') { if (Measure.cur) Measure.finish(); else Measure.disarm(); }
});
if (PHONE.matches) Measure.ensureCard();
late.Measure = Measure;
