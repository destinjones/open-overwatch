// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Words for the Solar System view's narrative (src/solar/story.js) that depend on what is actually drawn: how many
// galaxies or asteroids are on screen against how many the catalogue holds (phones and the Low quality level draw the
// brightest part only), and the planetary-alignment search with the window it really searched. Pure, for the tests.
import { planetSpread } from './planets.js';
import { formatUtc } from './time.js';

/** 2100-01-01: the planet formulae (core/planets.js) are not used past it. */
export const ALIGN_END_JD = 2488069.5;

const n0 = n => Math.round(n).toLocaleString('en-US');
/** "1.57 million", "300,000": a big count in words. */
export function countWords(n) {
  return n >= 1e6 ? `${(Math.round(n / 1e4) / 100).toLocaleString('en-US')} million` : n0(n);
}

/**
 * How many of a catalogue are drawn, in words: "43,480" (+ whole, say " of them") when all of them are (or the count
 * is not known yet), else "the brightest 15,000 of 43,480".
 */
export function drawnWords(drawn, total, whole = '') {
  return drawn > 0 && drawn < total ? `the brightest ${countWords(drawn)} of ${countWords(total)}` : countWords(total) + whole;
}

/**
 * The tightest grouping of the eight planets (seen from the Sun) in the century after the clock, stopping at 2100:
 * { jd, spread (deg), from, to } (from = the clock plus 30 days), or { beyond: true, from } when the clock is already
 * past 2100 and there is nothing to search.
 */
export function findAlignment(clockJd, spread = planetSpread) {
  const from = clockJd + 30, to = Math.min(from + 36525, ALIGN_END_JD);
  if (!(from < to)) return { beyond: true, from, to };
  let best = Infinity, bestJd = from;
  for (let jd = from; jd < to; jd += 3) { const s = spread(jd); if (s < best) { best = s; bestJd = jd; } }
  for (let jd = Math.max(from, bestJd - 3); jd < Math.min(to, bestJd + 3); jd += 0.25) { const s = spread(jd); if (s < best) { best = s; bestJd = jd; } }
  return { jd: bestJd, spread: best, from, to };
}

/** [title, text] for the caption: the window searched is the one named. */
export function alignmentCaption(r) {
  const year = jd => formatUtc(jd).slice(0, 4);
  if (r.beyond) return ['Planetary alignment', 'The planet formulae used here stop at 2100, so there is no alignment to look for after that. Press NOW to come back to today.'];
  return ['Planetary alignment · ' + formatUtc(r.jd).slice(0, 10),
    `All eight planets sit within ${r.spread.toFixed(0)}° of each other around the Sun, the tightest grouping between ${year(r.from)} and ${year(r.to)} (planets never line up exactly).`];
}
