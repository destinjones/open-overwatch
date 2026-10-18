// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Falling soon: objects predicted to re-enter in the next 30 days, worked out here from the loaded element sets (core/decay.js:
// n-dot and B* drag through a solar-scaled atmosphere; no download of its own). The list in the details card, soonest first,
// each with its window in plain words; the "Re-entry corridors" layer (off by default) draws every object's ground track
// around its likeliest time. Picking one highlights its corridor and flies to it.
import { C, $, esc, toast, store } from './env.js';
import { scene, camera } from './viewer.js';
import { L, syncDock } from './layers.js';
import { state, hooks } from './state.js';
import { Sats } from './satellites.js';
import { fallingSoon, corridor, windowWords, spanText, uncertaintyWords, whereWords, status, WINDOW_FRACTION } from '../core/decay.js';
import { provBlock } from '../core/liveprov.js';

const lines = scene.primitives.add(new C.PolylineCollection());   // the layer: every object's likeliest orbit
const picked = scene.primitives.add(new C.PolylineCollection());  // the chosen object's whole corridor
const RED = '#ff5a4f', FAINT = 0.35, OVERVIEW_MS = 45 * 60e3;   // the layer draws ±45 min (one orbit) round the likeliest time
const REFRESH_MS = 30 * 60e3;   // the element sets refresh every few hours; the list is recomputed at most this often
const when = (p, now) => { const s = status(p, now), d = (p.reentryMs - now) / 864e5;
  return s === 'window' ? (d >= 0 ? `window open · likeliest in ${spanText(d)}` : `window open · likeliest ${spanText(-d)} ago`) : `in ${spanText(d)}`; };

