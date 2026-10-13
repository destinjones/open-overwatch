// More on the aircraft card: what it is (class, maker and type, registration, owner, where it is registered, a photo)
// and where it is going (the route its callsign flies, from adsbdb, checked against where the plane actually is), its
// trail, and the boards of the airports at either end. ui.js builds the card; this fills in a section of it.
import { $, esc, fmt } from './env.js';
import { state, hooks } from './state.js';
import { airClass, Air } from './aircraft.js';
import { AcInfo } from './acinfo.js';
import { Trails } from './trails.js';
import { altRampCss } from '../core/trail.js';
import { etaText } from '../core/airports.js';

const row = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '';
const apText = a => a ? `${a.iata || a.icao}${a.city || a.name ? ' ' + (a.city || a.name) : ''}` : '';

function infoHtml(o) {
  const v = o.info, a = v && v.aircraft, rt = v && v.route, k = airClass(o);
  const what = a ? [a.manufacturer, a.type].filter(Boolean).join(' ') : o.desc || '';
  let html = `<dl class="ac-dl">${row('Kind', k.name + (k.why === 'guess' ? ' (a guess: no type known)' : k.why === 'category' ? ' (from its transponder category)' : ''))}${row('Aircraft', what)}`
    + `${!o.type && a && a.icaoType ? row('Type code', a.icaoType) : ''}${!o.reg && a && a.reg ? row('Registration', a.reg) : ''}${row('Operator', o.op || (a && a.owner) || '')}`
    + `${!o.country ? row('Registered in', (a && a.ownerCountry) || AcInfo.country(o)) : ''}</dl>`;
  if (rt && rt.origin && rt.destination) {
    const f = AcInfo.fit(o), pct = f ? Math.round(f.progress * 100) : null;
    const eta = f && f.fits && f.etaS != null && !o.ground ? ` · about ${etaText(f.etaS)} to go at this speed` : '';
    html += `<div class="ac-route ${f && !f.fits ? 'off' : ''}"><div class="ac-legs"><button class="ac-ap" data-ap="${esc(rt.origin.icao)}" title="${esc(rt.origin.name)}">${esc(rt.origin.iata || rt.origin.icao)}</button>`
      + `<span class="ac-bar"><i style="width:${pct ?? 0}%"></i></span><button class="ac-ap" data-ap="${esc(rt.destination.icao)}" title="${esc(rt.destination.name)}">${esc(rt.destination.iata || rt.destination.icao)}</button></div>`
      + `<div class="note">${esc(apText(rt.origin))} → ${esc(apText(rt.destination))}${rt.airline ? ' · ' + esc(rt.airline.name) : ''}${rt.iata ? ' ' + esc(rt.iata) : ''}`
      + (f ? (f.fits ? ` · ${fmt(f.leftKm)} km left${eta}` : ` · <b>${esc(f.why)}</b>: this callsign's usual route, which it may not be flying today`) : '') + '</div></div>';
  } else if (rt && rt.airline) html += `<p class="note">${esc(rt.airline.name)}${rt.iata ? ' ' + esc(rt.iata) : ''} · no route on file for this callsign</p>`;
  if (a && a.thumb) html += `<a class="ac-photo" href="${esc(a.photo || a.thumb)}" target="_blank" rel="noopener"><img src="${esc(a.thumb)}" alt="Photo of ${esc(a.reg || o.hex)}" loading="lazy" referrerpolicy="no-referrer"><span>photo: airport-data.com</span></a>`;
  return html;
}

function trailHtml(o) {
  const s = Trails.stats(o), pinned = Trails.pinned.has(o.hex);
  const what = s ? `${Math.round(s.minutes)} min · ${fmt(s.km)} km${s.climbM > 30 ? ` · climbed ${fmt(s.climbM / 0.3048)} ft` : ''}${s.descentM > 30 ? ` · descended ${fmt(s.descentM / 0.3048)} ft` : ''}`
    : 'starts with the next fix';
  return `<div class="ac-trail"><span class="ac-ramp" style="background:${altRampCss()}" title="Altitude: ground grey, orange low, violet at 40,000 ft"></span>`
    + `<span class="note">Trail (last ${Trails.minutes} min): ${esc(what)}</span>`
    + `<span class="ac-tbtns"><button class="chipbtn" data-tr="pin" title="Keep its trail drawn after you close this card">${pinned ? 'Unpin trail' : 'Pin trail'}</button>`
    + `<select data-tr="min" aria-label="Trail length">${[10, 30, 60].map(m => `<option value="${m}" ${m === Trails.minutes ? 'selected' : ''}>${m} min</option>`).join('')}</select></span></div>`;
}

function fill(o, card) {
  let box = card.querySelector('#acMore');
  if (!box) { box = document.createElement('div'); box.id = 'acMore'; const acts = card.querySelector('.acts'); card.insertBefore(box, acts || null); }
  box.innerHTML = infoHtml(o) + (Trails.on ? trailHtml(o) : '') + (AcInfo.limited ? '<p class="note">adsbdb asked us to slow down: details again in a minute.</p>' : '');
  box.querySelectorAll('[data-ap]').forEach(b => { b.onclick = () => hooks.openAirport?.(b.dataset.ap, o.info && o.info.route); });
  const pin = box.querySelector('[data-tr="pin"]'); if (pin) pin.onclick = () => { Trails.pin(o); fill(o, card); };
  const min = box.querySelector('[data-tr="min"]'); if (min) min.onchange = () => { Trails.setMinutes(+min.value); fill(o, card); };
}

/** Called by ui.js after it builds an aircraft's card. */
hooks.airCard = (o, card) => {
  fill(o, card);
  if (o.info === undefined) AcInfo.get(o).then(v => {
    if (!v) return;
    Air.restyle(o);   // the type may change its model
    if (state.selected === o && $('#card').classList.contains('show')) fill(o, $('#card'));
  });
};
// keep the trail line and the route progress current while the card is open
setInterval(() => {
  const o = state.selected, box = $('#acMore');
  if (o && o.kind === 'air' && box && $('#card').classList.contains('show') && !box.contains(document.activeElement)) fill(o, $('#card'));
}, 5000);
