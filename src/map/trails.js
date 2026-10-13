// Flight trails on the 2D map, as on the globe (core/trail.js): where a plane has been in the last 10, 30 or 60
// minutes, coloured by altitude (grey on the ground, orange low, through green and blue to violet at cruise). Every
// fix the ADS-B feeds bring is recorded (OpenSky's 15-minute snapshots would draw straight lines through turns, so
// they are not); the trail is drawn for the plane whose card is open, the one followed, and any pinned from a card
// ("Trail" or "Pin trail"), with the last stretch to where the plane is drawn now. The card says how far it went and
// how much it climbed, and copies the trail as GeoJSON with times and altitudes.
import { $, PHONE, Store, esc, fmt, late, toast } from './util.js';
import { map, vecRenderer } from './mapview.js';
import { Dyn, Sel, airAt } from './engine.js';
import { Detail } from './detail.js';
import { Air } from './aircraft.js';
import { Trail, altColor, altRampCss, trailStats, trailGeoJSON, flatM } from '../core/trail.js';

const FT = 0.3048, MAX_RECORDED = 1500, MAX_DRAWN = PHONE.matches ? 3 : 8;
const css = ([r, g, b]) => `rgb(${r},${g},${b})`;

export const Trails = {
  minutes: [10, 30, 60].includes(Store.get('trailMin', 30)) ? Store.get('trailMin', 30) : 30,
  map: new Map(),       // hex -> Trail
  pinned: new Set(),    // hexes pinned from their cards
  group: L.layerGroup().addTo(map),
  drawnKey: '',
  /** A fix from the feeds (aircraft.js calls Air.onFix for every record it ingests). */
  record(a) {
    if (a.lat == null || a.src === 'opensky') return;
    let t = this.map.get(a.hex);
    if (!t) {
      if (this.map.size >= MAX_RECORDED) this.dropOldest();
      t = new Trail({ minutes: this.minutes, maxPoints: PHONE.matches ? 300 : 600 }); this.map.set(a.hex, t);
    }
    t.add({ t: a.ts - (a.seen_pos || 0) * 1000, lat: a.lat, lon: a.lon, alt: a.ground ? 0 : (a.alt ?? 0) * FT, ground: !!a.ground });
  },
  dropOldest() {
    let old = null, oldT = Infinity;
    for (const [k, t] of this.map) { const last = t.pts[t.pts.length - 1]; if (!last || last.t < oldT) { old = k; oldT = last ? last.t : -1; } }
    if (old) this.map.delete(old);
  },
  /** The planes whose trails are drawn: the open card, the followed one, the pinned (capped). */
  watched() {
    const out = [], add = hex => { const a = hex && Dyn.air.get(hex); if (a && !out.includes(a)) out.push(a); };
    if (Sel.kind === 'air') add(Sel.id);
    add(Air.following);
    for (const hex of this.pinned) add(hex);
    return out.slice(0, MAX_DRAWN);
  },
  stats(a) { const t = this.map.get(a.hex); return t && t.length > 1 ? trailStats(t.pts) : null; },
  /** Pin or unpin a plane's trail; returns its number of fixes. */
  pin(hex, on = !this.pinned.has(hex)) { if (on) this.pinned.add(hex); else this.pinned.delete(hex); this.draw(true); const t = this.map.get(hex); return t ? t.length : 0; },
  setMinutes(m) { this.minutes = m; Store.set('trailMin', m); for (const t of this.map.values()) { t.minutes = m; t.trim(Date.now()); } this.draw(true); },
  /** Redraw: one short polyline per run of segments of the same colour (a 30-minute trail is a few dozen). */
  draw(force = false) {
    const now = Date.now(), want = this.watched(), key = want.map(a => { const t = this.map.get(a.hex); return `${a.hex}:${t ? t.version : 0}`; }).join('|') + '|' + Math.round(now / 4000);
    if (!force && key === this.drawnKey) return;
    this.drawnKey = key; this.group.clearLayers();
    for (const a of want) {
      const t = this.map.get(a.hex); if (!t) continue;
      t.trim(now);
      const pts = t.draw(20), [lat, lon] = airAt(a, now), tip = { lat, lon, alt: a.ground ? 0 : (a.alt ?? 0) * FT, ground: !!a.ground };
      const all = pts.length && flatM(pts[pts.length - 1], tip) > 5 ? pts.concat([tip]) : pts;
      if (all.length < 2) continue;
      let run = [[all[0].lat, all[0].lon]], col = css(altColor(all[0].alt, all[0].ground));
      const flush = () => { if (run.length > 1) L.polyline(run, { color: col, weight: 3, opacity: .9, interactive: false, renderer: vecRenderer }).addTo(this.group); };
      for (let i = 1; i < all.length; i++) {
        const c = css(altColor(all[i - 1].alt, all[i - 1].ground));
        if (c !== col) { flush(); run = [[all[i - 1].lat, all[i - 1].lon]]; col = c; }
        let lo = all[i].lon; const prev = run[run.length - 1][1];
        while (lo - prev > 180) lo -= 360; while (prev - lo > 180) lo += 360;   // across the date line: keep the line short
        run.push([all[i].lat, lo]);
      }
      flush();
    }
  },
  /** The trail section of an aircraft card (aircraft.js puts it under the aviation section). */
  html(a) {
    const s = this.stats(a), pinned = this.pinned.has(a.hex);
    const what = s ? `${Math.round(s.minutes)} min · ${fmt.n(s.km)} km${s.climbM > 30 ? ` · climbed ${fmt.n(s.climbM / FT)} ft` : ''}${s.descentM > 30 ? ` · descended ${fmt.n(s.descentM / FT)} ft` : ''}` : 'starts with the next fix';
    return `<div class="ac-trail"><span class="ac-ramp" style="background:${altRampCss()}" title="Altitude: ground grey, orange low, violet at 40,000 ft"></span>`
      + `<span class="note">Trail (last ${this.minutes} min): ${esc(what)}</span><span class="ac-tbtns">`
      + `<button type="button" class="btn small" data-tr="pin">${pinned ? 'Unpin trail' : 'Pin trail'}</button>`
      + (s ? '<button type="button" class="btn small" data-tr="geo" title="Copy the trail as GeoJSON (with times and altitudes)">Copy GeoJSON</button>' : '')
      + `<select data-tr="min" aria-label="Trail length">${[10, 30, 60].map(m => `<option value="${m}" ${m === this.minutes ? 'selected' : ''}>${m} min</option>`).join('')}</select></span></div>`;
  },
};
Air.onFix = a => Trails.record(a);
late.Trails = Trails;
setInterval(() => { if (!document.hidden) Trails.draw(); }, 1000);

// the card's buttons (the panel re-renders every 2 s, so they are handled where they land)
$('#detail').addEventListener('click', e => {
  const b = e.target.closest('[data-tr]'); if (!b || Sel.kind !== 'air' || b.tagName === 'SELECT') return;
  const a = Dyn.air.get(Sel.id); if (!a) return;
  if (b.dataset.tr === 'pin') { Trails.pin(a.hex); Detail.render(); }
  else if (b.dataset.tr === 'geo') {
    const t = Trails.map.get(a.hex), g = t && trailGeoJSON(t.pts, { callsign: (a.flight || '').trim(), hex: a.hex, type: a.t || '', source: a.src });
    if (!g) return;
    navigator.clipboard.writeText(JSON.stringify(g)).then(() => toast(`Copied ${g.geometry.coordinates.length} points as GeoJSON`), () => toast('The browser would not let me copy'));
  }
});
$('#detail').addEventListener('change', e => { const s = e.target.closest('select[data-tr="min"]'); if (s) { Trails.setMinutes(+s.value); Detail.render(); } });
