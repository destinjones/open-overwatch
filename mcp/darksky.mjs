// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// dark_sky: how dark the sky is at a place (the 2015 World Atlas of artificial sky brightness, Falchi et al. 2016, CC BY-NC
// 4.0, non-commercial, as the website's 1/15° grid data/lightpollution.bin): the Bortle class, the SQM reading, what that
// means for the eye, the nearest darker sky and which way; tonight's quality from the sky, the Moon and Open-Meteo's
// cloud forecast; and the deep-sky objects (OpenNGC, CC-BY-SA-4.0, data/deepsky.json) that eyes, binoculars or a small
// telescope can find there tonight. The maths and the words are the website's (src/core/darksky.js).
import { ToolError, derive } from './feeds.mjs';
import { preparedBorders } from './country.mjs';
import { areaProps, resolveArea, frame, globeUrl } from './place.mjs';
import { iso, areaData, clocks, r2 } from './words.mjs';
import { provenance, provenanceText } from '../src/core/provenance.js';
import { decodeAtlas, skyAt } from '../src/core/lightpollution.js';
import { parseDeepsky } from '../src/core/deepsky.js';
import { countryAt } from '../src/core/borders.js';
import { darkWindow } from '../src/core/sky.js';
import { hoursOf, night } from '../src/core/clouds.js';
import { skyWords, nearestDarker, darkText, moonOver, tonightQuality, deepSkyTonight, gearLimits, GEAR, ATLAS_CREDIT, NGC_CREDIT } from '../src/core/darksky.js';

const METEO = 'https://api.open-meteo.com/v1/forecast';
const DAY = 864e5;

