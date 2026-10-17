// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Live transit feeds, shared by the globe and the 2D map: which operators, where, how often, and the loops that run
// them (polling over fetch, HSL's MQTT stream over a WebSocket). No DOM: fetch and WebSocket are injected or global, so
// Node runs the same code in tests. Parsing and the motion model: core/transit.js and core/gtfsrt.js.
import { parseMbta, parseEntur, parseHfp, enturQuery, mqtt, fromGtfsRt, lagMeter, inArea, addFix, sample, ease, approach } from './transit.js';
import { parseVehiclePositions } from './gtfsrt.js';
import { stamp, rep } from './liveprov.js';

/** Modes: [name, colour]. */
export const TRANSIT_MODES = Object.freeze({ bus: ['Bus', '#ffcc4d'], tram: ['Tram', '#3ee08f'], lightrail: ['Light rail', '#3ee08f'], metro: ['Metro', '#ff5e7a'], rail: ['Train', '#b18cff'], ferry: ['Ferry', '#4f9dff'] });
// the GTFS-RT feeds carry route ids only: the lines that aren't buses (Metro Transit's METRO lines, CapMetro's train)
export const METRO_TRANSIT_ROUTES = Object.freeze({ 901: ['lightrail', 'METRO Blue Line', 'Blue'], 902: ['lightrail', 'METRO Green Line', 'Green'], 888: ['rail', 'Northstar commuter rail', 'Northstar'],
  903: ['bus', 'METRO Red Line (bus rapid transit)', 'Red'], 904: ['bus', 'METRO Orange Line (bus rapid transit)', 'Orange'], 905: ['bus', 'METRO Gold Line (bus rapid transit)', 'Gold'],
  921: ['bus', 'METRO A Line (rapid bus)', 'A'], 922: ['bus', 'METRO B Line (rapid bus)', 'B'], 923: ['bus', 'METRO C Line (rapid bus)', 'C'], 924: ['bus', 'METRO D Line (rapid bus)', 'D'], 925: ['bus', 'METRO E Line (rapid bus)', 'E'] });
export const CAPMETRO_ROUTES = Object.freeze({ 550: ['rail', 'MetroRail Red Line', 'Red Line'], 801: ['bus', 'MetroRapid 801'], 803: ['bus', 'MetroRapid 803'] });

export const MBTA_URL = 'https://api-v3.mbta.com/vehicles?fields[vehicle]=latitude,longitude,bearing,speed,current_status,label,updated_at'
  + '&include=route,trip&fields[route]=type,short_name,long_name,color&fields[trip]=headsign';
export const ENTUR_URL = 'https://api.entur.io/realtime/v2/vehicles/graphql';
export const HSL_URL = 'wss://mqtt.hsl.fi:443/';
/** HSL's vehicles as one GTFS-RT file (the MCP server's one-shot answers; route ids only: core/transit.js hslRoute). */
export const HSL_PB = 'https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl';
export const METRO_TRANSIT_PB = 'https://svc.metrotransit.org/mtgtfs/vehiclepositions.pb';
/** CapMetro's file moves: this record names the current one (blobId). */
export const CAPMETRO_VIEW = 'https://data.texas.gov/api/views/eiei-9rpf.json';
export const capmetroFile = blobId => (/^[\w-]+$/.test(blobId || '') ? `https://data.texas.gov/api/views/eiei-9rpf/files/${blobId}?filename=vehiclepositions.pb` : null);
const HFP = '/hfp/v2/journey/ongoing/vp/';
/** HSL: every vehicle at first (a 2 s sweep), then only messages whose position moved in the 3rd geohash digit or above. */
export const HFP_ALL = Object.freeze([HFP + '#']), HFP_MOVED = Object.freeze([0, 1, 2, 3].map(l => HFP + '+/+/+/+/+/+/+/+/' + l + '/#'));

/** Entur's box round a view centre: wider the higher the view (camera height, or the 2D map's equivalent), 60-250 km. */
export function enturBox(lat, lon, height) {
  const dLat = Math.min(Math.max(1.2 * height, 60e3), 250e3) / 111e3, dLon = dLat / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(x => +x.toFixed(3));
}

