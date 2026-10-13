// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Time travel: what the globe shows when its clock is in the past. Earthquakes from the USGS catalogue (FDSN event API,
// CORS, keyless, back to 1900), storms and natural events from NASA EONET's closed events and GDACS's past cyclones, and
// satellites from the site build's archive of past element sets (one snapshot a day, 30 days). Pure: no DOM, no fetch.
import { tleEpochJd } from './tle.js';
import { jdFromMs } from './time.js';

export const DAY_MS = 864e5;
/** Further back than this counts as the past: the layers switch from their live feeds to the archives. */
export const PAST_AFTER_MS = 30 * 60e3;
export const isPast = (ms, now = Date.now()) => Number.isFinite(ms) && ms < now - PAST_AFTER_MS;
export const utcDay = ms => new Date(ms).toISOString().slice(0, 10);
export const dayStart = ms => Math.floor(ms / DAY_MS) * DAY_MS;

// ---- what has history and what is live only (the time-travel panel's honest table) -----------------------------------

/** Each kind of thing on the globe and how far back it goes. `back`: how far the archive reaches, in words. */
export const HISTORY = Object.freeze([
  { what: 'Earthquakes', has: true, back: 'since 1900', src: 'USGS catalogue: the 24 h before the time shown, M2.5+' },
  { what: 'Tropical cyclones', has: true, back: 'since about 2000', src: 'NASA EONET and GDACS past tracks, cut at the time shown (no past forecasts)' },
  { what: 'Natural events', has: true, back: 'since about 2000', src: 'NASA EONET closed events: fires, volcanoes, floods, ice' },
  { what: 'Satellites', has: true, back: '30 days', src: 'the site\'s daily archive of element sets; older times hide them' },
  { what: 'Sun, Moon, day and night', has: true, back: 'any date', src: 'computed' },
  { what: 'Aircraft', has: false, src: 'live feeds only: hidden in the past' },
  { what: 'Rocket launches', has: false, src: 'upcoming ones only: hidden in the past' },
  { what: 'Cameras, ships, transit, bikes', has: false, src: 'live only: they keep showing now' },
  { what: 'Weather, aurora, fires (VIIRS), ocean, air quality', has: false, src: 'live or latest only' },
]);

// ---- earthquakes ---------------------------------------------------------------------------------------------------

export const FDSN = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
/** The catalogue's first year with global coverage worth drawing. */
export const QUAKES_FROM = Date.UTC(1900, 0, 1);
/** The window the quake layer shows, ending at the time shown (the live layer shows the last 24 h too). */
export const QUAKE_WINDOW_MS = DAY_MS;
/** At most this many quakes per UTC day, the biggest first (a big aftershock day has ~600 at M2.5+). */
export const QUAKE_DAY_LIMIT = 1500;
const iso = ms => new Date(ms).toISOString().slice(0, 19);
/** One UTC day of the catalogue as GeoJSON (the same shape as the live summaries, so core/quakes.js parses it). */
export const fdsnDayUrl = (dayMs, { minMag = 2.5, limit = QUAKE_DAY_LIMIT } = {}) => {
  const d = dayStart(dayMs);
  return `${FDSN}?format=geojson&starttime=${iso(d)}&endtime=${iso(d + DAY_MS)}&minmagnitude=${Math.max(0, Math.min(9, +minMag || 0))}&orderby=magnitude&limit=${Math.max(1, Math.min(20000, limit | 0))}`;
};
/** The UTC day starts whose quakes can fall in the window ending at `ms` (oldest first; nothing before 1900 or after now). */
export function quakeDays(ms, { windowMs = QUAKE_WINDOW_MS, now = Date.now() } = {}) {
  const out = [], end = Math.min(ms, now);
  if (!Number.isFinite(end) || end < QUAKES_FROM) return out;
  for (let d = dayStart(Math.max(QUAKES_FROM, end - windowMs)); d <= end; d += DAY_MS) out.push(d);
  return out;
}
/** Whether a quake (core/quakes.js record, time in ms) happened in the window ending at `ms`. */
export const quakeInWindow = (q, ms, windowMs = QUAKE_WINDOW_MS) => q != null && Number.isFinite(q.time) && q.time <= ms && q.time > ms - windowMs;

// ---- storms and natural events ---------------------------------------------------------------------------------------

export const EONET_EVENTS = 'https://eonet.gsfc.nasa.gov/api/v3/events';
/** EONET events (open and closed) around a moment: from `before` days earlier to a day later (a storm can last weeks). */
export const eonetAtUrl = (ms, { category = '', before = 12, after = 1 } = {}) =>
  `${EONET_EVENTS}?status=all&start=${utcDay(ms - Math.max(0, before) * DAY_MS)}&end=${utcDay(ms + Math.max(0, after) * DAY_MS)}${/^[a-zA-Z]+$/.test(category) ? '&category=' + category : ''}`;
