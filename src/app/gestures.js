// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Touch on the two maps: a first-run hint card for phones (how to pinch, tilt and long-press), shown once per view
// and remembered, plus the long press itself (spot.js). ?hints=1 shows the card again; OOApp.hints() too.

import { hintsDue, hintsSeen, HINT_KEY } from '../core/pwa.js';
import { initLongPress } from './spot.js';

// little finger drawings: dots are fingertips, arrows the way they move (animated in shell.css unless motion is reduced)
const ART = {
  drag: '<circle class="f f-drag" cx="20" cy="24" r="6"/><path d="M28 24h12m-4-4 4 4-4 4"/>',
  pinch: '<circle class="f f-pa" cx="16" cy="30" r="5.5"/><circle class="f f-pb" cx="32" cy="18" r="5.5"/><path d="M9 37l-4 4m0-5v5h5M39 11l4-4m0 5V7h-5"/>',
  tilt: '<circle class="f f-t" cx="17" cy="28" r="5.5"/><circle class="f f-t" cx="31" cy="28" r="5.5"/><path d="M24 17V7m-4 4 4-4 4 4M24 35v6"/>',
  press: '<circle class="f" cx="24" cy="24" r="6"/><circle class="ring" cx="24" cy="24" r="12"/><circle class="ring r2" cx="24" cy="24" r="18"/>',
  tap2: '<circle class="f f-tap" cx="24" cy="26" r="6"/><path d="M17 14a10 10 0 0 1 14 0M13 10a16 16 0 0 1 22 0"/>',
  tap: '<circle class="f f-tap" cx="24" cy="26" r="6"/><path d="M17 14a10 10 0 0 1 14 0"/>',
};
const LINES = {
  globe: [
    ['drag', 'Drag', 'with one finger to turn the Earth'],
    ['pinch', 'Pinch', 'to zoom, from the stars down to street level'],
    ['tilt', 'Two fingers up or down', 'to tilt toward the horizon'],
    ['press', 'Long-press', 'any spot for its coordinates, a pin and a link to share'],
    ['tap2', 'Double-tap', 'a satellite or a plane to ride along with it'],
  ],
  map: [
    ['drag', 'Drag', 'to move the map, pinch to zoom'],
    ['tap', 'Tap', 'an aircraft, ship or quake for its details, or open ground for weather and what is there'],
    ['press', 'Long-press', 'any spot for its coordinates and to see it on the 3D globe'],
  ],
};

const store = {
  get() { try { return localStorage.getItem(HINT_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(HINT_KEY, v); } catch { } },
};
const coarse = () => matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
const embedded = () => { try { return window.top !== window || /[?&]embed\b/.test(location.search); } catch { return true; } };

/** The page has finished its own start: the globe's boot screen and the map's splash and welcome are gone. */
function ready(page) {
  if (page === 'globe') return !document.getElementById('boot');
  const splash = document.getElementById('splash'), welcome = document.getElementById('welcome');
  return (!splash || splash.hidden) && (!welcome || welcome.hidden);
}

let open = null;
export function showHints(page = document.documentElement.dataset.ooPage) {
  if (open || !LINES[page]) return;
  const prev = document.activeElement;
  const el = open = document.createElement('div');
  el.id = 'ooHints'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'ooHintsT');
  el.innerHTML = `<div class="oo-hints-card"><h2 id="ooHintsT">${page === 'globe' ? 'Getting around the globe' : 'Getting around the map'}</h2><ul>${LINES[page].map(([art, b, t]) =>
    `<li><svg viewBox="0 0 48 48" aria-hidden="true">${ART[art]}</svg><span><b>${b}</b> ${t}</span></li>`).join('')}</ul><button type="button" class="oo-hints-ok">Got it</button></div>`;
  const close = () => {
    if (!open) return;
    store.set(hintsSeen(page, store.get()));
    el.classList.add('out'); open = null;
    removeEventListener('keydown', key, true);
    setTimeout(() => el.remove(), 250);
    if (prev && prev.focus && document.contains(prev)) prev.focus();
  };
  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); el.querySelector('.oo-hints-ok').focus(); }   // one control: focus stays on it
  };
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('.oo-hints-ok')) close(); });
  addEventListener('keydown', key, true);
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.classList.add('in'); el.querySelector('.oo-hints-ok').focus({ preventScroll: true }); });
  return close;
}

export function initGestures(page) {
  initLongPress(page);
  if (!hintsDue(page, store.get(), { coarse: coarse(), embed: embedded(), search: location.search })) return;
  // wait for the view to finish starting (up to three minutes), then a moment more so the first frame is not covered
  const t0 = Date.now();
  const poll = setInterval(() => {
    if (Date.now() - t0 > 180e3) return clearInterval(poll);
    if (!ready(page)) return;
    clearInterval(poll);
    setTimeout(() => showHints(page), 1200);
  }, 500);
}
