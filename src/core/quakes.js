// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Earthquakes from the USGS real-time GeoJSON summaries (public domain, CORS): one parser for the 2D map, the globe and
// the MCP server, and EMSC's catalogue (seismicportal.eu, keyless, CORS; credit EMSC) as the second word that lets a
// quake read "confirmed". Pure: no DOM, no fetch (emscSource is handed its fetch).

import { stamp, rep } from './liveprov.js';

export const USGS_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
/** The summaries a visitor can pick on the 2D map (USGS publishes more: {all,1.0,2.5,4.5,significant}_{hour,day,week,month}). */
export const USGS_FEEDS = Object.freeze([
  { id: '2.5_day', name: 'M2.5+ 24 h' }, { id: '1.0_day', name: 'M1+ 24 h' }, { id: '4.5_week', name: 'M4.5+ 7 d' }, { id: 'significant_month', name: 'Significant 30 d' },
]);
const FEED = /^(all|1\.0|2\.5|4\.5|significant)_(hour|day|week|month)$/;
/** The summary's address; an unknown feed name falls back to M2.5+ in the last day. */
export const usgsUrl = (feed = '2.5_day') => `${USGS_BASE}${FEED.test(feed) ? feed : '2.5_day'}.geojson`;
/** The smallest summary that holds every quake of magnitude `min` or more in `period` ('hour' | 'day' | 'week' | 'month'). */
export const usgsFeedFor = (min, period = 'day') => `${min >= 4.5 ? '4.5' : min >= 2.5 ? '2.5' : min >= 1 ? '1.0' : 'all'}_${period}`;

const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const fin = v => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : null);

/** A USGS summary (GeoJSON) → quakes { id, mag, magType, place, time, updated, depth (km), lat, lon, url, tsunami, alert, felt,
 *  status, type }, without features that have no usable position. Times are ms. Nothing is trusted: strings stay strings
 *  (the views escape them), numbers are checked, the link must be https. */
export function parseUsgs(doc, { min = -Infinity, quakesOnly = false } = {}) {
  const out = [];
  for (const f of (doc && doc.features) || []) {
    const p = (f && f.properties) || {}, c = (f && f.geometry && f.geometry.coordinates) || [];
    const lon = fin(c[0]), lat = fin(c[1]);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const mag = fin(p.mag);
    if (min > -Infinity && (mag == null || mag < min)) continue;
    if (quakesOnly && p.type && p.type !== 'earthquake') continue;   // quarry blasts, ice quakes...
    out.push({ id: str(f.id || p.code), mag, magType: str(p.magType), place: str(p.place), time: fin(p.time), updated: fin(p.updated), depth: fin(c[2]), lat, lon,
      url: /^https:\/\//.test(str(p.url)) ? p.url : '', tsunami: !!+p.tsunami, alert: ['green', 'yellow', 'orange', 'red'].includes(p.alert) ? p.alert : null,
      felt: fin(p.felt), status: str(p.status), type: str(p.type || 'earthquake') });
  }
  return out;
}

/** The largest of a list (ties: the newest), or null. */
export const largest = list => list.reduce((m, q) => (m == null || (q.mag ?? -9) > (m.mag ?? -9) || ((q.mag ?? -9) === (m.mag ?? -9) && (q.time || 0) > (m.time || 0)) ? q : m), null);

/** How a quake reads at a glance: "M6.2 · 34 km SW of Town". */
export const quakeTitle = q => `M${(q.mag ?? 0).toFixed(1)}${q.place ? ' · ' + q.place : ''}`;

/** When two catalogues' solutions are the same quake (provenance agreement): origin times within dtS, epicentres within km,
 *  magnitudes within mag (agencies differ by a few tenths, more across magnitude types). */
export const QUAKE_AGREE = Object.freeze({ dtS: 60, km: 100, mag: 0.6 });

/** Do quakes a and b ({ lat, lon, time (ms), mag }) agree within QUAKE_AGREE? A missing magnitude doesn't disagree. */
export function sameQuake(a, b, tol = QUAKE_AGREE) {
  if (!a || !b || !Number.isFinite(a.time) || !Number.isFinite(b.time) || Math.abs(a.time - b.time) > tol.dtS * 1000) return false;
  const r = Math.PI / 180, h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  if (2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) > tol.km) return false;
  return !(Number.isFinite(a.mag) && Number.isFinite(b.mag) && Math.abs(a.mag - b.mag) > tol.mag);
}

/** The newest data time of a USGS summary: when it was generated (ms), else its newest solution update. */
export const usgsDataAt = (doc, quakes = []) => fin(doc && doc.metadata && doc.metadata.generated) ?? (quakes.reduce((m, q) => Math.max(m, q.updated || q.time || 0), 0) || null);

/** GDACS's earthquake alerts (core/gdacs.js parseGdacsEvents items) as solutions to compare: { time, lat, lon, mag, usgs }
 *  where usgs: GDACS took the solution from USGS (NEIC), so it repeats USGS rather than confirming it. */
