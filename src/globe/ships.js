// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Ships: live AIS from Fintraffic's Digitraffic (keyless, CORS): every ship its coastal network hears in the Gulf of
// Finland, the Gulf of Bothnia, the Archipelago Sea and the northern Baltic (~800 at a time). Polled every 20 s for what
// changed (a few KB); between reports each ship moves along its course at its speed, through the turn it reports, and
// eases into each new report instead of jumping. Far out: an arrow per ship in its type's colour (a dot when it is
// stopped). Close in: its hull at true length and beam, flat on the water where its antenna puts it, with a wake that
// grows with its speed. Parsing, AIS codes and motion: core/ais.js.
import { C, esc, fmt, PHONE } from './env.js';
import { scene, camera, camHeight } from './viewer.js';
import { Terrain } from './terrain.js';
import { setCount } from './layers.js';
import { state } from './state.js';
import { courseAxis } from '../core/geo.js';
import { lagMeter } from '../core/transit.js';
import { parseAisLocations, parseAisVessels, shipKind, shipTypeName, SHIP_KINDS, NAV_STATUS, flagOf, underway, shipAt, etaTime, DIGITRAFFIC_AIS, DIGITRAFFIC_HEADERS, AIS_AREA } from '../core/ais.js';
import { rep, provStamp } from '../core/liveprov.js';

const API = DIGITRAFFIC_AIS, HEADERS = DIGITRAFFIC_HEADERS, AREA = AIS_AREA;   // the area: as far as the Finnish network hears
const MAX_H = 5.0e6, POLL = 20e3, META = 10 * 60e3, KEEP = 2 * 3600e3, DR_MAX = 600, STALE = 15 * 60e3;
const NEAR_MAX = PHONE ? 12 : 40, NEAR_H = 40e3;   // hulls on the water: at most this many, with the camera below this
const D2R = Math.PI / 180, KN_KMH = 1.852;
// a ship that doesn't say how big it is: a typical one of its kind (length, beam in m)
const TYPICAL = { cargo: [140, 22], tanker: [170, 28], passenger: [170, 28], fast: [35, 9], fishing: [24, 7], pleasure: [12, 4], military: [70, 11], service: [30, 10], other: [40, 10] };

const icons = scene.primitives.add(new C.BillboardCollection());
icons.show = false;
const ships = new Map();   // mmsi → ship
const meta = new Map();    // mmsi → details (name, type, size, destination…), kept while the page is open
const lag = lagMeter(1);   // the feed's clock against ours, measured per poll
const ICON_SCALE = new C.NearFarScalar(5e3, 1.15, 3e6, 0.45);

// ---- pictures, drawn once on first use ----------------------------------------------------------------------------
const IMG = new Map();
function drawn(key, w, h, paint) {
  if (!IMG.has(key)) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; paint(cv.getContext('2d'), w, h); IMG.set(key, cv.toDataURL()); }
  return IMG.get(key);
}
/** The far-out icon: an arrow along the course while making way, a dot when stopped. */
const iconOf = (kind, moving) => moving
  ? drawn('a' + kind, 20, 26, g => {
    g.beginPath(); g.moveTo(10, 1.5); g.lineTo(17, 16); g.lineTo(14.5, 24.5); g.lineTo(5.5, 24.5); g.lineTo(3, 16); g.closePath();
    g.fillStyle = SHIP_KINDS[kind][1]; g.fill(); g.lineWidth = 1.6; g.strokeStyle = 'rgba(0,0,0,.72)'; g.stroke();
  })
  : drawn('d' + kind, 12, 12, g => { g.beginPath(); g.arc(6, 6, 4.4, 0, 7); g.fillStyle = SHIP_KINDS[kind][1]; g.fill(); g.lineWidth = 1.4; g.strokeStyle = 'rgba(0,0,0,.72)'; g.stroke(); });

