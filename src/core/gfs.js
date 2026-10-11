// NOAA's GFS weather model on AWS (keyless, CORS, byte ranges): which run to read, its files, the fields the globe
// draws, how a moment between two forecast hours blends them, and the weather timeline's moments. Pure
// (test/gfs.test.mjs); the GRIB2 itself is read by core/grib2.js.

export const GFS_BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';
/** What the globe draws, as NOAA's .idx inventories name the fields. */
export const FIELDS = Object.freeze({
  wind: [['UGRD', '10 m above ground'], ['VGRD', '10 m above ground']],
  temp: [['TMP', '2 m above ground']],
  cloud: [['TCDC', 'entire atmosphere']],
  rain: [['PRATE', 'surface']],
});
/** GRIB2 "category.number" (discipline 0, meteorology) → our name for the field. */
export const PARAM = Object.freeze({ '2.2': 'u', '2.3': 'v', '0.0': 'temp', '6.1': 'cloud', '1.7': 'rain' });

const pad = (n, k) => String(n).padStart(k, '0');
const H = 3600e3, RUN = 6 * H;
/** The model run that starts at t (ms, a multiple of 6 h): { t, date: 'YYYYMMDD', hour: 'HH' }. */
export function cycleAt(t) {
  const d = new Date(t);
  return { t, date: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`, hour: pad(d.getUTCHours(), 2) };
}
/** Runs to try, newest first. A run's 1° files are all out 4-5 h after it starts; the newest is tried from 3.5 h. */
export function gfsCycles(now, n = 4) {
  const t0 = Math.floor((now - 3.5 * H) / RUN) * RUN;
  return Array.from({ length: n }, (_, i) => cycleAt(t0 - i * RUN));
}
/** The 1° file of forecast hour h in run c (add '.idx' for its inventory). */
export const gfsFile = (c, h) => `${GFS_BUCKET}/gfs.${c.date}/${c.hour}/atmos/gfs.t${c.hour}z.pgrb2.1p00.f${pad(h, 3)}`;

/** For a moment t (ms): the 3-hourly forecast hours either side of it in run c and the weight of the later one. */
export function bracket(c, t, maxH = 120, step = 3) {
  const h = Math.max(0, Math.min(maxH, (t - c.t) / H)), h0 = Math.min(maxH - step, Math.floor(h / step) * step);
  return { h0, h1: h0 + step, w: (h - h0) / step };
}

/**
 * The weather timeline's moments, oldest first: `obs` observed frames `obsStep` ms apart ending at `obsEnd` (satellite
 * pictures, radar), then forecast moments on the model's hours (every `every` h of run c) from the first one after
 * the last observed frame up to `until`. [{ t, fcst: false, k } | { t, fcst: true, h }]
 */
export function timeline({ obsEnd, obs = 6, obsStep = 30 * 60e3, run, until, every = 3 }) {
  const out = [];
  for (let k = 0; k < obs; k++) out.push({ t: obsEnd - (obs - 1 - k) * obsStep, fcst: false, k });
  if (run) {
    const after = out.length ? out[out.length - 1].t : -Infinity;
    for (let h = 0; run.t + h * H <= until; h += every) { const t = run.t + h * H; if (t > after + 20 * 60e3) out.push({ t, fcst: true, h }); }
  }
  return out;
}

/** "-2 h 30 min", "now", "+3 h", "+2 days 6 h": a moment against now. */
export function relTime(t, now) {
  const m = Math.round((t - now) / 60e3), a = Math.abs(m), s = m < 0 ? '−' : '+';
  if (a < 10) return 'now';
  if (a < 60) return `${s}${a} min`;
  const h = Math.floor(a / 60), mm = a % 60;
  if (h < 48) return `${s}${h} h${mm >= 10 ? ' ' + mm + ' min' : ''}`;
  const d = Math.floor(h / 24), hh = h % 24;
  return `${s}${d} days${hh ? ' ' + hh + ' h' : ''}`;
}

/** Wind components (m/s, u east, v north) → { speed (m/s), from (degrees the wind blows from, 0 = north) }. */
export function windFrom(u, v) {
  return { speed: Math.hypot(u, v), from: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360 };
}
const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** A bearing in words ("south-west"). */
export const compass = deg => POINTS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
