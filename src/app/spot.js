// The long press on the globe and the 2D map: hold a finger still for half a second and that spot opens: its
// coordinates (decimal, degrees-minutes-seconds, MGRS), Copy, a link that opens the 3D globe there with a pin, and on
// the globe a pin in the drawing (Measure) and the country it is in; on the 2D map the probe (weather, place, OSM).
// Touch only: a mouse has a right button and the views already use it.

import { isLongPress } from '../core/pwa.js';
import { describeSpot, spotLink } from '../core/spot.js';
import { esc } from '../core/format.js';
import { announce } from './a11y.js';

const HOLD = 550, SLOP = 10;

/** Watch `el` for a still single-finger hold; call fire(x, y) with client coordinates. */
export function watchLongPress(el, fire, { blocked = () => false } = {}) {
  const down = new Map();
  let timer = 0, start = null, firedAt = 0;
  const cancel = () => { clearTimeout(timer); timer = 0; start = null; };
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    down.set(e.pointerId, e);
    if (down.size !== 1 || blocked()) { cancel(); return; }   // a second finger: a pinch or a tilt, not a press
    start = { id: e.pointerId, t: performance.now(), x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => {
      const s = start; if (!s) return;
      if (!isLongPress(s.t, s.x, s.y, performance.now(), s.cx, s.cy, HOLD, SLOP)) return;
      firedAt = performance.now(); timer = 0;
      fire(s.x, s.y);
    }, HOLD);
  }, true);
  el.addEventListener('pointermove', e => {
    if (!start || e.pointerId !== start.id) return;
    start.cx = e.clientX; start.cy = e.clientY;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel();
  }, true);
  const up = e => { down.delete(e.pointerId); if (start && e.pointerId === start.id) cancel(); };
  el.addEventListener('pointerup', up, true);
  el.addEventListener('pointercancel', up, true);
  // the browser's own long-press menu (and Android's "image saved" bubble) would cover the card
  el.addEventListener('contextmenu', e => { if (performance.now() - firedAt < 1500 || start) e.preventDefault(); });
  return { get firedAt() { return firedAt; } };
}

const copy = async (text, btn) => {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* no clipboard (http, old browser) */ }
  if (!ok) { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch { } ta.remove(); }
  if (btn) { const was = btn.textContent; btn.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => { btn.textContent = was; }, 1600); }
  announce(ok ? 'Copied' : 'Could not copy');
};
const siteBase = () => new URL('../../', import.meta.url).href;
const rows = s => `<dl><dt>Decimal</dt><dd class="mono">${esc(s.decimal)}</dd><dt>Degrees</dt><dd class="mono">${esc(s.dms)}</dd>${s.mgrs ? `<dt>MGRS</dt><dd class="mono">${esc(s.mgrs)}</dd>` : ''}</dl>`;

