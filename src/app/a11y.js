// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The accessibility layer every page shares. The views build most of their controls in JavaScript, so this works on
// the live page from a short description per page (PAGES below) instead of touching each view's code:
//   - names: buttons whose text is only a symbol (« ▶ ☰ ✕) get their title as a name, inputs their placeholder;
//   - keyboard: arrow keys, Home and End move along toolbars (the globe's band, time and layer dock, the map's views,
//     the Solar System's scale ladder); the map's Brief/Detail/Log/Setup tabs are real tabs; the globe turns, zooms
//     and tilts with the keyboard; Escape closes the Solar System's card;
//   - state: aria-pressed / aria-current / aria-selected follow the views' own "on" and "off" classes;
//   - announcements: a selection (a satellite, a country, a planet, an aircraft) is said once in a polite live region,
//     not re-read every time its card's numbers tick;
//   - a "skip to the controls" link, and focus rings for keyboard users only (shell.css).
// Reduced motion is in shell.css (animations and transitions off) and in the views' own camera flights.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---- announcements ----
let politeEl = null, assertEl = null, lastSaid = '', lastAt = 0;
function regions() {
  if (politeEl) return;
  politeEl = document.createElement('div'); politeEl.id = 'ooAnnounce'; politeEl.className = 'oo-sr'; politeEl.setAttribute('aria-live', 'polite'); politeEl.setAttribute('role', 'status');
  assertEl = document.createElement('div'); assertEl.id = 'ooAlert'; assertEl.className = 'oo-sr'; assertEl.setAttribute('aria-live', 'assertive'); assertEl.setAttribute('role', 'alert');
  document.body.append(politeEl, assertEl);
}
/** Say something to screen readers (once: the same words within 2 s are said once). */
export function announce(text, { urgent = false } = {}) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (!text || !document.body) return;
  regions();
  if (text === lastSaid && performance.now() - lastAt < 2000) return;
  lastSaid = text; lastAt = performance.now();
  const el = urgent ? assertEl : politeEl;
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 60);   // a changed text node is what screen readers notice
}

// ---- names ----
const HAS_WORD = /[\p{L}\p{N}]/u;
/** The name a screen reader would read for el, roughly (aria-label, labelledby, text, alt, title). */
export function nameOf(el) {
  const l = el.getAttribute('aria-label'); if (l && l.trim()) return l.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) { const t = by.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim(); if (t) return t; }
  if (el.labels && el.labels.length) { const t = [...el.labels].map(x => x.textContent).join(' ').trim(); if (t) return t; }
  const t = (el.innerText ?? el.textContent ?? '').trim();
  if (t && el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') return t;
  const img = el.querySelector && el.querySelector('img[alt]'); if (img && img.alt.trim()) return img.alt.trim();
  return (el.getAttribute('title') || '').trim();
}
/** Give controls under root a name where they have none, or only a symbol. Cheap enough to run on every card change. */
export function fixNames(root = document) {
  for (const el of $$('button, a[href], [role="button"]', root)) {
    if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) continue;
    const text = (el.textContent || '').trim(), title = (el.getAttribute('title') || '').trim();
    if (!HAS_WORD.test(text) && title) el.setAttribute('aria-label', title.replace(/\s*\(.*?\)\s*$/, ''));
    else if (!text && !title && el.classList.contains('x')) el.setAttribute('aria-label', 'Close');
    for (const svg of $$('svg', el)) if (!svg.hasAttribute('aria-hidden')) svg.setAttribute('aria-hidden', 'true');
  }
  for (const el of $$('input:not([type=hidden]):not([type=button]):not([type=submit]), select, textarea', root)) {
    if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || (el.labels && el.labels.length)) continue;
    const name = el.getAttribute('placeholder') || el.getAttribute('title');
    if (name) el.setAttribute('aria-label', name.replace(/[…:]+$/, '').trim());
  }
  for (const img of $$('img:not([alt])', root)) img.setAttribute('alt', '');
}

