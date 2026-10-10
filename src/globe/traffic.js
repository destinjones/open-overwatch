// Traffic: simulated cars on real roads, close to the ground (below ~6 km). No open feed says where individual cars are
// (that would track people), so these cars are simulated, and say so: OpenStreetMap's roads around the view (from
// OpenFreeMap's vector tiles), cars that follow each other and stop at lights where busy roads meet, as many as the road
// type and the local time suggest. Where a city publishes measured speeds or counts, the cars drive at those and the road
// is coloured by them: New York City DOT's link speeds and Fintraffic's roadside sensors (both keyless, with CORS). The
// simulation is core/traffic.js, the roads core/roadtiles.js (both tested); this file loads tiles and readings, and draws.
import { C, esc, fmt, toast, PHONE, getJSON } from './env.js';
import { viewer, scene, camera, camHeight } from './viewer.js';
import { setCount } from './layers.js';
import { state } from './state.js';
import { Time } from './time.js';
import { Country } from './country.js';
import { decodeTile, tileAt } from '../core/mvt.js';
import { prepareTile, joinTiles } from '../core/roadtiles.js';
import { buildGraph, Sim, busyness, localTime, matchSpeeds, parseNyc, parseTms, laneOffset, drivesLeft, along, dist } from '../core/traffic.js';

const MAX_H = 6000, Z = 14, CAP = PHONE ? 600 : 2500, MAX_TILES = PHONE ? 4 : 9, KEEP_TILES = 24;
const NEAR = 1400, FAR = 1100;   // m from the camera: car pictures nearer than NEAR, glowing dots farther than FAR
const COLOR = '#f5c26b';
const bbs = scene.primitives.add(new C.BillboardCollection());
const pts = scene.primitives.add(new C.PointPrimitiveCollection());
const lines = scene.primitives.add(new C.PolylineCollection());
bbs.show = pts.show = lines.show = false;

// ---- the cars' pictures: top-down, nose up, drawn once (a few paints, a taxi yellow, two trucks) -------------------
const PAINTS = [['#eceff3', 24], ['#1c2026', 17], ['#a9b2bc', 17], ['#5d6773', 13], ['#b3202d', 8], ['#2a58b8', 8], ['#7a2236', 4], ['#3f6e4b', 4], ['#d8d0bf', 5]];
function sprite(body, truck, brake) {
  const w = truck ? 40 : 32, h = truck ? 148 : 74, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), box = (x, y, ww, hh, r) => { g.beginPath(); g.roundRect(x, y, ww, hh, r); };
  g.fillStyle = 'rgba(0,0,0,.38)'; box(1, 4, w - 2, h - 4, 9); g.fill();   // shadow
  if (truck) {
    g.fillStyle = '#e4e7ea'; box(3, 34, w - 6, h - 37, 3); g.fill(); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1.5; g.stroke();   // the box
    g.fillStyle = body; box(4, 1, w - 8, 31, 6); g.fill();   // the cab
    g.fillStyle = 'rgba(18,26,36,.9)'; g.fillRect(7, 7, w - 14, 8);
    g.fillStyle = '#fff6d8'; g.fillRect(7, 1, 6, 3); g.fillRect(w - 13, 1, 6, 3);
    tail(g, w, h - 6, brake);
    return cv.toDataURL();
  }
  g.fillStyle = body; box(3, 1, w - 6, h - 4, 10); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1; g.stroke();
  g.fillStyle = 'rgba(18,26,36,.88)';
  g.beginPath(); g.moveTo(7, 27); g.lineTo(w - 7, 27); g.lineTo(w - 9, 17); g.lineTo(9, 17); g.closePath(); g.fill();   // windscreen
  g.beginPath(); g.moveTo(8, 52); g.lineTo(w - 8, 52); g.lineTo(w - 10, 60); g.lineTo(10, 60); g.closePath(); g.fill();   // rear window
  g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(9, 29, w - 18, 21);   // roof
  g.fillStyle = body; g.fillRect(1, 21, 3, 4); g.fillRect(w - 4, 21, 3, 4);   // mirrors
  g.fillStyle = '#fff6d8'; g.fillRect(6, 2, 6, 3); g.fillRect(w - 12, 2, 6, 3);   // headlights
  tail(g, w, h - 7, brake);
  return cv.toDataURL();
}
/** Tail lights: dim red, or bright with a glow while braking or stopped. */
function tail(g, w, y, brake) {
  if (brake) { g.shadowColor = '#ff2030'; g.shadowBlur = 6; g.fillStyle = '#ff5a5a'; } else g.fillStyle = '#a3141f';
  g.fillRect(5, y, 6, 3); g.fillRect(w - 11, y, 6, 3); g.shadowBlur = 0;
}
let LOOKS = null;   // drawn on first use (no canvas work for people who never turn traffic on)
function looks() {
  if (!LOOKS) {
    const total = PAINTS.reduce((a, [, w]) => a + w, 0), cars = [];
    for (const [c, w] of PAINTS) for (let k = 0; k < Math.round(w / total * 100); k++) cars.push(c);
    const img = new Map(), of = (c, t) => { const k = c + t; if (!img.has(k)) img.set(k, [sprite(c, t, false), sprite(c, t, true)]); return img.get(k); };
    LOOKS = { car: cars.map(c => of(c, false)), taxi: of('#f2c230', false), truck: [of('#eceff3', true), of('#b3202d', true), of('#2a58b8', true)] };   // each: [driving, braking]
  }
  return LOOKS;
}
const NYC_CAB = [40.70, -74.02, 40.82, -73.93];   // Manhattan below 120th St: a quarter of the cars are yellow cabs
const inBox = (b, lat, lon) => lat > b[0] && lat < b[2] && lon > b[1] && lon < b[3];

