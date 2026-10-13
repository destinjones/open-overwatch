// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Where is it now?": the search box over everything the view knows (planets, moons, dwarf planets, spacecraft, every
// comet, 26,000 named asteroids, nearby stars and planetary systems), ranked by src/core/search.js, plus the view as a
// shareable link (src/core/solarlink.js): the URL hash follows what you fly to, and a card button copies it.
import { esc, distance } from '../core/format.js';
import { buildIndex, search, mergeResults } from '../core/search.js';
import { cometNames } from '../core/comets.js';
import { encodeSolarView, decodeSolarView } from '../core/solarlink.js';
import { bodies, byKey } from './world.js';

const $ = s => document.querySelector(s);
const SKIP = new Set(['light delay', 'radio bubble']);

export function createFind({ nav, story, small, comets, exo, clock, camera, controls, caption }) {
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
  $('#q').addEventListener('input', () => {
    const q = $('#q').value.trim(); if (q.length < 2) { $('#hits').style.display = 'none'; return; }
    hits = find(q, 14); sel = 0; render();
  });
  function pick(i) {
    const h = hits[i]; if (!h) return;
    flyTo(resolve(h), h.dist); $('#hits').style.display = 'none'; $('#q').value = ''; $('#q').blur();
  }
  $('#q').addEventListener('keydown', e => {
    if (e.key === 'Enter') pick(sel);
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
    if (!api.ready || document.body.classList.contains('embedded')) return;   // not before a link we opened is applied   // inside the globe the URL is the globe's
    const url = viewLink(), h = url.replace(/^[^#]*/, '');
    if (h !== lastHash) { lastHash = h; try { history.replaceState(null, '', url); } catch (e) { /* sandboxed */ } }
  }
  async function copyLink() {
    const url = viewLink();
    try { await navigator.clipboard.writeText(url); caption('Link copied', 'Anyone opening it sees this view, at this moment' + (clock.live ? ' (live).' : '.'), url, 6000, true); }
    catch (e) { caption('Share this view', url, 'Copy the address above.', 12000, true); }
  }
  /** Apply a hash: time, then the focus (or a search), then the distance. Returns true if it named something. */
  function applyHash(hash) {
    const v = decodeSolarView(hash); if (!v) return false;
    if (v.jd != null) { clock.setJd(v.jd); clock.setRate(v.rate ?? 0); }
    let b = v.focus ? byKey[v.focus] : null;
    if (!b && v.focus) { const name = v.focus.replace(/^[a-z]+:/, ''); b = (find(name, 1)[0] && resolve(find(name, 1)[0])) || null; }   // a comet or asteroid not made yet
    if (!b && v.query) { const h = find(v.query, 1)[0]; if (h) b = resolve(h); }
    if (b) { nav.focusOn(b, v.dist ?? undefined, 2.4); lastHash = ''; }
    return !!b;
  }
  addEventListener('hashchange', () => applyHash(location.hash));

  const api = { ready: false, find, resolve, flyTo, syncHash, copyLink, applyHash, viewLink };
  return api;
}
