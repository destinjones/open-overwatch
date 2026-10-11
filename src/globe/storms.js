// Tropical cyclones: NASA EONET's open severe-storm events (worldwide, CORS, no key) as a track and a marker sized and
// coloured by Saffir-Simpson category, NOAA NHC's official advisories for the Atlantic and East / Central Pacific
// (through the local helper, or the website's public relay), and forecasts: NOAA NHC's map service (CORS) gives the
// forecast track, the cone, coastal watches and warnings and the wind field now; GDACS (CORS) gives a track and cone
// for every other basin (JTWC and others). Cones and coast lines drape on the terrain or Google's 3D tiles.
import { C, esc, fmt, getJSON, relayed } from './env.js';
import { viewer, scene } from './viewer.js';
import { L, setCount } from './layers.js';
import { hooks, state } from './state.js';
import { nhcForecasts, gdacsForecast, WW } from '../core/hazards.js';

const pts = scene.primitives.add(new C.PointPrimitiveCollection());
const lines = scene.primitives.add(new C.PolylineCollection());
const fc = new C.CustomDataSource('cyclone-forecasts'); viewer.dataSources.add(fc);
const CAT = [[137, 5, '#ff4df0'], [113, 4, '#ff4d5e'], [96, 3, '#ff7b4f'], [83, 2, '#ffb44d'], [64, 1, '#ffe36e'], [34, 0, '#7fd0ff'], [0, -1, '#9fb3bf']];
const category = kt => CAT.find(([min]) => (kt || 0) >= min);
const catName = kt => { const c = category(kt)[1]; return c > 0 ? `Category ${c}` : c === 0 ? 'Tropical storm' : 'Depression or low'; };
const CLASS = { HU: 'Hurricane', TS: 'Tropical Storm', TD: 'Tropical Depression', STS: 'Subtropical Storm', STD: 'Subtropical Depression', PTC: 'Potential Tropical Cyclone', PC: 'Post-tropical Cyclone', TY: 'Typhoon' };   // NHC's codes
const dist = (a, b) => { const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r; return Math.hypot(x, y) * 6371; };
const KIND_KT = { TD: 30, TS: 50, HU: 80, TY: 80, MH: 100, STY: 130 };   // a track segment's colour from its category label