async function getJSON(f, url, init, signal) {
  const r = await f(url, { ...init, signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const gtfsrt = (url, opts) => async ({ fetch: f, signal }) => {
  const r = await f(typeof url === 'function' ? await url(f, signal) : url, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return fromGtfsRt(parseVehiclePositions(new Uint8Array(await r.arrayBuffer())), opts);
};

/**
 * The sources. `every`: poll period (0 = a stream); `gap0`: report interval assumed before a vehicle's own is known;
 * `stale`: drop a vehicle whose last report is older than this (a stream never says a vehicle has gone).
 * `load({ fetch, signal, view: { lat, lon, height } })` → fixes.
 */
export function transitSources() {
  const s = {
    // keyless MBTA allows 20 requests a minute per address; one every 15 s leaves room for a second tab
    mbta: { name: 'MBTA', every: 15e3, gap0: 15e3, stale: 15 * 60e3, credit: 'MBTA v3 API (MassDOT developer licence)',
      load: ({ fetch: f, signal }) => getJSON(f, MBTA_URL, {}, signal).then(parseMbta) },
    // Entur covers every Norwegian operator; ask for a box round the view
    entur: { name: 'Entur', every: 15e3, gap0: 15e3, stale: 4 * 60e3, credit: 'Entur (NLOD 2.0)',
      load: ({ fetch: f, signal, view }) => getJSON(f, ENTUR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'openoverwatch-globe' },
        body: JSON.stringify({ query: enturQuery(...enturBox(view.lat, view.lon, view.height)) }) }, signal).then(parseEntur) },
    hsl: { name: 'HSL', every: 0, gap0: 8e3, stale: 5 * 60e3, credit: 'HSL high-frequency positioning (CC BY 4.0)' },
    // CapMetro's vehicles report every few seconds (the file is refreshed about every 15 s); Metro Transit's every ~30 s
    capmetro: { name: 'CapMetro', every: 15e3, gap0: 15e3, stale: 10 * 60e3, credit: 'CapMetro GTFS-RT via the Texas Open Data Portal',
      load: gtfsrt(async (f, signal) => {   // the download link redirects without CORS: ask for the current file, then read it
        const url = capmetroFile((await getJSON(f, CAPMETRO_VIEW, {}, signal)).blobId);
        if (!url) throw new Error('CapMetro: no current file');
        return url;
      }, { prefix: 'capmetro', operator: 'CapMetro', routes: CAPMETRO_ROUTES }) },
    metrotransit: { name: 'Metro Transit', every: 15e3, gap0: 30e3, stale: 10 * 60e3, credit: 'Metro Transit GTFS-RT (Metropolitan Council)',
      load: gtfsrt(METRO_TRANSIT_PB, { prefix: 'mt', operator: 'Metro Transit', routes: METRO_TRANSIT_ROUTES }) },
  };
  for (const [id, x] of Object.entries(s)) Object.assign(x, { id, lag: lagMeter(x.every ? 1 : 15e3), running: false, fails: 0, stop: null });   // a poll is one batch
  return s;
}
/** Where each source runs: circles { lat, lon, r } or boxes { box: [s, w, n, e] } (Norway as three, so Sweden doesn't poll it). */
export const TRANSIT_AREAS = Object.freeze([
  { name: 'Boston', lat: 42.36, lon: -71.06, r: 150e3, src: 'mbta' },
  { name: 'Helsinki', lat: 60.17, lon: 24.94, r: 150e3, src: 'hsl' },
  { name: 'Austin', lat: 30.27, lon: -97.74, r: 150e3, src: 'capmetro' },
  { name: 'Minneapolis', lat: 44.98, lon: -93.20, r: 150e3, src: 'metrotransit' },
  { name: 'Norway', box: [57.8, 4.3, 63.5, 12.7], src: 'entur' },
  { name: 'Norway', box: [63.5, 8.3, 67.0, 15.5], src: 'entur' },
  { name: 'Norway', box: [67.0, 11.5, 71.4, 31.3], src: 'entur' },
]);
/** The source ids that should run for a view centre. */
export const sourcesAt = (lat, lon) => new Set(TRANSIT_AREAS.filter(a => inArea(a, lat, lon)).map(a => a.src));

/**
 * Run a polled source: now, then every `every` ms (longer after failures; MBTA answers 429 past its limit). Returns stop().
 * onFixes(fixes) gets each whole batch; view() gives the current view for sources that ask by area.
 * @param {any} s
 * @param {{ fetch?: typeof globalThis.fetch, onFixes: (fixes: any[]) => void, onError?: (e: Error) => void, view?: () => any, setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (t: any) => void }} opts
 */
export function startPoll(s, { fetch: f = globalThis.fetch, onFixes, onError = () => {}, view = () => null, setTimer = setTimeout, clearTimer = clearTimeout }) {
  /** @type {any} */ let timer = 0;
  let ctl = null, dead = false;   // `dead`, not s.running: a quick stop + start must not leave two loops
  const run = async () => {
    ctl = new AbortController(); const kill = setTimer(() => ctl.abort(), 20e3);
    try { const fixes = await s.load({ fetch: f, signal: ctl.signal, view: view() }); if (!dead) { onFixes(fixes); s.fails = 0; } }
    catch (e) { if (!dead) { s.fails++; onError(e); } }
    finally { clearTimer(kill); if (!dead) timer = setTimer(run, s.every * (1 + Math.min(s.fails, 4))); }
  };
  run();
  return () => { dead = true; clearTimer(timer); ctl?.abort(); };
}

/** HSL over MQTT on a WebSocket. Every vehicle reports each second (~500 messages/s at night, more by day), too much for
 *  a phone: after a 2 s full sweep to find everyone, only messages whose position changed by ~100 m come through.
 *  @param {any} s
 *  @param {{ WebSocket?: any, onFixes: (fixes: any[]) => void, onError?: (e: Error) => void, clientId?: string }} opts */
export function startHsl(s, { WebSocket: WS = globalThis.WebSocket, onFixes, onError = () => {}, clientId = 'oo-' + Math.random().toString(36).slice(2, 12) }) {
  /** @type {ReturnType<typeof setTimeout>} */ let sweep;
  /** @type {ReturnType<typeof setInterval>} */ let ping;
  /** @type {ReturnType<typeof setTimeout>} */ let retry;
  let ws = null, live = true, read;
  const open = () => {
    read = mqtt.reader();
    ws = new WS(HSL_URL, 'mqtt'); ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws.send(mqtt.connect(clientId, 60));
    ws.onmessage = e => {
      if (!live) return;   // closing: a late message must not bring vehicles back
      for (const p of read(new Uint8Array(e.data))) {
        if (p.type === 3) { const fx = parseHfp(p.topic, p.payload); if (fx) onFixes([fx]); }
        else if (p.type === 2 && p.code === 0) {
          s.fails = 0; ws.send(mqtt.subscribe(1, HFP_ALL));
          sweep = setTimeout(() => { if (ws?.readyState === 1) { ws.send(mqtt.subscribe(2, HFP_MOVED)); ws.send(mqtt.unsubscribe(3, HFP_ALL)); } }, 2000);
          ping = setInterval(() => ws?.readyState === 1 && ws.send(mqtt.ping()), 30e3);
        }
      }
    };
    ws.onclose = () => {
      clearInterval(ping); clearTimeout(sweep); ws = null;
      if (live) { s.fails++; onError(new Error('HSL stream closed')); retry = setTimeout(open, 3000 * Math.min(2 ** s.fails, 40)); }
    };
  };
  open();
  return () => { live = false; clearTimeout(retry); clearTimeout(sweep); clearInterval(ping); if (ws) { try { ws.send(mqtt.disconnect()); } catch (e) { /* closing anyway */ } ws.close(); } };
}

/** Start a source (poll or stream) once; opts as startPoll / startHsl. */
export function startSource(s, opts) { if (s.running) return; s.running = true; s.fails = 0; s.stop = s.every ? startPoll(s, opts) : startHsl(s, opts); }
export function stopSource(s) { if (!s.running) return false; s.running = false; s.stop(); s.stop = null; return true; }

/**
 * The vehicles of every running source, each drawn a little behind live between two real reports (so dots glide instead
 * of hopping). hooks: add(v) when a vehicle appears, drop(v) when it goes. A vehicle: { kind: 'transit', id, src, info
 * (its latest fix: line, dest, mode...), fixes, gap, delay (ms behind live), lat, lon, hdg, at }.
 */
export function createFleet(hooks = {}, vehicles = new Map()) {   // vehicles: the Map to keep them in (a view's own set)
  const tmp = { lat: 0, lon: 0, hdg: null };
  const drop = v => { vehicles.delete(v.id); hooks.drop?.(v); };
  return {
    vehicles,
    /** New reports. A poll is the whole picture, so a vehicle missing from it has gone (or left the box); a stream only adds. */
    ingest(s, fixes, whole, now = Date.now()) {
      const seen = whole ? new Set() : null;
      for (const f of fixes) {
        const age = now - f.t;
        s.lag.note(age, now);
        if (age - s.lag.value > s.stale) continue;   // Entur keeps parked buses for an hour
        let v = vehicles.get(f.id);
        if (!v) {
          v = { kind: 'transit', id: f.id, src: s, info: f, fixes: [], gap: null, delay: (s.gap0 + s.every) * 1.1, lat: f.lat, lon: f.lon, disp: { lat: f.lat, lon: f.lon }, hdg: f.hdg,
            at: { t: 0, lat: f.lat, lon: f.lon } };   // drawn position and the feed time it stands for (addFix)
          vehicles.set(f.id, v); hooks.add?.(v);
        }
        if (addFix(v, f, v.at)) { v.info = f; stamp(v, 'transit', [rep(s.id, { name: s.name, dataAt: f.t })]); }   // provenance: the vehicle's own report time
        seen?.add(f.id);
      }
      if (whole) for (const v of [...vehicles.values()]) if (v.src === s && !seen.has(v.id)) drop(v);
    },
    /** Advance one vehicle to wall-clock `now` (dt = ms since its last step); true if it moved. */
    step(v, now, dt) {
      const s = v.src, want = Math.min(Math.max(((v.gap ?? s.gap0) + s.every) * 1.1 + 1500, 3000), 120e3);
      v.delay = approach(v.delay, want, dt * 0.2);
      const t = now - s.lag.value - v.delay;
      if (!sample(v.fixes, t, tmp)) return false;
      ease(v.disp, tmp, dt);
      v.hdg = tmp.hdg; v.at.t = t; v.at.lat = v.disp.lat; v.at.lon = v.disp.lon;
      if (Math.abs(v.disp.lat - v.lat) + Math.abs(v.disp.lon - v.lon) < 1e-8) return false;   // parked
      v.lat = v.disp.lat; v.lon = v.disp.lon;
      return true;
    },
    /** Drop the vehicles whose last report has gone stale. */
    prune(now = Date.now()) { for (const v of [...vehicles.values()]) { const f = v.fixes[v.fixes.length - 1]; if (f && now - v.src.lag.value - f.t > v.src.stale) drop(v); } },
    dropSource(s) { for (const v of [...vehicles.values()]) if (v.src === s) drop(v); },
    clear() { for (const v of [...vehicles.values()]) drop(v); },
    /** Seconds since a vehicle's last report, on the feed's clock. */
    age: (v, now = Date.now()) => v.lastT ? (now - v.src.lag.value - v.lastT) / 1000 : 0,
    /** Vehicles per source and mode (the console, tests). */
    stats() { const out = {}; for (const v of vehicles.values()) { const o = out[v.src.name] || (out[v.src.name] = { total: 0 }); o.total++; o[v.info.mode] = (o[v.info.mode] || 0) + 1; } return out; },
  };
}
/** A vehicle in one line: "Bus 39 → Forest Hills · MBTA". */
export function transitTip(v) {
  const i = v.info, m = TRANSIT_MODES[i.mode]?.[0] || 'Vehicle';
  return `${m} ${i.line}${i.dest ? ' → ' + i.dest : ''} · ${v.src.name}`;
}
/** A vehicle's card rows: [[label, value]] (plain text; the views escape them). */
export function transitRows(v, age) {
  const i = v.info, rows = [];
  if (i.lineName && i.lineName !== i.line) rows.push(['Line', i.lineName]);
  if (i.vehicle) rows.push(['Vehicle', i.vehicle]);
  if (i.operator && i.operator !== v.src.name) rows.push(['Operator', i.operator]);
  if (i.status) rows.push(['Now', i.status]);
  if (i.delay != null) rows.push(['Schedule', lateness(i.delay)]);
  if (i.spd != null) rows.push(['Speed', Math.round(i.spd * 3.6) + ' km/h']);
  if (v.hdg != null) rows.push(['Heading', Math.round(v.hdg) + '°']);
  rows.push(['Last report', Math.max(0, Math.round(age)) + ' s ago']);
  return rows;
}

/** For a card: "3 min late", "on time". */
export function lateness(sec) {
  if (sec == null) return '';
  const m = Math.round(Math.abs(sec) / 60);
  return m === 0 ? 'on time' : `${m} min ${sec > 0 ? 'late' : 'early'}`;
}
