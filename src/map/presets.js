// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Views (presets), the legend, your location, and the ISS follow mode.
import { $, $$, C, esc, late, pick, Store, toast } from './util.js';
import { keptPlace, makePlace } from '../core/myplace.js';
import { map, vecRenderer } from './mapview.js';
import { Dyn, Layers } from './engine.js';
import { Detail, Tracks, sheetAware } from './detail.js';
import { Air } from './aircraft.js';
import { Sats, lySats } from './satellites.js';

/* ============================================================ PRESETS ("views") */
export const PRESETS = [
  { id: 'me', name: 'Around me', desc: 'Aircraft, cameras and weather near you', layers: ['air_local', 'air_mil', 'air_emg', 'cams', 'sats', 'quakes', 'storms', 'nws', 'terminator', 'osm_scan'], sats: ['stations'], go: 'locate' },
  { id: 'mil', name: 'Military air picture', desc: 'Every military-flagged aircraft in the world', layers: ['air_mil', 'air_emg', 'air_local', 'terminator', 'osm_scan'], sats: ['stations'], view: [40, 20, 3] },
  { id: 'space', name: 'Space', desc: 'ISS, bright satellites, GPS, aurora', layers: ['sats', 'aurora', 'terminator', 'osm_scan'], sats: ['stations', 'visual', 'gps-ops'], go: 'iss' },
  { id: 'hazards', name: 'Storms & quakes', desc: 'Earthquakes, cyclones, disasters, US warnings, radar', layers: ['quakes', 'events', 'gdacs', 'storms', 'nws', 'radar', 'terminator', 'osm_scan'], view: [20, -40, 3] },
  { id: 'all', name: 'Everything', desc: 'All default layers at once', layers: ['air_local', 'air_mil', 'air_emg', 'sats', 'ships_fi', 'quakes', 'events', 'storms', 'nws', 'cams', 'terminator', 'osm_scan', 'news', 'gdacs'], sats: ['stations', 'visual'] },
];
export const Presets = {
  current: Store.get('preset', null),
  apply(id, { fly = true } = {}) {
    const p = PRESETS.find(x => x.id === id); if (!p) return;
    Layers.apply(p.layers); if (p.sats) this.satOpt('sat_groups', p.sats);
    this.current = id; Store.set('preset', id); $$('.view').forEach(b => b.classList.toggle('on', b.dataset.preset === id));
    // clear the old selection and follow BEFORE flying: the ISS follow below selects the ISS, draws its track and toasts its own hint
    Detail.clear(); Fun.issFollow = false; Fun.issPending = 0; toast(`View: ${p.name}`);
    if (fly) { if (p.view) map.flyTo([p.view[0], p.view[1]], p.view[2], { duration: 1 }); else if (p.go === 'locate') Locate.go(); else if (p.go === 'iss') Fun.followIss(); }
    late.Brief.render();
  },
  // satellite options changed by a view or the ISS shortcut: redraw the Satellites pills to match, and reload the groups
  // (after any reload already in flight, which read the old ones)
  satOpt(k, v) {
    Layers.setOpt(k, v); const sr = $('.subrow[data-sub="sats"]'); if (sr) lySats.sub(sr);
    if (k === 'sat_groups' && lySats.on) { const go = () => { this.satWait = null; if (!lySats.on) return; if (Sats.loading) this.satWait = setTimeout(go, 1000); else Sats.reload(); }; if (!this.satWait) go(); }
  },
  build() { const root = $('#views'); for (const p of PRESETS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'view' + (this.current === p.id ? ' on' : ''); b.dataset.preset = p.id; b.innerHTML = `<b>${esc(p.name)}</b><small>${esc(p.desc)}</small>`; b.addEventListener('click', () => this.apply(p.id)); root.appendChild(b); } },
};
export const LEGEND = [['civil aircraft', C.civ], ['military', C.mil], ['emergency squawk', C.emg], ['degraded GPS', '#ff9ad5'], ['satellite', C.sat, 'dm'], ['vessel', C.ship], ['radiosonde', C.bal, 'rd'], ['camera', C.cam, 'rd'], ['earthquake', C.qk, 'rd'], ['event', C.evt, 'rd'], ['storm', '#7fd0ff', 'rd'], ['news', C.news, 'rd']];
export function legendHtml() { return LEGEND.map(([n, c, cls]) => `<span><i class="${cls || ''}" style="--c:${c}"></i>${esc(n)}</span>`).join(''); }

