// More on the aircraft card: what it is (class, maker and type, registration, owner, where it is registered, a photo),
// what it is doing (flight phase, height above the nearest field), where it is going (the route its callsign flies,
// from adsbdb, checked against where the plane actually is), its trail, and the boards of the airports at either end.
// ui.js builds the card; this fills in a section of it: the static part once (and again when adsbdb answers), the
// live part every 5 s (so the photo doesn't reload).
import { $, esc, fmt, toast } from './env.js';
import { state, hooks } from './state.js';
import { airClass, Air } from './aircraft.js';
import { AcInfo } from './acinfo.js';
import { Trails } from './trails.js';
import { Airports } from './airports.js';
import { LandWatch } from './landwatch.js';
import { TowerView } from './towerview.js';
import { Runways } from './runways.js';
import { altRampCss, trailGeoJSON } from '../core/trail.js';
import { etaText } from '../core/airports.js';
import { flightPhase } from '../core/phase.js';

const row = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '';
const apText = a => a ? `${a.iata || a.icao}${a.city || a.name ? ' ' + (a.city || a.name) : ''}` : '';

function staticHtml(o) {
  const v = o.info, a = v && v.aircraft, k = airClass(o);
  const what = a ? [a.manufacturer, a.type].filter(Boolean).join(' ') : o.desc || '';
  let html = `<dl class="ac-dl">${row('Kind', k.name + (k.why === 'guess' ? ' (a guess: no type known)' : k.why === 'category' ? ' (from its transponder category)' : ''))}${row('Aircraft', what)}`
    + `${!o.type && a && a.icaoType ? row('Type code', a.icaoType) : ''}${!o.reg && a && a.reg ? row('Registration', a.reg) : ''}${row('Operator', o.op || (a && a.owner) || '')}`
    + `${!o.country ? row('Registered in', (a && a.ownerCountry) || AcInfo.country(o)) : ''}</dl>`;
  if (v && v.route && !v.route.origin && v.route.airline) html += `<p class="note">${esc(v.route.airline.name)}${v.route.iata ? ' ' + esc(v.route.iata) : ''} · no route on file for this callsign</p>`;
  if (a && a.thumb) html += `<a class="ac-photo" href="${esc(a.photo || a.thumb)}" target="_blank" rel="noopener"><img src="${esc(a.thumb)}" alt="Photo of ${esc(a.reg || o.hex)}" loading="lazy" referrerpolicy="no-referrer"><span>photo: airport-data.com</span></a>`;
  return html;
}

function phaseHtml(o) {
  const p = { ...o, lat: o.cur?.lat ?? o.lat, lon: o.cur?.lon ?? o.lon, cls: airClass(o).cls };
  const ap = Airports.index.list.length ? Airports.index.nearest(p.lat, p.lon, 300) : null, f = flightPhase(p, ap);
  if (f.phase === 'unknown') return '';
  const where = ap ? ` · ${fmt(ap.km)} km from ${esc(ap.iata || ap.icao)}${f.agl != null && !o.ground && ap.km < 40 ? `, ${fmt(Math.max(0, f.agl) / 0.3048)} ft above it` : ''}` : '';
  const fin = (f.phase === 'final' || f.phase === 'approach') && ap ? Runways.final(ap, p) : null;
  return `<p class="ac-phase"><b>${esc(f.words)}${fin ? ' for ' + esc(fin.end.ident) : ''}</b>${where}</p>`;
}

function routeHtml(o) {
  const rt = o.info && o.info.route; if (!rt || !rt.origin || !rt.destination) return '';
  const f = AcInfo.fit(o), pct = f ? Math.round(f.progress * 100) : 0;
  const eta = f && f.fits && f.etaS != null && !o.ground ? ` · about ${etaText(f.etaS)} to go at this speed` : '';
  return `<div class="ac-route ${f && !f.fits ? 'off' : ''}"><div class="ac-legs"><button class="ac-ap" data-ap="${esc(rt.origin.icao)}" title="${esc(rt.origin.name)}: its board">${esc(rt.origin.iata || rt.origin.icao)}</button>`
    + `<span class="ac-bar"><i style="width:${pct}%"></i></span><button class="ac-ap" data-ap="${esc(rt.destination.icao)}" title="${esc(rt.destination.name)}: its board">${esc(rt.destination.iata || rt.destination.icao)}</button></div>`
    + `<div class="note">${esc(apText(rt.origin))} → ${esc(apText(rt.destination))}${rt.airline ? ' · ' + esc(rt.airline.name) : ''}${rt.iata ? ' ' + esc(rt.iata) : ''}`
    + (f ? (f.fits ? ` · ${fmt(f.leftKm)} km left${eta}` : ` · <b>${esc(f.why)}</b>: this callsign's usual route, which it may not be flying today`) : '') + '</div></div>';
}

