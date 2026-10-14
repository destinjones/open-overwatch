// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Point and vector layers: quakes, events, disasters, storms, news, weather, space weather, radar, clouds, terminator, cables, cameras, ships, balloons, fires, OSM scan.
import { num, idArg } from '../core/format.js';
import { COUNTRY, COUNTRY_ALIAS } from './countries.js';
import { $, C, debounce, deg, esc, fmt, haversine, isHttp, late, Log, Net, rad, Relay, safeHost, toast } from './util.js';
import { map, vecRenderer } from './mapview.js';
import { nightRing } from '../core/sky.js';
import { Dyn, Feeds, Layers, Points, UI, feed, requestDraw, runFeed } from './engine.js';
import { Detail } from './detail.js';
import { parseUsgs, usgsUrl, USGS_FEEDS, largest, usgsDataAt, stampQuake, gdacsQuakes } from '../core/quakes.js';
import { stamp, rep, stampReports } from '../core/liveprov.js';
import { parseEonet, eonetUrl, EONET_COLOR } from '../core/eonet.js';
import { loadGdacsEvents, GDACS_LEVEL_COLOR } from '../core/gdacs.js';
import { stormAgreement, loadCyclones, category, catName, KIND_KT, NHC_CURRENT, activeLine, shortName, stormSources } from '../core/cyclones.js';
import { WW } from '../core/hazards.js';
import { overpass } from '../core/overpass.js';
import { OVATION_URL, KP_URL, parseOvation, ovationAt, paintMercator, MERCATOR_MAX_LAT, latestKp } from '../core/aurora.js';
import { CABLE_URLS, LANDING_URLS, parseLandings, nearestCable, cablePage, landingPage, okColor } from '../core/cables.js';
import { CAMERA_NETS, CAMERA_GROUPS, boxInView, bustUrl, isStream, netOf } from '../core/cameras.js';
import { sameShip, parseAisLocations, parseAisVessels, shipKind, shipTypeName, SHIP_KINDS, NAV_STATUS, flagOf, etaTime, DIGITRAFFIC_AIS, DIGITRAFFIC_HEADERS } from '../core/ais.js';

/* ============================================================ POINT + VECTOR LAYERS
   Points go on the shared canvas (Points.set); only polygons and lines stay as Leaflet vectors, non-interactive. */
export function lineLayer(def) { const g = L.layerGroup(); def.group_ = g; const en = def.enable, dis = def.disable; def.enable = () => { g.addTo(map); en && en(); }; def.disable = () => { g.clearLayers(); map.removeLayer(g); dis && dis(); if (def.feed) def.feed.count = 0; }; return g; }
export function rerunFeed(f) { // option changed: refetch now, or as soon as a fetch already in flight (with the old option) finishes
  if (!f.running) return runFeed(f, true); if (f.rerunT) return;
  f.rerunT = setInterval(() => { if (f.running) return; clearInterval(f.rerunT); f.rerunT = null; runFeed(f, true); }, 300);
}
export const World = { quakes: [], events: [], storms: [], gdacs: [], news: [] }; // latest parsed feed data for the Brief

/* ---------- Earthquakes (USGS) */
export const lyQuakes = Layers.add({ id: 'quakes', group: 'Ground', name: 'Earthquakes', desc: 'USGS real-time feed', color: C.qk, shape: 'round', default: true, points: 'quakes',
  sub(el) { const r = () => UI.pills(el, USGS_FEEDS, id => Layers.opt('quake_feed') === id, id => { Layers.setOpt('quake_feed', id); r(); if (lyQuakes.on) rerunFeed(lyQuakes.feed); }); r(); } });
Points.define('quakes', 'quakes');
Detail.renderers.quake = p => `<div class="det">${Detail.head(C.qk, 'Earthquake · USGS', `M${(p.mag ?? 0).toFixed(1)} ${p.place || ''}`, esc(fmt.date(p.time)), [p.tsunami ? { t: 'Tsunami flag', cls: 'emg' } : null, p.alert ? { t: 'PAGER ' + p.alert, cls: p.alert === 'red' ? 'emg' : 'warn' } : null].filter(Boolean))}
${Detail.kv([['Magnitude', `${(p.mag ?? 0).toFixed(1)} ${p.magType || ''}`], ['Depth', `${fmt.n(p.depth, 1)} km`], ['Position', fmt.ll(p.lat, p.lon)], ['Felt reports', p.felt], ['Status', p.status], ['Age', fmt.ago(p.time) + ' ago']])}
<div class="actions"><button class="btn small" data-do="fly" data-lat="${num(p.lat)}" data-lon="${num(p.lon)}" data-z="7">Center</button></div><hr class="sep">${Detail.links([{ text: 'USGS event page', url: p.url }])}</div>`;
feed(lyQuakes, { interval: 300, fetch: async () => {   // parsed by core/quakes.js, like the globe's and the MCP server's
  const doc = await Net.json(usgsUrl(Layers.opt('quake_feed') || '2.5_day')), list = parseUsgs(doc), items = []; World.quakes = list;
  const dataAt = usgsDataAt(doc, list), gd = gdacsQuakes(World.gdacs);   // provenance: the summary's time; GDACS's alerts as a second word
  for (const p of list) {
    stampQuake(p, { dataAt, gdacs: gd });
    const mag = p.mag ?? 0, age = (Date.now() - p.time) / 3600e3, r = Math.max(2.5, 2 + (mag - 1) * 2.4);
    items.push({ lat: p.lat, lon: p.lon, r, color: C.qk, alpha: Math.max(.35, 1 - age / 48), fillAlpha: Math.max(.08, .45 - age / 60), kind: 'quake', obj: p, tip: `M${mag.toFixed(1)} · ${p.place} · ${fmt.ago(p.time)} ago`, label: mag >= 5.5 ? `M${mag.toFixed(1)}` : null, labelZoom: 2 });
    if (mag >= 6 && Date.now() - p.time < 3600e3 && !lyQuakes.seen?.has(p.id)) { (lyQuakes.seen ||= new Set()).add(p.id); Log.alert(`M${mag.toFixed(1)} earthquake · ${p.place}`, { onclick: () => { flyTo(p.lat, p.lon, 6); Detail.show('quake', p, p.id); } }); }
  }
  Points.set('quakes', items); lyQuakes.feed.count = items.length; const big = largest(list); if (big) lyQuakes.desc = `Largest: M${(big.mag ?? 0).toFixed(1)} ${big.place}`;
} });

/* ---------- Natural events (NASA EONET) */
export const lyEvents = Layers.add({ id: 'events', group: 'Ground', name: 'Natural events', desc: 'NASA EONET · wildfires, storms, volcanoes, floods, ice', color: C.evt, default: false, points: 'events' });
export const gEvents = lineLayer(lyEvents); Points.define('events', 'events');
export const EONET_COL = EONET_COLOR;
Detail.renderers.event = e => `<div class="det">${Detail.head(e.color, 'Natural event · NASA EONET', e.title, esc(e.cats.join(' · ')), e.closed ? [{ t: 'Closed ' + e.closed.slice(0, 10) }] : [{ t: 'Open', cls: 'good' }])}
${Detail.kv([['Latest position', fmt.ll(e.lat, e.lon)], ['Latest fix', fmt.date(e.date)], ['First reported', e.first ? fmt.date(e.first) : null], ['Fixes', e.n], ['Magnitude', e.mag]])}
<div class="actions"><button class="btn small" data-do="fly" data-lat="${num(e.lat)}" data-lon="${num(e.lon)}" data-z="7">Center</button></div><hr class="sep">${Detail.links([{ text: 'EONET event', url: e.link }, ...e.sources.map(s => ({ text: `Source: ${s.id}`, url: s.url }))])}</div>`;
feed(lyEvents, { interval: 900, fetch: async () => {   // core/eonet.js: polygons (some fires, ice) are placed at their middle
  const list = parseEonet(await Net.json(eonetUrl({ days: 20 }))); gEvents.clearLayers(); const items = []; World.events = [];
  for (const ev of list) {
    const color = EONET_COL[ev.cat] || C.evt, e = stamp({ ...ev, color }, 'events', [rep('eonet', { dataAt: ev.date })]);
    World.events.push(e); items.push({ lat: e.lat, lon: e.lon, r: 4.5, color, fillAlpha: .35, kind: 'event', obj: e, tip: e.title });
    if (ev.track.length > 1) L.polyline(ev.track.slice(-12).map(x => [x.lat, x.lon]), { color, weight: 1, opacity: .5, interactive: false, renderer: vecRenderer }).addTo(gEvents);
  }
  Points.set('events', items); lyEvents.feed.count = items.length;
} });

