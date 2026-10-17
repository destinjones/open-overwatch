// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// The service worker (sw.js) run in a fake worker: Node's own fetch classes, an in-memory Cache Storage and a scripted
// network. Checks what each kind of request does online and offline, that archived /v/<tag>/ versions and live feeds
// are never touched, the install crawl, and that a new version cleans up after the old one.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const SCOPE = 'https://destinjones.github.io/open-overwatch/';
/** Node's Request refuses mode 'navigate' and keeps no referrer: set them the way a browser's fetch event has them. */
function mkReq(url, init = {}) {
  const { mode, referrer, ...rest } = init;
  const req = new Request(url, mode && mode !== 'navigate' ? { ...rest, mode } : rest);
  if (mode === 'navigate') Object.defineProperty(req, 'mode', { value: 'navigate' });
  if (referrer) Object.defineProperty(req, 'referrer', { value: referrer });
  return req;
}
const DAY = 86400e3;

class FakeCache {
  constructor() { this.map = new Map(); }
  async put(key, res) { const k = typeof key === 'string' ? key : key.url; const body = await res.arrayBuffer(); this.map.delete(k); this.map.set(k, { body, init: { status: res.status, statusText: res.statusText, headers: [...res.headers] }, type: res.type }); }
  async match(key, opts = {}) {
    let k = typeof key === 'string' ? key : key.url;
    if (opts.ignoreSearch) k = k.split('?')[0];
    const e = this.map.get(k); if (!e) return undefined;
    return new Response(e.body.slice(0), e.init);
  }
  async add(url) { const res = await this.fetch(url); if (!res.ok) throw new Error('add failed'); await this.put(url, res); }
  async delete(key) { return this.map.delete(typeof key === 'string' ? key : key.url); }
  async keys() { return [...this.map.keys()].map(u => new Request(u)); }
}
class FakeCaches {
  constructor(fetch) { this.all = new Map(); this.fetch = fetch; }
  async open(name) { if (!this.all.has(name)) { const c = new FakeCache(); c.fetch = this.fetch; this.all.set(name, c); } return this.all.get(name); }
  async keys() { return [...this.all.keys()]; }
  async delete(name) { return this.all.delete(name); }
  async has(name) { return this.all.has(name); }
}

/** A worker built from sw.js. net: url -> Response | 'offline' | function(req) ; everything else 404. */
function worker({ net = {}, build = null, active = false } = {}) {
  const calls = [], listeners = {};
  let online = true;
  const fetch = async input => {
    const req = input instanceof Request ? input : new Request(input);
    calls.push({ url: req.url, mode: req.mode, cache: req.cache });
    if (!online) throw new TypeError('Failed to fetch');
    const h = net[req.url] ?? net[req.url.split('?')[0]];
    if (typeof h === 'function') return h(req);
    if (h instanceof Response) return h.clone();
    if (typeof h === 'string') return new Response(h, { status: 200, headers: { date: new Date().toUTCString(), 'content-type': /\.html$|\/$/.test(req.url) ? 'text/html' : 'text/javascript' } });
    return new Response('not found', { status: 404 });
  };
  const caches = new FakeCaches(fetch);
  const self = {
    registration: { scope: SCOPE, active: active ? {} : null, navigationPreload: { enable: async () => {} } },
    location: { href: SCOPE + 'sw.js' },
    clients: { claim: async () => {} },
    skipWaiting: async () => { self.skipped = true; },
    addEventListener: (t, f) => { listeners[t] = f; },
    navigator: {},
  };
  const ctx = vm.createContext({ self, caches, fetch, Request, Response, Headers, URL, URLSearchParams, setTimeout, clearTimeout, Promise, console, Date, Set, Map });
  vm.runInContext(build ? SRC.replace("const BUILD = 'dev'", `const BUILD = '${build}'`) : SRC, ctx, { filename: 'sw.js' });
  return {
    self, caches, calls, listeners, oo: self.__oo,
    set online(v) { online = v; },
    /** Run a fetch event; resolves to { res, passed, waits } once its waitUntil work is done too. */
    async request(url, init = {}) {
      const waits = [];
      const ev = { request: mkReq(url, init), waitUntil: p => waits.push(p), preloadResponse: Promise.resolve(undefined) };
      const p = self.__oo.handle(ev);
      if (!p) return { passed: true };
      let res, err;
      try { res = await p; } catch (e) { err = e; }
      await Promise.allSettled(waits);
      return { res, err, waits };
    },
    async lifecycle(type) { const waits = []; listeners[type]({ waitUntil: p => waits.push(p) }); for (const w of waits) await w; },
  };
}

