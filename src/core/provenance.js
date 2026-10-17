// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Where a live item came from, how old its data is, and how many independent sources agree: one record shape every
// live layer and card uses, so "checked" means the same thing everywhere on the map. A contact on the map is a claim
// by its sources, not evidence: the card says who claimed it and when the data (not the download) was made.
//
// Contract (other modules import this; extend it, don't fork it):
//   source({ id, name, url, licence, dataAt, fetchedAt, cached })   one source's report. dataAt: when the source's data
//     was measured or issued (ms); fetchedAt: when we downloaded it (ms); cached: it came from a copy (the site mirror,
//     the relay, a service-worker cache), so dataAt is what counts, never fetchedAt.
//   provenance(sources, { now, maxAgeMs, agreeing })   -> the record below. agreeing: ids of the sources that report the
//     same thing (the layer decides what "same" means: a position within a tolerance, the same magnitude...); default all.
//   record = { sources, agree, of, dataAt, ageMs, maxAgeMs, confidence, rule }
//     confidence: 'confirmed' (2+ independent sources agree, data fresh), 'reported' (one fresh source),
//                 'stale' (the newest agreeing data is older than maxAgeMs), 'unknown' (no source gave a data time).
//   provenanceText(record) one plain line;  provenanceHtml(record) the card block (every upstream string escaped).

import { esc } from './format.js';

export const RULE = 'Confirmed: two or more independent sources agree and their data is fresh. Reported: one fresh source. ' +
  'Stale: the newest data is older than this layer expects. Unknown: no source said when its data was made. ' +
  'Age is the age of the data, not of the download.';

export const CONFIDENCE = ['confirmed', 'reported', 'stale', 'unknown'];

const ms = t => t == null || t === '' ? null : typeof t === 'number' ? (Number.isFinite(t) ? t : null) : (v => Number.isFinite(v) ? v : null)(Date.parse(t));

/**
 * One source's report, normalised (times to ms or null).
 * @param {{ id?: string, name?: string, url?: string, licence?: string, dataAt?: any, fetchedAt?: any, cached?: boolean }} [r]
 */
export function source({ id, name, url = null, licence = null, dataAt = null, fetchedAt = null, cached = false } = {}) {
  if (!id) throw new Error('provenance source needs an id');
  return { id: String(id), name: String(name || id), url, licence, dataAt: ms(dataAt), fetchedAt: ms(fetchedAt), cached: !!cached };
}

/** The provenance record for one item from its sources' reports. */
export function provenance(sources, { now = Date.now(), maxAgeMs = 3600e3, agreeing = null } = {}) {
  const list = (sources || []).map(s => source(s));
  const ids = new Set(agreeing ?? list.map(s => s.id));
  const agreeList = list.filter(s => ids.has(s.id));
  const times = agreeList.map(s => s.dataAt).filter(t => t != null);
  const dataAt = times.length ? Math.max(...times) : null;
  const ageMs = dataAt == null ? null : Math.max(0, now - dataAt);
  const fresh = agreeList.filter(s => s.dataAt != null && now - s.dataAt <= maxAgeMs).length;
  const confidence = dataAt == null ? 'unknown' : ageMs > maxAgeMs ? 'stale' : fresh >= 2 ? 'confirmed' : 'reported';
  return { sources: list, agree: agreeList.length, of: list.length, dataAt, ageMs, maxAgeMs, confidence, rule: RULE };
}

/** "40 s", "3 min", "2.5 h", "4 days". */
export function ageText(a) {
  if (a == null || !Number.isFinite(a)) return 'unknown age';
  const s = a / 1000;
  if (s < 90) return Math.round(s) + ' s';
  if (s < 5400) return Math.round(s / 60) + ' min';
  if (s < 172800) return (s < 36000 ? (s / 3600).toFixed(1) : Math.round(s / 3600)) + ' h';
  return Math.round(s / 86400) + ' days';
}

/** "data 3 min old", or "data age unknown" when no source gave a time. */
const ageWords = a => (a == null || !Number.isFinite(a) ? 'data age unknown' : `data ${ageText(a)} old`);
const names = r => r.sources.map(s => s.name + (s.cached ? ' (copy)' : '')).join(' + ');

/** One line: "USGS + EMSC · 2 of 2 agree · data 3 min old · confirmed". */
export function provenanceText(r) {
  if (!r || !r.sources.length) return 'no source · unknown';
  const agree = r.of > 1 ? ` · ${r.agree} of ${r.of} agree` : '';
  return `${names(r)}${agree} · ${ageWords(r.ageMs)} · ${r.confidence}`;
}

/** The block a card shows: who, how many agree, how old, the confidence with its rule as a tooltip. */
export function provenanceHtml(r) {
  if (!r || !r.sources.length) return '<div class="prov prov-unknown">No source given</div>';
  const src = r.sources.map(s => {
    const n = esc(s.name) + (s.cached ? ' <span class="prov-copy">(copy)</span>' : '');
    return /^https:\/\//.test(s.url || '') ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${n}</a>` : n;
  }).join(' + ');
  const agree = r.of > 1 ? ` · ${r.agree} of ${r.of} agree` : '';
  return `<div class="prov prov-${esc(r.confidence)}"><span class="prov-src">${src}</span>${agree} · ${esc(ageWords(r.ageMs))} · ` +
    `<abbr class="prov-conf" title="${esc(r.rule)}">${esc(r.confidence)}</abbr></div>`;
}
