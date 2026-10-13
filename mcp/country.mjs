// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// country_briefing: one country in a page, what the globe's country card knows plus what is happening there now: its facts
// (Wikidata, World Bank: the website's data/countries.json), its size from its outline (data/borders.json, simplified, so
// "about"), this week's earthquakes in it and off its coast (USGS), NASA EONET's open events in it, tropical cyclones near
// it (NOAA NHC, GDACS) and the weather in its capital now (Open-Meteo).
import { prepare, inCountry, countryAt, mainBox } from '../src/core/borders.js';
import { multiPolygonArea } from '../src/core/measure.js';
import { weatherSentence } from '../src/core/voicecmd.js';
import { ToolError } from './feeds.mjs';
import { geocode, frame, globeUrl } from './place.mjs';
import { loadQuakes, loadStorms, loadEvents } from './hazards.mjs';
import { coord, big, ago, utc } from './words.mjs';

const METEO = 'https://api.open-meteo.com/v1/forecast';
const flag = iso => String.fromCodePoint(...[...iso].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ALIAS = { usa: 'US', 'united states of america': 'US', america: 'US', uk: 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', russia: 'RU', 'south korea': 'KR', 'north korea': 'KP',
  korea: 'KR', 'czech republic': 'CZ', czechia: 'CZ', holland: 'NL', 'the netherlands': 'NL', 'ivory coast': 'CI', burma: 'MM', 'east timor': 'TL', 'vatican': 'VA', 'uae': 'AE', 'drc': 'CD', 'dr congo': 'CD',
  'congo kinshasa': 'CD', 'congo brazzaville': 'CG', swaziland: 'SZ', 'cape verde': 'CV', macedonia: 'MK', turkey: 'TR', turkiye: 'TR', iran: 'IR', syria: 'SY', laos: 'LA', vietnam: 'VN', bolivia: 'BO', venezuela: 'VE', tanzania: 'TZ', moldova: 'MD' };

/**
 * Which country a name means: ISO alpha-2 or alpha-3 codes, the name (accents and case ignored), a few common short names,
 * else the one whose name starts with or contains it. facts: countries.json's countries. Returns the ISO code or null.
 */
export function findCountry(facts, q) {
  const s = String(q || '').trim(); if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s) && facts[s.toUpperCase()]) return s.toUpperCase();
  const f = fold(s), all = Object.entries(facts);
  if (/^[a-z]{3}$/.test(f)) { const m = all.find(([, c]) => (c.iso3 || '').toLowerCase() === f); if (m) return m[0]; }
  if (ALIAS[f] && facts[ALIAS[f]]) return ALIAS[f];
  const exact = all.find(([, c]) => fold(c.name) === f); if (exact) return exact[0];
  const starts = all.filter(([, c]) => fold(c.name).startsWith(f)); if (starts.length === 1 || (starts.length && f.length >= 4)) return starts.sort((a, b) => a[1].name.length - b[1].name.length)[0][0];
  const has = all.filter(([, c]) => fold(c.name).includes(f)); if (has.length && f.length >= 4) return has.sort((a, b) => a[1].name.length - b[1].name.length)[0][0];
  return null;
}

