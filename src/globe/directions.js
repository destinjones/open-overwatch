// Directions: a street route between two places (typed, said, or picked on the globe), drawn on the ground (on the
// photoreal city too: it is clamped to whatever is drawn), with turn-by-turn steps, then "Fly it": the camera rides
// the route like a drone, leading the path. Routing: the FOSSGIS OSRM servers over OpenStreetMap (no key, CORS).
import { C, $, esc, toast } from './env.js';
import { viewer, scene, camera, ctrl } from './viewer.js';
import { state, hooks } from './state.js';
import { release } from './follow.js';
import { findPlaces } from './places.js';
import { instruction, distanceText, durationText, measure, pointAt, bearing, haversine } from '../core/route.js';

const PROFILE = { drive: ['routed-car', 'driving'], walk: ['routed-foot', 'foot'], cycle: ['routed-bike', 'bike'] };
const MODE_WORD = { drive: 'Drive', walk: 'Walk', cycle: 'Cycle' };
const COLOR = '#7dffa6';
let ents = [], flight = null;

async function where(q) {
  const m = String(q).trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);   // "lat, lon" typed directly
  if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return { name: `${(+m[1]).toFixed(4)}, ${(+m[2]).toFixed(4)}`, lat: +m[1], lon: +m[2] };
  const p = (await findPlaces(q, 1))[0]; if (!p) throw new Error(`no place called "${q}"`);
  return p;
}

/** Two place names as the closest pair of candidates ("Big Ben" alone is a mountain in Queensland; next to "Tower of
 *  London" it is the clock tower). Throws if either has no match. */
export async function resolvePair(fromQ, toQ) {
  const [a, b] = await Promise.all([findPlaces(fromQ, 6), findPlaces(toQ, 6)]);
  if (!a.length) throw new Error(`no place called "${fromQ}"`); if (!b.length) throw new Error(`no place called "${toQ}"`);
  let best = [a[0], b[0]], bestD = Infinity;
  for (const x of a) for (const y of b) { const d = haversine([x.lon, x.lat], [y.lon, y.lat]); if (d < bestD) { bestD = d; best = [x, y]; } }
  if (bestD > 50e3) {   // over a city apart: ask again with each biased toward the other, both ways round, and keep the closest pair
    const one = async (q, near) => (await findPlaces(q, 1, near).catch(() => []))[0];
    const x1 = await one(fromQ, b[0]), y1 = x1 && await one(toQ, x1);
    const y2 = await one(toQ, a[0]), x2 = y2 && await one(fromQ, y2);
    for (const [x, y] of [[x1, y1], [x2, y2]]) if (x && y) { const d = haversine([x.lon, x.lat], [y.lon, y.lat]); if (d < bestD) { bestD = d; best = [x, y]; } }
  }
  return best;
}

