// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// How weather-model fields look, for every view that draws them (the globe's weather mode, src/globe/wind.js, and the
// 2D map's model layers, src/map/weather.js): the colour ramps of the washes (temperature, cloud, rain, gusts, waves)
// and of the wind streaks, the legends drawn from the same stops, a wash painted into an RGBA buffer through any
// projection, the darts that say which way the waves run, and the isobar chart (lines every 4 hPa, where to write their
// values, the highs and lows). Pure: the views turn these into imagery, canvases or map layers (test/wxpaint.test.mjs).
import { blend, coarsen } from './fields.js';
import { isolines, levels, extrema, labelSpots } from './contour.js';

const RAD = Math.PI / 180;

/** Temperature (°C) stops: violet at -40 through blue, green and yellow to red at 40. */
export const TEMP = [[-40, [120, 60, 200]], [-20, [70, 100, 240]], [0, [40, 190, 250]], [10, [40, 210, 140]], [20, [255, 230, 60]], [30, [255, 130, 40]], [40, [220, 30, 30]]];
/** Rain rate (mm/h): the usual radar colours, see-through when light, nothing under 0.1 mm/h. */
export const RAIN = [[0.1, [127, 214, 255, 70]], [1, [62, 224, 143, 150]], [4, [255, 224, 102, 185]], [10, [255, 159, 67, 205]], [25, [255, 77, 94, 220]]];
/** Gusts (m/s): clear when light, yellow (strong breeze) through red (gale) to purple (hurricane force). */
export const GUST = [[8, [255, 245, 170, 0]], [12, [255, 236, 120, 120]], [17, [255, 176, 64, 175]], [24, [255, 90, 70, 205]], [32, [220, 40, 150, 220]], [42, [150, 60, 230, 230]]];
/** Significant wave height (m): blues for slight seas to red and purple for high and phenomenal ones. */
export const WAVE = [[0, [40, 80, 160, 40]], [0.5, [40, 120, 210, 120]], [1.25, [40, 180, 220, 160]], [2.5, [70, 210, 150, 185]], [4, [240, 220, 80, 200]], [6, [250, 140, 50, 210]], [9, [230, 50, 60, 220]], [14, [180, 40, 170, 230]]];
/** Wind streak colours, calm to gale, and the speeds (m/s) between them. */
export const WIND_COLORS = ['#7fe8ff', '#b6f5ff', '#ffffff', '#fff3a8', '#ffc46b', '#ff7a5c'];
export const WIND_EDGES = [3, 6, 10, 15, 22];
/** The kinds that are washes (colour over the map), and how opaque each is laid over the base map. */
export const WASH_ALPHA = Object.freeze({ temp: 0.6, cloud: 1, rain: 1, gust: 0.85, wave: 0.85, pres: 1 });

/** Degrees C → [r, g, b] on the TEMP ramp (black for no value). */
export function tempRgb(t) {
  if (!Number.isFinite(t)) return [0, 0, 0];
  if (t <= TEMP[0][0]) return TEMP[0][1].slice(); if (t >= TEMP[TEMP.length - 1][0]) return TEMP[TEMP.length - 1][1].slice();
  let i = 1; while (t > TEMP[i][0]) i++; const [t0, a] = TEMP[i - 1], [t1, b] = TEMP[i], f = (t - t0) / (t1 - t0);
  return a.map((v, j) => Math.round(v + (b[j] - v) * f));
}
/** Linear steps through RGBA stops (log steps with `log`); below the first stop: clear. */
export function stepped(stops, v, log = false) {
  if (!(v >= stops[0][0])) return [0, 0, 0, 0];
  if (v >= stops[stops.length - 1][0]) return stops[stops.length - 1][1].slice();
  let i = 1; while (v > stops[i][0]) i++;
  const [m0, a] = stops[i - 1], [m1, b] = stops[i], f = log ? Math.log(v / m0) / Math.log(m1 / m0) : (v - m0) / (m1 - m0);
  return a.map((x, j) => Math.round(x + (b[j] - x) * f));
}
/** Cloud cover (%) → white, see-through where it is thin. */
export function cloudRgba(pc) {
  const a = Number.isFinite(pc) ? Math.max(0, Math.min(1, (pc - 12) / 88)) : 0;
  const g = Math.round(205 + 50 * a);
  return [g, g, Math.min(255, g + 6), Math.round(Math.pow(a, 1.15) * 225)];
}

