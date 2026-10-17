// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The canvas renderer for moving objects and point sets, the layer registry + panel, and the feed scheduler.
import { $, C, FONT_MONO, Log, Store, debounce, esc, fmt, hexA, rad, toast } from './util.js';
import { map } from './mapview.js';
import { shipAt, shipKind, SHIP_KINDS, underway } from '../core/ais.js';
import { deadReckon } from '../core/geo.js';
import { exportRow } from '../app/save.js';

/* ============================================================ dynamic objects + static point sets, all drawn on one canvas */
export const Dyn = { air: new Map(), sats: [], ships: new Map(), balloons: new Map() };
export const Sel = { kind: null, obj: null, id: null };
/** Where an aircraft is drawn at `now`: its last fix carried along its track at its ground speed, for at most 150 s
 *  (core/geo.js deadReckon). [lat, lon]. The canvas, following and the airport boards all place planes this way. */
export function airAt(a, now = Date.now()) {
  const p = deadReckon({ lat: a.lat, lon: a.lon, gs: a.gs * 0.514444, track: a.track, ground: a.ground }, Math.min(150, (now - a.ts) / 1000 + (a.seen_pos || 0)));
  return [p.lat, p.lon];
}
const shipPos = { lat: 0, lon: 0, cog: null };
/** Moving things drawn where they are now (ships, transit): Movers.define(id, { layerId, kind, minZoom, at(o, now, out) →
 *  false to skip, else out = { lat, lon, hdg }, glyph(ctx, x, y, o, z, sel), tip(o), label(o) }), then Movers.items(id)
 *  is a Map the feed fills. The canvas redraws a few times a second while any are shown. */
export const Movers = {
  sets: {}, order: [],
  define(id, def) { this.sets[id] = { minZoom: 0, items: new Map(), ...def, id }; this.order.push(id); return this.sets[id].items; },
  items(id) { return this.sets[id].items; },
  shown() { for (const id of this.order) { const s = this.sets[id]; if (s.items.size && Layers.on(s.layerId)) return true; } return false; },
};
/** What a layer's "Export view" buttons save: layer id → () => its live items (objects with lat/lon, stamped by
 *  core/liveprov.js). Point layers need no entry (their Points set is read); moving ones register here. */