// ---- cars and measured roads describe themselves (hover tips, cards) ----------------------------------------------
const CLASS = { motorway: 'Motorway', motorway_link: 'Motorway ramp', trunk: 'Major road', trunk_link: 'Major road ramp', primary: 'Main road', primary_link: 'Main road turn',
  secondary: 'Secondary road', secondary_link: 'Secondary road turn', tertiary: 'Local through road', tertiary_link: 'Local road turn', unclassified: 'Minor road', residential: 'Residential street', living_street: 'Living street' };
const SRC = { nyc: ['NYC DOT', 'New York City DOT traffic speed sensors (the city publishes them a few hours late)'], fintraffic: ['Fintraffic', 'a Fintraffic roadside sensor, 5-minute average (digitraffic.fi, CC BY 4.0)'] };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ago = ms => ms < 90e3 ? 'just now' : ms < 3600e3 ? Math.round(ms / 60e3) + ' min ago' : (ms / 3600e3).toFixed(1).replace(/\.0$/, '') + ' h ago';
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const roadName = e => e.name || CLASS[e.cls] || 'Road';
const limit = e => `${fmt(e.speed)} km/h`;
function measText(e) {
  const m = e.meas; if (!m) return '';
  return `${fmt(m.kmh)} km/h${m.flow != null ? ` · ${fmt(m.flow)} vehicles an hour` : ''}, measured by ${SRC[m.src][0]} ${ago(Date.now() - m.t)}`;
}
const CarProto = {
  get lat() { return along(this.e, this.s).lat; },
  get lon() { return along(this.e, this.s).lon; },
  tip() { return `Simulated car · ${roadName(this.e)} · ${fmt(this.v * 3.6)} km/h`; },
  cardHtml() {
    const e = this.e, lt = localTime(Time.nowMs(), this.lon), h = Math.floor(lt.hour), day = DAYS[new Date(Time.nowMs() + this.lon / 15 * 3600e3).getUTCDay()];
    const here = e.meas ? measText(e) : `typical for a ${(CLASS[e.cls] || 'road').toLowerCase()} on ${day} around ${(h % 12) || 12} ${h < 12 ? 'am' : 'pm'} local time (no live readings here)`;
    return `<div class="k" style="--c:${COLOR}">Simulated · not a real vehicle</div><h2>${this.truck ? 'Truck' : 'Car'} on ${esc(roadName(e))}</h2><dl>`
      + `<dt>Speed</dt><dd data-car-v>${fmt(this.v * 3.6)} km/h</dd><dt>Road</dt><dd>${esc(CLASS[e.cls] || e.cls)} · limit ${limit(e)}${e.lanes > 1 ? ` · ${e.lanes} lanes` : ''}${e.oneway ? ' · one way' : ''}</dd>`
      + `<dt>Traffic here</dt><dd>${esc(here)}</dd></dl>`
      + `<div class="note" style="margin-top:8px">No open feed shows where individual cars are (it would track people), so this one is simulated: it drives OpenStreetMap's roads, how many cars there are follows the road type and the local time, and it stops at lights where busy roads meet (the map has no signals, so those are a guess). Where a city publishes measured speeds or counts (New York City DOT, Fintraffic in Finland) the cars drive at those. Roads: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.</div>`;
  },
  afterCard(card) {   // keep the speed ticking while the card is open
    const id = setInterval(() => {
      const el = card.querySelector('[data-car-v]');
      if (!el || state.selected !== this || !card.classList.contains('show') || !this.e) return clearInterval(id);
      el.textContent = fmt(this.v * 3.6) + ' km/h';
    }, 500);
  },
};
const RoadProto = {
  get lat() { return along(this.e, this.e.len / 2).lat; },
  get lon() { return along(this.e, this.e.len / 2).lon; },
  tip() { return `${roadName(this.e)} · ${fmt(this.e.meas.kmh)} km/h measured`; },
  cardHtml() {
    const e = this.e, m = e.meas, [who, how] = SRC[m.src];
    return `<div class="k" style="--c:${speedColor(m.kmh / e.speed).toCssHexString()}">Measured traffic · ${esc(who)}</div><h2>${esc(roadName(e))}</h2><dl>`
      + `<dt>Speed</dt><dd>${fmt(m.kmh)} km/h (limit ${limit(e)})</dd>` + (m.flow != null ? `<dt>Flow</dt><dd>${fmt(m.flow)} vehicles an hour this way</dd>` : '')
      + `<dt>Measured</dt><dd>${esc(clock(m.t))} (${esc(ago(Date.now() - m.t))})</dd>` + (m.name ? `<dt>Sensor</dt><dd>${esc(m.name)}</dd>` : '') + '</dl>'
      + `<div class="note" style="margin-top:8px">From ${esc(how)}. The simulated cars on this stretch drive at this speed.</div>`;
  },
};

