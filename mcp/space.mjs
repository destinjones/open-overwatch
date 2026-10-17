// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// where_in_space: "where is it now?" for anything in the Solar System the website's 3D view knows by name: the planets,
// the Moon, the major moons, deep-space missions (Voyager, JWST, Parker, Juno, Europa Clipper, ISRO's Chandrayaan and
// Aditya-L1…), every comet and the 26,000 named asteroids and dwarf planets. How far it is from the Sun and from us,
// how long its light (or its radio signal) takes, how fast it moves, which way to look (RA/Dec, constellation, evening
// or morning sky, how bright), and, for a place, how high it is there now. The site's own data copies (JPL Horizons tracks, SBDB elements) and core
// maths; an asteroid's elements come out of the packed files by byte range. Links open the Solar System view on it.
import { catalogue, indexCatalogue, findBody, quickIndex, findQuick, recordRanges, elementsFromBytes, fileRecords, hgMagnitude, stateAt, lightWords, distanceWords, IAU_NAMES, seeingWords, CLASS_WORDS } from '../src/core/whereis.js';
import { planetPosition, earthPosition, moonGeocentric, PHYSICAL } from '../src/core/planets.js';
import { SKY_PLANETS, planetFromEarth } from '../src/core/solarsys.js';
import { moonOffset, moonPeriod } from '../src/core/moons.js';
import { trackPosition, missionPhase, eventsAround, relativeTime, missionDays, missionsNow, moonCenterAt } from '../src/core/craft.js';
import { cometFromRow, cometPosition, cometPeriodYears, cometClass, cometNames, cometsNearNow, cometMagnitude, orbitFresh, COMET_FACTS } from '../src/core/comets.js';
import { positionAt } from '../src/core/kepler.js';
import { nearestConstellation, formatRaDec, skyPhrase } from '../src/core/skyplace.js';
import { altAz, moonPhase } from '../src/core/sky.js';
import { compass } from '../src/core/passes.js';
import { encodeSolarView } from '../src/core/solarlink.js';
import { jdFromMs, msFromJd } from '../src/core/time.js';
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea } from './place.mjs';
import { iso, r1, r2, areaData, parseTime, timeHasZone, timeReadAs, zoneAt } from './words.mjs';

const DAY = 864e5, TTL = 24 * 3600e3;
const PLANETS = SKY_PLANETS.map(key => ({ key, name: PHYSICAL[key].name }));
const memo = new WeakMap();   // data object -> its built index (28,000 names: built once per isolate, not per call)
const indexOf = (src, items, make = indexCatalogue) => { let ix = memo.get(src); if (!ix) { ix = make(items()); memo.set(src, ix); } return ix; };
const EMPTY = {};
/** The perihelion nearest jd for a periodic comet (its last one on file moved on by whole periods), or the one on file. */
const nearestPerihelion = (c, jd) => { const P = cometPeriodYears(c) * 365.25, k = Number.isFinite(P) ? Math.round((jd - c.tp) / P) : 0; return { jd: c.tp + k * P, moved: k !== 0 }; };
/** The day the small-body copy was made (its 'made' field, when the file has one), or null. */
const asOf = small => (small && typeof small.made === 'string' && /^\d{4}-\d\d-\d\d/.test(small.made) ? small.made.slice(0, 10) : null);
// Apophis: two-body from the shared epoch is good to a few thousand km now, but its 13 April 2029 Earth flyby (JPL: closest
// at about 21:46 UTC, some 38,000 km from Earth's centre) bends its orbit, which these elements cannot follow
const APOPHIS = /^99942\b/, APOPHIS_FLYBY_JD = jdFromMs(Date.UTC(2029, 3, 13, 21, 46));
const APOPHIS_BEFORE = "Its Earth flyby on 13 April 2029 (JPL: closest at about 21:46 UTC, some 38,000 km from Earth's centre) is not modelled here: positions near it are only approximate.";
const APOPHIS_AFTER = "This is at or after its 13 April 2029 Earth flyby (JPL: about 38,000 km from Earth's centre), which is not modelled here: Earth's pull changes its orbit then, so this position may be off by tenths of an AU.";

