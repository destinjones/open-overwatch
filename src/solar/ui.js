// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// DOM side of the Solar System view: time controls, layer switches, labels, the details card (with a mission timeline
// and where the body is in Earth's sky), captions and the scale readout (search and share links: find.js). Everything that touches document lives here.
import * as THREE from 'three';
import { LY_AU } from '../core/units.js';
import { REAL_TIME, formatUtc } from '../core/time.js';
import { esc, viewWidth } from '../core/format.js';
import { fetchAsset } from '../core/assets.js';
import { skyPosition, skyPhrase, nearestConstellation, formatRaDec } from '../core/skyplace.js';
import { zoneCounts, zoneWords } from '../core/habitable.js';
import { PHONE, Sharpen } from './util.js';
import { bodies, byKey, layers, layer, layerOn, applyLayers, bodyVisible } from './world.js';
import { BANDS, RUNGS, RUNG_SHORT } from './story.js';
import { FLIGHT } from '../core/motion.js';

const $ = s => document.querySelector(s);
const RATES = { '-6': -365.25, '-4': -1, '0': 0, '1': REAL_TIME, '4': 1, '5': 30.44, '6': 365.25 };
const RATE_TEXT = { '-6': '1 year per second, backwards', '-4': '1 day per second, backwards', '0': 'paused', '1': 'real time', '4': '1 day per second', '5': '1 month per second', '6': '1 year per second' };
/** The header clock always says UTC (a visitor in India is 5.5 h ahead of it); a phone, short of room, leaves out the year while it is this year. */
const headerDate = (jd, phone, year = new Date().getUTCFullYear()) => { const s = formatUtc(jd, { suffix: '' }); return s === '—' ? s : (phone && s.startsWith(year + '-') ? s.slice(5) : s) + ' UTC'; };

