// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// A layer's visible live items as a file: GeoJSON, CSV or KML, each item with its provenance (sources, how many agree,
// the data time and age, the confidence). Pure: the views hand in items and save the text (test/export.test.mjs).

import { recordOf } from './liveprov.js';
import { provenanceText } from './provenance.js';

export const EXPORT_FORMATS = Object.freeze({
  geojson: { ext: 'geojson', mime: 'application/geo+json', name: 'GeoJSON' },
  csv: { ext: 'csv', mime: 'text/csv', name: 'CSV' },
  kml: { ext: 'kml', mime: 'application/vnd.google-earth.kml+xml', name: 'KML' },
});

const fin = v => typeof v === 'number' && Number.isFinite(v);
const SKIP = new Set(['prov', 'kind', 'track', 'trail', 'links', 'fc', 'cur', 'pt', 'entity', 'el', 'tip', 'cardHtml', 'afterCard', 'nhc', 'raw']);
const iso = t => (fin(t) ? new Date(t).toISOString() : null);

/**
 * One item → a flat row { id, name, lat, lon, ...its own plain fields, provenance, confidence, sources, agree, data_time,
 * data_age_s }. Only strings, finite numbers and booleans are kept (no nested objects, functions or the stamp itself).
 * label(item) names it where its own fields don't (flight, title, place, name, id).
 */
export function exportRow(item, { now = Date.now(), label = null } = {}) {
  const pos = item.cur && fin(item.cur.lat) ? item.cur : item;
  const row = {
    id: String(item.id ?? item.hex ?? item.mmsi ?? item.uuid ?? ''),
    name: String((label && label(item)) || item.title || item.flight || item.name || item.place || item.id || item.hex || ''),
    lat: fin(pos.lat) ? +pos.lat.toFixed(6) : null, lon: fin(pos.lon) ? +pos.lon.toFixed(6) : null,
  };
  for (const [k, v] of Object.entries(item)) {
    if (SKIP.has(k) || k in row || k.startsWith('_')) continue;
    if (typeof v === 'string' ? v.length <= 500 : fin(v) || typeof v === 'boolean') row[k] = v;
  }
  const r = recordOf(item, now);
  Object.assign(row, r ? {
    provenance: provenanceText(r), confidence: r.confidence, sources: r.sources.map(s => s.name + (s.cached ? ' (copy)' : '')).join(' + '),
    agree: r.agree, of: r.of, data_time: iso(r.dataAt), data_age_s: r.ageMs == null ? null : Math.round(r.ageMs / 1000),
  } : { provenance: 'no source given', confidence: 'unknown', sources: '', agree: 0, of: 0, data_time: null, data_age_s: null });
  return row;
}

/** Items → rows, skipping those without a position. */
export const exportRows = (items, opts = {}) => [...(items || [])].filter(Boolean).map(i => exportRow(i, opts)).filter(r => r.lat != null && r.lon != null);

/** Rows → a GeoJSON FeatureCollection (text). */
export function toGeoJSON(rows, { layer = '', now = Date.now() } = {}) {
  return JSON.stringify({
    type: 'FeatureCollection',
    metadata: { generator: 'Open Overwatch', layer, exported: new Date(now).toISOString(), note: 'provenance: who reported each item, how many agree, how old the data is' },
    features: rows.map(({ lat, lon, ...p }) => ({ type: 'Feature', id: p.id || undefined, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: p })),
  });
}

/** One CSV cell: quoted when needed; a text cell starting with = + - @ (or a tab or CR) gets a leading ' so spreadsheets
 *  don't run it as a formula. Numbers stay numbers. */
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Rows → CSV text (RFC 4180, CRLF), the columns in first-seen order with id, name, lat, lon first. */
export function toCSV(rows) {
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return [cols.map(csvCell).join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
}

const xml = s => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Rows → KML text: a Placemark each, its fields as ExtendedData, the provenance line as the description. */
export function toKML(rows, { layer = 'Open Overwatch export' } = {}) {
  const pm = rows.map(({ lat, lon, ...p }) => `<Placemark><name>${xml(p.name || p.id)}</name><description>${xml(p.provenance)}</description>` +
    `<ExtendedData>${Object.entries(p).map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(v)}</value></Data>`).join('')}</ExtendedData>` +
    `<Point><coordinates>${lon},${lat}</coordinates></Point></Placemark>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(layer)}</name>\n${pm}\n</Document></kml>\n`;
}

/** Everything a view needs to save one: { name (file name), mime, text, count }. */
export function exportFile(format, items, { layer = 'layer', now = Date.now(), label = null } = {}) {
  const f = EXPORT_FORMATS[format];
  if (!f) throw new Error('unknown export format ' + format);
  const rows = exportRows(items, { now, label });
  const text = format === 'geojson' ? toGeoJSON(rows, { layer, now }) : format === 'csv' ? toCSV(rows) : toKML(rows, { layer });
  const stampText = new Date(now).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const slug = String(layer).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'layer';
  return { name: `open-overwatch-${slug}-${stampText}.${f.ext}`, mime: f.mime, text, count: rows.length };
}