// ---- toolbars: arrow keys along a row (or column) of buttons ----
const focusables = box => $$('button, a[href], input, select, [tabindex="0"]', box).filter(el => !el.disabled && el.offsetParent !== null && el.getAttribute('aria-hidden') !== 'true');
/** The index to move to for a key in a list of n (null: not a moving key). */
export function stepIndex(key, i, n) {
  if (!n) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (i + 1) % n;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (i - 1 + n) % n;
  return null;
}
function toolbar(box, label) {
  if (!box || box.dataset.ooBar) return;
  box.dataset.ooBar = '1';
  if (!box.getAttribute('role') && box.tagName !== 'NAV') box.setAttribute('role', 'toolbar');
  if (!box.getAttribute('aria-label') && label) box.setAttribute('aria-label', label);
  box.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const list = focusables(box), i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const j = stepIndex(e.key, i, list.length);
    if (j === null) return;
    e.preventDefault(); list[j].focus();
    list[j].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
}

// ---- state attributes that follow the views' own classes ----
/** sync: [selector, attribute, (el) => value | null] — re-applied whenever the container's classes or children change. */
function follow(container, rules) {
  if (!container) return;
  const apply = () => {
    for (const [sel, attr, fn] of rules) for (const el of $$(sel, container)) {
      const v = fn(el);
      if (v === null) el.removeAttribute(attr); else if (el.getAttribute(attr) !== String(v)) el.setAttribute(attr, String(v));
    }
    fixNames(container);
  };
  apply();
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; apply(); }); } })
    .observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
}

// ---- a card or detail pane that says what was selected, once ----
function announceSelections(el, { visible, title, kind }) {
  if (!el) return;
  let said = '';
  const check = () => {
    if (!visible(el)) { said = ''; return; }
    const t = (title(el) || '').trim(); if (!t) return;
    const k = (kind && kind(el) || '').trim(), words = k ? `${k}: ${t}` : t;
    if (words !== said) { said = words; announce(words); }
  };
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; setTimeout(() => { queued = false; check(); fixNames(el); }, 120); } })
    .observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
}

/** A button that shows and hides a panel (on phones; on a desktop the panel may always be there): aria-expanded. */
function expands(btn, panel) {
  if (!btn || !panel) return;
  btn.setAttribute('aria-controls', panel.id);
  const sync = () => btn.setAttribute('aria-expanded', String(getComputedStyle(panel).display !== 'none'));
  sync();
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class', 'style'] });
}

