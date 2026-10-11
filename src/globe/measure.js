// Draw and measure: pins, lines and areas on the globe (up to 512 points), distance arrows between two points (and the
// same trip by road, through the directions' OSRM client), and country outlines from the bundled borders. Everything is
// draped over whatever is drawn below it, the globe, 3D terrain or Google's 3D city (ClassificationType.BOTH:
// CESIUM_3D_TILE alone drew nothing without Google's tiles). The numbers come from core/measure.js: shortest paths over
// the WGS84 ellipsoid (Vincenty, within a millimetre) and areas on it (within 0.001%). Band → Measure, the M key, or by
// voice ("measure from Paris to Berlin", "outline France", "clear the drawing"). Nothing leaves the browser except
// place names for voice (Photon, like a typed search) and the two ends of a "by road" request (OSRM).
import { C, $, esc, toast, PHONE, store } from './env.js';
import { viewer, scene, camera, globe } from './viewer.js';
import { state, hooks } from './state.js';
import { release } from './follow.js';
import { Terrain } from './terrain.js';
import { Country } from './country.js';
import { moonPosition } from './earth.js';
import { Directions, fetchRoute } from './directions.js';
import { findPlaces } from './places.js';
import { inverse, midpoint, pathLength, polygonArea, multiPolygonArea, centre, selfCrossing, choosePair, groundProfile, lengthText, areaText, bearingText, bearingWords,
  lengthWords, areaWords, toGeoJSON, MAX_POINTS } from '../core/measure.js';
import { durationText, pointAt, measure as walkable } from '../core/route.js';
import { mainBox } from '../core/borders.js';
import { toMgrs } from '../core/mgrs.js';
import { courseAxis } from '../core/geo.js';

const COLOR = '#ffd45c', ROAD = '#7dffa6';
const IMPERIAL = /^en-(us|lr)$|^my\b/i.test(navigator.language || '');   // miles first where people use them (the same test as voice.js)
const gold = C.Color.fromCssColorString(COLOR), green = C.Color.fromCssColorString(ROAD), ink = C.Color.fromCssColorString('#080c12');
const BOTH = C.ClassificationType.BOTH, GROUND = C.HeightReference.CLAMP_TO_GROUND, ALWAYS = Number.POSITIVE_INFINITY;
const TOOLS = { line: 'Line', area: 'Area', arrow: 'Distance', pin: 'Pin' };
const KIND = { ...TOOLS, outline: 'Country outline' };
const HINT = {
  line: PHONE ? 'Tap the globe to add points, then Finish.' : 'Click to add points. Double-click, Enter or Finish ends the line; Backspace takes a point back.',
  area: PHONE ? 'Tap the corners; tap the first one again (or Finish) to close it.' : 'Click the corners. Click the first one again, double-click or press Enter to close it.',
  arrow: PHONE ? 'Tap a start, then an end.' : 'Click a start, then an end: the shortest path between them, its length and its bearing.',
  pin: PHONE ? 'Tap to drop pins.' : 'Click to drop pins: each gets its coordinates and a grid reference.',
};
// everyday names the borders file spells differently
const COUNTRY_ALIAS = { usa: 'US', us: 'US', 'u s': 'US', 'u s a': 'US', america: 'US', 'united states': 'US', uk: 'GB', 'u k': 'GB', britain: 'GB', 'great britain': 'GB',
  holland: 'NL', netherlands: 'NL', czechia: 'CZ', 'czech republic': 'CZ', burma: 'MM', 'south korea': 'KR', korea: 'KR', 'north korea': 'KP', uae: 'AE', 'u a e': 'AE',
  emirates: 'AE', 'ivory coast': 'CI', drc: 'CD', 'east timor': 'TL', swaziland: 'SZ', macedonia: 'MK', 'vatican': 'VA', russia: 'RU' };
// an arrowhead pointing up the image: turned along the arrival heading with alignedAxis (Cesium's arrow material draws no head on a draped line)
const HEAD = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="26" viewBox="0 0 22 26"><path d="M11 1.5 20.5 24.5 11 18.5 1.5 24.5z" fill="#ffd45c" stroke="#080c12" stroke-width="2" stroke-linejoin="round"/></svg>');
const PIN = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36"><path d="M13 34.5S2.5 21.6 2.5 13a10.5 10.5 0 0 1 21 0c0 8.6-10.5 21.5-10.5 21.5z" fill="#ffd45c" stroke="#080c12" stroke-width="2"/><circle cx="13" cy="13" r="4" fill="#080c12"/></svg>');

const ds = new C.CustomDataSource('measure');
viewer.dataSources.add(ds);
const cart = ([lon, lat], h = 0) => C.Cartesian3.fromDegrees(lon, lat, h);
const deg = C.Math.toDegrees;
const len = (m, alt = false) => lengthText(m, alt ? !IMPERIAL : IMPERIAL);   // the visitor's units, or the other ones
const area = (m2, alt = false) => areaText(m2, alt ? !IMPERIAL : IMPERIAL);
const both = m => `${len(m)} · ${len(m, true)}`, bothArea = m2 => `${area(m2)} · ${area(m2, true)}`;
const rise = m => IMPERIAL ? `${Math.round(m / 0.3048).toLocaleString('en-US')} ft` : `${Math.round(m).toLocaleString('en-US')} m`;
const where = ([lon, lat]) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
const whereWords = ([lon, lat]) => `${Math.abs(lat).toFixed(2)} ${lat >= 0 ? 'north' : 'south'}, ${Math.abs(lon).toFixed(2)} ${lon >= 0 ? 'east' : 'west'}`;
const LABEL = { font: '600 12px "IBM Plex Mono", ui-monospace, monospace', fillColor: C.Color.WHITE, showBackground: true, backgroundColor: ink.withAlpha(0.8),
  backgroundPadding: new C.Cartesian2(7, 4), verticalOrigin: C.VerticalOrigin.BOTTOM, pixelOffset: new C.Cartesian2(0, -12), heightReference: GROUND, disableDepthTestDistance: ALWAYS };
const VERTEX = { pixelSize: 8, color: gold, outlineColor: ink, outlineWidth: 2, heightReference: GROUND, disableDepthTestDistance: ALWAYS };

