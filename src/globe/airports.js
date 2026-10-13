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
import { select, flyToObject } from './ui.js';
import { fetchAsset } from '../core/assets.js';
import { parseAirports, AirportIndex, makeBoard, etaText, BOARD } from '../core/airports.js';
import { airportWxUrl, airportWx, airportWxLine } from '../core/aloft.js';

const pts = scene.primitives.add(new C.PointPrimitiveCollection());
const labels = scene.primitives.add(new C.LabelCollection());
const COLOR = C.Color.fromCssColorString('#9fe3ff');
const LOOKUPS_PER_BOARD = 8;   // adsbdb look-ups to name where the board's planes come from or go

const CAT_COLOR = { VFR: '#3ee08f', MVFR: '#5fb0ff', IFR: '#ff6b6b', LIFR: '#e070ff' };
const wxCache = new Map();   // key -> { t, w }: the weather at a field, 15 minutes
async function fieldWeather(a) {
  const q = airportWxUrl(a.lat, a.lon), c = wxCache.get(q.key);
  if (c && Date.now() - c.t < 15 * 60e3) return c.w;
  const w = airportWx(await getJSON(q.url, { timeout: 15000 }));
  wxCache.set(q.key, { t: Date.now(), w }); return w;
}

const SECTIONS = [['arriving', 'Arriving', '#7dffa6'], ['departing', 'Departing', '#ffd27a'], ['recent', 'Just landed or took off', '#c9a0ff'], ['ground', 'On the ground', '#9fb3c8']];
const STATUS = { taxiing: 'taxiing', ground: 'parked' };

