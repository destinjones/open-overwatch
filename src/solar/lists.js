// Three lists in one panel: every deep-space mission with its distance and signal time to Earth (nearest first); the
// brightest comets now (SBDB magnitude parameters) with when each peaks, then the best placed ones; and the eclipses
// and lunar occultations of 2026-2030 with buttons that jump the clock there (eclipses.js). Rows fly to the body.
// Numbers follow the clock.
import { esc, distance, lightTime } from '../core/format.js';
import { missionsNow, relativeTime } from '../core/craft.js';
import { cometsNearNow, cometNames, perihelionPassages, brightComets, cometsComing, seeingWords } from '../core/comets.js';
import { formatUtc } from '../core/time.js';
import { byKey } from './world.js';

const $ = s => document.querySelector(s);

export function createLists({ craft, comets, clock, find, eclipses }) {
  let open = null, timer = 0;
  const short = au => distance(au).replace(/ · .*/, '');
  // statuses are today's: at an earlier clock time an "Ended 2017" mission was still flying
  const statusAt = st => { const m = /^(Ended|Silent since) (\d{4})/.exec(st || ''); return m && 2000 + (clock.jd - 2451545) / 365.25 < +m[2] ? 'In flight' : st; };

  function missionsHtml() {
    const E = byKey.earth.pos, rows = missionsNow(craft.craft.map(c => c.s), clock.jd, E);
    return `<div class="k">Deep-space missions · ${esc(clock.live ? 'now' : 'at the clock\'s time')}</div><h3>Nearest first · signal time is one way</h3>
      <table><tr><th>Mission</th><th>From Earth</th><th>Signal</th></tr>${rows.map(m => `<tr data-key="${esc('craft:' + m.name)}" class="${m.au == null ? 'off' : ''}">
        <td>${esc(m.name)}<small>${esc(m.au == null ? (m.phase === 'before launch' ? 'not launched yet' : 'no position (mission over)') : statusAt(m.status))}${m.next ? ' · next: ' + esc(m.next[1]) + ' ' + esc(relativeTime(m.next[0] - clock.jd)) : ''}</small></td>
        <td>${m.au == null ? '—' : esc(short(m.au))}</td><td>${m.light == null ? '—' : esc(lightTime(m.au))}</td></tr>`).join('')}</table>
      <p class="note">Trajectories: JPL Horizons. Past the published track a craft leaving the Sun coasts on in a straight line; the others stop.</p>`;
  }
  // the brightest comets: recomputed only when the clock has moved a day (each needs a peak search)
  let bright = null, coming = null, brightJd = null;
  function comingHtml() {
    if (!coming.length) return '';
    return `<div class="k">Coming up: comets due to peak brighter than magnitude 12</div><h3>Next three years · peak brightness as predicted</h3>
      <table><tr><th>Comet</th><th>Peak</th><th>Mag</th></tr>${coming.map(n => `<tr data-row="${esc(n.row[0])}"><td>${esc(cometNames(n.row[0]).display)}<small>${esc(seeingWords(n.peak.mag))}</small></td>
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
        return `<tr data-row="${esc(n.row[0])}"><td>${esc(nm.display)}<small>${esc(seeingWords(n.mag))} · ${n.delta.toFixed(2)} AU from Earth</small></td><td>${n.mag.toFixed(1)}</td>
          <td>${pk ? (pkNow ? 'now' : esc(formatUtc(pk.jd).slice(0, 10))) + `<small>${pk.mag.toFixed(1)}${pkNow ? '' : ' · ' + esc(relativeTime(pk.jd - clock.jd))}</small>` : '—'}</td></tr>`; }).join('')}</table>
      <p class="note">Magnitudes: JPL SBDB's M1 and K1 (m = M1 + 5 log Δ + K1 log r, as in Horizons). Comets often brighten or fade by magnitudes against these predictions; comets whose last orbit solution is too old to trust are left out.</p>` + comingHtml();
  }
  function cometsHtml() {
    const E = byKey.earth.pos, near = cometsNearNow(comets.rows, clock.jd, E, { maxR: 3, limit: 15 });
    return brightHtml() + `<div class="k">Comets inside 3 AU of the Sun</div><h3>Best placed first (by distance from the Sun and Earth)</h3>
      <table><tr><th>Comet</th><th>Sun</th><th>Earth</th></tr>${near.map(n => { const nm = cometNames(n.row[0]), tp = perihelionPassages(n.c, clock.jd - 400, clock.jd + 400)[0];
        return `<tr data-row="${esc(n.row[0])}"><td>${esc(nm.display)}<small>${tp ? 'perihelion ' + esc(relativeTime(tp - clock.jd)) : ''}</small></td><td>${n.r.toFixed(2)} AU</td><td>${n.delta.toFixed(2)} AU</td></tr>`; }).join('') || '<tr><td colspan="3">None right now.</td></tr>'}</table>
      <p class="note">Orbits: JPL SBDB, two-body. Tails switch on inside ~5 AU of the Sun.</p>`;
  }
  function eventsHtml() {
    if (!eclipses.ready) { eclipses.load().then(render, () => { $('#listB').innerHTML = '<p class="note">The Sun and Moon data did not load.</p>'; }); return '<p class="note">Loading the Sun and the Moon (JPL Horizons)…</p>'; }
    const rows = eclipses.around(clock.jd, 40), cls = e => e.type === 'occultation' ? 'occ' : e.type;
    return `<div class="k">Eclipses and lunar occultations</div><h3>Seen from space: shadows, the Sun-Earth-Moon line · times UTC</h3>
      <table><tr><th>Event</th><th>When</th><th></th></tr>${rows.map(e => { const w = e.words;
        return `<tr data-key="${esc(w.key)}" class="${e.jd < clock.jd - 0.3 ? 'past ' : ''}${cls(e)}"><td>${esc(w.title)}<small>${esc(w.detail)}</small><small>${esc(w.where)}</small></td>
          <td>${esc(formatUtc(e.jd).slice(0, 10))}<small>${esc(formatUtc(e.jd).slice(11, 16))} · ${esc(relativeTime(e.jd - clock.jd))}</small></td>
          <td><button class="go" data-jump="${esc(w.key)}" title="Set the clock to its greatest moment and look">Jump</button><button class="go" data-watch="${esc(w.key)}" title="Play it from the start, 10 minutes a second">▶</button></td></tr>`; }).join('')}</table>
      <p class="note">Sun and Moon: JPL Horizons, 2026-2030. Lunar shadow by Danjon's rule, as NASA's canon. Occultations: Aldebaran, Regulus, Spica, Antares, the Pleiades and the five bright planets, where the Moon covers them somewhere on Earth.</p>`;
  }
  function render() {
    if (!open) return;
    $('#listB').innerHTML = open === 'missions' ? missionsHtml() : open === 'events' ? eventsHtml() : cometsHtml();
    document.querySelectorAll('#listB [data-jump],#listB [data-watch]').forEach(bt => { bt.onclick = ev => { ev.stopPropagation(); const k = bt.dataset.jump || bt.dataset.watch, e = eclipses.events.find(x => x.words.key === k); if (e) eclipses.jump(e, { watch: !!bt.dataset.watch }); }; });
    document.querySelectorAll('#listB tr[data-key]').forEach(tr => { tr.onclick = () => { const b = byKey[tr.dataset.key]; if (b && b.launched !== false) find.flyTo(b); }; });
    document.querySelectorAll('#listB tr[data-row]').forEach(tr => { tr.onclick = () => { const row = comets.rows.find(r => r[0] === tr.dataset.row); if (row) find.flyTo(comets.cometBody(row, { transient: !byKey['comet:' + row[0]] })); }; });
  }
  function show(which) {
    open = open === which ? null : which; $('#list').style.display = open ? 'block' : 'none'; clearInterval(timer);
    if (open && innerWidth <= 900) $('#dock').classList.remove('open');   // phones: the layer panel would cover it
    if (open) { render(); timer = setInterval(render, 2000); }
  }
  $('#bMissions').onclick = () => show('missions');
  $('#bComets').onclick = () => show('comets');
  $('#bEclipses').onclick = () => show('events');
  $('#listX').onclick = () => show(open);
  return { show };
}
