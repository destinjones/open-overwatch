// Live transit: buses, trams, metros, trains and ferries in Boston (MBTA), Helsinki (HSL), all of Norway (Entur), Austin
// (CapMetro) and Minneapolis-St Paul (Metro Transit), straight from each operator's keyless feed (CORS or WebSocket, so
// the website needs no relay; Austin and Minneapolis publish GTFS-RT protobuf, read by core/gtfsrt.js). A feed runs only while
// the camera is near its area, below 400 km, in a visible tab. Vehicles report every few seconds; each is drawn a little
// behind live, between two real reports, so dots glide instead of hopping (motion model: core/transit.js).
import { C, esc, fmt } from './env.js';
import { scene, camera, camHeight } from './viewer.js';
import { Terrain } from './terrain.js';
import { setCount } from './layers.js';
import { state } from './state.js';
import { parseMbta, parseEntur, parseHfp, enturQuery, mqtt, addFix, sample, ease, approach, lagMeter, inArea, fromGtfsRt } from '../core/transit.js';
import { parseVehiclePositions } from '../core/gtfsrt.js';

const MAX_H = 400e3;   // above this the dots are sub-pixel specks: no feeds at all
const MODES = { bus: ['Bus', '#ffcc4d'], tram: ['Tram', '#3ee08f'], lightrail: ['Light rail', '#3ee08f'], metro: ['Metro', '#ff5e7a'], rail: ['Train', '#b18cff'], ferry: ['Ferry', '#4f9dff'] };
const COLOR = Object.fromEntries(Object.entries(MODES).map(([k, [, c]]) => [k, C.Color.fromCssColorString(c)]));
const OUTLINE = C.Color.BLACK.withAlpha(0.55), SCALE = new C.NearFarScalar(2e3, 1.4, 4e5, 0.5);
const pts = scene.primitives.add(new C.PointPrimitiveCollection());
pts.show = false;

const vehicles = new Map();   // id → Vehicle
const tmp = { lat: 0, lon: 0, hdg: null }, pos = new C.Cartesian3();