// ---- picking the ground under a click: Google's city (depth buffer), else the 3D terrain's drawn tiles, else the ellipsoid
function pickGround(win, precise = true) {
  let p = null;
  if (precise && state.photoreal) { try { p = scene.pickPosition(win) || null; } catch (e) { p = null; } }
  if (p) { const h = C.Cartographic.fromCartesian(p)?.height; if (!(Math.abs(h) < 2e4)) p = null; }   // the sky, or something far off the ground
  if (!p && Terrain.on && globe.show) { const ray = camera.getPickRay(win); p = (ray && globe.pick(ray, scene)) || null; }
  return p || camera.pickEllipsoid(win, C.Ellipsoid.WGS84) || null;
}

// ---- shapes: { id, kind, name, coords: [[lon, lat]], h: [heights], done, m: measurements, e: entities, road?, poly? }
let ids = 0;
const seq = {};
function newShape(kind, name) {
  seq[kind] = (seq[kind] || 0) + 1;
  const sh = { id: ++ids, kind, name: name || `${TOOLS[kind] || KIND[kind]} ${seq[kind]}`, coords: [], h: [], done: false, m: {}, e: { verts: [], legs: [] }, all: [] };
  sh.ref = { kind: 'measure', shape: sh, tip: () => `${sh.name} · ${summary(sh)}`, cardHtml: () => refCard(sh), afterCard: card => refActions(sh, card) };
  return sh;
}
function measureShape(sh) {
  const c = sh.coords;
  if (sh.kind === 'line' || sh.kind === 'arrow') { const p = pathLength(c); sh.m = { legs: p.legs, total: p.total }; }
  else if (sh.kind === 'area') { const a = c.length >= 3 ? polygonArea(c) : { area: 0, perimeter: pathLength(c).total }; sh.m = { area: a.area, per: a.perimeter, crosses: c.length >= 4 && selfCrossing(c) >= 0 }; }
}
/** One line about a shape: "3 legs · 1,234 km", "12.3 km² · 45.6 km around"... */
function summary(sh) {
  const m = sh.m;
  if (sh.kind === 'line') return m.legs.length ? `${m.legs.length} leg${m.legs.length === 1 ? '' : 's'} · ${len(m.total)}` : 'one point';
  if (sh.kind === 'area') return sh.coords.length >= 3 ? `${area(m.area)} · ${len(m.per)} around` : 'needs three corners';
  if (sh.kind === 'arrow') return m.legs.length ? `${len(m.total)} · ${bearingText(m.legs[0].az1)}${sh.road ? ` · by road ${len(sh.road.distance)}` : ''}` : 'pick an end';
  if (sh.kind === 'pin') return where(sh.coords[0]);
  return `${area(m.area)}${m.parts > 1 ? ` · ${m.parts} parts` : ''}`;
}

// entities: made once per part, then moved and relabelled in place (re-creating a draped line each click made it flicker)
function add(sh, o, ground) {
  const e = ds.entities.add(o); e.obj = sh.ref; sh.all.push(e);
  if (ground) e._at = ground;   // where it stands: hidden while it is behind the Earth (see the occlusion check below)
  return e;
}
function drop(sh, e) { if (!e) return null; ds.entities.remove(e); const i = sh.all.indexOf(e); if (i >= 0) sh.all.splice(i, 1); return null; }
function labelAt(sh, key, at, text, extra = {}) {
  const e = sh.e, p = cart(at);
  if (!e[key]) e[key] = add(sh, { position: p, label: { ...LABEL, text, ...extra } }, cart(at, 10));
  else { e[key].position = p; e[key].label.text = text; e[key]._at = cart(at, 10); }
  return e[key];
}
function sync(sh) {
  if (sh.kind === 'outline') return;   // drawn once, in outline()
  const e = sh.e, c = sh.coords, P = c.map(x => cart(x));
  // corners (an arrow's end is its head)
  const nVerts = sh.kind === 'pin' ? 0 : sh.kind === 'arrow' ? 1 : P.length;
  while (e.verts.length > Math.min(nVerts, P.length)) drop(sh, e.verts.pop());
  P.slice(0, nVerts).forEach((p, i) => {
    if (!e.verts[i]) e.verts[i] = add(sh, { position: p, point: { ...VERTEX } }, cart(c[i], 10));
    else { e.verts[i].position = p; e.verts[i]._at = cart(c[i], 10); }
    e.verts[i].point.pixelSize = sh.kind === 'area' && i === 0 && !sh.done ? 11 : 8;   // the corner that closes the area
  });
  if (sh.kind === 'pin') {
    const text = sh.name;
    if (!e.pin) e.pin = add(sh, { position: P[0], billboard: { image: PIN, verticalOrigin: C.VerticalOrigin.BOTTOM, heightReference: GROUND, disableDepthTestDistance: ALWAYS },
      label: { ...LABEL, text, pixelOffset: new C.Cartesian2(0, -40) } }, cart(c[0], 10));
    else { e.pin.position = P[0]; e.pin.label.text = text; }
    return;
  }
  // the line itself: draped (classificationType BOTH: on the globe, the terrain and Google's buildings alike)
  const line = sh.kind === 'area' && P.length >= 3 ? [...P, P[0]] : P;
  if (line.length >= 2) {
    if (!e.line) e.line = add(sh, { polyline: { positions: line, clampToGround: true, classificationType: BOTH, width: sh.kind === 'arrow' ? 4 : 3.5, material: gold } });
    else e.line.polyline.positions = line;
  } else e.line = drop(sh, e.line);
  if (sh.kind === 'arrow' && sh.m.legs.length) {
    const g = sh.m.legs[0], a = courseAxis(c[1][1], c[1][0], g.az2, {}), axis = new C.Cartesian3(a.x, a.y, a.z);
    if (!e.head) e.head = add(sh, { position: P[1], billboard: { image: HEAD, alignedAxis: axis, verticalOrigin: C.VerticalOrigin.TOP, heightReference: GROUND, disableDepthTestDistance: ALWAYS } }, cart(c[1], 10));
    else { e.head.position = P[1]; e.head.billboard.alignedAxis = axis; e.head._at = cart(c[1], 10); }
  } else e.head = drop(sh, e.head);
  if (sh.kind === 'area' && P.length >= 3) {
    if (!e.fill) e.fill = add(sh, { polygon: { hierarchy: new C.PolygonHierarchy(P), material: gold.withAlpha(0.18), classificationType: BOTH } });
    else e.fill.polygon.hierarchy = new C.PolygonHierarchy(P);
  } else e.fill = drop(sh, e.fill);
  // labels: each leg's length at its middle (only once the view is close enough for it to fit), the total at the end
  const m = sh.m, legs = sh.kind === 'line' && m.legs.length > 1 ? m.legs : [];
  while (e.legs.length > legs.length) drop(sh, e.legs.pop());
  legs.forEach((g, i) => {
    const at = midpoint(c[i], c[i + 1]), text = len(g.s);
    if (!e.legs[i]) e.legs[i] = add(sh, { position: cart(at), label: { ...LABEL, text, font: '500 11px "IBM Plex Mono", ui-monospace, monospace', pixelOffset: new C.Cartesian2(0, -6),
      distanceDisplayCondition: new C.DistanceDisplayCondition(0, Math.max(2500, g.s * 10)) } }, cart(at, 10));
    else { const l = e.legs[i]; l.position = cart(at); l._at = cart(at, 10); l.label.text = text; l.label.distanceDisplayCondition = new C.DistanceDisplayCondition(0, Math.max(2500, g.s * 10)); }
  });
  if (sh.kind === 'line' && m.legs.length) labelAt(sh, 'total', c[c.length - 1], m.legs.length > 1 ? `Σ ${len(m.total)}` : len(m.total));
  else if (sh.kind === 'area' && c.length >= 3) labelAt(sh, 'total', centre(c), `${area(m.area)}\n${len(m.per)} around${m.crosses ? '\n⚠ crosses itself' : ''}`, { verticalOrigin: C.VerticalOrigin.CENTER, pixelOffset: C.Cartesian2.ZERO });
  else if (sh.kind === 'arrow' && m.legs.length) labelAt(sh, 'total', midpoint(c[0], c[1]), `${len(m.total)}\n${bearingText(m.legs[0].az1)}`);
  else e.total = drop(sh, e.total);
  // by road (OSRM's car route), in green, with its length and time at its middle
  if (sh.road) {
    const R = sh.road.coords.map(x => cart(x));
    if (!e.road) e.road = add(sh, { polyline: { positions: R, clampToGround: true, classificationType: BOTH, width: 3.5, material: green.withAlpha(0.95) } });
    const mid = pointAt(walkable(sh.road.coords), sh.road.distance / 2);   // below its point: the straight line's label sits above its own, nearby
    labelAt(sh, 'roadLabel', mid, `by road ${len(sh.road.distance)} · ${durationText(sh.road.duration)}`, { fillColor: green, verticalOrigin: C.VerticalOrigin.TOP, pixelOffset: new C.Cartesian2(0, 12) });
  } else { e.road = drop(sh, e.road); e.roadLabel = drop(sh, e.roadLabel); }
}
function unsync(sh) { for (const x of sh.all) ds.entities.remove(x); sh.all = []; sh.e = { verts: [], legs: [] }; }

