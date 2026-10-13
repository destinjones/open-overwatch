// Aircraft: the OpenSky global snapshot (every 15 min) and adsb.lol military (every 60 s), dead-reckoned between fixes
// (through the turn a plane was making), each fix stamped with the feed's own time and eased in where it disagrees with
// where we drew the plane; drawn as Blender-rendered sprites far out (nose along the course from any angle) and as glTF
// models (pitch from climb rate, bank from turn rate) up close. Heights: geometric altitude where the feed has it, and on
// the 3D terrain, planes on the ground stand on it and low ones never dip into it.
import { C, bigStore, getJSON, NO_ENV_MAP } from './env.js';
import { viewer, camera, airPts, airIcons, camHeight } from './viewer.js';
import { L, setCount } from './layers.js';
import { state, hooks } from './state.js';
import { Follow, MODEL_FIX } from './follow.js';
import { deadReckonArc, courseAxis } from '../core/geo.js';
import { Terrain } from './terrain.js';
import { Time } from './time.js';
import { classify } from '../core/actype.js';

const DR_MAX_S = 900;              // dead-reckoning horizon: the global snapshot refreshes every 15 min
export const AIR_ICON_RANGE = 2.5e6; // planes become heading icons below ~2,500 km camera distance
const EMERGENCY = ['7500', '7600', '7700'];

// sprite shape by aircraft class (core/actype.js: the ICAO type code, adsbdb's type, or the emitter category;
// brand/tools/plane_sprites.py renders one per shape and colour)
const SPRITE_SIZE = { airliner: 30, prop: 26, heli: 26, fighter: 24, heavy: 36, tprop: 32 };
/** The class of a plane from everything known about it (an adsbdb answer fills in what the feed lacks). */
export function airClass(r) {
  const a = r.info && r.info.aircraft;
  return classify({ type: r.type || (a && a.icaoType), desc: r.desc || (a && [a.manufacturer, a.type].filter(Boolean).join(' ')), cat: r.cat, mil: r.mil, gs: r.gs, alt: r.alt, ground: r.ground });
}
export const airShape = r => airClass(r).shape;

/** Where an aircraft is at time ms: along its track for up to 15 min (planes never freeze between snapshots), through the
 *  turn it was making for up to 2 min, climbing or descending at its vertical rate for up to 1 min. alt: barometric
 *  (labels, cards); altE: geometric, above the ellipsoid, where the feed sends it; track: its course then. */
export function aircraftAt(r, ms) {
  const dts = Math.max(0, (ms - r.ts) / 1000), p = deadReckonArc(r, Math.min(DR_MAX_S, dts), r.turn || 0);
  const climb = r.ground ? 0 : (r.vr || 0) * Math.min(60, dts);
  return { lat: p.lat, lon: p.lon, track: p.track, alt: Math.max(0, (r.alt || 0) + climb), altE: r.ground || r.altG == null ? null : r.altG + climb };
}
/** aircraftAt plus what is left of the last correction: a fix that disagrees with where we drew the plane is eased in
 *  over a second or a few (a 15-min snapshot can be kilometres off), position and heading together, instead of a jump. */
export function displayAt(r, ms) {
  const p = aircraftAt(r, ms), k = r.corr;
  if (k) {
    const f = Math.exp(-(ms - k.t0) / k.tau);
    if (f < 0.01) r.corr = null;
    else { p.lat += k.lat * f; p.lon += k.lon * f; if (p.track != null) p.track = (p.track + k.hdg * f + 360) % 360; }
  }
  return p;
}
/** The height to draw at (m above the ellipsoid): geometric altitude where the feed has it, else barometric. On the 3D
 *  terrain, planes on the ground stand on it and low ones never dip into it (the feeds and the terrain are both rough). */