async function fetchJSON(url, init, signal) {
  const r = await fetch(url, { ...init, signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
/** A GTFS-RT vehicle positions feed → fixes. `url` may be a function that finds the current file. */
const gtfsrt = (url, opts) => async signal => {
  const r = await fetch(typeof url === 'function' ? await url(signal) : url, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return fromGtfsRt(parseVehiclePositions(new Uint8Array(await r.arrayBuffer())), opts);
};
// the feeds carry route ids only: the lines that aren't buses (Metro Transit's METRO lines, CapMetro's train)
const METRO_TRANSIT = { 901: ['lightrail', 'METRO Blue Line', 'Blue'], 902: ['lightrail', 'METRO Green Line', 'Green'], 888: ['rail', 'Northstar commuter rail', 'Northstar'],
  903: ['bus', 'METRO Red Line (bus rapid transit)', 'Red'], 904: ['bus', 'METRO Orange Line (bus rapid transit)', 'Orange'], 905: ['bus', 'METRO Gold Line (bus rapid transit)', 'Gold'],
  921: ['bus', 'METRO A Line (rapid bus)', 'A'], 922: ['bus', 'METRO B Line (rapid bus)', 'B'], 923: ['bus', 'METRO C Line (rapid bus)', 'C'], 924: ['bus', 'METRO D Line (rapid bus)', 'D'], 925: ['bus', 'METRO E Line (rapid bus)', 'E'] };
const CAPMETRO = { 550: ['rail', 'MetroRail Red Line', 'Red Line'], 801: ['bus', 'MetroRapid 801'], 803: ['bus', 'MetroRapid 803'] };

// ---- sources. `every`: poll period (0 = a stream); `gap0`: report interval assumed before a vehicle's own is known;
// `stale`: drop a vehicle whose last report is older than this (a stream never says a vehicle has gone)
const MBTA_URL = 'https://api-v3.mbta.com/vehicles?fields[vehicle]=latitude,longitude,bearing,speed,current_status,label,updated_at'
  + '&include=route,trip&fields[route]=type,short_name,long_name,color&fields[trip]=headsign';
const SOURCES = {
  // keyless MBTA allows 20 requests a minute per address; one every 15 s leaves room for a second tab
  mbta: { name: 'MBTA', every: 15e3, gap0: 15e3, stale: 15 * 60e3, credit: 'MBTA v3 API (MassDOT developer licence)',
    fetch: signal => fetchJSON(MBTA_URL, {}, signal).then(parseMbta) },
  // Entur covers every Norwegian operator; ask for a box round the camera, wider the higher it is
  entur: { name: 'Entur', every: 15e3, gap0: 15e3, stale: 4 * 60e3, credit: 'Entur (NLOD 2.0)',
    fetch(signal) {
      const c = camera.positionCartographic, lat = C.Math.toDegrees(c.latitude), lon = C.Math.toDegrees(c.longitude);
      const dLat = Math.min(Math.max(1.2 * c.height, 60e3), 250e3) / 111e3, dLon = dLat / Math.max(0.2, Math.cos(c.latitude));
      return fetchJSON('https://api.entur.io/realtime/v2/vehicles/graphql', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'openoverwatch-globe' },
        body: JSON.stringify({ query: enturQuery((lat - dLat).toFixed(3), (lon - dLon).toFixed(3), (lat + dLat).toFixed(3), (lon + dLon).toFixed(3)) }) }, signal).then(parseEntur);
    } },
  hsl: { name: 'HSL', every: 0, gap0: 8e3, stale: 5 * 60e3, credit: 'HSL high-frequency positioning (CC BY 4.0)' },
  // CapMetro's vehicles report every few seconds (the file is refreshed about every 15 s); Metro Transit's every ~30 s
  capmetro: { name: 'CapMetro', every: 15e3, gap0: 15e3, stale: 10 * 60e3, credit: 'CapMetro GTFS-RT via the Texas Open Data Portal',
    fetch: gtfsrt(async signal => {   // the download link redirects without CORS: ask for the current file, then read it
      const id = (await fetchJSON('https://data.texas.gov/api/views/eiei-9rpf.json', {}, signal)).blobId;
      if (!/^[\w-]+$/.test(id || '')) throw new Error('CapMetro: no current file');
      return `https://data.texas.gov/api/views/eiei-9rpf/files/${id}?filename=vehiclepositions.pb`;
    }, { prefix: 'capmetro', operator: 'CapMetro', routes: CAPMETRO }) },
  metrotransit: { name: 'Metro Transit', every: 15e3, gap0: 30e3, stale: 10 * 60e3, credit: 'Metro Transit GTFS-RT (Metropolitan Council)',
    fetch: gtfsrt('https://svc.metrotransit.org/mtgtfs/vehiclepositions.pb', { prefix: 'mt', operator: 'Metro Transit', routes: METRO_TRANSIT }) },
};
const AREAS = [
  { name: 'Boston', lat: 42.36, lon: -71.06, r: 150e3, src: SOURCES.mbta },
  { name: 'Helsinki', lat: 60.17, lon: 24.94, r: 150e3, src: SOURCES.hsl },
  { name: 'Austin', lat: 30.27, lon: -97.74, r: 150e3, src: SOURCES.capmetro },
  { name: 'Minneapolis', lat: 44.98, lon: -93.20, r: 150e3, src: SOURCES.metrotransit },
  // Norway as three boxes (south, middle, north) so Sweden doesn't poll it
  { name: 'Norway', box: [57.8, 4.3, 63.5, 12.7], src: SOURCES.entur },
  { name: 'Norway', box: [63.5, 8.3, 67.0, 15.5], src: SOURCES.entur },
  { name: 'Norway', box: [67.0, 11.5, 71.4, 31.3], src: SOURCES.entur },
];
for (const s of Object.values(SOURCES)) { s.lag = lagMeter(s.every ? 1 : 15e3); s.running = false; s.fails = 0; }   // a poll is one batch

/** Polled feeds: run now, then every `every` ms (longer after failures; MBTA answers 429 past its limit). */
function startPoll(s) {
  let timer = 0, ctl = null, dead = false;   // `dead`, not s.running: a quick stop + start must not leave two loops
  const run = async () => {
    ctl = new AbortController(); const kill = setTimeout(() => ctl.abort(), 20e3);
    try { const fixes = await s.fetch(ctl.signal); if (!dead) { ingest(s, fixes, true); s.fails = 0; } }
    catch (e) { if (!dead) { s.fails++; console.warn('transit', s.name, e.message); } }
    finally { clearTimeout(kill); if (!dead) timer = setTimeout(run, s.every * (1 + Math.min(s.fails, 4))); }
  };
  run();
  return () => { dead = true; clearTimeout(timer); ctl?.abort(); };
}

/** HSL over MQTT on a WebSocket. Every vehicle reports each second (~500 messages/s at night, more by day), too much
 *  for a phone: after a 2 s full sweep to find everyone, only messages whose position changed in the 3rd geohash digit
 *  or above (~100 m moved) come through, a fifth of the traffic. */
const HFP = '/hfp/v2/journey/ongoing/vp/';
const HFP_ALL = [HFP + '#'], HFP_MOVED = [0, 1, 2, 3].map(l => HFP + '+/+/+/+/+/+/+/+/' + l + '/#');
function startHsl(s) {
  let ws = null, ping = 0, sweep = 0, retry = 0, live = true, read;
  const open = () => {
    read = mqtt.reader();
    ws = new WebSocket('wss://mqtt.hsl.fi:443/', 'mqtt'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws.send(mqtt.connect('oo3d-' + Math.random().toString(36).slice(2, 12), 60));
    ws.onmessage = e => {
      if (!live) return;   // closing: a late message must not bring vehicles back
      for (const p of read(new Uint8Array(e.data))) {
        if (p.type === 3) { const f = parseHfp(p.topic, p.payload); if (f) ingest(s, [f], false); }
        else if (p.type === 2 && p.code === 0) {
          s.fails = 0; ws.send(mqtt.subscribe(1, HFP_ALL));
          sweep = setTimeout(() => { if (ws?.readyState === 1) { ws.send(mqtt.subscribe(2, HFP_MOVED)); ws.send(mqtt.unsubscribe(3, HFP_ALL)); } }, 2000);
          ping = setInterval(() => ws?.readyState === 1 && ws.send(mqtt.ping()), 30e3);
        }
      }
    };
    ws.onclose = () => {
      clearInterval(ping); clearTimeout(sweep); ws = null;
      if (live) { s.fails++; retry = setTimeout(open, 3000 * Math.min(2 ** s.fails, 40)); }
    };
  };
  open();
  return () => { live = false; clearTimeout(retry); if (ws) { try { ws.send(mqtt.disconnect()); } catch (e) { /* closing anyway */ } ws.close(); } };
}

function start(s) { if (s.running) return; s.running = true; s.fails = 0; s.stop = s.every ? startPoll(s) : startHsl(s); }
function stop(s) {
  if (!s.running) return; s.running = false; s.stop(); s.stop = null;
  for (const v of vehicles.values()) if (v.src === s) v.drop();
  count();
}

/** New reports. A poll is the whole picture, so a vehicle missing from it has gone (or left the box); a stream only adds. */
function ingest(s, fixes, whole) {
  const now = Date.now(), seen = whole ? new Set() : null;
  for (const f of fixes) {
    const age = now - f.t;
    s.lag.note(age, now);
    if (age - s.lag.value > s.stale) continue;   // Entur keeps parked buses for an hour
    let v = vehicles.get(f.id);
    if (!v) { v = new Vehicle(s, f); vehicles.set(f.id, v); }
    if (addFix(v, f, v.at)) v.info = f;
    seen?.add(f.id);
  }
  if (whole) { for (const v of vehicles.values()) if (v.src === s && !seen.has(v.id)) v.drop(); count(); }   // a stream: prune() counts
}
const count = () => setCount('transit', vehicles.size);

const MPS_KMH = 3.6;
const row = (k, v) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
function lateness(s) {
  if (s == null) return '';
  const m = Math.round(Math.abs(s) / 60);
  return m === 0 ? 'on time' : `${m} min ${s > 0 ? 'late' : 'early'}`;
}

class Vehicle {
  constructor(src, f) {
    this.kind = 'transit'; this.id = f.id; this.src = src; this.info = f; this.fixes = []; this.gap = null;
    this.delay = (src.gap0 + src.every) * 1.1;   // ms behind live, eased toward what its reports need
    this.lat = f.lat; this.lon = f.lon; this.disp = { lat: f.lat, lon: f.lon }; this.hdg = f.hdg;
    this.at = { t: 0, lat: f.lat, lon: f.lon };   // drawn position and the feed time it stands for (addFix)
    this.gh = 0; this.gLat = 99; this.gLon = 0; this.gOn = null; this.gx = false;   // ground height under it (terrain), where it was read, exact yet
    this.pt = pts.add({ position: C.Cartesian3.fromDegrees(f.lon, f.lat, 4), pixelSize: 6, color: COLOR[f.mode] || COLOR.bus,
      outlineColor: OUTLINE, outlineWidth: 1, scaleByDistance: SCALE, id: this });
  }
  /** Advance to wall-clock `now`; dt = ms since the last step. */
  step(now, dt) {
    const s = this.src, want = Math.min(Math.max(((this.gap ?? s.gap0) + s.every) * 1.1 + 1500, 3000), 120e3);
    this.delay = approach(this.delay, want, dt * 0.2);
    const t = now - s.lag.value - this.delay;
    if (!sample(this.fixes, t, tmp)) return;
    ease(this.disp, tmp, dt);
    this.hdg = tmp.hdg; this.at.t = t; this.at.lat = this.disp.lat; this.at.lon = this.disp.lon;
    if (Math.abs(this.disp.lat - this.lat) + Math.abs(this.disp.lon - this.lon) < 1e-8 && this.gOn === Terrain.on) return;   // parked: leave the buffer alone
    this.lat = this.disp.lat; this.lon = this.disp.lon;
    if (this.gOn !== Terrain.on || !this.gx || Math.abs(this.lat - this.gLat) + Math.abs(this.lon - this.gLon) > 5e-4) {   // the ground under it, every ~50 m
      this.gh = Terrain.near(this.lat, this.lon, 4); this.gx = Terrain.exact; this.gLat = this.lat; this.gLon = this.lon; this.gOn = Terrain.on;
    }
    this.pt.position = C.Cartesian3.fromDegrees(this.lon, this.lat, this.gh + 4, undefined, pos);
  }
  drop() { pts.remove(this.pt); vehicles.delete(this.id); }
  age() { return this.lastT ? (Date.now() - this.src.lag.value - this.lastT) / 1000 : 0; }
  tip() {
    const i = this.info, m = MODES[i.mode]?.[0] || 'Vehicle';
    return `${m} ${i.line}${i.dest ? ' → ' + i.dest : ''} · ${this.src.name}`;
  }
  cardHtml() {
    const i = this.info, [m, c] = MODES[i.mode] || ['Vehicle', '#fff'];
    const spd = i.spd != null ? fmt(i.spd * MPS_KMH) + ' km/h' : '';
    return `<div class="k" style="--c:${c}">${esc(m)} · ${esc(this.src.name)}</div><h2>${esc(i.line || m)}${i.dest ? ' → ' + esc(i.dest) : ''}</h2><dl>`
      + (i.lineName && i.lineName !== i.line ? row('Line', i.lineName) : '') + (i.vehicle ? row('Vehicle', i.vehicle) : '')
      + (i.operator && i.operator !== this.src.name ? row('Operator', i.operator) : '') + (i.status ? row('Now', i.status) : '')
      + (i.delay != null ? row('Schedule', lateness(i.delay)) : '') + (spd ? row('Speed', spd) : '')
      + (this.hdg != null ? row('Heading', Math.round(this.hdg) + '°') : '')
      + `<dt>Last report</dt><dd data-tr-age>${esc(Math.max(0, Math.round(this.age())) + ' s ago')}</dd></dl>`
      + `<div class="note" style="margin-top:8px">Drawn about ${Math.round(this.delay / 1000)} s behind live, moving between its real reports. ${esc(this.src.credit)}</div>`;
  }
  afterCard(card) {   // keep "last report" ticking while this card is open
    const id = setInterval(() => {
      const el = card.querySelector('[data-tr-age]');
      if (!el || state.selected !== this || !card.classList.contains('show')) return clearInterval(id);
      el.textContent = Math.max(0, Math.round(this.age())) + ' s ago';
    }, 1000);
  }
}

/** Which feeds should run: layer on, tab visible, camera under 400 km and over (or within 150 km of) the area. */
function evaluate() {
  const want = new Set(), c = camera.positionCartographic;
  if (Transit.layer.on && !document.hidden && c && c.height < MAX_H) {
    const lat = C.Math.toDegrees(c.latitude), lon = C.Math.toDegrees(c.longitude);
    for (const a of AREAS) if (inArea(a, lat, lon)) want.add(a.src);
  }
  for (const s of Object.values(SOURCES)) want.has(s) ? start(s) : stop(s);
}
function prune(now) {
  for (const v of vehicles.values()) {
    const f = v.fixes[v.fixes.length - 1];
    if (f && now - v.src.lag.value - f.t > v.src.stale) v.drop();
  }
  count();
}
document.addEventListener('visibilitychange', evaluate);

let lastCheck = 0, lastMove = 0;
export const Transit = {
  layer: { id: 'transit', group: 'Earth', name: 'Live transit (Boston · Helsinki · Norway · Austin · Minneapolis)', color: '#3ee08f', on: false },
  vehicles, sources: SOURCES,
  /** Show or hide; starts or stops the feeds (nothing is fetched while off). */
  apply(on = this.layer.on) {
    this.layer.on = on; pts.show = on;
    if (!on) { for (const s of Object.values(SOURCES)) stop(s); pts.removeAll(); vehicles.clear(); count(); }
    else evaluate();
  },
  /** Before each render: which feeds to run (once a second) and where every vehicle is now. */
  update(now = Date.now()) {
    if (!this.layer.on) return;
    if (now - lastCheck > 1000) { lastCheck = now; evaluate(); prune(now); }
    if (!vehicles.size) { lastMove = now; return; }
    if (camHeight() > 80e3 && now - lastMove < 250) return;   // from high up 4 moves a second look the same
    const dt = lastMove ? Math.min(now - lastMove, 1000) : 0;
    lastMove = now;
    for (const v of vehicles.values()) v.step(now, dt);
  },
  /** For the console and tests: vehicles per area and mode. */
  stats() {
    const out = {};
    for (const v of vehicles.values()) { const o = out[v.src.name] || (out[v.src.name] = { total: 0 }); o.total++; o[v.info.mode] = (o[v.info.mode] || 0) + 1; }
    return out;
  },
};