/* ---------- Disaster alerts (GDACS) */
export const lyGdacs = Layers.add({ id: 'gdacs', group: 'Ground', name: 'Disaster alerts', desc: 'GDACS (EU/UN) · cyclones, floods, volcanoes, drought, fires · last 14 days', color: '#ff9a3c', default: false, points: 'gdacs' });
Points.define('gdacs', 'gdacs');
export const GDACS_LVL = GDACS_LEVEL_COLOR;
Detail.renderers.gdacs = p => `<div class="det">${Detail.head(GDACS_LVL[p.alertlevel] || C.warn, 'Disaster alert · GDACS', p.name || p.eventname || p.eventtype, esc(p.description || ''), [{ t: `${p.alertlevel || ''} alert`, cls: p.alertlevel === 'Red' ? 'emg' : p.alertlevel === 'Orange' ? 'warn' : 'good' }, { t: p.eventtype }])}
${Detail.kv([['Country', p.country], ['From', p.fromdate ? fmt.date(p.fromdate) : null], ['To', p.todate ? fmt.date(p.todate) : null], ['Severity', p.severitydata?.severitytext], ['Episode', p.episodeid], ['Position', fmt.ll(p.lat, p.lon)]])}
<div class="actions"><button class="btn small" data-do="fly" data-lat="${num(p.lat)}" data-lon="${num(p.lon)}" data-z="6">Center</button></div><hr class="sep">${Detail.links([p.url?.report ? { text: 'GDACS report', url: p.url.report } : null, p.url?.details ? { text: 'Details (JSON)', url: p.url.details } : null].filter(Boolean))}</div>`;
feed(lyGdacs, { interval: 900, fetch: async () => {   // every page of the last 14 days, one marker per event (core/gdacs.js)
  World.gdacs = await loadGdacsEvents(Net.json.bind(Net), { opts: { timeout: 60000, throttle: 'gdacs', gap: 1000 } });
  for (const p of World.gdacs) stamp(p, 'gdacs', [rep('gdacs', { dataAt: p.datemodified ? (/(Z|[+-]\d\d:?\d\d)$/.test(p.datemodified) ? p.datemodified : p.datemodified + 'Z') : p.todate })]);
  const items = World.gdacs.map(p => ({ lat: p.lat, lon: p.lon, r: p.alertlevel === 'Red' ? 8 : p.alertlevel === 'Orange' ? 6 : 4, color: GDACS_LVL[p.alertlevel] || C.warn, fillAlpha: .2, halo: p.alertlevel === 'Red' ? 14 : 0, kind: 'gdacs', obj: p,
    tip: `${p.eventtype} · ${p.name || ''} (${p.alertlevel})`, label: p.alertlevel !== 'Green' ? (p.eventname || p.eventtype) : null, labelZoom: 3 }));
  Points.set('gdacs', items); lyGdacs.feed.count = items.length;
} });

/* ---------- Tropical cyclones (NASA EONET storm tracks, plus NHC advisories when the helper runs) */
export const lyStorms = Layers.add({ id: 'storms', group: 'Weather & space weather', name: 'Tropical cyclones', desc: 'NASA EONET tracks · NOAA NHC and GDACS forecast cones, watches and warnings, wind fields', color: '#7fd0ff', shape: 'round', default: true, points: 'storms' });
export const gStorms = lineLayer(lyStorms); Points.define('storms', 'storms');
Detail.renderers.storm = s => {
  const n = s.nhc || {}, f = s.fc, col = category(s.kt)[2];
  const srcs = stormSources(s);
  const fcRows = f ? f.points.filter(q => q.tau == null || q.tau > 0).slice(0, 6).map(q => [q.tau != null ? `+${q.tau} h` : 'Forecast', `${q.label}${q.kt ? ` · ${q.kt} kt (${catName(q.kt)})` : ''}`]) : [];
  const ww = f && f.warnings.length ? [...new Set(f.warnings.map(w => WW[w.code][0]))].join(', ') : null;
  const links = [...s.links, n.url ? { text: `NHC public advisory${n.advNum ? ' ' + n.advNum : ''}`, url: n.url } : null, n.forecastUrl ? { text: 'NHC forecast advisory', url: n.forecastUrl } : null].filter(Boolean);
  return `<div class="det">${Detail.head(col, 'Tropical cyclone · ' + srcs, n.title || s.title, esc(catName(s.kt)), s.kt ? [{ t: `${s.kt} kt`, cls: s.kt >= 64 ? 'emg' : 'warn' }] : [])}
${Detail.kv([['Max winds', s.kt ? `${s.kt} kt · ${fmt.n(s.kt * 1.852)} km/h` : null], ['Pressure', n.pressure ? `${n.pressure} mb` : f && f.points[0] && f.points[0].mb ? f.points[0].mb + ' mb' : null], ['Moving', n.movement], ['Position', fmt.ll(s.lat, s.lon)],
  ['Latest fix', s.date && !isNaN(Date.parse(s.date)) ? fmt.date(s.date) : null], ['Track points', s.track.length > 1 ? s.track.length : null], ['Advisory', f && f.advisory ? '#' + String(f.advisory).replace(/^0+/, '') : n.advisory], ['Watches, warnings', ww], ...fcRows])}
<p style="font-size:12px;color:var(--ink-dim);line-height:1.45">${f && f.cone.length ? (f.coherent ? 'The white cone is where the centre will probably be over the next days (about 2 times in 3); wind, rain and surge reach well outside it.' : 'The forecast cone is being updated: shown again with the next advisory.') : 'The past track, not a forecast.'}${f && f.winds.length ? ' Shaded now: tropical-storm (yellow), 50 kt (orange) and hurricane-force (red) winds.' : ''} Official forecasts and warnings: your national weather service.</p>
<div class="actions"><button class="btn small" data-do="fly" data-lat="${num(s.lat)}" data-lon="${num(s.lon)}" data-z="6">Center</button></div><hr class="sep">${Detail.links(links)}</div>`;
};
const gdacsKept = new Map();   // GDACS geometry per event/episode (never changes)
const ll = path => path.map(([lon, lat]) => [lat, lon]);
/** One storm's forecast on the map: the wind field now, the cone, the forecast track, coastal watches and warnings, the past track. */
function drawForecast(f) {
  const add = shape => shape.addTo(gStorms), opt = o => ({ interactive: false, renderer: vecRenderer, ...o });
  for (const w of f.winds.slice().sort((a, b) => a.kt - b.kt)) for (const r of w.rings) add(L.polygon(ll(r), opt({ stroke: false, fillColor: w.kt >= 64 ? '#ff4d5e' : w.kt >= 50 ? '#ff9f5c' : '#ffe36e', fillOpacity: .18 })));
  if (f.coherent) {
    for (const r of f.cone) add(L.polygon(ll(r), opt({ color: '#ffffff', weight: 1.4, opacity: .75, fillColor: '#ffffff', fillOpacity: .12 })));
    for (const p of f.track) add(L.polyline(ll(p), opt({ color: '#ffffff', weight: 2, opacity: .9, dashArray: '8 6' })));
  }
  for (const w of f.warnings) for (const p of w.paths) add(L.polyline(ll(p), opt({ color: WW[w.code][1], weight: 5, opacity: .95 })));
  for (const seg of f.past) for (const p of seg.paths) add(L.polyline(ll(p), opt({ color: category(KIND_KT[seg.kind] || 30)[2], weight: 2, opacity: .85 })));
}
feed(lyStorms, { interval: 1200, errorInterval: 1800, fetch: async () => {   // EONET + NHC + NOAA forecasts + GDACS, merged per storm (core/cyclones.js, as on the globe)
  const nhc = Relay.available || !!Relay.wrap(NHC_CURRENT);   // NHC's list: the helper, or the website's public relay
  const list = await loadCyclones({ json: (url, o = {}) => Net.json(url, { timeout: o.timeout || 30000 }), nhc, kept: gdacsKept, warn: (what, e) => Log.warn(`${what}: ${e.message}`) });
  gStorms.clearLayers(); World.storms = list; const items = [];
  const nhcCopy = Relay.viaCopy(NHC_CURRENT) ? ['nhc'] : [];
  for (const s of list) {
    const { reports, agreeing } = stormAgreement(s); stampReports(s, 'storms', reports, agreeing, { cached: nhcCopy });   // which agencies place it here (core/cyclones.js)
    const [, cat, col] = category(s.kt);
    if (s.track.length > 1 && !(s.fc && s.fc.past.length)) L.polyline(s.track.map(p => [p.lat, p.lon]), { color: col, weight: 1.5, opacity: .6, dashArray: '6 5', interactive: false, renderer: vecRenderer }).addTo(gStorms);
    if (s.fc) drawForecast(s.fc);
    items.push({ lat: s.lat, lon: s.lon, r: 6 + Math.max(0, cat) * 1.5, color: col, fillAlpha: .3, lw: 2, halo: 16, kind: 'storm', obj: s, tip: `${s.title}${s.kt ? ' · ' + s.kt + ' kt' : ''}${s.fc && s.fc.cone.length ? ' · forecast cone' : ''}`, label: shortName(s.title), labelZoom: 2 });
  }
  Points.set('storms', items); lyStorms.feed.count = items.length; lyStorms.desc = activeLine(list) || 'No active tropical cyclones right now';
} });

