// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Habitable zones (Kopparapu et al. 2014, ApJL 787 L29): the distances from a star where a rocky planet could keep
// liquid water on its surface. The effective stellar flux at each edge is a polynomial in T* = Teff - 5780 K (valid for
// 2600-7200 K; cooler or hotter stars are clamped), and the distance is sqrt(L / S_eff) AU.
//   conservative: runaway greenhouse (1 Earth mass) to maximum greenhouse (what data/solar/exoplanets.json stores as
//                 `hz` and flags as in_HZ, from brand/tools/make_exoplanets.py)
//   optimistic:   "recent Venus" to "early Mars" (the empirical edges: Venus seems to have lost its water about a
//                 billion years ago, Mars had some 3.8 billion years ago). Most published "planets in the habitable
//                 zone" (K2-18 b, both Teegarden planets) are counted against these.
// Pure: the Solar System view's exoplanet systems and the tests use it.

/** [S0, a, b, c, d] for S_eff = S0 + a T + b T^2 + c T^3 + d T^4 (Kopparapu et al. 2014, table 1). */
export const KOPPARAPU = Object.freeze({
  recentVenus: [1.776, 2.136e-4, 2.533e-8, -1.332e-11, -3.097e-15],
  runawayGreenhouse: [1.107, 1.332e-4, 1.580e-8, -8.308e-12, -1.931e-15],
  maximumGreenhouse: [0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16],
  earlyMars: [0.320, 5.547e-5, 1.526e-9, -2.874e-12, -5.011e-16],
});
const EDGES = { conservative: ['runawayGreenhouse', 'maximumGreenhouse'], optimistic: ['recentVenus', 'earlyMars'] };

/** Effective flux (in Earth's) at one edge for a star of teff K (missing: the Sun's 5780 K, as the build script does). */
export function seff(edge, teff) {
  const t = Math.max(2600, Math.min(7200, teff || 5780)) - 5780, [s0, a, b, c, d] = KOPPARAPU[edge];
  return s0 + a * t + b * t * t + c * t ** 3 + d * t ** 4;
}

/**
 * The habitable zone [inner, outer] in AU for a star of log10(L / Lsun) logL and temperature teff (K), or null without a
 * luminosity. kind: 'conservative' (default) | 'optimistic'.
 */
export function habitableZone(logL, teff, kind = 'conservative') {
  if (logL == null || !Number.isFinite(logL)) return null;
  const L = 10 ** logL, [i, o] = EDGES[kind] || EDGES.conservative;
  return [Math.sqrt(L / seff(i, teff)), Math.sqrt(L / seff(o, teff))];
}

const inside = (z, a) => !!z && a >= z[0] && a <= z[1];

/**
 * One exoplanets.json system's zones: { hz (stored conservative), opt (optimistic: stored hz_opt, else from its teff
 * and lum) }. The stored zone is used as is, so the ring the view draws and the in_HZ flags agree with each other.
 */
export function systemZones(s) {
  return { hz: s.hz || null, opt: s.hz_opt || habitableZone(s.lum, s.teff, 'optimistic') };
}

/** Where a planet at a AU sits: 'habitable' (the conservative zone) | 'optimistic' (only the optimistic one) | ''. */
export function zoneOf(zones, a, flagged = false) {
  if (flagged || inside(zones.hz, a)) return 'habitable';
  return inside(zones.opt, a) ? 'optimistic' : '';
}

/** Counts for a system (planet rows as in exoplanets.json: a at [1], the in_HZ flag at [11]): { habitable, optimistic }. */
export function zoneCounts(s, zones = systemZones(s)) {
  let habitable = 0, optimistic = 0;
  for (const p of s.pl) { const z = zoneOf(zones, p[1], !!p[11]); if (z === 'habitable') habitable++; else if (z === 'optimistic') optimistic++; }
  return { habitable, optimistic };
}

/** "3 planets (1 in the habitable zone, 2 more in the optimistic zone)": the card's line for a system. */
export function zoneWords(s, zones = systemZones(s)) {
  const { habitable, optimistic } = zoneCounts(s, zones), n = s.pl.length;
  const parts = [habitable ? `${habitable} in the habitable zone` : '', optimistic ? `${optimistic}${habitable ? ' more' : ''} in the optimistic zone` : ''].filter(Boolean);
  return String(n) + (parts.length ? ` (${parts.join(', ')})` : '');
}
