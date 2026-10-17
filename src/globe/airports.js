// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Airports and their boards. The large and medium airports of the world (data/airports.json, from OurAirports, public
// domain; made by brand/tools/make_airports.py) appear as dots below ~2,500 km, with codes below ~600 km. Click one for
// its board: the live aircraft near it that are arriving (low, descending towards it), departing (climbing away) or on
// the ground, worked out from the planes already on the globe (core/airports.js) and firmed up by the route on file
// where adsbdb knows one. It is not a timetable: a plane counts once it is close and low enough to tell.
import { C, $, esc, fmt, PHONE, getJSON } from './env.js';
import { scene, camHeight } from './viewer.js';
import { L, setCount, syncDock } from './layers.js';
import { state, hooks } from './state.js';
import { Air, AirModels, airShown, airClass } from './aircraft.js';
import { AcInfo } from './acinfo.js';
import { CockpitWx } from './cockpitwx.js';
import { TowerView } from './towerview.js';
import { Runways } from './runways.js';
import { select, flyToObject } from './ui.js';
import { fetchAsset } from '../core/assets.js';
import { parseAirports, AirportIndex, makeBoard, BOARD, BOARD_SECTIONS as SECTIONS, boardRowWords, planesNear } from '../core/airports.js';
import { windWords } from '../core/runways.js';
import { airportWxCache, airportWxLine } from '../core/aloft.js';
import { metarWords, tafWords, tafWorst, ageText, CAT_COLOR, CAT_WORDS } from '../core/metar.js';
import { arrivalEstimate, departureEstimate, etaRecordText } from '../core/eta.js';
import { historyText } from '../core/runwaylog.js';
import { FieldWx } from './fieldwx.js';
import { FieldWatch } from './fieldwatch.js';

const pts = scene.primitives.add(new C.PointPrimitiveCollection());
const labels = scene.primitives.add(new C.LabelCollection());
const COLOR = C.Color.fromCssColorString('#9fe3ff');
const LOOKUPS_PER_BOARD = 8;   // adsbdb look-ups to name where the board's planes come from or go

const fieldWx = airportWxCache({ json: url => getJSON(url, { timeout: 15000 }) });   // the model weather at a field, 15 minutes (core/aloft.js)
const fieldWeather = a => fieldWx.get(a);

function boardRow(e, ap) {
  const r = e.r, fin = e.status === 'arriving' ? Runways.final(ap, { ...r, lat: r.cur?.lat ?? r.lat, lon: r.cur?.lon ?? r.lon }) : null;
  // core/airports.js: the same words as the 2D map's boards (estimates as ranges, "final 27L", departed-ago)
  const { where, right, sub } = boardRowWords(e, ap, { fin, kind: airClass(r).name, fmt });
  const sq = r.emerg ? ` <em class="ab-emg">${/^7[567]00$/.test(r.squawk || '') ? 'SQUAWK ' + esc(r.squawk) : 'EMERGENCY'}</em>` : '';   // a declared emergency can come with any squawk
  return `<button class="cj ab-row${r.emerg ? ' emg' : ''}" data-hex="${esc(r.hex)}"><span><b>${esc(r.flight || r.hex)}</b>${sq} ${esc(r.type || (r.info && r.info.aircraft && r.info.aircraft.icaoType) || '')}${where ? ' · ' + esc(where) : ''}${e.sure ? ' ✓' : ''}</span>`
    + `<small>${esc(sub)} · ${esc(right)}</small></button>`;
}

