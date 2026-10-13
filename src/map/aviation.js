// Aviation on the 2D map, from the same core code as the globe: what a plane is and where it is going (adsbdb through
// core/acinfo.js: type, registration, owner, the route its callsign flies checked against where the plane is, with
// core/actype.js), what it is doing (core/phase.js: parked … cruise … on final, and the runway it is lined up with),
// and an Airports layer (OurAirports' large and medium fields, data/airports.json) whose cards hold a live board of
// arrivals, departures and planes on the ground made from the aircraft already on the map (core/airports.js), the
// weather at the field with a VFR/IFR category (Open-Meteo, core/aloft.js), the runway in use and the wind along and
// across every runway (data/runways.json, core/runways.js). Runways are drawn from zoom 11. Boards are not timetables:
// a plane counts once it is close and low enough to tell.
import { $, C, Log, Store, destination, esc, fmt, late, toast } from './util.js';
import { map, vecRenderer } from './mapview.js';
import { Dyn, Layers, Points, Sel, feed, requestDraw } from './engine.js';
import { Detail } from './detail.js';
import { Air, Photos } from './aircraft.js';
import { fetchAsset } from '../core/assets.js';
import { createAcInfo } from '../core/acinfo.js';
import { classify, routeFit, hexCountry } from '../core/actype.js';
import { flightPhase } from '../core/phase.js';
import { parseAirports, AirportIndex, makeBoard, etaText, findAirport, BOARD, BOARD_SECTIONS, boardRowWords, planesNear } from '../core/airports.js';
import { parseRunways, RunwayBook, windWords } from '../core/runways.js';
import { airportWxUrl, airportWx, airportWxLine } from '../core/aloft.js';

const FT = 0.3048, KT = 0.514444, FPM = 0.00508, AP_COLOR = '#9fe3ff';
const CAT_COLOR = { VFR: '#3ee08f', MVFR: '#5fb0ff', IFR: '#ff6b6b', LIFR: '#e070ff' };
const LOOKUPS_PER_BOARD = 8;   // adsbdb look-ups to name where a board's planes come from or go

/** adsbdb, cached in this browser only (its route data may not be copied into other databases). */
export const AcInfo = createAcInfo({ store: Store, warn: m => console.warn(m) });

/** A map aircraft record (feet, knots, ft/min, its last fix) as the SI point the shared code reads, where the map draws
 *  it now (dead-reckoned like the canvas), or null without a position. */
export function airPoint(a, now = Date.now()) {
  if (a.lat == null) return null;
  let lat = a.lat, lon = a.lon;
  const dt = Math.min(150, (now - a.ts) / 1000 + (a.seen_pos || 0));
  if (a.gs > 30 && a.track != null && dt > 0 && !a.ground) [lat, lon] = destination(a.lat, a.lon, a.track, a.gs * KT * dt);
  return { lat, lon, alt: a.alt != null ? a.alt * FT : NaN, gs: a.gs != null ? a.gs * KT : null, vr: a.vr != null ? a.vr * FPM : 0, track: a.track ?? null,
    ground: !!a.ground, ts: a.ts, type: a.t || a.info?.aircraft?.icaoType || '', desc: a.desc || a.info?.aircraft?.type || '', cat: a.category, mil: a.mil,
    was: a.was ? { ...a.was, gs: a.was.gs != null ? a.was.gs * KT : null } : null };
}

/* ============================================================ airports and runways (loaded on first use) */
export const Airports = {
  list: [], index: new AirportIndex([]), runways: new RunwayBook(), loading: null, credit: 'OurAirports', open: null, asked: new Set(),
  load() {
    if (!this.loading) this.loading = Promise.all([
      fetchAsset('data/airports.json', 'json').then(d => { this.credit = d.source || this.credit; this.list = parseAirports(d); this.index = new AirportIndex(this.list); }),
      fetchAsset('data/runways.json', 'json').then(d => { this.runways = new RunwayBook(parseRunways(d)); }).catch(() => {}),   // without it: nothing about runways
    ]).catch(e => { this.loading = null; throw e; });
    return this.loading;
  },
  nearest(p) { return this.list.length && p ? this.index.nearest(p.lat, p.lon, 300) : null; },
  /** The board from the aircraft on the map (each entry's .r is the live record). */
  board(ap) {
    const now = Date.now(), planes = planesNear(ap, Dyn.air.values(), a => airPoint(a, now), now);
    const b = makeBoard(ap, planes, { others: this.index.near(ap.lat, ap.lon, BOARD.radiusKm + 30, 12), now });
    for (const k of ['arriving', 'departing', 'ground', 'recent']) for (const e of b[k]) { e.p = e.r; e.r = e.r.r; }
    return b;
  },
};

