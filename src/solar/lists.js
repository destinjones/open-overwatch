// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Three lists in one panel: every deep-space mission with its distance and signal time to Earth (nearest first); the
// brightest comets now (SBDB magnitude parameters) with when each peaks, then the best placed ones; and the eclipses
// and lunar occultations of 2026-2030 with buttons that jump the clock there (eclipses.js). Rows fly to the body (each
// row's name is a real button, so the keyboard can too); on a phone the list closes first, or it would cover the card.
// Numbers follow the clock, except while a keyboard user is inside the list (a redraw would take their place away).
// A load that failed says so, with a Try again, instead of an empty table or a "Loading" that never ends.
import { esc, distance, lightTime } from '../core/format.js';
import { missionsNow, relativeTime } from '../core/craft.js';
import { cometsNearNow, cometNames, perihelionPassages, brightComets, cometsComing, seeingWords } from '../core/comets.js';
import { formatUtc } from '../core/time.js';
import { byKey, layer } from './world.js';

const $ = s => document.querySelector(s);
const PHONE_W = 900;   // solar.html's phone layout: the list and the card share the bottom of the screen
const RETRY_MS = 60e3;

export function createLists({ craft, comets, small, clock, find, eclipses, retry = id => (id === 'eclipses' ? eclipses.load() : Promise.resolve()) }) {
  let open = null, timer = 0, waiting = null;
  const short = au => distance(au).replace(/ · .*/, '');
  // statuses are today's: at an earlier clock time an "Ended 2017" mission was still flying
  const MISSION_OVER = /^(Ended|Silent since)|\blanded\b/i;   // past its track because the mission is over, not because the data ends
  const statusAt = st => { const m = /^(Ended|Silent since) (\d{4})/.exec(st || ''); return m && 2000 + (clock.jd - 2451545) / 365.25 < +m[2] ? 'In flight' : st; };
  /** A row's name: a button (the row's click handler does the flying; the button gives it a keyboard stop). */
  const fly = (key, label) => `<button class="fly" data-fly="${esc(key)}" title="Fly there">${esc(label)}</button>`;
  const failed = (what, id) => `<p class="note">${esc(what)} did not load (network or a blocker).</p><p><button class="go" data-retry="${esc(id)}">Try again</button></p>`;

  function missionsHtml() {
    const head = `<div class="k">Deep-space missions · ${esc(clock.live ? 'now' : 'at the clock\'s time')}</div>`;
    if (!craft.craft.length) return head + (layer('craft')?.failed ? failed('The spacecraft data', 'craft') : '<p class="note">Loading the spacecraft (JPL Horizons)…</p>');
    const E = byKey.earth.pos, rows = missionsNow(craft.craft.map(c => c.s), clock.jd, E, craft.centerAt);   // Moon orbiters around the Moon on screen
    return `${head}<h3>Nearest first · signal time is one way</h3>
      <table><tr><th>Mission</th><th>From Earth</th><th>Signal</th></tr>${rows.map(m => `<tr data-key="${esc('craft:' + m.name)}" class="${m.au == null ? 'off' : ''}">
        <td>${fly('key:craft:' + m.name, m.name)}<small>${esc(m.au == null ? (m.phase === 'before launch' ? 'not launched yet' : MISSION_OVER.test(m.status || '') ? 'no position (mission over)' : 'past the published track (JPL Horizons)') : statusAt(m.status))}${m.next ? ' · next: ' + esc(m.next[1]) + ' ' + esc(relativeTime(m.next[0] - clock.jd)) : ''}</small></td>
        <td>${m.au == null ? '—' : esc(short(m.au))}</td><td>${m.light == null ? '—' : esc(lightTime(m.au))}</td></tr>`).join('')}</table>
      <p class="note">Trajectories: JPL Horizons. Past the published track a craft leaving the Sun coasts on in a straight line; the others stop.</p>`;
  }
  /** "JPL SBDB, copy of 2026-10-13": the comet list is a snapshot, and a comet found since is not in it. */
  const sbdbCopy = () => small?.S?.made ? `JPL SBDB, copy of ${esc(small.S.made)} (comets found since are not in it)` : 'JPL SBDB';
  // the brightest comets: recomputed only when the clock has moved a day (each needs a peak search)
  let bright = null, coming = null, brightJd = null;
  function comingHtml() {
    if (!coming.length) return '';
    return `<div class="k">Coming up: comets due to peak brighter than magnitude 12</div><h3>Next three years · peak brightness as predicted</h3>
      <table><tr><th>Comet</th><th>Peak</th><th>Mag</th></tr>${coming.map(n => `<tr data-row="${esc(n.row[0])}"><td>${fly('row:' + n.row[0], cometNames(n.row[0]).display)}<small>${esc(seeingWords(n.peak.mag))}</small></td>
        <td>${esc(formatUtc(n.peak.jd).slice(0, 10))}<small>${esc(relativeTime(n.peak.jd - clock.jd))}</small></td><td>${n.peak.mag.toFixed(1)}</td></tr>`).join('')}</table>`;
  }
  function brightHtml() {
    if (brightJd == null || Math.abs(clock.jd - brightJd) > 1) {
      brightJd = clock.jd; bright = brightComets(comets.rows, clock.jd, { maxMag: 15, limit: 10, earth: byKey.earth.pos });
      coming = cometsComing(comets.rows, clock.jd, { days: 1100, maxMag: 12, limit: 8 });
    }
    if (!bright.length) return comingHtml();
    return `<div class="k">Brightest comets ${esc(clock.live ? 'now' : "at the clock's time")}</div><h3>Total magnitude (lower is brighter; 6 is the naked-eye limit) · when it peaks</h3>
      <table><tr><th>Comet</th><th>Mag</th><th>Peak</th></tr>${bright.map(n => { const nm = cometNames(n.row[0]), pk = n.peak, pkNow = pk && Math.abs(pk.jd - clock.jd) < 3;
        return `<tr data-row="${esc(n.row[0])}"><td>${fly('row:' + n.row[0], nm.display)}<small>${esc(seeingWords(n.mag))} · ${n.delta.toFixed(2)} AU from Earth</small></td><td>${n.mag.toFixed(1)}</td>
          <td>${pk ? (pkNow ? 'now' : esc(formatUtc(pk.jd).slice(0, 10))) + `<small>${pk.mag.toFixed(1)}${pkNow ? '' : ' · ' + esc(relativeTime(pk.jd - clock.jd))}</small>` : '—'}</td></tr>`; }).join('')}</table>
      <p class="note">Magnitudes: ${sbdbCopy()}, its M1 and K1 (m = M1 + 5 log Δ + K1 log r, as in Horizons). Comets often brighten or fade by magnitudes against these predictions; comets whose last orbit solution is too old to trust are left out.</p>` + comingHtml();
  }
  function cometsHtml() {
    if (!comets.rows.length) return '<div class="k">Comets</div>' + (layer('asteroids')?.failed ? '<p class="note">The comet data did not load (network or a blocker). Reload the page to try again.</p>' : '<p class="note">Loading the comets (JPL SBDB)…</p>');
    const E = byKey.earth.pos, near = cometsNearNow(comets.rows, clock.jd, E, { maxR: 3, limit: 15 });
    return brightHtml() + `<div class="k">Comets inside 3 AU of the Sun</div><h3>Best placed first (by distance from the Sun and Earth)</h3>
      <table><tr><th>Comet</th><th>Sun</th><th>Earth</th></tr>${near.map(n => { const nm = cometNames(n.row[0]), tp = perihelionPassages(n.c, clock.jd - 400, clock.jd + 400)[0];
        return `<tr data-row="${esc(n.row[0])}"><td>${fly('row:' + n.row[0], nm.display)}<small>${tp ? 'perihelion ' + esc(relativeTime(tp - clock.jd)) : ''}</small></td><td>${n.r.toFixed(2)} AU</td><td>${n.delta.toFixed(2)} AU</td></tr>`; }).join('') || '<tr><td colspan="3">None right now.</td></tr>'}</table>
      <p class="note">Orbits: ${sbdbCopy()}, two-body. Tails switch on inside ~5 AU of the Sun.</p>`;
  }
  /** Load the Sun and Moon once at a time; a failure is remembered (eclipses.failedAt) and shown, not retried every 2 s. */
  function loadEvents() {
    if (waiting) return;
    waiting = Promise.resolve(retry('eclipses')).catch(() => {}).finally(() => { waiting = null; if (open === 'events') render(); });   // only into the eclipse list: the reader may have moved on
  }
  function eventsHtml() {
    const head = '<div class="k">Eclipses and lunar occultations</div>';
    if (!eclipses.ready) {
      if (!waiting && performance.now() - eclipses.failedAt < RETRY_MS) return head + failed('The Sun and Moon data', 'eclipses');
      loadEvents(); return head + '<p class="note">Loading the Sun and the Moon (JPL Horizons)…</p>';
    }
    const rows = eclipses.around(clock.jd, 40), cls = e => e.type === 'occultation' ? 'occ' : e.type;
    return `${head}<h3>Seen from space: shadows, the Sun-Earth-Moon line · times UTC</h3>
      <table><tr><th>Event</th><th>When</th><th></th></tr>${rows.map(e => { const w = e.words;
        return `<tr data-key="${esc(w.key)}" class="${e.jd < clock.jd - 0.3 ? 'past ' : ''}${cls(e)}"><td>${fly('key:' + w.key, w.title)}<small>${esc(w.detail)}</small><small>${esc(w.where)}</small></td>
          <td>${esc(formatUtc(e.jd).slice(0, 10))}<small>${esc(formatUtc(e.jd).slice(11, 16))} · ${esc(relativeTime(e.jd - clock.jd))}</small></td>
          <td><button class="go" data-jump="${esc(w.key)}" title="Set the clock to its greatest moment and look">Jump</button><button class="go" data-watch="${esc(w.key)}" title="Play it from the start, 10 minutes a second">▶</button></td></tr>`; }).join('')}</table>
      <p class="note">Sun and Moon: JPL Horizons, 2026-2030. Lunar shadow by Danjon's rule, as NASA's canon. Occultations: Aldebaran, Regulus, Spica, Antares, the Pleiades and the five bright planets, where the Moon covers them somewhere on Earth.</p>`;
  }

  // ---- drawing, keeping the keyboard focus on the same button across a redraw
  const FOCUS_KEYS = ['fly', 'jump', 'watch', 'retry'];
  const focusKey = el => { for (const k of FOCUS_KEYS) if (el?.dataset?.[k] != null) return [k, el.dataset[k]]; return null; };
  function render() {
    if (!open) return;
    const box = $('#listB'), a = document.activeElement, had = a && box.contains(a) ? focusKey(a) : null;
    box.innerHTML = open === 'missions' ? missionsHtml() : open === 'events' ? eventsHtml() : cometsHtml();
    if (had) [...box.querySelectorAll(`[data-${had[0]}]`)].find(el => el.dataset[had[0]] === had[1])?.focus({ preventScroll: true });
  }
  /** The 2 s refresh: not while a keyboard user is inside the list (they would lose their place; the numbers wait). */
  function tick() {
    const a = document.activeElement;
    if (a && $('#list').contains(a) && document.documentElement.classList.contains('oo-kbd')) return;
    render();
  }
  /** On a phone the list covers the bottom of the screen, where the card for the pick opens: close it first. */
  const closeOnPhone = () => { if (open && innerWidth <= PHONE_W) show(open); };
  function pickRow(tr) {
    if (tr.dataset.key) {
      const b = byKey[tr.dataset.key]; if (!b || b.launched === false) return;
      closeOnPhone(); find.flyTo(b);
    } else {
      const row = comets.rows.find(r => r[0] === tr.dataset.row); if (!row) return;
      closeOnPhone(); find.flyTo(comets.cometBody(row, { transient: !byKey['comet:' + row[0]] }));
    }
  }
  // one listener for every row and button, made once (the rows are redrawn every 2 s)
  $('#listB').addEventListener('click', ev => {
    const t = /** @type {HTMLElement} */ (ev.target), bt = /** @type {HTMLElement} */ (t.closest('[data-jump],[data-watch],[data-retry]'));
    if (bt) {
      if (bt.dataset.retry) {
        if (bt.dataset.retry === 'eclipses') { eclipses.failedAt = -Infinity; loadEvents(); }
        else { const l = layer(bt.dataset.retry); if (l) l.failed = false; Promise.resolve(retry(bt.dataset.retry)).catch(() => {}).finally(() => { if (open) render(); }); }
        render(); return;
      }
      const k = bt.dataset.jump || bt.dataset.watch, e = eclipses.events.find(x => x.words.key === k);
      if (e) { closeOnPhone(); eclipses.jump(e, { watch: !!bt.dataset.watch }); }
      return;
    }
    const tr = /** @type {HTMLElement} */ (t.closest('tr[data-key],tr[data-row]')); if (tr) pickRow(tr);
  });
  function show(which) {
    open = open === which ? null : which; $('#list').style.display = open ? 'block' : 'none'; clearInterval(timer);
    if (open && innerWidth <= PHONE_W) $('#dock').classList.remove('open');   // phones: the layer panel would cover it
    if (open) { render(); timer = setInterval(tick, 2000); }
  }
  $('#bMissions').onclick = () => show('missions');
  $('#bComets').onclick = () => show('comets');
  $('#bEclipses').onclick = () => show('events');
  $('#listX').onclick = () => show(open);
  return { show };
}