const page = (url, extra = {}) => ({ ...extra, mode: 'navigate' });
const fresh = (body, ageMs = 0, headers = {}) => new Response(body, { status: 200, headers: { date: new Date(Date.now() - ageMs).toUTCString(), ...headers } });

test('every kind of request goes the right way', () => {
  const { oo } = worker();
  const k = (url, init) => oo.classify(mkReq(url, init));
  assert.equal(k(SCOPE + 'globe.html'), 'page');
  assert.equal(k(SCOPE, { mode: 'navigate' }), 'page');
  assert.equal(k(SCOPE + 'src/globe/main.js'), 'code');
  assert.equal(k(SCOPE + 'src/globe/ops.css'), 'code');
  assert.equal(k(SCOPE + 'manifest.webmanifest'), 'code');
  assert.equal(k(SCOPE + 'data/tle/starlink.txt'), 'data-live');
  assert.equal(k(SCOPE + 'data/wind.json'), 'data-live');
  assert.equal(k(SCOPE + 'data/launches.json'), 'data-live');
  assert.equal(k(SCOPE + 'versions.json'), 'data-live');
  assert.equal(k(SCOPE + 'data/borders.json'), 'data');
  assert.equal(k(SCOPE + 'data/solar/stars.bin'), 'data');
  assert.equal(k(SCOPE + 'brand/models/iss.glb'), 'asset');
  assert.equal(k(SCOPE + 'brand/textures/sky_1k/px.jpg'), 'asset');
  assert.equal(k('https://cdn.jsdelivr.net/npm/cesium@1.146.0/Build/Cesium/Cesium.js'), 'lib');
  assert.equal(k('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'), 'lib');
  assert.equal(k('https://fonts.gstatic.com/s/barlow/v12/x.woff2'), 'lib');
  assert.equal(k('https://cdn.jsdelivr.net/npm/cesium/Build/Cesium/Cesium.js'), 'pass', 'an unpinned library may change under the same URL');
  assert.equal(k('https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/default/500m/2/1/1.jpeg'), 'tile');
  assert.equal(k('https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_Black_Marble/default/2016-01-01/500m/2/1/1.png'), 'tile');
  assert.equal(k('https://terrain.reearth.land/cesium-mesh/ellipsoid/5/10/12.terrain'), 'tile');
  assert.equal(k('https://tile.openstreetmap.org/4/8/5.png'), 'tile');
});

test('live feeds, the relay, archived versions and odd requests are never touched', () => {
  const { oo } = worker();
  const k = (url, init) => oo.classify(mkReq(url, init));
  for (const url of ['https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson', 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations',
    'https://opensky-network.org/api/states/all', 'https://tilecache.rainviewer.com/v2/radar/1/256/2/1/1/2/1_1.png',
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/2/1/1.png',
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json', 'https://tiles.openfreemap.org/planet',
    // Esri's imagery: streamed live only, never kept (the owner's call, 2026-10-17)
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/1', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/1',
    'https://ibasemaps-api.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/3/2/1.jpg',
    SCOPE + 'proxy?url=https%3A%2F%2Fexample.org', SCOPE + 'sw.js', SCOPE + 'brand/clip/promo.mp4',
    SCOPE + 'v/v0.9.2.7/globe.html', SCOPE + 'v/v0.9.2.7/src/globe/main.js', 'https://destinjones.github.io/other-repo/index.html'])
    assert.equal(k(url), 'pass', url);
  assert.equal(k(SCOPE + 'data/solar/stars.bin', { referrer: SCOPE + 'v/v0.9.1/solar.html' }), 'pass', 'an archived page reading the root copy');
  assert.equal(k(SCOPE + 'index.html', { method: 'POST', body: 'x' }), 'pass');
  assert.equal(k(SCOPE + 'brand/models/iss.glb', { headers: { range: 'bytes=0-99' } }), 'pass');
  assert.equal(k('https://example.org/', { mode: 'navigate' }), 'pass');
});

