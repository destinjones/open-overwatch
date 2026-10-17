// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Tropical cyclones: NASA EONET's open severe-storm events (worldwide, CORS, no key) as a track and a marker sized and
// coloured by Saffir-Simpson category, NOAA NHC's official advisories for the Atlantic and East / Central Pacific
// (through the local helper, or the website's public relay), and forecasts: NOAA NHC's map service (CORS) gives the
// forecast track, the cone, coastal watches and warnings and the wind field now; GDACS (CORS) gives a track and cone
// for every other basin (JTWC and others). Cones and coast lines drape on the terrain or Google's 3D tiles.
// With the clock in the past (time travel): the storms going on then, from NASA EONET's closed events and GDACS's past
// cyclones, each track cut at the time shown and the storm where it was then (core/history.js); forecasts aren't archived.
import { C, esc, fmt, getJSON, relayed, viaCopy } from './env.js';
import { stamp, rep, stampReports } from '../core/liveprov.js';
import { viewer, scene } from './viewer.js';
import { L, setCount } from './layers.js';
import { hooks, state } from './state.js';
import { WW } from '../core/hazards.js';
import { stormAgreement, loadCyclones, category, catName, KIND_KT, NHC_CURRENT, stormSources, stormsFromEonet, gdacsGeometryUrl, gdacsKey, pruneKept } from '../core/cyclones.js';
import { parseEonet } from '../core/eonet.js';
import { gdacsForecast, retryBackoff } from '../core/hazards.js';
import { isPast, utcDay, eonetAtUrl, gdacsTcAtUrl, gdacsPastCyclones, stormsFromGdacs, stormsAt } from '../core/history.js';
import { Time } from './time.js';

const pts = scene.primitives.add(new C.PointPrimitiveCollection());
const lines = scene.primitives.add(new C.PolylineCollection());
const fc = new C.CustomDataSource('cyclone-forecasts'); viewer.dataSources.add(fc);
const gdacsKept = new Map();   // "event/episode" -> parsed geometry (an episode never changes); bounded by pruneKept
const retry = retryBackoff();   // a failed past day is asked again after 30 s, doubling to 5 min (sync runs every second)

const pastDays = new Map();   // UTC day -> Promise<storms around it, whole tracks> (past days don't change)
async function stormsAround(ms) {
  const json = getJSON, eonet = stormsFromEonet(parseEonet(await json(eonetAtUrl(ms, { category: 'severeStorms' }), { timeout: 30000 })));
  let gd = [];
  try {   // GDACS for what EONET lacks: only cyclones going on then, at most four geometries (~0.4 MB each)
    const names = new Set(eonet.map(s => s.title.toLowerCase().split(/\s+/).pop()));
    const past = gdacsPastCyclones(await json(gdacsTcAtUrl(ms), { timeout: 30000 })).filter(g => g.from <= ms && g.to + 12 * 3600e3 >= ms && !names.has(g.name.toLowerCase())).slice(0, 4);
    for (const g of past) {
      const key = gdacsKey(g);
      try { if (!gdacsKept.has(key)) gdacsKept.set(key, gdacsForecast(await json(gdacsGeometryUrl(g.eventid, g.episodeid), { timeout: 45000 }))); g.fc = gdacsKept.get(key); }
      catch (e) { console.warn('GDACS ' + g.name, e.message); }
    }
    pruneKept(gdacsKept, past);   // the day's geometries stay with its storms (g.fc); the cache keeps at most 24
    gd = stormsFromGdacs(past, eonet);
  } catch (e) { console.warn('GDACS (past)', e.message); }
  return eonet.concat(gd);
}

