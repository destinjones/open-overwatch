// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Small helpers every tool uses: times, numbers, coordinates and places in words, and the place's time zone.
const METEO = 'https://api.open-meteo.com/v1/forecast';

export const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);
export const utc = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
export const coord = (lat, lon) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const big = n => (n >= 1e12 ? `${r2(n / 1e12)} trillion` : n >= 1e9 ? `${r1(n / 1e9)} billion` : n >= 1e6 ? `${r1(n / 1e6)} million` : Math.round(n).toLocaleString('en-US'));
export const km = d => (d < 1 ? `${Math.round(d * 1000)} m` : d < 10 ? `${r1(d)} km` : `${Math.round(d).toLocaleString('en-US')} km`);
export function ago(t, now) {
  const s = Math.round((now - t) / 1000), a = Math.abs(s);
  const f = a < 90 ? `${a} s` : a < 5400 ? `${Math.round(a / 60)} min` : a < 129600 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} days`;
  return s >= 0 ? `${f} ago` : `in ${f}`;
}
/** Clock and date formatters for a time zone (IANA name; UTC when unknown or unreadable). */
export function clocks(tz) {
  const make = o => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hourCycle: 'h23', ...o }); } catch { return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hourCycle: 'h23', ...o }); } };
  const hm = make({ hour: '2-digit', minute: '2-digit' }), day = make({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const date = make({ weekday: 'short', day: 'numeric', month: 'short' });
  return { hm: ms => hm.format(new Date(ms)), full: ms => day.format(new Date(ms)).replace(',', ''), date: ms => date.format(new Date(ms)) };
}
export const areaData = a => a && { name: a.label, lat: r2(a.lat), lon: r2(a.lon), radius_km: Math.round(a.radiusKm), ...(a.bbox ? { bbox: a.bbox.map(r2) } : {}) };
export const where = a => (a ? (a.kind === 'point' ? ` within ${Math.round(a.radiusKm)} km of ${a.label}` : a.bbox ? ` in ${a.label}` : ` within ${Math.round(a.radiusKm)} km of ${a.label}`) : ' worldwide');
export const limitProp = (def, max) => ({ type: 'integer', minimum: 1, maximum: max, description: `How many to list (default ${def}, at most ${max}).` });
export const take = (list, n) => list.slice(0, Math.max(1, Math.min(n, list.length)));
/** The place's IANA time zone (Open-Meteo's lookup, cached a day), or null. */
export async function zoneAt(ctx, lat, lon, signal) {
  const d = await ctx.feeds.json(`${METEO}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&timezone=auto&forecast_days=1&current=is_day`, { ttl: 864e5, signal }).catch(() => null);
  return d && typeof d.timezone === 'string' ? d.timezone : null;
}
/** Bytes as base64 (MCP image content), in chunks so a large picture doesn't overflow the call stack; no Node Buffer. */
export function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
