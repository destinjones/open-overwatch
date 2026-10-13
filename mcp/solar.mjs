// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// solar_system: where the planets are and whether you can see them: distance from the Sun and from us (and how old their
// light is), angle from the Sun, phase and brightness, the next oppositions, conjunctions and greatest elongations, and,
// for a place, where each is in its sky now and when it rises and sets; plus the Moon and close meetings in the sky. All
// computed here from the website's own sky maths (src/core/planets.js, sky.js, solarsys.js): no network except the place.
import { planetFromEarth, moonFromEarth, skyEvents, visibility, SKY_PLANETS } from '../src/core/solarsys.js';
import { bodyRaDec, altAz, riseSet, moonPhase, nextFullMoon, meetings, sunAlt } from '../src/core/sky.js';
import { jdFromMs, msFromJd } from '../src/core/time.js';
import { VALID_JD } from '../src/core/planets.js';
import { compass } from '../src/core/passes.js';
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea, frame, globeUrl, panelUrl } from './place.mjs';
import { iso, r1, r2, areaData, clocks, zoneAt } from './words.mjs';

const BODIES = ['all', ...SKY_PLANETS, 'moon'];
const lightAge = min => (min < 1 ? `${Math.round(min * 60)} light-seconds` : min < 90 ? `${r1(min)} light-minutes` : `${r1(min / 60)} light-hours`);
/** "; sets …; rises …" in the order they happen (or up / down all day). */
const riseSetWords = s => {
  const ev = [s.rise_utc && ['rises', s.rise_utc, s.rises], s.set_utc && ['sets', s.set_utc, s.sets]].filter(Boolean).sort((x, y) => Date.parse(x[1]) - Date.parse(y[1]));
  return ev.map(([w, , local]) => `; ${w} ${local}`).join('') + (s.always ? `; ${s.always}` : '');
};
const mag = m => (m < 0 ? `magnitude ${m.toFixed(1)}` : `magnitude +${m.toFixed(1)}`);