export const Storms = {
  list: [], live: [], past: false, pastDay: '', pastAt: 0,
  async load() {   // EONET, NHC, NOAA's forecasts and GDACS, merged per storm (core/cyclones.js, shared with the 2D map)
    this.live = await loadCyclones({ json: getJSON, nhc: !!relayed(NHC_CURRENT), kept: gdacsKept, warn: (what, e) => console.warn(what, e.message) });
    const copy = viaCopy(NHC_CURRENT) ? ['nhc'] : [];
    for (const s of this.live) { const { reports, agreeing } = stormAgreement(s); stampReports(s, 'storms', reports, agreeing, { cached: copy }); }   // which agencies place it here
    if (!this.past) this.draw(this.live);
  },
  /** Follow the clock: live storms now; in the past the storms of the time shown, redrawn every hour of clock time. */
  async sync() {
    const ms = Time.nowMs();
    if (!isPast(ms)) { if (this.past) { this.past = false; this.pastDay = ''; retry.ok(); this.draw(this.live); hooks.historyChanged?.(); } return; }
    if (!this.past) { this.past = true; this.draw([]); }
    if (!L.storms.on) return;
    const d = utcDay(ms);
    if (d !== this.pastDay || retry.claim(d)) {
      this.pastDay = d; this.base = null; this.loading = true; hooks.historyChanged?.();
      if (!pastDays.has(d)) { if (pastDays.size > 10) pastDays.delete(pastDays.keys().next().value); pastDays.set(d, stormsAround(Date.parse(d + 'T12:00:00Z')).catch(e => { pastDays.delete(d); throw e; })); }
      try { const base = await pastDays.get(d); if (this.pastDay !== d) return; retry.ok(); this.base = base; this.pastAt = NaN; }
      catch (e) { console.warn('storms (past)', e); if (this.pastDay === d) retry.failed(d); return; }   // keep the day: asked again after the wait
      finally { this.loading = false; }
    }
    if (this.base && !(Math.abs(ms - this.pastAt) < 3600e3)) { this.pastAt = ms; this.draw(stormsAt(this.base, Math.round(ms / 1000) * 1000)); hooks.historyChanged?.(); }
  },
  draw(list) {
    const sel = state.selected && this.list.includes(state.selected) ? state.selected : null;   // its card follows the clock (the same storm then, or closes)
    pts.removeAll(); lines.removeAll(); fc.entities.removeAll(); this.list = list;
    for (const s of list) {
      const [, , col] = category(s.kt), c = C.Color.fromCssColorString(col);
      s.tip = () => `🌀 ${s.title}${s.kt ? ' · ' + s.kt + ' kt' : ''}${s.fc && s.fc.cone.length ? ' · forecast cone' : ''}`;
      s.cardHtml = () => card(s, col);
      if (!s.prov) stamp(s, 'history', [rep(/GDACS/.test(s.src) ? 'gdacs' : 'eonet', { dataAt: s.date })]);   // time travel: an archived track
      s.pt = pts.add({ position: C.Cartesian3.fromDegrees(s.lon, s.lat, 3000), pixelSize: 9 + Math.max(0, category(s.kt)[1]) * 2.5, color: c.withAlpha(0.35), outlineColor: c, outlineWidth: 2, id: s, show: L.storms.on });
      if (s.track.length > 1 && !(s.fc && s.fc.past.length)) s.line = lines.add({ positions: s.track.map(p => C.Cartesian3.fromDegrees(p.lon, p.lat, 3000)), width: 2, material: C.Material.fromType('PolylineDash', { color: c.withAlpha(0.8), dashLength: 12 }), show: L.storms.on });
      if (s.fc) drawForecast(s);
    }
    fc.show = L.storms.on;
    setCount('storms', list.length); hooks.updateStats?.();
    if (sel) { const same = list.find(s => s.id === sel.id); if (same) hooks.reselect?.(same); else hooks.closeCard?.(); }
  },
  apply() { const on = L.storms.on && !state.lookup; for (const s of this.list) { s.pt.show = on; if (s.line) s.line.show = on; } fc.show = on; },   // look-up mode hides things on the ground
};

