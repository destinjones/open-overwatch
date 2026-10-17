// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The network every browser test runs behind. One rule per request, in this order:
//   1. CelesTrak is refused before it leaves the browser (it firewalled this project's PC once): counted, never fetched.
//   2. The page's own server: the relay (/proxy) answers from fixtures and never reaches upstream; the site-build copies
//      (versions.json, data/launches.json, data/wind.json) are served as fixtures; everything else is the real file.
//   3. Pinned libraries and fonts (jsDelivr, cdnjs, Google Fonts) are fetched once and kept in e2e/.cache, so a rerun
//      is offline and byte-identical (CI keeps the folder between runs).
//   4. The published site's data (destinjones.github.io/open-overwatch/...): the TLE mirror and the launch copy from
//      fixtures, any file this checkout has from disk, the rest 404.
//   5. Live feeds get canned answers (feeds.mjs); map imagery gets flat stand-in tiles.
//   6. Anything else is aborted and listed, so a test can say which host a page tried that the suite does not know.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as F from './feeds.mjs';
import { encodePng, tilePng } from './png.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CACHE = path.join(ROOT, 'e2e', '.cache', 'cdn');
const CDN = new Set(['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com']);
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
const KEEP_HEADERS = ['content-type', 'access-control-allow-origin', 'timing-allow-origin', 'cross-origin-resource-policy'];

const TILE = { dark: tilePng([24, 28, 34]), ocean: tilePng([16, 38, 66]), night: tilePng([5, 7, 12], [12, 15, 22]), clear: encodePng(256, 256, new Uint8Array(256 * 256 * 4)) };

/** Which stand-in tile an imagery request gets (null: not a tile host). */
function tileFor(u) {
  const h = u.hostname, p = u.pathname + u.search;
  if (/arcgisonline\.com$/.test(h)) return /Reference|Boundaries|Labels|Transportation/i.test(p) ? TILE.clear : /Imagery/i.test(p) ? TILE.ocean : TILE.dark;
  if (h === 'gibs.earthdata.nasa.gov') return /Black_Marble|VIIRS_Black|CityLights/i.test(p) ? TILE.night : /BlueMarble|Blue_Marble/i.test(p) ? TILE.ocean : TILE.clear;
  if (/(^|\.)tile\.openstreetmap\.org$|basemaps\.cartocdn\.com$|tile\.opentopomap\.org$|tiles\.stadiamaps\.com$/.test(h)) return TILE.dark;
  if (/(^|\.)rainviewer\.com$/.test(h) && /\.png$/.test(u.pathname)) return TILE.clear;
  return null;
}

/** Canned JSON (or text) for a feed URL; undefined when the suite has no fixture for it. */
export function fixtureFor(href, now = Date.now()) {
  const u = new URL(href), h = u.hostname, p = u.pathname;
  if (h === 'earthquake.usgs.gov' && /\.geojson$/.test(p)) return F.usgs(now);
  if (h === 'earthquake.usgs.gov' && p === '/fdsnws/event/1/query') return F.catalogue(href);   // time travel
  if (h === 'www.seismicportal.eu' && p === '/fdsnws/event/1/query') return F.emsc(now);   // EMSC, the quakes' second catalogue
  if (h === 'eonet.gsfc.nasa.gov') return F.eonet(now);
  if (h === 'services.swpc.noaa.gov' && /k-index/.test(p)) return F.kp(now);
  if (h === 'services.swpc.noaa.gov' && /ovation/.test(p)) return F.ovation(now);
  if (h === 'services.swpc.noaa.gov') {   // the Sun now (core/spaceweather.js SW_URLS)
    const sw = { '/json/rtsw/rtsw_mag_1m.json': F.swMag, '/json/rtsw/rtsw_wind_1m.json': F.swWind, '/json/goes/primary/xray-flares-latest.json': F.swFlare,
      '/json/goes/primary/xray-flares-7-day.json': F.swFlares, '/json/goes/primary/xrays-1-day.json': F.swXrays, '/products/alerts.json': F.swAlerts,
      '/products/summary/solar-wind-mag-field.json': F.swMagNow, '/products/summary/solar-wind-speed.json': F.swWindNow }[p];
    if (sw) return sw(now);
  }
  if (h === 'api.weather.gov') return F.EMPTY.nws();
  if (h === 'www.nhc.noaa.gov' && /CurrentStorms/.test(p)) return F.EMPTY.nhc();
  if (h === 'www.gdacs.org') return F.EMPTY.gdacs();
  if (h === 'mapservices.weather.noaa.gov') return F.EMPTY.arcgis();
  if (/^(api\.adsb\.lol|opendata\.adsb\.fi|api\.airplanes\.live|api\.adsb\.one)$/.test(h)) return F.readsb(href, now);
  if (h === 'opensky-network.org' && /states/.test(p)) return F.opensky(now);
  if (h === 'api.wheretheiss.at') return F.wheretheiss(now);
  if (h === 'api.github.com' && /releases\/latest$/.test(p)) return F.githubRelease();
  if (h === 'll.thespacedevs.com' && /launch/.test(p)) return F.launches(now);
  if (h === 'll.thespacedevs.com' && /astronaut/.test(p)) return F.astronauts(now);
  if (h === 'api.open-meteo.com' && p === '/v1/forecast' && /cloud_cover/.test(u.search) && !/[,;]/.test(u.searchParams.get('latitude') || '')) return F.openMeteoClouds(href, now);   // one point (Tonight), never a grid
  return undefined;
}

