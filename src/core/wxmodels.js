// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The weather models the globe can read straight from their open buckets (keyless, CORS, HTTP byte ranges), side by
// side: NOAA's GFS (1°, with NOAA's WAVEWATCH III ocean waves at 0.25°) and ECMWF's IFS (0.25°, with its wave model;
// CC BY 4.0). For each: which runs exist when, a forecast hour's files and their inventories, which fields the globe
// draws, and which GRIB2 parameters those are. Pure (test/wxmodels.test.mjs); fetching happens in core/wxload.js and
// its worker, decoding in core/grib2.js.
import { cycleAt, gfsCycles, gfsFile, GFS_BUCKET } from './gfs.js';

const H = 3600e3;
const pad = (n, k) => String(n).padStart(k, '0');
export const ECMWF_BUCKET = 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com';

/** A GRIB2 message's parameter → [our field name, scale to our units]. Discipline 0 is meteorology, 10 the ocean. */
const PARAMS = {
  '0:2.2': ['u', 1], '0:2.3': ['v', 1], '0:0.0': ['temp', 1], '0:6.1': ['cloud', 1], '0:6.192': ['cloud', 100],   // ECMWF sends cloud as a fraction (a local parameter)
  '0:1.7': ['rain', 1], '0:1.52': ['rain', 1], '0:3.1': ['pres', 1], '0:3.0': ['pres', 1], '0:2.22': ['gust', 1],
  '10:0.3': ['wave', 1], '10:0.10': ['wavedir', 1], '10:0.14': ['wavedir', 1],
};
/** { discipline, category, number } → { key, scale } or null for a field the globe doesn't use. */
export function paramKey(m) {
  const p = PARAMS[`${m.discipline}:${m.category}.${m.number}`];
  return p ? { key: p[0], scale: p[1] } : null;
}

/** ECMWF runs to try, newest first: 00 and 12 UTC (the ones that reach 6 days), each complete about 7-8 h after it starts. */
export function ecmwfCycles(now, n = 3) {
  const t0 = Math.floor((now - 7.5 * H) / (12 * H)) * 12 * H;
  return Array.from({ length: n }, (_, i) => cycleAt(t0 - i * 12 * H));
}
/** ECMWF's file for forecast hour h of run c: stream 'oper' (the atmosphere) or 'wave'. Its inventory is the same name ending .index. */
export const ecmwfFile = (c, h, stream = 'oper') => `${ECMWF_BUCKET}/${c.date}/${c.hour}z/ifs/0p25/${stream}/${c.date}${c.hour}0000-${h}h-${stream}-fc.grib2`;
/** GFS-Wave (WAVEWATCH III), the global 0.25° grid of the same run as the atmosphere. Inventory: + '.idx'. */
export const gfsWaveFile = (c, h) => `${GFS_BUCKET}/gfs.${c.date}/${c.hour}/wave/gridded/gfswave.t${c.hour}z.global.0p25.f${pad(h, 3)}.grib2`;

/**
 * ECMWF's inventory (one JSON object a line: param, levtype, step, _offset, _length) → rows shaped like core/grib2.js's
 * parseIdx gives for NOAA's: [{ n, start, end, variable, level, forecast }], so idxRanges picks from either.
 */
export function parseEcIndex(text) {
  const rows = [];
  let n = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    if (!o || typeof o.param !== 'string' || !Number.isFinite(o._offset) || !Number.isFinite(o._length)) continue;
    rows.push({ n: ++n, start: o._offset, end: o._offset + o._length - 1, variable: o.param, level: o.levelist ? `${o.levtype} ${o.levelist}` : String(o.levtype || ''), forecast: `${o.step} hour fcst`, date: o.date + o.time });
  }
  return rows;
}

/** What each model's files call the fields, by what we draw. `file` names the stream they live in. */
export const MODELS = Object.freeze({
  gfs: {
    id: 'gfs', name: 'NOAA GFS', short: 'GFS', grid: '1°', every: 3, maxH: 384, index: 'idx',
    credit: 'NOAA GFS model; waves: NOAA WAVEWATCH III (GFS-Wave)', licence: 'public domain (US government)',
    cycles: gfsCycles,
    file: (c, h, stream = 'atmos') => stream === 'wave' ? gfsWaveFile(c, h) : gfsFile(c, h),
    indexOf: url => url + '.idx',
    cachePath: c => `/gfs.${c.date}/${c.hour}/`,
    kinds: {
      wind: { stream: 'atmos', wants: [['UGRD', '10 m above ground'], ['VGRD', '10 m above ground']] },
      temp: { stream: 'atmos', wants: [['TMP', '2 m above ground']] },
      cloud: { stream: 'atmos', wants: [['TCDC', 'entire atmosphere']] },
      rain: { stream: 'atmos', wants: [['PRATE', 'surface']] },
      pres: { stream: 'atmos', wants: [['PRMSL', 'mean sea level']] },
      gust: { stream: 'atmos', wants: [['GUST', 'surface']] },
      wave: { stream: 'wave', wants: [['HTSGW', 'surface'], ['DIRPW', 'surface']] },
    },
    notes: { gust: 'gusts at the surface, at the hour', wave: 'significant wave height and the main swell direction' },
  },
  ecmwf: {
    id: 'ecmwf', name: 'ECMWF IFS', short: 'ECMWF', grid: '0.25°', every: 3, maxH: 144, index: 'json',
    credit: 'ECMWF IFS open data (CC BY 4.0)', licence: 'CC BY 4.0',
    cycles: ecmwfCycles,
    file: (c, h, stream = 'oper') => ecmwfFile(c, h, stream),
    indexOf: url => url.replace(/\.grib2$/, '.index'),
    cachePath: c => `/${c.date}/${c.hour}z/`,
    kinds: {
      wind: { stream: 'oper', wants: [['10u', 'sfc'], ['10v', 'sfc']] },
      temp: { stream: 'oper', wants: [['2t', 'sfc']] },
      cloud: { stream: 'oper', wants: [['tcc', 'sfc']] },
      rain: { stream: 'oper', wants: [['tprate', 'sfc']] },
      pres: { stream: 'oper', wants: [['msl', 'sfc']] },
      gust: { stream: 'oper', wants: [['10fg', 'sfc']] },
      wave: { stream: 'wave', wants: [['swh', 'sfc'], ['mwd', 'sfc']] },
    },
    notes: { gust: 'the strongest gust in the hour before', wave: 'significant wave height and the mean wave direction' },
  },
});

/** The fields a kind fills in once fetched ('wind' → u and v; 'wave' → wave and wavedir). */
export const PARTS = Object.freeze({ wind: ['u', 'v'], wave: ['wave', 'wavedir'] });
export const partsOf = kind => PARTS[kind] || [kind];

/**
 * Forecast hours either side of moment t for a model whose files come every `every` hours (3 for both, up to the
 * hour we show): { h0, h1, w }. Same as core/gfs.js's bracket, kept here so both models share one rule.
 */
export function bracketFor(model, c, t, maxH) {
  const step = model.every, top = Math.min(maxH, model.maxH);
  const h = Math.max(0, Math.min(top, (t - c.t) / H)), h0 = Math.min(top - step, Math.floor(h / step) * step);
  return { h0, h1: h0 + step, w: (h - h0) / step };
}

/** "the 12:00 UTC run of 11/10": a run in words for the panel. */
export const runWords = c => `the ${c.hour}:00 UTC run of ${c.date.slice(6, 8)}/${c.date.slice(4, 6)}`;