const deg = path => C.Cartesian3.fromDegreesArray(path.flat());
function drawForecast(s) {
  const f = s.fc, white = C.Color.WHITE, add = e => { const ent = fc.entities.add(e); ent.obj = s; return ent; };
  if (f.coherent) {
    for (const r of f.cone) {   // where the centre will probably be (2 times in 3); its impacts reach well outside
      add({ polygon: { hierarchy: deg(r), material: white.withAlpha(0.13), classificationType: C.ClassificationType.BOTH } });
      add({ polyline: { positions: deg(r), clampToGround: true, width: 1.6, material: white.withAlpha(0.7) } });
    }
    for (const p of f.track) add({ polyline: { positions: deg(p), clampToGround: true, width: 2.5, material: new C.PolylineDashMaterialProperty({ color: white.withAlpha(0.95), dashLength: 14 }) } });
  }
  for (const w of f.winds.slice().sort((a, b) => a.kt - b.kt)) {   // the wind field now: 34, 50 and 64 kt
    const col = w.kt >= 64 ? '#ff4d5e' : w.kt >= 50 ? '#ff9f5c' : '#ffe36e';
    for (const r of w.rings) add({ polygon: { hierarchy: deg(r), material: C.Color.fromCssColorString(col).withAlpha(0.16), classificationType: C.ClassificationType.BOTH } });
  }
  for (const w of f.warnings) for (const p of w.paths) add({ polyline: { positions: deg(p), clampToGround: true, width: 6, material: C.Color.fromCssColorString(WW[w.code][1]) } });
  for (const seg of f.past) for (const p of seg.paths) add({ polyline: { positions: deg(p), clampToGround: true, width: 2.5, material: C.Color.fromCssColorString(category(KIND_KT[seg.kind] || 30)[2]).withAlpha(0.85) } });
  for (const q of f.points.slice(f.points[0] && f.points[0].tau === 0 ? 1 : 0)) {   // the forecast positions (the first is "now": the marker)
    const col = C.Color.fromCssColorString(category(q.kt)[2]);
    add({ position: C.Cartesian3.fromDegrees(q.lon, q.lat, 3000), point: { pixelSize: 7, color: col, outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1 },
      label: { text: q.label + (q.kt ? ` · ${q.kt} kt` : ''), font: '600 12px "JetBrains Mono", monospace', fillColor: white, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: C.HorizontalOrigin.LEFT, pixelOffset: new C.Cartesian2(10, 0), distanceDisplayCondition: new C.DistanceDisplayCondition(0, 6e6), scaleByDistance: new C.NearFarScalar(1e6, 1, 6e6, 0.75) } });
  }
}

function card(s, col) {
  const row = (k, v) => v == null || v === '' ? '' : `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`, n = s.nhc || {}, f = s.fc;
  const links = s.links.concat(n.url ? [{ text: 'NHC public advisory', url: n.url }] : []).filter(l => /^https:\/\//.test(l.url || ''));
  const fcRows = f ? f.points.filter(q => q.tau == null || q.tau > 0).slice(0, 6).map(q => `<dt>${esc(q.tau != null ? `+${q.tau} h` : 'Forecast')}</dt><dd>${esc(q.label)}${q.kt ? ` · ${q.kt} kt (${esc(catName(q.kt))})` : ''}</dd>`).join('') : '';
  const ww = f && f.warnings.length ? [...new Set(f.warnings.map(w => WW[w.code][0]))].join(', ') : '';
  const srcs = stormSources(s);
  return `<div class="k" style="--c:${col}">Tropical cyclone · ${esc(srcs)}</div><h2>${esc(n.title || s.title)}</h2>
    <dl>${row('Strength', catName(s.kt))}${row('Max winds', s.kt ? `${s.kt} kt · ${fmt(s.kt * 1.852)} km/h` : '—')}${row('Pressure', n.pressure ? n.pressure + ' mb' : f && f.points[0] && f.points[0].mb ? f.points[0].mb + ' mb' : null)}${row('Moving', n.movement)}
    ${row('Position', `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}`)}${row(s.then ? 'Time shown' : 'Latest fix', s.date ? new Date(s.date).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null)}
    ${f && f.advisory ? row('Advisory', '#' + f.advisory.replace(/^0+/, '')) : ''}${row('Watches, warnings', ww)}${fcRows}</dl>
    ${links.length ? `<div class="acts">${links.slice(0, 4).map(l => `<a class="chipbtn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.text)}</a>`).join('')}</div>` : ''}
    <div class="note" style="margin-top:8px">${s.then ? `Where it was at ${esc(new Date(s.date).toISOString().slice(0, 16).replace('T', ' '))} UTC, and its track until then (time travel; forecasts of the time aren't archived). ` : ''}${f && f.cone.length ? (f.coherent ? 'The white cone is where the centre will probably be over the next days (about 2 times in 3); wind, rain and surge reach well outside it. ' : 'The forecast cone is being updated: shown again with the next advisory. ') : s.then ? '' : 'The past track, not a forecast. '}${!s.then && f && f.winds.length ? 'Shaded now: tropical-storm (yellow), 50 kt (orange) and hurricane-force (red) winds. ' : ''}Official forecasts and warnings: your national weather service.</div>`;
}