/* ---------- World news by source country (GDELT DOC 2.0; the GEO API was retired) */
export const lyNews = Layers.add({ id: 'news', group: 'Ground', name: 'World news', desc: 'GDELT · last 24 h of coverage matching your query, placed by the reporting country', color: C.news, default: false, points: 'news',
  sub(el) { const w = document.createElement('div'); w.style.cssText = 'display:flex;gap:4px;width:100%'; w.innerHTML = `<input class="mono" id="newsQ" style="flex:1;min-width:0;background:var(--panel-2);border:1px solid var(--line-strong);border-radius:3px;padding:4px 7px;font-size:11px" placeholder="query, e.g. missile OR drone" value="${esc(Layers.opt('news_q'))}"><button type="button" class="btn small">Run</button>`;
    const go = () => { Layers.setOpt('news_q', $('#newsQ', w).value.trim() || 'military'); if (lyNews.on) rerunFeed(lyNews.feed); }; $('button', w).addEventListener('click', go); $('input', w).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }); el.appendChild(w); } });
Points.define('news', 'news');
export function countryIso(name) {
  if (!name) return null; let s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z, ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.includes(',')) { const parts = s.split(',').map(x => x.trim()); s = (parts.slice(1).join(' ') + ' ' + parts[0]).trim(); }
  s = s.replace(/^the /, '').replace(/\s+/g, ' ');
  if (COUNTRY_ALIAS[s]) return COUNTRY_ALIAS[s];
  for (const [iso, v] of Object.entries(COUNTRY)) if (v[2].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim() === s) return iso;
  return null;
}
export function gdeltQuery(q) { q = q.trim(); if (/\bOR\b/i.test(q) && !/^\(.*\)$/.test(q)) q = '(' + q + ')'; return q; }
Detail.renderers.news = p => `<div class="det">${Detail.head(C.news, 'World news · GDELT', p.name, `${fmt.n(p.count)} article${p.count === 1 ? '' : 's'} from ${esc(p.name)} outlets in the last 24 h matching <span class="mono">${esc(p.q || Layers.opt('news_q'))}</span>`)}
${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
<div class="actions"><button class="btn small" data-do="fly" data-lat="${num(p.lat)}" data-lon="${num(p.lon)}" data-z="5">Center</button></div><hr class="sep">${Detail.links(p.articles)}</div>`;
feed(lyNews, { interval: 900, errorInterval: 900, fetch: async () => {
  const q = gdeltQuery(Layers.opt('news_q') || 'military');
  let txt; // GDELT sends CORS itself now (no helper needed), but its rate-limit replies don't, so they surface as a CORS error
  try { txt = await Net.text(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=250&timespan=24h`, { timeout: 40000, throttle: 'gdelt', gap: 6000 }); }
  catch (e) { throw /CORS|HTTP 429/.test(e.message) ? new Error('GDELT refused the request (usually its limit of one query per 5 s, or offline): retrying later') : e; }
  let d; try { d = txt.trim() ? JSON.parse(txt) : {}; } catch (e) { throw new Error('GDELT: ' + txt.trim().replace(/\s+/g, ' ').slice(0, 160)); } // bad queries come back as plain text with HTTP 200
  const by = new Map(); let unknown = 0;
  for (const a of d.articles || []) {
    const iso = countryIso(a.sourcecountry); if (!iso || !COUNTRY[iso]) { unknown++; continue; }
    const g = by.get(iso) || { iso, name: COUNTRY[iso][2], lat: COUNTRY[iso][0], lon: COUNTRY[iso][1], count: 0, articles: [], image: null, q }; by.set(iso, g);
    g.count++; if (g.articles.length < 15 && isHttp(a.url)) g.articles.push({ text: (a.title || a.url).slice(0, 140), url: a.url, sub: `${a.domain || safeHost(a.url)} · ${a.language || ''} · ${(a.seendate || '').replace(/T(\d\d)(\d\d)\d\dZ/, ' $1:$2Z')}` });
    if (!g.image && isHttp(a.socialimage)) g.image = a.socialimage;
    const seen = Date.parse(String(a.seendate || '').replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z')); if (seen > (g.seenAt || 0)) g.seenAt = seen;
  }
  for (const g of by.values()) stamp(g, 'news', [rep('gdelt', { dataAt: g.seenAt || null })]);
  World.news = [...by.values()].sort((a, b) => b.count - a.count);
  Points.set('news', World.news.map(p => ({ lat: p.lat, lon: p.lon, r: Math.min(16, 4 + Math.log2(p.count + 1) * 2), color: C.news, fillAlpha: .3, kind: 'news', obj: p, tip: `${p.name} · ${p.count} article${p.count === 1 ? '' : 's'}` })));
  lyNews.feed.count = (d.articles || []).length; Log.info(`GDELT: ${(d.articles || []).length} articles from ${by.size} countries for "${q}"${unknown ? ` (${unknown} with no country)` : ''}`);
} });

/* ---------- NWS severe alerts (US) — polygons stay as Leaflet vectors, clickable */
export const lyNws = Layers.add({ id: 'nws', group: 'Weather & space weather', name: 'Severe weather alerts (US)', desc: 'NWS · Extreme and Severe warnings with polygons', color: C.alert, default: true });
export const gNws = lineLayer(lyNws);
Detail.renderers.nws = p => `<div class="det">${Detail.head(C.alert, 'NWS alert', p.event, esc(p.headline || ''), [{ t: p.severity, cls: p.severity === 'Extreme' ? 'emg' : 'warn' }, { t: p.urgency }, { t: p.certainty }])}
${Detail.kv([['Areas', p.areaDesc], ['Sender', p.senderName], ['Onset', p.onset ? fmt.date(p.onset) : null], ['Expires', p.expires ? fmt.date(p.expires) : null]])}
<p style="font-size:12.5px;line-height:1.45;white-space:pre-wrap;color:var(--ink-dim);max-height:40vh;overflow:auto">${esc((p.description || '').slice(0, 2500))}</p>
<hr class="sep">${Detail.links([{ text: 'Alert on weather.gov', url: p['@id'] || 'https://www.weather.gov/alerts' }])}</div>`;
feed(lyNws, { interval: 300, fetch: async () => {
  const d = await Net.json('https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&severity=Extreme,Severe', { timeout: 60000 }); gNws.clearLayers(); let n = 0, drawn = 0; World.nws = [];
  for (const f of d.features || []) {
    const p = stamp(f.properties || {}, 'alerts', [rep('nws', { dataAt: (f.properties || {}).sent })]); n++; World.nws.push(p); if (!f.geometry) continue; const isTor = /tornado|hurricane|extreme wind/i.test(p.event || ''); const col = isTor ? C.emg : /flash flood|storm/i.test(p.event || '') ? C.warn : '#ff9a6b';
    const g = L.geoJSON(f.geometry, { bubblingMouseEvents: false, style: { color: col, weight: isTor ? 2 : 1.2, fillColor: col, fillOpacity: isTor ? .25 : .12, renderer: vecRenderer } }); g.on('click', () => Detail.show('nws', p, p.id)); gNws.addLayer(g); drawn++;
    if (isTor && !lyNws.seen?.has(p.id)) { (lyNws.seen ||= new Set()).add(p.id); if (/tornado warning/i.test(p.event) && Date.now() - (Date.parse(p.sent) || 0) < 900e3) Log.alert(`${p.event}: ${p.areaDesc}`, { onclick: () => { const c = g.getBounds().getCenter(); flyTo(c.lat, c.lng, 8); Detail.show('nws', p, p.id); } }); }
  }
  lyNws.feed.count = drawn; lyNws.desc = `${n} active Extreme/Severe alerts · ${drawn} with polygons`;
} });

/* ---------- Aurora (NOAA SWPC OVATION) + Kp */
export const lyAurora = Layers.add({ id: 'aurora', group: 'Weather & space weather', name: 'Aurora forecast', desc: 'NOAA SWPC OVATION · 30–90 min forecast of visible-aurora probability', color: '#5cff9a', default: false });
export let auroraOverlay = null; export const Aurora = { grid: null, at(lat, lon) { return this.grid ? ovationAt(this.grid, lat, lon) : null; } };
lyAurora.enable = () => { if (auroraOverlay) auroraOverlay.addTo(map); }; lyAurora.disable = () => { if (auroraOverlay) map.removeLayer(auroraOverlay); lyAurora.feed.count = 0; };
feed(lyAurora, { interval: 900, fetch: async () => {   // the grid and its colours are the globe's (core/aurora.js)
  const o = parseOvation(await Net.json(OVATION_URL, { timeout: 60000 })); Aurora.grid = o.grid;
  const W = 1440, H = 720, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
  img.data.set(paintMercator(o.grid, W, H)); ctx.putImageData(img, 0, 0); const url = cv.toDataURL();
  if (auroraOverlay) map.removeLayer(auroraOverlay); auroraOverlay = L.imageOverlay(url, [[-MERCATOR_MAX_LAT, -180], [MERCATOR_MAX_LAT, 180]], { opacity: .8, interactive: false, className: 'aurora-ov' }); if (lyAurora.on) auroraOverlay.addTo(map);
  lyAurora.feed.count = o.cells20; lyAurora.desc = `Forecast for ${o.at} · ${o.cells20} cells ≥ 20 %`;
} });
export const Space = { kp: null, kpTime: null };
export async function fetchKp() {
  try {
    const last = latestKp(await Net.json(KP_URL)); if (!last) throw new Error('no Kp rows');   // rows or objects: core/aurora.js
    const kp = last.kp; Space.kp = kp; Space.kpTime = last.t; $('#chipKp b').textContent = kp.toFixed(1); $('#chipKp').classList.toggle('hot', kp >= 5);
    $('#chipKp').title = `Planetary K-index ${kp} at ${last.t} UTC (NOAA SWPC)` + (kp >= 5 ? ' · geomagnetic storm' : '');
    if (kp >= 6 && !window._kpWarned) { window._kpWarned = true; Log.warn(`Geomagnetic storm: Kp ${kp}`); } else if (kp < 5) window._kpWarned = false; // re-arm for the next storm
  } catch (e) { $('#chipKp b').textContent = '—'; $('#chipKp').title = 'Kp unavailable: ' + e.message; }
}
fetchKp(); setInterval(() => { if (!Feeds.paused) fetchKp(); }, 600000);

/* ---------- Precipitation radar (RainViewer) + IR satellite (NASA GIBS geostationary band 13; RainViewer dropped its IR product) */
export const lyRadar = Layers.add({ id: 'radar', group: 'Weather & space weather', name: 'Precipitation radar', desc: 'RainViewer · latest composite radar', color: '#4fa3ff', default: false });
export const lyIr = Layers.add({ id: 'irsat', group: 'Weather & space weather', name: 'Cloud cover (IR satellite)', desc: 'NASA GIBS · GOES-East, GOES-West and Himawari clean-IR (band 13), newest 10-min scans · no Europe/Africa disk', color: '#c9d6df', default: false });
export let radarTiles = null, irTiles = null;
lyRadar.enable = () => { if (radarTiles) radarTiles.addTo(map); }; lyRadar.disable = () => { if (radarTiles) map.removeLayer(radarTiles); };
lyIr.enable = () => { if (irTiles) irTiles.addTo(map); }; lyIr.disable = () => { if (irTiles) map.removeLayer(irTiles); };
export async function rainviewer(kind) {
  const d = await Net.json('https://api.rainviewer.com/public/weather-maps.json'); const host = d.host || 'https://tilecache.rainviewer.com';
  if (kind === 'radar') { const fr = (d.radar?.past || []).slice(-1)[0]; if (!fr) throw new Error('no radar frames'); const url = `${host}${fr.path}/256/{z}/{x}/{y}/2/1_1.png`; if (radarTiles) map.removeLayer(radarTiles); radarTiles = L.tileLayer(url, { opacity: .7, maxNativeZoom: 7, zIndex: 400, attribution: 'RainViewer' }); /* the free tiles stop at zoom 7 (8+ is a "Zoom Level Not Supported" image): Leaflet upscales past it */ if (lyRadar.on) radarTiles.addTo(map); lyRadar.desc = `Frame ${fmt.hms(fr.time * 1000)}Z`; lyRadar.feed.count = 1; }
}
// GIBS serves each disk's newest scan as time "default" (CORS *, no-cache), so a refresh is a cache-busting redraw.
// The three layers share one pane inside the tile pane, so the opacity applies once and overlapping disks show no seams.
export const GIBS_IR = ['GOES-West_ABI_Band13_Clean_Infrared', 'Himawari_AHI_Band13_Clean_Infrared', 'GOES-East_ABI_Band13_Clean_Infrared'];
export const irPane = map.createPane('irsat', map.getPane('tilePane')); irPane.style.zIndex = 390; irPane.style.opacity = .55; irPane.style.pointerEvents = 'none';
export async function gibsIr() {
  const b = Math.floor(Date.now() / 600e3);
  if (!irTiles) irTiles = L.layerGroup(GIBS_IR.map(id => L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png?b={b}`, { b, pane: 'irsat', maxNativeZoom: 6, attribution: 'NASA GIBS · GOES / Himawari' })));
  else irTiles.eachLayer(t => { if (t.options.b !== b) { t.options.b = b; t.redraw(); } });
  if (lyIr.on && !map.hasLayer(irTiles)) irTiles.addTo(map); lyIr.feed.count = GIBS_IR.length;
}
feed(lyRadar, { interval: 600, fetch: () => rainviewer('radar') }); feed(lyIr, { interval: 600, fetch: gibsIr });

/* ---------- Day/night terminator */
export const lyTerm = Layers.add({ id: 'terminator', group: 'Weather & space weather', name: 'Day / night', desc: 'Solar terminator, computed locally', color: '#2b3c49', default: true });
export let termPoly = null, termTimer = null;
export function drawTerminator() { const ring = nightRing(Date.now()); if (termPoly) termPoly.setLatLngs([ring]); else termPoly = L.polygon([ring], { color: '#000', weight: 0, fillColor: '#000', fillOpacity: .32, interactive: false, renderer: vecRenderer }); if (lyTerm.on && !map.hasLayer(termPoly)) termPoly.addTo(map); }
lyTerm.enable = () => { drawTerminator(); termTimer = setInterval(drawTerminator, 60000); }; lyTerm.disable = () => { clearInterval(termTimer); if (termPoly) map.removeLayer(termPoly); };

/* ---------- Submarine cables + landing points (TeleGeography data); cables are non-interactive lines with a manual click test */
export const lyCables = Layers.add({ id: 'cables', group: 'Infrastructure', name: 'Submarine cables', desc: 'TeleGeography submarine cable map data · live with the helper, an older GitHub copy without it', color: C.cable, default: false });
export const gCables = lineLayer(lyCables); export let cableData = null;
export const lyLanding = Layers.add({ id: 'landing', group: 'Infrastructure', name: 'Cable landing stations', desc: 'Where the cables come ashore', color: '#8fc6e6', shape: 'round', default: false, points: 'landing' });
Points.define('landing', 'landing', { minZoom: 4 });
Detail.renderers.cable = p => `<div class="det">${Detail.head(okColor(p.color) || C.cable, 'Submarine cable · TeleGeography', p.name, '')}${Detail.links([{ text: 'Cable page on submarinecablemap.com', url: cablePage(p.id) }])}</div>`;
Detail.renderers.landing = p => `<div class="det">${Detail.head('#8fc6e6', 'Cable landing station', p.name, '')}${Detail.links([{ text: 'Landing point on submarinecablemap.com', url: landingPage(p.id) }])}</div>`;
export async function firstOk(urls, o) { let err; for (const u of urls) { try { return await Net.json(u, o); } catch (e) { err = e; } } throw err; }
export function cableHit(latlng) { // nearest cable within ~10 px (core/cables.js)
  if (!cableData || !lyCables.on) return null;
  return nearestCable(cableData.features, latlng.lat, latlng.lng, 10 * 40075016 * Math.cos(rad(latlng.lat)) / (256 * Math.pow(2, map.getZoom())));
}
feed(lyCables, { interval: 86400, fetch: async () => { const d = cableData && Date.now() - cableData._t < 86400e3 ? cableData : await firstOk(CABLE_URLS, { timeout: 60000 }); d._t = d._t || Date.now(); cableData = d; gCables.clearLayers(); // toggling the layer reuses the multi-MB file
  gCables.addLayer(L.geoJSON(d, { interactive: false, style: f => ({ color: f.properties?.color || C.cable, weight: 1.2, opacity: .55, renderer: vecRenderer }) })); lyCables.feed.count = (d.features || []).length; } });
feed(lyLanding, { interval: 86400, fetch: async () => { const d = await firstOk(LANDING_URLS, { timeout: 60000 });
  const list = parseLandings(d); Points.set('landing', list.map(p => ({ lat: p.lat, lon: p.lon, r: 2.5, color: '#8fc6e6', fillAlpha: .6, kind: 'landing', obj: p, tip: p.name }))); lyLanding.feed.count = list.length; } });

/* ---------- Traffic & public cameras: the globe's twelve agency networks (core/cameras.js), each loaded only while its
   area is on screen, drawn from zoom 8; Windy (with a key) adds webcams near the view */
export const CAM_SRCS = CAMERA_GROUPS;
export const lyCams = Layers.add({ id: 'cams', group: 'Ground', name: 'Public cameras', desc: 'Official traffic cameras · appear from zoom 8 · London, New York, California, Delaware, Iowa, Missouri, British Columbia, Calgary, Finland, Norway, Hong Kong, Singapore · live video where the agency streams it · Windy key adds webcams worldwide', color: C.cam, default: true, points: 'cams',
  sub(el) { const r = () => UI.pills(el, CAM_SRCS, id => (Layers.opt('cam_src') || []).includes(id), (id, on) => { const s = (Layers.opt('cam_src') || []).filter(x => x !== id); if (on) s.push(id); Layers.setOpt('cam_src', s); r(); if (lyCams.on) rerunFeed(lyCams.feed); }); r();
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pill'; b.textContent = 'show regions'; b.title = 'Fly to the covered regions one by one'; let i = 0; b.addEventListener('click', () => { const s = CAM_SRCS[i++ % CAM_SRCS.length]; map.flyToBounds([[s.box[0], s.box[1]], [s.box[2], s.box[3]]], { duration: 1 }); toast('Cameras: ' + s.name); }); el.appendChild(b); } });
Points.define('cams', 'cams', { minZoom: 8 });
export function viewBox() { const b = map.getBounds(); return { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() }; }
export const viewIntersects = box => boxInView(box, viewBox());
// live video: Safari plays HLS itself, elsewhere hls.js (light build, the globe's version) loads on first use
const HLS_JS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.light.mjs';
let hlsLib = null, hlsNow = null;
export async function playStream(box, url) {
  if (hlsNow) { hlsNow.destroy(); hlsNow = null; }
  const v = document.createElement('video'); Object.assign(v, { muted: true, autoplay: true, playsInline: true, controls: true }); v.setAttribute('playsinline', '');
  box.replaceChildren(v);
  if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; return; }
  try {
    const Hls = (await (hlsLib ||= import(HLS_JS).catch(e => { hlsLib = null; throw e; }))).default;
    if (!Hls.isSupported() || !v.isConnected) throw new Error('this browser cannot play the stream');
    const h = hlsNow = new Hls({ maxBufferLength: 8, backBufferLength: 0, liveSyncDurationCount: 2 });
    h.on(Hls.Events.ERROR, (ev, d) => { if (d.fatal && hlsNow === h) { h.destroy(); hlsNow = null; box.insertAdjacentHTML('beforeend', '<div class="cap">The live video stopped (the agency\'s server).</div>'); } });
    h.loadSource(url); h.attachMedia(v);
  } catch (e) { box.innerHTML = `<div class="cap">The live video can't play here: ${esc(e.message)}</div>`; }
}
setInterval(() => { if (hlsNow && !document.querySelector('.det .camlive video')) { hlsNow.destroy(); hlsNow = null; } }, 2000);   // the card closed: stop downloading
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-camlive]'); if (b && isHttp(b.dataset.camlive)) playStream(b.closest('.camlive'), b.dataset.camlive); });   // no inline handler: the address stays an attribute
Detail.renderers.cam = c => {
  const net = netOf(c), src = c.src || (net ? net.name : c.net), img = c.relayImage ? (Relay.wrap(c.image) || c.image) : c.image;
  const media = isStream(c) ? `<div class="camlive">${img ? `<img src="${esc(bustUrl(img, c))}" alt="" referrerpolicy="no-referrer">` : ''}<div class="cap"><button class="btn small" data-camlive="${esc(c.video)}">▶ Live video</button> · ${esc(src)}</div></div>`
    : c.video ? `<video src="${esc(bustUrl(c.video, c))}" controls autoplay muted loop playsinline></video><div class="cap">Video clip · ${esc(src)}</div>`
    : img ? `<img src="${esc(bustUrl(img, c))}" alt="${esc(c.name)}" referrerpolicy="no-referrer"><div class="cap">Still image · ${esc(src)} · <a href="#" data-do="rerender">refresh</a></div>` : '';
  return `<div class="det">${Detail.head(C.cam, 'Camera · ' + src, c.name, esc(c.view || c.sub || ''), [c.online === false ? { t: 'Offline', cls: 'warn' } : null, isStream(c) ? { t: 'Live video', cls: 'good' } : null].filter(Boolean))}${media}
  ${Detail.kv([['Position', fmt.ll(c.lat, c.lon)], ['Direction', c.direction], ['Route', c.route], ['Views', c.presets && c.presets.length > 1 ? c.presets.length : null]])}
  <div class="actions"><button class="btn small" data-do="fly" data-lat="${num(c.lat)}" data-lon="${num(c.lon)}" data-z="13">Center</button></div><hr class="sep">${Detail.links([c.stream ? { text: 'Live stream (HLS)', url: c.stream } : null, c.link ? { text: 'Open at source', url: c.link } : null, c.image ? { text: 'Image URL', url: c.image } : null].filter(Boolean))}${net ? `<p class="cap" style="font-size:11px;color:var(--ink-faint)">${esc(net.credit)}</p>` : ''}</div>`;
};
export const CAM_LOADERS = {
  async windy(out) { const key = late.Keys.get('windy'); if (!key) return 0; const c = map.getCenter(); const d = await Net.json(`https://api.windy.com/webcams/api/v3/webcams?nearby=${c.lat.toFixed(3)},${(((c.lng + 540) % 360) - 180).toFixed(3)},250&include=images,location,player,urls&limit=50`, { headers: { 'x-windy-api-key': key } }); for (const w of d.webcams || []) { const loc = w.location || {}; if (loc.latitude == null) continue; out.push({ id: 'windy' + w.webcamId, src: 'Windy webcams', name: w.title, sub: [loc.city, loc.country].filter(Boolean).join(', '), lat: loc.latitude, lon: loc.longitude, image: w.images?.current?.preview, online: w.status === 'active', link: w.urls?.detail || `https://www.windy.com/webcams/${w.webcamId}` }); } return out.length; },
};
export const camCache = {}; // per network: { t, cams[] } so panning back does not refetch multi-MB lists
export const camItem = c => ({ lat: c.lat, lon: c.lon, r: z => z >= 13 ? 4.5 : z >= 11 ? 3 : 2, color: isStream(c) ? '#ff9ad5' : C.cam, fillAlpha: c.online === false ? .2 : .7, alpha: .9, kind: 'cam', obj: c, tip: c.name + (isStream(c) ? ' · live video' : '') });
async function loadCamNet(id) { // one agency's list (core/cameras.js parses it), kept 30 min (Singapore's stills change address: 5 min)
  const n = CAMERA_NETS[id]; let c = camCache[id];
  if (!c || Date.now() - c.t > (id === 'sg' ? 300e3 : 1800e3)) {
    if (n.relay && !Relay.available && !Relay.wrap(n.url)) throw new Error('needs the helper (no CORS)');
    const d = n.xml ? await Net.text(n.url, { timeout: 60000 }) : await Net.json(n.url, { timeout: 60000 });
    c = camCache[id] = { t: Date.now(), cams: n.parse(d) };
    for (const cam of c.cams) stamp(cam, 'cameras', [rep('cameras', { name: n.name, url: null, dataAt: cam.t || null, cached: Relay.viaCopy(n.url) })]);   // the lists carry no picture time: unknown
  }
  return c.cams;
}
feed(lyCams, { interval: 120, viewDependent: true, minZoom: 8, fetch: async () => {
  let items = []; const errs = [], loaded = [], skipped = [], v = viewBox();
  for (const g of CAM_SRCS.filter(s => (Layers.opt('cam_src') || []).includes(s.id))) {
    if (!boxInView(g.box, v)) { skipped.push(g.name); continue; }
    let n = 0;
    for (const id of g.nets) {
      if (!boxInView(CAMERA_NETS[id].box, v)) continue;
      try { const cams = await loadCamNet(id); items = items.concat(cams.map(camItem)); n += cams.length; } catch (e) { errs.push(`${CAMERA_NETS[id].name}: ${e.message}`); }
    }
    if (n) loaded.push(`${g.name} ${n}`);
  }
  if (late.Keys.get('windy')) { const out = []; try { await CAM_LOADERS.windy(out); items = items.concat(out.map(camItem)); loaded.push('Windy ' + out.length); } catch (e) { errs.push('Windy: ' + e.message); } }
  Points.set('cams', items); lyCams.feed.count = items.length; lyCams.desc = (loaded.length ? 'Loaded: ' + loaded.join(', ') : 'No covered region on screen') + (skipped.length ? ' · off-screen: ' + skipped.slice(0, 6).join(', ') + (skipped.length > 6 ? '…' : '') : '');
  if (errs.length) { if (!items.length) throw new Error(errs.join(' · ')); Log.warn('Cameras: ' + errs.join(' · ')); }
} });

/* ---------- Ships: Baltic AIS (Digitraffic) + global AIS (aisstream.io key) */
Detail.renderers.ship = s => {
  const eta = s.eta ? etaTime(s.eta) : null, kind = s.type != null ? SHIP_KINDS[shipKind(s.type)] : null;
  return `<div class="det">${Detail.head(kind ? kind[1] : C.ship, 'Vessel · AIS via ' + s.src, s.name || `MMSI ${s.id}`, [s.typeName, s.flag, s.callsign ? 'call ' + s.callsign : null, s.dest ? '→ ' + s.dest : null].filter(Boolean).map(esc).join(' · '))}
${Detail.kv([['MMSI', s.id], ['IMO', s.imo], ['Flag', s.flag], ['Speed', s.sog != null ? `${s.sog} kt · ${fmt.n(s.sog * 1.852)} km/h` : null], ['Course', s.cog != null ? `${s.cog}°` : null], ['Heading', (s.heading != null && s.heading < 360) ? `${s.heading}°` : null],
  ['Turning', s.turn ? `${Math.abs(s.turn * 60).toFixed(0)}°/min ${s.turn > 0 ? 'right' : 'left'}` : null], ['Nav status', s.navText || s.navStat], ['Destination', s.dest], ['ETA', eta ? fmt.date(eta) : null], ['Draught', s.draught ? `${s.draught} m` : null],
  ['Size', s.length ? `${s.length} × ${s.width || '?'} m` : null], ['Position', fmt.ll(s.lat, s.lon)], ['Fix age', fmt.ago(s.ts)]])}
<p style="font-size:12px;color:var(--ink-dim)">Moved along its course at its speed between reports (and through the turn it reports), as on the 3D globe.</p>
<div class="actions"><button class="btn small" data-do="fly" data-lat="${num(s.lat)}" data-lon="${num(s.lon)}" data-z="11">Center</button></div><hr class="sep">${Detail.links([{ text: 'VesselFinder', url: `https://www.vesselfinder.com/vessels/details/${num(s.id)}` }, { text: 'MarineTraffic search', url: `https://www.marinetraffic.com/en/ais/index/search/all?keyword=${num(s.id)}` }])}</div>`;
};
export const NAV = Object.fromEntries(NAV_STATUS.map((t, i) => [i, t ? t[0].toUpperCase() + t.slice(1) : '']).filter(([, t]) => t));
export const lyShipsFi = Layers.add({ id: 'ships_fi', group: 'Sea & sky', name: 'Ships · Baltic AIS', desc: 'Fintraffic Digitraffic · open AIS around Finland · zoom in past level 5 to see individual ships', color: C.ship, default: false,
  sub(el) { const b = document.createElement('button'); b.type = 'button'; b.className = 'pill'; b.textContent = 'go to Baltic'; b.addEventListener('click', () => map.flyTo([60.0, 24.5], 7)); el.appendChild(b); },
  disable() { for (const [k, s] of Dyn.ships) if (s.src === 'Digitraffic') Dyn.ships.delete(k); } });
export let vesselMeta = { t: 0, m: new Map() };
/** Provenance for a ship: its own receiver network, and the other one's report of the same MMSI where it agrees (core/ais.js). */
function stampShip(pre, mmsi) {
  const own = Dyn.ships.get(pre + mmsi), other = Dyn.ships.get((pre === 'fi' ? 'ws' : 'fi') + mmsi); if (!own) return;
  const r = s => ({ src: s.src === 'Digitraffic' ? 'digitraffic' : 'aisstream', t: s.ts, id: s.id, lat: s.lat, lon: s.lon, sog: s.sog });
  const reps = other ? [r(own), r(other)] : [r(own)];
  stampReports(own, 'ships', reps, reps.filter((x, i) => i === 0 || sameShip(reps[0], x)).map(x => x.src));
  if (other) stampReports(other, 'ships', [reps[1], reps[0]], sameShip(reps[0], reps[1]) ? [reps[1].src, reps[0].src] : [reps[1].src]);
}
const aisGet = path => Net.json(DIGITRAFFIC_AIS + path, { timeout: 60000, headers: DIGITRAFFIC_HEADERS });
feed(lyShipsFi, { interval: 60, fetch: async () => {   // positions and ship details parsed by core/ais.js, like the globe's ships
  if (Date.now() - vesselMeta.t > 1800e3) { try { vesselMeta = { t: Date.now(), m: new Map(parseAisVessels(await aisGet('vessels')).map(v => [v.mmsi, v])) }; } catch (e) { Log.warn('Digitraffic vessel names: ' + e.message); } }
  const reps = parseAisLocations(await aisGet('locations')), now = Date.now(); let n = 0;
  if (!lyShipsFi.on) return; // switched off while loading: don't put the ships back
  for (const [k, s] of Dyn.ships) if (k.startsWith('fi') && now - s.ts > 3600e3) Dyn.ships.delete(k); // ships that stopped reporting
  for (const r of reps) {
    if (now - r.t > 3600e3) continue; const m = vesselMeta.m.get(r.mmsi) || {};
    Dyn.ships.set('fi' + r.mmsi, { id: r.mmsi, lat: r.lat, lon: r.lon, sog: r.sog, cog: r.cog, heading: r.heading, turn: r.turn, navStat: r.navStat, navText: NAV[r.navStat], name: m.name, callsign: m.callSign, imo: m.imo,
      dest: m.destination, eta: m.eta, type: m.type ?? null, typeName: m.type ? shipTypeName(m.type) : null, flag: flagOf(r.mmsi), draught: m.draught, length: m.length, width: m.width, ts: r.t, src: 'Digitraffic' }); n++;
      stampShip('fi', r.mmsi);
  }
  lyShipsFi.feed.count = n; requestDraw();
} });
export const lyShipsWs = Layers.add({ id: 'ships_ws', group: 'Sea & sky', name: 'Ships · global AIS stream', desc: 'aisstream.io WebSocket · needs a free key (Setup tab)', color: '#3fb8a2', default: false });
export const AisWs = { ws: null, timer: null,
  connect() { const key = late.Keys.get('aisstream'); if (!key) { this.close(); lyShipsWs.feed.status = 'error'; lyShipsWs.feed.err = 'no aisstream.io key'; UI.refreshLayer(lyShipsWs); return; }
    this.close(); lyShipsWs.feed.status = 'loading'; UI.refreshLayer(lyShipsWs);
    try { this.ws = new WebSocket('wss://stream.aisstream.io/v0/stream'); } catch (e) { lyShipsWs.feed.status = 'error'; lyShipsWs.feed.err = e.message; UI.refreshLayer(lyShipsWs); return; }
    this.ws.onopen = () => { this.subscribe(); lyShipsWs.feed.status = 'ok'; lyShipsWs.feed.lastOk = Date.now(); UI.refreshLayer(lyShipsWs); Log.info('aisstream.io connected'); };
    this.ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.error) { lyShipsWs.feed.status = 'error'; lyShipsWs.feed.err = m.error; UI.refreshLayer(lyShipsWs); return; } if (m.MessageType !== 'PositionReport') return; const md = m.MetaData || {}, pr = m.Message?.PositionReport || {}; if (md.latitude == null) return;
      if (!Dyn.ships.has('ws' + md.MMSI)) lyShipsWs.feed.count++; if (!this.drawT) this.drawT = setTimeout(() => { this.drawT = null; requestDraw(); }, 1000); // O(1) per message; redraw at most once a second
      Dyn.ships.set('ws' + md.MMSI, { id: md.MMSI, lat: md.latitude, lon: md.longitude, sog: pr.Sog, cog: pr.Cog, heading: pr.TrueHeading, navStat: pr.NavigationalStatus, navText: NAV[pr.NavigationalStatus], name: (md.ShipName || '').trim(), ts: Date.parse(String(md.time_utc || '').replace(/^(\S+) (\d\d:\d\d:\d\d)(\.\d{1,3})?\d* \+0000 UTC$/, '$1T$2$3Z')) || Date.now(), src: 'aisstream.io' }); stampShip('ws', md.MMSI); };
    this.ws.onclose = () => { if (lyShipsWs.on) { lyShipsWs.feed.status = 'error'; lyShipsWs.feed.err = 'disconnected — retrying'; UI.refreshLayer(lyShipsWs); this.timer = setTimeout(() => this.connect(), 15000); } };
    this.ws.onerror = () => { };
  },
  subscribe() { if (!this.ws || this.ws.readyState !== 1) return; const b = map.getBounds(); const s = Math.max(-90, b.getSouth()), n = Math.min(90, b.getNorth()); let w = b.getWest(), e = b.getEast(); if (e - w >= 360) { w = -180; e = 180; } else { w = ((w + 540) % 360) - 180; e = ((e + 540) % 360) - 180; if (e < w) { w = -180; e = 180; } }
    this.ws.send(JSON.stringify({ APIKey: late.Keys.get('aisstream'), BoundingBoxes: [[[s, w], [n, e]]], FilterMessageTypes: ['PositionReport'] })); },
  close() { clearTimeout(this.timer); if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch (e) { } this.ws = null; } },
};
lyShipsWs.enable = () => AisWs.connect(); lyShipsWs.disable = () => { AisWs.close(); for (const k of [...Dyn.ships.keys()]) if (k.startsWith('ws')) Dyn.ships.delete(k); lyShipsWs.feed.count = 0; };
feed(lyShipsWs, { interval: 30, fetch: async () => { if (!AisWs.ws || AisWs.ws.readyState > 1) AisWs.connect(); const now = Date.now(); for (const [k, s] of Dyn.ships) if (k.startsWith('ws') && now - s.ts > 900e3) Dyn.ships.delete(k); lyShipsWs.feed.count = [...Dyn.ships.keys()].filter(k => k.startsWith('ws')).length; if (!late.Keys.get('aisstream')) throw new Error('no aisstream.io key (Setup tab)'); } });
map.on('moveend', debounce(() => AisWs.subscribe(), 1200));

