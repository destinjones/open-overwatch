// Tower view: stand on the airport's tower and watch a plane come in or climb out, with a telephoto lens that keeps it
// about the same size in the frame (the field of view narrows as it gets further away; the wheel or a pinch zooms the
// lens on top of that). The eye is 45 m over the field (over the 3D terrain's ground there, when it is on). Esc, the
// card's button, or the plane leaving the feeds ends it and gives the camera back.
import { C, $, toast, PHONE } from './env.js';
import { scene, camera, ctrl } from './viewer.js';
import { state, hooks } from './state.js';
import { release } from './follow.js';
import { Air, AirModels } from './aircraft.js';
import { Terrain } from './terrain.js';
import { Saver } from './saver.js';
import { select } from './ui.js';
import { gcKm } from '../core/actype.js';

const TOWER_M = 45, SPAN_M = 90;   // eye height over the field; what the lens tries to keep across the frame
const D = Math.PI / 180;
// a bar at the top while watching: what, from where, how far, and the way out (phones have no Esc key)
const bar = document.createElement('div'); bar.id = 'towerBar'; bar.className = 'glass'; bar.setAttribute('role', 'status'); document.body.append(bar);

export const TowerView = {
  on: false, ap: null, r: null, eye: null, fov: null, zoom: 1, _t: new C.Cartesian3(), _d: new C.Cartesian3(), _u: new C.Cartesian3(), _s: new C.Cartesian3(),
  start(ap, r) {
    if (!ap || !r) return;
    if (this.on) this.stop(false);
    release();
    const ground = Terrain.on ? Math.max(ap.elevM, Terrain.near(ap.lat, ap.lon, 4, 0)) : ap.elevM;
    Object.assign(this, { on: true, ap, r, zoom: 1, fov: camera.frustum.fov, eye: C.Cartesian3.fromDegrees(ap.lon, ap.lat, ground + TOWER_M) });
    ctrl.enableInputs = false;
    hooks.towerAir = r;   // aircraft.js keeps its 3D model while the tower watches it
    if (state.selected !== r) select(r);
    AirModels.ensure(r);
    document.body.classList.add('tower-view');
    if (PHONE) $('#card').classList.remove('show');   // the picture is the point on a small screen
    bar.innerHTML = `<span id="twTxt"></span><button class="chipbtn" id="twExit">Leave the tower</button>`; bar.querySelector('#twExit').onclick = () => this.stop();
    toast(`Tower view at ${ap.iata || ap.icao}: watching ${(r.flight || r.hex).trim()} · scroll to zoom the lens, Esc to leave`, 4500);
  },
  stop(fly = true) {
    if (!this.on) return;
    const ap = this.ap;
    this.on = false; ctrl.enableInputs = true; if (this.fov) camera.frustum.fov = this.fov;
    document.body.classList.remove('tower-view');
    this.r = null; hooks.towerAir = null;
    if (fly && ap) camera.flyTo({ destination: C.Cartesian3.fromDegrees(ap.lon, ap.lat - 0.16, ap.elevM + 24000), orientation: { heading: 0, pitch: -35 * D, roll: 0 }, duration: 1.5 });
  },
  frame(time) {
    if (!this.on) return;
    const r = this.r;
    if (!r || Air.map.get(r.hex) !== r) { toast('The plane left the feeds', 3000); this.stop(); return; }
    if (!r.ent) AirModels.ensure(r);
    const target = AirModels.state(r, time).pos, eye = this.eye;
    const dist = C.Cartesian3.distance(eye, target);
    if (dist > 150e3) { toast(`${(r.flight || r.hex).trim()} is out of sight of the tower`, 3000); this.stop(); return; }
    const dir = C.Cartesian3.normalize(C.Cartesian3.subtract(target, eye, this._d), this._d);
    const upG = C.Cartesian3.normalize(eye, this._u), side = C.Cartesian3.normalize(C.Cartesian3.cross(dir, upG, this._s), this._s);
    const up = C.Cartesian3.cross(side, dir, this._t);
    camera.setView({ destination: eye, orientation: { direction: dir, up } });
    camera.frustum.fov = Math.max(0.6 * D, Math.min(60 * D, 2 * Math.atan(SPAN_M / 2 / dist) * 3 / this.zoom));
    if ((this._n = (this._n || 0) + 1) % 15 === 0) {   // the bar's words, a few times a second
      const t = bar.querySelector('#twTxt'); if (t) t.textContent = `${this.ap.iata || this.ap.icao} tower · ${(r.flight || r.hex).trim()} · ${dist > 9500 ? (dist / 1000).toFixed(0) + ' km' : (dist / 1000).toFixed(1) + ' km'} · ${r.ground ? 'on the ground' : Math.round((r.alt || 0) / 0.3048).toLocaleString('en-US') + ' ft'}`;
    }
  },
  /** Can this plane be watched from a field's tower? The airport within 40 km of it, or null. */
  towerFor(r, index) {
    if (!r || !index || !index.list.length) return null;
    const lat = r.cur?.lat ?? r.lat, lon = r.cur?.lon ?? r.lon, ap = index.nearest(lat, lon, 40);
    return ap && (r.ground || (r.alt || 0) - ap.elevM < 4000) && gcKm(ap.lat, ap.lon, lat, lon) < 40 ? ap : null;
  },
};
scene.preUpdate.addEventListener((sc, time) => TowerView.frame(time));
setInterval(() => { if (TowerView.on) Saver.wake(); }, 1000);   // full frame rate while watching
addEventListener('keydown', e => { if (e.key === 'Escape' && TowerView.on) { e.stopImmediatePropagation(); TowerView.stop(); } }, true);
addEventListener('wheel', e => { if (!TowerView.on) return; e.preventDefault(); TowerView.zoom = Math.max(0.3, Math.min(8, TowerView.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); }, { passive: false });
// phones: a two-finger pinch zooms the lens
let pinch = null;
addEventListener('touchmove', e => {
  if (!TowerView.on || e.touches.length !== 2) { pinch = null; return; }
  const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  if (pinch) TowerView.zoom = Math.max(0.3, Math.min(8, TowerView.zoom * d / pinch));
  pinch = d;
}, { passive: true });
addEventListener('touchend', () => { pinch = null; }, { passive: true });