export const GDACS_SEARCH = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
/** GDACS's cyclones (current or not) between `before` days before and the day of `ms`. */
export const gdacsTcAtUrl = (ms, { before = 12 } = {}) => `${GDACS_SEARCH}?eventlist=TC&alertlevel=green;orange;red&fromdate=${utcDay(ms - before * DAY_MS)}&todate=${utcDay(ms)}`;
/** GDACS's event list → past cyclones [{ eventid, episodeid, name, nice, alert, from, to (ms), lat, lon, report }]; unlike
 *  parseGdacsCyclones it keeps the ones that are over. */
export function gdacsPastCyclones(doc) {
  const out = [], utc = s => Date.parse(String(s || '') + (/(Z|[+-]\d\d:?\d\d)$/.test(String(s || '')) ? '' : 'Z'));
  for (const f of (doc && doc.features) || []) {
    const p = (f && f.properties) || {}, c = (f && f.geometry && f.geometry.coordinates) || [];
    const from = utc(p.fromdate), to = utc(p.todate);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const name = String(p.eventname || '').replace(/-\d\d$/, '');
    out.push({ eventid: p.eventid, episodeid: p.episodeid, name, nice: name ? name[0] + name.slice(1).toLowerCase() : 'Storm', alert: String(p.alertlevel || ''), from, to,
      lat: Number.isFinite(+c[1]) && c.length ? +c[1] : null, lon: Number.isFinite(+c[0]) && c.length ? +c[0] : null,
      report: typeof (p.url && p.url.report) === 'string' && /^https:\/\//.test(p.url.report) ? p.url.report : '' });
  }
  return out;
}

const tOf = p => (Number.isFinite(p.t) ? p.t : Date.parse(p.date || ''));
/** Where a track (points { lat, lon, kt?, t (ms) or date (ISO) }, any order) was at `ms`: linear between fixes (the shorter
 *  way round in longitude), the last fix for up to `holdMs` after it. { lat, lon, kt, n (fixes up to then) } or null
 *  before the first fix or once the track has ended. */
export function trackAt(track, ms, { holdMs = 12 * 3600e3 } = {}) {
  const pts = (track || []).map(p => ({ p, t: tOf(p) })).filter(x => Number.isFinite(x.t) && Number.isFinite(x.p.lat) && Number.isFinite(x.p.lon)).sort((a, b) => a.t - b.t);
  if (!pts.length || ms < pts[0].t || ms > pts[pts.length - 1].t + holdMs) return null;
  let i = 0; while (i + 1 < pts.length && pts[i + 1].t <= ms) i++;
  const a = pts[i], b = pts[i + 1];
  if (!b || a.t === ms) return { lat: a.p.lat, lon: a.p.lon, kt: a.p.kt ?? null, n: i + 1 };
  const f = (ms - a.t) / (b.t - a.t);
  let dl = b.p.lon - a.p.lon; if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
  let lon = a.p.lon + dl * f; if (lon > 180) lon -= 360; else if (lon < -180) lon += 360;
  const kt = Number.isFinite(a.p.kt) && Number.isFinite(b.p.kt) ? Math.round(a.p.kt + (b.p.kt - a.p.kt) * f) : (a.p.kt ?? null);
  return { lat: a.p.lat + (b.p.lat - a.p.lat) * f, lon, kt, n: i + 1 };
}

/** Storms (core/cyclones.js shape: track [{ lat, lon, kt, date }]) as they stood at `ms`: the track up to then plus the
 *  position then, wind then, `date` then; storms not yet formed or already over are left out. The originals are untouched. */
export function stormsAt(storms, ms, opts) {
  const out = [];
  for (const s of storms || []) {
    const at = trackAt(s.track, ms, opts); if (!at) continue;
    const track = s.track.filter(p => tOf(p) <= ms).concat([{ lat: at.lat, lon: at.lon, kt: at.kt, date: new Date(ms).toISOString() }]);
    out.push({ ...s, lat: at.lat, lon: at.lon, kt: at.kt ?? s.kt, date: new Date(ms).toISOString(), track, then: true, fc: undefined, nhc: undefined });
  }
  return out;
}
/** GDACS past cyclones with their geometry (core/hazards.js gdacsForecast: points with times) → storms in the
 *  core/cyclones.js shape, tracks from the observed points, for the ones EONET doesn't already have (same name). */
export function stormsFromGdacs(past, have = []) {
  const names = new Set(have.map(s => String(s.title || '').toLowerCase().split(/\s+/).pop()));
  return past.filter(g => g.fc && !names.has(g.name.toLowerCase())).map(g => {
    const pts = g.fc.points.filter(q => Number.isFinite(q.t) && !q.forecast).map(q => ({ lat: q.lat, lon: q.lon, kt: null, date: new Date(q.t).toISOString() }));
    const last = pts[pts.length - 1] || { lat: g.lat, lon: g.lon };
    return { kind: 'storm', id: 'gdacs-' + g.eventid, title: g.nice, src: `GDACS (${g.fc.source || 'agency'})`, lat: last.lat, lon: last.lon, kt: null, date: last.date || null, track: pts,
      links: g.report ? [{ text: 'GDACS report', url: g.report }] : [] };
  }).filter(s => s.track.length);
}

/** Whether an EONET event (core/eonet.js record) was going on at `ms`: begun by then, and not closed (or last seen) more
 *  than `graceMs` before it. Events without a close date count until a week after their last fix. */
export function eventActiveAt(ev, ms, { graceMs = 0, openMs = 7 * DAY_MS } = {}) {
  const first = Date.parse(ev.first || ev.date || ''), last = Date.parse(ev.date || ''), closed = Date.parse(ev.closed || '');
  if (!Number.isFinite(first) || first > ms) return false;
  const end = Number.isFinite(closed) ? closed : Number.isFinite(last) ? last + openMs : Infinity;
  return end + graceMs >= ms;
}

// ---- satellites: the archive of element sets --------------------------------------------------------------------------

/** Where the site build keeps one snapshot of element sets a day (bare two-line sets, one file per UTC day). */
export const TLE_HISTORY = 'data/tle/history/';
export const TLE_HISTORY_DAYS = 30;
/** Element sets further than this from the time shown are not used: the satellite is hidden instead of drawn somewhere wrong
 *  (SGP4's error grows by kilometres a day, and satellites manoeuvre). */
export const MAX_GAP_DAYS = 7;
/** The groups the archive keeps (Starlink, OneWeb and "all other active" are too big for a daily copy: within a week of
 *  today they use today's elements, further back they hide). */
export const ARCHIVED_GROUPS = Object.freeze(['stations', 'visual', 'military', 'radar', 'gps-ops', 'glo-ops', 'galileo', 'beidou', 'weather', 'goes', 'resource', 'science', 'iridium-NEXT', 'geo',
  'cosmos-2251-debris', 'iridium-33-debris', 'fengyun-1c-debris']);
export const historyFileUrl = day => TLE_HISTORY + day + '.txt';

const DAY_RE = /^\d{4}-\d\d-\d\d$/;
/** The archive's index.json → snapshots [{ day: 'YYYY-MM-DD', at (ms the copy was taken), n (element sets) }], oldest first;
 *  anything malformed is dropped. */
export function parseHistoryIndex(doc) {
  const out = [];
  for (const d of (doc && Array.isArray(doc.days) ? doc.days : [])) {
    if (!d || !DAY_RE.test(d.day) || !Number.isFinite(+d.at) || !(+d.n > 0)) continue;
    out.push({ day: d.day, at: +d.at, n: +d.n });
  }
  return out.sort((a, b) => a.at - b.at);
}
/** The snapshot taken nearest `ms`, or null when there is none within `maxGapDays` (then no archive helps). */
export function nearestSnapshot(days, ms, { maxGapDays = MAX_GAP_DAYS } = {}) {
  let best = null;
  for (const d of days || []) if (!best || Math.abs(d.at - ms) < Math.abs(best.at - ms)) best = d;
  return best && Math.abs(best.at - ms) <= maxGapDays * DAY_MS ? best : null;
}
/** Which element sets the archive builds keep, as the build does it: the snapshots of the last `keep` days before `today`
 *  (YYYY-MM-DD strings), newest first. */
export const keepDays = (days, today, keep = TLE_HISTORY_DAYS) => {
  const cut = utcDay(Date.parse(today + 'T00:00:00Z') - (keep - 1) * DAY_MS);
  return [...new Set(days)].filter(d => DAY_RE.test(d) && d >= cut && d <= today).sort().reverse();
};

/** A snapshot's text → Map NORAD id → { l1, l2, jd (epoch) }. */
export function archiveMap(sets) {
  const m = new Map();
  for (const t of sets || []) { const jd = tleEpochJd(t.l1); if (Number.isFinite(jd)) m.set(t.id, { l1: t.l1, l2: t.l2, jd }); }
  return m;
}

/**
 * The element sets to propagate at `ms` for every satellite of `list` ([{ id, l1, l2, group }], the globe's order). `archive`
 * is archiveMap() of the nearest snapshot or null; `covers` says that snapshot was taken within a day of `ms` (then a
 * satellite of an archived group that is missing from it was not in the catalogue yet). Each satellite gets whichever set
 * (today's or the archive's) has its epoch nearer to `ms`, or null when that is more than `maxGapDays` away.
 * Returns { sets: Array<[l1, l2] | null> (list order), archived, today, hidden }.
 */
export function chooseElements(list, archive, ms, { covers = false, maxGapDays = MAX_GAP_DAYS, archived = ARCHIVED_GROUPS } = {}) {
  const jd = jdFromMs(ms), groups = new Set(archived), sets = new Array(list.length);
  let fromArchive = 0, fromToday = 0, hidden = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i], a = archive && archive.get(s.id), tj = s.jd ?? tleEpochJd(s.l1);
    let pick = null, gap = Infinity, src = 0;
    if (Number.isFinite(tj)) { pick = [s.l1, s.l2]; gap = Math.abs(tj - jd); src = 1; }
    if (a && Math.abs(a.jd - jd) < gap) { pick = [a.l1, a.l2]; gap = Math.abs(a.jd - jd); src = 2; }
    if (archive && covers && !a && groups.has(s.group) && tj > jd) pick = null;   // launched (or catalogued) after the time shown
    if (pick && gap > maxGapDays) pick = null;
    sets[i] = pick;
    if (!pick) hidden++; else if (src === 2) fromArchive++; else fromToday++;
  }
  return { sets, archived: fromArchive, today: fromToday, hidden };
}