export function renderHeight(r, p, near = true) {
  const h = p.altE ?? p.alt;
  if (!Terrain.on) return r.ground ? 3 : h;
  if (r.ground) return Terrain.near(p.lat, p.lon, 4, near ? 0.3 : 0) + 2;   // parked or taxiing: on the ground (the most detailed near the view)
  return h < 4500 ? Math.max(h, Terrain.near(p.lat, p.lon, 2, 0) + 15) : h;   // low fliers: never inside a hill (coarse ground)
}
const AX = new C.Cartesian3();

/** An adsb.lol (readsb) aircraft as one of ours; mil: true for the /mil feed, else from its database flags. */
export function fromAdsb(a, now, mil = !!(a.dbFlags & 1)) {
  const ground = a.alt_baro === 'ground';
  return { hex: a.hex, flight: (a.flight || '').trim(), type: a.t, reg: a.r, desc: a.desc, op: a.ownOp, cat: a.category, lon: a.lon, lat: a.lat, alt: ground ? 0 : (a.alt_baro || 0) * 0.3048, ground,
    altG: ground || a.alt_geom == null ? null : a.alt_geom * 0.3048,   // readsb: geometric, WGS84 ellipsoid
    gs: a.gs != null ? a.gs * 0.514444 : null, track: a.track, vr: a.baro_rate != null ? a.baro_rate * 0.00508 : 0, squawk: a.squawk, emerg: EMERGENCY.includes(a.squawk),
    mil, ts: now - (a.seen_pos || 0) * 1000, src: 'adsb.lol' };
}