// ---- tabs (the 2D map's side panel) ----
function tabs(list, { tab, panelOf, isOn }) {
  if (!list) return;
  list.setAttribute('role', 'tablist');
  const sync = () => {
    for (const t of $$(tab, list)) {
      const p = panelOf(t), on = isOn(t);
      t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      if (p) { if (!t.id) t.id = 'tab-btn-' + (t.dataset.tab || Math.random().toString(36).slice(2)); p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', t.id); t.setAttribute('aria-controls', p.id); }
    }
  };
  sync();
  new MutationObserver(sync).observe(list, { subtree: true, attributes: true, attributeFilter: ['class'] });
  list.addEventListener('keydown', e => {
    const all = $$(tab, list).filter(t => t.offsetParent !== null), i = all.indexOf(document.activeElement);
    const j = i < 0 ? null : stepIndex(e.key, i, all.length);
    if (j === null) return;
    e.preventDefault(); all[j].focus(); all[j].click();
  });
}

// ---- skip link ----
function skipLink(target, words) {
  const el = typeof target === 'string' ? $(target) : target;
  if (!el) return;
  const a = document.createElement('a');
  a.className = 'oo-skip'; a.href = '#'; a.textContent = words;
  a.addEventListener('click', e => {
    e.preventDefault();
    const t = typeof target === 'string' ? $(target) : target;
    const f = t && (t.matches('button, a[href], input, select, [tabindex]') ? t : focusables(t)[0]);
    if (f) { f.focus(); f.scrollIntoView?.({ block: 'nearest' }); }
  });
  document.body.prepend(a);
}

// ---- the globe from the keyboard: arrows turn it, + and - zoom, Page Up / Down tilt, Enter opens what is in the middle ----
function globeKeys() {
  const el = $('#globe'); if (!el) return;
  el.tabIndex = 0;
  el.setAttribute('aria-label', 'The 3D globe. Arrow keys turn it, plus and minus zoom, Page Up and Page Down tilt, Enter opens the place in the middle. The buttons along the bottom search, fly to places and open lists.');
  el.setAttribute('aria-roledescription', 'globe');
  let sayAlt = 0;
  el.addEventListener('keydown', e => {
    const O = window.OO3D, C = window.Cesium;
    if (!O || !C || e.altKey || e.ctrlKey || e.metaKey) return;
    const cam = O.viewer.camera, h = cam.positionCartographic.height;
    const turn = Math.min(0.2, Math.max(0.0004, h / 6.4e6 * 0.12)) * (e.shiftKey ? 3 : 1);
    let done = true;
    switch (e.key) {
      case 'ArrowLeft': cam.rotateRight(turn); break;
      case 'ArrowRight': cam.rotateLeft(turn); break;
      case 'ArrowUp': cam.rotateDown(turn); break;
      case 'ArrowDown': cam.rotateUp(turn); break;
      case '+': case '=': cam.zoomIn(h * 0.3); break;
      case '-': case '_': cam.zoomOut(h * 0.45); break;
      case 'PageUp': cam.lookUp(0.06); break;
      case 'PageDown': cam.lookDown(0.06); break;
      case 'Enter': e.preventDefault(); pickCentre(O, C); return;   // says what it found itself
      default: done = false;
    }
    if (!done) return;
    e.preventDefault(); O.viewer.scene.requestRender();
    clearTimeout(sayAlt);
    sayAlt = setTimeout(() => { const n = $('#bandName')?.textContent, a = $('#bandAlt')?.textContent; if (a && a !== '—') announce([n, a].filter(x => x && x !== '—').join(', ')); }, 700);
  });
}
function pickCentre(O, C) {
  const canvas = O.viewer.scene.canvas, mid = new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const p = O.viewer.camera.pickEllipsoid(mid, O.viewer.scene.globe.ellipsoid);
  if (!p) { announce('Space: nothing in the middle of the view'); return; }
  const g = C.Cartographic.fromCartesian(p), lon = C.Math.toDegrees(g.longitude), lat = C.Math.toDegrees(g.latitude);
  O.Country.at(lon, lat).then(k => { if (k) O.select(k); else announce(`Open ocean, ${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'north' : 'south'}, ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'east' : 'west'}`); }).catch(() => {});
}

// ---- the Solar System's search as a combobox ----
function solarSearch() {
  const q = $('#q'), hits = $('#hits'); if (!q || !hits) return;
  q.setAttribute('role', 'combobox'); q.setAttribute('aria-autocomplete', 'list'); q.setAttribute('aria-controls', 'hits'); q.setAttribute('aria-expanded', 'false');
  if (!q.getAttribute('aria-label')) q.setAttribute('aria-label', 'Search the Solar System and beyond');
  hits.setAttribute('role', 'listbox'); hits.setAttribute('aria-label', 'Search results');
  const sync = () => {
    const open = hits.style.display === 'block';
    q.setAttribute('aria-expanded', String(open));
    const opts = $$('button', hits);
    opts.forEach((b, i) => { b.id = 'hit-' + i; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(b.classList.contains('sel'))); b.tabIndex = -1; });
    const sel = opts.find(b => b.classList.contains('sel'));
    if (open && sel) q.setAttribute('aria-activedescendant', sel.id); else q.removeAttribute('aria-activedescendant');
    if (open && !opts.length) announce('Nothing found');
  };
  new MutationObserver(sync).observe(hits, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
}

// ---- per page ----
const visibleByClass = c => el => el.classList.contains(c);
const shown = el => el.style.display !== 'none' && getComputedStyle(el).display !== 'none';

const PAGES = {
  globe() {
    skipLink('#band', 'Skip to the controls');
    toolbar($('#band'), 'Places and tools');
    toolbar($('#timebar'), 'Time');
    toolbar($('#dock'), 'Layers');
    follow($('#timebar'), [['.tb[data-rate]', 'aria-pressed', el => el.classList.contains('on')]]);
    follow($('#band'), [['button.go', 'aria-current', el => el.classList.contains('on') ? 'true' : null]]);
    follow($('#dock'), [['.ly[data-ly], .ly[data-base], .ly[data-q], .ly[data-saver]', 'aria-pressed', el => !el.classList.contains('off')]]);
    const card = $('#card');
    if (card) card.removeAttribute('aria-live');   // the card's numbers tick every second: say the selection once instead
    announceSelections(card, { visible: visibleByClass('show'), title: el => $('h2', el)?.textContent || $('h3', el)?.textContent, kind: el => $('.k', el)?.textContent });
    const toast = $('#toast'); if (toast && !toast.getAttribute('role')) toast.setAttribute('role', 'status');
    const hover = $('#hover'); if (hover) hover.setAttribute('aria-hidden', 'true');
    expands($('#btnDock'), $('#dock'));
    globeKeys();
  },
  map() {
    skipLink('#q', 'Skip to search');
    toolbar($('#views'), 'Views');
    toolbar($('#mobilebar'), 'Panels');
    follow($('#views'), [['.view', 'aria-pressed', el => el.classList.contains('on')]]);
    follow($('#mobilebar'), [['button', 'aria-pressed', el => el.classList.contains('on')]]);
    follow($('#top'), [['#btnSound', 'aria-pressed', el => el.classList.contains('on')]]);
    tabs($('#panel .tabs'), { tab: 'button[data-tab]', panelOf: t => document.getElementById('tab-' + t.dataset.tab), isOn: t => t.classList.contains('on') });
    announceSelections($('#detail'), { visible: () => true, title: el => $('h2', el)?.textContent, kind: el => $('.kicker .label', el)?.textContent });
    const map = $('#map');
    if (map) map.setAttribute('aria-label', 'Live map. With the map focused, arrow keys pan and plus and minus zoom. Tap or click anything for details.');
    const layers = $('#layers'); if (layers) follow(layers, []);
    // map popups (the probe, a long press, quick looks) are said by their heading when they open
    const t0 = Date.now(), wait = setInterval(() => {
      const m = window.OW && window.OW.map;
      if (!m && Date.now() - t0 < 120e3) return;
      clearInterval(wait); if (!m) return;
      m.on('popupopen', e => {
        const el = e.popup.getElement(); if (!el) return;
        fixNames(el);
        const h = $('h1, h2, h3, h4, b, strong', el);
        if (h && !el.querySelector('.oo-spot')) announce((h.textContent || '').trim() + (el.querySelector('dd') ? ': ' + el.querySelector('dd').textContent.trim() : ''));
      });
    }, 1000);
  },
  solar() {
    skipLink('#q', 'Skip to search');
    toolbar($('#time'), 'Time');
    toolbar($('#rungs'), 'Jump to a scale');
    toolbar($('#dock .act'), 'Tours and tools');
    follow($('#time'), [['.tb[data-rate]', 'aria-pressed', el => el.classList.contains('on')]]);
    follow($('#band'), [['.rung', 'aria-current', el => el.classList.contains('on') || el.classList.contains('sel') ? 'true' : null]]);
    expands($('#menuBtn'), $('#dock'));
    follow($('#dock'), []);
    const card = $('#card');
    if (card) {
      card.setAttribute('role', 'region'); card.setAttribute('aria-label', 'Details');
      announceSelections(card, { visible: shown, title: el => $('h2', el)?.textContent, kind: el => $('.k', el)?.textContent });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && card.contains(document.activeElement)) { $('#cardX')?.click(); $('#q')?.focus(); } });
    }
    const cap = $('#cap'); if (cap) { cap.setAttribute('role', 'status'); cap.setAttribute('aria-live', 'polite'); }
    const err = $('#err'); if (err) err.setAttribute('role', 'alert');
    const c = $('#c'); if (c) { c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'The Solar System in 3D. Use the search, the scale ladder and the tours to move around.'); }
    solarSearch();
  },
  index() {
    skipLink('main, #top h1, h1', 'Skip to the content');
  },
  tonight() { skipLink('main, h1', 'Skip to the content'); },
  about() { skipLink('main, h1', 'Skip to the content'); },
};

export function initA11y(page) {
  const start = () => {
    regions();
    fixNames(document);
    try { PAGES[page]?.(); } catch (e) { console.warn('[oo] a11y:', e); }
    // keyboard users get focus rings, pointer users don't (for pages whose own styles hide :focus outlines)
    addEventListener('keydown', e => { if (e.key === 'Tab') document.documentElement.classList.add('oo-kbd'); }, true);
    addEventListener('pointerdown', () => document.documentElement.classList.remove('oo-kbd'), true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