const HULL = { cargo: ['#3d2b27', '#6b3b2e'], tanker: ['#4a1d20', '#8a3b2b'], passenger: ['#e9edf1', '#f7f9fb'], fast: ['#dfe4e9', '#f2f4f6'], fishing: ['#2f4f7a', '#d9dde2'],
  pleasure: ['#f1f3f5', '#c8a77a'], military: ['#5f6a73', '#79848d'], service: ['#a83c2a', '#d55b3f'], other: ['#4e5862', '#6f7a85'] };
const BOXES = ['#c0392b', '#2a6fb0', '#e0a526', '#2e8b57', '#8e44ad', '#d35400', '#7f8c8d', '#16a085'];
/** Close in: the hull from above, bow up (64 × 256, stretched to the ship's beam and length). */
const hullOf = kind => drawn('h' + kind, 64, 256, (g, W, H) => {
  const [side, deck] = HULL[kind];
  const outline = (inset) => { g.beginPath(); g.moveTo(W / 2, 2 + inset); g.bezierCurveTo(W - 4 - inset, 44, W - 3 - inset, 74, W - 3 - inset, 96); g.lineTo(W - 3 - inset, H - 16);
    g.quadraticCurveTo(W - 4 - inset, H - 3 - inset, W / 2, H - 3 - inset); g.quadraticCurveTo(4 + inset, H - 3 - inset, 3 + inset, H - 16); g.lineTo(3 + inset, 96); g.bezierCurveTo(3 + inset, 74, 4 + inset, 44, W / 2, 2 + inset); g.closePath(); };
  outline(0); g.fillStyle = side; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
  outline(4); g.fillStyle = deck; g.fill();
  const bridge = y => { g.fillStyle = '#f4f6f8'; g.fillRect(9, y, W - 18, 26); g.fillStyle = 'rgba(30,40,52,.85)'; g.fillRect(11, y + 2, W - 22, 4); g.fillStyle = '#c9d1d9'; g.fillRect(W / 2 - 3, y + 10, 6, 12); };
  if (kind === 'cargo') {   // rows of containers ahead of the bridge
    let n = 0; for (let y = 64; y < H - 66; y += 13) for (let x = 10; x + 13 <= W - 10; x += 15) { g.fillStyle = BOXES[(n++ * 7 + (y >> 2)) % BOXES.length]; g.fillRect(x, y, 13, 11); }
    bridge(H - 58);
  } else if (kind === 'tanker') {   // the pipe walkway along the deck, a manifold across the middle
    g.fillStyle = '#d9d9d9'; g.fillRect(W / 2 - 1.5, 40, 3, H - 104); g.fillRect(12, H / 2 - 2, W - 24, 4);
    g.fillStyle = '#2f6b4a'; for (let y = 56; y < H - 70; y += 26) { g.beginPath(); g.arc(W / 2 - 13, y, 4, 0, 7); g.arc(W / 2 + 13, y, 4, 0, 7); g.fill(); }
    bridge(H - 58);
  } else if (kind === 'passenger') {   // decks, a pool, lifeboats along both sides
    g.fillStyle = '#ffffff'; g.fillRect(9, 50, W - 18, H - 80); g.fillStyle = '#5ab4e6'; g.fillRect(W / 2 - 8, 120, 16, 30);
    g.fillStyle = '#f29a1d'; for (let y = 70; y < H - 50; y += 18) { g.fillRect(5, y, 4, 10); g.fillRect(W - 9, y, 4, 10); }
    g.fillStyle = 'rgba(30,40,52,.85)'; g.fillRect(12, 54, W - 24, 5); g.fillStyle = '#c0392b'; g.fillRect(W / 2 - 5, H - 70, 10, 16);   // bridge windows, funnel
  } else if (kind === 'pleasure') {   // a sailing yacht: cockpit aft, mast
    g.fillStyle = '#8c6b45'; g.fillRect(16, H - 70, W - 32, 46); g.fillStyle = '#ffffff'; g.fillRect(20, 80, W - 40, 60);
    g.fillStyle = '#333'; g.beginPath(); g.arc(W / 2, 110, 4, 0, 7); g.fill();
  } else bridge(kind === 'service' || kind === 'fishing' ? 70 : H - 80);   // tugs and fishing boats: the wheelhouse forward
});
/** The wake: churned water straight behind (about a beam wide, soft-edged), the two arms of the Kelvin wedge (19.5°
 *  each side) and faint transverse waves between them, all fading with distance from the stern. Apex at the top. */