export function spaceTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  const json = (path, signal) => feeds.json(feeds.site(path), { ttl: TTL, timeout: 30e3, signal });

  /** The packed bytes of one asteroid record (seven ranged reads, each cached for a week). */
  async function asteroidElements(row, meta, signal) {
    const [file, idx] = row, N = fileRecords(meta, file);
    if (!N) throw new ToolError(`The asteroid file for ${row[2]} is not listed`, 'unavailable');
    const url = feeds.site(`data/solar/asteroids_${file === 'b' ? 'b' : 'a'}.bin`), parts = {};
    await Promise.all(recordRanges(N, idx).map(async ([k, off, n]) => {
      const r = await feeds.bytes(url, { headers: { Range: `bytes=${off}-${off + n - 1}` }, ttl: 7 * TTL, maxBytes: 30e6, signal });
      parts[k] = r.bytes.length === n ? r.bytes : r.bytes.subarray(off, off + n);   // a server that ignores Range sends the whole file
      if (parts[k].length !== n) throw new ToolError('The asteroid file came back short', 'unavailable');
    }));
    return elementsFromBytes(parts, meta.epoch_jd);
  }

  /** Without a name: the missions now, nearest first, or the comets best placed now. */
  async function listing(kind, t, jd, signal) {
    const E = earthPosition(jd), when = iso(t), solarAt = key => `${site}solar.html#${encodeSolarView({ focus: key })}`;
    if (kind === 'missions') {
      const craft = await json('data/solar/spacecraft.json', signal), rows = missionsNow(craft, jd, E, moonCenterAt);
      const flying = rows.filter(m => m.au != null), done = rows.filter(m => m.au == null);
      const lines = flying.map(m => `${m.name}: ${distanceWords(m.au)} away, signal ${lightWords(m.light)}${m.status ? ` · ${m.status}` : ''}${m.next ? ` · next: ${m.next[1]} (${relativeTime(m.next[0] - jd)})` : ''}`);
      const url = `${site}solar.html`;
      return { text: [`${flying.length} deep-space missions with a position on ${when.slice(0, 10)}, nearest first:`, ...lines,
        done.length ? `No position now (before launch, or past the end of their tracks): ${done.map(m => m.name).join(', ')}.` : '', `The missions in the 3D Solar System: ${url}`].filter(Boolean).join('\n'),
        data: { at: when, missions: flying.map(m => ({ name: m.name, status: m.status || null, phase: m.phase, earth_au: Number(m.au.toPrecision(4)), signal_s: r1(m.light),
          next_event: m.next ? { date: iso(msFromJd(m.next[0])), what: m.next[1] } : null, url: solarAt('craft:' + m.name) })), without_position: done.map(m => m.name), url,
          source: "JPL Horizons spacecraft tracks (the website's copy)" } };
    }
    const small = await json('data/solar/small_bodies.json', signal), near = cometsNearNow(small.comets, jd, E, { maxR: 4, limit: 10 });
    const rows = near.map(x => {
      const n = cometNames(x.row[0]), P = cometPeriodYears(x.c), fresh = orbitFresh(x.c, jd), m = fresh ? cometMagnitude(x.c, x.r, x.delta) : null;
      return { name: n.display, designation: n.designation, class: cometClass(x.c), sun_au: r2(x.r), earth_au: r2(x.delta), magnitude: m == null ? null : r1(m),
        period_years: Number.isFinite(P) ? r1(P) : null, perihelion: iso(msFromJd(nearestPerihelion(x.c, jd).jd)), perihelion_estimated: nearestPerihelion(x.c, jd).moved,
        position_uncertain: !fresh, orbit_epoch: x.c.epoch != null ? iso(msFromJd(x.c.epoch)) : null, url: solarAt('comet:' + x.row[0]) };
    });
    const lines = rows.map(c => `${c.name}: ${c.sun_au} AU from the Sun, ${c.earth_au} AU from Earth · ${c.class}${c.magnitude != null ? ` · about magnitude ${c.magnitude}` : ''} · perihelion ${c.perihelion_estimated ? `around ${c.perihelion.slice(0, 7)}` : c.perihelion.slice(0, 10)}${c.position_uncertain ? ` · orbit data from ${String(c.orbit_epoch).slice(0, 4)}: position uncertain` : ''}`);
    return { text: [`The comets best placed on ${when.slice(0, 10)} (closest to the Sun and Earth together, not the brightest):`, ...lines, `Comets in the 3D Solar System: ${site}solar.html`].join('\n'),
      data: { at: when, comets: rows, url: `${site}solar.html`, note: 'ranked by distance from the Sun and Earth (5 log Δ + 10 log r), not by brightness; a magnitude is predicted where SBDB fits one (comets often stray from it)', source: `JPL Small-Body Database elements (the website's copy${asOf(small) ? `, made ${asOf(small)}` : ''})` } };
  }

  return {
    name: 'where_in_space',
    title: 'Where is it in the Solar System now',
    description: "Where something in the Solar System is right now (or at a given time): a planet, the Moon, a major moon (Titan, Europa…), a deep-space mission (Voyager 1, JWST, Parker Solar Probe, Juno, Europa Clipper, New Horizons, Chandrayaan-2, Aditya-L1, Mangalyaan…), any comet (Halley, 67P, 12P…) or any of 26,000 named asteroids and dwarf planets (Ceres, Pluto, Apophis, Bennu…). Its distance from the Sun and from Earth, how long light or a radio signal takes, its speed, which way to look (RA/Dec, constellation, evening or morning sky), how bright, the mission's phase and next event or the comet's next perihelion; with a place, how high it stands there now. From JPL Horizons tracks and JPL small-body elements (the website's copies). Without a name it lists every mission (nearest first, signal time, next event) or the comets best placed now. The link opens the 3D Solar System on it.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        name: { type: 'string', maxLength: 80, description: 'What to find: "Voyager 1", "JWST", "Halley", "67P", "Ceres", "Pluto", "Apophis", "Titan", "Mars". Leave out to get a list.' },
        list: { type: 'string', enum: ['missions', 'comets'], description: 'Without a name: every deep-space mission and how far it is (nearest first, with its signal time and next event), or the comets best placed now (near the Sun and Earth). Default missions.' },
        time: { type: 'string', maxLength: 40, description: 'A moment, ISO 8601 (default now), between 1900 and 2100. Give Z or an offset to be exact; a time without one is read as the place\'s local time, or as UTC without a place.' },
        ...areaProps(null),
      },
    },
    async run(a, { signal }) {
      const bad = () => new ToolError('time must be an ISO 8601 date between 1900 and 2100', 'invalid_arguments');
      const inRange = ms => Number.isFinite(ms) && ms >= Date.UTC(1900, 0, 1) && ms <= Date.UTC(2100, 0, 1);
      if (a.time != null && !inRange(parseTime(a.time))) throw bad();   // before any network
      const named = !!(a.name && a.name.trim());
      const area = named ? await resolveArea(a, feeds, { signal }) : null;
      // a time without a zone is the place's clock (UTC without a place), whichever host runs this
      const tz = area && a.time != null && !timeHasZone(a.time) ? await zoneAt(ctx, area.lat, area.lon, signal) : null;
      const t = a.time != null ? parseTime(a.time, tz) : ctx.now();
      if (!inRange(t)) throw bad();
      const jd = jdFromMs(t);
      if (!named) return listing(a.list || 'missions', t, jd, signal);
      const q = a.name.trim();
      // Look in the small lists first and only load the big ones when they are needed (they cost a Worker's CPU)
      const moons = (await json('data/solar/moons.json', signal).catch(() => null))?.moons || [];
      let hits = findBody(indexOf(moons, () => catalogue({ planets: PLANETS, moons })), q);
      let craft = [], small = null;
      if (!hits[0] || hits[0].score < 800) {
        craft = await json('data/solar/spacecraft.json', signal).catch(() => []);
        hits = [...hits, ...findBody(indexOf(craft, () => catalogue({ craft }).filter(x => x.ref.craft)), q)].sort((x, y) => y.score - x.score);
      }
      if (!hits[0] || hits[0].score < 800) {
        small = await json('data/solar/small_bodies.json', signal);
        hits = [...hits, ...findQuick(indexOf(small, () => catalogue({ small }).filter(x => x.ref.comet || x.ref.asteroid), quickIndex), q)].sort((x, y) => y.score - x.score);
      }
      const hit = hits[0];
      if (!hit) throw new ToolError(`Nothing in the Solar System called "${q}" is known here (try a planet, moon, mission, comet or numbered asteroid)`, 'not_found');
      const ref = hit.ref, earth = j => earthPosition(j);
      // how to place it: a function of jd giving the heliocentric position (AU)
      /** @type {Record<string, any>} */ let extra = {};
      let at, words = [];
      if (ref.planet) {
        at = j => planetPosition(ref.planet, j);
        const p = planetFromEarth(ref.planet, jd); extra = { magnitude: r1(p.magnitude), lit_percent: Math.round(p.lit * 100) };
      } else if (ref.moon) {
        at = j => { const E = earthPosition(j), m = moonGeocentric(j); return { x: E.x + m.x, y: E.y + m.y, z: E.z + m.z }; };
        const ph = moonPhase(t); extra = { phase: ph.name, lit_percent: Math.round(ph.lit * 100) };
        words.push(`${ph.name}, ${Math.round(ph.lit * 100)}% lit.`);
      } else if (ref.moonOf) {
        let host;
        if (SKY_PLANETS.includes(ref.moonOf)) host = j => planetPosition(ref.moonOf, j);
        else {   // Charon: Pluto is in the asteroid files
          small = small || await json('data/solar/small_bodies.json', signal);
          const row = small.named.find(n => n[2].toLowerCase().endsWith(' ' + ref.moonOf)); if (!row) throw new ToolError(`Can't place ${ref.moonOf}`, 'unavailable');
          const el = await asteroidElements(row, small, signal); host = j => positionAt(el, j);
        }
        at = j => { const h = host(j), o = moonOffset(ref.m, j); return { x: h.x + o.x, y: h.y + o.y, z: h.z + o.z }; };
        extra = { orbits: ref.moonOf, orbit_days: r2(moonPeriod(ref.m)), radius_km: ref.m.radius_km ?? null };
        words.push(`It circles ${ref.moonOf[0].toUpperCase() + ref.moonOf.slice(1)} every ${r2(moonPeriod(ref.m))} days.`);
      } else if (ref.craft) {
        const c = ref.craft, ph = missionPhase(c, jd), ev = eventsAround(c, jd), days = missionDays(c, jd);
        at = j => trackPosition(c, j, {}, moonCenterAt);   // a Moon orbiter on its orbit around the Moon
        extra = { status: c.status || null, agency: c.agency || null, phase: ph, launched: iso(msFromJd(c.launch_jd ?? c.t0_jd)), mission_days: Math.floor(days),
          last_event: ev.last ? { date: iso(msFromJd(ev.last[0])), what: ev.last[1] } : null, next_event: ev.next ? { date: iso(msFromJd(ev.next[0])), what: ev.next[1] } : null, about: c.desc || null };
        words.push(`${c.status ? c.status + '. ' : ''}${days >= 0 ? `Launched ${relativeTime(-days)} (${Math.floor(days).toLocaleString('en-US')} days).` : `Launches ${relativeTime(-days)}.`}${ev.last ? ` Last: ${ev.last[1]} (${relativeTime(ev.last[0] - jd)}).` : ''}${ev.next ? ` Next: ${ev.next[1]} (${relativeTime(ev.next[0] - jd)}).` : ''}`);
        if (ph === 'before launch') throw new ToolError(`${c.name} has not launched by ${iso(t).slice(0, 10)}`, 'not_found');
        if (!at(jd)) throw new ToolError(`${c.name} has no published position for ${iso(t).slice(0, 10)} (${ph})`, 'not_found');
      } else if (ref.comet) {
        const c = cometFromRow(ref.comet), n = cometNames(ref.comet[0]), P = cometPeriodYears(c);
        at = j => cometPosition(c, j, {});
        let peri = c.tp;
        if (Number.isFinite(P) && jd > c.tp) peri = c.tp + Math.ceil((jd - c.tp) / (P * 365.25)) * P * 365.25;
        extra = { designation: n.designation, class: cometClass(c), period_years: Number.isFinite(P) ? r1(P) : null, perihelion_au: r2(c.q), eccentricity: Number(c.e.toFixed(4)),
          perihelion: iso(msFromJd(peri)), perihelion_note: Number.isFinite(P) && jd > c.tp && P > 1 ? 'the next return, from its last perihelion and period (planets shift it by days to months)' : null };
        const fact = COMET_FACTS[n.designation] || COMET_FACTS[n.designation.split('/')[0]];
        words.push(`A ${cometClass(c)}${Number.isFinite(P) ? `, around the Sun every ${r1(P)} years` : ''}; perihelion ${r2(c.q)} AU from the Sun, ${jd < peri ? 'next' : 'last'} ${extra.perihelion_note ? `around ${iso(msFromJd(peri)).slice(0, 7)} (the planets' pull moves it by weeks)` : `on ${iso(msFromJd(peri)).slice(0, 10)}`}.${fact ? ' ' + fact : ''}`);
        if (!orbitFresh(c, jd)) {   // the same caveat as the Solar System view's comet card
          extra.orbit_epoch = iso(msFromJd(c.epoch)); extra.position_uncertain = true;
          words.push(`Orbit data from ${extra.orbit_epoch.slice(0, 4)}: placed two-body from then, so it may be well off its real place, and its perihelion date with it (the planets, Jupiter most, have pulled on it since).`);
        }
      } else {
        small = small || await json('data/solar/small_bodies.json', signal);
        const row = ref.asteroid, el = await asteroidElements(row, small, signal), cls = (small.classes || EMPTY)[row[5]] || null;
        at = j => positionAt(el, j, {});
        const P = el.a ** 1.5;
        extra = { class: cls, absolute_magnitude: row[3], diameter_km: row[4], orbit: { a_au: r2(el.a), e: Number(el.e.toFixed(3)), inclination_deg: r1(el.i * 180 / Math.PI), period_years: r2(P), perihelion_au: r2(el.a * (1 - el.e)), aphelion_au: r2(el.a * (1 + el.e)) } };
        const what = hit.kind === 'dwarf planet' ? 'dwarf planet' : CLASS_WORDS[cls] || 'asteroid';
        words.push(`${/^[aeiou]/i.test(what) ? 'An' : 'A'} ${what}${row[4] ? `, about ${row[4] < 10 ? r1(row[4]) : Math.round(row[4]).toLocaleString('en-US')} km across` : ''}: around the Sun every ${r2(P)} years, ${r2(el.a * (1 - el.e))} to ${r2(el.a * (1 + el.e))} AU out.`);
        // two-body from one epoch: a close pass by a planet is not modelled (Apophis's 2029 Earth flyby above all)
        const note = APOPHIS.test(row[2]) ? (jd < APOPHIS_FLYBY_JD - 1 ? APOPHIS_BEFORE : APOPHIS_AFTER)
          : cls === 'Near-Earth' && Math.abs(jd - small.epoch_jd) > 2 * 365.25 ? `A two-body estimate from its ${iso(msFromJd(small.epoch_jd)).slice(0, 4)} elements: close passes by the planets are not modelled, so this far from then it may be well off.` : null;
        if (note) { words.push(note); extra.accuracy_note = note; }
      }
      const s = stateAt(at, earth, jd);
      if (!s) throw new ToolError(`${hit.name} can't be placed at that time`, 'not_found');
      if (ref.asteroid && Number.isFinite(ref.asteroid[3])) extra.magnitude = r1(hgMagnitude(ref.asteroid[3], s.sun_au, s.earth_au, s.phase_deg));
      const figs = await json('data/constellations.json', signal).then(d => d.figures, () => null), near = figs ? nearestConstellation(s.ra, s.dec, figs) : null;
      const con = near && { ...near, name: IAU_NAMES[near.id] || near.name };
      const sky = area ? altAz({ ra: s.ra, dec: s.dec }, area.lat, area.lon, jd) : null;
      const solar = `${site}solar.html#${encodeSolarView({ focus: hit.key, jd: a.time != null ? jd : null, rate: 0 })}`;
      const self = !!ref.moon;
      const when = a.time != null ? ` on ${iso(t).replace('T', ' ').replace('Z', ' UTC')}${timeReadAs(a.time, tz)}` : ' now';
      const lead = `${hit.name} (${hit.kind})${when}: ${ref.moon ? '' : `${r2(s.sun_au)} AU from the Sun, `}${distanceWords(s.earth_au)} from Earth${self ? ', centre to centre' : ''} (${lightWords(s.light_s)}${ref.craft ? ' for its radio signal' : ''}).`;
      const motion = s.speed_km_s != null ? `Moving ${r1(s.speed_km_s)} km/s around the Sun${s.range_rate_km_s != null && !ref.moon ? `, ${s.range_rate_km_s >= 0 ? 'receding from' : 'approaching'} Earth at ${r1(Math.abs(s.range_rate_km_s))} km/s` : ''}.` : '';
      const look = `In the sky: ${formatRaDec(s)}${con ? `, ${con.sep < 3 ? 'in' : 'near'} ${con.name}` : ''}, ${Math.round(s.elongation)}° from the Sun (${skyPhrase({ elong: s.elongation, east: s.east })})${extra.magnitude != null ? `, magnitude ${extra.magnitude > 0 ? '+' : ''}${extra.magnitude}${seeingWords(extra.magnitude) ? ` (needs ${seeingWords(extra.magnitude)})` : ''}` : ''}.`;
      const local = sky ? `From ${area.label}: ${sky.alt > 0 ? `${Math.round(sky.alt)}° up in the ${compass(sky.az)}` : `below the horizon (${Math.round(sky.alt)}°, towards the ${compass(sky.az)})`}.` : '';
      const text = [lead, motion, look, local, ...words, `In the 3D Solar System: ${solar}`].filter(Boolean).join('\n');
      return { text, data: { name: hit.name, kind: hit.kind, key: hit.key, at: iso(t), sun_au: ref.moon ? null : r2(s.sun_au), earth_au: Number(s.earth_au.toPrecision(5)), earth_km: Math.round(s.earth_km),
        light_time_s: r1(s.light_s), speed_km_s: s.speed_km_s == null ? null : r2(s.speed_km_s), range_rate_km_s: s.range_rate_km_s == null ? null : r2(s.range_rate_km_s),
        ra_deg: r2(s.ra), dec_deg: r2(s.dec), constellation: con ? con.name : null, elongation_deg: r1(s.elongation), sky_side: s.east ? 'evening' : 'morning', ...extra,
        place: areaData(area), ...(sky ? { altitude_deg: r1(sky.alt), azimuth_deg: Math.round(sky.az), up: sky.alt > 0 } : {}),
        also_matching: hits.slice(1, 5).filter(h => h.score >= 400).map(h => ({ name: h.name, kind: h.kind })), url: solar,
        source: `JPL Horizons spacecraft tracks, JPL Small-Body Database elements${asOf(small) ? ` (as of ${asOf(small)})` : ''} and the Open Overwatch planet and moon maths (the website's data copies)` } };
    },
  };
}