export function solarTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'solar_system',
    title: 'The planets: where they are and how to see them',
    description: "Where the planets (and the Moon) are now or at a given time: distance from the Sun and from Earth, how long their light takes to reach us, how far from the Sun they appear (evening or morning sky), phase, brightness (magnitude), Saturn's ring tilt, and each planet's next opposition, conjunction or greatest elongation; with a place, where each is in that sky now (altitude, direction) and when it rises and sets in local time, and close meetings of the Moon and planets in the coming month. Computed from JPL's planetary elements (valid 1800-2050). Links open the 3D Solar System on the planet and the globe's tonight panel.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        body: { type: 'string', enum: BODIES, description: 'One planet, the moon, or all (default all).' },
        ...areaProps(null),
        time: { type: 'string', maxLength: 40, description: 'A moment, ISO 8601 (default now). Between 1800 and 2050.' },
      },
    },
    async run(a, { signal }) {
      let t = ctx.now();
      if (a.time != null) { t = Date.parse(a.time); if (!Number.isFinite(t)) throw new ToolError('time must be an ISO 8601 date, e.g. 2026-12-25T21:00:00Z', 'invalid_arguments'); }
      const jd = jdFromMs(t);
      if (jd < VALID_JD[0] || jd > VALID_JD[1] - 800) throw new ToolError('The planet tables are good from 1800 to 2050 (and the look-ahead needs two years before 2050)', 'invalid_arguments');
      const area = await resolveArea(a, feeds, { signal }), body = a.body || 'all';
      const tz = area ? await zoneAt(ctx, area.lat, area.lon, signal) : null, c = clocks(tz);
      const keys = body === 'all' ? SKY_PLANETS : body === 'moon' ? [] : [body];
      const sky = key => {   // where it is in the place's sky, and when it rises and sets
        if (!area) return null;
        const h = altAz(bodyRaDec(key, jd), area.lat, area.lon, jd), rs = riseSet(key, area.lat, area.lon, t);
        return { altitude_deg: r1(h.alt), direction: compass(h.az), azimuth_deg: Math.round(h.az), up: h.alt > 0, rises: rs.rise ? c.full(rs.rise) : null, sets: rs.set ? c.full(rs.set) : null,
          rise_utc: iso(rs.rise), set_utc: iso(rs.set), always: rs.up === true ? 'up all day' : rs.up === false ? 'below the horizon all day' : null };
      };
      const planets = keys.map(key => {
        const p = planetFromEarth(key, jd), ev = skyEvents(key, jd, body === 'all' ? 420 : 800).slice(0, body === 'all' ? 1 : 4);
        return { key, name: p.name, sun_au: r2(p.sun_au), earth_au: r2(p.earth_au), earth_million_km: r1(p.earth_km / 1e6), light: lightAge(p.light_min), light_minutes: r1(p.light_min),
          elongation_deg: r1(p.elongation), sky_side: p.side, phase_lit_percent: Math.round(p.lit * 100), magnitude: r1(p.magnitude), apparent_size_arcsec: r1(p.size_arcsec),
          ...(p.ring_tilt != null ? { ring_tilt_deg: r1(p.ring_tilt) } : {}), visibility: visibility(p),
          next: ev.map(e => ({ event: e.kind, date: iso(msFromJd(e.jd)), elongation_deg: r1(e.elongation) })), sky: sky(key), solar_url: `${site}solar.html?focus=${key}` };
      });
      const out = [], data = { at: iso(t), place: areaData(area), timezone: tz };
      const when = a.time != null ? ` on ${c.full(t)}` : ' now';
      if (planets.length) {
        out.push(area ? `The planets from ${area.label}${when} (times ${tz || 'UTC'}):` : `The planets${when}:`);
        for (const p of planets) {
          const s = p.sky, nxt = p.next[0];
          out.push(`${p.name}: ${p.earth_million_km.toLocaleString('en-US')} million km away (${p.light}), ${p.elongation_deg}° from the Sun in the ${p.sky_side} sky, ${mag(p.magnitude)}${p.key === 'venus' || p.key === 'mercury' ? `, ${p.phase_lit_percent}% lit` : ''}${p.ring_tilt_deg != null ? `, rings tilted ${Math.abs(p.ring_tilt_deg)}°` : ''}: ${p.visibility}.`
            + (s ? ` ${s.up ? `Up now, ${Math.round(s.altitude_deg)}° high in the ${s.direction}` : `Below the horizon now`}${riseSetWords(s)}.` : '')
            + (nxt ? ` Next ${nxt.event}: ${nxt.date.slice(0, 10)}.` : '')
            + (body !== 'all' && p.next.length > 1 ? ` Then: ${p.next.slice(1).map(e => `${e.event} ${e.date.slice(0, 10)}`).join('; ')}.` : ''));
        }
        data.planets = planets;
      }
      if (body === 'all' || body === 'moon') {
        const m = moonFromEarth(jd), ph = moonPhase(t), full = nextFullMoon(t), s = sky('moon');
        out.push(`The Moon: ${ph.name.toLowerCase()}, ${Math.round(ph.lit * 100)}% lit, ${Math.round(m.earth_km).toLocaleString('en-US')} km away (${r2(m.light_s)} light-seconds). Next full Moon: ${c.full(full.at)}, the ${full.name}${full.supermoon ? ' (a supermoon)' : ''}.`
          + (s ? ` ${s.up ? `Up now, ${Math.round(s.altitude_deg)}° high in the ${s.direction}` : 'Below the horizon now'}${riseSetWords(s)}.` : ''));
        data.moon = { phase: ph.name, lit_percent: Math.round(ph.lit * 100), waxing: ph.waxing, earth_km: Math.round(m.earth_km), next_full: { at: iso(full.at), name: full.name, supermoon: full.supermoon }, sky: s };
      }
      if (body === 'all') {
        const mt = meetings(t, { days: 30 }).filter(x => x.elong > 15).slice(0, 6);
        if (mt.length) out.push(`Close meetings in the sky (next 30 days): ${mt.map(x => `${x.a} and ${x.b} ${r1(x.sep)}° apart, ${c.date(x.at)}`).join('; ')}.`);
        data.meetings = mt.map(x => ({ at: iso(x.at), a: x.a, b: x.b, separation_deg: r1(x.sep), from_sun_deg: r1(x.elong) }));
      }
      if (area) { const sun = sunAlt(area.lat, area.lon, t); data.sun_altitude_deg = r1(sun); out.push(sun < -12 ? 'It is dark there now.' : sun < 0 ? 'It is twilight there now.' : 'The Sun is up there now: the planets wait for dusk (Venus and Jupiter can show in daylight if you know where to look).'); }
      const url = area ? globeUrl(site, { camera: frame(area.lat, area.lon, 900), on: ['stations', 'visual'], time: a.time != null ? { ms: t, rate: 60 } : null }) : panelUrl(site, 'tonight');
      const solar = `${site}solar.html${keys.length === 1 ? `?focus=${keys[0]}` : ''}`;
      out.push(`The Solar System in 3D: ${solar}`, area ? `The sky over ${area.label} on the globe: ${url}` : `Tonight's sky for where you are, on the globe: ${url}`);
      return { text: out.join('\n'), data: { ...data, url, solar_url: solar, source: "JPL approximate planetary elements (E. M. Standish), Meeus's magnitudes; the Open Overwatch sky maths" } };
    },
  };
}