// ---- the simulation and drawing ------------------------------------------------------------------------------------
let left = false, gv = 0, centre = null, R = 1000;
const sim = new Sim({
  proto: CarProto,
  onAdd(c) {
    const lk = looks(), cab = !c.truck && centre && inBox(NYC_CAB, centre.lat, centre.lon) && c.look % 100 < 25;
    c.imgs = c.truck ? lk.truck[c.look % lk.truck.length] : cab ? lk.taxi : lk.car[c.look % lk.car.length];
    c.bb = bbs.add({ image: c.imgs[0], sizeInMeters: true, width: c.truck ? 2.5 : 2.0, height: c.truck ? 8.5 : 4.6, alignedAxis: C.Cartesian3.UNIT_Z, id: c, show: false,
      color: new C.Color(1, 1, 1, 0), scaleByDistance: CAR_SCALE });
    c.pt = pts.add({ pixelSize: 3, color: DOT[0], id: c, show: false, scaleByDistance: DOT_SCALE });
    c.dot = 0; c.segE = null; c.solid = false; c.braking = false; c.avg = null; c.pv = 0;
  },
  onRemove(c) { bbs.remove(c.bb); pts.remove(c.pt); c.bb = c.pt = null; },
});
const DOT = ['#ffe7b0', '#ffb44d', '#ff4d5e'].map(s => C.Color.fromCssColorString(s)), DOT_SCALE = new C.NearFarScalar(1000, 1.4, 8000, 0.7);
const CAR_SCALE = new C.NearFarScalar(250, 1, 1400, 2.2);   // true size close up, a little larger farther out so cars still read as cars
const speedColor = r => C.Color.fromCssColorString(r >= 0.7 ? '#3ee08f' : r >= 0.45 ? '#ffd45c' : r >= 0.25 ? '#ff9f5c' : '#ff4d5e');