function trailHtml(o) {
  if (!Trails.on) return '';
  const s = Trails.stats(o), pinned = Trails.pinned.has(o.hex);
  const what = s ? `${Math.round(s.minutes)} min · ${fmt(s.km)} km${s.climbM > 30 ? ` · climbed ${fmt(s.climbM / 0.3048)} ft` : ''}${s.descentM > 30 ? ` · descended ${fmt(s.descentM / 0.3048)} ft` : ''}`
    : 'starts with the next fix';
  return `<div class="ac-trail"><span class="ac-ramp" style="background:${altRampCss()}" title="Altitude: ground grey, orange low, violet at 40,000 ft"></span>`
    + `<span class="note">Trail (last ${Trails.minutes} min): ${esc(what)}</span>`
    + `<span class="ac-tbtns"><button class="chipbtn" data-tr="pin" title="Keep its trail drawn after you close this card">${pinned ? 'Unpin trail' : 'Pin trail'}</button>`
    + (s ? '<button class="chipbtn" data-tr="geo" title="Copy the trail as GeoJSON (with times and altitudes)">Copy GeoJSON</button>' : '')
    + `<select data-tr="min" aria-label="Trail length">${[10, 30, 60].map(m => `<option value="${m}" ${m === Trails.minutes ? 'selected' : ''}>${m} min</option>`).join('')}</select></span></div>`;
}

function actsHtml(o) {
  const tw = TowerView.towerFor(o, Airports.index), on = TowerView.on && TowerView.r === o;
  const b = [o.ground ? '' : `<button class="chipbtn" data-lw="1" title="A notification when it is on final and when it lands (keep this tab open)">${LandWatch.has(o) ? 'Stop watching' : 'Tell me when it lands'}</button>`,
    tw || on ? `<button class="chipbtn" data-tw="1" style="color:#9fe3ff" title="Watch it from the airport's tower, with a lens that keeps it in frame">${on ? 'Leave the tower' : `Watch from the ${esc(tw.iata || tw.icao)} tower`}</button>` : ''].join('');
  return b ? `<div class="acts">${b}</div>` : '';
}

function box(card) {
  let b = card.querySelector('#acMore');
  if (!b) { b = document.createElement('div'); b.id = 'acMore'; b.innerHTML = '<div class="ac-static"></div><div class="ac-live"></div>'; card.insertBefore(b, card.querySelector('.acts') || null); }
  return b;
}
function fillStatic(o, card) {
  box(card).querySelector('.ac-static').innerHTML = staticHtml(o) + (AcInfo.limited ? '<p class="note">adsbdb asked us to slow down: details again in a minute.</p>' : '');
}
function fillLive(o, card) {
  const live = box(card).querySelector('.ac-live');
  live.innerHTML = phaseHtml(o) + routeHtml(o) + trailHtml(o)
    + actsHtml(o);
  live.querySelectorAll('[data-ap]').forEach(b => { b.onclick = () => hooks.openAirport?.(b.dataset.ap, o.info && o.info.route); });
  const tw = live.querySelector('[data-tw]'); if (tw) tw.onclick = () => { if (TowerView.on && TowerView.r === o) TowerView.stop(); else TowerView.start(TowerView.towerFor(o, Airports.index), o); fillLive(o, card); };
  const lw = live.querySelector('[data-lw]'); if (lw) lw.onclick = () => LandWatch.toggle(o).then(() => fillLive(o, card));
  const pin = live.querySelector('[data-tr="pin"]'); if (pin) pin.onclick = () => { Trails.pin(o); fillLive(o, card); };
  const geo = live.querySelector('[data-tr="geo"]');
  if (geo) geo.onclick = () => {
    const t = Trails.get(o), g = t && trailGeoJSON(t.pts, { callsign: (o.flight || '').trim(), hex: o.hex, type: o.type || o.info?.aircraft?.icaoType || '', source: o.src });
    if (!g) return;
    navigator.clipboard.writeText(JSON.stringify(g)).then(() => toast(`Copied ${g.geometry.coordinates.length} points as GeoJSON`, 2500), () => toast('The browser would not let me copy', 3000));
  };
  const min = live.querySelector('[data-tr="min"]'); if (min) min.onchange = () => { Trails.setMinutes(+min.value); fillLive(o, card); };
}

/** Called by ui.js after it builds an aircraft's card. */
hooks.airCard = (o, card) => {
  fillStatic(o, card); fillLive(o, card);
  if (!Airports.loading) Airports.load().then(() => { if (state.selected === o && card.classList.contains('show')) fillLive(o, card); });   // for the phase: the nearest field
  if (o.info === undefined) AcInfo.get(o).then(v => {
    if (!v) return;
    Air.restyle(o);   // the type may change its model
    if (state.selected === o && card.classList.contains('show') && card.querySelector('#acMore')) { fillStatic(o, card); fillLive(o, card); }
  });
};
// keep the phase, the route progress and the trail current while the card is open (not while the trail menu is in use)
setInterval(() => {
  const o = state.selected, card = $('#card'), live = card && card.querySelector('#acMore .ac-live');
  if (o && o.kind === 'air' && live && card.classList.contains('show') && !live.contains(document.activeElement)) fillLive(o, card);
}, 5000);
