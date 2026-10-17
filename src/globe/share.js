// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Share a view: a link that puts the next person where you are, with the same layers, the same time and (if open) the same
// weather sources and country. Everything lives in the URL hash (nothing is stored on a server):
//   #c=lon,lat,height,heading,pitch  &l=ids,of,layers,on  &w=ir,wind  &t=julianDate,rate  &k=ISO2  &f=CALLSIGN  &d=drawing
// and #go=tonight (a panel that needs no camera, e.g. from the landing page; &at=lat,lon&name= gives it a place). The drawing (measure.js) goes in as its points.
// Links made elsewhere (the MCP server) add &a= / &x= (layers on / off) and &s= (a satellite to follow). A new hash in an
// open page is applied again, flying there (main.js): the MCP panel moves its framed globe that way, without reloading it.
import { C, $, toast } from './env.js';
import { camera, camHeight } from './viewer.js';
import { LAYERS, syncDock } from './layers.js';
import { Time } from './time.js';
import { hooks, state } from './state.js';
import { Weather } from './weather.js';
import { Country } from './country.js';
import { select, PRESETS, flyToObject } from './ui.js';
import { release } from './follow.js';
import { Sats, SatModels } from './satellites.js';
import { Flight } from './flight.js';
import { Launches } from './launches.js';
import { Eclipses } from './eclipses.js';
import { Tonight } from './tonight.js';
import { encodeView, decodeView, decodeExtras, mapLayersFor } from '../core/viewlink.js';

const r = (v, n) => +v.toFixed(n);

