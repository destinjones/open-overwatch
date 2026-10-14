// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The MCP tools. Each one answers from public open data (the feeds the website reads, or the website's own copies of them)
// and returns { text, data }: text for people and models, data for programs, with `url`, a link that opens the live globe
// on what the answer is about. show_on_globe also shows that globe in the conversation where the host can (MCP Apps).
import { fromLL2, when as launchWhen, upcoming } from '../src/core/launches.js';
import { fromLL2Astronaut, whoIsUp, crewSentence } from '../src/core/crew.js';
import { parseAisLocations, parseAisVessels, shipKind, shipTypeName, NAV_STATUS, etaTime } from '../src/core/ais.js';
import { parseNetworks, parseStations, stationState, networksNear } from '../src/core/bikes.js';
import { findPasses, sunlit, compass, lookAngles } from '../src/core/passes.js';
import { observer, sunEcef } from '../src/core/observer.js';
import { planetsTonight, moonPhase, darkWindow, auroraAt, describePass, riseSet, sunAlt } from '../src/core/sky.js';
import { showersFor } from '../src/core/meteors.js';
import { skyWords, weatherSentence, SENSORS } from '../src/core/voicecmd.js';
import { decodeView } from '../src/core/viewlink.js';
import { AU_KM } from '../src/core/units.js';
import { ToolError } from './feeds.mjs';
import { rep, lineFor } from '../src/core/liveprov.js';
import { areaProps, resolveArea, inArea, distKm, frame, frameArea, globeUrl, panelUrl, LAYERS, WEATHER } from './place.mjs';
import { findSats, satState, ecefAt, GROUP_LAYER } from './sats.mjs';
import { PANEL_URI } from './panel.mjs';
import { iso, utc, r1, r2, coord, plural, ago, clocks, areaData, where, limitProp, take, zoneAt } from './words.mjs';
import { loadQuakes, loadStorms, loadEvents, EONET_CATS } from './hazards.mjs';
import { camerasTool } from './cams.mjs';
import { transitTool } from './transit.mjs';
import { firesTool } from './fires.mjs';
import { countryTool } from './country.mjs';
import { cablesTool } from './cables.mjs';
import { solarTool } from './solar.mjs';
import { eclipsesTool } from './eclipses.mjs';
import { distanceTool } from './distance.mjs';
import { volcanoesTool } from './volcanoes.mjs';
import { seaTool, airTool } from './ocean.mjs';
import { roadsTool } from './roads.mjs';
import { conjTool } from './conj.mjs';
import { reentryTool } from './reentry.mjs';
import { sunTool } from './sun.mjs';
import { meteorsTool } from './meteors.mjs';
import { createOsmTools } from './osm.mjs';
import { weatherDetailsTool } from './wxdetail.mjs';
import { aircraftTool } from './aircraft.mjs';
import { spaceTool } from './space.mjs';
import { spaceWeatherTool } from './spaceweather.mjs';
import { darkSkyTool } from './darksky.mjs';
import { airportWxTool } from './airportwx.mjs';

const AIS = 'https://meri.digitraffic.fi/api/ais/v1/', AIS_HEADERS = { 'Digitraffic-User': 'OpenOverwatch-MCP/0.1' };
const CITYBIKES = 'https://api.citybik.es/v2/networks';
const METEO = 'https://api.open-meteo.com/v1/forecast';
const SWPC = 'https://services.swpc.noaa.gov/';
const LD_KM = 384400, EARTH_VIEW = { lon: 0, lat: 20, height: 2.0e7, heading: 0, pitch: -90 };