// ---- the card (#msCard inside #card: other modules replace the card's contents, and the tool stands down when they do)
const openLegs = new Set();
const cardMine = () => $('#card').classList.contains('show') && !!document.getElementById('msCard');
function rowBody(sh) {
  const m = sh.m;
  if (sh.kind === 'line') {
    if (!m.legs.length) return '<span class="ms-dim">Add a second point</span>';
    const list = m.legs.length > 1 ? `<details data-legs="${sh.id}"${openLegs.has(sh.id) ? ' open' : ''}><summary>${m.legs.length} legs</summary><ol class="ms-legs">${m.legs.map(g => `<li>${esc(len(g.s))} · ${esc(bearingText(g.az1))}</li>`).join('')}</ol></details>` : `<span class="ms-dim">heading ${esc(bearingText(m.legs[0].az1))}</span>`;
    const g = sh.ground, hills = g ? `<span class="ms-dim">over the ground ${esc(len(g.length))} · up ${esc(rise(g.up))}, down ${esc(rise(g.down))}</span>` : '';
    return `<span class="ms-n">${esc(both(m.total))}</span>${hills}${list}`;
  }
  if (sh.kind === 'area') {
    if (sh.coords.length < 3) return `<span class="ms-dim">${sh.coords.length} of 3 corners</span>`;
    return `<span class="ms-n">${esc(bothArea(m.area))}</span><span class="ms-dim">${esc(len(m.per))} around · ${sh.coords.length} corners</span>${m.crosses ? '<span class="ms-warn">The outline crosses itself: its loops count against each other</span>' : ''}`;
  }
  if (sh.kind === 'arrow') {
    if (!m.legs.length) return '<span class="ms-dim">Now pick the end</span>';
    const g = m.legs[0], r = sh.road;
    const road = r ? `<span class="ms-road">By road ${esc(len(r.distance))} · ${esc(durationText(r.duration))} · ${(r.distance / Math.max(1, m.total)).toFixed(2)}× the straight line <small>(OSRM, car)</small></span>`
      : sh.routing ? '<span class="ms-dim">Asking OSRM for a road route…</span>' : `<button class="chipbtn ms-rd" data-road="${sh.id}">By road</button>`;
    return `<span class="ms-n">${esc(both(m.total))}</span><span class="ms-dim">sets off ${esc(bearingText(g.az1))}, arrives heading ${esc(bearingText(g.az2))}</span>${road}`;
  }
  if (sh.kind === 'pin') { const [lon, lat] = sh.coords[0], mg = toMgrs(lat, lon); return `<span class="ms-n">${esc(where(sh.coords[0]))}</span>${mg ? `<span class="ms-dim">MGRS ${esc(mg)}</span>` : ''}`; }
  return `<span class="ms-n">${esc(bothArea(m.area))}</span><span class="ms-dim">${m.parts} part${m.parts === 1 ? '' : 's'}, from simplified borders: roughly right, not official</span>`;
}
function rowHtml(sh) {
  return `<div class="ms-row${sh === Measure.cur ? ' cur' : ''}" data-row="${sh.id}"><button class="ms-name" data-fly="${sh.id}" title="Fly to it">${esc(sh.name)}</button>`
    + `<button class="ms-x" data-del="${sh.id}" aria-label="Delete ${esc(sh.name)}">×</button><div class="ms-body">${rowBody(sh)}</div></div>`;
}
function cardHtml() {
  return `<button class="x" aria-label="Close">×</button><div class="k" style="--c:${COLOR}">Draw and measure</div><h2>Measure</h2>
    <div class="ms-modes" role="group" aria-label="Drawing tool">${Object.entries(TOOLS).map(([k, w]) => `<button class="chipbtn" data-mode="${k}">${w}</button>`).join('')}</div>
    <p class="note ms-hint" id="msHint"></p><div class="ms-now" id="msNow" aria-live="polite"></div>
    <div class="acts ms-acts"><button class="chipbtn" id="msFinish">Finish</button><button class="chipbtn" id="msUndo">Undo</button><button class="chipbtn ms-full" id="msClear">Clear all</button><button class="chipbtn ms-full" id="msCopy" title="The drawing as GeoJSON, for geojson.io, QGIS and the like">Copy GeoJSON</button><button class="chipbtn" id="msMore" aria-label="Show everything drawn">More</button></div>
    <form class="fl-form ms-full" id="msOutline" autocomplete="off"><input id="msCountry" maxlength="60" placeholder="Outline a country" aria-label="Outline a country" list="msCountries" style="text-transform:none"><datalist id="msCountries"></datalist><button class="chipbtn" style="color:${COLOR}">Outline</button></form>
    <div class="ms-list ms-full" id="msList"></div>
    <p class="note ms-full" style="margin-top:8px">Shortest paths over the Earth's real shape (WGS84; within a millimetre) and areas on it (within 0.001%), at sea level. Up to ${MAX_POINTS} points. Countries: Natural Earth, simplified.</p>`;
}
function wire(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.type === 'submit' && b.form) return;
    const byId = k => Measure.shapes.find(s => s.id === +b.dataset[k]);
    if (b.classList.contains('x')) return Measure.close();
    if (b.dataset.mode) { const k = b.dataset.mode; Measure.finish(); Measure.mode === k ? Measure.disarm() : Measure.arm(k); }
    else if (b.dataset.fly) Measure.fly(byId('fly'));
    else if (b.dataset.del) Measure.remove(byId('del'));
    else if (b.dataset.road) Measure.byRoad(byId('road'));
    else if (b.id === 'msFinish') Measure.finish();
    else if (b.id === 'msUndo') Measure.undo();
    else if (b.id === 'msClear') Measure.clear();
    else if (b.id === 'msCopy') Measure.copy();
    else if (b.id === 'msMore') Measure.expanded = !Measure.expanded;
    else return;
    Measure.update();
  });
  root.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.legs) d.open ? openLegs.add(+d.dataset.legs) : openLegs.delete(+d.dataset.legs); }, true);
  root.querySelector('#msOutline').onsubmit = async e => {
    e.preventDefault(); const q = root.querySelector('#msCountry').value;
    const r = await Measure.outlineByName(q).catch(() => null);
    if (!r) toast(q.trim() ? `No country called "${q.trim().slice(0, 40)}" in the bundled borders` : 'Type a country to outline', 3000); else root.querySelector('#msCountry').value = '';
  };
  root.querySelector('#msCountry').addEventListener('focus', () => {   // the borders (430 KB) load when someone wants a country, not with the card
    Country.search('', 400).then(list => { const dl = root.querySelector('#msCountries'); if (dl) dl.innerHTML = list.map(c => `<option value="${esc(c.name)}">`).join(''); }).catch(() => {});
  }, { once: true });
}
// a drawn shape clicked while the tool is put away: a small card of its own (ui.js select() builds it from these)
function refCard(sh) {
  return `<div class="k" style="--c:${COLOR}">${esc(KIND[sh.kind])}</div><h2>${esc(sh.name)}</h2><div class="ms-body ms-solo">${rowBody(sh)}</div>`;
}
function refActions(sh, card) {
  const f = card.querySelector('#btnFocus'); if (f) f.onclick = () => Measure.fly(sh);
  const acts = card.querySelectorAll('.acts'), last = acts[acts.length - 1]; if (!last) return;
  last.insertAdjacentHTML('beforeend', `<button class="chipbtn" data-ms="open" style="color:${COLOR}">Measure tool</button><button class="chipbtn" data-ms="del">Delete</button>`);
  last.querySelector('[data-ms="open"]').onclick = () => Measure.open(null);
  last.querySelector('[data-ms="del"]').onclick = () => { Measure.remove(sh); hooks.closeCard?.(); };
  const rd = card.querySelector('[data-road]'); if (rd) rd.onclick = () => Measure.byRoad(sh).then(() => hooks.reselect(sh.ref));
}