// ---- forecasts
const NOAA = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer/';
const noaaLayer = (id, fields) => getJSON(`${NOAA}${id}/query?where=1%3D1&outFields=${fields}&outSR=4326&geometryPrecision=3&f=geojson`, { timeout: 30000 }).then(d => d.features || []);
async function noaaForecasts() {
  const [points, tracks, cones, warnings, winds, past] = await Promise.all([[5, 'idp_source,stormname,tcdvlp,tau,maxwind,gust,mslp,datelbl,fldatelbl'],
    [6, 'idp_source'], [7, 'idp_source,stormname'], [8, 'idp_source,tcww'], [16, 'stormid,radii,tau'], [11, 'idp_source,stormtype']].map(([id, f]) => noaaLayer(id, f).catch(() => [])));
  return [...nhcForecasts({ points, tracks, cones, warnings, winds, past }).values()].filter(s => s.points.length || s.cone.length);
}
const gdacsKept = new Map();   // "event/episode" -> parsed geometry (an episode never changes)
async function gdacsForecasts(skip) {
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const list = await getJSON(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red&fromdate=${day(Date.now() - 10 * 864e5)}&todate=${day(Date.now())}`, { timeout: 30000 });
  const out = [];
  for (const f of list.features || []) {
    const p = f.properties || {}, name = String(p.eventname || '').replace(/-\d\d$/, '');
    if (String(p.iscurrent) !== 'true' || skip.has(name.toLowerCase())) continue;   // NOAA's own forecast is drawn for its storms
    const key = p.eventid + '/' + p.episodeid;
    if (!gdacsKept.has(key)) {
      try { gdacsKept.set(key, gdacsForecast(await getJSON(`https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=${encodeURIComponent(p.eventid)}&episodeid=${encodeURIComponent(p.episodeid)}`, { timeout: 45000 }))); }
      catch (e) { console.warn('GDACS', name, e.message); continue; }
    }
    const c = f.geometry && f.geometry.coordinates;
    out.push({ ...gdacsKept.get(key), alert: String(p.alertlevel || ''), severity: String(p.severitydata && p.severitydata.severitytext || ''), kmh: p.severitydata && +p.severitydata.severity,
      lat: c ? +c[1] : null, lon: c ? +c[0] : null, report: p.url && p.url.report });
  }
  return out;
}
/** The storm in `list` a forecast belongs to (same name, or within 300 km), or a new one for it. */
function attach(list, name, at, make) {
  const n = name.toLowerCase().split(/\s+/).pop();
  let s = n.length > 2 ? list.find(x => x.title.toLowerCase().includes(n)) : null;
  if (!s && at) s = list.find(x => dist(x, at) < 300);
  if (!s) { s = make(); list.push(s); }
  return s;
}

export const Storms = {
  list: [],
  async load() {
    const d = await getJSON('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=severeStorms&days=10', { timeout: 30000 });
    const list = [];
    for (const ev of d.events || []) {
      const track = (ev.geometry || []).filter(g => g.type === 'Point' && Array.isArray(g.coordinates)).map(g => ({ lon: +g.coordinates[0], lat: +g.coordinates[1], kt: g.magnitudeUnit === 'kts' ? +g.magnitudeValue : null, date: g.date }))
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (!track.length) continue;
      const last = track[track.length - 1];
      list.push({ kind: 'storm', id: String(ev.id), title: String(ev.title || 'Storm'), src: 'NASA EONET', lat: last.lat, lon: last.lon, kt: last.kt, date: last.date, track,
        links: [{ text: 'EONET event', url: ev.link }, ...(ev.sources || []).map(s => ({ text: 'Source: ' + s.id, url: s.url }))] });
    }
    // NOAA NHC: official name, pressure and movement for storms in its basins
    const nhcUrl = 'https://www.nhc.noaa.gov/CurrentStorms.json';
    if (relayed(nhcUrl)) {
      try {
        const n = await getJSON(nhcUrl, { relay: true, timeout: 25000 });
        for (const st of n.activeStorms || []) {
          const s = { lat: +st.latitudeNumeric, lon: +st.longitudeNumeric }; if (!Number.isFinite(s.lat)) continue;
          const nhc = { title: `${CLASS[st.classification] || st.classification || ''} ${st.name || ''}`.trim(), kt: +st.intensity || null, pressure: st.pressure, movement: st.movementDir != null ? `${st.movementDir}° at ${st.movementSpeed} mph` : null, advisory: st.lastUpdate, url: st.publicAdvisory && st.publicAdvisory.url };
          const nm = String(st.name || '').toLowerCase(), same = (nm.length > 2 && list.find(x => x.title.toLowerCase().includes(nm))) || list.find(x => dist(x, s) < 300);   // EONET's last fix can lag
          if (same) Object.assign(same, { nhc, kt: same.kt || nhc.kt, lat: s.lat, lon: s.lon });
          else list.push({ kind: 'storm', id: 'nhc-' + st.id, title: nhc.title, src: 'NOAA NHC', lat: s.lat, lon: s.lon, kt: nhc.kt, date: st.lastUpdate, track: [s], nhc, links: [] });
        }
      } catch (e) { console.warn('NHC advisories', e.message); }
    }
    // forecasts: NOAA's map service for its basins, GDACS for the rest
    const noaa = await noaaForecasts().catch(e => { console.warn('NHC forecasts', e.message); return []; });
    for (const f of noaa) {
      const now = f.points[0], s = attach(list, f.name || f.id, now, () => ({ kind: 'storm', id: 'fc-' + f.id, title: f.name || f.id.toUpperCase(), src: 'NOAA NHC', lat: now ? now.lat : f.cone[0][0][1],
        lon: now ? now.lon : f.cone[0][0][0], kt: now && now.kt, track: [], links: [] }));
      s.fc = { src: 'NOAA NHC', ...f };
      if (now) { s.kt = now.kt || s.kt; s.lat = now.lat; s.lon = now.lon; }
    }
    const skip = new Set(noaa.map(f => f.name.toLowerCase().split(/\s+/).pop()));
    const gd = await gdacsForecasts(skip).catch(e => { console.warn('GDACS', e.message); return []; });
    for (const g of gd) {
      const at = g.lat != null ? { lat: g.lat, lon: g.lon } : null, kt = g.kmh ? Math.round(g.kmh / 1.852) : null;
      const s = attach(list, g.name, at, () => ({ kind: 'storm', id: 'gdacs-' + g.id, title: g.name ? g.name[0] + g.name.slice(1).toLowerCase() : 'Storm', src: `GDACS · ${g.source || 'agency'}`,
        lat: at ? at.lat : 0, lon: at ? at.lon : 0, kt, track: [], links: [] }));
      s.fc = { src: `GDACS (${g.source || 'agency'})`, gdacs: g, cone: g.cone, track: g.forecast.map(x => x.path), past: g.past.map(x => ({ kind: x.kind, paths: [x.path] })),
        points: g.points.filter(q => q.forecast).map(q => ({ lat: q.lat, lon: q.lon, label: q.label.replace(' UTC', ''), kt: null })), warnings: [], winds: [], coherent: true };
      if (!s.kt && kt) s.kt = kt;
      if (g.report && /^https:\/\//.test(g.report)) s.links.push({ text: 'GDACS report', url: g.report });
    }
    this.draw(list);
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
  const srcs = [s.src, s.nhc && s.src !== 'NOAA NHC' ? 'NOAA NHC' : '', f && f.src !== s.src ? f.src : ''].filter(Boolean).join(' + ');
  return `<div class="k" style="--c:${col}">Tropical cyclone · ${esc(srcs)}</div><h2>${esc(n.title || s.title)}</h2>
    <dl>${row('Strength', catName(s.kt))}${row('Max winds', s.kt ? `${s.kt} kt · ${fmt(s.kt * 1.852)} km/h` : '—')}${row('Pressure', n.pressure ? n.pressure + ' mb' : f && f.points[0] && f.points[0].mb ? f.points[0].mb + ' mb' : null)}${row('Moving', n.movement)}
    ${row('Position', `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}`)}${row('Latest fix', s.date ? new Date(s.date).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null)}
    ${f && f.advisory ? row('Advisory', '#' + f.advisory.replace(/^0+/, '')) : ''}${row('Watches, warnings', ww)}${fcRows}</dl>
    ${links.length ? `<div class="acts">${links.slice(0, 4).map(l => `<a class="chipbtn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.text)}</a>`).join('')}</div>` : ''}
    <div class="note" style="margin-top:8px">${f && f.cone.length ? (f.coherent ? 'The white cone is where the centre will probably be over the next days (about 2 times in 3); wind, rain and surge reach well outside it. ' : 'The forecast cone is being updated: shown again with the next advisory. ') : 'The past track, not a forecast. '}${f && f.winds.length ? 'Shaded now: tropical-storm (yellow), 50 kt (orange) and hurricane-force (red) winds. ' : ''}Official forecasts and warnings: your national weather service.</div>`;
}
