// Open Overwatch's service worker: the installable app and its offline copy. A classic script (module workers are still
// patchy), scoped to the site root. src/app/pwa.js registers it on the website only (on the local helper with ?sw=1).
//
// What it does with each request (classify() below; test/sw.test.mjs runs this file in a fake worker):
//   pages + code (html, src/, css, manifest)  network first, the saved copy when offline or after 4 s with no answer;
//                                             every page is kept, so the app opens with no connection at all
//   data/ copies of live feeds (TLEs, wind,   network first: never served as if fresh. Offline, the last copy comes
//   launches, news, versions.json …)          back marked with an x-oo-offline header (when it was saved)
//   data/ datasets (borders, stars, …)        stale-while-revalidate: the saved copy at once, refreshed in the
//                                             background once it is a day old (big binaries: a week)
//   brand/ assets (textures, models)          stale-while-revalidate, refreshed when a week old
//   pinned CDN libraries, fonts               cache first (the URL names an exact version), fetched with CORS so no
//                                             opaque copy eats storage quota
//   base map / terrain tiles                  cache first for 30 days, CORS answers only, at most 1,200 tiles
//   everything else (live feeds, the relay,   not touched: the browser fetches it as if there were no worker
//   /v/<tag>/ archived versions, ranges, POST)
//
// Versions: build_site.py stamps BUILD with the version and commit when the website is built, so every published
// version is a new worker. A new worker waits until the page says so (the "new version" prompt in src/app/pwa.js),
// except the very first one, which takes over at once. Old versions' page caches are deleted when a new one starts.

const BUILD = 'dev'; // stamped by .github/build_site.py: '<version>+<commit>'
const SHELL = 'oo-shell-' + BUILD;
const CACHES = { data: 'oo-data-v1', asset: 'oo-asset-v1', lib: 'oo-lib-v1', tile: 'oo-tile-v1' };
const LIMITS = { data: 200, asset: 400, lib: 600, tile: 1200, shell: 600 };
const KEEP = [SHELL, ...Object.values(CACHES)];
const NET_TIMEOUT = 4000;      // ms before a slow network loses to the saved copy (pages, code)
const LIVE_TIMEOUT = 8000;     // the same for copies of live feeds: wait longer, a fresh copy matters more
const DAY = 86400e3;
const SCOPE = new URL(self.registration ? self.registration.scope : './', self.location.href);

// the pages and the small files that make the app open offline; the modules each page imports are found by crawling
const PAGES = ['index.html', 'globe.html', 'open-overwatch.html', 'solar.html', 'tonight.html', 'about.html'];
const CORE = ['./', 'offline.html', 'manifest.webmanifest', 'brand/emblem/favicon.svg', 'brand/emblem/emblem-256.png',
  'brand/emblem/emblem-512.png', 'brand/emblem/apple-touch-icon.png'];
const MAX_PRECACHE = 450;      // files; the whole of src/ is about 200

// data/ files that copy a live feed (build_site.py refreshes them every 6 h): never "fresh" from the cache
const LIVE_DATA = /^data\/(tle\/|socrates\.json|wind\.json|flybys\.json|launches\.json|astronauts\.json|news\.json|index\.json)|^versions\.json$/;
const LIB_HOSTS = /^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)$/;
const FONT_HOSTS = /^fonts\.(googleapis|gstatic)\.com$/;
const PINNED = /@\d+\.\d+|\/ajax\/libs\/[^/]+\/\d+\.\d+/;   // npm@1.2.3 or cdnjs /ajax/libs/name/1.2.3/
const TILE_EXT = /\.(png|jpe?g|webp|pbf|mvt|terrain)$/i;

