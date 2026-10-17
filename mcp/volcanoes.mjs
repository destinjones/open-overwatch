// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// volcanoes: the volcanoes nearest a place (the website's Wikidata list, data/volcanoes.json, the same the globe's volcano
// layer draws), with what is happening at them now: an eruption NASA EONET has open, and this week's earthquakes nearby
// (USGS). Heights are left out: the list mixes metres and feet.
import { ToolError } from './feeds.mjs';
import { areaProps, resolveArea, distKm, frame, frameArea, globeUrl } from './place.mjs';
import { loadQuakes, loadEvents } from './hazards.mjs';
import { r1, r2, km, ago, plural, areaData, limitProp, take } from './words.mjs';

export function volcanoesTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  return {
    name: 'volcanoes',
    title: 'Volcanoes near a place',
    description: "The volcanoes nearest a place, or in an area (Wikidata's list of about 2,500, the one the globe draws): name, kind, country and distance, with what is going on there now: an eruption NASA's EONET has open, and earthquakes within 30 km this week (USGS). Its link opens the globe's volcano layer there.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { ...areaProps('to look (default 300 km around a point; the place\'s own size for a region)'), erupting_only: { type: 'boolean', description: 'Only volcanoes with an eruption NASA EONET has open (default false).' }, limit: limitProp(10, 40) },
    },
    async run(a, { signal }) {
      const [d, area, events, quakes] = await Promise.all([feeds.json(feeds.site('data/volcanoes.json'), { ttl: 864e5, timeout: 60e3, signal }), resolveArea(a, feeds, { need: true, pointKm: 300, signal }),
        loadEvents(feeds, { days: 60, category: 'volcanoes', signal, now: ctx.now() }).catch(() => null), loadQuakes(feeds, { min: 2.5, period: 'week', signal, now: ctx.now() }).catch(() => null)]);
      const cols = (d && d.cols) || [], ix = k => cols.indexOf(k);
      const [iN, iLat, iLon, iC, iT, iW] = ['name', 'lat', 'lon', 'country', 'type', 'wiki'].map(ix);
      if (iN < 0 || iLat < 0 || iLon < 0) throw new ToolError('The volcano list came back in an unexpected shape', 'unavailable');
      const box = area.bbox && area.radiusKm > 150 ? area.bbox : null, t = ctx.now();   // a country or region: inside it; a town: around it (Vesuvius is not in Naples)
      const radius = box ? null : Math.max(area.radiusKm, area.kind === 'point' ? 0 : 60);
      const inside = (lat, lon) => (box ? (() => { const [w, s, e, n] = box; return lat >= s && lat <= n && (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e); })() : distKm(area, lat, lon) <= radius);
      /** @type {any[]} */ const list = [];
      for (const r of (d && d.rows) || []) {
        const lat = +r[iLat], lon = +r[iLon]; if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inside(lat, lon)) continue;
        list.push({ name: String(r[iN] || 'Volcano').replace(/\s+/g, ' ').trim(), lat, lon, country: iC >= 0 && r[iC] ? String(r[iC]) : null, type: iT >= 0 && r[iT] ? String(r[iT]) : null, wiki: iW >= 0 && /^Q\d+$/.test(r[iW] || '') ? r[iW] : null, km: distKm(area, lat, lon) });
      }
      const near = (lat, lon, list2, k) => (list2 || []).filter(x => Math.abs(x.lat - lat) < 1 && distKm({ lat, lon }, x.lat, x.lon) <= k);
      for (const v of list) {
        const ev = near(v.lat, v.lon, events, 25);
        v.eruption = ev.length ? { title: ev[0].title, since: ev[0].latest, source: ev[0].sources[0] || ev[0].link || null, provenance: ev[0].provenance || null } : null;
        const q = near(v.lat, v.lon, quakes, 30);
        v.quakes = q.length ? { count: q.length, strongest: Math.max(...q.map(x => x.magnitude)), latest: Math.max(...q.map(x => x.t)) } : null;
      }
      if (a.erupting_only && !events) throw new ToolError("NASA EONET did not answer, so eruptions can't be listed; try again in a few minutes", 'unavailable');   // not "none erupting"
      // around a point: erupting first, then the nearest; in a region (no centre that means anything): erupting, then the restless, then by name
      let rows = list.sort((x, y) => (+!!y.eruption - +!!x.eruption) || (box ? ((y.quakes ? y.quakes.count : 0) - (x.quakes ? x.quakes.count : 0)) || x.name.localeCompare(y.name) : x.km - y.km));
      if (a.erupting_only) rows = rows.filter(v => v.eruption);
      const shown = take(rows, a.limit || 10);
      const where = box ? `in ${area.label}` : `within ${km(radius)} of ${area.label}`;
      const head = rows.length ? `${plural(rows.length, a.erupting_only ? 'erupting volcano' : 'volcano', a.erupting_only ? 'erupting volcanoes' : 'volcanoes')} ${where}${rows.length > shown.length ? ` (${box ? `erupting ones first, then those with earthquakes nearby; ${shown.length} listed` : `${a.erupting_only ? 'the nearest' : 'erupting ones first, then the nearest'} ${shown.length}`})` : ''}:`
        : `No ${a.erupting_only ? 'erupting ' : ''}volcanoes ${where}${a.erupting_only ? ' that NASA EONET has open' : ' in the list'}.`;
      const lines = shown.map(v => `${v.name}${v.type ? ` (${v.type})` : ''}${v.country ? `, ${v.country}` : ''}${box ? '' : ` · ${km(v.km)} away`}${v.eruption ? ` · ERUPTING: ${v.eruption.title}` : ''}${v.quakes ? ` · ${plural(v.quakes.count, 'earthquake')} M2.5+ within 30 km this week (strongest M${v.quakes.strongest}, latest ${ago(v.quakes.latest, t)})` : ''}`);
      const camera = shown.length === 1 ? frame(shown[0].lat, shown[0].lon, 30, { tilt: 55 }) : frameArea(box ? area : { ...area, bbox: null, frameLat: null, frameLon: null, radiusKm: radius });
      const url = globeUrl(site, { camera, on: ['volcanoes', 'quakes'] });
      const missing = `${events ? '' : '(NASA EONET did not answer: eruptions are not marked.) '}${quakes ? '' : '(USGS did not answer: earthquakes are not counted.) '}`;
      return { text: [head, ...lines, `${missing}Volcanoes on the globe: ${url}`].join('\n'),
        data: { total: rows.length, eruptions_known: !!events, quakes_known: !!quakes, volcanoes: shown.map(v => ({ name: v.name, type: v.type, country: v.country, lat: r2(v.lat), lon: r2(v.lon), distance_km: r1(v.km), eruption: v.eruption, quakes_week: v.quakes && { ...v.quakes, latest: new Date(v.quakes.latest).toISOString() },
          wikidata: v.wiki ? `https://www.wikidata.org/wiki/${v.wiki}` : null })), area: areaData(area), url, source: 'Wikidata (CC0) via the Open Overwatch website; NASA EONET; USGS' } };
    },
  };
}