const layerOf = r => L[r.mil ? 'mil' : 'air'];
/** Shown: its layer is on and the clock is at the live moment (aircraft feeds have no history). */
export const airShown = r => layerOf(r).on && !Time.offLive();
export const Air = {
  map: new Map(),
  upsert(a) {
    let r = this.map.get(a.hex);
    if (!r) {
      r = { ...a, kind: 'air' };
      r.pt = airPts.add({ position: C.Cartesian3.ZERO, pixelSize: 2.4, id: r, scaleByDistance: new C.NearFarScalar(2.0e5, 2.2, 2.0e7, 0.7), distanceDisplayCondition: new C.DistanceDisplayCondition(AIR_ICON_RANGE * 0.8, 1e12) });
      r.icon = airIcons.add({ position: C.Cartesian3.ZERO, id: r, alignedAxis: courseAxis(a.lat, a.lon, a.track, new C.Cartesian3()), scaleByDistance: new C.NearFarScalar(2.0e4, 1.5, AIR_ICON_RANGE, 0.6), distanceDisplayCondition: new C.DistanceDisplayCondition(0, AIR_ICON_RANGE) });
      this.map.set(a.hex, r);
    } else if (r.mil && !a.mil && Date.now() - r.ts < 180e3) return;   // keep fresher military data
    else {
      const now = Date.now(), before = r.cur && airShown(r) ? displayAt(r, now) : null;   // where we drew it
      const dt = (a.ts - r.ts) / 1000;   // turn rate (deg/s) from consecutive fixes: banks the model, curves the dead reckoning; short gaps only
      r.turn = (a.track != null && r.track != null && dt >= 2 && dt <= 120) ? (((a.track - r.track + 540) % 360) - 180) / dt : 0;
      if (a.ts > r.ts) r.was = { ground: r.ground, ts: r.ts, lat: r.lat, lon: r.lon, alt: r.alt, gs: r.gs };   // the fix before: boards tell a landing or a take-off from it
      Object.assign(r, a); r.corr = null;
      if (before) {   // ease from where it was drawn to where the new fix says it is (not across the world: a reused address)
        const after = aircraftAt(r, now), dLat = before.lat - after.lat, dLon = ((before.lon - after.lon + 540) % 360) - 180;
        const m = Math.hypot(dLat, dLon * Math.cos(after.lat * Math.PI / 180)) * 111320;
        if (m > 2 && m < 50e3) r.corr = { lat: dLat, lon: dLon, t0: now, tau: Math.min(6000, Math.max(800, m / 0.3)),
          hdg: before.track != null && after.track != null ? ((before.track - after.track + 540) % 360) - 180 : 0 };
      }
    }
    r.pt.color = C.Color.fromCssColorString(r.emerg ? '#ff4d5e' : r.mil ? '#ffb44d' : '#5fd3ff');
    this.restyle(r);
    const on = airShown(r); r.pt.show = on && !r.ent; r.icon.show = on && !r.ent;
    hooks.airFix?.(r);   // trails.js records it
  },
  /** Sprite and model from the class (again when a fresher fix or an adsbdb answer brings a type). */
  restyle(r) {
    const k = airClass(r), shape = k.shape, img = `brand/sprites/${shape}_${r.emerg ? 'emg' : r.mil ? 'mil' : 'civ'}.png`;
    r.cls = k.cls; r.scale = k.scale;
    if (r.sprite !== img) { r.sprite = img; r.shape = shape; r.icon.image = img; }
    r.icon.width = r.icon.height = Math.round(SPRITE_SIZE[shape] * (0.55 + 0.45 * k.scale));   // a business jet's sprite is smaller than an airliner's
    if (r.ent) AirModels.restyle(r);
  },
  async opensky() {
    let rows = null; const c = await bigStore.get('opensky');
    if (c && Date.now() - c.t < 15 * 60e3) rows = c.rows;   // anonymous OpenSky: 400 credits/day, a global snapshot costs 4
    else {
      const d = await getJSON('https://opensky-network.org/api/states/all', { relay: true, timeout: 60000 });
      rows = (d.states || []).filter(s => s[5] != null && s[6] != null).map(s => [s[0], (s[1] || '').trim(), s[2], s[5], s[6], s[8] ? 0 : s[7], s[8] ? 1 : 0, s[9], s[10], s[14], s[11], s[3], s[13]]);   // + time of the position, geometric altitude
      await bigStore.set('opensky', { t: Date.now(), rows });
    }
    const now = Date.now(), ts = (c && rows === c.rows) ? c.t : now;
    for (const [hex, flight, country, lon, lat, alt, ground, gs, track, squawk, vr, tpos, geo] of rows)   // dead-reckon from when each position was heard, not when we asked
      this.upsert({ hex, flight, country, lon, lat, alt: alt || 0, ground: !!ground, gs, track, vr: vr ?? 0, squawk, emerg: EMERGENCY.includes(squawk), mil: false,
        ts: tpos > 0 && tpos * 1000 <= ts && ts - tpos * 1000 < DR_MAX_S * 1000 ? tpos * 1000 : ts, altG: !ground && geo != null ? geo : null, src: 'OpenSky' });
    this.snapshotAt = ts; setCount('air', rows.length); hooks.updateStats();
  },
  async military() {
    const d = await getJSON('https://api.adsb.lol/v2/mil', { relay: true }), now = Date.now(); let n = 0; this.milAt = now;
    for (const a of d.ac || []) { if (a.lat == null || a.lon == null) continue; n++; this.upsert(fromAdsb(a, now, true)); }
    setCount('mil', n); hooks.updateStats();
  },
  prune() {
    const now = Date.now();
    for (const [k, r] of this.map) if (now - r.ts > (r.mil ? 5 * 60e3 : 20 * 60e3) && r !== Follow.obj && r !== state.selected) {
      AirModels.drop(r, true); airPts.remove(r.pt); airIcons.remove(r.icon); this.map.delete(k);
    }
  },
  update(now) {
    const cc = camera.positionCartographic, far = !cc || cc.height > 1.5e6;   // terrain heights only within ~400 km of a low camera
    const cLat = cc ? C.Math.toDegrees(cc.latitude) : 0, cLon = cc ? C.Math.toDegrees(cc.longitude) : 0;
    for (const r of this.map.values()) {
      if (!airShown(r)) continue;
      const p = displayAt(r, now), near = !far && Math.abs(p.lat - cLat) < 4 && Math.abs(((p.lon - cLon + 540) % 360) - 180) < 4 / Math.max(0.2, Math.cos(p.lat * Math.PI / 180));
      const h = near ? renderHeight(r, p, cc.height < 1.5e5) : r.ground ? 3 : (p.altE ?? p.alt);
      const pos = C.Cartesian3.fromDegrees(p.lon, p.lat, h + (r.ground ? 6 : 60));
      r.pt.position = pos; r.icon.position = pos; r.cur = { lat: p.lat, lon: p.lon };
      const trk = p.track ?? r.track ?? 0;
      if (r._axT == null || Math.abs(((trk - r._axT + 540) % 360) - 180) > 0.3 || Math.abs(p.lat - r._axLat) + Math.abs(p.lon - r._axLon) > 0.05) {
        r.icon.alignedAxis = courseAxis(p.lat, p.lon, trk, AX); r._axT = trk; r._axLat = p.lat; r._axLon = p.lon;
      }
    }
  },
  counts() { let air = 0, mil = 0; for (const r of this.map.values()) r.mil ? mil++ : air++; return { air, mil }; },
};