export const Reentry = {
  list: null, at: 0, sel: null, drawn: false, busy: null,
  /** The prediction list, recomputed when older than REFRESH_MS (today's element sets even while time travelling). */
  async compute() {
    if (this.list && Date.now() - this.at < REFRESH_MS) return this.list;
    if (this.busy) return this.busy;
    this.busy = (async () => {
      await Sats.ready;
      const sats = Sats.list.map(s => ({ id: s.id, name: s.name, l1: s.today?.l1 || s.l1, l2: s.today?.l2 || s.l2, group: s.group, source: s.today?.source }));
      await new Promise(r => setTimeout(r, 0));
      this.list = fallingSoon(sats, { now: Date.now() });
      for (const p of this.list) p.corridor = corridor(p);
      this.at = Date.now(); this.drawn = false;
      return this.list;
    })().finally(() => { this.busy = null; });
    return this.busy;
  },
  draw() {
    lines.removeAll();
    const mat = C.Material.fromType('Color', { color: C.Color.fromCssColorString(RED).withAlpha(FAINT) });
    for (const p of this.list || []) for (const seg of p.corridor?.segments || []) {
      const near = seg.filter(q => Math.abs(q.t - p.reentryMs) <= OVERVIEW_MS);
      if (near.length > 1) lines.add({ positions: near.map(q => C.Cartesian3.fromDegrees(q.lon, q.lat, 20000)), width: 1.4, material: mat, id: { kind: 'reentry', p } });
    }
    this.drawn = true; this.highlight();
  },
  highlight() {
    picked.removeAll();
    const p = this.sel; if (!p) return;
    const mat = C.Material.fromType('Color', { color: C.Color.fromCssColorString('#ffb4ad').withAlpha(0.95) });
    for (const seg of p.corridor?.segments || []) picked.add({ positions: seg.map(q => C.Cartesian3.fromDegrees(q.lon, q.lat, 20000)), width: 3, material: mat });
  },
  async apply() {
    const on = L.reentry?.on && !state.lookup;
    lines.show = !!on; picked.show = !state.lookup;   // the picked corridor is emptied when its card goes (onCardClosed in show)
    if (!on) return;
    await this.compute();
    if (!this.drawn) this.draw();
  },
  async openList(id = null) {
    const card = $('#card'); state.selected = null; this.sel = null; this.highlight();
    const head = '<button class="x" aria-label="Close">×</button><div class="k" style="--c:' + RED + '">Re-entries · next 30 days</div><h2>Falling soon</h2>';
    card.innerHTML = head + '<p class="note">Working out decay for every loaded satellite…</p>';
    card.classList.add('show'); card.querySelector('.x').onclick = () => this.close();
    let list;
    try { list = await this.compute(); } catch (e) { card.innerHTML = head + `<p class="note">${esc(e.message)}</p>`; card.querySelector('.x').onclick = () => this.close(); return; }
    if (id) { const p = list.find(x => x.id === String(id)); if (p) return this.show(p); }
    const now = Date.now();
    const rows = list.slice(0, 80).map((p, i) => `<button class="cj" data-i="${i}" style="--c:${RED}"><b>${esc(when(p, now).replace(/^in /, ''))}</b><span>${esc(p.name)}${p.working ? '' : ' · debris'}</span><small>${esc(windowWords(p))} · ±${Math.round(p.fraction * 100)}%</small></button>`).join('');
    card.innerHTML = head + `<p class="note">Predicted here from each object's public orbit (CelesTrak element sets) and the drag it is feeling now. ` +
      `Each window is usually ±${Math.round(WINDOW_FRACTION * 100)}% of the time it has left (the upper air swells and shrinks with the Sun), wider when the two drag estimates disagree. Satellites with fuel can still change course. ` +
      `${Sats.list.length ? `${list.length} of ${Sats.list.length.toLocaleString('en-US')} loaded objects.` : ''}</p>` +
      `<div class="acts"><button class="chipbtn" id="reLayer">${L.reentry.on ? 'Hide' : 'Show'} all corridors</button></div>` +
      `<div class="cjl">${rows || '<p class="note">Nothing in the loaded groups is predicted to come down in the next 30 days.</p>'}</div>`;
    card.querySelector('.x').onclick = () => this.close();
    $('#reLayer').onclick = () => { this.setLayer(!L.reentry.on); $('#reLayer').textContent = (L.reentry.on ? 'Hide' : 'Show') + ' all corridors'; };
    card.querySelectorAll('.cj').forEach(b => { b.onclick = () => this.show(list[+b.dataset.i]); });
  },
  setLayer(on) {
    L.reentry.on = on; store.set('ly.reentry', on); syncDock(); hooks.applyVisibility();
  },
  /** One prediction's card: the window in plain words, why it is that wide, the orbit, the provenance block. */
  show(p) {
    this.sel = p; this.highlight();
    const now = Date.now(), c = p.corridor, sat = Sats.byId.get(p.id);
    const card = $('#card');
    card.innerHTML = `<button class="x" aria-label="Close">×</button><div class="k" data-re style="--c:${RED}">Re-entry · ${esc(when(p, now))}</div><h2>${esc(p.name)}</h2>
      <p class="note" style="font-size:13px;color:var(--ink)">Coming down ${esc(whereWords(p, c))}.</p><dl>
      <dt>Likeliest</dt><dd>${new Date(p.reentryMs).toISOString().slice(0, 16).replace('T', ' ')} UTC</dd>
      <dt>Window</dt><dd>±${Math.round(p.fraction * 100)}% · ${esc(spanText((p.windowMs[1] - p.windowMs[0]) / 864e5))}</dd>
      <dt>Orbit now</dt><dd>${Math.round(p.perigeeKm)} × ${Math.round(p.apogeeKm)} km · ${p.incl.toFixed(1)}°</dd>
      <dt>Drag</dt><dd>${p.ballistic.toFixed(4)} m²/kg (${p.method === 'n-dot' ? 'n-dot' : 'B*'})</dd>
      <dt>Catalogue</dt><dd>NORAD ${esc(p.id)}${p.group ? ' · ' + esc(p.group) : ''}</dd></dl>
      <p class="note">Why so wide: ${esc(uncertaintyWords(p))} Worked out from ${p.method === 'n-dot' ? 'how fast its orbit is shrinking (n-dot)' : 'its drag term (B*)'}${p.otherDays != null ? `; the other drag estimate says ${esc(spanText(p.otherDays))} left` : ''}.</p>
      <p class="note">${p.working ? 'A satellite in service: if it still has fuel, its operator can keep it up or bring it down on purpose, and this prediction would not apply. ' : ''}` +
      `Solar flux assumed F10.7 ${p.solar.f107} sfu, Kp ${p.solar.kp}. Each new element set (every few hours) moves the window; the closer it gets, the narrower it becomes.</p>
      ${provBlock(p, now)}
      <div class="acts"><button class="chipbtn" id="reGo">Fly to the corridor</button>${sat ? '<button class="chipbtn" id="reSat">Show the satellite</button>' : ''}<button class="chipbtn" id="reBack">All re-entries</button></div>`;
    card.classList.add('show');
    card.querySelector('.x').onclick = () => this.close();
    $('#reBack').onclick = () => this.openList();
    $('#reGo').onclick = () => this.fly(p);
    if (sat) $('#reSat').onclick = () => { this.unselect(); hooks.reselect?.(sat); };
    hooks.onCardClosed?.('data-re', () => { if (this.sel === p) this.unselect(); });   // the bright corridor shows only while its card is up
    this.fly(p);
  },
  fly(p) {
    const seg = p.corridor?.segments?.[0]; if (!seg) { toast('No corridor for this one'); return; }
    // over the likeliest time's point, high enough to see a few thousand km of track
    const pts = p.corridor.segments.flat(), mid = pts.reduce((a, b) => (Math.abs(b.t - p.reentryMs) < Math.abs(a.t - p.reentryMs) ? b : a));
    camera.flyTo({ destination: C.Cartesian3.fromDegrees(mid.lon, mid.lat, 9.0e6), duration: 1.6 });
  },
  unselect() { this.sel = null; this.highlight(); },
  close() { this.unselect(); $('#card').classList.remove('show'); },
};
hooks.reentry = id => Reentry.openList(id);