const hm = t => new Date(t).toISOString().slice(11, 16) + 'Z';
const chip = (cat, title = CAT_WORDS[cat]) => cat ? `<b class="ap-cat" style="--c:${CAT_COLOR[cat]}" title="${esc(title || '')}">${cat}</b>` : '';
/** The METAR and TAF block of an airport card: the category, the report in plain words, the forecast period by period. */
function metarHtml(m, t) {
  if (!m && !t) return '<p class="note">No METAR or TAF from this field on aviationweather.gov.</p>';
  let h = '';
  if (m) {
    h += `<h3>${chip(m.category)} ${esc(m.type)} ${m.time ? hm(m.time) + ' · ' + esc(ageText(m.time)) : ''}${m.auto ? ' · automatic station' : ''}</h3>`
      + `<ul class="ap-words">${metarWords(m).map(w => `<li>${esc(w.text)}</li>`).join('')}</ul>`
      + `<details class="ap-raw"><summary>The report as sent</summary><code>${esc(m.raw)}</code></details>`;
  }
  if (t) {
    const lines = tafWords(t), worst = tafWorst(t, { hours: 6 });
    h += `<h3>Forecast · TAF${t.issued ? ' issued ' + hm(t.issued) : ''}${worst ? ` · next 6 h at worst ${chip(worst)}` : ''}</h3>`
      + (lines.length ? `<ul class="ap-words ap-taf">${lines.map(l => `<li>${chip(l.category)} ${esc(l.text)}</li>`).join('')}</ul>` : '<p class="note">The forecast has ended.</p>')
      + `<details class="ap-raw"><summary>The forecast as sent</summary><code>${esc(t.raw)}</code></details>`;
  }
  return h + '<p class="ap-src">Aviation Weather Center (NOAA), aviationweather.gov · times in UTC · decoded here; the raw text is what counts</p>';
}
/** Which runways the last hour's arrivals and departures used (download version, from the watched planes' trails). */
function historyHtml(a) {
  if (!FieldWatch.available) return '';
  const s = FieldWatch.log.summary(a.icao, Date.now(), 60), kept = FieldWatch.isKept(a);
  const btn = `<button class="chipbtn" data-keep style="color:#c9a0ff" title="Keep asking for fresh positions near ${esc(a.iata || a.icao)} with the card closed (up to 3 fields)">${kept ? 'Watching ✓' : 'Keep watching'}</button>`;
  if (!s.total) return `<div class="ap-hist"><h3 style="color:#c9a0ff">Runways used, last hour</h3><p class="note">Nothing seen landing or taking off yet: planes near the field are asked for a fresh position every 15 s while this card is open${kept ? ' (and while you keep watching it)' : ''}, and their trails are read for touchdowns and lift-offs.</p><div class="acts">${btn}</div></div>`;
  const bar = (list, col) => `<span class="ap-bar">${list.map(x => `<i style="flex:${x.n};--c:${col}" title="${esc(x.rwy)} ×${x.n}">${esc(x.rwy)}</i>`).join('')}</span>`;
  const ch = s.change ? `<p class="ap-rw">${s.change.kind === 'landing' ? 'Arrivals' : 'Departures'} moved from <b>${esc(s.change.from)}</b> to <b>${esc(s.change.to)}</b> about ${hm(s.change.at)}.</p>` : '';
  return `<div class="ap-hist"><h3 style="color:#c9a0ff">Runways used, last hour · ${s.total} seen</h3>`
    + (s.arrivals.length ? `<div class="ap-hrow"><span>Arrivals</span>${bar(s.arrivals, '#7dffa6')}</div>` : '')
    + (s.departures.length ? `<div class="ap-hrow"><span>Departures</span>${bar(s.departures, '#ffd27a')}</div>` : '')
    + `<p class="ap-rw">${esc(historyText(s))}</p>${ch}<div class="acts">${btn}</div></div>`;
}