/* The nearest aircraft to the camera (when it is below ~600 km) swap their icon for a glTF model at real size. Same axes
   as the satellites (+X nose, +Z up), so the same MODEL_FIX applies. */
export const AirModels = {
  max: 200, range: 3.0e5, ceiling: 6.0e5, pool: new Map(), _p: new C.Cartesian3(),
  view: { airliner: 38, prop: 28, heli: 18, fighter: 17, heavy: 50, tprop: 40 },
  get followed() { return Follow.obj && Follow.obj.kind === 'air' ? Follow.obj : null; },
  state(r, time = viewer.clock.currentTime) {
    const key = time.dayNumber * 86400 + time.secondsOfDay;
    if (r._k === key && r._st) return r._st;
    const st = r._st || (r._st = { pos: new C.Cartesian3(), quat: new C.Quaternion() }); r._k = key;
    const g = displayAt(r, C.JulianDate.toDate(time).getTime());
    C.Cartesian3.fromDegrees(g.lon, g.lat, renderHeight(r, g), C.Ellipsoid.WGS84, st.pos);
    const enu = C.Transforms.eastNorthUpToFixedFrame(st.pos), E = new C.Cartesian3(enu[0], enu[1], enu[2]), N = new C.Cartesian3(enu[4], enu[5], enu[6]), U = new C.Cartesian3(enu[8], enu[9], enu[10]);
    const h = C.Math.toRadians(g.track ?? r.track ?? 0);
    const pitch = r.ground ? 0 : Math.max(-0.35, Math.min(0.35, Math.atan2(r.vr || 0, Math.max(30, r.gs || 0))));
    const bank = r.ground ? 0 : Math.max(-0.5, Math.min(0.5, Math.atan((r.gs || 0) * C.Math.toRadians(r.turn || 0) / 9.81)));   // coordinated turn
    const f = C.Cartesian3.add(C.Cartesian3.multiplyByScalar(E, Math.sin(h), new C.Cartesian3()), C.Cartesian3.multiplyByScalar(N, Math.cos(h), new C.Cartesian3()), new C.Cartesian3());
    const X = C.Cartesian3.normalize(C.Cartesian3.add(C.Cartesian3.multiplyByScalar(f, Math.cos(pitch), new C.Cartesian3()), C.Cartesian3.multiplyByScalar(U, Math.sin(pitch), new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3());
    const Y0 = C.Cartesian3.normalize(C.Cartesian3.cross(U, X, new C.Cartesian3()), new C.Cartesian3());   // left wing
    const Z0 = C.Cartesian3.cross(X, Y0, new C.Cartesian3());
    const Z = C.Cartesian3.normalize(C.Cartesian3.subtract(C.Cartesian3.multiplyByScalar(Z0, Math.cos(bank), new C.Cartesian3()), C.Cartesian3.multiplyByScalar(Y0, Math.sin(bank), new C.Cartesian3()), new C.Cartesian3()), new C.Cartesian3()); // right turn = right wing down
    const Y = C.Cartesian3.cross(Z, X, new C.Cartesian3());
    C.Quaternion.multiply(C.Quaternion.fromRotationMatrix(new C.Matrix3(X.x, Y.x, Z.x, X.y, Y.y, Z.y, X.z, Y.z, Z.z), st.quat), MODEL_FIX, st.quat);
    return st;
  },
  uri: r => `brand/models/aircraft/${r.shape || 'airliner'}_${r.mil ? 'mil' : 'civ'}.glb`,
  restyle(r) { // shape/colour can change when a fresher fix arrives (a type code, a squawk)
    const m = r.ent.model; if (!m) return;
    const uri = this.uri(r); if (m.uri.getValue() !== uri) m.uri = uri;
    if (m.scale.getValue() !== (r.scale || 1)) m.scale = r.scale || 1;
    m.silhouetteColor = C.Color.fromCssColorString('#ff4d5e'); m.silhouetteSize = r.emerg ? 2.0 : 0.0;
  },
  ensure(r) {
    if (r.ent) return r.ent;
    const rotor = new C.NodeTransformationProperty({ rotation: new C.CallbackProperty(t => C.Quaternion.fromAxisAngle(C.Cartesian3.UNIT_Y, (t.secondsOfDay * 2 * Math.PI * 4.5) % (2 * Math.PI)), false) });
    r.ent = viewer.entities.add({
      position: new C.CallbackProperty(t => this.state(r, t).pos, false),
      orientation: new C.CallbackProperty(t => this.state(r, t).quat, false),
      model: { uri: this.uri(r), scale: r.scale || 1, environmentMapOptions: NO_ENV_MAP, minimumPixelSize: 26, maximumScale: 2.0e4, nodeTransformations: { rotor }, silhouetteColor: C.Color.fromCssColorString('#ff4d5e'), silhouetteSize: r.emerg ? 2.0 : 0.0 },
    });
    r.ent.air = r; r.pt.show = false; r.icon.show = false; this.pool.set(r.hex, r);
    return r.ent;
  },
  drop(r, force = false) {
    if (!r.ent || (!force && (r === Follow.obj || r === state.selected))) return;
    if (r === Follow.obj) Follow.stop();
    viewer.entities.remove(r.ent); r.ent = null; this.pool.delete(r.hex);
    const on = airShown(r); r.pt.show = on; r.icon.show = on;
  },
  refresh() {
    if (state.lookup) { for (const r of [...this.pool.values()]) this.drop(r); return; }   // look-up mode labels aircraft instead
    const want = new Set();
    if (camHeight() < this.ceiling) {
      const cam = camera.positionWC, near = [];
      for (const r of Air.map.values()) {
        if (!airShown(r) || !r.cur) continue;
        const d = C.Cartesian3.distance(C.Cartesian3.fromDegrees(r.cur.lon, r.cur.lat, r.alt || 0, C.Ellipsoid.WGS84, this._p), cam);
        if (d < this.range) near.push([d, r]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (const [, r] of near.slice(0, this.max)) want.add(r);
    }
    if (this.followed) want.add(this.followed);
    if (state.selected && state.selected.kind === 'air') want.add(state.selected);
    for (const r of [...this.pool.values()]) if (!want.has(r)) this.drop(r);
    for (const r of want) if (!r.ent && Air.map.has(r.hex)) this.ensure(r);
  },
  follow(r) { const ent = this.ensure(r); Follow.start(r, t => this.state(r, t).pos, (this.view[r.shape] || 38) * (0.6 + 0.4 * (r.scale || 1)), ent, 26); },
};