test('pages: the network first, the saved copy offline, the offline page when there is none', async () => {
  const w = worker({ net: { [SCOPE + 'globe.html']: '<h1>v2</h1>', [SCOPE + 'offline.html']: '<h1>offline</h1>' } });
  let r = await w.request(SCOPE + 'globe.html?embed=1', page());
  assert.equal(await r.res.text(), '<h1>v2</h1>');
  assert.ok((await w.caches.open(w.oo.SHELL)).map.has(SCOPE + 'globe.html'), 'saved without its query');
  await (await w.caches.open(w.oo.SHELL)).put(SCOPE + 'offline.html', fresh('<h1>offline</h1>'));
  w.online = false;
  r = await w.request(SCOPE + 'globe.html', page());
  assert.equal(await r.res.text(), '<h1>v2</h1>');
  r = await w.request(SCOPE + 'solar.html', page());
  assert.equal(await r.res.text(), '<h1>offline</h1>');
  r = await w.request(SCOPE + 'src/never-seen.js');
  assert.ok(r.err, 'code with no copy fails the way it would without a worker');
});

test('a slow network loses to the saved copy after a few seconds, a fast one always wins', async () => {
  const slow = () => new Promise(res => setTimeout(() => res(fresh('new')), 6000));
  const w = worker({ net: { [SCOPE + 'src/a.js']: 'fast', [SCOPE + 'src/b.js']: slow } });
  await (await w.caches.open(w.oo.SHELL)).put(SCOPE + 'src/a.js', fresh('old'));
  await (await w.caches.open(w.oo.SHELL)).put(SCOPE + 'src/b.js', fresh('old'));
  assert.equal(await (await w.request(SCOPE + 'src/a.js')).res.text(), 'fast');
  const t0 = Date.now(), r = await w.request(SCOPE + 'src/b.js');
  assert.equal(await r.res.text(), 'old');
  assert.ok(Date.now() - t0 < 5500);
});

test('copies of live feeds are never served as fresh: online always asks, offline says how old', async () => {
  const w = worker({ net: { [SCOPE + 'data/tle/stations.txt']: fresh('ISS new') } });
  const c = await w.caches.open(w.oo.CACHES.data);
  await c.put(SCOPE + 'data/tle/stations.txt', fresh('ISS old', 60e3));
  let r = await w.request(SCOPE + 'data/tle/stations.txt');
  assert.equal(await r.res.text(), 'ISS new', 'a one-minute-old copy still goes to the network');
  assert.equal(r.res.headers.get('x-oo-offline'), null);
  w.online = false;
  r = await w.request(SCOPE + 'data/tle/stations.txt');
  assert.equal(await r.res.text(), 'ISS new');
  assert.ok(Date.parse(r.res.headers.get('x-oo-offline')) > 0, 'marked with when it was saved');
});

test('datasets under data/: the saved copy at once, refreshed in the background once it is old', async () => {
  let hits = 0;
  const w = worker({ net: { [SCOPE + 'data/borders.json']: () => { hits++; return fresh('{"v":2}'); } } });
  let r = await w.request(SCOPE + 'data/borders.json');
  assert.equal(await r.res.text(), '{"v":2}'); assert.equal(hits, 1);
  r = await w.request(SCOPE + 'data/borders.json');
  assert.equal(await r.res.text(), '{"v":2}'); assert.equal(hits, 1, 'a fresh copy needs no network');
  const c = await w.caches.open(w.oo.CACHES.data);
  await c.put(SCOPE + 'data/borders.json', fresh('{"v":1}', 2 * DAY));
  r = await w.request(SCOPE + 'data/borders.json');
  assert.equal(await r.res.text(), '{"v":1}', 'stale: the old copy at once');
  assert.equal(hits, 2, '...and a refresh behind it');
  assert.equal(await (await c.match(SCOPE + 'data/borders.json')).text(), '{"v":2}');
  w.online = false;
  r = await w.request(SCOPE + 'data/borders.json');
  assert.equal(await r.res.text(), '{"v":2}');
});