/* ---------- Weather balloons / radiosondes (SondeHub) */
export const lyBalloons = Layers.add({ id: 'balloons', group: 'Sea & sky', name: 'Weather balloons', desc: 'SondeHub · community-uploaded, unverified: asks first', color: C.bal, shape: 'round', default: false, disable() { Dyn.balloons.clear(); },
  guard: { title: 'Weather balloons: read this first', accept: 'I understand, show balloons', body: [{"h": "Where balloon data comes from", "p": "A weather balloon carries a small radio transmitter, a radiosonde, that sends out its position every second or so. Hobbyists with cheap radio receivers pick those signals up and upload them to SondeHub, a free, open database. Open Overwatch asks SondeHub for the balloons near the middle of your map and draws whatever comes back."}, {"h": "Why anyone can add to it", "p": "SondeHub is open on purpose: that is how a worldwide network of volunteers works. Its uploads are open to volunteers and are not individually checked, so the list is part genuine balloons and part whatever people chose to submit. Nobody has to own a balloon, or even a radio, to add an entry that looks like one."}, {"h": "Why that could be a threat", "p": "A made-up balloon can put false information on the map, in the wrong place or with an official-sounding name. Its text fields (name, type, notes) could also hold web code instead of words: if a site displayed that carelessly, the code would run in your browser and could change the page or try to take your information (a script, or “injection”, attack). A balloon's details could carry a tempting link or instructions. And a reported landing spot could lure someone to a place that is private or unsafe."}, {"h": "What Open Overwatch does about it", "p": "Every balloon field is shown as plain text and never run as code; numbers are checked to be numbers before they go anywhere near a button; and the only link offered goes to SondeHub itself. This is covered by automated tests. It lowers the risk; it does not make the data true."}, {"h": "What you should do", "p": "Treat every balloon as unverified. Don't click links or follow instructions that you find in balloon details anywhere else. Never go looking for a landed balloon because of this map, and don't use it for safety, navigation or recovery. Switch the layer off when you're done."}, {"h": "What gets sent", "p": "Turning this on sends the centre of your map view to SondeHub (api.v2.sondehub.org) to ask which balloons are nearby."}] } });