export const Share = {
  /** How many drawn shapes the last link carried (-1: there was a drawing, too big for a link). */
  drawn: 0,
  link() {
    const c = camera.positionCartographic, drawing = hooks.drawState?.() || null;
    const hash = encodeView({ lon: C.Math.toDegrees(c.longitude), lat: C.Math.toDegrees(c.latitude), height: c.height, heading: C.Math.toDegrees(camera.heading), pitch: C.Math.toDegrees(camera.pitch),
      layers: LAYERS.filter(l => l.on).map(l => l.id), weather: Weather.on ? [...Object.entries(Weather.sets).filter(([, s]) => s.on).map(([k]) => k), ...Weather.shareTokens()] : null,
      time: Time.live ? null : { jd: Time.jd(), rate: Time.rate }, country: state.selected && state.selected.kind === 'country' ? state.selected.iso : null, flight: Flight.shareId, ops: hooks.opsState?.(), drawing });
    this.drawn = drawing ? (/(^|&)d=/.test(hash) ? drawing.length : -1) : 0;
    return location.origin + location.pathname + '#' + hash + (hooks.historyOpen?.() ? '&go=history' : '');   // the time-travel panel opens with it
  },
  /** The 2D map on this place: its counterparts of the layers on here switched on, the drawing carried (core/viewlink.js). */
  mapLink() {
    const c = camera.positionCartographic;
    return 'open-overwatch.html#' + encodeView({ lon: C.Math.toDegrees(c.longitude), lat: C.Math.toDegrees(c.latitude), height: c.height, heading: 0, pitch: -90,
      add: mapLayersFor(LAYERS.filter(l => l.on).map(l => l.id)), weather: Weather.on ? [...Object.entries(Weather.sets).filter(([, s]) => s.on).map(([k]) => k), ...Weather.shareTokens()] : null,   // the map's forecast layers
      drawing: hooks.drawState?.() || null });
  },
  /** An <iframe> for someone else's page: this view, in embed mode. */
  embedCode() { const u = this.link().replace('#', '#embed=1&'); return `<iframe src="${u.replace(/"/g, '&quot;')}" width="100%" height="480" style="border:0;border-radius:12px" loading="lazy" allow="fullscreen" title="Open Overwatch: the Earth, live"></iframe>`; },
  async copyEmbed() {
    const code = this.embedCode();
    try { await navigator.clipboard.writeText(code); toast('Embed code copied: paste it into any web page', 3500); } catch (e) { window.prompt('Copy this embed code:', code); }
  },
  async copy() {
    const url = this.link(), n = this.drawn;
    const said = Flight.shareId ? `Link copied: it finds ${Flight.shareId} wherever it is when opened` : n > 0 ? `Link copied, with the drawing (${n} shape${n === 1 ? '' : 's'})`
      : n < 0 ? 'Link copied without the drawing: too many points for a link (Measure → Copy GeoJSON keeps them all)' : 'Link to this view copied';
    try { await navigator.clipboard.writeText(url); toast(said, n ? 4000 : 3000); }
    catch (e) { window.prompt('Copy this link:', url); }
  },
  /** Apply a link's hash: after the boot screen is gone, and again (fly: true) whenever the hash changes. True if there was one. */
  booted: false,
  async restore({ fly = false } = {}) {
    this.booted = true;
    const v = decodeView(location.hash), x = decodeExtras(location.hash);
    if (!v) {
      if (x.go === 'launches' && x.id) Launches.openList(x.id);   // tonight.html hands over one launch or eclipse
      else if (x.go === 'eclipses' && x.id) Eclipses.openList(x.id);
      else if (x.go === 'reentry' && x.id) hooks.reentry?.(x.id);
      else if (x.go === 'tonight' && x.at) Tonight.open(x.at);   // Tonight for the place in the link (&at=lat,lon&name=), not saved
      else if (x.go) { const b = document.querySelector(`#band [data-go="${x.go}"]`); if (b) b.click(); else PRESETS[x.go](); }
      if (x.flight) Flight.find(x.flight); return !!(x.go || x.flight);
    }
    if (fly) {   // a view replacing another: what this link doesn't name goes back to how a fresh page starts
      release();
      if (!v.time && !Time.live) Time.goLive();
      if (!v.weather && Weather.on) Weather.close();
      if (!v.country && state.selected && state.selected.kind === 'country') hooks.closeCard?.();
      if (!v.ops) hooks.applyOps?.({ sensor: 'normal', hud: false, detect: false });
    }
    if (v.layers) { const on = new Set(v.layers); for (const l of LAYERS) l.on = on.has(l.id); syncDock(); hooks.applyVisibility(); }
    if (v.add || v.drop) { for (const l of LAYERS) { if (v.add?.includes(l.id)) l.on = true; if (v.drop?.includes(l.id)) l.on = false; } syncDock(); hooks.applyVisibility(); }
    if (v.time) Time.setJd(v.time.jd, v.time.rate);
    if (x.go === 'history') hooks.openHistory?.();
    if (v.ops) hooks.applyOps?.(v.ops);
    const to = { destination: C.Cartesian3.fromDegrees(v.lon, v.lat, Math.max(150, v.height)), orientation: { heading: C.Math.toRadians(v.heading), pitch: C.Math.toRadians(v.pitch), roll: 0 } };
    if (fly && !v.weather) camera.flyTo({ ...to, duration: 2.5 }); else camera.setView(to);   // weather opens on the whole Earth itself
    if (v.sat) this.follow(v.sat);
    if (v.drawing) hooks.applyDraw?.(v.drawing, { card: !v.country && !v.flight });   // its shapes are built at once (outlines once the borders load)
    if (v.weather) { for (const [k, s] of Object.entries(Weather.sets)) s.on = v.weather.includes(k); Weather.fromTokens(v.weather); await Weather.open(); Weather.build(); Weather.show(); }
    if (v.country) { const o = await Country.byIso(v.country).catch(() => null); if (o) select(o); }
    if (v.flight) Flight.find(v.flight);
    return true;
  },
  /** Select a satellite by NORAD number once they have loaded, and follow it (fly to it when it has no 3D model). */
  async follow(id) {
    await Sats.ready; const o = Sats.byId.get(String(id)); if (!o) return;
    select(o); if (SatModels.classify(o)) SatModels.follow(o); else flyToObject(o);
  },
};
// the "Classic map" link opens the 2D map where the globe is (a middle-click or a new tab gets the same address)
const classic = document.getElementById('btnClassic');
if (classic) for (const ev of ['click', 'auxclick', 'contextmenu']) classic.addEventListener(ev, () => { classic.href = Share.mapLink(); });