// ---- the globe: a card like any other selection (ui.js select() takes a self-describing object) ----
async function initGlobe() {
  const el = document.getElementById('globe'); if (!el) return;
  const { state } = await import('../globe/state.js');   // the globe's own state (same module instance as its code)
  watchLongPress(el, (x, y) => {
    const O = window.OO3D, C = window.Cesium; if (!O || !C) return;
    const r = O.viewer.scene.canvas.getBoundingClientRect();
    const p = O.viewer.camera.pickEllipsoid(new C.Cartesian2(x - r.left, y - r.top), O.viewer.scene.globe.ellipsoid);
    if (!p) return;
    const g = C.Cartographic.fromCartesian(p), s = describeSpot(C.Math.toDegrees(g.latitude), C.Math.toDegrees(g.longitude));
    if (!s) return;
    // lifting the finger is also a click for Cesium, which would open the country under it over this card:
    // the globe ignores clicks while something is "picking", so pick until the finger is up
    state.picking = true;
    const release = () => { setTimeout(() => { state.picking = false; }, 350); removeEventListener('pointerup', release, true); removeEventListener('pointercancel', release, true); };
    addEventListener('pointerup', release, true); addEventListener('pointercancel', release, true);
    navigator.vibrate?.(12);
    const height = Math.min(2.5e5, Math.max(2000, O.viewer.camera.positionCartographic.height * 0.5));
    O.select({
      kind: 'spot', lat: s.lat, lon: s.lon, name: s.decimal,
      cardHtml: () => `<div class="k" style="--c:#7dffa6">This spot</div><h2 class="mono" style="font-size:17px">${esc(s.decimal)}</h2>${rows(s)}<p class="note" id="spotWhere" style="margin:6px 0 0"></p>
        <div class="acts"><button class="chipbtn" id="spotCopy">Copy</button><button class="chipbtn" id="spotShare" title="A link that opens the globe here, with a pin">Share</button><button class="chipbtn" id="spotPin" style="color:#ffd45c" title="Add a pin to your drawing (Measure)">Pin it</button></div>`,
      afterCard(card) {
        card.querySelector('#spotCopy').onclick = e => copy(s.plain, e.currentTarget);
        card.querySelector('#spotShare').onclick = async e => {
          const url = spotLink(siteBase(), s.lat, s.lon, height);
          if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: 'A spot on Open Overwatch', url }); return; } catch (err) { if (err && err.name === 'AbortError') return; } }
          copy(url, e.currentTarget);
        };
        card.querySelector('#spotPin').onclick = () => { const M = O.Measure; if (!M) return; M.open('pin'); M.addPoint([s.lon, s.lat], g.height || 0); M.disarm(); M.update?.(); announce('Pinned'); };
        O.Country?.at(s.lon, s.lat).then(k => {
          const w = card.querySelector('#spotWhere'); if (!w) return;
          if (!k) { w.textContent = 'Open water'; return; }
          w.innerHTML = `In <a href="#" id="spotCountry">${esc(k.name || k.iso || 'a country')}</a>`;
          w.querySelector('#spotCountry').onclick = ev => { ev.preventDefault(); O.select(k); };
        }).catch(() => {});
      },
    });
    announce('This spot: ' + s.spoken);
  }, { blocked: () => state.picking || state.lookup });
}

// ---- the 2D map: a Leaflet popup ----
function initMap() {
  const el = document.getElementById('map'); if (!el) return;
  let suppressClick = 0;
  // the finger lifting after a long press must not also run the map's tap (the probe card)
  el.addEventListener('click', e => { if (performance.now() - suppressClick < 800) { e.stopPropagation(); e.preventDefault(); } }, true);
  watchLongPress(el, (x, y) => {
    const OW = window.OW, L = window.L; if (!OW || !OW.map || !L) return;
    const r = OW.map.getContainer().getBoundingClientRect(), ll = OW.map.containerPointToLatLng(L.point(x - r.left, y - r.top));
    const s = describeSpot(ll.lat, ll.lng); if (!s) return;
    suppressClick = performance.now();
    navigator.vibrate?.(12);
    const box = document.createElement('div'); box.className = 'oo-spot';
    box.innerHTML = `<b>This spot</b>${rows(s)}<div class="oo-spot-acts"><button type="button" class="btn small" data-a="copy">Copy</button><button type="button" class="btn small" data-a="probe">What's here</button><a class="btn small" href="${esc(spotLink(siteBase(), s.lat, s.lon, Math.max(3000, 4e7 / 2 ** OW.map.getZoom())))}">3D globe</a></div>`;
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a === 'copy') copy(s.plain, b);
      else if (b.dataset.a === 'probe') { OW.map.closePopup(); OW.Probe?.open(ll); }
    });
    L.popup({ className: 'oo-spot-pop', maxWidth: 300, autoPanPadding: [20, 60] }).setLatLng(ll).setContent(box).openOn(OW.map);
    announce('This spot: ' + s.spoken);
  });
}

export function initLongPress(page) {
  if (page === 'globe') initGlobe().catch(e => console.warn('[oo] long press:', e));
  else if (page === 'map') initMap();
}