export const Exports = {};
/** A layer's items in the map's view now (the export buttons; app/save.js + core/export.js turn them into a file). */
export function layerItemsInView(d) {
  const b = map.getBounds(), inView = o => o && Number.isFinite(o.lat) && Number.isFinite(o.lon) && b.contains([o.lat, ((o.lon - b.getCenter().lng + 540) % 360) - 180 + b.getCenter().lng]);
  if (Exports[d.id]) return Exports[d.id]().filter(inView);
  const s = d.points && Points.sets[d.points];
  if (!s || map.getZoom() < s.minZoom) return [];
  return s.items.filter(i => i.obj && inView(i)).map(i => i.obj.lat == null ? Object.assign(Object.create(null), i.obj, { lat: i.lat, lon: i.lon }) : i.obj);
}
export const Points = { // static point layers: {id -> {layerId, minZoom, items:[{lat,lon,r,color,alpha,shape,kind,obj,tip}]}}
  sets: {}, order: [],
  define(id, layerId, { minZoom = 0 } = {}) { this.sets[id] = { id, layerId, minZoom, items: [] }; this.order.push(id); },
  set(id, items) { const s = this.sets[id]; if (!s) return; s.items = items; requestDraw(); },
  clear(id) { this.set(id, []); },
  find(id, pred) { const s = this.sets[id]; return s ? s.items.find(pred) : null; },
};
export const Glyphs = L.Layer.extend({
  onAdd(m) {
    this._map = m; const c = this._canvas = L.DomUtil.create('canvas', 'glyph-canvas leaflet-zoom-hide'); m.getPanes().overlayPane.appendChild(c);
    this._ctx = c.getContext('2d'); this._hits = [];
    m.on('moveend zoomend resize viewreset', this._reset, this); this._reset(); return this;
  },
  onRemove(m) { L.DomUtil.remove(this._canvas); m.off('moveend zoomend resize viewreset', this._reset, this); },
  _reset() {
    const m = this._map, size = m.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1), c = this._canvas;
    if (c.width !== size.x * dpr || c.height !== size.y * dpr) { c.width = size.x * dpr; c.height = size.y * dpr; c.style.width = size.x + 'px'; c.style.height = size.y + 'px'; } // reallocate only on a real size change
    c.style.display = ''; this._dpr = dpr; this.draw();
  },
  // the cursor inside a glyph beats being near one; among glyphs it is inside, the closest centre wins (ties go to the
  // top-most, which is scanned first); otherwise the nearest edge within 14 px
  hitTest(pt) { let best = null, bs = Infinity; const h = this._hits; for (let i = h.length - 1; i >= 0; i--) { const x = h[i]; const d = Math.hypot(x.x - pt.x, x.y - pt.y); if (d >= x.r + 14) continue; const s = d <= x.r ? d : 1e4 + d - x.r; if (s < bs) { bs = s; best = x; } } return best; },
  draw() {
    const m = this._map; if (!m || !this._canvas) return;
    L.DomUtil.setPosition(this._canvas, m.containerPointToLayerPoint([0, 0])); // the pane moves during a drag; we paint in container coords
    const ctx = this._ctx, dpr = this._dpr || 1, size = m.getSize(), z = m.getZoom(), now = Date.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size.x, size.y);
    const hits = this._hits = [];
    const b = m.getBounds(), west = b.getWest(), east = b.getEast(), cx = size.x / 2, cy = size.y / 2;
    const toPt = (lat, lon) => { // container points for lon and its wrapped copies that are on screen
      const out = []; for (const dl of [0, -360, 360]) { const L2 = lon + dl; if (L2 < west - 2 || L2 > east + 2) continue; const p = m.latLngToContainerPoint([lat, L2]); if (p.x > -30 && p.x < size.x + 30 && p.y > -30 && p.y < size.y + 30) out.push(p); } return out;
    };
    ctx.lineJoin = 'round'; ctx.font = `11px ${FONT_MONO}`; ctx.textBaseline = 'middle';
    const label = (x, y, text, color) => { ctx.fillStyle = 'rgba(4,7,10,.72)'; const w = ctx.measureText(text).width; ctx.fillRect(x + 8, y - 7, w + 6, 14); ctx.fillStyle = color; ctx.fillText(text, x + 11, y); };
    const ring = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.stroke(); };
    // ---- static point sets (drawn first, under the moving things)
    for (const id of Points.order) {
      const s = Points.sets[id]; if (!s.items.length || !Layers.on(s.layerId) || z < s.minZoom) continue;
      for (const it of s.items) {
        for (const p of toPt(it.lat, it.lon)) {
          const sel = !it.noSel && ((Sel.obj != null && Sel.obj === it.obj) || (Sel.id != null && it.kind === Sel.kind && it.obj != null && (it.obj.id ?? it.obj.hex) === Sel.id)); // by id too: feeds rebuild their objects each poll; noSel: part of something else (a runway end)
          const r = typeof it.r === 'function' ? it.r(z) : it.r;
          ctx.globalAlpha = it.alpha ?? .85;
          if (it.shape === 'tri') { ctx.beginPath(); ctx.moveTo(p.x, p.y - r - 1); ctx.lineTo(p.x + r, p.y + r * .7); ctx.lineTo(p.x - r, p.y + r * .7); ctx.closePath(); ctx.fillStyle = hexA(it.color, .5); ctx.fill(); ctx.strokeStyle = it.color; ctx.lineWidth = 1.2; ctx.stroke(); }
          else if (it.shape === 'sq') { ctx.fillStyle = it.color; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); }
          else { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = hexA(it.color, it.fillAlpha ?? .35); ctx.fill(); if (r >= 2.5 || it.stroke) { ctx.strokeStyle = it.color; ctx.lineWidth = it.lw || 1; ctx.stroke(); } }
          if (it.halo) { ctx.beginPath(); ctx.arc(p.x, p.y, it.halo, 0, Math.PI * 2); ctx.strokeStyle = hexA(it.color, .35); ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]); }
          ctx.globalAlpha = 1;
          if (sel) ring(p.x, p.y, r + 6);
          if (it.label && (sel || z >= (it.labelZoom ?? 6))) label(p.x, p.y, it.label, sel ? C.accent : hexA(it.color, .95));
          if (it.kind && it.obj != null) hits.push({ x: p.x, y: p.y, r: Math.max(r, 3), kind: it.kind, obj: it.obj, tip: it.tip });   // a dot with no card (the plate-reader cloud) is not a target
        }
      }
    }
    // ---- movers (ships, transit): placed at `now` by their own motion model
    const at = { lat: 0, lon: 0, hdg: null };
    for (const id of Movers.order) {
      const ms = Movers.sets[id]; if (!ms.items.size || !Layers.on(ms.layerId) || z < ms.minZoom) continue;
      for (const o of ms.items.values()) {
        if (ms.at(o, now, at) === false) continue;
        for (const p of toPt(at.lat, at.lon)) {
          const sel = Sel.kind === ms.kind && Sel.id === o.id;
          ms.glyph(ctx, p.x, p.y, o, z, sel, at.hdg);
          if (sel) ring(p.x, p.y, 10);
          const lb = ms.label && ms.label(o, z, sel); if (lb) label(p.x, p.y, lb, sel ? C.accent : 'rgba(230,240,248,.9)');
          hits.push({ x: p.x, y: p.y, r: 5, kind: ms.kind, obj: o, tip: ms.tip(o) });
        }
      }
    }
    // ---- satellites
    if (Layers.on('sats')) {
      const showNames = Dyn.sats.length <= 80 || z >= 5;
      for (const s of Dyn.sats) {
        if (s.lat == null) continue;
        for (const p of toPt(s.lat, s.lon)) {
          const sel = Sel.kind === 'sat' && Sel.id === s.id;
          const col = s.dim ? hexA(C.sat, .55) : C.sat; const r = s.dim ? 2 : 3;
          ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(p.x, p.y - r - 1); ctx.lineTo(p.x + r + 1, p.y); ctx.lineTo(p.x, p.y + r + 1); ctx.lineTo(p.x - r - 1, p.y); ctx.closePath(); ctx.fill();
          if (!s.dim) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x - r - 4, p.y); ctx.lineTo(p.x + r + 4, p.y); ctx.stroke(); }
          if (sel) ring(p.x, p.y, 9);
          if ((showNames && !s.dim) || sel || s.star) label(p.x, p.y, s.name, sel ? C.accent : hexA(C.sat, .9));
          hits.push({ x: p.x, y: p.y, r: 4, kind: 'sat', obj: s, tip: `${s.name} · ${s.alt ? fmt.n(s.alt) + ' km' : ''}` });
        }
      }
    }
    // ---- ships: glyphs from zoom 5, one cluster bubble per source below that
    const SHIP_LAYERS = { Digitraffic: 'ships_fi', 'aisstream.io': 'ships_ws' }; // ship src -> the layer that owns it
    const shipOn = s => !SHIP_LAYERS[s.src] || Layers.on(SHIP_LAYERS[s.src]);
    if (Dyn.ships.size && Layers.on('ships_fi') || Dyn.ships.size && Layers.on('ships_ws')) {
      if (z >= 5) {
        for (const s of Dyn.ships.values()) {
          if (!shipOn(s)) continue;
          const at = shipAt(s, (now - s.ts) / 1000, shipPos);   // along its course between reports (core/ais.js, as on the globe)
          const col = s.type != null ? SHIP_KINDS[shipKind(s.type)][1] : C.ship;
          for (const p of toPt(at.lat, at.lon)) {
            const sel = Sel.kind === 'ship' && Sel.id === s.id;
            const hd = (s.heading != null && s.heading < 360) ? s.heading : (at.cog ?? s.cog ?? 0);
            if (s.sog != null && !underway(s)) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2); ctx.fill(); }
            else { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rad(hd)); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.5, -1); ctx.lineTo(3.5, 5); ctx.lineTo(-3.5, 5); ctx.lineTo(-3.5, -1); ctx.closePath(); ctx.fill(); ctx.restore(); }
            if (sel) ring(p.x, p.y, 10);
            if (z >= 9 || sel) label(p.x, p.y, s.name || String(s.id), sel ? C.accent : hexA(C.ship, .9));
            hits.push({ x: p.x, y: p.y, r: 5, kind: 'ship', obj: s, tip: `${s.name || 'MMSI ' + s.id}${s.sog != null ? ' · ' + s.sog + ' kt' : ''}` });
          }
        }
      } else {
        // the bubble sits on the source's busiest 5° cell: the mean of a worldwide feed can land on empty ocean or land
        const groups = {}; for (const s of Dyn.ships.values()) { if (!shipOn(s)) continue; const g = groups[s.src] || (groups[s.src] = { n: 0, cells: new Map() }); g.n++; const k = Math.floor(s.lat / 5) * 1000 + Math.floor(s.lon / 5); const c = g.cells.get(k) || { n: 0, lat: 0, lon: 0 }; c.n++; c.lat += s.lat; c.lon += s.lon; g.cells.set(k, c); }
        for (const [src, g] of Object.entries(groups)) { let c = null; for (const x of g.cells.values()) if (!c || x.n > c.n) c = x; const lat = c.lat / c.n, lon = c.lon / c.n; for (const p of toPt(lat, lon)) { ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fillStyle = hexA(C.ship, .25); ctx.fill(); ctx.strokeStyle = C.ship; ctx.lineWidth = 1.5; ctx.stroke(); label(p.x, p.y, `${fmt.n(g.n)} ships · zoom in`, hexA(C.ship, .95)); hits.push({ x: p.x, y: p.y, r: 10, kind: 'cluster', obj: { lat, lon, z: 6, text: `${g.n} vessels from ${src}` }, tip: `${g.n} vessels · click to zoom` }); } }
      }
    }
    // ---- balloons
    if (Dyn.balloons.size && z >= 4 && Layers.on('balloons')) {
      for (const s of Dyn.balloons.values()) {
        for (const p of toPt(s.lat, s.lon)) {
          const sel = Sel.kind === 'balloon' && Sel.id === s.id;
          ctx.fillStyle = C.bal; ctx.beginPath(); ctx.arc(p.x, p.y - 3, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = C.bal; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + 5); ctx.stroke();
          if (sel) ring(p.x, p.y, 10);
          if (z >= 6 || sel) label(p.x, p.y, `${s.id} ${fmt.n(s.alt)} m`, sel ? C.accent : hexA(C.bal, .9));
          hits.push({ x: p.x, y: p.y, r: 5, kind: 'balloon', obj: s, tip: `Radiosonde ${s.id} · ${fmt.n(s.alt)} m` });
        }
      }
    }
    // ---- aircraft (dead-reckoned), with a label budget so dense areas stay readable
    if (Dyn.air.size) {
      const size0 = z >= 9 ? 9 : z >= 6 ? 7 : 5.5;
      const labelsOn = Layers.opt('air_labels'); const cands = [];
      // draw only what an enabled layer owns (ingest tags each record with the feeds that saw it); a disable() purge can
      // race an in-flight fetch that re-adds the aircraft. Search hits, unknown tags and the selection always show.
      const AIR_TAGS = { local: 'air_local', mil: 'air_mil', sqk: 'air_emg', opensky: 'air_opensky' };
      const airOn = a => { if ((Sel.kind === 'air' && Sel.id === a.hex) || (a.emerg && Layers.on('air_emg')) || !a.tags) return true; for (const t of a.tags) { const ly = AIR_TAGS[t]; if (!ly || Layers.on(ly)) return true; } return !a.tags.size; };
      for (const a of Dyn.air.values()) {
        if (a.lat == null || !airOn(a)) continue;
        const [lat, lon] = airAt(a, now);
        for (const p of toPt(lat, lon)) {
          const sel = Sel.kind === 'air' && Sel.id === a.hex;
          const col = a.emerg ? C.emg : a.mil ? C.mil : a.lowNic ? '#ff9ad5' : C.civ;
          if (a.ground) { ctx.fillStyle = hexA(col, .6); ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
          else if (z < 5 && !a.mil && !a.emerg && !sel) { ctx.fillStyle = hexA(col, .8); ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
          else drawPlane(ctx, p.x, p.y, a.track ?? 0, col, a.mil ? size0 + 1 : size0, sel || a.emerg);
          if (a.emerg) { ctx.strokeStyle = hexA(C.emg, .35 + .35 * Math.abs(Math.sin(now / 300))); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.stroke(); }
          if (sel) ring(p.x, p.y, 13);
          const alt = a.ground ? 'GND' : (a.alt != null ? 'FL' + String(Math.round(a.alt / 100)).padStart(3, '0') : '');
          const text = `${a.flight || a.r || a.hex} ${alt}`.trim();
          if (sel || a.emerg) label(p.x, p.y, text, sel ? C.accent : hexA(col, .95));
          else if (labelsOn && (z >= 9 || (a.mil && z >= 5))) cands.push({ x: p.x, y: p.y, text, col: hexA(col, .95), pri: a.mil ? 0 : 1, d: Math.hypot(p.x - cx, p.y - cy) });
          hits.push({ x: p.x, y: p.y, r: size0, kind: 'air', obj: a, tip: `${text} · ${a.t || a.desc || ''}${a.mil ? ' · military' : ''}` });
        }
      }
      if (cands.length) { cands.sort((p, q) => p.pri - q.pri || p.d - q.d); const budget = z >= 11 ? 400 : z >= 9 ? 160 : 90; for (const c of cands.slice(0, budget)) label(c.x, c.y, c.text, c.col); }
    }
  }
});
export function drawPlane(ctx, x, y, track, color, s, emph) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rad(track)); ctx.beginPath();
  ctx.moveTo(0, -s); ctx.lineTo(s * .22, -s * .35); ctx.lineTo(s, s * .12); ctx.lineTo(s, s * .32); ctx.lineTo(s * .2, s * .08); ctx.lineTo(s * .2, s * .58);
  ctx.lineTo(s * .48, s * .8); ctx.lineTo(s * .48, s * .95); ctx.lineTo(0, s * .78); ctx.lineTo(-s * .48, s * .95); ctx.lineTo(-s * .48, s * .8); ctx.lineTo(-s * .2, s * .58);
  ctx.lineTo(-s * .2, s * .08); ctx.lineTo(-s, s * .32); ctx.lineTo(-s, s * .12); ctx.lineTo(-s * .22, -s * .35); ctx.closePath();
  ctx.fillStyle = color; ctx.fill(); if (emph) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); } ctx.restore();
}

