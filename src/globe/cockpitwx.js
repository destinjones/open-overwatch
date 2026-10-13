// Cockpit weather: riding a plane (Ops cockpit, or the HUD while following one), the right side of the HUD shows the
// weather where it is: wind at its height and what it does to it (head or tail, cross), outside air temperature against
// the standard atmosphere, true airspeed and Mach, cloud at its level and the sky's layers, surface visibility, an
// icing hint, and the nearest airport and the destination on file. From Open-Meteo (keyless, CORS), asked for the
// plane's 0.25° cell and its two pressure levels, again only when the plane moves to another cell or level or after 10
// minutes, so a long ride costs a handful of requests.
import { $, getJSON } from './env.js';
import { Follow } from './follow.js';
import { Ops } from './ops.js';
import { displayAt, airClass } from './aircraft.js';
import { AcInfo } from './acinfo.js';
import { aloftUrl, parseAloft, aloftLines } from '../core/aloft.js';
import { gcKm, bearing } from '../core/actype.js';
import { flightPhase } from '../core/phase.js';
import { Runways } from './runways.js';

const REASK = 10 * 60e3;
const cache = new Map();   // key -> { t, json } (a few entries: the cells a ride passes through)
let el = null, asking = null, lastErr = 0;

function box() {
  if (el && el.isConnected) return el;
  const hud = $('#opsHud'); if (!hud) return null;
  el = document.createElement('div'); el.className = 'oh-wx'; hud.append(el);
  return el;
}
async function weatherFor(p) {
  const q = aloftUrl(p.lat, p.lon, p.alt), c = cache.get(q.key);
  if (c && Date.now() - c.t < REASK) return c.json;
  if (asking || Date.now() - lastErr < 60e3) return c ? c.json : null;
  asking = getJSON(q.url, { timeout: 15000 }).then(json => {
    cache.set(q.key, { t: Date.now(), json });
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return json;
  }).catch(e => { lastErr = Date.now(); console.warn('cockpit weather', e.message); return null; }).finally(() => { asking = null; });
  return c ? c.json : asking;
}
const pad3 = d => String(Math.round(d) % 360).padStart(3, '0');

export const CockpitWx = {
  airports: null,   // airports.js sets its index here once loaded
  get active() { const o = Follow.obj; return !!(o && o.kind === 'air' && (Ops.cockpit || Ops.hud)); },
  async tick() {
    const b = box(); if (!b) return;
    if (!this.active) { b.style.display = 'none'; return; }
    const o = Follow.obj, p = displayAt(o, Date.now()), at = { ...p, alt: o.ground ? 0 : p.alt, track: p.track ?? o.track, gs: o.gs, ground: o.ground };
    const json = await weatherFor(at);
    if (Follow.obj !== o) return;
    const w = parseAloft(json, at.alt), lines = w ? aloftLines(at, w) : [asking ? 'WX …' : 'WX —'];
    const ap = this.airports && this.airports.nearest(p.lat, p.lon, 300);
    const ph = flightPhase({ ...at, lat: p.lat, lon: p.lon, vr: o.vr, cls: airClass(o).cls }, ap);
    const fin = ap && (ph.phase === 'final' || ph.phase === 'approach') ? Runways.final(ap, { ...at, lat: p.lat, lon: p.lon }) : null;
    if (ph.phase !== 'unknown') lines.unshift(`PHASE ${ph.words.toUpperCase()}${fin ? ' RWY ' + fin.end.ident : ''}${ph.agl != null && ap && ap.km < 40 && !o.ground ? ` · ${Math.round(Math.max(0, ph.agl) / 0.3048).toLocaleString('en-US')} FT AFE` : ''}`);
    if (ap) lines.push(`NRST ${ap.icao}${ap.iata ? '/' + ap.iata : ''} ${pad3(bearing(p.lat, p.lon, ap.lat, ap.lon))}° ${Math.round(ap.km / 1.852)} NM`);
    const dest = o.info && o.info.route && o.info.route.destination, fit = dest ? AcInfo.fit(o) : null;
    if (dest && fit && fit.fits && !o.ground) lines.push(`DEST ${dest.icao || dest.iata} ${pad3(bearing(p.lat, p.lon, dest.lat, dest.lon))}° ${Math.round(gcKm(p.lat, p.lon, dest.lat, dest.lon) / 1.852)} NM (on file)`);
    b.innerHTML = `<b>WX AT ${o.ground ? 'SFC' : 'FL' + String(Math.round(at.alt / 0.3048 / 100)).padStart(3, '0')}</b>` + lines.map(l => `<span>${l.replace(/[<>&]/g, '')}</span>`).join('')
      + `<span class="oh-src">Open-Meteo model${w && w.time ? ' · ' + w.time.slice(11, 16) + 'Z' : ''}</span>`;
    b.style.display = 'grid';
  },
};
setInterval(() => CockpitWx.tick(), 1000);