Detail.renderers.balloon = b => `<div class="det">${Detail.head(C.bal, 'Radiosonde · SondeHub', b.id, [b.type, b.subtype].filter(Boolean).map(esc).join(' · '))}
${Detail.kv([['Altitude', `${fmt.n(b.alt)} m`], ['Climb', b.vel_v != null ? `${b.vel_v > 0 ? '▲' : '▼'} ${Math.abs(b.vel_v).toFixed(1)} m/s` : null], ['Ground speed', b.vel_h != null ? `${fmt.n(b.vel_h * 3.6)} km/h` : null], ['Heading', b.heading != null ? `${fmt.n(b.heading)}°` : null], ['Temp', b.temp != null ? `${b.temp} °C` : null], ['Humidity', b.humidity != null ? `${b.humidity} %` : null], ['Pressure', b.pressure != null ? `${b.pressure} hPa` : null], ['Frequency', b.frequency ? `${b.frequency} MHz` : null], ['Heard by', b.uploader], ['Last frame', b.datetime ? fmt.date(b.datetime) : null], ['Position', fmt.ll(b.lat, b.lon)]])}
<div class="actions"><button class="btn small" data-do="fly" data-lat="${num(b.lat)}" data-lon="${num(b.lon)}" data-z="9">Center</button></div><hr class="sep">${Detail.links([{ text: 'Track on SondeHub', url: `https://sondehub.org/${encodeURIComponent(b.id)}` }])}</div>`;
feed(lyBalloons, { interval: 120, viewDependent: true, fetch: async () => {
  const c = map.getCenter(); const d = await Net.json(`https://api.v2.sondehub.org/sondes?lat=${c.lat.toFixed(2)}&lon=${(((c.lng + 540) % 360) - 180).toFixed(2)}&distance=3000000&last=10800`, { timeout: 40000 }); if (!lyBalloons.on) return; Dyn.balloons.clear(); let n = 0; // off while loading: stay off
  for (const [serial, t] of Object.entries(d || {})) { if (!t || !Number.isFinite(+t.lat) || !Number.isFinite(+t.lon)) continue; Dyn.balloons.set(serial, { id: serial, lat: t.lat, lon: t.lon, alt: t.alt, vel_h: t.vel_h, vel_v: t.vel_v, heading: t.heading, temp: t.temp, humidity: t.humidity, pressure: t.pressure, frequency: t.frequency, type: t.type, subtype: t.subtype, uploader: t.uploader_callsign, datetime: t.datetime, ts: Date.parse(t.datetime) || Date.now() }); stamp(Dyn.balloons.get(serial), 'balloons', [rep('sondehub', { dataAt: t.datetime })]); n++; }
  lyBalloons.feed.count = n; requestDraw();
} });