const wxCache = new Map();   // key -> { t, w | null, pending }: the weather at a field, 15 minutes
function fieldWeather(ap) {
  const q = airportWxUrl(ap.lat, ap.lon), c = wxCache.get(q.key);
  if (c && (c.pending || Date.now() - c.t < 15 * 60e3)) return c.w;
  wxCache.set(q.key, { t: Date.now(), w: c ? c.w : undefined, pending: true });
  fetch(q.url).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))).then(j => airportWx(j)).catch(() => null)
    .then(w => { wxCache.set(q.key, { t: Date.now(), w }); if (Sel.kind === 'airport') Detail.render(); });
  return c ? c.w : undefined;
}

/* ---- the layer: large fields from zoom 4, medium from 7; codes from 7 (large) and 9 */
export const lyAirports = Layers.add({ id: 'airports', group: 'Air', name: 'Airports and their boards', desc: 'OurAirports · click one for arrivals, departures and planes on the ground from the live aircraft, the weather, runways and crosswinds', color: AP_COLOR, shape: 'round', default: false, points: 'airports' });
Points.define('airports', 'airports', { minZoom: 4 });
Points.define('airports_m', 'airports', { minZoom: 7 });
const apItem = a => ({ lat: a.lat, lon: a.lon, r: a.size === 2 ? 3.6 : 2.4, color: AP_COLOR, fillAlpha: .55, stroke: true, label: a.iata || a.icao, labelZoom: a.size === 2 ? 7 : 9, kind: 'airport', obj: a, tip: `${a.iata || a.icao} · ${a.name}` });
feed(lyAirports, { interval: 86400, fetch: async () => {
  await Airports.load();
  Points.set('airports', Airports.list.filter(a => a.size === 2).map(apItem)); Points.set('airports_m', Airports.list.filter(a => a.size !== 2).map(apItem));
  lyAirports.feed.count = Airports.list.length; Runways2D.draw();
} });
lyAirports.disable = () => { Points.clear('airports_m'); Runways2D.clear(); };

/* ---- runways on the map from zoom 11: the strip, its end idents; the one in use green on an open airport card */
const Runways2D = {
  group: L.layerGroup().addTo(map), key: '',
  clear() { this.group.clearLayers(); this.key = ''; Points.clear('rwyends'); },
  draw() {
    if (!lyAirports.on || map.getZoom() < 11 || !Airports.list.length) { if (this.key) this.clear(); return; }
    const b = map.getBounds().pad(0.3), aps = Airports.index.inBox(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), 40);
    const use = Airports.open && Airports.open.use, key = aps.map(a => a.icao).join(',') + '|' + (use ? use.end.ident + Airports.open.icao : '') + '|' + Math.round(map.getZoom());
    if (key === this.key) return; this.key = key; this.group.clearLayers();
    const ends = [], w = Math.max(3, Math.min(14, (map.getZoom() - 10) * 3));
    for (const a of aps) for (const rw of Airports.runways.of(a) || []) {
      const live = use && Airports.open.icao === a.icao && rw.ends.includes(use.end);
      L.polyline(rw.ends.map(e => [e.lat, e.lon]), { color: live ? '#7dffa6' : '#c7d3de', weight: w, opacity: live ? .85 : .55, lineCap: 'butt', interactive: false, renderer: vecRenderer }).addTo(this.group);
      for (const e of rw.ends) ends.push({ lat: e.lat, lon: e.lon, r: 1.5, color: live && e === use.end ? '#7dffa6' : AP_COLOR, label: e.ident, labelZoom: 12, kind: 'airport', obj: a, tip: `${a.iata || a.icao} runway ${e.ident} · heading ${Math.round(e.hdg)}°${rw.lengthFt ? ' · ' + fmt.n(rw.lengthFt) + ' ft' : ''}` });
    }
    Points.set('rwyends', ends);
  },
};
Points.define('rwyends', 'airports', { minZoom: 11 });
map.on('moveend', () => Runways2D.draw());