export function countryTool(ctx) {
  const { feeds } = ctx, site = feeds.siteBase;
  let loaded = null;
  const load = signal => (loaded = loaded || Promise.all([feeds.json(feeds.site('data/countries.json'), { ttl: 864e5, signal }), feeds.json(feeds.site('data/borders.json'), { ttl: 864e5, timeout: 60e3, signal })])
    .then(([c, b]) => ({ facts: (c && c.countries) || {}, credit: c && c.source, updated: c && c.updated, borders: prepare(Array.isArray(b) ? b.map(x => ({ ...x })) : []) }), e => { loaded = null; throw e; }));

  return {
    name: 'country_briefing',
    title: 'Country briefing',
    description: "A briefing on one country: capital, population, economy, life expectancy, languages and currency (Wikidata, World Bank), its biggest employers, its area from its outline, this week's earthquakes in it and off its coast (USGS), open natural events in it (NASA EONET: wildfires, eruptions, floods…), tropical cyclones near it (NOAA NHC, GDACS) and the weather in its capital now (Open-Meteo). Its link opens the globe on the country with its outline and card.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        country: { type: 'string', maxLength: 80, description: 'The country: its name ("Japan", "Côte d\'Ivoire", "UK") or ISO code ("JP", "JPN").' },
        place: { type: 'string', maxLength: 120, description: 'Or a place in it ("Kyoto"): the country it is in.' },
        lat: { type: 'number', minimum: -90, maximum: 90, description: 'Or a point (with lon): the country there.' },
        lon: { type: 'number', minimum: -180, maximum: 180, description: 'Longitude, east positive.' },
      },
    },
    async run(a, { signal }) {
      const d = await load(signal), t = ctx.now();
      let iso = null;
      if (a.country) { iso = findCountry(d.facts, a.country); if (!iso) throw new ToolError(`No country called "${a.country}" in the briefing data (it has ${Object.keys(d.facts).length} countries)`, 'not_found'); }
      else if (a.lat != null || a.lon != null) {
        if (!(Number.isFinite(a.lat) && Number.isFinite(a.lon))) throw new ToolError('Give both lat and lon', 'invalid_arguments');
        const b = countryAt(d.borders, a.lon, a.lat); if (!b) throw new ToolError(`${coord(a.lat, a.lon)} is not inside any country's outline (at sea, or on a coast the simplified borders miss)`, 'not_found');
        iso = b.iso;
      } else if (a.place) {
        const g = await geocode(feeds, a.place, signal), b = countryAt(d.borders, g.lon, g.lat);
        iso = b ? b.iso : g.country && d.facts[g.country] ? g.country : null;
        if (!iso) throw new ToolError(`${g.label} is not inside any country's outline the briefing knows`, 'not_found');
      } else throw new ToolError('Say which country (country), or a place or point in it', 'invalid_arguments');
      const f = d.facts[iso] || {}, b = d.borders.find(x => x.iso === iso);
      const name = f.name || (b && b.name) || iso;
      const box = b ? mainBox(b) : null, km2 = b ? multiPolygonArea(b.poly).area / 1e6 : null;

      // the live parts, side by side; any one failing leaves its line out
      const capitalAt = f.capital ? geocode(feeds, `${f.capital}, ${name}`, signal).catch(() => null) : Promise.resolve(null);
      const [quakes, events, storms, cap, cos] = await Promise.all([loadQuakes(feeds, { min: 2.5, period: 'week', signal }).catch(() => null), loadEvents(feeds, { days: 30, signal }).catch(() => null),
        loadStorms(feeds, t, signal).catch(() => null), capitalAt, feeds.json(feeds.site('data/companies.json'), { ttl: 864e5, signal }).catch(() => null)]);
      const employers = (() => {   // the biggest companies headquartered inside it (Wikidata, as the globe's country card shows)
        if (!cos || !b) return null;
        const c = cos.cols || [], ix = k => c.indexOf(k), [iN, iLat, iLon, iInd, iEmp] = ['name', 'lat', 'lon', 'industry', 'employees'].map(ix);
        return (cos.rows || []).filter(r => Number.isFinite(+r[iLat]) && Number.isFinite(+r[iLon]) && inCountry(b, +r[iLon], +r[iLat]))
          .sort((x, y) => (+y[iEmp] || 0) - (+x[iEmp] || 0)).slice(0, 5).map(r => ({ name: String(r[iN]), industry: iInd >= 0 && r[iInd] ? String(r[iInd]) : null, employees: +r[iEmp] || null }));
      })();
      let wx = null;
      if (cap) {
        const m = await feeds.json(`${METEO}?latitude=${cap.lat.toFixed(3)}&longitude=${cap.lon.toFixed(3)}&timezone=auto&forecast_days=1&wind_speed_unit=ms&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m`, { ttl: 10 * 60e3, signal }).catch(() => null);
        const c = m && m.current;
        if (c) wx = { place: cap.label, time: c.time, timezone: m.timezone || null, temperature_c: c.temperature_2m, words: weatherSentence({ temp: c.temperature_2m, speed: c.wind_speed_10m, from: c.wind_direction_10m, cloud: c.cloud_cover, code: c.weather_code }) };
      }
      const pad = 1.5, near = (lat, lon) => box && lat >= box[1] - pad && lat <= box[3] + pad && lon >= box[0] - pad && lon <= box[2] + pad;
      const qIn = (quakes || []).filter(q => b && inCountry(b, q.lon, q.lat)), qOff = (quakes || []).filter(q => b && !inCountry(b, q.lon, q.lat) && near(q.lat, q.lon) && !countryAt(d.borders, q.lon, q.lat));
      const evIn = (events || []).filter(e => b && inCountry(b, e.lon, e.lat));
      const stNear = (storms || []).filter(s => box && s.lat >= box[1] - 8 && s.lat <= box[3] + 8 && s.lon >= box[0] - 8 && s.lon <= box[2] + 8);
      const top = list => list.reduce((m, q) => (!m || q.magnitude > m.magnitude ? q : m), null);

      const facts = [f.capital && `Capital ${f.capital}`, f.cont, f.pop && `population ${big(f.pop)} (${f.popYear})`, km2 && `about ${big(km2)} km² (from its outline)`,
        f.gdp && `economy $${big(f.gdp)} (${f.gdpYear})`, f.gdpPc && `$${Math.round(f.gdpPc).toLocaleString('en-US')} a person`, f.life && `life expectancy ${f.life} years`,
        (f.lang || []).length && `languages: ${f.lang.join(', ')}`, (f.cur || []).length && `currency: ${f.cur[0]}`].filter(Boolean);
      const out = [`${flag(iso)} ${name} (${iso}${f.iso3 ? '/' + f.iso3 : ''}): ${facts.join('; ')}.`];
      if (quakes) {
        const tq = top(qIn), to = top(qOff);
        out.push(qIn.length || qOff.length ? `Earthquakes M2.5+ this week: ${qIn.length} inside it${tq ? ` (strongest M${tq.magnitude}, ${tq.place}, ${ago(tq.t, t)})` : ''}${qOff.length ? `; ${qOff.length} off its coast${to ? ` (strongest M${to.magnitude}, ${to.place})` : ''}` : ''}.` : 'No earthquakes of M2.5+ in or off it this week.');
      }
      if (events) out.push(evIn.length ? `Open natural events (NASA EONET, last 30 days): ${evIn.slice(0, 6).map(e => `${e.title} (${e.categories.join(', ')})`).join('; ')}${evIn.length > 6 ? `; and ${evIn.length - 6} more` : ''}.` : 'NASA EONET has no open natural events inside it.');
      if (storms) out.push(stNear.length ? `Tropical cyclones near it: ${stNear.map(s => `${s.class} ${s.name} at ${coord(s.lat, s.lon)}${s.wind_kt ? `, ${s.wind_kt} kt` : ''}`).join('; ')}.` : 'No active tropical cyclones near it.');
      if (wx) out.push(`In ${f.capital} now (${String(wx.time).replace('T', ' ')} local): ${wx.words}.`);
      if (employers && employers.length) out.push(`Biggest employers headquartered there: ${employers.map(e => `${e.name}${e.employees ? ` (${big(e.employees)})` : ''}`).join(', ')}.`);
      const camera = box ? frame((box[1] + box[3]) / 2, (box[0] + box[2]) / 2, Math.max(60, Math.min(4000, Math.max((box[3] - box[1]) * 111.32, (box[2] - box[0]) * 111.32 * Math.cos((box[1] + box[3]) / 2 * Math.PI / 180)) * 0.6))) : frame(f.lat || 0, f.lon || 0, 900);
      const url = globeUrl(site, { camera, country: iso, on: ['quakes'] });
      out.push(`${name} on the globe (its outline and card): ${url}`);
      return { text: out.join('\n'), data: {
        country: { iso, iso3: f.iso3 || null, name, capital: f.capital || null, region: f.cont || null, population: f.pop || null, population_year: f.popYear || null, area_km2: km2 ? Math.round(km2) : null,
          gdp_usd: f.gdp || null, gdp_year: f.gdpYear || null, gdp_per_person_usd: f.gdpPc || null, life_expectancy: f.life || null, languages: f.lang || [], currencies: f.cur || [] },
        earthquakes_week: quakes ? { inside: qIn.length, offshore: qOff.length, strongest: top([...qIn, ...qOff]) && (({ t: _, ...q }) => q)(top([...qIn, ...qOff])), list: [...qIn, ...qOff].sort((x, y) => y.magnitude - x.magnitude).slice(0, 10).map(({ t: _, ...q }) => q) } : null,
        events: events ? evIn.slice(0, 20) : null, storms_near: storms ? stNear : null, capital_weather: wx, biggest_employers: employers, url,
        facts_updated: d.updated || null, as_of: utc(t), source: `${d.credit || 'Wikidata, World Bank'}; companies: Wikidata; USGS; NASA EONET; NOAA NHC, GDACS; Open-Meteo` } };
    },
  };
}
