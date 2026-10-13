// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The sea, measured: NOAA NDBC's buoys and coastal stations (~870 reporting: waves, wind, water and air temperature,
// pressure; their latest observation, refreshed every 10 minutes while the layer is on), its DART tsunami buoys (~75 on
// the deep-sea floor; a card reads the buoy's own file: the water column height and whether it is in event mode), and
// NOAA CO-OPS tide gauges (~300 on US coasts and the Great Lakes; a card reads the level now and the next high and low).
// NDBC sends no CORS headers, so its files come through the local helper or the website's relay; CO-OPS sends them.
// Parsing and the card's words are shared (core/ocean.js). All NOAA data, public domain.
import { C, esc, toast, getText, getJSON, relayed } from './env.js';
import { scene } from './viewer.js';
import { L, setCount } from './layers.js';
import { state } from './state.js';
import {
  NDBC_LATEST, NDBC_STATIONS, NDBC_TYPES, parseNdbcLatest, parseNdbcStations, mergeNdbc, waveLook, buoyRows, agoWords,
  dartUrl, ndbcPage, parseDart, dartStatus, DART_MODES,
  COOPS_STATIONS, parseCoopsStations, coopsDatum, coopsUrl, parseCoopsLatest, parseCoopsHilo, nextTides, tideRows, coopsPage,
} from '../core/ocean.js';

const REFRESH = 10 * 60e3;
const buoyPts = scene.primitives.add(new C.PointPrimitiveCollection());
const dartPts = scene.primitives.add(new C.PointPrimitiveCollection());
const tidePts = scene.primitives.add(new C.PointPrimitiveCollection());
buoyPts.show = dartPts.show = tidePts.show = false;
const SCALE = new C.NearFarScalar(2e5, 1.6, 2e7, 0.7), OUTLINE = C.Color.BLACK.withAlpha(0.55);
const col = css => C.Color.fromCssColorString(css);
const rows = list => '<dl>' + list.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>';
const link = (url, words) => url ? `<div class="acts"><a class="chipbtn" href="${esc(url)}" target="_blank" rel="noopener">${esc(words)}</a></div>` : '';
const needsHelper = () => { toast('NOAA\'s buoy files need the download version (its local helper relays them) or the published website', 4000); };

// NDBC's station list: names, owners and types for both layers, fetched once
let stationList = null;
const stations = () => stationList || (stationList = (async () => {
  const via = relayed(NDBC_STATIONS); if (!via) throw new Error('no relay');
  return parseNdbcStations(await getText(via, { timeout: 60000 }));
})().catch(e => { stationList = null; throw e; }));

// ---------------------------------------------------------------- buoys and coastal stations
const BuoyProto = {
  kind: 'buoy',
  tip() { const b = [this.name || 'Station ' + this.id]; if (this.waveM != null) b.push(`waves ${this.waveM.toFixed(1)} m`); if (this.waterC != null) b.push(`water ${this.waterC.toFixed(1)} °C`); else if (this.windMs != null) b.push(`wind ${this.windMs.toFixed(0)} m/s`); return '🌊 ' + b.join(' · '); },
  cardHtml() {
    const [words, color] = waveLook(this.waveM);
    return `<div class="k" style="--c:${color}">NOAA NDBC · ${esc(NDBC_TYPES[this.type] || NDBC_TYPES.other)}</div><h2>${esc(this.name || 'Station ' + this.id)}</h2>`
      + rows([...buoyRows(this), ['Station', [this.id, this.owner].filter(Boolean).join(' · ')]])
      + (this.waveM == null ? '' : `<div class="note" style="margin-top:6px">Sea state: ${esc(words)}. Significant wave height is the average of the highest third of the waves; single waves can be twice as high.</div>`)
      + link(ndbcPage(this.id), 'NDBC station page')
      + '<div class="note" style="margin-top:8px">Each station reports about once an hour; this is its latest report. NOAA National Data Buoy Center (public domain).</div>';
  },
};
export const Buoys = {
  list: [], loading: null, at: 0, timer: 0,
  async load() {
    const via = relayed(NDBC_LATEST); if (!via) { needsHelper(); return; }
    const [txt, st] = await Promise.all([getText(via, { timeout: 60000 }), stations().catch(() => [])]);
    const list = mergeNdbc(parseNdbcLatest(txt), st);
    buoyPts.removeAll(); this.list = [];
    for (const r of list) {
      const o = Object.assign(Object.create(BuoyProto), r), c = col(waveLook(r.waveM)[1]);
      o.pt = buoyPts.add({ position: C.Cartesian3.fromDegrees(r.lon, r.lat, 0), pixelSize: r.waveM != null ? 7 : 5, color: c, outlineColor: OUTLINE, outlineWidth: 1.5, scaleByDistance: SCALE, id: o });
      this.list.push(o);
    }
    this.at = Date.now(); setCount('buoys', this.list.length); scene.requestRender();
  },
  apply() {
    buoyPts.show = L.buoys.on; scene.requestRender();
    if (!L.buoys.on) return;
    if (!this.loading && Date.now() - this.at > REFRESH) this.loading = this.load().catch(e => console.warn('buoys', e.message)).finally(() => { this.loading = null; });
    if (!this.timer) this.timer = setInterval(() => { if (L.buoys.on && !document.hidden) this.apply(); }, REFRESH);
  },
};