/* ============================================================ LOCATION */
// Only the device's own fix, or a place the visitor picks on the map: never an IP lookup. Kept rounded to 0.01° (about
// 1 km) for 24 h (core/myplace.js); Setup → "Forget my location" removes it.
const kept = keptPlace(Store.get('pos', null)); if (!kept) Store.del('pos'); else Store.set('pos', kept);   // too old, or an older version's IP lookup; else stored rounded
export const Locate = {
  _pos: kept, _pickUntil: 0,
  // a place is wanted after a failed fix: for 60 s only (phones have no Escape), so a much later tap is not taken as the place
  get picking() { return Date.now() < this._pickUntil; },
  set picking(v) { this._pickUntil = v ? Date.now() + 60e3 : 0; },
  get pos() { if (this._pos && !keptPlace(this._pos)) this.forget(true); return this._pos; },   // {lat, lon, how, t}, 24 h at most
  keep(lat, lon, how) { const p = makePlace(lat, lon, how); if (!p) return null; this._pos = p; Store.set('pos', p); return p; },
  forget(quiet = false) { this._pos = null; this.picking = false; Store.del('pos'); if (!quiet) { toast('Your location is forgotten on this device'); late.Brief.render(); } },
  refresh() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('this browser has no location service')); return; }
      navigator.geolocation.getCurrentPosition(p => resolve(this.keep(p.coords.latitude, p.coords.longitude, 'device')),
        e => reject(new Error(e && e.code === 1 ? 'location access was denied' : 'the device found no position')), { timeout: 8000, maximumAge: 60000 });
    });
  },
  mark(p) { L.circleMarker([p.lat, p.lon], { radius: 6, color: C.accent, weight: 2, fillOpacity: .2, interactive: false, renderer: vecRenderer }).addTo(Tracks.group); },
  async go() {
    try { const p = await this.refresh(); this.picking = false; map.flyTo([p.lat, p.lon], 8, { duration: 1 }); this.mark(p); toast('Centered on your device position'); late.Brief.render(); }
    catch (e) { this.picking = true; toast(`No location: ${e.message}. Tap the map where you are (or search "lat, lon") to set your place.`, 'alert'); }   // the visitor picks it instead
  },
  /** This spot is the visitor's place (the tap after a failed fix, a coordinate search then, or the probe's button). */
  setHere(lat, lon) { this.picking = false; const p = this.keep(lat, lon, 'picked'); if (!p) return null; this.mark(p); toast('Your place is set here, to about 1 km · Setup → Forget my location removes it'); late.Brief.render(); return p; },
  /** A map tap while a place is wanted: true when the tap was taken. */
  pick(lat, lon) { return this.picking && !!this.setHere(lat, lon); },
};
Object.assign(late, { Locate });

/* ============================================================ FUN */
export const Fun = {
  surprise() {
    const pool = [...Dyn.air.values()].filter(a => a.mil && !a.ground && Air.notable(a)); const pool2 = pool.length ? pool : [...Dyn.air.values()].filter(a => a.mil && !a.ground);
    if (!pool2.length) { toast(Layers.on('air_mil') ? 'No military aircraft loaded yet — give the feed a few seconds' : 'Turn on "Military aircraft, worldwide" first', 'alert'); return; }
    const a = pick(pool2); Detail.show('air', a, a.hex); map.flyTo(sheetAware([a.lat, a.lon], 7), 7, { duration: 1.2 }); setTimeout(() => Air.trail(a.hex), 1300);
    toast(`${a.flight || a.r || a.hex.toUpperCase()} · ${a.desc || a.t || 'military'} · ${Air.roleOf(a)} · near ${Air.where(a)}`);
  },
  followIss() {
    const iss = Sats.iss(); Air.following = null; // one follow at a time
    if (!iss || iss.lat == null) { // not loaded yet: start it, and the follow interval below picks the ISS up once it is propagated
      if (!Layers.on('sats')) Layers.set('sats', true); if (!Sats.groupsOn().includes('stations')) Presets.satOpt('sat_groups', [...Sats.groupsOn(), 'stations']);
      this.issPending = Date.now(); toast('Loading the ISS orbit… the map will follow it once it is in'); return;
    }
    this.issPending = 0; Detail.show('sat', iss, iss.id); const z = Math.max(map.getZoom(), 3); map.flyTo(sheetAware([iss.lat, iss.lon], z), z, { duration: 1 }); Sats.drawTrack(iss); if (!Layers.opt('sat_tracks')) Presets.satOpt('sat_tracks', true);   // the card first: on a phone its sheet decides where "centre" is
    this.issFollow = true; toast('Following the ISS — pan the map to stop');
  },
  issInView() { const iss = Sats.iss(); if (!iss || iss.lat == null) return true; const b = map.getBounds(), c = b.getCenter(); return iss.lat >= b.getSouth() && iss.lat <= b.getNorth() && Math.abs(((iss.lon - c.lng) % 360 + 540) % 360 - 180) <= (b.getEast() - b.getWest()) / 2; },
};
// the ISS follow stops on a drag, or when anything else (Brief, search, Locate, an aircraft follow…) moves the ISS out of view;
// it never pans over another move in progress (panTo would cancel that flyTo)
export let mapMovingAt = 0;
map.on('dragstart', () => { Fun.issFollow = false; Fun.issPending = 0; });
map.on('movestart', () => { mapMovingAt = Date.now(); });
map.on('moveend', () => { mapMovingAt = 0; if (Fun.issFollow && !Fun.issInView()) Fun.issFollow = false; });
setInterval(() => {
  if (Fun.issPending) { const iss = Sats.iss(); if (!Layers.on('sats') || Date.now() - Fun.issPending > 120e3) Fun.issPending = 0; else if (iss && iss.lat != null) Fun.followIss(); }
  if (Fun.issFollow) { const iss = Sats.iss(); if (!Layers.on('sats')) Fun.issFollow = false; else if (iss && iss.lat != null && !document.hidden && Date.now() - mapMovingAt > 4000) map.panTo(sheetAware([iss.lat, iss.lon]), { animate: true, duration: .8 }); }   // phones: above the open sheet
}, 2500);
