// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Tropical cyclones: NASA EONET's open severe-storm events (worldwide, CORS, no key) as a track and a marker sized and
// coloured by Saffir-Simpson category, NOAA NHC's official advisories for the Atlantic and East / Central Pacific
// (through the local helper, or the website's public relay), and forecasts: NOAA NHC's map service (CORS) gives the
// forecast track, the cone, coastal watches and warnings and the wind field now; GDACS (CORS) gives a track and cone
// for every other basin (JTWC and others). Cones and coast lines drape on the terrain or Google's 3D tiles.
import { C, esc, fmt, getJSON, relayed } from './env.js';
import { viewer, scene } from './viewer.js';
import { L, setCount } from './layers.js';
import { hooks, state } from './state.js';
import { WW } from '../core/hazards.js';
import { loadCyclones, category, catName, KIND_KT, NHC_CURRENT, stormSources } from '../core/cyclones.js';

const pts = scene.primitives.add(new C.PointPrimitiveCollection());
const lines = scene.primitives.add(new C.PolylineCollection());
const fc = new C.CustomDataSource('cyclone-forecasts'); viewer.dataSources.add(fc);
const gdacsKept = new Map();   // "event/episode" -> parsed geometry (an episode never changes)

export const Storms = {
  list: [],
  async load() {   // EONET, NHC, NOAA's forecasts and GDACS, merged per storm (core/cyclones.js, shared with the 2D map)
    this.draw(await loadCyclones({ json: getJSON, nhc: !!relayed(NHC_CURRENT), kept: gdacsKept, warn: (what, e) => console.warn(what, e.message) }));
  },
  draw(list) {
    pts.removeAll(); lines.removeAll(); fc.entities.removeAll(); this.list = list;
    for (const s of list) {
      const [, , col] = category(s.kt), c = C.Color.fromCssColorString(col);
      s.tip = () => `🌀 ${s.title}${s.kt ? ' · ' + s.kt + ' kt' : ''}${s.fc && s.fc.cone.length ? ' · forecast cone' : ''}`;
      s.cardHtml = () => card(s, col);
      s.pt = pts.add({ position: C.Cartesian3.fromDegrees(s.lon, s.lat, 3000), pixelSize: 9 + Math.max(0, category(s.kt)[1]) * 2.5, color: c.withAlpha(0.35), outlineColor: c, outlineWidth: 2, id: s, show: L.storms.on });
      if (s.track.length > 1 && !(s.fc && s.fc.past.length)) s.line = lines.add({ positions: s.track.map(p => C.Cartesian3.fromDegrees(p.lon, p.lat, 3000)), width: 2, material: C.Material.fromType('PolylineDash', { color: c.withAlpha(0.8), dashLength: 12 }), show: L.storms.on });
      if (s.fc) drawForecast(s);
    }
    fc.show = L.storms.on;
    setCount('storms', list.length); hooks.updateStats?.();
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
    ${row('Position', `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}`)}${row('Latest fix', s.date ? new Date(s.date).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null)}
    ${f && f.advisory ? row('Advisory', '#' + f.advisory.replace(/^0+/, '')) : ''}${row('Watches, warnings', ww)}${fcRows}</dl>
    ${links.length ? `<div class="acts">${links.slice(0, 4).map(l => `<a class="chipbtn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.text)}</a>`).join('')}</div>` : ''}
    <div class="note" style="margin-top:8px">${f && f.cone.length ? (f.coherent ? 'The white cone is where the centre will probably be over the next days (about 2 times in 3); wind, rain and surge reach well outside it. ' : 'The forecast cone is being updated: shown again with the next advisory. ') : 'The past track, not a forecast. '}${f && f.winds.length ? 'Shaded now: tropical-storm (yellow), 50 kt (orange) and hurricane-force (red) winds. ' : ''}Official forecasts and warnings: your national weather service.</div>`;
}