const WAKE = () => drawn('wake', 128, 256, (g, W, H) => {
  const fade = (a0, a1, mid) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(240,248,255,0)'); gr.addColorStop(0.015, `rgba(240,248,255,${a0})`);
    gr.addColorStop(mid, `rgba(240,248,255,${a1})`); gr.addColorStop(1, 'rgba(240,248,255,0)'); return gr; };
  for (let k = 0; k < 6; k++) {   // layered strips, the wider ones fainter: a soft edge
    const w0 = 2.5 + k * 1.3, w1 = 7 + k * 3.5; g.fillStyle = fade(0.17, 0.04, 0.6);
    g.beginPath(); g.moveTo(W / 2 - w0, 0); g.lineTo(W / 2 + w0, 0); g.lineTo(W / 2 + w1, H); g.lineTo(W / 2 - w1, H); g.closePath(); g.fill();
  }
  g.lineCap = 'round';
  for (const s of [-1, 1]) { g.strokeStyle = fade(0.6, 0.18, 0.5); g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2, 3); g.lineTo(W / 2 + s * (W / 2 - 3), H); g.stroke(); }
  for (let k = 1; k <= 6; k++) {
    const y = k * H / 7, x = y * (W / 2 - 3) / H * 0.85;
    g.strokeStyle = `rgba(240,248,255,${(0.16 * (1 - k / 7)).toFixed(3)})`; g.lineWidth = 1.2; g.beginPath(); g.moveTo(W / 2 - x, y); g.quadraticCurveTo(W / 2, y + 9, W / 2 + x, y); g.stroke();
  }
});

