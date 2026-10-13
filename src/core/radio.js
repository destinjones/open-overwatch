// World radio: pure helpers for the globe's radio layer (src/globe/radio.js). DOM-free so Node can test them.
// Stations come from radio-browser.info's /json/stations/search; these turn its rows into small station objects,
// choose the set the analog tuner steps through, and map the dial's position to a station.

import { haversine } from './geo.js';

/** The href only if it is an http(s) URL (a homepage link must never be javascript:, data: or the like), else ''. */
export function httpUrl(u) {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u.trim())) return '';
  try { const p = new URL(u.trim()); return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : ''; } catch (e) { return ''; }
}
/** Only an https stream plays on an https page without mixed-content blocking. */
export function httpsUrl(u) { const h = httpUrl(u); return h.startsWith('https:') ? h : ''; }

/** Some directory names carry keyword-stuffed titles: keep the first clause, at most ~42 characters (as the 2D map does). */
export function tidyName(name) {
  let s = String(name || '').replace(/^[\s#\-–—|>*]+/, '').replace(/\s+/g, ' ').trim();
  if (s.length > 42) { const re = /\s[-–—|:]\s|\s-{2,}|\s\|\|/g; let m; while ((m = re.exec(s))) { if (m.index > 8) { s = s.slice(0, m.index).trim(); break; } } }
  if (s.length > 42) s = s.slice(0, 40).trim() + '…';
  return s || 'Unnamed station';
}

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; };

/**
 * radio-browser rows -> compact stations: real coordinates (not 0,0 or out of range), an https stream (url_resolved
 * first), one entry per stationuuid, at most `max`, kept in the order given (the API already sorts by votes).
 * `hls: false` drops HLS playlists for browsers that can't play them in an <audio> element.
 */
export function cleanStations(rows, { max = 3000, hls = true } = {}) {
  const out = [], seen = new Set();
  for (const r of rows || []) {
    if (!r || out.length >= max) continue;
    const lat = +r.geo_lat, lon = +r.geo_long, id = String(r.stationuuid || '');
    if (!id || seen.has(id) || r.geo_lat == null || r.geo_long == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const url = httpsUrl(r.url_resolved) || httpsUrl(r.url);
    if (!url || (!hls && (r.hls == 1 || /\.m3u8(\?|$)/i.test(url)))) continue;
    seen.add(id);
    out.push({
      id, name: tidyName(r.name), url, lat, lon,
      country: clip(r.country, 40), cc: clip(r.countrycode, 2).toUpperCase(), place: clip(r.state, 40),
      tags: String(r.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 6).map(t => clip(t, 24)),
      codec: /^unknown$/i.test(String(r.codec || '').trim()) ? '' : clip(r.codec, 12), bitrate: +r.bitrate || 0, votes: +r.votes || 0, clicks: +r.clickcount || 0,
      homepage: httpUrl(r.homepage), language: clip(r.language, 30),
    });
  }
  return out;
}

/** Longitude difference b - a folded into (-180, 180]. */
export const dLon = (a, b) => { let d = ((b - a) % 360 + 540) % 360 - 180; return d === -180 ? 180 : d; };

/**
 * The stations the tuner steps through: the `n` nearest to (lon, lat), with at most `perSpot` sharing one ~5 km spot
 * (directories pin dozens of stations to one city centre; a dial of identical places would fly nowhere), the
 * best-voted first within a spot. Sorted west to east (by longitude relative to the centre, so it works across the
 * date line), north to south and by name on ties. Returns [{ st, km }] (km: distance from the centre); the
 * station objects themselves are passed through untouched.
 */
export function tunerSet(list, lon, lat, { n = 40, perSpot = 3 } = {}) {
  const near = list.map(s => ({ s, km: haversine(lat, lon, s.lat, s.lon) / 1000 })).sort((a, b) => a.km - b.km || b.s.votes - a.s.votes);
  const spots = new Map(), pick = [];
  for (const x of near) {
    if (pick.length >= n) break;
    const k = Math.round(x.s.lat * 20) + ',' + Math.round(x.s.lon * 20 / Math.max(0.2, Math.cos(x.s.lat * Math.PI / 180)));
    const c = spots.get(k) || 0; if (c >= perSpot) continue;
    spots.set(k, c + 1); pick.push(x);
  }
  return pick.sort((a, b) => dLon(lon, a.s.lon) - dLon(lon, b.s.lon) || b.s.lat - a.s.lat || a.s.name.localeCompare(b.s.name))
    .map(x => ({ st: x.s, km: x.km }));
}

/** Dial position (0 left .. 1 right) of detent i of n: evenly spaced, with one station in the middle. */
export const dialPos = (i, n) => n <= 1 ? 0.5 : Math.min(1, Math.max(0, i / (n - 1)));
/** The detent nearest a dial position (0..1); -1 for an empty dial. */
export const dialIndex = (x, n) => n <= 0 ? -1 : n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round((Number.isFinite(x) ? x : 0) * (n - 1))));

/** radio-browser.info mirrors: all.api… resolves to whichever are live (nl1/at1/fi1 are gone); de1/de2 as named fallbacks. */
export const RADIO_HOSTS = Object.freeze(['all', 'de1', 'de2']);
/** Ask each mirror in turn (a dead one looks like a CORS error to the browser): get(host) → its answer; the first that
 *  answers wins, as { host, value }; else the first error. */
export async function firstMirror(get, hosts = RADIO_HOSTS) {
  let err;
  for (const h of hosts) { const host = h + '.api.radio-browser.info'; try { return { host, value: await get(host) }; } catch (e) { err = err || e; } }
  throw err || new Error('no mirror answered');
}
/** The best-voted geolocated stations with https streams (the globe's world radio). */
export const radioSearchUrl = (host, max) => `https://${host}/json/stations/search?has_geo_info=true&is_https=true&hidebroken=true&order=votes&reverse=true&limit=${max | 0}`;
/** The most-played stations with a tag (the 2D map's radio player). */
export const radioTagUrl = (host, tag, limit = 14) => `https://${host}/json/stations/bytag/${encodeURIComponent(tag)}?limit=${limit | 0}&hidebroken=true&order=clickcount&reverse=true`;