test('pinned libraries: fetched once with CORS (no opaque copies), then from the cache', async () => {
  const url = 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js';
  const w = worker({ net: { [url]: req => { const r = fresh('lib'); Object.defineProperty(r, 'type', { value: req.mode === 'cors' ? 'cors' : 'opaque' }); return r; } } });
  let r = await w.request(url, { mode: 'no-cors' });
  assert.equal(await r.res.text(), 'lib');
  assert.equal(w.calls.at(-1).mode, 'cors');
  const n = w.calls.length;
  w.online = false;
  r = await w.request(url, { mode: 'no-cors' });
  assert.equal(await r.res.text(), 'lib'); assert.equal(w.calls.length, n + 0, 'no network at all');
});

test('tiles: opaque answers are not kept, readable ones are, and the cache stays bounded', async () => {
  const osm = 'https://tile.openstreetmap.org/4/8/5.png', gibs = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/default/500m/2/1/1.jpeg';
  const opaque = () => { const r = fresh('px'); Object.defineProperty(r, 'type', { value: 'opaque' }); return r; };
  const w = worker({ net: { [osm]: req => req.mode === 'cors' ? Promise.reject(new TypeError('CORS')) : opaque(), [gibs]: () => fresh('tile') } });
  const r1 = await w.request(osm, { mode: 'no-cors' });
  assert.equal(r1.res.type, 'opaque', 'the picture still shows');
  assert.equal((await w.caches.open(w.oo.CACHES.tile)).map.size, 0);
  await w.request(gibs);
  assert.equal((await w.caches.open(w.oo.CACHES.tile)).map.size, 1);
  const c = await w.caches.open('t'); for (let i = 0; i < 30; i++) await c.put(SCOPE + 'x' + i, fresh('x'));
  await w.oo.trim('t', 10);
  assert.deepEqual([...c.map.keys()].slice(0, 2), [SCOPE + 'x20', SCOPE + 'x21'], 'the oldest go first');
});

test('Esri tiles stream live only: never kept, and copies an older version kept are dropped at activate', async () => {
  const esri = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/1', esri2 = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/4/5/6';
  const gibs = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/default/500m/2/1/1.jpeg', osm = 'https://tile.openstreetmap.org/4/8/5.png';
  const w = worker({ net: { [esri]: () => fresh('esri'), [gibs]: () => fresh('gibs') } });
  assert.equal((await w.request(esri)).passed, true, 'the browser fetches it as if there were no worker');
  assert.equal((await w.caches.open(w.oo.CACHES.tile)).map.size, 0);
  // what v0.9.2.15 and earlier left behind: Esri tiles next to NASA's and OSM's
  const tiles = await w.caches.open(w.oo.CACHES.tile);
  for (const u of [esri, esri2, gibs, osm]) await tiles.put(u, fresh('old'));
  await w.lifecycle('activate');
  assert.deepEqual([...tiles.map.keys()].sort(), [gibs, osm].sort(), 'the NASA Blue Marble and OSM copies stay for offline use');
  assert.equal(await w.oo.dropStreamOnly(), 0, 'nothing left to drop');
});