/** Each edge's points on the globe (ECEF), unit directions and unit "right" vectors per segment; redone when heights change. */
const v1 = new C.Cartesian3();
function geo(e) {
  if (e.G && e.G.gv === gv) return e.G;
  const n = e.pts.length, P = new Float64Array(n * 3), U = new Float64Array(n * 3), Rt = new Float64Array(n * 3), h = groundAt(e.pts[0]) + 0.9;
  for (let k = 0; k < n; k++) { C.Cartesian3.fromDegrees(e.pts[k].lon, e.pts[k].lat, h, undefined, v1); P[k * 3] = v1.x; P[k * 3 + 1] = v1.y; P[k * 3 + 2] = v1.z; }
  for (let k = 0; k < n - 1; k++) {
    const j = k * 3, dx = P[j + 3] - P[j], dy = P[j + 4] - P[j + 1], dz = P[j + 5] - P[j + 2], l = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / l, uy = dy / l, uz = dz / l, m = Math.hypot(P[j], P[j + 1], P[j + 2]), ox = P[j] / m, oy = P[j + 1] / m, oz = P[j + 2] / m;
    let rx = uy * oz - uz * oy, ry = uz * ox - ux * oz, rz = ux * oy - uy * ox; const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    U[j] = ux; U[j + 1] = uy; U[j + 2] = uz; Rt[j] = rx; Rt[j + 1] = ry; Rt[j + 2] = rz;
  }
  if (n > 1) for (let c = 0; c < 3; c++) { U[(n - 1) * 3 + c] = U[(n - 2) * 3 + c]; Rt[(n - 1) * 3 + c] = Rt[(n - 2) * 3 + c]; }
  return (e.G = { gv, P, U, Rt });
}

const pos = new C.Cartesian3(), axis = new C.Cartesian3();
function draw(dt) {
  const cam = camera.positionWC, N2 = NEAR * NEAR, F2 = FAR * FAR, now = sim.clock, k8 = Math.min(1, dt / 8);
  for (const c of sim.cars) {
    c.avg = c.avg == null ? c.v : c.avg + (c.v - c.avg) * k8;   // the dots show the last ~8 s, not every touch of the brakes
    const e = c.e, G = geo(e), cum = e.cum;
    let i = c.i; while (i < cum.length - 1 && cum[i] < c.s) i++; c.i = i;
    const a = (i - 1) * 3, k = Math.min(1, Math.max(0, (c.s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1))), off = laneOffset(e, c.lane, left);
    pos.x = G.P[a] + (G.P[a + 3] - G.P[a]) * k + G.Rt[a] * off;
    pos.y = G.P[a + 1] + (G.P[a + 4] - G.P[a + 1]) * k + G.Rt[a + 1] * off;
    pos.z = G.P[a + 2] + (G.P[a + 5] - G.P[a + 2]) * k + G.Rt[a + 2] * off;
    const d2 = (pos.x - cam.x) ** 2 + (pos.y - cam.y) ** 2 + (pos.z - cam.z) ** 2;
    if (d2 < N2) {
      const b = c.bb; if (!b.show) b.show = true;
      b.position = pos;
      if (c.segE !== e || c.segI !== i) { c.segE = e; c.segI = i; axis.x = G.U[a]; axis.y = G.U[a + 1]; axis.z = G.U[a + 2]; b.alignedAxis = axis; }   // nose along the road
      const brake = c.v < 0.8 || (dt > 0 && (c.pv - c.v) / dt > 1.2); c.pv = c.v;
      if (brake !== c.braking) { c.braking = brake; b.image = c.imgs[brake ? 1 : 0]; }
      const f = (now - c.born) / 0.8;   // fade in where a car (re)appears
      if (f < 1) { b.color = new C.Color(1, 1, 1, Math.max(0, f)); c.solid = false; } else if (!c.solid) { b.color = C.Color.WHITE; c.solid = true; }
    } else if (c.bb.show) c.bb.show = false;
    if (d2 > F2) {
      const p = c.pt; if (!p.show) p.show = true;
      p.position = pos;
      const r = c.avg / Math.max(1, e.speed / 3.6), dot = r >= 0.5 ? 0 : r >= 0.22 ? 1 : 2;
      if (dot !== c.dot) { c.dot = dot; p.color = DOT[dot]; }
    } else if (c.pt.show) c.pt.show = false;
  }
}

