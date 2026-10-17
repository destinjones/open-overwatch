// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// One fixed grid of 250 nm circles over the world: the shared tiling the 2D map sweeps its view in and the globe asks the
// few nearest its camera from. Because every visitor asks for the same few thousand URLs, a shared cache can keep one
// answer for all of them (a free query per visitor would never repeat). The public relay carried these queries until
// adsb.lol refused Cloudflare's servers (2026-10-15); relay/worker.js no longer imports this file.

export const TILE_NM = 250;                 // adsb.lol /v2/point answers at most 250 nm
export const TILE_KM = 463;                 // 250 nm
const ROW = 1.5 * TILE_KM / 111;            // degrees between rows: a hexagonal packing of the circles
const MAX_LAT = 80;
const fix3 = x => { const v = +x.toFixed(3); return v === 0 ? 0 : v; };   // -0 would print as "0" anyway; keep it plain

/** Row r of the grid: its latitude and the spacing and offset of its tiles in longitude (degrees). A whole number of
 *  tiles goes round each row, so the grid repeats every 360° and has no seam at the antimeridian. */
export function gridRow(r) {
  const lat = r * ROW, dLon = 360 / Math.ceil(360 * 111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)) / (Math.sqrt(3) * TILE_KM));
  return { lat, dLon, off: r % 2 ? dLon / 2 : 0 };
}
export const ROW_DEG = ROW;
/** A tile's centre as the feeds are asked for it: 3 decimals, longitude in [-180, 180). */
export const tileAt = (lat, lon) => { const w = fix3((((lon % 360) + 540) % 360) - 180); return { lat: fix3(lat), lon: w >= 180 ? w - 360 : w }; };   // 179.9999 rounds to 180: that is -180

/** Whether (lat, lon) as written in a URL is a centre of the grid. */
export function onGrid(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > MAX_LAT || lon < -180 || lon >= 180) return false;
  const r = Math.round(lat / ROW), g = gridRow(r);
  if (Math.abs(lat - fix3(g.lat)) > 1e-9) return false;
  const k = Math.round((lon - g.off) / g.dLon), t = tileAt(g.lat, k * g.dLon + g.off);
  return t.lon === lon && t.lat === lat;
}

/** The n tiles whose centres are nearest (lat, lon), nearest first: [{ lat, lon, km }]. */
export function nearestTiles(lat, lon, n = 3) {
  const out = [], r0 = Math.round(lat / ROW);
  for (let r = r0 - 2; r <= r0 + 2; r++) {
    const g = gridRow(r); if (Math.abs(g.lat) > MAX_LAT) continue;
    const k0 = Math.round((lon - g.off) / g.dLon);
    for (let k = k0 - 2; k <= k0 + 2; k++) { const t = tileAt(g.lat, k * g.dLon + g.off); out.push({ ...t, km: gcKm(lat, lon, t.lat, t.lon) }); }
  }
  const seen = new Set();
  return out.sort((a, b) => a.km - b.km).filter(t => { const key = t.lat + ',' + t.lon; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, n);
}
function gcKm(la1, lo1, la2, lo2) {
  const d = Math.PI / 180, a = Math.sin((la2 - la1) * d / 2) ** 2 + Math.cos(la1 * d) * Math.cos(la2 * d) * Math.sin((lo2 - lo1) * d / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// adsb.lol through a shared relay: seconds an answer may be shared (0 = not shared). Only queries every visitor asks
// alike: the military list, the three emergency squawks, and area queries on the grid above. Single-plane lookups (hex,
// callsign, registration) differ per visitor, so they stay with the download's local helper. adsbLolTtl and
// adsbLolRelayable are kept for a future relay that can reach adsb.lol; today only the tests use them (the map reads AIR_TTL).
export const ADSB_LOL_HOST = 'api.adsb.lol';
export const AIR_TTL = Object.freeze({ mil: 60, squawk: 60, point: 45 });
const POINT = /^\/v2\/point\/(-?\d{1,2}(?:\.\d{1,3})?)\/(-?\d{1,3}(?:\.\d{1,3})?)\/250$/;
/** How long a shared relay may keep an adsb.lol answer for this path (seconds), or 0 when it shouldn't carry it. */
export function adsbLolTtl(path) {
  if (path === '/v2/mil') return AIR_TTL.mil;
  if (/^\/v2\/squawk\/7[567]00$/.test(path)) return AIR_TTL.squawk;
  const m = POINT.exec(path);
  return m && onGrid(+m[1], +m[2]) ? AIR_TTL.point : 0;
}
/** Whether a shared relay may carry this adsb.lol URL (no query string: one URL per answer, so the cache is shared). */
export function adsbLolRelayable(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === ADSB_LOL_HOST && !u.port && !u.search && adsbLolTtl(u.pathname) > 0; }
  catch (e) { return false; }
}
