// Tropical cyclones: NASA EONET's open severe-storm events (worldwide, CORS, no key) as a track and a marker sized and
// coloured by Saffir-Simpson category, plus NOAA NHC's official advisories for the Atlantic and East / Central Pacific
// (through the local helper, or the website's public relay). No forecast cones yet: NHC publishes those as KMZ files.
import { C, esc, fmt, getJSON, relayed } from './env.js';
import { scene } from './viewer.js';
import { L, setCount } from './layers.js';
import { hooks } from './state.js';

const pts = scene.primitives.add(new C.PointPrimitiveCollection());
const lines = scene.primitives.add(new C.PolylineCollection());
const CAT = [[137, 5, '#ff4df0'], [113, 4, '#ff4d5e'], [96, 3, '#ff7b4f'], [83, 2, '#ffb44d'], [64, 1, '#ffe36e'], [34, 0, '#7fd0ff'], [0, -1, '#9fb3bf']];
const category = kt => CAT.find(([min]) => (kt || 0) >= min);
const catName = kt => { const c = category(kt)[1]; return c > 0 ? `Category ${c}` : c === 0 ? 'Tropical storm' : 'Depression or low'; };
const CLASS = { HU: 'Hurricane', TS: 'Tropical Storm', TD: 'Tropical Depression', STS: 'Subtropical Storm', STD: 'Subtropical Depression', PTC: 'Potential Tropical Cyclone', PC: 'Post-tropical Cyclone', TY: 'Typhoon' };   // NHC's codes
const dist = (a, b) => { const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r; return Math.hypot(x, y) * 6371; };

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
          const same = list.find(x => dist(x, s) < 300);
          if (same) Object.assign(same, { nhc, kt: same.kt || nhc.kt });
          else list.push({ kind: 'storm', id: 'nhc-' + st.id, title: nhc.title, src: 'NOAA NHC', lat: s.lat, lon: s.lon, kt: nhc.kt, date: st.lastUpdate, track: [s], nhc, links: [] });
        }
      } catch (e) { console.warn('NHC advisories', e.message); }
    }
    this.draw(list);
  },
  draw(list) {
    pts.removeAll(); lines.removeAll(); this.list = list;
    for (const s of list) {
      const [, , col] = category(s.kt), c = C.Color.fromCssColorString(col);
      s.tip = () => `🌀 ${s.title}${s.kt ? ' · ' + s.kt + ' kt' : ''}`;
      s.cardHtml = () => {
        const row = (k, v) => v == null || v === '' ? '' : `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`, n = s.nhc || {};
        const links = s.links.concat(n.url ? [{ text: 'NHC public advisory', url: n.url }] : []).filter(l => /^https:\/\//.test(l.url || ''));
        return `<div class="k" style="--c:${col}">Tropical cyclone · ${esc(s.src)}${s.nhc && s.src !== 'NOAA NHC' ? ' + NOAA NHC' : ''}</div><h2>${esc(n.title || s.title)}</h2>
          <dl>${row('Strength', catName(s.kt))}${row('Max winds', s.kt ? `${s.kt} kt · ${fmt(s.kt * 1.852)} km/h` : '—')}${row('Pressure', n.pressure ? n.pressure + ' mb' : null)}${row('Moving', n.movement)}
          ${row('Position', `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'} ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}`)}${row('Latest fix', s.date ? new Date(s.date).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null)}${row('Track points', s.track.length)}</dl>
          ${links.length ? `<div class="acts">${links.slice(0, 4).map(l => `<a class="chipbtn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.text)}</a>`).join('')}</div>` : ''}
          <div class="note" style="margin-top:8px">The past track, not a forecast. Official forecasts and warnings: your national weather service.</div>`;
      };
      s.pt = pts.add({ position: C.Cartesian3.fromDegrees(s.lon, s.lat, 3000), pixelSize: 9 + Math.max(0, category(s.kt)[1]) * 2.5, color: c.withAlpha(0.35), outlineColor: c, outlineWidth: 2, id: s, show: L.storms.on });
      if (s.track.length > 1) s.line = lines.add({ positions: s.track.map(p => C.Cartesian3.fromDegrees(p.lon, p.lat, 3000)), width: 2, material: C.Material.fromType('PolylineDash', { color: c.withAlpha(0.8), dashLength: 12 }), show: L.storms.on });
    }
    setCount('storms', list.length); hooks.updateStats?.();
  },
  apply() { for (const s of this.list) { s.pt.show = L.storms.on; if (s.line) s.line.show = L.storms.on; } },
};