/** The colour of a wash at a value, [r, g, b, a] (0-255): temp °C, cloud %, rain mm/h, gust m/s, wave m (NaN: land,
 *  clear). Temperature is opaque here; the view lays the whole wash at WASH_ALPHA. */
export function washRgba(kind, v) {
  switch (kind) {
    case 'temp': return Number.isFinite(v) ? [...tempRgb(v), 255] : [0, 0, 0, 0];
    case 'cloud': return cloudRgba(v);
    case 'rain': return stepped(RAIN, v, true);
    case 'gust': return stepped(GUST, v);
    case 'wave': return Number.isFinite(v) ? stepped(WAVE, Math.max(0, v)) : [0, 0, 0, 0];
    default: return [0, 0, 0, 0];
  }
}

/** Which streak colour (index into WIND_COLORS) a wind speed (m/s) gets. */
export function windBucket(speed) {
  let b = 0; while (b < WIND_EDGES.length && speed > WIND_EDGES[b]) b++;
  return b;
}

/**
 * Paint a wash into an RGBA buffer `px` (w × h, row by row, 4 bytes a pixel) through any projection: `at(x, y)` gives
 * the value at the centre of pixel (x, y) (NaN where there is none). `step` > 1 samples every step-th pixel and fills
 * the block (a cheap preview for big canvases). Returns px.
 */