/* ============================================================ layer registry + UI */
export const Layers = {
  defs: [], byId: {}, state: Store.get('layers', {}),
  opts: Object.assign({ air_labels: true, sat_groups: ['stations', 'visual'], sat_tracks: true, air_src: 'adsb.lol', cam_src: ['tfl', 'nyc', 'caltrans', 'sg', 'finland', 'deldot', 'iowa', 'missouri', 'norway', 'bc', 'calgary', 'hk'], news_q: 'military OR missile OR airstrike OR protest OR explosion', quake_feed: '2.5_day', ships_src: ['fi'] }, Store.get('opts', {})),
  migrate() { if (!this.opts.cam_v2) { this.opts.cam_src = [...new Set([...(this.opts.cam_src || []), 'singapore', 'finland'])]; this.opts.cam_v2 = true; Store.set('opts', this.opts); }
    if (!this.opts.cam_v3) { this.opts.cam_src = [...new Set([...(this.opts.cam_src || []).map(x => x === 'singapore' ? 'sg' : x), 'deldot', 'iowa', 'missouri', 'norway', 'bc', 'calgary', 'hk'])]; this.opts.cam_v3 = true; Store.set('opts', this.opts); } },   // v3: the globe's networks (core/cameras.js)
  add(def) { if (!this._migrated) { this._migrated = true; this.migrate(); } this.defs.push(def); this.byId[def.id] = def; def.on = (def.id in this.state) ? !!this.state[def.id] : !!def.default; if (def.guard && def.on && !this.acked(def)) { def.on = false; this.state[def.id] = false; } return def; },
  /** A layer with a `guard` (a warning to read first) can only be switched on after the reader has accepted it, once per browser session. */
  _acked: new Set(),   // this page load, even where sessionStorage is blocked (accepting would otherwise re-open the warning for ever)
  acked(d) { if (this._acked.has(d.id)) return true; try { return sessionStorage.getItem('oo.ack.' + d.id) === '1'; } catch (e) { return false; } },
  ack(d) { this._acked.add(d.id); try { sessionStorage.setItem('oo.ack.' + d.id, '1'); } catch (e) { /* private mode: asked again next load */ } },
  on(id) { const d = this.byId[id]; return !!(d && d.on); },
  opt(k) { return this.opts[k]; },
  setOpt(k, v) { this.opts[k] = v; Store.set('opts', this.opts); },
  set(id, on, opts = {}) { const d = this.byId[id]; if (!d || d.on === on) return;
    if (on && d.guard && !this.acked(d)) {   // not before the warning has been read; presets and saved states never skip it
      UI.refreshLayer(d); if (!opts.silent) UI.guard(d).then(ok => { if (ok) { this.ack(d); this.set(id, true); } else UI.refreshLayer(d); }); return;
    }
    d.on = on; this.state[id] = on; Store.set('layers', this.state); if (on) { d.enable && d.enable(); if (d.feed) { d.feed.nextAt = 0; d.feed.fails = 0; d.feed.notCarried = false; } } else { d.disable && d.disable(); if (d.points) Points.clear(d.points); if (d.feed) { d.feed.status = 'idle'; d.feed.count = 0; } } UI.refreshLayer(d); glyphs.draw(); },
  apply(onIds) { for (const d of this.defs) this.set(d.id, onIds.includes(d.id), { silent: true }); },
};
export const UI = {
  /** The warning a guarded layer shows before it can be switched on: resolves true on "accept", false on cancel, Esc or a click outside. */
  guard(d) {
    return new Promise(resolve => {
      const g = d.guard, prev = document.activeElement, root = document.createElement('div'); root.className = 'guard-back';
      root.innerHTML = `<div class="guard" role="alertdialog" aria-modal="true" aria-labelledby="guardT"><h3 id="guardT">${esc(g.title)}</h3><div class="guard-body" tabindex="0">${g.body.map(x => `<h4>${esc(x.h)}</h4><p>${esc(x.p)}</p>`).join('')}</div><div class="guard-act"><button type="button" class="btn" data-no>Keep them off</button><button type="button" class="btn small" data-yes>${esc(g.accept)}</button></div></div>`;
      const done = ok => { document.removeEventListener('keydown', key, true); root.remove(); if (prev && prev.focus) prev.focus(); resolve(ok); };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } else if (e.key === 'Tab') { const b = [...root.querySelectorAll('.guard-body, button')]; /* the text too: keyboard users must be able to scroll what they accept */ const i = b.indexOf(document.activeElement); e.preventDefault(); b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus(); } };
      root.addEventListener('click', e => { if (e.target === root || e.target.closest('[data-no]')) done(false); else if (e.target.closest('[data-yes]')) done(true); });
      document.addEventListener('keydown', key, true); document.body.appendChild(root); root.querySelector('[data-no]').focus();   // the safe choice has the focus
    });
  },
  groups: ['Air', 'Space', 'Sea & sky', 'Ground', 'Cities', 'Weather & space weather', 'Infrastructure'],
  build() {
    const root = $('#layers'); root.innerHTML = '';
    for (const g of this.groups) {
      const defs = Layers.defs.filter(d => d.group === g); if (!defs.length) continue;
      const det = document.createElement('details'); det.className = 'group'; det.open = Store.get('grp.' + g, g === 'Air' || g === 'Space');
      det.addEventListener('toggle', () => Store.set('grp.' + g, det.open));
      det.innerHTML = `<summary><span class="label">${esc(g)}</span><span class="gcount" data-g="${esc(g)}"></span></summary>`;
      for (const d of defs) {
        const row = document.createElement('label'); row.className = 'layer'; row.dataset.id = d.id;
        row.innerHTML = `<input type="checkbox" ${d.on ? 'checked' : ''} id="ly_${d.id}"><span class="sw ${d.shape || ''}" style="--c:${d.color}"></span><span class="name">${esc(d.name)}<small class="desc">${esc(d.desc || '')}</small></span><span class="st"><span class="cnt"></span><span class="dot idle"></span></span>`;
        row.querySelector('input').addEventListener('change', e => Layers.set(d.id, e.target.checked));
        det.appendChild(row);
        if (d.sub) { const sr = document.createElement('div'); sr.className = 'subrow'; sr.dataset.sub = d.id; det.appendChild(sr); d.sub(sr); }
        if (d.live !== false && (Exports[d.id] || (d.points && !/^(airports|landing)$/.test(d.id)))) {   // live layers: save what's in view, with provenance
          const er = exportRow(() => layerItemsInView(d), d.name, msg => toast(msg)); er.dataset.exp = d.id; er.classList.add('subrow'); det.appendChild(er);
        }
      }
      root.appendChild(det);
    }
    for (const d of Layers.defs) this.refreshLayer(d);
    this.refreshGroups();
  },
  refreshGroups() { for (const g of this.groups) { const el = $(`.gcount[data-g="${g}"]`); if (el) { const defs = Layers.defs.filter(d => d.group === g); el.textContent = `${defs.filter(d => d.on).length}/${defs.length}`; } } },
  refreshLayer(d) {
    const row = $(`.layer[data-id="${d.id}"]`); if (!row) return;
    const f = d.feed; const st = f ? (d.on ? f.status : 'idle') : (d.on ? 'ok' : 'idle');
    row.querySelector('input').checked = !!d.on;
    row.querySelector('.dot').className = 'dot ' + st;
    row.querySelector('.cnt').textContent = (d.on && f && f.count) ? fmt.n(f.count) : '';
    row.classList.toggle('err', !!(d.on && f && f.status === 'error'));
    const desc = row.querySelector('.desc'); desc.textContent = (d.on && f && f.status === 'error') ? ('✕ ' + f.err) : (d.desc || '');
    row.title = (f && f.lastOk) ? `Last update ${fmt.ago(f.lastOk)} ago` : '';
    const sub = $(`.subrow[data-sub="${d.id}"]`); if (sub) sub.style.display = d.on ? '' : 'none';
    const exp = $(`.export-row[data-exp="${d.id}"]`); if (exp) exp.style.display = d.on ? '' : 'none';
    this.refreshGroups();
  },
  pills(container, items, getOn, setOn) {
    container.innerHTML = '';
    for (const it of items) { const b = document.createElement('button'); b.type = 'button'; b.className = 'pill' + (getOn(it.id) ? ' on' : ''); b.textContent = it.name; b.title = it.title || ''; b.addEventListener('click', () => { setOn(it.id, !b.classList.contains('on')); b.classList.toggle('on'); }); container.appendChild(b); }
  },
};