/** A path of the published site (or the site-build copies served locally): fixture, the checkout's own file, or null. */
function siteFile(rel, now = Date.now()) {
  if (/^data\/tle\/[\w.-]+\.txt$/.test(rel)) return { body: F.tle(), type: 'text/plain; charset=utf-8' };
  if (rel === 'data/launches.json') return { body: JSON.stringify(F.launches(now)), type: 'application/json' };
  if (rel === 'data/astronauts.json') return { body: JSON.stringify(F.astronauts(now)), type: 'application/json' };
  if (rel === 'data/wind.json') return { body: JSON.stringify(F.wind()), type: 'application/json' };
  // the site build's archive of past element sets (core/history.js): one day, today's fixture elements, so a rewind finds it
  if (rel === 'data/tle/history/index.json') return { body: JSON.stringify({ days: [{ day: new Date(now).toISOString().slice(0, 10), at: now, n: 1 }] }), type: 'application/json' };
  if (/^data\/tle\/history\/[\w.-]+\.txt$/.test(rel)) return { body: F.tle(), type: 'text/plain; charset=utf-8' };
  if (rel === 'versions.json') return { body: JSON.stringify(F.versions()), type: 'application/json' };
  return null;
}

async function cdn(route, u) {
  const key = createHash('sha1').update(u.href).digest('hex'), file = path.join(CACHE, key), meta = file + '.json';
  if (existsSync(meta) && existsSync(file)) {
    const m = JSON.parse(readFileSync(meta, 'utf8'));
    return route.fulfill({ status: 200, headers: m.headers, body: readFileSync(file) });
  }
  let r, body;
  try { r = await route.fetch({ timeout: 60000 }); body = await r.body(); }
  catch (e) { return route.abort('internetdisconnected').catch(() => {}); }   // offline, or the page went away mid-fetch
  const all = r.headers(), headers = {};
  for (const k of KEEP_HEADERS) if (all[k]) headers[k] = all[k];
  if (r.status() === 200) { mkdirSync(CACHE, { recursive: true }); writeFileSync(file, body); writeFileSync(meta, JSON.stringify({ url: u.href, headers })); }
  return route.fulfill({ status: r.status(), headers, body }).catch(() => {});
}

/**
 * Put a browser context behind the stub network. Returns the log the tests read:
 * { celestrak: n refused, blocked: [urls aborted as unknown], fixtures: [urls answered from fixtures], relayed: [urls the
 *   page asked the local relay for] }. `extra(url)` may return { status, body, type } to answer a URL first (per test);
 *   `now()` is the moment the time-relative fixtures are made for (a test that fixes the page's clock passes the same).
 */
export async function stubNetwork(context, { port, extra, now = () => Date.now() } = {}) {
  const log = { celestrak: 0, blocked: [], fixtures: [], relayed: [], media: [], tiles: 0 };
  const json = (route, data, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json' }, body: typeof data === 'string' ? data : JSON.stringify(data) });
  // Video is refused: with request interception on, a playing <video> in headless Chromium stalls the page's other
  // requests (local modules, fonts, fixtures) until the test times out. The landing page's hero and demo clips are
  // decoration with still-image fallbacks; tests check that the right clip is asked for, not that it plays.
  const MEDIA = /\.(mp4|webm)$/i;
  await context.route(() => true, async route => {
    const req = route.request(), href = req.url();
    let u; try { u = new URL(href); } catch (e) { return route.continue(); }
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    if (/(^|\.)celestrak\.(org|com)$/.test(u.hostname)) { log.celestrak++; return route.abort('blockedbyclient'); }
    if (MEDIA.test(u.pathname)) { log.media.push(href); return route.abort('blockedbyclient'); }
    const custom = extra && await extra(u);
    if (custom) return route.fulfill({ status: custom.status || 200, headers: { ...CORS, 'content-type': custom.type || 'application/json' }, body: typeof custom.body === 'string' || Buffer.isBuffer(custom.body) ? custom.body : JSON.stringify(custom.body) });
    const own = (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && +u.port === port;
    if (own) {
      if (u.pathname === '/proxy') {
        if (u.searchParams.has('ping')) return route.continue();
        const target = u.searchParams.get('url') || ''; log.relayed.push(target);
        const fx = (() => { try { return fixtureFor(target, now()); } catch (e) { return undefined; } })();
        return fx === undefined ? route.fulfill({ status: 503, headers: CORS, body: 'stubbed upstream (e2e): no fixture for this feed' }) : json(route, fx);
      }
      const f = siteFile(u.pathname.replace(/^\/+/, ''), now());
      if (f) { log.fixtures.push(href); return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': f.type }, body: f.body }); }
      return route.continue();
    }
    if (CDN.has(u.hostname)) return cdn(route, u);
    if (u.hostname === 'destinjones.github.io' && u.pathname.startsWith('/open-overwatch/')) {
      const rel = decodeURIComponent(u.pathname.slice('/open-overwatch/'.length));
      const f = siteFile(rel, now());
      if (f) { log.fixtures.push(href); return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': f.type }, body: f.body }); }
      const local = path.join(ROOT, rel);
      if (rel && !rel.includes('..') && existsSync(local) && statSync(local).isFile()) return route.fulfill({ status: 200, headers: CORS, path: local });
      return route.fulfill({ status: 404, headers: CORS, body: 'not in this checkout (e2e)' });
    }
    const fx = fixtureFor(href, now());
    if (fx !== undefined) { log.fixtures.push(href); return json(route, fx); }
    const tile = tileFor(u);
    if (tile) { log.tiles++; return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: tile }); }
    log.blocked.push(href);
    return route.abort('blockedbyclient');
  });
  return log;
}