// ---- ships describe themselves (hover tips, cards) ----------------------------------------------------------------
const ago = ms => ms < 90e3 ? Math.max(0, Math.round(ms / 1000)) + ' s ago' : ms < 3600e3 ? Math.round(ms / 60e3) + ' min ago' : (ms / 3600e3).toFixed(1).replace(/\.0$/, '') + ' h ago';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function etaText(parts) {
  const t = etaTime(parts); if (t == null) return '';
  const d = new Date(t), hm = parts.hour == null ? '' : ` ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  const dh = (t - Date.now()) / 3600e3, rel = Math.abs(dh) < 48 ? `${dh >= 0 ? 'in ' : ''}${Math.abs(dh) < 1 ? Math.round(Math.abs(dh) * 60) + ' min' : Math.round(Math.abs(dh)) + ' h'}${dh < 0 ? ' ago' : ''}`
    : `${dh >= 0 ? 'in ' : ''}${Math.round(Math.abs(dh) / 24)} days${dh < 0 ? ' ago' : ''}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${hm} (${rel})`;
}
const row = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '';
const ShipProto = {
  get prov() { return provStamp('ships', [rep('digitraffic', { dataAt: this.t })]); },
  get m() { return meta.get(this.mmsi) || {}; },
  get label() { return this.m.name || 'MMSI ' + this.mmsi; },
  tip() { return `🚢 ${this.label} · ${shipTypeName(this.m.type).split(' · ')[0]}${underway(this) ? ` · ${(this.sog ?? 0).toFixed(1)} kn` : ' · ' + (NAV_STATUS[this.navStat] || 'stopped')}`; },
  age() { return Date.now() - lag.value - this.t; },
  cardHtml() {
    const m = this.m, kind = shipKind(m.type), [kname, color] = SHIP_KINDS[kind], flag = flagOf(this.mmsi);
    const now = underway(this) ? `${(this.sog ?? 0).toFixed(1)} kn (${fmt((this.sog ?? 0) * KN_KMH)} km/h)${this.cog != null ? ` · course ${Math.round(this.cog)}°` : ''}${this.heading != null ? ` · heading ${Math.round(this.heading)}°` : ''}` : '';
    const size = m.length ? `${fmt(m.length)} × ${fmt(m.width || 0)} m${m.draught ? ` · draught ${m.draught.toFixed(1)} m` : ''}` : '';
    return `<div class="k" style="--c:${color}">Ship · ${esc(kname)}${flag ? ' · ' + esc(flag) : ''}</div><h2>${esc(this.label)}</h2><dl>`
      + row('Status', NAV_STATUS[this.navStat] || '') + row('Moving', now) + row('Type', m.type ? shipTypeName(m.type) : '')
      + row('Heading for', m.destination) + row('Expected', m.eta ? etaText(m.eta) : '') + row('Size', size) + row('Flag', flag)
      + row('IMO', m.imo ? String(m.imo) : '') + row('Call sign', m.callSign) + row('MMSI', String(this.mmsi))
      + `<dt>Last report</dt><dd data-ship-age>${esc(ago(this.age()))}</dd></dl>`
      + `<div class="note" style="margin-top:8px">Live AIS heard by Fintraffic's coastal network (Digitraffic, CC BY 4.0). Between reports it moves along its course at its speed${this.turn ? ' through the turn it reports' : ''}; destination and ETA are what the crew typed in.${this.age() > STALE ? ' No recent report: it may be out of range.' : ''}</div>`;
  },
  afterCard(card) {   // keep "last report" ticking while the card is open
    const id = setInterval(() => {
      const el = card.querySelector('[data-ship-age]');
      if (!el || state.selected !== this || !card.classList.contains('show')) return clearInterval(id);
      el.textContent = ago(this.age());
    }, 1000);
  },
};