/* ---------- Active fires (NASA FIRMS, key) */
export const lyFires = Layers.add({ id: 'fires', group: 'Ground', name: 'Active fires (satellite)', desc: 'NASA FIRMS VIIRS · needs a free MAP_KEY (Setup tab) · zoom in', color: '#ff6a2a', shape: 'round', default: false, points: 'fires' });
Points.define('fires', 'fires');
Detail.renderers.fire = f => `<div class="det">${Detail.head('#ff6a2a', 'Thermal anomaly · NASA FIRMS', `${f.satellite || 'VIIRS'} detection`, esc(`${f.acq_date} ${String(f.acq_time).padStart(4, '0').replace(/(\d\d)(\d\d)/, '$1:$2')}Z`), [{ t: `${f.confidence} confidence`, cls: f.confidence === 'h' || f.confidence === 'high' ? 'warn' : '' }, { t: f.daynight === 'D' ? 'Day' : 'Night' }])}
${Detail.kv([['Radiative power', f.frp ? `${f.frp} MW` : null], ['Brightness (I4)', f.bright_ti4 ? `${f.bright_ti4} K` : null], ['Position', fmt.ll(+f.latitude, +f.longitude)]])}<hr class="sep">${Detail.links([{ text: 'FIRMS fire map', url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${f.longitude},${f.latitude},9z` }])}</div>`;
feed(lyFires, { interval: 900, viewDependent: true, minZoom: 5, fetch: async () => {
  const key = late.Keys.get('firms'); if (!key) throw new Error('no FIRMS MAP_KEY (Setup tab)'); const b = map.getBounds(); const w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast());
  const txt = await Net.text(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/${w.toFixed(2)},${b.getSouth().toFixed(2)},${e.toFixed(2)},${b.getNorth().toFixed(2)}/1`, { timeout: 60000 });
  if (/invalid|error/i.test(txt.slice(0, 200)) && !txt.includes('latitude')) throw new Error(txt.slice(0, 80)); const lines = txt.trim().split('\n'); const head = lines.shift().split(','); const items = [];
  for (const line of lines) { const cols = line.split(','); const f = {}; head.forEach((h, i) => f[h] = cols[i]); const lat = +f.latitude, lon = +f.longitude; if (!isFinite(lat)) continue;
    const hhmm = String(f.acq_time || '').padStart(4, '0'); stamp(f, 'fires', [rep('firms', { dataAt: `${f.acq_date}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`, cached: Relay.viaCopy('https://firms.modaps.eosdis.nasa.gov/') })]);
    items.push({ lat, lon, r: Math.min(9, 2.5 + Math.sqrt(+f.frp || 1)), color: '#ff6a2a', fillAlpha: .6, kind: 'fire', obj: f, tip: `${f.frp || '?'} MW · ${f.acq_date}` }); }
  Points.set('fires', items); lyFires.feed.count = items.length;
} });

