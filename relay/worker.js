// Copyright (c) 2026 Destin Jones. Open Overwatch, MIT License (see LICENSE and NOTICE).
// Open Overwatch public relay, a Cloudflare Worker. A few feeds the website needs send no CORS headers (NOAA's hurricane
// advisories, buoys and tsunami messages, NYC cameras, some camera lists and stills, the submarine cable map), so a browser
// page can't read them. This passes those through, and only those, like the download's local helper (serve.js):
//   GET /?url=<encodeURIComponent(new URL(feed).href)>   the feed, with Access-Control-Allow-Origin for the website
//   GET /?url=<...>&t=<digits>                            the same (a camera still's refresh: t only busts the browser's copy)
//   GET /?ping=1                                          "ok"
// Rules: an allowlist of hosts and paths, GET only, an Origin header required (browsers always send one cross-origin;
// a script without one gets nothing), one canonical request form (anything else is a 400: extra or reordered parameters,
// a re-encoded or upper-case target would each be a fresh cache key), every redirect re-checked against the allowlist, a
// fixed Accept header (a forwarded one could poison the shared cache with an HTML rendering of a JSON feed), no cookies or
// keys passed on, a byte cap enforced on the stream. Rate limiting per address is a Cloudflare WAF rule on the route.
// Two caches share each answer for seconds to minutes, so a thousand visitors cost the volunteer feeds one request per
// interval, not a thousand: Workers Cache in front (wrangler.toml [cache], keyed by the raw request; its hits never reach
// this code, so the allowed origin is one fixed value) and caches.default inside, keyed by the canonical target alone.
// Not carried: adsb.lol (it answers Cloudflare's servers with 429, checked 2026-10-15; the download's helper asks it from
// the visitor's own address; don't disguise the relay to get past that), OpenSky (its terms forbid passing the data on, and
// a live service needs its written licence), adsb.fi (personal use only), airplanes.live and adsb.one (written permission).

const SITE = 'https://destinjones.github.io';
const ORIGINS = new Set([SITE, 'http://localhost:8787', 'http://127.0.0.1:8787']);   // a cache miss from anywhere else is refused
// host -> seconds a response is shared. Keep in sync with PUBLIC_RELAY_HOSTS (src/core/relay.js; test/relayhosts.test.mjs checks)
const TTL = {
  'www.nhc.noaa.gov': 600,            // hurricane advisories
  'webcams.nyctmc.org': 30,           // NYC traffic camera frames
  'www.submarinecablemap.com': 86400, // cable routes
  'www.drivebc.ca': 3600,             // British Columbia camera list (the pictures themselves send CORS)
  'traveler.modot.org': 3600,         // Missouri camera list (the video streams send CORS)
  'kamera.atlas.vegvesen.no': 60,     // camera stills without CORS headers: Norway, Iowa, Calgary, Singapore
  'atmsqf.iowadot.gov': 60,
  'trafficcam.calgary.ca': 60,
  'images.data.gov.sg': 300,
  'www.ndbc.noaa.gov': 600,           // NOAA buoys (latest observations, station list) and DART tsunami buoy files
  'www.tsunami.gov': 300,             // the NOAA tsunami warning centres' message feeds (NTWC, PTWC)
};
// what each host may be asked for: path prefixes, or a pattern for the camera stills the feeds name (seen 2026-10-17:
// vegvesen /api/images/<id>, Calgary /loc<n>.jpg, Singapore /api/traffic-images/<y>/<m>/<uuid>.jpg; Iowa's list was empty)
const STILL = /\.(?:jpe?g|png|webp|gif)$/i;
const PATHS = {
  'www.nhc.noaa.gov': ['/CurrentStorms.json'],
  'webcams.nyctmc.org': ['/api/cameras'],
  'www.submarinecablemap.com': ['/api/v3/'],
  'www.drivebc.ca': ['/api/webcams/', '/images/'],
  'traveler.modot.org': ['/timconfig/feed/'],
  'kamera.atlas.vegvesen.no': ['/api/images/'], 'atmsqf.iowadot.gov': [STILL], 'trafficcam.calgary.ca': [STILL], 'images.data.gov.sg': ['/api/traffic-images/'],
  'www.ndbc.noaa.gov': ['/data/latest_obs/latest_obs.txt', '/activestations.xml', '/data/realtime2/'],
  'www.tsunami.gov': ['/events/xml/'],
};
const MAX_BYTES = 30e6;
const ACCEPT = 'application/json, application/geo+json, image/*;q=0.9, */*;q=0.5';
const UA = 'OpenOverwatchRelay/1 (+https://destinjones.github.io/open-overwatch/)';