// ---- the feed -----------------------------------------------------------------------------------------------------
async function get(path, signal) {
  const r = await fetch(API + path, { headers: HEADERS, signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
let stopPoll = null, fails = 0, lastPoll = 0, newest = 0, metaAt = 0;
function start() {
  if (stopPoll) return;
  let dead = false, timer = 0, ctl = null;
  const run = async () => {
    ctl = new AbortController(); const kill = setTimeout(() => ctl.abort(), 25e3);
    try {
      const now = Date.now();
      if (now - metaAt > META) {   // names, types, sizes, destinations: all once, then what changed
        const since = metaAt ? metaAt - 60e3 : 0, list = parseAisVessels(await get('vessels' + (since ? '?from=' + since : ''), ctl.signal));
        for (const v of list) meta.set(v.mmsi, v);
        metaAt = now; for (const s of ships.values()) restyle(s);
      }
      const whole = !newest || now - lastPoll > 5 * 60e3;   // after a pause, everything again
      const reps = parseAisLocations(await get('locations' + (whole ? '' : '?from=' + (newest - 10e3)), ctl.signal));
      if (dead) return;
      const at = Date.now();
      for (const r of reps) { lag.note(at - r.t, at); if (r.t > newest) newest = r.t; }
      for (const r of reps) ingest(r, at);
      lastPoll = at; fails = 0; count();
    } catch (e) { if (!dead) { fails++; console.warn('ships', e.message); } }
    finally { clearTimeout(kill); if (!dead) timer = setTimeout(run, POLL * (1 + Math.min(fails, 4))); }
  };
  run();
  stopPoll = () => { dead = true; clearTimeout(timer); ctl?.abort(); };
}
function stop() { if (stopPoll) { stopPoll(); stopPoll = null; } }

const P = new C.Cartesian3(), AX = new C.Cartesian3();
function ingest(r, now) {
  if (now - lag.value - r.t > KEEP) return;
  let s = ships.get(r.mmsi);
  if (!s) {
    s = Object.assign(Object.create(ShipProto), r, { kind: 'ship', at: { lat: r.lat, lon: r.lon, cog: r.cog ?? r.heading }, corr: null, gh: 0, gLat: 99, gLon: 0, gOn: null, look: '', near: null });
    s.icon = icons.add({ position: C.Cartesian3.fromDegrees(r.lon, r.lat, 3), id: s, scaleByDistance: ICON_SCALE });
    ships.set(r.mmsi, s); restyle(s); return;
  }
  if (r.t <= s.t) return;
  const was = { lat: s.at.lat, lon: s.at.lon, cog: s.at.cog };   // where it is drawn now
  Object.assign(s, r);
  const to = shipAt(s, (now - lag.value - s.t) / 1000, {}, DR_MAX), dLat = was.lat - to.lat, dLon = was.lon - to.lon;
  const m = Math.hypot(dLat, dLon * Math.cos(to.lat * D2R)) * 111320;
  s.corr = m > 1 && m < 3000 ? { lat: dLat, lon: dLon, cog: was.cog != null && to.cog != null ? ((was.cog - to.cog + 540) % 360) - 180 : 0, t0: now, tau: Math.min(8000, Math.max(1500, m / 0.004)) } : null;
  restyle(s);
}
/** Its icon (kind, moving or not), and its size for the hull. */
function restyle(s) {
  const m = meta.get(s.mmsi) || {}, kind = shipKind(m.type), moving = underway(s), look = kind + moving + (moving && (s.sog || 0) >= 2);   // the last: a wake
  if (s.look !== look) { s.look = look; s.icon.image = iconOf(kind, moving); s.icon.alignedAxis = C.Cartesian3.ZERO; s._ax = null; if (s.near) dropNear(s); }
  const [tl, tw] = TYPICAL[kind];
  s.len = m.length || tl; s.beam = m.width || Math.min(tw, s.len / 4);
  s.dy = m.length && m.refA ? m.refA - m.length / 2 : 0;   // the hull's centre ahead of the antenna (AIS positions are the antenna's)
  s.dx = m.width && m.refC != null ? m.width / 2 - m.refC : 0;   // …and to starboard of it
}
const count = () => setCount('ships', ships.size);

// ---- close in: hulls and wakes flat on the water, a few dozen at a time -------------------------------------------
// This viewer isn't 3D-only, so a primitive's geometry is baked into world coordinates (and projected for 2D) when it is
// built: each quad is built where the ship is, and moved after that by a modelMatrix = (transform now) × (transform at build)⁻¹.
const HULL_FS = `czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  vec4 c = texture(image, materialInput.st);
  if (c.a < 0.5) discard;
  m.diffuse = c.rgb; m.alpha = 1.0;
  return m;
}`;
const ENU = new C.Matrix4(), TRS = new C.Matrix4(), M = new C.Matrix4(), Q = new C.Quaternion(), T = new C.Cartesian3(), S = new C.Cartesian3();
/** The transform of one quad now: the ship's frame at its antenna, turned to its heading, offset and stretched. */
function transform(s, dx, dy, z, sx, sy, out) {
  const dir = underway(s) ? (s.at.cog ?? s.heading ?? 0) : (s.heading ?? s.at.cog ?? 0), c = dir * D2R, sn = Math.sin(c), cs = Math.cos(c);
  C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(s.at.lon, s.at.lat, s.gh, undefined, P), undefined, ENU);
  C.Quaternion.fromAxisAngle(C.Cartesian3.UNIT_Z, -c, Q);
  T.x = dx * cs + dy * sn; T.y = -dx * sn + dy * cs; T.z = z; S.x = sx; S.y = sy; S.z = 1;   // local (starboard, forward) turned onto the heading
  return C.Matrix4.multiply(ENU, C.Matrix4.fromTranslationQuaternionRotationScale(T, Q, S, TRS), out);
}
/** A flat quad (x -½..½, y y0..y1, the picture's top at y1) built through transform `m`. */
function quad(m, y0, y1) {
  const pts = [[-0.5, y0], [0.5, y0], [0.5, y1], [-0.5, y1]].map(([x, y]) => C.Matrix4.multiplyByPoint(m, new C.Cartesian3(x, y, 0), new C.Cartesian3()));
  const v = new Float64Array(12), n = new Float32Array(12), up = C.Cartesian3.normalize(pts[0], new C.Cartesian3());
  pts.forEach((p, i) => { v.set([p.x, p.y, p.z], i * 3); n.set([up.x, up.y, up.z], i * 3); });
  return new C.Geometry({ attributes: {
    position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: v }),
    normal: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: n }),
    st: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) }) },
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]), primitiveType: C.PrimitiveType.TRIANGLES, boundingSphere: C.BoundingSphere.fromPoints(pts) });
}
/** One quad as a primitive: the hull opaque (cut out along its outline), the wake see-through. */
function flat(s, part, y0, y1) {
  const m0 = part.place(s, new C.Matrix4()), hull = part.key === 'hull';
  const material = hull ? new C.Material({ fabric: { uniforms: { image: hullOf(shipKind(s.m.type)) }, source: HULL_FS }, translucent: false })
    : new C.Material({ fabric: { type: 'Image', uniforms: { image: WAKE(), color: new C.Color(1, 1, 1, Math.min(0.8, 0.35 + (s.sog || 0) / 30)) } }, translucent: true });
  const prim = scene.primitives.add(new C.Primitive({ geometryInstances: new C.GeometryInstance({ geometry: quad(m0, y0, y1), id: s }), asynchronous: false, compressVertices: false,
    appearance: new C.MaterialAppearance({ material, flat: true, translucent: !hull, faceForward: true, closed: false }) }));
  prim.inv = C.Matrix4.inverse(m0, new C.Matrix4()); prim.part = part;
  return prim;
}
const HULL_PART = { key: 'hull', place: (s, out) => transform(s, s.dx, s.dy, 1.5, s.beam, s.len, out) };
const WAKE_PART = { key: 'wake', place: (s, out) => { const wl = Math.min(6, 1.2 + (s.sog || 0) / 6) * Math.max(s.len, 30); return transform(s, s.dx, s.dy - s.len / 2 + 2, 1.0, wl * 0.71, wl, out); } };
function addNear(s) {
  s.near = { hull: flat(s, HULL_PART, -0.5, 0.5), wake: underway(s) && (s.sog || 0) >= 2 ? flat(s, WAKE_PART, -1, 0) : null };
  s.icon.distanceDisplayCondition = new C.DistanceDisplayCondition(s.len * 40, Number.MAX_VALUE);   // the arrow gives way once the hull is bigger
}
function dropNear(s) {
  if (!s.near) return;
  scene.primitives.remove(s.near.hull); if (s.near.wake) scene.primitives.remove(s.near.wake);
  s.near = null; s.icon.distanceDisplayCondition = undefined;
}
function placeNear(s) {
  for (const prim of [s.near.hull, s.near.wake]) if (prim) C.Matrix4.multiply(prim.part.place(s, M), prim.inv, prim.modelMatrix);
}
let lastPick = 0;
function pickNear(now) {
  if (now - lastPick < 500) return; lastPick = now;
  const c = camera.positionCartographic, h = camHeight();
  const want = new Set();
  if (c && h < NEAR_H) {
    const lat = C.Math.toDegrees(c.latitude), lon = C.Math.toDegrees(c.longitude), r = Math.min(40e3, Math.max(6e3, h * 4)), k = Math.cos(lat * D2R);
    const near = [];
    for (const s of ships.values()) { const d = Math.hypot(s.at.lat - lat, (s.at.lon - lon) * k) * 111320; if (d < r) near.push([d, s]); }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < near.length && i < NEAR_MAX; i++) want.add(near[i][1]);
  }
  for (const s of ships.values()) if (s.near && !want.has(s)) dropNear(s);
  for (const s of want) if (!s.near) addNear(s);
}