export const Directions = {
  from: null, to: null, mode: 'drive', route: null, picking: null,
  open(prefill = {}) {
    Object.assign(this, prefill);
    const c = $('#card'); hooks.clearSelection?.();
    const val = p => p ? esc(p.name) : '';
    c.innerHTML = `<button class="x" aria-label="Close">×</button><div class="k" style="--c:${COLOR}">OpenStreetMap routing</div><h2>Directions</h2>
      <form class="fl-form" id="drForm" autocomplete="off">
        <input id="drFrom" maxlength="80" placeholder="From: a place, or pick on the globe" aria-label="From" value="${val(this.from)}" style="text-transform:none">
        <input id="drTo" maxlength="80" placeholder="To" aria-label="To" value="${val(this.to)}" style="text-transform:none;margin-top:6px">
      </form>
      <div class="acts" id="drModes">${Object.entries(MODE_WORD).map(([k, w]) => `<button class="chipbtn${this.mode === k ? ' on' : ''}" data-m="${k}" style="${this.mode === k ? 'color:#7dffa6' : ''}">${w}</button>`).join('')}</div>
      <div class="acts"><button class="chipbtn" data-pick="from">Pick start</button><button class="chipbtn" data-pick="to">Pick end</button><button class="chipbtn" id="drGo" style="color:#7dffa6">Route</button></div>
      <div id="drOut"></div><p class="note" style="margin-top:8px">Routes: FOSSGIS OSRM · © OpenStreetMap contributors. For exploring, not for navigation.</p>`;
    c.classList.add('show');
    c.querySelector('.x').onclick = () => { c.classList.remove('show'); this.stopPick(); };
    c.querySelector('#drModes').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; this.mode = b.dataset.m; this.open(); if (this.from && this.to) this.go(); };
    c.querySelector('#drForm').onsubmit = e => { e.preventDefault(); this.goFromInputs(); };
    c.querySelector('#drGo').onclick = () => this.goFromInputs();
    c.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => this.startPick(b.dataset.pick); });
    if (this.route) this.render();
  },
  async goFromInputs() {
    const f = $('#drFrom')?.value.trim(), t = $('#drTo')?.value.trim();
    try {
      const newF = f && (!this.from || f !== this.from.name), newT = t && (!this.to || t !== this.to.name);
      if (newF && newT && !/^-?\d/.test(f) && !/^-?\d/.test(t)) [this.from, this.to] = await resolvePair(f, t);   // both typed: the closest pair
      else { if (newF) this.from = await where(f); if (newT) this.to = await where(t); }
    } catch (e) { toast('Directions: ' + e.message, 4000); return; }
    if (!this.from || !this.to) { toast('Directions need a start and an end', 3000); return; }
    return this.go();
  },
  /** Route between two places ({ name, lat, lon }), draw it, frame it. Resolves with the route or throws. */
  async go(from = this.from, to = this.to, mode = this.mode) {
    Object.assign(this, { from, to, mode });
    const [host, prof] = PROFILE[mode] || PROFILE.drive;
    const url = `https://routing.openstreetmap.de/${host}/route/v1/${prof}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
    let d;
    try { const r = await fetch(url, { signal: ctl.signal }); d = await r.json().catch(() => null); if (!r.ok && !(d && d.code)) throw new Error('HTTP ' + r.status); }   // OSRM answers "no route" as HTTP 400 with a code
    catch (e) { toast('Routing is unavailable right now: ' + (e.name === 'AbortError' ? 'timeout' : e.message), 4500); throw e; }
    finally { clearTimeout(timer); }
    if (d.code !== 'Ok' || !d.routes || !d.routes[0]) { toast(`No ${MODE_WORD[mode].toLowerCase()} route between those places${haversine([from.lon, from.lat], [to.lon, to.lat]) > 1e6 ? ' (they are over 1,000 km apart)' : ''}`, 4500); throw new Error(d.code || 'no route'); }
    const r = d.routes[0], coords = r.geometry.coordinates;
    this.route = { coords, line: measure(coords), distance: r.distance, duration: r.duration, steps: (r.legs || []).flatMap(l => l.steps || []) };
    this.draw(); this.render(); this.frame();
    return this.route;
  },
  draw() {
    this.clearDrawing();
    const pos = this.route.coords.map(([lon, lat]) => C.Cartesian3.fromDegrees(lon, lat));
    ents.push(viewer.entities.add({ polyline: { positions: pos, clampToGround: true, width: 7, material: new C.PolylineGlowMaterialProperty({ color: C.Color.fromCssColorString(COLOR), glowPower: 0.25 }) } }));
    for (const [p, label, col] of [[this.from, 'A', '#7dffa6'], [this.to, 'B', '#ff7b4f']]) {
      ents.push(viewer.entities.add({ position: C.Cartesian3.fromDegrees(p.lon, p.lat), point: { pixelSize: 11, color: C.Color.fromCssColorString(col), outlineColor: C.Color.BLACK, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: label, font: '600 13px IBM Plex Mono, monospace', pixelOffset: new C.Cartesian2(0, -18), fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    }
  },
  clearDrawing() { for (const e of ents) viewer.entities.remove(e); ents = []; },
  clear() { this.stopFly(); this.clearDrawing(); this.route = null; },
  frame() {
    release();
    const xs = this.route.coords.map(c => c[0]), ys = this.route.coords.map(c => c[1]);
    const pad = Math.max(0.004, (Math.max(...ys) - Math.min(...ys)) * 0.25, (Math.max(...xs) - Math.min(...xs)) * 0.15);
    camera.flyTo({ destination: C.Rectangle.fromDegrees(Math.min(...xs) - pad, Math.min(...ys) - pad * 1.6, Math.max(...xs) + pad, Math.max(...ys) + pad), duration: 2.2 });
  },
  render() {
    const out = $('#drOut'); if (!out || !this.route) return;
    const r = this.route;
    out.innerHTML = `<dl style="margin-top:10px"><dt>${esc(MODE_WORD[this.mode])}</dt><dd>${esc(distanceText(r.distance))} · ${esc(durationText(r.duration))}</dd></dl>
      <div class="acts"><button class="chipbtn" id="drFly" style="color:#7dffa6">▶ Fly it</button><button class="chipbtn" id="drClear">Clear</button></div>
      <ol class="note" style="margin:8px 0 0 18px;padding:0;max-height:180px;overflow:auto">${r.steps.map(s => `<li>${esc(instruction(s))}${s.distance > 0 ? ` <span style="color:var(--faint)">· ${esc(distanceText(s.distance))}</span>` : ''}</li>`).join('')}</ol>`;
    out.querySelector('#drFly').onclick = () => this.fly();
    out.querySelector('#drClear').onclick = () => { this.clear(); out.innerHTML = ''; };
  },

  // ---- picking A or B on the globe
  startPick(which) {
    this.picking = which; state.picking = true; scene.canvas.style.cursor = 'crosshair';
    toast(`Click the globe to set the ${which === 'from' ? 'start' : 'end'}`, 3000);
  },
  stopPick() { this.picking = null; state.picking = false; scene.canvas.style.cursor = ''; },
  pickAt(win) {
    const p = camera.pickEllipsoid(win, C.Ellipsoid.WGS84); if (!p) return;
    const g = C.Cartographic.fromCartesian(p), lat = C.Math.toDegrees(g.latitude), lon = C.Math.toDegrees(g.longitude);
    this[this.picking] = { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon };
    this.stopPick(); this.open(); if (this.from && this.to) this.go().catch(() => {});
  },

  // ---- fly it: the camera leads the route, banking gently into turns
  fly() {
    if (!this.route) return;
    this.stopFly(); release(); hooks.clearPresets?.();
    const line = this.route.line, speed = this.mode === 'walk' ? 45 : this.mode === 'cycle' ? 70 : 140;   // metres of route per second of film
    const dur = Math.min(90, Math.max(12, line.total / speed)), height = this.mode === 'walk' ? 140 : 260, back = height * 1.6;
    const t0 = performance.now(); let head = null;
    ctrl.enableInputs = false;
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / (dur * 1000)), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;   // ease in and out
      const d = e * line.total, here = pointAt(line, d), ahead = pointAt(line, Math.min(line.total, d + Math.max(120, height)));
      let b = bearing(here, ahead); if (head == null) head = b;
      const diff = ((b - head + 540) % 360) - 180; head = (head + diff * 0.06 + 360) % 360;   // smooth heading: no snapping at corners
      const r = C.Math.toRadians(head), dLat = -Math.cos(r) * back / 111320, dLon = -Math.sin(r) * back / (111320 * Math.cos(C.Math.toRadians(here[1])));
      camera.setView({ destination: C.Cartesian3.fromDegrees(here[0] + dLon, here[1] + dLat, height), orientation: { heading: r, pitch: C.Math.toRadians(-32), roll: C.Math.toRadians(C.Math.clamp(-diff * 0.25, -8, 8)) } });
      if (u >= 1) { this.stopFly(); return; }
    };
    flight = scene.preUpdate.addEventListener(step);
    const stop = e => { if (e.type === 'keydown' && e.key !== 'Escape') return; this.stopFly(); };
    this._stop = stop; for (const ev of ['pointerdown', 'wheel', 'keydown']) addEventListener(ev, stop, { capture: true, passive: true });
    toast(`Flying the ${distanceText(line.total)} route · any click or Esc stops`, 3500);
  },
  stopFly() {
    if (flight) { flight(); flight = null; }
    if (this._stop) { for (const ev of ['pointerdown', 'wheel', 'keydown']) removeEventListener(ev, this._stop, { capture: true }); this._stop = null; }
    ctrl.enableInputs = true;
  },
};

// clicks while picking a start or an end (ui.js skips its own click handling while state.picking is set)
new C.ScreenSpaceEventHandler(scene.canvas).setInputAction(c => { if (Directions.picking) Directions.pickAt(c.position); }, C.ScreenSpaceEventType.LEFT_CLICK);