// ---------------------------------------------------------------- DART tsunami buoys
const DART_LOOK = { event: '#ff4d6d', standard: '#ffd45c', late: '#c9a35a', silent: '#8b9bab' };
const DartProto = {
  kind: 'dart',
  tip() { return `DART tsunami buoy ${this.id} · ${this.name}`; },
  cardHtml() {
    return `<div class="k" style="--c:${DART_LOOK.standard}">NOAA DART · tsunami buoy</div><h2>${esc(this.name || this.id)}</h2>`
      + `<div id="dartBody">${rows([['Station', this.id + (this.owner ? ' · ' + this.owner : '')]])}<p class="note">Reading the buoy's latest data…</p></div>`
      + link(ndbcPage(this.id), 'NDBC station page')
      + '<div class="note" style="margin-top:8px">A pressure sensor on the sea floor measures the height of the water above it. Tides move it by a metre or more over hours; a tsunami passing over shows as a sudden change of a few centimetres or more. A quake\'s shaking or a sudden change switches the buoy into event mode (readings every 15 seconds, then every minute) for a few hours; tests do too. Official warnings come from tsunami.gov. NOAA National Data Buoy Center (public domain).</div>';
  },
  async afterCard(card) {
    const body = card.querySelector('#dartBody'), url = dartUrl(this.id), via = url && relayed(url);
    if (!body) return;
    if (!via) { body.querySelector('.note').textContent = 'The buoy\'s file needs the download version (its local helper relays it) or the published website.'; return; }
    try {
      const d = parseDart(await getText(via, { timeout: 60000 }), { max: 200 }), s = dartStatus(d);
      if (state.selected !== this || !body.isConnected) return;
      const l = d.latest, k = card.querySelector('.k'); if (k) k.style.setProperty('--c', DART_LOOK[s.state]);
      body.innerHTML = rows([['Status', s.words], ...(l ? [['Water column', `${l.heightM.toFixed(3)} m above the sensor`], ['Sampling', DART_MODES[l.mode] || 'mode ' + l.mode], ['Last reading', agoWords(l.t, Date.now(), true)]] : []),
        ...(s.rangeM != null ? [['Change, last 6 h', `${s.rangeM.toFixed(3)} m (mostly the tide)`]] : []), ['Station', this.id + (this.owner ? ' · ' + this.owner : '')]]);
    } catch (e) { if (body.isConnected) body.querySelector('.note').textContent = 'NDBC is not answering for this buoy right now (' + e.message + ').'; }
  },
};
export const Darts = {
  list: [], loading: null,
  async load() {
    const st = (await stations()).filter(s => s.type === 'dart');
    dartPts.removeAll(); this.list = [];
    for (const s of st) {
      const o = Object.assign(Object.create(DartProto), s), c = col(s.dartData ? DART_LOOK.standard : DART_LOOK.silent);
      o.pt = dartPts.add({ position: C.Cartesian3.fromDegrees(s.lon, s.lat, 0), pixelSize: 8, color: c.withAlpha(s.dartData ? 1 : 0.7), outlineColor: col('#2a1d00'), outlineWidth: 2, scaleByDistance: SCALE, id: o });
      this.list.push(o);
    }
    setCount('dart', this.list.length); scene.requestRender();
  },
  apply() {
    dartPts.show = L.dart.on; scene.requestRender();
    if (L.dart.on && !this.loading && !this.list.length) {
      if (!relayed(NDBC_STATIONS)) { needsHelper(); return; }
      this.loading = this.load().catch(e => console.warn('dart', e.message)).finally(() => { this.loading = null; });
    }
  },
};