// ---- the timeline: presets and the scrubber's range -------------------------------------------------------------------

/** "On this day" moments the time-travel panel offers. t: ISO UTC; at: [lon, lat, camera height m]; on: layers to switch on. */
export const MOMENTS = Object.freeze([
  { id: 'tohoku', name: 'Tōhoku earthquake and tsunami', when: '2011-03-11T06:30:00Z', at: [142.4, 38.3, 3.2e6], on: ['quakes'], note: 'M9.1 off Japan at 05:46 UTC, with hundreds of aftershocks that day' },
  { id: 'ian', name: 'Hurricane Ian makes landfall in Florida', when: '2022-09-28T19:00:00Z', at: [-82.2, 26.6, 3.5e6], on: ['storms', 'events'], note: 'Category 4 at Cayo Costa, about 19:05 UTC' },
  { id: 'haiyan', name: 'Typhoon Haiyan hits the Philippines', when: '2013-11-07T21:00:00Z', at: [125.5, 11.0, 4e6], on: ['storms', 'events'], note: 'One of the strongest landfalls on record, near Guiuan' },
  { id: 'turkey', name: 'Türkiye–Syria earthquakes', when: '2023-02-06T11:00:00Z', at: [37.2, 37.4, 2.5e6], on: ['quakes'], note: 'M7.8 at 01:17 UTC, then M7.5 nine hours later' },
  { id: 'jwst', name: 'James Webb Space Telescope launch', when: '2021-12-25T12:20:00Z', at: [-52.8, 5.2, 4e6], on: [], note: 'Ariane 5 from Kourou at 12:20 UTC (nothing in orbit is drawn this far back)' },
  { id: 'apollo11', name: 'Apollo 11 lifts off', when: '1969-07-16T13:32:00Z', at: [-80.6, 28.6, 2.5e6], on: ['quakes'], note: 'Saturn V from Kennedy Space Center pad 39A at 13:32 UTC' },
]);
/** Quick steps back from now: [label, ms back]. */
export const STEPS_BACK = Object.freeze([['1 day ago', DAY_MS], ['1 week ago', 7 * DAY_MS], ['30 days ago', 30 * DAY_MS], ['1 year ago', 365 * DAY_MS]]);
export const momentMs = m => Date.parse(m.when);

/** The scrubber's range around the time shown: within the satellite archive (the last 30 days) the whole archive, further
 *  back the 4 days before and a day after (so a slider step stays a few minutes). { from, to } in ms, never after now. */
export function scrubRange(ms, now = Date.now()) {
  if (ms >= now - TLE_HISTORY_DAYS * DAY_MS) return { from: dayStart(now - TLE_HISTORY_DAYS * DAY_MS), to: now };
  const to = Math.min(now, dayStart(ms) + 2 * DAY_MS);
  return { from: to - 6 * DAY_MS, to };
}
