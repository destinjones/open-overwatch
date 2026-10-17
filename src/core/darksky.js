// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Dark skies, in plain words: what a spot's light pollution (lightpollution.js, the Falchi et al. 2016 atlas, CC BY-NC)
// means for the eye (the faintest star, how many stars, the Milky Way), the nearest darker sky (Bortle 3 or better) and
// which way it is, one "how good is tonight" line from the sky, the Moon and the clouds, which deep-sky objects
// (deepsky.js, OpenNGC, CC-BY-SA-4.0) the sky and the observer's gear allow, and the colours of the light-pollution
// overlay on the globe and the 2D map. DOM-free; times are ms since 1970.
import { BORTLE, NATURAL_MCD, sqmFromMcd, mcdFromSqm, bortleFromSqm } from './lightpollution.js';
import { TYPES, label, visibleTonight } from './deepsky.js';
import { altAz, bodyRaDec, moonPhase } from './sky.js';
import { compass } from './passes.js';
import { IAU_NAMES } from './whereis.js';
import { jdFromMs } from './time.js';

const HOUR = 3600e3, DEG = Math.PI / 180, KM_PER_DEG = 111.195;

/** The credit lines wherever the data shows. */
export const ATLAS_CREDIT = 'Light pollution: Falchi et al. 2016, The New World Atlas of Artificial Night Sky Brightness (CC BY-NC 4.0, non-commercial)';
export const ATLAS_SHORT = 'Falchi et al. 2016, CC BY-NC';
export const ATLAS_URL = 'https://doi.org/10.5880/GFZ.1.4.2016.001';
export const NGC_CREDIT = 'Deep-sky objects: OpenNGC (Mattia Verga and contributors, CC-BY-SA-4.0)';
export const NGC_URL = 'https://github.com/mattiaverga/OpenNGC';

/** Naked-eye limiting magnitude at the zenith for a sky brightness (mag/arcsec²), the usual SQM-to-NELM fit. */
export const nelmFromSqm = sqm => 7.93 - 5 * Math.log10(10 ** (4.316 - sqm / 5) + 1);

// stars brighter than a magnitude over the whole sky (Allen's Astrophysical Quantities, rounded)
const STARS = [[0, 4], [1, 15], [2, 48], [3, 171], [4, 513], [5, 1602], [6, 4800], [6.5, 9100], [7, 15000]];
/** About how many stars the eye can see at once with that limiting magnitude: half the sky is up, the low part dimmed. */
export function starsVisible(nelm) {
  const m = Math.max(0, Math.min(7, nelm));
  let i = 1; while (i < STARS.length - 1 && STARS[i][0] < m) i++;
  const [m0, n0] = STARS[i - 1], [m1, n1] = STARS[i], n = n0 * (n1 / n0) ** ((m - m0) / (m1 - m0)) * 0.4;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);   // two significant figures
  return Math.round(n / p) * p;
}

const MILKY = [null,
  ['bright', 'The Milky Way is bright and full of detail, enough to cast a faint glow; the zodiacal light is easy.'],
  ['bright', 'The Milky Way is bright and detailed from horizon to horizon.'],
  ['plain', 'The Milky Way is plain and structured overhead, fading near the horizon where towns glow.'],
  ['visible', 'The Milky Way is visible but loses its detail; town glows sit on the horizon.'],
  ['faint', 'The Milky Way is faint: only overhead, and only on the clearest nights.'],
  ['hints', 'The Milky Way is all but gone: at best a hint straight up.'],
  ['none', 'No Milky Way: the sky is grey all over.'],
  ['none', 'No Milky Way: only the brightest stars and the outlines of a few constellations.'],
  ['none', 'No Milky Way: a few dozen stars, the Moon and the planets.']];

/**
 * A sky (lightpollution.js skyAt) in words: { bortle, sqm, name, nelm, stars, milkyWay ('bright' … 'none'), bright (vs a
 * natural sky), milky, eye (sentences), text (all of it) }.
 */
