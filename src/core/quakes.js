// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Earthquakes from the USGS real-time GeoJSON summaries (public domain, CORS): one parser for the 2D map, the globe and
// the MCP server. Pure: no DOM, no fetch.

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
  mag: fin(p.severitydata && p.severitydata.severity), dataAt: Date.parse(p.datemodified ? (/(Z|[+-]\d\d:?\d\d)$/.test(p.datemodified) ? p.datemodified : p.datemodified + 'Z') : p.todate) || null,
  usgs: /NEIC|USGS/i.test(String(p.source || '')), url: /^https:\/\//.test(String(p.url && p.url.report || '')) ? p.url.report : null })).filter(g => Number.isFinite(g.time));

/** Stamp a USGS quake with its provenance: USGS at the summary's data time, plus a matching GDACS alert (sameQuake), which
 *  agrees as a second witness only when its solution is not USGS's own. cached: the summary came from a copy. */
export function stampQuake(q, { dataAt = null, gdacs = [], cached = false } = {}) {
  const reports = [rep('usgs', { dataAt: dataAt ?? q.updated ?? q.time, cached })], agreeing = ['usgs'];
  const g = gdacs.find(x => sameQuake(q, x));
  if (g) { reports.push(rep('gdacs', { dataAt: g.dataAt, name: g.usgs ? 'GDACS (USGS solution)' : 'GDACS', url: g.url || undefined })); if (!g.usgs) agreeing.push('gdacs'); }
  return stamp(q, 'quakes', reports, { agreeing });
}