// ---- the tools ------------------------------------------------------------------------------------------------------
export function createTools(ctx) {
  const { feeds } = ctx, site = feeds.siteBase, now = () => ctx.now();
  const link = v => globeUrl(site, v);

  const showOnGlobe = {
    name: 'show_on_globe',
    title: 'Show on the live 3D globe',
    description: "Opens Open Overwatch's live 3D Earth on a view. In Claude Desktop and other hosts with MCP Apps the globe appears in the conversation; everywhere else the answer is a link to open. Pass the url another tool returned to show exactly that, or describe a view: a place or lat/lon and how much around it, a tilt, layers to turn on or off, weather to overlay, a moment in time and how fast the clock runs, a satellite to follow, a flight to look for, a country to open, a camera look.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        url: { type: 'string', maxLength: 4000, description: "An Open Overwatch globe link from another tool's answer: shows exactly that." },
        ...areaProps('to show'),
        tilt: { type: 'number', minimum: 0, maximum: 80, description: 'Degrees from straight down: 0 is a map view, 50-70 looks across the land at the place.' },
        heading: { type: 'number', minimum: 0, maximum: 360, description: 'The way the camera faces, degrees clockwise from north (with tilt).' },
        layers_on: { type: 'array', maxItems: 32, items: { type: 'string', enum: LAYERS }, description: 'Layers to turn on: stations, visual, gnss, geo, weather (satellites), starlink, active, debris, launches, air, mil, airq (air quality), smoke, airports, quakes, transit, buoys (ocean), dart (tsunami buoys), tides, sst (sea temperature), ships (Baltic), bikes, traffic, storms, events (natural events), fires, radio, lighthouses, sun, terrain, buildings, cams, cctv, photoreal, volcanoes, companies, aurora, clouds, night, labels.' },
        layers_off: { type: 'array', maxItems: 32, items: { type: 'string', enum: LAYERS }, description: 'Layers to turn off.' },
        weather: { type: 'array', maxItems: 9, items: { type: 'string', enum: WEATHER }, description: 'Open weather mode with these: ir (clouds seen by satellites), radar (rain), rain (rain from space), lightning, wind, temp (temperature), pres (sea-level pressure: isobars, highs and lows), gust (wind gusts), wave (ocean wave height and direction).' },
        time: { type: 'string', maxLength: 40, description: "A moment to set the globe's clock to, ISO 8601 (e.g. a satellite pass). Omit for live." },
        time_speed: { type: 'number', minimum: -100000, maximum: 100000, description: 'With time: simulated seconds per real second (1 real time, 60 a minute a second, 0 paused). Default 1.' },
        satellite: { type: 'string', maxLength: 80, description: 'A satellite to follow, by name or NORAD number ("ISS", "Hubble", "NOAA 19", "25544").' },
        flight: { type: 'string', pattern: '^[A-Za-z0-9]{2,8}$', description: 'A flight callsign to look for, e.g. "BAW123".' },
        country: { type: 'string', pattern: '^[A-Za-z]{2}$', description: "Two-letter ISO country code: opens the country's card and outline." },
        sensor: { type: 'string', enum: SENSORS, description: 'A camera look: nvg (night vision), flir (thermal, white hot), flirbh (black hot), iron (thermal colours), crt (old screen), noir (black and white), normal.' },
      },
    },
    ui: { resourceUri: PANEL_URI },
    async run(a, { signal }) {
      if (a.url) {
        let u; try { u = new URL(a.url); } catch { throw new ToolError('That url is not a link', 'invalid_arguments'); }
        const own = new URL(site);
        if (u.origin !== own.origin || !/\/globe\.html$/.test(u.pathname) || !u.pathname.startsWith(own.pathname)) throw new ToolError(`Only Open Overwatch globe links (${site}globe.html#…) can be shown`, 'invalid_arguments');
        const v = decodeView(u.hash);
        return { text: `Showing it on the globe: ${u.href}`, data: { url: u.href, view: v } };
      }
      let camera = null, sat = null, on = [...(a.layers_on || [])], what = '';
      const area = await resolveArea(a, feeds, { pointKm: 150, signal });
      if (a.satellite) {
        const [s] = await findSats(feeds, a.satellite, { signal, max: 1 }), sl = await ctx.sgp4();
        const st = satState(sl, s, Number.isFinite(Date.parse(a.time)) ? Date.parse(a.time) : now());
        sat = s.id; if (GROUP_LAYER[s.group]) on.push(GROUP_LAYER[s.group]);
        what = `${s.name} (NORAD ${s.id})`;
        if (st && !area) camera = frame(st.lat, st.lon, Math.max(1500, st.altKm * 1.2));
      }
      if (area) camera = frameArea(area, { tilt: a.tilt, heading: a.heading || 0 });
      if (!camera) camera = EARTH_VIEW;
      let time = null;
      if (a.time != null) { const t = Date.parse(a.time); if (!Number.isFinite(t) || t < Date.UTC(1900, 0, 1) || t > Date.UTC(2100, 0, 1)) throw new ToolError('time must be an ISO 8601 date between 1900 and 2100', 'invalid_arguments'); time = { ms: t, rate: a.time_speed ?? 1 }; }
      const country = a.country ? a.country.toUpperCase() : null, flight = a.flight ? a.flight.toUpperCase() : null;
      const url = link({ camera, on, off: a.layers_off, weather: a.weather, time, country, flight, sat, sensor: a.sensor && a.sensor !== 'normal' ? a.sensor : null });
      const lead = area ? `Showing ${area.label}` : what ? `Following ${what}` : `Showing ${country ? `country ${country}` : 'the whole Earth'}`;
      const bits = [lead, area && what && `following ${what}`, flight && `looking for flight ${flight}`, a.weather?.length && `weather: ${a.weather.join(', ')}`, time && `at ${utc(time.ms)}`].filter(Boolean);
      return { text: `${bits.join(' · ')} on the globe: ${url}`, data: { url, view: decodeView(new URL(url).hash), area: areaData(area) } };
    },
  };

  const earthquakes = {
    name: 'earthquakes',
    title: 'Earthquakes',
    description: 'Recent earthquakes from the US Geological Survey (worldwide; complete above about magnitude 4.5 everywhere and lower in the US), strongest or latest first, optionally in an area. Each has its magnitude, place, time, depth, tsunami flag and PAGER alert, with a globe link.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        ...areaProps('to look'),
        min_magnitude: { type: 'number', minimum: 0, maximum: 10, description: 'Smallest magnitude to include (default 2.5).' },
        period: { type: 'string', enum: ['hour', 'day', 'week', 'month'], description: 'How far back (default day).' },
        sort: { type: 'string', enum: ['magnitude', 'time'], description: 'Strongest first (default) or latest first.' },
        limit: limitProp(20, 100),
      },
    },
    async run(a, { signal }) {
      const min = a.min_magnitude ?? 2.5, period = a.period || 'day', sort = a.sort || 'magnitude';
      if (period === 'month' && min < 2.5) throw new ToolError('For a whole month ask for magnitude 2.5 or more (the full list is too large)', 'invalid_arguments');
      const [quakes, area] = await Promise.all([loadQuakes(feeds, { min, period, signal }), resolveArea(a, feeds, { pointKm: 500, signal })]);
      const all = quakes.filter(q => inArea(area, q.lat, q.lon));
      all.sort(sort === 'time' ? (x, y) => y.t - x.t : (x, y) => y.magnitude - x.magnitude || y.t - x.t);
      const list = take(all, a.limit || 20), t = now(), top = all.length ? all.reduce((m, q) => (q.magnitude > m.magnitude ? q : m)) : null;
      const camera = area ? frameArea(area) : top ? frame(top.lat, top.lon, 900) : EARTH_VIEW, url = link({ camera, on: ['quakes'] });
      const head = all.length ? `${plural(all.length, 'earthquake')} of magnitude ${min}+ in the last ${period}${where(area)}${all.length > list.length ? ` (the ${list.length} ${sort === 'time' ? 'latest' : 'strongest'} below)` : ''}.`
        : `No earthquakes of magnitude ${min}+ in the last ${period}${where(area)}.`;
      const lines = list.map(q => `M${q.magnitude} · ${q.place} · ${utc(q.t)} (${ago(q.t, t)}) · ${q.depth_km} km deep${q.tsunami ? ' · tsunami flag' : ''}${q.alert ? ` · PAGER ${q.alert}` : ''}`);
      const note = period !== 'day' || min < 2.5 ? " (the globe's layer shows the last 24 hours, M2.5+)" : '';
      return { text: [head, ...lines, `On the globe${note}: ${url}`].join('\n'), data: { total: all.length, returned: list.length, truncated: all.length > list.length, min_magnitude: min, period,
        area: areaData(area), earthquakes: list.map(({ t: _, ...q }) => q), url, source: 'USGS Earthquake Hazards Program (public domain)' } };
    },
  };

  const whereSat = {
    name: 'where_is_satellite',
    title: 'Where is a satellite now',
    description: 'Where a satellite or space station is right now: the point below it, its height and speed, its orbit, and whether it is in sunlight, from the website copy of CelesTrak element sets (SGP4). Default: the ISS. Its link follows it on the globe.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { satellite: { type: 'string', maxLength: 80, description: 'Name or NORAD catalogue number ("ISS", "Tiangong", "Hubble", "NOAA 19", "25544"). Default ISS.' } } },
    async run(a, { signal }) {
      const found = await findSats(feeds, a.satellite || 'ISS', { signal, max: 5 }), s = found[0], sl = await ctx.sgp4(), t = now(), st = satState(sl, s, t);
      if (!st) throw new ToolError(`${s.name} (NORAD ${s.id}) can't be placed from its element set: it may have come down`, 'not_found');
      const p = ecefAt(sl, s, t), lit = p ? sunlit(p, sunEcef(t)) : null;
      const camera = frame(st.lat, st.lon, Math.max(1500, st.altKm * 1.2)), url = link({ camera, on: GROUP_LAYER[s.group] ? [GROUP_LAYER[s.group]] : [], sat: s.id });
      const others = found.slice(1).map(o => `${o.name} (${o.id})`);
      const text = [`${s.name} (NORAD ${s.id}) is over ${coord(st.lat, st.lon)}, ${Math.round(st.altKm)} km up, moving ${r2(st.speedKmS)} km/s (${Math.round(st.speedKmS * 3600).toLocaleString('en-US')} km/h).`,
        `One orbit takes ${r1(st.periodMin)} min, inclined ${r1(st.inclination)}°. ${lit == null ? '' : lit ? 'It is in sunlight.' : "It is in Earth's shadow."} Elements from ${utc(st.epochMs)} (${ago(st.epochMs, t)}).`,
        others.length ? `Also matching: ${others.join(', ')}.` : '', `Follow it on the globe: ${url}`].filter(Boolean).join('\n');
      return { text, data: { provenance: lineFor('satellites', [rep('celestrak', { dataAt: st.epochMs, cached: true })], { now: t }), satellite: { name: s.name, norad: s.id }, at: iso(t), lat: r2(st.lat), lon: r2(st.lon), altitude_km: Math.round(st.altKm), speed_km_s: r2(st.speedKmS),
        period_min: r1(st.periodMin), inclination_deg: r1(st.inclination), sunlit: lit, elements_epoch: iso(st.epochMs), also_matching: found.slice(1).map(o => ({ name: o.name, norad: o.id })), url,
        source: 'CelesTrak element sets via the Open Overwatch website copy; SGP4 (satellite.js)' } };
    },
  };

  const passes = {
    name: 'satellite_passes',
    title: 'When a satellite passes over',
    description: "When a satellite (default the ISS) passes over a place in the next days: rise time and direction, highest elevation, set direction, and whether it will be visible to the eye (sunlit against a dark sky). Times are given in the place's own time zone and UTC.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        ...areaProps(null),
        satellite: { type: 'string', maxLength: 80, description: 'Name or NORAD number. Default ISS.' },
        days: { type: 'integer', minimum: 1, maximum: 10, description: 'How many days ahead (default 3).' },
        visible_only: { type: 'boolean', description: 'Only passes you can see with the eye (default false).' },
        min_elevation: { type: 'number', minimum: 0, maximum: 80, description: 'Lowest peak elevation to count, degrees above the horizon (default 10).' },
        limit: limitProp(10, 40),
      },
    },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, signal });
      const [[s], sl, tz] = await Promise.all([findSats(feeds, a.satellite || 'ISS', { signal, max: 1 }), ctx.sgp4(), zoneAt(ctx, area.lat, area.lon, signal)]);
      const t0 = now(), t1 = t0 + (a.days || 3) * 864e5, minEl = a.min_elevation ?? 10, o = observer(area.lat, area.lon, 0), c = clocks(tz);
      const at = ms => ecefAt(sl, s, ms);
      const p0 = at(t0); if (!p0) throw new ToolError(`${s.name} (NORAD ${s.id}) can't be placed from its element set`, 'not_found');
      let list = findPasses(at, o, t0, t1, { minEl, sunAt: sunEcef });
      const look = lookAngles(p0, o);
      if (!list.length && look.el >= minEl) {   // geostationary (or near it): never sets
        const url = link({ camera: frameArea({ ...area, radiusKm: 400 }), on: GROUP_LAYER[s.group] ? [GROUP_LAYER[s.group]] : [] });
        return { text: `${s.name} never sets from ${area.label}: it stays ${Math.round(look.el)}° up in the ${compass(look.az)} (a geostationary orbit, ${Math.round(look.range).toLocaleString('en-US')} km away).\nOn the globe: ${url}`,
          data: { satellite: { name: s.name, norad: s.id }, place: areaData(area), always_up: true, elevation_deg: r1(look.el), azimuth_deg: r1(look.az), passes: [], url } };
      }
      if (a.visible_only) list = list.filter(p => p.visible);
      const shown = list.slice(0, a.limit || 10), first = shown.find(p => p.visible) || shown[0];
      const camera = frameArea({ ...area, radiusKm: 1100 });
      const url = link({ camera, on: GROUP_LAYER[s.group] ? [GROUP_LAYER[s.group]] : [], time: first ? { ms: first.rise - 60e3, rate: 20 } : null });
      const head = shown.length ? `${plural(list.length, `${a.visible_only ? 'visible ' : ''}pass`, `${a.visible_only ? 'visible ' : ''}passes`)} of ${s.name} over ${area.label} in the next ${plural(a.days || 3, 'day')} (times ${tz || 'UTC'}):`
        : `${s.name} has no ${a.visible_only ? 'visible ' : ''}passes above ${minEl}° over ${area.label} in the next ${plural(a.days || 3, 'day')}.`;
      const lines = shown.map(p => describePass(s.name, p, { time: c.full }));
      return { text: [head, ...lines, first ? `Replay the ${first.visible ? 'first visible' : 'next'} pass on the globe: ${url}` : `On the globe: ${url}`].join('\n'),
        data: { satellite: { name: s.name, norad: s.id }, place: areaData(area), timezone: tz, passes: shown.map(p => ({ rise: iso(p.rise), peak: iso(p.peak), set: iso(p.set), rise_local: c.full(p.rise),
          max_elevation_deg: r1(p.maxEl), rise_direction: compass(p.azRise), peak_direction: compass(p.azPeak), set_direction: compass(p.azSet), minutes: r1((p.set - p.rise) / 60e3), visible: !!p.visible })), url } };
    },
  };

  const launches = {
    name: 'launches',
    title: 'Rocket launches',
    description: "Upcoming rocket launches worldwide (The Space Devs' Launch Library 2, copied by the website every 6 h): time and how sure it is, rocket, provider, mission, pad, status, weather odds and webcast. Each links to the globe's launch card.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 120, description: 'How many days ahead (default 14).' },
        search: { type: 'string', maxLength: 60, description: 'Only launches whose rocket, provider, mission, pad, place or country code contains this (e.g. "Falcon", "Starlink", "Kourou", "CN").' },
        limit: limitProp(10, 40),
      },
    },
    async run(a, { signal }) {
      const d = await feeds.json(feeds.site('data/launches.json'), { ttl: 20 * 60e3, signal }), t = now(), until = t + (a.days || 14) * 864e5;
      const q = String(a.search || '').trim().toLowerCase();
      let list = upcoming(((d && d.results) || []).map(fromLL2).filter(Boolean), t).filter(l => !Number.isFinite(l.net) || l.net <= until);
      if (q) list = list.filter(l => [l.name, l.mission, l.rocket, l.provider, l.pad, l.place, l.country, l.orbit].some(x => String(x || '').toLowerCase().includes(q)));
      const shown = take(list, a.limit || 10);
      const rows = shown.map(l => ({ id: l.id, name: l.name, mission: l.mission, mission_type: l.type || null, description: l.desc.slice(0, 300) || null, orbit: l.orbit || null, rocket: l.rocket, provider: l.provider,
        net: iso(l.net), when: launchWhen(l), status: l.statusName || l.status, pad: l.pad, place: l.place, country: l.country || null, lat: r2(l.lat), lon: r2(l.lon), weather_go_percent: l.prob,
        webcast: l.webcasts[0] ? l.webcasts[0].url : null, url: panelUrl(site, 'launches', l.id),
        provenance: lineFor('launches', [rep('ll2', { dataAt: l.updated ?? d.t ?? null, cached: true })], { now: t }) }));
      const lines = rows.map((l, i) => `${launchWhen(shown[i])}${Number.isFinite(shown[i].net) && shown[i].net > t ? ` (${ago(shown[i].net, t)})` : ''} · ${l.name} · ${l.provider} · ${l.place} · ${l.status}${l.weather_go_percent != null ? ` · ${l.weather_go_percent}% weather go` : ''}${l.webcast ? ` · webcast ${l.webcast}` : ''}`);
      const head = list.length ? `${plural(list.length, 'launch', 'launches')} in the next ${plural(a.days || 14, 'day')}${q ? ` matching "${a.search}"` : ''}${list.length > shown.length ? ` (the first ${shown.length})` : ''}:` : `No launches in the next ${plural(a.days || 14, 'day')}${q ? ` matching "${a.search}"` : ''}.`;
      const url = rows[0] ? rows[0].url : panelUrl(site, 'launches');
      return { text: [head, ...lines, `Launch cards on the globe: ${url}`].join('\n'), data: { total: list.length, returned: rows.length, launches: rows, url, updated: iso(d && d.t), source: 'The Space Devs, Launch Library 2' } };
    },
  };

  const crew = {
    name: 'people_in_space',
    title: 'Who is in space now',
    description: 'Everyone in space right now, by station (ISS, Tiangong), with agency, nationality and days in space (Launch Library 2, copied by the website every 6 h).',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async run(a, { signal }) {
      const d = await feeds.json(feeds.site('data/astronauts.json'), { ttl: 60 * 60e3, signal }), w = whoIsUp(((d && d.results) || []).map(fromLL2Astronaut)), t = now();
      const lines = w.stations.map(s => `${s.name} (${s.crew.length}): ${s.crew.map(p => `${p.name} (${[p.agency, p.countries.join('/')].filter(Boolean).join(', ')}${p.since ? `, up since ${utc(p.since).slice(0, 10)}` : ''})`).join('; ')}`);
      const url = panelUrl(site, 'crew'), iss = link({ camera: EARTH_VIEW, on: ['stations'], sat: '25544' });
      return { text: [crewSentence(w), ...lines, `Crew card on the globe: ${url}`, `Follow the ISS: ${iss}`].join('\n'),
        data: { total: w.total, stations: w.stations.map(s => ({ name: s.name, crew: s.crew.map(p => ({ name: p.name, agency: p.agency, countries: p.countries, days_in_space_career: p.days != null ? Math.round(p.days) : null,
          in_space_since: iso(p.since), days_this_flight: p.since ? Math.round((t - p.since) / 864e5) : null, wikipedia: p.wiki })) })), url, iss_url: iss, updated: iso(d && d.t), source: 'The Space Devs, Launch Library 2' } };
    },
  };

  const flybys = {
    name: 'asteroid_flybys',
    title: 'Asteroids passing close to Earth',
    description: "Asteroids passing close to Earth in the coming weeks (NASA/JPL CNEOS close-approach data, copied by the website): when, how close (in lunar distances and km), how fast and roughly how big.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 60, description: 'How many days ahead (default 30).' },
        max_lunar_distances: { type: 'number', minimum: 0.01, maximum: 50, description: "Only those closer than this many Moon distances (384,400 km each; default 10)." },
        limit: limitProp(10, 50),
      },
    },
    async run(a, { signal }) {
      const d = await feeds.json(feeds.site('data/flybys.json'), { ttl: 3 * 3600e3, signal }), t = now(), until = t + (a.days || 30) * 864e5, maxLd = a.max_lunar_distances ?? 10;
      const size = r => { if (Number.isFinite(r.km) && r.km > 0) return [r.km, r.km]; if (!Number.isFinite(r.h)) return null; const k = 1329 * 10 ** (-r.h / 5); return [k / Math.sqrt(0.25), k / Math.sqrt(0.05)]; };
      const words = s => { if (!s) return 'size unknown'; const f = m => (m >= 1000 ? `${r1(m / 1000)} km` : `${Math.round(m)} m`); return s[0] === s[1] ? `about ${f(s[0] * 1000)} across` : `about ${f(s[0] * 1000)} to ${f(s[1] * 1000)} across`; };
      const all = ((d && d.rows) || []).filter(r => Number.isFinite(r.tca) && r.tca >= t - 12 * 3600e3 && r.tca <= until && Number.isFinite(r.au)).map(r => ({ ...r, ld: (r.au * AU_KM) / LD_KM })).filter(r => r.ld <= maxLd).sort((x, y) => x.tca - y.tca);
      const shown = take(all, a.limit || 10), url = panelUrl(site, 'flybys');
      const lines = shown.map(r => `${String(r.name || r.des).replace(/^\((.*)\)$/, '$1')} · ${utc(r.tca)} (${ago(r.tca, t)}) · ${r2(r.ld)} lunar distances (${Math.round(r.au * AU_KM).toLocaleString('en-US')} km) · ${r1(r.kms)} km/s · ${words(size(r))}`);
      const head = all.length ? `${plural(all.length, 'asteroid')} passing within ${maxLd} lunar distances in the next ${plural(a.days || 30, 'day')}${all.length > shown.length ? ` (the first ${shown.length})` : ''}:` : `No asteroids pass within ${maxLd} lunar distances in the next ${plural(a.days || 30, 'day')}.`;
      return { text: [head, ...lines, `Flybys on the globe: ${url}`].join('\n'), data: { total: all.length, flybys: shown.map(r => ({ designation: r.des, name: String(r.name || r.des).replace(/^\((.*)\)$/, '$1'),
        closest: iso(r.tca), lunar_distances: r2(r.ld), km: Math.round(r.au * AU_KM), speed_km_s: r1(r.kms), absolute_magnitude: r.h ?? null, size_m: size(r) && size(r).map(k => Math.round(k * 1000)) })),
        url, updated: iso(d && d.t), source: 'NASA/JPL CNEOS close-approach data' } };
    },
  };

  const storms = {
    name: 'tropical_storms',
    title: 'Hurricanes, typhoons and cyclones',
    description: "Active tropical cyclones worldwide: NOAA's National Hurricane Center advisories (Atlantic, East and Central Pacific: class, wind, pressure, movement) and GDACS for every basin (alert level, strongest wind so far, countries). Optionally only those in an area.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps('to look') } },
    async run(a, { signal }) {
      const [list, area] = await Promise.all([loadStorms(feeds, now(), signal), resolveArea(a, feeds, { pointKm: 1500, signal })]);
      const shown = list.filter(s => inArea(area, s.lat, s.lon));
      const camera = area ? frameArea(area) : shown[0] ? frame(shown[0].lat, shown[0].lon, 1300) : EARTH_VIEW, url = link({ camera, on: ['storms'] });
      const lines = shown.map(s => `${s.class} ${s.name} · ${coord(s.lat, s.lon)}${s.wind_kt ? ` · ${s.wind_kt} kt (${s.strength})` : ''}${s.pressure_mb ? ` · ${s.pressure_mb} mb` : ''}${s.movement ? ` · moving ${s.movement}` : ''}${s.gdacs ? ` · GDACS ${s.gdacs.alert || ''} alert${s.gdacs.peak_wind_kmh ? `, strongest wind so far ${s.gdacs.peak_wind_kmh} km/h` : ''}${s.gdacs.countries ? `, ${s.gdacs.countries}` : ''}` : ''}${s.advisory ? ` · ${s.advisory}` : s.gdacs && s.gdacs.report ? ` · ${s.gdacs.report}` : ''}`);
      const head = shown.length ? `${plural(shown.length, 'active tropical cyclone')}${where(area)}:` : `No active tropical cyclones${where(area)}.`;
      return { text: [head, ...lines, `Tracks and forecast cones on the globe: ${url}`].join('\n'), data: { total: shown.length, storms: shown, area: areaData(area), url, source: 'NOAA National Hurricane Center; GDACS (European Commission JRC and UN OCHA)' } };
    },
  };

  const EVENT_LAYER = { wildfires: 'fires', volcanoes: 'volcanoes', severeStorms: 'storms', earthquakes: 'quakes' };
  const EVENT_WORD = { wildfires: 'wildfire', volcanoes: 'volcano', severeStorms: 'severe storm', floods: 'flood', seaLakeIce: 'sea and lake ice', earthquakes: 'earthquake', landslides: 'landslide',
    dustHaze: 'dust and haze', drought: 'drought', snow: 'snow', tempExtremes: 'temperature extreme', waterColor: 'water colour', manmade: 'man-made' };
  const events = {
    name: 'natural_events',
    title: 'Natural events (NASA EONET)',
    description: "Natural events NASA's Earth Observatory Natural Event Tracker has open: wildfires, volcanic eruptions, severe storms, floods, icebergs, dust, drought, landslides and more, newest first, optionally of one kind and in an area.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        category: { type: 'string', enum: EONET_CATS, description: 'One kind of event (default all).' },
        ...areaProps('to look'),
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'Events active in the last this many days (default 30).' },
        limit: limitProp(20, 100),
      },
    },
    async run(a, { signal }) {
      const days = a.days || 30;
      const [list, area] = await Promise.all([loadEvents(feeds, { days, category: a.category, signal }), resolveArea(a, feeds, { pointKm: 500, signal })]);
      const all = list.filter(e => inArea(area, e.lat, e.lon));
      const shown = take(all, a.limit || 20), cats = a.category ? [a.category] : [];
      const camera = area ? frameArea(area) : shown[0] ? frame(shown[0].lat, shown[0].lon, 400) : EARTH_VIEW, url = link({ camera, on: cats.map(c => EVENT_LAYER[c]).filter(Boolean) });
      const t = now(), lines = shown.map(e => `${e.title} · ${e.categories.join(', ')} · ${coord(e.lat, e.lon)}${e.latest ? ` · last seen ${ago(Date.parse(e.latest), t)}` : ''}${e.magnitude ? ` · ${e.magnitude}` : ''}${e.sources[0] ? ` · ${e.sources[0]}` : ''}`);
      const kind = a.category ? EVENT_WORD[a.category] : 'natural';
      const head = all.length ? `${plural(all.length, `open ${kind} event`)}${where(area)} (active in the last ${days} days)${all.length > shown.length ? `, the ${shown.length} newest:` : ':'}` : `No open ${kind} events${where(area)} in the last ${days} days.`;
      return { text: [head, ...lines, `On the globe: ${url}`].join('\n'), data: { total: all.length, events: shown, area: areaData(area), url, source: 'NASA Earth Observatory Natural Event Tracker (EONET)' } };
    },
  };

  const KINDS = ['cargo', 'tanker', 'passenger', 'fast', 'fishing', 'pleasure', 'military', 'service', 'other'];
  const ships = {
    name: 'ships_baltic',
    title: 'Ships in the northern Baltic',
    description: "Ships near a place in the northern Baltic Sea, live from Finland's coastal AIS network (Fintraffic Digitraffic): name, type, status, speed, course, destination and ETA, size and distance. Covers the Gulf of Finland, the Archipelago Sea, the Gulf of Bothnia and the waters off Finland and Estonia only.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        ...areaProps('to look (default 15 km, at most 150)'),
        kind: { type: 'string', enum: KINDS, description: 'Only ships of this kind.' },
        name: { type: 'string', maxLength: 40, description: 'Only ships whose name contains this.' },
        limit: limitProp(15, 50),
      },
    },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, pointKm: 15, signal }), lat = area.lat, lon = area.lon;
      if (lat < 53.5 || lat > 66.5 || lon < 9 || lon > 35) throw new ToolError(`${area.label} is outside the AIS coverage: Finland's network hears the northern Baltic only (Gulf of Finland, Archipelago Sea, Gulf of Bothnia)`, 'unsupported');
      const km = Math.min(150, area.bbox ? Math.min(area.radiusKm, 60) : area.radiusKm), t = now();
      const d = await feeds.json(`${AIS}locations?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&radius=${Math.round(km)}`, { ttl: 20e3, headers: AIS_HEADERS, timeout: 30e3, signal });
      let near = parseAisLocations(d).filter(s => t - s.t < 3 * 3600e3).map(s => ({ ...s, km: distKm(area, s.lat, s.lon) })).filter(s => s.km <= km).sort((x, y) => x.km - y.km);
      const want = a.kind || a.name ? 60 : (a.limit || 15);
      const pool = near.slice(0, want), meta = new Map();
      for (let i = 0; i < pool.length; i += 6) {   // a few at a time: be gentle with the feed
        const got = await Promise.all(pool.slice(i, i + 6).map(s => feeds.json(`${AIS}vessels/${s.mmsi}`, { ttl: 3600e3, headers: AIS_HEADERS, signal }).catch(() => null)));
        for (const v of parseAisVessels(got.filter(Boolean))) meta.set(v.mmsi, v);
      }
      let rows = pool.map(s => ({ s, v: meta.get(s.mmsi) || {} }));
      if (a.kind) rows = rows.filter(({ v }) => shipKind(v.type || 0) === a.kind);
      if (a.name) rows = rows.filter(({ v }) => (v.name || '').toLowerCase().includes(a.name.toLowerCase()));
      rows = take(rows, a.limit || 15);
      const list = rows.map(({ s, v }) => { let eta = etaTime(v.eta, t); if (eta != null && (eta < t - 864e5 || eta > t + 60 * 864e5)) eta = null;   // left over from an old voyage, or a placeholder
        return { name: v.name || null, mmsi: s.mmsi, imo: v.imo || null, callsign: v.callSign || null, type: v.type ? shipTypeName(v.type) : null, kind: shipKind(v.type || 0),
        status: NAV_STATUS[s.navStat] || null, speed_kn: s.sog, course_deg: s.cog, heading_deg: s.heading, destination: v.destination || null, eta: iso(eta), length_m: v.length, beam_m: v.width,
        draught_m: v.draught, lat: Number(s.lat.toFixed(4)), lon: Number(s.lon.toFixed(4)), distance_km: r2(s.km), reported: iso(s.t), provenance: lineFor('ships', [rep('digitraffic', { dataAt: s.t })], { now: t }) }; });
      const camera = frame(lat, lon, Math.max(2, Math.min(km, 40)), { tilt: 55 }), url = link({ camera, on: ['ships'] });
      const lines = list.map(s => `${s.name || 'MMSI ' + s.mmsi} · ${s.type || 'type unknown'} · ${s.status || ''}${s.speed_kn != null ? ` · ${s.speed_kn} kn` : ''}${s.course_deg != null && s.speed_kn >= 0.5 ? ` heading ${compass(s.course_deg)}` : ''}${s.destination ? ` · to ${s.destination}` : ''}${s.eta ? ` (ETA ${utc(Date.parse(s.eta))})` : ''}${s.length_m ? ` · ${s.length_m} m` : ''} · ${s.distance_km} km away`);
      const head = near.length ? `${plural(near.length, 'ship')} reported within ${Math.round(km)} km of ${area.label}${rows.length < near.length ? `; ${a.kind || a.name ? 'matching' : 'nearest'} ${rows.length}:` : ':'}` : `No ships reported within ${Math.round(km)} km of ${area.label} in the last 3 hours.`;
      return { text: [head, ...lines, `Ships on the globe: ${url}`].join('\n'), data: { total: near.length, ships: list, area: areaData(area), url, source: 'Fintraffic / Digitraffic marine AIS (CC BY 4.0)' } };
    },
  };

  const bikes = {
    name: 'bike_share',
    title: 'Bike share near a place',
    description: 'Live bike share near a place, from the CityBikes directory of about 800 systems worldwide: the nearest stations with bikes, e-bikes and free docks, and the totals for the system.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps('(the stations nearest the point are listed)'), limit: limitProp(8, 30) } },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, pointKm: 2, signal }), lat = area.lat, lon = area.lon;
      const nets = parseNetworks(await feeds.json(CITYBIKES + '?fields=id,name,location,company', { ttl: 864e5, timeout: 30e3, signal })), near = networksNear(nets, lat, lon, 60, 3);
      if (!near.length) throw new ToolError(`No bike share system CityBikes knows of is within 60 km of ${area.label}`, 'not_found');
      const n = near[0], st = parseStations(await feeds.json(`${CITYBIKES}/${encodeURIComponent(n.id)}`, { ttl: 60e3, timeout: 30e3, signal }));
      if (!st.length) throw new ToolError(`${n.name} lists no stations right now`, 'unavailable');
      const sum = k => st.reduce((s, x) => s + (Number.isFinite(x[k]) ? x[k] : 0), 0), big = k => sum(k).toLocaleString('en-US'), t = now();
      const shown = take(st.map(s => ({ ...s, m: distKm(area, s.lat, s.lon) * 1000 })).sort((x, y) => x.m - y.m), a.limit || 8);
      const list = shown.map(s => ({ name: s.name, bikes: s.bikes, ebikes: s.ebikes, free_docks: s.docks, state: stationState(s), distance_m: Math.round(s.m), lat: Number(s.lat.toFixed(5)), lon: Number(s.lon.toFixed(5)), updated: iso(s.t),
        provenance: lineFor('bikes', [rep('citybikes', { name: `${n.name} via CityBikes`, dataAt: s.t })], { now: t }) }));
      const camera = frame(lat, lon, 1.2, { tilt: 55 }), url = link({ camera, on: ['bikes'] });
      const lines = list.map(s => `${s.name} · ${plural(s.bikes, 'bike')}${s.ebikes ? ` (${s.ebikes} electric)` : ''}${s.free_docks != null ? ` · ${plural(s.free_docks, 'free dock')}` : ''}${s.state !== 'ok' ? ` · ${s.state}` : ''} · ${s.distance_m < 1000 ? s.distance_m + ' m' : r1(s.distance_m / 1000) + ' km'} away`);
      const age = shown[0] && shown[0].t ? ` (updated ${ago(shown[0].t, t)})` : '';
      return { text: [`${n.name}${n.city ? ` (${n.city})` : ''}: ${st.length.toLocaleString('en-US')} stations, ${big('bikes')} bikes free${sum('ebikes') ? ` (${big('ebikes')} electric)` : ''}, ${big('docks')} free docks${age}. Nearest to ${area.label}:`, ...lines, `On the globe: ${url}`].join('\n'),
        data: { system: { id: n.id, name: n.name, city: n.city, country: n.country, company: n.company || null, stations: st.length, bikes: sum('bikes'), ebikes: sum('ebikes'), free_docks: sum('docks') },
          stations: list, other_systems_nearby: near.slice(1).map(x => x.name), area: areaData(area), url, source: 'CityBikes (citybik.es)' } };
    },
  };

  const weather = {
    name: 'weather',
    title: 'Weather at a place',
    description: "Weather now and the next days at a place (Open-Meteo, from the national weather services' models): conditions, temperature and feels-like, wind and gusts, rain and its odds, sunrise and sunset, in the place's time zone. Its link opens the globe's weather mode (satellite clouds, radar, wind) over the place.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { ...areaProps(null), days: { type: 'integer', minimum: 1, maximum: 7, description: 'Days of forecast (default 3).' }, units: { type: 'string', enum: ['metric', 'imperial'], description: 'metric (default) or imperial.' } },
    },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, signal }), imp = a.units === 'imperial', days = a.days || 3;
      const q = `${METEO}?latitude=${area.lat.toFixed(3)}&longitude=${area.lon.toFixed(3)}&timezone=auto&forecast_days=${days}&wind_speed_unit=ms`
        + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset';
      const d = await feeds.json(q, { ttl: 10 * 60e3, signal }), c = d && d.current, dy = d && d.daily;
      if (!c || !dy) throw new ToolError('Open-Meteo sent no forecast for that place', 'unavailable');
      const T = v => (Number.isFinite(v) ? (imp ? `${Math.round(v * 9 / 5 + 32)} °F` : `${Math.round(v)} °C`) : '?'), W = v => (Number.isFinite(v) ? (imp ? `${Math.round(v * 2.23694)} mph` : `${Math.round(v * 3.6)} km/h`) : '?');
      const P = v => (imp ? `${r2(v / 25.4)} in` : `${r1(v)} mm`);
      const now0 = weatherSentence({ temp: c.temperature_2m, speed: c.wind_speed_10m, from: c.wind_direction_10m, cloud: c.cloud_cover, code: c.weather_code }, imp);
      const daysOut = (dy.time || []).map((date, i) => ({ date, conditions: skyWords({ code: dy.weather_code[i] }) || null, high: dy.temperature_2m_max[i], low: dy.temperature_2m_min[i], rain_mm: dy.precipitation_sum[i],
        rain_chance_percent: dy.precipitation_probability_max[i], wind_max_ms: dy.wind_speed_10m_max[i], gusts_max_ms: dy.wind_gusts_10m_max[i], sunrise: dy.sunrise[i], sunset: dy.sunset[i] }));
      const lines = daysOut.map(x => `${new Date(x.date + 'T12:00:00Z').toUTCString().slice(0, 11)}: ${x.conditions || 'mixed'}, ${T(x.low)} to ${T(x.high)}${x.rain_mm > 0 ? `, ${P(x.rain_mm)} rain` : ''}${x.rain_chance_percent != null ? ` (${x.rain_chance_percent}% chance)` : ''}, wind up to ${W(x.wind_max_ms)} (gusts ${W(x.gusts_max_ms)}), sunrise ${String(x.sunrise).slice(11)}, sunset ${String(x.sunset).slice(11)}`);
      const camera = frame(area.lat, area.lon, 1400), url = link({ camera, weather: ['ir', 'radar', 'wind'] });   // weather mode shows the whole Earth below 3,000 km
      const head = `Now at ${area.label} (${String(c.time).replace('T', ' ')} ${d.timezone_abbreviation || d.timezone || ''}): ${now0}; feels like ${T(c.apparent_temperature)}, humidity ${c.relative_humidity_2m}%, gusts ${W(c.wind_gusts_10m)}${c.precipitation > 0 ? `, ${P(c.precipitation)} of rain in the last 15 min` : ''}.`;
      const wxAt = Date.parse(String(c.time || '') + 'Z') - (+d.utc_offset_seconds || 0) * 1000;
      return { text: [head, ...lines, `Clouds, radar and wind on the globe: ${url}`].join('\n'), data: { provenance: lineFor('weather', [rep('openmeteo', { name: 'Open-Meteo (model)', dataAt: Number.isFinite(wxAt) ? wxAt : null })], { now: now() }), place: areaData(area), timezone: d.timezone || null, units: imp ? 'imperial' : 'metric',
        now: { time: c.time, conditions: skyWords({ code: c.weather_code }) || null, temperature_c: c.temperature_2m, feels_like_c: c.apparent_temperature, humidity_percent: c.relative_humidity_2m,
          cloud_percent: c.cloud_cover, wind_ms: c.wind_speed_10m, wind_from_deg: c.wind_direction_10m, gusts_ms: c.wind_gusts_10m, precipitation_mm: c.precipitation }, days: daysOut, url, source: 'Open-Meteo.com (CC BY 4.0)' } };
    },
  };

  const KP_WORDS = [[9, 'an extreme geomagnetic storm (G5)'], [8, 'a severe geomagnetic storm (G4)'], [7, 'a strong geomagnetic storm (G3)'], [6, 'a moderate geomagnetic storm (G2)'], [5, 'a minor geomagnetic storm (G1)'], [4, 'active'], [3, 'unsettled'], [0, 'quiet']];
  const kpWords = kp => KP_WORDS.find(([m]) => kp >= m)[1];
  const aurora = {
    name: 'aurora',
    title: 'Aurora and space weather',
    description: "The aurora and geomagnetic activity from NOAA's Space Weather Prediction Center: the planetary Kp index now and its 3-day forecast, and, for a place, the chance of seeing the aurora overhead or on the horizon right now (the OVATION model) and whether it is dark there.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps(null) } },
    async run(a, { signal }) {
      const [kp, fc, area] = await Promise.all([feeds.json(`${SWPC}products/noaa-planetary-k-index.json`, { ttl: 10 * 60e3, signal }), feeds.json(`${SWPC}products/noaa-planetary-k-index-forecast.json`, { ttl: 30 * 60e3, signal }).catch(() => []),
        resolveArea(a, feeds, { signal })]);
      const rows = (Array.isArray(kp) ? kp : []).map(r => (Array.isArray(r) ? { time_tag: r[0], Kp: +r[1] } : r)).filter(r => Number.isFinite(+(r.Kp ?? r.kp)));
      const last = rows[rows.length - 1]; if (!last) throw new ToolError('NOAA SWPC sent no Kp readings', 'unavailable');
      const kpNow = +(last.Kp ?? last.kp), t = now(), at = Date.parse(last.time_tag + (/Z$/.test(last.time_tag) ? '' : 'Z'));
      const ahead = new Map();
      for (const r of Array.isArray(fc) ? fc : []) {
        const tt = Date.parse(r.time_tag + (/Z$/.test(r.time_tag) ? '' : 'Z')), v = +r.kp; if (!Number.isFinite(tt) || !Number.isFinite(v) || r.observed === 'observed' || tt < t - 3 * 3600e3) continue;
        const k = new Date(tt).toISOString().slice(0, 10), o = ahead.get(k); if (!o || v > o.kp) ahead.set(k, { kp: v, scale: r.noaa_scale || null });
      }
      const days = [...ahead.entries()].slice(0, 3).map(([date, o]) => ({ date, max_kp: r2(o.kp), scale: o.scale }));
      let local = null;
      if (area) {
        const ov = await feeds.json(`${SWPC}json/ovation_aurora_latest.json`, { ttl: 10 * 60e3, timeout: 30e3, signal });
        const ch = auroraAt((ov && ov.coordinates) || [], area.lat, area.lon), sun = sunAlt(area.lat, area.lon, t);
        local = { place: areaData(area), overhead_percent: ch.overhead, horizon_percent: ch.horizon, level: ch.level, verdict: ch.text, dark: sun < -12, sun_altitude_deg: r1(sun), forecast_time: ov && ov['Forecast Time'] };
      }
      const pole = area ? (area.lat >= 0 ? 66 : -66) : 66, camera = frame(pole, area ? area.lon : -100, 2600), url = link({ camera, on: ['aurora'] });
      const lines = [`Kp ${r2(kpNow)} (${kpWords(kpNow)}), measured ${ago(at, t)}.`, days.length ? `Forecast: ${days.map(d => `${d.date} up to Kp ${d.max_kp}${d.scale ? ` (${d.scale})` : ''}`).join('; ')}.` : '',
        local ? `At ${area.label}: ${local.verdict}${local.dark ? '' : ' It is not dark there now, so wait for night.'} (chance overhead ${local.overhead_percent}%, on the horizon ${local.horizon_percent}%)` : '',
        `The aurora oval on the globe: ${url}`].filter(Boolean);
      return { text: lines.join('\n'), data: { provenance: lineFor('aurora', [rep('swpc', { dataAt: at })], { now: t }), kp_now: r2(kpNow), kp_time: iso(at), activity: kpWords(kpNow), forecast: days, local, url, source: 'NOAA Space Weather Prediction Center (Kp, OVATION aurora model)' } };
    },
  };

  const BRIGHT = [['25544', 'ISS'], ['48274', 'Tiangong'], ['20580', 'Hubble']];
  const night = {
    name: 'night_sky',
    title: "Tonight's sky at a place",
    description: "What to see in the sky tonight from a place: when it gets dark, the bright planets and where, the Moon's phase, rise and set, meteor showers, visible passes of the ISS, Tiangong and Hubble, the aurora chance, and the cloud forecast for the night, in the place's time zone.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { ...areaProps(null) } },
    async run(a, { signal }) {
      const area = await resolveArea(a, feeds, { need: true, signal }), lat = area.lat, lon = area.lon, t = now();
      const met = await feeds.json(`${METEO}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&timezone=auto&forecast_days=3&hourly=cloud_cover`, { ttl: 30 * 60e3, signal }).catch(() => null);
      const tz = met && met.timezone, c = clocks(tz), minLeft = 45 * 60e3, dark = darkWindow(lat, lon, t, { minLeft });
      const out = [], data = { place: areaData(area), timezone: tz || null };
      if (dark) { out.push(`Dark enough from ${c.full(dark.start)} until ${c.hm(dark.end)}.`); data.dark = { from: iso(dark.start), until: iso(dark.end) }; } else out.push('No dark sky here in the next day (polar day or summer twilight).');
      if (dark && met && met.hourly) {   // the cloud forecast for the dark hours
        const hrs = met.hourly.time.map((s, i) => [Date.parse(s + ':00Z') - met.utc_offset_seconds * 1000, met.hourly.cloud_cover[i]]).filter(([h, v]) => h >= dark.start && h <= dark.end && Number.isFinite(v));
        if (hrs.length) { const avg = hrs.reduce((s, [, v]) => s + v, 0) / hrs.length; out.push(`Clouds: ${avg < 20 ? 'mostly clear' : avg < 50 ? 'partly cloudy' : avg < 80 ? 'mostly cloudy' : 'overcast'} (${Math.round(avg)}% on average through the night).`); data.cloud_percent = Math.round(avg); }
      }
      const planets = planetsTonight(lat, lon, t, { time: c.hm, minLeft }), up = planets.filter(p => p.up);
      out.push(up.length ? up.map(p => p.text).join('\n') : 'None of the bright planets is up while it is dark.'); data.planets = planets.map(p => ({ name: p.name, up: p.up, text: p.text }));
      const mp = moonPhase(t), mr = riseSet('moon', lat, lon, t);
      out.push(`Moon: ${mp.name.toLowerCase()}, ${Math.round(mp.lit * 100)}% lit${mr.rise ? `, rises ${c.hm(mr.rise)}` : ''}${mr.set ? `, sets ${c.hm(mr.set)}` : ''}${mr.up === true ? ', up all day' : mr.up === false ? ', below the horizon all day' : ''}.`);
      data.moon = { phase: mp.name, lit_percent: Math.round(mp.lit * 100), rise: iso(mr.rise), set: iso(mr.set) };
      const showers = showersFor(lat, lon, t, { ahead: 14, time: c.hm, minLeft }).filter(s => s.active || s.nights <= 3);
      if (showers.length) out.push(...showers.map(s => s.text)); data.meteor_showers = showers.map(s => ({ name: s.name, peak: iso(s.peakMs), active: s.active, per_hour_tonight: s.rate, text: s.text }));
      data.passes = [];
      if (dark) {
        const sl = await ctx.sgp4(), o = observer(lat, lon, 0), seen = [];
        for (const [id, short] of BRIGHT) {
          const [s] = await findSats(feeds, id, { signal, max: 1 }).catch(() => []); if (!s) continue;
          const ps = findPasses(ms => ecefAt(sl, s, ms), o, Math.max(t, dark.start - 30 * 60e3), dark.end + 30 * 60e3, { minEl: 10, sunAt: sunEcef }).filter(p => p.visible);
          for (const p of ps) seen.push([short, p]);
        }
        seen.sort((x, y) => x[1].rise - y[1].rise);   // in the order they happen
        for (const [short, p] of seen) { out.push(describePass(short, p, { time: c.hm })); data.passes.push({ satellite: short, rise: iso(p.rise), max_elevation_deg: r1(p.maxEl), rise_direction: compass(p.azRise), set_direction: compass(p.azSet) }); }
        if (!seen.length) out.push('No bright passes of the ISS, Tiangong or Hubble tonight.');
      }
      if (Math.abs(lat) >= 40) {
        const ov = await feeds.json(`${SWPC}json/ovation_aurora_latest.json`, { ttl: 10 * 60e3, timeout: 30e3, signal }).catch(() => null);
        if (ov) { const ch = auroraAt(ov.coordinates || [], lat, lon); if (ch.level) out.push(ch.text); data.aurora = { level: ch.level, text: ch.text }; }
      }
      const camera = frame(lat, lon, 900), url = link({ camera, on: ['stations', 'visual'], time: dark ? { ms: Math.max(t, dark.start), rate: 60 } : null });
      out.push(`The night over ${area.label} on the globe (a minute a second): ${url}`);
      return { text: [`Tonight from ${area.label} (times ${tz || 'UTC'}):`, ...out].join('\n'), data: { ...data, url } };
    },
  };

  return [showOnGlobe, earthquakes, whereSat, passes, launches, crew, flybys, storms, events, ships, bikes, weather, aurora, night,
    camerasTool(ctx), transitTool(ctx), firesTool(ctx), countryTool(ctx), cablesTool(ctx), solarTool(ctx), eclipsesTool(ctx), distanceTool(ctx), volcanoesTool(ctx), roadsTool(ctx),
    conjTool(ctx), reentryTool(ctx), sunTool(ctx), meteorsTool(ctx), ...createOsmTools(ctx, link), weatherDetailsTool(ctx), aircraftTool(ctx), spaceTool(ctx), airportWxTool(ctx), seaTool(ctx), airTool(ctx), spaceWeatherTool(ctx), darkSkyTool(ctx)];
}

/** Server instructions: how the tools fit together. */
export const INSTRUCTIONS = 'Open Overwatch answers questions about the live Earth from public open data (USGS, NOAA, NASA, Launch Library 2, CelesTrak element sets, Fintraffic AIS, CityBikes, Open-Meteo, '
  + 'adsbdb, JPL Horizons and small-body elements, public traffic cameras, transit operators, TeleGeography, Wikidata, the World Bank, and OpenStreetMap through OpenFreeMap and FlockHopper map tiles). '
  + 'Every answer includes a url that opens the live 3D globe on it. When the person would like to see something, call show_on_globe with that url (or describe the view): '
  + 'in hosts with MCP Apps, such as Claude Desktop, the globe then appears in the conversation. Give people the url too.';
