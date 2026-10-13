// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Earth now": what is happening on the planet right now, summed up from the feeds the globe already reads (USGS quakes,
// tropical cyclones, NASA EONET wildfires, Launch Library 2 launches and astronauts, NOAA's Kp index, NASA/JPL flybys,
// the weather model's fields). Pure aggregation and the small history charts as SVG text: no DOM, no fetch, so Node can
// test every number the panel shows (test/earthnow.test.mjs). The globe's panel is src/globe/now.js.
import { rowLat } from './fields.js';
import { esc } from './format.js';

const DAY = 864e5;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Midnight UTC of the day holding `ms`. */
export const utcDayStart = ms => Math.floor(ms / DAY) * DAY;

// ---- earthquakes --------------------------------------------------------------------------------------------------

/** The US state and territory codes USGS writes after a place ("5 km W of Cobb, CA"), and its other short forms. */
const US = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', MX: 'Mexico', 'B.C.': 'Mexico' };

/**
 * The region of a USGS place, for grouping: the part after the last comma ("12 km NNE of Pahala, Hawaii" → "Hawaii",
 * "5 km W of Cobb, CA" → "California"), or the place without its distance and direction ("south of the Fiji Islands" →
 * "Fiji Islands", "Fiji region" → "Fiji"). Empty in, "Unnamed area" out.
 */
export function quakeRegion(place) {
  let s = String(place || '').trim();
  if (!s) return 'Unnamed area';
  const comma = s.lastIndexOf(',');
  if (comma >= 0) s = s.slice(comma + 1).trim();
  else s = s.replace(/^\d+(\.\d+)?\s*km\s+[NSEW]{1,3}\s+of\s+/i, '');
  s = s.replace(/^(far\s+)?((north|south|east|west)(east|west)?(ern)?|central|off the (east |west |north |south )?coast of|near the (east |west |north |south )?coast of|near)\s+(of\s+)?/i, '')
    .replace(/^the\s+/i, '').replace(/\s+region$/i, '').trim();
  if (US[s]) return US[s];
  if (US[s.toUpperCase()] && s.length <= 4) return US[s.toUpperCase()];
  return s ? s[0].toUpperCase() + s.slice(1) : 'Unnamed area';
}

/** A quake's strength in words (USGS's own classes). */
export const quakeClass = m => !fin(m) ? 'unknown' : m >= 8 ? 'great' : m >= 7 ? 'major' : m >= 6 ? 'strong' : m >= 5 ? 'moderate' : m >= 4 ? 'light' : m >= 3 ? 'minor' : 'micro';

/**
 * Quakes (core/quakes.js parseUsgs) → { count, strongest, m45, m6, tsunami (flagged), alerts (PAGER yellow and worse),
 * latest, regions: [{ region, n, max, q (its strongest quake) }] busiest first (ties: the stronger) }. `since` (ms)
 * keeps only quakes from then on.
 */
export function summarizeQuakes(list, { since = -Infinity, top = 6 } = {}) {
  const qs = (Array.isArray(list) ? list : []).filter(q => q && fin(q.lat) && fin(q.lon) && (!fin(since) || (fin(q.time) && q.time >= since)));
  const by = new Map();
  let strongest = null, latest = null, m45 = 0, m6 = 0, tsunami = 0, alerts = 0;
  for (const q of qs) {
    const m = fin(q.mag) ? q.mag : -9;
    if (!strongest || m > (fin(strongest.mag) ? strongest.mag : -9) || (m === strongest.mag && (q.time || 0) > (strongest.time || 0))) strongest = q;
    if (!latest || (q.time || 0) > (latest.time || 0)) latest = q;
    if (m >= 4.5) m45++; if (m >= 6) m6++; if (q.tsunami) tsunami++; if (q.alert && q.alert !== 'green') alerts++;
    const r = quakeRegion(q.place); let g = by.get(r);
    if (!g) by.set(r, g = { region: r, n: 0, max: -9, q: null });
    g.n++; if (m > g.max || !g.q) { g.max = m; g.q = q; }
  }
  const regions = [...by.values()].sort((a, b) => b.n - a.n || b.max - a.max || a.region.localeCompare(b.region)).slice(0, top);
  return { count: qs.length, strongest, latest, m45, m6, tsunami, alerts, regions };
}