/* ============================================================ the airport card */
const apHead = a => `${a.iata ? a.iata + ' · ' : ''}${a.icao}${a.city ? ' · ' + a.city : ''}${a.cc ? ', ' + a.cc : ''} · ${fmt.n(a.elevM / FT)} ft`;
function boardRow(e, ap) {
  const r = e.r, fin = e.status === 'arriving' ? Airports.runways.final(ap, e.p) : null;
  const { where, right, sub } = boardRowWords({ ...e, r: { ...r, vr: e.p.vr } }, ap, { fin, kind: classify(e.p).name, fmt: fmt.n });   // the same words as the globe's boards
  const type = r.t || (r.info && r.info.aircraft && r.info.aircraft.icaoType) || '';
  return `<button type="button" class="ab-row${r.emerg ? ' emg' : ''}" data-hex="${esc(r.hex)}"><span><b>${esc(r.flight || r.r || r.hex)}</b>${r.emerg ? ` <em>SQUAWK ${esc(r.squawk)}</em>` : ''} ${esc(type)}${where ? ' · ' + esc(where) : ''}${e.sure ? ' ✓' : ''}</span><small>${esc(sub)} · ${esc(right)}</small></button>`;
}
function runwaysHtml(a, wx, use) {
  const rws = Airports.runways.of(a); if (!rws) return '';
  const table = wx && wx.windKt != null && wx.windDir != null ? Airports.runways.wind(a, wx.windDir, wx.windKt) : [];
  const byEnd = new Map(table.map(t => [t.end, t]));
  const rows = rws.map(rw => `<tr><td><b>${esc(rw.ends.map(e => e.ident).join('/'))}</b></td><td>${rw.lengthFt ? fmt.n(rw.lengthFt) + ' ft' : ''}${rw.surface ? ' · ' + esc(rw.surface) : ''}</td></tr>`
    + rw.ends.map(e => { const t = byEnd.get(e); return t ? `<tr class="ap-end${use && use.end === e ? ' on' : ''}"><td>${esc(e.ident)}</td><td>${esc(windWords(t))}${Math.abs(t.cross) >= 15 ? ' <em>strong crosswind</em>' : t.head < -5 ? ' <em>tailwind</em>' : ''}</td></tr>` : ''; }).join('')).join('');
  return `<h4>Runways${table.length ? ': the wind on each end' : ''}</h4><table class="ap-rw">${rows}</table>`;
}
Detail.renderers.airport = a => {
  Airports.open = a; const wx = fieldWeather(a), b = Dyn.air.size ? Airports.board(a) : null;
  if (b && !Airports.asked.has(a.icao)) {   // ask adsbdb where the first few come from or go (queued, cached a day)
    Airports.asked.add(a.icao);
    for (const r of [...b.arriving, ...b.departing].map(e => e.r).filter(r => r.info === undefined).slice(0, LOOKUPS_PER_BOARD)) AcInfo.get(r).then(v => { if (v && Sel.kind === 'airport' && Sel.obj === a) Detail.render(); });
  }
  const use = b ? Airports.runways.inUse(a, b.arriving.map(e => e.p), wx && { dir: wx.windDir, speed: wx.windKt }) : null;
  const onIt = use && wx && wx.windKt != null ? Airports.runways.wind(a, wx.windDir, wx.windKt).find(t => t.end === use.end) : null;
  a.use = use; Runways2D.draw();
  const n = b ? b.arriving.length + b.departing.length + b.ground.length + b.recent.length : 0, code = a.iata || a.icao, next = b && b.arriving.find(e => e.etaS != null);
  const wxLine = wx === undefined ? '<p class="ap-wx">Weather…</p>' : wx ? `<p class="ap-wx">${wx.category ? `<b class="ap-cat" style="--c:${CAT_COLOR[wx.category]}" title="Flight category from the model's visibility and an estimated cloud base">${wx.category}</b> ` : ''}${esc(airportWxLine(wx))} <small>Open-Meteo model${wx.time ? ', ' + esc(wx.time.slice(11, 16)) + 'Z' : ''}</small></p>` : '';
  const board = !Layers.on('air_local') && !Layers.on('air_mil') && !Layers.on('air_opensky') ? `<p class="note">Switch on an aircraft layer to see who is coming and going.</p>`
    : n ? BOARD_SECTIONS.map(([k, name, col]) => b[k].length ? `<h4 style="color:${col}">${name} · ${b[k].length}</h4>${b[k].map(e => boardRow(e, a)).join('')}` : '').join('')
    : `<p class="note">No aircraft near ${esc(code)} right now that the feeds can see.</p>`;
  return `<div class="det ap">${Detail.head(AP_COLOR, a.size === 2 ? 'Large airport · OurAirports' : 'Airport · OurAirports', a.name, esc(apHead(a)))}${wxLine}`
    + (use ? `<p class="ap-use">Runway in use: <b>${esc(use.end.ident)}</b> ${use.how === 'arrivals' ? `(${use.n} lined up)` : '(into the wind; a guess)'}${onIt ? ` · wind on it ${esc(windWords(onIt))}` : ''}</p>` : '')
    + (next ? `<div class="actions"><button type="button" class="btn small" data-follow="${esc(next.r.hex)}">Follow the next arrival · ${esc(next.r.flight || next.r.hex)}</button></div>` : '')
    + `<div class="ap-board">${board}</div>${runwaysHtml(a, wx, use)}`
    + `<p class="note">From the live aircraft on the map: arriving means low and descending towards ${esc(code)}, departing means climbing away from it (within ${BOARD.radiusKm} km); ✓ the route on file agrees. Not a timetable. Airports and runways: ${esc(Airports.credit)}.</p>`
    + `<div class="actions"><button type="button" class="btn small" data-center="${esc(a.icao)}">Center</button></div></div>`;
};