// ---- each frame -----------------------------------------------------------------------------------------------------
function step(s, now) {
  shipAt(s, (now - lag.value - s.t) / 1000, s.at, DR_MAX);
  const k = s.corr;
  if (k) { const f = Math.exp(-(now - k.t0) / k.tau); if (f < 0.01) s.corr = null; else { s.at.lat += k.lat * f; s.at.lon += k.lon * f; if (s.at.cog != null) s.at.cog = (s.at.cog + k.cog * f + 360) % 360; } }
  if (s.gOn !== Terrain.on || Math.abs(s.at.lat - s.gLat) + Math.abs(s.at.lon - s.gLon) > 3e-3) {   // the sea surface under it (the geoid, with terrain on)
    s.gh = Terrain.on ? Terrain.near(s.at.lat, s.at.lon, 3) : 0; s.gLat = s.at.lat; s.gLon = s.at.lon; s.gOn = Terrain.on;
  }
  s.icon.position = C.Cartesian3.fromDegrees(s.at.lon, s.at.lat, s.gh + 3, undefined, P);
  if (underway(s) && s.at.cog != null && (s._ax == null || Math.abs(((s.at.cog - s._ax + 540) % 360) - 180) > 0.5)) { s.icon.alignedAxis = courseAxis(s.at.lat, s.at.lon, s.at.cog, AX); s._ax = s.at.cog; }
  const faded = now - lag.value - s.t > STALE;
  if (faded !== s._faded) { s._faded = faded; s.icon.color = faded ? new C.Color(1, 1, 1, 0.45) : C.Color.WHITE; }
  if (s.near) placeNear(s);
}

