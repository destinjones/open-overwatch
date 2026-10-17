// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Satellites for the MCP tools: element sets (TLEs) from the website's copy of CelesTrak's groups, refreshed every 6 h by
// the site build (never CelesTrak itself), found by name or catalogue number, and moved with SGP4 (satellite.js 5.0.0, the
// library the website uses, passed in as `sgp4` so tests can run without it).
import { parseTle, tleEpochJd } from '../src/core/tle.js';
import { msFromJd } from '../src/core/time.js';
import { ToolError } from './feeds.mjs';

/** Groups searched for a name, in order (the small, famous ones first; 'active' holds every working satellite). */
export const SEARCH_GROUPS = Object.freeze(['stations', 'visual', 'weather', 'gps-ops', 'galileo', 'glo-ops', 'beidou', 'geo', 'active']);
const DEBRIS_GROUPS = ['fengyun-1c-debris', 'iridium-33-debris', 'cosmos-2251-debris'];
/** The globe layer that draws each group (src/globe/layers.js sat:). */
export const GROUP_LAYER = Object.freeze({ stations: 'stations', visual: 'visual', weather: 'weather', 'gps-ops': 'gnss', galileo: 'gnss', 'glo-ops': 'gnss', beidou: 'gnss',
  geo: 'geo', starlink: 'starlink', active: 'active', 'fengyun-1c-debris': 'debris', 'iridium-33-debris': 'debris', 'cosmos-2251-debris': 'debris' });
/** Names people use that the catalogue spells differently. */
const ALIASES = { iss: '25544', 'international space station': '25544', 'space station': '25544', zarya: '25544', tiangong: '48274', css: '48274', tianhe: '48274',
  'chinese space station': '48274', 'china space station': '48274', hubble: '20580', hst: '20580', 'hubble space telescope': '20580' };
/** Not in Earth orbit, so not in any element set: say where they are instead of "not found". */
const ELSEWHERE = { jwst: 'the James Webb Space Telescope orbits the Sun-Earth L2 point, 1.5 million km away', webb: 'the James Webb Space Telescope orbits the Sun-Earth L2 point, 1.5 million km away',
  'james webb': 'the James Webb Space Telescope orbits the Sun-Earth L2 point, 1.5 million km away', moon: 'the Moon is not a satellite in these catalogues' };

const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** feeds.scope (the memo every server of an isolate shares) or feeds -> Map(group -> { txt, list, byId, names }): a group
 *  parsed once for as long as its text stays the same. The 'active' set is ~16,000 element sets, 6-12 ms to parse, past the
 *  free Worker's 10 ms on every lookup otherwise. The same satellite objects come back each time, so satrec's memo hits too. */
const parsed = new WeakMap();
/** A group's text, parsed (once per text): { txt, list: [{ id, name, l1, l2, group }], byId: Map (both '00005' and '5'), names (normalised) }. */
export function parseGroup(feeds, group, txt) {
  const owner = feeds.scope || feeds;
  let m = parsed.get(owner);
  if (!m) parsed.set(owner, (m = new Map()));
  const k = m.get(group);
  if (k && k.txt === txt) return k;
  parseGroup.parses++;
  const list = parseTle(txt).map(t => ({ ...t, group })), byId = new Map(), names = list.map(x => norm(x.name));
  for (const x of list) {
    const id = String(x.id); if (!byId.has(id)) byId.set(id, x);
    if (/^\d+$/.test(id) && !byId.has(String(+id))) byId.set(String(+id), x);
  }
  const g = { txt, list, byId, names };
  m.set(group, g);
  return g;
}
parseGroup.parses = 0;   // the tests check that a second lookup parses nothing

const groupOf = async (feeds, group, signal) => parseGroup(feeds, group, await feeds.text(feeds.site(`data/tle/${encodeURIComponent(group)}.txt`), { ttl: 3 * 3600e3, timeout: 30e3, signal }));
/** A group's satellites, [{ id, name, l1, l2, group }] (shared between calls: copy one before changing it). */
export async function loadGroup(feeds, group, signal) {
  return (await groupOf(feeds, group, signal)).list;
}

/**
 * Find satellites by NORAD number or name: [{ id, name, l1, l2, group }] best first (an exact name, then a name that starts
 * with the words, then one that contains them; shorter names first). Throws not_found with a hint.
 * @param {any} feeds
 * @param {string} query
 * @param {{ signal?: AbortSignal, max?: number }} [opts]
 */
export async function findSats(feeds, query, { signal, max = 5 } = {}) {
  const raw = String(query ?? '').trim().slice(0, 80) || 'ISS', key = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (ELSEWHERE[key]) throw new ToolError(`Not an Earth satellite: ${ELSEWHERE[key]}`, 'not_found');
  const id = /^\d{1,9}$/.test(raw) ? String(+raw) : ALIASES[key] || null, q = norm(raw);
  const out = [], have = new Set();
  for (const name of [...SEARCH_GROUPS, ...(id ? DEBRIS_GROUPS : [])]) {
    const g = await groupOf(feeds, name, signal).catch(e => { if (name === 'active') throw e; return null; });   // a small group missing is no news
    if (!g) continue;
    if (id) { const s = g.byId.get(id); if (s) return [s]; continue; }
    const scored = [];
    g.list.forEach((s, i) => {
      const n = g.names[i], score = n === q ? 0 : n.startsWith(q) ? 1 : (' ' + n + ' ').includes(' ' + q + ' ') ? 2 : n.includes(q) ? 3 : -1;
      if (score >= 0 && !have.has(s.id)) scored.push([score, n.length, s]);
    });
    scored.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    for (const [, , s] of scored) if (!have.has(s.id)) { have.add(s.id); out.push(s); }
    if (out.length && norm(out[0].name) === q) break;   // an exact name: stop looking
  }
  if (!out.length) throw new ToolError(id ? `No satellite numbered ${id} is in the catalogue the globe uses (working satellites and three debris clouds)` : `No satellite called "${raw}" was found; try its NORAD catalogue number`, 'not_found');
  return out.slice(0, max);
}

/** satrec for a TLE, made once. */
const recs = new WeakMap();
export const satrec = (sgp4, s) => { let r = recs.get(s); if (!r) { r = sgp4.twoline2satrec(s.l1, s.l2); recs.set(s, r); } return r; };

/** Earth-fixed position (km) at ms, or null if SGP4 can't place it (decayed, or the elements are too old). */
export function ecefAt(sgp4, s, ms) {
  const d = new Date(ms), pv = sgp4.propagate(satrec(sgp4, s), d);
  if (!pv || !pv.position || !Number.isFinite(pv.position.x)) return null;
  return sgp4.eciToEcf(pv.position, sgp4.gstime(d));
}

/** Where a satellite is at ms: { lat, lon, altKm, speedKmS, periodMin, inclination, epochMs } or null. */
export function satState(sgp4, s, ms) {
  const rec = satrec(sgp4, s), d = new Date(ms), pv = sgp4.propagate(rec, d);
  if (!pv || !pv.position || !Number.isFinite(pv.position.x)) return null;
  const g = sgp4.eciToGeodetic(pv.position, sgp4.gstime(d)), v = pv.velocity;
  return { lat: sgp4.degreesLat(g.latitude), lon: sgp4.degreesLong(g.longitude), altKm: g.height, speedKmS: Math.hypot(v.x, v.y, v.z),
    periodMin: 2 * Math.PI / rec.no, inclination: rec.inclo * 180 / Math.PI, epochMs: msFromJd(tleEpochJd(s.l1)) };
}