export function skyWords(s) {
  const nelm = nelmFromSqm(s.sqm), stars = starsVisible(nelm), [milkyWay, mw] = MILKY[s.bortle];
  const bright = s.ratio < 0.01 ? 'no measurable light pollution' : s.ratio < 0.15 ? 'nearly natural' : `${s.ratio < 10 ? (1 + s.ratio).toFixed(1) : Math.round(1 + s.ratio)} times brighter than a natural sky`;
  const eye = `The faintest stars are about magnitude ${nelm.toFixed(1)}: some ${stars.toLocaleString('en-US')} stars on a clear moonless night.`;
  return { bortle: s.bortle, sqm: s.sqm, name: s.name, nelm, stars, milkyWay, bright, milky: mw, eye,
    text: `Bortle ${s.bortle}, ${/^[aeiou]/.test(s.name) ? 'an' : 'a'} ${s.name} (SQM ${s.sqm.toFixed(2)} mag/arcsec², ${bright}). ${mw} ${eye}` };
}

/** Initial bearing (deg from north) from one point to another. */
export function bearing(la1, lo1, la2, lo2) {
  const y = Math.sin((lo2 - lo1) * DEG) * Math.cos(la2 * DEG), x = Math.cos(la1 * DEG) * Math.sin(la2 * DEG) - Math.sin(la1 * DEG) * Math.cos(la2 * DEG) * Math.cos((lo2 - lo1) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}
const kmBetween = (la1, lo1, la2, lo2) => {
  const a = Math.sin((la2 - la1) * DEG / 2) ** 2 + Math.cos(la1 * DEG) * Math.cos(la2 * DEG) * Math.sin((lo2 - lo1) * DEG / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
};

/** The largest cell byte whose artificial brightness still gives Bortle `cls` or better. */
export function qLimit(g, cls) {
  const thr = mcdFromSqm(BORTLE[cls - 1].sqm) - (g.natural ?? NATURAL_MCD);
  if (thr <= 0) return 0;   // (byte 0 is "no measurable light": always dark)
  return Math.max(0, Math.min(255, Math.floor((Math.log10(thr) - g.log0) / g.qstep + 1)));
}

/**
 * The nearest stretch of sky at Bortle `maxBortle` or better (a dark cell whose four neighbours are dark too, so not a
 * single gap between towns) within maxKm: { lat, lon, km, bearing, dir, bortle, sqm } or null; { here: true, km: 0 } when
 * the spot itself qualifies. `land(lat, lon)` (optional) rejects candidates at sea: the atlas is dark offshore. Without
 * it the nearest cell comes back marked `unchecked: true`, and darkText says it may be at sea.
 */
export function nearestDark(g, lat, lon, { maxBortle = 3, maxKm = 1000, land = null, tries = 20000 } = {}) {
  const q = qLimit(g, maxBortle), { cols, rows, step } = g, cells = g.cells;
  const row = Math.floor((g.lat0 - lat) / step), col = Math.floor((((lon - g.lon0) % 360 + 360) % 360) / step);
  if (row < 0 || row >= rows) return null;
  const ok = (i, j) => i >= 0 && i < rows && cells[i * cols + ((j % cols) + cols) % cols] <= q;
  if (ok(row, col)) return { here: true, km: 0, lat, lon, bortle: maxBortle };
  const dr = Math.ceil(maxKm / KM_PER_DEG / step), found = [];
  for (let i = Math.max(1, row - dr); i <= Math.min(rows - 2, row + dr); i++) {
    const la = g.lat0 - (i + 0.5) * step, c = Math.cos(la * DEG);
    const dc = c < 0.02 ? cols / 2 : Math.min(cols / 2, Math.ceil(maxKm / (KM_PER_DEG * c) / step));
    for (let j = col - dc; j <= col + dc; j++) {
      if (!(ok(i, j) && ok(i - 1, j) && ok(i + 1, j) && ok(i, j - 1) && ok(i, j + 1))) continue;
      const lo = g.lon0 + (j + 0.5) * step, km = kmBetween(lat, lon, la, lo);
      if (km <= maxKm) found.push([km, la, ((lo + 540) % 360) - 180, i * cols + ((j % cols) + cols) % cols]);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  for (const [km, la, lo, k] of found.slice(0, land ? tries : 1)) {
    if (land && !land(la, lo)) continue;
    const art = cells[k] ? 10 ** (g.log0 + (cells[k] - 1) * g.qstep) : 0, sqm = sqmFromMcd(art + (g.natural ?? NATURAL_MCD)), b = bearing(lat, lon, la, lo);
    const d = { lat: +la.toFixed(3), lon: +lo.toFixed(3), km, bearing: b, dir: compass(b), bortle: bortleFromSqm(sqm), sqm };
    if (!land) d.unchecked = true;   // no land test ran (the caller's land map did not load): it may be offshore
    return d;
  }
  return null;
}

/** nearestDark for Bortle 3, else (marked `fallback`) the nearest Bortle 4 when the spot is brighter than that. */
export function nearestDarker(g, lat, lon, opts = {}) {
  const d = nearestDark(g, lat, lon, { ...opts, maxBortle: 3 });
  if (d) return d;
  const d4 = nearestDark(g, lat, lon, { ...opts, maxBortle: 4 });
  return d4 && { ...d4, fallback: true };
}

/** "about 45 km to the north-west" */
export const COMPASS_WORDS = { N: 'north', NNE: 'north-north-east', NE: 'north-east', ENE: 'east-north-east', E: 'east', ESE: 'east-south-east', SE: 'south-east', SSE: 'south-south-east',
  S: 'south', SSW: 'south-south-west', SW: 'south-west', WSW: 'west-south-west', W: 'west', WNW: 'west-north-west', NW: 'north-west', NNW: 'north-north-west' };
export function darkText(d, maxKm = 1000) {
  if (!d) return `No Bortle 3 or 4 sky within ${maxKm.toLocaleString('en-US')} km on land.`;
  if (d.here) return d.bortle <= 3 ? 'You are already under a dark (Bortle 3 or better) sky.' : `No Bortle 3 sky within ${maxKm.toLocaleString('en-US')} km on land, and this sky is already as dark as the nearest ones.`;
  const km = d.km < 20 ? Math.round(d.km) : Math.round(d.km / 5) * 5, sea = d.unchecked ? ' The land map did not load: it may be at sea.' : '';
  return `${d.fallback ? `No Bortle 3 sky within ${maxKm.toLocaleString('en-US')} km${d.unchecked ? '' : ' on land'}. The nearest darker one` : 'The nearest dark sky'} (Bortle ${d.bortle}) is about ${km} km to the ${COMPASS_WORDS[d.dir] || d.dir}, around ${Math.abs(d.lat).toFixed(2)}°${d.lat >= 0 ? 'N' : 'S'} ${Math.abs(d.lon).toFixed(2)}°${d.lon >= 0 ? 'E' : 'W'} (as the crow flies).${sea}`;
}

// The Moon's light on the sky: a full Moon well up brightens a dark sky to about SQM 18.5 (~4.3 mcd/m²); the phase law
// falls off steeply (a half Moon gives about a tenth of the full Moon's light). Rough, but it ranks nights the right way.
const MOON_FULL_MCD = 4.3;
const moonMcd = (lit, alt) => alt <= 0 ? 0 : MOON_FULL_MCD * lit ** 3 * Math.min(1, Math.sin(alt * DEG) * 2);

/**
 * The Moon over a dark window ({ start, end }): { lit, name, upHours, darkHours, moonless (hours of dark without the
 * Moon), moonlessFrom, moonlessTo (the longest moonless stretch), mcd (its mean added brightness while it is up) }.
 */
export function moonOver(lat, lon, win, { step = 10 * 60e3 } = {}) {
  const ph = moonPhase((win.start + win.end) / 2);
  let up = 0, n = 0, sum = 0, run = null, best = null;
  for (let t = win.start; t < win.end; t += step) {
    const jd = jdFromMs(t), alt = altAz(bodyRaDec('moon', jd), lat, lon, jd).alt;
    n++;
    if (alt > 0) { up++; sum += moonMcd(ph.lit, alt); if (run) { if (!best || run.to - run.from > best.to - best.from) best = run; run = null; } }
    else { if (!run) run = { from: t, to: t }; run.to = Math.min(t + step, win.end); }
  }
  if (run && (!best || run.to - run.from > best.to - best.from)) best = run;
  const h = step / HOUR;
  return { lit: ph.lit, name: ph.name, upHours: up * h, darkHours: n * h, moonless: (n - up) * h, moonlessFrom: best ? best.from : null, moonlessTo: best ? best.to : null, mcd: up ? sum / up : 0 };
}

/** @type {[number, string][]} */
const WORDS = [[0.75, 'excellent'], [0.5, 'good'], [0.3, 'fair'], [0.12, 'poor'], [-1, 'not worth it']];

/**
 * How good tonight is for looking up, from the site's sky (skyAt), the Moon (moonOver) and the clouds (clouds.js
 * night(): { mean, clear }), any of which may be missing. { score 0-1, word, sqm (the sky you will really have), text }.
 */
export function tonightQuality({ sky = null, moon = null, clouds = null, time = ms => new Date(ms).toISOString().slice(11, 16) } = {}) {
  const site = sky ? sky.total : NATURAL_MCD * 1.5;
  // the Moon counts unless it leaves at least two hours (or most of the night) moonless
  const moonFree = moon && (moon.moonless >= Math.min(2, 0.6 * moon.darkHours));
  const eff = sqmFromMcd(site + (moon && !moonFree ? moon.mcd : 0));
  const skyScore = Math.max(0, Math.min(1, (eff - 17.5) / (21.9 - 17.5)));
  let clear = 1;
  if (clouds) { clear = 1 - clouds.mean / 100; if (clouds.clear && clouds.clear.length) clear = Math.max(clear, 0.7); }
  const score = skyScore * clear, word = WORDS.find(([x]) => score >= x)[1];
  const parts = [];
  if (sky) parts.push(`a Bortle ${sky.bortle} sky`);
  if (moon) {
    const pct = Math.round(moon.lit * 100);
    parts.push(moon.lit < 0.05 || moon.upHours === 0 ? `no Moon${moon.lit >= 0.05 ? ' in the dark hours' : ''}` : moonFree && moon.moonlessFrom != null ? `the Moon ${pct}% lit but down ${time(moon.moonlessFrom)}–${time(moon.moonlessTo)}` : `a ${pct}% Moon up ${Math.round(moon.upHours)} of ${Math.round(moon.darkHours)} dark hours`);
  }
  if (clouds) parts.push(clouds.clear && clouds.clear.length ? (clouds.mean < 20 ? 'clear skies' : `clear spells (${clouds.mean}% cloud on average)`) : clouds.mean >= 75 ? `cloud (${clouds.mean}%)` : `patchy cloud (${clouds.mean}%)`);
  else parts.push('no cloud forecast yet');
  return { score, word, sqm: eff, text: `Tonight: ${word}. ${parts.join(', ').replace(/^./, c => c.toUpperCase())}.` };
}

/** What each kind of observer brings: how much deeper than the naked-eye limit, and how faint a glow (above the sky) shows. */
export const GEAR = {
  eyes: { label: 'Eyes', note: 'naked eye, dark-adapted', mag: -1, sb: 1.5 },
  binoculars: { label: 'Binoculars', note: '7×50 or 10×50', mag: 3.5, sb: 2.3 },
  scope: { label: 'Small telescope', note: '80–130 mm', mag: 5.5, sb: 3.0 },
};

/** Mean surface brightness (mag/arcsec²) of an object's bright part (galaxies: the inner half), or null without a size. */
export function surfaceBrightness(o) {
  if (o.mag == null || !o.maj) return null;
  const f = TYPES[o.type]?.group === 'galaxy' ? 0.25 : 1, area = Math.PI / 4 * o.maj * (o.min || o.maj) * 3600 * f;
  return o.mag + 2.5 * Math.log10(area);
}

/**
 * Limits for gear under a sky of `sqm` (mag/arcsec²): { maxMag, maxSb, nelm }. Every class of sky shifts both.
 */
export function gearLimits(gear, sqm) {
  const G = GEAR[gear] || GEAR.eyes, nelm = nelmFromSqm(sqm);
  return { nelm, maxMag: nelm + G.mag, maxSb: sqm + G.sb };
}

/** Objects the gear can show under that sky: bright enough, and (for galaxies and nebulae) concentrated enough. */
export function withinReach(list, gear, sqm) {
  const { maxMag, maxSb } = gearLimits(gear, sqm);
  return list.filter(o => {
    if (o.mag == null || o.mag > maxMag || o.type === 'DrkN' || o.type === '*' || o.type === '**') return false;
    const g = TYPES[o.type]?.group;
    if (g !== 'galaxy' && g !== 'nebula' || o.mag <= 5) return true;   // clusters resolve into stars, planetaries are small and bright, the brightest have bright cores
    const sb = surfaceBrightness(o); return sb == null || sb <= maxSb;
  });
}

const size = o => !o.maj ? '' : o.maj >= 60 ? `${(o.maj / 60).toFixed(o.maj >= 120 ? 0 : 1)}° across` : `${o.maj >= 10 ? Math.round(o.maj) : o.maj.toFixed(1)}′ across`;
/** "Globular cluster in Hercules · mag 5.8 · 20′ across" */
export function describe(o) {
  const t = TYPES[o.type]?.label || 'object';
  return [`${t[0].toUpperCase()}${t.slice(1)} in ${IAU_NAMES[o.con] || o.con}`, o.mag != null ? `mag ${o.mag.toFixed(1)}` : '', size(o)].filter(Boolean).join(' · ');
}

/**
 * The deep-sky list for tonight: objects the gear reaches under `sqm`, at least minAlt up while it is dark (deepsky.js
 * visibleTonight), Messier objects first among equals, each { obj, label, text, best, alt, az, dir, from, to }.
 */
export function deepSkyTonight(list, lat, lon, t0, { gear = 'eyes', sqm = 21, minAlt = 25, limit = 30, minLeft = 0 } = {}) {
  const pool = withinReach(list, gear, sqm);
  return visibleTonight(pool, lat, lon, t0, { minAlt, minLeft })
    .sort((a, b) => (a.obj.mag - (a.obj.m ? 1 : 0)) - (b.obj.mag - (b.obj.m ? 1 : 0)))
    .slice(0, limit)
    .map(v => ({ ...v, label: label(v.obj), text: describe(v.obj), dir: compass(v.az) }));
}

// ---- the overlay: colours by Bortle class, transparent where the sky is dark
const RAMP = [null, [0, 0, 0, 0], [0, 0, 0, 0], [40, 70, 160, 110], [40, 150, 90, 140], [235, 220, 60, 160], [255, 150, 40, 180], [255, 70, 50, 195], [255, 120, 200, 210], [255, 245, 250, 225]];
/** RGBA for each cell byte (a 1024-entry table): the cell's total sky brightness turned into a Bortle class. */
export function overlayTable(g) {
  const t = new Uint8ClampedArray(1024), nat = g.natural ?? NATURAL_MCD;
  for (let q = 0; q < 256; q++) {
    const art = q ? 10 ** (g.log0 + (q - 1) * g.qstep) : 0;
    t.set(RAMP[bortleFromSqm(sqmFromMcd(art + nat))], q * 4);
  }
  return t;
}
/** The cell byte at lat/lon (nearest cell), or 0 outside the atlas. */
const cellAt = (g, lat, lon) => {
  const i = Math.floor((g.lat0 - lat) / g.step); if (i < 0 || i >= g.rows) return 0;
  const j = Math.floor((((lon - g.lon0) % 360 + 360) % 360) / g.step);
  return g.cells[i * g.cols + (j % g.cols)];
};
/**
 * An equirectangular picture of the atlas (w × h, lon -180…180, lat lat0…lat0 - rows × step), each pixel the brightest
 * cell under it (so a small town still shows at a coarse size): RGBA bytes.
 */
export function paintAtlas(g, w, h, table = overlayTable(g)) {
  const out = new Uint8ClampedArray(w * h * 4), sx = g.cols / w, sy = g.rows / h;
  for (let y = 0; y < h; y++) {
    const i0 = Math.floor(y * sy), i1 = Math.max(i0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const j0 = Math.floor(x * sx), j1 = Math.max(j0 + 1, Math.floor((x + 1) * sx));
      let m = 0; for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) { const v = g.cells[i * g.cols + j]; if (v > m) m = v; }
      out.set(table.subarray(m * 4, m * 4 + 4), (y * w + x) * 4);
    }
  }
  return out;
}
/** One Web Mercator tile (z, x, y) of the overlay, size × size RGBA, sampled at each pixel's centre. */
export function paintTile(g, z, x, y, size = 256, table = overlayTable(g)) {
  const out = new Uint8ClampedArray(size * size * 4), n = 2 ** z;
  for (let py = 0; py < size; py++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (py + 0.5) / size) / n))) / DEG;
    for (let px = 0; px < size; px++) {
      const lon = (x + (px + 0.5) / size) / n * 360 - 180, q = cellAt(g, lat, lon);
      out.set(table.subarray(q * 4, q * 4 + 4), (py * size + px) * 4);
    }
  }
  return out;
}
