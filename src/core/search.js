// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// "Where is it now?" search: one ranked list over planets, moons, spacecraft, comets, named asteroids, stars and other
// planetary systems. DOM-free so it is tested (test/solar.test.mjs).
//
// An item is { key, name, kind, aliases?: [..], weight?: 0..100 (how famous), data?: anything }. Ranking, best first:
//   exact name or alias  >  name/alias starts with the query  >  every query word starts a word of the name
//   >  the query appears inside  >  a typo away (1 edit for 4+ letters, 2 for 8+)
// then by kind (a planet before a moon before a craft ... before an asteroid), fame, shorter names, alphabetical.
// "voyager1" finds "Voyager 1" (spaces and punctuation are ignored as a second try), "67p" finds 67P/Churyumov-
// Gerasimenko, "jwst" the James Webb Space Telescope (an alias), "jupitr" Jupiter (a typo).

export const KIND_RANK = Object.freeze({
  planet: 60, star: 50, 'dwarf planet': 48, spacecraft: 40, moon: 34, comet: 30, galaxy: 24, asteroid: 12, exoplanet: 10,
});
/** Rank of a kind, also for the long forms ("main-belt asteroid", "galaxy cluster", "exoplanet system"). */
const LONGEST_FIRST = Object.entries(KIND_RANK).sort((a, b) => b[0].length - a[0].length);   // "exoplanet" before "planet"
export const kindRank = kind => KIND_RANK[kind] ?? LONGEST_FIRST.find(([k]) => String(kind).includes(k))?.[1] ?? 0;

/** Lower case, accents off, punctuation to spaces, single spaces. */
export function normalize(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const compact = s => s.replace(/ /g, '');

/** Optimal string alignment distance (Levenshtein plus adjacent swaps), stopping early once it exceeds max. */
export function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v); if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

/** Precompute the normalized forms of each item's names. */
export function buildIndex(items) {
  return items.map(it => {
    const names = [it.name, ...(it.aliases || [])].map(normalize).filter(Boolean);
    return { it, names, compacts: names.map(compact), words: names.map(n => n.split(' ')) };
  });
}

/** Match score of one indexed entry against a normalized query (0 = no match). */
export function matchScore(e, q, qc = compact(q), qw = q.split(' ')) {
  let best = 0;
  for (let k = 0; k < e.names.length; k++) {
    const n = e.names[k], c = e.compacts[k], alias = k > 0 ? 5 : 0;   // the main name wins a tie with an alias
    let s = 0;
    if (n === q || c === qc) s = 1000;
    else if (n.startsWith(q) || c.startsWith(qc)) s = 800 - Math.min(80, n.length - q.length);
    else if (qw.every(w => e.words[k].some(x => x.startsWith(w)))) s = 600;
    else if (n.includes(q) || ((qc.length >= 5 || q.includes(' ')) && c.includes(qc))) s = 400;   // short runs of digits would hit thousands of numbers
    else if (qc.length >= 4) {
      const max = qc.length >= 8 ? 2 : 1;
      // a typo in the whole name, or in the start of it (search-as-you-type: "jupit" for "jupiter")
      const d = Math.min(editDistance(qc, c, max), editDistance(qc, c.slice(0, qc.length), max), editDistance(qc, c.slice(0, qc.length + 1), max));
      if (d <= max) s = 250 - 60 * d;
    }
    if (s) best = Math.max(best, s - alias);
  }
  return best;
}

/** Ranked matches for a query: [{ ...item, score }], at most `limit`. Queries under 2 characters match nothing. */
export function search(index, query, limit = 12) {
  const q = normalize(query); if (q.length < 2 && !/^\d$/.test(q)) return [];
  const qc = compact(q), qw = q.split(' '), out = [];
  for (const e of index) {
    const m = matchScore(e, q, qc, qw); if (!m) continue;
    const it = e.it;
    out.push({ it, score: m + kindRank(it.kind) + Math.min(100, it.weight || 0) * 0.5 });
  }
  out.sort((a, b) => b.score - a.score || a.it.name.length - b.it.name.length || a.it.name.localeCompare(b.it.name));
  return out.slice(0, limit).map(o => ({ ...o.it, score: o.score }));
}

/** Merge ranked lists from several sources (each already scored), keeping the best per key and per name. */
export function mergeResults(lists, limit = 12) {
  const seen = new Map();
  for (const list of lists) for (const r of list) {
    const k = r.key ?? r.name, prev = seen.get(k);
    if (!prev || r.score > prev.score) seen.set(k, r);
  }
  const byName = new Map();
  for (const r of seen.values()) { const n = normalize(r.name), p = byName.get(n); if (!p || r.score > p.score) byName.set(n, r); }
  return [...byName.values()].sort((a, b) => b.score - a.score || a.name.length - b.name.length).slice(0, limit);
}