/** Which way a request goes: 'pass' | 'page' | 'code' | 'data-live' | 'data' | 'asset' | 'lib' | 'tile'. */
function classify(req) {
  if (req.method !== 'GET') return 'pass';
  const h = req.headers;
  if (h && typeof h.get === 'function' && h.get('range')) return 'pass';           // partial content (video) can't be cached whole
  let url;
  try { url = new URL(req.url); } catch { return 'pass'; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'pass';
  if (url.origin === SCOPE.origin) {
    if (!url.pathname.startsWith(SCOPE.pathname)) return 'pass';                    // another site on the same host
    const rel = url.pathname.slice(SCOPE.pathname.length);
    if (archived(rel) || fromArchived(req)) return 'pass';                          // frozen versions keep their own files
    if (/^(proxy|relay)\b/.test(rel) || rel === 'sw.js' || url.searchParams.has('url')) return 'pass';   // the local relay, the worker itself
    if (rel.startsWith('brand/clip/')) return 'pass';                               // video: big, and played with ranges
    if (LIVE_DATA.test(rel)) return 'data-live';
    if (rel.startsWith('data/')) return 'data';
    if (req.mode === 'navigate' || rel === '' || /\.html$/.test(rel)) return 'page';
    if (rel.startsWith('brand/')) return 'asset';
    if (/\.(m?js|css|json|webmanifest|svg|txt)$/.test(rel)) return 'code';
    return 'pass';
  }
  if (req.mode === 'navigate') return 'pass';
  const host = url.hostname;
  if (FONT_HOSTS.test(host)) return 'lib';
  if (LIB_HOSTS.test(host)) return PINNED.test(url.pathname) ? 'lib' : 'pass';
  if (isTile(url)) return 'tile';
  return 'pass';
}

/** Base maps and terrain that don't change from day to day (live layers such as radar or GIBS "best" IR stay out). */
function isTile(url) {
  const host = url.hostname, path = url.pathname;
  if (/^(services|server)\.arcgisonline\.com$/.test(host)) return /\/MapServer\/tile\//.test(path);
  if (host === 'gibs.earthdata.nasa.gov') return /\/(BlueMarble_NextGeneration|VIIRS_Black_Marble)\//.test(path) && TILE_EXT.test(path);
  if (/^([abc]\.)?tile\.openstreetmap\.org$/.test(host)) return TILE_EXT.test(path);
  if (host === 'tiles.openfreemap.org') return /\.pbf$/.test(path);
  if (host === 'terrain.reearth.land') return /\.terrain$/.test(path);
  return false;
}

function archived(rel) { return /^v\/[^/]+\//.test(rel); }
function fromArchived(req) {
  if (!req.referrer || req.referrer === 'about:client') return false;
  try { const r = new URL(req.referrer); return r.origin === SCOPE.origin && r.pathname.startsWith(SCOPE.pathname) && archived(r.pathname.slice(SCOPE.pathname.length)); }
  catch { return false; }
}

/** Same-origin copies are kept under the URL without its query (globe.html?embed=1 is globe.html). */
function keyOf(req, kind) {
  if (kind === 'lib' || kind === 'tile') return req.url;
  const u = new URL(req.url); u.search = ''; u.hash = '';
  return u.href;
}

/** How old a saved response is (ms), from its Date header (the HTTP cache updates it when a copy is revalidated). */
function ageOf(res, now = Date.now()) {
  const d = res && res.headers && Date.parse(res.headers.get('date') || '');
  return Number.isFinite(d) ? Math.max(0, now - d) : Infinity;
}

/** A saved copy handed out because the network failed: same body, plus when it was saved. */
function markOffline(res) {
  if (!res || res.type === 'opaque') return res;
  const headers = new Headers(res.headers);
  headers.set('x-oo-offline', res.headers.get('date') || 'unknown');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const cacheFor = kind => kind === 'page' || kind === 'code' ? SHELL : CACHES[kind === 'data-live' ? 'data' : kind];
const limitFor = kind => kind === 'page' || kind === 'code' ? LIMITS.shell : LIMITS[kind === 'data-live' ? 'data' : kind];
const okToKeep = (res, kind) => !!res && res.ok && res.status === 200 && (res.type === 'basic' || res.type === 'cors' || res.type === 'default')
  && !(kind === 'tile' && /no-store/i.test(res.headers.get('cache-control') || ''));   // our own files are ours to keep (the local helper says no-store to everything)

const putCount = {};
async function keep(kind, key, res) {
  if (!okToKeep(res, kind)) return;
  const name = cacheFor(kind);
  try {
    const c = await caches.open(name);
    await c.put(key, res);
    putCount[name] = (putCount[name] || 0) + 1;
    if (putCount[name] % 25 === 0) await trim(name, limitFor(kind));
  } catch { /* quota or a body already read: the copy is optional */ }
}

/** Keep a cache to `max` entries, dropping the oldest saved (keys come back in the order they were saved). */
async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function saved(kind, key) {
  try { const c = await caches.open(cacheFor(kind)); return (await c.match(key, { ignoreVary: true })) || null; } catch { return null; }
}

const timeout = ms => new Promise(r => setTimeout(() => r(null), ms));

/** Network first: the network's answer (saved for later), else the saved copy, else what `fallback` gives. */
async function networkFirst(event, kind, key, wait, fallback, preload) {
  const req = event.request;
  const net = (async () => {
    const res = (preload && await preload.catch(() => null)) || await fetch(req);
    if (okToKeep(res, kind)) { const copy = res.clone(); event.waitUntil(keep(kind, key, copy)); }
    return res;
  })();
  net.catch(() => {});
  const copy = saved(kind, key);
  // race only when there is something to fall back to: no copy means waiting for the network as long as it takes
  const first = await Promise.race([net.then(r => ({ r }), () => ({ r: null, failed: true })), copy.then(c => c ? timeout(wait).then(() => ({ r: null, slow: true })) : new Promise(() => {}))]);
  if (first.r) return first.r;
  const old = await copy;
  if (old) return kind === 'data-live' ? markOffline(old) : old;
  if (first.slow) { const r = await net.catch(() => null); if (r) return r; }
  const f = fallback && await fallback();
  if (f) return f;
  return net;   // rejects: the page sees the same network error it would without a worker
}

/** Stale-while-revalidate with a freshness window: a copy younger than `fresh` ms is used as is, an older one is used
 *  and refreshed in the background, no copy means the network. */
async function staleWhileRevalidate(event, kind, key, fresh) {
  const old = await saved(kind, key);
  const refresh = () => fetch(event.request).then(res => { if (okToKeep(res, kind)) return keep(kind, key, res.clone()).then(() => res); return res; });
  if (!old) return refresh();
  if (ageOf(old) > fresh) event.waitUntil(refresh().catch(() => {}));
  return old;
}

/** Cache first for things whose URL never changes content (pinned libraries) or barely does (tiles, `maxAge`). */
async function cacheFirst(event, kind, key, maxAge) {
  const old = await saved(kind, key);
  if (old && ageOf(old) <= maxAge) return old;
  const req = event.request;
  // a <script> or <link> without crossorigin asks no-cors; asking these CDNs with CORS gives a readable copy instead of
  // an opaque one (which Chrome counts as megabytes of quota), and a CORS answer may serve a no-cors request
  const viaCors = req.mode === 'no-cors' ? new Request(req.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }) : req;
  try {
    let res = await fetch(viaCors);
    if (!res.ok && viaCors !== req) res = await fetch(req);
    if (okToKeep(res, kind)) event.waitUntil(keep(kind, key, res.clone()));
    return res;
  } catch (e) {
    if (viaCors !== req) { try { return await fetch(req); } catch { /* offline */ } }
    if (old) return old;
    throw e;
  }
}

async function offlinePage() {
  const c = await caches.open(SHELL);
  return (await c.match(new URL('offline.html', SCOPE).href)) || new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p>You are offline and this page was not saved yet.</p>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function handle(event) {
  const req = event.request, kind = classify(req);
  if (kind === 'pass') return null;
  const key = keyOf(req, kind);
  const reload = req.cache === 'no-store' || req.cache === 'reload' || req.cache === 'no-cache';   // the page asked for fresh
  switch (kind) {
    case 'page': return networkFirst(event, kind, key, NET_TIMEOUT, offlinePage, event.preloadResponse);
    case 'code': return networkFirst(event, kind, key, NET_TIMEOUT);
    case 'data-live': return networkFirst(event, kind, key, LIVE_TIMEOUT);
    case 'data': return reload ? networkFirst(event, kind, key, LIVE_TIMEOUT) : staleWhileRevalidate(event, kind, key, /\.bin$/.test(key) ? 7 * DAY : DAY);
    case 'asset': return reload ? networkFirst(event, kind, key, NET_TIMEOUT) : staleWhileRevalidate(event, kind, key, 7 * DAY);
    case 'lib': return cacheFirst(event, kind, key, 365 * DAY);
    case 'tile': return cacheFirst(event, kind, key, 30 * DAY);
  }
  return null;
}

self.addEventListener('fetch', event => {
  const p = handle(event);
  if (p) event.respondWith(p);
});

// ---- install: the pages, then every module they import (found by reading them), into this version's cache ----

/** Relative module and stylesheet references in a page or a module: src="…", href="….css", import … from '…',
 *  import('…'), new URL('…', import.meta.url) (how the modules start their workers). Only plain relative paths; nothing built at run time. */
function references(text, isPage) {
  const out = new Set(), add = s => { if (s && !/^(https?:|data:|blob:|\/\/|#|mailto:)/i.test(s) && /\.(m?js|css|json|svg|png|webmanifest)(\?|$)/.test(s)) out.add(s); };
  if (isPage) {
    for (const m of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
    for (const m of text.matchAll(/<link\b[^>]*\brel\s*=\s*["']?(?:stylesheet|manifest|icon|apple-touch-icon|modulepreload)["']?[^>]*>/gi)) { const h = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0]); if (h) add(h[1]); }
  } else {
    for (const m of text.matchAll(/\b(?:import|export)\s+(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']/g)) add(m[1]);
    for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) add(m[1]);
    for (const m of text.matchAll(/\bnew\s+URL\(\s*["']([^"']+\.(?:m?js|json|css))["']\s*,\s*import\.meta\.url\s*\)/g)) add(m[1]);
  }
  return [...out];
}

/** Everything the app needs to open offline: CORE + PAGES + the modules and styles they reach, same site, under scope. */
async function crawl(fetchText, limit = MAX_PRECACHE) {
  const seen = new Set(), queue = [];
  const push = (ref, base) => {
    let u; try { u = new URL(ref, base); } catch { return; }
    const rel = u.pathname.slice(SCOPE.pathname.length);
    if (u.origin !== SCOPE.origin || !u.pathname.startsWith(SCOPE.pathname) || archived(rel) || rel === 'sw.js') return;
    u.search = ''; u.hash = '';
    if (seen.has(u.href) || seen.size >= limit) return;
    seen.add(u.href); queue.push(u.href);
  };
  for (const p of [...CORE, ...PAGES]) push(p, SCOPE);
  while (queue.length) {
    const batch = queue.splice(0, 6);
    await Promise.all(batch.map(async href => {
      if (!/\.(html|m?js)$/.test(href) && !href.endsWith('/')) return;
      const text = await fetchText(href).catch(() => null);
      if (text) for (const r of references(text, /\.html$|\/$/.test(href))) push(r, href);
    }));
  }
  return [...seen];
}

async function precache() {
  const c = await caches.open(SHELL), bodies = new Map();
  const conn = self.navigator && self.navigator.connection;
  // ask the server (the HTTP cache may answer with a quick 304); keep the answers so nothing is downloaded twice
  const get = async href => {
    const res = await fetch(new Request(href, { cache: 'no-cache', credentials: 'same-origin' }));
    if (!res.ok) throw new Error(res.status + ' ' + href);
    bodies.set(href, res.clone());
    return res;
  };
  const urls = conn && conn.saveData ? [...CORE, ...PAGES].map(p => new URL(p, SCOPE).href)
    : await crawl(href => get(href).then(r => r.clone().text()));
  let ok = 0;
  await Promise.all(urls.map(async href => {
    try { const res = bodies.get(href) || await get(href); await c.put(href, res); ok++; } catch { /* one missing file must not stop the app installing */ }
  }));
  // the offline page is the one file the worker can't do without
  if (!(await c.match(new URL('offline.html', SCOPE).href))) await c.add(new URL('offline.html', SCOPE).href);
  return ok;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await precache();
    if (!self.registration.active) await self.skipWaiting();   // the first worker takes over at once; updates wait for the page
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('oo-') && !KEEP.includes(name)) await caches.delete(name);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const d = event.data || {}, reply = v => { if (event.ports && event.ports[0]) event.ports[0].postMessage(v); else if (event.source) event.source.postMessage(v); };
  if (d.type === 'skip-waiting') self.skipWaiting();
  else if (d.type === 'build') reply({ type: 'build', build: BUILD });
  else if (d.type === 'status') event.waitUntil(status().then(reply));
  else if (d.type === 'clear-saved') event.waitUntil(Promise.all(Object.values(CACHES).map(n => caches.delete(n))).then(() => status()).then(reply));
});

/** How much is saved: entries per cache, and when this version's pages were saved. */
async function status() {
  const out = { type: 'status', build: BUILD, caches: {} };
  for (const name of await caches.keys()) if (name.startsWith('oo-')) out.caches[name] = (await (await caches.open(name)).keys()).length;
  const page = await saved('page', new URL('index.html', SCOPE).href);
  out.savedAt = page ? Date.parse(page.headers.get('date') || '') || null : null;
  return out;
}

// for test/sw.test.mjs (harmless in a browser)
self.__oo = { BUILD, SHELL, CACHES, classify, isTile, keyOf, ageOf, references, crawl, trim, markOffline, handle };