/* ============================================================ more on the aircraft card */
const apText = a => a ? `${a.iata || a.icao}${a.city || a.name ? ' ' + (a.city || a.name) : ''}` : '';
/** The aviation section of an aircraft card (aircraft.js puts it under the photo). */
Air.more = a => {
  if (a.info === undefined && !AcInfo.limited) AcInfo.get(a).then(v => { if (v && Sel.kind === 'air' && Sel.id === a.hex) Detail.render(); });
  if (!Airports.list.length && !Airports.loading) Airports.load().then(() => { if (Sel.kind === 'air') Detail.render(); }).catch(() => {});
  const v = a.info, ac = v && v.aircraft, p = airPoint(a), k = classify(p || {});
  const rows = [['Kind', k.name + (k.why === 'guess' ? ' (a guess: no type known)' : k.why === 'category' ? ' (from its transponder category)' : '')],
    ['Aircraft', ac ? [ac.manufacturer, ac.type].filter(Boolean).join(' ') : null], ['Type code', !a.t && ac ? ac.icaoType : null], ['Registration', !a.r && ac ? ac.reg : null],
    ['Operator', !a.ownOp && ac ? ac.owner : null], ['Registered in', (ac && ac.ownerCountry) || a.country || hexCountry(a.hex)]];
  let html = Detail.kv(rows);
  // the phase, and the runway it is lined up with
  const ap = Airports.nearest(p), f = p ? flightPhase({ ...p, cls: k.cls }, ap) : null;
  if (f && f.phase !== 'unknown') {
    const fin = (f.phase === 'final' || f.phase === 'approach') && ap ? Airports.runways.final(ap, p) : null;
    const where = ap ? ` · ${fmt.n(ap.km)} km from <button type="button" class="ac-ap" data-ap="${esc(ap.icao)}">${esc(ap.iata || ap.icao)}</button>${f.agl != null && !a.ground && ap.km < 40 ? `, ${fmt.n(Math.max(0, f.agl) / FT)} ft above it` : ''}` : '';
    html += `<p class="ac-phase"><b>${esc(f.words)}${fin ? ' for ' + esc(fin.end.ident) : ''}</b>${where}</p>`;
  }
  // the route its callsign flies, checked against where it is
  const rt = v && v.route;
  if (rt && rt.origin && rt.destination) {
    const fit = p ? routeFit(rt, p) : null, pct = fit ? Math.round(fit.progress * 100) : 0;
    const eta = fit && fit.fits && fit.etaS != null && !a.ground ? ` · about ${etaText(fit.etaS)} to go at this speed` : '';
    html += `<div class="ac-route${fit && !fit.fits ? ' off' : ''}"><div class="ac-legs"><button type="button" class="ac-ap" data-ap="${esc(rt.origin.icao)}" title="${esc(rt.origin.name)}: its board">${esc(rt.origin.iata || rt.origin.icao)}</button>`
      + `<span class="ac-bar"><i style="width:${pct}%"></i></span><button type="button" class="ac-ap" data-ap="${esc(rt.destination.icao)}" title="${esc(rt.destination.name)}: its board">${esc(rt.destination.iata || rt.destination.icao)}</button></div>`
      + `<div class="note">${esc(apText(rt.origin))} → ${esc(apText(rt.destination))}${rt.airline ? ' · ' + esc(rt.airline.name) : ''}${rt.iata ? ' ' + esc(rt.iata) : ''}`
      + (fit ? (fit.fits ? ` · ${fmt.n(fit.leftKm)} km left${eta}` : ` · <b>${esc(fit.why)}</b>: this callsign's usual route, which it may not be flying today`) : '') + '</div></div>';
  } else if (rt && rt.airline) html += `<p class="note">${esc(rt.airline.name)}${rt.iata ? ' ' + esc(rt.iata) : ''} · no route on file for this callsign</p>`;
  if (ac && ac.thumb && Photos.cache.get(a.hex) === null) html += `<a class="ac-photo" href="${esc(ac.photo || ac.thumb)}" target="_blank" rel="noopener"><img src="${esc(ac.thumb)}" alt="Photo of ${esc(ac.reg || a.hex)}" loading="lazy" referrerpolicy="no-referrer"><span>photo: airport-data.com</span></a>`;
  if (AcInfo.limited) html += '<p class="note">adsbdb asked us to slow down: details again in a minute.</p>';
  else if (v === undefined) html += '<p class="note">Asking adsbdb what it is and where it is going…</p>';
  return `<div class="ac-more">${html}<p class="note">Type, owner and route: adsbdb.com (a route is the callsign's usual one).</p></div>`;
};

