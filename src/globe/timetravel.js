// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Time travel (band → Time travel, #go=history): a timeline scrubber on the globe's one clock, a date box, steps back,
// "on this day in history" moments, and an honest account of what the layers show at the time shown. The layers follow
// the clock themselves (quakes.js, storms.js, events.js, satellites.js travel()); this panel only moves the clock and
// says what came back. Ranges, moments and the table of what has history: core/history.js.
import { C, esc, fmt, store } from './env.js';
import { camera } from './viewer.js';
import { L, syncDock } from './layers.js';
import { hooks } from './state.js';
import { release } from './follow.js';
import { Time } from './time.js';
import { Quakes } from './quakes.js';
import { Storms } from './storms.js';
import { Events } from './events.js';
import { Sats } from './satellites.js';
import { jdFromMs } from '../core/time.js';
import { HISTORY, MOMENTS, STEPS_BACK, MAX_GAP_DAYS, QUAKES_FROM, isPast, momentMs, scrubRange, DAY_MS } from '../core/history.js';

const utc = ms => new Date(Math.round(ms / 1000) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const dateOf = ms => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
let el = null, range = null, lastSet = 0, pending = null;

function go(ms, { keepRange = false } = {}) {
  ms = Math.min(Date.now(), Math.max(Date.UTC(1800, 0, 1), ms));
  Time.setJd(jdFromMs(ms), 0);   // paused at that moment: press ▶ or a rate on the time bar to let it run from there
  if (!keepRange) range = null;
  render();
}
function turnOn(ids) {
  let changed = false;
  for (const id of ids) if (L[id] && !L[id].on) { L[id].on = true; store.set('ly.' + id, true); changed = true; }
  if (changed) { syncDock(); hooks.applyVisibility(); }
}

function statusRows() {
  const ms = Time.nowMs(), past = isPast(ms), off = id => `<button class="chipbtn tt-on" data-on="${id}">switch on</button>`;
  if (!past) return '<p class="note">Live. Drag the slider, pick a date or a moment below to go back; the layers below switch to their archives.</p>';
  const q = !L.quakes.on ? off('quakes') : ms < QUAKES_FROM ? 'none: the catalogue starts in 1900' : Quakes.loading ? 'asking the USGS catalogue…' : `${fmt(Quakes.list.length)} M2.5+ in the 24 h before`;
  const st = !L.storms.on ? off('storms') : Storms.loading ? 'loading past tracks…' : Storms.list.length ? Storms.list.slice(0, 4).map(s => esc(s.title)).join(', ') + (Storms.list.length > 4 ? ` +${Storms.list.length - 4}` : '') : 'none going on';
  const ev = !L.events.on ? off('events') : `${fmt(Events.list.length)} going on`;
  const h = Sats.history, sat = !h ? '…' : h.archived + h.today === 0 ? `hidden: no element sets within ${MAX_GAP_DAYS} days of this time (the archive keeps 30 days)`
    : [h.archived ? `${fmt(h.archived)} from the ${esc(h.day)} archive` : '', h.today ? `${fmt(h.today)} from today's elements` : '', h.hidden ? `${fmt(h.hidden)} hidden (nothing within ${MAX_GAP_DAYS} days)` : ''].filter(Boolean).join(' · ');
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  return `<dl class="tt-st">${row('Earthquakes', q)}${row('Cyclones', st)}${row('Natural events', ev)}${row('Aircraft, launches', 'live or upcoming only: hidden')}${row('Satellites', sat)}${row('Cameras, ships, transit', 'live only: still showing now')}</dl>`;
}

function render() {
  if (!el || el.hidden) return;
  const ms = Time.nowMs(), now = Date.now();
  if (!range || ms < range.from || ms > range.to) range = scrubRange(ms, now);
  const slide = el.querySelector('#ttSlide');
  if (document.activeElement !== slide) { slide.min = 0; slide.max = Math.round((range.to - range.from) / 60e3); slide.value = Math.round((ms - range.from) / 60e3); }
  el.querySelector('#ttFrom').textContent = dateOf(range.from); el.querySelector('#ttTo').textContent = range.to >= now - 60e3 ? 'now' : dateOf(range.to);
  el.querySelector('#ttNow').textContent = utc(ms);
  el.querySelector('#ttAgo').textContent = !isPast(ms) ? 'live' : (() => { const d = (now - ms) / DAY_MS; return d < 2 ? `${Math.round(d * 24)} hours ago` : d < 730 ? `${Math.round(d)} days ago` : `${Math.round(d / 365.25)} years ago`; })();
  const box = el.querySelector('#ttWhen'); if (document.activeElement !== box) box.value = new Date(Math.round(ms / 60e3) * 60e3).toISOString().slice(0, 16);
  el.querySelector('#ttStatus').innerHTML = statusRows();
}

function build() {
  el = document.createElement('section'); el.id = 'tt'; el.className = 'glass'; el.hidden = true; el.setAttribute('aria-label', 'Time travel');
  el.innerHTML = `<button class="x" aria-label="Close time travel">×</button>
    <div class="k" style="--c:#c9a0ff">Time travel · one clock for the globe</div>
    <div class="tt-when"><b id="ttNow" class="mono">—</b><span id="ttAgo"></span></div>
    <div class="tt-slide"><span id="ttFrom"></span><input type="range" id="ttSlide" aria-label="Time shown" step="10"><span id="ttTo"></span></div>
    <div class="tt-row"><button class="chipbtn" data-step="-86400000">−1 day</button><button class="chipbtn" data-step="-3600000">−1 h</button><button class="chipbtn" data-step="3600000">+1 h</button><button class="chipbtn" data-step="86400000">+1 day</button>
      <label class="tt-date">UTC <input type="datetime-local" id="ttWhen" aria-label="Date and time, UTC"></label></div>
    <div class="tt-row">${STEPS_BACK.map(([label, back]) => `<button class="chipbtn" data-back="${back}">${esc(label)}</button>`).join('')}<button class="chipbtn" data-live="1">Now</button><button class="chipbtn" data-link="1">Copy link</button></div>
    <div id="ttStatus"></div>
    <h3 class="tt-h">On this day in history</h3>
    <div class="tt-moments">${MOMENTS.map(m => `<button class="chipbtn" data-m="${m.id}" title="${esc(utc(momentMs(m)) + ': ' + m.note)}">${esc(m.name)}<span style="color:var(--faint);margin-left:6px">${new Date(momentMs(m)).getUTCFullYear()}</span></button>`).join('')}</div>
    <details class="tt-what"><summary>What has history, and what is live only</summary><dl>${HISTORY.map(h => `<dt>${h.has ? '✓' : '✗'} ${esc(h.what)}</dt><dd>${h.has ? esc(h.back) + ': ' : ''}${esc(h.src)}</dd>`).join('')}</dl></details>`;
  document.body.append(el);
  el.querySelector('.x').onclick = () => TimeTravel.close();
  const slide = el.querySelector('#ttSlide');
  slide.addEventListener('input', () => {   // scrubbing: at most ~8 clock moves a second (each one re-checks every layer)
    pending = range.from + +slide.value * 60e3;
    const t = performance.now(); if (t - lastSet < 120) return; lastSet = t; go(pending, { keepRange: true });
  });
  slide.addEventListener('change', () => { if (pending != null) go(pending, { keepRange: true }); pending = null; slide.blur(); });
  el.querySelector('#ttWhen').addEventListener('change', e => { const ms = Date.parse(e.target.value + 'Z'); if (Number.isFinite(ms)) go(ms); });
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.step) go(Time.nowMs() + +b.dataset.step, { keepRange: true });
    else if (b.dataset.back) go(Date.now() - +b.dataset.back);
    else if (b.dataset.live) { Time.goLive(); range = null; render(); }
    else if (b.dataset.link) hooks.shareCopy();
    else if (b.dataset.on) { turnOn([b.dataset.on]); render(); }
    else if (b.dataset.m) TimeTravel.moment(b.dataset.m);
  });
}

export const TimeTravel = {
  get open() { return !!el && !el.hidden; },
  show() { if (!el) build(); el.hidden = false; document.body.classList.add('tt-open'); range = null; render(); },
  close() { if (el) el.hidden = true; document.body.classList.remove('tt-open'); hooks.clearPresets?.(); },
  toggle() { this.open ? this.close() : this.show(); },
  /** Go to one of the moments: its time (paused), its layers on, the camera over the place. */
  moment(id) {
    const m = MOMENTS.find(x => x.id === id); if (!m) return;
    turnOn(m.on); go(momentMs(m)); release();
    // the panel covers the lower part of the screen: look from a little south, so the place sits in the upper half
    const south = Math.min(20, 0.22 * m.at[2] / 111e3);
    camera.flyTo({ destination: C.Cartesian3.fromDegrees(m.at[0], Math.max(-85, m.at[1] - south), m.at[2]), orientation: { heading: 0, pitch: C.Math.toRadians(-90), roll: 0 }, duration: 2.5 });
  },
  render,
};
hooks.historyChanged = () => render();
hooks.historyOpen = () => TimeTravel.open;
Time.onChange(render);
setInterval(() => { if (TimeTravel.open && !Time.live) render(); }, 1000);