export function darkSkyTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  const memo = (f, k = { p: null }) => signal => k.p || (k.p = f(signal).catch(e => { k.p = null; throw e; }));
  const atlas = memo(async signal => derive(await feeds.bytes(feeds.site('data/lightpollution.bin'), { ttl: 7 * DAY, timeout: 90e3, maxBytes: 4e6, signal }), 'atlas', r => decodeAtlas(r.bytes)));
  const catalogue = memo(async signal => derive(await feeds.json(feeds.site('data/deepsky.json'), { ttl: 7 * DAY, signal }), 'deepsky', parseDeepsky));
  const borders = memo(async signal => preparedBorders(await feeds.json(feeds.site('data/borders.json'), { ttl: DAY, timeout: 60e3, signal })));
  return {
    name: 'dark_sky',
    title: 'Dark sky: light pollution and deep-sky objects tonight',
    description: "How dark the night sky is at a place, from the World Atlas of artificial sky brightness (Falchi et al. 2016): the Bortle class (1 pristine to 9 inner city), the sky brightness as a Sky Quality Meter reading, whether the Milky Way shows and about how many stars, and the nearest darker sky (Bortle 3 or better) with its distance and direction. Also how good tonight is (the sky, the Moon and the cloud forecast together), and the galaxies, star clusters and nebulae (Messier, NGC and IC, from OpenNGC) well placed tonight that the eye, binoculars or a small telescope can find under that sky, each with when it is highest, how high and which way to look.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps(null),
      gear: { type: 'string', enum: Object.keys(GEAR), description: 'What the observer uses: eyes (default), binoculars or scope (a small telescope, 80-130 mm).' },
      limit: { type: 'integer', minimum: 1, maximum: 30, description: 'How many deep-sky objects to list (default 12, at most 30).' } } },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, signal }), lat = area.lat, lon = area.lon, t = ctx.now(), gear = a.gear || 'eyes', limit = a.limit || 12;
      const [g, cat, met] = await Promise.all([
        atlas(signal).catch(e => { throw new ToolError(`The light pollution grid didn't load from the website (${e.message})`, 'unavailable'); }),
        catalogue(signal).catch(() => null),
        feeds.json(`${METEO}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&timezone=auto&forecast_days=3&hourly=cloud_cover,precipitation_probability&timeformat=unixtime`, { ttl: 30 * 60e3, signal }).catch(() => null)]);
      const tz = met && met.timezone, c = clocks(tz), sky = skyAt(g, lat, lon), minLeft = 45 * 60e3, win = darkWindow(lat, lon, t, { minLeft });
      const url = globeUrl(site, { camera: frame(lat, lon, 250), on: ['lightpollution'] });
      const out = [], data = { place: areaData(area), timezone: tz || null, gear };
      if (!sky) out.push(`${area.label} is outside the light pollution atlas (it covers 60°S to 85°N).`);
      else {
        const w = skyWords(sky), land = await borders(signal).then(b => (la, lo) => !!countryAt(b, lo, la), () => null);
        const dark = nearestDarker(g, lat, lon, { land });
        out.push(`${area.label}: ${w.text}`, darkText(dark));
        data.sky = { bortle: w.bortle, class_name: w.name, sqm_mag_arcsec2: r2(w.sqm), artificial_mcd_m2: +sky.artificial.toPrecision(3), times_natural: r2(1 + sky.ratio), naked_eye_limit_mag: +w.nelm.toFixed(1), stars_visible: w.stars, milky_way: w.milkyWay, words: w.text };
        data.nearest_dark = dark ? (dark.here ? { here: true, bortle: dark.bortle } : { lat: dark.lat, lon: dark.lon, km: Math.round(dark.km), bearing_deg: Math.round(dark.bearing), direction: dark.dir, bortle: dark.bortle, sqm_mag_arcsec2: r2(dark.sqm), only_bortle_4: !!dark.fallback,
          url: globeUrl(site, { camera: frame(dark.lat, dark.lon, 60), on: ['lightpollution'] }) }) : null;
      }
      let q = null;
      if (win) {
        const moon = moonOver(lat, lon, win), hours = met ? hoursOf(met) : [], clouds = hours.length ? night(hours, Math.max(win.start, t), win.end, { time: c.hm }) : null;
        q = tonightQuality({ sky, moon, clouds, time: c.hm });
        out.push(`${q.text} Dark from ${c.full(win.start)} to ${c.hm(win.end)}.`);
        data.tonight = { quality: q.word, score: r2(q.score), effective_sqm: r2(q.sqm), dark_from: iso(win.start), dark_until: iso(win.end), moon_lit_percent: Math.round(moon.lit * 100), moon_up_hours: +moon.upHours.toFixed(1), moonless_hours: +moon.moonless.toFixed(1),
          cloud_percent: clouds ? clouds.mean : null, clouds: clouds ? clouds.text : null, words: q.text };
      } else out.push('No dark sky here in the next day (polar day or summer twilight), so no deep-sky list.');
      if (win && cat) {
        const sqm = sky ? q.sqm : 21.5, lim = gearLimits(gear, sqm), list = deepSkyTonight(cat, lat, lon, t, { gear, sqm, minLeft, limit: 30 });
        out.push(list.length ? `Deep sky tonight with ${GEAR[gear].label.toLowerCase()} (to about magnitude ${lim.maxMag.toFixed(1)}), ${list.length >= 30 ? '30 or more' : list.length} well placed:` : `No deep-sky object within reach of ${GEAR[gear].label.toLowerCase()} is well placed tonight.`);
        for (const v of list.slice(0, limit)) out.push(`- ${v.label}: ${v.text}. Highest ${c.hm(v.best)}, ${Math.round(v.alt)}° up in the ${v.dir}.`);
        data.deep_sky = list.slice(0, limit).map(v => ({ id: v.obj.id, messier: v.obj.m, name: v.obj.name, label: v.label, type: v.obj.type, constellation: v.obj.con, mag: v.obj.mag, size_arcmin: v.obj.maj, ra_deg: v.obj.ra, dec_deg: v.obj.dec,
          highest: iso(v.best), highest_local: c.full(v.best), altitude_deg: Math.round(v.alt), azimuth_deg: Math.round(v.az), direction: v.dir, above_25_from: iso(v.from), above_25_until: iso(v.to), text: v.text }));
        data.limits = { max_mag: +lim.maxMag.toFixed(1), max_surface_brightness: +lim.maxSb.toFixed(1) };
      } else if (win) out.push('The deep-sky catalogue did not load from the website this time.');
      out.push(`Light pollution around the place on the globe: ${url}`, `Sources: ${ATLAS_CREDIT}; ${NGC_CREDIT}; clouds from Open-Meteo.com (CC BY 4.0).`);
      data.provenance = provenanceText(provenance([{ id: 'falchi2016', name: 'Falchi et al. 2016 World Atlas', dataAt: Date.UTC(2015, 0, 1) }, { id: 'openngc', name: 'OpenNGC v20260501', dataAt: Date.UTC(2026, 4, 1) }], { now: t, maxAgeMs: 30 * 365.25 * DAY }));
      data.url = url; data.source = `${ATLAS_CREDIT}; ${NGC_CREDIT}`;
      return { text: out.join('\n'), data };
    },
  };
}
