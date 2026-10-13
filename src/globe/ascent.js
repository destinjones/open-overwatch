// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Launch replay: a reconstructed ascent (core/ascent.js) for any launch in the list: the flown path bright, the rest
// dashed, a chase camera, a T+ clock with the usual events, and scrubbing at 0.25x-16x. Always labelled an estimate:
// it is built from the pad and the target orbit, not from telemetry.
import { C, $, esc, fmt } from './env.js';
import { scene, camera, ctrl } from './viewer.js';
import { hooks } from './state.js';
import { release } from './follow.js';
import { ascentProfile, sample, eventAt } from '../core/ascent.js';

const ORANGE = C.Color.fromCssColorString('#ff9f5c');
let prims = null, frame = null, ui = 0;
const pos = s => C.Cartesian3.fromDegrees(s.lon, s.lat, s.altKm * 1000);
const tplus = t => `T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export const Ascent = {
  l: null, p: null, t: 0, rate: 4, playing: false, chase: true, last: 0,
  play(l) {
    this.stop(); release(); hooks.clearPresets?.();
    this.l = l; this.p = ascentProfile(l); this.t = 0; this.rate = 4; this.playing = true; this.chase = true; this.last = performance.now();
    const all = []; for (let t = 0; t <= this.p.tEnd; t += 4) all.push(pos(sample(this.p, t)));
    prims = { lines: scene.primitives.add(new C.PolylineCollection()), pts: scene.primitives.add(new C.PointPrimitiveCollection()), labels: scene.primitives.add(new C.LabelCollection()) };
    prims.lines.add({ positions: all, width: 1.5, material: C.Material.fromType('PolylineDash', { color: ORANGE.withAlpha(0.55), dashLength: 10 }) });
    prims.flown = prims.lines.add({ positions: [all[0], all[0]], width: 3, material: C.Material.fromType('PolylineGlow', { color: ORANGE, glowPower: 0.3 }) });
    prims.rocket = prims.pts.add({ position: all[0], pixelSize: 9, color: C.Color.WHITE, outlineColor: ORANGE, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY });
    prims.tag = prims.labels.add({ position: all[0], text: '', font: '500 12px IBM Plex Mono, monospace', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3,
      style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(14, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY });
    ctrl.enableInputs = false;
    frame = scene.preUpdate.addEventListener(() => this.tick());
    this.card(); ui = setInterval(() => this.readout(), 100);
  },
  tick() {
    const now = performance.now(), dt = (now - this.last) / 1000; this.last = now;
    if (this.playing) { this.t = Math.min(this.p.tEnd, this.t + dt * this.rate); if (this.t >= this.p.tEnd) this.playing = false; }
    const s = sample(this.p, this.t), P = pos(s);
    prims.rocket.position = P; prims.tag.position = P; prims.tag.text = `${tplus(this.t)}  ${fmt(s.altKm)} km`;
    const flown = []; for (let t = 0; t < this.t; t += 4) flown.push(pos(sample(this.p, t))); flown.push(P); if (flown.length < 2) flown.push(P);
    prims.flown.positions = flown;
    if (this.chase) {   // a three-quarter view from behind and to the side, so the arc over the Earth reads
      const ahead = pos(sample(this.p, Math.min(this.p.tEnd, this.t + 2))), up = C.Cartesian3.normalize(P, new C.Cartesian3());
      const v0 = C.Cartesian3.subtract(ahead, P, new C.Cartesian3()), v = C.Cartesian3.normalize(C.Cartesian3.subtract(v0, C.Cartesian3.multiplyByScalar(up, C.Cartesian3.dot(v0, up), new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3());
      if (!Number.isFinite(v.x)) return;   // the horizontal heading (straight up at lift-off has none yet: keep the last view)
      const sideV = C.Cartesian3.normalize(C.Cartesian3.cross(v, up, new C.Cartesian3()), new C.Cartesian3()), dist = 14000 + s.altKm * 900;
      const off = C.Cartesian3.add(C.Cartesian3.add(C.Cartesian3.multiplyByScalar(v, -0.75 * dist, new C.Cartesian3()), C.Cartesian3.multiplyByScalar(sideV, 0.65 * dist, new C.Cartesian3()), new C.Cartesian3()), C.Cartesian3.multiplyByScalar(up, 0.18 * dist, new C.Cartesian3()), new C.Cartesian3());
      const eye = C.Cartesian3.add(P, off, new C.Cartesian3());
      const dir = C.Cartesian3.normalize(C.Cartesian3.subtract(P, eye, new C.Cartesian3()), new C.Cartesian3());
      const side = C.Cartesian3.normalize(C.Cartesian3.cross(dir, up, new C.Cartesian3()), new C.Cartesian3());
      camera.setView({ destination: eye, orientation: { direction: dir, up: C.Cartesian3.cross(side, dir, new C.Cartesian3()) } });
    }
  },
  card() {
    const c = $('#card'), l = this.l, p = this.p; hooks.clearSelection?.();
    c.innerHTML = `<button class="x" aria-label="Close">×</button><div class="k" style="--c:#ff9f5c">Launch replay · reconstructed estimate</div><h2>${esc(l.mission)}</h2>
      <p class="lc-cd" id="asT">T+00:00</p><dl id="asRead"></dl>
      <input type="range" id="asScrub" min="0" max="${p.tEnd}" step="1" value="0" aria-label="Time after lift-off" style="width:100%;margin:10px 0 4px">
      <div class="acts" id="asRates">${[0.25, 1, 4, 16].map(r => `<button class="chipbtn" data-r="${r}">${r}×</button>`).join('')}<button class="chipbtn" id="asPlay">❚❚</button><button class="chipbtn" id="asCam">Free camera</button></div>
      <p class="note" style="margin-top:8px">${esc(l.rocket)} from ${esc(l.pad || l.place)} to ${esc(p.name)}, heading ${Math.round(p.az)}°. Built from the pad and the target orbit with a generic two-stage climb: not telemetry, and event times are typical, not this flight's.</p>`;
    c.classList.add('show');
    c.querySelector('.x').onclick = () => { this.stop(); c.classList.remove('show'); };
    c.querySelector('#asScrub').oninput = e => { this.t = +e.target.value; };
    c.querySelector('#asRates').onclick = e => { const b = e.target.closest('[data-r]'); if (b) { this.rate = +b.dataset.r; this.playing = true; } };
    c.querySelector('#asPlay').onclick = () => { if (this.t >= this.p.tEnd) this.t = 0; this.playing = !this.playing; };
    c.querySelector('#asCam').onclick = e => { this.chase = !this.chase; ctrl.enableInputs = !this.chase; e.target.textContent = this.chase ? 'Free camera' : 'Chase camera'; };
  },
  readout() {
    const s = sample(this.p, this.t), el = id => document.getElementById(id); if (!el('asT')) { this.stop(); return; }
    el('asT').textContent = `${tplus(this.t)} · ${eventAt(this.t, this.p.sub)}`;
    el('asRead').innerHTML = `<dt>Altitude</dt><dd>${fmt(s.altKm)} km</dd><dt>Speed</dt><dd>${(s.speedKms).toFixed(2)} km/s</dd><dt>Downrange</dt><dd>${fmt(s.downrangeKm)} km</dd>`;
    const sc = el('asScrub'); if (document.activeElement !== sc) sc.value = String(Math.round(this.t));
    el('asPlay').textContent = this.playing ? '❚❚' : '▶';
    document.querySelectorAll('#asRates [data-r]').forEach(b => b.style.color = +b.dataset.r === this.rate ? '#ff9f5c' : '');
  },
  stop() {
    if (frame) { frame(); frame = null; } clearInterval(ui);
    if (prims) { scene.primitives.remove(prims.lines); scene.primitives.remove(prims.pts); scene.primitives.remove(prims.labels); prims = null; }
    ctrl.enableInputs = true; this.playing = false;
  },
};
hooks.ascent = l => Ascent.play(l);
