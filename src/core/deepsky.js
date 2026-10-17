// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Deep-sky objects for "what's up tonight": the Messier list and the brighter NGC/IC objects from data/deepsky.json
// (brand/tools/make_deepsky.py; CC-BY-SA-4.0, derived from OpenNGC, see data/deepsky.md), filtered by magnitude and
// type, and placed in the sky for an observer with sky.js's helpers. Read-only and DOM-free; times are ms since 1970.
// Positions are J2000 catalogue places; sky.js altAz() turns them to the equator and apparent sidereal time of date
// (eclipselocal.js icrfToFixed), so altitudes are good to well under a degree.
import { altAz, darkWindow } from './sky.js';
import { jdFromMs } from './time.js';

/** OpenNGC's type codes: a label for people and a group to filter by. */
export const TYPES = {
  G: { label: 'galaxy', group: 'galaxy' },
  GPair: { label: 'galaxy pair', group: 'galaxy' },
  GTrpl: { label: 'galaxy triplet', group: 'galaxy' },
  GGroup: { label: 'group of galaxies', group: 'galaxy' },
  OCl: { label: 'open cluster', group: 'cluster' },
  GCl: { label: 'globular cluster', group: 'cluster' },
  '*Ass': { label: 'star association', group: 'cluster' },
  'Cl+N': { label: 'cluster with nebula', group: 'nebula' },
  Neb: { label: 'nebula', group: 'nebula' },
  HII: { label: 'emission nebula (H II region)', group: 'nebula' },
  EmN: { label: 'emission nebula', group: 'nebula' },
  RfN: { label: 'reflection nebula', group: 'nebula' },
  DrkN: { label: 'dark nebula', group: 'nebula' },
  SNR: { label: 'supernova remnant', group: 'nebula' },
  PN: { label: 'planetary nebula', group: 'planetary' },
  '**': { label: 'double star', group: 'other' },
  '*': { label: 'star', group: 'other' },
  Other: { label: 'other', group: 'other' },
};

/** The file's rows as objects: { id, m (Messier number or null), type, ra, dec (deg J2000), mag, band, maj, min (arcmin), name, con }. */
export function parseDeepsky(doc) {
  const f = doc.fields;
  return doc.rows.map(r => Object.fromEntries(f.map((k, i) => [k, r[i]])));
}

/** Fetch and parse data/deepsky.json (about 175 KB, 2,405 objects). */
export async function loadDeepsky(url = 'data/deepsky.json', fetchFn = fetch) {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return parseDeepsky(await r.json());
}

/** "M 31", else the catalogue id; with the common name when there is one: "M 31 (Andromeda Galaxy)". */
export const label = o => `${o.m ? 'M ' + o.m : o.id}${o.name ? ` (${o.name})` : ''}`;

/**
 * Objects brighter than maxMag (objects with no magnitude only when `unknownMag`), of the given groups ('galaxy',
 * 'cluster', 'nebula', 'planetary', 'other') or type codes, Messier objects only when `messier`. A new array.
 */
export function filterDeepsky(list, { maxMag = Infinity, groups = null, types = null, messier = false, unknownMag = false } = {}) {
  return list.filter(o =>
    (o.mag == null ? unknownMag : o.mag <= maxMag) &&
    (!messier || o.m != null) &&
    (!types || types.includes(o.type)) &&
    (!groups || groups.includes(TYPES[o.type]?.group ?? 'other')));
}

/** Altitude and azimuth (deg) of an object for an observer at lat/lon (deg) at ms. */
export const altAzOf = (o, lat, lon, ms) => altAz(o, lat, lon, jdFromMs(ms));

/**
 * Objects worth looking for during the dark part of the next 24 h (Sun below -6°, sky.js's darkWindow): those that get
 * at least minAlt degrees up while it is dark. Each: { obj, best (ms of the highest point in the dark), alt, az (there),
 * from, to (ms: the first and last sampled moments above minAlt) }, brightest first (no magnitude last). [] in polar day.
 * Pass a pre-filtered list (filterDeepsky) to keep it quick on a phone; `limit` caps the result.
 */
export function visibleTonight(list, lat, lon, t0, { minAlt = 20, step = 15 * 60e3, minLeft = 0, limit = Infinity } = {}) {
  const win = darkWindow(lat, lon, t0, { minLeft });
  if (!win) return [];
  const times = [];
  for (let t = win.start; t < win.end; t += step) times.push(t);
  times.push(win.end);
  const out = [];
  for (const o of list) {
    let best = null, from = null, to = null;
    for (const t of times) {
      const h = altAz(o, lat, lon, jdFromMs(t));
      if (h.alt < minAlt) continue;
      if (from == null) from = t;
      to = t;
      if (!best || h.alt > best.alt) best = { t, alt: h.alt, az: h.az };
    }
    if (best) out.push({ obj: o, best: best.t, alt: best.alt, az: best.az, from, to });
  }
  out.sort((a, b) => (a.obj.mag ?? 99) - (b.obj.mag ?? 99));
  return out.slice(0, limit);
}