const LINE_MAT = ['#3ee08f', '#ffd45c', '#ff9f5c', '#ff4d5e'].map(s => C.Material.fromType('Color', { color: C.Color.fromCssColorString(s).withAlpha(0.9) }));
/** Measured roads as coloured lines beside the traffic (green flowing ... red crawling). */
function drawLines() {
  lines.removeAll();
  for (const e of sim.g.edges) {
    if (!e.meas) continue;
    const G = geo(e), off = laneOffset(e, e.lanes, left) + (e.oneway ? LANE : 0), positions = [], r = e.meas.kmh / e.speed;
    for (let k = 0; k < e.pts.length; k++) { const j = k * 3; positions.push(new C.Cartesian3(G.P[j] + G.Rt[j] * off, G.P[j + 1] + G.Rt[j + 1] * off, G.P[j + 2] + G.Rt[j + 2] * off)); }
    lines.add({ positions, width: 4, material: LINE_MAT[r >= 0.7 ? 0 : r >= 0.45 ? 1 : r >= 0.25 ? 2 : 3], id: Object.assign(Object.create(RoadProto), { kind: 'road', e }) });
  }
}
const LANE = 2.4;

// ---- ground height under Google's photoreal city (elsewhere the globe is the bare ellipsoid: 0) ---------------------
const ground = new Map();   // tile -> metres above the ellipsoid (a low quantile of samples: the street, not the roofs)
let groundAll = 0;
const tileKey = p => { const t = tileAt(p.lat, p.lon, Z); return t.x + '/' + t.y; };
function groundAt(p) { return state.photoreal ? ground.get(tileKey(p)) ?? groundAll : 0; }
function sampleGround() {
  if (!state.photoreal || !scene.sampleHeightSupported) return;
  for (const key of active) {
    const t = tiles.get(key), P = t?.prep?.pieces; if (ground.has(key) || !P?.length) continue;
    const hs = [];
    for (let k = 0; k < 10; k++) {   // a few road points in this tile (Google's tiles must be in view to answer)
      const g = P[Math.floor(Math.random() * P.length)].geometry, p = g[Math.floor(Math.random() * g.length)];
      let hgt; try { hgt = scene.sampleHeight(C.Cartographic.fromDegrees(p.lon, p.lat), [bbs, pts, lines]); } catch (e) { return; }
      if (Number.isFinite(hgt)) hs.push(hgt);
    }
    if (hs.length >= 4) { hs.sort((a, b) => a - b); ground.set(key, hs[Math.floor(hs.length * 0.25)]); groundAll = [...ground.values()].sort((a, b) => a - b)[ground.size >> 1]; gv++; drawLines(); }
    return;   // one tile a tick: each sample is a small render
  }
}

