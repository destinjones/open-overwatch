// Two "right now" lists in one panel: every deep-space mission with its distance and signal time to Earth (nearest
// first), and the comets best placed near the Sun and Earth. Rows fly to the body. Numbers follow the clock.
import { esc, distance, lightTime } from '../core/format.js';
import { missionsNow, relativeTime } from '../core/craft.js';
import { cometsNearNow, cometNames, perihelionPassages } from '../core/comets.js';
import { byKey } from './world.js';

const $ = s => document.querySelector(s);

export function createLists({ craft, comets, clock, find }) {
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
  function cometsHtml() {
    const E = byKey.earth.pos, near = cometsNearNow(comets.rows, clock.jd, E, { maxR: 3, limit: 15 });
    return `<div class="k">Comets inside 3 AU of the Sun</div><h3>Best placed first (distance only: we have no brightness for most)</h3>
      <table><tr><th>Comet</th><th>Sun</th><th>Earth</th></tr>${near.map(n => { const nm = cometNames(n.row[0]), tp = perihelionPassages(n.c, clock.jd - 400, clock.jd + 400)[0];
        return `<tr data-row="${esc(n.row[0])}"><td>${esc(nm.display)}<small>${tp ? 'perihelion ' + esc(relativeTime(tp - clock.jd)) : ''}</small></td><td>${n.r.toFixed(2)} AU</td><td>${n.delta.toFixed(2)} AU</td></tr>`; }).join('') || '<tr><td colspan="3">None right now.</td></tr>'}</table>
      <p class="note">Orbits: JPL SBDB, two-body. Tails switch on inside ~5 AU of the Sun.</p>`;
  }
  function render() {
    if (!open) return;
    $('#listB').innerHTML = open === 'missions' ? missionsHtml() : cometsHtml();
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
  $('#listX').onclick = () => show(open);
  return { show };
}