/* ============================================================ feed scheduler */
export const glyphs = new Glyphs().addTo(map);
export let drawQueued = false;
export function requestDraw() { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; glyphs.draw(); }); }
setInterval(() => { if (!document.hidden && (Dyn.air.size || Dyn.sats.length || Dyn.ships.size || Movers.shown())) requestDraw(); }, 500);
export const Feeds = { list: [], paused: false };
export function feed(layerDef, { interval, fetch, errorInterval, viewDependent = false, minZoom = 0, startDelay = 0 }) {
  // errors retry after errorInterval (default 30 s-2 min), doubling per consecutive failure up to the normal interval
  // (at least 5 min, at most 30 min): a daily feed doesn't sit red for a day, a rate-limited fast one backs off
  const f = { id: layerDef.id, interval, errorInterval: errorInterval || Math.min(Math.max(interval, 30), 120), fetch, status: 'idle', count: 0, lastOk: 0, err: '', fails: 0, retry: 0, nextAt: Date.now() + startDelay * 1000, running: false, viewDependent, minZoom, layer: layerDef };
  layerDef.feed = f; Feeds.list.push(f); return f;
}
export async function runFeed(f, force = false) {
  const d = f.layer; if (!d.on) return;
  if (f.running) { if (force) { f.nextAt = 0; f.forceNext = true; } return; } // forced while busy: run again right after
  force = force || !!f.forceNext; f.forceNext = false;
  if (map.getZoom() < f.minZoom) { f.status = 'idle'; f.err = ''; UI.refreshLayer(d); f.nextAt = Date.now() + 5000; return; }
  f.running = true; f.status = 'loading'; UI.refreshLayer(d);
  f.nextAt = Infinity; // a reschedule made during the fetch (pan nudge, re-enable, the fetch itself) lowers this and is kept below
  try { await f.fetch(force); f.status = 'ok'; f.lastOk = Date.now(); f.err = ''; f.fails = 0; f.notCarried = false; f.nextAt = Math.min(f.nextAt, Date.now() + f.interval * 1000); }
  catch (e) {
    const msg = e.message || String(e); f.status = 'error'; f.fails++;
    // the website's relay refused this feed's host (util.js Net.fetch): retrying can't help, so it waits for a re-enable or a
    // custom relay (setup.js); nextAt stays at the Infinity set above unless something rescheduled it during the fetch
    if (e.notCarried) { if (/^air_/.test(f.id) && !Feeds.airNotCarried) { Feeds.airNotCarried = true; Log.info('No live aircraft on the website: they need the free download'); }   // once per visit: the boot line (main.js) sets the flag too
      f.notCarried = true; if (msg !== f.err) Log.warn(`${d.name}: ${msg}`); f.err = msg; return; }
    f.retry = Math.min(f.errorInterval * 2 ** (f.fails - 1), Math.max(f.errorInterval, Math.min(Math.max(f.interval, 300), 1800)));
    f.nextAt = Math.min(f.nextAt, Date.now() + f.retry * 1000); if (msg !== f.err) Log.error(`${d.name}: ${msg}`); f.err = msg;
  }
  finally { f.running = false; if (d.on) UI.refreshLayer(d); requestDraw(); }
}
setInterval(() => { // hidden tab: keep polling at a third of the cadence so alerts still arrive; visible tab: full cadence
  if (Feeds.paused) return; const now = Date.now(), hidden = document.hidden;
  for (const f of Feeds.list) if (f.layer.on && !f.running && now >= f.nextAt + (hidden ? 2 * (f.status === 'error' ? f.retry : f.interval) * 1000 : 0)) runFeed(f);
}, 1000);
map.on('moveend', debounce(() => { for (const f of Feeds.list) if (f.viewDependent && f.layer.on && !f.notCarried) f.nextAt = Math.min(f.nextAt, Date.now() + 1500); }, 600));
$('#btnPause').addEventListener('click', () => { Feeds.paused = !Feeds.paused; $('#btnPause').textContent = Feeds.paused ? 'Resume' : 'Pause'; $('#btnPause').classList.toggle('primary', Feeds.paused); Log.warn(Feeds.paused ? 'All feeds paused' : 'Feeds resumed'); });