// ---------------------------------------------------------------- CO-OPS tide gauges
const TIDE = '#5fd3ff', LAKE = '#9fe3ff';
const coops = url => getJSON(url, { timeout: 30000 });
const TideProto = {
  kind: 'tide',
  tip() { return `Tide gauge · ${this.name}${this.state ? ', ' + this.state : ''}${this.greatLakes ? ' (lake level)' : ''}`; },
  cardHtml() {
    return `<div class="k" style="--c:${this.greatLakes ? LAKE : TIDE}">NOAA CO-OPS · ${this.greatLakes ? 'lake level gauge' : this.tidal ? 'tide gauge' : 'water level gauge'}</div><h2>${esc(this.name)}${this.state ? ', ' + esc(this.state) : ''}</h2>`
      + `<div id="tideBody"><p class="note">Reading the gauge…</p></div>` + link(coopsPage(this.id), 'NOAA Tides & Currents page')
      + '<div class="note" style="margin-top:8px">The level is measured every 6 minutes (preliminary until NOAA checks it); highs and lows are NOAA\'s astronomical predictions, so wind and pressure can push the real water above or below them. NOAA CO-OPS (public domain).</div>';
  },
  async afterCard(card) {
    const body = card.querySelector('#tideBody'); if (!body) return;
    let datum = coopsDatum(this);
    try {
      let latest = parseCoopsLatest(await coops(coopsUrl(this.id, 'latest', { datum })));
      const alt = /Datum values are:\s*([A-Z]{3,4})/.exec(latest.error || '');   // a gauge with its own datums: use the first it offers
      if (alt) { datum = alt[1]; latest = parseCoopsLatest(await coops(coopsUrl(this.id, 'latest', { datum }))); }
      const tides = this.tidal ? nextTides(parseCoopsHilo(await coops(coopsUrl(this.id, 'hilo', { datum })).catch(() => ({})))) : null;
      if (state.selected !== this || !body.isConnected) return;
      body.innerHTML = rows([...tideRows({ ...this, tidal: datum === 'MLLW', greatLakes: datum === 'IGLD' }, latest, tides), ['Station', this.id]]);
    } catch (e) { if (body.isConnected) body.innerHTML = `<p class="note">NOAA Tides & Currents is not answering right now (${esc(e.message)}).</p>`; }
  },
};
export const Tides = {
  list: [], loading: null,
  async load() {
    const st = parseCoopsStations(await getJSON(COOPS_STATIONS, { timeout: 60000 }));
    tidePts.removeAll(); this.list = [];
    for (const s of st) {
      const o = Object.assign(Object.create(TideProto), s);
      o.pt = tidePts.add({ position: C.Cartesian3.fromDegrees(s.lon, s.lat, 0), pixelSize: 7, color: col(s.greatLakes ? LAKE : TIDE), outlineColor: col('#06303d'), outlineWidth: 2, scaleByDistance: SCALE, id: o });
      this.list.push(o);
    }
    setCount('tides', this.list.length); scene.requestRender();
  },
  apply() {
    tidePts.show = L.tides.on; scene.requestRender();
    if (L.tides.on && !this.loading && !this.list.length) this.loading = this.load().catch(e => console.warn('tides', e.message)).finally(() => { this.loading = null; });
  },
};