function inView() {
  const h = camHeight(); if (h > MAX_H) return false;
  const r = camera.computeViewRectangle(); if (!r) return true;
  const w = C.Math.toDegrees(r.west), s = C.Math.toDegrees(r.south), e = C.Math.toDegrees(r.east), n = C.Math.toDegrees(r.north);
  return !(AREA[0] > n || AREA[2] < s || (w <= e && (AREA[1] > e || AREA[3] < w)));
}
let lastCheck = 0, lastMove = 0;
function evaluate(now) {
  if (Ships.layer.on && !document.hidden && inView()) start(); else stop();
  for (const s of ships.values()) if (now - lag.value - s.t > KEEP && state.selected !== s) { dropNear(s); icons.remove(s.icon); ships.delete(s.mmsi); }
  count();
}
document.addEventListener('visibilitychange', () => evaluate(Date.now()));

export const Ships = {
  layer: { id: 'ships', group: 'Earth', name: 'Ships: live AIS, northern Baltic (Fintraffic)', color: '#5fb0ff', on: false },
  ships, meta,
  /** Show or hide; starts or stops the feed (nothing is fetched while off). */
  apply(on = this.layer.on) {
    this.layer.on = on; icons.show = on;
    if (!on) { stop(); for (const s of ships.values()) dropNear(s); icons.removeAll(); ships.clear(); newest = 0; count(); }
    else evaluate(Date.now());
  },
  /** Before each render: whether to poll (once a second), which ships get hulls, and where every ship is now. */
  update(now = Date.now()) {
    if (!this.layer.on) return;
    if (now - lastCheck > 1000) { lastCheck = now; evaluate(now); }
    if (!ships.size) return;
    pickNear(now);
    if (camHeight() > 150e3 && now - lastMove < 500) return;   // from high up, twice a second is plenty
    lastMove = now;
    for (const s of ships.values()) step(s, now);
  },
  /** For the console: ships by kind, and how many are making way. */
  stats() {
    const out = { total: ships.size, moving: 0, near: 0 };
    for (const s of ships.values()) { const k = shipKind(s.m.type); out[k] = (out[k] || 0) + 1; if (underway(s)) out.moving++; if (s.near) out.near++; }
    return out;
  },
};