// ---- the rubber band to the pointer (mice only) and its tip: the leg so far, the total, the area if closed here
const tip = document.createElement('div'); tip.id = 'msTip'; tip.setAttribute('aria-hidden', 'true'); document.body.append(tip);
let band = [], bandEnt = null, raf = 0, mouse = null, touch = matchMedia('(pointer: coarse)').matches;
function bandLine() {
  if (!bandEnt) bandEnt = ds.entities.add({ polyline: { positions: new C.CallbackProperty(() => band, false), width: 2, arcType: C.ArcType.GEODESIC,
    material: new C.PolylineDashMaterialProperty({ color: gold, dashLength: 12 }), depthFailMaterial: new C.PolylineDashMaterialProperty({ color: gold.withAlpha(0.55), dashLength: 12 }) } });
}
function hideBand() { band = []; tip.style.display = 'none'; }
function preview(win) {
  const p = pickGround(win, false); if (!p) { hideBand(); return; }
  const g = C.Cartographic.fromCartesian(p), at = [deg(g.longitude), deg(g.latitude)], sh = Measure.cur, mode = Measure.mode;
  let text;
  if (mode === 'pin') { band = []; text = where(at); }
  else if (sh && sh.coords.length) {
    const c = sh.coords, last = c[c.length - 1], leg = inverse(last[1], last[0], at[1], at[0]);
    bandLine(); band = [cart(last, sh.h[c.length - 1]), p];
    if (mode === 'area' && c.length >= 2) { band.push(cart(c[0], sh.h[0])); text = `${area(polygonArea([...c, at]).area)} · +${len(leg.s)}`; }
    else text = `+${len(leg.s)} · ${bearingText(leg.az1)}${mode === 'line' && c.length > 1 ? ` · Σ ${len(sh.m.total + leg.s)}` : ''}`;
  } else { band = []; text = mode === 'area' ? 'Click the first corner' : mode === 'arrow' ? 'Click the start' : 'Click the first point'; }
  tip.textContent = text; tip.style.display = 'block';
  tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, win.x + 16) + 'px'; tip.style.top = Math.max(8, win.y - 38) + 'px';
}
scene.canvas.addEventListener('pointerdown', e => { touch = e.pointerType !== 'mouse'; }, true);
scene.canvas.addEventListener('pointerleave', hideBand);