// ---- Cache Storage, for small things worth keeping a day (Fintraffic's sensor list) -------------------------------
const CACHE = 'oo3d-roads', TTL = 864e5;
async function cacheGet(key) {
  try { const r = await (await caches.open(CACHE)).match('/__roads/' + key); if (!r) return null; const j = await r.json(); return Date.now() - j.t < TTL ? j : null; } catch (e) { return null; }
}
async function cachePut(key, j) {
  try { await (await caches.open(CACHE)).put('/__roads/' + key, new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json' } })); } catch (e) { /* private mode: not kept */ }
}

// ---- roads: OpenFreeMap's vector tiles (z14: ~1.9 km squares at New York's latitude), nearest first, two at a time --
// A public CDN with no key and no request limit, and the browser keeps each tile (the URLs are versioned): unlike the
// volunteer-run Overpass servers, it doesn't mind a website full of visitors. Each tile is prepared once (roadtiles.js).
const TILEJSON = 'https://tiles.openfreemap.org/planet', WANT = ['transportation', 'transportation_name'];
const tiles = new Map();   // "x/y" -> { prep, used } | { loading } | { failed }
let template = null, templateAt = 0, active = [], inflight = 0, dirty = false, told = false, credited = false;
async function tileUrl(x, y) {
  if (!template || Date.now() - templateAt > 6 * 3600e3) {   // the TileJSON names this week's tile set
    const tj = await getJSON(TILEJSON, { timeout: 20000 }); if (!tj?.tiles?.[0]) throw new Error('no tile URL');
    template = tj.tiles[0]; templateAt = Date.now();
  }
  return template.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
}
async function loadTile(key) {
  const [x, y] = key.split('/').map(Number); inflight++; tiles.set(key, { loading: true });
  try {
    const r = await fetch(await tileUrl(x, y)); if (!r.ok) throw new Error('HTTP ' + r.status);
    const prep = prepareTile(decodeTile(new Uint8Array(await r.arrayBuffer()), WANT), Z, x, y);
    tiles.set(key, { prep, used: Date.now() }); dirty = true;
    if (!credited) { credited = true; viewer.creditDisplay.addStaticCredit(new C.Credit('Traffic: simulated cars on roads from OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors')); }
  } catch (e) {
    tiles.set(key, { failed: Date.now() }); console.warn('traffic roads', e.message);
    if (!told) { told = true; toast('Road data is unavailable right now: traffic will fill in as it retries', 4000); }
  } finally { inflight--; }
}
const tileLat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** Z))) * 180 / Math.PI;
/** The tiles a circle touches, nearest first (the one under the centre leads). */
function tilesFor(c, r) {
  const n = 2 ** Z, t = tileAt(c.lat, c.lon, Z), span = Math.ceil(r / (40075016.7 * Math.cos(c.lat * Math.PI / 180) / n)) + 1, out = [];
  for (let x = t.x - span; x <= t.x + span; x++) for (let y = t.y - span; y <= t.y + span; y++) {
    const q = { lat: Math.min(Math.max(c.lat, tileLat(y + 1)), tileLat(y)), lon: Math.min(Math.max(c.lon, x / n * 360 - 180), (x + 1) / n * 360 - 180) }, d = dist(c, q);
    if (d <= r) out.push([x + '/' + y, d]);
  }
  return out.sort((a, b) => a[1] - b[1]).slice(0, MAX_TILES).map(a => a[0]);
}
function rebuild() {
  const preps = [];
  for (const key of active) { const t = tiles.get(key); if (t?.prep) { t.used = Date.now(); preps.push(t.prep); } }
  const { ways, signals } = joinTiles(preps), g = buildGraph(ways, signals);
  measure(g.edges); sim.setGraph(g); drawLines();
}