export function paintWash(kind, px, w, h, at, step = 1) {
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const [r, g, b, a] = washRgba(kind, at(x + step / 2 - 0.5, y + step / 2 - 0.5));
    for (let yy = y; yy < Math.min(h, y + step); yy++) for (let xx = x; xx < Math.min(w, x + step); xx++) {
      const i = (yy * w + xx) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  return px;
}

/**
 * Darts for the direction waves run: one every `step` degrees of open sea with waves of `minH` m or more (fewer toward
 * the poles, where a degree of longitude is short), inside the box. `value(kind, lat, lon)` reads 'wave' (m) and
 * 'wavedir' (° the waves come from). [{ lat, lon, to (° they run towards), h }].
 */
export function waveDarts(value, { step = 4, minH = 0.3, south = -75, north = 75, west = -180, east = 180 } = {}) {
  const out = [];
  const lat0 = Math.ceil(Math.max(-75, south) / step) * step;
  for (let lat = lat0; lat <= Math.min(75, north); lat += step) {
    const k = Math.max(1, Math.round(1 / Math.cos(lat * RAD))), dl = step * k;
    const o = -180 + step / 2;   // on a world-fixed grid, so the darts stay put while a map pans
    for (let lon = o + Math.ceil((west - o) / dl) * dl; lon < east; lon += dl) {
      const L = ((lon + 180) % 360 + 360) % 360 - 180;
      const h = value('wave', lat, L), from = value('wavedir', lat, L);
      if (!(h >= minH) || !Number.isFinite(from)) continue;
      out.push({ lat, lon, to: (from + 180) % 360, h });
    }
  }
  return out;
}

/**
 * The isobar chart of a pressure field (Pa), blended in time from forecast hours a and b (w): smoothed to 1° first
 * (a 0.25° field wiggles over every mountain), lines every 4 hPa from 1000 (bold every 20), where to write their
 * values (`spacing` degrees apart along a line, none within 5° of an H or L), and the highs and lows that stand 2.5 hPa
 * off their surroundings within 9°. { lines: [{ hpa, bold, lines: [[[lon, lat], …]] }], labels: [{ lon, lat, angle,
 * text }], centres: [{ type: 'H' | 'L', lat, lon, value (hPa) }] }.
 */
export function pressureChart(a, b = null, w = 0, { maxCentres = 32, spacing = 40, minLen = 12, maxLat = 75 } = {}) {
  const f0 = blend(a, b, w), f = coarsen(f0, Math.max(1, Math.round(1 / f0.grid.di)));
  let lo = Infinity, hi = -Infinity; for (const v of f.values) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const lines = isolines(f, levels(lo, hi, 400, 100000)).map(({ level, lines: ls }) => ({ hpa: Math.round(level / 100), bold: Math.round(level / 100) % 20 === 0, lines: ls }));
  const centres = extrema(f, { radius: 9, depth: 250 }).slice(0, maxCentres).map(e => ({ ...e, value: e.value / 100 }));
  const nearCentre = (lat, lon) => centres.some(e => Math.abs(e.lat - lat) < 5 && Math.abs(((e.lon - lon) % 360 + 540) % 360 - 180) * Math.cos(lat * RAD) < 5);
  const labels = [];
  for (const { hpa, lines: ls } of lines) for (const line of ls) for (const s of labelSpots(line, { spacing, minLen })) {
    if (Math.abs(s.lat) > maxLat || nearCentre(s.lat, s.lon)) continue;
    labels.push({ ...s, text: String(hpa) });
  }
  return { lines, labels, centres };
}

/**
 * A line in longitudes that may run past ±180 (isolines on a global grid do) as pieces that each stay continuous, for
 * a flat map: split where it jumps by more than half the world. [[[lon, lat], …], …].
 */
export function splitJumps(line) {
  const out = []; let cur = [];
  for (const p of line) {
    if (cur.length && Math.abs(p[0] - cur[cur.length - 1][0]) > 180) { if (cur.length > 1) out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/**
 * The legend for a layer: { title, gradient (a CSS linear-gradient), ticks: [[percent, label]] } in metric, or with
 * `imperial` in °F, mph and feet. Pressure has no colours: a line about the isobars instead.
 */
export function legendFor(kind, imperial = false) {
  const css = (stops, a = 1) => `linear-gradient(90deg,${stops.map(([, c], i) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255 * a + (1 - a)}) ${(i / (stops.length - 1) * 100).toFixed(1)}%`).join(',')})`;
  const ticks = (stops, f) => stops.map(([v], i) => [i / (stops.length - 1) * 100, f(v)]);
  const mph = v => Math.round(v * 2.23694), kmh = v => Math.round(v * 3.6);
  switch (kind) {
    case 'temp': return { title: imperial ? 'Temperature °F' : 'Temperature °C', gradient: css(TEMP.map(([v, c]) => [v, [...c, 255]])), ticks: ticks(TEMP, v => imperial ? Math.round(v * 9 / 5 + 32) : v) };
    case 'gust': return { title: imperial ? 'Gusts, mph' : 'Gusts, km/h', gradient: css(GUST, 0.6), ticks: ticks(GUST, imperial ? mph : kmh) };
    case 'wave': return { title: imperial ? 'Waves, feet (darts: where they run)' : 'Waves, metres (darts: where they run)', gradient: css(WAVE, 0.6), ticks: ticks(WAVE, v => imperial ? Math.round(v * 3.28084) : v) };
    case 'rain': return { title: 'Rain, mm/h', gradient: css(RAIN, 0.6), ticks: ticks(RAIN, v => v) };
    case 'cloud': return { title: 'Cloud cover, %', gradient: 'linear-gradient(90deg,rgba(205,205,211,0) 0%,rgba(230,230,236,.5) 50%,rgba(255,255,255,.9) 100%)', ticks: [[0, 12], [50, 56], [100, 100]] };
    case 'wind': return { title: imperial ? 'Wind streaks, mph' : 'Wind streaks, km/h', gradient: `linear-gradient(90deg,${WIND_COLORS.map((c, i) => `${c} ${(i / (WIND_COLORS.length - 1) * 100).toFixed(1)}%`).join(',')})`,
      ticks: [0, ...WIND_EDGES].map((v, i) => [i / WIND_EDGES.length * 100, imperial ? mph(v) : kmh(v)]) };
    case 'pres': return { title: 'Pressure: isobars every 4 hPa, heavier every 20; H high, L low', gradient: null, ticks: [] };
    default: return null;
  }
}