/* ============================================================ clicks inside cards, search, a place to open an airport */
export function showAirport(code, route) {
  return Airports.load().then(() => {
    let a = Airports.index.get(code);
    if (!a && route) {   // a small field on a route: a card from what the route says about it
      const r = [route.origin, route.destination].find(x => x && (x.icao === code || x.iata === code));
      if (r) a = { kind: 'airport', icao: r.icao || r.iata, iata: r.iata, name: r.name || code, city: r.city, cc: r.cc, lat: r.lat, lon: r.lon, elevM: (r.elevFt || 0) * FT, size: 1 };
    }
    if (!a) { toast(`No airport ${code} in the list`); return false; }
    if (!lyAirports.on) Layers.set('airports', true);
    map.flyTo([a.lat, a.lon], Math.max(map.getZoom(), 9), { duration: 0.8 }); Detail.show('airport', a, a.icao);
    return true;
  });
}
$('#detail').addEventListener('click', e => {
  const ap = e.target.closest('[data-ap]'), row = e.target.closest('[data-hex]'), fol = e.target.closest('[data-follow]'), ctr = e.target.closest('[data-center]');
  if (ap) { const sel = Sel.kind === 'air' ? Sel.obj : null; showAirport(ap.dataset.ap, sel && sel.info && sel.info.route); }
  else if (row || fol) { const a = Dyn.air.get((row || fol).dataset.hex || (fol && fol.dataset.follow)); if (!a) return; const p = airPoint(a); if (p) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 9), { duration: 0.8 }); Detail.show('air', a, a.hex); if (fol) Air.follow(a.hex); }
  else if (ctr) { const a = Sel.obj; if (a && a.kind === 'airport') map.flyTo([a.lat, a.lon], Math.max(map.getZoom(), 12), { duration: 0.8 }); }
});
/** For the search box: an airport by code, name or city, or null (loads the list on first use). */
late.findAirport = async q => { try { await Airports.load(); } catch (e) { return null; } return findAirport(Airports.list, q); };
late.showAirport = showAirport;
// a card that is open follows its airport's board and weather (the panel re-renders live kinds every 2 s)
setInterval(() => { if (Sel.kind !== 'airport' && Airports.open) { Airports.open.use = null; Airports.open = null; Runways2D.draw(); } }, 2000);

export const Aviation2D = { AcInfo, Airports, Runways2D, airPoint, showAirport };