export const gdacsQuakes = list => (list || []).filter(p => p && p.eventtype === 'EQ').map(p => ({ id: String(p.eventid ?? ''), time: Date.parse(p.fromdate), lat: +p.lat, lon: +p.lon,
  mag: fin(p.severitydata && p.severitydata.severity), dataAt: Date.parse(p.datemodified || p.todate) || null,
  usgs: /NEIC|USGS/i.test(String(p.source || '')), url: /^https:\/\//.test(String(p.url && p.url.report || '')) ? p.url.report : null })).filter(g => Number.isFinite(g.time));

/** EMSC's FDSN event service (European-Mediterranean Seismological Centre): worldwide, keyless, CORS *; its terms ask
 *  for credit ("EMSC"), which every card and answer that uses it gives through its provenance line. */
export const EMSC_BASE = 'https://www.seismicportal.eu/fdsnws/event/1/query';
const EMSC_STEP = 10 * 60e3;
/** EMSC's events in the `hours` before `now` at magnitude `min` less QUAKE_AGREE.mag or more (so every solution that could
 *  agree with a USGS quake of `min` is in it), newest first, at most `limit` (500; 1000, the most asked, for windows past a
 *  day or floors under M2.5). The start is floored to 10 minutes, so one question keeps one address (and its caches) for
 *  10 minutes. A busy window (a week or month, M1+ in a day) can hold more than the limit: the answer then covers only its
 *  newest part, and older USGS quakes read "reported" for want of an EMSC solution, not because EMSC disagrees. */
export function emscUrl({ min = 2.5, hours = 24, now = Date.now(), limit = hours > 24 || min < 2.5 ? 1000 : 500 } = {}) {
  const start = new Date(Math.floor((now - hours * 3600e3) / EMSC_STEP) * EMSC_STEP).toISOString().slice(0, 19);
  const mm = Math.round((min - QUAKE_AGREE.mag) * 10) / 10;
  return `${EMSC_BASE}?format=json&limit=${Math.max(1, Math.min(1000, limit | 0))}${mm > 0 ? `&minmag=${mm}` : ''}&starttime=${start}`;
}
const SPAN_H = { hour: 1, day: 24, week: 168, month: 720 };
/** What to ask EMSC beside a USGS summary ('2.5_day', 'significant_month'...): { min, hours }. The floor is the summary's
 *  (not the question's), so every question on one summary shares one EMSC answer. */
export function emscAsk(feed = '2.5_day') {
  const m = FEED.exec(feed) || FEED.exec('2.5_day');
  return { min: m[1] === 'all' ? 0 : m[1] === 'significant' ? 4.5 : +m[1], hours: SPAN_H[m[2]] };
}

const isoMs = v => (typeof v === 'string' && v ? Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(v) ? v : v + 'Z') : fin(v)) || null;
/** An EMSC answer (FDSN GeoJSON) -> solutions { id, mag, magType, place, time, updated, depth (km, down), lat, lon, auth,
 *  url, dataAt }. auth: the agency whose solution EMSC publishes (NEIC is USGS's own). dataAt: the answer's newest solution
 *  update, the catalogue's data time (an EMSC answer carries no generated time). Only earthquakes (known, suspected,
 *  felt); nothing is trusted, as in parseUsgs. doc may be the body as text (throws when it isn't JSON). */
export function parseEmsc(doc) {
  if (typeof doc === 'string') doc = doc.trim() ? JSON.parse(doc) : null;   // the body as text: empty is FDSN's 204, no events
  const out = [];
  for (const f of (doc && doc.features) || []) {
    const p = (f && f.properties) || {}, c = (f && f.geometry && f.geometry.coordinates) || [];
    const lat = fin(p.lat ?? c[1]), lon = fin(p.lon ?? c[0]), time = isoMs(p.time);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || time == null) continue;
    if (p.evtype && !['ke', 'se', 'fe'].includes(p.evtype)) continue;   // quarry blasts, explosions, rockbursts...
    const unid = str(p.unid || f.id), dep = fin(p.depth) ?? (fin(c[2]) != null ? -fin(c[2]) : null);
    out.push({ id: unid, mag: fin(p.mag), magType: str(p.magtype), place: str(p.flynn_region), time, updated: isoMs(p.lastupdate), depth: dep, lat, lon,
      auth: str(p.auth).slice(0, 16), url: /^[\w-]{1,40}$/.test(unid) ? `https://www.seismicportal.eu/eventdetails.html?unid=${unid}` : '', dataAt: null });
  }
  const at = out.reduce((m, e) => Math.max(m, e.updated || e.time || 0), 0) || null;
  for (const e of out) e.dataAt = at;
  return out;
}

/** Is EMSC's solution e USGS's own? Its agency is NEIC (USGS), or the network that made the USGS quake q (its id's first
 *  two letters: ak, ci, nc...), so it repeats USGS rather than confirming it. */
export function emscRepeatsUsgs(e, q) {
  const a = String((e && e.auth) || '').toLowerCase(), net = (/^([a-z]{2})[0-9a-z]/i.exec((q && q.id) || '') || [])[1];
  return /^(neic|neis|usgs|us)$/.test(a) || (!!a && !!net && a === net.toLowerCase());
}

const byTime = new WeakMap();   // an EMSC list -> its solutions with a time, oldest first (list order among equal times)
/** list's solutions sorted by time, built once per list (a list is never changed once parsed; a length change rebuilds). */
function timeIndex(list) {
  let ix = byTime.get(list);
  if (!ix || ix.n !== list.length) {
    const s = list.map((e, i) => [e, i]).filter(([e]) => e && Number.isFinite(e.time)).sort((a, b) => a[0].time - b[0].time || a[1] - b[1]);
    byTime.set(list, (ix = { n: list.length, e: s.map(x => x[0]), i: s.map(x => x[1]), t: s.map(x => x[0].time) }));
  }
  return ix;
}
/** The EMSC solution that is quake q (sameQuake), the closest in time when several are (the first in the list on a tie);
 *  or null. A long list (a week's or month's 1000) is searched by time, so stamping n quakes costs n log m, not n * m. */
export function matchEmsc(q, emsc) {
  let best = null, bi = -1;
  if (!emsc || !emsc.length || !q || !Number.isFinite(q.time)) return null;
  if (emsc.length < 32) {
    for (const e of emsc) if (sameQuake(q, e) && (!best || Math.abs(e.time - q.time) < Math.abs(best.time - q.time))) best = e;
    return best;
  }
  const ix = timeIndex(emsc), lo = q.time - QUAKE_AGREE.dtS * 1000, hi = q.time + QUAKE_AGREE.dtS * 1000;
  let a = 0, b = ix.t.length;
  while (a < b) { const m = (a + b) >> 1; if (ix.t[m] < lo) a = m + 1; else b = m; }
  for (let k = a; k < ix.t.length && ix.t[k] <= hi; k++) {
    const e = ix.e[k], d = Math.abs(e.time - q.time);
    if (!sameQuake(q, e)) continue;
    const bd = best ? Math.abs(best.time - q.time) : Infinity;
    if (d < bd || (d === bd && ix.i[k] < bi)) { best = e; bi = ix.i[k]; }
  }
  return best;
}

/**
 * EMSC answers for one view, fetched through json(url) -> Promise<doc or body text>: at most one request at a time per
 * question, and one per gapMs (9.5 min: a little under the globe's 10-min reload, so a tick a moment early still asks).
 * A failure keeps that question's last list (its own data time says how old it is), so EMSC down only takes the
 * "confirmed" votes away; another question (the 2D map's summary changed) never gets this one's list. load() never
 * rejects; list is the newest kept for the latest question.
 */
export function emscSource(json, { gapMs = 9.5 * 60e3, now = Date.now } = {}) {
  let at = -Infinity, key = '', pending = null;
  const kept = new Map();   // question -> its last list
  const src = {
    list: [],
    load({ min = 2.5, hours = 24 } = {}) {
      const k = `${min}/${hours}`, t = now();
      if (k === key && pending) return pending;
      if (k === key && t - at < gapMs) return Promise.resolve(src.list);
      key = k; at = t; src.list = kept.get(k) || [];
      const p = pending = Promise.resolve().then(() => json(emscUrl({ min, hours, now: t }))).then(parseEmsc).catch(() => kept.get(k) || [])
        .then(list => { kept.set(k, list); if (key === k) src.list = list; return list; })
        .finally(() => { if (pending === p) pending = null; });
      return p;
    },
  };
  return src;
}

/** Stamp a USGS quake with its provenance: USGS at the summary's data time, plus the matching EMSC solution and GDACS alert
 *  (sameQuake), each agreeing as a second witness only when its solution is not USGS's own. cached: the summary came from
 *  a copy. Stamping again (when EMSC answers later) replaces the stamp. */
export function stampQuake(q, { dataAt = null, gdacs = [], emsc = [], cached = false } = {}) {
  const reports = [rep('usgs', { dataAt: dataAt ?? q.updated ?? q.time, cached })], agreeing = ['usgs'];
  const e = matchEmsc(q, emsc);
  if (e) { const own = emscRepeatsUsgs(e, q); reports.push(rep('emsc', { dataAt: e.dataAt ?? e.updated ?? e.time, name: own ? 'EMSC (USGS solution)' : 'EMSC', url: e.url || undefined })); if (!own) agreeing.push('emsc'); }
  const g = gdacs.find(x => sameQuake(q, x));
  if (g) { reports.push(rep('gdacs', { dataAt: g.dataAt, name: g.usgs ? 'GDACS (USGS solution)' : 'GDACS', url: g.url || undefined })); if (!g.usgs) agreeing.push('gdacs'); }
  return stamp(q, 'quakes', reports, { agreeing });
}
