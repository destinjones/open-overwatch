// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The aurora oval from NOAA SWPC's OVATION model (a 1-degree grid of the chance of seeing aurora, public domain, CORS):
// one grid and one colour ramp for the 2D map's overlay and the globe's imagery layer. Pure: pictures are RGBA arrays
// the views put on a canvas. Spot readings with the horizon included: core/sky.js auroraAt.

export const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
export const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
/** The colour ramp: faint green through yellow to pink where it is strong ([% chance, [r, g, b]]). */
export const AURORA_STOPS = /** @type {ReadonlyArray<[number, number[]]>} */ (Object.freeze([[3, [60, 255, 160]], [25, [110, 255, 110]], [55, [240, 255, 110]], [80, [255, 160, 90]], [100, [255, 80, 200]]]));
export function auroraColor(p) {
  let i = 1; while (i < AURORA_STOPS.length - 1 && p > AURORA_STOPS[i][0]) i++;
  const [p0, a] = AURORA_STOPS[i - 1], [p1, b] = AURORA_STOPS[i], f = Math.max(0, Math.min(1, (p - p0) / (p1 - p0)));
  return a.map((v, j) => Math.round(v + (b[j] - v) * f));
}
/** How opaque a cell is painted: faint cells show, strong ones never hide the ground (0-255). */
export const auroraAlpha = p => Math.min(235, 40 + p * 4);

/** OVATION's answer → { grid (Float32Array, 181 rows from 90°S, 360 columns from 0°E), at ('Forecast Time'), peak, cells20
 *  (cells of 20% or more) }. Longitudes may come as -180..180 or 0..359. */
export function parseOvation(d) {
  const grid = new Float32Array(360 * 181); let peak = 0, cells20 = 0;
  for (const c of (d && d.coordinates) || []) {
    if (!Array.isArray(c)) continue;
    const lon = Math.round(+c[0]), lat = Math.round(+c[1]), v = +c[2];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(v) || lat < -90 || lat > 90) continue;
    grid[(lat + 90) * 360 + ((lon % 360) + 360) % 360] = v;
    if (v > peak) peak = v; if (v >= 20) cells20++;
  }
  return { grid, at: d && typeof d['Forecast Time'] === 'string' ? d['Forecast Time'] : '', peak, cells20 };
}
/** The chance (%) in the cell over a place. */
export const ovationAt = (grid, lat, lon) => (grid ? grid[(Math.round(lat) + 90) * 360 + ((Math.round(lon) % 360) + 360) % 360] || 0 : 0);

/** The grid as a 360 × 181 picture, west edge 180°W, top row 90°N (the globe drapes it over -180..180, -90.5..90.5). */
export function paintEquirect(grid, min = 3) {
  const px = new Uint8ClampedArray(360 * 181 * 4);
  for (let y = 0; y < 181; y++) for (let x = 0; x < 360; x++) {
    const p = grid[(90 - y + 90) * 360 + ((x + 180) % 360)]; if (p < min) continue;
    const [r, g, b] = auroraColor(p), i = (y * 360 + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = auroraAlpha(p);
  }
  return px;
}
export const MERCATOR_MAX_LAT = 85.0511;
/** The grid as a w × h Web Mercator picture of the world (85°S..85°N, 180°W..180°E), for a map image overlay. */
export function paintMercator(grid, w = 1440, h = 720, min = 3) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const lat = Math.atan(Math.sinh((1 - 2 * (y + 0.5) / h) * Math.PI)) * 180 / Math.PI, row = (Math.round(lat) + 90) * 360;
    for (let x = 0; x < w; x++) {
      const p = grid[row + ((Math.round(x / w * 360 - 180) % 360) + 360) % 360]; if (p < min) continue;
      const [r, g, b] = auroraColor(p), i = (y * w + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = auroraAlpha(p);
    }
  }
  return px;
}

/** NOAA's planetary K-index list (rows [time, Kp, ...] after a header, or objects { time_tag, Kp }) → the latest { t, kp }. */
export function latestKp(d) {
  const rows = (Array.isArray(d) ? d : []).map(r => Array.isArray(r) ? { t: r[0], kp: parseFloat(r[1]) } : r && typeof r === 'object' ? { t: r.time_tag, kp: parseFloat(r.Kp ?? r.kp ?? r.kp_index) } : null)
    .filter(r => r && Number.isFinite(r.kp));
  return rows.length ? rows[rows.length - 1] : null;
}