/**
 * Counts per UTC day for the `days` days ending today (oldest first): [{ t (midnight UTC), day ('2026-10-13'), label
 * ('Oct 13'), n, max (largest value of `size`, or null), partial (today, still going) }]. `time(x)` gives an item's ms.
 */
export function dailyCounts(items, { now = Date.now(), days = 7, time = x => x && x.time, size = x => x && x.mag, min = -Infinity } = {}) {
  const today = utcDayStart(now), first = today - (days - 1) * DAY;
  const out = Array.from({ length: days }, (_, i) => { const t = first + i * DAY, d = new Date(t); return { t, day: isoDay(t), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`, n: 0, max: null, partial: t === today }; });
  for (const x of Array.isArray(items) ? items : []) {
    const t = time(x); if (!fin(t) || t < first || t >= today + DAY) continue;
    const s = size(x); if (min > -Infinity && !(fin(s) && s >= min)) continue;
    const b = out[Math.floor((t - first) / DAY)]; b.n++;
    if (fin(s) && (b.max == null || s > b.max)) b.max = s;
  }
  return out;
}

// ---- space weather: the planetary K index ------------------------------------------------------------------------

/** NOAA SWPC's Kp product with the last week observed and estimated and the next 3 days predicted (public domain, CORS). */
export const KP_FORECAST_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

/** NOAA's G scale from Kp (SWPC marks Kp 5- (4.67) as G1): { g (0-5), name, color }. */
export function kpLevel(kp) {
  if (!fin(kp)) return { g: 0, name: 'unknown', color: '#8b9bab' };
  const g = Math.max(0, Math.min(5, Math.round(kp) - 4));
  const name = g ? `G${g} ${['minor', 'moderate', 'strong', 'severe', 'extreme'][g - 1]} storm` : kp >= 4 - 1e-6 ? 'active' : kp >= 3 - 1e-6 ? 'unsettled' : 'quiet';
  const color = ['#7dffa6', '#ffe36e', '#ffb44d', '#ff7b4f', '#ff4d5e', '#ff4df0'][g] || '#7dffa6';
  return { g, name, color: !g && kp >= 4 - 1e-6 ? '#d6f56e' : color };
}

/** Where the aurora may be seen at this Kp, roughly (geomagnetic latitude of the oval's equator edge, SWPC's rule of thumb). */
export function auroraReach(kp) {
  if (!fin(kp)) return '';
  const k = Math.max(0, Math.min(9, Math.round(kp)));
  const lat = [66, 64.5, 62.4, 60.4, 58.3, 56.3, 54.2, 52.2, 50.1, 48][k];
  const where = k >= 8 ? 'far from the poles: northern US states, central Europe' : k >= 6 ? 'mid-latitudes: Scotland, southern Scandinavia, the northern US' : k >= 4 ? 'northern Scandinavia, Iceland, Alaska and Canada' : 'near the poles only';
  return `about ${lat}° geomagnetic latitude and poleward: ${where}`;
}

/**
 * NOAA's Kp products (rows [time, Kp, ...] after a header, or objects { time_tag, Kp | kp, observed }) → [{ t (ms), kp,
 * kind ('observed' | 'estimated' | 'predicted') }] oldest first, from `pastH` hours before `now` to `aheadH` after.
 */
export function kpSeries(doc, { now = Date.now(), pastH = 72, aheadH = 0 } = {}) {
  const rows = [];
  for (const r of Array.isArray(doc) ? doc : []) {
    let tag, kp, kind;
    if (Array.isArray(r)) { tag = r[0]; kp = parseFloat(r[1]); kind = typeof r[2] === 'string' && /^(observed|estimated|predicted)$/.test(r[2]) ? r[2] : 'observed'; }
    else if (r && typeof r === 'object') { tag = r.time_tag; kp = parseFloat(r.Kp ?? r.kp ?? r.kp_index); kind = /^(observed|estimated|predicted)$/.test(r.observed) ? r.observed : 'observed'; }
    if (typeof tag !== 'string') continue;
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(tag) ? tag : tag.replace(' ', 'T') + 'Z');
    if (!fin(t) || !fin(kp) || kp < 0 || kp > 9) continue;
    if (t < now - pastH * 3600e3 || t > now + aheadH * 3600e3) continue;
    rows.push({ t, kp, kind });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows.filter((r, i) => i === 0 || r.t !== rows[i - 1].t);
}

/** The Kp story for the panel: { now (the latest observed or estimated row whose 3-hour block has begun: SWPC tags a
 *  block by its start and sometimes "estimates" one that hasn't), max (the highest observed or estimated so far), next
 *  (the highest still to come), level (kpLevel of now) } or null. */
export function kpSummary(series, now = Date.now()) {
  const seen = series.filter(r => r.kind !== 'predicted' && r.t <= now), ahead = series.filter(r => r.t > now || r.kind === 'predicted');
  if (!seen.length && !ahead.length) return null;
  const top = list => list.reduce((m, r) => (!m || r.kp > m.kp ? r : m), null);
  const cur = seen.length ? seen[seen.length - 1] : null;
  return { now: cur, max: top(seen), next: top(ahead.filter(r => r.t > (cur ? cur.t : -Infinity))), level: kpLevel(cur ? cur.kp : NaN) };
}

// ---- cyclones, wildfires, launches, people, flybys ------------------------------------------------------------------

/** Storms (core/cyclones.js loadCyclones) → { count, strongest, list (strongest first) }. */
export function summarizeStorms(list) {
  const s = (Array.isArray(list) ? list : []).filter(x => x && fin(x.lat) && fin(x.lon));
  const sorted = s.slice().sort((a, b) => (b.kt || 0) - (a.kt || 0) || String(a.title || a.name).localeCompare(String(b.title || b.name)));
  return { count: s.length, strongest: sorted[0] || null, list: sorted };
}

/** Acres from an EONET magnitude ('2000 acres'), or null. */
const acresOf = e => { const m = /^([\d.]+)\s*acres?$/i.exec(String(e && e.mag || '')); return m ? +m[1] : null; };

/** Is an EONET fire a planned burn ("Prescribed Fire West Fork RX, Wasatch, Utah")? */
export const prescribed = e => /^prescribed\b|\bRX\b/i.test(String(e && e.title || ''));

/**
 * NASA EONET wildfire events (core/eonet.js parseEonet) → { count (wildfires), rx (prescribed burns, counted apart),
 * newest, largest (by reported acres), largestAcres, recent (updated in the last `days` days), places: [{ region
 * ('Idaho'), n, e }] busiest first }. EONET's fires come mostly from US and Canadian incident reports: a list of named
 * fires, not every fire on Earth (the satellites' hot spots are the globe's Wildfires layer).
 */
export function summarizeWildfires(events, { now = Date.now(), days = 7, top = 5 } = {}) {
  const all = (Array.isArray(events) ? events : []).filter(e => e && fin(e.lat) && fin(e.lon) && !e.closed && (!e.cat || e.cat === 'wildfires' || (e.catIds || []).includes('wildfires')));
  const ev = all.filter(e => !prescribed(e));
  let newest = null, largest = null, recent = 0;
  const by = new Map();
  for (const e of ev) {
    const t = Date.parse(e.date || '');
    if (fin(t) && (!newest || t > Date.parse(newest.date))) newest = e;
    if (fin(t) && t >= now - days * DAY) recent++;
    const a = acresOf(e); if (a != null && (!largest || a > acresOf(largest))) largest = e;
    const r = wildfireRegion(e.title); let g = by.get(r); if (!g) by.set(r, g = { region: r, n: 0, e }); g.n++;
  }
  return { count: ev.length, rx: all.length - ev.length, newest, largest, largestAcres: largest ? acresOf(largest) : null, recent,
    places: [...by.values()].sort((a, b) => b.n - a.n || a.region.localeCompare(b.region)).slice(0, top) };
}
/** "Wildfire Buckhorn 2, Cassia, Idaho" → "Idaho"; "Wildfires - Northern Territory, Australia" → "Australia". */
export const wildfireRegion = title => { const parts = String(title || '').split(',').map(s => s.trim()).filter(Boolean); return parts.length > 1 ? parts[parts.length - 1] : 'Elsewhere'; };

/** Launches (core/launches.js fromLL2) in the next `hours` hours (and any in flight): soonest first. */
export function launchesSoon(list, { now = Date.now(), hours = 24 } = {}) {
  return (Array.isArray(list) ? list : []).filter(l => l && (l.status === 'In Flight' || (fin(l.net) && l.net >= now - 3600e3 && l.net <= now + hours * 3600e3)))
    .sort((a, b) => (a.net || 0) - (b.net || 0));
}
/** Launches on today's UTC date (flown or not, as far as the list still holds them). */
export const launchesToday = (list, now = Date.now()) => (Array.isArray(list) ? list : []).filter(l => l && fin(l.net) && utcDayStart(l.net) === utcDayStart(now)).sort((a, b) => a.net - b.net);

/**
 * Launches per calendar month (UTC) for `months` months from `now`'s month: [{ t, month ('2026-10'), label ('Oct'), n,
 * partial }]. A month is partial when it started before `now` (launches already flown are not in an upcoming list) or
 * ends after the list's last launch (the list holds only the next few dozen). Only launches with a firm-ish date (a day
 * or better) count: "NET Q1 2027" would pile up on the first of a month.
 */
export function launchesByMonth(list, { now = Date.now(), months = 3, truncated = true } = {}) {
  const ok = (Array.isArray(list) ? list : []).filter(l => l && fin(l.net) && !/^(M|MONTH|Q[1-4]|H[12]|Y|YEAR|FY)$/i.test(String(l.precision || '')));
  const d = new Date(now), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const last = ok.reduce((x, l) => Math.max(x, l.net), -Infinity);
  return Array.from({ length: months }, (_, i) => {
    const t = Date.UTC(y, m + i, 1), end = Date.UTC(y, m + i + 1, 1), dd = new Date(t);
    const n = ok.filter(l => l.net >= t && l.net < end).length;
    return { t, month: `${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(2, '0')}`, label: MONTHS[dd.getUTCMonth()], n, partial: i === 0 || (truncated && end > last) };
  });
}

/** Flybys (data/flybys.json rows { name, tca (ms), au, kms, h, km }) → { next7 (count within 7 days), closest (of those),
 *  next (the soonest still to come), ld (closest's distance in lunar distances) }. */
export function summarizeFlybys(rows, { now = Date.now(), days = 7 } = {}) {
  const LD_AU = 384400 / 149597870.7;
  const ahead = (Array.isArray(rows) ? rows : []).filter(r => r && fin(r.tca) && fin(r.au) && r.tca >= now).sort((a, b) => a.tca - b.tca);
  const week = ahead.filter(r => r.tca <= now + days * DAY);
  const closest = week.reduce((m, r) => (!m || r.au < m.au ? r : m), null);
  return { next7: week.length, closest, next: ahead[0] || null, ld: closest ? closest.au / LD_AU : null, total: ahead.length };
}

// ---- weather extremes from a model field --------------------------------------------------------------------------

const lonOf = (g, i) => { const x = ((g.lo1 + i * g.di) % 360 + 360) % 360; return x > 180 ? x - 360 : x; };

/**
 * The highest and lowest values of a model field (core/fields.js shape: { grid, values }) with where they are:
 * { max: { v, lat, lon }, min: { v, lat, lon } } or null. NaNs (no data) are skipped. `pick(lat, lon)` may exclude points.
 */
export function fieldExtremes(f, { pick = null } = {}) {
  if (!f || !f.grid || !f.values) return null;
  const g = f.grid, v = f.values;
  let max = null, min = null;
  for (let j = 0; j < g.nj; j++) {
    const lat = rowLat(g, j);
    for (let i = 0; i < g.ni; i++) {
      const x = v[j * g.ni + i]; if (!(x === x)) continue;
      if (max && min && x <= max.v && x >= min.v) continue;
      const lon = lonOf(g, i); if (pick && !pick(lat, lon)) continue;
      if (!max || x > max.v) max = { v: x, lat, lon };
      if (!min || x < min.v) min = { v: x, lat, lon };
    }
  }
  return max ? { max, min } : null;
}

/** The strongest wind of a { u, v } pair of fields (m/s): { v (speed), lat, lon, from (degrees the wind blows from) } or null. */
export function windiest(w) {
  if (!w || !w.u || !w.v || !w.u.values || !w.v.values) return null;
  const g = w.u.grid, U = w.u.values, V = w.v.values;
  let best = null;
  for (let j = 0; j < g.nj; j++) for (let i = 0; i < g.ni; i++) {
    const k = j * g.ni + i, u = U[k], v = V[k]; if (!(u === u) || !(v === v)) continue;
    const s = Math.hypot(u, v);
    if (!best || s > best.v) best = { v: s, lat: rowLat(g, j), lon: lonOf(g, i), u, w: v };
  }
  if (!best) return null;
  return { v: best.v, lat: best.lat, lon: best.lon, from: ((Math.atan2(-best.u, -best.w) * 180 / Math.PI) + 360) % 360 };
}

/** Kelvin → "41 °C · 106 °F"; m/s → "38 m/s · 137 km/h · 74 kt". */
export const tempWords = k => fin(k) ? `${Math.round(k - 273.15)} °C · ${Math.round((k - 273.15) * 9 / 5 + 32)} °F` : '—';
export const windWords = ms => fin(ms) ? `${Math.round(ms * 3.6)} km/h · ${Math.round(ms * 1.943844)} kt` : '—';
/** 41.2, -12.5 → "41.2°N 12.5°W". */
export const latLonWords = (lat, lon) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

/** Weather model extremes in one go: { hottest, coldest, windiest } from { temp (K field), wind ({ u, v }) }. */
export function weatherExtremes({ temp, wind } = {}) {
  const t = fieldExtremes(temp);
  return { hottest: t ? t.max : null, coldest: t ? t.min : null, windiest: windiest(wind) };
}

// ---- small charts as SVG text ------------------------------------------------------------------------------------

/**
 * A bar chart as SVG markup: accessible (role="img", a <title> and a <desc> listing every value, a <title> per bar for
 * hover) and theme-aware (bars in `currentColor` unless a bar brings its own colour; text and lines in CSS variables
 * with fallbacks). bars: [{ n, label (under the bar, may be ''), long (the bar's full name for the description; else
 * label), color?, dim? (drawn faint: partial or predicted), dimWord?, tip? }]. `values` prints each number over its bar
 * (for a handful of bars). Pure: the panel puts the string into the page; every label is escaped here.
 */
export function barsSvg(bars, { w = 300, h = 74, title = 'Chart', unit = '', max = null, lines = [], every = 1, id = 'c', values = false } = {}) {
  const list = Array.isArray(bars) ? bars : [], n = list.length;
  const top = 10, bottom = 16, left = 2, right = 2, ph = h - top - bottom, pw = w - left - right;
  const hi = Math.max(fin(max) ? max : 0, ...list.map(b => (fin(b.n) ? b.n : 0)), 1e-9);
  const bw = n ? pw / n : pw, gap = Math.min(3, bw * 0.2);
  const y = v => top + ph - (Math.max(0, v) / hi) * ph;
  const desc = list.map(b => `${b.long || b.label}: ${fin(b.n) ? +b.n.toFixed(2) : 'no data'}${unit ? ' ' + unit : ''}${b.dim ? ' (' + (b.dimWord || 'partial') + ')' : ''}`).join('; ');
  const tid = `${id}-t`, did = `${id}-d`;
  let s = `<svg class="nw-chart" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="none" role="img" aria-labelledby="${tid} ${did}" xmlns="http://www.w3.org/2000/svg">`
    + `<title id="${tid}">${esc(title)}</title><desc id="${did}">${esc(desc)}</desc>`
    + `<line x1="${left}" x2="${w - right}" y1="${top + ph}" y2="${top + ph}" stroke="var(--edge-dim, rgba(128,128,128,.4))" stroke-width="1"/>`;
  for (const l of lines) {
    if (!fin(l.v) || l.v > hi) continue;
    const ly = y(l.v).toFixed(1);
    s += `<line x1="${left}" x2="${w - right}" y1="${ly}" y2="${ly}" stroke="${esc(l.color || 'var(--dim, #888)')}" stroke-width="1" stroke-dasharray="3 3" opacity=".8"/>`
      + (l.label ? `<text x="${w - right}" y="${(+ly - 2).toFixed(1)}" text-anchor="end" font-size="8" fill="${esc(l.color || 'var(--dim, #888)')}">${esc(l.label)}</text>` : '');
  }
  list.forEach((b, i) => {
    const v = fin(b.n) ? b.n : 0, x = left + i * bw + gap / 2, yy = y(v), bh = Math.max(v > 0 ? 1.5 : 0, top + ph - yy);
    s += `<rect x="${x.toFixed(1)}" y="${(top + ph - bh).toFixed(1)}" width="${Math.max(1, bw - gap).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${b.color ? esc(b.color) : 'currentColor'}"${b.dim ? ' opacity=".45"' : ''}><title>${esc(b.tip || `${b.long || b.label}: ${fin(b.n) ? +b.n.toFixed(2) : 'no data'}${unit ? ' ' + unit : ''}`)}</title></rect>`;
    if (values && fin(b.n)) s += `<text x="${(x + (bw - gap) / 2).toFixed(1)}" y="${Math.max(8, top + ph - bh - 2).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="var(--ink, currentColor)" aria-hidden="true">${+b.n.toFixed(1)}</text>`;
    if (b.label && (i % every === 0 || i === n - 1)) s += `<text x="${(x + (bw - gap) / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="8.5" fill="var(--faint, #888)">${esc(b.label)}</text>`;
  });
  return s + '</svg>';
}

/** The quake history chart: counts per UTC day (dailyCounts), today drawn faint. */
export const quakeChart = (days, { title = 'Earthquakes per day', id = 'q', every = 1 } = {}) =>
  barsSvg(days.map(d => ({ n: d.n, label: d.label.replace(/^\w+ /, ''), long: d.label, tip: `${d.label}: ${d.n} quake${d.n === 1 ? '' : 's'}${d.max != null ? ', largest M' + d.max.toFixed(1) : ''}${d.partial ? ' (today so far)' : ''}`, dim: d.partial, dimWord: 'today so far' })),
    { title, id, every, unit: 'quakes', values: days.length <= 10 });

/** The Kp chart: 3-hour bars coloured by storm level, predicted ones faint, the G1 line dashed. */
export function kpChart(series, { title = 'Planetary K index, 3-hour values', id = 'kp' } = {}) {
  const fmtT = t => { const d = new Date(t); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`; };
  const bars = series.map(r => {
    const d = new Date(r.t), lv = kpLevel(r.kp);
    return { n: r.kp, label: d.getUTCHours() === 0 ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : '', long: fmtT(r.t), color: lv.color, dim: r.kind === 'predicted', dimWord: 'predicted',
      tip: `${fmtT(r.t)}: Kp ${r.kp.toFixed(2)}, ${lv.name}${r.kind !== 'observed' ? ' (' + r.kind + ')' : ''}` };
  });
  return barsSvg(bars, { title, id, max: 9, unit: 'Kp', lines: [{ v: 4.67, label: 'G1 storm', color: '#ffe36e' }] });
}

/** Launches per month (launchesByMonth), partial months faint. */
export const launchChart = (months, { title = 'Launches scheduled per month', id = 'ln' } = {}) =>
  barsSvg(months.map(m => ({ n: m.n, label: m.label, long: `${m.label} ${m.month.slice(0, 4)}`, dim: m.partial, dimWord: 'partial: the list holds only the next few dozen', tip: `${m.label} ${m.month.slice(0, 4)}: ${m.n} launch${m.n === 1 ? '' : 'es'} listed${m.partial ? ' (partial)' : ''}` })),
    { title, id, unit: 'launches', values: true });
