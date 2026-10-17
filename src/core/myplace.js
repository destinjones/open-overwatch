// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The visitor's own place on the 2D map ("Around me", "Center on me", the Brief's passes and aurora): what may be kept of
// it. Only the device's own fix or a place the visitor picked on the map, rounded to 0.01° (about 1 km), for 24 hours.
// No IP lookups: a position an older version got from an IP-location service is dropped when it is read back.

/** How long a kept place counts (ms). */
export const PLACE_TTL = 24 * 3600e3;
/** Where a place came from: the browser's location service, or a tap on the map. */
export const PLACE_SOURCES = ['device', 'picked'];

const r2 = x => Math.round(x * 100) / 100 + 0;   // + 0: no -0

/** A place as it is kept: lat/lon rounded to 0.01°, longitude wrapped to -180..180. Null for nonsense input. */
export function roundPlace(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
  const w = ((lon + 180) % 360 + 360) % 360 - 180;
  return { lat: r2(lat), lon: r2(w) };
}

/** A new place to keep: { lat, lon, how, t }, or null when the source is not one we keep. */
export function makePlace(lat, lon, how, now = Date.now()) {
  if (!PLACE_SOURCES.includes(how)) return null;
  const p = roundPlace(lat, lon); return p && { ...p, how, t: now };
}

/** A place read back from storage: the same, re-rounded, while it is under PLACE_TTL old; null when it is too old, from
 *  the future, malformed, or came from an IP lookup (an older version's 'approximate (IP)'). */
export function keptPlace(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.t)) return null;
  if (raw.t > now + 60e3 || now - raw.t >= PLACE_TTL) return null;
  return makePlace(raw.lat, raw.lon, raw.how, raw.t);
}