test('the install crawl finds every module a page reaches, and nothing outside the site', async () => {
  const { oo } = worker();
  assert.deepEqual([...oo.references(`<script src="src/app/shell.js" type="module"></script><script src="https://cdn.x/y.js"></script>
    <link rel="stylesheet" href="src/globe/ops.css"><link rel="manifest" href="manifest.webmanifest"><link rel="preconnect" href="https://fonts.googleapis.com">`, true)],
  ['src/app/shell.js', 'src/globe/ops.css', 'manifest.webmanifest']);
  assert.deepEqual([...oo.references(`import { a,\n b } from './a.js';\nimport * as C from "../core/c.js";\nimport './side.js';\nexport { x } from './x.js';
    const w = new Worker(new URL('./w.worker.js', import.meta.url), { type: 'module' }); const lib = await import('https://cdn/hls.mjs'); import('./lazy.js'); css.href = new URL('shell.css', import.meta.url).href; new URL('../../sw.js', import.meta.url);
    // a comment: import nothing from here`, false)].sort(), ['../../sw.js', '../core/c.js', './a.js', './lazy.js', './side.js', './w.worker.js', './x.js', 'shell.css']);
  const site = {
    'globe.html': '<script type="module" src="src/globe/main.js"></script><a href="v/v0.9/globe.html">old</a>',
    'src/globe/main.js': "import { t } from '../core/time.js'; import '../../v/v0.9/src/x.js'; new URL('../../sw.js', import.meta.url);",
    'src/core/time.js': "export const t = 1;",
    'index.html': '<script type="module" src="src/app/shell.js"></script>', 'src/app/shell.js': "import './pwa.js';", 'src/app/pwa.js': '',
  };
  const got = await oo.crawl(async href => { const rel = href.slice(SCOPE.length); if (!(rel in site)) throw new Error('404'); return site[rel]; });
  for (const f of ['src/globe/main.js', 'src/core/time.js', 'src/app/shell.js', 'src/app/pwa.js', 'offline.html']) assert.ok(got.includes(SCOPE + f), f);
  assert.ok(!got.some(u => u.includes('/v/')), 'archived files stay out');
  assert.ok(!got.includes(SCOPE + 'sw.js'), 'the worker never caches itself');
});

test('the install crawl of the real site stays under MAX_PRECACHE (a file past it would come from a newer publish)', async () => {
  const { oo } = worker(), root = new URL('../', import.meta.url);
  const got = await oo.crawl(async href => readFileSync(new URL(href.slice(SCOPE.length).replace(/\/$/, '/index.html') || 'index.html', root), 'utf8'));
  assert.ok(got.includes(SCOPE + 'src/vendor/satellite.min.js'), 'the crawl reaches the site, not just the pages');
  assert.ok(got.length < oo.MAX_PRECACHE * 0.8, got.length + ' files of ' + oo.MAX_PRECACHE + ': raise MAX_PRECACHE');
});

test('install saves the app; a new version waits, then deletes the old one\'s pages and keeps the data', async () => {
  const net = {
    [SCOPE]: '<script type="module" src="src/app/shell.js"></script>', [SCOPE + 'offline.html']: '<p>offline</p>',
    [SCOPE + 'index.html']: '<script type="module" src="src/app/shell.js"></script>', [SCOPE + 'src/app/shell.js']: "import './pwa.js';", [SCOPE + 'src/app/pwa.js']: '//',
  };
  const v1 = worker({ net, build: '0.9.2.9+aaa' });
  await v1.lifecycle('install');
  assert.ok(v1.self.skipped, 'the first worker takes over at once');
  const shell1 = await v1.caches.open('oo-shell-0.9.2.9+aaa');
  for (const f of ['', 'index.html', 'offline.html', 'src/app/shell.js', 'src/app/pwa.js']) assert.ok(shell1.map.has(SCOPE + f), f);
  assert.ok(v1.calls.every(c => c.cache === 'no-cache'), 'precache asks the server, never a stale HTTP-cache copy blindly');
  await (await v1.caches.open('oo-data-v1')).put(SCOPE + 'data/borders.json', fresh('{}'));
  await (await v1.caches.open('other-app')).put(SCOPE + 'x', fresh('x'));

  const v2 = worker({ net, build: '0.9.2.10+bbb', active: true });
  v2.caches.all = v1.caches.all;
  await v2.lifecycle('install');
  assert.ok(!v2.self.skipped, 'an update waits for the page to say so');
  await v2.lifecycle('activate');
  const names = await v2.caches.keys();
  assert.ok(!names.includes('oo-shell-0.9.2.9+aaa') && names.includes('oo-shell-0.9.2.10+bbb'));
  assert.ok(names.includes('oo-data-v1') && names.includes('other-app'), 'data copies and other caches survive');
});

