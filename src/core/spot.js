// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "This spot": what a long press on the globe or the 2D map shows (src/app/spot.js): the coordinates in the usual ways,
// and a link that opens the 3D globe there with a pin on it. DOM-free.

import { toMgrs } from './mgrs.js';
import { encodeView } from './viewlink.js';

const hemi = (v, pos, neg) => (v >= 0 ? pos : neg);

/** Wrap a longitude into -180..180 (the globe can hand back 181°). */
export function wrapLon(lon) { return lon >= -180 && lon <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180; }

/** "48.85660° N, 2.35220° E" (digits: decimals; 5 is about a metre). */
export function decimal(lat, lon, digits = 5) {
  lon = wrapLon(lon);
  return `${Math.abs(lat).toFixed(digits)}° ${hemi(lat, 'N', 'S')}, ${Math.abs(lon).toFixed(digits)}° ${hemi(lon, 'E', 'W')}`;
}

/** "48° 51′ 23.8″ N, 2° 21′ 07.9″ E" (rounding never shows 60″). */
export function dms(lat, lon) {
  const one = (v, pos, neg) => {
    let tenths = Math.round(Math.abs(v) * 36000);   // tenths of an arcsecond
    const d = Math.floor(tenths / 36000); tenths -= d * 36000;
    const m = Math.floor(tenths / 600); tenths -= m * 600;
    return `${d}° ${String(m).padStart(2, '0')}′ ${(tenths / 10).toFixed(1).padStart(4, '0')}″ ${hemi(v, pos, neg)}`;
  };
  return one(lat, 'N', 'S') + ', ' + one(wrapLon(lon), 'E', 'W');
}

/** The text a "Copy" button puts on the clipboard: plain numbers a map app or a spreadsheet reads. */
export function plain(lat, lon) { return `${lat.toFixed(6)}, ${wrapLon(lon).toFixed(6)}`; }

/** Everything the spot card shows. */
export function describeSpot(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
  lon = wrapLon(lon);
  return { lat, lon, decimal: decimal(lat, lon), dms: dms(lat, lon), mgrs: toMgrs(lat, lon) || null, plain: plain(lat, lon),
    spoken: `${Math.abs(lat).toFixed(3)} degrees ${lat >= 0 ? 'north' : 'south'}, ${Math.abs(lon).toFixed(3)} degrees ${lon >= 0 ? 'east' : 'west'}` };
}

/** A link to globe.html that looks straight down on the spot from `height` metres, with a pin on it. */
export function spotLink(base, lat, lon, height = 2.5e5) {
  lon = wrapLon(lon);
  const h = Math.min(2e7, Math.max(800, Math.round(height)));
  return new URL('globe.html', base).href + '#' + encodeView({ lon, lat, height: h, heading: 0, pitch: -90, drawing: [{ kind: 'pin', coords: [[lon, lat]] }] });
}