// ---- measured speeds: New York City DOT (every 5 min over NYC) and Fintraffic (every 2 min over Finland) -----------
const NYC_BOX = [40.47, -74.28, 40.93, -73.67], FI_BOX = [59.6, 19.0, 70.2, 31.7];
const meas = { nyc: { links: [], at: 0 }, fi: { stations: null, points: [], at: 0, where: null } };
let measBusy = false, measCredit = new Set();
const digitraffic = url => fetch(url, { headers: { 'Digitraffic-User': 'OpenOverwatch/globe' } }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
async function loadNyc() {
  const q = new URLSearchParams({ $select: 'link_id,speed,data_as_of,link_name,borough,link_points', $order: 'data_as_of DESC', $limit: '600' });
  meas.nyc.links = parseNyc(await getJSON('https://data.cityofnewyork.us/resource/i4gi-tjb9.json?' + q, { timeout: 30000 }));
}
async function loadFi(c) {
  if (!meas.fi.stations) {
    let st = await cacheGet('tms-stations');
    if (!st) {
      const j = await digitraffic('https://tie.digitraffic.fi/api/tms/v1/stations');
      st = { t: Date.now(), f: (j.features || []).filter(f => f.properties?.collectionStatus === 'GATHERING' && f.properties.bearing != null)
        .map(f => ({ id: f.properties.id, geometry: f.geometry, properties: { id: f.properties.id, name: f.properties.name, bearing: f.properties.bearing } })) };
      cachePut('tms-stations', st);
    }
    meas.fi.stations = st.f;
  }
  const near = meas.fi.stations.map(f => [f, dist(c, { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] })])
    .filter(([, d]) => d < R + 2500).sort((a, b) => a[1] - b[1]).slice(0, 12).map(([f]) => f);
  const data = await Promise.all(near.map(f => digitraffic(`https://tie.digitraffic.fi/api/tms/v1/stations/${f.id}/data`).catch(() => null)));
  meas.fi.points = parseTms(near, data.filter(Boolean)); meas.fi.where = c;
}
/** Put the fresh readings on the roads (none while the time bar is away from now: they are readings of now). */
function measure(edges) {
  const now = Date.now(), live = Math.abs(Time.nowMs() - now) < 30 * 60e3;
  const fi = live ? meas.fi.points.filter(p => now - p.t < 20 * 60e3) : [], nyc = live ? meas.nyc.links.filter(l => now - l.t < 4 * 3600e3) : [];
  matchSpeeds(edges, fi, nyc);
  for (const [k, used, text] of [['nyc', nyc.length, 'Road speeds: NYC DOT'], ['fi', fi.length, 'Road speeds: Fintraffic / digitraffic.fi (CC BY 4.0)']])
    if (used && !measCredit.has(k)) { measCredit.add(k); viewer.creditDisplay.addStaticCredit(new C.Credit(text)); }
}
async function refreshMeasured(c) {
  if (measBusy) return;
  const now = Date.now(), nyc = inBox(NYC_BOX, c.lat, c.lon) && now - meas.nyc.at > 5 * 60e3;
  const fi = inBox(FI_BOX, c.lat, c.lon) && (now - meas.fi.at > 2 * 60e3 || (meas.fi.where && dist(meas.fi.where, c) > 1500));
  if (!nyc && !fi) return;
  measBusy = true;
  try {
    if (nyc) { meas.nyc.at = now; await loadNyc(); }
    if (fi) { meas.fi.at = now; await loadFi(c); }
    measure(sim.g.edges); sim.zone(centre, R, sim.busy); drawLines();
  } catch (e) { console.warn('traffic speeds', e.message); } finally { measBusy = false; }
}

