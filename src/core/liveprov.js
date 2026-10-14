// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Provenance for the live layers: who each feed is, how old a layer's data may be before it is stale, and the stamp a
// layer puts on each item so every card (globe, 2D map) and every MCP answer says the same thing about it. The record
// itself is provenance.js; this is the per-layer side of it. Pure: no DOM (test/liveprov.test.mjs).
//
// A layer stamps an item when it builds it:  stamp(item, 'quakes', [rep('usgs', { dataAt: doc.metadata.generated })])
// and the card asks, at the moment it is drawn:  provBlock(item)  (or recordOf / provLine). The age is worked out then,
// from the data time the upstream gave, so an open card never says "1 min old" of a report an hour old.

import { source, provenance, provenanceText, provenanceHtml } from './provenance.js';

const MIN = 60e3, H = 3600e3, D = 864e5;

/** Who the feeds are: the name a card shows, the page it links to, the terms. */
export const SOURCES = Object.freeze({
  usgs: { name: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/', licence: 'public domain' },
  gdacs: { name: 'GDACS', url: 'https://www.gdacs.org/', licence: 'GDACS terms: credit GDACS and the source agency' },
  eonet: { name: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/', licence: 'public domain' },
  nhc: { name: 'NOAA NHC', url: 'https://www.nhc.noaa.gov/', licence: 'public domain' },
  adsblol: { name: 'adsb.lol', url: 'https://adsb.lol/', licence: 'ODbL' },
  adsbfi: { name: 'adsb.fi', url: 'https://adsb.fi/', licence: 'adsb.fi open-data terms' },
  adsbone: { name: 'adsb.one', url: 'https://adsb.one/', licence: 'community feed' },
  airplaneslive: { name: 'airplanes.live', url: 'https://airplanes.live/', licence: 'by permission' },
  opensky: { name: 'OpenSky', url: 'https://opensky-network.org/', licence: 'OpenSky terms (non-commercial)' },
  celestrak: { name: 'CelesTrak', url: 'https://celestrak.org/', licence: 'free, credit CelesTrak' },
  firms: { name: 'NASA FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov/', licence: 'NASA open data' },
  viirs: { name: 'NASA VIIRS (GIBS)', url: 'https://nasa-gibs.github.io/gibs-api-docs/', licence: 'NASA open data' },
  nifc: { name: 'NIFC WFIGS', url: 'https://data-nifc.opendata.arcgis.com/', licence: 'public domain' },
  digitraffic: { name: 'Fintraffic Digitraffic', url: 'https://www.digitraffic.fi/en/marine-traffic/', licence: 'CC BY 4.0' },
  aisstream: { name: 'aisstream.io', url: 'https://aisstream.io/', licence: 'aisstream.io terms' },
  mbta: { name: 'MBTA', url: 'https://www.mbta.com/developers', licence: 'MassDOT Developers License' },
  hsl: { name: 'HSL', url: 'https://digitransit.fi/en/developers/', licence: 'CC BY 4.0' },
  entur: { name: 'Entur', url: 'https://developer.entur.org/', licence: 'NLOD 2.0' },
  capmetro: { name: 'CapMetro', url: 'https://data.texas.gov/d/eiei-9rpf', licence: 'Texas Open Data' },
  metrotransit: { name: 'Metro Transit', url: 'https://svc.metrotransit.org/', licence: 'Metro Transit terms' },
  citybikes: { name: 'CityBikes', url: 'https://citybik.es/', licence: 'CityBikes terms' },
  ndbc: { name: 'NOAA NDBC', url: 'https://www.ndbc.noaa.gov/', licence: 'public domain' },
  coops: { name: 'NOAA CO-OPS', url: 'https://tidesandcurrents.noaa.gov/', licence: 'public domain' },
  openmeteo: { name: 'Open-Meteo', url: 'https://open-meteo.com/', licence: 'CC BY 4.0' },
  sondehub: { name: 'SondeHub', url: 'https://sondehub.org/', licence: 'amateur network' },
  nws: { name: 'NWS', url: 'https://www.weather.gov/', licence: 'public domain' },
  gdelt: { name: 'GDELT', url: 'https://www.gdeltproject.org/', licence: 'open data' },
  ll2: { name: 'Launch Library 2', url: 'https://thespacedevs.com/', licence: 'The Space Devs terms' },
  osm: { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL' },
  nycdot: { name: 'NYC DOT', url: 'https://data.cityofnewyork.us/Transportation/DOT-Traffic-Speeds-NBE/i4gi-tjb9', licence: 'NYC Open Data' },
  radiobrowser: { name: 'radio-browser.info', url: 'https://www.radio-browser.info/', licence: 'free, without guarantee' },
  swpc: { name: 'NOAA SWPC', url: 'https://www.swpc.noaa.gov/', licence: 'public domain' },
  cameras: { name: 'Traffic camera network', url: null, licence: 'each network\'s terms' },
});

/**
 * How old each layer's data may be before its cards say "stale", and what its data time is. The times are the
 * upstream's own (measured or issued), never our download time.
 */
export const LAYERS = Object.freeze({
  aircraft: { maxAgeMs: 2 * MIN, dataAt: 'the position\'s own time (readsb now − seen_pos; OpenSky time_position)' },
  satellites: { maxAgeMs: 3 * D, dataAt: 'the element set\'s epoch (SGP4 error grows ~1-3 km a day after it)' },
  reentry: { maxAgeMs: 3 * D, dataAt: 'the element set\'s epoch; each prediction sets its own limit, a fifth of the time it had left (core/decay.js)' },
  quakes: { maxAgeMs: 30 * MIN, dataAt: 'when USGS generated the summary (it does every minute); a solution\'s own update time without it' },
  events: { maxAgeMs: 7 * D, dataAt: 'the event\'s newest dated geometry' },
  gdacs: { maxAgeMs: 2 * D, dataAt: 'GDACS\'s last change to the event' },
  storms: { maxAgeMs: 9 * H, dataAt: 'the advisory or fix time (NHC advises every 6 h, 3 h with watches out)' },
  fires: { maxAgeMs: 24 * H, dataAt: 'the satellite\'s acquisition time' },
  perimeters: { maxAgeMs: 2 * D, dataAt: 'when the perimeter was last mapped' },
  ships: { maxAgeMs: 15 * MIN, dataAt: 'the AIS position report\'s time' },
  transit: { maxAgeMs: 3 * MIN, dataAt: 'the vehicle\'s own report time' },
  cameras: { maxAgeMs: 20 * MIN, dataAt: 'the picture\'s time where the network gives one' },
  bikes: { maxAgeMs: 6 * H, dataAt: 'the station\'s last report' },
  buoys: { maxAgeMs: 3 * H, dataAt: 'the observation time (stations report about hourly)' },
  dart: { maxAgeMs: 7 * H, dataAt: 'the newest water-column height (standard mode reports every 6 h)' },
  tides: { maxAgeMs: H, dataAt: 'the newest 6-minute water level' },
  airq: { maxAgeMs: 3 * H, dataAt: 'the model hour Open-Meteo returns' },
  balloons: { maxAgeMs: 10 * MIN, dataAt: 'the sonde\'s frame time' },
  alerts: { maxAgeMs: D, dataAt: 'when the alert was sent' },
  news: { maxAgeMs: D, dataAt: 'when GDELT saw the article' },
  launches: { maxAgeMs: 12 * H, dataAt: 'Launch Library\'s last update of the launch' },
  osm: { maxAgeMs: 2 * H, dataAt: 'when the tiles were built (hourly), if they say' },
  traffic: { maxAgeMs: 4 * H, dataAt: 'NYC DOT\'s data_as_of (published 2.5-3 h late)' },
  radio: { maxAgeMs: 7 * D, dataAt: 'the directory\'s last good check of the stream' },
  aurora: { maxAgeMs: 3 * H, dataAt: 'the newest Kp reading or OVATION forecast time' },
  weather: { maxAgeMs: 3 * H, dataAt: 'the model time of the current conditions' },
  history: { maxAgeMs: 200 * 365 * D, dataAt: 'the archived record\'s own time (time travel: a record of the past, never stale)' },
});

/** One source's report for a stamp: the catalogue's name, link and terms plus this report's times. */
export function rep(id, { dataAt = null, fetchedAt = null, cached = false, name = null, url } = {}) {
  const s = SOURCES[id] || {};
  return source({ id, name: name || s.name || id, url: url !== undefined ? url : s.url || null, licence: s.licence || null, dataAt, fetchedAt, cached });
}

/**
 * Put the stamp on an item (and return the item): its layer and its sources' reports. agreeing: the ids of the reports that
 * say the same thing (agreeingIds below); default all. The record is made when asked (recordOf), so ages stay true.
 */
export function stamp(item, layer, reports, { agreeing = null } = {}) {
  if (!item || typeof item !== 'object') return item;
  item.prov = provStamp(layer, reports, agreeing);
  return item;
}
/** The stamp itself ({ layer, sources, agreeing }), for objects that work it out in a getter (`get prov()` on a prototype). */
export function provStamp(layer, reports, agreeing = null) {
  const list = (Array.isArray(reports) ? reports : [reports]).filter(r => r && r.id).map(r => rep(r.id, r));
  return { layer, sources: list, agreeing: agreeing ? [...agreeing] : null };
}

/** The provenance record of a stamped item at `now`, or null without a stamp. */
export function recordOf(item, now = Date.now()) {
  const p = item && item.prov;
  if (!p || !Array.isArray(p.sources)) return null;
  const maxAgeMs = p.maxAgeMs ?? (LAYERS[p.layer] || {}).maxAgeMs ?? H;   // an item may set its own (re-entry predictions do)
  return provenance(p.sources, { now, maxAgeMs, agreeing: p.agreeing });
}

/** The card block for a stamped item ('' without a stamp, so cards of static things show nothing). */
export const provBlock = (item, now = Date.now()) => { const r = recordOf(item, now); return r ? provenanceHtml(r) : ''; };
/** One plain line for a stamped item (MCP answers, exports, tooltips), or null. */
export const provLine = (item, now = Date.now()) => { const r = recordOf(item, now); return r ? provenanceText(r) : null; };

/**
 * Which reports agree: the freshest report is the reference and every report `same(ref, r)` agrees with it. reports:
 * [{ src (source id), t (data time, ms), ...whatever same() reads }]. Returns the agreeing source ids (the reference's
 * first). Reports from the same source count once.
 */
export function agreeingIds(reports, same) {
  const list = (reports || []).filter(r => r && r.src);
  if (!list.length) return [];
  const ref = list.reduce((a, b) => ((b.t ?? -Infinity) > (a.t ?? -Infinity) ? b : a));
  const ids = [ref.src];
  for (const r of list) if (!ids.includes(r.src) && same(ref, r)) ids.push(r.src);
  return ids;
}

/** Metres between two { lat, lon } (haversine; good to ~0.5% for agreement checks). */
export function metresBetween(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Stamp from agreement reports ([{ src, t }], as agreeingIds and the layers' merge code keep them). cached: the source
 *  ids that came through a copy (the relay, the site mirror). */
export function stampReports(item, layer, reports, agreeing = null, { cached = [] } = {}) {
  return stamp(item, layer, (reports || []).map(r => ({ id: r.src, name: r.name || null, dataAt: r.t ?? null, cached: cached.includes(r.src) })), { agreeing });
}

/** The provenance line for reports that need no item (an MCP answer): lineFor('ships', [rep('digitraffic', { dataAt })], { now }). */
export const lineFor = (layer, reports, { agreeing = null, now = Date.now() } = {}) => provLine(stamp({}, layer, reports, { agreeing }), now);
