// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// sun_and_moon: the day at a place: sunrise, sunset, solar noon and how long the day is, the twilights (civil, nautical,
// astronomical), the golden and blue hours for photographs, and the Moon's rise, set and phase, in the place's time zone;
// for any date 1800-2050 (the website's own sky maths, src/core/sky.js: a minute or so).
import { riseSet, sunAlt, moonPhase, nextFullMoon, bodyRaDec, altAz } from '../src/core/sky.js';
import { jdFromMs } from '../src/core/time.js';
import { compass } from '../src/core/passes.js';
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea, frame, globeUrl } from './place.mjs';
import { iso, r1, areaData, clocks, zoneAt } from './words.mjs';

const hm = ms => { const m = Math.round(ms / 60e3); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };

/** The local calendar day (00:00 to 24:00 in the zone) that holds `ms`: its start in UTC ms. */
function dayStart(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return ms - (((+p.hour % 24) * 60 + +p.minute) * 60 + +p.second) * 1000 - (ms % 1000);
}

export function sunTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'sun_and_moon',
    title: 'Sunrise, sunset, twilight and the Moon',
    description: "The day at a place, in its own time zone: sunrise and sunset (and the direction of each), solar noon and the Sun's height then, day length and how it is changing, civil, nautical and astronomical twilight, the golden and blue hours for photographs, and the Moon's rise, set and phase. Any date from 1800 to 2050 (default today).",
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps(null), date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'A day, YYYY-MM-DD (default today there).' } } },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, signal }), lat = area.lat, lon = area.lon;
      const tz = await zoneAt(ctx, lat, lon, signal), c = clocks(tz);
      let t0 = dayStart(ctx.now(), tz);
      if (a.date) { const d = Date.parse(a.date + 'T12:00:00Z'); if (!Number.isFinite(d) || new Date(d).toISOString().slice(0, 10) !== a.date || d < Date.UTC(1800, 0, 2) || d > Date.UTC(2049, 11, 30)) throw new ToolError('date must be a real day between 1800 and 2049 (YYYY-MM-DD)', 'invalid_arguments'); t0 = dayStart(d, tz); }
      const one = (key, h0) => riseSet(key, lat, lon, t0, { h0, hours: 24, step: 5 * 60e3 });
      const sun = one('sun', -0.833), civ = one('sun', -6), nau = one('sun', -12), ast = one('sun', -18), gold = one('sun', 6), blue = one('sun', -4), moon = riseSet('moon', lat, lon, t0, { h0: 0.125, hours: 24, step: 5 * 60e3 });
      // solar noon: the Sun's highest that day (to the minute)
      let noon = t0, top = -90;
      for (let t = t0; t < t0 + 864e5; t += 5 * 60e3) { const h = sunAlt(lat, lon, t); if (h > top) { top = h; noon = t; } }
      for (let t = noon - 5 * 60e3; t <= noon + 5 * 60e3; t += 30e3) { const h = sunAlt(lat, lon, t); if (h > top) { top = h; noon = t; } }
      const len = (r, up) => (r.rise != null && r.set != null ? (r.set > r.rise ? r.set - r.rise : 864e5 - (r.rise - r.set)) : up === true ? 864e5 : up === false ? 0 : null);
      const dayLen = len(sun, sun.up), next = riseSet('sun', lat, lon, t0 + 864e5, { h0: -0.833, hours: 24, step: 5 * 60e3 }), lenNext = len(next, next.up);
      const az = ms => compass(altAz(bodyRaDec('sun', jdFromMs(ms)), lat, lon, jdFromMs(ms)).az);
      const f = ms => (ms != null ? c.hm(ms) : null);
      const out = [`${c.date(t0 + 12 * 3600e3)} at ${area.label} (${tz || 'UTC'}):`];
      if (sun.up === true) out.push('The Sun does not set today (midnight sun).'); else if (sun.up === false) out.push('The Sun does not rise today (polar night).');
      else out.push(`Sunrise ${f(sun.rise) || '-'}${sun.rise ? ` in the ${az(sun.rise)}` : ''}, sunset ${f(sun.set) || '-'}${sun.set ? ` in the ${az(sun.set)}` : ''}; the day is ${hm(dayLen)} long${lenNext != null && dayLen != null ? `, ${Math.abs(Math.round((lenNext - dayLen) / 60e3)) < 1 ? 'the same tomorrow' : `${Math.abs(Math.round((lenNext - dayLen) / 60e3))} min ${lenNext > dayLen ? 'longer' : 'shorter'} tomorrow`}` : ''}.`);
      out.push(`Solar noon ${f(noon)}, the Sun ${Math.round(top)}° up.`);
      const tw = (name, r) => (r.rise || r.set ? `${name} ${f(r.rise) || '-'} to ${f(r.set) || '-'}` : r.up === true ? `${name}: all day` : `${name}: not today`);
      out.push(`Light (dawn to dusk): ${tw('civil twilight', civ)}; ${tw('nautical', nau)}; ${tw('astronomical', ast)}.`);
      if (sun.up === true && (gold.rise || gold.set)) out.push(`Golden light all night: the Sun stays under 6° from ${f(gold.set) || '-'} to ${f(gold.rise) || '-'}.`);
      else if (sun.up !== false && (gold.rise || gold.set)) {
        const b = [blue.rise && civ.rise && `${f(civ.rise)} to ${f(blue.rise)}`, blue.set && civ.set && `${f(blue.set)} to ${f(civ.set)}`].filter(Boolean);
        out.push(`Golden hour: from sunrise to ${f(gold.rise) || '-'} and from ${f(gold.set) || '-'} to sunset${b.length ? `; blue hour ${b.join(' and ')}` : ''}.`);
      }
      const ph = moonPhase(t0 + 12 * 3600e3), full = nextFullMoon(t0);
      out.push(`Moon: ${ph.name.toLowerCase()}, ${Math.round(ph.lit * 100)}% lit${moon.rise ? `, rises ${f(moon.rise)}` : ''}${moon.set ? `, sets ${f(moon.set)}` : ''}${moon.up === true ? ', up all day' : moon.up === false ? ', below the horizon all day' : ''}; next full Moon ${c.full(full.at)} (the ${full.name}).`);
      const url = globeUrl(site, { camera: frame(lat, lon, 2500), on: ['sun'], time: { ms: sun.set || noon, rate: 60 } });
      out.push(`The day and night line on the globe at ${sun.set ? 'sunset' : 'noon'} (a minute a second): ${url}`);
      const pair = r => ({ start: iso(r.rise), end: iso(r.set), start_local: f(r.rise), end_local: f(r.set) });
      return { text: out.join('\n'), data: { place: areaData(area), timezone: tz, date: new Date(t0 + 12 * 3600e3).toISOString().slice(0, 10),
        sunrise: iso(sun.rise), sunset: iso(sun.set), sunrise_local: f(sun.rise), sunset_local: f(sun.set), day_length_min: dayLen != null ? Math.round(dayLen / 60e3) : null,
        change_tomorrow_min: lenNext != null && dayLen != null ? Math.round((lenNext - dayLen) / 60e3) : null, polar: sun.up === true ? 'midnight sun' : sun.up === false ? 'polar night' : null,
        solar_noon: iso(noon), solar_noon_local: f(noon), noon_altitude_deg: r1(top), civil_twilight: pair(civ), nautical_twilight: pair(nau), astronomical_twilight: pair(ast),
        golden_hour: { morning_end: iso(gold.rise), evening_start: iso(gold.set) }, blue_hour: { morning: [iso(civ.rise), iso(blue.rise)], evening: [iso(blue.set), iso(civ.set)] },
        moon: { phase: ph.name, lit_percent: Math.round(ph.lit * 100), rise: iso(moon.rise), set: iso(moon.set), next_full: iso(full.at), next_full_name: full.name }, url, source: 'the Open Overwatch sky maths (src/core/sky.js)' } };
    },
  };
}