// ---- once a second: where the circle is, which roads, how many cars ------------------------------------------------
let on = false, shown = false, lastCell = '', lastZone = null, lastR = 0, lastFrame = 0, wasPhoto = false, wasLive = true;
function reticle() {
  const p = camera.pickEllipsoid(new C.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), C.Ellipsoid.WGS84);
  const g = C.Cartographic.fromCartesian(p || camera.positionWC), c = { lat: C.Math.toDegrees(g.latitude), lon: C.Math.toDegrees(g.longitude) };
  const below = camera.positionCartographic, under = { lat: C.Math.toDegrees(below.latitude), lon: C.Math.toDegrees(below.longitude) };
  const d = dist(under, c), max = Math.max(1500, camHeight() * 2.5);   // a low, tilted view: not the horizon
  if (d <= max) return c;
  const f = max / d; return { lat: under.lat + (c.lat - under.lat) * f, lon: under.lon + (c.lon - under.lon) * f };
}
function setShown(v) { if (v === shown) return; shown = v; bbs.show = pts.show = lines.show = v; lastFrame = 0; }
function tick() {
  if (!on) return;
  const h = camHeight();
  setShown(!state.lookup && (shown ? h < MAX_H * 1.1 : h < MAX_H));
  if (!shown) return;
  centre = reticle(); R = Math.min(Math.max(h * 1.1, 600), PHONE ? 1200 : 2200);
  const want = tilesFor(centre, R);
  if (want.join(';') !== active.join(';')) { active = want; dirty = true; }
  while (inflight < 2) {
    const miss = want.find(k => !tiles.has(k) || (tiles.get(k).failed && Date.now() - tiles.get(k).failed > 60e3));
    if (!miss) break; loadTile(miss);
  }
  const rebuilt = dirty; if (dirty) { dirty = false; rebuild(); }
  if (!!state.photoreal !== wasPhoto) { wasPhoto = !!state.photoreal; gv++; drawLines(); }   // onto Google's ground, or back to the globe's
  const live = Math.abs(Time.nowMs() - Date.now()) < 30 * 60e3;
  if (live !== wasLive) { wasLive = live; measure(sim.g.edges); drawLines(); lastZone = null; }   // readings are of now: off while the time bar is elsewhere
  const lt = localTime(Time.nowMs(), centre.lon), busy = busyness(lt.hour, lt.weekend);
  if (rebuilt || !lastZone || dist(lastZone, centre) > 0.08 * R || Math.abs(R - lastR) > 0.15 * R || Math.abs(busy - sim.busy) > 0.02) {
    sim.zone(centre, R, busy); lastZone = centre; lastR = R;
  }
  sim.fit(Math.min(CAP, sim.wanted()));
  setCount('traffic', sim.cars.length);
  const cell = tileKey(centre);
  if (cell !== lastCell) { lastCell = cell; Country.at(centre.lon, centre.lat).then(k => { const l = drivesLeft(k?.iso); if (l !== left) { left = l; drawLines(); } }).catch(() => {}); }
  refreshMeasured(centre);
  sampleGround();
  if (tiles.size > KEEP_TILES) for (const [k] of [...tiles].filter(([k, t]) => !active.includes(k) && t.prep).sort((a, b) => a[1].used - b[1].used).slice(0, tiles.size - KEEP_TILES)) tiles.delete(k);
}
setInterval(tick, 1000);

export const Traffic = {
  sim,
  /** Show or hide (off frees the cars; nothing is fetched while off). */
  apply(want) {
    if (want === on) { if (on) tick(); return; }
    on = want;
    if (!on) { setShown(false); sim.fit(0); setCount('traffic', 0); return; }
    if (camHeight() > MAX_H) toast('Traffic: simulated cars on real roads. Fly below 6 km over a city to see them.', 4500);
    tick();
  },
  /** Before each render: move the cars (real time: the time bar sets how busy, not how fast) and draw them. */
  update() {
    if (!on || !shown) return;
    const now = performance.now(), dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0; lastFrame = now;
    if (dt > 0 && sim.cars.length) sim.step(dt, sim.clock);
    draw(dt);
  },
  /** For the console: what's loaded and running. */
  stats() {
    return { cars: sim.cars.length, wanted: Math.round(sim.wanted()), edges: sim.g.edges.length, signals: sim.g.signals.size, measured: sim.g.edges.filter(e => e.meas).length,
      tiles: [...tiles.values()].filter(t => t.prep).length, active: active.length, R: Math.round(R), left, busy: +sim.busy.toFixed(2), ground: state.photoreal ? Object.fromEntries(ground) : null };
  },
};
