// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// eclipses: the coming solar eclipses (2027-2030, the website's JPL Horizons tables, data/eclipses.json): kind, when and
// where the eclipse is greatest and for how long the Sun is hidden there, and, for a place, whether it is seen there at all,
// when it starts, peaks and ends in local time and how much of the Sun is covered (src/core/eclipselocal.js). Each links
// to the globe's eclipse card, which plays the Moon's shadow across the Earth.
import { greatestEclipse, localEclipse } from '../src/core/eclipselocal.js';
import { countryAt } from '../src/core/borders.js';
import { oceanAt } from '../src/core/explain.js';
import { msFromJd } from '../src/core/time.js';
import { ToolError, derive } from './feeds.mjs';
import { preparedBorders } from './country.mjs';
import { areaProps, resolveArea, panelUrl } from './place.mjs';
import { iso, r1, coord, plural, areaData, clocks, zoneAt, limitProp } from './words.mjs';

const KIND = { total: 'Total', annular: 'Annular', partial: 'Partial' };
const dur = s => `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;

export function eclipsesTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  let borders = null;
  const whereIs = async (lat, lon, signal) => {
    if (!borders) borders = feeds.json(feeds.site('data/borders.json'), { ttl: 864e5, timeout: 60e3, signal }).then(preparedBorders, e => { borders = null; throw e; });
    const b = await borders.catch(() => null), c = b && countryAt(b, lon, lat);
    return c ? c.name : oceanAt(lat, lon);
  };

  return {
    name: 'eclipses',
    title: 'Solar eclipses',
    description: "The coming solar eclipses (2027-2030, from JPL Horizons positions of the Sun and Moon): total, annular or partial, when and where each is greatest and how long the Sun is hidden there; for a place, whether it is seen there, when it starts, peaks and ends in local time, how much of the Sun is covered and how high the Sun is. Each links to the globe's eclipse card, which plays the Moon's shadow across the Earth.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { ...areaProps(null), only_visible: { type: 'boolean', description: 'With a place: only the eclipses seen from there (default false).' }, limit: limitProp(10, 10) },
    },
    async run(a, { signal }) {
      const [d, area] = await Promise.all([feeds.json(feeds.site('data/eclipses.json'), { ttl: 864e5, timeout: 60e3, signal }), resolveArea(a, feeds, { signal })]);
      const t = ctx.now(), all = ((d && d.eclipses) || []).filter(e => Array.isArray(e.sun) && msFromJd(e.jd0) + e.sun.length * (e.step_s || 60) * 1000 > t);
      if (!all.length) throw new ToolError('No upcoming eclipses in the website\'s tables (they run 2027-2030)', 'not_found');
      const tz = area ? await zoneAt(ctx, area.lat, area.lon, signal) : null, c = clocks(tz);
      const rows = [];
      for (const e of all) {
        const g = derive(e, 'greatest', greatestEclipse), place = await whereIs(g.lat, g.lon, signal);
        const here = area ? localEclipse(e, area.lat, area.lon) : null;
        if (a.only_visible && area && !here) continue;
        rows.push({ date: e.date, kind: e.type, greatest: { at: iso(g.at), lat: r1(g.lat), lon: r1(g.lon), where: place, duration_s: g.duration_s, path_width_km: g.width_km ? Math.round(g.width_km) : null, sun_altitude_deg: r1(g.sun_alt), magnitude: g.magnitude != null ? Math.round(g.magnitude * 1000) / 1000 : null },
          here: area ? (here ? { seen: true, kind: here.kind, covered_percent: Math.round(here.covered * 1000) / 10, magnitude: Math.round(here.magnitude * 1000) / 1000, start: iso(here.start), max: iso(here.max), end: iso(here.end),
            start_local: here.start != null ? c.full(here.start) : null, max_local: c.full(here.max), end_local: here.end != null ? c.full(here.end) : null, central_s: here.central_s, sun_altitude_deg: r1(here.sun_alt),
            rises_eclipsed: here.rises_eclipsed, sets_eclipsed: here.sets_eclipsed } : { seen: false }) : undefined, url: panelUrl(site, 'eclipses', e.date) });
        if (rows.length >= (a.limit || 10)) break;
      }
      const lines = rows.map(r => {
        const g = r.greatest, h = r.here;
        const head = `${r.date}: ${KIND[r.kind]} eclipse, greatest at ${g.at.slice(11, 16)} UTC over ${g.where} (${coord(g.lat, g.lon)})${g.duration_s ? `, the Sun hidden for ${dur(g.duration_s)} there${g.path_width_km ? ` in a path ${g.path_width_km} km wide` : ''}` : g.magnitude ? `, ${Math.round(g.magnitude * 100)}% of the Sun's width covered there` : ''}.`;
        if (!h) return head;
        if (!h.seen) return `${head} Not seen from ${area.label}.`;
        const what = h.kind === 'total' ? `total there for ${dur(h.central_s)}` : h.kind === 'annular' ? `annular there (a ring of Sun) for ${dur(h.central_s)}` : `partial there: ${h.covered_percent}% of the Sun covered`;
        return `${head} From ${area.label}: ${what}, greatest ${h.max_local} with the Sun ${h.sun_altitude_deg < 1 ? 'on the horizon' : `${Math.round(h.sun_altitude_deg)}° up`}; ${h.rises_eclipsed ? `the Sun rises already eclipsed (${h.start_local})` : `starts ${h.start_local}`}, ${h.sets_eclipsed ? `the Sun sets still eclipsed (${h.end_local})` : `ends ${h.end_local}`}.`;
      });
      const seen = area ? rows.filter(r => r.here.seen).length : null;
      const top = area ? `${plural(rows.length, 'solar eclipse')} from now to 2030${a.only_visible ? ' seen' : ''}; ${seen} of them seen from ${area.label} (times ${tz || 'UTC'}):` : `${plural(rows.length, 'solar eclipse')} from now to 2030:`;
      const url = rows[0] ? rows[0].url : panelUrl(site, 'eclipses');
      return { text: [top, ...lines, 'Never look at the Sun without eclipse glasses, except during totality itself.', `The Moon's shadow on the globe: ${url}`].join('\n'),
        data: { eclipses: rows, place: areaData(area), timezone: tz, url, source: 'JPL Horizons (the website\'s data/eclipses.json); the Open Overwatch eclipse geometry' } };
    },
  };
}