export function createUI({ camera, controls, clock, nav, story, small, deep, quality, exo }) {
  // ---- captions (a "locked" caption, from the tour or a button, isn't overwritten by scale-band captions)
  let capTimer = 0, capLock = 0;
  function caption(t, p, s, ms = 9000, lock = false) {
    if (lock) capLock = performance.now() + ms; else if (performance.now() < capLock) return;
    $('#capT').textContent = t; $('#capP').textContent = p; $('#capS').textContent = s || '';
    $('#cap').classList.remove('hide'); clearTimeout(capTimer); capTimer = setTimeout(() => $('#cap').classList.add('hide'), PHONE ? Math.min(ms, 6000) : ms);
  }

  // ---- time
  function syncRate() {
    const k = Object.keys(RATES).find(x => RATES[x] === clock.rate);
    document.querySelectorAll('#time [data-rate]').forEach(b => b.classList.toggle('on', b.dataset.rate === k));
    $('#tRate').textContent = k !== undefined ? RATE_TEXT[k] : Math.round(clock.rate * 86400).toLocaleString('en-US') + '× speed';   // a rate set by the globe
  }
  document.querySelectorAll('#time [data-rate]').forEach(b => { b.onclick = () => { clock.setRate(RATES[b.dataset.rate]); syncRate(); }; });
  $('#now').onclick = () => { clock.goLive(); syncRate(); };

  // ---- layers: the buttons are built once (again only when the set of layers or graphics levels changes) and then
  // updated in place, so a layer switched with Enter or Space keeps the keyboard focus, and a screen reader its place
  const FAILED_TITLE = 'This data did not load (network). Reload the page to try again.';
  function layerItems() {
    const items = layers.map(l => ({ key: 'id', id: l.id, name: l.name, c: l.c, sub: !!l.sub, on: !!l.on,
      n: l.failed ? 'not loaded' : l.n ? l.n.toLocaleString('en-US') : '', title: l.failed ? (l.retry || FAILED_TITLE) : '' }));
    if (!quality) return items;
    const auto = quality.chosen === 'auto', opts = [['auto', `Auto (${quality.LEVELS[quality.level].name.toLowerCase()})`], ...Object.entries(quality.LEVELS).map(([id, q]) => [id, q.name])];
    return [...items, { head: 'Graphics' }, ...opts.map(([id, name]) => ({ key: 'q', id, name, c: '#e6edf3', sub: true, on: auto ? id === 'auto' : id === quality.chosen, n: '', title: '' }))];
  }
  const lyKey = it => it.key + ':' + it.id;
  let lyButtons = new Map(), lyShape = '';
  function layerButton(it) {
    const b = document.createElement('button'), t = document.createElement('span');
    b.className = 'ly' + (it.sub ? ' sub' : ''); b.dataset[it.key] = it.id; b.style.setProperty('--c', it.c); t.className = 't';
    b.append(document.createElement('i'), t);
    b.onclick = it.key === 'q' ? () => { quality.choose(it.id); renderLayers(); } : () => { const l = layer(it.id); l.on = !l.on; applyLayers(); renderLayers(); };
    return b;
  }
  function renderLayers() {
    const box = $('#lys'), items = layerItems(), shape = items.map(it => it.head ? '#' + it.head : lyKey(it)).join('|');
    if (shape !== lyShape) {   // first time, or a layer or level was added: build, keeping the focused button focused
      const had = [...lyButtons].find(([, b]) => b === document.activeElement)?.[0];
      lyButtons = new Map(); lyShape = shape;
      box.replaceChildren(...items.map(it => {
        if (it.head) { const h = document.createElement('div'); h.className = 'qh'; h.textContent = it.head; return h; }
        const b = layerButton(it); lyButtons.set(lyKey(it), b); return b;
      }));
      if (had && lyButtons.has(had)) lyButtons.get(had).focus({ preventScroll: true });
    }
    for (const it of items) {
      const b = !it.head && lyButtons.get(lyKey(it)); if (!b) continue;
      b.classList.toggle('off', !it.on); b.setAttribute('aria-pressed', String(it.on));
      const t = b.querySelector('.t'); if (t.textContent !== it.name) t.textContent = it.name;
      let n = b.querySelector('.n');
      if (it.n && !n) { n = document.createElement('span'); n.className = 'n'; b.append(n); }
      if (n && !it.n) n.remove(); else if (n && n.textContent !== it.n) n.textContent = it.n;
      if (it.title) b.title = it.title; else b.removeAttribute('title');
    }
  }
  // phones (and the globe's embed at phone width) hide the credits line: the menu's Credits button opens it as a sheet
  const credits = $('#credits'), creditsBtn = $('#bCredits');
  const showCredits = on => {
    if (!credits || !creditsBtn) return;
    credits.classList.toggle('open', on); creditsBtn.setAttribute('aria-expanded', String(on));
    if (on) { $('#dock').classList.remove('open'); $('#creditsX').focus({ preventScroll: true }); }
  };
  $('#menuBtn').onclick = () => { if ($('#dock').classList.toggle('open')) showCredits(false); };   // the sheet would cover the menu
  if (credits && creditsBtn) {
    creditsBtn.onclick = () => showCredits(!credits.classList.contains('open'));
    // the X goes away: focus to the menu button (phones), or on a desktop, where that is hidden, the Credits button; not <body>
    const focusBack = () => { const m = $('#menuBtn'); (m.offsetParent ? m : creditsBtn).focus(); };
    $('#creditsX').onclick = () => { showCredits(false); focusBack(); };
    credits.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); showCredits(false); focusBack(); } });
    credits.addEventListener('click', e => { if (!credits.classList.contains('open') && !e.target.closest('a')) showCredits(true); });   // desktop: the two-line note opens in full
  }

  // ---- buttons
  const tourLabel = on => { $('#bTour').innerHTML = on ? '<b>■</b> Stop the tour' : '<b>▶</b> Guided tour: Earth to Andromeda'; syncRate(); };
  $('#bTour').onclick = () => (story.tour.on ? story.stopTour() : story.startTour());
  $('#bPulse').onclick = () => story.startPulse();
  $('#bAlign').onclick = () => { story.findAlignment(); syncRate(); };
  $('#rungs').innerHTML = RUNGS.map(([label], i) => `<button class="rung" data-i="${i}">${RUNG_SHORT[label] || label}</button>`).join('');
  document.querySelectorAll('.rung').forEach(b => { b.onclick = () => { story.stopTour(); const [, k, d] = RUNGS[+b.dataset.i]; nav.focusOn(byKey[k] || byKey.sun, d, k === 'gc' ? FLIGHT.far : FLIGHT.rung, false); }; });

  // ---- details card: the static part (title, fact, timeline, buttons) is drawn once per body; the numbers every second
  $('#cap').addEventListener('click', () => $('#cap').classList.add('hide'));
  let figures = null, figuresAsked = false, onShare = () => {}, cardRows = '';
  const needFigures = () => { if (figuresAsked) return; figuresAsked = true; fetchAsset('data/constellations.json', 'json').then(d => { figures = d.figures; }, () => {}); };
  /** "In Earth's sky" rows for a Solar System body: when to look and among which stars. */
  function skyRows(b) {
    const E = byKey.earth;
    if (!E || b === E || b.key === 'sun' || b.fixed || b.event || b.launched === false || b.kind === 'light delay' || b.pos.length() > 2e4) return [];   // events (eclipses.js) say where they are seen
    if (b.kind === 'moon' && b.key !== 'moon' && b.parent && byKey[b.parent]) return [];   // moons of other planets: see the planet
    needFigures();
    const sp = skyPosition(b.pos, E.pos), c = figures && nearestConstellation(sp.ra, sp.dec, figures);
    return [["In Earth's sky", skyPhrase(sp) + (c ? ` · near ${c.name}` : '')], ['Direction', formatRaDec(sp) + ` · ${Math.round(sp.elong)}° from the Sun`]];
  }
  function rowsHtml(b) { return [...(b.info ? b.info() : []), ...skyRows(b)].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join(''); }
  function timelineHtml(b) {
    const ev = b.timeline ? b.timeline() : null; if (!ev || !ev.length) return '';
    return `<h3>Timeline</h3><ol class="tl">${ev.map(e => `<li data-jd="${+e[0]}"><button title="Set the clock to this moment (paused)"><b>${esc(formatUtc(e[0]).slice(0, 10))}</b> ${esc(e[1])}</button></li>`).join('')}</ol>`;
  }
  function markTimeline() {
    const items = document.querySelectorAll('#cardB .tl li'); let nextSet = false;
    items.forEach(li => { const past = +li.dataset.jd <= clock.jd; li.classList.toggle('past', past); li.classList.toggle('next', !past && !nextSet); if (!past) nextSet = true; });
  }
  function showCard(b) {
    if (b && PHONE) $('#cap').classList.add('hide');
    if (!b) { $('#card').style.display = 'none'; delete $('#card').dataset.key; return; }
    // the live numbers each second: rewritten only when they changed (a rewrite relays the card out)
    if ($('#card').dataset.key === b.key && $('#card').style.display !== 'none') { const html = rowsHtml(b); if (html !== cardRows) { cardRows = html; $('#cardDl').innerHTML = html; } markTimeline(); return; }
    if (innerWidth <= 900) {   // phones: the list, Under the hood and the credits sheet sit where the card opens, and over it: a new card closes them
      if ($('#list') && $('#list').style.display !== 'none') $('#listX').click();
      if ($('#nerd') && !$('#nerd').hidden) $('#nerd .x').click();
      if (credits?.classList.contains('open')) showCredits(false);
    }
    cardRows = rowsHtml(b);
    $('#cardB').innerHTML = `<div class="k">${esc(b.kind)}</div><h2>${esc(b.fullName || b.name)}</h2><dl id="cardDl">${cardRows}</dl>${b.fact ? `<p>${esc(b.fact)}</p>` : ''}
      ${timelineHtml(b)}
      <div class="row">${b.key === 'earth' ? '<a class="btn" href="globe.html">Land on Earth: 3D globe</a>' : ''}<button class="btn" data-share>Share this view</button></div>`;
    const card = $('#card'), opening = card.style.display === 'none' || !card.style.display;
    card.style.display = 'block'; card.dataset.key = b.key; markTimeline();
    card.classList.remove('in'); if (opening) { void card.offsetWidth; card.classList.add('in'); }   // a fresh card fades in (solar.html; none with reduced motion)
    document.querySelectorAll('#cardB .tl li').forEach(li => { li.querySelector('button').onclick = () => { story.stopTour(); clock.setJd(+li.dataset.jd); clock.setRate(0); syncRate(); markTimeline(); }; });
    $('#cardB [data-share]').onclick = () => onShare();
  }
  $('#cardX').onclick = () => showCard(null);
  $('#follow').onclick = () => nav.release();
  $('#cardB').addEventListener('click', e => { const a = e.target.closest('a[href="globe.html"]'); if (a && window.OOSS?.embed?.active !== undefined && document.body.classList.contains('embedded')) { e.preventDefault(); window.OOSS.embed.goToEarth(); } });
  setInterval(() => { // live numbers, unless the reader is selecting text
    const k = $('#card').dataset.key, sel = getSelection();
    if (k && byKey[k] && $('#card').style.display !== 'none' && (!sel || sel.isCollapsed)) showCard(byKey[k]);
  }, 1000);

  // ---- labels: an element only once a body is first labelled (most of the ~300 bodies never are), and style writes only
  // when something changed: a write per label per frame, shown or not, was most of this view's main-thread time
  const labelsEl = $('#labels'), els = new Map(), v = new THREE.Vector3(), S2 = [0, 0];
  /** Screen position of p in CSS pixels, written into out [x, y] (null behind the camera). */
  const screenOf = (p, out = [0, 0]) => { v.copy(p).project(camera); if (v.z > 1 || v.z < -1) return null; out[0] = (v.x + 1) / 2 * innerWidth; out[1] = (1 - v.y) / 2 * innerHeight; return out; };
  /** A body's label: { el, t (the transform last written), on (shown) }. */
  function labelFor(b) {
    let L = els.get(b.key); if (L) return L;
    const el = document.createElement('div'); el.className = 'lbl' + (b.big ? ' big' : ''); el.textContent = b.name; el.style.setProperty('--lc', b.color); el.style.display = 'none';
    el.onclick = e => { e.stopPropagation(); story.stopTour(); nav.focusOn(b); }; labelsEl.appendChild(el);
    L = { el, t: '', on: false }; els.set(b.key, L); return L;
  }
  const hide = L => { if (L.on) { L.on = false; L.el.style.display = 'none'; } };
  let lastRank = 0, lastSweep = 0;
  function labelShown(b, camSun, camFocus) {
    if (!layerOn('labels') || !bodyVisible(b) || b.launched === false || b.event) return false;   // an eclipse or occultation sits on the Earth or Moon, which have labels
    if (b.star) return camSun > 0.3 * LY_AU && b.vis;                              // the brightest few, once out among them
    if (b.here) return camSun > 30 * LY_AU;
    if (b.bubble) return camSun > 12 * LY_AU && camSun < 3000 * LY_AU;               // the radio bubble
    if (b.exoPlanet) return camera.position.distanceTo(b.pos) < 3;                   // planets of the system you are in
    if (b.exo) return b === nav.focus || (camSun > 2 * LY_AU && camSun < 2e4 * LY_AU);  // labelled planetary systems
    if (b.web) return camSun > 2.5e7 * LY_AU;                                    // galaxy clusters
    if (b.far) return (camSun > 3000 * LY_AU || (b.key === 'gc' && camSun > 800 * LY_AU)) && camSun < 4e7 * LY_AU;
    if (b.key === 'sun') return camSun < 30 * LY_AU;
    if (b.kind === 'moon') return b.parent ? !!byKey[b.parent] && camera.position.distanceTo(byKey[b.parent].pos) < b.near : camera.position.distanceTo(byKey.earth.pos) < 0.05;
    if (b.kind === 'planet') return camSun < 3000;
    return camSun < 600 && (b === nav.focus || camera.position.distanceTo(b.pos) < Math.max(10 * camFocus, 3));  // close in: none from far behind
  }
  let taken = new Float64Array(256), nTaken = 0;   // screen spots already labelled this frame (x, y pairs)
  const crowded = (x, y) => { for (let i = 0; i < nTaken; i += 2) if (Math.abs(taken[i] - x) < 60 && Math.abs(taken[i + 1] - y) < 14) return true; return false; };
  function updateLabels(camSun, camFocus) {
    if (performance.now() - lastRank > 400) { lastRank = performance.now(); deep.rankStars(camSun); }
    nTaken = 0;
    for (const b of bodies) {
      let s = labelShown(b, camSun, camFocus) ? screenOf(b.pos, S2) : null;
      if (s && b !== nav.focus && crowded(s[0], s[1])) s = null;
      if (!s || s[0] < -50 || s[1] < -20 || s[0] > innerWidth + 50 || s[1] > innerHeight + 20) { const L = els.get(b.key); if (L) hide(L); continue; }
      const L = labelFor(b); if (L.el.textContent !== b.name) L.el.textContent = b.name;   // a few names change (the light-delay ghost)
      if (nTaken + 2 > taken.length) { const t = new Float64Array(taken.length * 2); t.set(taken); taken = t; }
      taken[nTaken++] = s[0]; taken[nTaken++] = s[1];
      const t = `translate(${(s[0] + 9).toFixed(1)}px, ${(s[1] - 7).toFixed(1)}px)`;
      if (L.t !== t) { L.t = t; L.el.style.transform = t; }
      if (!L.on) { L.on = true; L.el.style.display = ''; }
    }
    if (performance.now() - lastSweep > 250) { lastSweep = performance.now(); for (const [key, L] of els) if (!byKey[key]) { L.el.remove(); els.delete(key); } }   // a replaced picked asteroid, an exoplanet system left
  }

  // ---- picking
  let downAt = null;
  const canvas = $('#c');
  canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; story.stopTour(); });
  canvas.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    let best = null, bd = 18;
    for (const b of bodies) {
      // a hidden label still picks a body whose globe covers a pixel (every planet has a mesh from the start, so not
      // the planets far out: from light-years away a click near the Sun picks the Sun)
      if (!bodyVisible(b) || (!els.get(b.key)?.on && !(b.mesh && b.mesh.visible && Sharpen.px(b) > 1))) continue;
      const s = screenOf(b.pos); if (!s) continue;
      const d = Math.hypot(s[0] - e.clientX, s[1] - e.clientY); if (d < bd) { bd = d; best = b; }
    }
    if (!best && layerOn('asteroids') && camera.position.length() < 200) best = small.pickAsteroid(e.clientX, e.clientY, clock.jd, screenOf);
    if (best) nav.focusOn(best);
  });

  // ---- search: find.js

  // ---- per frame: date, scale readout, band caption, ladder highlight, labels
  // the header's bottom edge (the "Riding with" pill sits under it), measured when it changes size, not every frame:
  // reading it right after a text write forced a layout per frame
  let lastDate = 0, band = -1, started = false, topBottom = 0, lastDist = '', litBand = null, followOn = null;
  const rungEls = [...document.querySelectorAll('.rung')], followEl = $('#follow');
  const measureTop = () => { topBottom = $('#top').getBoundingClientRect().bottom; };
  measureTop(); addEventListener('resize', measureTop);
  if (window.ResizeObserver) new ResizeObserver(measureTop).observe($('#top'));   // it wraps to more rows as its text changes
  function frame({ camSun, camFocus }) {
    if (performance.now() - lastDate > 200) { lastDate = performance.now(); $('#tDate').textContent = headerDate(clock.jd, PHONE); syncRate(); }
    const dist = 'View ' + viewWidth(2 * camFocus * Math.tan(camera.fov * Math.PI / 360) * camera.aspect) + ' wide';
    if (dist !== lastDist) { lastDist = dist; $('#sDist').textContent = dist; }
    const f = nav.focus || byKey.sun, close = camFocus < 0.05 && f.key !== 'earth' && f.key !== 'moon';   // close in, name the body instead
    const inSystem = exo && exo.X.built && camera.position.distanceTo(exo.X.built.hostPos) < 30;   // inside another star's system
    const bi = close ? -2 : inSystem ? -3 : BANDS.findIndex(b => camSun < b[0]);
    if (bi !== band || (close && $('#sName').textContent !== f.name)) {
      band = bi;
      if (close) $('#sName').textContent = f.name;
      else if (inSystem) {
        const s = exo.X.built.s, nm = byKey['exo:' + s.host]?.name || s.host;   // Kepler-90, not the archive's KOI-351
        // both zones, as the card counts them (core/habitable.js): "3 (1 in the habitable zone, 2 more in the optimistic zone)"
        const n = s.pl.length, z = zoneCounts(s), zw = zoneWords(s).slice(String(n).length);
        $('#sName').textContent = 'Other worlds';
        if (started && !story.tour.on && !story.pulse.on) caption(nm + ': another solar system', `${n} known planet${n > 1 ? 's' : ''}${zw}, ${Math.round(s.ly)} light-years from us.${z.habitable || z.optimistic ? ' The green bands are its habitable zones (the fainter one is the optimistic zone).' : ''} They move with the clock; speed it up to watch them orbit.`, 'From the NASA Exoplanet Archive.');
      } else { const B = BANDS[bi]; $('#sName').textContent = B[1]; if (started && !story.tour.on && !story.pulse.on) caption(B[2], B[3], B[4]); }
    }
    if (bi !== litBand) { litBand = bi; rungEls.forEach((r, i) => r.classList.toggle('on', bi === -3 ? RUNGS[i][0] === 'Other worlds' : bi >= 0 && RUNGS[i][0] === BANDS[bi][1])); }
    const name = (nav.focus || byKey.sun).name, show = !nav.free && !!nav.focus && !(document.body.classList.contains('embedded') && nav.focus.key === 'earth'), top = show ? Math.round(topBottom + 8) + 'px' : '';
    if (show !== followOn) { followOn = show; followEl.style.display = show ? '' : 'none'; }
    if (show && followEl.style.top !== top) followEl.style.top = top;   // under the header, which wraps to rows on a phone
    if (show && followEl.dataset.n !== name) { followEl.dataset.n = name; $('#followN').textContent = name; }
    updateLabels(camSun, camFocus);
  }

  renderLayers(); syncRate();
  return { caption, showCard, renderLayers, tourLabel, frame, start() { started = true; }, set onShare(fn) { onShare = fn; } };
}