/* ---------- OSM area scan results (from the probe) */
export const lyScan = Layers.add({ id: 'osm_scan', group: 'Infrastructure', name: 'Area scan results', desc: 'Military areas, airfields, nuclear sites, harbours from OpenStreetMap · run from a map probe', color: C.infra, default: true, points: 'scan' });
Points.define('scan', 'osm_scan'); lyScan.enable = () => { if (lyScan.last) Points.set('scan', lyScan.last); }; // turning the layer off clears the points; bring the last scan back
Detail.renderers.osm = o => `<div class="det">${Detail.head(C.infra, 'OpenStreetMap · ' + o.kind, o.name, esc(o.sub || ''))}${Detail.kv(Object.entries(o.tags).filter(([k]) => !/^(name|source|created_by)/.test(k)).slice(0, 24).map(([k, v]) => [k, v]))}
<div class="actions"><button class="btn small" data-do="fly" data-lat="${num(o.lat)}" data-lon="${num(o.lon)}" data-z="13">Center</button></div><hr class="sep">${Detail.links([{ text: `OSM ${o.type} ${o.id}`, url: `https://www.openstreetmap.org/${o.type}/${o.id}` }])}</div>`;
export async function scanArea(lat, lon, radius = 30000) {
  const around = `(around:${radius},${lat},${lon})`;
  const q = `[out:json][timeout:30];(nwr["landuse"="military"]${around};nwr["military"]${around};nwr["aeroway"="aerodrome"]${around};nwr["generator:source"="nuclear"]${around};nwr["plant:source"="nuclear"]${around};nwr["harbour"="yes"]${around};nwr["seamark:type"="harbour"]${around};nwr["man_made"="radar_station"]${around};nwr["telecom"="data_center"]${around};);out center tags 300;`;
  toast('Scanning OpenStreetMap…'); const d = await overpass(q, { timeout: 60000 }), items = [], seen = new Set();   // core/overpass.js: one request at a time, the quickest mirror that answers (the globe's client) const items = []; const seen = new Set();
  for (const el of d.elements || []) { const t = el.tags || {}; const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon; if (la == null) continue; const key = `${la.toFixed(4)},${lo.toFixed(4)}`; if (seen.has(key)) continue; seen.add(key);
    const kind = t.aeroway ? (t['aerodrome:type'] === 'military' || t.military ? 'Military airfield' : 'Airfield') : (t.landuse === 'military' || t.military) ? 'Military · ' + (t.military || 'area') : (t['generator:source'] === 'nuclear' || t['plant:source'] === 'nuclear') ? 'Nuclear plant' : t.man_made === 'radar_station' ? 'Radar station' : t.telecom ? 'Data centre' : 'Harbour';
    const o = { osmAt: d.osm3s && d.osm3s.timestamp_osm_base, id: el.id, type: el.type, kind, name: t.name || t['name:en'] || t.icao || t.iata || kind, sub: [t.operator, t.icao, t.iata].filter(Boolean).join(' · '), lat: la, lon: lo, tags: t };
    const col = /Military/.test(kind) ? C.mil : /Nuclear|Radar/.test(kind) ? C.emg : C.infra;
    stamp(o, 'osm', [rep('osm', { name: 'OpenStreetMap (Overpass)', dataAt: o.osmAt })]);
    items.push({ lat: la, lon: lo, r: 5, color: col, shape: /Military/.test(kind) ? 'tri' : 'circle', fillAlpha: .3, kind: 'osm', obj: o, tip: `${o.kind}: ${o.name}`, label: o.name, labelZoom: 10 }); }
  lyScan.last = items; if (!lyScan.on) Layers.set('osm_scan', true); Points.set('scan', items); lyScan.feed = lyScan.feed || { status: 'ok', count: 0, lastOk: 0, err: '', nextAt: 1e15, running: false, interval: 1e9, errorInterval: 1e9, layer: lyScan, fetch: async () => { } }; lyScan.feed.count = items.length; lyScan.feed.status = 'ok'; lyScan.feed.lastOk = Date.now(); UI.refreshLayer(lyScan);
  Log.info(`OSM scan: ${items.length} features within ${radius / 1000} km of ${fmt.ll(lat, lon)}`); toast(`${items.length} features found`); return items.length;
}

Object.assign(late, { cableHit });