test('a published build serves one version: its own pages and modules even when the site already has newer ones', async () => {
  const B = '0.9.2.15+ccc', net = {
    [SCOPE]: '<script type="module" src="src/app/shell.js"></script>', [SCOPE + 'offline.html']: '<p>offline</p>',
    [SCOPE + 'globe.html']: '<script type="module" src="src/globe/main.js"></script>', [SCOPE + 'src/globe/main.js']: "import { t } from './sats.js';",
    [SCOPE + 'src/globe/sats.js']: "const lib = new URL('../vendor/satellite.min.js', import.meta.url);", [SCOPE + 'src/vendor/satellite.min.js']: '/* v1 */',
  };
  const w = worker({ net, build: B });
  assert.equal(w.oo.ONE_VERSION, true); assert.equal(worker().oo.ONE_VERSION, false, "'dev' keeps the network first");
  await w.lifecycle('install');
  const shell = await w.caches.open(w.oo.SHELL);
  assert.ok(shell.map.has(SCOPE + 'src/vendor/satellite.min.js'), "the workers' satellite.js is saved too (offline)");
  // the next version is published: every file on the site changes, but this tab's worker has not been replaced yet
  for (const k of Object.keys(net)) net[k] = net[k] + ' /* v2 */';
  const n = w.calls.length;
  assert.equal(await (await w.request(SCOPE + 'globe.html', page())).res.text(), '<script type="module" src="src/globe/main.js"></script>');
  assert.equal(await (await w.request(SCOPE + 'src/globe/main.js', { cache: 'no-cache' })).res.text(), "import { t } from './sats.js';", 'a reload too');
  assert.equal(await (await w.request(SCOPE + 'src/vendor/satellite.min.js')).res.text(), '/* v1 */');
  assert.equal(w.calls.length, n, 'no network for what this version has');
  // a file the install missed comes from the network and is kept; offline, a page never saved gets the offline page
  net[SCOPE + 'src/late.js'] = 'late';
  assert.equal(await (await w.request(SCOPE + 'src/late.js')).res.text(), 'late');
  assert.ok(shell.map.has(SCOPE + 'src/late.js'));
  w.online = false;
  assert.equal(await (await w.request(SCOPE + 'src/globe/main.js')).res.text(), "import { t } from './sats.js';");
  assert.equal(await (await w.request(SCOPE + 'solar.html', page())).res.text(), '<p>offline</p>');
  // data still goes to the network first (a version's copy is about code, not feeds)
  w.online = true; net[SCOPE + 'data/tle/stations.txt'] = 'ISS';
  assert.equal(await (await w.request(SCOPE + 'data/tle/stations.txt')).res.text(), 'ISS');
});

test('navigation preload: on for network first (dev), off for a published build (it would fetch every page for nothing)', async () => {
  for (const [build, want] of [[null, 'enable'], ['0.9.2.15+ccc', 'disable']]) {
    const w = worker({ build }); let got = null;
    w.self.registration.navigationPreload = { enable: async () => { got = 'enable'; }, disable: async () => { got = 'disable'; } };
    await w.lifecycle('activate');
    assert.equal(got, want, String(build));
  }
});

test('the satellite workers load the vendored satellite.js by a URL the install crawl finds', () => {
  const { oo } = worker();
  for (const f of ['src/globe/satellites.js', 'src/map/satellites.js'])
    assert.ok(oo.references(readFileSync(new URL('../' + f, import.meta.url), 'utf8'), false).includes('../vendor/satellite.min.js'), f);
});

test('the page can ask for the build and for skipping the wait', async () => {
  const w = worker({ build: '1.2.3+abc' });
  let got; w.listeners.message({ data: { type: 'build' }, ports: [{ postMessage: v => { got = v; } }], waitUntil() {} });
  assert.deepEqual({ ...got }, { type: 'build', build: '1.2.3+abc' });
  w.listeners.message({ data: { type: 'skip-waiting' }, waitUntil() {} });
  assert.ok(w.self.skipped);
});
