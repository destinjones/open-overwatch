// Flight trails: where a plane has been in the last half hour, as a line coloured by altitude (grey on the ground,
// orange low, through green and blue to violet at cruise). Every fix that arrives is recorded (the 60-second military
// feed and fresh look-ups; the 15-minute OpenSky snapshot is too sparse to count), and the trail is drawn for the plane
// you follow or have open, plus any you pin from its card. In the download version the planes you watch are asked for
// a fresh fix every 10 s (20 s for the rest; adsb.lol through the local helper, backing off for 2 min when it says too
// many), so their trails fill in as you watch; the website has no live aircraft (the feeds refuse websites), so it has
// no trails. adsb.lol's trace files would give the history before you looked, but its server answers them only on its
// own map, so a trail starts when the plane is first heard here (military planes: from the 60-second feed).
import { C, getJSON, RELAY, PHONE, store } from './env.js';
import { scene } from './viewer.js';
import { state, hooks } from './state.js';
import { Follow } from './follow.js';
import { Air, displayAt, renderHeight, fromAdsb, airShown } from './aircraft.js';
import { Trail, altColor, trailStats, flatM } from '../core/trail.js';

const API = 'https://api.adsb.lol/v2/hex/';
const MAX_DRAWN = PHONE ? 3 : 8, MAX_RECORDED = 1500;
const prims = scene.primitives.add(new C.PrimitiveCollection());

export const Trails = {
  minutes: store.get('trailMin', 30),
  on: store.get('trails', true),
  map: new Map(),        // hex -> Trail
  pinned: new Set(),     // hexes pinned from their cards
  drawn: new Map(),      // hex -> { prim, version, at }
  /** Record a fix from a feed record (called from Air.upsert via hooks.airFix). */
  record(r) {
    if (r.src === 'OpenSky' && r !== Follow.obj && r !== state.selected && !this.pinned.has(r.hex)) return;   // 15-min snapshots draw straight lines through turns
    let t = this.map.get(r.hex);
    if (!t) {
      if (this.map.size >= MAX_RECORDED) this.dropOldest();
      t = new Trail({ minutes: this.minutes, maxPoints: PHONE ? 300 : 600 }); this.map.set(r.hex, t);
    }
    const h = renderHeight(r, { lat: r.lat, lon: r.lon, alt: r.alt || 0, altE: r.ground || r.altG == null ? null : r.altG }, false);
    t.add({ t: r.ts, lat: r.lat, lon: r.lon, alt: r.alt || 0, h, ground: r.ground });
  },
  dropOldest() {
    let old = null, oldT = Infinity;
    for (const [k, t] of this.map) { const last = t.pts[t.pts.length - 1]; if (!last || last.t < oldT) { old = k; oldT = last ? last.t : -1; } }
    if (old) this.map.delete(old);
  },
  /** The planes whose trails are drawn: followed, selected, pinned (newest first, capped). */
  watched() {
    const out = [];
    const add = r => { if (r && r.kind === 'air' && !out.includes(r) && Air.map.get(r.hex) === r) out.push(r); };
    add(Follow.obj); add(state.selected);
    for (const hex of this.pinned) add(Air.map.get(hex));
    return out.slice(0, MAX_DRAWN);
  },
  get(r) { return this.map.get(r.hex) || null; },
  stats(r) { const t = this.get(r); return t && t.length > 1 ? trailStats(t.pts) : null; },
  pin(r, on = !this.pinned.has(r.hex)) { if (on) this.pinned.add(r.hex); else this.pinned.delete(r.hex); this.draw(true); return on; },
  setMinutes(m) { this.minutes = m; store.set('trailMin', m); for (const t of this.map.values()) { t.minutes = m; t.trim(Date.now()); } this.draw(true); },
  setOn(on) { this.on = on; store.set('trails', on); this.draw(true); },

  /** Rebuild the drawn lines whose trails changed (and the last stretch to where the plane is drawn now). */
  draw(force = false) {
    const want = this.on ? this.watched().filter(r => airShown(r)) : [], keep = new Set(want.map(r => r.hex)), now = Date.now();
    for (const [hex, d] of this.drawn) if (!keep.has(hex)) { prims.remove(d.prim); this.drawn.delete(hex); }
    for (const r of want) {
      const t = this.map.get(r.hex); if (!t) continue;
      t.trim(now);
      const d = this.drawn.get(r.hex);
      if (!force && d && d.version === t.version && now - d.at < 1000) continue;
      const pts = t.draw(PHONE ? 40 : 20);
      const tip = displayAt(r, now), tipH = renderHeight(r, tip, false);
      const all = pts.concat(flatM(pts[pts.length - 1] || tip, tip) > 5 ? [{ lat: tip.lat, lon: tip.lon, alt: tip.alt, h: tipH, ground: r.ground }] : []);
      if (d) { prims.remove(d.prim); this.drawn.delete(r.hex); }
      if (all.length < 2) continue;
      const positions = all.map(p => C.Cartesian3.fromDegrees(p.lon, p.lat, (p.h ?? p.alt) + (p.ground ? 2 : 0)));
      const colors = all.map(p => { const [cr, cg, cb] = altColor(p.alt, p.ground); return C.Color.fromBytes(cr, cg, cb, 235); });
      const prim = new C.Primitive({
        geometryInstances: new C.GeometryInstance({ geometry: new C.PolylineGeometry({ positions, colors, colorsPerVertex: true, width: PHONE ? 3 : 3.5, arcType: C.ArcType.NONE }) }),
        appearance: new C.PolylineColorAppearance({ translucent: true }), asynchronous: false,
      });
      prims.add(prim); this.drawn.set(r.hex, { prim, version: t.version, at: now });
    }
  },
  /** Fresh fixes for the watched planes (download version): every 10 s for the followed one, 20 s for the rest. */
  backoff: 0,
  async poll() {
    if (!RELAY || !this.on || document.hidden || this.busy || Date.now() < this.backoff) return;
    this.busy = true; try { await this._poll(); } finally { this.busy = false; }
  },
  async _poll() {
    const now = Date.now();
    for (const r of this.watched()) {
      if (r.mil && now - r.ts < 60e3 && r !== Follow.obj) continue;   // the military feed keeps it fresh enough
      const every = r === Follow.obj ? 10e3 : 20e3; if (now - (r._polled || 0) < every || now - r.ts < every / 2) continue;
      r._polled = now;
      const d = await getJSON(API + r.hex, { relay: true, timeout: 8000 }).catch(() => { this.backoff = Date.now() + 120e3; return null; }), at = Date.now();
      if (!d) return;
      const a = d && (d.ac || []).find(x => x.hex === r.hex && x.lat != null && x.lon != null);
      if (a) Air.upsert(fromAdsb(a, at, r.mil || !!(a.dbFlags & 1)));
    }
  },
};
hooks.airFix = r => Trails.record(r);
setInterval(() => Trails.draw(), 1000);
setInterval(() => Trails.poll(), 2500);