function boardRow(e, ap) {
  const r = e.r, k = airClass(r), rt = r.info && r.info.route;
  // the other end of its route on file, when the route agrees with what it is doing here (a route that starts here on a
  // plane landing here is some other day's flight under the same callsign: say nothing)
  const inbound = e.status === 'arriving' || e.status === 'landed' || (e.status !== 'departing' && e.status !== 'departed' && e.toHere);
  const other = rt && rt.origin && rt.destination ? (inbound ? rt.origin : rt.destination) : null;
  const where = other && other.icao !== ap.icao && (inbound ? !e.fromHere : !e.toHere) ? `${inbound ? 'from' : 'to'} ${other.iata || other.icao}` : '';
  const right = e.status === 'arriving' ? etaText(e.etaS) : e.status === 'departing' ? `climbing ${fmt((r.vr || 0) * 196.85)} ft/min`
    : e.status === 'landed' || e.status === 'departed' ? `${e.status} about ${etaText(e.agoS)} ago`.replace('about now ago', 'just now') : STATUS[e.status];
  const sq = r.emerg ? ` <em class="ab-emg">SQUAWK ${esc(r.squawk)}</em>` : '';
  return `<button class="cj ab-row${r.emerg ? ' emg' : ''}" data-hex="${esc(r.hex)}"><span><b>${esc(r.flight || r.hex)}</b>${sq} ${esc(r.type || (r.info && r.info.aircraft && r.info.aircraft.icaoType) || '')}${where ? ' · ' + esc(where) : ''}${e.sure ? ' ✓' : ''}</span>`
    + `<small>${e.status === 'ground' || e.status === 'taxiing' || e.status === 'landed' || e.status === 'departed' ? esc(k.name) : `${fmt(Math.max(0, e.aboveM) / 0.3048)} ft above the field · ${fmt(e.km)} km`} · ${esc(right)}</small></button>`;
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
      setCount('airports', this.list.length); this.apply();
    }).catch(e => { this.missing = true; console.warn('airports', e.message || e); });
    return this.loading;
  },
  apply() { pts.show = labels.show = L.airports.on; if (L.airports.on && !this.loading) this.load(); },
  /** The board for an airport from the live aircraft. */
  board(a) {
    const planes = [], now = Date.now(), dLon = 1.6 / Math.max(0.05, Math.cos(a.lat * Math.PI / 180));   // a box around the field first (~180 km)
    for (const r of Air.map.values()) if (Math.abs(r.lat - a.lat) < 1.6 && Math.abs(((r.lon - a.lon + 540) % 360) - 180) < dLon && now - r.ts < 20 * 60e3 && airShown(r)) {
      const p = r.cur ? { ...r, lat: r.cur.lat, lon: r.cur.lon, route: r.info && r.info.route } : { ...r, route: r.info && r.info.route };
      p.r = r; planes.push(p);
    }
    const b = makeBoard(a, planes, { others: this.index.near(a.lat, a.lon, BOARD.radiusKm + 30, 12) });
    for (const k of ['arriving', 'departing', 'ground', 'recent']) for (const e of b[k]) e.r = e.r.r;   // back to the live records
    return b;
  },
  cardHtml(a) {
    return `<div class="k" style="--c:#9fe3ff">${a.size === 2 ? 'Large airport' : 'Airport'}</div><h2>${esc(a.name)}</h2>`
      + `<dl>${a.iata ? `<dt>IATA</dt><dd>${esc(a.iata)}</dd>` : ''}<dt>ICAO</dt><dd>${esc(a.icao)}</dd>${a.city ? `<dt>City</dt><dd>${esc(a.city)}${a.cc ? ' · ' + esc(a.cc) : ''}</dd>` : ''}<dt>Elevation</dt><dd>${fmt(a.elevM / 0.3048)} ft</dd></dl>`
      + '<p id="apWx" class="ap-wx note">Weather…</p><div id="apBoard" class="ap-board"><p class="note">Reading the sky…</p></div>';
  },
  afterCard(a, card) {
    this.open = a; clearInterval(this.timer);
    fieldWeather(a).then(w => {   // the weather now at the field, METAR-like (a model's values: Open-Meteo)
      const el = card.querySelector('#apWx'); if (!el || state.selected !== a) return;
      el.innerHTML = w ? `${w.category ? `<b class="ap-cat" style="--c:${CAT_COLOR[w.category]}" title="Flight category from the model's visibility and an estimated cloud base">${w.category}</b> ` : ''}${esc(airportWxLine(w))} <span class="ap-src">Open-Meteo model${w.time ? ', ' + esc(w.time.slice(11, 16)) + 'Z' : ''}</span>` : '';
    }).catch(() => { const el = card.querySelector('#apWx'); if (el) el.remove(); });
    const draw = () => {
      const box = card.querySelector('#apBoard');
      if (!box || state.selected !== a || !card.classList.contains('show')) { clearInterval(this.timer); this.open = null; return; }
      if (!L.air.on && !L.mil.on) { box.innerHTML = '<p class="note">Switch on the aircraft layers to see who is coming and going.</p>'; return; }
      const b = this.board(a), n = b.arriving.length + b.departing.length + b.ground.length + b.recent.length;
      const next = b.arriving.find(e => e.etaS != null);
      box.innerHTML = (next ? `<div class="acts"><button class="chipbtn" data-next="${esc(next.r.hex)}" style="color:#7dffa6">Follow the next arrival · ${esc(next.r.flight || next.r.hex)}</button><button class="chipbtn" data-tower="${esc(next.r.hex)}" style="color:#9fe3ff" title="Watch it come in from the tower">From the tower</button></div>` : '')
        + (n ? SECTIONS.map(([k, name, col]) => b[k].length ? `<h3 style="color:${col}">${name} · ${b[k].length}</h3>${b[k].map(e => boardRow(e, a)).join('')}` : '').join('')
        : `<p class="note">No aircraft near ${esc(a.iata || a.icao)} right now that the feeds can see.</p>`)
        + `<p class="note">From the live aircraft on the globe: arriving means low and descending towards ${esc(a.iata || a.icao)}, departing means climbing away from it (within ${BOARD.radiusKm} km); ✓ the route on file agrees. Not a timetable. Airport list: ${esc(this.credit)}.</p>`;
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