const handler = new C.ScreenSpaceEventHandler(scene.canvas);
handler.setInputAction(c => { if (Measure.armed()) Measure.clickAt(c.position); }, C.ScreenSpaceEventType.LEFT_CLICK);
handler.setInputAction(() => { if (Measure.armed()) { Measure.finish(); Measure.update(); } }, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
handler.setInputAction(m => {
  if (!Measure.armed() || touch) return;
  mouse = C.Cartesian2.clone(m.endPosition, mouse);
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (Measure.armed() && mouse) preview(mouse); });
}, C.ScreenSpaceEventType.MOUSE_MOVE);

const userPoints = () => Measure.shapes.reduce((n, s) => n + (s.kind === 'outline' ? 0 : s.coords.length), 0);
const placeName = p => p.here ? p.name : p.name + (p.sub && p.sub.includes(' · ') ? ', ' + p.sub.split(' · ').pop() : '');
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const ME = /^(me|my location|where i am|my position|home|my home|my house)$/, HERE = /^(here|there|this place|this spot|the pointer|the view|the middle of the view)$/;

export const Measure = {
  shapes: [], cur: null, mode: null, lastMode: 'line', expanded: false,
  armed() { return !!this.mode && !state.lookup && cardMine(); },
  /** Open the card; `mode` arms a tool (null: just show the drawing, as after a spoken measurement). */
  open(mode = this.lastMode) {
    if (state.lookup) return;
    hooks.clearSelection?.();
    if (Directions.picking) Directions.stopPick();   // one tool takes clicks at a time
    const c = $('#card');
    c.innerHTML = `<div id="msCard">${cardHtml()}</div>`; c.classList.add('show');
    wire(c.querySelector('#msCard'));
    if (mode) this.arm(mode); else this.disarm();
    this.update();
  },
  close() { this.disarm(); if (cardMine()) $('#card').classList.remove('show'); },
  arm(mode) {
    this.mode = mode; this.lastMode = mode; state.picking = true; document.body.classList.add('ms-armed');
    if (this.cur && this.cur.kind !== mode) this.finish();
    this.update();
  },
  /** Put the tool away: the shape in progress is kept if it is complete, clicks go back to opening cards. */
  disarm() {
    if (this.cur) this.finish();
    const was = this.mode; this.mode = null; hideBand(); document.body.classList.remove('ms-armed');
    if (was && !Directions.picking) state.picking = false;
    this.update();
  },
  /** A click on the globe while a tool is armed. */
  clickAt(win) {
    const sh = this.cur, quick = s => performance.now() - (s.t || 0) < 500;
    const near = (s, i, px) => { const w = C.SceneTransforms.worldToWindowCoordinates(scene, cart(s.coords[i], s.h[i])); return w && Math.hypot(w.x - win.x, w.y - win.y) < px; };
    if (sh && sh.coords.length) {
      // a quick second click or tap on the last point is a double-click: it ends the shape (and adds nothing); an area's first
      // corner closes it. A slow click near the last point is just a point placed close by (corners can be a few pixels apart)
      if (quick(sh) && near(sh, sh.coords.length - 1, touch ? 24 : 8)) { this.finish(); this.update(); return; }
      if (sh.kind === 'area' && sh.coords.length >= 3 && near(sh, 0, touch ? 20 : 10)) { this.finish(); this.update(); return; }
      if (near(sh, sh.coords.length - 1, 3)) return;   // no zero-length legs
    }
    const lastPin = this.shapes[this.shapes.length - 1];
    if (this.mode === 'pin' && lastPin && lastPin.kind === 'pin' && quick(lastPin) && near(lastPin, 0, touch ? 24 : 8)) return;   // a double-click's second click
    const p = pickGround(win); if (!p) return;
    const g = C.Cartographic.fromCartesian(p);
    if (this.addPoint([deg(g.longitude), deg(g.latitude)], g.height)) this.update();
    if (mouse && !touch) preview(win);
  },
  addPoint(at, h = 0, name) {
    if (userPoints() >= MAX_POINTS) { toast(`That's ${MAX_POINTS} points, the most one drawing holds: clear some first`, 3500); return false; }
    const mode = this.mode || 'line';
    if (mode === 'pin') { const sh = newShape('pin', name); sh.coords.push(at); sh.h.push(h); sh.done = true; sh.t = performance.now(); this.shapes.push(sh); this.changed(sh); return sh; }
    if (!this.cur || this.cur.kind !== mode) { this.finish(); this.cur = newShape(mode, name); this.shapes.push(this.cur); }
    const sh = this.cur; sh.coords.push(at); sh.h.push(h); sh.t = performance.now();
    if (sh.kind === 'arrow' && sh.coords.length === 2) { sh.done = true; this.cur = null; }
    this.changed(sh); return sh;
  },
  /** End the shape being drawn (a line needs two points, an area three; fewer are dropped). */
  finish() {
    const sh = this.cur; if (!sh) return null; this.cur = null; hideBand();
    if (sh.coords.length < (sh.kind === 'area' ? 3 : 2)) { this.remove(sh); if (sh.coords.length > 1 || sh.kind === 'line' && sh.coords.length) toast(sh.kind === 'area' ? 'An area needs three corners' : 'A line needs two points', 2500); return null; }
    sh.done = true; this.changed(sh);
    if (sh.kind === 'line') this.overGround(sh);
    return sh;
  },
  /** With 3D terrain on, a finished line's length over the hills and its climb (lines up to 30 km: heights every 25 m or
   *  so, at most 300, from the most detailed tiles; a longer line would pull detailed tiles for a whole region). */
  async overGround(sh) {
    if (!Terrain.on || sh.m.total > 30e3 || sh.m.total < 20) return;
    const v = sh.coords.length, line = walkable(sh.coords), n = Math.min(300, Math.ceil(line.total / 25));
    const hs = await Terrain.heights(Array.from({ length: n + 1 }, (_, i) => { const [lon, lat] = pointAt(line, line.total * i / n); return { lon, lat }; }));
    if (!this.shapes.includes(sh) || sh.coords.length !== v || !sh.done || !Terrain.on) return;   // changed meanwhile
    sh.ground = groundProfile(sh.m.total, hs); this.update();
    if (state.selected === sh.ref) hooks.reselect(sh.ref);
  },
  /** Take back the last point (reopening a finished line or area), the last pin, or the last outline. */
  undo() {
    const sh = this.cur || this.shapes[this.shapes.length - 1]; if (!sh) return false;
    if (sh.kind === 'outline' || sh.kind === 'pin') { this.remove(sh); return true; }
    sh.coords.pop(); sh.h.pop(); sh.road = null;
    if (!sh.coords.length) { this.remove(sh); return true; }
    sh.done = false; this.cur = sh; if (this.mode && this.mode !== sh.kind) this.mode = sh.kind;
    this.changed(sh); return true;
  },
  remove(sh) {
    if (!sh) return;
    unsync(sh); this.shapes = this.shapes.filter(s => s !== sh); if (this.cur === sh) this.cur = null;
    if (state.selected === sh.ref) hooks.closeCard?.();
    this.update();
  },
  clear() { this.cur = null; for (const sh of this.shapes) unsync(sh); this.shapes = []; for (const k of Object.keys(seq)) delete seq[k]; hideBand(); this.update(); },
  changed(sh) { sh.ground = null; measureShape(sh); sync(sh); scene.requestRender(); },
  /** Refresh the card, if it is ours and open. */
  update() {
    const root = document.getElementById('msCard'); if (!root) return;
    root.querySelectorAll('[data-mode]').forEach(b => { const on = b.dataset.mode === this.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    root.querySelector('#msHint').textContent = this.mode ? HINT[this.mode] : 'Pick a tool, then click the globe. Distances and areas follow the Earth\'s curve.';
    const list = root.querySelector('#msList'), top = list.scrollTop;
    list.innerHTML = this.shapes.length ? this.shapes.map(rowHtml).join('') : '<p class="note" style="margin:0">Nothing drawn yet.</p>';
    list.scrollTop = top; if (this.cur) list.querySelector(`[data-row="${this.cur.id}"]`)?.scrollIntoView({ block: 'nearest' });
    root.querySelector('#msFinish').disabled = !this.cur; root.querySelector('#msUndo').disabled = root.querySelector('#msClear').disabled = root.querySelector('#msCopy').disabled = !this.shapes.length;
    // phones, while a tool is armed: just the tools, one line about the shape in hand, Finish and Undo (the full card hid
    // most of the globe there); More opens the rest
    const compact = PHONE && !!this.mode && !this.expanded, now = this.cur || this.shapes[this.shapes.length - 1];
    root.classList.toggle('ms-compact', compact);
    root.querySelector('#msMore').textContent = compact ? 'More' : 'Less';
    root.querySelector('#msNow').textContent = now ? `${now.name} · ${summary(now)}` : '';
  },
  fly(sh) {
    if (!sh) return;
    release();
    if (sh.kind === 'outline') { Country.fly({ border: sh.border }); return; }
    const c = sh.road ? [...sh.coords, ...sh.road.coords] : sh.coords;
    if (c.length === 1) { camera.flyTo({ destination: C.Cartesian3.fromDegrees(c[0][0], c[0][1] - 0.012, 1800), orientation: { heading: 0, pitch: C.Math.toRadians(-45), roll: 0 }, duration: 1.8 }); return; }
    // framed clear of the card: it covers the right of a desktop and the bottom of a phone
    const r = C.Rectangle.fromCartesianArray(c.map(x => cart(x))), w = C.Rectangle.computeWidth(r), h = r.north - r.south, pad = Math.max(w, h) * 0.25 + 2e-4;
    const south = pad + (PHONE && cardMine() ? Math.max(h, w * 0.5) * (this.mode && !this.expanded ? 0.6 : 1.4) : 0), east = pad + (!PHONE && cardMine() ? w * 0.4 : 0);
    camera.flyTo({ destination: new C.Rectangle(r.west - pad, Math.max(-1.5, r.south - south), r.east + east, Math.min(1.5, r.north + pad)), duration: 2 });
  },
  /** A distance arrow's trip by road (OSRM, car): drawn in green beside the straight line. */
  async byRoad(sh) {
    if (!sh || sh.kind !== 'arrow' || sh.coords.length < 2 || sh.routing) return null;
    sh.routing = true; this.update();
    const [a, b] = sh.coords.map(([lon, lat]) => ({ lon, lat }));
    try { const r = await fetchRoute(a, b, 'drive'); sh.road = { coords: r.coords, distance: r.distance, duration: r.duration }; }
    catch (e) { toast(e.noRoute ? `No road between those points${sh.m.total > 1e6 ? ' (they are over 1,000 km apart)' : ''}` : 'Road routing is unavailable right now: ' + e.message, 4000); }
    finally { sh.routing = false; }
    if (this.shapes.includes(sh)) { this.changed(sh); this.update(); }
    return sh.road || null;
  },
  /** Outline a country (a record from Country.byIso), with its area; once per country. */
  outline(o) {
    let sh = this.shapes.find(s => s.kind === 'outline' && s.iso === o.iso);
    if (!sh) {
      this.finish();
      sh = newShape('outline', o.facts.name || o.border.name); sh.iso = o.iso; sh.border = o.border; sh.poly = o.border.poly; sh.done = true;
      sh.m = { area: multiPolygonArea(o.border.poly).area, parts: o.border.poly.length };
      for (const rings of sh.poly) {
        const outer = rings[0].map(x => cart(x)), holes = rings.slice(1).map(r => new C.PolygonHierarchy(r.map(x => cart(x))));
        add(sh, { polygon: { hierarchy: new C.PolygonHierarchy(outer, holes), material: gold.withAlpha(0.12), classificationType: BOTH } });
        for (const r of rings) add(sh, { polyline: { positions: r.map(x => cart(x)), clampToGround: true, classificationType: BOTH, width: 2.5, material: gold } });
      }
      const bx = mainBox(o.border), mid = [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2];
      add(sh, { position: cart(mid), label: { ...LABEL, text: `${sh.name}\n${area(sh.m.area)}`, verticalOrigin: C.VerticalOrigin.CENTER, pixelOffset: C.Cartesian2.ZERO } }, cart(mid, 10));
      this.shapes.push(sh);
    }
    this.fly(sh); this.update(); scene.requestRender();
    return sh;
  },
  /** A country by name ("France", "the UK", "this country"): its outline shape, or null if there is no such country. */
  async outlineByName(q, spot = null) {
    const s = String(q || '').trim().toLowerCase().replace(/^the /, '').replace(/[.]/g, '');
    if (!s) return null;
    let o = null;
    if (/^(this|that|the|my) country$|^here$|^this$/.test(s)) { if (spot && spot.lat != null) o = await Country.at(spot.lon, spot.lat); }
    else if (COUNTRY_ALIAS[s]) o = await Country.byIso(COUNTRY_ALIAS[s]);
    else { const list = await Country.search(s); const hit = list.find(c => c.name.toLowerCase() === s) || list[0]; if (hit) o = await Country.byIso(hit.iso); }
    return o ? this.outline(o) : null;
  },
  /** The drawing as GeoJSON: to the clipboard, or saved as a file where the clipboard is refused. */
  async copy() {
    const done = this.shapes.filter(s => s.kind === 'outline' || s.coords.length >= (s.kind === 'area' ? 3 : s.kind === 'pin' ? 1 : 2));
    if (!done.length) { toast('Nothing finished to copy yet', 2500); return; }
    const text = JSON.stringify(toGeoJSON(done.map(s => ({ kind: s.kind, name: s.name, coords: s.coords, poly: s.poly, road: s.road }))));
    try { await navigator.clipboard.writeText(text); toast(`GeoJSON copied (${done.length} shape${done.length === 1 ? '' : 's'}): paste it into geojson.io, QGIS or a .geojson file`, 4000); }
    catch (e) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/geo+json' })); a.download = 'open-overwatch-drawing.geojson';
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10e3); toast('Saved as open-overwatch-drawing.geojson', 3000);
    }
  },
  /** Look-up mode hides the drawing (and puts the tool away). */
  apply() { ds.show = !state.lookup; if (state.lookup && this.mode) this.disarm(); },
  /** A sentence about the shape being drawn, or the last one. */
  describe(sh = this.cur || this.shapes[this.shapes.length - 1]) {
    if (!sh) return 'Nothing is drawn yet.';
    const m = sh.m, im = IMPERIAL;
    if (sh.kind === 'line') return m.legs.length ? `${sh.name}: ${m.legs.length} leg${m.legs.length === 1 ? '' : 's'}, ${lengthWords(m.total, im)} in all.${sh.ground ? ` Over the ground ${lengthWords(sh.ground.length, im)}, climbing ${rise(sh.ground.up).replace(/ m$/, ' metres').replace(/ ft$/, ' feet')}.` : ''}` : `${sh.name} has one point so far.`;
    if (sh.kind === 'area') return sh.coords.length >= 3 ? `${sh.name}: ${areaWords(m.area, im)}, ${lengthWords(m.per, im)} around.${m.crosses ? ' Its outline crosses itself.' : ''}` : `${sh.name} needs three corners.`;
    if (sh.kind === 'arrow') return m.legs.length ? `${sh.name}: ${lengthWords(m.total, im)}, heading ${bearingWords(m.legs[0].az1)}.${sh.road ? ` By road, ${lengthWords(sh.road.distance, im)}, about ${durationText(sh.road.duration).replace(' h ', ' hours ').replace(/ min$/, ' minutes')}.` : ''}` : `${sh.name} needs an end.`;
    if (sh.kind === 'pin') return `${sh.name}: ${whereWords(sh.coords[0])}.`;
    return `${sh.name}: about ${areaWords(m.area, im)}, from the simplified border.`;
  },

  /** Run a spoken draw / measure command (core/voicecmd.js); resolves with the sentence to say. `help`: { here() → { lat, lon } | null
   *  (the pointer, else the middle of the view), famousSat(q) → a satellite or null }. */
  async voice(cmd, help) {
    const im = IMPERIAL;
    switch (cmd.act) {
      case 'measure': return this.sayMeasure(cmd, help);
      case 'outline': {
        const sh = await this.outlineByName(cmd.place, help.here()).catch(() => undefined);
        if (sh === undefined) return 'The country borders did not load. Try again.';
        if (!sh) return `I can outline countries, and I have none called ${cmd.place.replace(/\b\w/g, ch => ch.toUpperCase())}.`;
        this.open(null);
        return cmd.area ? `${sh.name}: about ${areaWords(sh.m.area, im)}, measured on its simplified border.` : `${sh.name} outlined: about ${areaWords(sh.m.area, im)}.`;
      }
      case 'pin': {
        let at, name;
        if (cmd.place) {
          const pl = (await findPlaces(cmd.place, 1).catch(() => null) || [])[0];
          if (!pl) return `I couldn't find ${cmd.place}.`;
          at = [pl.lon, pl.lat]; name = pl.name;
        } else { const s = help.here(); if (!s || s.lat == null) return 'Point at a place on the Earth first.'; at = [s.lon, s.lat]; }
        const was = this.mode; this.mode = 'pin'; const sh = this.addPoint(at, 0, name); this.mode = was;
        if (!sh) return `The drawing is full: ${MAX_POINTS} points.`;
        this.open(was); if (cmd.place) this.fly(sh);
        return `${sh.name}: ${whereWords(at)}.`;
      }
      case 'draw':
        if (cmd.on === false) { this.close(); return 'Drawing put away. The shapes stay until you clear them.'; }
        if (cmd.finish) { const sh = this.finish(); this.update(); return sh ? this.describe(sh) : 'Nothing is being drawn.'; }
        this.open(cmd.mode || 'line');
        return { line: `Line. ${PHONE ? 'Tap' : 'Click'} the globe to add points, then say finish.`, area: `Area. ${PHONE ? 'Tap' : 'Click'} the corners, then say finish.`,
          arrow: `Distance. ${PHONE ? 'Tap' : 'Click'} a start, then an end.`, pin: `Pins. ${PHONE ? 'Tap' : 'Click'} to drop one, or say: drop a pin on Rome.` }[cmd.mode || 'line'];
      case 'undoDraw': { const ok = this.undo(); this.update(); return ok ? 'Taken back.' : 'Nothing to undo.'; }
      case 'clearDraw': { const n = this.shapes.length; this.clear(); return n ? 'Drawing cleared.' : 'There was nothing drawn.'; }
      case 'drawInfo': return this.describe();
      default: return 'Try: measure from Paris to Berlin.';
    }
  },
  async sayMeasure(cmd, help) {
    const im = IMPERIAL, to = cmd.to;
    // the Moon, the Sun and the famous satellites: how far right now, no drawing
    if (/^(moon|sun)$/.test(to)) {
      const p = to === 'moon' ? moonPosition() : C.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(viewer.clock.currentTime), d = C.Cartesian3.magnitude(p);
      return `The ${to === 'moon' ? 'Moon' : 'Sun'} is ${lengthWords(d, im)} away right now, centre to centre: light takes ${to === 'moon' ? (d / 299792458).toFixed(1) + ' seconds' : Math.round(d / 299792458 / 60 * 10) / 10 + ' minutes'}.`;
    }
    const here = q => {   // "here", "me" (the place Tonight remembers), or nothing said: the pointer, else the middle of the view
      if (q && ME.test(q)) { const h = store.get('home', null); if (h && Number.isFinite(h.lat)) return { name: 'your location', lat: h.lat, lon: h.lon, here: true }; }
      if (!q || ME.test(q) || HERE.test(q)) { const s = help.here(); return s && s.lat != null ? { name: 'here', lat: s.lat, lon: s.lon, here: true } : null; }
      return undefined;
    };
    const sat = help.famousSat?.(to);
    if (sat && sat.pt) {
      const from = here(cmd.from ?? null); if (!from) return 'Point at a place on the Earth first.';
      const d = C.Cartesian3.distance(sat.pt.position, cart([from.lon, from.lat])), up = C.Cartographic.fromCartesian(sat.pt.position).height;
      return `${sat.name} is ${lengthWords(d, im)} from ${from.name === 'here' ? 'the middle of the view' : from.name}, ${lengthWords(up, im)} up.`;
    }
    const fromSpot = here(cmd.from ?? (store.get('home', null) ? 'me' : null)), toSpot = here(to);
    if (fromSpot === null || toSpot === null) return 'Point at a place on the Earth first.';
    let as, bs;
    try { [as, bs] = await Promise.all([fromSpot ? [fromSpot] : findPlaces(cmd.from, 6), toSpot ? [toSpot] : findPlaces(to, 6)]); }
    catch (e) { return 'The place search is unavailable right now.'; }
    if (!as.length) return `I couldn't find ${cmd.from}.`; if (!bs.length) return `I couldn't find ${to}.`;
    const [a, b] = choosePair(as, bs);
    const was = this.mode; this.finish(); this.mode = 'arrow';
    const sh = this.addPoint([a.lon, a.lat], 0, `${a.here ? (a.name === 'here' ? 'Here' : 'You') : a.name} → ${b.here ? 'here' : b.name}`); if (sh) this.addPoint([b.lon, b.lat]);
    this.mode = was;
    if (!sh || sh.coords.length < 2) { if (sh) this.remove(sh); return `The drawing is full: ${MAX_POINTS} points.`; }
    this.open(null); this.fly(sh);
    const g = sh.m.legs[0];
    let said = cap(`${placeName(a)} to ${placeName(b)}: ${lengthWords(g.s, im)} in a straight line, heading ${bearingWords(g.az1)}.`);
    if (cmd.road) {
      const r = await this.byRoad(sh);
      said += r ? ` By road, ${lengthWords(r.distance, im)}, about ${durationText(r.duration).replace(' h ', ' hours ').replace(/ min$/, ' minutes')}.` : ' I found no road route.';
    }
    return said;
  },
};

// the card was closed or another module took it: the tool stands down (the drawing stays)
new MutationObserver(() => { if (Measure.mode && !cardMine()) Measure.disarm(); }).observe($('#card'), { childList: true, attributes: true, attributeFilter: ['class'] });
// keys while a tool is armed: Enter finishes, Backspace / Ctrl+Z undo; M opens or closes the tool
addEventListener('keydown', e => {
  if (state.lookup || /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && Measure.armed()) { e.preventDefault(); Measure.undo(); Measure.update(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.key === 'm' || e.key === 'M') { if (cardMine()) Measure.close(); else Measure.open(); return; }
  if (!Measure.armed()) return;
  if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); Measure.finish(); Measure.update(); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); Measure.undo(); Measure.update(); }
});
// labels and corners are drawn on top of everything (they would hide in hills): those on the far side of the Earth hide
setInterval(() => {
  if (!ds.show || !Measure.shapes.length) return;
  const occ = new C.EllipsoidalOccluder(C.Ellipsoid.WGS84, camera.positionWC);
  for (const sh of Measure.shapes) for (const e of sh.all) if (e._at) { const v = occ.isPointVisible(e._at); if (e.show !== v) e.show = v; }
}, 250);