// no query string or fragment on the target either: one URL per answer (the caches are shared)
const allowed = u => u.protocol === 'https:' && !u.port && Object.hasOwn(TTL, u.hostname) && !u.username && !u.password && !u.search && !u.hash
  && PATHS[u.hostname].some(p => p instanceof RegExp ? p.test(u.pathname) : u.pathname.startsWith(p));
/** The one request URL that names target (t: a camera still's minute, or none), spelled as the runtime spells it: what
 *  the clients send (src/core/relay.js relayUrl) and, without t, the inner cache's key. */
const canonical = (target, base, t = '') => new URL('/?url=' + encodeURIComponent(target.href) + (t ? '&t=' + t : ''), base).href;

function reply(status, body, seconds = 0) {
  return new Response(body, { status, headers: {
    'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': SITE,
    'cache-control': seconds ? `public, max-age=${seconds}` : 'no-store', 'x-content-type-options': 'nosniff' } });
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': SITE, 'access-control-allow-methods': 'GET, HEAD', 'access-control-max-age': '86400' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(405, 'GET only');
    const u = new URL(req.url), origin = req.headers.get('origin'), keys = [...u.searchParams.keys()];
    if (keys.length === 1 && keys[0] === 'ping') return reply(200, 'ok', 60);
    if (!origin || !ORIGINS.has(origin)) return reply(403, 'this relay only serves Open Overwatch pages');
    let target;
    try { target = new URL(u.searchParams.get('url') || ''); } catch (e) { return reply(400, 'url= must be a full https URL'); }
    const t = u.searchParams.get('t') || '';
    if (keys.length !== (t ? 2 : 1) || (t && !/^\d{1,12}$/.test(t)) || u.href !== canonical(target, u.origin, t))
      return reply(400, 'one form only: /?url=' + encodeURIComponent(target.href) + ' (encodeURIComponent of the normalised URL; &t=<digits> may follow)');
    if (!allowed(target)) return reply(403, 'host not on the relay allowlist: ' + target.hostname);

    // the inner cache: one copy per target whatever t says (the cache in front keys by the raw URL, t included)
    const cache = req.method === 'GET' && typeof caches !== 'undefined' && caches.default, key = cache && new Request(canonical(target, u.origin));
    if (cache) { const hit = await cache.match(key).catch(() => null); if (hit) return hit; }
    const seconds = TTL[target.hostname];

    let res;
    try {
      for (let hop = 0; ; hop++) {   // follow redirects by hand so every hop is checked against the allowlist
        res = await fetch(target, { headers: { 'user-agent': UA, accept: ACCEPT }, redirect: 'manual', signal: AbortSignal.timeout(25000) });
        if (res.status < 300 || res.status >= 400) break;
        const loc = res.headers.get('location'); if (!loc) break;
        const next = new URL(loc, target);
        if (hop >= 5 || !allowed(next)) return reply(502, 'upstream redirected outside the allowlist: ' + next.hostname);
        target = next;
      }
    } catch (e) { return reply(502, 'upstream error: ' + (e.name === 'TimeoutError' ? 'timeout' : e.message)); }

    const len = +res.headers.get('content-length') || 0, type = res.headers.get('content-type') || '';
    if (len > MAX_BYTES) return reply(502, 'upstream response too large');
    const h = new Headers({ 'access-control-allow-origin': SITE, 'x-content-type-options': 'nosniff', 'x-relay': 'open-overwatch' });
    for (const k of ['content-type', 'content-length', 'last-modified', 'etag']) { const v = res.headers.get(k); if (v) h.set(k, v); }
    // only good answers are shared; errors (a 429 from a busy feed) are not, so the next visitor tries again. An HTML
    // page where a feed was expected (a login page, an error page, a content-negotiated rendering) is never shared either
    const share = res.ok && !/text\/html/i.test(type);
    h.set('cache-control', share ? `public, max-age=${seconds}` : 'no-store');
    // the byte cap holds without a Content-Length too (chunked or compressed answers): count as it streams
    let seen = 0;
    const capped = res.body && res.body.pipeThrough(new TransformStream({ transform(chunk, ctl) { seen += chunk.byteLength; if (seen > MAX_BYTES) ctl.error(new Error('too large')); else ctl.enqueue(chunk); } }));
    if (req.method === 'HEAD') return new Response(null, { status: res.status, headers: h });
    const out = new Response(capped, { status: res.status, headers: h });
    if (cache && share) { const put = cache.put(key, out.clone()).catch(() => { }); if (ctx && ctx.waitUntil) ctx.waitUntil(put); }
    return out;
  },
};
