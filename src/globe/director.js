// Director: shots to fly through, for clips and demos. Frame a view, Add it (the sensor look comes along), set how long
// the flight to it takes, then Play; Cinema hides every control for a clean screen recording. Scenes travel as a link
// (#scene=…, core/scene.js) or a .json file. Esc or a click stops playback.
import { C, $, esc, toast } from './env.js';
import { camera, camHeight } from './viewer.js';
import { hooks } from './state.js';
import { release } from './follow.js';
import { Ops } from './ops.js';
import { encodeScene, decodeScene, parseSceneFile, sceneFile } from '../core/scene.js';

const deg = C.Math.toDegrees, rad = C.Math.toRadians;
const where = s => `${s.h > 1e5 ? Math.round(s.h / 1000).toLocaleString('en-US') + ' km' : Math.round(s.h).toLocaleString('en-US') + ' m'} · ${Math.abs(s.lat).toFixed(2)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(2)}°${s.lon >= 0 ? 'E' : 'W'}`;

export const Director = {
  shots: [], title: 'My scene', playing: false, loop: false, cinema: false, run: 0,
  add() {
    const c = camera.positionCartographic;
    this.shots.push({ lon: deg(c.longitude), lat: deg(c.latitude), h: c.height, heading: deg(camera.heading), pitch: deg(camera.pitch), roll: deg(camera.roll), dur: this.shots.length ? 5 : 0, hold: 1, sensor: Ops.sensor });
    this.open();
  },
  open() {
    const card = $('#card'); hooks.clearSelection?.();
    card.innerHTML = `<button class="x" aria-label="Close">×</button><div class="k" style="--c:#b48cff">Director</div><h2>${esc(this.title)}</h2>
      <p class="note" style="margin:0 0 8px">Frame a view and press <b>Add shot</b> (the sensor look comes along). <b>Play</b> flies through them; <b>Cinema</b> hides the controls so a screen recording is clean.</p>
      <div class="cjl" id="dirList">${this.shots.length ? this.shots.map((s, i) => `<div class="cj" style="display:flex;gap:8px;align-items:center;cursor:default"><span style="flex:1"><b>${i + 1}</b> · ${esc(where(s))} · ${esc(s.sensor.toUpperCase())}</span>
        ${i ? `<label class="note" title="Seconds to fly here">fly <input type="number" min="0" max="120" step="0.5" value="${s.dur}" data-dur="${i}" style="width:52px"></label>` : ''}<button class="chipbtn" data-go="${i}" title="Go to this shot">◎</button><button class="chipbtn" data-del="${i}" title="Remove">✕</button></div>`).join('') : '<p class="note">No shots yet.</p>'}</div>
      <div class="acts"><button class="chipbtn" id="dirAdd" style="color:#7dffa6">+ Add shot</button><button class="chipbtn" id="dirPlay" style="color:#b48cff"${this.shots.length < 2 ? ' disabled' : ''}>▶ Play</button>
        <label class="chipbtn"><input type="checkbox" id="dirCin"${this.cinema ? ' checked' : ''}> Cinema</label><label class="chipbtn"><input type="checkbox" id="dirLoop"${this.loop ? ' checked' : ''}> Loop</label></div>
      <div class="acts"><button class="chipbtn" id="dirLink"${this.shots.length ? '' : ' disabled'}>Copy link</button><button class="chipbtn" id="dirSave"${this.shots.length ? '' : ' disabled'}>Save file</button><button class="chipbtn" id="dirOpen">Open file</button><button class="chipbtn" id="dirClear"${this.shots.length ? '' : ' disabled'}>Clear</button></div>`;
    card.classList.add('show');
    const q = s => card.querySelector(s);
    q('.x').onclick = () => card.classList.remove('show');
    q('#dirAdd').onclick = () => this.add();
    q('#dirPlay').onclick = () => this.play();
    q('#dirCin').onchange = e => { this.cinema = e.target.checked; };
    q('#dirLoop').onchange = e => { this.loop = e.target.checked; };
    q('#dirLink').onclick = () => this.copyLink();
    q('#dirSave').onclick = () => this.save();
    q('#dirOpen').onclick = () => this.load();
    q('#dirClear').onclick = () => { this.shots = []; this.open(); };
    q('#dirList').onclick = e => {
      const g = e.target.closest('[data-go]'), d = e.target.closest('[data-del]');
      if (g) this.goto(this.shots[+g.dataset.go], 1.5);
      if (d) { this.shots.splice(+d.dataset.del, 1); if (this.shots[0]) this.shots[0].dur = 0; this.open(); }
    };
    q('#dirList').onchange = e => { const i = e.target.dataset.dur; if (i != null) this.shots[+i].dur = Math.max(0, Math.min(120, +e.target.value || 0)); };
  },
  goto(s, dur) {
    release(); Ops.setSensor(s.sensor);
    const dest = C.Cartesian3.fromDegrees(s.lon, s.lat, s.h), orientation = { heading: rad(s.heading), pitch: rad(s.pitch), roll: rad(s.roll) };
    return new Promise(res => {
      if (!dur) { camera.setView({ destination: dest, orientation }); res(); return; }
      camera.flyTo({ destination: dest, orientation, duration: dur, easingFunction: C.EasingFunction.QUADRATIC_IN_OUT, complete: res, cancel: res });
    });
  },
  async play() {
    if (this.shots.length < 2) return;
    const run = ++this.run; this.playing = true; hooks.clearPresets?.();
    if (this.cinema) document.body.classList.add('cinema');
    $('#card').classList.remove('show');
    const stop = e => { if (e.type === 'keydown' && e.key !== 'Escape') return; this.stop(); };
    this._stop = stop; setTimeout(() => { if (this._stop === stop) for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, stop, { capture: true }); }, 300);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    do {
      for (const [i, s] of this.shots.entries()) {
        if (run !== this.run) return;
        await this.goto(s, i === 0 ? 0 : s.dur);
        if (run !== this.run) return;
        await wait(Math.max(0.2, s.hold) * 1000);
      }
    } while (this.loop && run === this.run);
    if (run === this.run) this.stop();
  },
  stop() {
    this.run++; this.playing = false; camera.cancelFlight(); document.body.classList.remove('cinema');
    if (this._stop) { for (const ev of ['pointerdown', 'keydown']) removeEventListener(ev, this._stop, { capture: true }); this._stop = null; }
    this.open();
  },
  link() { return location.origin + location.pathname + '#scene=' + encodeScene(this.shots); },
  async copyLink() {
    const u = this.link(); if (u.length > 7000) { toast('Too many shots for a link: save a file instead', 4000); return; }
    try { await navigator.clipboard.writeText(u); toast('Scene link copied: it opens ready to play', 3000); } catch (e) { window.prompt('Copy this link:', u); }
  },
  save() {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([sceneFile(this.title, this.shots)], { type: 'application/json' }));
    a.download = (this.title || 'scene').replace(/[^\w-]+/g, '-').toLowerCase() + '.oo-scene.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  load() {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = async () => { const f = i.files[0]; if (!f || f.size > 200000) return; const p = parseSceneFile(await f.text()); if (!p || !p.shots.length) { toast('That file is not an Open Overwatch scene', 3500); return; } this.title = p.title; this.shots = p.shots; this.open(); };
    i.click();
  },
  /** A #scene= link: load it and offer to play (called once after boot). */
  restore() {
    const m = location.hash.match(/[#&]scene=([A-Za-z0-9_-]+)/); if (!m) return false;
    const shots = decodeScene(m[1]); if (!shots.length) return false;
    this.shots = shots; this.title = 'Shared scene'; this.goto(shots[0], 0); this.open(); toast(`A scene with ${shots.length} shots: press Play`, 4000); return true;
  },
};
Ops.onDirector = () => Director.open();
