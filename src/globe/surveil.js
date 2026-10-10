// Mapped cameras: surveillance cameras and licence-plate readers (ALPR) that OpenStreetMap volunteers have tagged
// (man_made=surveillance), loaded for the area in view once you are low enough (below ~25 km), from the public Overpass
// API. Locations and tags only: no video, no plates. Where a camera's direction is tagged, a small wedge shows where it
// points. Coverage is whatever volunteers have mapped: patchy, and labelled that way.
import { C, esc } from './env.js';
import { scene, camera, camHeight } from './viewer.js';
import { L, setCount } from './layers.js';
import { state } from './state.js';
import { overpass } from './overpass.js';

const MAX_H = 2.5e4, CELL = 0.05, MAX_CELLS = 16, GAP_MS = 4000;   // query 0.05-degree cells, at most 16 at a time
const pts = scene.primitives.add(new C.PointPrimitiveCollection()), wedges = scene.primitives.add(new C.PolylineCollection());
const COL = { alpr: '#ff4d5e', cam: '#c9a0ff' };   // lavender: live cameras (cams.js) are pink
const cells = new Map();   // "x,y" -> 'loading' | 'done'
let byId = new Map(), busy = false, last = 0, failed = 0;

function tagsHtml(t) {
  const show = ['surveillance:type', 'surveillance', 'surveillance:zone', 'camera:type', 'camera:direction', 'camera:mount', 'operator', 'manufacturer', 'name', 'description'];
  return show.filter(k => t[k]).map(k => `<dt>${esc(k.replace(/^(surveillance|camera):/, '').replace(/_/g, ' '))}</dt><dd>${esc(String(t[k]).slice(0, 120))}</dd>`).join('');
}
function add(el) {
  if (byId.has(el.id) || !Number.isFinite(el.lat)) return;
  const t = el.tags || {}, alpr = /alpr|anpr|plate/i.test(`${t['surveillance:type'] || ''} ${t['camera:type'] || ''} ${t.name || ''}`), col = C.Color.fromCssColorString(alpr ? COL.alpr : COL.cam);
  const o = { kind: 'cctv', id: el.id, lat: el.lat, lon: el.lon, alpr, tags: t };
  o.tip = () => `${alpr ? 'Plate reader (ALPR)' : 'Surveillance camera'}${t.operator ? ' · ' + String(t.operator).slice(0, 40) : ''}`;
  o.cardHtml = () => `<div class="k" style="--c:${alpr ? COL.alpr : COL.cam}">Mapped by OpenStreetMap volunteers</div><h2>${alpr ? 'Plate reader' : 'Camera'}</h2>
    <dl>${tagsHtml(t)}<dt>Position</dt><dd>${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}</dd></dl>
    <div class="acts"><a class="chipbtn" href="https://www.openstreetmap.org/node/${encodeURIComponent(el.id)}" target="_blank" rel="noopener">On OpenStreetMap</a></div>
    <div class="note" style="margin-top:8px">A location someone tagged, not a feed: no video, no plates. Unmapped cameras are not shown, and some tags are out of date. © OpenStreetMap contributors (ODbL).</div>`;
  o.pt = pts.add({ position: C.Cartesian3.fromDegrees(o.lon, o.lat, 4), pixelSize: alpr ? 8 : 6, color: col.withAlpha(0.85), outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1, id: o, show: L.cctv.on, disableDepthTestDistance: 5000 });
  const dir = parseFloat(t['camera:direction'] || t.direction);
  if (Number.isFinite(dir)) {   // a 60-degree wedge, 35 m long, toward where the camera looks
    const R = 35, m = 111320, cos = Math.cos(o.lat * Math.PI / 180), at = a => C.Cartesian3.fromDegrees(o.lon + Math.sin(a * Math.PI / 180) * R / (m * cos), o.lat + Math.cos(a * Math.PI / 180) * R / m, 4);
    const c0 = C.Cartesian3.fromDegrees(o.lon, o.lat, 4), arc = []; for (let a = dir - 30; a <= dir + 30; a += 10) arc.push(at(a));
    o.wedge = wedges.add({ positions: [c0, ...arc, c0], width: 1.5, material: C.Material.fromType('Color', { color: col.withAlpha(0.7) }), show: L.cctv.on });
  }
  byId.set(el.id, o);
}

async function tick() {
  if (!L.cctv.on || state.lookup || busy || camHeight() > MAX_H || performance.now() - last < GAP_MS || failed > 4) return;
  // the area around the reticle (a tilted view's rectangle runs to the horizon), sized by height: 1.5-12 km across
  const c = camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), C.Ellipsoid.WGS84) || camera.positionWC;
  const g = C.Cartographic.fromCartesian(c), lat = C.Math.toDegrees(g.latitude), lon = C.Math.toDegrees(g.longitude);
  const rad = Math.min(6000, Math.max(750, camHeight() * 2)), dLat = rad / 111320, dLon = rad / (111320 * Math.max(0.2, Math.cos(g.latitude)));
  const w = lon - dLon, e = lon + dLon, s = lat - dLat, n = lat + dLat;
  const want = [];
  for (let x = Math.floor(w / CELL); x <= Math.floor(e / CELL); x++) for (let y = Math.floor(s / CELL); y <= Math.floor(n / CELL); y++) if (!cells.has(x + ',' + y)) want.push([x, y]);
  if (!want.length || want.length > MAX_CELLS * 4) return;   // too wide a view: zoom in first
  const pick = want.slice(0, MAX_CELLS), xs = pick.map(c => c[0]), ys = pick.map(c => c[1]);
  const bb = [Math.min(...ys) * CELL, Math.min(...xs) * CELL, (Math.max(...ys) + 1) * CELL, (Math.max(...xs) + 1) * CELL].map(v => v.toFixed(4)).join(',');
  for (const [x, y] of pick) cells.set(x + ',' + y, 'loading');
  busy = true; last = performance.now();
  try {
    const q = `[out:json][timeout:25];node["man_made"="surveillance"](${bb});out 2000;`;
    for (const el of (await overpass(q, { timeout: 30000 })).elements || []) add(el);
    for (const [x, y] of pick) cells.set(x + ',' + y, 'done');
    failed = 0; setCount('cctv', byId.size);
  } catch (e) { console.warn('mapped cameras', e.message); for (const [x, y] of pick) cells.delete(x + ',' + y); failed++; last = performance.now() + failed * 8000; }
  busy = false;
}

export const Surveil = {
  get list() { return [...byId.values()]; },
  apply() { const on = L.cctv.on && !state.lookup; for (const o of byId.values()) { o.pt.show = on; if (o.wedge) o.wedge.show = on; } if (on) tick(); },
};
setInterval(tick, 1500);
