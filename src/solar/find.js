// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Where is it now?": the search box over everything the view knows (planets, moons, dwarf planets, spacecraft, every
// comet, 26,000 named asteroids, nearby stars and planetary systems), ranked by src/core/search.js, plus the view as a
// shareable link (src/core/solarlink.js): the URL hash follows what you fly to, and a card button copies it.
import { esc, distance } from '../core/format.js';
import { buildIndex, search, mergeResults } from '../core/search.js';
import { cometNames } from '../core/comets.js';
import { encodeSolarView, decodeSolarView } from '../core/solarlink.js';
import { bodies, byKey, layerOn } from './world.js';
import { FLIGHT } from '../core/motion.js';

const $ = s => document.querySelector(s);
const SKIP = new Set(['light delay', 'radio bubble']);

export function createFind({ nav, story, small, comets, exo, clock, camera, controls, caption, linkLoads = {} }) {
  // ---- indexes, built lazily and rebuilt when their source grows
  let bodyIdx = null, bodyN = -1, cometIdx = null, cometN = -1, astIdx = null, astN = -1, exoIdx = null;
  const bodyItems = () => bodies.filter(b => !b.transient && !b.exoPlanet && !SKIP.has(b.kind) && b.key !== 'here')
    .map(b => ({ key: b.key, name: b.fullName || b.name, kind: b.kind, aliases: b.aliases, weight: b.weight ?? (b.big ? 80 : b.kind === 'moon' ? 30 : 0), go: () => b }));
  function indexes() {
    if (bodies.length !== bodyN) { bodyN = bodies.length; bodyIdx = buildIndex(bodyItems()); }
    const rows = comets.rows;
    if (rows.length !== cometN) {
      cometN = rows.length;
      cometIdx = buildIndex(rows.map(r => { const n = cometNames(r[0]); return { key: 'comet:' + r[0], name: n.display, kind: 'comet', aliases: n.aliases, go: () => comets.cometBody(r, { transient: true }) }; }));
    }
    if (small.S.named.length !== astN) {
      astN = small.S.named.length;
      const have = new Set(bodies.filter(b => b.layer === 'dwarfs').map(b => b.name.toLowerCase()));
      astIdx = buildIndex(small.S.named.filter(n => !have.has(n[2].replace(/^\d+ /, '').toLowerCase()))
        .map(n => ({ key: 'ast:' + n[2], name: n[2], kind: 'asteroid', weight: Math.max(0, Math.min(30, 18 - (n[3] ?? 18)) * 2), go: () => small.asteroidBody(n) })));
    }
    if (!exoIdx && exo?.X?.systems?.length) exoIdx = buildIndex(exo.X.systems.map(s => ({ key: 'exo:' + s.host, name: s.host, kind: 'exoplanet system', go: () => exo.hostBody(s), dist: exo.viewDistance(s), sys: s })));
    return [bodyIdx, cometIdx, astIdx, exoIdx].filter(Boolean);
  }

  /** Ranked hits for text: [{ key, name, kind, go, ... }]. */
  function find(q, limit = 12) {
    if (!exo?.X?.data && q.length >= 3) exo?.load?.().catch(() => {});   // planetary systems: their list loads on first search
    return mergeResults(indexes().map(ix => search(ix, q, limit)), limit);
  }
  /** Resolve a hit to a body (creates a transient comet or asteroid body if needed). */
  const resolve = h => (byKey[h.key] || h.go());

  function flyTo(b, dist) {
    if (!b) return;
    story.stopTour();
    if (b.kind === 'comet') b.update(clock.jd);   // one just made from the search or the list sits at the Sun until the next frame: the distance below reads where it is
    const d = dist ?? (b.kind === 'asteroid' || b.kind?.includes('asteroid') ? Math.max(b.pos.length() * 0.15, 0.05) : b.kind === 'comet' ? Math.max(0.05, Math.min(1.2, b.pos.length() * 0.25)) : b.kind === 'spacecraft' ? 0.02 : undefined);
    nav.focusOn(b, d);
  }

  // ---- the box
  let hits = [], sel = 0;
  const where = h => {
    const b = byKey[h.key], E = byKey.earth;
    if (!b || !E || b === E || b.fixed || b.launched === false) return '';
    return distance(b.pos.distanceTo(E.pos)) .replace(/ · .*/, '') + ' from Earth';
  };
  function render() {
    $('#hits').innerHTML = hits.map((h, i) => { const w = where(h);
      return `<button data-i="${i}" class="${i === sel ? 'sel' : ''}"><span>${esc(h.name)}${w ? `<em>${esc(w)}</em>` : ''}</span><small>${esc(h.kind)}</small></button>`; }).join('') || '<div class="note">Nothing found. Try a planet, a moon, a spacecraft (Voyager, JWST), a comet (Halley, 67P) or an asteroid.</div>';
    $('#hits').style.display = 'block';
    if (innerWidth <= 900) {   // phones: across the screen under the box, not hanging off the left edge
      const r = $('#search').getBoundingClientRect();
      Object.assign($('#hits').style, { left: Math.round(10 - r.left) + 'px', right: 'auto', width: (innerWidth - 20) + 'px' });
    }
    document.querySelectorAll('#hits button').forEach(b => { b.onclick = () => pick(+b.dataset.i); });
  }
  /** Search what the box says now (2+ characters), or clear the hits so Enter has nothing stale to act on. */
  function runSearch() {
    const q = $('#q').value.trim(); if (q.length < 2) { hits = []; sel = 0; $('#hits').style.display = 'none'; return false; }
    hits = find(q, 14); sel = 0; render(); return true;
  }
  // typing: one search 90 ms after the last key, not one per key (a search scans ~35,000 names, with spelling slack: up
  // to ~370 ms per keystroke on a phone); a box under two letters clears at once, and Enter runs a waiting search first
  let typing = 0;
  const flush = () => { if (typing) { clearTimeout(typing); typing = 0; runSearch(); } };
  $('#q').addEventListener('input', () => {
    clearTimeout(typing); typing = 0;
    if ($('#q').value.trim().length < 2) { runSearch(); return; }
    typing = setTimeout(() => { typing = 0; runSearch(); }, 90);
  });
  $('#q').addEventListener('focus', () => { if ($('#hits').style.display !== 'block') runSearch(); });   // back in a box that still says "Mars": the results again
  function pick(i) {
    const h = hits[i]; if (!h) return;
    hits = []; sel = 0;   // the box empties: Enter in it again must not repeat this flight
    const b = resolve(h);
    if (b) flyTo(b, h.dist); else caption(h.name, 'Fetching its orbit. The view flies there as soon as it lands.', '', 6000, true);   // (small.onNamed flies; onNamedFailed, below, says if it can't)
    $('#hits').style.display = 'none'; $('#q').value = ''; $('#q').blur();
  }
  $('#q').addEventListener('keydown', e => {
    if (e.key === 'Enter') { flush(); if ($('#hits').style.display === 'block') pick(sel); else runSearch(); }   // only a list that is showing; a hidden one is shown again first
    if (e.key === 'Escape') { $('#hits').style.display = 'none'; $('#q').blur(); }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; document.querySelectorAll('#hits button').forEach((b, i) => b.classList.toggle('sel', i === sel)); e.preventDefault(); }
  });
  document.addEventListener('click', e => { if (!$('#search').contains(e.target)) $('#hits').style.display = 'none'; });
  addEventListener('keydown', e => { if (e.key === '/' && !/input|textarea/i.test(e.target.tagName)) { e.preventDefault(); $('#q').focus(); } });   // "/" to search

  // ---- the view as a link
  const viewLink = () => {
    const f = nav.free ? null : nav.focus?.key;
    const h = encodeSolarView({ focus: f && f !== 'ghost' ? f : null, jd: clock.live ? null : clock.jd, rate: clock.rate, dist: camera.position.distanceTo(controls.target) });
    return location.href.replace(/#.*$/, '') + (h ? '#' + h : '');
  };
  let lastHash = '';
  /** Keep the address bar on the current view (replaceState: no history entry per click). */
  function syncHash() {
    if (!api.ready || linkWaits || document.body.classList.contains('embedded')) return;   // not before a link we opened is applied   // inside the globe the URL is the globe's
    if (kept) { if (nav.focus === kept.focus && !nav.free && performance.now() < kept.until) return; kept = null; }   // a link that found nothing stays readable until the view moves on
    const url = viewLink(), h = url.replace(/^[^#]*/, '');
    if (h !== lastHash) { lastHash = h; try { history.replaceState(null, '', url); } catch (e) { /* sandboxed */ } }
  }
  async function copyLink() {
    const url = viewLink();
    try { await navigator.clipboard.writeText(url); caption('Link copied', 'Anyone opening it sees this view, at this moment' + (clock.live ? ' (live).' : '.'), url, 6000, true); }
    catch (e) { caption('Share this view', url, 'Copy the address above.', 12000, true); }
  }
  // ---- opening a link. A key names one thing: it is looked up exactly, once whatever holds it has loaded (the stars,
  // the planetary systems and the galaxies are not part of the boot loads), and never replaced by the nearest-sounding
  // name, which sent a link to Vega to asteroid 82332 Las Vegas. Only a #q= link is a search.
  let linkWaits = 0, linkSeq = 0, kept = null;
  const settled = (...p) => Promise.allSettled(p);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const sameName = (h, text) => { const l = text.toLowerCase(); return [h.key, h.name, h.name.replace(/^\d+ /, '')].some(x => x.toLowerCase() === l); };
  /** The body a key names, or null. Comets, asteroids and most planetary systems have no body until they are asked for. */
  async function bodyForKey(key) {
    const colon = key.indexOf(':'), prefix = colon > 0 ? key.slice(0, colon) : '', name = key.slice(colon + 1);
    if (prefix !== 'exo' && byKey[key]) return byKey[key];
    await api.boot;
    if (prefix === 'exo') await settled(exo?.load?.());   // always: a famous system's body exists, but its distance and viewing distance come from the catalogue
    else if (!byKey[key] && linkLoads[prefix]) await settled(linkLoads[prefix]());
    if (prefix === 'exo') { const s = exo?.X?.systems?.find(x => x.host === name); if (s) return exo.hostBody(s); }
    if (byKey[key]) return byKey[key];
    if (prefix === 'comet') { const row = comets.rows.find(r => r[0] === name); if (row) return comets.cometBody(row, { transient: true }); }
    if (prefix === 'ast') {
      const n = small.S.named.find(x => x[2] === name), world = n && byKey[name.replace(/^\d+ /, '').toLowerCase()];   // 433 Eros is the body "eros"
      if (world?.layer === 'dwarfs') return world;
      if (n) return small.namedBody(n);
    }
    // a hand-written key that is a name as such (comet:Halley, exo:Kepler-90, Mars): that name exactly
    if (!prefix || prefix === 'comet' || prefix === 'ast' || prefix === 'exo') { const h = find(name, 8).find(x => sameName(x, name)); if (h) return h.key === key ? resolve(h) : bodyForKey(h.key); }
    return null;
  }
  /** An exoplanet exists only while its system is built, which happens with the camera near its star (exoplanets.js):
   *  fly to the star, wait for that, and then the planet is there. 'moved' if the visitor went elsewhere meanwhile; 'host' if the system was not built. */
  async function planetForKey(key) {
    await api.boot; await settled(exo?.load?.());
    const name = key.slice(5);
    if (byKey[key]) return byKey[key];
    const s = exo?.X?.systems?.find(x => name.startsWith(x.host + ' ') && x.pl.some(p => x.host + ' ' + p[0] === name)); if (!s) return null;
    const host = exo.hostBody(s), t0 = performance.now(); let landed = 0;
    nav.focusOn(host, Math.min(exo.viewDistance(s), 250), FLIGHT.rung);   // (systems build within 300 AU; a wide one is viewed from further out than that)
    while (performance.now() - t0 < 30e3 && layerOn('exo')) {
      await wait(200);
      if (nav.focus !== host || nav.free) return 'moved';
      if (byKey[key]) return byKey[key];
      if (nav.fly) landed = 0; else if (!landed) landed = performance.now(); else if (performance.now() - landed > 2000) break;
    }
    return 'host';
  }
  const notFound = (name, why = 'If you are offline, its data may not have loaded.') => {
    caption('Could not find that', `This link names \u201c${name}\u201d, which is not in the data here.`, why, 9000, true);
    kept = { focus: nav.focus, until: performance.now() + 30e3 };
  };
  /** Apply a hash: time, then the focus (or a search), then the distance. Resolves true if what it names is now in view
   *  (false, with a caption, if nothing here matches). The address bar keeps the link until then. */
  async function applyHash(hash) {
    const v = decodeSolarView(hash); if (!v) return false;
    if (v.jd != null) { clock.setJd(v.jd); clock.setRate(v.rate ?? 0); }
    const seq = ++linkSeq, f0 = nav.focus, free0 = nav.free; kept = null;
    linkWaits++;
    try {
      let b = null;
      const planet = v.focus?.startsWith('exop:');
      if (planet) {
        b = await planetForKey(v.focus);
        if (seq !== linkSeq || b === 'moved') return false;
        if (b === 'host') { notFound(v.focus.slice(5), 'Its star is in view: the planets show with the "Planets of other stars" layer on, close to the star.'); return false; }
      } else if (v.focus) {
        b = await bodyForKey(v.focus);
      } else if (v.query) {
        let h = find(v.query, 1)[0];
        if (!h || !sameName(h, v.query)) {   // not a name it knows yet: it may be a star or a planetary system
          await api.boot; await settled(exo?.load?.(), ...Object.values(linkLoads).map(f => f()));
          h = find(v.query, 1)[0];
        }
        if (h) b = await bodyForKey(h.key);
      } else return false;   // a moment and nothing else: the clock is set
      if (seq !== linkSeq || (!planet && (nav.focus !== f0 || nav.free !== free0))) return false;   // another link, or the visitor went elsewhere while this one loaded
      if (!b) { notFound(v.focus ? v.focus.replace(/^[a-z]+:/, '') : v.query); return false; }
      nav.focusOn(b, v.dist ?? undefined, FLIGHT.rung); lastHash = '';
      return true;
    } finally { linkWaits--; }
  }
  addEventListener('hashchange', () => { applyHash(location.hash); });
  small.onNamedFailed = n => caption('Could not load ' + n[2], 'Its orbit did not download (network). Try again in a moment.', '', 9000, true);

  /** Build the search indexes ahead of the first keystroke (main.js: in an idle slice once the data is in, and when the box gets focus). */
  const prepare = () => { indexes(); };
  const api = { ready: false, find, resolve, flyTo, syncHash, copyLink, applyHash, viewLink, prepare, flush };
  return api;
}