export const Airports = {
  list: [], index: new AirportIndex([]), loading: null, open: null, timer: 0, credit: '', missing: false,
  load() {
    if (!this.loading) this.loading = fetchAsset('data/airports.json', 'json').then(d => {
      this.credit = d.source || 'OurAirports'; this.list = parseAirports(d); this.index = new AirportIndex(this.list); CockpitWx.airports = this.index;
      for (const a of this.list) {
        a.layer = 'airports'; a.cardHtml = () => this.cardHtml(a); a.afterCard = card => this.afterCard(a, card);
        a.pt = pts.add({ position: C.Cartesian3.fromDegrees(a.lon, a.lat, a.elevM + 30), pixelSize: a.size === 2 ? 6 : 4, color: COLOR.withAlpha(a.size === 2 ? 0.95 : 0.7), id: a,
          outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1, distanceDisplayCondition: new C.DistanceDisplayCondition(0, a.size === 2 ? 2.5e6 : 9.0e5) });
        if (a.size === 2 || !PHONE) a.label = labels.add({ position: C.Cartesian3.fromDegrees(a.lon, a.lat, a.elevM + 30), text: a.iata || a.icao, id: a, font: '600 12px "IBM Plex Mono", monospace',
          fillColor: COLOR, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(8, -8),
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, a.size === 2 ? 6.0e5 : 1.5e5) });
      }
      FieldWx.airports = this.index; FieldWatch.restore(this.index);
      setCount('airports', this.list.length); this.apply();
      Runways.load();   // runway ends for finals and the runway in use (nothing about runways without the file)
    }).catch(e => { this.missing = true; console.warn('airports', e.message || e); });
    return this.loading;
  },
  apply() { pts.show = labels.show = L.airports.on; if (L.airports.on && !this.loading) this.load(); },
  /** The board for an airport from the live aircraft. */
  board(a) {
    // where each is drawn now (fixes can be 15 min old), within ~180 km
    const now = Date.now(), planes = planesNear(a, Air.map.values(), r => airShown(r) ? (r.cur ? { ...r, lat: r.cur.lat, lon: r.cur.lon } : { ...r }) : null, now);
    const b = makeBoard(a, planes, { others: this.index.near(a.lat, a.lon, BOARD.radiusKm + 30, 12), now });
    for (const k of ['arriving', 'departing', 'ground', 'recent']) for (const e of b[k]) e.r = e.r.r;   // back to the live records
    // arrival estimates with a range (core/eta.js), widened or narrowed by how this field's estimates have done; each
    // fresh one (a fix under 90 s old) goes into the track record, scored when the plane is seen landing
    const spread = FieldWatch.eta.spread(a.icao);
    for (const e of b.arriving) {
      const r = e.r, p = { ...r, lat: r.cur?.lat ?? r.lat, lon: r.cur?.lon ?? r.lon };
      e.est = arrivalEstimate(a, p, { final: Runways.final(a, p), cls: airClass(r).cls, spread });
      if (e.est && now - r.ts < 90e3) FieldWatch.eta.note(a.icao, r.hex, now, e.est);
    }
    for (const e of b.departing) { const r = e.r; e.dep = departureEstimate(a, { ...r, lat: r.cur?.lat ?? r.lat, lon: r.cur?.lon ?? r.lon }, { cls: airClass(r).cls }); }
    const t = e => (e.est ? e.est.etaS : e.etaS ?? 1e9);
    b.arriving.sort((x, y) => t(x) - t(y));
    return b;
  },
  cardHtml(a) {
    return `<div class="k" style="--c:#9fe3ff">${a.size === 2 ? 'Large airport' : 'Airport'}</div><h2>${esc(a.name)}</h2>`
      + `<dl>${a.iata ? `<dt>IATA</dt><dd>${esc(a.iata)}</dd>` : ''}<dt>ICAO</dt><dd>${esc(a.icao)}</dd>${a.city ? `<dt>City</dt><dd>${esc(a.city)}${a.cc ? ' · ' + esc(a.cc) : ''}</dd>` : ''}<dt>Elevation</dt><dd>${fmt(a.elevM / 0.3048)} ft</dd></dl>`
      + '<p id="apWx" class="ap-wx note">Weather…</p><div id="apMetar" class="ap-metar"></div><div id="apBoard" class="ap-board"><p class="note">Reading the sky…</p></div>';
  },
  afterCard(a, card) {
    this.open = a; FieldWatch.open = a; clearInterval(this.timer);
    let wx = null, metar = null;
    Runways.load().then(() => { if (this.open === a) draw(); });
    const showModel = () => fieldWeather(a).then(w => {
      wx = w; if (this.open === a) draw();   // the weather now at the field, METAR-like (a model's values: Open-Meteo)
      const el = card.querySelector('#apWx'); if (!el || state.selected !== a) return;
      el.innerHTML = w ? `${w.category ? `<b class="ap-cat" style="--c:${CAT_COLOR[w.category]}" title="Flight category from the model's visibility and an estimated cloud base">${w.category}</b> ` : ''}${esc(airportWxLine(w))} <span class="ap-src">Open-Meteo model${w.time ? ', ' + esc(w.time.slice(11, 16)) + 'Z' : ''}</span>`
        + (FieldWx.available ? '' : ' <span class="ap-src">· the airport’s own METAR and TAF need the download version (aviationweather.gov refuses websites)</span>') : '';
    }).catch(() => { const el = card.querySelector('#apWx'); if (el) el.remove(); });
    // the real reports (download version): METAR and TAF in plain words; the model line only when the field has no METAR
    if (FieldWx.available && /^[A-Z]{4}$/.test(a.icao)) {
      Promise.all([FieldWx.metar(a.icao).catch(() => null), FieldWx.taf(a.icao).catch(() => null)]).then(([m, t]) => {
        if (state.selected !== a) return;
        metar = m; if (this.open === a) draw();
        const box = card.querySelector('#apMetar'); if (box) box.innerHTML = metarHtml(m, t);
        if (m) card.querySelector('#apWx')?.remove(); else showModel();
      });
    } else showModel();
    const draw = () => {
      const box = card.querySelector('#apBoard');
      if (!box || state.selected !== a || !card.classList.contains('show')) { clearInterval(this.timer); this.open = null; if (FieldWatch.open === a) FieldWatch.open = null; return; }
      if (!L.air.on && !L.mil.on) { box.innerHTML = '<p class="note">Switch on the aircraft layers to see who is coming and going.</p>'; return; }
      const b = this.board(a), n = b.arriving.length + b.departing.length + b.ground.length + b.recent.length;
      const next = b.arriving.find(e => e.etaS != null);
      // the runway in use: what arrivals are lined up with, else what the wind favours, and the wind on it
      const wind = metar && metar.wind && metar.wind.speedKt != null ? { dir: metar.wind.dir, speed: metar.wind.speedKt } : wx && { dir: wx.windDir, speed: wx.windKt };   // the METAR's wind first
      const use = Runways.inUse(a, b.arriving.map(e => ({ ...e.r, lat: e.r.cur?.lat ?? e.r.lat, lon: e.r.cur?.lon ?? e.r.lon })), wind);
      const onIt = use && wind && wind.speed != null && wind.dir != null ? Runways.wind(a, wind.dir, wind.speed).find(t => t.end === use.end) : null;
      const rwy = use ? `<p class="ap-rw">Runway in use: <b>${esc(use.end.ident)}</b> ${use.how === 'arrivals' ? `(${use.n} lined up)` : '(into the wind; a guess)'}`
        + (onIt ? ` · wind on it ${windWords(onIt)}` : '') + '</p>' : '';
      box.innerHTML = rwy + (next ? `<div class="acts"><button class="chipbtn" data-next="${esc(next.r.hex)}" style="color:#7dffa6">Follow the next arrival · ${esc(next.r.flight || next.r.hex)}</button><button class="chipbtn" data-tower="${esc(next.r.hex)}" style="color:#9fe3ff" title="Watch it come in from the tower">From the tower</button></div>` : '')
        + (n ? SECTIONS.map(([k, name, col]) => b[k].length ? `<h3 style="color:${col}">${name} · ${b[k].length}</h3>${b[k].map(e => boardRow(e, a)).join('')}` : '').join('')
        : `<p class="note">No aircraft near ${esc(a.iata || a.icao)} right now that the feeds can see.</p>`)
        + historyHtml(a)
        + `<p class="note">From the live aircraft on the globe: arriving means low and descending towards ${esc(a.iata || a.icao)}, departing means climbing away from it (within ${BOARD.radiusKm} km); ✓ the route on file agrees. Not a timetable: times are estimates from distance, ground speed and descent, with the range they could fall in. ${esc(etaRecordText(FieldWatch.eta.summary(a.icao)))} Airport list: ${esc(this.credit)}.</p>`;
      const kb = box.querySelector('[data-keep]'); if (kb) kb.onclick = () => { FieldWatch.keep(a); draw(); };
      const tb = box.querySelector('[data-tower]'); if (tb) tb.onclick = () => { const r = Air.map.get(tb.dataset.tower); if (r) TowerView.start(a, r); };
      const nb = box.querySelector('[data-next]'); if (nb) nb.onclick = () => { const r = Air.map.get(nb.dataset.next); if (r) { select(r); AirModels.follow(r); } };
      box.querySelectorAll('[data-hex]').forEach(el => { el.onclick = () => { const r = Air.map.get(el.dataset.hex); if (r) select(r); }; });
      return b;
    };
    const b = draw();
    if (b) {   // ask adsbdb where the first few come from or go (queued, cached a day)
      const ask = [...b.arriving, ...b.departing].map(e => e.r).filter(r => r.info === undefined).slice(0, LOOKUPS_PER_BOARD);
      for (const r of ask) AcInfo.get(r).then(v => { if (v && this.open === a) draw(); });
    }
    this.timer = setInterval(draw, 5000);
  },
  /** Open an airport's card by code (from an aircraft's route), loading the list first. A route airport that is not in
   *  the list (a small field) still gets a card from what the route says about it. */
  async show(code, route) {
    if (!L.airports.on) { L.airports.on = true; syncDock(); hooks.applyVisibility(); }
    await this.load();
    let a = this.index.get(code);
    if (!a && route) {
      const r = [route.origin, route.destination].find(x => x && (x.icao === code || x.iata === code));
      if (r) { a = { kind: 'airport', layer: 'airports', icao: r.icao || r.iata, iata: r.iata, name: r.name || code, city: r.city, cc: r.cc, lat: r.lat, lon: r.lon, elevM: (r.elevFt || 0) * 0.3048, size: 1 };
        a.cardHtml = () => this.cardHtml(a); a.afterCard = card => this.afterCard(a, card); }
    }
    if (!a) return false;
    select(a); flyToObject(a);
    return true;
  },
};
hooks.openAirport = (code, route) => Airports.show(code, route);
